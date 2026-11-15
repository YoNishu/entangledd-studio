/* Real lines from books, films and series, found for her without a paid search.

   When Dhruuu asks for quotes from a named work, the app looks for its real lines in this order, and goes on
   to the next place only when the ones before gave too few:
     0. lines already kept for that work in the Library (found earlier, or saved by her "from" that title)
     1. Wikiquote (free, no key)
     2. the big quote sites, read directly (free, no key): Goodreads for books, IMDb for films and series
     3. Gemini with Google Search, only when the setting GEMINI_API_KEY is there (at most 40 questions a day)
     4. OpenAI with web search, only when the setting OPENAI_API_KEY is there (at most 20 questions a day)
   What is found is kept on the work in the Library as "found": at most 30 lines, each with the page it came
   from. So a title is looked up once, and again only when its kept lines run short or after 30 days.
   After these come Anthropic's paid search (only when switched on) and Nishiii's memory, both in worker.js.

   Rules that hold for every place:
   - a line from a page is kept only if its exact words are in the text of that page;
   - one search and one page for a work at each site, with a User-Agent that says who is asking;
   - a site that turns the app away (403, a "prove you are human" page, a page without quotes) simply has
     nothing today; that is written in data/lookups.json, where the health record can show it later;
   - nothing personal ever goes to Gemini or OpenAI: only the title, the kind of work, the author and how
     many lines are wanted, and the public facts of the work (its year, country, original title, lead actors).

   Before the first look at a work the app does not know yet, its title is checked (verify.js), so that every
   question says which work is meant ("the 2026 Chinese TV series ... with ...") and a title that is also a
   plain phrase does not bring back lines about the phrase. Every look leaves a trail: what each place
   answered, step by step. The last trail is kept on the work and the last few in data/lookups.json; she sees
   one plain sentence of it, Nishith all of it (GET /api/lookups and the health line "Looking things up"). */

import * as V from "./verify.js";
import * as O from "./opensearch.js";
import * as S from "./said.js";

const DAY = 24 * 60 * 60 * 1000;
export const KEEP = 80;                 // lines kept for one work (with its reading list: about 45 KB at most)
export const LOOK_AGAIN_DAYS = 30;      // kept lines are refreshed after this long
export const A_DAY = { gemini: 40, openai: 20 };   // so a key can never run up a bill, whatever is attached to it
const BUDGET = 26;                      // outside calls one request may spend on looking up (it has about 50 in all)
const SECONDS = 22;                     // no new place is started after this long, so her phone is never left waiting
const PICK = 12;                        // lines Nishiii may pick from one page
const UA = "DsStudio/1.0 (personal quotes app; one search and one page per title)";
const HOUR = 60 * 60 * 1000;
// Raised whenever the way of looking changes, so that works looked up the old way are looked up afresh.
const LOOK_VERSION = 7;                // 6: every line through the gate (said.js); 7: a reading list, read on round by round
const RETRY_HOURS = [2, 12, 48];        // a look that found nothing is tried again after this long, then after 30 days
const MODEL_DAYS = 7;                   // the models a key may use are asked again after this long
const QUESTIONS = 3;                    // questions to Gemini and OpenAI together for one look at one work
const TRAILS = 10;                      // trails kept in data/lookups.json (looks, title checks, checks, engine searches)

// ---------------------------------------------------------------- the trail of one look

// One step of a look: where, what came of it ("found", "no page", "wrong work", "blocked", "key refused",
// "may not search", "no model", "no line passed", ...), and for the search helpers the model, the status and
// the service's own short words (with anything shaped like a key cut out).
export function step(state, where, what, more = {}) {
  if (!state.trail) state.trail = [];
  if (state.trail.length < 30) state.trail.push({ where, what, ...more });
}
// How the last search for each feature went ("lookup" for a work, "discover" and "echo" for the engine,
// "check" for "Who said this?", "title" for the title check), in data/lookups.json: which helper, its outcome
// ("found", "all rejected", "no answer", "key refused", "may not search", "no model", "used up", "limit",
// "resting"), the model, the status and the service's words. The health line shows one line per feature.
export const FEATURES = ["lookup", "discover", "echo", "check", "title"];
export function noteUse(state, who, what, more = {}) {
  if (!state.rec) return;
  const feature = state.feature || "lookup";
  state.rec.uses = state.rec.uses || {};
  const prev = state.rec.uses[feature];
  // Resting after a refusal says less than the refusal itself, which stays shown for the day.
  if (what === "resting" && prev && prev.who === who && prev.what !== "found" && Date.now() - prev.at < DAY) return;
  state.rec.uses[feature] = { at: Date.now(), who, what, ...more };
  state.dirty = true;
}
// A service's own words, safe to keep: one line, short, without the keys it was sent and without anything
// shaped like a key or an address for mail (the same rule as health.js's hide()).
export function tidy(text, env = {}, max = 160) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const v of [env.GEMINI_API_KEY, env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.TAVILY_API_KEY, env.SERPER_API_KEY]) if (v && String(v).length >= 8) out = out.split(String(v)).join("[hidden]");
  return out.replace(/[A-Za-z0-9_|%-]{24,}/g, "[hidden]").replace(/\S+@\S+\.\S+/g, "[hidden]").slice(0, max);
}
const PLACE_NAME = { wikiquote: "Wikiquote", goodreads: "Goodreads", imdb: "IMDb", gemini: "Google", openai: "OpenAI",
  web: "pages on the web", duckduckgo: "DuckDuckGo", bing: "Bing", tavily: "Tavily", serper: "Serper", more: "more pages about it" };
const TRIED = new Set(["found", "no page", "wrong work", "no line passed"]);
const andList = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
// The trail in one plain sentence for her: "Looked on Wikiquote, IMDb and Google: nothing yet."
export function sayTrail(steps, n = 0) {
  const asked = [], couldNot = [];
  for (const s of steps || []) {
    const name = PLACE_NAME[s.where];
    if (!name) continue;
    if (TRIED.has(s.what) || s.what === "answered") { if (!asked.includes(name)) asked.push(name); }
    else if (s.what !== "models" && !couldNot.includes(name)) couldNot.push(name);
  }
  const off = couldNot.filter((x) => !asked.includes(x));
  const first = asked.length ? `Looked on ${andList(asked)}: ${n ? `found ${n}` : "nothing yet"}.` : n ? `Found ${n}.` : "Nothing could be asked yet.";
  return off.length ? `${first} ${andList(off)} couldn't be asked this time.` : first;
}
// The trail in full, for Nishith: every step, with the service's own words.
export function stepsText(steps) {
  return (steps || []).map((s) => {
    if (s.where === "extract" && s.what === "read") return `Read through Tavily: ${s.n} ${s.n === 1 ? "page" : "pages"}${s.why ? ` (${s.why})` : ""}.`;
    const name = { ...PLACE_NAME, gemini: "Gemini", title: "Title check", extract: "Tavily's page reader", more: "Reading on" }[s.where] || s.where;
    const bits = [s.q && `asked for ${s.q}`, s.model, s.status && `status ${s.status}`, Number.isFinite(s.n) && s.what === "found" && `${s.n} lines`, Number.isFinite(s.pages) && `${s.pages} pages read`,
      s.list && s.list.join(", "), s.read && s.read.length && `read ${s.read.join(", ")}`, s.why, s.said && `"${s.said}"`].filter(Boolean);
    return `${name}: ${s.what}${bits.length ? ` (${bits.join("; ")})` : ""}.`;
  }).join(" ");
}

// ---------------------------------------------------------------- what the work is

// The words of a title that name the work, without what people add to say what it is: "The early spring
// cdrama" and "The Early Spring (2026)" are both "early spring".
const KIND_WORDS = /\s+(c|k|j|thai|chinese|korean|japanese|taiwanese)?\s?(drama|dramas|tv series|tv show|series|show|web series|film|movie|novel|book)$/;
export function coreTitle(kit, t) {
  let out = kit.norm(String(t || "").replace(/\s*\((\d{4}|tv series|series|film|novel|book|drama)\)\s*$/i, "")).replace(/^(the|a|an) /, "");
  for (let i = 0; i < 2; i++) out = out.replace(KIND_WORDS, "").replace(/\s+(19|20)\d\d$/, "").trim();
  return out;
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const kept = (work) => (work.found && Array.isArray(work.found.lines) ? work.found.lines : []);
const typed = (lib) => [...(lib.books || []).map((x) => ({ ...x, type: "book" })), ...(lib.screen || []).map((x) => ({ ...x, type: x.kind }))];
const bare = (kit, t) => kit.norm(t).replace(/^the /, "");
const surnameOf = (kit, work) => (work.type === "book" && work.author ? kit.norm(work.author).split(" ").pop() : "");
// A work as the lookups see it: with the author and year the title check found on the web (verify.js), when she
// gave none herself and the title she kept is the one that was checked.
function withKnown(kit, work) {
  const k = work.known;
  if (!k || kit.norm(k.title) !== kit.norm(work.title)) return work;
  const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => kit.oneLine(x, 80)).filter(Boolean).slice(0, n);
  return { ...work, author: work.author || (work.type === "book" ? k.by || "" : ""), year: Number(k.year) || 0,
    real: kit.oneLine(k.real || k.title, 120), original: kit.oneLine(k.original, 80), country: kit.oneLine(k.country, 40),
    cast: list(k.cast, 6), aka: list(k.aka, 4), characters: list(k.characters, 8), network: kit.oneLine(k.network, 40) };
}
// Every name the work goes by: her title, its proper title, its original title and other titles.
const namesOf = (work) => [work.title, work.real, work.original, ...(work.aka || [])].filter(Boolean);
// Does what a search answer says a line is from name this work? A line about the phrase in the title (spring,
// for "The Early Spring") is credited to no work, or to another one.
export function fromThisWork(kit, work, from) {
  const said = String(from || "").trim();
  if (!said) return false;
  const core = coreTitle(kit, said);
  return namesOf(work).some((name) => {
    if (!/[a-z0-9]/i.test(name)) return said.includes(name);          // a title in another script, such as 早春晴朗
    const want = coreTitle(kit, name);
    return !!want && (core === want || (want.split(" ").length >= 2 && ` ${core} `.includes(` ${want} `)));
  });
}
const KIND_NAME_ = { book: "book", film: "film", series: "TV series" };
// The work as every question names it: 'the 2026 Chinese TV series "The Early Spring" (早春晴朗), with Jing Boran
// and Sun Qian'. Only public facts about the work.
export function describe(work) {
  const lead = [work.year || "", work.country || "", KIND_NAME_[work.type] || "work"].filter(Boolean).join(" ");
  return `the ${lead} "${work.real || work.title}"${work.original ? ` (${work.original})` : ""}${work.type === "book" && work.author ? ` by ${work.author}` : ""}`
    + `${work.type !== "book" && work.cast && work.cast.length ? `, with ${andList(work.cast.slice(0, 2))}` : ""}`;
}

// ---------------------------------------------------------------- 0. what the Library already holds

// Lines for one work that have not been suggested yet: her own lines saved "from" that title, and the lines
// found for it earlier. "seen" may also answer like(line, work id) (worker.js suggestFrom): then a line near one
// she has already been shown for this work (a word or two different) counts as seen too.
function unused(kit, lib, work, seen) {
  const title = kit.norm(work.title);
  const isNew = (t) => { const n = kit.norm(t); return !seen.has(n) && !(seen.like && seen.like(n, work.id)); };
  const own = (lib.quotes || []).filter((q) => q.from && kit.norm(q.from) === title && isNew(q.text))
    .map((q) => ({ text: q.text, author: q.author || "", source: { type: "own", title: q.from }, theme: "", tone: "", verify: false }));
  const found = kept(work).filter((l) => isNew(l.text)).map((l) => asQuote(work, l));
  return { own, found, n: own.length + found.length };
}
// A kept line as a suggestion: who says it, which work, and the page it was found on.
function asQuote(work, line) {
  return { text: line.text, author: work.type === "book" ? work.author || line.by || "" : line.by || "",
    source: { type: work.type, title: work.title, url: line.url || undefined, site: line.site || undefined },
    theme: line.theme || "", tone: line.tone || "", verify: !!line.verify, found: true, ...(line.is ? { is: line.is } : {}) };
}
// Is it time to look this work up (again)? "more" is true when its reading list still has pages to read now.
function due(work, have, share, now, more = false) {
  const f = work.found;
  if (!f || !f.at) return true;
  if (now - (f.first || f.at) > LOOK_AGAIN_DAYS * DAY) return true;
  if (have >= share) return false;
  // She is asking for this work now and there is nothing kept for it: look, whatever went before. (An earlier
  // look that found nothing must never stand in the way of her own request; only a tap twice within two minutes
  // is spared. The waits of 2, 12 and 48 hours are for the timed job, which goes by retryAt below.)
  if (!kept(work).length) return more || typeof f.resume === "number" || f.v !== LOOK_VERSION || now - f.at > 2 * 60 * 1000;
  // Running short (she has been shown the kept lines): read on at once while there is anything left to read; else
  // look again, unless a look a moment ago found nothing new, which means every line there is to find has been found.
  return more || typeof f.resume === "number" || f.added > 0 || f.v !== LOOK_VERSION || now - f.at > AGAIN_AFTER;
}
// Is there more to read for this work now? Pages or questions left on its reading list, and not waiting for a
// service that rests (Tavily's Extract after "allowance used up").
export function canReadOn(env, kit, work, now = Date.now()) {
  const f = work.found;
  if (!f || f.v !== LOOK_VERSION || !f.more) return false;
  if (f.wait && now < (f.wait.until || 0)) return false;
  return O.leftToRead(env, withKnown(kit, work), f.more);
}
export const waitingFor = (work, now = Date.now()) => (work.found && work.found.wait && now < (work.found.wait.until || 0) ? work.found.wait : null);
const AGAIN_AFTER = 10 * 60 * 1000;     // a look that found nothing new is not repeated for her within ten minutes

// When a look that found nothing may be tried again: after 2 hours, then 12, then 48, then the 30 days.
export const retryAt = (f) => (f.at || 0) + (RETRY_HOURS[Math.max(0, (f.tries || 1) - 1)] ?? LOOK_AGAIN_DAYS * 24) * HOUR;

// ---------------------------------------------------------------- the small record of how the looking went

// data/lookups.json: today's count of questions to Gemini and OpenAI, and for each site when it last gave
// lines and when (and how) it last turned the app away. Read once for a request, written only when it changed.
export async function openRecord(env, kit, state) {
  if (state.rec) return state.rec;
  state.spent += 1;
  const rec = (await kit.loadDoc(env, "lookups", null)) || {};
  const day = kit.todayIST();
  if (rec.day !== day) Object.assign(rec, { day, gemini: { calls: 0 }, openai: { calls: 0 } });
  rec.sites = rec.sites || {};
  rec.last = rec.last || {};
  return (state.rec = rec);
}
// A new tally for one request: what it has spent of its outside calls, and when it began.
export const newState = (env, seconds = SECONDS) => ({ spent: 0, rec: null, dirty: false, began: Date.now(), limit: (Number(env.LOOKUP_SECONDS) || seconds) * 1000 });
// Saves the record if this request changed it.
export async function closeRecord(env, kit, state) { if (state.rec && state.dirty) await saveRecord(env, kit, state); }
export async function saveRecord(env, kit, state) { state.spent += 1; state.dirty = false; await kit.saveDoc(env, "lookups", state.rec); }
// A site answered: with lines (why is empty) or without (why says what came back instead).
export function noteSite(state, site, why, blocked = false) {
  const s = (state.rec.sites[site] = state.rec.sites[site] || {});
  if (why) step(state, site, blocked ? "blocked" : /without quotes/.test(why) ? "no line passed" : "no answer", { why: String(why).slice(0, 80) });
  if (why) { s.failed = Date.now(); s.why = String(why).slice(0, 80); state.dirty = true; }
  else if (!s.ok || s.why) { s.ok = Date.now(); delete s.why; delete s.failed; delete s.blocked; delete s.until; state.dirty = true; }
}
// A site that turned the app away is left alone until tomorrow (or, for "days", that long).
export const resting = (state, site) => { const s = state.rec.sites[site]; return !!(s && s.blocked && Date.now() < (s.until || (s.failed || 0) + DAY)); };
export function noteBlocked(state, site, why, days = 1) {
  noteSite(state, site, days > 1 ? `${why}; not asked again for ${days} days` : why, true);
  Object.assign(state.rec.sites[site], { blocked: true });
  if (days > 1) state.rec.sites[site].until = Date.now() + days * DAY; else delete state.rec.sites[site].until;
}
// IMDb's quotes page answers 202 with a challenge for robots: it is not asked again for a week.
const IMDB_REST_DAYS = 7;
export async function page(state, url, accept, ms = 8000) {
  state.spent += 1;
  return fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en" }, signal: AbortSignal.timeout(ms) });
}

// HTML as plain text: line breaks kept, tags dropped, the common entities turned back into characters.
const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—", ndash: "–" };
export const plain = (html) => String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
  .replace(/&#(x?)([0-9a-f]+);/gi, (m, hex, n) => String.fromCodePoint(parseInt(n, hex ? 16 : 10) || 32))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

// ---------------------------------------------------------------- 1. Wikiquote

// Does the note in brackets after a page's title, such as "(2014 film)" or "(TV series)", fit this kind of work?
function tagFits(tag, type) {
  const t = tag.toLowerCase();
  const film = /\b(film|movie)\b/.test(t);
  const tv = /\b(tv|television|season|sitcom|anime|miniseries|show)\b/.test(t) || (/\bseries\b/.test(t) && !/\b(book|novel|film)\b/.test(t));
  const book = /\b(novel|book|novella|memoir|play|poem|short story)\b/.test(t);
  return type === "film" ? film : type === "series" ? tv : book;
}
// The pages from a search that could be this work, best first. A page for another kind of work with the same
// name (the novel when she asked for the film) is never one of them.
function candidates(kit, results, work, not) {
  const want = new Set(namesOf(work).map((n) => coreTitle(kit, n)).filter(Boolean)), out = [];
  results.forEach((r, rank) => {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(r.title || "");
    const base = m ? m[1] : r.title || "", tag = m ? m[2] : "";
    if (!want.has(coreTitle(kit, base)) || not.includes(r.title)) return;
    if (tag && !tagFits(tag, work.type)) return;
    // A page for the same title in another year is another work.
    const tagYear = Number((/\b(1[89]\d\d|20\d\d)\b/.exec(tag) || [])[1]) || 0;
    if (work.year && tagYear && Math.abs(tagYear - work.year) > 1) return;
    out.push({ title: r.title, tagged: !!tag, year: !!work.year && tag.includes(String(work.year)), full: (r.size || 0) >= 3000, rank });
  });
  return out.sort((a, b) => (b.year - a.year) || (b.tagged - a.tagged) || (b.full - a.full) || (a.rank - b.rank));
}
// What kind of work a page says it is about, from its opening words (or, failing that, its categories).
function kindOfPage(pg) {
  const firstOf = (text) => {
    const at = (re) => { const m = re.exec(text); return m ? m.index : Infinity; };
    const where = { film: at(/\b(films?|movies?)\b/i), series: at(/\b(television|tv series|tv show|sitcom|anime|miniseries|web series|drama series|animated series|streaming series)\b/i),
      book: at(/\b(novels?|books?|novella|memoir|play|poems?|short story|short stories)\b/i) };
    const first = Object.keys(where).sort((a, b) => where[a] - where[b])[0];
    return where[first] === Infinity ? "" : first;
  };
  const intro = String(pg.extract || "").split(/\n==/)[0].slice(0, 500);
  const cats = (pg.categories || []).map((c) => String(c.title || "").replace(/^Category:/, "")).join(" | ");
  if (/\bmay refer to\b/i.test(intro) || /disambiguation/i.test(cats)) return "";
  return firstOf(intro) || firstOf(cats);
}
// For a book whose author she gave: is that author named at the top of the page?
function authorFits(kit, pg, work) {
  const surname = surnameOf(kit, work);
  if (!surname) return true;
  const top = kit.norm(String(pg.extract || "").slice(0, 1500) + " " + (pg.categories || []).map((c) => c.title).join(" "));
  return ` ${top} `.includes(` ${surname} `);
}

async function wikiquote(env, state, params) {
  const res = await page(state, `${env.WIKIQUOTE_API || "https://en.wikiquote.org"}/w/api.php?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`, "application/json");
  if (!res.ok) throw Object.assign(new Error("Wikiquote answered " + res.status), { blocked: "answered " + res.status });
  return res.json();
}
const SKIPPED = /^(cast|external links|see also|references|notes|sources|bibliography|further reading|taglines?|misattributed|disputed|about|about .*|quotes about .*|quotes by others about .*)$/i;
const HEADING = /^(={2,6})\s*(.*?)\s*\1\s*$/;
// The page's text without the parts that are not lines from the work: the cast, taglines, links, and what
// other people said about it.
function withoutExtras(text) {
  const out = [];
  let skipping = 0;                               // the level of the heading whose section is being left out
  for (const line of String(text).split("\n")) {
    const h = HEADING.exec(line);
    if (h && !(skipping && h[1].length > skipping)) skipping = SKIPPED.test(h[2]) ? h[1].length : 0;
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}
// On an author's page, the part about one book (its heading contains the title).
function sectionAbout(kit, text, title) {
  const all = String(text).split("\n"), want = kit.norm(title);
  const start = all.findIndex((l) => { const h = HEADING.exec(l); return h && ` ${kit.norm(h[2])} `.includes(` ${want} `); });
  if (start < 0) return "";
  const level = HEADING.exec(all[start])[1].length;
  let end = all.length;
  for (let i = start + 1; i < all.length; i++) { const h = HEADING.exec(all[i]); if (h && h[1].length <= level) { end = i; break; } }
  return all.slice(start, end).join("\n");
}
// The Wikiquote page for a work: one search, then one page. Null when it has no page that is surely this work.
async function wikiquotePage(env, kit, work, state) {
  const not = (work.found && work.found.not) || [];
  const search = await wikiquote(env, state, { action: "query", list: "search", srnamespace: "0", srlimit: "10",
    srsearch: `${work.real || work.title}${work.type === "book" && work.author ? " " + work.author : ""}` });
  const results = (search.query && search.query.search) || [];
  let pick = candidates(kit, results, work, not)[0], section = false;
  if (!pick && work.type === "book" && work.author) {
    // Many books have no page of their own: their lines sit under a heading on the author's page.
    const author = results.find((r) => kit.norm(r.title) === kit.norm(work.author) && !not.includes(r.title));
    if (author) { pick = { title: author.title, tagged: true }; section = true; }
  }
  if (!pick) return null;
  const got = await wikiquote(env, state, { action: "query", prop: "extracts|categories", explaintext: "1", exsectionformat: "wiki", exlimit: "1",
    cllimit: "50", redirects: "1", titles: pick.title });
  const pg = ((got.query && got.query.pages) || [])[0];
  if (!pg || pg.missing || !pg.extract) return null;
  let text;
  if (section) text = sectionAbout(kit, pg.extract, work.title);
  else {
    // A page the search sent somewhere else must still be this work; one without a note in brackets must
    // say itself what kind of work it is; and a book's page must name her author.
    if (pg.title !== pick.title && !candidates(kit, [{ title: pg.title }], work, not).length) return null;
    if ((!pick.tagged && kindOfPage(pg) !== work.type) || !authorFits(kit, pg, work)) return null;
    text = pg.extract;
  }
  text = withoutExtras(text).slice(0, 400000);
  if (text.length < 200) return null;
  return { name: pg.title, url: "https://en.wikiquote.org/wiki/" + encodeURIComponent(pg.title.replace(/ /g, "_")), site: "wikiquote.org", text };
}

// ---------------------------------------------------------------- 1b. MyDramaList (dramas and films from East Asia)

// Where Asian dramas are reviewed, often with the lines people loved ("Luan Nian: You don’t have to be perfect
// ..."). Its own search finds the work's page (title and year); its reviews are read. Two calls.
const mdlFits = (work) => (work.type === "series" || work.type === "film") && (EAST.test(work.country || "") || (!work.country && work.type === "series"));
async function mdlPage(env, kit, work, state) {
  const site = env.MDL_SITE || "https://mydramalist.com";
  const own = (u) => site + new URL(u).pathname + new URL(u).search;          // the address the app itself fetches
  const more = state.more;
  let name = "";
  if (!more.mdl) {
    // Its own search page: by the app while the site lets it, else through Tavily's Extract.
    const addr = `https://mydramalist.com/search?q=${encodeURIComponent(work.real || work.title)}`;
    const found = (await O.readSite(env, kit, state, "mydramalist", [addr], own)).get(O.addressKey(addr));
    if (!found) return null;
    const list = O.readMdlSearch(found.links), hit = O.mdlPick(kit, work, list);
    O.say(env, "mydramalist search", { n: list.length, first: list.slice(0, 5).map((r) => `${r.path} ${r.title} ${r.year}`), hit: hit && hit.path, how: found.how });
    if (!hit) return null;
    more.mdl = { path: hit.path, next: 1, last: 0, quiet: 0 };
    name = hit.title;
  }
  if (more.mdl.next > 1) return null;                         // its first page was read already: later rounds read on
  const url = O.mdlReviews(more.mdl.path, 1);
  const pg = (await O.readSite(env, kit, state, "mydramalist", [url], own)).get(O.addressKey(url));
  if (!pg) return null;
  more.mdl.next = 2;
  more.mdl.last = O.lastPage(pg.links);
  const text = pg.text.slice(0, 300000);
  // Reviews: every quoted line goes to the gate, whose judge sees the words around it (no picking by Claude).
  return text.length < 200 ? null : { name: name || more.mdl.path, url, site: "mydramalist.com", text, web: true, extractor: true };
}

// ---------------------------------------------------------------- 2. Goodreads (books) and IMDb (films and series)

// What a site sends instead of its page when it wants proof of a person.
const wall = (html) => /captcha|verify you are human|are you a robot|unusual traffic|access denied|enable javascript and cookies/i.test(String(html).slice(0, 6000));

// Goodreads: its own list of suggestions for a title, then that book's quotes page.
async function goodreadsPage(env, kit, work, state) {
  const base = env.GOODREADS_SITE || "https://www.goodreads.com";
  let res = await page(state, `${base}/book/auto_complete?format=json&q=${encodeURIComponent(work.real || work.title)}`, "application/json");
  if (!res.ok) return void noteBlocked(state, "goodreads", "search answered " + res.status);
  let list;
  try { list = JSON.parse(await res.text()); } catch (e) { return void noteBlocked(state, "goodreads", "search was not a list"); }
  const want = new Set(namesOf(work).map((n) => coreTitle(kit, n)).filter(Boolean)), surname = surnameOf(kit, work), not = (work.found && work.found.not) || [];
  const book = (Array.isArray(list) ? list : []).find((b) => b && b.workId && want.has(coreTitle(kit, b.bookTitleBare || String(b.title || "").replace(/\s*\([^)]*\)\s*$/, "")))
    && (!surname || kit.norm((b.author || {}).name).split(" ").includes(surname)) && !not.includes("goodreads:" + b.workId));
  if (!book) return null;                                   // no such book there: nothing wrong with the site
  const id = String(book.workId).replace(/\D/g, "");
  // Its quotes pages go on the reading list: page 1 now, the others in later rounds (through Extract if need be).
  if (!state.more.gr) state.more.gr = { id, next: 1, last: 0, quiet: 0 };
  res = await page(state, `${base}/work/quotes/${id}`, "text/html");
  if (!res.ok) return void noteBlocked(state, "goodreads", "quotes page answered " + res.status);
  const html = (await res.text()).slice(0, 1_500_000);
  if (wall(html)) return void noteBlocked(state, "goodreads", "asked for proof of a person");
  if (state.more.gr.id === id && state.more.gr.next <= 1) Object.assign(state.more.gr, { next: 2, last: O.lastPage(html) });
  const quotes = [];
  for (let at = 0, n = 0; n < 40; n++) {
    const start = html.indexOf('class="quoteText"', at);
    if (start < 0) break;
    const open = html.indexOf(">", start) + 1, end = html.indexOf("</div>", open);
    if (end < 0) break;
    at = end;
    // The words come first, then a long dash and who wrote them.
    const all = plain(html.slice(open, end)), bar = all.lastIndexOf("―");
    const words = bar >= 0 ? all.slice(0, bar) : all, credit = bar >= 0 ? all.slice(bar + 1) : "";
    if (surname && !kit.norm(credit).split(" ").includes(surname)) continue;
    const text = words.replace(/\s*\n\s*/g, " ").trim().replace(/^[“"]+|[”"]+$/g, "").trim();
    if (text) quotes.push(text);
  }
  if (!quotes.length) return void noteSite(state, "goodreads", "a page without quotes");
  return { name: "goodreads:" + id, url: `https://www.goodreads.com/work/quotes/${id}`, site: "goodreads.com", text: quotes.join("\n\n"), by: (book.author || {}).name || "" };
}

// IMDb: its own list of suggestions for a title, then that title's quotes page.
const IMDB_KINDS = { film: ["movie", "tvMovie", "video", "short"], series: ["tvSeries", "tvMiniSeries"] };
async function imdbPage(env, kit, work, state) {
  const typedYear = (/\((\d{4})\)\s*$/.exec(work.title) || [])[1], title = (work.real || work.title).replace(/\s*\(\d{4}\)\s*$/, "");
  let res = await page(state, `${env.IMDB_SUGGEST || "https://v3.sg.media-imdb.com"}/suggestion/x/${encodeURIComponent(title.toLowerCase())}.json`, "application/json");
  if (!res.ok) return void noteBlocked(state, "imdb", "search answered " + res.status);
  let list;
  try { list = JSON.parse(await res.text()).d; } catch (e) { return void noteBlocked(state, "imdb", "search was not a list"); }
  const want = new Set([title, ...namesOf(work)].map((n) => coreTitle(kit, n)).filter(Boolean)), not = (work.found && work.found.not) || [];
  const same = (Array.isArray(list) ? list : []).filter((t) => t && /^tt\d+$/.test(t.id || "") && want.has(coreTitle(kit, t.l)) && IMDB_KINDS[work.type].includes(t.qid)
    && (!typedYear || String(t.y) === typedYear) && !not.includes("imdb:" + t.id));
  const near = work.year ? same.filter((t) => Math.abs(Number(t.y) - work.year) <= 1).sort((a, b) => Math.abs(a.y - work.year) - Math.abs(b.y - work.year)) : [];
  // With the year known (from the title check), a title of another year is another work.
  const hit = work.year && !typedYear ? near[0] : near[0] || same[0];
  if (!hit) { if (same.length) step(state, "imdb", "wrong work", { why: `only titles of other years (${same.map((t) => t.y).join(", ")})` }); return null; }
  res = await page(state, `${env.IMDB_SITE || "https://www.imdb.com"}/title/${hit.id}/quotes/`, "text/html");
  if (res.status !== 200) return void noteBlocked(state, "imdb", "quotes page answered " + res.status, res.status === 202 || res.status === 403 ? IMDB_REST_DAYS : 1);
  const html = (await res.text()).slice(0, 3_000_000);
  if (wall(html)) return void noteBlocked(state, "imdb", "asked for proof of a person");
  const quotes = [];
  for (let at = 0, n = 0; n < 60; n++) {
    const start = html.indexOf('class="ipc-html-content-inner-div"', at);
    if (start < 0) break;
    const open = html.indexOf(">", start) + 1, end = html.indexOf("</div>", open);
    if (end < 0) break;
    at = end;
    // One exchange: each line is "Character: what is said".
    const said = html.slice(open, end).split(/<\/li>|<\/p>/i).map((l) => plain(l).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (said.length) quotes.push(said.join("\n"));
  }
  if (!quotes.length) return void noteSite(state, "imdb", "a page without quotes");
  return { name: "imdb:" + hit.id, url: `https://www.imdb.com/title/${hit.id}/quotes/`, site: "imdb.com", text: quotes.join("\n\n") };
}

// ---------------------------------------------------------------- Nishiii picks from a page

const PICK_SYSTEM = `You pick real lines from a page of quotes for a quiet, reflective Instagram quotes page.
Reply with a JSON array only: [{"text": "...", "by": "...", "theme": "one or two words", "tone": "one word"}]
- The passages come from one page (Wikiquote, Goodreads or IMDb) about one book, film or series. A line "== like this ==" is a heading: a character, an episode, a season or a chapter.
- Copy each line exactly as it appears in the passages: same words, same punctuation. One to three sentences, complete on its own, under 45 words. Leave out the speaker's name before a colon and any stage direction in [brackets].
- "by" is who says the line: for a film or series the character (the heading above it, or the name before the colon); for a book the author, or "" when the passages do not say.
- Only lines from the work itself: what a character says, or the book's own sentences. Skip the opening description of the work, cast lists, what critics and others said about it, headings and links.
- Choose lines that stand alone without the story around them.
- If "about" is given, prefer lines on that subject. If "taste" is given, follow it.`;

// The page as passages for Nishiii to read: all of a short page, or samples from across a long one, each
// with the heading it sits under so the speaker is known.
function passagesOf(text) {
  if (text.length <= 20000) return [text];
  const out = [], size = 1600, tries = 12;
  for (let i = 0; i < tries; i++) {
    const from = Math.floor(((i + Math.random()) / tries) * (text.length - size));
    const brk = text.indexOf("\n", from);
    const at = brk >= 0 && brk - from < 600 ? brk + 1 : from;
    const before = text.lastIndexOf("\n==", at);
    const heading = before >= 0 ? text.slice(before + 1, text.indexOf("\n", before + 1)) : "";
    out.push((heading && !text.startsWith("==", at) ? heading + "\n" : "") + text.slice(at, at + size));
  }
  return out;
}
// Nishiii picks lines from the page; when Nishiii cannot answer or none of the picks passes, the lines on the
// page are taken without Claude (opensearch.js extractLines: each line under a character's heading, quoted text,
// "Name: line"). A line is kept only if its words are really on the page that was read.
async function pickFrom(env, kit, work, pg, about, taste, have, state) {
  const passages = passagesOf(have.had ? withoutHad(kit, pg.text, have.had) : pg.text);
  let answer = null;
  if (!pg.extractor) try {
    state.spent += 4;                                // the question itself, and the counting that goes with every question to Claude
    answer = kit.parseJson(await kit.claude(env, { system: PICK_SYSTEM, maxTokens: 2500, messages: [{ role: "user", content:
      `Work: ${work.title} (${work.type})${work.author ? ` by ${work.author}` : ""}\nPick up to ${PICK} lines.\n${about ? `about: ${about}\n` : ""}${taste ? `taste: ${JSON.stringify({ loves: taste.loves, avoids: taste.avoids, herNotes: taste.herNotes })}\n` : ""}\nPassages:\n${passages.map((p, i) => `--- ${i + 1} ---\n${p}`).join("\n")}` }] }));
  } catch (e) { O.say(env, "claude", { why: oneLineOf(e) }); }
  const flat = passages.map(kit.flatten).join("\n"), lower = flat.toLowerCase(), lines = [];
  const pick = (list, words) => {
    for (const q of Array.isArray(list) ? list : []) {
      const text = kit.flatten(q && q.text).replace(/^"+|"+$/g, "");
      // Kept only if the words are really on the page that was read.
      if (have.has(kit.norm(text))) O.agrees(have, kit.norm(text), pg);
      if (!O.lineLike(text) || !O.onPage(words, text) || have.has(kit.norm(text)) || HEADING.test(text)) { O.say(env, "rejected", { site: pg.site, why: "not on the page, too short or already kept", text: text.slice(0, 120) }); continue; }
      const by = kit.oneLine(q.by, 80);
      const named = by && (q.fromPage || lower.includes(by.toLowerCase())) ? by : "";
      // The gate (said.js): only what is said in the work. A quotes page's own list is its proof.
      const place = QUOTE_PAGES.has(pg.site) ? "quotes" : pg.site === "mydramalist.com" ? "mdl" : "page";
      const ctx = q.ctx ? { ...q.ctx, place } : S.contextOf(pg, text, place);
      const said = S.isSaid({ text, by: named }, work, ctx);
      if (!said.ok) { S.count(O.gateTally(state), said.why); O.say(env, "rejected", { site: pg.site, why: "gate: " + said.why, text: text.slice(0, 120) }); continue; }
      lines.push({ text, by: work.type === "book" ? pg.by || named : named, url: pg.url, site: pg.site, verify: !!pg.web,
        theme: kit.oneLine(q.theme, 30), tone: kit.oneLine(q.tone, 20), ctx });
      have.add(kit.norm(text));
      if (have.kept) have.kept.set(kit.norm(text), lines[lines.length - 1]);
      if (lines.length >= PICK) break;
    }
  };
  pick(answer, O.sameWords(flat));
  // Claude could not answer, picked nothing, or none of what it picked is on the page: the page's own lines,
  // found without it. (Picks that were all already kept are Claude's judgement that the page has no more.)
  if (!lines.length && (pg.extractor || !Array.isArray(answer) || !answer.length || answer.every((q) => !O.onPage(O.sameWords(flat), kit.flatten(q && q.text))))) {
    const got = O.extractLines(pg.text, { names: [...(work.cast || []), ...(work.characters || [])], list: pg.site === "wikiquote.org" });
    O.say(env, "candidates", { site: pg.site, url: pg.url, n: got.length, how: "without Claude" });
    pick(got.filter((q) => !q.other), O.sameWords(pg.text));
  }
  return lines;
}
const oneLineOf = (e) => String((e && e.message) || e || "").replace(/\s+/g, " ").slice(0, 120);
// The page without the lines she has already been shown (with or without "Name: " before them), so that a look
// for more, when she has had every kept line, is read for the others (forWorks passes them as "had").
function withoutHad(kit, text, had) {
  return text.split("\n").filter((l) => { const n = kit.norm(l); return !n || !(had.has(n) || had.has(kit.norm(l.replace(/^[^:]{1,32}: /, "")))); }).join("\n");
}
const QUOTE_PAGES = new Set(["wikiquote.org", "goodreads.com", "imdb.com"]);   // pages that are lists of a work's quotes

// ---------------------------------------------------------------- 3 and 4. Gemini and OpenAI, searching the web

const KIND_NAME = { book: "book", film: "film", series: "TV series" };
const EAST = /^(chinese|korean|south korean|japanese|taiwanese|thai|hong kong|filipino|vietnamese)$/i;
// What every question asks for, and the rules for each line.
const ANSWER_SHAPE = (want) => `Reply with a JSON array only, no other text, of up to ${want} items:
[{"text": "the line, word for word as the page has it", "by": "the character who says it, or the author for a book", "from": "the title of the work the page says the line is from", "page": "the address of the page it is on", "also": "the address of a second page on another site that gives the same wording, or an empty string"}]
Keep a line only when a page you read gives its wording and says it is from this work. Lines about the words of the title, or from other works, are not wanted. Never fill gaps from memory and never guess. One to three sentences each, under 45 words. If you find nothing real, reply with [].`;
// Where to read. A new work is quoted on social posts and fan blogs long before the quote sites have it.
function whereToRead(work) {
  const drama = work.type === "series" && EAST.test(work.country || "");
  const fresh = !work.year || work.year >= new Date().getUTCFullYear() - 2;
  return `Read pages that quote the work itself: quote pages (Goodreads, Wikiquote, IMDb${drama ? ", MyDramaList" : ""}, fan wikis), transcripts, reviews and articles${fresh ? ", and posts on Instagram, Pinterest, Tumblr and fan blogs" : ""}.`;
}
// Everything the two are told: the work, its public facts and how many lines. Nothing about her. Three ways of
// asking: for its quotes; under its original title; for its best lines and dialogue.
export const question = (work, want, shape = "quotes") => {
  const d = describe(work);
  const first = shape === "dialogue" ? `Search the web for the best lines and dialogue from ${d}.`
    : shape === "original" ? `Search the web for English quotes from ${d}. Search under its original title "${work.original}" too.`
    : `Search the web for real quotes from ${d}.`;
  return `${first}\n${whereToRead(work)}\n${ANSWER_SHAPE(want)}`;
};
const SHAPE_SAID = { quotes: "its quotes", original: "its original title", dialogue: "its best lines" };

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
const sameSite = (host, site) => !!host && !!site && (host === site || host.endsWith("." + site) || site.endsWith("." + host));
// The site a page Google read is on. Its links pass through Google (vertexaisearch.cloud.google.com), so the
// site comes from the page's title, which is usually the site's own name ("instagram.com", or "Instagram").
const BRANDS = { instagram: "instagram.com", pinterest: "pinterest.com", tumblr: "tumblr.com", facebook: "facebook.com", youtube: "youtube.com",
  tiktok: "tiktok.com", reddit: "reddit.com", x: "x.com", twitter: "x.com", threads: "threads.net", quora: "quora.com", medium: "medium.com",
  goodreads: "goodreads.com", wikiquote: "wikiquote.org", wikipedia: "wikipedia.org", imdb: "imdb.com", mydramalist: "mydramalist.com",
  fandom: "fandom.com", "rotten tomatoes": "rottentomatoes.com", "azquotes": "azquotes.com", "brainyquote": "brainyquote.com", douban: "douban.com", weibo: "weibo.com" };
export function siteOfChunk(c) {
  for (const v of [c.domain, c.title]) {
    const t = String(v || "").trim().toLowerCase().replace(/^www\./, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t)) return t;
    if (BRANDS[t]) return BRANDS[t];
  }
  const host = hostOf(c.uri);
  return /(^|\.)google\.com$|(^|\.)googleusercontent\.com$/.test(host) ? "" : host;
}

// Turns an answer into lines. "read" are the pages the service says it really read ({ uri, site }, the site ""
// when it could not be told), "behind(n)" the ones it says stand behind a piece of the answer. A line counts
// when a read page stands behind it, or when the page the model names is on a site that was read. A line with
// no read page behind it is left out; so is one the answer does not credit to this work (when a work is
// asked about). A line is sure only when two sites agree on it; otherwise it is marked to check.
// Returns { lines, dropped }: "dropped" counts the lines left out, by reason, for the trail.
function webLines(kit, said, read, behind, have, work = null, refused = {}) {
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  if (!read.length) { drop("no page was read"); return { lines: [], dropped }; }   // an answer from memory is not kept
  let answer;
  try { answer = kit.parseJson(said); } catch (e) { drop("an answer that was not a list"); return { lines: [], dropped }; }
  const lines = [], told = read.filter((r) => r.site);
  for (const q of Array.isArray(answer) ? answer : []) {
    const text = kit.flatten(q && q.text).replace(/^"+|"+$/g, ""), n = kit.norm(text);
    if (text.length < 20 || text.length > 400) { drop("too short or too long"); continue; }
    if (have.has(n)) { drop("already kept"); continue; }
    if (work && !fromThisWork(kit, work, q.from)) { drop("not said to be from this work"); continue; }
    const ctx = { place: "helper" }, gate = S.isSaid({ text, by: kit.oneLine(q.by, 80) }, work, ctx);     // said.js
    if (!gate.ok) { S.count(refused, gate.why); continue; }
    const pages = behind(n);
    const urls = [q.page, q.also].map((u) => kit.foundAt(u)).filter((u) => u && !/(^|\.)google\.com$/.test(hostOf(u)));
    const named = urls.filter((u) => told.some((r) => sameSite(hostOf(u), r.site)));
    if (!pages.length && !named.length) { drop("no page behind it"); continue; }
    // The page to show: one the model names on a site that was read; else a page behind the line (when Google
    // did not say its site, the page the model names tells it, still to be checked).
    let url = named[0], site = named[0] ? hostOf(named[0]) : "";
    if (!url) {
      const p = pages.find((x) => x.site);
      if (p) { url = urls.find((u) => sameSite(hostOf(u), p.site)) || p.uri; site = p.site; }
      else if (urls[0]) { url = urls[0]; site = hostOf(urls[0]); }
      else url = pages[0].uri;
    }
    const sites = new Set([...pages.map((p) => p.site).filter(Boolean), ...named.map(hostOf)]);
    lines.push({ text, by: kit.oneLine(q.by, 80), url, site, verify: sites.size < 2, theme: "", tone: "",
      ...(q.work ? { work: kit.oneLine(q.work, 120), type: ["book", "film", "series"].includes(q.type) ? q.type : "classic" } : {}), ctx });
    have.add(n);
  }
  return { lines, dropped };
}

// ---------------------------------------------------------------- which models to ask

// The flash models a Gemini key may use for generateContent, in the order to try them. Google's price list (checked
// 15 Nov 2026) gives Search grounding on the free tier only to gemini-2.5-flash-lite and gemini-2.5-flash (500 a day,
// shared); every Gemini 3 and newer model has none there (a 429 with "limit: 0"). So those two come first, then the
// other flash-lite models, newest first, then the flash models, newest first. Up to five, so a key on the free tier
// still reaches one that may search.
export const FREE_GROUNDING = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const versionOf = (name) => Number((/-(\d+(?:\.\d+)?)-/.exec(name) || [])[1]) || 0;
export function pickGemini(models) {
  const names = (Array.isArray(models) ? models : []).filter((m) => m && (m.supportedGenerationMethods || []).includes("generateContent"))
    .flatMap((m) => [m.baseModelId, String(m.name || "").replace(/^models\//, "")]).map((n) => String(n || ""))
    .filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
  const free = (n) => (FREE_GROUNDING.includes(n) ? FREE_GROUNDING.indexOf(n) : 9);
  return [...new Set(names)].sort((a, b) => free(a) - free(b) || b.endsWith("-lite") - a.endsWith("-lite") || versionOf(b) - versionOf(a)).slice(0, 5);
}
// OpenAI: the models it offers, in the app's order of preference (cheapest that can search first); failing
// those, the newest general GPT models it lists.
export const OPENAI_PREFER = ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"];
export function pickOpenAI(models) {
  const list = (Array.isArray(models) ? models : []).filter((m) => m && typeof m.id === "string");
  const ids = new Set(list.map((m) => m.id));
  const liked = OPENAI_PREFER.filter((id) => ids.has(id));
  const other = list.filter((m) => /^gpt-\d+(\.\d+)?(-[a-z]+)?$/.test(m.id) && !/(realtime|image|audio|transcribe|tts|search|cyber|live|codex|chat|mini|nano)/.test(m.id) && !liked.includes(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0)).map((m) => m.id);
  return [...liked, ...other].slice(0, 3);
}
const SETTING = { gemini: "GEMINI_MODEL", openai: "OPENAI_MODEL" };
const names = (v) => String(v || "").split(",").map((m) => m.trim()).filter((m) => /^[a-z0-9.-]+$/i.test(m)).slice(0, 5);
// Reads the list of models a key may use. Costs nothing and asks nothing. { list, status, said }.
export async function listModels(env, who, ms = 8000) {
  const res = who === "gemini"
    ? await fetch(`${env.GEMINI_API || "https://generativelanguage.googleapis.com"}/v1beta/models?pageSize=1000`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY }, signal: AbortSignal.timeout(ms) })
    : await fetch(`${env.OPENAI_API || "https://api.openai.com"}/v1/models`, { headers: { Authorization: "Bearer " + env.OPENAI_API_KEY }, signal: AbortSignal.timeout(ms) });
  const text = await res.text().catch(() => "");
  if (!res.ok) return { list: [], status: res.status, said: serviceSaid(text, env) };
  let data = {};
  try { data = JSON.parse(text); } catch (e) { return { list: [], status: res.status, said: "a list that could not be read" }; }
  return { list: who === "gemini" ? pickGemini(data.models) : pickOpenAI(data.data), status: res.status, said: "" };
}
// The models to try, in order: the setting when there is one; else the ones the key may use, as asked within the
// last week (the one that last worked first); else asked now; failing that, the built-in names.
async function modelsFor(env, kit, state, who, fallback) {
  if (env[SETTING[who]]) return { list: names(env[SETTING[who]]) };
  const rec = state.rec, kept = (rec.models || {})[who];
  if (kept && Array.isArray(kept.list) && kept.list.length && Date.now() - kept.at < MODEL_DAYS * DAY) {
    return { list: [...new Set([kept.worked, ...kept.list].filter((m) => m && kept.list.includes(m)))] };
  }
  state.spent += 1;
  let got;
  try { got = await listModels(env, who); }
  catch (e) { got = { list: [], status: 0, said: e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached" }; }
  if (got.list.length) {
    rec.models = { ...(rec.models || {}), [who]: { list: got.list, at: Date.now() } };
    state.dirty = true;
    step(state, who, "models", { list: got.list });
    return { list: got.list };
  }
  const how = got.status ? classify(who, got.status, got.said) : "no answer";
  step(state, who, how === "key refused" ? how : "models unknown", { status: got.status || undefined, said: got.said || undefined, why: how === "key refused" ? undefined : "the built-in names are tried" });
  if (how === "key refused") return { refused: true, status: got.status, said: got.said };
  return { list: names(fallback) };
}
// The service's own short words about a refusal: its error message, tidied.
function serviceSaid(text, env) {
  let m = "";
  try { const j = JSON.parse(text); m = (j.error && (j.error.message || j.error.status)) || j.message || ""; } catch (e) { m = String(text || "").replace(/<[^>]*>/g, " "); }
  // Google's quota refusals say what matters on their second line: which quota, its limit and the model.
  const q = /Quota exceeded for metric: (?:[a-z.]+\/)?([a-z_]+), (limit: \d+)(, model: [a-z0-9.-]+)?/i.exec(m);
  if (q) m = `Quota exceeded: ${q[1].replace(/_/g, " ")}, ${q[2]}${q[3] || ""}`;
  return tidy(m, env);
}
// What a refusal means: "used up" (the allowance), "key refused", "may not search" (this model, or this plan,
// may not use the search tool: the next model is tried), "no model" (not offered: the next is tried), or
// "no answer" (the service is unwell).
function classify(who, status, said) {
  const s = String(said || "");
  if (status === 429) return /insufficient_quota|billing/i.test(s) && who === "openai" ? "no credit" : "used up";
  if (status === 401 || (status === 400 && /api[ _]?key/i.test(s))) return "key refused";
  if ((status === 403 || status === 400) && /search|ground|tool/i.test(s)) return "may not search";
  if (status === 403) return "key refused";
  if (status === 404 || (status === 400 && /model/i.test(s))) return "no model";
  if (status === 400) return "may not search";
  return "no answer";
}
const OFF = { "used up": "used up", "key refused": "refused", "may not search": "may not search", "no model": "no model", "no allowance": "no allowance", "no credit": "no credit" };
// What a 429 means, from its body (and headers): { how, wait }.
//   "no allowance"  Gemini: this model has no allowance at all on this key ("limit: 0", the free tier): the next model.
//   "used up"       Gemini: this model's allowance for the day is spent (a per-day quota): the next model.
//   "no credit"     OpenAI: the account has no credit (insufficient_quota): nothing more today, whatever the model.
//   "busy"          a passing rate limit (per minute, or a short "retry in"): wait "wait" ms and ask once more.
export function refusalOf(who, status, text, headers = null) {
  let err = {};
  try { err = (JSON.parse(text) || {}).error || {}; } catch (e) { err = {}; }
  const msg = String(err.message || text || ""), code = `${err.code || ""} ${err.type || ""} ${err.status || ""}`;
  const secs = (v) => { const m = /([\d.]+)\s*(ms|s)\b/.exec(String(v || "")); return m ? Number(m[1]) * (m[2] === "ms" ? 1 : 1000) : NaN; };
  let wait = NaN;
  if (who === "openai") {
    if (/insufficient_quota/.test(code) || /insufficient_quota|exceeded your current quota/i.test(msg)) return { how: "no credit" };
    wait = Number(headers && headers.get && headers.get("retry-after-ms")) || secs((/try again in ([\d.]+\s*m?s)/i.exec(msg) || [])[1]) || Number(headers && headers.get && headers.get("retry-after")) * 1000;
    return { how: "busy", wait: Number.isFinite(wait) && wait > 0 ? wait : 1500 };
  }
  const details = Array.isArray(err.details) ? err.details : [];
  const quota = details.flatMap((d) => (d && d.violations) || []).map((v) => `${v.quotaId || ""} ${v.quotaMetric || ""}`).join(" ");
  const retry = details.find((d) => d && /RetryInfo/.test(d["@type"] || ""));
  wait = secs(retry && retry.retryDelay) || secs((/retry in ([\d.]+\s*m?s)/i.exec(msg) || [])[1]);
  if (/limit:\s*0\b/.test(msg) || /FreeTier/i.test(quota) && /limit:\s*0\b/.test(msg)) return { how: "no allowance" };
  if (/PerDay/i.test(quota) || /per day/i.test(msg)) return { how: "used up" };
  if (/PerMinute/i.test(quota) || Number.isFinite(wait)) return { how: "busy", wait: Number.isFinite(wait) ? wait : 1500 };
  return { how: "used up" };
}
const MAX_WAIT = 4000;                  // a passing rate limit is waited out only this long; longer, the next model
// Asks one of the two, trying its models in order. Counts every question against the day's limit first.
// A refusal (the allowance is used up, the key is not accepted, no model may search) means "not today":
// nothing more is asked of it until tomorrow. Every answer and refusal goes on the trail; how the last
// question went is kept in "last" for the health record (probes.js). Answers null when nothing came back.
async function ask(env, kit, state, who, fallback, send, read) {
  const rec = await openRecord(env, kit, state), use = rec[who];
  const outcome = (what) => { rec.last[who] = { at: Date.now(), what }; state.dirty = true; };
  const limit = () => { outcome("limit"); step(state, who, "not asked", { why: `the app's limit of ${A_DAY[who]} a day` }); noteUse(state, who, "limit"); return null; };
  if (use.off) { step(state, who, "not asked", { why: `resting until tomorrow: ${use.off}` }); noteUse(state, who, "resting", { why: use.off }); return null; }
  if (use.calls >= A_DAY[who]) return limit();
  if (state.busy && state.busy[who]) { step(state, who, "not asked", { why: "it asked the app to wait, a moment ago" }); return null; }
  const models = await modelsFor(env, kit, state, who, fallback);
  if (models.refused) { use.off = "refused"; outcome("refused"); noteUse(state, who, "key refused", { status: models.status, said: models.said }); return null; }
  let last = "";
  use.skip = Array.isArray(use.skip) ? use.skip : [];
  const list = models.list.filter((m) => !use.skip.includes(m));
  if (!list.length && models.list.length) { use.off = "no allowance"; outcome(use.off); step(state, who, "not asked", { why: "no model it may use has an allowance today" }); return null; }
  for (const model of list) {
    for (let again = 0; again < 2; again++) {
      if (use.calls >= A_DAY[who]) return limit();
      use.calls += 1;
      await saveRecord(env, kit, state);               // counted before asking, so a question that never returns still counts
      let res;
      state.spent += 1;
      try { res = await send(model); }
      catch (e) {
        const why = e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached";
        outcome("no answer"); step(state, who, "no answer", { model, why }); noteUse(state, who, "no answer", { model, why }); return null;
      }
      if (res.ok) {
        try {
          const got = read(await res.json());
          outcome("worked");
          use.answered = (use.answered || 0) + 1;
          const m = (rec.models || {})[who];
          if (m && m.worked !== model) { m.worked = model; state.dirty = true; }
          rec.last[who].model = model;
          noteUse(state, who, got.read.length ? "answered" : "all rejected", { model, ...(got.read.length ? {} : { why: "it read no page" }) });
          return { ...got, model };
        } catch (e) { outcome("no answer"); step(state, who, "no answer", { model, status: res.status, why: "an answer that could not be read" }); noteUse(state, who, "no answer", { model, why: "an answer that could not be read" }); return null; }
      }
      const body = await res.text().catch(() => "");
      const said = serviceSaid(body, env);
      const r = res.status === 429 ? refusalOf(who, 429, body, res.headers) : { how: classify(who, res.status, said) };
      const how = r.how;
      if (how !== "no answer") use.refused = (use.refused || 0) + 1;
      step(state, who, how, { model, status: res.status, said, ...(how === "busy" ? { why: again ? "still busy after a wait" : `asked again after ${Math.round(Math.min(r.wait, MAX_WAIT) / 100) / 10} s` } : {}) });
      noteUse(state, who, how, { model, status: res.status, said });
      if (how === "busy") {
        // A passing rate limit: waited out once (when short), never a reason to stop for the day.
        if (!again && r.wait <= MAX_WAIT) { await new Promise((done) => setTimeout(done, r.wait)); continue; }
        outcome("busy"); state.dirty = true; state.busy = { ...(state.busy || {}), [who]: true }; return null;
      }
      if (how === "no answer") { outcome("no answer"); return null; }
      if (how === "no credit" || how === "key refused") { use.off = OFF[how]; outcome(use.off); return null; }
      if (how === "no allowance" || how === "used up") { use.skip.push(model); state.dirty = true; }
      last = how;                                     // this model has no allowance, may not search, or is not offered: the next one
      break;
    }
  }
  if (last && use.calls < A_DAY[who]) {
    use.off = OFF[last]; outcome(use.off);
    // None of the models worked: the list is asked again next time.
    if (last === "no model" && rec.models && rec.models[who]) delete rec.models[who];
  }
  return null;
}

// Gemini with Google Search. The models are asked of Google (above); GEMINI_MODEL (one name, or up to three
// with commas) can replace them without a change to the app, and these are tried when the list can't be read.
export const GEMINI_MODELS = "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.8-flash";
// One question to Gemini with Google Search: { said, read, behind, model } (the answer, the pages read, and
// for a piece of the answer the pages behind it), or null.
export function geminiSearch(env, kit, state, prompt, ms = 20000) {
  return ask(env, kit, state, "gemini", GEMINI_MODELS,
    (model) => fetch(`${env.GEMINI_API || "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }) }),
    (data) => {
      const cand = (data.candidates || [])[0] || {}, meta = cand.groundingMetadata || {};
      const said = (((cand.content || {}).parts) || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
      // The pages Google says were read. Its links to them pass through Google, so the site's name comes from the title.
      const read = (meta.groundingChunks || []).map((c) => (c && c.web) || {}).map((c) => ({ uri: kit.foundAt(c.uri), site: siteOfChunk(c) }));
      const behind = (n) => {
        const at = new Set();
        for (const s of meta.groundingSupports || []) {
          const part = kit.norm((s.segment || {}).text);
          if (part && (part.includes(n) || (part.length >= 20 && n.includes(part)))) for (const i of s.groundingChunkIndices || []) if (read[i] && read[i].uri) at.add(i);
        }
        return [...at].map((i) => read[i]);
      };
      return { said, read: read.filter((r) => r.uri), behind, queries: (meta.webSearchQueries || []).slice(0, 4).map((q) => kit.oneLine(q, 80)) };
    });
}
// OpenAI with its web search tool (the Responses API). OPENAI_MODEL can replace the models, as for Gemini.
export const OPENAI_MODELS = "gpt-6-luna,gpt-6.1-terra";
export function openaiSearch(env, kit, state, prompt, ms = 25000) {
  return ask(env, kit, state, "openai", OPENAI_MODELS,
    (model) => fetch(`${env.OPENAI_API || "https://api.openai.com"}/v1/responses`, {
      method: "POST", headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" }, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }], tool_choice: "required", include: ["web_search_call.action.sources"], store: false }) }),
    (data) => {
      const out = Array.isArray(data.output) ? data.output : [];
      const parts = out.filter((o) => o.type === "message").flatMap((o) => o.content || []).filter((c) => c.type === "output_text");
      const said = parts.map((c) => c.text || "").join("");
      // The pages it read: the ones it cites in the answer, and the ones its searches opened.
      const cited = parts.flatMap((c) => (c.annotations || []).filter((a) => a.type === "url_citation").map((a) => ({ uri: kit.foundAt(a.url), site: hostOf(a.url), about: kit.norm(String(c.text || "").slice(a.start_index, a.end_index)) })));
      const opened = out.filter((o) => o.type === "web_search_call").flatMap((o) => (o.action && o.action.sources) || []).map((s) => ({ uri: kit.foundAt(s.url), site: hostOf(s.url) }));
      const behind = (n) => cited.filter((c) => c.uri && c.about && (c.about.includes(n) || (c.about.length >= 20 && n.includes(c.about))));
      const queries = out.filter((o) => o.type === "web_search_call").flatMap((o) => (o.action && (o.action.queries || [o.action.query])) || []).filter(Boolean).slice(0, 4).map((q) => kit.oneLine(q, 80));
      return { said, read: [...cited, ...opened].filter((r) => r.uri && r.site), behind, queries };
    });
}
// One question about a work to one of the two, with the outcome on the trail.
async function fromHelper(env, kit, who, work, want, have, state, shape = "quotes") {
  const got = await (who === "gemini" ? geminiSearch : openaiSearch)(env, kit, state, question(work, want, shape));
  if (!got) return [];
  const { lines, dropped } = webLines(kit, got.said, got.read, got.behind, have, work, O.gateTally(state));
  const why = Object.entries(dropped).map(([k, v]) => `${v} ${k}`).join(", ");
  noteUse(state, who, lines.length ? "found" : "all rejected", { model: got.model, n: lines.length, ...(why ? { why } : {}) });
  step(state, who, lines.length ? "found" : "no line passed", { q: SHAPE_SAID[shape], model: got.model, n: lines.length,
    read: [...new Set(got.read.map((r) => r.site || "a page Google did not name"))].slice(0, 5), ...(why ? { why } : {}) });
  return lines;
}

// ---------------------------------------------------------------- the whole search for one request

// Should the title be checked before this look? When the app does not know the work yet: never checked, or
// checked more than a day ago without a result (and no "Did you mean ...?" waiting for her answer).
// Also when what is known is thin (no year, no cast, no characters) and the last look found nothing, a few hours on.
// A "Did you mean ...?" waiting for her answer does not stop it: her own title may still be a real work.
const thin = (k) => !k || (!Number(k.year) && !(k.cast || []).length && !(k.characters || []).length);
const needsKnowing = (work) => {
  const since = Date.now() - (work.titleChecked || 0);
  if (!work.known) return !work.titleChecked || since > DAY || (!kept(work).length && since > 2 * HOUR && !!work.found);
  // Known only thinly (no year, cast or characters) and nothing kept: find out more before every look of hers.
  return thin(work.known) && !kept(work).length && since > 2 * 60 * 1000;
};

// Looks one work up, place after place until there are enough lines, and returns what to keep on it.
// A look that runs out of time or of calls stops there, and the next one carries on at the place it stopped.
// What the title check learns is put on "item" itself (known, maybe, titleChecked), for keep() to save.
async function lookUp(env, kit, item, need, about, taste, state) {
  state.trail = [];
  state.refused = {};                              // what the gate (said.js) refused in this look, by reason
  state.feature = "lookup";
  if (needsKnowing(item) && state.spent + 4 <= (state.budget || BUDGET)) {
    try {
      const got = await V.checkTitle(env, kit, item, item.type, state);
      // What was learnt before stays when this check learns less; a new close title is offered only with nothing known.
      if (got.known) Object.assign(item, got);
      else Object.assign(item, { titleChecked: got.titleChecked }, item.known ? {} : { maybe: got.maybe || item.maybe || null });
    }
    catch (e) { if (e instanceof kit.UserError && e.status !== 502) throw e; step(state, "title", "no answer", { why: tidy(e && e.message, env, 80) }); }
  }
  const work = withKnown(kit, item);
  const have = new Set(kept(work).map((l) => kit.norm(l.text)));
  for (const n of item.had || []) have.add(n);     // and what she has already been shown (forWorks), so only new lines are picked
  if (item.had) have.had = item.had;
  have.kept = new Map();                           // the lines of this look, so a second site that agrees makes one sure
  const prior = work.found || {};
  // Its reading list (opensearch.js): where its lines are written down and how far it has been read.
  const fresh = !(prior.v === LOOK_VERSION && prior.at && Date.now() - (prior.first || prior.at) < LOOK_AGAIN_DAYS * DAY);
  state.more = O.newMore(fresh ? null : prior.more);
  // A work looked up already, with pages left to read: this round reads on, and asks the other places nothing.
  const readingOn = !fresh && typeof prior.resume !== "number" && !!prior.more && O.leftToRead(env, work, state.more);
  let lines = [], where = "", waiting = null;
  // Reading a page: finds it, has Nishiii pick from it, and copes quietly when the site is unreachable. A site
  // that turned the app away is still read when "viaTavily" and Tavily's Extract can read its pages.
  const read = async (site, find, viaTavily = false) => {
    await openRecord(env, kit, state);
    if (resting(state, site) && !(viaTavily && O.canExtract(env, state))) {
      // Said once a day; a rest of a week is not repeated on every look.
      const s = state.rec.sites[site];
      if ((s.until || 0) - (s.failed || 0) <= DAY || Date.now() - s.failed < DAY) step(state, site, "not asked", { why: (s.until || 0) - (s.failed || 0) > DAY ? `it turned the app away; resting until ${new Date(s.until).toISOString().slice(0, 10)}` : "it turned the app away earlier today" });
      return;
    }
    const before = state.trail.length;
    try {
      const pg = await find(env, kit, work, state);
      if (!pg) { if (state.trail.length === before) step(state, site, "no page", { why: `no page for ${work.real || work.title}` }); return; }
      const got = await pickFrom(env, kit, work, pg, about, taste, have, state);
      if (got.length) noteSite(state, site, "");
      if (got.length && !where) where = pg.name;
      step(state, site, got.length ? "found" : "no line passed", { n: got.length, ...(got.length ? {} : { why: "no line on the page was picked" }) });
      lines = lines.concat(got);
    } catch (e) {
      if (e instanceof kit.UserError && e.status !== 502) throw e;      // Nishiii is switched off or at the day's limit: say so
      if (e.blocked) noteBlocked(state, site, e.blocked);
      else if (!(e instanceof kit.UserError)) noteSite(state, site, e.name === "TimeoutError" ? "no answer in time" : "could not be reached");
      else step(state, site, "no answer", { why: "Nishiii could not read the page just now" });
    }
  };
  const more = () => Math.min(PICK, need - lines.length + 3);
  const helper = (who, shape) => ({ cost: 3, name: who, look: async () => { lines = lines.concat(await fromHelper(env, kit, who, work, more(), have, state, shape)); } });
  // The questions to the search helpers: each way of asking to Gemini, then to OpenAI, at most three in all.
  const shapes = ["quotes", ...(work.original ? ["original"] : []), "dialogue"];
  const helpers = [["gemini", env.GEMINI_API_KEY], ["openai", env.OPENAI_API_KEY]].filter(([, key]) => key).map(([who]) => who);
  const asks = shapes.flatMap((shape) => helpers.map((who) => helper(who, shape))).slice(0, QUESTIONS);
  const places = [
    { cost: 6, name: "wikiquote", look: () => read("wikiquote", wikiquotePage) },
    { cost: 6, name: "mydramalist", off: !mdlFits(work), look: () => read("mydramalist", mdlPage, true) },
    // Goodreads and IMDb ask that robots don't read their pages; this step can be switched off with QUOTE_SITES=off.
    { cost: 6, name: work.type === "book" ? "goodreads" : "imdb", off: env.QUOTE_SITES === "off", look: () => read(work.type === "book" ? "goodreads" : "imdb", work.type === "book" ? goodreadsPage : imdbPage) },
    // The web with no paid allowance (opensearch.js): Tavily or Serper when their keys are set, else a public
    // results page; then the pages it points to, read for lines word for word.
    { cost: 10, name: "web", off: !O.providers(env).length, look: async () => {
      await openRecord(env, kit, state);
      try {
        const got = await O.linesForWork(env, kit, work, state, { want: more(), have, about });
        const why = Object.entries(got.dropped).map(([k, v]) => `${v} ${k}`).join(", ");
        step(state, "web", got.lines.length ? "found" : got.pages.length ? "no line passed" : "no page", { n: got.lines.length,
          counts: { ...(got.counts || {}), dropped: got.dropped },
          read: [...new Set(got.pages.map((p) => p.site))].slice(0, 4), ...(why ? { why } : got.pages.length ? {} : { why: "no page that names this work" }) });
        if (got.lines.length && !where) where = got.lines[0].url;
        lines = lines.concat(got.lines);
      } catch (e) {
        if (e instanceof kit.UserError && e.status !== 502) throw e;
        step(state, "web", "no answer", { why: e instanceof kit.UserError ? "Nishiii could not read the pages just now" : tidy(e && e.message, env, 80) });
      }
    } },
    ...asks,
  ];
  // Reading on (opensearch.js readOn): the next review or quotes pages, the results not read yet, or one more
  // question. Last in a first look (when there is room), alone in the rounds after it.
  const readMore = { cost: 7, name: "more", get off() { return !O.leftToRead(env, work, state.more); }, look: async () => {
    try {
      const got = await O.readOn(env, kit, work, state, { want: 30, have, about });
      if (got.waiting) { waiting = got.waiting; step(state, "more", "not asked", { why: got.waiting.why === "limit" ? "the app's daily limit of pages read through Tavily" : "Tavily's page reader is resting" }); return; }
      step(state, "more", got.lines.length ? "found" : got.read ? "no line passed" : "no page", { n: got.lines.length, pages: got.read });
      if (got.lines.length && !where) where = got.lines[0].url;
      lines = lines.concat(got.lines);
    } catch (e) {
      if (e instanceof kit.UserError && e.status !== 502) throw e;
      step(state, "more", "no answer", { why: tidy(e && e.message, env, 80) });
    }
  } };
  if (readingOn) places.length = 0;
  places.push(readMore);
  let resume;
  for (let i = !readingOn && typeof prior.resume === "number" && Date.now() - prior.at < DAY ? prior.resume : 0; i < places.length && lines.length < need; i++) {
    if (places[i].off) continue;
    const late = Date.now() - state.began > state.limit;
    if (late || state.spent + places[i].cost > (state.budget || BUDGET)) {
      if (readingOn || places[i] === readMore) break;       // reading on simply waits for the next round
      resume = i;
      step(state, places[i].name, "not asked", { why: late ? "out of time for now: the next look carries on here" : "out of calls for now: the next look carries on here" });
      break;
    }
    await places[i].look();
  }
  // The gate's second step (said.js): the new lines are judged by Nishiii in one question; when Nishiii cannot
  // be asked, only lines whose page shows by its structure that they are said in the work stay.
  const judged = await S.judge(env, kit, work, lines, { state });
  lines = judged.kept;
  const gate = gateNote(state, judged, lines.length);
  const all = [...kept(work), ...lines].slice(-KEEP);
  const steps = state.trail.slice();
  const out = { ...prior, v: LOOK_VERSION, at: Date.now(), first: fresh ? Date.now() : prior.first || prior.at, added: lines.length, resume, page: where || prior.page || "", lines: all,
    tries: all.length ? 0 : (prior.tries || 0) + 1, trail: { at: Date.now(), said: sayTrail(steps, lines.length), steps, ...(gate ? { gate } : {}) },
    more: state.more, ...(waiting ? { wait: { why: waiting.why, until: waiting.until } } : {}) };
  if (resume === undefined) delete out.resume;
  if (!waiting) delete out.wait;
  keepTrail(state, work, steps, lines.length);
  keepCoarse(state, item, steps, lines.length);
  return out;
}
// The gate on the trail, beside the steps: how many lines it kept and refused, and why (counts only, no line).
// { kept, refused: { why: n }, how, said }: "how" is "claude", "structure" or "".
const GATE_HOW = { claude: "judged by Nishiii", structure: "Nishiii could not be asked: kept only lines the page itself shows are said in the work" };
function gateNote(state, judged, n) {
  const refused = O.gateTally(state);
  for (const [k, v] of Object.entries(judged.refused || {})) refused[k] = (refused[k] || 0) + v;
  const sum = S.tallySum(refused);
  state.gate = !judged.how && !sum ? null : { kept: n, refused: { ...refused }, how: judged.how || "",
    said: [`gate: ${n} kept, ${sum} refused${sum ? ` (${S.tallyText(refused)})` : ""}`, GATE_HOW[judged.how]].filter(Boolean).join("; ") };
  return state.gate;
}
// The gate's record, coarse, for the open health record: counts by reason, reasons in plain lower-case words.
const coarseGate = (g) => (g ? { kept: Number(g.kept) || 0, how: String(g.how || "").slice(0, 10),
  refused: Object.fromEntries(Object.entries(g.refused || {}).filter(([why, v]) => DROP_WORDS.test(why) && Number.isFinite(v)).slice(0, 10)) } : null);
// For the open health record (/api/health): the last look only, with no title and no line, only what each
// step did and its counts, and whether the work was identified. So Nishith can see how it went without signing in.
function keepCoarse(state, item, steps, n) {
  if (!state.rec) return;
  const k = item.known || {};
  state.rec.coarse = { at: Date.now(), type: item.type, identified: !!item.known, kind: item.known ? k.kind || "" : "", year: item.known ? Number(k.year) || 0 : 0,
    kept: n, steps: steps.slice(0, 16).map((s) => ({ where: String(s.where || "").slice(0, 20), what: String(s.what || "").slice(0, 20),
      ...(Number.isFinite(s.n) ? { n: s.n } : {}), ...(s.counts ? { counts: coarseCounts(s.counts) } : {}) })), ...(state.gate ? { gate: coarseGate(state.gate) } : {}) };
  state.dirty = true;
}
const DROP_WORDS = /^[a-z ]{3,40}$/;
const coarseCounts = (c) => ({ ...Object.fromEntries(["results", "read", "about", "tried"].filter((k) => Number.isFinite(c[k])).map((k) => [k, c[k]])),
  // which public sites the results were on and what became of each (no address, no title, no words of hers)
  ...(Array.isArray(c.sites) ? { sites: c.sites.slice(0, 10).map((x) => String(x).replace(/[^a-z0-9 .:-]/gi, "").slice(0, 60)) } : {}),
  dropped: Object.fromEntries(Object.entries(c.dropped || {}).filter(([why, v]) => DROP_WORDS.test(why) && Number.isFinite(v)).slice(0, 8)) });
// The coarse record in words: "title: identified (series, 2026); wikiquote: no page; web: 5 results, 3 pages about
// the work, 12 candidates, 2 kept (9 not on the page, 1 too short or too long)".
export function coarseText(c) {
  if (!c || !Array.isArray(c.steps)) return "";
  const step = (s) => {
    const k = s.counts;
    if (!k) return `${s.where}: ${s.what}${Number.isFinite(s.n) && s.n ? ` (${s.n})` : ""}`;
    const drops = Object.entries(k.dropped || {}).map(([why, v]) => `${v} ${why}`).join(", ");
    return `${s.where}: ${k.results ?? 0} results, ${k.read ?? 0} pages read, ${k.about ?? 0} about the work, ${k.tried ?? 0} candidates, ${s.n || 0} kept${drops ? ` (${drops})` : ""}${k.sites ? ` [${k.sites.join(" | ")}]` : ""}`;
  };
  const g = c.gate, refused = g ? Object.entries(g.refused || {}) : [];
  const gate = g ? [`gate: ${g.kept || 0} kept, ${refused.reduce((a, [, v]) => a + v, 0)} refused${refused.length ? ` (${refused.map(([why, v]) => `${v} ${why}`).join(", ")})` : ""}${g.how ? `, ${g.how === "claude" ? "judged by Nishiii" : "on the pages' structure"}` : ""}`] : [];
  return [`work identified: ${c.identified ? `yes (${[c.kind, c.year].filter(Boolean).join(", ")})` : "no"}`, ...c.steps.map((s) => s.where === "title" ? `title check: ${s.what}` : step(s)), ...gate, `lines kept: ${c.kept || 0}`].join("; ");
}
// The last few trails, in data/lookups.json, for Nishith.
export function keepTrail(state, work, steps, n) {
  if (!state.rec) return;
  const list = Array.isArray(state.rec.trails) ? state.rec.trails : [];
  list.push({ title: String(work.title || "").slice(0, 120), type: work.type, at: Date.now(), n, steps, ...(state.gate ? { gate: state.gate } : {}) });
  state.rec.trails = list.slice(-TRAILS);
  state.dirty = true;
}

// Real lines for the works she named. "works" are Library items with a "type" (book, film or series);
// "room" is how many quotes are still wanted and "also" how many other sources share that room.
// Returns { items, short, dry }: the quotes, the works that did not get as many as their share, and of those the
// ones with nothing new left to find for now (looked up just now, or a moment ago, and still nothing new).
// "reading": of the short ones, those with pages still to read (the next round reads on); "waiting": those whose
// pages wait for a service that rests until tomorrow (Tavily's Extract), each { work, wait }.
export async function forWorks(env, kit, lib, works, { room, also = 0, about = "", taste = null, seen, ranker = null }) {
  const items = [], short = [], looked = [], dry = [], reading = [], waiting = [];
  const state = newState(env);
  const words = kit.norm(about).split(" ").filter((w) => w.length > 3);
  for (let i = 0; i < works.length && room > 0; i++) {
    const work = works[i];
    const share = Math.ceil(room / (works.length - i + also));
    let have = unused(kit, lib, work, seen);
    const isDue = due(work, have.n, share, Date.now(), canReadOn(env, kit, work));
    let lookedNow = false;
    if (state.spent + 6 <= BUDGET && Date.now() - state.began <= state.limit && isDue) {
      work.had = seen;                                   // the look picks only lines she has not been shown
      work.found = await lookUp(env, kit, work, Math.max(1, share - have.n), about, taste, state);
      delete work.had;
      looked.push(work);
      lookedNow = true;
      have = unused(kit, lib, work, seen);
    }
    // (A look that had to stop early, out of time or calls, carries on next time: that is not "nothing left".)
    // Not "nothing left" either while its reading list has pages to read, or waits for a service resting until tomorrow.
    const wait = have.n < share ? waitingFor(work) : null;
    if (wait) waiting.push({ work, wait });
    else if (have.n < share && canReadOn(env, kit, work)) reading.push(work);
    else if (have.n < share && ((lookedNow && typeof work.found.resume !== "number") || !isDue)) dry.push(work);
    // Her own lines from this title first; then found lines: those on her subject, or as the scorer ranks them.
    let pool = shuffle(have.found);
    if (words.length) pool.sort((a, b) => words.filter((w) => kit.norm(b.text).includes(w)).length - words.filter((w) => kit.norm(a.text).includes(w)).length);
    else if (ranker && pool.length > share) pool = ranker.choose(pool, share, items);
    const take = [...shuffle(have.own), ...pool].slice(0, share);
    for (const q of take) seen.add(kit.norm(q.text));
    items.push(...take);
    room -= take.length;
    if (take.length < share) short.push(work);
  }
  await closeRecord(env, kit, state);
  if (looked.length) await keep(env, kit, lib, looked);
  return { items, short, dry, reading, waiting, said: reading.length ? O.readingWhat(withKnown(kit, reading[0]), reading[0].found.more) : "" };
}
// Writes what was found onto the works in the Library. The Library is read afresh first, so anything she
// changed while the search ran is not lost.
async function keep(env, kit, lib, looked) {
  const now = await kit.loadDoc(env, "library", null);
  if (!now) return;
  for (const work of looked) {
    for (const from of [now, lib]) {
      const item = [...(from.books || []), ...(from.screen || [])].find((x) => x.id === work.id);
      if (!item) continue;
      item.found = work.found;
      // What the title check learnt on the way, unless she changed the title meanwhile.
      if (work.titleChecked && kit.norm(item.title) === kit.norm(work.title)) for (const k of ["titleChecked", "known", "maybe"]) if (k in work) item[k] = work[k];
    }
  }
  await kit.saveDoc(env, "library", now);
}

// ---------------------------------------------------------------- the daily five

// A few kept lines for the brief Nishiii reads when choosing the day's quotes: real lines she may suggest
// word for word.
export function forBrief(kit, lib, seen, max = 12) {
  const all = [];
  for (const work of typed(lib)) for (const l of kept(work)) if (!seen.has(kit.norm(l.text))) all.push({ from: work.title, type: work.type, by: l.by || (work.type === "book" ? work.author || "" : ""), text: l.text });
  return shuffle(all).slice(0, max);
}
// If a suggestion is one of the kept lines, it gets that line's exact words, its speaker and the page it was found on.
export function stamp(kit, lib, item) {
  const n = kit.norm(item.text);
  for (const work of typed(lib)) {
    const line = kept(work).find((l) => kit.norm(l.text) === n);
    if (line) return { ...item, ...asQuote(work, line), theme: item.theme || line.theme || "", tone: item.tone || line.tone || "" };
  }
  return item;
}

// ---------------------------------------------------------------- for the engine (server/engine.js)

// Kept lines not yet suggested, as ready suggestions (each with its work, speaker and page), in no set order.
export function keptPool(kit, lib, seen, max = 14) {
  const all = [];
  for (const work of typed(lib)) for (const l of kept(work)) if (!seen.has(kit.norm(l.text))) all.push(asQuote(work, l));
  return shuffle(all).slice(0, max);
}
// The timed look-up: one work of her Library that has never been looked up, or whose lines are due again, is
// looked up within a smaller budget (a timed run may spend about 20 outside calls). Null when none is due.
export const READY = 20;                 // unseen lines a work should have ready before she asks
export async function refreshOne(env, kit, lib, { budget = 14, need = 10 } = {}) {
  const now = Date.now();
  const works = typed(lib).filter((w) => w.title);
  const never = works.filter((w) => !w.found || !w.found.at);
  const resumed = works.filter((w) => w.found && typeof w.found.resume === "number");
  const retry = works.filter((w) => w.found && w.found.at && !kept(w).length && typeof w.found.resume !== "number" && (w.found.v !== LOOK_VERSION || now >= retryAt(w.found))).sort((a, b) => a.found.at - b.found.at);
  const old = works.filter((w) => w.found && w.found.at && now - w.found.at > LOOK_AGAIN_DAYS * DAY).sort((a, b) => a.found.at - b.found.at);
  // Looked up the older way, before every line passed the gate (said.js): looked at again, one a run.
  const before = works.filter((w) => w.found && w.found.at && (w.found.v || 0) < LOOK_VERSION).sort((a, b) => a.found.at - b.found.at);
  let work = never[0] || resumed[0] || retry[0] || old[0] || before[0], spent = 2;
  // Else a work with fewer than READY lines she has not been shown, and pages left to read: one more round, so
  // that her next ask is answered at once.
  if (!work) {
    const ready = works.filter((w) => canReadOn(env, kit, w, now));
    if (ready.length) {
      const shownDoc = (await kit.loadDoc(env, "asked-shown", null)) || {};
      spent += 1;
      const unseen = (w) => { const had = new Set(((shownDoc.works || {})[w.id] || {}).t || []); return kept(w).filter((l) => !had.has(kit.norm(l.text).slice(0, 160))).length; };
      work = ready.map((w) => [w, unseen(w)]).filter(([, n]) => n < READY).sort((a, b) => a[1] - b[1]).map(([w]) => w)[0];
      if (work) need = READY;
    }
  }
  if (!work) return null;
  const state = { spent, rec: null, dirty: false, began: now, limit: (Number(env.LOOKUP_SECONDS) || SECONDS) * 1000, budget };
  work.found = await lookUp(env, kit, work, need, "", null, state);
  if (state.dirty) await saveRecord(env, kit, state);
  await keep(env, kit, lib, [work]);
  return { title: work.title, added: work.found.added || 0, spent: state.spent };
}
// One question to Gemini, and to OpenAI if Gemini gave too few, through the same daily limits and the same checks
// as the look-ups above (a line is kept only with a page that was really read behind it; sure only when two
// sites agree). "prompt" must hold nothing about her: only themes, titles, authors or a public line's words.
// "allow" caps the questions this caller may put to each today ({ gemini, openai }), counted in "used".
// "open" ({ query, ask, near }) is the same search in a few words for the web with no paid allowance (opensearch.js),
// asked first: Tavily or Serper when their keys are set, else a public results page, and the pages it points to.
export async function searchWeb(env, kit, prompt, want, have, { allow = { gemini: 0, openai: 0 }, used = {}, feature = "discover", open = null } = {}) {
  const state = { spent: 0, rec: null, dirty: false, began: Date.now(), limit: 60000, feature, trail: [] };
  let lines = [];
  if (open && open.query && O.providers(env).length) {
    await openRecord(env, kit, state);
    try {
      const got = await O.linesFor(env, kit, state, open.query, { want, have, ask: open.ask || "", near: open.near || [] });
      const why = Object.entries(got.dropped || {}).map(([k, v]) => `${v} ${k}`).join(", ");
      step(state, "web", got.lines.length ? "found" : "no line passed", { n: got.lines.length, ...(why ? { why } : {}) });
      noteUse(state, "web", got.lines.length ? "found" : "all rejected", { n: got.lines.length, ...(why ? { why } : {}) });
      lines = got.lines;
    } catch (e) {
      if (e instanceof kit.UserError && e.status !== 502) throw e;
      step(state, "web", "no answer", { why: tidy(e && e.message, env, 80) });
    }
  }
  for (const [who, key, search] of [["gemini", "GEMINI_API_KEY", geminiSearch], ["openai", "OPENAI_API_KEY", openaiSearch]]) {
    if (lines.length >= want || !env[key] || (used[who] || 0) >= (allow[who] || 0)) continue;
    used[who] = (used[who] || 0) + 1;
    const got = await search(env, kit, state, prompt);
    if (!got) continue;
    const { lines: more, dropped } = webLines(kit, got.said, got.read, got.behind, have, null, O.gateTally(state));
    const why = Object.entries(dropped).map(([k, v]) => `${v} ${k}`).join(", ");
    noteUse(state, who, more.length ? "found" : "all rejected", { model: got.model, n: more.length, ...(why ? { why } : {}) });
    step(state, who, more.length ? "found" : "no line passed", { model: got.model, n: more.length, ...(why ? { why } : {}) });
    lines = lines.concat(more);
  }
  // The gate's second step (said.js), for lines with no work of hers: each must be credited to someone and be
  // said or written by them, never words about a work.
  const judged = await S.judge(env, kit, null, lines, { state });
  lines = judged.kept;
  gateNote(state, judged, lines.length);
  if (state.rec && state.trail.length) keepTrail(state, { title: `(${feature})`, type: feature }, state.trail, lines.length);
  if (state.dirty) await saveRecord(env, kit, state);
  return { lines, spent: state.spent };
}

// ---------------------------------------------------------------- for the Library

// "Not the right one": the lines found for a work are dropped, and the page they came from is never used
// for it again.
export function setAside(work) {
  const f = work.found || {};
  work.found = { at: 0, added: 0, page: "", lines: [], not: [...(f.not || []), f.page].filter(Boolean).slice(-6) };
}

// "Look again", from the Library row: one work looked up now, whatever was found before (at most once a
// minute for a work). Answers the Library with what was found on it.
export async function lookAgain(env, kit, lib, kind, id) {
  const item = (lib[kind] || []).find((x) => x.id === id);
  if (!item) throw new kit.UserError(404, "That's no longer on the list.");
  const f = item.found || {};
  if (f.at && Date.now() - f.at < 60 * 1000) throw new kit.UserError(429, "Nishiii looked a moment ago. Try again in a minute.");
  const work = { ...item, type: kind === "books" ? "book" : item.kind };
  if (work.found) { delete work.found.resume; work.found.at = 0; }
  const state = newState(env);
  // (Also run by the phone just after she adds a work: its first pages are read, so her first ask is answered at once.)
  work.found = await lookUp(env, kit, work, READY, "", null, state);
  await closeRecord(env, kit, state);
  await keep(env, kit, lib, [work]);
  return work.found;
}
// Two Library entries for one work ("The early spring" and "The early spring cdrama"): the second is folded
// into the first, her choice, never on its own. Its found lines, facts and her own lines saved "from" it move over.
export function merge(kit, lib, kind, id, into) {
  const list = lib[kind] || [];
  const from = list.find((x) => x.id === id), to = list.find((x) => x.id === into);
  if (!from || !to || from === to) throw new kit.UserError(404, "That's no longer on the list.");
  if (coreTitle(kit, from.title) !== coreTitle(kit, to.title)) throw new kit.UserError(409, "Those two are different works.");
  const lines = [...kept(to), ...kept(from)], seen = new Set();
  const all = lines.filter((l) => { const n = kit.norm(l.text); if (seen.has(n)) return false; seen.add(n); return true; }).slice(-KEEP);
  if (all.length || from.found) to.found = { ...(to.found || from.found || {}), lines: all, at: Math.max((to.found || {}).at || 0, (from.found || {}).at || 0) };
  if (!to.known && from.known) to.known = { ...from.known, title: to.title };
  if (!to.author && from.author) to.author = from.author;
  for (const q of lib.quotes || []) if (q.from && kit.norm(q.from) === kit.norm(from.title)) q.from = to.title;
  lib[kind] = list.filter((x) => x !== from);
  return lib;
}

// ---------------------------------------------------------------- what was kept before the gate

// A one-off clean-up, as a timed job: every line kept before the gate (said.js) existed goes through it once:
// the works' kept lines in the Library, the engine's bank, the quotes she asked for, and the suggestions of
// today and the week before that she has not used yet. What fails is dropped; what passes is marked ("is"),
// so it is never judged again. One store, or one day of suggestions, a run; at most three questions to
// Claude a run (a few lines each: about 6 outside calls), and the run's own reads and writes. Where it got to
// is kept in data/linegate.json; once done, the job only reads that, about once a month.
const CLEAN_V = 1, CLEAN_BATCH = 30, CLEAN_ASKS = 3;
let cleanDone = false;
const placeOfSite = (site) => (QUOTE_PAGES.has(site) ? "quotes" : site === "mydramalist.com" ? "mdl" : "page");
// The work a kept suggestion or bank line is from, with what the Library knows of it.
function workOf(kit, lib, title, type) {
  if (!title || !["book", "film", "series"].includes(type)) return null;
  const item = typed(lib).find((w) => kit.norm(w.title) === kit.norm(title));
  return item ? withKnown(kit, item) : { title, type };
}
// Judges the unjudged lines of a list, a few works at a time. "list" holds { line, key, work }: "line" is
// { text, by, site }. Returns a Map from key to the verdict ("drop" or the "is" to keep), or null when Claude
// should have answered and did not (the run stops and tries again later).
async function cleanBatch(env, kit, list, force = false) {
  const groups = new Map();
  for (const x of list) {
    const k = x.work ? `${x.work.type}:${kit.norm(x.work.title)}` : "";
    if (!groups.has(k)) { if (groups.size >= CLEAN_ASKS) continue; groups.set(k, { work: x.work, items: [] }); }
    const g = groups.get(k);
    if (g.items.length < CLEAN_BATCH) g.items.push(x);
  }
  const out = new Map(), refused = {};
  for (const { work, items } of groups.values()) {
    const lines = items.map((x) => ({ text: x.line.text, by: x.line.by || "", key: x.key, ctx: { place: placeOfSite(x.line.site), quoted: x.line.site === "mydramalist.com" } }));
    const pass = lines.filter((l) => { const r = S.isSaid(l, work, l.ctx); if (!r.ok) { out.set(l.key, "drop"); S.count(refused, r.why); } return r.ok; });
    const j = await S.judge(env, kit, work, pass);
    if (j.how === "structure" && env.ANTHROPIC_API_KEY && !force) return null;   // Claude is resting or unreachable: later
    const keptKeys = new Map(j.kept.map((l) => [l.key, l.is]));
    for (const l of pass) out.set(l.key, keptKeys.get(l.key) || "drop");
    for (const [k, v] of Object.entries(j.refused)) refused[k] = (refused[k] || 0) + v;
  }
  out.refused = refused;
  return out;
}
const PHASES = ["library", "bank", "asked", "days"];
const SUGGESTION_DAYS = 8;                     // today and the seven days before it, as Today shows them
const dayOf = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * DAY).toISOString().slice(0, 10);
async function cleanJob(env, kit) {
  const mark = (await kit.loadDoc(env, "linegate", null)) || {};
  if (mark.v === CLEAN_V && mark.done) { cleanDone = true; return null; }
  const at = mark.v === CLEAN_V ? { phase: mark.phase || 0, day: mark.day || 0, refused: mark.refused || {}, dropped: mark.dropped || 0, judged: mark.judged || 0, waits: mark.waits || 0 }
    : { phase: 0, day: 0, refused: {}, dropped: 0, judged: 0, waits: 0 };
  const lib = (await kit.loadDoc(env, "library", null)) || { books: [], screen: [], quotes: [] };
  const name = PHASES[at.phase];
  const docName = name === "library" ? "library" : name === "bank" ? "engine/bank" : name === "asked" ? "asked" : `suggestions/${dayOf(at.day)}`;
  const read = async () => (name === "library" ? kit.loadDoc(env, "library", null) : kit.loadDoc(env, docName, null));
  // The lines still to judge in this store: { line, key, work }.
  const todo = (d) => {
    const out = [];
    if (!d) return out;
    if (name === "library") for (const w of typed(d)) kept(w).forEach((l, i) => { if (!l.is) out.push({ line: l, key: `${w.id}#${kit.norm(l.text)}`, work: withKnown(kit, w) }); });
    else if (name === "bank") for (const l of Array.isArray(d.lines) ? d.lines : []) { if (!l.is) out.push({ line: l, key: kit.norm(l.text), work: workOf(kit, lib, l.work, l.type) }); }
    else for (const it of Array.isArray(d) ? d : []) {
      if (it.is || it.state === "used" || it.state === "rejected") continue;
      const src = it.source || {};
      out.push({ line: { text: it.text, by: it.author || "", site: src.site || "" }, key: it.id || kit.norm(it.text), work: workOf(kit, lib, src.title, src.type) });
    }
    return out;
  };
  const first = name === "library" ? lib : await read();
  const list = todo(first);
  if (list.length) {
    // Claude resting or unreachable: tried again on later runs; after three such runs, the pages' structure decides.
    const verdict = await cleanBatch(env, kit, list, at.waits >= 3);
    if (!verdict) { at.waits += 1; await save(env, kit, at, false); return { waiting: true }; }
    at.waits = 0;
    // Read again just before writing, so anything changed meanwhile is not lost; then apply the verdicts.
    const d = await read();
    let dropped = 0, judged = 0;
    const apply = (key, keep) => { const v = verdict.get(key); if (!v) return true; if (v === "drop") { dropped += 1; return false; } judged += 1; keep(v); return true; };
    if (d && name === "library") for (const w of typed(d)) {
      const item = [...(d.books || []), ...(d.screen || [])].find((x) => x.id === w.id);
      if (item && item.found && Array.isArray(item.found.lines)) item.found.lines = item.found.lines.filter((l) => l.is || apply(`${w.id}#${kit.norm(l.text)}`, (v) => { l.is = v; }));
    }
    else if (d && name === "bank") d.lines = d.lines.filter((l) => l.is || apply(kit.norm(l.text), (v) => { l.is = v; }));
    else if (Array.isArray(d)) { const kept_ = d.filter((it) => it.is || apply(it.id || kit.norm(it.text), (v) => { it.is = v; })); d.length = 0; d.push(...kept_); }
    if (d) await kit.saveDoc(env, docName, d);
    at.dropped += dropped; at.judged += judged;
    for (const [k, v] of Object.entries(verdict.refused || {})) at.refused[k] = (at.refused[k] || 0) + v;
    if (todo(d).length) return save(env, kit, at, false);        // more in this store: the next run carries on
  }
  // This store is done: the next one (or the next day of suggestions).
  if (name === "days" && at.day + 1 < SUGGESTION_DAYS) at.day += 1;
  else at.phase += 1;
  return save(env, kit, at, at.phase >= PHASES.length);
}
async function save(env, kit, at, done) {
  await kit.saveDoc(env, "linegate", { v: CLEAN_V, phase: at.phase, day: at.day, done, refused: at.refused, dropped: at.dropped, judged: at.judged, waits: at.waits || 0, at: Date.now() });
  if (done) cleanDone = true;
  return { phase: PHASES[at.phase] || "done", dropped: at.dropped, judged: at.judged };
}
export const jobs = [
  // Every half hour while there is something left to clean; once done, about once a month (one read).
  { name: "lines-gate", get everyHours() { return cleanDone ? 24 * 30 : 0.5; }, run: (env, kit) => cleanJob(env, kit) },
];
export const runClean = cleanJob;                // for the tests

// ---------------------------------------------------------------- for Nishith

// GET /api/lookups (signed in): the whole record of looking things up: today's counts, which models were
// chosen, how each site last answered, and the last few trails in full. It holds no key and nothing of hers
// but the titles she asked about.
export const routes = {
  lookups: async (request, env, parts, kit) => {
    if (request.method !== "GET" || parts.length !== 1) return kit.fail(404, "Not found.");
    const [rec0, clean] = await Promise.all([kit.loadDoc(env, "lookups", null), kit.loadDoc(env, "linegate", null)]);
    const rec = rec0 || {};
    const trails = (Array.isArray(rec.trails) ? rec.trails : []).slice().reverse().map((t) => ({ ...t, said: sayTrail(t.steps, t.n), text: [stepsText(t.steps), t.gate && t.gate.said ? `${t.gate.said}.` : ""].filter(Boolean).join(" ") }));
    return kit.json({ day: rec.day || "", gemini: rec.gemini || {}, openai: rec.openai || {}, models: rec.models || {}, last: rec.last || {}, sites: rec.sites || {}, trails,
      keys: { gemini: !!env.GEMINI_API_KEY, openai: !!env.OPENAI_API_KEY },
      // The one-off clean-up of lines kept before the gate (said.js): counts only.
      cleanup: clean ? { done: !!clean.done, at: clean.at || 0, store: PHASES[clean.phase] || "done", dropped: clean.dropped || 0, judged: clean.judged || 0, refused: clean.refused || {} } : null });
  },
};
