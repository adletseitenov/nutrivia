import pytest

from nutrivia.config import ROOT
from nutrivia.engine import DishBase
from nutrivia.matcher import Matcher


@pytest.fixture(scope="session")
def base():
    return DishBase.from_csv(str(ROOT / "data" / "dishes.csv"))


@pytest.fixture(scope="session")
def matcher(base):
    return Matcher(base)
