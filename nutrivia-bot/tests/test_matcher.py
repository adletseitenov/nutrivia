from nutrivia.matcher import parse_edits


def test_exact_synonym_fuzzy(matcher):
    assert matcher.match("Плов с говядиной").how == "exact"
    m = matcher.match("ош")
    assert m.dish.id == "plov" and m.how == "synonym"
    m = matcher.match("бешбармакк")
    assert m.dish.id == "beshbarmak" and m.how == "fuzzy"
    assert matcher.match("Курица").dish.id == "chicken_breast"
    assert matcher.match("Манты!").dish.id == "manty"


def test_unknown_dish(matcher):
    assert matcher.match("суши филадельфия") is None
    assert matcher.match("") is None


def test_parse_edits():
    assert parse_edits("плов 350") == [("плов", 350)]
    assert parse_edits("плов 350\nсалат 120 г") == [("плов", 350), ("салат", 120)]
    assert parse_edits("манты: 180гр; чай - 200") == [("манты", 180), ("чай", 200)]
    assert parse_edits("плова было полпиалы") == []


def test_long_model_names(matcher):
    """Названия, как их реально пишет модель по фото (прогон 28.10)."""
    cases = {
        "манты": "manty",
        "салат из свежих овощей (помидор, огурец, лук)": "salad_veg",
        "салат из свежих овощей с зеленью и орехами": "salad_veg",
        "омлет с зеленью и грибами": "omelet",
        "шорпа с зеленью": "sorpa",
        "тост из белого хлеба (бриошь)": "bread_white",
        "плов": "plov",
        "салат оливье": "olivier",
    }
    for name, dish_id in cases.items():
        m = matcher.match(name)
        assert m is not None and m.dish.id == dish_id, (name, m)
    # Раньше нечёткий поиск по куску строки давал «чай с молоком» и «лепёшку»
    for name in ("зелень с чёрным перцем и острым маслом", "авокадо ломтиками", "клубника", "сумаляк"):
        assert matcher.match(name) is None, name
