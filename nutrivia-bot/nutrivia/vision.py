"""VisionProvider: фото → список блюд с граммами. Нутриенты модель не считает.
Схема и промпт без изменений переезжают в VisionProvider M2."""
import base64
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

import anthropic
import httpx

log = logging.getLogger(__name__)

# $ за 1M токенов (claude-opus-5-5). Для отчёта о стоимости, не для биллинга.
PRICE_IN, PRICE_OUT = 4.0, 20.0

DISHES_SCHEMA = {
    "type": "object",
    "properties": {
        "is_food": {"type": "boolean"},
        "dishes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "portion": {"type": "number"},
                    "unit": {"type": "string"},
                    "grams": {"type": "number"},
                    "confidence": {"type": "number"},
                },
                "required": ["name", "portion", "unit", "grams", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_food", "dishes"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """Ты помогаешь нутрициологу в Казахстане разбирать фото еды клиентов.
По фото перечисли каждое отдельное блюдо или продукт на столе, который человек, судя по всему, ест.

Для каждого блюда:
- name — короткое обычное название на русском, как его назовут в Алматы (плов, манты, бешбармак, баурсак, лепёшка, салат из свежих овощей, чай с молоком).
- unit — местная мера: пиала, тарелка, кесе, штука, кусок, ломтик, стакан, порция.
- portion — сколько таких мер (можно дробно: 0.5, 1.5).
- grams — твоя оценка массы съедаемой части в граммах.
- confidence — уверенность от 0 до 1 в названии и граммах вместе.

Не считай калории и нутриенты — это делает база. Если на фото нет еды, верни is_food=false и пустой список.
Ориентиры: пиала плова ≈300 г, тарелка бешбармака ≈350 г, одна манта ≈60 г, баурсак ≈25 г, четверть лепёшки ≈60 г, кесе ≈200–250 мл."""


@dataclass
class VisionDish:
    name: str
    portion: float
    unit: str
    grams: float
    confidence: float


@dataclass
class VisionResult:
    status: str                       # ok | not_food | refusal | error
    dishes: list[VisionDish] = field(default_factory=list)
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    error: str = ""
    raw: dict | None = None


class VisionProvider(Protocol):
    async def analyze(self, image: bytes, media_type: str = "image/jpeg") -> VisionResult: ...


def parse_payload(payload: dict) -> list[VisionDish]:
    dishes = []
    for d in payload.get("dishes", []):
        grams = float(d.get("grams") or 0)
        if grams <= 0 or not str(d.get("name", "")).strip():
            continue
        dishes.append(VisionDish(
            name=str(d["name"]).strip(),
            portion=float(d.get("portion") or 0),
            unit=str(d.get("unit") or ""),
            grams=min(grams, 2000.0),
            confidence=max(0.0, min(1.0, float(d.get("confidence") or 0))),
        ))
    return dishes


class ClaudeVision:
    def __init__(self, model: str = "claude-opus-5-5", client: anthropic.AsyncAnthropic | None = None):
        self.model = model
        self.client = client or anthropic.AsyncAnthropic()

    async def analyze(self, image: bytes, media_type: str = "image/jpeg") -> VisionResult:
        started = time.monotonic()
        try:
            resp = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=4000,
                system=SYSTEM_PROMPT,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": DISHES_SCHEMA},
                },
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {
                            "type": "base64", "media_type": media_type,
                            "data": base64.standard_b64encode(image).decode("ascii"),
                        }},
                        {"type": "text", "text": "Разбери фото."},
                    ],
                }],
            )
        except anthropic.RateLimitError as e:
            return self._fail(started, f"rate_limit: {e}")
        except anthropic.APIStatusError as e:
            return self._fail(started, f"api_status {e.status_code}: {e}")
        except anthropic.APIConnectionError as e:
            return self._fail(started, f"connection: {e}")

        result = VisionResult(
            status="ok",
            model=resp.model,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            cost_usd=(resp.usage.input_tokens * PRICE_IN + resp.usage.output_tokens * PRICE_OUT) / 1_000_000,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        if resp.stop_reason == "refusal":
            result.status = "refusal"
            return result
        if resp.stop_reason == "max_tokens":
            result.status, result.error = "error", "max_tokens"
            return result

        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            result.status, result.error = "error", "bad_json"
            return result
        result.raw = payload
        result.dishes = parse_payload(payload)
        if not payload.get("is_food") or not result.dishes:
            result.status = "not_food"
        return result

    def _fail(self, started: float, error: str) -> VisionResult:
        log.warning("vision failed: %s", error)
        return VisionResult(status="error", model=self.model, error=error,
                            latency_ms=int((time.monotonic() - started) * 1000))


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterVision:
    """Тот же промпт и схема через OpenRouter: одна оплата, любая модель с картинками.
    Стоимость берём из usage.cost — OpenRouter считает её сам по цене выбранной модели."""

    def __init__(self, model: str, api_key: str, client: httpx.AsyncClient | None = None, timeout: float = 60):
        self.model, self.api_key = model, api_key
        self.client = client or httpx.AsyncClient(timeout=timeout)

    async def analyze(self, image: bytes, media_type: str = "image/jpeg") -> VisionResult:
        started = time.monotonic()
        data_url = f"data:{media_type};base64,{base64.standard_b64encode(image).decode('ascii')}"
        body = {
            "model": self.model,
            "max_tokens": 4000,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": "Разбери фото."},
                ]},
            ],
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": "dishes", "strict": True, "schema": DISHES_SCHEMA}},
            # Только провайдеры, которые держат схему ответа; без неё разбор не парсится
            "provider": {"require_parameters": True},
            "usage": {"include": True},
        }
        try:
            resp = await self.client.post(OPENROUTER_URL, json=body, headers={
                "Authorization": f"Bearer {self.api_key}",
                "X-Title": "Nutrivia",
            })
        except httpx.HTTPError as e:
            return self._fail(started, f"connection: {e}")
        if resp.status_code == 429:
            return self._fail(started, f"rate_limit: {resp.text[:200]}")
        if resp.status_code >= 400:
            return self._fail(started, f"api_status {resp.status_code}: {resp.text[:200]}")

        out = resp.json()
        if "error" in out:
            return self._fail(started, f"api_error: {str(out['error'])[:200]}")
        usage = out.get("usage") or {}
        choice = (out.get("choices") or [{}])[0]
        result = VisionResult(
            status="ok",
            model=out.get("model", self.model),
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            cost_usd=float(usage.get("cost") or 0),
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        finish = choice.get("finish_reason")
        if finish == "content_filter":
            result.status = "refusal"
            return result
        if finish == "length":
            result.status, result.error = "error", "max_tokens"
            return result

        text = (choice.get("message") or {}).get("content") or ""
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            result.status, result.error = "error", "bad_json"
            return result
        result.raw = payload
        result.dishes = parse_payload(payload)
        if not payload.get("is_food") or not result.dishes:
            result.status = "not_food"
        return result

    def _fail(self, started: float, error: str) -> VisionResult:
        log.warning("vision failed: %s", error)
        return VisionResult(status="error", model=self.model, error=error,
                            latency_ms=int((time.monotonic() - started) * 1000))


def make_vision(provider: str, model: str = "", openrouter_key: str = "") -> VisionProvider:
    """VISION_PROVIDER: claude | openrouter | fake."""
    if provider == "fake":
        return FakeVision()
    if provider == "openrouter":
        if not openrouter_key:
            raise RuntimeError("VISION_PROVIDER=openrouter, но нет OPENROUTER_API_KEY")
        return OpenRouterVision(model or "anthropic/claude-sonnet-5.5", openrouter_key)
    return ClaudeVision(model or "claude-opus-5-5")


class FakeVision:
    """Офлайн-провайдер для тестов и прогона без API: возвращает заданный ответ."""

    def __init__(self, payload: dict | None = None):
        self.payload = payload or {"is_food": True, "dishes": [
            {"name": "плов", "portion": 1, "unit": "пиала", "grams": 300, "confidence": 0.8},
            {"name": "салат из свежих овощей", "portion": 0.5, "unit": "тарелка", "grams": 100, "confidence": 0.7},
        ]}

    async def analyze(self, image: bytes, media_type: str = "image/jpeg") -> VisionResult:
        dishes = parse_payload(self.payload)
        status = "ok" if self.payload.get("is_food") and dishes else "not_food"
        return VisionResult(status=status, dishes=dishes, model="fake", raw=self.payload)
