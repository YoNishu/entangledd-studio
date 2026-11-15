#!/usr/bin/env python3
"""D's Studio reel renderer.

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
FPS = 30                 # photo and gradient reels; a video keeps its own usual rate (see reel_rate)
GOP_SECONDS = 2          # a fresh, self-contained keyframe every 2 seconds (Instagram asks for closed GOPs)
TOP_KBPS = 12000         # picture bitrate ceiling: well under Instagram's 25 Mbps, plenty for 1080x1920
MAX_FILE_MB = 85         # the finished reel goes back through the app, which takes up to 95 MB
AUDIO_KBPS = 192
AUDIO_RATE = 48000       # Instagram's highest sound rate
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


def media_seconds(path):
    """Length of an audio or video file in seconds (0 if it can't be read)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def make_background(bg_path, palette, dim, times=1):
    """Returns a (1080*times)x(1920*times) RGB image: the photo cover-cropped, or a gradient.

    times=2 is for the slow zoom: the photo is scaled once, straight from the original, to twice the reel's
    size, so the zoom has real detail to work with instead of a picture that was shrunk and then enlarged."""
    w, h = W * times, H * times
    if bg_path:
        img = Image.open(bg_path).convert("RGB")
        scale = max(w / img.width, h / img.height)
        img = img.resize((max(w, round(img.width * scale)), max(h, round(img.height * scale))), Image.LANCZOS)
        left, top = (img.width - w) // 2, (img.height - h) // 2
        img = img.crop((left, top, left + w, top + h))
        if dim > 0:
            img = Image.blend(img, Image.new("RGB", (w, h), (0, 0, 0)), dim)
        return img
    top_c, bottom_c = PALETTES[palette]
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top_c, bottom_c)))
    return grad.resize((w, h))


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


def hdr_fix(path):
    """Filter text that brings an HDR clip (as recent iPhones record) down to normal colours.

    Without it, HDR footage comes out grey and washed-out, because its brightness values are read as if
    they were ordinary video. Returns "" for ordinary clips, or when this ffmpeg lacks the needed filter."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    if out.stdout.strip().split(",")[0] not in ("smpte2084", "arib-std-b67"):
        return ""
    filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    if " zscale " not in filters or " tonemap " not in filters:
        print("HDR clip, but this ffmpeg has no zscale/tonemap filter: colours may look washed-out.")
        return ""
    return (",zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,"
            "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


# The usual frame rates of film and video, as ffmpeg writes them.
USUAL_RATES = {23.976: "24000/1001", 24.0: "24", 25.0: "25", 29.97: "30000/1001", 30.0: "30"}


def reel_rate(path):
    """Frame rate for a reel over this video: its own when that is a usual rate from 23.976 to 30, half of
    it for 48 to 60, otherwise 30. Changing 24 or 25 pictures a second to 30 repeats every fourth or fifth
    picture, which makes movement stutter. Returns (ffmpeg's way of writing it, pictures per second)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate",
         "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip().split(",")[0]
    try:
        num, _, den = out.partition("/")
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 0.0
    for got in (fps, fps / 2):
        usual = min(USUAL_RATES, key=lambda r: abs(got - r))
        if abs(got - usual) < 0.02:
            num, _, den = USUAL_RATES[usual].partition("/")
            return USUAL_RATES[usual], float(num) / float(den or 1)
    return str(FPS), float(FPS)


def picture_kbps(dur):
    """Picture bitrate ceiling for a reel this long: TOP_KBPS, or less for long reels so the finished file
    always stays under MAX_FILE_MB (two extra seconds allowed for the encoder's buffer)."""
    room = MAX_FILE_MB * 8 * 1048.576 / (dur + 2) - AUDIO_KBPS
    return int(min(TOP_KBPS, room))


def encode_settings(dur, rate_text, fps):
    """ffmpeg output settings: the top of Instagram's reel specification (docs/SPEC.md, "Reel file")."""
    kbps = picture_kbps(dur)
    gop = round(GOP_SECONDS * fps)
    return [
        "-t", str(dur), "-r", rate_text,
        "-c:v", "libx264", "-preset", "slow", "-crf", "15",
        "-maxrate", f"{kbps}k", "-bufsize", f"{2 * kbps}k",
        "-profile:v", "high", "-level:v", "4.2",
        "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0", "-flags", "+cgop", "-bf", "2",
        "-pix_fmt", "yuv420p", "-color_range", "tv",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ar", str(AUDIO_RATE), "-ac", "2",
        # Index at the front, no edit list (Instagram asks for both); negative composition offsets let the
        # first picture start at 0 without an edit list, so sound and picture stay in step.
        "-movflags", "+faststart+negative_cts_offsets", "-use_editlist", "0",
    ]


# RGB pictures (photo, gradient, the app's text layer) become video with the HD colour formula the reel is
# labelled with. Left to itself ffmpeg uses the older SD formula, which shifts every colour slightly.
TO_HD = "scale=out_color_matrix=bt709:out_range=tv"


def render(args):
    dur = args.duration
    video_bg = is_video(args.bg)
    rate_text, fps = reel_rate(args.bg) if video_bg else (str(FPS), float(FPS))
    frames = int(dur * fps)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)

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
            bg = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},"
                  f"fps={rate_text},setsar=1{hdr_fix(args.bg)}{dim}[bg]")
        else:
            bg_png = os.path.join(tmp, "bg.png")
            # At twice the size for the slow zoom, so it is smooth, not jittery, and keeps the photo's detail.
            make_background(args.bg, args.palette, args.dim, 2 if args.zoom else 1).save(bg_png)
            cmd += ["-i", bg_png]
            if args.zoom:
                bg = (f"[0:v]zoompan=z='1+0.07*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                      f":d={frames}:s={W}x{H}:fps={FPS},setsar=1,{TO_HD},format=yuv420p[bg]")
            else:
                bg = f"[0:v]loop=loop={frames}:size=1:start=0,fps={FPS},setsar=1,{TO_HD},format=yuv420p[bg]"
        cmd += ["-loop", "1", "-i", text_png]
        fade = ",fade=t=in:st=0.3:d=1.2:alpha=1" if args.fade else ""
        video = (f"{bg};[1:v]format=rgba{fade}[txt];[txt]{TO_HD},format=yuva420p[hd];"
                 f"[bg][hd]overlay=0:0,format=yuv420p[v]")

        # Audio: the clip's own sound, the music, both mixed, or silence.
        sources = []
        if video_bg and args.keep_audio and has_audio(args.bg):
            sources.append(f"[0:a]aresample={AUDIO_RATE}[c];[c]")
        idx = 2
        if args.music:
            if not has_audio(args.music):
                sys.exit("That music file has no sound in it.")
            # Start partway into the track if asked, as long as that point exists; loop if the track is shorter than the reel.
            start = args.music_start if 0 < args.music_start < media_seconds(args.music) - 1 else 0
            cmd += ["-stream_loop", "-1"] + (["-ss", f"{start:.2f}"] if start else []) + ["-i", args.music]
            sources.append(f"[{idx}:a]aresample={AUDIO_RATE},aformat=channel_layouts=stereo,volume={args.volume}[m];[m]")
            idx += 1
        if not sources:
            # Silent track: some players and Instagram's processing expect an audio stream.
            cmd += ["-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate={AUDIO_RATE}"]
            audio = f"[{idx}:a]atrim=0:{dur}[a]"
        else:
            shape = (f"atrim=0:{dur},afade=t=in:st=0:d=0.6,"
                     f"afade=t=out:st={max(dur - 1.2, 0)}:d=1.2[a]")
            if len(sources) == 2:
                audio = f"[0:a]aresample={AUDIO_RATE}[c];{sources[1]}[c]amix=inputs=2:duration=first:normalize=0,{shape}"
            else:
                audio = f"{sources[0]}{shape}"
        cmd += [
            "-filter_complex", video + ";" + audio,
            "-map", "[v]", "-map", "[a]",
            *encode_settings(dur, rate_text, fps),
            args.out,
        ]
        subprocess.run(cmd, check=True)

        if args.cover:
            # Cover = first frame of the finished reel, so it always matches.
            # A JPEG holds colours by the SD formula at full range, so the picture is turned into that.
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", args.out, "-frames:v", "1",
                            "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc,"
                                   "format=yuvj420p", "-q:v", "2", args.cover], check=True)
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
    p.add_argument("--music-start", type=float, default=0.0, help="Seconds into the music to start from.")
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
