"""Бэкап базы и фото. Безопасно на работающем сервере: копия базы — через SQLite backup API.

    .venv/bin/python -m scripts.backup [папка=backups] [хранить=14]

Кладёт nutrivia-ГГГГММДД-ЧЧММ.db и такой же .tar.gz с фото, старые сверх «хранить» удаляет.
Для ежедневного запуска: cron `0 4 * * * cd /app && python -m scripts.backup /data/backups`.
"""
import sqlite3
import sys
import tarfile
from datetime import datetime
from pathlib import Path

from nutrivia.config import load_config


def main(out: str = "backups", keep: int = 14) -> None:
    cfg = load_config()
    dest = Path(out)
    dest.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    db_copy = dest / f"nutrivia-{stamp}.db"
    src = sqlite3.connect(cfg.db_path)
    with sqlite3.connect(db_copy) as dst:
        src.backup(dst)
    src.close()
    photos = Path(cfg.photos_dir)
    if photos.is_dir():
        with tarfile.open(dest / f"nutrivia-{stamp}.tar.gz", "w:gz") as tar:
            tar.add(photos, arcname="photos")
    for pattern in ("nutrivia-*.db", "nutrivia-*.tar.gz"):
        for old in sorted(dest.glob(pattern))[:-keep]:
            old.unlink()
    print(f"бэкап: {db_copy}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "backups", int(sys.argv[2]) if len(sys.argv) > 2 else 14)
