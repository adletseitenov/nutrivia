"""«Холодильник»: продукты с фото → что приготовить из базы блюд под остаток калорий дня.
Модель только называет продукты; блюда — шаблоны ниже, калории и белок считает Engine. Без LLM-рецептов."""
import re
from dataclasses import dataclass

from .engine import DishBase, compute

# Продукт → ключ: по началу слова, чтобы «яйца», «яйцо», «яичный» и «куриное филе» узнавались
PRODUCT_KEYS = {
    "egg": r"яйц|яич", "chicken": r"куриц|курин|филе", "buckwheat": r"греч", "rice": r"рис",
    "potato": r"картоф|картош", "cottage": r"творог|сүзбе", "kefir": r"кефир|айран", "tomato": r"помидор|томат",
    "cucumber": r"огур", "oatmeal": r"овсян|геркулес|хлопь", "banana": r"банан", "apple": r"яблок",
    "pasta": r"макарон|паст|спагетт", "fish": r"рыб|судак|минта|горбуш|лосос", "beef": r"говяд|мяс|фарш",
    "yogurt": r"йогурт", "bread": r"хлеб|лепеш|батон", "pepper": r"перец|перц", "cabbage": r"капуст",
}


@dataclass(frozen=True)
class Idea:
    title: str
    needs: tuple[str, ...]
    items: tuple[tuple[str, float], ...]  # (dish_id, граммы на обычную порцию)
    minutes: int


IDEAS = (
    Idea("Куриная грудка с гречкой", ("chicken", "buckwheat"), (("chicken_breast", 150), ("buckwheat", 150)), 25),
    Idea("Курица с рисом", ("chicken", "rice"), (("chicken_breast", 150), ("rice_boiled", 150)), 25),
    Idea("Курица с картофелем", ("chicken", "potato"), (("chicken_breast", 150), ("potato_boiled", 200)), 30),
    Idea("Макароны с курицей", ("pasta", "chicken"), (("pasta", 180), ("chicken_breast", 120)), 20),
    Idea("Говядина с гречкой", ("beef", "buckwheat"), (("beef_boiled", 120), ("buckwheat", 150)), 40),
    Idea("Рыба с картофелем", ("fish", "potato"), (("fish_baked", 150), ("potato_boiled", 200)), 30),
    Idea("Омлет с овощами", ("egg", "tomato"), (("omelet", 110), ("salad_veg", 100)), 10),
    Idea("Яйца с хлебом", ("egg", "bread"), (("egg_boiled", 100), ("bread_white", 30)), 10),
    Idea("Творог с кефиром", ("cottage", "kefir"), (("cottage_cheese", 150), ("kefir", 200)), 2),
    Idea("Йогурт с яблоком", ("yogurt", "apple"), (("yogurt_plain", 150), ("apple", 150)), 2),
    Idea("Овсянка с бананом", ("oatmeal", "banana"), (("oatmeal", 250), ("banana", 120)), 7),
    Idea("Салат из свежих овощей", ("tomato", "cucumber"), (("salad_veg", 200),), 5),
)


def product_keys(products: list[str]) -> set[str]:
    keys = set()
    for name in products:
        for key, pattern in PRODUCT_KEYS.items():
            if re.search(pattern, name.lower()):
                keys.add(key)
    return keys


def ideas_for(products: list[str], base: DishBase, remaining_kcal: float, protein_low: bool,
              limit: int = 5) -> list[dict]:
    """Блюда из того, что есть. Не влезает в остаток дня — порция меньше (не меньше половины),
    так человек видит реальный вариант, а не «ничего нельзя». Совет «не ешьте» не даём."""
    have = product_keys(products)
    budget = max(remaining_kcal, 250)
    out = []
    for idea in IDEAS:
        if not set(idea.needs) <= have or not all(base.get(d) for d, _ in idea.items):
            continue
        full = sum(compute(base.get(d), g).kcal for d, g in idea.items)
        scale = 1.0 if full <= budget else max(0.5, budget / full)
        items = []
        for dish_id, grams in idea.items:
            g = max(10, round(grams * scale / 10) * 10)
            n = compute(base.get(dish_id), g)
            items.append({"dish_id": dish_id, "name": base.get(dish_id).name_ru, "grams": g,
                          "kcal": round(n.kcal), "protein": round(n.protein, 1)})
        kcal = sum(i["kcal"] for i in items)
        protein = round(sum(i["protein"] for i in items), 1)
        out.append({"title": idea.title, "minutes": idea.minutes, "items": items, "kcal": kcal, "protein": protein,
                    "fits": kcal <= budget, "smaller": scale < 1.0})
    # белка мало — сначала белковые; иначе — те, что ближе к половине остатка (ещё останется на другой приём)
    out.sort(key=lambda i: -i["protein"] / max(i["kcal"], 1) if protein_low else abs(i["kcal"] - budget * 0.5))
    return out[:limit]
