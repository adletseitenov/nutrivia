"""Ограничение частоты запросов в памяти процесса (один сервер пилота; при нескольких — вынести в Redis).
Скользящее окно: не больше N запросов за W секунд на ключ (IP или токен сессии)."""
import os
import time
from collections import defaultdict, deque

# (префикс пути, метод) → (запросов, окно в секундах, по чему считаем)
RULES = (
    # Вход: 60 запросов за 10 минут с адреса. Один вход — 2 запроса (номер и код); на показе в зале люди
    # сидят за одним Wi-Fi (общий адрес), поэтому не 20. Перебор кода держит сам код: 5 попыток на номер.
    ("/v1/auth/", "POST", 60, 600, "ip"),
    ("/v1/meals", "POST", 40, 3600, "token"),    # фото и ручной ввод: 40 в час на сессию (дневной лимит фото — отдельно)
    ("/v1/fridge", "POST", 20, 3600, "token"),
    ("/v1/admin/", "", 60, 60, "ip"),
)
AUTH_LIMIT = RULES[0][2]


def client_ip(headers, peer: str | None) -> str:
    """Адрес человека. За прокси хостинга (TRUST_PROXY=1, Railway) все запросы приходят с адреса прокси —
    настоящий он дописывает последним в X-Forwarded-For; первые значения может подставить сам клиент.
    Без TRUST_PROXY заголовкам не верим: их подделывает кто угодно."""
    if os.environ.get("TRUST_PROXY"):
        last = headers.get("x-forwarded-for", "").split(",")[-1].strip()
        if last:
            return last
    return peer or "?"


class RateLimiter:
    def __init__(self, rules=RULES, clock=time.monotonic):
        self.rules, self.clock = rules, clock
        self.hits: dict[tuple, deque] = defaultdict(deque)
        self.checks = 0

    def check(self, path: str, method: str, ip: str, token: str | None) -> int | None:
        """None — можно; число — сколько секунд подождать."""
        self.checks += 1
        if self.checks % 1000 == 0:
            self._prune()
        for prefix, m, limit, window, by in self.rules:
            if not path.startswith(prefix) or (m and m != method):
                continue
            key = (prefix, ip if by == "ip" or not token else token)
            now = self.clock()
            q = self.hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return int(q[0] + window - now) + 1
            q.append(now)
        return None

    def _prune(self) -> None:
        """Ключи без свежих запросов — из памяти (иначе каждый адрес и токен копится до перезапуска)."""
        now = self.clock()
        longest = max(w for *_, w, _ in self.rules)
        for key in [k for k, q in self.hits.items() if not q or q[-1] <= now - longest]:
            del self.hits[key]
