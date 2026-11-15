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
| 16 | A scorer trained on her picks and skips, from the first pick, self-tested on her own days | Done |
| 17 | Little notes from Nishiii under the heading on Today; sealed delivery of notes through the repository | Done |
| 18 | The health record, self-renewing Instagram sign-in, "Check everything" in Settings | Done |
| 19 | Upkeep: cleaning, daily backups, the record of problems, a ceiling on questions to Claude, moving to a new Claude model unaided, the reel maker's self-test | Done |
| 20 | Faster opening and unlocking; Face ID asks by itself; reel tools kept between runs | Done |
| 21 | A daily reminder on her phone at 11:11, if she turns it on | Done |
| 22 | The test suite in the repository (`tests/`) | Done |
| 23 | Real lines from a named book, film or series, found on Wikiquote, Goodreads and IMDb at no cost (and through Gemini or OpenAI web search when a key is set), kept in the Library | Done |
| 24 | "Who said this?" and Library titles looked up on the web (Wikiquote, Quote Investigator, Wikipedia, Open Library; Gemini or OpenAI when those find nothing), with the pages shown; lookups in the health record | Done |
| 25 | One engine for every suggestion: a pool from every source (her lines, found lines, web discovery, the real quotes behind pages she follows, Nishiii's memory) and one score over every signal, with a reason on each card; also used for Insights, advice, captions and background words | Done |
| 26 | Drafts: every piece of work in Create is saved by itself and opens again exactly (on another phone too); made reels kept under "Made, not posted" with Edit, Post, Share and Delete; Edit on waiting and handed-over reels; "Make a version of this" on posted reels for 7 days | Done |

## How the app is laid out

| Section | What it holds |
|---|---|
| Today | A little note from Nishiii, the day and date, exactly five suggestions (Use this, Reword, Skip; one may be marked "Something different"), and the previous seven days folded one row per day, still usable |
| Create | The composer. Tabs: Background, Text (with "Check who said this"), Style (shape, styles, her saved looks), Music (her own file or a free track, start point, volume, preview), Finish (reel, picture or carousel; post now or keep for later) |
| Library | What she feeds Nishiii: her own quotes (typed, scanned, or imported highlights), books (each marked if its full text is free to read), films and series, and reels and pages she loves |
| Posts | The last 7 days against the week before, with Nishiii's note, the best time of day and themes so far; reels made but not posted (Post, Edit, Share, Delete); reels waiting to be posted (with Edit); everything posted with its numbers and comments |
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
often she picks that, with recent choices counting more. It counts from her first pick or skip,
and tests itself on her own past days (would it have put the quote she picked above the ones she
passed?): proven, it is "live"; clearly worse than chance, "resting".

**The engine** (`server/engine.js`, `server/tags.js`). Every suggestion comes from one pool (her
own lines, lines found for her works, lines found on the web, the real quotes behind posts that do
well on pages she follows, Nishiii from memory) and one score: the sum of seven parts, each a
value of about -1 to 1 worked out from stored signals, times its starting weight, times n / (n + K)
for the evidence n behind it.

| Part | Weight | Evidence (K) | Value |
|---|---|---|---|
| picks | 1.0 | picks and skips (40); at least 0.8 once proven, a twentieth while resting | the scorer's counts |
| taste | 1.0 | profile phrases plus twice her notes (2) | +1 for a loved phrase that fits (+1.2 for a note), -2 for an avoid |
| own voice | 0.6 | her lines and rewordings (5) | theme and tone of her own lines, length near hers (shorter if she asks to shorten) |
| pages | 0.8 | tagged posts from pages (6) | share of what she saved and what did well there, each post against its account's usual numbers, recent ones more, shared reels 1.5 |
| audience | 0.9 | measured posts (10) | her posts per person reached (saves and shares x3, comments x2), per group of at least 3, shrunk |
| trust | 0.5 | always | book text 1, on a page 0.9, two sites 0.9, unchecked -0.6 |
| fresh | 0.4 | always | author, theme had in the last days: down; a theme not had lately: up |

The five: best first, at most two per source, theme or author, one of her own lines, one
"Something different", lines her avoids bury only if nothing else is left; shown in a random order.
The reason on a card is its two strongest parts, in words that name only what really matched.
Scoring 500 candidates takes about 4 ms in Node. Gemini and OpenAI are sent only themes from the
shared vocabulary, titles, authors and the words of a public quote. It is counting and arithmetic,
not model training, and "Forget everything" in the Nishiii section wipes it.

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
| `engine-tags` | 2 h | Tags up to 40 new lines (her own, pages' posts, found on the web) with theme and tone, in one question to Claude |
| `engine-found` | 3 h | Looks up one of her works never looked up (or due again), at most 4 a day |
| `engine-discover` | 4 h | One web question (Gemini, else OpenAI) for real quotes on her themes, by her authors, from works close to hers or new; at most 4 + 2 a day |
| `engine-echo` | 6 h | Asks Claude who really wrote up to 12 lines read off pages she follows, then checks one on the web; never a page's own writing |
| `lovenotes-deliveries` | 1 h | Opens sealed deliveries of little notes (listed only while one is waiting) |
| `upkeep-clean` | 6 h | Removes stored files that have outlived their lifetime (table below) |
| `upkeep-backup` | 1 h look, daily copy | Copies the documents that cannot be made again to `backup/<day>/`, seven per run |
| `upkeep-drafts` | 6 h | Drops made reels and the draft past their keeping, and removes files under `drafts/` that nothing names (after a day) |
| `health-services` | 24 h | Probes: book texts, the music search, a photo fetched the way the app fetches it, the reel maker's self-test, looking things up |
| `health-page` | 24 h | Probes: her posts on Instagram, post numbers, comments; then backups, tidying up, problems noticed |

**The health record** (`server/health.js`, `server/probes.js`). Eighteen lines, each `ok`,
`soon`, `attention`, `off` or `unknown`. `GET /api/health` (open) gives ids, states, day counts,
one message in fixed words, three counts, `needsAttention`, and `lastLookup`: the last look for
quotes from a work, coarse (`{at, identified, kind, year, kept, said}`, `said` such as "work
identified: yes (series, 2026); mydramalist: found (3); web: 5 results, 4 pages read, 3 about the
work, 12 candidates, 2 kept (9 not on the page); lines kept: 3"; no title and no line; kept in
`data/lookups.json` as `coarse`); it costs two storage reads and never calls an outside service. `GET /api/checkup` (signed in) gives the full record with the
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
`rewords`, `inspirations`, `account`, `instagram`, `passkeys`, `lovenotes`, `sealkey`, `draft`, `made`
(the settings of drafts and made reels, not their files), and everything under `scorer/`. A document unchanged since its last copy is skipped. Copies older
than 14 days are removed, but never a document's newest copy. `GET /api/backups` lists days and
names (never contents); `POST /api/backups/restore` with `{ day, name }` puts one back and keeps
what it replaced under `backup/undo/`. The README has the commands.

## Drafts and made reels

Every piece of work in Create is a draft (`web/drafts.js`, `server/drafts.js`). The composer's whole state
(`snapshot()` in `web/app.js`: every line with its words, font, size, colour, alignment, width, line height,
lowercase and place; shadow, fade, sound, length, style, author, shape; the background and music as she chose
them, with the music's start, volume, title and credit) plus where the quote came from and the caption is saved
on the server about 2.5 seconds after a change. A background or music file is sent once (`drafts/<fileId>`)
and a reel made from it uses that same file. When a reel is started its snapshot goes with it
(`jobs/<id>/keep.json`), and the moment the renderer hands in the reel the server keeps it in `data/made.json`,
so closing the app while it renders loses nothing.

- On opening: this phone's own draft is completed from the server (background and music back). On a phone
  with nothing in Create, one line offers "Carry on where you left off" with the draft's first words.
- Edit (on a made reel, a waiting one, one handed to Instagram, the finished reel; "Make a version of this" on a
  posted one for 7 days) puts everything back exactly and opens Text. Creating it again replaces a reel that is
  only under "Made, not posted" (its old files go); a waiting, handed-over or posted one stays, and the new one
  is a new reel (the app says so).
- "Use this" on a quote and "Start a new one" begin a new draft. Two phones: the last save wins; made reels are
  never lost to it. A file that was cleaned: the draft opens with what is left and says what is missing.
- Same state, same reel: the drawing and export code are unchanged; reopened and made again unchanged, a reel
  gets the same text layer and render inputs byte for byte (`tests/test_a14_edit.py`, `tests/test_a14_draft.py`).
- Not kept: the pictures already added to a carousel's tray (the picture being made is).

## What is kept in storage, and for how long

Nothing only grows: every kind of file is either one document with a size limit, or has a
lifetime and a cleaner.

| Key or prefix | What | Limit or lifetime |
|---|---|---|
| `jobs/<id>/bg`, `overlay.png`, `music` | What a reel is made from | Removed an hour after the reel exists, else after 7 days |
| `jobs/<id>/reel.mp4`, `job.json`, `keep.json`, `thumb.jpg` | A finished reel, what it was made from, its small picture | 7 days; 30 days while it is in `data/made.json` and not posted |
| `drafts/<fileId>` | A background or music file as she chose it, for drafts and made reels; a reel uses it as it is (`bgKey`, `music.key` in `job.json`) | While a draft or made reel names it; else removed after a day |
| `data/draft.json` | The current draft in Create (`{ id, of, updated, snap }`; last save wins) | One; 30 days after its last change |
| `data/made.json` | Reels made from the app and what each was made from (`{ id, jobId, made, snap, about, posted, postId }`) | 20 not posted, 30 days each; posted ones 7 days; then only the post's record |
| `data/drafts.json` | Unfinished reels set aside when she starts something else (`{ id, of, updated, snap }`); shown under Drafts in Posts, removed by `DELETE /api/drafts/saved/<id>`; `PUT /api/drafts/current` answers with the id it set aside | 10, each 30 days |
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
| `data/engine/bank.json` | Lines found on the web by the engine, the questions already asked, the day's counts | 300 lines, 200 questions |
| `data/engine/tags.json` | Theme and tone of each line, by a fingerprint of its words | 2,500 |
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
- "Who said this?" is looked up (`server/verify.js`, `POST /api/check`, the chat's `check_quote`):
  Wikiquote's text search and the matching page with the headings above the line (a
  "Misattributed" or "Disputed" section is the strongest evidence), and Quote Investigator's own
  search (`/wp-json/wp/v2/search`) and article (`/wp-json/wp/v2/posts/<id>`), both free and
  asked side by side; Gemini or OpenAI only when those found nothing (same daily limits). Claude
  gives the verdict from that evidence and names what it rests on: the answer carries
  `basis` (`web` or `memory`) and `sources` (`url`, `site`, `title`), shown as "Found on ..."
  links. With nothing found it is Claude's memory, marked so. Only the line and the name on it
  are sent anywhere. Searching stops after nine seconds (four per free page).
- A book, film or series added to the Library is checked once (`POST
  /api/library/<books|screen>/<id>/title`; `{accept: true}` or `{keep: true}` answers the offer):
  Open Library's search for books, Wikipedia's search with each page's short description, then
  Gemini or OpenAI if those found nothing (asked which work it is: proper title, original title,
  other titles, year, country, creators, lead actors, kind). Kept on the item: `titleChecked`,
  `known` (`title` hers, `real` the proper title, `by`, `year`, `kind`, `page`, `site`, and when
  found `original`, `aka`, `country`, `cast`, `about`) when her title is a real one (case and words
  such as "cdrama", "series", "(2026)" aside), `maybe` when a real title
  is close to hers or of the other kind (offered as "Did you mean ...?", applied only by her
  tap; accepting fills an empty author, sets the kind, and drops lines found under the old title),
  `titleKept` when she kept hers. The Library checks at most two older unchecked titles per
  visit. findlines uses `known`: the author for Goodreads and Wikiquote when she gave none, and
  the year to choose between same-named titles (IMDb, within a year; Wikiquote's "(2016 film)"),
  and every fact in each question to Gemini and OpenAI. A look at a work without `known` (never
  checked, or checked over a day ago with no result, or checked over two hours ago with nothing
  known and nothing found; also when what is known is thin, no year, cast or characters) checks the
  title first, within the look's own budget; a "Did you mean ...?" waiting for her does not stop it,
  and is dropped once her own title is known. The Wikipedia check (`verify.js`) searches the title
  without words such as "drama" or "movie", with the kind of work after it, then with the kind in
  brackets; each result's short description, or else its opening words, gives the kind, year and
  country; the opening gives the original title, the romanised title and other titles ("also known
  as"), and the leads ("starring"); for a film or series the whole page gives the characters
  ("Jing Boran as Luan Nian") and the network. Of several works with her title, the one of the kind
  she chose and, for a film or series, the most recent is taken, and the trail says so. `POST .../<id>/merge {into}` folds a second entry for the same work into the first (found
  lines, facts, her own lines "from" it); the Library offers it on the later entry, never on its own.
- Quotes on request for a named book (without free full text), film or series are real lines
  looked up for her (`server/findlines.js`). The places are tried in this order, the next one
  only when those before gave too few: lines already kept for that work in the Library (found
  earlier, or saved by her with its title under "Where it's from"); Wikiquote; MyDramaList for a
  series, or a film from East Asia (its search page `mydramalist.com/search?q=<title>`, the entry
  with the title or the romanised title in its address and the year, then that entry's `/reviews`;
  `MDL_SITE` in the stand-in); Goodreads for a book or IMDb for a film or series, read directly;
  the web with no paid allowance
  (`server/opensearch.js`: Tavily if `TAVILY_API_KEY` is set, Serper if `SERPER_API_KEY` is set,
  then DuckDuckGo's plain results page or Bing's RSS results (its web page when the RSS gives none;
  the query sent as %20, since Bing read "+" as its end), unless `OPEN_SEARCH` is `off`; the
  queries: the quoted proper title with year, country and kind, then with the main characters, then
  MyDramaList's reviews for an East Asian drama, then "memorable lines dialogue", then the original
  title; up to four result pages fetched and read, lines kept only on a page that names the work, or
  from two sites' snippets marked to check); Gemini with Google Search, if
  `GEMINI_API_KEY` is set (at most 40 questions a day); OpenAI with web search, if
  `OPENAI_API_KEY` is set (at most 20 a day); Anthropic's paid web search, only if
  `CLAUDE_WEB_SEARCH` is `on`; and last Nishiii's memory, marked to check. The first three need
  no key and cost nothing.
- Lines are picked by Nishiii; when Claude cannot answer (no key, the day's limit, an error, an
  answer that is not a list) or none of its picks is on the page, the app's own reader
  (`opensearch.js` `extractLines`) takes them: text in quotation marks (straight, curly, « », 「」),
  "Speaker: line" on a line of its own (not labels such as "Rating:" or "Episode 3:"), a known
  character's or actor's name followed by a colon anywhere in the text (pages write "Shang Zhitao"
  and "Shang Zhi Tao": names are compared without spaces), and on Wikiquote each line under a
  character's heading; a line a page credits after a dash to a person who is not of the work is left
  out. Every line, Claude's or not, must look like a line: 4 to 60 words, not a heading or title.
  Lines from web pages and MyDramaList are marked to check; one found again on another site in the
  same look becomes sure.
- A page counts as about the work when it has the original title (in its own script), or the
  title, proper title or another title with one more known fact (year, an actor, a character, the
  author, the network), or the title in the page's own `<title>` or address together with the kind
  of work; the kind of work alone counts only when nothing else is known.
- A line from a page is kept only if its words are on that page (quote marks, apostrophes, dashes,
  ellipses, non-breaking and repeated spaces, and case aside), and only from the page of
  the right work (title, kind and, for a book, the author she gave). Lines from Gemini and OpenAI
  are kept only with a page that was really read standing behind them (a grounding support, or the
  page the answer names on a site that was read), and only when the answer credits them to this
  work (`from`, matched against its titles); they are marked to check unless two sites agree.
  Google's grounding links are redirects: the site comes from the chunk's title (a domain, or a
  name such as "Instagram"); a supported line behind a page whose site Google did not name takes
  its site from the page the answer names, marked to check. Gemini and OpenAI are told the work's
  public facts and the number of lines, nothing about her. Up to three questions per look: its
  quotes, its original title (when known), its best lines and dialogue; Gemini then OpenAI for
  each; MyDramaList and social posts are named as places to read for new or East Asian works.
- Every look leaves a trail (`found.trail` on the work: `{at, said, steps}`; each step `{where,
  what, model?, status?, said?, n?, read?, why?}`, `what` one of found, no page, wrong work, blocked,
  no answer, key refused, may not search, no model, used up, no line passed, not asked, models,
  models unknown, known, unknown, close title). `said` is one sentence for her, shown on the Library
  row with "Look again" (`POST .../<id>/look`, at most once a minute) and in the message when
  nothing was found. A look that found nothing is due again after 2, 12, 48 hours, then 30 days
  (`found.tries`); the timed look-up retries such works too.
- What is found is kept on the work in the Library (`found`: at most 30 lines, each with its
  page), so a title is looked up once: again when the kept lines run short, or after 30 days.
  Today's five may use kept lines too. The Library shows "12 real lines found" on the work, with
  "Not the right one" to drop them and never use that page for it again.
- One search and one page per work at each site. A site that turns the app away (403, a "prove
  you are human" page, a page without quotes) has nothing that day; `data/lookups.json` notes
  when each site last worked or failed (also Quote Investigator, Wikipedia and Open Library),
  holds the day's count for Gemini and OpenAI, and in `last` how each one's last question went
  (`worked` with its `model`, `limit`, `used up`, `refused`, `may not search`, `no model`,
  `no allowance`, `no credit`, `busy`, `no answer`), and for each of the two `calls`, `answered`,
  `refused`, `skip` (models with no allowance today) and `off`. A 429 is read from its body:
  Gemini "limit: 0" is `no allowance` and a per-day quota `used up` on that model (the next model is
  tried); OpenAI `insufficient_quota` is `no credit` (rests for the day); a per-minute limit or a
  short "retry in" is `busy` (waited out once, at most 4 s, never a rest for the day). IMDb's 202
  rests it for seven days (`sites.imdb.until`). `open` holds the day's counts of the web with no
  paid allowance (`results`, `pages`, `tavily`, `serper`; caps 60, 120, 30, 20). `models`
  the models chosen by reading `GET /v1beta/models` (gemini-2.5-flash-lite and gemini-2.5-flash
  first, the only ones with free Search grounding; then `-flash-lite`, then `-flash`, newest
  first, up to five, that support generateContent) and `GET /v1/models` (gpt-6-luna, gpt-6.1-terra, gpt-6.1-sol,
  gpt-6-astra, else the newest plain GPT model), each `{list, at, worked}`, read again after a week
  or when none worked; `uses` the last outcome per feature (`lookup`, `title`, `check`, `discover`,
  `echo`); `trails` the last ten trails. `GEMINI_MODEL` / `OPENAI_MODEL` replace the choice; the
  built-in names (`gemini-3.8-flash`, `gemini-3.5-flash-lite`; `gpt-6-luna`, `gpt-6.1-terra`) are
  tried when the list can't be read. 429 rests the helper for the day; 401, 403 and a 400 naming the
  key mean the key is refused; a 400 or 403 naming search, grounding or a tool means this model may
  not search and the next is tried; 404 means not offered, next. The service's own words are kept,
  one line, with anything key-shaped cut out. `GET /api/lookups` (signed in) returns the record with
  the trails in full. It is not backed up: it rebuilds itself within a day, and an old copy could
  wrongly rest a site.
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
