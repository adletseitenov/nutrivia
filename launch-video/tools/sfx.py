"""Синтез звуковых эффектов (свои, без лицензий) → public/media/audio/sfx-*.wav"""
import wave
from pathlib import Path
import numpy as np

SR = 48000
OUT = Path(__file__).resolve().parents[1] / "public/media/audio"
rng = np.random.default_rng(7)


def save(name, x):
    x = x / (np.abs(x).max() + 1e-9) * 0.9
    st = np.stack([x, x], 1)
    with wave.open(str(OUT / f"sfx-{name}.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())


def t(sec):
    return np.arange(int(SR * sec)) / SR


def lowpass(x, a):  # однополюсный фильтр, a 0..1 (меньше — темнее)
    a = np.broadcast_to(np.asarray(a, dtype=float), x.shape)
    y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc); y[i] = acc
    return y


# затвор камеры: два щелчка шума
tt = t(0.18); n = rng.standard_normal(len(tt))
click = n * np.exp(-tt * 90)
shutter = click.copy(); off = int(0.07 * SR); shutter[off:] += 0.7 * click[: len(tt) - off]
save("shutter", lowpass(shutter, 0.5))

# свист перехода: шум с нарастающей и спадающей громкостью, «яркость» растёт
tt = t(0.55); n = rng.standard_normal(len(tt)); env = np.sin(np.pi * tt / tt[-1]) ** 2
save("whoosh", lowpass(n, 0.08) * env * (0.4 + tt / tt[-1]))

# поп карточки: короткий синус со спадом высоты
tt = t(0.12); f = 900 * np.exp(-tt * 18) + 300
save("pop", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 35))

# уведомление: два мягких тона
tt = t(0.6)
d = (np.sin(2 * np.pi * 1318 * tt) * np.exp(-tt * 9) + 0.8 * np.sin(2 * np.pi * 1760 * np.clip(tt - 0.12, 0, None))
     * np.exp(-np.clip(tt - 0.12, 0, None) * 8) * (tt > 0.12))
save("ding", d)

# нарастание 3 с: шум + тон вверх
tt = t(3.0); n = lowpass(rng.standard_normal(len(tt)), 0.05 + 0.25 * tt / 3)
tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (tt / 3) ** 2) / SR)
save("riser", (n * 0.8 + 0.25 * tone) * (tt / 3) ** 2)

# удар на сброс: суб-бас со спадом + щелчок
tt = t(1.2); f = 120 * np.exp(-tt * 6) + 38
boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 3.2)
boom[: int(0.01 * SR)] += rng.standard_normal(int(0.01 * SR)) * 0.6
save("impact", boom)

# тик счётчика
tt = t(0.03); save("tick", np.sin(2 * np.pi * 2400 * tt) * np.exp(-tt * 200))
print("ok")
