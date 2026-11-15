// A pretend Tavily Extract (POST /extract, server/opensearch.js extractPages) and the pages it reads for two made-up
// works. Loaded by server/dev.mjs before devparts/opensearch.mjs and devparts/findlines.mjs; never part of the real app.
// Every work, page and line here is made up; only the shapes are the real services' shapes (Tavily's API reference,
// read 16 Nov 2026: { urls, extract_depth, format } -> { results: [{ url, raw_content }], failed_results: [{ url,
// error }], response_time, usage: { credits } }; 1 credit per 5 pages read; 401 bad key, 429 slow down with
// Retry-After, 432 allowance used up).
//
//   "The Willow Station" (柳站), a 2026 Chinese drama with Mei Lin and Zhao Feng (characters Su Qing and Gu Yan): 30
//   pages of reviews on the pretend MyDramaList, 12 reviews a page. The app's own fetch is refused there (403), on
//   its search page and its reviews; Extract reads them. The reviews hold 40 real lines (with and without a speaker,
//   some repeated on later pages), reviewers' own remarks in quotation marks, and a cited headline; pages 25 to 30
//   hold only remarks and repeats. Tavily's search finds its reviews page (with the text of page 1), its own page and a
//   fan blog (without text), and an Instagram post.
//   "Lanterns for the Tide" by Mara Ellison, a made-up book with four Goodreads quotes pages (6 quotes each).
//
//   EXTRACT=ok|used|slow|badkey      how Extract answers (used: 432; slow: 429 with Retry-After: 30; badkey: 401)
//   GET /__extract_set?mode=..       changes that while running
//   GET /__extract_log[?reset=1]     every call to Extract ({ urls, body, status, read, failed, credits }) and every
//                                    fetch the app made itself of the made-up drama's MyDramaList pages ({ own })
const KEY = "dev-tavily-key";
const mode = { extract: process.env.EXTRACT || "ok" };
let log = [], at = "";

export function env(PORT) { at = `http://localhost:${PORT}`; return {}; }

// ---------------------------------------------------------------- the made-up drama
const PATH = "/771234-liu-zhan";
const MDL = "https://mydramalist.com" + PATH;
const LINES = [
  "In the last week of winter, even the trains run slower for the people who are leaving.",
  "The first time I waited for you here, the platform lights were still broken.",
  "You don't have to buy a ticket to be allowed to stay a while.",
  "Every willow by these tracks was planted by someone who did not want to be forgotten.",
  "I kept the timetable from that year because it was the last thing you gave me.",
  "Have you ever missed a train on purpose?",
  "Some people leave so quietly that you only notice when the tea goes cold.",
  "The station is not where we said goodbye, it is where I learned to wait.",
  "If the snow stops by morning, I will tell you everything I never said.",
  "You always sat on the left side, so you could see the river first.",
  "I am not brave, I just stopped running before you did.",
  "A town this small remembers every footstep on the bridge.",
  "The last train leaves at ten, but I have never once been on it.",
  "Do you think the willows know when spring is late?",
  "My mother said a station is a house with too many doors.",
  "I did not come back for the town, I came back for the sound of the bell.",
  "The ticket was one way, but my heart never bought it.",
  "We were never late, we were only waiting for the right train.",
  "When you laugh like that, the whole platform forgets the cold.",
  "You can carry a suitcase for years and still not be ready to open it.",
  "I painted the bench by the clock so you would know which one was ours.",
  "Home is the place where someone keeps the light on past the last arrival.",
  "Even the river slows down when it passes this station.",
  "I wrote your name on the frost every morning until the frost gave up.",
  "Not every goodbye needs a whistle to be heard.",
  "The willow bends because it trusts the wind to let it go.",
  "You were the only stop I ever wanted to miss.",
  "Waiting is just loving someone in the wrong tense.",
  "Some mornings the fog is kind and hides how much I miss you.",
  "I learned the timetable by heart so I would never have to ask anyone when you were coming.",
  "If you stay, I will learn to like the cold.",
  "The bridge was never the problem, it was what we left on the other side.",
  "You came back on a Tuesday, and Tuesdays have been warm ever since.",
  "No one leaves a town like this, they just carry it further.",
  "I counted the lanterns on the line so I would not count the days.",
  "There is no schedule for the heart, only arrivals.",
  "Let the station keep our secrets, it has kept everyone else's.",
  "Before you go, tell me which window you will look out of.",
  "The rain here has a way of asking you to stay.",
  "We met where the tracks bend, and nothing has been straight since.",
];
const WHO = ["Su Qing", "Gu Yan"];
// Reviewers' own words in quotation marks, each in the voice of a reviewer (what only the words around tell apart).
const REMARKS = [
  ["When the first episode ended I was like ", "Oh, this is going to be SO good."],
  ["Episode twelve had me yelling at my screen, ", "Wait, did that really just happen?!"],
  ["Honestly, ", "The rest of the actors are wonderful, and the writing is top-notch."],
  ["Me, at two in the morning: ", "Just one more episode and then I sleep."],
  ["My first impression was ", "Another slow small-town romance, how original."],
  ["I kept saying ", "Please let them be happy for once."],
];
const HEADLINE = `As the Screen Daily headline put it, "Willow Station Becomes the Quiet Hit of the Spring". March 3, 2026.`;
// The lines first written on each page: two a page on 1 to 16, one a page on 17 to 24, none after.
const linesOf = (p) => (p <= 16 ? [2 * (p - 1), 2 * (p - 1) + 1] : p <= 24 ? [32 + (p - 17)] : []);
const said = (i) => {
  const t = LINES[i];
  if (i % 3 === 0) return `The scene at the platform wrecked me. "${t}" (${WHO[i % 2]})`;
  if (i % 3 === 1) return `Significant quotes\n${WHO[i % 2]}: ${t}`;
  return `My favourite line of the whole show: "${t}" I wrote it down.`;
};
const FILL = "The pacing was gentle and the music fit every scene. I watched it over two weekends with my sister.";
const review = (n, body) => `### Review ${n}\nStory 8.5 Acting/Cast 9.0 Music 8.0 Rewatch Value 7.5 Overall 8.5\n${body}\n${FILL}\n`;
function reviewsMd(p, links = true) {
  const parts = [];
  const lines = linesOf(p), again = p >= 3 ? [2 * ((p - 3) % 16)] : [];          // a line from an earlier page, again
  for (let r = 1; r <= 12; r++) {
    let body = "A quiet, lovely drama about a station and the people who wait there.";
    if (r === 2 && lines[0] !== undefined) body = said(lines[0]);
    if (r === 5 && lines[1] !== undefined) body = said(lines[1]);
    if (r === 8 && again.length) body = said(again[0]);
    if (r === 3 || r === 10) { const [b, q] = REMARKS[(p * 2 + r) % REMARKS.length]; body = `${b}"${q}" ${r === 3 ? "and I was right." : "That was me all week."}`; }
    if (r === 11 && (p === 2 || p === 9)) body = HEADLINE;
    parts.push(review((p - 1) * 12 + r, body));
  }
  const pager = links ? `\n${[1, 2, 3, p - 1, p, p + 1, 30].filter((n, i, a) => n >= 1 && n <= 30 && a.indexOf(n) === i).map((n) => `[${n}](${MDL}/reviews?page=${n})`).join(" ")} [Next](${MDL}/reviews?page=${Math.min(30, p + 1)}) [Last](${MDL}/reviews?page=30)\n` : "";
  return `# The Willow Station (2026) Reviews\n![poster](https://i.mydramalist.com/willow.jpg)\nThe Willow Station 柳站 · Chinese Drama · 2026, 28 episodes. Starring Mei Lin and Zhao Feng.\n\n${parts.join("\n")}${pager}`;
}
const SEARCH_MD = `# Search results\n![cover](https://i.mydramalist.com/x.jpg)\n[The Willow Station](${MDL})\nChinese Drama - 2026, 28 episodes\n\n[Willow Lane](https://mydramalist.com/5501-willow-lane)\nKorean Drama - 2019, 16 episodes\n`;
const BLOG_MD = `# The Willow Station: lines I can't forget\nThe 2026 Chinese drama The Willow Station, with Mei Lin and Zhao Feng, is my comfort show this year.\n\n> “${LINES[0]}” — Su Qing\n\n> “${LINES[38]}” — Gu Yan\n\n> “${LINES[39]}” — Su Qing\n`;
const BLOG = "https://willowstationfans.example.org/lines";

// ---------------------------------------------------------------- the made-up book on Goodreads
const BOOK = { title: "Lanterns for the Tide", author: "Mara Ellison", id: "55501" };
const OPEN = ["The tide comes back for everything it borrows", "A lantern is a promise held in one hand", "We were salt and we were patient once",
  "No harbour keeps a heart that wants to sail", "She folded the old map into her winter coat", "The sea never apologised and neither did she"];
const END = ["and the morning forgave us anyway.", "so we learned to wait without counting.", "but nobody in the village believed it.", "until the lighthouse keeper finally slept."];
const BOOK_LINES = Array.from({ length: 24 }, (_, i) => `${OPEN[i % 6]}, ${END[Math.floor(i / 6)]}`);
const grPage = (n) => `<!doctype html><html><head><title>Lanterns for the Tide Quotes by Mara Ellison</title></head><body><h1>Lanterns for the Tide Quotes</h1>`
  + BOOK_LINES.slice((n - 1) * 6, n * 6).map((t) => `<div class="quote"><div class="quoteText">“${t}” <br>  ―  <span class="authorOrTitle">Mara Ellison,</span> <a class="authorOrTitle" href="/work/quotes/${BOOK.id}">Lanterns for the Tide</a></div></div>`).join("")
  + `<div class="pagination">${[1, 2, 3, 4].map((k) => `<a href="/work/quotes/${BOOK.id}?page=${k}">${k}</a>`).join(" ")}</div></body></html>`;
const grMd = (n) => `# Lanterns for the Tide Quotes\n` + BOOK_LINES.slice((n - 1) * 6, n * 6).map((t) => `“${t}”\n― Mara Ellison, [Lanterns for the Tide](https://www.goodreads.com/work/quotes/${BOOK.id})`).join("\n\n")
  + `\n\n${[1, 2, 3, 4].map((k) => `[${k}](https://www.goodreads.com/work/quotes/${BOOK.id}?page=${k})`).join(" ")}`;

// What Extract reads at an address (markdown), or "" for an address it cannot read.
function readAt(u) {
  let x;
  try { x = new URL(u); } catch (e) { return ""; }
  const page = Number(x.searchParams.get("page") || 1);
  if (x.hostname === "mydramalist.com" && x.pathname === PATH + "/reviews") return page >= 1 && page <= 30 ? reviewsMd(page) : "";
  if (x.hostname === "mydramalist.com" && x.pathname === PATH) return `# The Willow Station (2026)\nThe Willow Station 柳站 · Chinese Drama · 2026. Starring Mei Lin and Zhao Feng.\n[Reviews](${MDL}/reviews)`;
  if (x.hostname === "mydramalist.com" && x.pathname === "/search" && /willow station/i.test(x.searchParams.get("q") || "")) return SEARCH_MD;
  if (u === BLOG) return BLOG_MD;
  if (x.hostname === "www.goodreads.com" && x.pathname.startsWith(`/work/quotes/${BOOK.id}`)) return page >= 1 && page <= 4 ? grMd(page) : "";
  return "";
}
const plainOf = (md) => md.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#+ /gm, "");

// Tavily's search for the made-up works (the other queries go on to devparts/opensearch.mjs).
function searchFor(body) {
  const q = String(body.query || "").toLowerCase(), sites = Array.isArray(body.include_domains) ? body.include_domains : null;
  if (q.includes("willow station")) {
    if (sites && sites.includes("mydramalist.com")) return [
      { url: `${MDL}/reviews`, title: "The Willow Station (2026) Reviews - MyDramaList", content: "The Willow Station 柳站 reviews", score: 0.9, raw_content: plainOf(reviewsMd(1, false)) }];
    return [
      { url: MDL, title: "The Willow Station (2026) - MyDramaList", content: "The Willow Station 柳站 · Chinese Drama · 2026", score: 0.8, raw_content: null },
      { url: BLOG, title: "The Willow Station: lines I can't forget", content: "The 2026 Chinese drama The Willow Station, with Mei Lin and Zhao Feng", score: 0.7, raw_content: null },
      { url: "https://www.instagram.com/p/Willow01/", title: "Instagram", content: "The Willow Station 2026", score: 0.6, raw_content: null }];
  }
  if (q.includes("lanterns for the tide")) return [
    { url: `https://www.goodreads.com/work/quotes/${BOOK.id}`, title: "Lanterns for the Tide Quotes by Mara Ellison", content: "Lanterns for the Tide quotes", score: 0.9, raw_content: null }];
  return null;
}

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out, type = "application/json", headers = {}) => { res.writeHead(status, { "Content-Type": type, ...headers }).end(typeof out === "string" ? out : JSON.stringify(out)); return true; };
  if (p === "/__extract_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (p === "/__extract_set") { if (url.searchParams.has("mode")) mode.extract = url.searchParams.get("mode"); return send(200, mode); }
  // The app's own fetch of the made-up drama's MyDramaList pages: refused, as the real site refuses the app.
  if (p.startsWith("/__mdl/") && (p.startsWith("/__mdl" + PATH) || (p === "/__mdl/search" && /willow station/i.test(url.searchParams.get("q") || "")))) {
    log.push({ own: p + url.search });
    return send(403, "<html><body>Access denied</body></html>", "text/html");
  }
  // The made-up book on the pretend Goodreads (read by the app itself).
  if (p === "/__goodreads/book/auto_complete" && /lanterns for the tide/i.test(url.searchParams.get("q") || "")) return send(200, [{ workId: Number(BOOK.id), bookTitleBare: BOOK.title, title: BOOK.title, author: { name: BOOK.author } }]);
  if (p === `/__goodreads/work/quotes/${BOOK.id}`) { log.push({ own: p + url.search }); return send(200, grPage(Number(url.searchParams.get("page") || 1)), "text/html; charset=utf-8"); }
  if (req.method !== "POST" || !p.startsWith("/__tavily/")) return false;
  const raw = await tools.readBody(req);
  const body = JSON.parse(raw.toString() || "{}");
  if (p === "/__tavily/search") {
    const list = searchFor(body);
    if (!list) {
      // Not one of these works: put the body back for devparts/opensearch.mjs.
      const orig = req.on.bind(req);
      req.on = (ev, fn) => { if (ev === "data") queueMicrotask(() => fn(raw)); else if (ev === "end") queueMicrotask(() => queueMicrotask(fn)); else orig(ev, fn); return req; };
      return false;
    }
    if (req.headers.authorization !== "Bearer " + KEY) return send(401, { detail: { error: "Unauthorized: missing or invalid API key." } });
    log.push({ search: body.query, sites: body.include_domains || null, body });
    return send(200, { query: body.query, results: list.filter((r) => !(body.exclude_domains || []).some((d) => new URL(r.url).hostname.endsWith(d))) });
  }
  if (p !== "/__tavily/extract") return send(404, { detail: { error: "Not found" } });
  const urls = Array.isArray(body.urls) ? body.urls : [body.urls].filter(Boolean);
  const entry = { urls, body, status: 200, read: 0, failed: 0, credits: 0 };
  log.push(entry);
  if (req.headers.authorization !== "Bearer " + KEY || mode.extract === "badkey") return send((entry.status = 401), { detail: { error: "Unauthorized: missing or invalid API key." } });
  if (mode.extract === "used") return send((entry.status = 432), { detail: { error: "This request exceeds your plan's set usage limit." } });
  if (mode.extract === "slow") return send((entry.status = 429), { detail: { error: "Rate limit exceeded." } }, "application/json", { "Retry-After": "30" });
  if (!urls.length || urls.length > 20) return send((entry.status = 400), { detail: { error: "Between 1 and 20 URLs." } });
  const results = [], failed_results = [];
  for (const u of urls) {
    const md = readAt(String(u));
    if (md) results.push({ url: u, raw_content: body.format === "text" ? plainOf(md) : md, images: [] });
    else failed_results.push({ url: u, error: "Failed to fetch url" });
  }
  Object.assign(entry, { read: results.length, failed: failed_results.length, credits: Math.ceil(results.length / 5) });
  return send(200, { results, failed_results, response_time: 0.4, usage: { credits: entry.credits }, request_id: "dev-" + log.length });
}
