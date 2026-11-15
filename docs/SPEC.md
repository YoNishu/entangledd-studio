# D's Studio: what it is and how each part works

Last updated: 15 Nov 2026. Everything below is built and live. What is not built is in the one
list at the end, "Ideas for later, only if she asks".

## Decisions

| Topic | Decision |
|---|---|
| App name | D's Studio (until 14 Nov 2026: Entangledd Studio; the repository, the Cloudflare project and the storage bucket keep the old name) |
| Instagram account | `@theentangledd`, professional (Creator), linked to the "Entangledd" Facebook Page |
| Assistant | Nishiii. Speaks to the user as "you" or Dhruuu |
| Posting | Never automatic. Every post waits for a tap |
| Instagram API route | Facebook Login (the Page is linked), Graph API v25.0, which allows the Instagram music library and reference-account stats |
| Model behind Nishiii | Claude Sonnet 5.5 through a paid Anthropic API key. If Anthropic retires it, the app moves to the newest Sonnet by itself |
| Hosting | Free tiers: a Cloudflare Worker with static assets for the app and API, R2 for storage, GitHub Actions for rendering reels |
| Upkeep | None on a schedule. The app renews, cleans, copies and checks itself, and a weekly Claude task reads its open health record |
| Repo | github.com/YoNishu/entangledd-studio (public: nothing secret or private is ever committed) |

## Features

| # | What | Status |
|---|---|---|
| 1 | Reel renderer and GitHub workflows | Done |
| 2 | Composer: photo or video background, styles, drag and pinch, image export | Done |
| 3 | Server: passcode, reels created from the phone | Done |
| 4 | Quotes: Today's five, Library, page scan, rewording, search for free photos and videos (Pixabay) | Done |
| 5 | Instagram: connect, captions, music, tap to post reels; carousels on a 4:5 canvas | Done |
| 6 | Post results: reach, views, likes, comments, saves, shares; deleted posts drop off | Done |
| 7 | Inspiration: accounts (top posts), reel links, screenshots read by Claude | Done |
| 8 | Taste profile: what Nishiii has learned, her notes, daily update, used in every suggestion | Done |
| 9 | Films and series as sources; quotes on request from any mix of her sources, with real lines looked up on the web for a named book, film or series; Face ID lock; Settings | Done |
| 10 | Nishiii as a chat that can fetch quotes, fill Create, add to the Library, report on posts and the week, check who said a quote | Done |
| 11 | Quotes copied from the full text of free (Project Gutenberg) books and checked against it; highlights import | Done |
| 12 | "Check who said this", the week's numbers, reels kept to post later, saved looks, ten fonts, comment replies drafted by Nishiii, HDR clips tone-mapped | Done |
| 13 | Insights: totals, reach over time, followers, best posts, best days and times, what works by theme, tone, source, background, format, length, author, music, font, reel length and hashtags, audience, rhythm, Nishiii's advice, a downloadable file | Done |
| 14 | Music inside the reel: her own audio (or a video's sound), or a free track from Openverse; start point, volume, preview; credit added to the caption where the licence asks | Done |
| 15 | "Add a song in Instagram": hand the finished reel to the Instagram app, then find it on her page and track it | Done |
| 16 | A scorer trained on her picks and skips, which ranks suggestions once it has proved itself | Done |
| 17 | Little notes from Nishiii under the heading on Today; sealed delivery of notes through the repository | Done |
| 18 | The health record, self-renewing Instagram sign-in, "Check everything" in Settings | Done |
| 19 | Upkeep: cleaning, daily backups, the record of problems, a ceiling on questions to Claude, moving to a new Claude model unaided, the reel maker's self-test | Done |
| 20 | Faster opening and unlocking; Face ID asks by itself; reel tools kept between runs | Done |
| 21 | A daily reminder on her phone at 11:11, if she turns it on | Done |
| 22 | The test suite in the repository (`tests/`) | Done |
| 23 | Real lines from a named book, film or series, found on Wikiquote, Goodreads and IMDb at no cost (and through Gemini or OpenAI web search when a key is set), kept in the Library | Done |

## How the app is laid out

| Section | What it holds |
|---|---|
| Today | A little note from Nishiii, the day and date, exactly five suggestions (Use this, Reword, Skip; one may be marked "Something different"), and the previous seven days folded one row per day, still usable |
| Create | The composer. Tabs: Background, Text (with "Check who said this"), Style (shape, styles, her saved looks), Music (her own file or a free track, start point, volume, preview), Finish (reel, picture or carousel; post now or keep for later) |
| Library | What she feeds Nishiii: her own quotes (typed, scanned, or imported highlights), books (each marked if its full text is free to read), films and series, and reels and pages she loves |
| Posts | The last 7 days against the week before, with Nishiii's note, the best time of day and themes so far; reels waiting to be posted; everything posted with its numbers and comments |
| Insights | A period picker, then: people reached, the key numbers, reach of each post, best posts, a day-by-time grid, "What works" comparisons, the clearest differences with Nishiii's advice, followers over time, Instagram's totals for the whole page, who follows the page, posting rhythm, and a file of every post's numbers |
| Nishiii | Ask for five quotes from chosen books, films, series or pages (kept here, apart from Today); what Nishiii has learned about her taste; how far the scorer has come; notes she writes for Nishiii |
| Chat (round button, top right) | Nishiii as a chat that can act in the app |
| Settings (top right) | Face ID lock, the Instagram connection, little notes from Nishiii, Check everything (the health record), the daily reminder, signing out |

## How Nishiii learns

**The taste profile.** Evidence is collected as she uses the app: quotes she picks and skips, how
she asks for rewording, her own saved lines, her posts and their numbers, and the reels, accounts
and screenshots she adds as inspiration. Each morning (and on "Update now") Claude is given the
previous profile, her notes and the recent evidence, and writes the updated profile. Because each
update starts from the previous profile, it keeps what was learned long ago even after the raw
evidence has aged out. The profile and her notes are sent with every request for suggestions,
rewording and captions. Lines from other creators are used only to understand her taste and are
never suggested back.

**The scorer** (`server/scorer.js`). It keeps its own lasting record of every suggestion and what
became of it. For each thing a quote can be (theme, tone, source, author, length) it counts how
often she picks that, with recent choices counting more. Before it may rank anything it needs 50
picks and proof on her own past choices that its ranking beats chance; if it stops being that
good it goes back to learning. Once live, Nishiii is asked for about twice as many quotes, the
best matches are kept (never more than two on one theme or by one author) plus one "Something
different" so her taste can keep growing. It is counting and arithmetic, not model training, and
"Forget everything" in the Nishiii section wipes it.

## How it looks after itself

**Timers.** Cloudflare runs the server at 00:30 UTC (06:00 India time) for the morning pass, and
every five minutes. Each five-minute run finishes posts in progress and runs at most one timed
job that is due (their last runs are in `data/jobstamps.json`; a job that fails is tried again
about an hour later). Each run stays within the free plan: about 20 outside calls, storage
included, of the 50 allowed.

| Timed job | Every | What |
|---|---|---|
| `instagram-renew` | 24 h | Renews the Instagram sign-in in its last 30 days, adopting the new one only when Meta's own check proves it valid, for the same app and person, with every permission and a later end date |
| `health-check` | 24 h | The seven lines about keys and connections |
| `scorer` | 6 h | Gathers her choices, rebuilds and tests the scorer |
| `lovenotes-deliveries` | 1 h | Opens sealed deliveries of little notes (listed only while one is waiting) |
| `upkeep-clean` | 6 h | Removes stored files that have outlived their lifetime (table below) |
| `upkeep-backup` | 1 h look, daily copy | Copies the documents that cannot be made again to `backup/<day>/`, seven per run |
| `health-services` | 24 h | Probes: book texts, the music search, a photo fetched the way the app fetches it, the reel maker's self-test |
| `health-page` | 24 h | Probes: her posts on Instagram, post numbers, comments; then backups, tidying up, problems noticed |

**The health record** (`server/health.js`, `server/probes.js`). Seventeen lines, each `ok`,
`soon`, `attention`, `off` or `unknown`. `GET /api/health` (open) gives ids, states, day counts,
one message in fixed words, three counts and `needsAttention`; it costs one storage read and
never calls an outside service. `GET /api/checkup` (signed in) gives the full record with the
steps to fix each thing; `POST /api/checkup` checks now, at most once a minute. A record older
than 36 hours says so itself, so timers that stop cannot hide. Every probe is read-only: nothing
is posted, written to Instagram or paid for.

**Claude.** Every question is counted per India day in `data/claudeuse.json`; after 400
(`CLAUDE_DAILY_CAP` changes it) no more are sent until midnight and she is told kindly. If
Anthropic answers that the model no longer exists, the app reads Anthropic's list of models,
moves to the newest Sonnet, remembers the choice in the same document and notes it in the health
record. The same ceiling bounds web searches, which Anthropic bills separately.

**The reel maker's self-test** (`.github/workflows/render-check.yml`). Twice a week GitHub makes
sample reels with the real renderer and checks picture, sound and words. The health record reads
the latest result with the app's own GitHub key. GitHub stops timed workflows in a repository
nobody has touched for 60 days, so when the latest run is over eight days old the app switches
the workflow on and starts a run itself. One failed run is started again; a second failure in a
row is raised.

**The record of problems** (`data/errors.json`). The last 30 errors: when, where (the path with
every id removed) and a short description from which quoted text, addresses and anything shaped
like a key have been cut. Written at most once a minute. The app on her phone reports script
errors to the same record. Ten or more in a day, or a burst of wrong passcodes, is raised in the
health record.

**Backups.** Documents copied: `library`, `posts`, `taste`, `looks`, `queue`, `history`,
`rewords`, `inspirations`, `account`, `instagram`, `passkeys`, `lovenotes`, `sealkey`, and
everything under `scorer/`. A document unchanged since its last copy is skipped. Copies older
than 14 days are removed, but never a document's newest copy. `GET /api/backups` lists days and
names (never contents); `POST /api/backups/restore` with `{ day, name }` puts one back and keeps
what it replaced under `backup/undo/`. The README has the commands.

## What is kept in storage, and for how long

Nothing only grows: every kind of file is either one document with a size limit, or has a
lifetime and a cleaner.

| Key or prefix | What | Limit or lifetime |
|---|---|---|
| `jobs/<id>/bg`, `overlay.png`, `music` | What a reel is made from | Removed an hour after the reel exists, else after 7 days |
| `jobs/<id>/reel.mp4`, `job.json` | A finished reel | 7 days |
| `slides/<id>.jpg` | Carousel pictures | 7 days |
| `data/stockcache/`, `data/musiccache/` | Search results | 2 days, 8 days |
| `auth/` | Wrong-passcode counts and markers, used Face ID challenges | 1 day |
| `data/suggestions/<day>.json` | A day's five quotes | 60 days (the app shows 7; the scorer keeps what it needs in its own record) |
| `backup/<day>/`, `backup/undo/` | Daily copies | 14 days, a document's newest copy always kept; one undo copy per document |
| `secret/challenge-seal` | The server's own random key for sealing Face ID challenges | One small file, never sent anywhere |
| `data/library.json` | Her library | 500 quotes, 100 books, 150 films and series |
| `data/posts.json` | Posts and their numbers | Newest 500 |
| `data/history.json`, `rewords.json`, `asked.json` | Her choices, rewording, quotes on request | Last 400, 80, 40 |
| `data/queue.json`, `handoffs.json` | Reels to post later, reels handed to Instagram | 14 for 7 days each, 12 for 72 hours each |
| `data/looks.json`, `inspirations.json`, `taste.json`, `passkeys.json` | Saved looks, inspiration, taste profile and notes, Face ID devices | 12, 80, 30 notes, 10 |
| `data/account.json` | Followers per day | 800 days |
| `data/scorer/log.json`, `model.json`, `forgot.json` | The scorer's record and model | 1,500 rows, older ones folded into running counts |
| `data/lovenotes.json`, `sealkey.json` | Little notes, and the key that opens sealed deliveries | 60 notes of 280 characters; never shown, listed or logged |
| `data/errors.json` | The record of problems | Last 30 |
| `data/insightcache/*`, and one each of `instagram`, `openverse`, `metriclists`, `report`, `jobstamps`, `health`, `healthnotes`, `upkeep`, `backupstate`, `claudeuse` | Small state | Overwritten in place |

## What works without signing in

| Path | What it gives | Guard |
|---|---|---|
| `GET /api/status` | Six yes/no flags | None needed |
| `POST /api/login` | A session for the right passcode | Passcode compared through a keyed hash, so not even its length shows; 10 wrong tries per address per 15 minutes; 60 tries an hour across all addresses, counted before the passcode is looked at |
| `POST /api/passkey/challenge`, `/login` | A Face ID challenge; a session for a valid reply | Challenges are sealed with the server's own key, last five minutes and work once; a reply naming no saved device writes nothing |
| `GET /api/public/reel/<id>.mp4`, `/slide/<id>.jpg` | One file, for Instagram to fetch | A signed link valid for 24 hours |
| `GET /api/health` | The open health record | Nothing private in it |
| `GET /api/seal-key` | The public half of the key for sealing little notes | The private half never leaves storage |
| `/api/render/<id>/*` | A reel's parts, for the renderer | The render secret |

The app's own pages carry `X-Content-Type-Options: nosniff`, a strict referrer policy and no
framing by other sites (`web/_headers`). The session is derived from the passcode: changing
`APP_PASSCODE` in Cloudflare signs every device out at once.

## Reel look

- Full-bleed nature photo or video, not darkened.
- Small, still text: it takes up a small patch of the frame and does not animate.
- Styles: Sea (cream serif, centred), Horizon (small lowercase serif), Whisper (italic sans,
  staggered lines, free placement).
- Backgrounds: her own photos and videos from the iPhone, or free ones found with the in-app search.
- The app draws the text layer; the renderer only lays it over the background, so the preview
  and the finished reel always match.

## Limits to remember

- Fonts: Lora and Poppins load first; eight more load in the background. To add another, put the
  .ttf in `web/fonts`, add an `@font-face` line in `web/app.css` and list it in `web/app.js`.
- HDR clips (recent iPhones) are tone-mapped to normal colours when the reel is rendered. The
  preview in the app is not, so it can look slightly different from the finished reel.
- "Check who said this" is Claude's memory, not a lookup. It catches famous misattributions; it
  cannot prove an obscure quote.
- Quotes on request for a named book (without free full text), film or series are real lines
  looked up for her (`server/findlines.js`). The places are tried in this order, the next one
  only when those before gave too few: lines already kept for that work in the Library (found
  earlier, or saved by her with its title under "Where it's from"); Wikiquote; Goodreads for a
  book or IMDb for a film or series, read directly; Gemini with Google Search, if
  `GEMINI_API_KEY` is set (at most 40 questions a day); OpenAI with web search, if
  `OPENAI_API_KEY` is set (at most 20 a day); Anthropic's paid web search, only if
  `CLAUDE_WEB_SEARCH` is `on`; and last Nishiii's memory, marked to check. The first three need
  no key and cost nothing.
- A line from a page is kept only if its exact words are on that page, and only from the page of
  the right work (title, kind and, for a book, the author she gave). Lines from Gemini and OpenAI
  are kept only with a page that was really read, and are marked to check unless two sites agree.
  Gemini and OpenAI are told the title, kind, author and number of lines, nothing about her.
- What is found is kept on the work in the Library (`found`: at most 30 lines, each with its
  page), so a title is looked up once: again when the kept lines run short, or after 30 days.
  Today's five may use kept lines too. The Library shows "12 real lines found" on the work, with
  "Not the right one" to drop them and never use that page for it again.
- One search and one page per work at each site. A site that turns the app away (403, a "prove
  you are human" page, a page without quotes) has nothing that day; `data/lookups.json` notes
  when each site last worked or failed, and holds the day's count for Gemini and OpenAI.
  Goodreads and IMDb do not offer this as a service and may refuse a server; the app then moves on.
- Book text comes from Project Gutenberg through the Gutendex catalogue, so only books old
  enough to be free have it. Lines taken from a book's text are kept only if the exact words
  are found in the text.
- Best time of day and best themes appear after six posts have numbers, and only compare
  groups with at least two posts. Times are India time.
- A reel kept to post later lives on the server for seven days, like every finished reel.
- Insights compares kinds of post only when a kind has at least two posts, and says so.
  "All time" covers the newest 500 posts.
- Followers are noted once a day by the app, so the follower chart starts on the day Insights first
  ran. Instagram's totals for the whole page cover at most 30 days. Audience details (countries,
  cities, ages) need 100 followers. Watch time and "left in the first 3 seconds" exist for reels only.
- "Add a song in Instagram" hands the finished reel to the Instagram app through the phone's share
  menu, with the caption copied. The app keeps a note of what was handed over for 72 hours; the
  server looks for a new reel on her page and links it, so it is tracked like any other post.
  Which song she picked can't be read back from Instagram.
- Music has three routes. Her own file or a free track becomes part of the reel. Instagram's own
  music is chosen at posting, and only for reels with no music of their own, so the two never overlap.
- Free tracks come from Openverse and only under licences that allow use in a video: CC0, public
  domain, and CC BY. A CC BY track's credit line is added to the caption by the server even if it
  was edited out. This is not legal advice; the licence shown on each track's own page is what counts.
- Openverse lets anonymous apps make only a few new searches an hour. Each search is kept for a
  week, so repeats are free.
- A song she doesn't own, baked into the video, can be muted or blocked by Instagram. For
  popular songs the Instagram music picker at posting is the right route.
- Comments need the `instagram_manage_comments` permission and post numbers need
  `instagram_manage_insights`; the health record says if either is missing. A reply is sent only
  when she taps Send reply.
- Instagram may ask for a fresh sign-in whatever the app does (Meta's rule). The health record
  warns 21 days ahead. This is the only thing that can need a person again.
- Backups live in the same storage as the app. They guard against a mistake or a damaged
  document, not against losing the Cloudflare account.
- No full Content-Security-Policy: previews and media come from Pixabay's and the music hosts'
  own addresses, which the stand-in cannot imitate, so a policy could not be proven harmless.
- Reels carry no watermark. Reel text must fit a safe box; the renderer rejects quotes over
  roughly 800 characters.
- Quotes from modern books and other creators are their authors' work. Always credit; prefer
  public-domain sources and her own writing.
- Secrets (Instagram token, Anthropic key and the others) live in Cloudflare and GitHub, never
  in the repository.

## Ideas for later, only if she asks

Nothing here is planned or pending.

- Story versions of a post.
- When her followers are online (Instagram's format for it isn't documented clearly enough to trust).
- Comparisons against other accounts.
- "All time" beyond the newest 500 posts.
- A larger music-search allowance by registering the app with Openverse
  (`OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET`).
- A copy of the backups outside Cloudflare.
- A full Content-Security-Policy, once it can be tried against the real services.
