#!/usr/bin/env bash
# Gets ffmpeg and Pillow ready for the reel renderer.
#
#   Quick way: unpack the copy an earlier run saved in ~/render-tools (a few seconds).
#   Long way (what every run did until now): apt-get install ffmpeg, pip install pillow (20 to 45 seconds),
#     then put a copy of what that install added to the machine in ~/render-tools, for the next run.
#
# If the quick way fails for any reason at all, the long way is used. The saved copy is the very files apt
# installs on this same machine image, so the renderer's ffmpeg is the same program either way and the reel
# comes out the same.
set -uo pipefail

TOOLS="${RENDER_TOOLS_DIR:-$HOME/render-tools}"
SNAP="$TOOLS/apt-files.tar"
PY="$TOOLS/py"
# Folders where packages make links while they set themselves up (links their own file lists don't mention).
SCAN="${RENDER_TOOLS_SCAN:-/etc/alternatives /usr/bin /usr/sbin /usr/lib/$(uname -m)-linux-gnu}"
PIP="${RENDER_TOOLS_PIP:-python3 -m pip}"
SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
started=$(date +%s)
say() { echo "render-tools: $*"; }

# Every filter render.py asks ffmpeg for (zscale and tonemap are the two that keep iPhone HDR clips from
# looking washed-out).
NEED_FILTERS="scale crop fps setsar format eq zoompan loop fade overlay zscale tonemap aresample aformat volume atrim afade amix anullsrc"
has_filters() {
  local names f
  names="$(ffmpeg -hide_banner -filters 2>/dev/null | sed -n 's/^ [^ ]* \([^ ]*\) .*/\1/p')" || return 1   # the name column only
  for f in $NEED_FILTERS; do grep -qx "$f" <<< "$names" || return 1; done
}

# True when ffmpeg can make the kind of file the renderer makes, has every filter the renderer uses, ffprobe
# can read the file back, and Pillow loads.
works() {
  local tmp ok=1
  tmp="$(mktemp -d)"
  if ffmpeg -hide_banner -loglevel error -f lavfi -i "testsrc2=s=320x568:r=30:d=0.4" \
        -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" -t 0.4 -vf "scale=180:320,format=yuv420p" \
        -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -y "$tmp/t.mp4" >/dev/null 2>&1 \
     && [ "$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$tmp/t.mp4" 2>/dev/null)" = "h264" ] \
     && has_filters \
     && PYTHONPATH="$PY${PYTHONPATH:+:$PYTHONPATH}" python3 -c "from PIL import Image, ImageDraw, ImageFilter, ImageFont" >/dev/null 2>&1; then
    ok=0
  fi
  rm -rf "$tmp"
  return $ok
}

# Every package on the machine with its version, one per line.
packages() { dpkg-query -W -f='${binary:Package} ${Version}\n' 2>/dev/null | LC_ALL=C sort; }

# Puts a copy of everything the install added into $SNAP: every file of every package that is new or newer than
# before, plus the links made in the library and program folders while those packages set themselves up.
save_copy() {  # save_copy MARKER PACKAGES_BEFORE
  local list="$TOOLS/files.list" new status
  new="$(packages | LC_ALL=C comm -13 "$2" - | cut -d' ' -f1)"
  {
    if [ -n "$new" ]; then
      # shellcheck disable=SC2086
      dpkg-query -L $new 2>/dev/null | while IFS= read -r f; do
        if [ -L "$f" ] || [ -f "$f" ]; then printf '%s\0' "$f"; fi     # files and links only, never folders
      done
    fi
    # shellcheck disable=SC2086
    $SUDO find $SCAN -xdev \( -type f -o -type l \) -cnewer "$1" ! -name ld.so.cache -print0 2>/dev/null
  } | LC_ALL=C sort -zu > "$list"
  grep -qz '/bin/ffmpeg$' "$list" || { rm -f "$list"; return 1; }
  $SUDO tar --null --no-recursion -T "$list" -cf - 2>/dev/null > "$SNAP.part"
  status=$?                                  # 1 only means a file changed while it was being read
  rm -f "$list"
  # The copy must read back whole and have ffmpeg in it. (No pipe into "grep -q" here: it would stop reading
  # early and make a good copy look broken.)
  local names
  if [ "$status" -le 1 ] && names="$(tar -tf "$SNAP.part" 2>/dev/null)" && grep -q 'bin/ffmpeg$' <<< "$names"; then
    mv "$SNAP.part" "$SNAP"
    return 0
  fi
  rm -f "$SNAP" "$SNAP.part"
  return 1
}

# The long way, as it has always been done, followed by keeping a copy of what it installed.
install_afresh() {
  rm -rf "$TOOLS"; mkdir -p "$TOOLS"
  local marker before
  marker="$(mktemp)"; before="$(mktemp)"; packages > "$before"; sleep 1
  $SUDO apt-get update -qq || say "apt-get update had trouble; trying the install anyway"
  $SUDO apt-get install -y -qq ffmpeg || return 1
  # Pillow goes into the saved folder so it travels with the copy; if that is refused, install it the old way.
  $PIP install --quiet --target "$PY" pillow || $PIP install --quiet pillow || return 1
  if save_copy "$marker" "$before"; then
    say "kept a copy for next time ($(du -sh "$TOOLS" 2>/dev/null | cut -f1))"
  else
    say "couldn't keep a copy for next time; the next run will install again"
  fi
  rm -f "$marker" "$before"
  return 0
}

source="install"; restored="no"; save="no"
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
  if works; then
    if [ -s "$SNAP" ]; then save="yes"; fi   # only a copy of tools that work is worth passing on
  else
    rm -f "$SNAP"
    say "warning: the quick self-test did not pass after a fresh install (continuing; the render will tell)"
  fi
fi

if [ -d "$PY" ] && [ -n "${GITHUB_ENV:-}" ]; then echo "PYTHONPATH=$PY${PYTHONPATH:+:$PYTHONPATH}" >> "$GITHUB_ENV"; fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then { echo "source=$source"; echo "restored=$restored"; echo "save=$save"; } >> "$GITHUB_OUTPUT"; fi
filters="$(ffmpeg -hide_banner -filters 2>/dev/null || true)"
hdr="yes"; { grep -q " zscale " <<< "$filters" && grep -q " tonemap " <<< "$filters"; } || hdr="NO"
line="ready from $source in $(( $(date +%s) - started )) s | $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3) | HDR filters: $hdr"
say "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "Render tools: $line" >> "$GITHUB_STEP_SUMMARY"; fi
exit 0
