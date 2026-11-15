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

const UA = "DsStudio/1.0 (personal quotes app; a few pages per search)";
export const PAGE_BYTES = 400 * 1024;          // the most read from one page
export const MAX_RESULT_PAGES = 2;             // results pages asked for one search
export const MAX_PAGES = 4;                    // pages fetched for one search
export const KEYED_QUERIES = 2;                // questions to Tavily or Serper for one search
export const OPEN_A_DAY = { results: 60, pages: 120, tavily: 30, serper: 20 };   // Tavily: 1,000 a month; Serper: 2,500 once
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
  if (!rec.open || rec.open.day !== day) rec.open = { day, results: 0, pages: 0, tavily: 0, serper: 0 };
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
  if ([202, 403, 429, 451, 503].includes(res.status)) { if (res.body) await res.body.cancel().catch(() => {}); throw blocked("answered " + res.status); }
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
export function pageText(html) {
  return F.plain(String(html)
    .replace(/<(script|style|noscript|svg|head|nav|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
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

const PROVIDER_NAME = { tavily: "Tavily", serper: "Serper", duckduckgo: "DuckDuckGo", bing: "Bing" };
export const providerName = (id) => PROVIDER_NAME[id] || id;

// Tavily: { results: [{ url, title, content, raw_content }] }. One basic search is one credit; include_raw_content
// "text" sends each page's whole text as plain text (Tavily's API reference, checked 15 Nov 2026), so the lines are
// read from it without fetching the page again.
async function tavily(env, kit, state, q) {
  const got = await fetchCapped(env, state, `${env.TAVILY_API || "https://api.tavily.com"}/search`, { method: "POST", accept: "application/json", bytes: 900 * 1024, ms: 9000,
    headers: { Authorization: "Bearer " + env.TAVILY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, search_depth: "basic", max_results: 8, include_raw_content: "text", include_answer: false }) });
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
// page only when that gives nothing. The words go as %20, not "+": Bing read "+" as the end of the query (it
// answered "The Early Spring" with pages about the word "the").
const bingQuery = (q) => "q=" + encodeURIComponent(q);
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
  const list = [], seen = new Set(), via = [];
  let keyless = 0;
  for (const [id, run, cap] of providers(env)) {
    if (list.length >= enough) break;
    if (F.resting(state, id)) { F.step(state, id, "not asked", { why: "it turned the app away earlier" }); continue; }
    for (const q of queries.slice(0, cap === "results" ? MAX_RESULT_PAGES - keyless : KEYED_QUERIES)) {
      if (list.length >= enough || Date.now() - state.began > state.limit) break;
      if (cap === "results" && keyless >= MAX_RESULT_PAGES) break;
      if (!spend(state, kit, cap)) { F.step(state, id, "not asked", { why: "the app's daily limit for it" }); break; }
      if (cap === "results") keyless += 1;
      let got;
      try { got = await run(env, kit, state, q); say(env, "results", { via: id, q, list: got.map((r) => [r.url, r.title, r.snippet]) }); }
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
      F.step(state, id, n ? "answered" : "no page", { q: kit.oneLine(q, 90), n });
      if (n) { F.noteSite(state, id, ""); if (!via.includes(id)) via.push(id); }
    }
  }
  return { list, via };
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
// used as it came; one it sent only a short extract of is fetched, and the extract used if the site says no. A
// page that turns the app away is on the trail.
const FULL = 200;
export async function readPages(env, kit, state, list, max = MAX_PAGES) {
  const pick = [];
  for (const r of list) {
    if (pick.length >= max) break;
    if (!(r.raw && r.raw.length >= FULL) && !allowed(env, r.url)) continue;
    pick.push(r);
  }
  const extract = (r, why) => {
    const text = String(r.raw && r.raw.length >= FULL ? r.raw : r.extract || "").replace(/[ \t]+/g, " ");
    say(env, "page", { url: r.url, how: why, chars: text.length });
    return text.length >= 200 ? { url: r.url, site: r.host, title: r.title, head: "", text, via: r.via } : null;
  };
  const got = await Promise.all(pick.map(async (r) => {
    if (r.raw && r.raw.length >= FULL) return extract(r, "as the search sent it");
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

// ---------------------------------------------------------------- MyDramaList, read directly

// MyDramaList's own search page: each work is a link "/761231-zao-chun-qing-lang" with its title as the link's
// text, and its kind and year just after ("Chinese Drama - 2026, 24 episodes"). [{ path, slug, title, year, about }]
export function readMdlSearch(html) {
  const out = [], seen = new Set(), h = String(html);
  for (const m of h.matchAll(/href="(?:https:\/\/mydramalist\.com)?\/(\d+-([a-z0-9-]+))"[^>]*>\s*([^<]{1,150}?)\s*</g)) {
    const path = "/" + m[1];
    if (seen.has(path)) continue;
    const after = F.plain(h.slice(m.index + m[0].length, m.index + m[0].length + 700)).replace(/\s+/g, " ");
    seen.add(path);
    out.push({ path, slug: m[2], title: F.plain(m[3]).trim(), year: Number((/\b((?:19|20)\d\d)\b/.exec(after) || [])[1]) || 0, about: after.slice(0, 120) });
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
const NOT_SPEAKERS = /^(notes?|episodes?|ep|eps|rating|ratings|score|overall|story|acting|cast|music|rewatch value|source|sources|review|reviews|posted|posted by|by|from|via|credit|credits|photo|image|genre|genres|tags?|labels?|updated?|date|time|title|native title|also known as|screenwriter|director|directors|country|network|aired|airs|duration|content rating|ranked|popularity|watchers|status|q|a|warning|spoilers?|edit|summary|plot|synopsis|verdict|pros|cons|read more|translation|subtitles?|written by|category|filed under|link|comments?|reply|share|chinese|english|pinyin|season|part|chapter|related|watch|where to watch|final thoughts|conclusion|significant quotes|quotes|quote|favourite quote|favorite quote|note to self)$/i;
const NAME = "[A-Z][\\p{L}'’.-]+(?: [A-Z][\\p{L}'’.-]+){0,2}";
const SPOKEN = new RegExp(`^\\s*(?:[-*•]\\s*)?(${NAME})\\s*(?:\\([^)]{0,30}\\))?\\s*[:：]\\s*(.+)$`, "u");
const BEFORE = new RegExp(`(${NAME})\\s*(?:\\([^)]{0,30}\\))?\\s*(?:[:：]|,?\\s+(?:said|says|told|tells|asks|asked|replies|replied|to [A-Z][\\p{L}]+)\\b[^“"«「]{0,20}[,:]?)\\s*$`, "u");
const AFTER = new RegExp(`^\\s*[,.]?\\s*(?:[-–—]\\s*|,?\\s*(?:said|says)\\s+)(${NAME})`, "u");
const QUOTED = /“([^“”\n]{20,400})”|"([^"\n]{20,300})"|«\s?([^«»\n]{20,300}?)\s?»|「([^「」\n]{20,300})」|『([^『』\n]{20,300})』/g;

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
const knownName = (names, who) => names.find((n) => n && who && squash(n) === squash(who)) || "";
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A known name as a pattern that allows a space, or none, between its letters' groups.
const namePattern = (n) => squash(n).length >= 4 ? String(n).trim().split(/\s+/).map((w) => w.split("").map(escape).join("\\s?")).join("\\s?") : "";
// Lines on a page, found without Claude: text inside quotation marks (straight, curly, « », 「」), and
// "Speaker: line" where the speaker is a name known for the work or a capitalised name of one to three words.
// "names" are the work's cast and characters (a known name before a quote is its speaker). "list" reads each
// line under a heading as a line (Wikiquote's own pages). [{ text, by, other }]: "other" is a name the page
// credits the line to that is not one of the work's (a known author on a mixed list page).
export function extractLines(text, { names = [], list = false } = {}) {
  const out = [], seen = new Set();
  const add = (raw, by = "", other = "") => {
    const t = String(raw).replace(/\s+/g, " ").replace(/^\s*\[[^\]]{0,80}\]\s*/, "").replace(/^[\s"'“”‘’]+|[\s"'“”]+$/g, "").trim();
    const n = sameWords(t);
    if (!lineLike(t) || seen.has(n)) return;
    seen.add(n);
    out.push({ text: t, by, other, fromPage: true });
  };
  const all = String(text);
  for (const m of all.matchAll(QUOTED)) {
    const inner = m[1] || m[2] || m[3] || m[4] || m[5];
    const before = all.slice(Math.max(0, m.index - 70), m.index).split("\n").pop();
    const after = all.slice(m.index + m[0].length, m.index + m[0].length + 50).split("\n")[0];
    const known = names.filter((n) => n && n.length >= 3 && before.includes(n)).pop() || "";
    const b = BEFORE.exec(before), a = AFTER.exec(after);
    const said = known || (b && !NOT_SPEAKERS.test(b[1]) ? b[1] : "") || (a && !NOT_SPEAKERS.test(a[1]) ? a[1] : "");
    const mine = knownName(names, said);
    // A name after a dash that is none of the work's: the line is credited to someone else.
    add(inner, mine || (said && !(a && said === a[1]) ? said : ""), a && !mine && said === a[1] ? a[1] : "");
  }
  // "Luan Nian: You don’t have to be perfect to be worthy of love." in the middle of a review: after a known name,
  // the sentence up to its end.
  for (const n of names) {
    const p = namePattern(n);
    if (!p) continue;
    for (const m of all.matchAll(new RegExp(`(?:^|[^\\p{L}])(${p})\\s*[:：]\\s*[“"]?([^\\n:：“”"]{20,300}?[.!?…])(?=["”]?(?:\\s|$))`, "giu"))) add(m[2], n);
  }
  let heading = "", started = !list;
  for (const line of all.split("\n")) {
    const h = /^={2,6}\s*(.*?)\s*={2,6}\s*$/.exec(line);
    if (h) { heading = h[1]; started = true; continue; }
    if (!started) continue;                                      // a page's opening words say what the work is
    const s = SPOKEN.exec(line);
    if (s && !NOT_SPEAKERS.test(s[1])) {
      add(s[2], knownName(names, s[1]) || s[1]);
      continue;
    }
    if (list && !/[“"«「]/.test(line) && !/^(quoting|describing|referring|speaking|said|after|while|when he|when she|on |about )/i.test(line.trim())) add(line, /^(season|series|episode|part|chapter|dialogue|act|book|volume)\b/i.test(heading) || /\d/.test(heading) ? "" : heading);
  }
  // A piece of dialogue inside a longer quote is not a line of its own.
  const words = out.map((q) => sameWords(q.text));
  return out.filter((q, i) => !words.some((w, j) => j !== i && w.length > words[i].length && w.includes(words[i])));
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

const PICK_SYSTEM = `You pick real, quotable lines from pages found on the web, for a quiet, reflective Instagram quotes page.
Reply with a JSON array only: [{"page": the number of the page, "text": "...", "by": "...", "from": "...", "theme": "one or two words", "tone": "one word"}]
- Copy each line exactly as the page has it: same words, same punctuation. One to three sentences, under 45 words.
- Keep a line only when the page itself presents it as a quote and says who says or wrote it, or which work it is from.
- "by": the character or person the page credits it to. "from": the book, film or series the page says it is from, or "".
- Never add a line that is not on the pages, never complete or correct one, never guess who said it.
- If a work is named in the request, keep only lines the page credits to that work: not lines about the words of its title, and not lines from other works.`;

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
export async function pickLines(env, kit, pages, { work = null, want = 8, have = new Set(), about = "", ask = "", near = [] }) {
  const dropped = {};
  const drop = (why, text = "", site = "") => { dropped[why] = (dropped[why] || 0) + 1; say(env, "rejected", { why, site, text: String(text).slice(0, 120) }); };
  if (!pages.length) return { lines: [], dropped, how: "" };
  const shown = pages.map((p) => passages(kit, p.text, near));
  const words = pages.map((p) => sameWords(p.text));
  const about_ = pages.map((p) => !work || namesWork(kit, work, p.text, p));
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
    lines.push({ text, by: credited, url: pg.url, site: pg.site, verify: !!work, theme: kit.oneLine(q.theme, 30), tone: kit.oneLine(q.tone, 20),
      ...(!work && from ? { work: from, type: "classic" } : {}) });
    have.add(n);
    if (have.kept) have.kept.set(n, lines[lines.length - 1]);
  };
  let answer = null, how = "claude";
  try {
    answer = kit.parseJson(await kit.claude(env, { system: PICK_SYSTEM, maxTokens: 2500, messages: [{ role: "user", content:
      `${work ? `Work: ${F.describe(work)}\n` : ""}${ask ? `Wanted: ${ask}\n` : ""}${about ? `about: ${about}\n` : ""}Pick up to ${want} lines.\n\n`
      + shown.map((s, i) => `--- page ${i + 1} (${pages[i].site}) ---\n${s}`).join("\n\n") }] }));
  } catch (e) { say(env, "claude", { why: kit.oneLine(e && e.message, 120) }); }
  for (const q of Array.isArray(answer) ? answer : []) { if (lines.length >= want) break; take(q, Number(q && q.page) - 1); }
  // Claude could not answer, or none of its picks passed: the lines on the pages themselves, found without it.
  // (An empty answer, or picks already kept, is Claude's judgement: that stands.)
  const missed = Array.isArray(answer) && answer.length && answer.every((q) => { const i = Number(q && q.page) - 1; return !words[i] || !onPage(words[i], kit.flatten(q && q.text)); });
  if (!lines.length && work && (!Array.isArray(answer) || missed)) {
    how = "extractor";
    pages.forEach((pg, i) => {
      const got = about_[i] ? extractLines(pg.text, { names }) : [];
      say(env, "candidates", { site: pg.site, url: pg.url, n: got.length });
      for (const q of got) { if (lines.length >= want) break; take(q, i); }
    });
  }
  return { lines, dropped, how, tried };
}

// Lines from the snippets alone: only a quoted line that two results on different sites carry in the same
// words, and (for a work) whose snippets name the work. Always marked to check.
export function snippetLines(kit, list, work, have = new Set()) {
  const seen = new Map();
  for (const r of list) {
    const words = `${r.title} ${r.snippet}`;
    if (work && !namesWork(kit, work, words, r)) continue;
    for (const m of String(r.snippet).matchAll(/[“"]([^”"]{20,300})[”"]/g)) {
      const text = kit.flatten(m[1]).trim(), n = kit.norm(text);
      if (n.split(" ").length < 5 || have.has(n)) continue;
      const e = seen.get(n) || { text, hosts: new Set(), url: r.url, site: r.host };
      e.hosts.add(r.host);
      seen.set(n, e);
    }
  }
  const out = [];
  for (const [n, e] of seen) {
    if (e.hosts.size < 2) continue;
    out.push({ text: e.text, by: "", url: kit.foundAt(e.url) || e.url, site: e.site, verify: true, theme: "", tone: "", snippet: true });
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
  if (work.type !== "book" && EAST.test(work.country || "")) out.push(`${name} ${work.year || ""} mydramalist reviews`.replace(/\s+/g, " "));
  out.push(`${name} ${work.type === "book" && work.author ? work.author + " " : ""}memorable lines dialogue`);
  if (work.original) out.push(`"${work.original}" quotes lines`);
  return [...new Set(out)];
}

// For a work (findlines.js): results, the pages that name it, Claude's picks from them, and lines two snippets
// agree on. Returns { lines, pages, dropped }. "work" holds only public facts.
export async function linesForWork(env, kit, work, state, { want = 10, have = new Set(), about = "" } = {}) {
  if (!providers(env).length) return { lines: [], pages: [], dropped: {}, off: true };
  const { list } = await results(env, kit, state, queriesFor(work));
  const counts = { results: list.length, read: 0, about: 0, tried: 0 };
  if (!list.length) return { lines: [], pages: [], dropped: {}, counts };
  const names = [work.real || work.title, work.original].filter(Boolean);
  const read = await readPages(env, kit, state, rank(list, names, (work.found && work.found.not) || []));
  const pages = read.filter((p) => namesWork(kit, work, p.text, p));
  for (const p of read) say(env, "about the work", { url: p.url, yes: pages.includes(p) });
  const dropped = {};
  if (read.length > pages.length) dropped["pages not about this work"] = read.length - pages.length;
  Object.assign(counts, { read: read.length, about: pages.length });
  let lines = [];
  if (pages.length) {
    state.spent += 4;
    const got = await pickLines(env, kit, pages, { work, want, have, about, near: names });
    lines = got.lines;
    counts.tried = got.tried;
    for (const [k, v] of Object.entries(got.dropped)) dropped[k] = (dropped[k] || 0) + v;
  }
  if (lines.length < want) lines = lines.concat(snippetLines(kit, list, work, have).slice(0, want - lines.length));
  return { lines, pages, dropped, counts };
}

// For the engine and other callers without a work: { lines, dropped } for a query, picked as "ask" says.
export async function linesFor(env, kit, state, query, { want = 8, have = new Set(), ask = "", near = [] } = {}) {
  if (!providers(env).length) return { lines: [], dropped: {}, off: true };
  const { list } = await results(env, kit, state, [query]);
  const pages = await readPages(env, kit, state, rank(list, near), 3);
  if (!pages.length) return { lines: [], dropped: {} };
  state.spent += 4;
  return pickLines(env, kit, pages, { want, have, ask, near });
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
