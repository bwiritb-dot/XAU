#!/bin/bash
# render 1080p60 in 5 s chunks (resumable), then concat + mux audio
cd "$(dirname "$0")"
for s in 0 5 10 15 20 25; do
  f=out/chunk_$s.mp4
  [ -s $f ] && continue
  node render.js $f.tmp.mp4 1920 1080 60 $s $((s+5)) 2 6 > out/chunk_$s.log 2>&1 && mv $f.tmp.mp4 $f
done
printf "file 'chunk_%s.mp4'\n" 0 5 10 15 20 25 > out/list.txt
python3 audio.py out/audio.wav
ffmpeg -y -v error -f concat -safe 0 -i out/list.txt -i out/audio.wav -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-14:TP=-1.0:LRA=11" -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart out/line-form-time.mp4
echo FINAL_DONE
