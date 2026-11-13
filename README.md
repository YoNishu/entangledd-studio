# Entangledd Studio

An app for running the [@theentangledd](https://www.instagram.com/theentangledd/) quotes account:
suggest quotes, turn the chosen one into a reel, and post it to Instagram after a tap.
The in-app assistant is called Nishiii.

## What works today

**Composer (the app).** `web/` is the phone app: choose a photo or video, write the words, pick a
style (Sea, Horizon, Whisper), drag the text to move it and pinch to resize it. Photo posts save
straight from the phone as a 1080x1920 image. It is a plain static site with no build step:
serve the `web/` folder (for example `python3 -m http.server --directory web`) or host it on
Cloudflare Pages with `web` as the output directory.

**Reel maker.** `render/render.py` turns a quote into a 1080x1920 MP4 (H.264 + AAC) with a slow
background zoom, a text fade-in, an optional background photo and optional music.

Run it on GitHub (no install needed):

1. Open the **Actions** tab, choose **Render reel**, click **Run workflow**.
2. Type the quote and author. Optionally name a file from `backgrounds/` or `music/`.
3. When the run finishes, download the `reel` artifact from the run page.

Run it on your own machine (needs Python 3.9+, Pillow and ffmpeg):

```
python3 render/render.py --quote "Your quote" --author "Who said it" --out out/reel.mp4
python3 render/render.py --quote "Your quote" --bg backgrounds/sea.jpg --music music/calm.mp3
```

With a text layer saved from the app, the reel matches the app's preview exactly, over a photo
or a video:

```
python3 render/render.py --overlay entangledd-text.png --bg clip.mov --keep-audio
```

`python3 render/render.py --help` lists every option.

## Folders

| Folder | What goes in it |
|---|---|
| `web/` | The phone app (composer) |
| `render/` | The reel renderer and its fonts |
| `backgrounds/` | Background images you own or have rights to use |
| `music/` | Audio you own or that is royalty-free |
| `docs/` | The feature spec and build plan |
| `.github/workflows/` | The cloud jobs (rendering now; daily suggestions and stats later) |

See [docs/SPEC.md](docs/SPEC.md) for the full feature list and build order.
