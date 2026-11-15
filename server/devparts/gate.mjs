// A pretend Claude for the gate's judge (server/said.js): for each numbered line, "said", "narration" (when the
// work is a book), "about" or "unsure". And the web for one made-up series, "Bright Bloom" (2025): its results
// point to a Wikipedia-like page (an episode list, a reception part, a list of references), the same page as
// plain text (as a search service sends pages), and a fan blog with its real lines, a critic's words and the
// poster's tagline. Loaded by server/dev.mjs before the other web stand-ins; never part of the real app.
//   A line is "about" when it praises or describes the work from outside (praised, hailed, fans, critics,
//   audiences, viewers, "this drama", "recommend"); "unsure" when it holds the word "unsure"; else "said", or
//   "narration" for a book.
//   SAID=down                  the judge answers 500 (Claude cannot be asked): only lines with proof stay
//   GET /__said_set?mode=on|down   changes that while running
//   GET /__said_log            every question the judge received ({ work, lines }), in order (?reset=1 empties it)
let log = [], at = "";

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const WIKI = `<!DOCTYPE html><html><head><title>Bright Bloom (TV series) - Wikipedia</title></head><body><nav>Main page · Contents</nav>
<h1>Bright Bloom (TV series)</h1>
<p><b>Bright Bloom</b> is a 2025 South Korean television series, a drama about a florist who returns to her seaside town.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>
<div class="mw-heading mw-heading2"><h2 id="Synopsis">Synopsis</h2></div>
<p>Han Yeo-reum is a florist who reopens her late mother's shop and finds that "every season gives back what the last one took."</p>
<div class="mw-heading mw-heading2"><h2 id="Episodes">Episodes</h2></div>
<table class="wikitable"><tr><td>1</td><td>"The day the shop opened again, nobody came in"</td></tr><tr><td>2</td><td>"Some flowers only open in the rain, she said"</td></tr></table>
<div class="mw-heading mw-heading2"><h2 id="Reception">Reception</h2></div>
<p>Critics called it "A quiet triumph of a drama, warm and never in a hurry."</p>
<div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
<div class="reflist"><ol class="references"><li id="cite_note-1"><span class="reference-text"><cite class="citation news cs1">Lee, Min (March 3, 2025). <a href="https://example.org/">"Bright Bloom: florist drama based on a webtoon hailed by TV viewers"</a>. <i>The Seoul Daily</i>. Retrieved March 5, 2025.</cite></span></li></ol></div>
</body></html>`;
const NOTES = `Bright Bloom is a 2025 South Korean television series, a drama about a florist who returns to her seaside town.
== Episodes ==
1 "The day the shop opened again, nobody came in"
== References ==
^ Lee, Min (March 3, 2025). "Bright Bloom: florist drama based on a webtoon hailed by TV viewers". The Seoul Daily. Retrieved March 5, 2025.
^ Park, Ji-hoon (April 1, 2025). "Viewers cannot stop talking about the ending of the flower shop drama". Daily Screen. Archived from the original on April 2, 2025.`;
const BLOG = `<!DOCTYPE html><html><head><title>Bright Bloom: the lines I loved</title></head><body><article><h1>Bright Bloom (2025 drama): the lines I loved</h1>
<p>The drama Bright Bloom ended on Sunday. These are the lines I wrote down.</p>
<blockquote>“I water the flowers you left, every single morning.” — Han Yeo-reum</blockquote>
<blockquote>“Some roots hold on longest in the coldest ground.” — Seo Ji-an</blockquote>
<p>My favourite line: "Maybe we were never late, maybe the spring came early." and then the rain started.</p>
<p>One review summed it up: “A gentle story that fans will treasure for years.”</p>
<p>The poster's tagline reads “Every flower opens in its own season.”</p>
</article></body></html>`;
const PAGES = { "bloom-wiki": [WIKI, "text/html; charset=utf-8"], "bloom-notes": [NOTES, "text/plain; charset=utf-8"], "bloom-blog": [BLOG, "text/html; charset=utf-8"] };
const RESULTS = () => [
  { url: at + "/__web/bloom-wiki", title: "Bright Bloom (TV series) - Wikipedia", snippet: "Bright Bloom is a 2025 South Korean television series, a drama about a florist." },
  { url: at + "/__web/bloom-notes", title: "Bright Bloom (2025 drama) notes", snippet: "Bright Bloom, 2025 South Korean drama: episodes and references." },
  { url: at + "/__web/bloom-blog", title: "Bright Bloom: the lines I loved", snippet: "The drama Bright Bloom ended on Sunday. These are the lines I wrote down." },
];
const ddgPage = (list) => `<!DOCTYPE html><html><head><title>results at DuckDuckGo</title></head><body><div id="links" class="results">`
  + list.map((r) => `<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}&amp;rut=abc123">${esc(r.title)}</a></h2>`
    + `<div class="result__extras"><a class="result__url" href="${esc(r.url)}">${esc(r.url)}</a></div><a class="result__snippet" href="${esc(r.url)}">${esc(r.snippet)}</a><div class="clear"></div></div></div>`).join("")
  + `</div></body></html>`;
const mode = { judge: process.env.SAID === "down" ? "down" : "on" };
const ABOUT = /\b(praised|hailed|loved by|fans|critics|audiences?|viewers|this drama|recommend)\b/i;
// What a reader of a review sees around a quoted piece (Agent 21): a reviewer's own voice just before it ("I was like",
// "Me:", "Honestly,", "I kept saying", "my first impression was", "had me yelling") makes it the reviewer's remark;
// so do words about the making ("the writing", "the actors"). Without those words around it, a line is "said".
const REVIEWER = /(\b(i was like|i kept saying|i thought|i screamed|honestly|my first impression was|my reaction was|in my head)\s*[:,]?|\bme(,? at [^:]{0,30})?:|\bhad me (yelling|screaming)[^"“]{0,40}?[,:]?)\s*$/i;
const MAKING = /\b(the (rest of the )?(actors?|acting|writing|cast|directing|pacing|script)|top-notch)\b/i;
export function standInVerdict({ text, before = "", after = "", book = false }) {
  if (ABOUT.test(text)) return "about";
  if (/\bunsure\b/i.test(text)) return "unsure";
  if (REVIEWER.test(String(before).replace(/["“']\s*$/, "")) || MAKING.test(text)) return "about";
  return book ? "narration" : "said";
}

export function env(PORT) { at = `http://localhost:${PORT}`; return {}; }

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(out)); return true; };
  if (p === "/__said_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (p === "/__said_set") { if (url.searchParams.has("mode")) mode.judge = url.searchParams.get("mode"); return send(200, mode); }
  // The made-up series' results and pages (other queries and pages are left to devparts/opensearch.mjs).
  const q = (url.searchParams.get("q") || "").toLowerCase();
  if ((p.startsWith("/__ddg") || p.startsWith("/__bing")) && q.includes("bright bloom")) {
    log.push({ to: p.startsWith("/__ddg") ? "ddg" : "bing", q });
    if (p.startsWith("/__bing")) { res.writeHead(403, { "Content-Type": "text/html" }).end("<html>Forbidden</html>"); return true; }
    res.writeHead(200, { "Content-Type": "text/html" }).end(ddgPage(RESULTS())); return true;
  }
  if (p.startsWith("/__web/") && PAGES[p.split("/").pop()]) { const [page, type] = PAGES[p.split("/").pop()]; res.writeHead(200, { "Content-Type": type }).end(page); return true; }
  if (req.method !== "POST" || !p.startsWith("/__anthropic/")) return false;
  const raw = await tools.readBody(req);
  const body = JSON.parse(raw.toString() || "{}");
  if (!String(body.system || "").startsWith("You sort lines found on the web for a quotes page")) {
    // Not the judge: put the body back for the next stand-in.
    const orig = req.on.bind(req);
    req.on = (ev, fn) => { if (ev === "data") queueMicrotask(() => fn(raw)); else if (ev === "end") queueMicrotask(() => queueMicrotask(fn)); else orig(ev, fn); return req; };
    return false;
  }
  if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY) return send(401, {});
  const content = String((body.messages && body.messages[0] && body.messages[0].content) || "");
  const work = content.split("\n")[0];
  // Each line, with the words before and after it on its page on the two lines under it (when the question has them).
  const lines = [...content.matchAll(/^(\d+)\. "(.*)" \((.*)\)$((?:\n   (?:before|after): ".*")*)/gm)].map((m) => ({ n: Number(m[1]), text: m[2], note: m[3],
    before: (/\n   before: "(.*)"/.exec(m[4] || "") || [])[1] || "", after: (/\n   after: "(.*)"/.exec(m[4] || "") || [])[1] || "" }));
  log.push({ to: "judge", work, lines, all: content });
  if (mode.judge === "down") return send(500, { error: { message: "pretend outage" } });
  const book = /^Work: the .*\bbook\b/.test(work);
  const out = lines.map((l) => ({ n: l.n, is: standInVerdict({ ...l, book }) }));
  return send(200, { content: [{ type: "text", text: JSON.stringify(out) }] });
}
