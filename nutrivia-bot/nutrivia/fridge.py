"""«Холодильник»: продукты с фото → что приготовить из базы блюд под остаток калорий дня.
Модель только называет продукты; блюда — шаблоны ниже, калории и белок считает Engine. Без LLM-рецептов."""
import re
from dataclasses import dataclass

from .engine import DishBase, compute

# Продукт → ключ: по началу слова, чтобы «яйца», «яйцо», «яичный» и «куриное филе» узнавались
PRODUCT_KEYS = {
    "egg": r"яйц|яич", "chicken": r"куриц|курин|филе|окороч|бедр", "buckwheat": r"греч(?!еск)", "rice": r"рис",
    "potato": r"картоф|картош", "cottage": r"творог|сүзбе", "kefir": r"кефир|айран", "tomato": r"помидор|томат",
    "cucumber": r"\bогур", "oatmeal": r"овсян|геркулес|хлопь", "banana": r"банан", "apple": r"яблок",
    "pasta": r"макарон|спагетт|лапш|^паст", "fish": r"рыб|судак|минта|горбуш|треск|хек",
    "salmon": r"лосос|сёмг|семг|форел", "beef": r"говяд|мяс|фарш", "turkey": r"индейк",
    "yogurt": r"йогурт", "bread": r"хлеб|лепеш|батон|тост", "pepper": r"перец|перц", "cabbage": r"капуст",
    "milk": r"молок|^молоч", "cheese": r"сыр(?!ник)", "sausage": r"сосиск|сардельк|колбас",
    "sour_cream": r"сметан", "lavash": r"лаваш", "tuna": r"тунец|тунц", "carrot": r"морков",
    "flour": r"мук", "semolina": r"манк", "millet": r"пшен", "bulgur": r"булгур", "lentil": r"чечевиц",
    "strawberry": r"клубник", "orange": r"апельсин|мандарин", "avocado": r"авокадо", "liver": r"печен",
}


@dataclass(frozen=True)
class Idea:
    title: str
    needs: tuple[str, ...]
    items: tuple[tuple[str, float], ...]  # (dish_id, граммы на обычную порцию)
    minutes: int


IDEAS = (
    # из двух-трёх продуктов
    Idea("Куриная грудка с гречкой", ("chicken", "buckwheat"), (("chicken_breast", 150), ("buckwheat", 150)), 25),
    Idea("Курица с рисом", ("chicken", "rice"), (("chicken_breast", 150), ("rice_boiled", 150)), 25),
    Idea("Курица с картофелем", ("chicken", "potato"), (("chicken_breast", 150), ("potato_boiled", 200)), 30),
    Idea("Макароны с курицей", ("pasta", "chicken"), (("pasta", 180), ("chicken_breast", 120)), 20),
    Idea("Говядина с гречкой", ("beef", "buckwheat"), (("beef_boiled", 120), ("buckwheat", 150)), 40),
    Idea("Индейка с рисом", ("turkey", "rice"), (("turkey", 150), ("rice_boiled", 150)), 30),
    Idea("Рыба с картофелем", ("fish", "potato"), (("fish_baked", 150), ("potato_boiled", 200)), 30),
    Idea("Лосось с рисом", ("salmon", "rice"), (("salmon", 120), ("rice_boiled", 150)), 25),
    Idea("Печень с гречкой", ("liver", "buckwheat"), (("liver", 120), ("buckwheat", 150)), 25),
    Idea("Блины", ("flour", "milk", "egg"), (("blini", 150),), 30),
    Idea("Омлет на молоке", ("egg", "milk"), (("omelet", 150),), 10),
    Idea("Омлет с овощами", ("egg", "tomato"), (("omelet", 110), ("salad_veg", 100)), 10),
    Idea("Яичница с сосиской", ("egg", "sausage"), (("egg_fried", 100), ("sausage", 50)), 10),
    Idea("Яичница с сыром", ("egg", "cheese"), (("egg_fried", 100), ("cheese", 20)), 10),
    Idea("Яйца с хлебом", ("egg", "bread"), (("egg_boiled", 100), ("bread_white", 30)), 10),
    Idea("Картофель с яйцом", ("potato", "egg"), (("potato_boiled", 200), ("egg_boiled", 50)), 25),
    Idea("Сырники", ("cottage", "egg"), (("syrniki", 150),), 20),
    Idea("Творог со сметаной", ("cottage", "sour_cream"), (("cottage_cheese", 150), ("sour_cream", 20)), 2),
    Idea("Творог с бананом", ("cottage", "banana"), (("cottage_cheese", 150), ("banana", 100)), 2),
    Idea("Творог с кефиром", ("cottage", "kefir"), (("cottage_cheese", 150), ("kefir", 200)), 2),
    Idea("Йогурт с яблоком", ("yogurt", "apple"), (("yogurt_plain", 150), ("apple", 150)), 2),
    Idea("Йогурт с бананом", ("yogurt", "banana"), (("yogurt_plain", 150), ("banana", 100)), 2),
    Idea("Йогурт с клубникой", ("yogurt", "strawberry"), (("yogurt_plain", 150), ("strawberry", 100)), 2),
    Idea("Кефир с бананом", ("kefir", "banana"), (("kefir", 250), ("banana", 100)), 2),
    Idea("Овсянка на молоке", ("oatmeal", "milk"), (("oatmeal_milk", 250),), 10),
    Idea("Овсянка с бананом", ("oatmeal", "banana"), (("oatmeal", 250), ("banana", 120)), 7),
    Idea("Рисовая каша на молоке", ("rice", "milk"), (("rice_porridge", 250),), 25),
    Idea("Манная каша", ("semolina", "milk"), (("semolina", 250),), 10),
    Idea("Макароны с сыром", ("pasta", "cheese"), (("pasta", 200), ("cheese", 20)), 15),
    Idea("Макароны с сосисками", ("pasta", "sausage"), (("pasta", 180), ("sausage", 100)), 15),
    Idea("Шаурма с курицей дома", ("lavash", "chicken"), (("lavash", 60), ("chicken_breast", 120), ("salad_veg", 80)), 15),
    Idea("Тунец с яйцом и овощами", ("tuna", "egg"), (("tuna", 80), ("egg_boiled", 50), ("salad_veg", 100)), 10),
    Idea("Салат из свежих овощей", ("tomato", "cucumber"), (("salad_veg", 200),), 5),
    Idea("Салат из капусты", ("cabbage", "carrot"), (("salad_cabbage", 200),), 10),
    # из одного продукта — если пары не нашлось
    Idea("Яичница", ("egg",), (("egg_fried", 100),), 5),
    Idea("Варёные яйца", ("egg",), (("egg_boiled", 100),), 10),
    Idea("Куриная грудка отварная", ("chicken",), (("chicken_breast", 150),), 25),
    Idea("Индейка отварная", ("turkey",), (("turkey", 150),), 30),
    Idea("Рыба запечённая", ("fish",), (("fish_baked", 150),), 25),
    Idea("Лосось запечённый", ("salmon",), (("salmon", 120),), 20),
    Idea("Гречка", ("buckwheat",), (("buckwheat", 200),), 20),
    Idea("Рис", ("rice",), (("rice_boiled", 200),), 20),
    Idea("Отварной картофель", ("potato",), (("potato_boiled", 250),), 25),
    Idea("Макароны", ("pasta",), (("pasta", 200),), 12),
    Idea("Овсянка на воде", ("oatmeal",), (("oatmeal", 250),), 7),
    Idea("Булгур", ("bulgur",), (("bulgur", 200),), 20),
    Idea("Пшённая каша", ("millet",), (("millet", 200),), 25),
    Idea("Чечевичный суп", ("lentil",), (("lentil_soup", 300),), 35),
    Idea("Творог", ("cottage",), (("cottage_cheese", 150),), 1),
    Idea("Йогурт", ("yogurt",), (("yogurt_plain", 180),), 1),
    Idea("Стакан кефира", ("kefir",), (("kefir", 250),), 1),
    Idea("Стакан молока", ("milk",), (("milk", 250),), 1),
    Idea("Яблоко", ("apple",), (("apple", 150),), 1),
    Idea("Банан", ("banana",), (("banana", 120),), 1),
    Idea("Апельсин", ("orange",), (("orange", 150),), 1),
    Idea("Салат из капусты", ("cabbage",), (("salad_cabbage", 200),), 10),
)


def product_keys(products: list[str]) -> set[str]:
    keys = set()
    for name in products:
        found = {key for key, pattern in PRODUCT_KEYS.items() if re.search(pattern, name.lower())}
        if found & {"egg", "liver"}:  # «яйца куриные», «печень куриная» — это не курица
            found.discard("chicken")
        keys |= found
    return keys


def ideas_for(products: list[str], base: DishBase, remaining_kcal: float, protein_low: bool,
              limit: int = 6) -> list[dict]:
    """Блюда из того, что есть. Не влезает в остаток дня — порция меньше (не меньше половины),
    так человек видит реальный вариант, а не «ничего нельзя». Совет «не ешьте» не даём."""
    have = product_keys(products)
    budget = max(remaining_kcal, 250)
    out, covered, titles = [], set(), set()
    # сначала блюда из нескольких продуктов; блюдо из одного — только для продукта, который ни во что не вошёл
    for idea in sorted(IDEAS, key=lambda i: -len(i.needs)):
        if not set(idea.needs) <= have or not all(base.get(d) for d, _ in idea.items) or idea.title in titles:
            continue
        if len(idea.needs) == 1 and idea.needs[0] in covered:
            continue
        covered.update(idea.needs)
        titles.add(idea.title)
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
                    "fits": kcal <= budget, "smaller": scale < 1.0, "_n": len(idea.needs)})
    # белка мало — сначала белковые; иначе — те, что ближе к половине остатка (ещё останется на другой приём)
    # из нескольких продуктов — выше; внутри: белка мало — сначала белковые, иначе ближе к половине остатка
    out.sort(key=lambda i: (-i["_n"], -i["protein"] / max(i["kcal"], 1) if protein_low else abs(i["kcal"] - budget * 0.5)))
    for i in out:
        del i["_n"]
    return out[:limit]
