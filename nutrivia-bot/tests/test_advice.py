from nutrivia.advice import pick_options, targets_for


def test_targets_default_and_override():
    assert targets_for({"goal": "lose", "kcal_target": None}) == (1600, 90)
    assert targets_for({"goal": "lose", "kcal_target": 1800}) == (1800, 90)


def test_pick_options_protein_first_and_fit(base):
    opts = pick_options(base, remaining_kcal=500, protein_low=True)
    assert 1 <= len(opts) <= 3
    assert opts[0][0].category in ("protein", "dairy")
    for d, grams in pick_options(base, remaining_kcal=300, protein_low=False):
        assert d.kcal * grams / 100 <= 300 + 1


def test_pick_options_never_empty_on_overeat(base):
    assert pick_options(base, remaining_kcal=-400, protein_low=False)


def test_home_filter(base):
    opts = pick_options(base, 600, True, allowed=("egg_boiled", "omelet"))
    assert {d.id for d, _ in opts} <= {"egg_boiled", "omelet"}


def test_personal_targets():
    from nutrivia.advice import personal_targets
    # Женщина 30 лет, 165 см, 70 кг, лёгкая активность: BMR 1420.25 → ×1.375 = 1952.8
    assert personal_targets("f", 30, 165, 70, "light", "even") == (1950, 85)
    assert personal_targets("f", 30, 165, 70, "light", "lose") == (1650, 110)    # ×0.85, белок 1.6 г/кг
    assert personal_targets("m", 25, 180, 80, "mid", "muscle") == (3100, 145)    # BMR 1805 ×1.55 ×1.1 = 3077
    assert personal_targets("f", 60, 150, 45, "low", "lose")[0] == 1200          # не ниже минимума


def test_targets_priority():
    from nutrivia.advice import targets_for
    base = {"goal": "lose", "kcal_target": None, "sex": None, "birth_year": None, "height_cm": None,
            "weight_kg": None, "activity": None}
    assert targets_for(base) == (1600, 90)  # параметров нет — по цели
    full = {**base, "sex": "f", "birth_year": 1996, "height_cm": 165, "weight_kg": 70, "activity": "light"}
    assert targets_for(full, year=2026) == (1650, 110)
    assert targets_for({**full, "kcal_target": 1500}, year=2026) == (1500, 110)  # нутрициолог главнее
