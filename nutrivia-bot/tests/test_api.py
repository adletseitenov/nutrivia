import re
import time

import pytest
from fastapi.testclient import TestClient

from nutrivia.api import create_app, sniff_image
from nutrivia.auth import AuthError, ConsoleSms, normalize_phone
from nutrivia.config import Config
from nutrivia.vision import FakeVision

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PHONE = "+7 707 123 45 67"


@pytest.fixture
def client(tmp_path):
    sms = ConsoleSms()
    cfg = Config(solo_review_chat_id=-100, photos_dir=str(tmp_path / "p"), bot_token="")
    app = create_app(cfg, vision=FakeVision(), db_path=":memory:", sms=sms)
    with TestClient(app) as c:
        c.sms = sms
        yield c


def last_code(c):
    return re.search(r"\b(\d{4})\b", c.sms.sent[-1][1]).group(1)


def clock(c):
    return c.app.state.svc.db


def login(c, phone=PHONE, **kw):
    """Полный вход: код из SMS → токен. Возвращает заголовки и ответ verify."""
    assert c.post("/v1/auth/sms/start", json={"phone": phone}).status_code == 200, "start"
    body = {"phone": phone, "code": last_code(c), "consent": True, "goal": "lose", **kw}
    r = c.post("/v1/auth/sms/verify", json=body)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()


def register(c, **kw):
    return login(c, **kw)[0]


def upload(c, h):
    return c.post("/v1/meals", headers=h, files={"photo": ("a.jpg", JPEG, "image/jpeg")})


# --- вход по SMS ---

def test_normalize_phone():
    assert normalize_phone("8 (707) 123-45-67") == "+77071234567"
    assert normalize_phone("+7 707 123 45 67") == "+77071234567"
    assert normalize_phone("7071234567") == "+77071234567"
    for bad in ("+7 912 345 67 89", "12345", ""):
        with pytest.raises(AuthError):
            normalize_phone(bad)


def test_login_and_relogin_same_user(client):
    h1, r1 = login(client)
    assert r1["is_new"] and r1["me"]["role"] == "client"
    later = int(time.time()) + 61
    client.app.state.svc.db.clock = lambda: later  # прошла минута — можно новый код
    h2, r2 = login(client)
    assert not r2["is_new"] and r2["me"]["user_id"] == r1["me"]["user_id"]
    assert client.get("/v1/me", headers=h1).status_code == 200  # старая сессия тоже жива


def test_requires_login(client):
    assert client.get("/v1/today").status_code == 401
    assert client.get("/v1/today", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_new_number_needs_consent(client):
    client.post("/v1/auth/sms/start", json={"phone": PHONE})
    r = client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": last_code(client)})
    assert r.status_code == 409 and r.json()["code"] == "consent_required"


def test_wrong_code_attempts_and_lock(client):
    client.post("/v1/auth/sms/start", json={"phone": PHONE})
    code = last_code(client)
    wrong = "0000" if code != "0000" else "1111"
    for left in (4, 3, 2, 1):
        r = client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": wrong, "consent": True})
        assert r.status_code == 400 and f"Осталось попыток: {left}" in r.json()["message"]
    client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": wrong, "consent": True})
    r = client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": code, "consent": True})
    assert r.status_code == 429 and r.json()["code"] == "locked"  # даже верный код после 5 ошибок


def test_code_expires_and_is_single_use(client):
    db = client.app.state.svc.db
    t = [1_900_000_000]
    db.clock = lambda: t[0]
    client.post("/v1/auth/sms/start", json={"phone": PHONE})
    code = last_code(client)
    t[0] += 301
    r = client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": code, "consent": True})
    assert r.json()["code"] == "expired"
    client.post("/v1/auth/sms/start", json={"phone": PHONE})
    code = last_code(client)
    assert client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": code, "consent": True}).status_code == 200
    assert client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": code, "consent": True}).json()["code"] == "expired"


def test_resend_limits(client):
    db = client.app.state.svc.db
    t = [1_900_000_000]
    db.clock = lambda: t[0]
    assert client.post("/v1/auth/sms/start", json={"phone": PHONE}).status_code == 200
    r = client.post("/v1/auth/sms/start", json={"phone": PHONE})
    assert r.status_code == 429 and r.json()["code"] == "too_soon" and r.headers["Retry-After"]
    for _ in range(4):
        t[0] += 61
        assert client.post("/v1/auth/sms/start", json={"phone": PHONE}).status_code == 200
    t[0] += 61
    assert client.post("/v1/auth/sms/start", json={"phone": PHONE}).json()["code"] == "too_many"
    assert len(client.sms.sent) == 5


def test_sms_text_and_no_code_in_response(client):
    r = client.post("/v1/auth/sms/start", json={"phone": PHONE}).json()
    assert "code" not in r and r["phone"] == "+77071234567"
    assert client.sms.sent[-1][1].startswith("Nutrivia: код входа")


def test_sms_send_failure_allows_immediate_retry(client):
    from nutrivia.auth import SmsError

    real = client.sms.send

    async def broken(phone, text):
        raise SmsError("down")

    client.sms.send = broken
    r = client.post("/v1/auth/sms/start", json={"phone": PHONE})
    assert r.status_code == 502 and r.json()["code"] == "sms_failed"
    client.sms.send = real
    assert client.post("/v1/auth/sms/start", json={"phone": PHONE}).status_code == 200


async def test_mobizon_request_and_errors():
    import httpx
    from nutrivia.auth import MobizonSms, SmsError

    seen = {}

    def ok(request):
        seen["url"], seen["form"] = request.url, dict(httpx.QueryParams(request.content.decode()))
        return httpx.Response(200, json={"code": 0, "data": {"messageId": "1"}, "message": ""})

    sms = MobizonSms("KEY", "Nutrivia", client=httpx.AsyncClient(transport=httpx.MockTransport(ok)))
    await sms.send("+77071234567", "Nutrivia: код входа 1234.")
    assert seen["url"].host == "api.mobizon.kz" and seen["url"].params["apiKey"] == "KEY"
    assert seen["form"]["recipient"] == "77071234567" and seen["form"]["from"] == "Nutrivia"

    bad = MobizonSms("KEY", client=httpx.AsyncClient(transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"code": 1, "message": "not enough money", "data": {}}))))
    with pytest.raises(SmsError):
        await bad.send("+77071234567", "x")


def test_default_invite_code_for_clients_without_code(client, monkeypatch):
    h_pro, out = login(client, phone="+77070000001", role="nutritionist", name="Алан")
    monkeypatch.setenv("DEFAULT_INVITE_CODE", out["me"]["pro"]["invite_code"])
    _, solo = login(client, phone="+77070000002")
    assert solo["join"] == "ok"
    students = client.get("/v1/pro/students", headers=h_pro).json()["students"]
    assert len(students) == 1
    monkeypatch.setenv("DEFAULT_INVITE_CODE", "nope99")
    _, other = login(client, phone="+77070000003")
    assert other["join"] is None and other["join_message"] is None


def test_logout(client):
    h = register(client)
    assert client.post("/v1/auth/logout", headers=h).status_code == 204
    assert client.get("/v1/me", headers=h).status_code == 401


# --- типы аккаунтов и коды приглашения ---

def test_pro_needs_name_and_gets_invite_code(client):
    client.post("/v1/auth/sms/start", json={"phone": PHONE})
    r = client.post("/v1/auth/sms/verify", json={"phone": PHONE, "code": last_code(client), "consent": True, "role": "trainer"})
    assert r.json()["code"] == "name_required"
    client.app.state.svc.db.clock = lambda: 2_000_000_000
    _, body = login(client, role="trainer", name="Ерлан")
    pro = body["me"]["pro"]
    assert body["me"]["role"] == "trainer" and pro["name"] == "Ерлан" and pro["limit"] == 5
    assert re.fullmatch(r"[a-z2-9]{6}", pro["invite_code"])


def test_trainer_student_limit(client):
    trainer, body = login(client, role="trainer", name="Ерлан")
    code = body["me"]["pro"]["invite_code"]
    for n in range(5):
        _, s = login(client, phone=f"+7701000000{n}", invite_code=code.upper())
        assert s["join"] == "ok" and s["me"]["coach"]["name"] == "Ерлан"
    _, sixth = login(client, phone="+77010000009", invite_code=code)
    assert sixth["join"] == "full" and sixth["me"]["coach"] is None and "максимум" in sixth["join_message"]
    students = client.get("/v1/pro/students", headers=trainer).json()
    assert len(students["students"]) == 5 and students["me"]["pro"]["students"] == 5
    assert students["students"][0]["label"] == "Ученик 1"  # имён учеников специалист не видит


def test_nutritionist_has_no_limit_and_join_later(client):
    _, body = login(client, role="nutritionist", name="Динара")
    code = body["me"]["pro"]["invite_code"]
    assert body["me"]["pro"]["limit"] is None
    h = register(client, phone="+77010000001")
    r = client.post("/v1/me/coach", headers=h, json={"invite_code": "nosuch"})
    assert r.status_code == 400 and r.json()["code"] == "not_found"
    assert client.post("/v1/me/coach", headers=h, json={"invite_code": code}).json()["coach"]["name"] == "Динара"


def test_students_only_for_pros_and_pro_cannot_join(client):
    h = register(client)
    assert client.get("/v1/pro/students", headers=h).status_code == 403
    _, t = login(client, phone="+77010000001", role="trainer", name="Ерлан")
    pro_h, _ = login(client, phone="+77010000002", role="nutritionist", name="Динара")
    r = client.post("/v1/me/coach", headers=pro_h, json={"invite_code": t["me"]["pro"]["invite_code"]})
    assert r.json()["code"] == "not_client"


def test_deleting_pro_unlinks_students(client):
    pro_h, body = login(client, role="trainer", name="Ерлан")
    code = body["me"]["pro"]["invite_code"]
    student_h, _ = login(client, phone="+77010000001", invite_code=code)
    assert client.delete("/v1/users/me", headers=pro_h).status_code == 204
    assert client.get("/v1/me", headers=student_h).json()["coach"] is None


# --- фото и разбор ---

def test_photo_flow(client):
    h = register(client)
    r = upload(client, h)
    assert r.status_code == 200, r.text
    meal = r.json()
    assert meal["status"] == "draft"
    names = {i["dish_id"]: i for i in meal["items"]}
    assert names["plov"]["grams"] == 300 and round(names["plov"]["kcal"]) == 570

    r = client.put(f"/v1/meals/{meal['id']}/items", headers=h,
                   json={"items": [{"dish_id": "plov", "grams": 450}, {"dish_id": "salad_veg", "grams": 100}]})
    assert r.status_code == 200
    plov = next(i for i in r.json()["items"] if i["dish_id"] == "plov")
    assert round(plov["kcal"]) == 855 and plov["portion"].startswith("1½")

    assert client.post(f"/v1/meals/{meal['id']}/confirm", headers=h).json()["status"] == "draft"
    today = client.get("/v1/today", headers=h).json()
    assert len(today["meals"]) == 1 and round(today["totals"]["kcal"]) == 895
    assert today["targets"]["kcal"] == 1600
    # совет на вечер: остаток 705 ккал, белка мало → белковые блюда из базы, каждое влезает в остаток
    adv = today["advice"]
    assert adv["remaining_kcal"] == 705 and adv["hint"] == "protein"
    assert 1 <= len(adv["options"]) <= 3 and all(o["kcal"] <= 705 for o in adv["options"])


def test_reject_non_images_and_unknown_dish(client):
    h = register(client)
    r = client.post("/v1/meals", headers=h, files={"photo": ("a.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 415
    meal = upload(client, h).json()
    bad = client.put(f"/v1/meals/{meal['id']}/items", headers=h, json={"items": [{"dish_id": "sushi", "grams": 100}]})
    assert bad.status_code == 422


def test_other_users_meals_and_photos_hidden(client):
    h = register(client)
    meal = upload(client, h).json()
    other = register(client, phone="+77010000002")
    assert client.get(f"/v1/meals/{meal['id']}", headers=other).status_code == 404
    assert client.get(f"/v1/meals/{meal['id']}/photo", headers=other).status_code == 404
    r = client.get(f"/v1/meals/{meal['id']}/photo", headers=h)
    assert r.status_code == 200 and r.content == JPEG and r.headers["content-type"] == "image/jpeg"


def test_add_dish(client):
    h = register(client)
    meal = upload(client, h).json()
    items = [{"dish_id": i["dish_id"], "grams": i["grams"]} for i in meal["items"]] + [{"dish_id": "tea_milk", "grams": 200}]
    r = client.put(f"/v1/meals/{meal['id']}/items", headers=h, json={"items": items}).json()
    tea = next(i for i in r["items"] if i["dish_id"] == "tea_milk")
    assert tea["name"] == "Чай с молоком" and round(tea["kcal"]) == 60


def test_reviewer_send_marks_reviewed(client):
    h = register(client)
    meal = upload(client, h).json()
    client.portal.call(client.app.state.svc.reviewer_send, meal["id"], 99)
    assert client.get(f"/v1/meals/{meal['id']}", headers=h).json()["status"] == "reviewed"


def test_delete_me(client):
    h = register(client)
    assert client.delete("/v1/users/me", headers=h).status_code == 204
    assert client.get("/v1/today", headers=h).status_code == 401
    client.app.state.svc.db.clock = lambda: 2_000_000_000
    _, again = login(client)
    assert again["is_new"]  # номер освобождён — новый пользователь


def test_progress_endpoint(client):
    h = register(client)
    upload(client, h)
    p = client.get("/v1/progress", headers=h).json()
    assert p["streak"]["photos_today"] == 1 and p["streak"]["stage"] == 1
    assert len(p["week"]["days"]) == 7 and p["week"]["days"][-1]["meals"] == 1


def test_dish_search(client):
    hits = client.get("/v1/dishes", params={"q": "бешпармак"}).json()
    assert hits[0]["id"] == "beshbarmak"


def test_sniff():
    assert sniff_image(JPEG) == "image/jpeg"
    assert sniff_image(b"\x89PNG\r\n\x1a\nxxxx") == "image/png"
    assert sniff_image(b"GIF89a") is None


# --- проверка разборов специалистом ---

def pro_with_student(c):
    pro_h, body = login(c, role="nutritionist", name="Динара")
    student_h, _ = login(c, phone="+77010000001", invite_code=body["me"]["pro"]["invite_code"])
    meal = upload(c, student_h).json()
    return pro_h, student_h, meal


def test_pro_review_flow(client):
    pro_h, student_h, meal = pro_with_student(client)
    queue = client.get("/v1/pro/queue", headers=pro_h).json()["meals"]
    assert [m["id"] for m in queue] == [meal["id"]] and queue[0]["student"] == "Ученик 1"
    assert client.get(f"/v1/pro/meals/{meal['id']}/photo", headers=pro_h).content == JPEG

    r = client.put(f"/v1/pro/meals/{meal['id']}/items", headers=pro_h,
                   json={"items": [{"dish_id": "plov", "grams": 450}, {"dish_id": "tea_milk", "grams": 200}]})
    items = {i["dish_id"]: i for i in r.json()["items"]}
    assert set(items) == {"plov", "tea_milk"} and items["plov"]["grams"] == 450
    client.post(f"/v1/pro/meals/{meal['id']}/comment", headers=pro_h, json={"text": "Отлично, добавьте белок"})
    assert client.post(f"/v1/pro/meals/{meal['id']}/send", headers=pro_h).json()["status"] == "reviewed"

    seen = client.get(f"/v1/meals/{meal['id']}", headers=student_h).json()
    assert seen["status"] == "reviewed" and seen["comment"] == "Отлично, добавьте белок"
    assert client.get("/v1/pro/queue", headers=pro_h).json()["meals"] == []
    again = client.post(f"/v1/pro/meals/{meal['id']}/send", headers=pro_h)
    assert again.status_code == 409 and again.json()["code"] == "already_sent"
    assert client.put(f"/v1/pro/meals/{meal['id']}/items", headers=pro_h,
                      json={"items": [{"dish_id": "plov", "grams": 100}]}).status_code == 409
    # метрика ошибки граммов: оценка модели сохранилась
    db_item = client.portal.call(client.app.state.svc.db.fetchone,
                                 "SELECT ai_grams FROM meal_items WHERE meal_id = ? AND dish_id = 'plov'", (meal["id"],))
    assert db_item["ai_grams"] == 300


def test_pro_sees_only_own_students(client):
    pro_h, _, meal = pro_with_student(client)
    other_pro, _ = login(client, phone="+77010000005", role="trainer", name="Ерлан")
    client_h = register(client, phone="+77010000006")
    assert client.get(f"/v1/pro/meals/{meal['id']}", headers=other_pro).status_code == 404
    assert client.post(f"/v1/pro/meals/{meal['id']}/send", headers=other_pro).status_code == 404
    assert client.get(f"/v1/pro/meals/{meal['id']}/photo", headers=other_pro).status_code == 404
    assert client.get("/v1/pro/queue", headers=client_h).status_code == 403


def test_pro_cannot_send_unmatched(client):
    pro_h, body = login(client, role="nutritionist", name="Динара")
    client.app.state.svc.vision.payload = {"is_food": True, "dishes": [
        {"name": "фуа-гра", "portion": 6, "unit": "штука", "grams": 180, "confidence": 0.6}]}
    student_h, _ = login(client, phone="+77010000001", invite_code=body["me"]["pro"]["invite_code"])
    meal = upload(client, student_h).json()
    r = client.post(f"/v1/pro/meals/{meal['id']}/send", headers=pro_h)
    assert r.status_code == 409 and r.json()["code"] == "unmatched"
    # замена блюдом из базы убирает «не из базы» — теперь можно отправить
    client.put(f"/v1/pro/meals/{meal['id']}/items", headers=pro_h, json={"items": [{"dish_id": "rice_boiled", "grams": 180}]})
    assert client.post(f"/v1/pro/meals/{meal['id']}/send", headers=pro_h).status_code == 200


def test_client_meal_view_shows_reviewer_after_send(client):
    pro_h, student_h, meal = pro_with_student(client)
    client.post(f"/v1/pro/meals/{meal['id']}/comment", headers=pro_h, json={"text": "Отлично"})
    draft = client.get(f"/v1/meals/{meal['id']}", headers=student_h).json()
    assert draft["comment"] is None and draft["reviewer"] is None  # черновик комментария клиент не видит
    client.put(f"/v1/pro/meals/{meal['id']}/items", headers=pro_h, json={"items": [{"dish_id": "plov", "grams": 450}]})
    client.post(f"/v1/pro/meals/{meal['id']}/send", headers=pro_h)
    m = client.get(f"/v1/meals/{meal['id']}", headers=student_h).json()
    assert m["status"] == "reviewed" and m["comment"] == "Отлично" and m["reviewed_at"]
    assert m["reviewer"] == {"name": "Динара", "role": "nutritionist"}
    plov = m["items"][0]
    assert plov["grams"] == 450 and plov["ai_grams"] == 300


def test_operator_review_shows_generic_name(client):
    h = register(client)
    meal = upload(client, h).json()
    client.portal.call(client.app.state.svc.reviewer_send, meal["id"], 12345)  # оператор из Telegram
    assert client.get(f"/v1/meals/{meal['id']}", headers=h).json()["reviewer"]["name"] == "Нутрициолог Nutrivia"


# --- пилот без SMS: коды выдаёт админ ---

@pytest.fixture
def manual_client(tmp_path):
    from nutrivia.auth import ManualCodes
    cfg = Config(solo_review_chat_id=-100, photos_dir=str(tmp_path / "p"), bot_token="")
    app = create_app(cfg, vision=FakeVision(), db_path=":memory:", sms=ManualCodes())
    with TestClient(app) as c:
        yield c


def issue(c, phone=PHONE):
    """Админ выдаёт код (как scripts/pilot_code.py), в event loop приложения."""
    return c.portal.call(c.app.state.auth.issue_manual, phone)[1]


def test_manual_codes_only_for_invited(manual_client):
    c = manual_client
    r = c.post("/v1/auth/sms/start", json={"phone": PHONE})
    assert r.status_code == 403 and r.json()["code"] == "not_invited"

    old = issue(c)
    code = issue(c)  # повторная выдача заменяет прежний код
    r = c.post("/v1/auth/sms/start", json={"phone": PHONE})
    assert r.status_code == 200 and r.json()["delivery"] == "manual"
    assert c.post("/v1/auth/sms/start", json={"phone": PHONE}).status_code == 200  # без «повторно через минуту»

    body = {"phone": PHONE, "consent": True, "goal": "lose"}
    if old != code:
        assert c.post("/v1/auth/sms/verify", json={**body, "code": old}).status_code == 400
    r = c.post("/v1/auth/sms/verify", json={**body, "code": code})
    assert r.status_code == 200, r.text
    # Код от админа работает весь срок: вошёл в Safari, потом с иконки «Домой» — тем же кодом
    assert c.post("/v1/auth/sms/start", json={"phone": PHONE}).status_code == 200
    again = c.post("/v1/auth/sms/verify", json={**body, "code": code})
    assert again.status_code == 200 and again.json()["is_new"] is False      # тот же аккаунт, не новый
    me = c.get("/v1/me", headers={"Authorization": f"Bearer {again.json()['token']}"}).json()
    assert me["user_id"] == c.get("/v1/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()["user_id"]


def test_sms_start_reports_delivery(client):
    assert client.post("/v1/auth/sms/start", json={"phone": PHONE}).json()["delivery"] == "sms"


def test_serves_web_app(tmp_path, monkeypatch):
    web = tmp_path / "web"
    (web / "_expo").mkdir(parents=True)
    (web / "index.html").write_text("<html><head></head>app</html>")
    (web / "manifest.webmanifest").write_text("{}")
    (web / "_expo" / "app.js").write_text("js")
    (tmp_path / "secret.txt").write_text("nope")
    monkeypatch.setenv("WEB_DIR", str(web))
    cfg = Config(solo_review_chat_id=-100, photos_dir=str(tmp_path / "p"), bot_token="")
    with TestClient(create_app(cfg, vision=FakeVision(), db_path=":memory:", sms=ConsoleSms())) as c:
        assert "app</html>" in c.get("/").text and 'rel="manifest"' in c.get("/").text  # PWA-теги
        assert "app</html>" in c.get("/today").text  # маршрут приложения
        assert c.get("/_expo/app.js").text == "js"
        assert c.get("/../secret.txt").text != "nope"
        assert c.get("/health").json() == {"ok": True}  # API не перекрыт
        assert c.get("/v1/me").status_code == 401
        assert c.get("/v1/nope").status_code == 404


def test_profile_sets_personal_targets(client):
    h, out = login(client)
    assert out["me"]["targets"] == {"kcal": 1600, "protein": 90, "set_by_pro": False}
    body = {"sex": "f", "birth_year": 1996, "height_cm": 165, "weight_kg": 70, "activity": "light"}
    me = client.patch("/v1/me", headers=h, json=body).json()
    assert me["profile"]["weight_kg"] == 70 and me["targets"]["kcal"] in (1650, 1600, 1700)
    assert client.get("/v1/today", headers=h).json()["targets"]["kcal"] == me["targets"]["kcal"]
    # цель можно менять отдельно, параметры остаются
    assert client.patch("/v1/me", headers=h, json={"goal": "even"}).json()["profile"]["sex"] == "f"
    assert client.patch("/v1/me", headers=h, json={"birth_year": 2012}).status_code == 200   # без ограничения 18+
    r = client.patch("/v1/me", headers=h, json={"birth_year": 2025})
    assert r.status_code == 400 and r.json()["code"] == "bad_year"
    assert client.patch("/v1/me", headers=h, json={"height_cm": 20}).status_code == 422


def test_manual_meal_past_day_and_delete(client):
    h = register(client)
    r = client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "oatmeal", "grams": 250}]})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["status"] == "manual" and m["items"][0]["kcal"] > 0 and not m["has_photo"]
    # не идёт в серию фото
    assert client.get("/v1/progress", headers=h).json()["streak"]["photos_today"] == 0
    # вчерашний день
    from datetime import datetime, timedelta
    from nutrivia.config import ALMATY
    yday = (datetime.fromtimestamp(time.time(), ALMATY) - timedelta(days=1)).date().isoformat()
    y = client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "plov", "grams": 300}], "date": yday}).json()
    day = client.get(f"/v1/today?date={yday}", headers=h).json()
    assert [x["id"] for x in day["meals"]] == [y["id"]]
    assert [x["id"] for x in client.get("/v1/today", headers=h).json()["meals"]] == [m["id"]]
    # слишком давно и неизвестное блюдо — нельзя
    assert client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "plov", "grams": 300}], "date": "2020-01-01"}).status_code == 422
    assert client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "nope", "grams": 300}]}).status_code == 422
    # удалить можно только своё
    other = register(client, phone="+77070000009")
    assert client.delete(f"/v1/meals/{m['id']}", headers=other).status_code == 404
    assert client.delete(f"/v1/meals/{m['id']}", headers=h).status_code == 204
    assert client.get(f"/v1/meals/{m['id']}", headers=h).status_code == 404


def test_delete_photo_meal_removes_file(client, tmp_path):
    h = register(client)
    meal = upload(client, h).json()
    files = list((tmp_path / "p").glob("*"))
    assert len(files) == 1
    assert client.delete(f"/v1/meals/{meal['id']}", headers=h).status_code == 204
    assert list((tmp_path / "p").glob("*")) == []


def test_operator_reviews_clients_without_coach(client):
    h_solo = register(client, phone="+77070000011")
    h_pro, pro = login(client, phone="+77070000012", role="trainer", name="Ерлан")
    h_student = register(client, phone="+77070000013", invite_code=pro["me"]["pro"]["invite_code"])
    h_op, op = login(client, phone="+77070000014")
    db = client.app.state.svc.db
    client.portal.call(db.execute, "UPDATE users SET role = 'operator' WHERE tg_id = ?", (op["me"]["user_id"],))

    solo_meal = upload(client, h_solo).json()
    student_meal = upload(client, h_student).json()

    me = client.get("/v1/me", headers=h_op).json()
    assert me["pro"]["operator"] is True and me["pro"]["invite_code"] is None
    queue = client.get("/v1/pro/queue", headers=h_op).json()["meals"]
    assert [m["id"] for m in queue] == [solo_meal["id"]]  # ученик тренера — пока у тренера
    assert queue[0]["student"] == "Клиент 1"
    assert client.get(f"/v1/pro/meals/{student_meal['id']}", headers=h_op).status_code == 404
    # клиенты оператора — только без тренера
    assert [s["label"] for s in client.get("/v1/pro/students", headers=h_op).json()["students"]] == ["Клиент 1"]

    # через 15 минут непроверенный разбор ученика тоже виден оператору
    client.portal.call(db.execute, "UPDATE meals SET received_at = received_at - 1000 WHERE id = ?", (student_meal["id"],))
    ids = [m["id"] for m in client.get("/v1/pro/queue", headers=h_op).json()["meals"]]
    assert student_meal["id"] in ids

    # оператор проверяет — клиент видит «Нутрициолог Nutrivia»
    items = [{"dish_id": i["dish_id"], "grams": i["grams"]} for i in solo_meal["items"] if i["dish_id"]]
    assert client.put(f"/v1/pro/meals/{solo_meal['id']}/items", headers=h_op, json={"items": items}).status_code == 200
    assert client.post(f"/v1/pro/meals/{solo_meal['id']}/send", headers=h_op).status_code == 200
    seen = client.get(f"/v1/meals/{solo_meal['id']}", headers=h_solo).json()
    assert seen["status"] == "reviewed" and seen["reviewer"] == {"name": "Нутрициолог Nutrivia", "role": "operator"}
    # обычный клиент в кабинет не попадает
    assert client.get("/v1/pro/queue", headers=h_solo).status_code == 403


def test_weights_update_profile_and_targets(client):
    h = register(client)
    client.patch("/v1/me", headers=h, json={"sex": "f", "birth_year": 1996, "height_cm": 165, "weight_kg": 80, "activity": "light"})
    before = client.get("/v1/me", headers=h).json()["targets"]["kcal"]
    from datetime import datetime, timedelta
    from nutrivia.config import ALMATY
    week_ago = (datetime.fromtimestamp(time.time(), ALMATY) - timedelta(days=7)).date().isoformat()
    client.post("/v1/weights", headers=h, json={"kg": 80, "date": week_ago})
    r = client.post("/v1/weights", headers=h, json={"kg": 78.4}).json()
    assert r["weights"]["change"] == -1.6 and len(r["weights"]["points"]) == 2
    assert r["me"]["profile"]["weight_kg"] == 78.4
    assert r["me"]["targets"]["kcal"] <= before
    # повтор в тот же день заменяет
    client.post("/v1/weights", headers=h, json={"kg": 78.0})
    assert [p["kg"] for p in client.get("/v1/weights", headers=h).json()["points"]] == [80.0, 78.0]
    assert client.post("/v1/weights", headers=h, json={"kg": 10}).status_code == 422
    # удаление аккаунта стирает и вес
    uid = client.get("/v1/me", headers=h).json()["user_id"]
    assert client.delete("/v1/users/me", headers=h).status_code == 204
    n = client.portal.call(client.app.state.svc.db.fetchone, "SELECT COUNT(*) AS n FROM weights WHERE user_id = ?", (uid,))
    assert n["n"] == 0


def test_recent_dishes(client):
    h = register(client)
    for _ in range(2):
        client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "oatmeal", "grams": 250}]})
    client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "plov", "grams": 300}]})
    assert [d["id"] for d in client.get("/v1/dishes/recent", headers=h).json()] == ["oatmeal", "plov"]


def test_student_card_week_comment_target_note(client):
    h_pro, pro = login(client, phone="+77070000021", role="nutritionist", name="Алан")
    h_st, st = login(client, phone="+77070000022", invite_code=pro["me"]["pro"]["invite_code"])
    h_other, other_pro = login(client, phone="+77070000023", role="trainer", name="Чужой")
    sid = st["me"]["user_id"]
    upload(client, h_st)
    client.post("/v1/weights", headers=h_st, json={"kg": 82})

    card = client.get(f"/v1/pro/students/{sid}", headers=h_pro).json()
    assert card["label"] == "Ученик 1" and len(card["meals"]) == 1 and card["weights"]["points"][0]["kg"] == 82
    assert client.get(f"/v1/pro/students/{sid}", headers=h_other).status_code == 404  # чужой ученик

    # итог недели — клиент видит его в «Прогрессе» вместо комментария к фото
    client.post(f"/v1/pro/students/{sid}/week-comment", headers=h_pro, json={"text": "Отличная неделя, белка хватает"})
    week = client.get("/v1/progress", headers=h_st).json()["week"]
    assert week["coach"] == {"name": "Алан", "comment": "Отличная неделя, белка хватает"}

    # ориентир от специалиста главнее личного; null возвращает расчёт
    card = client.put(f"/v1/pro/students/{sid}/target", headers=h_pro, json={"kcal": 1700}).json()
    assert card["targets"] == {"kcal": 1700, "protein": card["targets"]["protein"], "set_by_pro": True}
    assert client.get("/v1/today", headers=h_st).json()["targets"]["kcal"] == 1700
    assert client.put(f"/v1/pro/students/{sid}/target", headers=h_pro, json={"kcal": None}).json()["targets"]["set_by_pro"] is False
    assert client.put(f"/v1/pro/students/{sid}/target", headers=h_pro, json={"kcal": 300}).status_code == 422

    # заметка видна только своему специалисту
    client.put(f"/v1/pro/students/{sid}/note", headers=h_pro, json={"text": "Не ест после 20:00"})
    assert client.get(f"/v1/pro/students/{sid}", headers=h_pro).json()["note"] == "Не ест после 20:00"
    assert client.put(f"/v1/pro/students/{sid}/note", headers=h_other, json={"text": "x"}).status_code == 404
    # клиент в кабинет не попадает
    assert client.get(f"/v1/pro/students/{sid}", headers=h_st).status_code == 403


def test_admin_requires_token_and_works(client, monkeypatch):
    assert client.get("/v1/admin/overview").status_code == 404  # без ADMIN_TOKEN админки нет
    monkeypatch.setenv("ADMIN_TOKEN", "adm")
    assert client.get("/v1/admin/overview", headers={"X-Admin-Token": "wrong"}).status_code == 401
    A = {"X-Admin-Token": "adm"}
    h = register(client)
    upload(client, h)
    o = client.get("/v1/admin/overview", headers=A).json()
    assert o["roles"]["client"] == 1 and o["queue"]["pending"] == 1 and o["photos_by_day"][-1]["photos"] == 1
    users = client.get("/v1/admin/users", headers=A).json()
    assert users[0]["phone"].startswith("+770 ***") and users[0]["pending"] == 1
    r = client.post("/v1/admin/codes", headers=A, json={"phone": "+77071112299"}).json()
    assert len(r["code"]) == 4 and r["code"] in r["message"]
    assert client.post("/v1/admin/operators", headers=A, json={"phone": "+77071112299"}).status_code == 200
    assert "operator" in client.get("/v1/admin/overview", headers=A).json()["roles"]
    assert client.get("/v1/admin/users.csv", headers=A).text.startswith("user_id,role,phone")
    assert client.get("/admin").status_code == 200


def test_fridge_ideas_fit_remaining_kcal(client):
    h = register(client)
    r = client.post("/v1/fridge", headers=h, files={"photo": ("f.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 200, r.text
    out = r.json()
    assert "курица" in out["products"] and out["ideas"]
    titles = [i["title"] for i in out["ideas"]]
    assert "Куриная грудка с гречкой" in titles and "Творог с кефиром" in titles
    assert all(i["kcal"] == sum(x["kcal"] for x in i["items"]) for i in out["ideas"])
    # почти весь день съеден — порции уменьшаются, но не меньше половины
    client.post("/v1/meals/manual", headers=h, json={"items": [{"dish_id": "plov", "grams": 700}]})
    small = client.post("/v1/fridge", headers=h, files={"photo": ("f.jpg", JPEG, "image/jpeg")}).json()
    assert small["remaining_kcal"] < out["remaining_kcal"] and any(i["smaller"] for i in small["ideas"])
    # убрал курицу, дописал рыбу и картошку — без ИИ
    edited = client.post("/v1/fridge/ideas", headers=h, json={"products": ["рыба", "картофель", "творог", "кефир"]}).json()
    assert {i["title"] for i in edited["ideas"]} == {"Рыба с картофелем", "Творог с кефиром"}


def test_same_photo_twice_is_not_paid_again(client):
    h = register(client)
    upload(client, h)
    upload(client, h)
    db = client.app.state.svc.db
    calls = client.portal.call(db.fetchone, "SELECT COUNT(*) AS n FROM ai_requests")
    hits = client.portal.call(db.fetchone, "SELECT COUNT(*) AS n FROM events WHERE name = 'vision_cache_hit'")
    assert calls["n"] == 1 and hits["n"] == 1


def test_daily_ai_budget(client):
    h = register(client)
    svc = client.app.state.svc
    svc.cfg.ai_daily_usd = 0.01
    client.portal.call(svc.db.execute, "INSERT INTO ai_requests (ts, model, status, cost_usd) VALUES (?, 'x', 'ok', 0.02)",
                       (int(time.time()),))
    m = upload(client, h).json()
    assert m["status"] == "draft" and m["items"] == []  # модель не звали — черновик заполнит человек
    assert client.post("/v1/fridge", headers=h, files={"photo": ("f.jpg", JPEG, "image/jpeg")}).json()["code"] == "budget"
    svc.cfg.ai_daily_usd = 0


def test_rate_limit_on_login(client):
    from nutrivia.ratelimit import RateLimiter
    t = [0.0]
    rl = RateLimiter(rules=(("/v1/auth/", "POST", 3, 60, "ip"),), clock=lambda: t[0])
    assert [rl.check("/v1/auth/sms/start", "POST", "1.1.1.1", None) for _ in range(3)] == [None, None, None]
    assert rl.check("/v1/auth/sms/start", "POST", "1.1.1.1", None) == 61
    assert rl.check("/v1/auth/sms/start", "POST", "2.2.2.2", None) is None  # другой адрес
    t[0] = 61
    assert rl.check("/v1/auth/sms/start", "POST", "1.1.1.1", None) is None  # окно прошло
    # в приложении — 429 с понятным текстом
    from nutrivia.ratelimit import AUTH_LIMIT
    for _ in range(AUTH_LIMIT):
        client.post("/v1/auth/sms/start", json={"phone": "+77070000777"})
    r = client.post("/v1/auth/sms/start", json={"phone": "+77070000778"})
    assert r.status_code == 429 and r.json()["code"] == "too_many" and r.headers["Retry-After"]


def test_security_headers_and_export(client):
    h = register(client)
    upload(client, h)
    client.post("/v1/weights", headers=h, json={"kg": 70})
    r = client.get("/v1/users/me/export", headers=h)
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    data = r.json()
    assert len(data["meals"]) == 1 and data["weights"][0]["kg"] == 70 and "phone" not in str(data["profile"])


def test_kazakh_dish_names(client):
    h = register(client)
    meal = upload(client, h).json()
    assert meal["items"][0]["name"] == "Плов с говядиной"
    assert client.patch("/v1/me", headers=h, json={"lang": "kk"}).json()["lang"] == "kk"
    assert client.get(f"/v1/meals/{meal['id']}", headers=h).json()["items"][0]["name"] == "Палау"


def test_feed_posts_likes_reports_moderation(client):
    a = register(client, phone="+77070000031")
    b = register(client, phone="+77070000032")
    meal = upload(client, a).json()
    # килограммы не публикуем
    r = client.post("/v1/feed", headers=a, json={"kind": "habit", "text": "Минус 3 кг за неделю!"})
    assert r.status_code == 422 and r.json()["code"] == "bad_text"
    post = client.post("/v1/feed", headers=a, json={"kind": "recipe", "text": "Плов с салатом на обед", "meal_id": meal["id"]}).json()
    assert post["mine"] and post["meal"]["items"] == ["Плов с говядиной", "Салат из свежих овощей"]
    # чужой приём пищи прикрепить нельзя
    assert client.post("/v1/feed", headers=b, json={"kind": "recipe", "text": "Чужое", "meal_id": meal["id"]}).status_code == 404
    client.post("/v1/feed", headers=b, json={"kind": "habit", "text": "Неделю без сладкого после ужина"})

    feed_b = client.get("/v1/feed", headers=b).json()["posts"]
    assert [p["kind"] for p in feed_b] == ["habit", "recipe"] and not feed_b[1]["mine"]
    assert client.get("/v1/feed?kind=recipe", headers=b).json()["posts"][0]["id"] == post["id"]
    assert client.get(f"/v1/feed/{post['id']}/photo", headers=b).status_code == 200
    liked = client.post(f"/v1/feed/{post['id']}/like", headers=b).json()
    assert liked["likes"] == 1 and liked["liked"]
    assert client.post(f"/v1/feed/{post['id']}/like", headers=b).json()["likes"] == 0  # повторный — снять

    # три жалобы — пост скрыт; оператор возвращает
    for i in range(3):
        h = b if i == 0 else register(client, phone=f"+7707000004{i}")
        assert client.post(f"/v1/feed/{post['id']}/report", headers=h).status_code == 204
    assert all(p["id"] != post["id"] for p in client.get("/v1/feed", headers=b).json()["posts"])
    assert client.get(f"/v1/feed/{post['id']}/photo", headers=b).status_code == 404
    h_op, op = login(client, phone="+77070000049")
    client.portal.call(client.app.state.svc.db.execute, "UPDATE users SET role = 'operator' WHERE tg_id = ?", (op["me"]["user_id"],))
    queue = client.get("/v1/feed/moderation", headers=h_op).json()["posts"]
    assert queue[0]["id"] == post["id"] and queue[0]["hidden"] and queue[0]["reports"] == 3
    assert client.get("/v1/feed/moderation", headers=b).status_code == 403
    client.post(f"/v1/feed/{post['id']}/moderate", headers=h_op, json={"keep": True})
    assert any(p["id"] == post["id"] for p in client.get("/v1/feed", headers=b).json()["posts"])
    # удалить свой пост можно, чужой — нет; удаление аккаунта стирает посты
    assert client.delete(f"/v1/feed/{post['id']}", headers=b).status_code == 404
    assert client.delete("/v1/users/me", headers=a).status_code == 204
    assert all(p["id"] != post["id"] for p in client.get("/v1/feed", headers=b).json()["posts"])


def test_subscription_trial_claim_confirm_and_paywall(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "adm")
    A = {"X-Admin-Token": "adm"}
    svc = client.app.state.svc
    h, out = login(client)
    uid = out["me"]["user_id"]
    s = client.get("/v1/subscription", headers=h).json()
    assert s["status"] == "trial" and s["days_left"] == 14 and not s["enforced"]
    # пробный период прошёл
    client.portal.call(svc.db.execute, "UPDATE users SET joined_at = joined_at - 15 * 86400 WHERE tg_id = ?", (uid,))
    assert client.get("/v1/subscription", headers=h).json()["status"] == "expired"
    assert upload(client, h).status_code == 200  # без PAYWALL_ENFORCE фото принимаем
    svc.cfg.paywall_enforce = True
    r = upload(client, h)
    assert r.status_code == 402 and r.json()["code"] == "subscription"
    # «Я оплатил» → админ подтверждает → 30 дней
    assert client.post("/v1/subscription/claim", headers=h).json()["pending"] is True
    client.post("/v1/subscription/claim", headers=h)  # повтор не плодит заявки
    pend = client.get("/v1/admin/payments", headers=A).json()
    assert len(pend) == 1 and pend[0]["user_id"] == uid
    assert client.post(f"/v1/admin/payments/{pend[0]['id']}", headers=A, json={"confirm": True}).json() == {"ok": True}
    s = client.get("/v1/subscription", headers=h).json()
    assert s["status"] == "active" and not s["pending"]
    assert upload(client, h).status_code == 200
    svc.cfg.paywall_enforce = False
    # специалисту подписка не нужна
    h_pro, _ = login(client, phone="+77070000061", role="trainer", name="Ерлан")
    assert client.get("/v1/subscription", headers=h_pro).json()["status"] == "free"


def test_client_ip_behind_proxy(monkeypatch):
    from nutrivia.ratelimit import client_ip
    h = {"x-forwarded-for": "6.6.6.6, 5.5.5.5", "cf-connecting-ip": "7.7.7.7"}
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    assert client_ip(h, "10.0.0.1") == "10.0.0.1"  # без прокси заголовкам не верим
    monkeypatch.setenv("TRUST_PROXY", "1")
    assert client_ip(h, "10.0.0.1") == "5.5.5.5"   # последний — тот, что дописал прокси; первый подделан
    assert client_ip({}, "10.0.0.1") == "10.0.0.1"


def test_rate_limiter_forgets_idle_keys():
    from nutrivia.ratelimit import RateLimiter
    t = [0.0]
    rl = RateLimiter(rules=(("/v1/auth/", "POST", 3, 60, "ip"),), clock=lambda: t[0])
    for i in range(500):
        rl.check("/v1/auth/sms/start", "POST", f"ip{i}", None)
    t[0] = 1000
    for _ in range(500):
        rl.check("/health", "GET", "x", None)
    assert len(rl.hits) == 0


def test_huge_upload_rejected_before_reading(client):
    h = register(client)
    r = client.post("/v1/meals", headers={**h, "content-length": str(50 * 1024 * 1024)}, content=b"x")
    assert r.status_code == 413 and r.json()["code"] == "too_large"


def test_telegram_link_needs_bot(client):
    h, body = login(client)
    assert body["me"]["telegram"] == {"available": False, "linked": False}
    r = client.post("/v1/me/telegram", headers=h)
    assert r.status_code == 503 and r.json()["code"] == "no_bot"
    assert client.delete("/v1/me/telegram", headers=h).json()["telegram"]["linked"] is False


def test_second_login_with_coach_code(manual_client):
    """Номер уже зарегистрирован: роль не меняется. Специалисту — понятное сообщение, клиент без тренера — подключается."""
    c = manual_client
    trainer_phone, client_phone = "+77070000101", "+77070000102"
    base = {"consent": True, "goal": "lose"}
    t = c.post("/v1/auth/sms/verify", json={**base, "phone": trainer_phone, "code": issue(c, trainer_phone),
                                            "role": "trainer", "name": "Айбек"}).json()
    invite = t["me"]["pro"]["invite_code"]
    # тренер входит снова и вводит свой же код как «клиент» — остаётся тренером, получает объяснение
    again = c.post("/v1/auth/sms/verify", json={**base, "phone": trainer_phone, "code": issue(c, trainer_phone),
                                                "role": "client", "invite_code": invite}).json()
    assert again["me"]["role"] == "trainer" and again["join"] == "pro_account" and "другой номер" in again["join_message"]
    # прошёл регистрацию клиента без кода (цель, параметры) — тоже объясняем
    plain = c.post("/v1/auth/sms/verify", json={**base, "phone": trainer_phone, "code": issue(c, trainer_phone)}).json()
    assert plain["join"] == "pro_account"
    # обычный «Войти» (без цели и кода) — молча открываем кабинет
    login = c.post("/v1/auth/sms/verify", json={"phone": trainer_phone, "code": issue(c, trainer_phone),
                                                "consent": True}).json()
    assert login["join"] is None and login["me"]["role"] == "trainer"
    # клиент без тренера при повторном входе с кодом — подключается
    first = c.post("/v1/auth/sms/verify", json={**base, "phone": client_phone, "code": issue(c, client_phone)}).json()
    assert first["me"]["coach"] is None
    second = c.post("/v1/auth/sms/verify", json={**base, "phone": client_phone, "code": issue(c, client_phone),
                                                 "invite_code": invite}).json()
    assert second["join"] == "ok" and second["me"]["coach"]["code"] == invite
