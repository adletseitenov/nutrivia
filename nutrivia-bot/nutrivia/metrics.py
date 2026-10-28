"""Метрики фазы 0 из таблицы events: пороги гейта + ошибка граммов модели и недостающие блюда."""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median

from .db import Database


def _median(xs):
    return round(median(xs), 1) if xs else None


async def compute_metrics(db: Database) -> dict:
    events = [dict(r) | {"data": json.loads(r["data"]) if r["data"] else {}}
              for r in await db.fetchall("SELECT * FROM events ORDER BY ts")]
    by_name = defaultdict(list)
    for e in events:
        by_name[e["name"]].append(e)

    joined = {e["user_id"]: e for e in by_name["user_joined"]}
    groups = Counter(e["data"].get("group") for e in joined.values())

    # Удержание: доля пользователей, приславших фото на N-й день с момента входа (N=1,3,7,14)
    photo_days = defaultdict(set)
    for e in by_name["photo_received"]:
        j = joined.get(e["user_id"])
        if j:
            photo_days[e["user_id"]].add((e["ts"] - j["ts"]) // 86400 + 1)
    consented = {e["user_id"] for e in by_name["consent"]}
    retention = {}
    for n in (1, 3, 7, 14):
        retention[f"d{n}"] = round(sum(1 for u in consented if n in photo_days[u]) / len(consented), 3) \
            if consented else None
    active_days = Counter(len(d) for d in photo_days.values())

    review_seconds = [e["data"]["review_seconds"] for e in by_name["review_done"]]
    reviewer_by_group = defaultdict(list)
    for e in by_name["review_done"]:
        grp = joined.get(e["user_id"], {}).get("data", {}).get("group", "?")
        reviewer_by_group[grp].append(e["data"]["review_seconds"])

    # Ошибка граммов модели против человека по блюдам
    gram_err = defaultdict(list)
    for e in by_name["review_done"]:
        for it in e["data"].get("items", []):
            if it.get("ai_grams") and it.get("grams"):
                gram_err[it.get("dish_id") or it["raw_name"]].append(abs(it["ai_grams"] - it["grams"]) / it["grams"])
    all_err = [x for xs in gram_err.values() for x in xs]

    missing = Counter(name.lower() for e in by_name["draft_ready"] for name in e["data"].get("unmatched", []))
    ai = await db.fetchone("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost,"
                           " SUM(status IN ('error','refusal')) AS failed FROM ai_requests")
    sent = len(by_name["reply_sent"])

    return {
        "summary": {
            "users_joined": len(joined),
            "users_coach": groups.get("coach", 0),
            "users_solo": groups.get("solo", 0),
            "users_consented": len(consented),
            "users_deleted": len(by_name["deleted"]),
            "photos": len(by_name["photo_received"]),
            "replies_sent": sent,
            "confirmed_rate": round(len(by_name["client_confirmed"]) / sent, 3) if sent else None,
            "corrected_rate": round(len(by_name["client_corrected"]) / sent, 3) if sent else None,
            "median_draft_latency_s": _median([e["data"].get("latency_ms", 0) / 1000 for e in by_name["draft_ready"]]),
            "median_review_seconds": _median(review_seconds),
            "median_review_seconds_coach": _median(reviewer_by_group["coach"]),
            "median_review_seconds_solo": _median(reviewer_by_group["solo"]),
            "median_total_latency_s": _median([e["data"]["total_latency"] for e in by_name["reply_sent"]]),
            "users_7plus_photo_days": sum(v for k, v in active_days.items() if k >= 7),
            **{f"retention_{k}": v for k, v in retention.items()},
            "advice_sent": len(by_name["advice_sent"]),
            "advice_done": len(by_name["advice_done"]),
            "weekly_reports": len(by_name["weekly_report_sent"]),
            "payment_links": len(by_name["payment_link_sent"]),
            "paid": len(by_name["paid"]),
            "paid_solo": sum(1 for e in by_name["paid"]
                             if joined.get(e["user_id"], {}).get("data", {}).get("group") == "solo"),
            "gram_error_mean": round(mean(all_err), 3) if all_err else None,
            "gram_error_median": _median(all_err),
            "ai_requests": ai["n"],
            "ai_failed": ai["failed"] or 0,
            "ai_cost_usd": round(ai["cost"], 4),
        },
        "gram_error": sorted(((k, len(v), round(mean(v), 3)) for k, v in gram_err.items()), key=lambda r: -r[1]),
        "missing_dishes": missing.most_common(),
        "events": events,
    }


async def export_csv(db: Database, out_dir: str) -> Path:
    m = await compute_metrics(db)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["metric", "value"])
        w.writerows(m["summary"].items())
    with open(out / "gram_error.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["dish", "n", "mean_rel_error"])
        w.writerows(m["gram_error"])
    with open(out / "missing_dishes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "count"])
        w.writerows(m["missing_dishes"])
    with open(out / "events.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ts", "user_id", "name", "data"])
        for e in m["events"]:
            w.writerow([e["ts"], e["user_id"], e["name"], json.dumps(e["data"], ensure_ascii=False)])
    return out
