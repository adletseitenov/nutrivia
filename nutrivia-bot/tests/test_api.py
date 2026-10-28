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
        {"name": "суши", "portion": 6, "unit": "штука", "grams": 180, "confidence": 0.6}]}
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
    # Одноразовый: второй вход тем же кодом не пускает
    assert c.post("/v1/auth/sms/start", json={"phone": PHONE}).status_code == 403
    assert c.post("/v1/auth/sms/verify", json={**body, "code": code}).status_code == 400


def test_sms_start_reports_delivery(client):
    assert client.post("/v1/auth/sms/start", json={"phone": PHONE}).json()["delivery"] == "sms"
