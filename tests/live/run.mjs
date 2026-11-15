// The live proving ground: the app's real lookups (server/findlines.js, opensearch.js, verify.js) run against the
// real internet, for a few works, with storage kept in memory. No key of any kind is used: Claude, Gemini, OpenAI
// and Tavily are skipped (the lines are picked by the app's own extractor, as when Claude cannot answer), and so
// is everything about her: only titles of public works are searched for.
//
// It prints, for each work: what the title check learnt, every address fetched (status, bytes, time), every query
// and its results, the pages read and whether each is about the work, candidates, each line left out and why,
// and the lines kept with their pages. Then a summary. It always ends with exit code 0: it reports, it does not
// judge (the workflow .github/workflows/live-lookups.yml runs it on GitHub, where the internet is open).
//
//   node tests/live/run.mjs                 every work
//   node tests/live/run.mjs "early spring"  only the works whose title holds these words
//   LIVE_PROBES=off                         without the extra look at a few known pages
import worker, { kit as realKit } from "../../server/worker.js";
import * as F from "../../server/findlines.js";

void worker;
const WORKS = [
  { id: "w1", title: "The early spring", kind: "series", expect: { year: 2026, country: "Chinese" } },
  { id: "w2", title: "Twisted love", list: "books" },
  { id: "w3", title: "Interstellar", kind: "film", expect: { year: 2014 } },
  { id: "w4", title: "When Life Gives You Tangerines", kind: "series", expect: { year: 2025, country: "South Korean" } },
];
const only = process.argv.slice(2).join(" ").toLowerCase();
const cut = (v, n = 200) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);

// ---- storage in memory, the only stand-in
class Bucket {
  constructor() { this.m = new Map(); }
  async put(key, body) { this.m.set(key, typeof body === "string" ? body : Buffer.from(await new Response(body).arrayBuffer()).toString()); }
  async get(key) { const v = this.m.get(key); return v == null ? null : { json: async () => JSON.parse(v), text: async () => v }; }
  async delete(key) { this.m.delete(key); }
  async list({ prefix = "" } = {}) { return { objects: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}

// ---- every outside call, as it happens
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const t0 = Date.now(), n = ++calls;
  try {
    const res = await realFetch(input, init);
    let bytes = "?";
    try { bytes = (await res.clone().arrayBuffer()).byteLength; } catch (e) { bytes = "unread"; }
    console.log(`  fetch#${n} ${init.method || "GET"} ${cut(url, 170)} -> ${res.status} ${bytes}B ${Date.now() - t0}ms${res.headers.get("location") ? " to " + cut(res.headers.get("location"), 100) : ""}`);
    return res;
  } catch (e) {
    console.log(`  fetch#${n} ${init.method || "GET"} ${cut(url, 170)} -> failed: ${cut(e && (e.name + " " + e.message), 100)} ${Date.now() - t0}ms`);
    throw e;
  }
};

function log(what, d) {
  if (what === "results") {
    if (d.failed) return console.log(`  results ${d.via} "${cut(d.q, 120)}": failed: ${cut(d.failed, 100)}`);
    console.log(`  results ${d.via} "${cut(d.q, 120)}": ${d.list.length}`);
    d.list.slice(0, 10).forEach(([u, t, s], i) => console.log(`    ${i + 1}. ${cut(u, 110)} | ${cut(t, 70)} | ${cut(s, 120)}`));
  } else if (what === "rejected") console.log(`  rejected (${d.why}) ${d.site || ""}: "${cut(d.text, 110)}"`);
  else console.log(`  ${what}: ${cut(JSON.stringify(d), 260)}`);
}

// ---- a few known pages and results pages, fetched as they are, to see their shapes (nothing is kept from here)
const Q = "The Early Spring 2026 Chinese drama quotes";
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const PROBES = [
  ["https://en.wikipedia.org/wiki/The_Early_Spring", ["Luan Nian", "Youku"]],
  ["https://mydramalist.com/search?q=The%20Early%20Spring", ["761231", "Chinese Drama"], { around: "761231" }],
  ["https://mydramalist.com/search?q=When%20Life%20Gives%20You%20Tangerines", ["Tangerines"], { around: "Tangerines" }],
  [`https://www.bing.com/search?format=rss&q=${encodeURIComponent(Q)}&setlang=en&cc=US`, ["<item>", "mydramalist"], { results: "rss" }],
  [`https://www.bing.com/search?q=${encodeURIComponent(Q)}&setlang=en&cc=US&form=QBLH`, ["b_algo", "mydramalist"], { results: "html" }],
  [`https://www.bing.com/search?q=${encodeURIComponent(Q)}&setlang=en&cc=US&form=QBLH`, ["b_algo", "mydramalist"], { results: "html", ua: BROWSER }],
  [`https://www.mojeek.com/search?q=${encodeURIComponent(Q)}`, ["mydramalist", "class=\"title\""], { around: "<li" }],
  [`https://search.brave.com/search?q=${encodeURIComponent(Q)}&source=web`, ["mydramalist"], { around: "mydramalist" }],
  [`https://html.duckduckgo.com/html/?q=${encodeURIComponent(Q)}`, ["result__a"]],
];
async function probes() {
  const O = await import("../../server/opensearch.js");
  console.log("\n=== known pages and results pages, fetched directly (a look at their shapes; nothing is kept from here)");
  for (const [url, words, opt = {}] of PROBES) {
    try {
      const res = await realFetch(url, { headers: { "User-Agent": opt.ua || "DsStudio/1.0 (personal quotes app; a few pages per search)", Accept: "text/html,application/rss+xml,application/json", "Accept-Language": "en" }, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      const plain = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ");
      console.log(`${res.status} ${text.length}B ${cut(url, 140)}${opt.ua ? " (browser UA)" : ""} title="${cut((/<title[^>]*>([^<]*)/i.exec(text) || [])[1], 80)}"`);
      for (const w of words) {
        const at = plain.indexOf(w), raw = text.indexOf(w);
        console.log(`   ${at >= 0 || raw >= 0 ? "has" : "no "} "${w}"${at >= 0 ? ": …" + cut(plain.slice(Math.max(0, at - 100), at + 160), 260) + "…" : ""}`);
      }
      if (opt.around && text.indexOf(opt.around) >= 0) { const at = text.indexOf(opt.around); console.log("   raw: " + cut(text.slice(Math.max(0, at - 300), at + 900), 1200)); }
      if (opt.results) {
        const got = opt.results === "rss" ? O.readBingRss(text) : O.readBing(text);
        console.log(`   read as results: ${got.length}`);
        got.slice(0, 5).forEach((r, i) => console.log(`    ${i + 1}. ${cut(r.url, 100)} | ${cut(r.title, 70)}`));
      }
      if (/mydramalist\.com\/search/.test(url)) console.log("   read as MyDramaList search: " + cut(JSON.stringify(O.readMdlSearch(text).slice(0, 4)), 500));
    } catch (e) { console.log(`failed ${cut(url, 120)}: ${cut(e && e.message, 100)}`); }
  }
}

// ---- one work through the app's own lookup
async function one(w, kit) {
  const env = { MEDIA: new Bucket(), LOOKUP_LOG: log, LOOKUP_SECONDS: process.env.LIVE_SECONDS || "" };
  const list = w.list || "screen";
  const item = { id: w.id, title: w.title, added: Date.now(), ...(w.kind ? { kind: w.kind } : {}) };
  const lib = { quotes: [], books: list === "books" ? [item] : [], screen: list === "screen" ? [item] : [], accounts: [] };
  await kit.saveDoc(env, "library", lib);
  const type = list === "books" ? "book" : w.kind;
  console.log(`\n=== ${type} "${w.title}" (typed so; nothing else known)`);
  const t0 = Date.now(), before = calls;
  let out;
  try { out = await F.forWorks(env, kit, lib, [{ ...item, type }], { room: 10, seen: new Set() }); }
  catch (e) { console.log(`  STOPPED: ${cut(e && (e.stack || e.message), 400)}`); }
  const saved = await kit.loadDoc(env, "library", null);
  const it = [...saved.books, ...saved.screen][0];
  const k = it.known || {};
  console.log(`  -- title check: ${it.known ? `known: ${cut(JSON.stringify(k), 600)}` : it.maybe ? `only a close title: ${cut(JSON.stringify(it.maybe), 300)}` : "nothing learnt"}`);
  const found = (it.found && it.found.lines) || [];
  console.log(`  -- trail: ${cut(it.found && it.found.trail && it.found.trail.said, 600)}`);
  for (const s of (it.found && it.found.trail && it.found.trail.steps) || []) console.log(`     step ${cut(JSON.stringify(s), 300)}`);
  console.log(`  -- ${found.length} lines kept (${calls - before} outside calls, ${Math.round((Date.now() - t0) / 100) / 10}s):`);
  for (const l of found) console.log(`     "${cut(l.text, 200)}"${l.by ? " (" + l.by + ")" : ""}  <- ${cut(l.url, 140)}${l.verify ? " [to check]" : ""}`);
  return { title: w.title, type, identified: !!it.known, year: Number(k.year) || 0, country: k.country || "", kind: k.kind || "", lines: found.length,
    pages: [...new Set(found.map((l) => l.site))], expect: w.expect || null, n: out ? out.items.length : 0 };
}

const kit = { ...realKit };
const summary = [];
if (process.env.LIVE_PROBES !== "off" && (!only || "the early spring".includes(only))) await probes();
for (const w of WORKS) {
  if (only && !w.title.toLowerCase().includes(only)) continue;
  try { summary.push(await one(w, kit)); } catch (e) { console.log(`  FAILED: ${cut(e && (e.stack || e.message), 500)}`); summary.push({ title: w.title, failed: true }); }
}
console.log("\n=== summary");
for (const s of summary) {
  if (s.failed) { console.log(`${s.title}: the run stopped with an error`); continue; }
  const fits = !s.expect || (s.year === s.expect.year && (!s.expect.country || s.country === s.expect.country));
  console.log(`${s.title} (${s.type}): identified ${s.identified ? `yes (${s.kind} ${s.year} ${s.country})${fits ? "" : " NOT THE EXPECTED ONE"}` : "no"}; ${s.lines} lines kept from ${s.pages.join(", ") || "no page"}`);
}
console.log(`outside calls in all: ${calls}`);
