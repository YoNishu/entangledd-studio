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
export const OPEN_A_DAY = { results: 60, pages: 120, tavily: 30, serper: 20 };   // Tavily: 1,000 a month; Serper: 2,500 once
const RESULTS_MS = 6000, PAGE_MS = 6000;
// Sites that show nothing without signing in (their snippets are still used), and the search sites themselves.
const SKIP = /(^|\.)(instagram\.com|pinterest\.[a-z.]+|facebook\.com|tiktok\.com|x\.com|twitter\.com|threads\.net|linkedin\.com|duckduckgo\.com|bing\.com|google\.[a-z.]+|youtube\.com|weibo\.com|douban\.com|imdb\.com)$/;
// Sites that tend to hold lines from a work, tried first.
const GOOD = /(^|\.)(goodreads\.com|wikiquote\.org|mydramalist\.com|fandom\.com|quotefancy\.com|azquotes\.com|dramabeans\.com|kissasian|dramawiki|asianwiki\.com|tumblr\.com|medium\.com|wordpress\.com|blogspot\.com|quotes\.net|subslikescript\.com)$/;

const wall = (html) => /captcha|verify you are human|are you a robot|unusual traffic|anomaly-modal|bots use duckduckgo|access denied|enable javascript and cookies/i.test(String(html).slice(0, 8000));
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

// Tavily: { results: [{ url, title, content, raw_content }] }. One basic search is one credit.
async function tavily(env, kit, state, q) {
  const got = await fetchCapped(env, state, `${env.TAVILY_API || "https://api.tavily.com"}/search`, { method: "POST", accept: "application/json", bytes: 900 * 1024, ms: 9000,
    headers: { Authorization: "Bearer " + env.TAVILY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, search_depth: "basic", max_results: 8, include_raw_content: true, include_answer: false }) });
  if (got.status === 401 || got.status === 432 || got.status === 433) throw blocked(`refused the key or its allowance (status ${got.status})`);
  if (got.status !== 200) throw new Error("answered " + got.status);
  const data = JSON.parse(got.text);
  return (data.results || []).map((r) => ({ url: String(r.url || ""), title: kit.oneLine(r.title, 160), snippet: kit.oneLine(r.content, 400),
    raw: typeof r.raw_content === "string" ? r.raw_content.slice(0, PAGE_BYTES) : "" }));
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
async function bing(env, kit, state, q) {
  const got = await fetchCapped(env, state, `${env.BING_SITE || "https://www.bing.com"}/search?${new URLSearchParams({ q, setlang: "en", cc: "US" })}`, { ms: RESULTS_MS });
  if (got.status !== 200) throw new Error("answered " + got.status);
  return readBing(got.text);
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
    for (const q of queries.slice(0, cap === "results" ? MAX_RESULT_PAGES - keyless : 1)) {
      if (list.length >= enough || Date.now() - state.began > state.limit) break;
      if (cap === "results" && keyless >= MAX_RESULT_PAGES) break;
      if (!spend(state, kit, cap)) { F.step(state, id, "not asked", { why: "the app's daily limit for it" }); break; }
      if (cap === "results") keyless += 1;
      let got;
      try { got = await run(env, kit, state, q); }
      catch (e) {
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
// Fetches up to "max" of them at once: [{ url, site, title, text }]. A page that turns the app away is on the trail.
export async function readPages(env, kit, state, list, max = MAX_PAGES) {
  const pick = [];
  for (const r of list) {
    if (pick.length >= max) break;
    if (!r.raw && !allowed(env, r.url)) continue;
    pick.push(r);
  }
  const got = await Promise.all(pick.map(async (r) => {
    if (r.raw && r.raw.length >= 200) return { url: r.url, site: r.host, title: r.title, text: r.raw.replace(/[ \t]+/g, " "), via: r.via };
    if (!spend(state, kit, "pages")) { F.step(state, "web", "not asked", { why: "the app's daily limit of pages" }); return null; }
    try {
      const pg = await fetchCapped(env, state, r.url, { accept: "text/html,text/plain" });
      if (pg.status !== 200 || !/text\/(html|plain)|xhtml/i.test(pg.type)) { F.step(state, "web", "no page", { why: `${r.host} answered ${pg.status}` }); return null; }
      const text = /html/i.test(pg.type) ? pageText(pg.text) : pg.text;
      return text.length >= 200 ? { url: kit.foundAt(pg.url) || pg.url, site: r.host, title: r.title, text, via: r.via } : null;
    } catch (e) {
      F.step(state, "web", e && e.blocked ? "blocked" : "no answer", { why: `${r.host}: ${e && e.blocked ? e.blocked : e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached"}` });
      return null;
    }
  }));
  return got.filter(Boolean);
}

// ---------------------------------------------------------------- lines from what was read

// Does the text name the work, and not just the words of its title? Its original title, or its title together
// with one more public fact (its year, a lead actor, its author, or what kind of work it is).
export function namesWork(kit, work, text) {
  const t = String(text), low = kit.norm(t);
  if (work.original && /[^\x00-\x7f]/.test(work.original) && t.includes(work.original)) return true;
  const titled = [work.title, work.real, ...(work.aka || [])].filter(Boolean).some((n) => {
    const c = F.coreTitle(kit, n);
    return c && ` ${low} `.includes(` ${c} `);
  });
  if (!titled) return false;
  const facts = [work.year && String(work.year), ...(work.cast || []), work.author, work.type === "book" ? "" : work.type === "film" ? "film" : "drama"].filter(Boolean);
  return facts.some((f) => ` ${low} `.includes(` ${kit.norm(f)} `)) || (work.type === "series" && /\b(episode|tv series|web series|c-?drama|k-?drama)\b/i.test(t));
}

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
// Claude picks lines from the pages read; each is kept only if its exact words are on the page it names, it is
// new, and (when a work is asked about) credited to that work and on a page that names it. { lines, dropped }.
export async function pickLines(env, kit, pages, { work = null, want = 8, have = new Set(), about = "", ask = "", near = [] }) {
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  if (!pages.length) return { lines: [], dropped };
  const shown = pages.map((p) => passages(kit, p.text, near));
  const flat = shown.map((s) => kit.flatten(s));
  const answer = kit.parseJson(await kit.claude(env, { system: PICK_SYSTEM, maxTokens: 2500, messages: [{ role: "user", content:
    `${work ? `Work: ${F.describe(work)}\n` : ""}${ask ? `Wanted: ${ask}\n` : ""}${about ? `about: ${about}\n` : ""}Pick up to ${want} lines.\n\n`
    + shown.map((s, i) => `--- page ${i + 1} (${pages[i].site}) ---\n${s}`).join("\n\n") }] }));
  const lines = [];
  for (const q of Array.isArray(answer) ? answer : []) {
    const i = Number(q && q.page) - 1, pg = pages[i];
    const text = kit.flatten(q && q.text).replace(/^"+|"+$/g, ""), n = kit.norm(text);
    if (!pg) { drop("no page named"); continue; }
    if (text.length < 20 || text.length > 400) { drop("too short or too long"); continue; }
    if (!flat[i].includes(text)) { drop("not word for word on the page"); continue; }
    if (have.has(n)) { drop("already kept"); continue; }
    const by = kit.oneLine(q.by, 80), from = kit.oneLine(q.from, 120);
    const credited = by && flat[i].toLowerCase().includes(by.toLowerCase()) ? by : "";
    if (work && (!namesWork(kit, work, pg.text) || !F.fromThisWork(kit, work, from))) { drop("not from this work"); continue; }
    if (!work && !credited && !(from && flat[i].toLowerCase().includes(from.toLowerCase()))) { drop("no one named for it"); continue; }
    lines.push({ text, by: credited, url: pg.url, site: pg.site, verify: false, theme: kit.oneLine(q.theme, 30), tone: kit.oneLine(q.tone, 20),
      ...(!work && from ? { work: from, type: "classic" } : {}) });
    have.add(n);
    if (lines.length >= want) break;
  }
  return { lines, dropped };
}

// Lines from the snippets alone: only a quoted line that two results on different sites carry in the same
// words, and (for a work) whose snippets name the work. Always marked to check.
export function snippetLines(kit, list, work, have = new Set()) {
  const seen = new Map();
  for (const r of list) {
    const words = `${r.title} ${r.snippet}`;
    if (work && !namesWork(kit, work, words)) continue;
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

// The words to search for a work: its title with its public facts, then its original title.
export function queriesFor(work) {
  const kind = { book: "book", film: "film", series: "drama" }[work.type] || "";
  const first = [`"${work.real || work.title}"`, work.year || "", work.country || "", kind, work.type === "book" && work.author ? work.author : "", "quotes"].filter(Boolean).join(" ");
  const second = work.original ? `"${work.original}" quotes lines` : `"${work.real || work.title}" ${work.cast && work.cast[0] ? work.cast[0] + " " : ""}lines dialogue`;
  return [first, second];
}

// For a work (findlines.js): results, the pages that name it, Claude's picks from them, and lines two snippets
// agree on. Returns { lines, pages, dropped }. "work" holds only public facts.
export async function linesForWork(env, kit, work, state, { want = 10, have = new Set(), about = "" } = {}) {
  if (!providers(env).length) return { lines: [], pages: [], dropped: {}, off: true };
  const { list } = await results(env, kit, state, queriesFor(work));
  if (!list.length) return { lines: [], pages: [], dropped: {} };
  const names = [work.real || work.title, work.original].filter(Boolean);
  const read = await readPages(env, kit, state, rank(list, names, (work.found && work.found.not) || []));
  const pages = read.filter((p) => namesWork(kit, work, p.text));
  const dropped = {};
  if (read.length > pages.length) dropped["pages not about this work"] = read.length - pages.length;
  let lines = [];
  if (pages.length) {
    state.spent += 4;
    const got = await pickLines(env, kit, pages, { work, want, have, about, near: names });
    lines = got.lines;
    for (const [k, v] of Object.entries(got.dropped)) dropped[k] = (dropped[k] || 0) + v;
  }
  if (lines.length < want) lines = lines.concat(snippetLines(kit, list, work, have).slice(0, want - lines.length));
  return { lines, pages, dropped };
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
