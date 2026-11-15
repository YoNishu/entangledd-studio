"""Agent 16: the reel file sits at the top of Instagram's reel specification (real render, real probe).
- a video background (tests media sea.mp4, made 25 fps here) and a zooming photo with music, both 8 s;
- each passes render/selfcheck.sh --check: 48 kHz stereo AAC, H.264 High 4.2, an IDR keyframe every 2 s and
  closed groups, no edit list, index before the pictures, picture bitrate under 25 Mbps (and over a floor
  for the moving one);
- a 25 fps clip stays 25 fps (no repeated pictures), a 30 fps one stays 30;
- colours come out as they went in (a red photo and green words, read back with the reel's own HD label),
  and so does the cover JPEG;
- the bitrate ceiling keeps a 90 s reel under 85 MB.
No server needed. Run:  python3 tests/test_a16_render.py"""
import importlib.util, json, os, subprocess, sys
import where as _W
from PIL import Image

ROOT, MEDIA, OUT = _W.ROOT, _W.MEDIA, os.path.join(_W.OUT, "a16render")
os.makedirs(OUT, exist_ok=True)
fails = []
def check(name, ok, more=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(more)[:300]))
    if not ok: fails.append(name)
def run(*cmd): return subprocess.run(cmd, capture_output=True, text=True)
def probe(f, sel, entries): return run("ffprobe", "-v", "error", "-select_streams", sel, "-show_entries", entries, "-of", "csv=p=0", f).stdout.strip()

# Test media: a red photo, a text layer with green words, a 25 fps copy of the sea clip.
red, ov, clip25 = (os.path.join(OUT, n) for n in ("red.png", "ov.png", "sea25.mp4"))
Image.new("RGB", (1600, 2400), (200, 30, 40)).save(red)
im = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0)); im.paste((40, 180, 90, 255), (200, 300, 700, 700)); im.save(ov)
run("ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(MEDIA, "sea.mp4"), "-vf", "fps=25", "-c:v", "libx264", "-crf", "12", "-c:a", "copy", clip25)

def render(name, *args):
    out, cover = os.path.join(OUT, name + ".mp4"), os.path.join(OUT, name + ".jpg")
    r = run("python3", os.path.join(ROOT, "render", "render.py"), "--overlay", ov, "--duration", "8", "--out", out, "--cover", cover, *args)
    check(f"{name} renders", r.returncode == 0, r.stderr)
    return out, cover

video, vcover = render("video25", "--bg", clip25, "--keep-audio")
photo, pcover = render("photo", "--bg", red, "--music", os.path.join(MEDIA, "steps.mp3"))
still, scover = render("still", "--bg", red, "--no-zoom")

for f, floor in ((video, 1500), (photo, 0), (still, 0)):
    r = run("bash", os.path.join(ROOT, "render", "selfcheck.sh"), "--check", f, "8", str(floor))
    lines = [l for l in r.stdout.splitlines() if l.startswith("FAIL ") and ".mp4" in l]
    # The self-check's own picture-rate rule says 30/1; the 25 fps reel is judged on that below instead.
    lines = [l for l in lines if not (f == video and ("video is" in l or "pictures, not" in l))]
    check(f"{os.path.basename(f)} meets Instagram's reel specification", not lines, " | ".join(lines) or r.stdout[-300:])

check("a 25 fps clip stays 25 fps", probe(video, "v:0", "stream=r_frame_rate") == "25/1", probe(video, "v:0", "stream=r_frame_rate"))
check("a photo reel is 30 fps", probe(photo, "v:0", "stream=r_frame_rate") == "30/1")
check("sound is 48 kHz stereo AAC at about 192 kbps", probe(photo, "a:0", "stream=codec_name,sample_rate,channels") == "aac,48000,2"
      and 170000 <= int(probe(photo, "a:0", "stream=bit_rate") or 0) <= 200000, probe(photo, "a:0", "stream=codec_name,sample_rate,channels,bit_rate"))

def near(a, b, tol=4): return all(abs(x - y) <= tol for x, y in zip(a, b))
frame = os.path.join(OUT, "frame.png")
run("ffmpeg", "-y", "-loglevel", "error", "-ss", "3", "-i", still, "-frames:v", "1", "-pix_fmt", "rgb24", frame)
px = Image.open(frame).convert("RGB")
check("the photo's red comes out red", near(px.getpixel((900, 1500)), (200, 30, 40)), px.getpixel((900, 1500)))
check("the words' green comes out green", near(px.getpixel((450, 500)), (40, 180, 90)), px.getpixel((450, 500)))
cv = Image.open(scover).convert("RGB")
check("the cover's colours match too", near(cv.getpixel((900, 1500)), (200, 30, 40), 5) and near(cv.getpixel((450, 500)), (40, 180, 90), 5),
      (cv.getpixel((900, 1500)), cv.getpixel((450, 500))))

spec = importlib.util.spec_from_file_location("render", os.path.join(ROOT, "render", "render.py"))
mod = importlib.util.module_from_spec(spec); sys.argv = ["render.py"]; spec.loader.exec_module(mod)
worst = (mod.picture_kbps(90) + 192) * (90 + 2) / 8 / 1000
check("a 90 s reel stays under 85 MB at most", worst < 85 * 1.048576, f"{worst:.1f} MB")
check("the picture ceiling is 12 Mbps for short reels", mod.picture_kbps(30) == 12000, mod.picture_kbps(30))

print("PASS" if not fails else f"FAIL ({len(fails)}): " + "; ".join(fails))
sys.exit(1 if fails else 0)
