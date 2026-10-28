import os
from dataclasses import dataclass, field
from datetime import timedelta, timezone
from pathlib import Path

ALMATY = timezone(timedelta(hours=5))
ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


@dataclass
class Config:
    bot_token: str = ""
    solo_review_chat_id: int = 0
    admin_ids: set[int] = field(default_factory=set)
    vision_provider: str = "claude"
    vision_model: str = ""             # пусто — модель провайдера по умолчанию
    openrouter_api_key: str = ""
    db_path: str = str(ROOT / "data" / "nutrivia.db")
    photos_dir: str = str(ROOT / "data" / "photos")
    dishes_csv: str = str(ROOT / "data" / "dishes.csv")
    daily_photo_limit: int = 15
    kaspi_pay_url: str = ""
    offer_price_kzt: int = 2000
    # Часы приёма фото: вне окна отвечаем «разбор утром»
    work_start_hour: int = 9
    work_end_hour: int = 22
    advice_hour: int = 19
    weekly_hour: int = 20
    offer_day: int = 15


def load_config() -> Config:
    _load_dotenv(ROOT / ".env")
    env = os.environ
    return Config(
        bot_token=env.get("BOT_TOKEN", ""),
        solo_review_chat_id=int(env.get("SOLO_REVIEW_CHAT_ID", "0") or 0),
        admin_ids={int(x) for x in env.get("ADMIN_IDS", "").split(",") if x.strip()},
        vision_provider=env.get("VISION_PROVIDER", "claude"),
        vision_model=env.get("VISION_MODEL", ""),
        openrouter_api_key=env.get("OPENROUTER_API_KEY", ""),
        db_path=env.get("DB_PATH", str(ROOT / "data" / "nutrivia.db")),
        photos_dir=env.get("PHOTOS_DIR", str(ROOT / "data" / "photos")),
        dishes_csv=env.get("DISHES_CSV", str(ROOT / "data" / "dishes.csv")),
        daily_photo_limit=int(env.get("DAILY_PHOTO_LIMIT", "15")),
        kaspi_pay_url=env.get("KASPI_PAY_URL", ""),
        offer_price_kzt=int(env.get("OFFER_PRICE_KZT", "2000")),
    )
