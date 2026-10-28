"""Мини-Engine: нутриенты считает только код, по базе, как per_100g × grams / 100.
Модель возвращает лишь названия и граммы."""
import csv
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Dish:
    id: str
    name_ru: str
    name_kk: str
    synonyms: tuple[str, ...]
    category: str
    kcal: float
    protein: float
    fat: float
    carbs: float
    unit: str
    unit_grams: float
    advice: bool
    verified: bool

    def name(self, lang: str = "ru") -> str:
        return self.name_kk if lang == "kk" and self.name_kk else self.name_ru


@dataclass
class Nutrients:
    kcal: float = 0.0
    protein: float = 0.0
    fat: float = 0.0
    carbs: float = 0.0

    def __add__(self, other: "Nutrients") -> "Nutrients":
        return Nutrients(self.kcal + other.kcal, self.protein + other.protein,
                         self.fat + other.fat, self.carbs + other.carbs)

    def rounded(self) -> "Nutrients":
        return Nutrients(round(self.kcal), round(self.protein, 1), round(self.fat, 1), round(self.carbs, 1))


def compute(dish: Dish, grams: float) -> Nutrients:
    if grams < 0:
        raise ValueError("grams must be >= 0")
    k = grams / 100
    return Nutrients(dish.kcal * k, dish.protein * k, dish.fat * k, dish.carbs * k)


def portion_text(dish: Dish, grams: float) -> str:
    """Порция в местной мере: «1½ пиалы (≈450 г)». Мера даётся грубо, граммы точно."""
    if not dish.unit or dish.unit_grams <= 0:
        return f"{round(grams)} г"
    units = grams / dish.unit_grams
    halves = round(units * 2) / 2
    if halves <= 0:
        return f"{round(grams)} г"
    whole, half = int(halves), halves % 1 == 0.5
    count = (str(whole) if whole else "") + ("½" if half else "")
    return f"{count} × {dish.unit} (≈{round(grams)} г)"


@dataclass
class DishBase:
    dishes: dict[str, Dish] = field(default_factory=dict)

    @classmethod
    def from_csv(cls, path: str) -> "DishBase":
        dishes = {}
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                dishes[row["id"]] = Dish(
                    id=row["id"],
                    name_ru=row["name_ru"],
                    name_kk=row["name_kk"],
                    synonyms=tuple(s.strip() for s in row["synonyms"].split("|") if s.strip()),
                    category=row["category"],
                    kcal=float(row["kcal"]),
                    protein=float(row["protein"]),
                    fat=float(row["fat"]),
                    carbs=float(row["carbs"]),
                    unit=row["unit"],
                    unit_grams=float(row["unit_grams"] or 0),
                    advice=row["advice"] == "1",
                    verified=row["verified"] == "1",
                )
        return cls(dishes)

    def get(self, dish_id: str | None) -> Dish | None:
        return self.dishes.get(dish_id) if dish_id else None

    def __iter__(self):
        return iter(self.dishes.values())
