#!/usr/bin/env bash
# Does the self-check notice words that come out weaker than the app drew them? Runs it against a copy of the
# renderer that has been spoiled on purpose (words laid over at 60% strength). Asserts; exits non-zero on failure.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${STUDIO_OUT:-/tmp/studio-tests}"
T="$OUT/sc/weak"; rm -rf "$T"; mkdir -p "$T/render"
cp -r "$ROOT/render/." "$T/render/"
python3 - "$T/render/render.py" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = 'video = f"{bg};[1:v]format=rgba{fade}[txt];'
assert old in s
open(p, "w").write(s.replace(old, 'video = f"{bg};[1:v]format=rgba,colorchannelmixer=aa=0.6{fade}[txt];'))
PY
out="$(bash "$T/render/selfcheck.sh" "$T/out" 2>&1)"; rc=$?
n="$(grep -c "the words are not at full strength" <<< "$out")"
tail -3 <<< "$out" | cut -c1-200
if [ "$rc" != 0 ] && [ "$n" = 4 ]; then echo "ok   weak words are caught in all four sample reels"; echo PASS
else echo "FAIL weak words were not caught (exit $rc, $n of 4)"; exit 1; fi
