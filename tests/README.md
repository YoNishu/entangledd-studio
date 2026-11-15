# Tests

Everything here runs against the stand-in server (`server/dev.mjs`), which has pretend versions
of Claude, Instagram, GitHub, Pixabay, Openverse and Gutendex. Nothing touches the real app, a
real key or Instagram, and nothing costs money. The made-up passcode is `letmein`.

## Run them

```
bash tests/run_all.sh                    # everything, about 75 scripts (30 to 60 minutes)
bash tests/run_all.sh g test_a6_backup   # only these, by label (the first word of each line in run_all.sh)
```

Each test gets a fresh server with empty storage and the settings it needs. Its output is kept
in `$STUDIO_OUT/results/<label>.txt` with the server's log beside it, screenshots go to
`$STUDIO_OUT/shots/`. The run ends with a count and exits non-zero if anything failed.

One test by hand:

```
bash tests/prepare.sh                    # sample media and the two pieces of older code (once)
bash tests/serve                         # a fresh stand-in server; tests/stop ends it
python3 tests/test_a6_signin.py          # most tests start their own server anyway
```

## What they need

- Node 20 or newer.
- Python 3 with `playwright` (and Chrome: the tests use `channel="chrome"`), `cryptography`,
  `numpy`, `Pillow` and `PyYAML`.
- ffmpeg with libx264, aac and libmp3lame.
- The full git history (not a shallow clone): three tests compare with the code as it was at
  two earlier commits, which `tests/prepare.sh` takes from the history.

## Settings, all from the environment

| Name | Default | What |
|---|---|---|
| `STUDIO_PORT` | `8787` | Port of the stand-in server. The next port up is used by the tests that run a second server |
| `STUDIO_URL` | `http://localhost:<port>` | Its address |
| `STUDIO_OUT` | `/tmp/studio-tests` | Results, screenshots, logs, scratch files |
| `STUDIO_MEDIA` | `<STUDIO_OUT>/media` | The sample media |
| `STUDIO_WRAP` | (nothing) | A command put in front of every test by `run_all.sh`, such as `nice -n 5` |

`tests/where.py` reads these for the Python tests; `tests/serve` and `tests/stop` read the same names.

## What is here

| File | What |
|---|---|
| `run_all.sh` | Runs the suite |
| `prepare.sh` | Makes the sample media if missing, and unpacks the code as it was at commit `d576d40` (before the scorer, the health record and the new look) and the scorer as first built (`4d6c348`) into `$STUDIO_OUT` |
| `make_media.sh` | Makes every sample file with ffmpeg and plain text: two pictures, four short videos, two sounds, a pretend book and a pretend highlights file. No media file is kept in the repository. Each sound has its own pitch, so a test can hear which one ended up in a reel |
| `serve`, `stop` | Start (afresh) and stop the stand-in server |
| `where.py` | Addresses and folders, from the environment |
| `a3lib.py`, `a4lib.py`, `a5lib.py`, `a6lib.py`, `a4kit.mjs`, `a4loop.mjs`, `pitch.py`, `harness_a5.mjs`, `count_calls.mjs`, `cpu_run.mjs`, `seal_raw.mjs`, `unseal_raw.mjs` | Helpers |

Two kinds of test:

- **Walk-throughs** (`test_g.py`, `test_chat.py`, `test_car.py`, `test_r4.py` to `test_r7.py`,
  `test_made.py`, `test_words.py`, `test_ins_*.py`, `test_tiers.py`, `test_photo.py`,
  `test_race.py`, `test_video_pick.py`, `test_voice.py`, `test_books.py`, `test_music_*.py`,
  `test_igmusic.py`, `test_handoff_*.py`). The oldest tests. They use the app the way she would
  and **print what they see rather than judge it**. `run_all.sh` fails them only when they stop
  with an error, so after changing a screen, read their output and look at the screenshots.
- **Checks that judge for themselves** (`test_a1_*` speed, Face ID and the reel tools; `test_a2_*`
  the interface and exported pictures; `test_a3_*` the health record and Instagram renewal;
  `test_a4_*` the scorer; `test_a5_*` little notes and sealed deliveries; `test_a6_*` cleaning,
  backups, probes, the ceiling on Claude, the model move, the record of problems, sign-in and
  safety; `test_web_quotes.py`; `unit_renew.mjs`). Each asserts, prints `PASS` or `FAIL` on its
  last line and exits non-zero on failure.

## Writing a new one

Start from a small one such as `test_a6_cap.py`: `from a6lib import *`, `serve()` for a fresh
server (pass `"NAME=VALUE"` settings for the stand-in), `login()` for a session,
`http(method, path, body, token)` for a call, `check(name, ok, detail)` for each claim and
`finish()` at the end. Hooks of the stand-in (all start with `/__`): `/__cron` runs the
five-minute timer, `/__doc?name=` reads or writes a stored document, `/__keys?prefix=` lists
storage, `/__health_set?...` switches how the pretend services behave; `server/dev.mjs` and
`server/devparts/` list the rest. Never put a real key, token, passcode or anything personal in
a test: this repository is public.

## Not here

`test_a1_tools_real.sh` (it proved the reel tools' saved copy on a machine it could take apart as
root) stayed out: it needs root and changes the machine it runs on. `test_a1_tools.sh` checks the
same script's logic in a pretend world, and GitHub's own twice-weekly `render-check.yml` run
proves the real thing.
