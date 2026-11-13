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
| 3 | Server: passcode, reels made from the phone | Done, working on the live app |
| 4 | Quotes: Today's suggestions, Library (own quotes, books, accounts), page scan, rewording with Nishiii, free footage search | Built; needs `ANTHROPIC_API_KEY` and `PIXABAY_API_KEY` |
| 5 | Instagram: connect the account, caption and hashtags, tap to post reels and carousels, music from Instagram's library | Next |
| 6 | Insights: nightly stats pull, what-works view, results feeding the suggestions | After 5 |
| 7 | Reference accounts: their top posts and numbers, read into suggestions | After 5 |
| 8 | Nishiii as a chat bar that can run any task in the app | After 5 |
| 9 | Book text: full-text quotes from public-domain books, imported highlights | Later |
| 10 | Extras: attribution check, duplicate guard across posts, queue and best-time hints, saved styles, more fonts, weekly report, comment reply drafts, HDR clips | Later |

### How suggestions learn today

Each "Use this" and "Skip" is recorded with the quote's theme and tone, and the last 30 of each
are given to Claude when it picks the next batch. Her own saved quotes are mixed in word for word.
Results from Instagram (reach, likes, saves) join this once stage 6 exists.

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
