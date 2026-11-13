#!/usr/bin/env bash
# Renders one reel job from the app: fetch the background and text layer, render, send the reel back.
# Needs: JOB_ID, APP_URL, RENDER_SECRET in the environment.
set -euo pipefail

[[ "${JOB_ID:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "Bad JOB_ID"; exit 1; }
[[ "${APP_URL:-}" =~ ^https://[A-Za-z0-9.-]+$ || "${APP_URL:-}" =~ ^http://localhost:[0-9]+$ ]] || { echo "Bad APP_URL"; exit 1; }
[[ -n "${RENDER_SECRET:-}" ]] || { echo "RENDER_SECRET is not set"; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
api="$APP_URL/api/render/$JOB_ID"
auth=(-H "Authorization: Bearer $RENDER_SECRET")
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

report_failure() {
  local body
  body="$(python3 -c 'import json,sys; print(json.dumps({"state": "failed", "error": sys.argv[1]}))' "$1")"
  curl -sS -X POST "${auth[@]}" -H "Content-Type: application/json" -d "$body" "$api/status" >/dev/null || true
}
trap 'report_failure "The reel could not be put together. Try again, or try a different video."' ERR

curl -fsS "${auth[@]}" "$api/job" -o "$work/job.json"
read -r ext length keep fade < <(python3 - "$work/job.json" <<'PY'
import json, re, sys
j = json.load(open(sys.argv[1]))
ext = j["bgExt"] if re.fullmatch(r"[a-z0-9]{2,5}", j["bgExt"]) else "mp4"
print(ext, float(j["length"]), int(bool(j["keepAudio"])), int(bool(j["fade"])))
PY
)

curl -fsS "${auth[@]}" "$api/bg" -o "$work/bg.$ext"
curl -fsS "${auth[@]}" "$api/overlay" -o "$work/overlay.png"

args=(--overlay "$work/overlay.png" --bg "$work/bg.$ext" --duration "$length" --out "$work/reel.mp4")
[[ "$keep" == "1" ]] && args+=(--keep-audio)
[[ "$fade" == "1" ]] && args+=(--fade)
python3 "$here/render.py" "${args[@]}"

curl -fsS -X PUT "${auth[@]}" -H "Content-Type: video/mp4" --data-binary "@$work/reel.mp4" "$api/reel" >/dev/null
echo "Reel sent back for job $JOB_ID"
