"""Проверка пилота снаружи: весь путь через публичный адрес API, как его проходит приложение.

    .venv/bin/python -m scripts.smoke_pilot https://xxx.trycloudflare.com [фото_еды.jpg]

С настоящим распознаванием передайте реальное фото еды — рисунок из приложения модель может не узнать.
Коды: при SMS_PROVIDER=manual выдаёт сам (как scripts/pilot_code), при console — берёт из data/pilot-logs/api.log.
Создаёт нутрициолога и клиента на тестовых номерах и в конце удаляет обоих.
"""
import os
import re
import sys
import time
from pathlib import Path

import httpx

LOG = Path(__file__).resolve().parent.parent / "data" / "pilot-logs" / "api.log"
PHOTO = Path(__file__).resolve().parent.parent.parent / "nutrivia-app" / "assets" / "images" / "demo-plov.png"
PRO_PHONE, CLIENT_PHONE = "+77009990001", "+77009990002"


def issue_manual(phone: str) -> str:
    import asyncio
    import os

    from nutrivia.auth import ManualCodes, SmsAuth
    from nutrivia.config import load_config
    from nutrivia.db import Database

    async def run() -> str:
        db = Database(load_config().db_path)
        await db.connect()
        try:
            return (await SmsAuth(db, ManualCodes(), os.environ["AUTH_SECRET"]).issue_manual(phone))[1]
        finally:
            await db.close()
    return asyncio.run(run())


def code_for(phone: str) -> str:
    for _ in range(20):
        found = re.findall(rf"DEV SMS to \{phone}: Nutrivia: код входа (\d{{4}})", LOG.read_text())
        if found:
            return found[-1]
        time.sleep(0.5)
    sys.exit(f"нет кода для {phone} в {LOG}")


def login(c: httpx.Client, phone: str, **kw) -> dict:
    manual = os.environ.get("SMS_PROVIDER") == "manual"
    code = issue_manual(phone) if manual else None
    r = c.post("/v1/auth/sms/start", json={"phone": phone})
    assert r.status_code == 200, r.text
    r = c.post("/v1/auth/sms/verify", json={"phone": phone, "code": code or code_for(phone), "consent": True, "goal": "lose", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def step(name: str) -> None:
    print(f"ok  {name}")


def main(api: str, photo: Path = PHOTO) -> None:
    from nutrivia.config import load_config
    load_config()  # .env → окружение: SMS_PROVIDER, AUTH_SECRET, DB_PATH
    with httpx.Client(base_url=api, timeout=60) as c:
        assert c.get("/health").json() == {"ok": True}
        step("health через туннель")

        pro = login(c, PRO_PHONE, role="nutritionist", name="Проверка")
        ph = {"Authorization": f"Bearer {pro['token']}"}
        invite = pro["me"]["pro"]["invite_code"]
        step(f"нутрициолог зарегистрирован, код {invite}")

        cl = login(c, CLIENT_PHONE, role="client", invite_code=invite)
        ch = {"Authorization": f"Bearer {cl['token']}"}
        assert cl["join"] == "ok", cl
        step("клиент зарегистрирован по коду")

        media = "image/png" if photo.suffix.lower() == ".png" else "image/jpeg"
        r = c.post("/v1/meals", headers=ch, files={"photo": (photo.name, photo.read_bytes(), media)})
        assert r.status_code == 200, r.text
        meal = r.json()
        assert meal["status"] == "draft" and meal["items"], meal
        step(f"фото загружено, черновик: {', '.join(i['name'] for i in meal['items'])}")

        r = c.get(f"/v1/meals/{meal['id']}/photo", headers=ch)
        assert r.status_code == 200 and r.content == photo.read_bytes()
        step("клиент получает своё фото")

        queue = c.get("/v1/pro/queue", headers=ph).json()["meals"]
        assert any(m["id"] == meal["id"] for m in queue)
        assert c.get(f"/v1/pro/meals/{meal['id']}/photo", headers=ph).status_code == 200
        step("разбор в очереди нутрициолога, фото открывается")

        fixed = [{"dish_id": i["dish_id"], "grams": i["grams"]} for i in meal["items"] if i["dish_id"]]
        fixed[0]["grams"] = round(fixed[0]["grams"] * 0.8)  # нутрициолог уменьшил первую порцию
        r = c.put(f"/v1/pro/meals/{meal['id']}/items", headers=ph, json={"items": fixed})
        assert r.status_code == 200, r.text
        assert c.post(f"/v1/pro/meals/{meal['id']}/comment", headers=ph, json={"text": "Порция меньше, всё ок"}).status_code == 200
        r = c.post(f"/v1/pro/meals/{meal['id']}/send", headers=ph)
        assert r.status_code == 200, r.text
        step("нутрициолог поправил граммы и отправил")

        seen = c.get(f"/v1/meals/{meal['id']}", headers=ch).json()
        assert seen["status"] == "reviewed" and seen["comment"] == "Порция меньше, всё ок", seen
        assert seen["reviewer"]["role"] == "nutritionist"
        today = c.get("/v1/today", headers=ch).json()
        assert today["meals"][0]["id"] == meal["id"]
        step("клиент видит проверку, комментарий и день")

        assert c.delete("/v1/users/me", headers=ch).status_code == 204
        assert c.delete("/v1/users/me", headers=ph).status_code == 204
        assert c.get("/v1/me", headers=ch).status_code == 401
        step("тестовые аккаунты удалены")
    print("\nПилот работает снаружи от начала до конца.")


if __name__ == "__main__":
    main(sys.argv[1].rstrip("/"), Path(sys.argv[2]) if len(sys.argv) > 2 else PHOTO)
