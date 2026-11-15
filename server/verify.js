/* Looking things up on the web, so that what the app tells Dhruuu rests on pages rather than on memory.

   checkLine    "Who said this?": is a quote worded and credited right? The evidence comes, in this order, from
                Wikiquote (the line on a page, with the headings above it, so a "Misattributed" or "Disputed"
                section is seen) and Quote Investigator (its article on the line, and its conclusion), both free;
                then, only when those found nothing, Gemini with Google Search or OpenAI with web search (the same
                daily limits as findlines.js). Nishiii then gives the verdict from that evidence and names the pages
                it rests on. When nothing could be found, the answer is from Nishiii's memory and says so.
   checkTitle   a book, film or series added to the Library: its proper title, author or creator, year and kind,
                from Open Library (books) and Wikipedia's search with Wikidata's short descriptions, both free; the
                search helpers only when those found nothing. A title close to hers is offered, never put in her
                place; what is found is kept on the item as "known", and findlines.js uses it to pick the right page.

   Nothing personal is ever sent anywhere: only the line and the name it is credited to, or the title, the
   author she typed and the kind of work. Every search has a few seconds, then the app goes on without it. */
import * as F from "./findlines.js";

const CHECK_SECONDS = 9;          // a check stops searching after this long and answers with what it has
const TITLE_SECONDS = 8;          // the same for a title
const ONE_PAGE_MS = 4000;         // the longest one free page may take
const HEADING = /^(={2,6})\s*(.*?)\s*\1\s*$/;
const VERDICTS = ["matches", "different_author", "altered_wording", "found", "unsure"];

const words = (kit, t) => kit.norm(t).split(" ").filter(Boolean);
const phrase = (kit, t, n) => words(kit, t).slice(0, n).join(" ");
// Time left before "until", for one more call (never more than one page's worth).
const left = (until, cap = ONE_PAGE_MS) => Math.max(300, Math.min(cap, until - Date.now()));
const uniq = (list) => [...new Set(list)];

// Runs one free place; its answer (or the way it failed) goes into the record of lookups, which the health
// record shows. A failure is never the user's problem: the place simply gives nothing.
async function guarded(state, site, find) {
  if (F.resting(state, site)) return [];
  try { const got = await find(); F.noteSite(state, site, ""); return got; }
  catch (e) {
    if (e && e.blocked) F.noteBlocked(state, site, e.blocked);
    else F.noteSite(state, site, e && e.name === "TimeoutError" ? "no answer in time" : "could not be reached");
    return [];
  }
}
const refused = (res) => Object.assign(new Error("answered " + res.status), { blocked: "answered " + res.status });

// ---------------------------------------------------------------- the evidence for a quote

// Where a quote sits on a page's text: the line, the few lines under it (Wikiquote puts the source, or who
// really said it, there), and the headings above it.
export function locate(kit, text, quote) {
  const w = words(kit, quote), size = Math.min(6, w.length);
  if (size < 3) return null;
  const windows = [];
  for (let i = 0; i + size <= w.length; i += Math.max(1, Math.floor(size / 2))) windows.push(w.slice(i, i + size).join(" "));
  const all = String(text).split("\n"), path = [];
  for (let i = 0; i < all.length; i++) {
    const h = HEADING.exec(all[i]);
    if (h) { const level = h[1].length - 2; path.length = level; path[level] = h[2]; continue; }
    const n = ` ${kit.norm(all[i])} `;
    if (!windows.some((x) => n.includes(` ${x} `))) continue;
    const under = [];
    for (let j = i + 1; j < all.length && under.length < 3 && !HEADING.test(all[j]); j++) if (all[j].trim()) under.push(all[j].trim());
    return { path: path.filter(Boolean), context: [all[i].trim(), ...under].join("\n").slice(0, 700) };
  }
  return null;
}
const wikiUrl = (title) => "https://en.wikiquote.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));

// Wikiquote: one search of the pages' text, then up to two pages, the claimed author's own page first.
async function wikiquoteEvidence(env, kit, state, quote, author, until) {
  const api = `${env.WIKIQUOTE_API || "https://en.wikiquote.org"}/w/api.php?`;
  const get = async (params) => {
    const res = await F.page(state, api + new URLSearchParams({ ...params, format: "json", formatversion: "2" }), "application/json", left(until));
    if (!res.ok) throw refused(res);
    return res.json();
  };
  const found = await get({ action: "query", list: "search", srsearch: phrase(kit, quote, 12), srwhat: "text", srnamespace: "0", srlimit: "5", srprop: "size" });
  const a = kit.norm(author);
  const hits = ((found.query && found.query.search) || []).filter((r) => r && r.title).sort((x, y) => (kit.norm(y.title) === a) - (kit.norm(x.title) === a));
  const out = [];
  for (const hit of hits.slice(0, 2)) {
    if (until - Date.now() < 800 || out.length) break;
    const got = await get({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", exlimit: "1", redirects: "1", titles: hit.title });
    const pg = ((got.query && got.query.pages) || [])[0];
    const at = pg && pg.extract ? locate(kit, pg.extract, quote) : null;
    if (!at) continue;
    const section = at.path[at.path.length - 1];
    out.push({ site: "wikiquote.org", url: wikiUrl(pg.title) + (section ? "#" + encodeURIComponent(section.replace(/ /g, "_")) : ""), title: pg.title,
      text: `Wikiquote, the page "${pg.title}"${at.path.length ? `, under the heading "${at.path.join(" > ")}"` : ""}:\n${at.context}` });
  }
  return out;
}

// Quote Investigator: its own search, then the article whose title shares most words with the line.
async function qiEvidence(env, kit, state, quote, until) {
  const base = env.QUOTEINV_SITE || "https://quoteinvestigator.com";
  let res = await F.page(state, `${base}/wp-json/wp/v2/search?${new URLSearchParams({ search: phrase(kit, quote, 8), per_page: "3", _fields: "id,title,url" })}`, "application/json", left(until));
  if (!res.ok) throw refused(res);
  const hits = await res.json();
  if (!Array.isArray(hits)) throw Object.assign(new Error("not a list"), { blocked: "search was not a list" });
  const want = new Set(words(kit, quote).filter((w) => w.length > 2));
  const score = (h) => uniq(words(kit, F.plain(h.title))).filter((x) => want.has(x)).length;
  const best = hits.filter((h) => h && Number(h.id) > 0).sort((x, y) => score(y) - score(x))[0];
  if (!best || score(best) < Math.min(3, want.size) || until - Date.now() < 800) return [];
  res = await F.page(state, `${base}/wp-json/wp/v2/posts/${Number(best.id)}?_fields=title,link,content`, "application/json", left(until));
  if (!res.ok) throw refused(res);
  const post = await res.json();
  const title = kit.oneLine(F.plain((post.title || {}).rendered || best.title), 160);
  const text = F.plain((post.content || {}).rendered || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  if (text.length < 200) return [];
  const end = text.search(/\bIn conclusion\b|\bIn summary\b/i);
  return [{ site: "quoteinvestigator.com", url: kit.foundAt(post.link) || kit.foundAt(best.url), title,
    text: `Quote Investigator, the article "${title}". It begins: ${text.slice(0, 450)}\nIts conclusion: ${end >= 0 ? text.slice(end, end + 900) : text.slice(-900)}` }];
}

// Gemini or OpenAI, searching the web, when the free places found nothing.
const CHECK_QUESTION = (quote, author) => `Search the web for where this quote comes from and who really said or wrote it. Quote Investigator and Wikiquote (with its "Misattributed" and "Disputed" sections) are the most careful sources: prefer them.
Quote: "${quote}"
Credited to: ${author || "nobody"}
Reply with a JSON object only, no other text:
{"author": "who really said or wrote it, or unknown", "work": "the book, speech or film it is from, or an empty string", "wording": "the original wording if it differs, or an empty string", "misattributed": true or false, "summary": "one or two sentences on what the pages say", "pages": ["the addresses of the pages that say so"]}
Keep to what the pages you read say. Never answer from memory.`;
async function helperEvidence(env, kit, state, quote, author, until) {
  const helpers = [["gemini", "Google, through Gemini", F.geminiSearch, env.GEMINI_API_KEY], ["openai", "OpenAI", F.openaiSearch, env.OPENAI_API_KEY]];
  for (const [, name, search, on] of helpers) {
    if (!on || until - Date.now() < 2500) continue;
    const got = await search(env, kit, state, CHECK_QUESTION(quote, author), left(until, 12000));
    if (!got || !got.read.length) continue;                 // nothing read on the web: an answer from memory is not evidence
    let a;
    try { a = kit.parseJson(got.said); } catch (e) { continue; }
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const wasRead = (u) => got.read.some((r) => F.hostOf(u) === r.site || F.hostOf(u).endsWith("." + r.site));
    const named = (Array.isArray(a.pages) ? a.pages : []).map((u) => kit.foundAt(u)).filter((u) => u && wasRead(u));
    const url = named[0] || got.read[0].uri;
    return [{ site: F.hostOf(url) || got.read[0].site, url, title: "",
      text: `A web search (${name}) read ${uniq(got.read.map((r) => r.site)).slice(0, 5).join(", ")} and reports: the author is "${kit.oneLine(a.author, 80)}"`
        + `${a.work ? `, from "${kit.oneLine(a.work, 120)}"` : ""}; ${a.misattributed ? "the line is often credited to the wrong person" : "no misattribution is mentioned"}`
        + `${a.wording ? `; the original wording is "${kit.lines(a.wording, 400)}"` : ""}. ${kit.lines(a.summary, 400)}` }];
  }
  return [];
}

// ---------------------------------------------------------------- the check

export const CHECK_SYSTEM = `You check whether a quote is worded and credited correctly. Many quotes online are credited to the wrong person.
You may be given evidence found on the web just now, numbered [1], [2] and so on. When there is evidence, rest your verdict on it: a page that lists the quote as misattributed or disputed, or an article that traces it to someone else, outweighs your memory. When the evidence does not settle it, say "unsure" rather than guess. With no evidence, answer from what you know.
Reply with a JSON object only: {"verdict": "matches" | "different_author" | "altered_wording" | "found" | "unsure", "author": "...", "work": "...", "wording": "...", "note": "...", "sources": [the numbers of the evidence your verdict rests on]}
- "matches": the given author is right and the wording is close to the original.
- "different_author": it is by someone else or is a known misattribution. Put the right name in "author", or "unknown" if it has no confirmed source.
- "altered_wording": the author is right but the words differ from the original in a way that matters. Put the usual wording in "wording".
- "found": no author was given and you know who it is by. Put the name in "author".
- "unsure": neither the evidence nor what you know is enough to say. Never guess to seem helpful.
- "work": the book, speech or film it comes from, only when you are confident. Otherwise "".
- "sources": [] when you answered from memory, or when the evidence was about something else.
- "note": one or two plain sentences said to the person who asked; when the evidence settled it, say where, in a few words. If you mention them, say "you"; never "the user", "she" or "her".`;

// The verdict on one quote: { verdict, author, work, wording, note, basis: "web" | "memory", sources: [{ url, site, title }] }.
export async function checkLine(env, kit, quote, author) {
  const state = F.newState(env, CHECK_SECONDS), until = state.began + state.limit;
  await F.openRecord(env, kit, state);
  const free = await Promise.all([
    guarded(state, "wikiquote", () => wikiquoteEvidence(env, kit, state, quote, author, until)),
    guarded(state, "quoteinvestigator", () => qiEvidence(env, kit, state, quote, until)),
  ]);
  let evidence = free.flat();
  if (!evidence.length) evidence = await helperEvidence(env, kit, state, quote, author, until);
  await F.closeRecord(env, kit, state);
  evidence = evidence.slice(0, 4);
  const told = evidence.length ? `\n\nEvidence found on the web just now:\n${evidence.map((e, i) => `[${i + 1}] ${e.text}`).join("\n\n")}`
    : "\n\nNothing about this line could be found on the web just now: answer from what you know.";
  const a = kit.parseJson(await kit.claude(env, { system: CHECK_SYSTEM, maxTokens: 600,
    messages: [{ role: "user", content: `Quote:\n${quote}\nCredited to: ${author || "nobody (no author given)"}${told}` }] }));
  const used = uniq((Array.isArray(a.sources) ? a.sources : []).map(Number)).filter((n) => n >= 1 && n <= evidence.length).map((n) => evidence[n - 1]);
  const sources = used.filter((e) => e.url).map((e) => ({ url: e.url, site: e.site, title: kit.oneLine(e.title, 120) }));
  return { verdict: VERDICTS.includes(a.verdict) ? a.verdict : "unsure", author: kit.oneLine(a.author, 80), work: kit.oneLine(a.work, 120),
    wording: kit.lines(a.wording, 600), note: kit.lines(a.note, 400), basis: sources.length ? "web" : "memory", sources };
}

// ---------------------------------------------------------------- the title of a work in the Library

const bare = (kit, t) => kit.norm(String(t || "").replace(/\s*\([^)]*\)\s*$/, "")).replace(/^(the|a|an) /, "");
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 8) return 99;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
// "same" when it is her title (case, punctuation and a leading "The" aside), "close" when it looks like her
// title misspelt or cut short, "" otherwise.
export function closeness(kit, typed, real) {
  const a = bare(kit, typed), b = bare(kit, real);
  if (!a || !b) return "";
  if (a === b) return "same";
  if (distance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 6))) return "close";
  if (b.startsWith(a + " ") && a.split(" ").length >= 2) return "close";
  return "";
}
const KIND_FITS = {
  book: /\b(novels?|books?|novella|memoir|poems?|poetry|play|short stor(y|ies)|essays?|collection|non-?fiction)\b/i,
  film: /\b(film|movie)\b/i,
  series: /\b(television|tv) (series|show|programme|program|drama|sitcom)|\b(sitcom|miniseries|web series|anime series|drama series|animated series|streaming series)\b/i,
};
const kindOf = (desc, allowed) => allowed.find((k) => KIND_FITS[k].test(desc)) || "";
const yearIn = (t) => Number((/\b(1[5-9]\d\d|20\d\d)\b/.exec(String(t || "")) || [])[1]) || 0;
const surname = (kit, name) => words(kit, name).pop() || "";

// Open Library's search for a book.
async function openLibrary(env, kit, state, item, until) {
  const q = { title: item.title, fields: "key,title,author_name,first_publish_year", limit: "5" };
  if (item.author) q.author = item.author;
  const res = await F.page(state, `${env.OPENLIBRARY_SITE || "https://openlibrary.org"}/search.json?${new URLSearchParams(q)}`, "application/json", left(until));
  if (!res.ok) throw refused(res);
  const docs = ((await res.json()) || {}).docs;
  return (Array.isArray(docs) ? docs : []).filter((d) => d && d.title).map((d) => ({ title: kit.oneLine(d.title, 120), by: kit.oneLine((d.author_name || [])[0], 80),
    year: Number(d.first_publish_year) || 0, kind: "book", site: "openlibrary.org",
    page: /^(\/works\/)?OL\d+W$/.test(d.key || "") ? `https://openlibrary.org${d.key.startsWith("/") ? d.key : "/works/" + d.key}` : "" }));
}
// Wikipedia's search, with each page's short description (from Wikidata), such as "2010 film by Christopher Nolan".
async function wikipedia(env, kit, state, item, kind, until) {
  const word = { book: "novel", film: "film", series: "TV series" }[kind];
  const res = await F.page(state, `${env.WIKIPEDIA_API || "https://en.wikipedia.org"}/w/api.php?${new URLSearchParams({ action: "query", generator: "search",
    gsrsearch: `${item.title}${kind === "book" && item.author ? " " + item.author : ""} ${word}`, gsrnamespace: "0", gsrlimit: "6", gsrenablerewrites: "1",
    prop: "description", redirects: "1", format: "json", formatversion: "2" })}`, "application/json", left(until));
  if (!res.ok) throw refused(res);
  const pages = (((await res.json()) || {}).query || {}).pages;
  const allowed = kind === "book" ? ["book"] : [kind, kind === "film" ? "series" : "film"];
  return (Array.isArray(pages) ? pages : []).sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => {
    const desc = String(p.description || ""), k = kindOf(desc, allowed);
    if (!k || /disambiguation/i.test(desc)) return null;
    return { title: kit.oneLine(String(p.title || "").replace(/\s*\([^)]*\)\s*$/, ""), 120), by: kit.oneLine((/\bby ([^,;()]+?)\s*$/.exec(desc) || [])[1], 80),
      year: yearIn(desc), kind: k, site: "wikipedia.org", page: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(p.title).replace(/ /g, "_")) };
  }).filter(Boolean);
}
// Gemini or OpenAI, when the free places found nothing.
const TITLE_QUESTION = (item, kind) => `Search the web for the ${{ book: "book", film: "film", series: "TV series" }[kind]} that someone calls "${item.title}"${kind === "book" && item.author ? ` by ${item.author}` : ""}. The title may be misspelt.
Reply with a JSON object only, no other text: {"title": "its proper title", "by": "the author of a book, or the director or creator", "year": the year it first came out as a number, "kind": "book" or "film" or "series", "page": "the address of a page that confirms it"}
Reply with {} if no such work is found. Never answer from memory.`;
async function helperTitle(env, kit, state, item, kind, until) {
  for (const [search, on] of [[F.geminiSearch, env.GEMINI_API_KEY], [F.openaiSearch, env.OPENAI_API_KEY]]) {
    if (!on || until - Date.now() < 2500) continue;
    const got = await search(env, kit, state, TITLE_QUESTION(item, kind), left(until, 10000));
    if (!got || !got.read.length) continue;
    let a;
    try { a = kit.parseJson(got.said); } catch (e) { continue; }
    if (!a || !a.title) continue;
    const page = kit.foundAt(a.page);
    const k = ["book", "film", "series"].includes(a.kind) ? a.kind : kind;
    if (kind === "book" ? k !== "book" : k === "book") continue;
    return [{ title: kit.oneLine(a.title, 120), by: kit.oneLine(a.by, 80), year: Number(a.year) || 0, kind: k,
      site: page ? F.hostOf(page) : got.read[0].site, page: page && got.read.some((r) => F.hostOf(page).endsWith(r.site)) ? page : got.read[0].uri }];
  }
  return [];
}

// What the web knows of a work she added: { titleChecked, known, maybe } to keep on the item. "known" is set
// when the title she typed is a real one; "maybe" when a real title is close to hers (offered, never applied).
export async function checkTitle(env, kit, item, kind) {
  const state = F.newState(env, TITLE_SECONDS), until = state.began + state.limit;
  await F.openRecord(env, kit, state);
  const fits = (c) => !(kind === "book" && item.author && c.by && !words(kit, c.by).includes(surname(kit, item.author)));
  const pick = (list) => {
    const ok = list.filter(fits).map((c) => ({ c, how: closeness(kit, item.title, c.title) })).filter((x) => x.how);
    // Her own title, of the kind she chose, comes first; then her title of the other kind; then a close one.
    return ok.find((x) => x.how === "same" && x.c.kind === kind) || ok.find((x) => x.how === "same") || ok[0] || null;
  };
  let hit = null;
  if (kind === "book") hit = pick(await guarded(state, "openlibrary", () => openLibrary(env, kit, state, item, until)));
  if (!hit || hit.how !== "same") hit = pick(await guarded(state, "wikipedia", () => wikipedia(env, kit, state, item, kind, until))) || hit;
  if (!hit) hit = pick(await helperTitle(env, kit, state, item, kind, until));
  await F.closeRecord(env, kit, state);
  const out = { titleChecked: Date.now(), known: null, maybe: null };
  if (!hit) return out;
  const found = { title: hit.c.title, by: hit.c.by, year: hit.c.year, kind: hit.c.kind, page: hit.c.page, site: hit.c.site };
  // Her title, of her kind: kept as known. A spelling or a kind that differs from hers: offered.
  if (hit.how === "same" && found.kind === kind) out.known = { ...found, title: item.title };
  else out.maybe = found;
  return out;
}

// Her answer to "Did you mean ...?": the title she accepted takes the place of hers (and its author, when she
// gave none, and its kind); or hers is kept and the offer is not made again. Either way the item is changed in
// place. Lines found under the old title are dropped, and a book's text is looked for again.
export function settleTitle(item, accept, list) {
  const m = item.maybe;
  item.maybe = null;
  if (!accept || !m) { item.titleKept = true; return item; }
  item.title = m.title;
  if (list === "books" && !item.author && m.by) item.author = m.by;
  if (list === "screen" && (m.kind === "film" || m.kind === "series")) item.kind = m.kind;
  item.known = { ...m };
  delete item.found;
  if (list === "books") for (const k of ["textChecked", "textUrl", "textTitle", "textAuthor", "textNote"]) delete item[k];
  return item;
}
