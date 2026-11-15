#!/bin/bash
# Runs the whole suite: a fresh stand-in server for every test, each with the settings it needs, and each
# test's output kept in $STUDIO_OUT/results/<label>.txt (the server's own log beside it).
#   usage: tests/run_all.sh [label ...]        (no labels: everything; labels are the first word of each line below)
# Reads STUDIO_PORT, STUDIO_URL, STUDIO_OUT, STUDIO_MEDIA (see tests/where.py), and STUDIO_WRAP: a command to
# put in front of every test, such as "nice -n 5", on a small machine.
# Ends with a count; exits non-zero when any test did.
here="$(cd "$(dirname "$0")" && pwd)"; root="$(dirname "$here")"
export STUDIO_PORT="${STUDIO_PORT:-$(sed -nE 's#.*:([0-9]+)/?$#\1#p' <<< "${STUDIO_URL:-}")}"; export STUDIO_PORT="${STUDIO_PORT:-8787}"
export STUDIO_OUT="${STUDIO_OUT:-/tmp/studio-tests}"; export STUDIO_MEDIA="${STUDIO_MEDIA:-$STUDIO_OUT/media}"
res="$STUDIO_OUT/results"; mkdir -p "$res"
only=" $* "; passed=0; failed=0; failures=""
bash "$here/prepare.sh" || exit 1

run() {   # label | "NAME=VALUE ..." for the stand-in | "addresses to call first" | script | arguments...
  local label=$1 envs=$2 seeds=$3 script=$4; shift 4
  if [ "$only" != "  " ] && [[ "$only" != *" $label "* ]]; then return; fi
  [ -f "$here/$script" ] || { echo "$label: (no $script here, skipped)"; return; }
  "$here/serve" $envs > /dev/null || { echo "$label: the stand-in server did not start"; failed=$((failed + 1)); failures="$failures $label"; return; }
  for s in $seeds; do curl -s -o /dev/null "http://localhost:$STUDIO_PORT/$s"; done
  local with=python3; case "$script" in *.mjs) with=node;; *.sh) with=bash;; esac
  local start=$(date +%s) code
  ( cd "$here" && $STUDIO_WRAP timeout 600 $with "$script" "$@" ) > "$res/$label.txt" 2>&1; code=$?
  cp "$STUDIO_OUT/dev.log" "$res/$label.server.log" 2>/dev/null
  local errors=$(grep -c 'Traceback\|^Error:' "$res/$label.txt")
  echo "exit=$code secs=$(( $(date +%s) - start ))" >> "$res/$label.txt"
  if [ "$code" = 0 ] && [ "$errors" = 0 ]; then passed=$((passed + 1)); echo "ok    $label"
  else failed=$((failed + 1)); failures="$failures $label"; echo "FAIL  $label (exit $code, $errors error lines; see $res/$label.txt)"; fi
}

# The walk-through tests. These print what they see rather than judge it: they fail here only when they stop
# with an error, so after a change to the screens, read their output too.
run g              ""                     ""                test_g.py
run chat           ""                     ""                test_chat.py
run car            ""                     ""                test_car.py
run r4             ""                     ""                test_r4.py
run r5             ""                     ""                test_r5.py
run r6             ""                     ""                test_r6.py
run r7             ""                     "__seed_history"  test_r7.py
run made           ""                     ""                test_made.py
run words          ""                     ""                test_words.py
run ins_api        ""                     ""                test_ins_api.py
run ins_ui_390     ""                     ""                test_ins_ui.py 390
run ins_ui_375     ""                     ""                test_ins_ui.py 375
run tiers_full     ""                     ""                test_tiers.py full
run tiers_noskip   "NO_SKIP=1"            ""                test_tiers.py noskip
run photo_default  ""                     ""                test_photo.py default
run photo_plain    "PHOTOS=plain"         ""                test_photo.py plain
run photo_srvref   "PHOTOS=serverrefused" ""                test_photo.py serverrefused
run photo_allref   "PHOTOS=allrefused"    ""                test_photo.py allrefused
run race           "SLOW_VIDEOS=1"        ""                test_race.py
run video_pick     ""                     ""                test_video_pick.py
run voice_old      ""                     ""                test_voice.py old
run voice_new      ""                     ""                test_voice.py new
run voice_slips    "SLIPS=1"              ""                test_voice.py slips
run books          ""                     ""                test_books.py
run music_api      ""                     ""                test_music_api.py anon
run music_api_keys "OV_KEYS=1"            ""                test_music_api.py keys
run music_api_nocat "NO_CATEGORY=1"       ""                test_music_api.py nocategory
run music_api_lim  "MUSIC_LIMIT=1"        ""                test_music_api.py limited
run music_ui       ""                     ""                test_music_ui.py
run music_more     ""                     ""                test_music_more.py normal
run music_more_lim "MUSIC_LIMIT=1"        ""                test_music_more.py limited
run music_silent   ""                     ""                test_music_silent.py
run igmusic        ""                     ""                test_igmusic.py
run handoff_api    ""                     ""                test_handoff_api.py
run handoff_ui     ""                     ""                test_handoff_ui.py
run ig_blocked     ""                     ""                test_ig_blocked.mjs
run posted_by_hand ""                     ""                test_posted_by_hand.py
run ask_looks_again ""                    ""                test_ask_looks_again.py
run bottom_gap     ""                     ""                test_bottom_gap.py
run keyboard_band  ""                     ""                test_keyboard_band.py

# The tests that judge for themselves: each asserts, prints PASS or FAIL and exits non-zero on failure.
# Most start their own fresh server (several times, with different settings) through tests/serve.
run web_quotes     ""                     ""                test_web_quotes.py
run unit_renew     ""                     ""                unit_renew.mjs
for f in "$here"/test_a[0-9]*_*.py "$here"/test_a[0-9]*_*.mjs; do
  [ -f "$f" ] && run "$(basename "${f%.*}")" "" "" "$(basename "$f")"
done
# The reel maker's own self-check, and whether it really catches a spoiled reel (needs ffmpeg and Pillow).
if [ "$only" = "  " ] || [[ "$only" == *" test_a1_selfcheck"* ]]; then
  [ -s "$STUDIO_OUT/sc/two/photo_music.mp4" ] || bash "$root/render/selfcheck.sh" "$STUDIO_OUT/sc/two" > "$res/selfcheck_make.txt" 2>&1
fi
for f in "$here"/test_a1_*.sh; do [ -f "$f" ] && run "$(basename "${f%.*}")" "" "" "$(basename "$f")"; done

"$here/stop" > /dev/null
echo
echo "$passed passed, $failed failed.${failures:+ Failed:$failures}"
[ "$failed" = 0 ]
