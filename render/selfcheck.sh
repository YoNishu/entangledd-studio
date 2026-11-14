#!/usr/bin/env bash
# Self-check for the reel renderer, run by .github/workflows/render-check.yml (and by hand if you like).
#
#   bash render/selfcheck.sh OUTDIR          make test media, render four sample reels with the real render.py
#                                            into OUTDIR, and check each one is exactly what the app expects
#   bash render/selfcheck.sh --compare A B   check that the reels in folders A and B match (same stream
#                                            settings, and the pictures are the same: SSIM close to 1)
#
# Nothing binary lives in the repo: the test media is made here with ffmpeg and Pillow.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SAMPLES="photo_music video_keep_music hdr_video photo_silent"
fails=0
bad() { echo "FAIL $*"; fails=$((fails + 1)); }

probe() {  # probe FILE STREAM ENTRIES -> value(s) on one line
  ffprobe -v error -select_streams "$2" -show_entries "$3" -of csv=p=0 "$1" | head -1
}

# What every reel must look like: the values come from render.py (W, H, FPS and the ffmpeg settings).
check_reel() {  # check_reel FILE SECONDS
  local f="$1" want="$2" v a d
  v="$(probe "$f" v:0 stream=codec_name,profile,width,height,pix_fmt,color_space,color_transfer,color_primaries,r_frame_rate)"
  [ "$v" = "h264,High,1080,1920,yuv420p,bt709,bt709,bt709,30/1" ] || bad "$(basename "$f") video is $v"
  a="$(probe "$f" a:0 stream=codec_name,sample_rate,channels)"
  [ "$a" = "aac,44100,2" ] || bad "$(basename "$f") sound is $a"
  d="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
  python3 -c "import sys; sys.exit(0 if abs(float('$d') - $want) < 0.15 else 1)" || bad "$(basename "$f") lasts $d s, not $want"
  # The moov atom must come first (+faststart), so the reel starts playing before it has fully loaded.
  python3 - "$f" <<'PY' || bad "$(basename "$f") is not set to start playing early"
import sys
data = open(sys.argv[1], "rb").read(1 << 16)
sys.exit(0 if 0 <= data.find(b"moov") < data.find(b"mdat") or data.find(b"mdat") < 0 else 1)
PY
  echo "ok   $(basename "$f"): $v | $a | ${d}s"
}

if [ "${1:-}" = "--compare" ]; then
  for s in $SAMPLES; do
    x="$2/$s.mp4"; y="$3/$s.mp4"
    [ -s "$x" ] && [ -s "$y" ] || { bad "$s missing from one side"; continue; }
    for st in v:0 a:0; do
      p="stream=codec_name,profile,width,height,pix_fmt,color_space,r_frame_rate,sample_rate,channels,bit_rate"
      [ "$(probe "$x" $st $p)" = "$(probe "$y" $st $p)" ] || bad "$s $st differs: $(probe "$x" $st $p) vs $(probe "$y" $st $p)"
    done
    ssim="$(ffmpeg -hide_banner -nostats -i "$x" -i "$y" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | tail -1 | cut -d: -f2)"
    same="different bytes"; cmp -s "$x" "$y" && same="identical bytes"
    python3 -c "import sys; sys.exit(0 if float('${ssim:-0}') >= 0.999 else 1)" || bad "$s pictures differ: SSIM ${ssim:-none}"
    echo "ok   $s: SSIM $ssim, $same"
  done
  [ "$fails" = 0 ] && echo "PASS: both setups make the same reels" || { echo "FAIL ($fails)"; exit 1; }
  exit 0
fi

out="${1:?give an output folder}"; mkdir -p "$out"
m="$(mktemp -d)"; trap 'rm -rf "$m"' EXIT
t0=$(date +%s)
q() { ffmpeg -hide_banner -loglevel error -y "$@"; }
q -f lavfi -i "testsrc2=s=1600x1200" -frames:v 1 -q:v 2 "$m/photo.jpg"
q -f lavfi -i "testsrc2=s=720x1280:r=30:d=6" -f lavfi -i "sine=f=440:r=48000:d=6" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$m/clip.mp4"
# An HDR-style clip, tagged the way an iPhone tags its HDR video, so the renderer's tone-mapping is used.
q -f lavfi -i "testsrc2=s=1280x720:r=30:d=6" -c:v libx264 -pix_fmt yuv420p10le \
  -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc "$m/hdr.mp4"
q -f lavfi -i "sine=f=330:r=44100:d=12" -ac 2 -c:a aac -b:a 192k "$m/music.m4a"
# A text layer like the one the app draws: transparent, 1080x1920, with fine edges to show any softening.
python3 - "$m/overlay.png" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
im = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
try:
    f = ImageFont.load_default(size=72)
except TypeError:  # older Pillow
    f = ImageFont.load_default()
d.text((120, 860), "Every day with you", font=f, fill=(255, 255, 255, 255))
d.line([(500, 980), (580, 980)], fill=(255, 255, 255, 150), width=2)
im.save(sys.argv[1])
PY
echo "test media made in $(( $(date +%s) - t0 )) s"

render() {  # render NAME ARGS...
  local n="$1" t; shift; t=$(date +%s)
  python3 "$here/render.py" --overlay "$m/overlay.png" --duration 5 --out "$out/$n.mp4" "$@" >/dev/null
  echo "rendered $n in $(( $(date +%s) - t )) s"
}
render photo_music --bg "$m/photo.jpg" --music "$m/music.m4a" --volume 0.8 --music-start 2
render video_keep_music --bg "$m/clip.mp4" --keep-audio --music "$m/music.m4a" --volume 0.5 --fade
render hdr_video --bg "$m/hdr.mp4"
render photo_silent --bg "$m/photo.jpg"
for s in $SAMPLES; do check_reel "$out/$s.mp4" 5; done
ffmpeg -version | head -1
[ "$fails" = 0 ] && echo "PASS: all sample reels are right" || { echo "FAIL ($fails)"; exit 1; }
