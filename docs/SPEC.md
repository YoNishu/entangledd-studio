# Entangledd Studio: spec and build plan

Last updated: 13 Nov 2026

## Decisions

| Topic | Decision |
|---|---|
| App name | Entangledd Studio |
| Instagram account | `@theentangledd`, professional (Creator), linked to the "Entangledd" Facebook Page |
| Account email | theentangledd8@gmail.com |
| Assistant | Nishiii. Addresses the user as Dhruuu |
| Posting | Never automatic. Every post waits for a tap |
| Instagram API route | Facebook Login (the Page is linked), which allows the Instagram music library and reference-account stats |
| In-app chatbot model | Claude Sonnet 5.5 through a paid Anthropic API key |
| Hosting target | Free tiers: Cloudflare Pages/Workers for the app and API, GitHub Actions for rendering and scheduled jobs |
| Repo | github.com/YoNishu/entangledd-studio |

## Features

1. **Daily quote suggestions** from a mix of sources. Every suggestion shows its source.
   - Reference books: titles she has read. Public-domain books are read in full; for modern
     books, well-known quotes credited to the author, plus her imported highlights.
   - Reference Instagram accounts: handles she adds. Top posts by likes, comments and views.
   - Her own quotes: typed in, or scanned from a photo of a book page.
2. **Reel maker**: quote + optional background image + optional music -> MP4.
3. **Edit with Claude**: after picking a quote, a chat to reword it ("shorter", "more poetic").
4. **Post to Instagram** with caption and hashtags, after a tap.
5. **Analytics and learning loop**: nightly pull of reach, likes, comments, saves and shares.
   Quotes are tagged (theme, tone, length, author); her picks and rejections and each reel's
   results steer later suggestions.
6. **Nishiii**: a chat bar on every screen that can run any of the above.

Extras, in rough priority order: attribution check, duplicate guard, caption and hashtag
generator, approval queue with best-time hints, brand templates, carousel/story versions,
weekly report, comment reply drafts.

## Build order

| Stage | What | Status |
|---|---|---|
| 1 | Reel renderer and GitHub workflows | Done |
| 2 | Composer: photo/video background, styles, drag and pinch, image export | Done |
| 3 | Server: passcode, reels created from the phone | Done, live |
| 4 | Quotes: Today's suggestions, Library, page scan, rewording, free footage (Pixabay) | Done, live |
| 5 | Instagram: connect, captions, music, tap to post reels | Done, live; first real posts made |
| 6 | Post results: reach, views, likes, comments, saves, shares; deleted posts drop off | Built against a stand-in; first run on real posts pending |
| 7 | Inspiration: accounts (top posts), reel links, screenshots read by Claude | Built against a stand-in; first real run pending |
| 8 | Taste profile: what Nishiii has learned, her notes, daily update, used in every suggestion | Built against a stand-in; first real run pending |
| 8b | Films and series as sources; quotes on request from any mix of her sources; Face ID lock; Settings | Built; Face ID tested with a simulated authenticator, first run on a real iPhone pending |
| 5b | Carousel posts (needs a 4:5 canvas) | Next |
| 9 | Nishiii as a chat bar that can run any task | Next |
| 10 | Quotes from public-domain book text; imported highlights | Later |
| 11 | Extras: attribution check, queue and best-time hints, saved styles, more fonts, weekly report, comment reply drafts, HDR clips | Later |

## How the app is laid out

| Section | What it holds |
|---|---|
| Today | The day and date, and exactly five suggestions: Use this, Reword, Skip |
| Create | The composer. Tabs: Background, Text, Style, Finish |
| Library | What she feeds Nishiii: her own quotes, books, films and series, and reels and pages she loves |
| Posts | Everything posted from the app with its numbers |
| Settings (top right) | Face ID lock, the Instagram connection, signing out |
| Nishiii | Ask for five quotes from chosen books, films, series or pages (kept here, apart from Today); what Nishiii has learned about her taste; notes she writes for Nishiii |

## How Nishiii learns (the taste profile)

Evidence is collected as she uses the app: quotes she picks and skips, how she asks for
rewording, her own saved lines, her posts and their numbers, and the reels, accounts and
screenshots she adds as inspiration. Each morning (and on "Update now") Claude is given the
previous profile, her notes and the recent evidence, and writes the updated profile: a short
summary plus lists of what she is drawn to, what she passes over, wording, look, and what has
worked on her page. Because each update starts from the previous profile, it keeps what was
learned long ago even after the raw evidence has aged out. The profile and her notes are sent
with every request for suggestions, rewording and captions. Lines from other creators are used
only to understand her taste and are never suggested back.

## Reel look (from the three reference posts)

- Full-bleed nature photo or video, not darkened.
- Small, still text: it takes up a small patch of the frame and does not animate.
- Styles: Sea (cream serif, centred), Horizon (small lowercase serif), Whisper (italic sans,
  staggered lines, free placement).
- Backgrounds: her own photos and videos from the iPhone, or free stock footage found in-app.
- The app draws the text layer; the renderer only lays it over the background, so the preview
  and the finished reel always match.

## Limits to remember

- Fonts bundled so far: Lora and Poppins. More can be added by putting the .ttf in `web/fonts`
  and listing it in `web/app.js`.
- iPhone clips recorded in HDR may look washed out after rendering until tone-mapping is added.

- Reels carry no watermark by default.
- Reel text must fit a safe box; the renderer rejects quotes over roughly 800 characters.
- Quotes from modern books and other creators are their authors' work. Always credit; prefer
  public-domain sources and her own writing.
- The "learning" is a feedback loop over stored stats and choices, not model training. It needs
  about 30 posts before patterns are meaningful.
- Secrets (Instagram token, Anthropic key) live in Cloudflare/GitHub secrets, never in the repo.
