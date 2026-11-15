#!/bin/bash
# Makes the sample media the tests use, with ffmpeg and plain text, so no media file lives in the repo.
#   usage: tests/make_media.sh [folder]      (default: $STUDIO_MEDIA, else $STUDIO_OUT/media, else /tmp/studio-tests/media)
# Needs ffmpeg (with libx264, aac and libmp3lame) and python3. Everything here is made up: test cards, plain
# tones and invented sentences. Each sound has its own pitch, so a test can tell which one ended up in a reel.
set -euo pipefail
dir="${1:-${STUDIO_MEDIA:-${STUDIO_OUT:-/tmp/studio-tests}/media}}"
mkdir -p "$dir"; cd "$dir"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
tone() { echo "sine=f=$1:d=$2:r=44100"; }
video="-c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 30"; sound="-c:a aac -b:a 96k -ac 1"

# Pictures: a tall sky-blue one and a very bright one (to see that text stays readable on both).
ff -f lavfi -i "gradients=s=1200x1600:c0=0xa9d6f5:c1=0x1d4e89:x0=0:y0=0:x1=400:y1=1600:d=1" -frames:v 1 -q:v 3 sky.jpg
ff -f lavfi -i "gradients=s=900x1600:c0=0xffffff:c1=0xf3efe2:x0=0:y0=0:x1=0:y1=1600:d=1" -frames:v 1 -q:v 3 bright.jpg

# Videos: a phone-shaped clip with sound (220 Hz), a small clip with sound (700 Hz), a small silent one,
# and a large one (over 16 MB, so it is uploaded in several parts).
ff -f lavfi -i "testsrc2=s=720x1280:r=30:d=6" -f lavfi -i "$(tone 220 6)" $video $sound -shortest -movflags +faststart sea.mp4
ff -f lavfi -i "testsrc2=s=320x240:r=25:d=12" -f lavfi -i "$(tone 700 12)" $video $sound -shortest songclip.mp4
ff -f lavfi -i "testsrc2=s=320x240:r=25:d=3" $video -an silent.mp4
ff -f lavfi -i "testsrc2=s=1080x1920:r=30:d=7,noise=alls=40:allf=t+u" -f lavfi -i "$(tone 220 7)" -c:v libx264 -pix_fmt yuv420p -preset ultrafast \
   -b:v 25M -minrate 25M -maxrate 25M -bufsize 25M $sound -shortest big.mp4

# Sound: one steady tone (500 Hz), and a track that steps up every ten seconds (300, 600, 1200 Hz), so a test
# can hear where in the track a reel's music was taken from.
ff -f lavfi -i "$(tone 500 20)" $sound tone.m4a
ff -f lavfi -i "$(tone 300 10)" -f lavfi -i "$(tone 600 10)" -f lavfi -i "$(tone 1200 10)" -filter_complex "[0][1][2]concat=n=3:v=0:a=1" -c:a libmp3lame -b:a 128k -ac 1 steps.mp3

# Text: a pretend book in the shape Project Gutenberg sends one, and a pretend Kindle highlights file.
python3 - <<'PY'
LINES = ["The lake at dusk repeats the sky without adding a word of its own.",
  "I have found that a small room, well swept, holds a large enough life.",
  "We carry more than we need, and call the weight a kind of safety.",
  "Seasons do not hurry, and nothing in them is left undone.",
  "Simplicity is not a thing we add; it is what remains when we stop adding.",
  "The morning asks nothing of us except that we notice it has come.",
  "The man who counts his hours carefully often spends them poorly.",
  "What we call solitude is often only our own attention, finally come home.",
  "A pond keeps its own counsel, and the patient learn more from it than the hurried.",
  "He who must be busy has not yet learned what he is busy for.",
  "There is a quiet in plain work that no holiday has ever matched.",
  "To walk slowly through a wood is to be told, kindly, how little is urgent."]
seed = 7
def nxt(n):                                   # a small fixed shuffle, the same on every machine
    global seed
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
out = ["The Project Gutenberg eBook of Walden", "", "This ebook is for the use of anyone anywhere.", "",
       "*** START OF THE PROJECT GUTENBERG EBOOK WALDEN ***"]
for chapter in range(1, 7):
    out += ["", f"CHAPTER {chapter}", ""]
    for _ in range(10):
        picked = []
        while len(picked) < 3 + nxt(3):
            line = LINES[nxt(len(LINES))]
            if line not in picked: picked.append(line)
        out += [" ".join(picked), ""]
out += ["*** END OF THE PROJECT GUTENBERG EBOOK WALDEN ***", "", "Licence text that must never be quoted from, which goes on for a while."]
open("book.txt", "w").write("\n".join(out) + "\n")

CLIPS = [("Walden (Thoreau, Henry David)", "- Your Highlight on page 12 | Location 150-151 | Added on Monday, 2 November 2026 21:10:11", LINES[5]),
  ("Walden (Thoreau, Henry David)", "- Your Bookmark on page 14 | Location 180 | Added on Monday, 2 November 2026 21:12:00", ""),
  ("The Little Book of Stillness (Asha Rao)", "- Your Highlight on page 3 | Location 31-33 | Added on Tuesday, 3 November 2026 07:40:02",
   "Quiet is not the absence of sound but the presence of attention."),
  ("The Little Book of Stillness (Asha Rao)", "- Your Note on page 3 | Location 33 | Added on Tuesday, 3 November 2026 07:41:00", "use this one for sunday"),
  ("Walden (Thoreau, Henry David)", "- Your Highlight on page 40 | Location 600-601 | Added on Wednesday, 4 November 2026 08:00:00", LINES[5])]
open("clippings.txt", "w").write("".join(f"{book}\n{meta}\n\n{text}\n==========\n" for book, meta, text in CLIPS))
PY
echo "sample media in $dir: $(ls | tr '\n' ' ')"
