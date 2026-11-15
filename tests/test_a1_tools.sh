#!/usr/bin/env bash
# Tries the render-tools setup script in a small pretend world: a machine with no ffmpeg until a pretend
# "apt-get install" puts it there, and a pretend package list. Checks the quick way, the long way, what goes
# into the saved copy, and every way of falling back.
# (The real GitHub machine can't be reached from here; this proves the script's own logic.)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${STUDIO_OUT:-/tmp/studio-tests}"
SCRIPT="$ROOT/.github/actions/render-tools/tools.sh"
T="$OUT/toolstest"
fails=0
check() { if [ "$2" = "0" ]; then echo "ok   $1"; else echo "FAIL $1 ${3:-}"; fails=$((fails + 1)); fi; }

world() {   # a brand-new pretend machine (the saved-tools folder in $T/home survives, like GitHub's cache)
  rm -rf "$T/bin" "$T/fr" "$T/env" "$T/out" "$T/pkgs"; mkdir -p "$T/bin" "$T/fr/usr/bin" "$T/fr/etc/alternatives" "$T/fr/etc" "$T/home"
  for c in bash sh python3 tar find grep mktemp date rm mkdir mv du cut sleep id head cat ldconfig cp ln chmod wc dirname env sort comm uname sed touch; do ln -s "$(command -v $c)" "$T/bin/$c"; done
  printf 'base 1.0\nlibold:amd64 1.0\n' > "$T/pkgs"
  echo old > "$T/fr/usr/libold.so.1"
  cat > "$T/bin/apt-get" <<EOF
#!/bin/bash
if [ "\$1" = "install" ]; then
  [ -n "\${APT_FAILS:-}" ] && exit 100
  mkdir -p "$T/fr/usr/share/ffmpeg" "$T/fr/usr/lib"
  if [ -n "\${APT_BROKEN:-}" ]; then printf '#!/bin/bash\nexit 1\n' > "$T/fr/usr/bin/ffmpeg"; chmod +x "$T/fr/usr/bin/ffmpeg"; cp /usr/bin/ffprobe "$T/fr/usr/bin/"
  else cp /usr/bin/ffmpeg /usr/bin/ffprobe "$T/fr/usr/bin/"; fi
  echo preset > "$T/fr/usr/share/ffmpeg/preset.txt"            # a package's file outside the folders that are searched
  echo lib > "$T/fr/usr/lib/libfoo.so.1"
  echo new > "$T/fr/usr/libold.so.1"                            # a package that was there already, brought up to date
  ln -sf ffmpeg "$T/fr/usr/bin/ffmpeg-made-by-setup"            # links made during setup: in no package's list
  ln -sf ../../usr/lib/libfoo.so.1 "$T/fr/etc/alternatives/alt-link"
  echo changed > "$T/fr/etc/hosts-touched"                      # something else on the machine changed meanwhile
  [ -n "\${NO_PKGS:-}" ] || printf 'base 1.0\nffmpeg 7:8.0.1\nlibfoo1:amd64 1.2\nlibold:amd64 1.1\n' > "$T/pkgs"
  echo install >> "$T/apt.log"
fi
exit 0
EOF
  cat > "$T/bin/dpkg-query" <<EOF
#!/bin/bash
# pretend package manager: -W lists what is installed, -L lists the files of the packages named
if [ "\$1" = "-W" ]; then cat "$T/pkgs"; exit 0; fi
if [ "\$1" = "-L" ]; then shift
  for p in "\$@"; do case "\$p" in
    ffmpeg) printf '%s\n' "$T/fr/usr" "$T/fr/usr/bin" "$T/fr/usr/bin/ffmpeg" "$T/fr/usr/bin/ffprobe" "$T/fr/usr/share/ffmpeg" "$T/fr/usr/share/ffmpeg/preset.txt" "package diverts others to: $T/fr/usr/bin/other" ;;
    libfoo1:amd64) printf '%s\n' "$T/fr/usr/lib" "$T/fr/usr/lib/libfoo.so.1" "$T/fr/usr/lib/not-there.so" ;;
    libold:amd64) printf '%s\n' "$T/fr/usr/libold.so.1" ;;
    *) echo "dpkg-query: package '\$p' is not installed" >&2 ;;
  esac; echo; done
  exit 0
fi
exit 1
EOF
  cat > "$T/bin/fakepip" <<EOF
#!/bin/bash
# pretend pip: only "--target DIR" works, by copying the Pillow that is already on this machine
while [ \$# -gt 0 ]; do if [ "\$1" = "--target" ]; then mkdir -p "\$2" && cp -r "$(python3 -c 'import PIL,os;print(os.path.dirname(PIL.__file__))')" "$(python3 -c 'import PIL,os;print(os.path.dirname(os.path.dirname(PIL.__file__)))')/pillow.libs" "\$2/" && exit 0; fi; shift; done
exit 1
EOF
  chmod +x "$T/bin/apt-get" "$T/bin/fakepip" "$T/bin/dpkg-query"
}
run() {  # run the script inside the pretend world; extra settings as NAME=VALUE arguments
  env -i PATH="$T/bin:$T/fr/usr/bin" HOME="$T/home" RENDER_TOOLS_SCAN="${SCAN:-$T/fr/etc/alternatives $T/fr/usr/bin $T/fr/no-such-folder}" RENDER_TOOLS_PIP="$T/bin/fakepip" \
    GITHUB_ENV="$T/env" GITHUB_OUTPUT="$T/out" GITHUB_STEP_SUMMARY="$T/summary" "$@" bash "$SCRIPT" > "$T/log" 2>&1
}
installs() { [ -f "$T/apt.log" ] && wc -l < "$T/apt.log" || echo 0; }
out() { grep -c "^$1\$" "$T/out" 2>/dev/null || true; }
said() { [ "$(out "source=$1")" = 1 ] && [ "$(out "restored=$2")" = 1 ] && [ "$(out "save=$3")" = 1 ] && echo 0 || echo 1; }
COPY="$T/home/render-tools/apt-files.tar"
has() { tar -tf "$COPY" 2>/dev/null | grep -c -x "${T#/}/fr/$1" || true; }

rm -rf "$T"; mkdir -p "$T"

# 1. first run ever: the long way, and a copy is kept
world; run; rc=$?
check "first run: succeeds" "$rc" "$(tail -3 "$T/log")"
check "first run: installed the long way, and says the copy is worth saving" "$(said install no yes)" "$(cat "$T/out")"
check "first run: the copy has the programs" "$([ "$(has usr/bin/ffmpeg)" = 1 ] && [ "$(has usr/bin/ffprobe)" = 1 ] && echo 0 || echo 1)" "$(tar -tf "$COPY" 2>&1 | head -12)"
check "first run: the copy has a package's file from a folder that is never searched" "$([ "$(has usr/share/ffmpeg/preset.txt)" = 1 ] && [ "$(has usr/lib/libfoo.so.1)" = 1 ] && echo 0 || echo 1)"
check "first run: the copy has the file of a package that was brought up to date" "$([ "$(has usr/libold.so.1)" = 1 ] && echo 0 || echo 1)"
check "first run: the copy has the links made during setup" "$([ "$(has usr/bin/ffmpeg-made-by-setup)" = 1 ] && [ "$(has etc/alternatives/alt-link)" = 1 ] && echo 0 || echo 1)"
check "first run: nothing else that changed on the machine is in the copy" "$([ "$(has etc/hosts-touched)" = 0 ] && echo 0 || echo 1)"
check "first run: the copy holds files and links only, each once" "$([ "$(tar -tf "$COPY" | grep -c '/$')" = 0 ] && [ "$(tar -tf "$COPY" | sort | uniq -d | wc -l)" = 0 ] && [ "$(tar -tf "$COPY" | wc -l)" = 7 ] && echo 0 || echo 1)" "$(tar -tf "$COPY" | tr '\n' ' ')"
check "first run: Pillow is in the saved folder and on the path for later steps" "$([ -d "$T/home/render-tools/py/PIL" ] && grep -q "^PYTHONPATH=$T/home/render-tools/py" "$T/env" && echo 0 || echo 1)"
check "first run: no work files are left in the saved folder" "$([ "$(ls "$T/home/render-tools" | tr '\n' ' ')" = "apt-files.tar py " ] && echo 0 || echo 1)" "$(ls "$T/home/render-tools" | tr '\n' ' ')"
check "first run: a line for the run's summary page" "$(grep -q "^Render tools: ready from install" "$T/summary" && echo 0 || echo 1)" "$(cat "$T/summary" 2>&1)"

# 2. a new machine with the saved copy: the quick way, no install
world; run; rc=$?
check "second run: succeeds" "$rc" "$(tail -3 "$T/log")"
check "second run: unpacked the copy, installed nothing, saves nothing again" "$([ "$(said cache yes no)" = 0 ] && [ "$(installs)" = 1 ] && echo 0 || echo 1)" "$(cat "$T/out") installs=$(installs)"
check "second run: ffmpeg really runs from the unpacked copy" "$("$T/fr/usr/bin/ffmpeg" -version >/dev/null 2>&1 && [ -L "$T/fr/usr/bin/ffmpeg-made-by-setup" ] && echo 0 || echo 1)"
check "second run: everything in the copy is back in place" "$([ -L "$T/fr/etc/alternatives/alt-link" ] && [ "$(cat "$T/fr/usr/share/ffmpeg/preset.txt")" = preset ] && [ "$(cat "$T/fr/usr/libold.so.1")" = new ] && echo 0 || echo 1)"
check "second run: Pillow is on the path again" "$(grep -q "^PYTHONPATH=$T/home/render-tools/py" "$T/env" && echo 0 || echo 1)"

# 3. the saved copy is damaged: falls back to the long way and keeps a good copy again
world; head -c 2000 "$COPY" > "$T/cut" && mv "$T/cut" "$COPY"; run; rc=$?
check "damaged copy: still succeeds, by installing, and offers a fresh copy" "$([ "$rc" = 0 ] && [ "$(said install yes yes)" = 0 ] && [ "$(installs)" = 2 ] && echo 0 || echo 1)" "$(cat "$T/out")"
check "damaged copy: a good copy is kept again" "$([ "$(has usr/bin/ffmpeg)" = 1 ] && echo 0 || echo 1)"

# 4. the saved copy unpacks but its ffmpeg doesn't work on this machine: long way
world; printf '#!/bin/bash\nexit 1\n' > "$T/fr/usr/bin/ffmpeg"; chmod +x "$T/fr/usr/bin/ffmpeg"
( cd / && tar -cf "$COPY" "${T#/}/fr/usr/bin/ffmpeg" 2>/dev/null ); rm -f "$T/fr/usr/bin/ffmpeg"; run; rc=$?
check "copy that doesn't work here: still succeeds, by installing" "$([ "$rc" = 0 ] && [ "$(said install yes yes)" = 0 ] && [ "$(installs)" = 3 ] && "$T/fr/usr/bin/ffmpeg" -version >/dev/null 2>&1 && echo 0 || echo 1)" "$(cat "$T/out")"

# 5. nothing can be kept (the install's files can't be found): the run still succeeds, just without a copy
world; rm -rf "$T/home/render-tools"; mkdir -p "$T/empty"; SCAN="$T/empty" run NO_PKGS=1; rc=$?
check "copy can't be made: the run still succeeds, and nothing is offered for saving" "$([ "$rc" = 0 ] && [ "$(said install no no)" = 0 ] && [ ! -e "$COPY" ] && [ ! -e "$COPY.part" ] && echo 0 || echo 1)" "$(tail -2 "$T/log")"

# 6. the package list is of no help (no package manager answers), but the searched folders are: a copy is still kept
world; rm -rf "$T/home/render-tools"; rm "$T/bin/dpkg-query"; run; rc=$?
check "no package list: the programs found by searching are still kept" "$([ "$rc" = 0 ] && [ "$(said install no yes)" = 0 ] && [ "$(has usr/bin/ffmpeg)" = 1 ] && [ "$(has usr/bin/ffmpeg-made-by-setup)" = 1 ] && echo 0 || echo 1)" "$(cat "$T/out"; tail -2 "$T/log")"

# 7. the install "succeeds" but its ffmpeg doesn't work: the run carries on, and no copy of broken tools is passed on
world; rm -rf "$T/home/render-tools"; run APT_BROKEN=1; rc=$?
check "broken install: carries on with a warning, and keeps no copy" "$([ "$rc" = 0 ] && [ "$(said install no no)" = 0 ] && [ ! -e "$COPY" ] && grep -q "did not pass" "$T/log" && echo 0 || echo 1)" "$(cat "$T/out"; tail -2 "$T/log")"

# 8. the install itself fails and there is no copy: the step fails clearly (as it would have before)
world; rm -rf "$T/home/render-tools"; run APT_FAILS=1; rc=$?
check "install impossible: fails with a clear line" "$([ "$rc" != 0 ] && grep -q "could not be installed" "$T/log" && echo 0 || echo 1)" "rc=$rc $(tail -1 "$T/log")"

echo "--- last log:"; tail -3 "$T/log"
if [ "$fails" = 0 ]; then echo PASS; else echo "FAIL ($fails)"; exit 1; fi
