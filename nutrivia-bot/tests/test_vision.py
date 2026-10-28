import json
from types import SimpleNamespace

import pytest

from nutrivia.vision import DISHES_SCHEMA, ClaudeVision, FakeVision


class FakeMessages:
    def __init__(self, resp):
        self.resp, self.kwargs = resp, None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        return self.resp


def fake_client(stop_reason="end_turn", payload=None):
    text = json.dumps(payload if payload is not None else {"is_food": True, "dishes": [
        {"name": "манты", "portion": 4, "unit": "штука", "grams": 240, "confidence": 0.8}]})
    resp = SimpleNamespace(stop_reason=stop_reason, model="claude-opus-5-5",
                           content=[SimpleNamespace(type="thinking"), SimpleNamespace(type="text", text=text)],
                           usage=SimpleNamespace(input_tokens=1500, output_tokens=300))
    msgs = FakeMessages(resp)
    return SimpleNamespace(beta=SimpleNamespace(messages=msgs)), msgs


async def test_request_shape_and_parse():
    client, msgs = fake_client()
    r = await ClaudeVision(client=client).analyze(b"jpeg")
    kw = msgs.kwargs
    assert kw["model"] == "claude-opus-5-5"
    assert kw["fallbacks"] == "default"
    assert kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert kw["output_config"]["format"] == {"type": "json_schema", "schema": DISHES_SCHEMA}
    assert "thinking" not in kw and "temperature" not in kw
    assert r.status == "ok" and r.dishes[0].name == "манты" and r.dishes[0].grams == 240
    assert r.cost_usd == pytest.approx((1500 * 4 + 300 * 20) / 1e6)


async def test_refusal_and_not_food():
    client, _ = fake_client(stop_reason="refusal")
    assert (await ClaudeVision(client=client).analyze(b"x")).status == "refusal"
    client, _ = fake_client(payload={"is_food": False, "dishes": []})
    assert (await ClaudeVision(client=client).analyze(b"x")).status == "not_food"


async def test_bad_values_filtered():
    r = await FakeVision({"is_food": True, "dishes": [
        {"name": "", "portion": 1, "unit": "", "grams": 100, "confidence": 1},
        {"name": "чай", "portion": 1, "unit": "кесе", "grams": 0, "confidence": 1},
        {"name": "плов", "portion": 9, "unit": "пиала", "grams": 9000, "confidence": 3}]}).analyze(b"")
    assert len(r.dishes) == 1 and r.dishes[0].grams == 2000 and r.dishes[0].confidence == 1


def openrouter_vision(handler):
    from nutrivia.vision import OpenRouterVision
    import httpx
    return OpenRouterVision("anthropic/claude-sonnet-5.5", "sk-or-test",
                            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def openrouter_reply(content, finish="stop"):
    import httpx
    return httpx.Response(200, json={
        "model": "anthropic/claude-sonnet-5.5",
        "choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 1200, "completion_tokens": 150, "cost": 0.0039},
    })


async def test_openrouter_request_and_parse():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return openrouter_reply(json.dumps({"is_food": True, "dishes": [
            {"name": "манты", "portion": 4, "unit": "штука", "grams": 240, "confidence": 0.8}]}))

    r = await openrouter_vision(handler).analyze(b"jpeg", "image/jpeg")
    assert r.status == "ok" and r.dishes[0].name == "манты" and r.dishes[0].grams == 240
    assert r.cost_usd == 0.0039 and r.input_tokens == 1200
    body = seen["body"]
    assert seen["auth"] == "Bearer sk-or-test"
    assert body["response_format"]["json_schema"]["schema"] == DISHES_SCHEMA
    assert body["provider"]["require_parameters"] is True
    assert body["messages"][1]["content"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")


async def test_openrouter_failures():
    import httpx
    assert (await openrouter_vision(lambda r: openrouter_reply("", "content_filter")).analyze(b"x")).status == "refusal"
    assert (await openrouter_vision(lambda r: openrouter_reply("{oops")).analyze(b"x")).error == "bad_json"
    r = await openrouter_vision(lambda r: openrouter_reply(json.dumps({"is_food": False, "dishes": []}))).analyze(b"x")
    assert r.status == "not_food"
    r = await openrouter_vision(lambda r: httpx.Response(402, json={"error": {"message": "no credits"}})).analyze(b"x")
    assert r.status == "error" and "402" in r.error


def test_make_vision():
    from nutrivia.vision import OpenRouterVision, make_vision
    assert isinstance(make_vision("fake"), FakeVision)
    assert make_vision("openrouter", "", "k").model == "anthropic/claude-sonnet-5.5"
    assert isinstance(make_vision("openrouter", "google/gemini-3.8-flash", "k"), OpenRouterVision)
    with pytest.raises(RuntimeError):
        make_vision("openrouter", "", "")
