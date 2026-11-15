#!/bin/bash
# Gets everything ready that the tests need besides the code: the sample media, and two pieces of the code
# as it once was (taken from the repo's own history) for the tests that compare then with now.
#   usage: tests/prepare.sh        (quick when everything is already there)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${STUDIO_OUT:-/tmp/studio-tests}"; media="${STUDIO_MEDIA:-$out/media}"
mkdir -p "$out/shots" "$out/work"
[ -s "$media/steps.mp3" ] && [ -s "$media/big.mp4" ] && [ -s "$media/book.txt" ] || bash "$root/tests/make_media.sh" "$media"
# The code before the scorer, the health record and the new look existed (commit d576d40): two tests prove
# that what did not have to change (the pictures the app exports, the day's quotes) did not change.
if [ ! -s "$out/base/server/worker.js" ]; then
  if git -C "$root" cat-file -e d576d40^{commit} 2>/dev/null; then
    rm -rf "$out/base"; mkdir -p "$out/base"; git -C "$root" archive d576d40 | tar -x -C "$out/base"
  else echo "note: commit d576d40 is not in this copy's history (a shallow clone?); the three then-and-now tests will fail"; fi
fi
# The scorer as first built (commit 4d6c348), for the test that plays out a made-up year with both.
if [ ! -s "$out/scorer_at_4d6c348.js" ]; then
  git -C "$root" show 4d6c348:server/scorer.js > "$out/scorer_at_4d6c348.js" 2>/dev/null || { rm -f "$out/scorer_at_4d6c348.js"; echo "note: commit 4d6c348 is not in this copy's history; test_a4_loop.mjs will fail"; }
fi
echo "ready: media in $media, output in $out"
