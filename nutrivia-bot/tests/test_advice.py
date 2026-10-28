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
