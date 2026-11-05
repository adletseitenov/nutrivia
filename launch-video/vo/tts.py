"""Озвучка сцен через OpenRouter → Fish Audio (бесплатная модель). Ключ — OPENROUTER_API_KEY из nutrivia-bot/.env.
  python3 vo/tts.py            # озвучить сцены, которых ещё нет
  python3 vo/tts.py s04_photo  # переозвучить одну
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parents[1] / "nutrivia-bot" / ".env"
MODEL = "fish-audio/s2.1-pro-free:free"
VOICE = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else "2270bb203a424d1881678ba5e4b82b54"


def key():
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("нет OPENROUTER_API_KEY")


def speak(text, out):
    body = json.dumps({"model": MODEL, "input": text, "voice": VOICE, "response_format": "mp3"}).encode()
    for i in range(5):
        req = urllib.request.Request("https://openrouter.ai/api/v1/audio/speech", data=body,
                                     headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
                if not r.headers.get("Content-Type", "").startswith("audio"):
                    sys.exit(f"не аудио: {data[:200]!r}")
            out.write_bytes(data)
            return
        except urllib.error.HTTPError as e:
            msg = e.read()[:200]
            if e.code in (429, 500, 502, 503) and i < 4:
                print(f"{e.code}, повтор через {20 * (i + 1)} с: {msg!r}", flush=True)
                time.sleep(20 * (i + 1))
                continue
            sys.exit(f"ошибка {e.code}: {msg!r}")


only = [a for a in sys.argv[1:] if a.startswith("s")]
for name, text in json.loads((HERE / "script.json").read_text(encoding="utf-8")):
    out = HERE / f"{name}.mp3"
    if (only and name not in only) or (not only and out.exists()):
        continue
    speak(text, out)
    print("ok", name, flush=True)
