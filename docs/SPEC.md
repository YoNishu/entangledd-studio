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
| 1 | Reel maker (renderer + GitHub workflow) | Done |
| 2 | Composer app: photo/video background, styles, drag and pinch, image export | Done |
| 3 | Server: passcode, video and photo reels made from the phone | Built; needs the three secrets set |
| 3a | Free footage search, carousel posts | Next |
| 3b | Publishing to Instagram | Needs the Meta developer app settings |
| 4 | Daily suggestions, reference books/accounts, her own quotes, scan | Needs the Anthropic API key |
| 5 | Edit with Claude and Nishiii | Needs the Anthropic API key |
| 6 | Analytics and learning loop | After the first posts exist |
| 7 | Extras | |

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
