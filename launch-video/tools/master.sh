#!/bin/sh
# Мастеринг звука: двухпроходный loudnorm до -14 LUFS, пики ≤ -1.5 dBTP. Видео копируется без перекодирования.
#   sh tools/master.sh out/nutrivia-launch.mp4  → out/nutrivia-launch.master.mp4
set -e
IN="$1"; OUT="${IN%.mp4}.master.mp4"
J=$(ffmpeg -hide_banner -i "$IN" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
v() { echo "$J" | grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
ffmpeg -v error -y -i "$IN" -c:v copy -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(v input_i):measured_TP=$(v input_tp):measured_LRA=$(v input_lra):measured_thresh=$(v input_thresh):offset=$(v target_offset):linear=true,aresample=48000" -c:a aac -b:a 256k -movflags +faststart "$OUT"
ffmpeg -v info -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -E '^\s+I:|^\s+Peak:' | tr -s ' '
