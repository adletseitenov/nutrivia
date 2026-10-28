"""Черновик разбора: ответ модели → блюда базы → КБЖУ. И правки «плов 350» от проверяющего или клиента."""
from .engine import DishBase, Nutrients, compute, portion_text
from .matcher import Matcher
from .texts import t
from .vision import VisionDish


def make_item(raw_name: str, grams: float, base: DishBase, matcher: Matcher,
              ai_grams: float | None = None, dish_id: str | None = None, portion: str | None = None) -> dict:
    dish = base.get(dish_id)
    if dish is None:
        m = matcher.match(raw_name)
        dish = m.dish if m else None
    item = {"raw_name": raw_name, "grams": float(grams), "ai_grams": ai_grams,
            "dish_id": dish.id if dish else None, "portion": portion,
            "kcal": None, "protein": None, "fat": None, "carbs": None}
    if dish:
        n = compute(dish, grams)
        item.update(kcal=n.kcal, protein=n.protein, fat=n.fat, carbs=n.carbs, portion=portion_text(dish, grams))
    return item


def build_items(dishes: list[VisionDish], base: DishBase, matcher: Matcher) -> list[dict]:
    return [make_item(d.name, d.grams, base, matcher, ai_grams=d.grams) for d in dishes]


def apply_edits(items: list[dict], edits: list[tuple[str, float]], base: DishBase,
                matcher: Matcher) -> tuple[list[dict], list[str]]:
    """Меняет граммы у совпавших блюд, добавляет новые; grams=0 убирает блюдо.
    Возвращает новые позиции и названия, которые не нашли ни в разборе, ни в базе."""
    items = [dict(i) for i in items]
    unknown = []
    for name, grams in edits:
        m = matcher.match(name)
        target = None
        for it in items:
            if (m and it["dish_id"] == m.dish.id) or it["raw_name"].lower() == name.lower():
                target = it
                break
        if target is not None:
            if grams == 0:
                items.remove(target)
            else:
                target.update(make_item(target["raw_name"], grams, base, matcher,
                                        ai_grams=target.get("ai_grams"), dish_id=target["dish_id"]))
        elif m and grams > 0:
            items.append(make_item(m.dish.name_ru, grams, base, matcher, dish_id=m.dish.id))
        else:
            unknown.append(name)
    return items, unknown


def totals(items) -> Nutrients:
    total = Nutrients()
    for it in items:
        if it["kcal"] is not None:
            total = total + Nutrients(it["kcal"], it["protein"], it["fat"], it["carbs"])
    return total.rounded()


def _item_line(it, base: DishBase, lang: str) -> str:
    dish = base.get(it["dish_id"])
    if dish is None:
        return f"• {it['raw_name']} — ≈{round(it['grams'])} г ({t('reply_unknown', lang)})"
    return f"• {dish.name(lang)} — {it['portion']}: {round(it['kcal'])} ккал"


def format_client(items, base: DishBase, lang: str = "ru", comment: str | None = None) -> str:
    total = totals(items)
    lines = [t("reply_header", lang), *(_item_line(it, base, lang) for it in items), "",
             t("reply_total", lang, kcal=total.kcal, p=total.protein, f=total.fat, c=total.carbs)]
    if comment:
        lines += ["", t("reply_comment", lang, text=comment)]
    lines += ["", t("reply_footer", lang)]
    return "\n".join(lines)


def format_review(meal_id: int, user, coach_name: str | None, items, base: DishBase,
                  confidence: dict[str, float] | None = None, comment: str | None = None) -> str:
    """Карточка для группы проверки (всегда на русском)."""
    who = f"Клиент {user['tg_id']}" + (f" · нутрициолог {coach_name}" if coach_name else " · одиночка")
    goal = f"цель: {user['goal'] or '—'}" + (f", ограничения: {user['restrictions']}" if user["restrictions"] else "")
    lines = [f"#meal{meal_id} · {who}", goal, ""]
    for it in items:
        conf = (confidence or {}).get(it["raw_name"])
        conf_txt = f" · увер. {conf:.0%}" if conf is not None else ""
        if it["dish_id"]:
            lines.append(f"• {it['raw_name']} → {base.get(it['dish_id']).name_ru}: {round(it['grams'])} г, "
                         f"{round(it['kcal'])} ккал{conf_txt}")
        else:
            lines.append(f"• ❗ {it['raw_name']}: {round(it['grams'])} г — НЕТ В БАЗЕ{conf_txt}")
    total = totals(items)
    lines += ["", f"Итого: {total.kcal} ккал · Б {total.protein} · Ж {total.fat} · У {total.carbs}"]
    if comment:
        lines.append(f"Комментарий: {comment}")
    lines.append("Править: ответьте на это сообщение строками «плов 350» (0 — убрать блюдо).")
    return "\n".join(lines)
