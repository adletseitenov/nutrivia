"""Тайминги слов озвучки (faster-whisper) → vo/words.json: {сцена: {"dur": с, "words": [[слово, начало, конец], ...]}}."""
import json, subprocess, sys
from pathlib import Path
import numpy as np
from faster_whisper import WhisperModel

HERE = Path(__file__).resolve().parent
model = WhisperModel("small", device="cpu", compute_type="int8")
out = {}
for f in sorted(HERE.glob("s*.mp3")):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    segs, _ = model.transcribe(audio, language="ru", word_timestamps=True)
    words = [[w.word.strip(), round(w.start, 2), round(w.end, 2)] for s in segs for w in s.words]
    out[f.stem] = {"dur": round(len(audio) / 16000, 2), "words": words}
    print(f.stem, "|", " ".join(w[0] for w in words), flush=True)
(HERE / "words.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
