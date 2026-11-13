# Entangledd Studio

An app for running the [@theentangledd](https://www.instagram.com/theentangledd/) quotes account:
suggest quotes, turn the chosen one into a reel, and post it to Instagram after a tap.
The in-app assistant is called Nishiii.

## What works today

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

`python3 render/render.py --help` lists every option.

## Folders

| Folder | What goes in it |
|---|---|
| `render/` | The reel renderer and its fonts |
| `backgrounds/` | Background images you own or have rights to use |
| `music/` | Audio you own or that is royalty-free |
| `docs/` | The feature spec and build plan |
| `.github/workflows/` | The cloud jobs (rendering now; daily suggestions and stats later) |

See [docs/SPEC.md](docs/SPEC.md) for the full feature list and build order.
