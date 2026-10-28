"""Сопоставление названия блюда с базой: точное имя → синоним → опечатка (fuzzy) → начало фразы.
Модель пишет длинно («салат из свежих овощей с зеленью (помидор, огурец)»), поэтому скобки отбрасываем,
а длинную фразу узнаём по известному названию в её начале. Нечёткий поиск — только по всей строке:
поиск по куску строки находил «чай с молоком» в «зелени с острым маслом».
Не нашли — None, и бот просит уточнить блюдо (в список кандидатов на расширение базы)."""
import re
from dataclasses import dataclass

from rapidfuzz import fuzz, process

from .engine import Dish, DishBase

FUZZY_THRESHOLD = 82


def normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class Match:
    dish: Dish
    how: str      # exact | synonym | fuzzy | prefix
    score: float


class Matcher:
    def __init__(self, base: DishBase):
        self.base = base
        self.exact: dict[str, Dish] = {}
        self.synonyms: dict[str, Dish] = {}
        for d in base:
            for name in (d.name_ru, d.name_kk, d.id):
                self.exact[normalize(name)] = d
            for s in d.synonyms:
                self.synonyms.setdefault(normalize(s), d)
        self._choices = {**self.synonyms, **self.exact}

    def match(self, name: str) -> Match | None:
        key = normalize(re.sub(r"\([^)]*\)", " ", name))
        if not key:
            return None
        if key in self.exact:
            return Match(self.exact[key], "exact", 100)
        if key in self.synonyms:
            return Match(self.synonyms[key], "synonym", 100)
        best = process.extractOne(key, list(self._choices), scorer=fuzz.ratio)
        if best and best[1] >= FUZZY_THRESHOLD:
            return Match(self._choices[best[0]], "fuzzy", best[1])
        # «омлет с зеленью и грибами» → омлет: самое длинное известное название в начале фразы
        heads = [c for c in self._choices if key.startswith(c + " ")]
        if heads:
            head = max(heads, key=len)
            return Match(self._choices[head], "prefix", 90)
        return None


_EDIT_LINE = re.compile(r"^\s*(?P<name>.+?)\s*[-:=—]?\s*(?P<grams>\d+(?:[.,]\d+)?)\s*(?:г|гр|g)?\s*$", re.IGNORECASE)


def parse_edits(text: str) -> list[tuple[str, float]]:
    """«плов 350\\nсалат 120 г» → [("плов", 350), ("салат", 120)]. Строки без граммов пропускаем."""
    out = []
    for line in re.split(r"[\n;,](?!\d)", text):
        m = _EDIT_LINE.match(line)
        if m:
            out.append((m["name"].strip(), float(m["grams"].replace(",", "."))))
    return out
