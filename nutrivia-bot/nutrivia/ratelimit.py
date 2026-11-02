"""Ограничение частоты запросов в памяти процесса (один сервер пилота; при нескольких — вынести в Redis).
Скользящее окно: не больше N запросов за W секунд на ключ (IP или токен сессии)."""
import time
from collections import defaultdict, deque

# (префикс пути, метод) → (запросов, окно в секундах, по чему считаем)
RULES = (
    ("/v1/auth/", "POST", 20, 600, "ip"),        # перебор кодов и рассылка: 20 попыток за 10 минут с адреса
    ("/v1/meals", "POST", 40, 3600, "token"),    # фото и ручной ввод: 40 в час на сессию (дневной лимит фото — отдельно)
    ("/v1/fridge", "POST", 20, 3600, "token"),
    ("/v1/admin/", "", 60, 60, "ip"),
)


class RateLimiter:
    def __init__(self, rules=RULES, clock=time.monotonic):
        self.rules, self.clock = rules, clock
        self.hits: dict[tuple, deque] = defaultdict(deque)

    def check(self, path: str, method: str, ip: str, token: str | None) -> int | None:
        """None — можно; число — сколько секунд подождать."""
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
