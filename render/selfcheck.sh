#!/usr/bin/env bash
# Self-check for the reel renderer, run by .github/workflows/render-check.yml (and by hand if you like).
#
#   bash render/selfcheck.sh OUTDIR
#       makes test media, renders four sample reels with the real render.py into OUTDIR and checks that each
#       one is exactly what the app expects: size, codecs, colours, frame rate, sound, length, and that the
#       words come out at full strength. Also notes which ffmpeg made them (OUTDIR/tools.txt, tools.files).
#
#   bash render/selfcheck.sh --compare LONG QUICK [QUICK...]
#       checks that the reels in each QUICK folder (tools set up the quick way) match the ones in LONG (tools
#       installed the long way): same settings, same pictures, same sound. Also says whether the quick way was
#       really taken.
#
#   bash render/selfcheck.sh --check REEL.mp4 [SECONDS]
#       checks one finished reel (any reel) against the same settings.
#
# Nothing binary lives in the repo: the test media is made here with ffmpeg and Pillow.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SAMPLES="photo_music video_keep_music hdr_video photo_silent"
fails=0
bad() { echo "FAIL $*"; fails=$((fails + 1)); }
first_line() { sed -n 1p; }                 # (not "head -1": that stops reading early, which upsets "pipefail")

probe() {  # probe FILE STREAM ENTRIES -> the values on one line
  ffprobe -v error -select_streams "$2" -show_entries "$3" -of csv=p=0 "$1" 2>/dev/null | first_line || true
}
# The settings every reel must have. They come from render.py: W, H, FPS and the ffmpeg settings there.
VIDEO_WANT="h264,High,1080,1920,yuv420p,bt709,bt709,bt709,30/1"
VIDEO_WANT_RUNNER="h264,High,1080,1920,yuv420p,bt709,unknown,unknown,30/1"
VIDEO_ASK="stream=codec_name,profile,width,height,pix_fmt,color_space,color_transfer,color_primaries,r_frame_rate"
AUDIO_WANT="aac,LC,44100,2"
AUDIO_ASK="stream=codec_name,profile,sample_rate,channels"
q() { ffmpeg -hide_banner -loglevel error -y "$@"; }
m="$(mktemp -d)"; trap 'rm -rf "$m"' EXIT   # scratch folder
get() { sed -n "s/^$2=//p" "$1/tools.txt" 2>/dev/null | first_line || true; }   # get FOLDER NAME -> a value from tools.txt

check_reel() {  # check_reel FILE SECONDS
  local f="$1" want="$2" n v a d frames expect words before="$fails"
  n="$(basename "$f")"
  [ -s "$f" ] || { bad "$n is missing"; return 0; }
  v="$(probe "$f" v:0 "$VIDEO_ASK")"
  # GitHub's ffmpeg (8.x) writes the colour matrix tag but leaves transfer and primaries unmarked, as it
  # always has for these reels; players read that as the same standard HD colour. Both forms pass.
  [ "$v" = "$VIDEO_WANT" ] || [ "$v" = "$VIDEO_WANT_RUNNER" ] || bad "$n video is $v"
  frames="$(probe "$f" v:0 stream=nb_frames)"; expect="$(python3 -c "print(int(float('$want') * 30))")"
  [ "$frames" = "$expect" ] || bad "$n has $frames pictures, not $expect"
  a="$(probe "$f" a:0 "$AUDIO_ASK")"
  [ "$a" = "$AUDIO_WANT" ] || bad "$n sound is $a"
  d="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || true)"
  python3 -c "import sys; sys.exit(0 if abs(float('${d:-0}') - $want) < 0.15 else 1)" || bad "$n lasts ${d:-?} s, not $want"
  # The index must come first (+faststart), so the reel starts playing before it has fully loaded.
  python3 - "$f" <<'PY' || bad "$n is not set to start playing early"
import sys
data = open(sys.argv[1], "rb").read(1 << 16)
sys.exit(0 if 0 <= data.find(b"moov") < data.find(b"mdat") or data.find(b"mdat") < 0 else 1)
PY
  if ! [ -s "$m/overlay.png" ]; then
    if [ "$fails" = "$before" ]; then echo "ok   $n: $v, $frames pictures | $a | ${d}s"; fi
    return 0
  fi
  # The words: well inside every letter the picture must be the text layer's own white, at full strength.
  q -ss 2.5 -i "$f" -frames:v 1 -pix_fmt rgb24 "$m/frame.png" || true
  words="$(python3 - "$m/frame.png" "$m/overlay.png" <<'PY' || true
import sys
from PIL import Image, ImageFilter, ImageStat
frame = Image.open(sys.argv[1]).convert("L")
alpha = Image.open(sys.argv[2]).getchannel("A")
inside = alpha.point(lambda a: 255 if a == 255 else 0).filter(ImageFilter.MinFilter(5))
count = inside.histogram()[255]
if frame.size != (1080, 1920): print("bad size"); sys.exit(0)
if count < 500: print("skipped"); sys.exit(0)
stat = ImageStat.Stat(frame, mask=inside)
print("%d %.1f %d" % (count, stat.mean[0], stat.extrema[0][0]))
PY
)"
  case "$words" in
    skipped) words="words not checked (this Pillow has no large built-in typeface)" ;;
    "bad size") bad "$n: a picture taken from it is not 1080x1920" ;;
    *) python3 -c "import sys; c, mean, low = '$words'.split(); sys.exit(0 if float(mean) >= 250 and int(low) >= 235 else 1)" \
         || bad "$n: the words are not at full strength (pixels inside letters, average, darkest: $words)"
       words="words at full strength (inside the letters: average and darkest ${words#* }, of 255)" ;;
  esac
  if [ "$fails" = "$before" ]; then echo "ok   $n: $v, $frames pictures | $a | ${d}s | $words"; fi
}
if [ "${1:-}" = "--check" ]; then
  check_reel "${2:?give a reel file}" "${3:-5}"
  if [ "$fails" = 0 ]; then echo "PASS"; else echo "FAIL ($fails)"; exit 1; fi
  exit 0
fi

if [ "${1:-}" = "--compare" ]; then
  long="${2:?give the folder made the long way}"; shift 2
  [ "$#" -ge 1 ] || { echo "give at least one folder made the quick way"; exit 1; }
  echo "long way : $(get "$long" ffmpeg) | Pillow $(get "$long" pillow) | $(get "$long" machine)"
  for quick in "$@"; do
    name="$(basename "$quick")"
    echo "--- $name: tools from $(get "$quick" source) | $(get "$quick" ffmpeg) | Pillow $(get "$quick" pillow) | $(get "$quick" machine)"
    [ "$(get "$quick" ffmpeg)" = "$(get "$long" ffmpeg)" ] || echo "note $name: a different ffmpeg version than the long way (a package update in between?)"
    if [ -s "$long/tools.files" ] && [ -s "$quick/tools.files" ]; then
      differ="$(diff <(LC_ALL=C sort "$long/tools.files") <(LC_ALL=C sort "$quick/tools.files") | grep -c '^>' || true)"
      if [ "$differ" = "0" ]; then echo "ok   $name: the very same program files as the long way ($(wc -l < "$quick/tools.files") files, compared by checksum)"
      else echo "note $name: $differ program files differ from the long way (a package update since the copy was saved?)"; fi
    fi
    for s in $SAMPLES; do
      x="$long/$s.mp4"; y="$quick/$s.mp4"
      if ! [ -s "$x" ] || ! [ -s "$y" ]; then bad "$name $s: missing from one side"; continue; fi
      for st in "v:0 $VIDEO_ASK,nb_frames" "a:0 $AUDIO_ASK"; do
        a="$(probe "$x" ${st% *} "${st#* }")"; b="$(probe "$y" ${st% *} "${st#* }")"
        [ "$a" = "$b" ] || bad "$name $s: settings differ: $a vs $b"
      done
      ssim="$(ffmpeg -hide_banner -nostats -i "$x" -i "$y" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | tail -1 | cut -d: -f2 || true)"
      python3 -c "import sys; sys.exit(0 if float('${ssim:-0}') >= ${SSIM_FLOOR:-0.995} else 1)" || bad "$name $s: pictures differ (SSIM ${ssim:-none})"
      # The sound: take one reel's sound away from the other's, sample by sample, and see how loud what is left
      # gets (-inf = nothing at all is left; anything under -50 dB is far too quiet to hear).
      q -i "$x" -map 0:a:0 -f s16le -c:a pcm_s16le "$m/x.pcm" || true
      q -i "$y" -map 0:a:0 -f s16le -c:a pcm_s16le "$m/y.pcm" || true
      left="$(python3 - "$m/x.pcm" "$m/y.pcm" <<'PY' || true
import array, math, sys
a = array.array("h"); a.frombytes(open(sys.argv[1], "rb").read())
b = array.array("h"); b.frombytes(open(sys.argv[2], "rb").read())
if len(a) != len(b) or not a:
    print("lengths-differ")
else:
    worst = max(abs(x - y) for x, y in zip(a, b))
    print("-inf" if worst == 0 else "%.1f" % (20 * math.log10(worst / 32768)))
PY
)"
      python3 -c "import sys; sys.exit(0 if float('${left:-0}') <= -50 else 1)" 2>/dev/null || bad "$name $s: sound differs (what is left after taking one from the other peaks at ${left:-?} dB)"
      same="different bytes"; if cmp -s "$x" "$y"; then same="identical bytes"; fi
      echo "ok   $name $s: pictures SSIM $ssim, sound difference $left dB, $same"
    done
  done
  # Was the quick way really taken? (Only said when the folders come from the workflow, which notes how the tools arrived.)
  sources=""; keys=""; for quick in "$@"; do sources="$sources $(get "$quick" source)"; keys="$keys $(get "$quick" key | sed 's/-[0-9]*-[0-9]*$//')"; done
  for quick in "$@"; do
    if [ "$(get "$quick" restored)" = "yes" ] && [ "$(get "$quick" source)" != "cache" ]; then
      bad "$(basename "$quick"): a saved copy of the tools was found but did not work (reels are still made, the long way)"
    fi
  done
  case " $sources " in
    *" cache "*) echo "ok   the quick way was taken:$sources" ;;
    *" install "*)
      if [ "$#" -ge 2 ] && [ "$(printf '%s\n' $keys | sort -u | wc -l)" = "1" ]; then
        bad "the quick way was never taken, though both runs were on the same machine image:$sources (reels are still made, the long way)"
      else
        echo "note the quick way was not taken this time:$sources (first run on a new machine image; the next run should take it)"
      fi ;;
    *) ;;
  esac
  if [ "$fails" = 0 ]; then echo "PASS: both ways of setting up make the same reels"; else echo "FAIL ($fails)"; exit 1; fi
  exit 0
fi

out="${1:?give an output folder}"; mkdir -p "$out"
t0=$(date +%s)

# Which tools are these? Noted so that two runs can be compared afterwards.
{
  echo "source=${TOOLS_SOURCE:-unknown}"
  echo "restored=${TOOLS_RESTORED:-unknown}"
  echo "key=${TOOLS_KEY:-}"
  echo "ffmpeg=$(ffmpeg -version | first_line)"
  echo "pillow=$(python3 -c 'import PIL; print(PIL.__version__)')"
  echo "machine=${ImageOS:-unknown}-${ImageVersion:-unknown}"
} > "$out/tools.txt"
{ command -v ffmpeg; command -v ffprobe; ldd "$(command -v ffmpeg)" | awk '$3 ~ /^\// { print $3 }'; } | LC_ALL=C sort -u | xargs sha256sum > "$out/tools.files"
sed -n 's/^ffmpeg=//p' "$out/tools.txt"

# HDR clips (as recent iPhones record) need these two filters, or their colours come out washed-out.
filters="$(ffmpeg -hide_banner -filters 2>/dev/null)"
for f in zscale tonemap; do grep -q " $f " <<< "$filters" || bad "this ffmpeg has no $f filter: HDR clips would look washed-out"; done

# Test media. The clips are stored without loss, so every machine starts from exactly the same pictures.
q -f lavfi -i "testsrc2=s=1600x1200" -frames:v 1 -q:v 2 "$m/photo.jpg"
q -f lavfi -i "testsrc2=s=720x1280:r=30:d=6" -f lavfi -i "sine=f=440:r=48000:d=6" \
  -c:v libx264 -qp 0 -pix_fmt yuv420p -c:a aac -shortest "$m/clip.mp4"
# An HDR-style clip, tagged the way an iPhone tags its HDR video, so the renderer's tone-mapping is used.
q -f lavfi -i "testsrc2=s=1280x720:r=30:d=6" -c:v libx264 -qp 0 -pix_fmt yuv420p10le \
  -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc "$m/hdr.mp4"
q -f lavfi -i "sine=f=330:r=44100:d=12" -ac 2 -c:a aac -b:a 192k "$m/music.m4a"
# A text layer like the one the app draws: transparent, 1080x1920, white words with fine edges.
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
  python3 "$here/render.py" --overlay "$m/overlay.png" --duration 5 --out "$out/$n.mp4" "$@" > "$m/$n.log" 2>&1 \
    || { cat "$m/$n.log"; bad "$n could not be rendered"; return 0; }
  if grep -q "washed-out" "$m/$n.log"; then bad "$n: the HDR colours were not brought down to normal"; fi
  echo "rendered $n in $(( $(date +%s) - t )) s"
}
render photo_music --bg "$m/photo.jpg" --music "$m/music.m4a" --volume 0.8 --music-start 2
render video_keep_music --bg "$m/clip.mp4" --keep-audio --music "$m/music.m4a" --volume 0.5 --fade
render hdr_video --bg "$m/hdr.mp4"
render photo_silent --bg "$m/photo.jpg"

for s in $SAMPLES; do check_reel "$out/$s.mp4" 5; done
echo "whole check took $(( $(date +%s) - t0 )) s"
if [ "$fails" = 0 ]; then echo "PASS: all sample reels are right"; else echo "FAIL ($fails)"; exit 1; fi
