"""Вечерний совет и недельный итог: правила + шаблоны из texts.py, без LLM.
Шаблоны проверяет нутрициолог-партнёр до запуска."""
from collections import Counter

from .engine import Dish, DishBase, compute, portion_text
from .texts import t

# Ориентиры по цели по умолчанию; нутрициолог меняет командой /target
DEFAULT_TARGETS = {
    "lose": (1600, 90),
    "muscle": (2300, 120),
    "even": (2000, 75),
    "coach_plan": (2000, 75),
    None: (2000, 75),
}


def targets_for(user) -> tuple[int, int]:
    kcal, protein = DEFAULT_TARGETS.get(user["goal"], DEFAULT_TARGETS[None])
    return (user["kcal_target"] or kcal), protein


def pick_options(base: DishBase, remaining_kcal: float, protein_low: bool,
                 allowed: tuple[str, ...] | None = None, limit: int = 3) -> list[tuple[Dish, float]]:
    """1–3 блюда из базы на одну обычную порцию, которые помещаются в остаток дня.
    При нехватке белка сначала белковые."""
    budget = max(remaining_kcal, 250)  # совет «ничего не есть» не даём
    pool = [d for d in base if d.advice and (allowed is None or d.id in allowed)]
    scored = []
    for d in pool:
        grams = d.unit_grams or 100
        kcal = compute(d, grams).kcal
        if kcal > budget:
            grams = round(budget / d.kcal * 100 / 10) * 10
            if grams < 50:
                continue
            kcal = compute(d, grams).kcal
        density = compute(d, grams).protein / max(kcal, 1)
        scored.append((density if protein_low else -abs(budget * 0.6 - kcal), d, grams))
    scored.sort(key=lambda x: (-x[0], x[1].id))
    return [(d, g) for _, d, g in scored[:limit]]


def advice_text(user, eaten: dict, base: DishBase, allowed: tuple[str, ...] | None = None) -> str:
    lang = user["lang"]
    kcal_target, protein_target = targets_for(user)
    remaining = kcal_target - eaten["kcal"]
    protein_low = eaten["protein"] < protein_target * 0.7
    if eaten["meals"]:
        lines = [t("advice_header", lang, eaten=round(eaten["kcal"]), protein=round(eaten["protein"]))]
    else:
        lines = [t("advice_empty_day", lang)]
    for d, grams in pick_options(base, remaining, protein_low, allowed):
        n = compute(d, grams)
        lines.append(f"• {d.name(lang)} — {portion_text(d, grams)}, ~{round(n.kcal)} ккал, белок {round(n.protein)} г")
    if eaten["meals"] and protein_low:
        lines.append(t("advice_protein", lang))
    elif eaten["meals"] and remaining < 400:
        lines.append(t("advice_light", lang))
    return "\n".join(lines)


def weekly_text(user, days: list[dict], dish_counts: Counter, base: DishBase) -> str:
    """days — итоги по дням (только дни с записями)."""
    lang = user["lang"]
    kcal_target, protein_target = targets_for(user)
    n = len(days)
    avg_kcal = round(sum(d["kcal"] for d in days) / n) if n else 0
    avg_protein = round(sum(d["protein"] for d in days) / n) if n else 0
    top = ", ".join(base.get(i).name(lang) for i, _ in dish_counts.most_common(3) if base.get(i)) or "—"
    if n < 4:
        note = t("weekly_note_few", lang)
    elif avg_protein < protein_target * 0.8:
        note = t("weekly_note_protein", lang)
    else:
        note = t("weekly_note_ok", lang)
    return t("weekly", lang, days=n, meals=sum(d["meals"] for d in days), kcal=avg_kcal, protein=avg_protein,
             target=kcal_target, protein_target=protein_target, top=top, note=note)
