#!/usr/bin/env bash
# Does the renderer's self-check really catch a wrong reel? Feeds it good and deliberately spoiled reels.
# Needs $STUDIO_OUT/sc/two (made by: bash render/selfcheck.sh $STUDIO_OUT/sc/two; tests/run_all.sh does it). Asserts; exits non-zero on failure.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${STUDIO_OUT:-/tmp/studio-tests}"
SC="$ROOT/render/selfcheck.sh"
GOOD="$OUT/sc/two"
T="$OUT/sc/neg"; rm -rf "$T"; mkdir -p "$T"
fails=0
check() { if [ "$2" = "0" ]; then echo "ok   $1"; else echo "FAIL $1 ${3:-}"; fails=$((fails + 1)); fi; }
q() { ffmpeg -hide_banner -loglevel error -y "$@"; }
expect_fail() {  # expect_fail NAME WORDS-IT-MUST-SAY COMMAND...
  local name="$1" words="$2" out rc; shift 2
  out="$("$@" 2>&1)"; rc=$?
  check "$name" "$([ "$rc" != 0 ] && grep -q "$words" <<< "$out" && echo 0 || echo 1)" "(exit $rc) $(tail -2 <<< "$out" | tr '\n' ' ' | cut -c1-220)"
}
[ -s "$GOOD/photo_music.mp4" ] || { echo "FAIL: make $GOOD first"; exit 1; }
g="$GOOD/video_keep_music.mp4"
V=(-c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -r 30)
A=(-c:a aac -b:a 160k -ar 44100 -ac 2)

# ---- one reel at a time
out="$(bash "$SC" --check "$g" 5 2>&1)"; check "a good reel passes" "$?" "$out"
q -i "$g" "${V[@]}" -r 25 "${A[@]}" -movflags +faststart "$T/fps25.mp4";            expect_fail "25 pictures a second is caught" "video is" bash "$SC" --check "$T/fps25.mp4" 5
q -i "$g" "${V[@]}" -vf scale=720:1280 "${A[@]}" -movflags +faststart "$T/small.mp4"; expect_fail "a smaller picture is caught" "720,1280" bash "$SC" --check "$T/small.mp4" 5
q -i "$g" "${V[@]}" -pix_fmt yuv444p "${A[@]}" -movflags +faststart "$T/444.mp4";     expect_fail "another pixel layout is caught" "video is" bash "$SC" --check "$T/444.mp4" 5
q -i "$g" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -r 30 -bsf:v h264_metadata=colour_primaries=2:transfer_characteristics=2:matrix_coefficients=2 "${A[@]}" -movflags +faststart "$T/untagged.mp4"
expect_fail "missing colour tags are caught" "video is" bash "$SC" --check "$T/untagged.mp4" 5
q -i "$g" "${V[@]}" -c:a aac -b:a 160k -ar 48000 -ac 2 -movflags +faststart "$T/48k.mp4"; expect_fail "another sound rate is caught" "sound is" bash "$SC" --check "$T/48k.mp4" 5
q -i "$g" "${V[@]}" -c:a aac -b:a 160k -ar 44100 -ac 1 -movflags +faststart "$T/mono.mp4"; expect_fail "one-sided sound is caught" "sound is" bash "$SC" --check "$T/mono.mp4" 5
q -i "$g" "${V[@]}" -an -movflags +faststart "$T/silent.mp4";                         expect_fail "no sound track at all is caught" "sound is" bash "$SC" --check "$T/silent.mp4" 5
q -i "$g" -c copy "$T/slowstart.mp4";                                                 expect_fail "a reel that can't start playing early is caught" "start playing early" bash "$SC" --check "$T/slowstart.mp4" 5
q -i "$g" -t 4 "${V[@]}" "${A[@]}" -movflags +faststart "$T/short.mp4";               expect_fail "a shorter reel is caught" "lasts" bash "$SC" --check "$T/short.mp4" 5
expect_fail "a missing reel is caught" "missing" bash "$SC" --check "$T/nothing.mp4" 5

# ---- two sets side by side
side() { rm -rf "$T/$1"; mkdir -p "$T/$1"; cp "$GOOD"/*.mp4 "$GOOD"/tools.* "$T/$1/"; }
side same; out="$(bash "$SC" --compare "$GOOD" "$T/same" 2>&1)"; check "an identical set passes" "$?" "$(tail -2 <<< "$out")"
check "and is called identical" "$(grep -c "identical bytes" <<< "$out" | grep -qx 4 && echo 0 || echo 1)"
side soft; q -i "$g" -c:v libx264 -preset medium -crf 38 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -r 30 -c:a copy -movflags +faststart "$T/soft/video_keep_music.mp4"
expect_fail "a set with a lower-quality picture is caught" "pictures differ" bash "$SC" --compare "$GOOD" "$T/soft"
side quiet; q -i "$g" -c:v copy -af volume=0.7 "${A[@]}" -movflags +faststart "$T/quiet/video_keep_music.mp4"
expect_fail "a set with quieter sound is caught" "sound differs" bash "$SC" --compare "$GOOD" "$T/quiet"
side gone; rm "$T/gone/hdr_video.mp4"; expect_fail "a set with a reel missing is caught" "missing from one side" bash "$SC" --compare "$GOOD" "$T/gone"
side tagged; cp "$T/small.mp4" "$T/tagged/video_keep_music.mp4"; expect_fail "a set with other settings is caught" "settings differ" bash "$SC" --compare "$GOOD" "$T/tagged"

# ---- was the quick way really taken?
tools() { side "$1"; { echo "source=$2"; echo "restored=$3"; echo "key=$4"; echo "ffmpeg=$(sed -n 's/^ffmpeg=//p' "$GOOD/tools.txt")"; echo "pillow=x"; echo "machine=m"; } > "$T/$1/tools.txt"; }
K=render-tools-v2-ubuntu26-20261111.82.6-py312-abcdef012345
tools q1 install no "$K-777-1"; tools q2 cache yes "$K-777-1"
out="$(bash "$SC" --compare "$GOOD" "$T/q1" "$T/q2" 2>&1)"; check "first run installs, second takes the quick way: passes and says so" "$([ $? = 0 ] && grep -q "the quick way was taken" <<< "$out" && echo 0 || echo 1)" "$(tail -2 <<< "$out")"
tools q3 install yes "$K-777-1"
expect_fail "a saved copy that did not work is caught" "found but did not work" bash "$SC" --compare "$GOOD" "$T/q1" "$T/q3"
tools q4 install no "$K-777-1"
expect_fail "the quick way never being taken on one machine image is caught" "never taken" bash "$SC" --compare "$GOOD" "$T/q1" "$T/q4"
tools q5 install no "render-tools-v2-ubuntu26-20261118.90.1-py312-abcdef012345-777-1"
out="$(bash "$SC" --compare "$GOOD" "$T/q1" "$T/q5" 2>&1)"; check "two different machine images, both installing: a note, not a failure" "$([ $? = 0 ] && grep -q "^note the quick way was not taken" <<< "$out" && echo 0 || echo 1)" "$(tail -2 <<< "$out")"

if [ "$fails" = 0 ]; then echo PASS; else echo "FAIL ($fails)"; exit 1; fi
