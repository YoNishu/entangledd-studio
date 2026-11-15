/* Searching the web with no paid allowance (used by findlines.js, verify.js and, through searchWeb, the engine).

   Two halves:
     results   the links and snippets for a few words. In this order, each only while too few have come back:
               Tavily (only when TAVILY_API_KEY is set; it also sends the text of each page it read), Serper
               (Google's results, only when SERPER_API_KEY is set), then a public results page read directly, with no
               key: DuckDuckGo's plain HTML page, and Bing's when DuckDuckGo turns the app away.
     pages     up to four of the most promising result pages fetched and turned into plain text, so that a line is
               kept only when its exact words are on a page that was really read.

   A polite client: a User-Agent that says who is asking; at most two results pages and four pages per search; only
   https (no redirect to anything else, two redirects at most); at most 400 KB read from a page; a few seconds each;
   a small daily cap kept in data/lookups.json ("open"); a site that turns the app away (403, 429, 202, a "prove you
   are human" page) is written on the trail as "blocked" and left alone for the day. OPEN_SEARCH=off switches the
   keyless results pages off (the keyed ones stay, when their settings exist). Only titles, public facts about a work
   and public lines are ever searched for: nothing about her. */
import * as F from "./findlines.js";
import * as S from "./said.js";

const UA = "DsStudio/1.0 (personal quotes app; a few pages per search)";
export const PAGE_BYTES = 400 * 1024;          // the most read from one page
export const MAX_RESULT_PAGES = 2;             // results pages asked for one search
export const MAX_PAGES = 4;                    // pages fetched for one search
export const KEYED_QUERIES = 2;                // questions to Tavily or Serper for one search
export const OPEN_A_DAY = { results: 60, pages: 120, tavily: 30, serper: 20, extract: 150 };   // Tavily: 1,000 credits a month (Extract: 1 per 5 pages read); Serper: 2,500 once
export const EXTRACT_MAX = 20;                 // addresses in one question to Tavily's Extract (its own limit)
export const EXTRACT_MS = 8000;
export const ROUND_PAGES = 5;                  // pages read for a work in one more round
const RESULTS_MS = 6000, PAGE_MS = 6000;
// Sites that show nothing without signing in (their snippets are still used), and the search sites themselves.
const SKIP = /(^|\.)(instagram\.com|pinterest\.[a-z.]+|facebook\.com|tiktok\.com|x\.com|twitter\.com|threads\.net|linkedin\.com|duckduckgo\.com|bing\.com|google\.[a-z.]+|youtube\.com|weibo\.com|douban\.com|imdb\.com)$/;
// Sites that tend to hold lines from a work, tried first.
const GOOD = /(^|\.)(goodreads\.com|wikiquote\.org|mydramalist\.com|fandom\.com|quotefancy\.com|azquotes\.com|dramabeans\.com|kissasian|dramawiki|asianwiki\.com|tumblr\.com|medium\.com|wordpress\.com|blogspot\.com|quotes\.net|subslikescript\.com)$/;

// What the live proving script (tests/live) is told as the lookups run; never set in the real app.
export const say = (env, what, detail) => { if (typeof env.LOOKUP_LOG === "function") env.LOOKUP_LOG(what, detail); };
// A page that asks for proof of a person instead of its content. Such pages are small; a real page that merely
// mentions a captcha (Wikipedia's articles carry such words in their scripts) is not one.
const wall = (html) => {
  const h = String(html), title = (/<title[^>]*>([^<]{0,200})/i.exec(h) || [])[1] || "";
  return /just a moment|attention required|access denied|are you a robot|captcha|verify you are human|security check/i.test(title)
    || (h.length < 60000 && /captcha|verify you are human|are you a robot|unusual traffic|anomaly-modal|bots use duckduckgo|access denied|enable javascript and cookies/i.test(h.slice(0, 8000)));
};
const blocked = (why) => Object.assign(new Error(why), { blocked: why });

// ---------------------------------------------------------------- the daily cap

function capOf(rec, kit) {
  const day = kit.todayIST();
  if (!rec.open || rec.open.day !== day) rec.open = { day, results: 0, pages: 0, tavily: 0, serper: 0, extract: 0 };
  return rec.open;
}
function spend(state, kit, what) {
  const cap = capOf(state.rec, kit);
  if ((cap[what] || 0) >= OPEN_A_DAY[what]) return false;
  cap[what] = (cap[what] || 0) + 1;
  state.dirty = true;
  return true;
}

// ---------------------------------------------------------------- fetching one address, politely

// May the app fetch this address? Only https, never an address without a dot in its name; plain http only for
// the hosts of the local stand-in server (OPEN_DEV_HOSTS, never set in the real app).
export function allowed(env, url) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  const dev = String(env.OPEN_DEV_HOSTS || "").split(",").filter(Boolean).includes(u.host);
  if (dev) return u.protocol === "http:" || u.protocol === "https:";
  return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password && (!u.port || u.port === "443");
}
// One fetch with redirects followed by hand (two at most, each checked), and at most "bytes" read.
// { status, type, text, url }; throws { blocked } when the site turns the app away.
export async function fetchCapped(env, state, url, { accept = "text/html", ms = PAGE_MS, bytes = PAGE_BYTES, method = "GET", headers = {}, body } = {}) {
  let at = url, res;
  for (let hop = 0; ; hop++) {
    if (!allowed(env, at)) throw blocked("an address the app does not fetch");
    state.spent += 1;
    res = await fetch(at, { method, body, redirect: "manual", signal: AbortSignal.timeout(ms),
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en", ...headers } });
    if (res.status < 300 || res.status > 399) break;
    if (res.body) await res.body.cancel().catch(() => {});
    const next = res.headers.get("Location");
    if (!next || hop >= 2) throw blocked("sent on too far");
    at = new URL(next, at).href;
  }
  if ([202, 403, 429, 451, 503].includes(res.status)) {
    if (res.body) await res.body.cancel().catch(() => {});
    throw Object.assign(blocked("answered " + res.status), { status: res.status, retry: Number(res.headers.get("Retry-After")) || 0 });
  }
  const type = res.headers.get("Content-Type") || "";
  let text = "";
  if (res.body) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = bytes - got;
      text += dec.decode(value.byteLength > room ? value.slice(0, room) : value, { stream: true });
      got += value.byteLength;
      if (got >= bytes) { await reader.cancel().catch(() => {}); break; }
    }
  }
  if (/html/i.test(type) && wall(text)) throw blocked("asked for proof of a person");
  return { status: res.status, type, text, url: at };
}

// A web page as plain text: no scripts, styles or menus; blocks on lines of their own.
// Where text sat stays readable: a heading becomes a line "== Heading ==" (so a line under "References" or
// "Episodes" is known for one, said.js), and a page's list of references, its citations, its footnote marks
// and its picture captions are left out: none of them is ever a line from the work.
export function pageText(html) {
  return F.plain(String(html)
    .replace(/<(script|style|noscript|svg|head|nav|footer|form|iframe|figcaption|caption)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ol\b[^>]*class="[^"]*\breferences\b[^"]*"[^>]*>[\s\S]*?<\/ol>|<sup\b[^>]*class="[^"]*\breference\b[^"]*"[^>]*>[\s\S]*?<\/sup>|<cite\b[^>]*class="[^"]*\bcitation\b[^"]*"[^>]*>[\s\S]*?<\/cite>/gi, " ")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, inner) => { const t = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); return t ? `\n== ${t} ==\n` : "\n"; })
    .replace(/<\/?(p|div|li|h[1-6]|blockquote|tr|section|article|figcaption|dd|dt)\b[^>]*>/gi, "\n"))
    .replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// ---------------------------------------------------------------- the results pages

// DuckDuckGo's plain page: each result is an <a class="result__a" href="//duckduckgo.com/l/?uddg=..."> with the
// title, then <a class="result__snippet">. The real address sits in "uddg".
export function readDuckDuckGo(html) {
  const out = [];
  const parts = String(html).split(/class="result__a"/).slice(1);
  for (const part of parts.slice(0, 15)) {
    const href = (/href="([^"]+)"/.exec(part) || [])[1] || "";
    const title = F.plain((/>([\s\S]*?)<\/a>/.exec(part) || [])[1] || "").trim();
    const snippet = F.plain((/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|td|div)>/.exec(part) || [])[1] || "").replace(/\s+/g, " ").trim();
    let url = F.plain(href);
    try { const u = new URL(url, "https://duckduckgo.com"); url = u.searchParams.get("uddg") || u.href; } catch (e) { url = ""; }
    if (url && title && !/^https?:\/\/(duckduckgo\.com\/y\.js|.*\bad_provider\b)/.test(url)) out.push({ url, title, snippet });
  }
  return out;
}
// Bing's page: each result is an <li class="b_algo"> with <h2><a href="...">title</a></h2> and a <p> under it.
// Its links may pass through bing.com/ck/a with the address in "u" (a1 + base64).
export function readBing(html) {
  const out = [];
  for (const part of String(html).split(/<li class="b_algo"/).slice(1, 16)) {
    const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(part);
    if (!a) continue;
    let url = F.plain(a[1]);
    try {
      const u = new URL(url);
      const enc = u.hostname.endsWith("bing.com") && u.searchParams.get("u");
      if (enc && enc.startsWith("a1")) url = atob(enc.slice(2).replace(/-/g, "+").replace(/_/g, "/"));
    } catch (e) { url = ""; }
    const snippet = F.plain((/<p[^>]*>([\s\S]*?)<\/p>/.exec(part) || [])[1] || "").replace(/\s+/g, " ").trim();
    if (url) out.push({ url, title: F.plain(a[2]).trim(), snippet });
  }
  return out;
}

// A question's words: a question is a string, or { q, sites } when it is for particular sites (Tavily only).
const textOf = (query) => (typeof query === "string" ? query : String((query && query.q) || ""));
// Sites with no lines to read: those that want signing in, and Wikipedia, whose page about a work has its plot,
// its cast and a list of sources (article titles in quotation marks), never its lines.
const NO_LINES_SITES = ["instagram.com", "tiktok.com", "facebook.com", "pinterest.com", "x.com", "twitter.com", "threads.net", "linkedin.com", "youtube.com", "wikipedia.org", "imdb.com"];
const NO_LINES = /(^|\.)wikipedia\.org$/;
// A result the app can read lines from.
const readable = (r) => !!r.host && !SKIP.test(r.host) && !NO_LINES.test(r.host);
// The sites where people write down a work's lines, by kind of work: asked for first, by name, where the search
// can be told which sites to look on.
const LINE_SITES = { book: ["goodreads.com", "wikiquote.org", "quotes.net", "azquotes.com", "quotefancy.com"],
  screen: ["mydramalist.com", "wikiquote.org", "quotes.net", "fandom.com", "dramabeans.com", "asianwiki.com", "subslikescript.com"] };
export function siteQuery(work) {
  const name = `"${work.real || work.title}"`;
  return { q: [name, work.year || "", work.type === "book" && work.author ? work.author : "", "quotes"].filter(Boolean).join(" "), sites: LINE_SITES[work.type === "book" ? "book" : "screen"] };
}

const PROVIDER_NAME = { tavily: "Tavily", serper: "Serper", duckduckgo: "DuckDuckGo", bing: "Bing" };
export const providerName = (id) => PROVIDER_NAME[id] || id;

// Tavily: { results: [{ url, title, content, raw_content }] }. One basic search is one credit; include_raw_content
// "text" sends each page's whole text as plain text (Tavily's API reference, checked 15 Nov 2026), so the lines are
// read from it without fetching the page again.
// A question may be { q, sites } (only those sites: include_domains); a plain question leaves out the sites the
// app cannot read lines from (exclude_domains): both are in Tavily's API reference (checked 16 Nov 2026).
async function tavily(env, kit, state, query) {
  const q = textOf(query), sites = query && Array.isArray(query.sites) ? query.sites : null;
  const got = await fetchCapped(env, state, `${env.TAVILY_API || "https://api.tavily.com"}/search`, { method: "POST", accept: "application/json", bytes: 900 * 1024, ms: 9000,
    headers: { Authorization: "Bearer " + env.TAVILY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, search_depth: "basic", max_results: 8, include_raw_content: "text", include_answer: false,
      ...(sites ? { include_domains: sites } : { exclude_domains: NO_LINES_SITES }) }) });
  if (got.status === 401 || got.status === 432 || got.status === 433) throw blocked(`refused the key or its allowance (status ${got.status})`);
  if (got.status !== 200) throw new Error("answered " + got.status);
  const data = JSON.parse(got.text);
  return (data.results || []).map((r) => ({ url: String(r.url || ""), title: kit.oneLine(r.title, 160), snippet: kit.oneLine(r.content, 400),
    raw: typeof r.raw_content === "string" ? r.raw_content.slice(0, PAGE_BYTES) : "", extract: String(r.content || "").slice(0, 3000) }));
}
// Serper: Google's results as JSON: { organic: [{ title, link, snippet }] }.
async function serper(env, kit, state, q) {
  const got = await fetchCapped(env, state, `${env.SERPER_API || "https://google.serper.dev"}/search`, { method: "POST", accept: "application/json", ms: 8000,
    headers: { "X-API-KEY": env.SERPER_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 10 }) });
  if (got.status === 401 || got.status === 400 || got.status === 402) throw blocked(`refused the key or its allowance (status ${got.status})`);
  if (got.status !== 200) throw new Error("answered " + got.status);
  return (JSON.parse(got.text).organic || []).map((r) => ({ url: String(r.link || ""), title: kit.oneLine(r.title, 160), snippet: kit.oneLine(r.snippet, 400) }));
}
async function duckduckgo(env, kit, state, q) {
  const got = await fetchCapped(env, state, `${env.DDG_SITE || "https://html.duckduckgo.com"}/html/?${new URLSearchParams({ q, kl: "us-en" })}`, { ms: RESULTS_MS });
  if (got.status !== 200) throw new Error("answered " + got.status);
  return readDuckDuckGo(got.text);
}
// Bing: its plain RSS answer first (titles, links and descriptions, and no page furniture to read past); its web
// page only when that gives nothing. The words go as %20, not "+", and without quotation marks: asked either way
// from a server, Bing answered with pages about the first word alone ("the", "when"; live run, 15 Nov 2026).
const bingQuery = (q) => "q=" + encodeURIComponent(q.replace(/"/g, ""));
async function bing(env, kit, state, q) {
  const site = env.BING_SITE || "https://www.bing.com";
  const rss = await fetchCapped(env, state, `${site}/search?format=rss&${bingQuery(q)}&setlang=en&cc=US`, { accept: "application/rss+xml,text/xml", ms: RESULTS_MS });
  if (rss.status === 200) {
    const got = readBingRss(rss.text);
    if (got.length) return got;
  }
  const got = await fetchCapped(env, state, `${site}/search?${bingQuery(q)}&setlang=en&cc=US&form=QBLH`, { ms: RESULTS_MS });
  if (got.status !== 200) throw new Error("answered " + got.status);
  return readBing(got.text);
}
// Bing's RSS: <item><title>..</title><link>..</link><description>..</description></item>.
export function readBingRss(xml) {
  const out = [];
  for (const part of String(xml).split(/<item>/i).slice(1, 16)) {
    const tag = (n) => F.plain(((new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, "i")).exec(part) || [])[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
    const url = tag("link"), title = tag("title");
    if (/^https?:\/\//.test(url) && title) out.push({ url, title, snippet: tag("description").replace(/\s+/g, " ") });
  }
  return out;
}

// The providers there are now, in order: the keyed ones whose settings exist, then the keyless pages.
export function providers(env) {
  return [env.TAVILY_API_KEY && ["tavily", tavily, "tavily"], env.SERPER_API_KEY && ["serper", serper, "serper"],
    env.OPEN_SEARCH !== "off" && ["duckduckgo", duckduckgo, "results"], env.OPEN_SEARCH !== "off" && ["bing", bing, "results"]].filter(Boolean);
}

// Results for the queries (best first), from the first providers that answer. { list, via }, each result
// { url, title, snippet, host, via, raw? }. At most MAX_RESULT_PAGES keyless pages in all.
export async function results(env, kit, state, queries, { enough = 6 } = {}) {
  await F.openRecord(env, kit, state);
  const list = [], seen = new Set(), via = [], asked = [];
  let keyless = 0;
  // Enough: as many results the app can read as it reads pages (a list of sign-in sites is not enough, however long).
  const full = () => list.filter(readable).length >= Math.min(enough, MAX_PAGES);
  for (const [id, run, cap] of providers(env)) {
    if (full()) break;
    if (F.resting(state, id)) { F.step(state, id, "not asked", { why: "it turned the app away earlier" }); continue; }
    const mine = id === "tavily" ? queries : queries.filter((q) => typeof q === "string");     // only Tavily can be told which sites
    for (const query of mine.slice(0, cap === "results" ? MAX_RESULT_PAGES - keyless : KEYED_QUERIES)) {
      const q = textOf(query);
      if (full() || Date.now() - state.began > state.limit) break;
      if (cap === "results" && keyless >= MAX_RESULT_PAGES) break;
      if (!spend(state, kit, cap)) { F.step(state, id, "not asked", { why: "the app's daily limit for it" }); break; }
      if (cap === "results") keyless += 1;
      asked.push(query);
      let got;
      try { got = await run(env, kit, state, query); say(env, "results", { via: id, q, list: got.map((r) => [r.url, r.title, r.snippet]) }); }
      catch (e) {
        say(env, "results", { via: id, q, failed: e && (e.blocked || e.message) });
        if (cap === "results") keyless -= 1;           // a results page that said no does not use up a search's share
        if (e && e.blocked) F.noteBlocked(state, id, e.blocked);
        else F.noteSite(state, id, e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached");
        break;                                         // this provider is no good now: the next one
      }
      let n = 0;
      for (const r of got) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url); n += 1;
        list.push({ ...r, host: F.hostOf(r.url), via: id });
      }
      F.step(state, id, n ? "answered" : "no page", { q: kit.oneLine(q, 90), n, ...(query && query.sites ? { on: "the sites where lines are written down" } : {}) });
      if (n) { F.noteSite(state, id, ""); if (!via.includes(id)) via.push(id); }
    }
  }
  return { list, via, asked };
}

// ---------------------------------------------------------------- the pages

// The results most worth reading: not a site that needs signing in, not seen before; those that name what is
// looked for ("names") first, then the quote sites, then the search's own order.
export function rank(list, names = [], not = []) {
  const low = names.map((n) => String(n).toLowerCase()).filter((n) => n.length >= 2);
  const score = (r) => {
    const t = `${r.title} ${r.snippet}`.toLowerCase();
    return (low.some((n) => t.includes(n)) ? 4 : 0) + (GOOD.test(r.host) ? 2 : 0) + (/quote|lines|dialogue/.test(t) ? 1 : 0);
  };
  return list.map((r, i) => ({ r, i, s: score(r) })).filter((x) => x.r.host && !SKIP.test(x.r.host) && !not.includes(x.r.url))
    .sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
}
// Fetches up to "max" of them at once: [{ url, site, title, head, text }]. A page whose text Tavily already sent is
// used as it came. With Tavily's key, a page that came without its text is read through Tavily's Extract (one
// question for all of them); without it (or while Extract rests), the app fetches it itself, and the extract is
// used if the site says no. A page that turns the app away is on the trail.
const FULL = 200;
const hasRaw = (r) => !!(r.raw && r.raw.length >= FULL);
export async function readPages(env, kit, state, list, max = MAX_PAGES) {
  const viaTavily = canExtract(env, state);
  const pick = [];
  for (const r of list) {
    if (pick.length >= max) break;
    if (!hasRaw(r) && !viaTavily && !allowed(env, r.url)) continue;
    pick.push(r);
  }
  const extract = (r, why) => {
    const text = String(hasRaw(r) ? r.raw : r.extract || "").replace(/[ \t]+/g, " ");
    say(env, "page", { url: r.url, how: why, chars: text.length });
    return text.length >= 200 ? { url: r.url, site: r.host, title: r.title, head: "", text, via: r.via } : null;
  };
  const ext = viaTavily ? pick.filter((r) => !hasRaw(r)) : [];
  const read = ext.length ? await extractPages(env, kit, state, ext.map((r) => r.url)) : new Map();
  const got = await Promise.all(pick.map(async (r) => {
    if (hasRaw(r)) return extract(r, "as the search sent it");
    if (ext.includes(r)) {
      const pg = read.get(addressKey(r.url));
      if (pg && pg.text.length >= 200) { say(env, "page", { url: r.url, how: "read through Tavily", chars: pg.text.length }); return { url: r.url, site: r.host, title: r.title, head: "", text: pg.text, via: "extract", links: pg.links }; }
      return r.extract ? extract(r, "the extract, Tavily could not read the page") : null;
    }
    if (!spend(state, kit, "pages")) { F.step(state, "web", "not asked", { why: "the app's daily limit of pages" }); return null; }
    try {
      const pg = await fetchCapped(env, state, r.url, { accept: "text/html,text/plain" });
      if (pg.status !== 200 || !/text\/(html|plain)|xhtml/i.test(pg.type)) { F.step(state, "web", "no page", { why: `${r.host} answered ${pg.status}` }); return r.extract ? extract(r, "the extract") : null; }
      const html = /html/i.test(pg.type);
      const text = html ? pageText(pg.text) : pg.text;
      const head = html ? F.plain((/<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(pg.text) || [])[1] || "").trim() : "";
      say(env, "page", { url: pg.url, how: "fetched", status: pg.status, bytes: pg.text.length, chars: text.length, head });
      return text.length >= 200 ? { url: kit.foundAt(pg.url) || pg.url, site: r.host, title: r.title, head, text, via: r.via } : null;
    } catch (e) {
      F.step(state, "web", e && e.blocked ? "blocked" : "no answer", { why: `${r.host}: ${e && e.blocked ? e.blocked : e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached"}` });
      say(env, "page", { url: r.url, how: "failed", why: e && (e.blocked || e.message) });
      return r.extract ? extract(r, "the extract, the page said no") : null;
    }
  }));
  return got.filter(Boolean);
}

// ---------------------------------------------------------------- Tavily's Extract: pages the app may not read itself

// Tavily's second service, made for reading pages (API reference, read 16 Nov 2026): POST /extract with up to 20
// addresses; { results: [{ url, raw_content }], failed_results: [{ url, error }] }; 1 credit for every 5 pages that
// were read (failed ones cost nothing); 401 a bad key, 429 slow down (Retry-After), 432/433 the allowance used up.
// This is the one way a page that turns the app away is read: never by pretending to be a browser, never by
// asking again and again. Markdown is asked for, so a page's links (a review page's "?page=N") stay readable.
export const canExtract = (env, state) => !!env.TAVILY_API_KEY && !!state.rec && !F.resting(state, "extract") && !extractCapped(state);
const extractCapped = (state) => { const c = state.rec && state.rec.open; return !!(c && c.day === state.rec.day && (c.extract || 0) >= OPEN_A_DAY.extract); };
// An address as Extract may give it back (with or without a slash at its end).
export const addressKey = (u) => String(u || "").replace(/#.*$/, "").replace(/\/+$/, "");
// The first moment of tomorrow, India time (the day the app counts by).
const IST = 5.5 * 60 * 60 * 1000;
export const tomorrowIST = (now = Date.now()) => { const d = new Date(now + IST); d.setUTCHours(24, 0, 0, 0); return d.getTime() - IST; };
// Why Extract cannot read now, in plain words for her ("" when it can): it rests after a refusal, or the app's
// daily limit of pages is reached. { who, why, until }.
export function extractWait(env, state) {
  if (!env.TAVILY_API_KEY || !state.rec) return null;
  const s = state.rec.sites.extract;
  if (F.resting(state, "extract")) return { who: "extract", why: s.used ? "used up" : "resting", until: s.until || (s.failed || 0) + 24 * 3600 * 1000 };
  if (extractCapped(state)) return { who: "extract", why: "limit", until: tomorrowIST() };
  return null;
}
// Reads the addresses through Extract: a Map from addressKey(url) to { text, links } (text as plain text, links the
// markdown it came as, for its page links). An address it could not read is simply not there.
export async function extractPages(env, kit, state, urls) {
  const out = new Map();
  if (!env.TAVILY_API_KEY) return out;
  await F.openRecord(env, kit, state);
  const s0 = state.rec.sites.extract;
  if (F.resting(state, "extract")) { F.step(state, "extract", "not asked", { why: s0 && s0.used ? "Tavily's allowance is used up until tomorrow" : "it turned the app away earlier" }); return out; }
  const cap = capOf(state.rec, kit), room = OPEN_A_DAY.extract - (cap.extract || 0);
  if (room <= 0) { F.step(state, "extract", "not asked", { why: "the app's daily limit of pages read through Tavily" }); return out; }
  const ask = [...new Set(urls.map(String).filter((u) => /^https:\/\//.test(u)))].slice(0, Math.min(EXTRACT_MAX, room));
  if (!ask.length) return out;
  try {
    const got = await fetchCapped(env, state, `${env.TAVILY_API || "https://api.tavily.com"}/extract`, { method: "POST", accept: "application/json", bytes: 4 * 1024 * 1024, ms: EXTRACT_MS,
      headers: { Authorization: "Bearer " + env.TAVILY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ask, extract_depth: "basic", format: "markdown" }) });
    if (got.status === 401) throw blocked("refused the key (status 401)");
    if (got.status === 432 || got.status === 433) {
      F.noteBlocked(state, "extract", `the allowance is used up (status ${got.status}); resting until tomorrow`);
      Object.assign(state.rec.sites.extract, { until: tomorrowIST(), used: true });
      return out;
    }
    if (got.status !== 200) throw new Error("answered " + got.status);
    const data = JSON.parse(got.text);
    for (const r of Array.isArray(data.results) ? data.results : []) {
      if (!r || typeof r.raw_content !== "string" || !r.raw_content.trim()) continue;
      const md = r.raw_content.slice(0, PAGE_BYTES);
      out.set(addressKey(r.url), { text: mdText(md), links: md });
    }
    const failed = Array.isArray(data.failed_results) ? data.failed_results.length : 0;
    cap.extract = (cap.extract || 0) + out.size;            // only pages that were read count (and cost)
    state.dirty = true;
    state.extracted = (state.extracted || 0) + out.size;
    F.step(state, "extract", out.size ? "read" : "no page", { n: out.size, ...(failed ? { why: `${failed} could not be read` } : {}) });
    if (out.size) F.noteSite(state, "extract", "");
    say(env, "extract", { asked: ask, read: [...out.keys()], failed });
  } catch (e) {
    say(env, "extract", { asked: ask, failed: e && (e.blocked || e.message) });
    if (e && e.status === 429) {
      F.noteBlocked(state, "extract", "asked the app to slow down (status 429)");
      state.rec.sites.extract.until = Date.now() + Math.max(60, Math.min(3600, e.retry || 0)) * 1000;
    } else if (e && e.blocked) F.noteBlocked(state, "extract", e.blocked);
    else F.noteSite(state, "extract", e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached");
  }
  return out;
}
// Markdown as plain text, the way pageText writes a page: a link's words without its address, no pictures,
// headings as "== Heading ==".
export function mdText(md) {
  return String(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, "\n== $1 ==\n")
    .replace(/\*\*|__/g, "").replace(/\\([*_\[\]()#-])/g, "$1")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
// The highest "?page=N" a page links to (its list of pages), 0 when none.
export const lastPage = (raw) => Math.min(200, Math.max(0, ...[...String(raw || "").matchAll(/[?&]page=(\d{1,3})\b/g)].map((m) => Number(m[1]))));

// Pages of one site the app may read itself (MyDramaList, Goodreads): fetched by the app while the site lets it;
// once it turns the app away it rests for the day, and its pages are read through Extract instead. "own" gives the
// address the app itself fetches for a page (the stand-in's site in tests). Map from addressKey(url) to
// { text, links, how }.
export async function readSite(env, kit, state, site, urls, own = (u) => u) {
  const out = new Map();
  await F.openRecord(env, kit, state);
  let rest = urls.slice();
  const one = async (u) => {
    const pg = await fetchCapped(env, state, own(u), { accept: "text/html" });
    if (pg.status !== 200) return pg.status;
    out.set(addressKey(u), { text: /html/i.test(pg.type) ? pageText(pg.text) : pg.text, links: pg.text.slice(0, PAGE_BYTES), how: "fetched" });
    return 200;
  };
  if (rest.length && !F.resting(state, site)) {
    try {
      await one(rest[0]);                                    // one first: if the site says no, the others are not asked
      await Promise.all(rest.slice(1).map((u) => one(u).catch(() => 0)));
      rest = [];
    } catch (e) {
      if (e && e.blocked) F.noteBlocked(state, site, e.blocked);
      else F.noteSite(state, site, e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached");
      if (!(e && e.blocked)) rest = [];
    }
  }
  if (rest.length && env.TAVILY_API_KEY) for (const [k, v] of await extractPages(env, kit, state, rest)) out.set(k, { ...v, how: "read through Tavily" });
  return out;
}

// ---------------------------------------------------------------- MyDramaList, read directly

// MyDramaList's own search page: each work is a link "/761231-zao-chun-qing-lang" with its title as the link's
// text, and its kind and year just after ("Chinese Drama - 2026, 24 episodes"). [{ path, slug, title, year, about }]
export function readMdlSearch(html) {
  const out = [], at = new Map();
  // The same page read through Extract comes as markdown: its links "[title](https://mydramalist.com/761231-...)".
  const h = String(html).replace(/\[([^\]\[]{1,150})\]\((?:https:\/\/mydramalist\.com)?(\/\d+-[a-z0-9-]+)\)/g, '<a href="$2">$1</a>');
  // A work's address comes twice: on its cover picture (the title in the picture's alt text), then on its title.
  for (const m of h.matchAll(/href="(?:https:\/\/mydramalist\.com)?\/(\d+-([a-z0-9-]+))"[^>]*>\s*(<img[^>]*?alt="([^"]{1,150})"[^>]*>|[^<]{1,150}?)\s*</g)) {
    const path = "/" + m[1], title = F.plain(m[4] || (m[3].startsWith("<") ? "" : m[3])).trim();
    const known = at.get(path);
    if (known) { if (!known.title && title) known.title = title; continue; }
    const after = F.plain(h.slice(m.index + m[0].length, m.index + m[0].length + 900).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
    const e = { path, slug: m[2], title, year: Number((/\b(?:Drama|Movie|Special|TV Show)\b[^0-9]{0,6}((?:19|20)\d\d)\b/.exec(after) || /\b((?:19|20)\d\d)\b/.exec(after) || [])[1]) || 0, about: after.slice(0, 120) };
    at.set(path, e); out.push(e);
  }
  return out;
}
const slugOf = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// The entry for this work on that page: its title (or another title it goes by, or the romanised original as the
// address has it), and its year when the year is known.
export function mdlPick(kit, work, list) {
  const names = [work.real || work.title, work.title, ...(work.aka || [])].filter(Boolean);
  const cores = names.map((n) => F.coreTitle(kit, n)).filter(Boolean), slugs = names.map(slugOf);
  const yearFits = (r) => !work.year || !r.year || r.year === work.year;
  return list.find((r) => cores.includes(F.coreTitle(kit, r.title)) && yearFits(r))
    || list.find((r) => slugs.includes(r.slug) && yearFits(r)) || null;
}

// The work's own MyDramaList and Goodreads addresses, from search results that name it: a result on
// mydramalist.com/761231-zao-chun-qing-lang (its page or its reviews) whose title is the work's; a Goodreads
// quotes page /work/quotes/123 titled "<title> Quotes by <author>".
export function mdlFromResults(kit, work, list) {
  const found = [];
  for (const r of list) {
    if (r.host !== "mydramalist.com") continue;
    const m = /^\/(\d+-([a-z0-9-]+))(?:\/|$|\?)/.exec(pathOf(r.url));
    if (!m) continue;
    const t = String(r.title || "").replace(/\s*[-|–]\s*MyDramaList\s*$/i, "").replace(/\s*\b(Reviews?|Episode Guide|Cast & Crew)\s*$/i, "");
    found.push({ path: "/" + m[1], slug: m[2], title: t.replace(/\s*\((?:19|20)\d\d\)\s*$/, "").trim(), year: Number((/\(((?:19|20)\d\d)\)/.exec(t) || [])[1]) || 0 });
  }
  const hit = mdlPick(kit, work, found);
  return hit ? hit.path : "";
}
export function grFromResults(kit, work, list) {
  for (const r of list) {
    if (r.host !== "goodreads.com") continue;
    const m = /^\/work\/quotes\/(\d+)/.exec(pathOf(r.url));
    const t = String(r.title || "").replace(/\s+Quotes\b.*$/i, "");
    if (m && F.coreTitle(kit, t) && [work.real, work.title].some((n) => n && F.coreTitle(kit, n) === F.coreTitle(kit, t))) return m[1];
  }
  return "";
}
const pathOf = (u) => { try { return new URL(u).pathname; } catch (e) { return ""; } };
export const mdlReviews = (path, n) => `https://mydramalist.com${path}/reviews${n > 1 ? `?page=${n}` : ""}`;
export const grQuotes = (id, n) => `https://www.goodreads.com/work/quotes/${id}${n > 1 ? `?page=${n}` : ""}`;

// ---------------------------------------------------------------- lines on a page, without Claude

// Words made comparable the way pages differ: curly quotes and apostrophes straight, every dash one hyphen, "…"
// three dots, any kind of space one space, lower case. "You don’t have to" on one page is "You don't have to"
// on another.
export const sameWords = (t) => String(t || "").replace(/[‘’‚‛ʼ′`´]/g, "'").replace(/[“”„‟″«»「」『』]/g, '"')
  .replace(/[‐‑‒–—―−]/g, "-").replace(/…/g, "...").replace(/[\s  -​  　]+/g, " ").trim().toLowerCase();
// Is the line on the page, in the same words (quote marks, dashes, spaces and case aside)?
export const onPage = (pageWords, line) => {
  const n = sameWords(line).replace(/^["'\s]+|["'\s]+$/g, "");
  return n.length >= 12 && pageWords.includes(n);
};

// Labels on review and recap pages that look like "Name: words" but are not someone speaking.
const NOT_SPEAKERS = /^(he|she|they|we|you|i|it|his|her|their|this|that|notes?|episodes?|ep|eps|rating|ratings|score|overall|story|acting|cast|music|rewatch value|source|sources|review|reviews|posted|posted by|by|from|via|credit|credits|photo|image|genre|genres|tags?|labels?|updated?|date|time|title|native title|also known as|screenwriter|director|directors|country|network|aired|airs|duration|content rating|ranked|popularity|watchers|status|q|a|warning|spoilers?|edit|summary|plot|synopsis|verdict|pros|cons|read more|translation|subtitles?|written by|category|filed under|link|comments?|reply|share|chinese|english|pinyin|season|part|chapter|related|watch|where to watch|final thoughts|conclusion|significant quotes|quotes|quote|favourite quote|favorite quote|note to self)$/i;
const NAME = "[A-Z][\\p{L}'’.-]+(?: [A-Z][\\p{L}'’.-]+){0,2}";
const SPOKEN = new RegExp(`^\\s*(?:[-*•]\\s*)?(${NAME})\\s*(?:\\([^)]{0,30}\\))?\\s*[:：]\\s*(.+)$`, "u");
const BEFORE = new RegExp(`(${NAME})\\s*(?:\\([^)]{0,30}\\))?\\s*(?:[:：]|,?\\s+(?:said|says|told|tells|asks|asked|replies|replied|to [A-Z][\\p{L}]+)\\b[^“"«「]{0,20}[,:]?)\\s*$`, "u");
const AFTER = new RegExp(`^\\s*[,.]?\\s*(?:[-–—―]\\s*|,?\\s*(?:said|says)\\s+)(${NAME})`, "u");
// "… no ice sculptures." (Luan Nian): who says it, in brackets just after the line, as reviewers write it.
const BRACKETED = new RegExp(`^\\s*[,.]?\\s*\\((${NAME})\\)`, "u");
// Marks that say which way they face: “ ” « » 「 」 『 』. Straight marks are paired in order, on each line.
const FACING = /“([^“”\n]{20,400})”|«\s?([^«»\n]{20,300}?)\s?»|「([^「」\n]{20,300})」|『([^『』\n]{20,300})』/g;
// Every quoted span on the text, in order: { index, end, inner }. A straight mark opens and the next one on the
// line closes, so the words BETWEEN two quotations ('"Early Spring" as it is missing ... for "Bright"') are
// never taken for one.
function quotedSpans(all) {
  const out = [];
  for (const m of all.matchAll(FACING)) out.push({ index: m.index, end: m.index + m[0].length, inner: m[1] || m[2] || m[3] || m[4] });
  let at = 0;
  for (const line of all.split("\n")) {
    const marks = [];
    for (let i = line.indexOf('"'); i >= 0; i = line.indexOf('"', i + 1)) marks.push(i);
    for (let k = 0; k + 1 < marks.length; k += 2) {
      const inner = line.slice(marks[k] + 1, marks[k + 1]);
      if (inner.length >= 20 && inner.length <= 300) out.push({ index: at + marks[k], end: at + marks[k + 1] + 1, inner });
    }
    at += line.length + 1;
  }
  return out.sort((a, b) => a.index - b.index);
}
// Does a quoted span read as a line someone says, not a piece of a reviewer's sentence? It starts with a capital
// (or a digit, or "..."), not with a joining word, and ends a sentence: with its own punctuation, or with
// punctuation right after the closing mark.
// (Joining words in lower case: "In the height of summer" is a line, "in the romantic sense" is not.)
const JOINING = /^(and|but|or|nor|as|in|of|to|for|which|that|because|so|then|with|while|when|where|if|than|like|from|by|at|on|whereas|Which|Whereas)\b/;
function spanOk(inner, next) {
  const t = String(inner).trim();
  if (!/^(\.\.\.|…)?\s*[\p{Lu}\p{N}]/u.test(t) || JOINING.test(t)) return false;
  return /[.!?…,;—–-]["'’”]?$/.test(t) || /^[.!?,;:—–-]/.test(next || "");
}

// A piece of text worth offering as a line: four to sixty words, real words, not an address, a heading or a title.
export function lineLike(t) {
  const s = String(t || "").trim(), n = s.split(/\s+/).length;
  if (s.length < 20 || s.length > 400 || n < 4 || n > 60) return false;
  if (/https?:|www\.|\.com\b|@|#\w|\{|\}|<|>/.test(s) || !/[a-z]/.test(s)) return false;
  const caps = s.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length;
  return caps / s.split(/\s+/).length < 0.7;                      // a title or a list of names, not a line
}
// Names compared without their spaces: pages write "Shang Zhitao" and "Shang Zhi Tao".
const squash = (t) => sameWords(t).replace(/[^\p{L}\p{N}]+/gu, "");
// Two wordings of one line: the same words but for one or two, in a line of six words or more.
function nearly(a, b) {
  const x = a.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean), y = b.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean);
  if (Math.min(x.length, y.length) < 6 || Math.abs(x.length - y.length) > 2) return false;
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= y.length; j++) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1)); prev = keep; }
  }
  return row[y.length] <= 2 && row[y.length] < Math.min(x.length, y.length) / 3;
}
const MAX_CANDIDATES = 80;                // lines taken from one page at most (a dozen are kept): little computing
const knownName = (names, who) => names.find((n) => n && who && squash(n) === squash(who)) || "";

// Lines on a page, found without Claude: text inside quotation marks (straight, curly, « », 「」), and
// "Speaker: line" where the speaker is a name known for the work or a capitalised name of one to three words.
// "names" are the work's cast and characters (a known name before a quote is its speaker). "list" reads each
// line under a heading as a line (Wikiquote's own pages). [{ text, by, other }]: "other" is a name the page
// credits the line to that is not one of the work's (a known author on a mixed list page).
export function extractLines(text, { names = [], list = false } = {}) {
  const out = [], seen = new Set();
  const add = (raw, by = "", other = "", ctx = {}) => {
    if (out.length >= MAX_CANDIDATES || seen.has(raw)) return;
    seen.add(raw);
    const t = String(raw).replace(/\s+/g, " ").replace(/^\s*\[[^\]]{0,80}\]\s*/, "").replace(/^[\s"'“”‘’]+|[\s"'“”]+$/g, "").trim();
    const n = sameWords(t);
    if (!lineLike(t) || seen.has(n)) return;
    seen.add(n);
    out.push({ text: t, by, other, fromPage: true, ctx });
  };
  const all = String(text).slice(0, 150000);                    // enough for any page of quotes; keeps the computing small
  const parts = S.partsOf(all);                                 // the page's headings: where each line sat (said.js)
  for (const m of quotedSpans(all)) {
    if (out.length >= MAX_CANDIDATES) break;
    const inner = m.inner;
    const before = all.slice(Math.max(0, m.index - 70), m.index).split("\n").pop();
    const after = all.slice(m.end, m.end + 140).split("\n")[0];
    if (!spanOk(inner, after)) continue;
    const known = names.filter((n) => n && n.length >= 3 && before.includes(n)).pop() || "";
    // (Each pattern only where its marks are there at all: most quotes have no speaker around them.)
    const b = /[:：]\s*$|\b(said|says|told|tells|asks|asked|replies|replied|to [A-Z])/.test(before) ? BEFORE.exec(before) : null;
    const a = /^\s*[,.]?\s*(?:[-–—―]|,?\s*says?\b|,?\s*said\b)/.test(after) ? AFTER.exec(after) : null;
    const p = /^\s*[,.]?\s*\(/.test(after) ? BRACKETED.exec(after) : null;
    const said = known || (b && !NOT_SPEAKERS.test(b[1]) ? b[1] : "") || (a && !NOT_SPEAKERS.test(a[1]) ? a[1] : "") || (p && !NOT_SPEAKERS.test(p[1]) ? p[1] : "");
    const mine = knownName(names, said);
    // A name after a dash that is none of the work's: the line is credited to someone else.
    add(inner, mine || (said && !(a && said === a[1]) ? said : ""), a && !mine && said === a[1] ? a[1] : "", { ...S.around(all, parts, m.index, m.end), quoted: true });
  }
  // "Luan Nian: You don’t have to be perfect to be worthy of love." in the middle of a review: after a known name,
  // the sentence up to its end. One pass over the colons, each checked against the names (little computing).
  const squashed = names.map((n) => [n, squash(n)]).filter(([, q]) => q.length >= 4);
  if (squashed.length) {
    const ends = squashed.map(([, q]) => q.slice(-3));
    for (const m of all.matchAll(/[:：]/g)) {
      if (out.length >= MAX_CANDIDATES) break;
      const raw = all.slice(Math.max(0, m.index - 40), m.index).toLowerCase().replace(/\s+/g, "");
      if (!ends.some((e) => raw.endsWith(e))) continue;            // most colons follow no name: cheap to rule out
      const before = squash(raw);
      const who = squashed.find(([, q]) => before.endsWith(q));
      if (!who) continue;
      const said = /^\s*[“"]?([^\n:：“”"]{20,300}?[.!?…])(?=["”]?(?:\s|$))/.exec(all.slice(m.index + 1, m.index + 330));
      if (said) add(said[1], who[0], "", S.around(all, parts, m.index + 1, m.index + 1 + said[0].length));
    }
  }
  let heading = "", started = !list, at = -1;
  for (const line of all.split("\n")) {
    at += line.length + 1;
    if (out.length >= MAX_CANDIDATES) break;
    const h = /^={2,6}\s*(.*?)\s*={2,6}\s*$/.exec(line);
    if (h) { heading = h[1]; started = true; continue; }
    if (!started) continue;                                      // a page's opening words say what the work is
    const s = SPOKEN.exec(line);
    if (s && !NOT_SPEAKERS.test(s[1])) {
      add(s[2], knownName(names, s[1]) || s[1], "", { part: S.partAt(parts, at - line.length), ...S.wide(all, at - line.length, at) });
      continue;
    }
    if (list && !/[“"«「]/.test(line) && !/^(quoting|describing|referring|speaking|said|after|while|when he|when she|on |about )/i.test(line.trim())) add(line, /^(season|series|episode|part|chapter|dialogue|act|book|volume)\b/i.test(heading) || /\d/.test(heading) ? "" : heading, "", { part: heading, list: true, ...S.wide(all, at - line.length, at) });
  }
  // A piece of dialogue inside a longer quote is not a line of its own; of two wordings of one line ("worthy
  // love" and "worthy of love"), the one the page has more often stays, else the longer.
  const words = out.map((q) => sameWords(q.text));
  const flat = out.length > 1 ? sameWords(all) : "";
  const seenOn = (w) => (flat ? flat.split(w).length - 1 : 1);
  const counts = words.map(seenOn);
  return out.filter((q, i) => !words.some((w, j) => j !== i && ((w.length > words[i].length && w.includes(words[i]))
    || (nearly(w, words[i]) && (counts[j] > counts[i] || (counts[j] === counts[i] && (w.length > words[i].length || (w.length === words[i].length && j < i))))))));
}

// ---------------------------------------------------------------- lines from what was read

// Does the text name the work, and not just the words of its title? Its original title (in its own script); or
// its title, proper title or another title it goes by, together with one more public fact: its year, a lead actor,
// a character, its author or its network; or with the title in the page's own title or address. Only when
// nothing more is known of the work does the kind of work ("drama", "film") count as that fact.
// "pg" is the page ({ title, url }), when there is one.
export function namesWork(kit, work, text, pg = null) {
  const t = String(text), low = ` ${kit.norm(t)} `;
  if (work.original && /[^\x00-\x7f]/.test(work.original) && t.includes(work.original)) return true;
  const cores = [work.title, work.real, ...(work.aka || []), ...(/[^\x00-\x7f]/.test(work.original || "") ? [] : [work.original])].filter(Boolean)
    .map((n) => F.coreTitle(kit, n)).filter(Boolean);
  if (!cores.some((c) => low.includes(` ${c} `))) return false;
  const facts = [work.year && String(work.year), ...(work.cast || []), ...(work.characters || []), work.author, work.network].filter(Boolean);
  if (facts.some((f) => low.includes(` ${kit.norm(f)} `))) return true;
  if (pg) {
    const head = ` ${kit.norm(`${pg.title || ""} ${pg.head || ""} ${String(pg.url || "").replace(/^https?:\/\/[^/]+/, "")}`)} `;
    if (cores.some((c) => c.includes(" ") && head.includes(` ${c} `)) && kindSaid(work, t)) return true;
  }
  if (facts.length) return false;
  return kindSaid(work, t);
}
// Does the page say what kind of work it is about?
const kindSaid = (work, t) => work.type === "book" ? /\b(novel|book|author)\b/i.test(t) : work.type === "film" ? /\b(film|movie)\b/i.test(t)
  : /\b(drama|episodes?|tv series|web series|c-?drama|k-?drama|series)\b/i.test(t);

const QUOTE_SITES = /(^|\.)(goodreads\.com|wikiquote\.org|quotes\.net|azquotes\.com|quotefancy\.com)$/;      // their pages are lists of lines
const PICK_SYSTEM = `You pick real, quotable lines from pages found on the web, for a quiet, reflective Instagram quotes page.
Reply with a JSON array only: [{"page": the number of the page, "text": "...", "by": "...", "from": "...", "theme": "one or two words", "tone": "one word"}]
- Copy each line exactly as the page has it: same words, same punctuation. One to three sentences, under 45 words.
- Keep a line only when the page itself presents it as a quote and says who says or wrote it, or which work it is from.
- "by": the character or person the page credits it to. "from": the book, film or series the page says it is from, or "".
- Never add a line that is not on the pages, never complete or correct one, never guess who said it.
- If a work is named in the request, keep only lines the page credits to that work: not lines about the words of its title, and not lines from other works.
- A line is what a character says in the work, or the work's own words (a sentence of the book, a voice-over). Never words about the work: an article or reference title, a headline, a review or rating, a plot summary, a tagline, an episode or chapter title. If a page has no such line, pick nothing from it.`;

// The pages as passages for Claude: a short page whole; from a long one, the parts around where the work (or
// "near" words) are named, and its start.
function passages(kit, text, near) {
  if (text.length <= 9000) return text;
  const low = text.toLowerCase(), out = [text.slice(0, 1500)];
  let total = 1500;
  for (const w of near.map((n) => String(n).toLowerCase()).filter((n) => n.length >= 3)) {
    for (let at = low.indexOf(w), n = 0; at >= 0 && n < 6 && total < 9000; at = low.indexOf(w, at + 2500), n++) {
      out.push(text.slice(Math.max(0, at - 600), at + 1800)); total += 2400;
    }
  }
  return out.join("\n…\n");
}
// A line found again on another site: the two sites agree, so it is sure (no longer marked to check).
// "have" may carry "kept", a Map from a line's words to the line kept for them (findlines.js sets it).
export function agrees(have, n, pg) {
  const k = have.kept && have.kept.get(n);
  if (k && pg && k.site && pg.site && k.site !== pg.site) { k.verify = false; k.also = pg.url; }
}
// Claude picks lines from the pages read (or, when Claude cannot answer or picks nothing usable, extractLines
// does); each is kept only if its words are on the page it names (quote marks, dashes and spaces aside), it is
// new, and (when a work is asked about) the page names the work and the line is not credited to another work or
// person. { lines, dropped, how }.
// "noPick": Claude is not asked to pick (review and quotes pages: every quoted line on them goes to the gate, whose
// judge sees the words around each); a page marked "own" (the work's own MyDramaList or Goodreads page) is about
// the work by where it is.
export async function pickLines(env, kit, pages, { work = null, want = 8, have = new Set(), about = "", ask = "", near = [], refused = {}, noPick = false }) {
  const dropped = {};
  const drop = (why, text = "", site = "") => { dropped[why] = (dropped[why] || 0) + 1; say(env, "rejected", { why, site, text: String(text).slice(0, 120) }); };
  if (!pages.length) return { lines: [], dropped, how: "" };
  const shown = pages.map((p) => passages(kit, p.text, near));
  const words = pages.map((p) => sameWords(p.text));
  const about_ = pages.map((p) => !work || !!p.own || namesWork(kit, work, p.text, p));
  const names = work ? [...(work.cast || []), ...(work.characters || [])] : [];
  const lines = [];
  let tried = 0;
  const take = (q, i) => {
    const pg = pages[i];
    tried += 1;
    const text = kit.flatten(q && q.text).replace(/^"+|"+$/g, ""), n = kit.norm(text);
    if (!pg) return drop("no page named", text);
    if (!lineLike(text)) return drop("too short or too long", text, pg.site);
    if (!onPage(words[i], text)) return drop("not on the page", text, pg.site);
    if (have.has(n)) { agrees(have, n, pg); return drop("already kept", text, pg.site); }
    const by = kit.oneLine(q.by, 80), from = kit.oneLine(q.from, 120);
    const credited = by && (q.fromPage || words[i].includes(sameWords(by))) ? by : "";
    if (work && !about_[i]) return drop("page not about this work", text, pg.site);
    if (work && from && !F.fromThisWork(kit, work, from)) return drop("from another work", text, pg.site);
    if (work && q.other && !knownName(names, q.other)) return drop("credited to someone else", text, pg.site);
    if (!work && !credited && !(from && words[i].includes(sameWords(from)))) return drop("no one named for it", text, pg.site);
    // The gate (said.js): a line said in the work, never one said about it. Where it sat on the page counts.
    const place = pg.site === "mydramalist.com" ? "mdl" : QUOTE_SITES.test(pg.site) ? "quotes" : "page";
    const ctx = q.ctx ? { ...q.ctx, place } : S.contextOf(pg, text, place);
    const said = S.isSaid({ text, by: credited }, work, ctx);
    if (!said.ok) { S.count(refused, said.why); return say(env, "rejected", { why: "gate: " + said.why, site: pg.site, text: text.slice(0, 120) }); }
    lines.push({ text, by: credited, url: pg.url, site: pg.site, verify: !!work, theme: kit.oneLine(q.theme, 30), tone: kit.oneLine(q.tone, 20),
      ...(!work && from ? { work: from, type: "classic" } : {}), ctx });
    have.add(n);
    if (have.kept) have.kept.set(n, lines[lines.length - 1]);
  };
  let answer = null, how = "claude";
  if (!noPick) try {
    answer = kit.parseJson(await kit.claude(env, { system: PICK_SYSTEM, maxTokens: 2500, messages: [{ role: "user", content:
      `${work ? `Work: ${F.describe(work)}\n` : ""}${ask ? `Wanted: ${ask}\n` : ""}${about ? `about: ${about}\n` : ""}Pick up to ${want} lines.\n\n`
      + shown.map((s, i) => `--- page ${i + 1} (${pages[i].site}) ---\n${s}`).join("\n\n") }] }));
  } catch (e) { say(env, "claude", { why: kit.oneLine(e && e.message, 120) }); }
  for (const q of Array.isArray(answer) ? answer : []) { if (lines.length >= want) break; take(q, Number(q && q.page) - 1); }
  // Claude could not answer, or none of its picks passed: the lines on the pages themselves, found without it.
  // (Picks that were all already kept are Claude's judgement that the page has nothing new: that stands.)
  const missed = Array.isArray(answer) && answer.length && answer.every((q) => { const i = Number(q && q.page) - 1; return !words[i] || !onPage(words[i], kit.flatten(q && q.text)); });
  if ((!lines.length || noPick) && work && (noPick || !Array.isArray(answer) || !answer.length || missed)) {
    how = "extractor";
    pages.forEach((pg, i) => {
      const got = about_[i] ? extractLines(pg.text, { names }) : [];
      say(env, "candidates", { site: pg.site, url: pg.url, n: got.length });
      for (const q of got) { if (lines.length >= want) break; take(q, i); }
    });
  }
  return { lines, dropped, how, tried, refused };
}

// Lines from the snippets alone: only a quoted line that two results on different sites carry in the same
// words, and (for a work) whose snippets name the work. Always marked to check.
export function snippetLines(kit, list, work, have = new Set(), refused = {}) {
  const seen = new Map();
  for (const r of list) {
    const words = `${r.title} ${r.snippet}`;
    if (work && !namesWork(kit, work, words, r)) continue;
    for (const m of String(r.snippet).matchAll(/[“"]([^”"]{20,300})[”"]/g)) {
      const text = kit.flatten(m[1]).trim(), n = kit.norm(text);
      if (n.split(" ").length < 5 || have.has(n)) continue;
      const sn = String(r.snippet), end = m.index + m[0].length;
      const e = seen.get(n) || { text, hosts: new Set(), url: r.url, site: r.host,
        ctx: { before: sn.slice(Math.max(0, m.index - 120), m.index), after: sn.slice(end, end + 140), place: "snippet", quoted: true } };
      e.hosts.add(r.host);
      seen.set(n, e);
    }
  }
  const out = [];
  for (const [n, e] of seen) {
    if (e.hosts.size < 2) continue;
    const said = S.isSaid(e.text, work, e.ctx);                    // the gate (said.js)
    if (!said.ok) { S.count(refused, said.why); continue; }
    out.push({ text: e.text, by: "", url: kit.foundAt(e.url) || e.url, site: e.site, verify: true, theme: "", tone: "", snippet: true, ctx: e.ctx });
    have.add(n);
  }
  return out;
}

// ---------------------------------------------------------------- the whole search, for the callers

// The words to search for a work, best first: its proper title in quotes with its year, country and kind; for a
// series, with its main characters' names; for a drama from East Asia, MyDramaList's reviews, where people quote
// the lines they loved; its memorable lines and dialogue; its original title. Only public facts about the work.
const EAST = /^(chinese|korean|south korean|japanese|taiwanese|thai|hong kong|filipino|vietnamese)$/i;
export function queriesFor(work) {
  const name = `"${work.real || work.title}"`, kind = { book: "book", film: "film", series: "drama" }[work.type] || "";
  const chars = (work.characters || []).slice(0, 2).join(" ");
  const out = [[name, work.year || "", work.country || "", kind, work.type === "book" && work.author ? work.author : "", "quotes"].filter(Boolean).join(" ")];
  if (work.type !== "book" && chars) out.push(`${name} ${kind} quotes ${chars}`);
  if (work.type !== "book" && (EAST.test(work.country || "") || !work.country)) out.push(`${name} ${work.year || ""} mydramalist reviews`.replace(/\s+/g, " "));
  out.push(`${name} ${work.type === "book" && work.author ? work.author + " " : ""}memorable lines dialogue`);
  if (work.original) out.push(`"${work.original}" quotes lines`);
  return [...new Set(out)];
}

// The tally of lines the gate refused in one look-up (said.js), kept on its state for the trail.
export const gateTally = (state) => (state.refused = state.refused || {});

// For a work (findlines.js): results, the pages that name it, Claude's picks from them, and lines two snippets
// agree on. Returns { lines, pages, dropped }. "work" holds only public facts. What it learns of where the
// work's lines are written down goes on "state.more" (its reading list, below), so later rounds read on.
export async function linesForWork(env, kit, work, state, { want = 10, have = new Set(), about = "" } = {}) {
  if (!providers(env).length) return { lines: [], pages: [], dropped: {}, off: true };
  const more = state.more || (state.more = newMore());
  const found = await results(env, kit, state, [siteQuery(work), ...queriesFor(work)]);
  for (const q of found.asked || []) noteAsked(more, q);
  const list = found.list.filter((r) => !NO_LINES.test(r.host));
  const counts = { results: list.length, read: 0, about: 0, tried: 0 };
  learnPlaces(kit, work, more, list);
  if (!list.length) return { lines: [], pages: [], dropped: {}, counts };
  const names = [work.real || work.title, work.original].filter(Boolean);
  const ranked = rank(list, names, [...((work.found && work.found.not) || []), ...more.pages.filter((p) => p.read).map((p) => p.url)]);
  const read = await readPages(env, kit, state, ranked);
  const pages = read.filter((p) => namesWork(kit, work, p.text, p));
  for (const p of read) say(env, "about the work", { url: p.url, yes: pages.includes(p) });
  // For the coarse record: each result's site, whether its text came with the search, and what became of it.
  counts.sites = list.slice(0, 10).map((r) => {
    const pg = read.find((p) => p.url === r.url || p.site === r.host);
    return `${r.host} ${r.raw && r.raw.length >= FULL ? "sent " + r.raw.length : "no text"}: ${pg ? (pages.includes(pg) ? "about it" : "not about it") : "not read"}`;
  });
  const dropped = {};
  if (read.length > pages.length) dropped["pages not about this work"] = read.length - pages.length;
  Object.assign(counts, { read: read.length, about: pages.length });
  let lines = [];
  if (pages.length) {
    state.spent += 4;
    const got = await pickLines(env, kit, pages, { work, want, have, about, near: names, refused: gateTally(state) });
    lines = got.lines;
    counts.tried = got.tried;
    for (const [k, v] of Object.entries(got.dropped)) dropped[k] = (dropped[k] || 0) + v;
  }
  // The reading list: what was read (and what it gave), and the results left for later rounds, best first.
  const tried = new Set(ranked.slice(0, MAX_PAGES).map((r) => r.url));
  notePages(more, ranked.filter((r) => readable(r) && !(work.found && (work.found.not || []).includes(r.url))), (u) => tried.has(u) || read.some((p) => p.url === u), lines);
  learnPages(more, read);
  if (lines.length < want) lines = lines.concat(snippetLines(kit, list, work, have, gateTally(state)).slice(0, want - lines.length));
  return { lines, pages, dropped, counts };
}

// ---------------------------------------------------------------- reading on: more pages for a work

// A work's reading list, kept with its lines (found.more): every page known to hold its lines and whether it was
// read (and how many new lines it gave), its MyDramaList reviews (the address and the next page to read, out of
// how many) and its Goodreads quotes pages, the questions already asked. Each round reads the next few, so that
// when her kept lines run out there is always somewhere new to read, until all of it is read.
//   { pages: [{ url, site, title, read, got }], mdl: { path, next, last, quiet, done }, gr: { id, ... }, asked: [q] }
export const LISTED = 40, ASKED = 12, QUIET = 3;
export const newMore = (m) => {
  const x = m && typeof m === "object" ? m : {};
  return { pages: Array.isArray(x.pages) ? x.pages.slice(0, LISTED).map((p) => ({ ...p })) : [], ...(x.mdl ? { mdl: { ...x.mdl } } : {}), ...(x.gr ? { gr: { ...x.gr } } : {}),
    asked: Array.isArray(x.asked) ? x.asked.slice(-ASKED) : [] };
};
const qKey = (q) => sameWords(textOf(q)) + (q && q.sites ? " @sites" : "");
export const noteAsked = (more, q) => { const k = qKey(q); if (!more.asked.includes(k)) more.asked = [...more.asked, k].slice(-ASKED); };
// The work's own review and quotes pages, from results that name it.
export function learnPlaces(kit, work, more, list) {
  if (!more.mdl && work.type !== "book") { const path = mdlFromResults(kit, work, list); if (path) more.mdl = { path, next: 1, last: 0, quiet: 0 }; }
  if (!more.gr && work.type === "book") { const id = grFromResults(kit, work, list); if (id) more.gr = { id, next: 1, last: 0, quiet: 0 }; }
}
// Results onto the list (new ones at the end, in the order given), those read marked with what they gave.
export function notePages(more, list, wasRead, lines = []) {
  const at = new Map(more.pages.map((p) => [addressKey(p.url), p]));
  for (const r of list) {
    const k = addressKey(r.url);
    if (ownPage(more, r.url)) continue;                       // the work's own review pages are counted on mdl/gr
    let p = at.get(k);
    if (!p) { if (more.pages.length >= LISTED) continue; p = { url: String(r.url).slice(0, 240), site: r.host || r.site || "", title: String(r.title || "").slice(0, 80), read: false, got: 0 }; more.pages.push(p); at.set(k, p); }
    if (wasRead(r.url) && !p.read) { p.read = true; p.got = lines.filter((l) => addressKey(l.url) === k).length; }
  }
}
// A page read in the first look that is the work's first review or quotes page: the list goes on from page 2.
function learnPages(more, read) {
  for (const pg of read) {
    const n = ownPage(more, pg.url);
    const o = n && (more.mdl && /mydramalist\.com/.test(pg.url) ? more.mdl : more.gr);
    if (o && n === 1 && o.next <= 1) { o.next = 2; if (pg.links) o.last = Math.max(o.last || 0, lastPage(pg.links)); }
  }
}
// The page number when the address is one of the work's own review or quotes pages, else 0.
function ownPage(more, url) {
  const u = String(url);
  const m = more.mdl && u.startsWith(`https://mydramalist.com${more.mdl.path}/reviews`) ? /[?&]page=(\d+)/.exec(u) || [0, 1] : null;
  const g = more.gr && u.startsWith(`https://www.goodreads.com/work/quotes/${more.gr.id}`) ? /[?&]page=(\d+)/.exec(u) || [0, 1] : null;
  return Number((m || g || [0, 0])[1]) || 0;
}
// Is anything left to read? Own pages not read yet, results not read yet, or a question not asked yet.
export function leftToRead(env, work, more) {
  if (!more || !Array.isArray(more.pages)) return false;
  const own = (o) => o && !o.done && (!o.last || o.next <= o.last);
  return own(more.mdl) || (own(more.gr) && env.QUOTE_SITES !== "off") || more.pages.some((p) => !p.read) || (!!providers(env).length && !!nextQuestion(work, more));
}
const nextQuestion = (work, more) => [siteQuery(work), ...queriesFor(work)].find((q) => !more.asked.includes(qKey(q))) || null;
// What the next round will read, in her words: "Reading more reviews of X…" or "Reading more pages about X…".
export function readingWhat(work, more) {
  const own = (o) => o && !o.done && (!o.last || o.next <= o.last);
  const title = work.title;
  if (own(more && more.mdl)) return `Reading more reviews of ${title}…`;
  if (own(more && more.gr)) return `Reading more quotes pages of ${title}…`;
  return `Reading more pages about ${title}…`;
}

// One more round for a work: up to ROUND_PAGES pages not read yet: its next MyDramaList review pages, its next
// Goodreads quotes pages, then the search results not read yet (best first); when none is left, the next question
// not asked yet (one more search at most). Review and quotes pages are read by the app itself while their site lets
// it, else through Extract; other pages as readPages reads them. Every quoted line on them goes through the gate.
// { lines, pages, read, waiting } ("waiting": nothing could be read now because Extract rests).
export async function readOn(env, kit, work, state, { want = 30, have = new Set(), about = "" } = {}) {
  await F.openRecord(env, kit, state);
  const more = state.more || (state.more = newMore());
  const own = (o) => o && !o.done && (!o.last || o.next <= o.last);
  const picks = [];
  const take = (o, site, addr) => { if (own(o)) for (let n = o.next; picks.length < ROUND_PAGES && (!o.last || n <= o.last); n++) picks.push({ o, n, url: addr(n), site }); };
  if (more.mdl) take(more.mdl, "mydramalist", (n) => mdlReviews(more.mdl.path, n));
  if (more.gr && env.QUOTE_SITES !== "off") take(more.gr, "goodreads", (n) => grQuotes(more.gr.id, n));
  let rest = more.pages.filter((p) => !p.read).slice(0, ROUND_PAGES - picks.length);
  if (!picks.length && !rest.length) {
    const q = nextQuestion(work, more);
    if (q && providers(env).length) {
      noteAsked(more, q);
      const found = await results(env, kit, state, [q], { enough: 8 });
      const list = found.list.filter(readable);
      learnPlaces(kit, work, more, list);
      notePages(more, list, () => false);
      if (more.mdl) take(more.mdl, "mydramalist", (n) => mdlReviews(more.mdl.path, n));
      rest = more.pages.filter((p) => !p.read).slice(0, ROUND_PAGES - picks.length);
    }
  }
  if (!picks.length && !rest.length) return { lines: [], pages: [], read: 0 };
  // The work's own pages: by the app while the site lets it, else through Extract.
  const base = { mydramalist: env.MDL_SITE || "https://mydramalist.com", goodreads: env.GOODREADS_SITE || "https://www.goodreads.com" };
  const ownAddress = (site) => (u) => base[site] + new URL(u).pathname + new URL(u).search;
  const got = new Map();
  for (const site of ["mydramalist", "goodreads"]) {
    const mine = picks.filter((p) => p.site === site);
    if (mine.length) for (const [k, v] of await readSite(env, kit, state, site, mine.map((p) => p.url), ownAddress(site))) got.set(k, v);
  }
  const pagesRead = [];
  const ownSite = { mydramalist: "mydramalist.com", goodreads: "goodreads.com" };
  for (const p of picks) {
    const pg = got.get(addressKey(p.url));
    if (pg && pg.text.length >= 200) pagesRead.push({ url: p.url, site: ownSite[p.site], title: "", head: "", text: pg.text, via: pg.how, links: pg.links, own: true, pick: p });
  }
  const others = rest.length ? await readPages(env, kit, state, rest.map((p) => ({ url: p.url, title: p.title, snippet: "", host: p.site, via: "list" })), rest.length) : [];
  const wait = extractWait(env, state);
  // Nothing could be read because Extract rests (or the day's pages are read): the list stays as it was.
  if (!pagesRead.length && !others.length && wait) return { lines: [], pages: [], read: 0, waiting: wait };
  const names = [work.real || work.title, work.original].filter(Boolean);
  const aboutIt = others.filter((p) => namesWork(kit, work, p.text, p));
  const lines = [];
  const pick = async (pages, noPick) => {
    if (!pages.length) return;
    if (!noPick) state.spent += 4;
    const r = await pickLines(env, kit, pages, { work, want: Math.max(want, 30), have, about, near: names, refused: gateTally(state), noPick });
    lines.push(...r.lines);
  };
  await pick(pagesRead, true);
  await pick(aboutIt, false);
  // What each page gave; three review pages in a row with nothing new end the reviews; a page past the last ends them too.
  const gave = (u) => lines.filter((l) => addressKey(l.url) === addressKey(u)).length;
  for (const o of [more.mdl, more.gr].filter(Boolean)) {
    for (const p of picks.filter((x) => x.o === o).sort((a, b) => a.n - b.n)) {
      const pg = pagesRead.find((x) => x.pick === p);
      if (pg && pg.links) o.last = Math.max(o.last || 0, lastPage(pg.links));
      const n = pg ? gave(p.url) : 0;
      o.quiet = n ? 0 : (o.quiet || 0) + 1;
      o.next = p.n + 1;
      if (o.quiet >= QUIET || (o.last && o.next > o.last)) o.done = true;
    }
  }
  for (const p of rest) { p.read = true; p.got = gave(p.url); }
  say(env, "read on", { title: work.title, own: picks.map((p) => p.url), pages: rest.map((p) => p.url), read: pagesRead.length + others.length, lines: lines.length });
  return { lines, pages: [...pagesRead, ...aboutIt], read: pagesRead.length + others.length };
}

// For the engine and other callers without a work: { lines, dropped } for a query, picked as "ask" says.
export async function linesFor(env, kit, state, query, { want = 8, have = new Set(), ask = "", near = [] } = {}) {
  if (!providers(env).length) return { lines: [], dropped: {}, off: true };
  const { list } = await results(env, kit, state, [query]);
  const pages = await readPages(env, kit, state, rank(list, near), 3);
  if (!pages.length) return { lines: [], dropped: {} };
  state.spent += 4;
  return pickLines(env, kit, pages, { want, have, ask, near, refused: gateTally(state) });
}

// ---------------------------------------------------------------- an address the book texts use (worker.js)

// The address of a book's plain text. The catalogue lists several (us-ascii, utf-8, old /files/ addresses that
// Project Gutenberg no longer serves, and /ebooks/N.txt.utf-8, which only redirects): on gutenberg.org the one
// address that is always there, /cache/epub/N/pgN.txt, is used; elsewhere the utf-8 one, else the first.
export function gutenbergText(r) {
  const plain = Object.entries(r.formats || {}).filter(([k, v]) => k.startsWith("text/plain") && typeof v === "string" && !/\.zip$/i.test(v));
  const url = (plain.find(([k]) => /utf-8/i.test(k)) || plain[0] || [])[1] || "";
  let host = "";
  try { host = new URL(url).hostname; } catch (e) { host = ""; }
  return (host === "gutenberg.org" || host.endsWith(".gutenberg.org")) && Number(r.id) > 0 ? `https://www.gutenberg.org/cache/epub/${Number(r.id)}/pg${Number(r.id)}.txt` : url;
}
