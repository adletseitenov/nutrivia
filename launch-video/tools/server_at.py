"""Сервер Nutrivia «как будто сейчас» SERVER_NOW (ISO, Алматы) — для записи экранов в нужное время суток.
Только для локальной записи футажа: время идёт дальше от этой точки."""
import os, time
from datetime import datetime
import nutrivia.db as db
from nutrivia.config import ALMATY

shift = datetime.fromisoformat(os.environ["SERVER_NOW"]).replace(tzinfo=ALMATY).timestamp() - time.time()
db.now = lambda: int(time.time() + shift)

from nutrivia.api import main  # noqa: E402  — импорт после подмены, чтобы Database взяла новые часы
main()
