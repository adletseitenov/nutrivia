"""Выгрузка метрик в CSV (для Google Sheets): python -m scripts.export_metrics [папка]"""
import asyncio
import sys
from datetime import datetime

from nutrivia.config import ALMATY, ROOT, load_config
from nutrivia.db import Database
from nutrivia.metrics import compute_metrics, export_csv


async def main() -> None:
    cfg = load_config()
    db = Database(cfg.db_path)
    await db.connect()
    out_dir = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "exports" / datetime.now(ALMATY).strftime("%Y-%m-%d"))
    path = await export_csv(db, out_dir)
    for k, v in (await compute_metrics(db))["summary"].items():
        print(f"{k:32} {v}")
    print(f"\nCSV: {path}")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
