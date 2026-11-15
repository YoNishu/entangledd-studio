// Pretend versions of the web with no paid allowance (server/opensearch.js): DuckDuckGo's plain results page, Bing's
// results page, Tavily, Serper, and the pages their results point to. Loaded by server/dev.mjs; never part of the
// real app. Every work, page and line here is made up; only the shapes are the real services' shapes.
//
//   OPEN_SEARCH=on                the layer is used (off unless set, so the older tests see the app as it was)
//   DDG=ok|blocked|captcha|empty  how DuckDuckGo answers (blocked: 202 with its "bots use DuckDuckGo too" page)
//   BING=ok|blocked               how Bing answers
//   TAVILY=on, SERPER=on          a key for Tavily or Serper is set
//   GET /__open_set?ddg=..&bing=..&tavily=on|off&serper=on|off   changes these while running
//   GET /__open_log               every request these pretend services received (?reset=1 empties it)
//   "The Late Thaw" is the made-up 2026 Chinese drama of devparts/findlines.mjs (春迟, with Lin Qiao and Shen Mo).
//   Its results point to a fan blog with its lines, a page about the season (not about the drama), a page larger
//   than the app reads, and posts on Instagram and Pinterest whose snippets carry the same line.
const TAVILY_KEY = "dev-tavily-key", SERPER_KEY = "dev-serper-key";
const mode = { ddg: process.env.DDG || "ok", bing: process.env.BING || "ok", tavily: process.env.TAVILY || "off", serper: process.env.SERPER || "off" };
let log = [], at = "";

export function env(PORT) {
  at = `http://localhost:${PORT}`;
  return { DDG_SITE: at + "/__ddg", BING_SITE: at + "/__bing", TAVILY_API: at + "/__tavily", SERPER_API: at + "/__serper", OPEN_DEV_HOSTS: `localhost:${PORT}`, MDL_SITE: at + "/__mdl",
    OPEN_SEARCH: process.env.OPEN_SEARCH === "on" ? "on" : "off",
    ...(process.env.CLAUDE === "off" ? { ANTHROPIC_API_KEY: "" } : {}),      // Nishiii switched off: lines are picked without Claude
    ...(mode.tavily === "on" ? { TAVILY_API_KEY: TAVILY_KEY } : {}), ...(mode.serper === "on" ? { SERPER_API_KEY: SERPER_KEY } : {}) };
}

// ---------------------------------------------------------------- the pages
const BLOG = () => `<!doctype html><html><head><title>The Late Thaw quotes</title><style>.x{color:red}</style><script>var lines = "Not a line: this sits in a script and is never read.";</script></head>
<body><nav>Home · Dramas · About</nav><article><h1>The Late Thaw (春迟): my favourite lines</h1>
<p>The 2026 Chinese drama The Late Thaw, with Lin Qiao and Shen Mo, ended last week. Here are the lines I keep coming back to.</p>
<blockquote>“You don't have to bloom early to be worth the wait.” — Xia Lan</blockquote>
<blockquote>“I kept the window open all winter, in case you came back with the spring.” — Lu Yan</blockquote>
<blockquote>“Some rivers only learn to move after the ice has had its say.” — Xia Lan</blockquote>
<p>Not from the drama, but it fits: “The season turns whether or not we are ready for it.” — a line from another show, Paper Lanterns</p>
</article><footer>© a fan blog</footer></body></html>`;
const SEASON = () => `<!doctype html><html><body><h1>Late thaw and early spring quotes to welcome the season</h1>
<p>When the late thaw comes, the world softens. Our favourite lines about the season:</p>
<blockquote>“The late thaw teaches the river patience, and the river teaches us.” — Anonymous</blockquote>
<blockquote>“Every spring is a promise the earth keeps quietly.” — Old proverb</blockquote></body></html>`;
const HUGE = () => `<!doctype html><html><body><h1>The Late Thaw (春迟), 2026 Chinese drama: every episode</h1><p>${"Recap filler text for the episode. ".repeat(16000)}</p>
<blockquote>“This line sits past the reading limit of the page, so it is never read.” — Xia Lan</blockquote></body></html>`;
const HOPE = () => `<!doctype html><html><body><h1>Quotes about hope from books, films and series</h1>
<blockquote>“Hope is the thing that keeps the light on in the window.” — Ada Vey, The Lamplighter's Year</blockquote>
<blockquote>“We are not late; we are only on our way.” — Teo Brandt, Northbound</blockquote>
<p>Unattributed: “Some days are only for getting through, and that is enough.”</p></body></html>`;
const MDL = () => `<!doctype html><html><body><h1>The Late Thaw (2026)</h1><p>春迟 · Chinese Drama · 36 episodes. Starring Lin Qiao and Shen Mo.</p><p>A florist who left her town returns in the last week of winter.</p><p>${"Reviews and details. ".repeat(20)}</p></body></html>`;
const PAGES = { "thaw-mdl": MDL, "thaw-blog": BLOG, "spring-season": SEASON, "thaw-huge": HUGE, "hope-quotes": HOPE };

const HARBOUR_WIKI = `Harbour in March (Chinese: 三月的港) is a 2026 Chinese television series starring Lin Qiao and Shen Mo.
Plot
A ferry pilot returns to the harbour town she left ten years ago.
Reception
The series was praised for its quiet pacing.
References
1. ^ Zhao, Min (March 3, 2026). "Harbour dramas find a second wind with younger viewers". The Coast Daily. Retrieved March 9, 2026.
2. ^ "Quiet romances lead the spring line-up". Screen Weekly. March 1, 2026.`;
const HARBOUR_REVIEWS = `Harbour in March (2026) Reviews - MyDramaList
Harbour in March (2026) 三月的港 Chinese Drama, 30 episodes
Story 9.0 Acting/Cast 9.0 Music 8.5 Rewatch Value 8.0
A slow one, and worth it. Significant Quotes
Xu Wan: You can leave a harbour, but it keeps your place.
Han Zhou: I waited for the tide so long that I forgot I could swim.
“Some goodbyes are only the sea taking a breath.” said Xu Wan in the last episode, and I cried.
The acting was fine and the pacing was slow in the middle. 8/10 from me.`;
const HARBOUR_PLAIN = [
  { url: "https://www.tiktok.com/@cdramalines/video/1", title: "TikTok", content: "Harbour in March lines", score: 0.8, raw_content: "Harbour in March 2026 " + "clip ".repeat(80) },
  { url: "https://en.wikipedia.org/wiki/Harbour_in_March", title: "Harbour in March - Wikipedia", content: "Harbour in March is a 2026 Chinese television series.", score: 0.8, raw_content: HARBOUR_WIKI },
  { url: "https://www.instagram.com/p/Harbour01/", title: "Instagram", content: "Harbour in March 2026", score: 0.7, raw_content: "Harbour in March 2026 " + "post ".repeat(80) },
  { url: "https://www.facebook.com/harbourinmarch", title: "Facebook", content: "Harbour in March", score: 0.6, raw_content: null }];
const HARBOUR_SITES = [
  { url: "https://mydramalist.com/9911-san-yue-de-gang/reviews", title: "Harbour in March (2026) Reviews - MyDramaList", content: "Harbour in March (2026) 三月的港 reviews", score: 0.9, raw_content: HARBOUR_REVIEWS }];

// The results for a query, in the order a search engine gives them.
function resultsFor(q) {
  const s = q.toLowerCase();
  if (s.includes("late thaw") || q.includes("春迟")) return [
    { url: at + "/__web/thaw-mdl", title: "The Late Thaw (2026) - MyDramaList", snippet: "春迟 · Chinese Drama · 2026, 36 episodes. Starring Lin Qiao and Shen Mo. A florist who left her town returns in the last week of winter." },
    { url: "https://www.instagram.com/p/LateThaw02/", title: "Instagram", snippet: "The Late Thaw 春迟 2026 drama ✿ “Some people arrive like spring: late, and all at once.” #thelatethaw" },
    { url: at + "/__web/thaw-blog", title: "The Late Thaw (春迟): my favourite lines", snippet: "The 2026 Chinese drama The Late Thaw, with Lin Qiao and Shen Mo ... lines I keep coming back to." },
    { url: at + "/__web/spring-season", title: "Late thaw and early spring quotes to welcome the season", snippet: "When the late thaw comes, the world softens. Our favourite lines about the season." },
    { url: "https://www.pinterest.com/pin/8801/", title: "Pinterest", snippet: "The Late Thaw (春迟) cdrama quote: “Some people arrive like spring: late, and all at once.”" },
    { url: at + "/__web/thaw-huge", title: "The Late Thaw recap, every episode", snippet: "The Late Thaw (春迟) 2026 Chinese drama, every episode." },
  ];
  if (s.includes("quotes about") || s.includes("hope") || s.includes("keeps the light on") || s.includes("only on our way")) return [
    { url: "https://www.facebook.com/hopequotes", title: "Facebook", snippet: "Quotes about hope." },
    { url: at + "/__web/hope-quotes", title: "Quotes about hope from books, films and series", snippet: "Hope is the thing that keeps the light on in the window." }];
  return [];
}
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
// DuckDuckGo's plain page, in its real layout: the address of each result inside "uddg" of a duckduckgo.com/l/ link.
const ddgPage = (list) => `<!DOCTYPE html><html><head><title>results at DuckDuckGo</title></head><body><div id="links" class="results">`
  + list.map((r) => `<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}&amp;rut=abc123">${esc(r.title)}</a></h2>`
    + `<div class="result__extras"><a class="result__url" href="${esc(r.url)}">${esc(r.url)}</a></div><a class="result__snippet" href="${esc(r.url)}">${esc(r.snippet).replace(/Late Thaw/g, "<b>Late Thaw</b>")}</a><div class="clear"></div></div></div>`).join("")
  + `</div></body></html>`;
// Bing's page: <li class="b_algo">, links through bing.com/ck/a with the address in "u" as a1 + base64.
const bingPage = (list) => `<!DOCTYPE html><html><body><ol id="b_results">` + list.map((r) => `<li class="b_algo"><div class="b_tpcn"></div><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${Buffer.from(r.url).toString("base64url")}&amp;ntb=1">${esc(r.title)}</a></h2><div class="b_caption"><p>${esc(r.snippet)}</p></div></li>`).join("") + `</ol></body></html>`;
const bingRss = (list) => `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing: results</title>`
  + list.map((r) => `<item><title>${esc(r.title)}</title><link>${esc(r.url)}</link><description>${esc(r.snippet)}</description><pubDate>Sun, 15 Nov 2026 10:00:00 GMT</pubDate></item>`).join("") + `</channel></rss>`;

// MyDramaList, in the shape its search and reviews pages really have (seen on the live run): a work only for
// "The Quiet Orchard" (two works of that name, 2011 and 2026); every other search finds nothing.
const MDL_SEARCH = (q) => `<!doctype html><html><head><title>Search results - MyDramaList</title></head><body><div class="col-lg-8">`
  + (/quiet orchard/i.test(q) ? [["901-the-quiet-orchard", "The Quiet Orchard", "Taiwanese Drama - 2011, 20 episodes"], ["7702-jing-guo-yuan", "The Quiet Orchard", "Chinese Drama - 2026, 30 episodes"]]
    .map(([path, title, about]) => `<div class="box"><div class="cover"><a href="/${path}" class="block"><img alt="${title}" src="x.jpg"></a></div><div class="content"><h6 class="text-primary title"><a href="/${path}">${title}</a></h6><span class="text-muted">${about}</span></div></div>`).join("") : "<p>No results found.</p>")
  + `</div></body></html>`;
const MDL_REVIEWS = () => `<!doctype html><html><head><title>The Quiet Orchard (2026) Reviews - MyDramaList</title><script>var x = "Not a line: in a script.";</script></head><body>
<h1>The Quiet Orchard (2026) Reviews</h1><div class="review">Story 9.0 Acting/Cast 9.0 Music 8.0 Rewatch Value 8.0 This review may contain spoilers <b>Slow, gentle and true..</b> Oh my heart.. Significant Quotes Jiang Yu: You don’t have to hurry to arrive where you belong. Lin Qing: I kept every letter, even the ones I never sent. 💗The Harvest💗 "Some things only grow when no one is watching them. That is why I waited." 💗 Also, I loved how the drama ends.</div>
<div class="review">Story 7.0 The pacing was slow. “Spring is the time of plans and projects.” — Leo Tolstoy, as my teacher used to say.</div></body></html>`;
function mdl(send, path, q) {
  if (path === "/search") return send(200, MDL_SEARCH(q), "text/html; charset=utf-8");
  if (path === "/7702-jing-guo-yuan/reviews") return send(200, MDL_REVIEWS(), "text/html; charset=utf-8");
  return send(404, "<html>Not found</html>", "text/html");
}
const ANOMALY = `<!DOCTYPE html><html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div><div>Please complete the following challenge to confirm this search was made by a human.</div></body></html>`;
const plainText = (html) => html.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, "\n").replace(/\n\s*\n+/g, "\n").trim();

// ---------------------------------------------------------------- the pretend Claude, picking from those pages
// Picks every “line” — Speaker[, Work] on the pages it is shown, says it is from the work asked about (or the work the
// page names), and adds one made-up line and one with words changed, both of which the server must reject.
function pick(content) {
  const work = (/^Work: .*?"([^"]+)"/m.exec(content) || [])[1] || "";
  const out = [{ page: 1, text: "This sentence is on no page at all, not anywhere.", by: "Nobody", from: work }];
  for (const block of content.split(/--- page (\d+) \([^)]*\) ---\n/).reduce((acc, x, i, all) => (i % 2 ? acc.concat([[Number(x), all[i + 1]]]) : acc), [])) {
    const [n, text] = block;
    for (const m of text.matchAll(/[“"]([^”"]{15,300})[”"]\s*—\s*([^,\n]+?)(?:,\s*([^\n]+?))?\s*$/gm)) {
      const other = /another show/.test(m[2]);
      out.push({ page: n, text: m[1], by: other ? "" : m[2].trim(), from: other ? (m[3] || "").trim() : work || (m[3] || "").trim(), theme: "spring", tone: "quiet" });
    }
  }
  if (out.length > 1) out.push({ page: out[1].page, text: out[1].text.replace(/\bthe\b/, "a") + " Changed.", by: out[1].by, from: out[1].from });
  return out;
}

// ---------------------------------------------------------------- answering
export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out, type = "application/json", headers = {}) => { res.writeHead(status, { "Content-Type": type, ...headers }).end(typeof out === "string" ? out : JSON.stringify(out)); return true; };
  if (p === "/__open_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (p === "/__open_set") {
    for (const [k, v] of url.searchParams) if (k in mode) mode[k] = v;
    for (const [k, name, key] of [["tavily", "TAVILY_API_KEY", TAVILY_KEY], ["serper", "SERPER_API_KEY", SERPER_KEY]]) { if (mode[k] === "on") tools.env[name] = key; else delete tools.env[name]; }
    if (url.searchParams.has("open")) tools.env.OPEN_SEARCH = url.searchParams.get("open");
    return send(200, mode);
  }
  if (p.startsWith("/__anthropic/")) {
    const raw = await tools.readBody(req);
    const body = JSON.parse(raw.toString() || "{}");
    // CLAUDE_PICKS=none: Claude picks nothing from any page; =offpage: only a line that is on no page.
    if (process.env.CLAUDE_PICKS && String(body.system || "").startsWith("You pick real")) {
      log.push({ to: "claude", path: "", query: {}, agent: "", content: "" });
      return send(200, { content: [{ type: "text", text: process.env.CLAUDE_PICKS === "none" ? "[]" : JSON.stringify([{ page: 1, text: "A line that is on no page anywhere, made up whole.", by: "Nobody" }]) }] });
    }
    if (!String(body.system || "").startsWith("You pick real, quotable lines from pages found on the web")) {
      const orig = req.on.bind(req);
      req.on = (ev, fn) => { if (ev === "data") queueMicrotask(() => fn(raw)); else if (ev === "end") queueMicrotask(() => queueMicrotask(fn)); else orig(ev, fn); return req; };
      return false;
    }
    if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY) return send(401, {});
    log.push({ to: "claude", path: "", query: {}, agent: "", content: body.messages[0].content });
    return send(200, { content: [{ type: "text", text: JSON.stringify(pick(body.messages[0].content)) }] });
  }
  const to = (/^\/__(ddg|bing|tavily|serper|web|mdl)\//.exec(p) || [])[1];
  if (!to) return false;
  const entry = { to, path: p.replace(/^\/__[a-z]+/, ""), query: Object.fromEntries(url.searchParams), agent: req.headers["user-agent"] || "" };
  log.push(entry);
  if (to === "ddg") {
    if (mode.ddg === "blocked") return send(202, ANOMALY, "text/html");
    if (mode.ddg === "captcha") return send(200, ANOMALY, "text/html");
    return send(200, ddgPage(mode.ddg === "empty" ? [] : resultsFor(url.searchParams.get("q") || "")), "text/html");
  }
  if (to === "mdl") return mdl(send, p.replace(/^\/__mdl/, ""), url.searchParams.get("q") || "");
  if (to === "bing" && url.searchParams.get("format") === "rss" && mode.bing !== "blocked") return send(200, bingRss(resultsFor(url.searchParams.get("q") || "")), "application/rss+xml");
  if (to === "bing") return mode.bing === "blocked" ? send(403, "<html>Forbidden</html>", "text/html") : send(200, bingPage(resultsFor(url.searchParams.get("q") || "")), "text/html");
  if (to === "tavily" || to === "serper") {
    const body = JSON.parse((await tools.readBody(req)).toString() || "{}");
    entry.body = body;
    if (to === "tavily") {
      if (req.headers.authorization !== "Bearer " + TAVILY_KEY) return send(401, { detail: { error: "Unauthorized: missing or invalid API key." } });
      // "Harbour in March" (a made-up 2026 drama): asked plainly, Tavily has only sign-in sites and its Wikipedia
      // page (a plot and a list of sources); asked for the sites where lines are written down, its reviews page.
      if (/harbour in march/i.test(body.query || "")) return send(200, { query: body.query, results: (Array.isArray(body.include_domains) && body.include_domains.includes("mydramalist.com") ? HARBOUR_SITES : HARBOUR_PLAIN)
        .filter((r) => !(body.exclude_domains || []).some((d) => new URL(r.url).hostname.endsWith(d))) });
      return send(200, { query: body.query, results: resultsFor(body.query || "").map((r) => ({ url: r.url, title: r.title, content: r.snippet, score: 0.8,
        raw_content: r.url.includes("/__web/") && !r.url.includes("huge") ? plainText(PAGES[r.url.split("/").pop()]()) : null })) });
    }
    if (req.headers["x-api-key"] !== SERPER_KEY) return send(401, { message: "Unauthorized." });
    return send(200, { searchParameters: { q: body.q }, organic: resultsFor(body.q || "").map((r, i) => ({ title: r.title, link: r.url, snippet: r.snippet, position: i + 1 })) });
  }
  // The pages, and two that send the app somewhere it must not go.
  const name = p.split("/").pop();
  if (name === "to-ftp") return send(302, "", "text/plain", { Location: "ftp://example.org/x" });
  if (name === "loop") return send(302, "", "text/plain", { Location: at + "/__web/loop" });
  if (!PAGES[name]) return send(404, "<html>Not found</html>", "text/html");
  return send(200, PAGES[name](), "text/html; charset=utf-8");
}
