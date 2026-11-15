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
     many lines are wanted. */

const DAY = 24 * 60 * 60 * 1000;
export const KEEP = 30;                 // lines kept for one work
export const LOOK_AGAIN_DAYS = 30;      // kept lines are refreshed after this long
export const A_DAY = { gemini: 40, openai: 20 };   // so a key can never run up a bill, whatever is attached to it
const BUDGET = 26;                      // outside calls one request may spend on looking up (it has about 50 in all)
const SECONDS = 22;                     // no new place is started after this long, so her phone is never left waiting
const PICK = 12;                        // lines Nishiii may pick from one page
const UA = "DsStudio/1.0 (personal quotes app; one search and one page per title)";

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
  return { ...work, author: work.author || (work.type === "book" ? k.by || "" : ""), year: Number(k.year) || 0 };
}

// ---------------------------------------------------------------- 0. what the Library already holds

// Lines for one work that have not been suggested yet: her own lines saved "from" that title, and the lines
// found for it earlier.
function unused(kit, lib, work, seen) {
  const title = kit.norm(work.title);
  const own = (lib.quotes || []).filter((q) => q.from && kit.norm(q.from) === title && !seen.has(kit.norm(q.text)))
    .map((q) => ({ text: q.text, author: q.author || "", source: { type: "own", title: q.from }, theme: "", tone: "", verify: false }));
  const found = kept(work).filter((l) => !seen.has(kit.norm(l.text))).map((l) => asQuote(work, l));
  return { own, found, n: own.length + found.length };
}
// A kept line as a suggestion: who says it, which work, and the page it was found on.
function asQuote(work, line) {
  return { text: line.text, author: work.type === "book" ? work.author || line.by || "" : line.by || "",
    source: { type: work.type, title: work.title, url: line.url || undefined, site: line.site || undefined },
    theme: line.theme || "", tone: line.tone || "", verify: !!line.verify, found: true };
}
// Is it time to look this work up (again)?
function due(work, have, share, now) {
  const f = work.found;
  if (!f || !f.at) return true;
  if (now - f.at > LOOK_AGAIN_DAYS * DAY) return true;
  if (have >= share) return false;
  // Running short: look again at once if the last look had to stop early or still turned up something new,
  // otherwise tomorrow.
  return typeof f.resume === "number" || f.added > 0 || now - f.at > DAY;
}

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
export function noteSite(state, site, why) {
  const s = (state.rec.sites[site] = state.rec.sites[site] || {});
  if (why) { s.failed = Date.now(); s.why = String(why).slice(0, 80); state.dirty = true; }
  else if (!s.ok || s.why) { s.ok = Date.now(); delete s.why; delete s.failed; state.dirty = true; }
}
// A site that turned the app away is left alone until tomorrow.
export const resting = (state, site) => { const s = state.rec.sites[site]; return !!(s && s.blocked && Date.now() - s.failed < DAY); };
export function noteBlocked(state, site, why) { noteSite(state, site, why); state.rec.sites[site].blocked = true; }
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
  const want = bare(kit, work.title), out = [];
  results.forEach((r, rank) => {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(r.title || "");
    const base = m ? m[1] : r.title || "", tag = m ? m[2] : "";
    if (bare(kit, base) !== want || not.includes(r.title)) return;
    if (tag && !tagFits(tag, work.type)) return;
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
    srsearch: `${work.title}${work.type === "book" && work.author ? " " + work.author : ""}` });
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

// ---------------------------------------------------------------- 2. Goodreads (books) and IMDb (films and series)

// What a site sends instead of its page when it wants proof of a person.
const wall = (html) => /captcha|verify you are human|are you a robot|unusual traffic|access denied|enable javascript and cookies/i.test(String(html).slice(0, 6000));

// Goodreads: its own list of suggestions for a title, then that book's quotes page.
async function goodreadsPage(env, kit, work, state) {
  const base = env.GOODREADS_SITE || "https://www.goodreads.com";
  let res = await page(state, `${base}/book/auto_complete?format=json&q=${encodeURIComponent(work.title)}`, "application/json");
  if (!res.ok) return void noteBlocked(state, "goodreads", "search answered " + res.status);
  let list;
  try { list = JSON.parse(await res.text()); } catch (e) { return void noteBlocked(state, "goodreads", "search was not a list"); }
  const want = bare(kit, work.title), surname = surnameOf(kit, work), not = (work.found && work.found.not) || [];
  const book = (Array.isArray(list) ? list : []).find((b) => b && b.workId && bare(kit, b.bookTitleBare || String(b.title || "").replace(/\s*\([^)]*\)\s*$/, "")) === want
    && (!surname || kit.norm((b.author || {}).name).split(" ").includes(surname)) && !not.includes("goodreads:" + b.workId));
  if (!book) return null;                                   // no such book there: nothing wrong with the site
  const id = String(book.workId).replace(/\D/g, "");
  res = await page(state, `${base}/work/quotes/${id}`, "text/html");
  if (!res.ok) return void noteBlocked(state, "goodreads", "quotes page answered " + res.status);
  const html = (await res.text()).slice(0, 1_500_000);
  if (wall(html)) return void noteBlocked(state, "goodreads", "asked for proof of a person");
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
  const typedYear = (/\((\d{4})\)\s*$/.exec(work.title) || [])[1], title = work.title.replace(/\s*\(\d{4}\)\s*$/, "");
  let res = await page(state, `${env.IMDB_SUGGEST || "https://v3.sg.media-imdb.com"}/suggestion/x/${encodeURIComponent(title.toLowerCase())}.json`, "application/json");
  if (!res.ok) return void noteBlocked(state, "imdb", "search answered " + res.status);
  let list;
  try { list = JSON.parse(await res.text()).d; } catch (e) { return void noteBlocked(state, "imdb", "search was not a list"); }
  const want = bare(kit, title), not = (work.found && work.found.not) || [];
  const same = (Array.isArray(list) ? list : []).filter((t) => t && /^tt\d+$/.test(t.id || "") && bare(kit, t.l) === want && IMDB_KINDS[work.type].includes(t.qid)
    && (!typedYear || String(t.y) === typedYear) && !not.includes("imdb:" + t.id));
  const near = work.year ? same.filter((t) => Math.abs(Number(t.y) - work.year) <= 1).sort((a, b) => Math.abs(a.y - work.year) - Math.abs(b.y - work.year)) : [];
  const hit = near[0] || same[0];
  if (!hit) return null;
  res = await page(state, `${env.IMDB_SITE || "https://www.imdb.com"}/title/${hit.id}/quotes/`, "text/html");
  if (res.status !== 200) return void noteBlocked(state, "imdb", "quotes page answered " + res.status);
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
- Only lines from the work itself. Skip the opening description of the work, cast lists, what critics and others said about it, headings and links.
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
async function pickFrom(env, kit, work, pg, about, taste, have, state) {
  const passages = passagesOf(pg.text);
  state.spent += 4;                                // the question itself, and the counting that goes with every question to Claude
  const answer = kit.parseJson(await kit.claude(env, { system: PICK_SYSTEM, maxTokens: 2500, messages: [{ role: "user", content:
    `Work: ${work.title} (${work.type})${work.author ? ` by ${work.author}` : ""}\nPick up to ${PICK} lines.\n${about ? `about: ${about}\n` : ""}${taste ? `taste: ${JSON.stringify({ loves: taste.loves, avoids: taste.avoids, herNotes: taste.herNotes })}\n` : ""}\nPassages:\n${passages.map((p, i) => `--- ${i + 1} ---\n${p}`).join("\n")}` }] }));
  const flat = passages.map(kit.flatten).join("\n"), lower = flat.toLowerCase(), lines = [];
  for (const q of Array.isArray(answer) ? answer : []) {
    const text = kit.flatten(q && q.text).replace(/^"+|"+$/g, "");
    // Kept only if the exact words are really on the page that was read.
    if (text.length < 20 || text.length > 400 || !flat.includes(text) || have.has(kit.norm(text)) || HEADING.test(text)) continue;
    const by = kit.oneLine(q.by, 80);
    const named = by && lower.includes(by.toLowerCase()) ? by : "";
    lines.push({ text, by: work.type === "book" ? pg.by || named : named, url: pg.url, site: pg.site, verify: false,
      theme: kit.oneLine(q.theme, 30), tone: kit.oneLine(q.tone, 20) });
    have.add(kit.norm(text));
    if (lines.length >= PICK) break;
  }
  return lines;
}

// ---------------------------------------------------------------- 3 and 4. Gemini and OpenAI, searching the web

const KIND_NAME = { book: "book", film: "film", series: "TV series" };
// Everything the two are told: the title, the kind of work, the author and how many lines. Nothing about her.
const question = (work, want) => `Search the web for real quotes from the ${KIND_NAME[work.type]} "${work.title}"${work.type === "book" && work.author ? ` by ${work.author}` : ""}.
Read pages that quote the work itself: quote pages (Goodreads, Wikiquote, IMDb, fan wikis), transcripts, reviews and articles.
Reply with a JSON array only, no other text, of up to ${want} items:
[{"text": "the line, word for word as the page has it", "by": "the character who says it, or the author for a book", "page": "the address of the page it is on", "also": "the address of a second page on another site that gives the same wording, or an empty string"}]
Keep a line only when a page you read gives its wording and says it is from this work. Never fill gaps from memory and never guess. One to three sentences each, under 45 words. If you find nothing real, reply with [].`;

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
// Turns an answer into lines. "read" are the pages the service says it really read, "behind(n)" the ones it
// says stand behind a piece of the answer. A page the model only names counts when it is on a site that was
// read; a line with no read page behind it is left out. A line is sure only when two sites agree on it.
function webLines(kit, said, read, behind, have) {
  if (!read.length) return [];                    // nothing was read on the web: an answer from memory is not kept
  let answer;
  try { answer = kit.parseJson(said); } catch (e) { return []; }
  const lines = [];
  for (const q of Array.isArray(answer) ? answer : []) {
    const text = kit.flatten(q && q.text).replace(/^"+|"+$/g, ""), n = kit.norm(text);
    if (text.length < 20 || text.length > 400 || have.has(n)) continue;
    const pages = behind(n);
    const named = [q.page, q.also].map((u) => kit.foundAt(u)).filter((u) => u && read.some((r) => hostOf(u) === r.site || hostOf(u).endsWith("." + r.site)));
    if (!pages.length && !named.length) continue;
    const sites = new Set([...pages.map((p) => p.site), ...named.map(hostOf)]);
    lines.push({ text, by: kit.oneLine(q.by, 80), url: named[0] || pages[0].uri, site: named[0] ? hostOf(named[0]) : pages[0].site, verify: sites.size < 2, theme: "", tone: "" });
    have.add(n);
  }
  return lines;
}
// Asks one of the two, trying its models in order. Counts every question against the day's limit first.
// A refusal (the allowance is used up, the key is not accepted, the plan does not include searching) means
// "not today": nothing more is asked of it until tomorrow. How the last question went is kept in "last", which
// the health record shows (probes.js). Answers null when nothing came back.
async function ask(env, kit, state, who, models, send, read) {
  const rec = await openRecord(env, kit, state), use = rec[who];
  const outcome = (what) => { rec.last[who] = { at: Date.now(), what }; state.dirty = true; };
  if (use.off) return null;
  for (const model of String(models).split(",").map((m) => m.trim()).filter((m) => /^[a-z0-9.-]+$/i.test(m)).slice(0, 2)) {
    if (use.calls >= A_DAY[who]) { outcome("limit"); return null; }
    use.calls += 1;
    await saveRecord(env, kit, state);               // counted before asking, so a question that never returns still counts
    let res;
    state.spent += 1;
    try { res = await send(model); } catch (e) { outcome("no answer"); return null; }
    // Google answers a key it does not know with 400, the same status as for a model that may not search.
    const badKey = res.status === 400 && /api[ _]?key/i.test(await res.clone().text().catch(() => ""));
    if ((res.status === 404 || res.status === 400) && !badKey) continue;     // this model is not offered, or may not search: try the next one
    if (res.status === 429 || res.status === 401 || res.status === 403 || badKey) {
      use.off = res.status === 429 ? "used up" : "refused"; outcome(use.off); return null;
    }
    if (!res.ok) { outcome("no answer"); return null; }
    try { const got = read(await res.json()); outcome("worked"); return got; } catch (e) { outcome("no answer"); return null; }
  }
  if (use.calls < A_DAY[who]) { use.off = "no model"; outcome("no model"); }
  return null;
}

// Gemini with Google Search. Google changes which models a key may search with (the 2.5 models are kept only
// for keys that used them before), so the setting GEMINI_MODEL (one name, or two with a comma) can replace this
// list without a change to the app.
export const GEMINI_MODELS = "gemini-3.8-flash,gemini-3.5-flash-lite";
// One question to Gemini with Google Search: { said, read, behind } (the answer, the pages read, and for a
// piece of the answer the pages behind it), or null.
export function geminiSearch(env, kit, state, prompt, ms = 20000) {
  const siteOf = (c) => { const t = String(c.title || "").trim().toLowerCase().replace(/^www\./, ""); return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) ? t : hostOf(c.uri); };
  return ask(env, kit, state, "gemini", env.GEMINI_MODEL || GEMINI_MODELS,
    (model) => fetch(`${env.GEMINI_API || "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }) }),
    (data) => {
      const cand = (data.candidates || [])[0] || {}, meta = cand.groundingMetadata || {};
      const said = (((cand.content || {}).parts) || []).map((p) => p.text || "").join("");
      // The pages Google says were read. Its links to them pass through Google, so the site's name comes from the title.
      const read = (meta.groundingChunks || []).map((c) => (c && c.web) || {}).map((c) => ({ uri: kit.foundAt(c.uri), site: siteOf(c) }));
      const behind = (n) => {
        const at = new Set();
        for (const s of meta.groundingSupports || []) {
          const part = kit.norm((s.segment || {}).text);
          if (part && (part.includes(n) || (part.length >= 20 && n.includes(part)))) for (const i of s.groundingChunkIndices || []) if (read[i] && read[i].uri) at.add(i);
        }
        return [...at].map((i) => read[i]);
      };
      return { said, read: read.filter((r) => r.uri && r.site), behind };
    });
}
async function fromGemini(env, kit, work, want, have, state) {
  const got = await geminiSearch(env, kit, state, question(work, want));
  return got ? webLines(kit, got.said, got.read, got.behind, have) : [];
}
// OpenAI with its web search tool (the Responses API). OPENAI_MODEL can replace the list, as for Gemini.
export const OPENAI_MODELS = "gpt-6-luna,gpt-6.1-terra";
export function openaiSearch(env, kit, state, prompt, ms = 25000) {
  return ask(env, kit, state, "openai", env.OPENAI_MODEL || OPENAI_MODELS,
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
      return { said, read: [...cited, ...opened].filter((r) => r.uri && r.site), behind };
    });
}
async function fromOpenAI(env, kit, work, want, have, state) {
  const got = await openaiSearch(env, kit, state, question(work, want));
  return got ? webLines(kit, got.said, got.read, got.behind, have) : [];
}

// ---------------------------------------------------------------- the whole search for one request

// Looks one work up, place after place until there are enough lines, and returns what to keep on it.
// A look that runs out of time or of calls stops there, and the next one carries on at the place it stopped.
async function lookUp(env, kit, work, need, about, taste, state) {
  work = withKnown(kit, work);
  const have = new Set(kept(work).map((l) => kit.norm(l.text)));
  const prior = work.found || {};
  let lines = [], where = "";
  // Reading a page: finds it, has Nishiii pick from it, and copes quietly when the site is unreachable.
  const read = async (site, find) => {
    await openRecord(env, kit, state);
    if (resting(state, site)) return;
    try {
      const pg = await find(env, kit, work, state);
      if (!pg) return;
      const got = await pickFrom(env, kit, work, pg, about, taste, have, state);
      if (got.length) noteSite(state, site, "");
      if (got.length && !where) where = pg.name;
      lines = lines.concat(got);
    } catch (e) {
      if (e instanceof kit.UserError && e.status !== 502) throw e;      // Nishiii is switched off or at the day's limit: say so
      if (e.blocked) noteBlocked(state, site, e.blocked);
      else if (!(e instanceof kit.UserError)) noteSite(state, site, e.name === "TimeoutError" ? "no answer in time" : "could not be reached");
    }
  };
  const more = () => Math.min(PICK, need - lines.length + 3);
  const places = [
    { cost: 6, look: () => read("wikiquote", wikiquotePage) },
    // Goodreads and IMDb ask that robots don't read their pages; this step can be switched off with QUOTE_SITES=off.
    { cost: 6, off: env.QUOTE_SITES === "off", look: () => read(work.type === "book" ? "goodreads" : "imdb", work.type === "book" ? goodreadsPage : imdbPage) },
    { cost: 3, off: !env.GEMINI_API_KEY, look: async () => { lines = lines.concat(await fromGemini(env, kit, work, more(), have, state)); } },
    { cost: 3, off: !env.OPENAI_API_KEY, look: async () => { lines = lines.concat(await fromOpenAI(env, kit, work, more(), have, state)); } },
  ];
  let resume;
  for (let i = typeof prior.resume === "number" && Date.now() - prior.at < DAY ? prior.resume : 0; i < places.length && lines.length < need; i++) {
    if (places[i].off) continue;
    if (state.spent + places[i].cost > BUDGET || Date.now() - state.began > state.limit) { resume = i; break; }
    await places[i].look();
  }
  const out = { ...prior, at: Date.now(), added: lines.length, resume, page: where || prior.page || "", lines: [...kept(work), ...lines].slice(-KEEP) };
  if (resume === undefined) delete out.resume;
  return out;
}

// Real lines for the works she named. "works" are Library items with a "type" (book, film or series);
// "room" is how many quotes are still wanted and "also" how many other sources share that room.
// Returns { items, short }: the quotes, and the works that did not get as many as their share.
export async function forWorks(env, kit, lib, works, { room, also = 0, about = "", taste = null, seen, ranker = null }) {
  const items = [], short = [], looked = [];
  const state = newState(env);
  const words = kit.norm(about).split(" ").filter((w) => w.length > 3);
  for (let i = 0; i < works.length && room > 0; i++) {
    const work = works[i];
    const share = Math.ceil(room / (works.length - i + also));
    let have = unused(kit, lib, work, seen);
    if (state.spent + 6 <= BUDGET && Date.now() - state.began <= state.limit && due(work, have.n, share, Date.now())) {
      work.found = await lookUp(env, kit, work, Math.max(1, share - have.n), about, taste, state);
      looked.push(work);
      have = unused(kit, lib, work, seen);
    }
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
  return { items, short };
}
// Writes what was found onto the works in the Library. The Library is read afresh first, so anything she
// changed while the search ran is not lost.
async function keep(env, kit, lib, looked) {
  const now = await kit.loadDoc(env, "library", null);
  if (!now) return;
  for (const work of looked) {
    for (const from of [now, lib]) {
      const item = [...(from.books || []), ...(from.screen || [])].find((x) => x.id === work.id);
      if (item) item.found = work.found;
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

// ---------------------------------------------------------------- for the Library

// "Not the right one": the lines found for a work are dropped, and the page they came from is never used
// for it again.
export function setAside(work) {
  const f = work.found || {};
  work.found = { at: 0, added: 0, page: "", lines: [], not: [...(f.not || []), f.page].filter(Boolean).slice(-6) };
}
