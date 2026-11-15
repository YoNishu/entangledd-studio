// Agent 12: the pieces of the web with no paid allowance, in Node. Reading DuckDuckGo's and Bing's results pages;
// a polite fetch (only https, redirects checked, at most 400 KB read, a site's "no" seen as "turned away"); which
// page names a work; snippets that agree; what a 429 means (no allowance, used up, no credit, a passing limit);
// the order of Gemini models (the ones with a free search allowance first); the address of a free book's text.
import http from "node:http";
import { readDuckDuckGo, readBing, fetchCapped, allowed, namesWork, snippetLines, rank, pageText, gutenbergText, PAGE_BYTES } from "../server/opensearch.js";
import { refusalOf, pickGemini } from "../server/findlines.js";

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 300)}`); if (!ok) failed += 1; };
const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const kit = { norm, flatten: (t) => String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim(), foundAt: (u) => u, oneLine: (t, n) => String(t || "").slice(0, n), todayIST: () => "2026-11-15" };

// ---- results pages
const ddg = `<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmydramalist.com%2F7-the-late-thaw&amp;rut=x">The <b>Late Thaw</b> (2026)</a></h2>
<a class="result__snippet" href="x">春迟 &middot; Chinese <b>Drama</b> &amp; more</a></div>
<div class="result"><h2 class="result__title"><a class="result__a" href="https://example.org/direct">Direct</a></h2><a class="result__snippet" href="y">Plain</a></div>`;
const d = readDuckDuckGo(ddg);
check("DuckDuckGo: the real address is taken out of uddg", d[0] && d[0].url === "https://mydramalist.com/7-the-late-thaw" && d[0].title === "The Late Thaw (2026)", d);
check("DuckDuckGo: snippets lose their tags and entities", d[0] && d[0].snippet.includes("Chinese Drama & more"), d);
check("DuckDuckGo: a direct link is kept as it is", d[1] && d[1].url === "https://example.org/direct", d);
const bing = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1${Buffer.from("https://fan.example.org/thaw").toString("base64url")}&amp;ntb=1">Fan page</a></h2><div class="b_caption"><p>Lines from <strong>it</strong></p></div></li>`;
const b = readBing(bing);
check("Bing: an address behind bing.com/ck/a is decoded", b[0] && b[0].url === "https://fan.example.org/thaw" && b[0].snippet === "Lines from it", b);

// ---- a polite fetch
const big = "x".repeat(PAGE_BYTES * 2);
const server = http.createServer((req, res) => {
  const p = req.url;
  if (p === "/big") return res.writeHead(200, { "Content-Type": "text/html" }).end(`<html>${big}</html>`);
  if (p === "/ftp") return res.writeHead(302, { Location: "ftp://example.org/" }).end();
  if (p === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
  if (p === "/one") return res.writeHead(301, { Location: "/ok" }).end();
  if (p === "/ok") return res.writeHead(200, { "Content-Type": "text/html" }).end(`<p>ua=${req.headers["user-agent"]}</p>`);
  if (p === "/challenge") return res.writeHead(202, { "Content-Type": "text/html" }).end("<html>wait</html>");
  if (p === "/captcha") return res.writeHead(200, { "Content-Type": "text/html" }).end("<html>Please verify you are human</html>");
  res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, ok));
const host = `localhost:${server.address().port}`, base = `http://${host}`;
const env = { OPEN_DEV_HOSTS: host }, state = () => ({ spent: 0 });
const err = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const got = await fetchCapped(env, state(), base + "/big");
check("at most 400 KB of a page is read", got.text.length <= PAGE_BYTES && got.text.length > PAGE_BYTES - 70000, got.text.length);
check("a redirect to another scheme is never followed", (await err(() => fetchCapped(env, state(), base + "/ftp")))?.blocked === "an address the app does not fetch");
check("a redirect loop stops", !!(await err(() => fetchCapped(env, state(), base + "/loop")))?.blocked);
const one = await fetchCapped(env, state(), base + "/one");
check("one redirect is followed, with the User-Agent that says who asks", one.status === 200 && one.text.includes("ua=DsStudio/1.0"), one.text);
check("a 202 challenge is 'turned away'", (await err(() => fetchCapped(env, state(), base + "/challenge")))?.blocked === "answered 202");
check("a 'prove you are human' page is 'turned away'", (await err(() => fetchCapped(env, state(), base + "/captcha")))?.blocked === "asked for proof of a person");
check("plain http is refused in the real app", !allowed({}, base + "/ok") && !allowed({}, "http://example.org/") && allowed({}, "https://example.org/a") && !allowed({}, "https://u:p@example.org/"));
check("counted: two calls for a redirect", await (async () => { const s = state(); await fetchCapped(env, s, base + "/one"); return s.spent === 2; })());
server.close();
check("scripts, styles and menus are not page text", pageText("<head><title>t</title></head><nav>Menu</nav><script>var a='secret line'</script><p>Real &amp; true</p>") === "Real & true");

// ---- which pages and snippets are about the work
const work = { title: "the late thaw", real: "The Late Thaw", original: "春迟", year: 2026, country: "Chinese", type: "series", cast: ["Lin Qiao"] };
const coreless = { ...work, original: "" };
check("a page with the original title names the work", namesWork(kit, work, "Lines from 春迟, my favourite"));
check("a page with the title and its year names the work", namesWork(kit, coreless, "The Late Thaw (2026) is lovely"));
check("a page about the season does not", !namesWork(kit, coreless, "When the late thaw comes, the world softens. Lines about the season."));
const snips = [{ url: "https://a.example/1", host: "a.example", title: "Late Thaw 2026 drama", snippet: "“Some people arrive like spring: late, and all at once.”" },
  { url: "https://b.example/2", host: "b.example", title: "The Late Thaw drama", snippet: "quote: “Some people arrive like spring: late, and all at once.”" },
  { url: "https://c.example/3", host: "c.example", title: "The Late Thaw drama", snippet: "“Only one site says this line about the thaw.”" }];
const sl = snippetLines(kit, snips, coreless);
check("snippets give a line only when two sites agree, marked to check", sl.length === 1 && sl[0].verify === true && sl[0].text.startsWith("Some people"), sl);
check("sites that need signing in are never fetched; quote sites first", (() => { const r = rank([{ url: "https://www.instagram.com/p/1", host: "instagram.com", title: "", snippet: "" },
  { url: "https://blog.example/x", host: "blog.example", title: "x", snippet: "" }, { url: "https://www.goodreads.com/q", host: "goodreads.com", title: "q", snippet: "" }]); return r.length === 2 && r[0].host === "goodreads.com"; })());

// ---- what a 429 means
const g0 = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.8-flash\nPlease retry in 33.6s.",
  details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "33s" }] } });
check("Gemini 'limit: 0' is 'no allowance' on that model", refusalOf("gemini", 429, g0).how === "no allowance");
const gDay = g0.replace("limit: 0", "limit: 20");
check("Gemini's daily quota spent is 'used up' for that model", refusalOf("gemini", 429, gDay).how === "used up");
const gMin = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded, limit: 10. Please retry in 1.2s.", details: [{ "@type": "x.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" }] } });
const rm = refusalOf("gemini", 429, gMin);
check("Gemini's per-minute limit is 'busy', with the wait it asks for", rm.how === "busy" && rm.wait === 1000, rm);
check("OpenAI insufficient_quota is 'no credit'", refusalOf("openai", 429, JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } })).how === "no credit");
const ro = refusalOf("openai", 429, JSON.stringify({ error: { message: "Rate limit reached for requests per min. Please try again in 500ms.", type: "requests", code: "rate_limit_exceeded" } }));
check("OpenAI's rate limit is 'busy', for 500 ms", ro.how === "busy" && ro.wait === 500, ro);

// ---- the order of Gemini models
const m = (n) => ({ name: "models/" + n, baseModelId: n, supportedGenerationMethods: ["generateContent"] });
const order = pickGemini([m("gemini-3.8-flash"), m("gemini-3.5-flash-lite"), m("gemini-2.5-flash"), m("gemini-2.5-flash-lite"), m("gemini-3.6-flash"), m("gemini-3.1-flash-lite"), m("gemini-3.1-pro-preview")]);
check("the models with a free search allowance come first, then lite models, then flash, newest first", JSON.stringify(order) === JSON.stringify(["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"]), order);

// ---- the address of a free book's text
const walden = { id: 205, formats: { "text/plain; charset=us-ascii": "https://www.gutenberg.org/files/205/205-0.txt", "application/epub+zip": "https://www.gutenberg.org/ebooks/205.epub3.images" } };
check("on gutenberg.org the address that is always there is used", gutenbergText(walden) === "https://www.gutenberg.org/cache/epub/205/pg205.txt", gutenbergText(walden));
check("elsewhere the utf-8 address the catalogue gives", gutenbergText({ id: 3, formats: { "text/plain; charset=us-ascii": "http://localhost/a.txt", "text/plain; charset=utf-8": "http://localhost/b.txt" } }) === "http://localhost/b.txt");
check("no plain text, no address", gutenbergText({ id: 4, formats: { "text/html": "https://www.gutenberg.org/ebooks/4.html.images" } }) === "");

console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
