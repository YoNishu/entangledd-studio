#!/usr/bin/env python3
"""Entangledd Studio reel renderer.

Turns a quote into a 1080x1920 Instagram reel (MP4, H.264 + AAC).

    python3 render/render.py --quote "..." --author "..." --out out/reel.mp4
    python3 render/render.py --quote "..." --bg backgrounds/sea.jpg --music music/calm.mp3
    python3 render/render.py --overlay text.png --bg clip.mov --keep-audio

With --overlay the text layer comes from the app (a transparent PNG), so the reel matches the
app's preview exactly. Without it, the quote is laid out here in a simple centred style.

Needs: Python 3.9+, Pillow, ffmpeg on PATH.
"""
import argparse
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
FPS = 30
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_REGULAR = os.path.join(HERE, "fonts", "Lora-Variable.ttf")
FONT_ITALIC = os.path.join(HERE, "fonts", "Lora-Italic-Variable.ttf")

# Text stays inside this box so Instagram's own buttons and caption never cover it.
SAFE_X = 110
SAFE_TOP = 420
SAFE_BOTTOM = 1420

PALETTES = {
    "midnight": ((16, 18, 38), (58, 36, 92)),
    "dusk": ((38, 20, 46), (150, 72, 84)),
    "forest": ((10, 30, 28), (38, 86, 72)),
    "ink": ((12, 12, 14), (46, 46, 54)),
    "sand": ((70, 52, 40), (168, 130, 96)),
}


def font(path, size, weight=None):
    f = ImageFont.truetype(path, size)
    if weight:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


def wrap(draw, text, fnt, max_width):
    """Wrap text to max_width in pixels. Keeps the writer's own line breaks."""
    lines = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            lines.append("")
            continue
        line = words[0]
        for word in words[1:]:
            trial = line + " " + word
            if draw.textlength(trial, font=fnt) <= max_width:
                line = trial
            else:
                lines.append(line)
                line = word
        lines.append(line)
    return lines


def fit_quote(draw, quote, max_width, max_height):
    """Largest font size at which the wrapped quote fits the safe box."""
    for size in range(92, 35, -2):
        fnt = font(FONT_REGULAR, size, 500)
        lines = wrap(draw, quote, fnt, max_width)
        line_h = int(size * 1.42)
        widest = max(draw.textlength(l, font=fnt) for l in lines)
        if len(lines) * line_h <= max_height and widest <= max_width:
            return fnt, lines, line_h
    raise SystemExit(
        "Quote is too long to fit on one reel (the limit is roughly 800 characters). "
        "Shorten it or split it into two reels."
    )


VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm", ".mkv")


def is_video(path):
    return bool(path) and path.lower().endswith(VIDEO_EXT)


def has_audio(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    return bool(out.stdout.strip())


def make_background(bg_path, palette, dim):
    """Returns a 1080x1920 RGB image: the photo cover-cropped, or a gradient."""
    if bg_path:
        img = Image.open(bg_path).convert("RGB")
        scale = max(W / img.width, H / img.height)
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
        left, top = (img.width - W) // 2, (img.height - H) // 2
        img = img.crop((left, top, left + W, top + H))
        if dim > 0:
            img = Image.blend(img, Image.new("RGB", (W, H), (0, 0, 0)), dim)
        return img
    top_c, bottom_c = PALETTES[palette]
    grad = Image.new("RGB", (1, H))
    for y in range(H):
        t = y / (H - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top_c, bottom_c)))
    return grad.resize((W, H))


def make_text_layer(quote, author, handle):
    """Transparent 1080x1920 layer with the quote, author and handle."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    max_w = W - 2 * SAFE_X

    author_fnt = font(FONT_ITALIC, 44, 400)
    author_block = 110 if author else 0
    fnt, lines, line_h = fit_quote(draw, quote, max_w, SAFE_BOTTOM - SAFE_TOP - author_block)

    block_h = len(lines) * line_h + author_block
    y = SAFE_TOP + (SAFE_BOTTOM - SAFE_TOP - block_h) // 2

    # Soft shadow under the text, drawn on its own layer and blurred.
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    yy = y
    for line in lines:
        x = (W - draw.textlength(line, font=fnt)) / 2
        sdraw.text((x + 2, yy + 4), line, font=fnt, fill=(0, 0, 0, 170))
        yy += line_h
    layer = Image.alpha_composite(layer, shadow.filter(ImageFilter.GaussianBlur(8)))
    draw = ImageDraw.Draw(layer)

    for line in lines:
        x = (W - draw.textlength(line, font=fnt)) / 2
        draw.text((x, y), line, font=fnt, fill=(255, 255, 255, 255))
        y += line_h

    if author:
        y += 34
        draw.line([(W / 2 - 40, y), (W / 2 + 40, y)], fill=(255, 255, 255, 150), width=2)
        y += 26
        text = "— " + author
        x = (W - draw.textlength(text, font=author_fnt)) / 2
        draw.text((x, y), text, font=author_fnt, fill=(255, 255, 255, 215))

    if handle:
        handle_fnt = font(FONT_REGULAR, 32, 400)
        x = (W - draw.textlength(handle, font=handle_fnt)) / 2
        draw.text((x, 1560), handle, font=handle_fnt, fill=(255, 255, 255, 130))
    return layer


def render(args):
    dur = args.duration
    frames = int(dur * FPS)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    video_bg = is_video(args.bg)

    with tempfile.TemporaryDirectory() as tmp:
        text_png = os.path.join(tmp, "text.png")
        if args.overlay:
            # Text layer made in the app: already laid out, so it is used exactly as drawn.
            layer = Image.open(args.overlay).convert("RGBA")
            if layer.size != (W, H):
                layer = layer.resize((W, H), Image.LANCZOS)
        else:
            layer = make_text_layer(args.quote, args.author, args.handle)
        layer.save(text_png)

        cmd = ["ffmpeg", "-y", "-loglevel", "error"]
        if video_bg:
            cmd += ["-stream_loop", "-1", "-i", args.bg]
            dim = f",eq=brightness={-args.dim / 2:.3f}" if args.dim > 0 else ""
            bg = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                  f"fps={FPS},setsar=1{dim}[bg]")
        else:
            bg_png = os.path.join(tmp, "bg.png")
            make_background(args.bg, args.palette, args.dim).save(bg_png)
            cmd += ["-i", bg_png]
            if args.zoom:
                # Upscaled first so the slow zoom is smooth, not jittery.
                bg = (f"[0:v]scale={W * 2}:{H * 2},"
                      f"zoompan=z='1+0.07*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                      f":d={frames}:s={W}x{H}:fps={FPS}[bg]")
            else:
                bg = f"[0:v]loop=loop={frames}:size=1:start=0,fps={FPS},setsar=1[bg]"
        cmd += ["-loop", "1", "-i", text_png]
        fade = ",fade=t=in:st=0.3:d=1.2:alpha=1" if args.fade else ""
        video = f"{bg};[1:v]format=rgba{fade}[txt];[bg][txt]overlay=0:0,format=yuv420p[v]"

        # Audio: the clip's own sound, the music, both mixed, or silence.
        sources = []
        if video_bg and args.keep_audio and has_audio(args.bg):
            sources.append("[0:a]")
        idx = 2
        if args.music:
            cmd += ["-stream_loop", "-1", "-i", args.music]
            sources.append(f"[{idx}:a]volume={args.volume}[m];[m]")
            idx += 1
        if not sources:
            # Silent track: some players and Instagram's processing expect an audio stream.
            cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
            audio = f"[{idx}:a]atrim=0:{dur}[a]"
        else:
            shape = (f"atrim=0:{dur},afade=t=in:st=0:d=0.6,"
                     f"afade=t=out:st={max(dur - 1.2, 0)}:d=1.2[a]")
            if len(sources) == 2:
                audio = f"{sources[1]}[0:a]amix=inputs=2:duration=first:normalize=0,{shape}"
            else:
                audio = f"{sources[0]}{shape}"
        cmd += [
            "-filter_complex", video + ";" + audio,
            "-map", "[v]", "-map", "[a]",
            "-t", str(dur), "-r", str(FPS),
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            args.out,
        ]
        subprocess.run(cmd, check=True)

        if args.cover:
            # Cover = first frame of the finished reel, so it always matches.
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", args.out,
                            "-frames:v", "1", "-q:v", "3", args.cover], check=True)
    print(args.out)


def main():
    p = argparse.ArgumentParser(description="Render a quote reel for Instagram.")
    p.add_argument("--quote", default="", help="Quote text. Use \\n for a manual line break.")
    p.add_argument("--overlay", default="",
                   help="Transparent 1080x1920 PNG text layer saved from the app. Replaces --quote.")
    p.add_argument("--author", default="", help="Who said it. Shown under the quote.")
    p.add_argument("--handle", default="", help="Optional watermark text, e.g. @theentangledd. Off by default.")
    p.add_argument("--bg", default="", help="Background photo or video. Omit for a gradient.")
    p.add_argument("--dim", type=float, default=0.0,
                   help="Darken the background, 0 (off) to 0.8. Helps light text on bright photos.")
    p.add_argument("--no-zoom", dest="zoom", action="store_false",
                   help="Keep a photo background still instead of slowly zooming.")
    p.add_argument("--fade", action="store_true", help="Fade the text in. Off by default.")
    p.add_argument("--keep-audio", action="store_true",
                   help="Keep a video background's own sound (mixed with --music if both).")
    p.add_argument("--palette", default="midnight", choices=sorted(PALETTES),
                   help="Gradient colours when no --bg is given.")
    p.add_argument("--music", default="", help="Audio file to mix in. Omit for silence.")
    p.add_argument("--volume", type=float, default=0.8, help="Music volume, 0 to 1.")
    p.add_argument("--duration", type=float, default=8.0, help="Length in seconds (5 to 90).")
    p.add_argument("--out", default="out/reel.mp4")
    p.add_argument("--cover", default="", help="Also save a cover image (JPEG) here.")
    args = p.parse_args()

    args.quote = args.quote.replace("\\n", "\n").strip()
    if not args.quote and not args.overlay:
        sys.exit("Give either --quote or --overlay.")
    if not 0 <= args.dim <= 0.8:
        sys.exit("--dim must be between 0 and 0.8.")
    if not 5 <= args.duration <= 90:
        sys.exit("Duration must be between 5 and 90 seconds.")
    for label, path in (("Background", args.bg), ("Music", args.music), ("Overlay", args.overlay)):
        if path and not os.path.isfile(path):
            sys.exit(f"{label} file not found: {path}")
    render(args)


if __name__ == "__main__":
    main()
