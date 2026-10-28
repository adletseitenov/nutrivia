import pytest

from nutrivia.engine import compute, portion_text


def test_chicken_150g(base):
    n = compute(base.get("chicken_breast"), 150).rounded()
    assert n.kcal == 248
    assert n.protein == 46.5
    assert n.fat == 5.4
    assert n.carbs == 0


def test_zero_and_negative_grams(base):
    assert compute(base.get("plov"), 0).kcal == 0
    with pytest.raises(ValueError):
        compute(base.get("plov"), -10)


def test_csv_sane(base):
    assert len(base.dishes) >= 40
    for d in base:
        assert d.kcal > 0 or d.category == "drink"
        # Энергия из БЖУ не должна расходиться с ккал больше чем на 25%
        energy = d.protein * 4 + d.fat * 9 + d.carbs * 4
        assert abs(energy - d.kcal) / d.kcal < 0.25, d.id


def test_portion_text(base):
    plov = base.get("plov")
    assert portion_text(plov, 450) == "1½ × пиала (≈450 г)"
    assert portion_text(plov, 300) == "1 × пиала (≈300 г)"
    assert portion_text(plov, 150) == "½ × пиала (≈150 г)"
