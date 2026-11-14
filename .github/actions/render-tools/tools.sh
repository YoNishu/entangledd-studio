#!/usr/bin/env bash
# Gets ffmpeg and Pillow ready for the reel renderer.
#
#   Quick way: unpack the copy an earlier run saved in ~/render-tools (a few seconds).
#   Long way (what every run did until now): apt-get install ffmpeg, pip install pillow (about 45 seconds),
#     then save every file that install put on the machine, so the next run can take the quick way.
#
# If the quick way fails for any reason at all, the long way is used. The saved copy is the same files apt
# installs, so the renderer's ffmpeg is the same program either way and the reel comes out the same.
set -uo pipefail

TOOLS="${RENDER_TOOLS_DIR:-$HOME/render-tools}"
SNAP="$TOOLS/apt-files.tar"
PY="$TOOLS/py"
SCAN="${RENDER_TOOLS_SCAN:-/usr /etc}"            # where an install puts files (tests point this elsewhere)
PIP="${RENDER_TOOLS_PIP:-python3 -m pip}"
SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
started=$(date +%s)
say() { echo "render-tools: $*"; }

# True when ffmpeg can make the kind of file the renderer makes, ffprobe can read it back, and Pillow loads.
works() {
  local tmp ok=1
  tmp="$(mktemp -d)"
  if ffmpeg -hide_banner -loglevel error -f lavfi -i "testsrc2=s=320x568:r=30:d=0.4" \
        -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" -t 0.4 -vf "scale=180:320,format=yuv420p" \
        -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -y "$tmp/t.mp4" >/dev/null 2>&1 \
     && [ "$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$tmp/t.mp4" 2>/dev/null)" = "h264" ] \
     && PYTHONPATH="$PY${PYTHONPATH:+:$PYTHONPATH}" python3 -c "from PIL import Image, ImageDraw, ImageFilter, ImageFont" >/dev/null 2>&1; then
    ok=0
  fi
  rm -rf "$tmp"
  return $ok
}

# The long way, as it has always been done, followed by saving a copy of what it installed.
install_afresh() {
  rm -rf "$TOOLS"; mkdir -p "$TOOLS"
  local marker; marker="$(mktemp)"; sleep 1
  $SUDO apt-get update -qq || say "apt-get update had trouble; trying the install anyway"
  $SUDO apt-get install -y -qq ffmpeg || return 1
  # Pillow goes into the saved folder so it travels with the copy; if that is refused, install it the old way.
  $PIP install --quiet --target "$PY" pillow || $PIP install --quiet pillow || return 1

  # Save every file the install put on (or changed on) the machine. Looking at what changed, rather than asking
  # the package manager, also catches links that packages create while setting themselves up.
  local list="$TOOLS/files.list"
  # shellcheck disable=SC2086
  if find $SCAN -xdev \( -type f -o -type l \) -cnewer "$marker" ! -name ld.so.cache -print0 > "$list" 2>/dev/null \
     && grep -qz '/bin/ffmpeg$' "$list" \
     && $SUDO tar --null -T "$list" -cf - 2>/dev/null > "$SNAP.part" \
     && [ -s "$SNAP.part" ]; then
    mv "$SNAP.part" "$SNAP"
    say "saved a copy for next time ($(du -sh "$TOOLS" 2>/dev/null | cut -f1))"
  else
    rm -f "$SNAP" "$SNAP.part"
    say "couldn't save a copy for next time; the next run will install again"
  fi
  rm -f "$list" "$marker"
  return 0
}

source="install"; restored="no"
if [ -s "$SNAP" ]; then
  restored="yes"
  if $SUDO tar -xf "$SNAP" -C / >/dev/null 2>&1 && { $SUDO ldconfig >/dev/null 2>&1 || true; } && works; then
    source="cache"
  else
    say "the saved copy didn't work on this machine; installing afresh"
  fi
fi
if [ "$source" != "cache" ]; then
  if ! install_afresh; then say "ffmpeg or Pillow could not be installed"; exit 1; fi
  works || say "warning: the quick self-test did not pass after a fresh install (continuing; the render will tell)"
fi

if [ -d "$PY" ] && [ -n "${GITHUB_ENV:-}" ]; then echo "PYTHONPATH=$PY${PYTHONPATH:+:$PYTHONPATH}" >> "$GITHUB_ENV"; fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then { echo "source=$source"; echo "restored=$restored"; } >> "$GITHUB_OUTPUT"; fi
filters="$(ffmpeg -hide_banner -filters 2>/dev/null || true)"
hdr="yes"; { echo "$filters" | grep -q " zscale " && echo "$filters" | grep -q " tonemap "; } || hdr="NO"
say "ready from $source in $(( $(date +%s) - started )) s | $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3) | HDR filters: $hdr"
exit 0
