import re

from nutrivia.texts import T, t


def test_no_forbidden_words():
    for key, entry in T.items():
        for lang, text in entry.items():
            assert not re.search(r"дефицит|диагноз|тапшылық|диагноз", text, re.I), (key, lang)


def test_every_key_has_ru_and_kk():
    for key, entry in T.items():
        assert entry.get("ru") and entry.get("kk"), key


def test_kk_placeholders_match_ru():
    for key, entry in T.items():
        assert set(re.findall(r"{(\w+)}", entry["ru"])) == set(re.findall(r"{(\w+)}", entry["kk"])), key


def test_reply_has_photo_estimate_mark():
    assert "оценка по фото" in t("reply_footer", "ru")
    assert "фото бойынша бағалау" in t("reply_footer", "kk")
