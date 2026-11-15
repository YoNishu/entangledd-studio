# D's Studio

A home-screen web app for running the [@theentangledd](https://www.instagram.com/theentangledd/)
quotes page on Instagram. It suggests five quotes a day, turns the chosen one into a reel or a
picture post, posts it to Instagram after a tap, and shows how every post did. The assistant
inside it is called Nishiii. (Until 14 November 2026 the app was called Entangledd Studio; the
repository and the Cloudflare project keep that name.)

Everything it needs to keep running, it does by itself. The one thing it asks of a person is at
the end of [When the weekly check sends a notification](#when-the-weekly-check-sends-a-notification).

## What it does

- **Today**: five suggested quotes each morning, each with its source, and the last seven days.
  Above them, one little note from Nishiii each time the app is opened.
- **Create**: the composer. A photo or video of her own, or a free one from the built-in search;
  the words; a style; music (her own file, a free track, or a song picked in Instagram); then a
  reel, a picture or a carousel, posted now or kept for later.
- **Library**: what Nishiii draws on: her own quotes (typed, scanned from a page, or imported
  highlights), books, films and series, and pages and reels she loves.
- **Posts**: the week against the week before, what is waiting to be posted, and everything
  posted with its numbers and comments.
- **Insights**: totals, charts and comparisons of what works, for 7, 30 or 90 days or all time.
- **Nishiii**: quotes on request from any mix of her sources, what Nishiii has learned about her
  taste, and her notes to Nishiii. For a book, film or series she asks about, Nishiii looks real
  lines up on the web. A chat (the round button, top right) can do most things in the app for her.
- **Settings**: Face ID lock, the Instagram connection, little notes, and "Check everything".

Nothing is ever posted without her tap.

## How it is hosted

| Part | Where | What |
|---|---|---|
| The app | Cloudflare Workers, static assets from `web/` | Plain HTML, CSS and JavaScript. No build step, no frameworks, no packages. |
| The server | Cloudflare Worker `server/worker.js` | Everything under `/api/`. Add-on sections: `health.js` and `probes.js` (the health record), `engine.js` (the pool of quotes and the score behind every suggestion, with `tags.js`), `scorer.js`, `lovenotes.js`, `upkeep.js` (cleaning, backups, the record of problems), `claudeuse.js` (the daily ceiling and the model in use). |
| Storage | Cloudflare R2 bucket `entangledd-media` | Small JSON documents under `data/`, reels and uploads under `jobs/`, daily copies under `backup/`. |
| Reels | GitHub Actions, `.github/workflows/render-job.yml` | `render/render.py` with ffmpeg lays the text the app drew over the background and mixes in the music. |
| Outside services | Instagram Graph API, Anthropic (Claude), Pixabay, Openverse, Gutendex | Their keys live only in Cloudflare and GitHub, never in this repository. |

A push to `main` deploys the app (Cloudflare) and nothing else is needed. Settings are in
`wrangler.jsonc`. Secrets, set once in the Cloudflare dashboard (Workers & Pages,
entangledd-studio, Settings, Variables and Secrets): `APP_PASSCODE`, `RENDER_SECRET`,
`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `PIXABAY_API_KEY` (or `PEXELS_API_KEY`), `META_APP_ID`,
`META_APP_SECRET`. Optional: `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` (a larger music
search allowance), `CLAUDE_DAILY_CAP` (see below), `GEMINI_API_KEY` and `OPENAI_API_KEY` (see
"Real lines from books, films and series"). The GitHub repository holds the same
`RENDER_SECRET` as an Actions secret.

## What runs by itself

Cloudflare starts the server twice on a timer: every morning at 06:00 India time, and every five
minutes. The five-minute timer finishes posts Instagram is still processing, links reels she
finished in Instagram's own editor, and runs at most one of the timed jobs below.

| What | When | What it does |
|---|---|---|
| The morning pass | daily, 06:00 India time | Reads how posts did, notes the follower count, updates Nishiii's picture of her taste, prepares the day's five quotes. |
| Instagram sign-in renewal | daily, in the last 30 days of a sign-in | Asks Meta for a fresh sign-in and takes it only if Meta's own check says it is as good as the old one. |
| The scorer | every 6 hours | Learns which suggestions she picks, from the first pick, and tests itself on her past choices. |
| The engine's pool | every 2 to 6 hours, a little at a time | Tags new lines (theme, tone) in one question to Claude; looks up a book, film or series of hers never looked up (or due again); searches the web for real quotes on her themes, by her authors and from works close to hers; finds the real author behind lines that do well on pages she follows. Within its own share of each day's limits: 8 questions to Claude, 4 to Gemini, 2 to OpenAI, 4 look-ups. |
| Little notes | hourly, while a sealed delivery is waiting | Opens notes delivered through `server/sealed.js`. |
| Cleaning | every 6 hours | Removes what has outlived its use: reels and their parts after 7 days (the parts an hour after the reel exists), carousel pictures after 7 days, search results after 2 and 8 days, sign-in markers after 1 day, day lists after 60 days. |
| Backups | looked at hourly, copied once a day | Copies every document that cannot be made again to `backup/<day>/`. Unchanged documents are skipped. Two weeks are kept, and a document's newest copy is never removed. |
| The health record | daily, in three small runs | Checks every key and connection, asks each outside service one cheap read-only question, reads the reel maker's own self-test from GitHub, and looks at the cleaning, the backups and the record of problems. |
| The reel maker's self-test | twice a week on GitHub (`render-check.yml`) | Makes sample reels with the real renderer and checks them. If GitHub stops running it, the app starts it again. One failed run is tried again by the app; only a repeat is raised. |
| Claude model | when needed | If Anthropic retires the model the app uses, the app moves to the newest Sonnet on Anthropic's list by itself and says so in the health record. |
| A ceiling on Claude | every question | At most 400 questions to Claude in one India day (a usual day needs 10 to 40). `CLAUDE_DAILY_CAP` changes the number. |
| The record of problems | whenever something goes wrong | The last 30 errors on the server or in the app on her phone: the time, the place and a short description with nothing private in it. |
| Daily reminder | 11:11 India time, if she turned it on | One notification on her phone. |

Sign-in protects itself too: ten wrong passcodes from one address lock that address for 15
minutes, and sixty wrong tries in an hour from anywhere rest sign-in by passcode for the remainder
of that hour (Face ID and devices already signed in carry on). The health record says when that
happened.

### The health record

`GET /api/health` is open to anyone and holds nothing private: for each of eighteen checks an id,
a state (`ok`, `soon`, `attention`, `off`, `unknown`) and a day count, plus one plain message, a
few counts and `needsAttention` (true or false). In the app, Settings, **Check everything** shows
the same record in full, with the steps to fix whatever needs fixing, and **Check now**.

The eighteen: the Instagram connection, the reel maker's key, the reel maker, Nishiii, the
background search, the free music library, the daily routines; then book texts, the music search,
photos from the search, the reel maker's self-test, looking things up, her posts on Instagram,
post numbers, comments, backups, tidying up, and problems noticed.

"Looking things up" gives each place's last outcome (worked, turned the app away, didn't answer)
and, for Gemini and OpenAI, whether the key is accepted and which models it may use (checked by
reading the list of models, which asks nothing and costs nothing), the day's count and how the
last search went. Then one entry per feature that searches (quotes from a work, checking a
title, "Who said this?", finding new lines, checking new lines): worked, refused (the key, or
the search tool), no model, answered but every line was left out, with the service's own short
words. Last comes the last look at a work, step by step. A refused key needs attention; a site
that turns the app away, a model no longer offered, or a search that was refused is "soon".
The same record, with the last few trails in full, is at `GET /api/lookups` (signed in).
`POST /api/checkup?part=services` (signed in) renews the line at once.

### The weekly check

Once a week a scheduled Claude task reads `/api/health` and sends Nishith a notification: one line
when all is well, a few lines when something needs him. It reads that one address and nothing
else, and never touches a key.

## When the weekly check sends a notification

Open D's Studio, Settings, **Check everything**. The line that needs attention says in plain
words what is wrong, and **How to fix it** under it lists the steps. Where the steps say "tell
Claude", open the Claude chat where the app was built and paste the sentence shown. When the fix
is made, tap **Check now**; the line turns to Working.

Only one thing can come back however well the app looks after itself: **Instagram may ask for a
fresh sign-in.** Meta alone decides whether a sign-in can be renewed without a person. The app
renews what Meta lets it renew, and warns 21 days ahead when it cannot. The fix takes two
minutes: on a computer open developers.facebook.com/tools/explorer, choose the app, Generate
Access Token with every permission ticked, copy it; in D's Studio open Settings, Connect again,
paste, Connect Instagram.

Two settings, made once, keep everything else quiet: a GitHub token with no end date, and
auto-reload on the Anthropic account.

## Real lines from books, films and series

When she asks for quotes from a named book, film or series, the app first makes sure it knows which
work it is: Open Library (books) and Wikipedia's search, whose pages give the proper title, the
original title (早春晴朗), the romanised one, the year, the country, the cast, the characters and
the network. A title that is also a common phrase ("The early spring") is only ever searched with
those facts. Then it looks for real lines: those it already keeps for that work, Wikiquote,
MyDramaList's reviews (East Asian dramas and films: its own search finds the work by title and
year), then Goodreads (books) or IMDb (films and series). These need no key and cost nothing. Then
the web itself, with no key and no money (`server/opensearch.js`): DuckDuckGo's plain results page
(Bing's RSS results when DuckDuckGo turns the app away), and up to four of the pages it points to.
A page counts only when it names the work (its title with one more known fact, such as its year,
an actor, a character or the network; or its original title); a line counts only when it is on
that page, word for word (curly or straight quote marks, dashes and spaces aside), and is not
credited there to another work or person. Nishiii picks the lines; when Nishiii can't, the app's
own reader takes the quoted lines and "Name: line" lines from the page. A line on one page is
marked to check; two sites that agree make it sure. At most two results pages and four pages per
search, 400 KB a page, only https, 60 results pages and 120 pages a day. `OPEN_SEARCH=off`
switches the results pages off. How the last look went (each step's counts, no title, no line)
is on the open health page, `/api/health`, as `lastLookup`. The workflow `Live lookups`
(`tests/live/`) runs these lookups on GitHub against the real web, with no key, and prints every
step. Two free search keys go first when set:

- `TAVILY_API_KEY`: Tavily (1,000 searches a month free, no card). Sign up at tavily.com, copy the
  key from the dashboard (it starts `tvly-`). It sends the whole text of each page it read
  (`include_raw_content: "text"`), so no page is fetched again; a page it sent only a short extract
  of is fetched, and the extract used if the site says no. Two questions per look, at most 30 a day.
- `SERPER_API_KEY`: Serper, Google's results as JSON (2,500 searches once, free, no card). Sign up
  at serper.dev, copy the API key from the dashboard. Its result pages are fetched and read as
  above. At most 20 a day.

Two more places are used only when their key is set in Cloudflare, and only when those gave too few:

- `GEMINI_API_KEY`: Gemini with Google Search. Make the key at aistudio.google.com (Get API
  key, Create API key). The app asks at most 40 times a day. On a free key Google gives search
  only to gemini-2.5-flash-lite and gemini-2.5-flash (500 a day, checked on Google's price list in
  November 2026); Gemini 3 and newer models answer 429 with "limit: 0" until billing is set up
  (then 5,000 searches a month free, then $14 per 1,000). The app reads the list of models the key
  may use (once a week), tries those two first, then the flash-lite and flash models newest first
  (up to five). A model with no allowance sends it to the next; a passing rate limit is waited out
  once; only when no model may search does Gemini rest for the day. Every refusal is on the trail
  with Google's own words, and the health line says what the key lacks. `GEMINI_MODEL` (up to
  five names, with commas) replaces the choice.
- `OPENAI_API_KEY`: OpenAI with web search (about one cent a search, plus a little for the
  words). Make the key at platform.openai.com (API keys) and set a monthly budget under
  Settings, Limits. The app asks at most 20 times a day. The model is chosen from the list the key
  may use (gpt-6-luna, then gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra). `OPENAI_MODEL` replaces it.
  A key with no credit answers 429 `insufficient_quota`: OpenAI then rests for the day.

IMDb answers robots with 202 and an empty page: after that it is not asked for a week.

Anthropic's own paid web search stays off unless `CLAUDE_WEB_SEARCH` is `on`. Whatever is found
is kept in the Library on that work, so a title is looked up once (a look that found nothing is
tried again after 2, 12 and 48 hours, then after 30 days; "Look again" on the Library row looks at
once). Before the first look at a work the app does not know, its title is checked, and its facts
(year, country, original title, lead actors) go into every question, so "The early spring" is
searched as the 2026 Chinese drama and not as the season. A line must be credited to the work; one
found only on social posts (Instagram, Pinterest, Tumblr) is kept, marked to check, with its site.
Each work is asked about in up to three ways (its quotes, its original title, its best lines), at
most three questions in all. Every look leaves a trail: the Library row says in one sentence where
Nishiii looked ("Looked on Wikiquote, IMDb and Google: nothing yet."), and so does her message.
`data/lookups.json` in storage holds the day's counts, the models chosen, each site's last answer,
the last outcome per feature and the last trails; the health record shows it.

The same places check two more things (`server/verify.js`), sharing the daily limits:

- **Who said this?** (in Create, on a quote card marked to be checked, and in the chat): the line
  is looked up on Wikiquote (with the headings above it, so its "Misattributed" and "Disputed"
  sections count) and on Quote Investigator, both free; then Gemini or OpenAI only if those found
  nothing. Nishiii gives the verdict from that evidence and the app shows the page it rests on;
  when nothing is found, the answer is from memory and says so. Only the line and the name on it
  are sent. The searching stops after nine seconds.
- **A work added to the Library**: the title is checked on Open Library (books) and Wikipedia
  (with Wikidata's short descriptions, such as "2010 film by Christopher Nolan"), then Gemini or
  OpenAI if those found nothing. A title close to hers is offered ("Did you mean ...?"), never
  put in her place; a real one is kept with its year, author or creator and kind (and, from the
  search question, its original title, other titles, country and lead actors), which help the
  lookups above pick the right page. Words people add to say what a work is ("cdrama", "series",
  "(2026)") don't count, and two Library entries for one work offer "Same as ...? Keep one".

## How quotes are chosen

Every suggestion, Today's five and quotes on request, comes from one pool and one score
(`server/engine.js`). The pool: her own lines, real lines found for her books, films and series,
real lines found on the web beyond her list, the real quotes behind what does well on the pages
she follows, and Nishiii from memory. A source with nothing to give, or Nishiii unavailable for
the day, does not stop the day. The score weighs her picks, what she told Nishiii, her own voice,
the pages she follows, how her posts did, how sure the wording is, and variety; each card says
why in one quiet line. `docs/SPEC.md` has the parts and their weights. Gemini and OpenAI are only
ever sent themes, titles, authors and the words of a public quote.

## How to add a little note

- **In the app**: Settings, Little notes from Nishiii, write the note, add a date if it belongs
  to one (it then appears on that day every year), Save. Up to 60 notes of 280 characters.
- **Without opening the app** (so she never sees it coming): write the notes in a file outside
  this repository, seal them with `node tools/seal.mjs` (the steps are at the top of that file),
  commit the changed `server/sealed.js` and push. The sealed text can only be opened by the app's
  own server, so it is safe in a public repository; the plain file is not, so delete it.

## How to restore a backup

Every document the app cannot make again (her library, posts, Nishiii's picture of her taste and
her notes, saved looks, reels waiting to be posted, the record of her choices, the scorer's
record, the little notes, the Instagram sign-in, Face ID devices) is copied once a day. To put one
back, from any computer (replace the address with the app's own, and type the passcode where
shown):

```
APP=https://<the app's address>
TOKEN=$(curl -s -X POST $APP/api/login -H 'Content-Type: application/json' -d '{"passcode":"<the passcode>"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# which days and documents have a copy (names only; the contents are never listed)
curl -s $APP/api/backups -H "Authorization: Bearer $TOKEN"

# put one document back as it was on that day
curl -s -X POST $APP/api/backups/restore -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"day":"2026-11-20","name":"library"}'

# changed your mind: what was there just before the restore is kept, and "undo" brings it back
curl -s -X POST $APP/api/backups/restore -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"day":"undo","name":"library"}'
```

Document names are the ones the list shows, for example `library`, `posts`, `taste`, `looks`,
`queue`, `history`, `lovenotes`, `scorer/log`. The copies live in the same storage as the app, so
they guard against a mistake or a damaged document, not against losing the Cloudflare account.

## Trying it on one machine

`node server/dev.mjs`, then open http://localhost:8787 (passcode `letmein`). The stand-in server
has pretend versions of Claude, Instagram, GitHub, Pixabay, Openverse and Gutendex (paste any
token starting with `SHORT` to connect Instagram), so trying it costs nothing and posts nothing.

## How to run the tests

```
bash tests/run_all.sh                 # everything: about 75 scripts, a fresh stand-in server for each
bash tests/run_all.sh test_a6_signin  # one of them, by its label
```

They need Node 20 or newer, Python 3 with Playwright (and Chrome), `cryptography`, `numpy`,
`Pillow` and `PyYAML`, and ffmpeg. The sample media is made on the spot by `tests/make_media.sh`;
no media file lives in the repository. Addresses and folders come from the environment
(`STUDIO_PORT`, `STUDIO_OUT`, `STUDIO_MEDIA`). See [tests/README.md](tests/README.md).

## The reel maker by hand

`render/render.py` turns a quote into a 1080x1920 MP4 (H.264 and AAC). On GitHub: Actions,
**Render reel**, Run workflow. On a machine with Python 3.9 or newer, Pillow and ffmpeg:

```
python3 render/render.py --quote "Your quote" --author "Who said it" --out out/reel.mp4
python3 render/render.py --overlay text-layer.png --bg clip.mov --keep-audio
python3 render/render.py --help
```

## Folders

| Folder | What is in it |
|---|---|
| `web/` | The app: `index.html`, `app.js` (composer, sign-in, Face ID), `studio.js` (everything around it), `insights.js`, `health.js`, `scorer.js` (what the engine has learnt), `lovenotes.js`, `app.css`, fonts, `_headers` |
| `server/` | The server, its add-on sections, and `dev.mjs` with `devparts/`: the stand-in for trying and testing |
| `render/` | The reel renderer, its fonts, and its self-check |
| `.github/` | Workflows: making a reel for the app, making one by hand, and the self-check twice a week |
| `tools/` | `seal.mjs`, for delivering little notes sealed |
| `tests/` | The test suite and what it needs |
| `backgrounds/`, `music/` | Files for the reel maker when it is run by hand |
| `docs/` | [SPEC.md](docs/SPEC.md): decisions, how each part works, limits, and ideas for later |
