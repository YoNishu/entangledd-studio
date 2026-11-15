/* A quote is something said IN a work, never something said ABOUT it.

   Every line the app finds on the web (Wikiquote, Goodreads, IMDb, MyDramaList, any page, a search snippet, an
   answer from Gemini or OpenAI) passes this gate before it is kept or shown:

   1. isSaid(line, work, ctx): cheap refusals that need no outside call. Where the text sat counts first: in a
      references or notes list, in a heading, under "Episodes", "Plot" or "Reception", as a cited title followed
      by its publisher and date. Then its shape: an episode or chapter title, a tagline, a summary of the plot, a
      rating or review sentence, a line that talks about the work from outside (names the work or its actors,
      "K-drama", "viewers", "episode", "the film" ...), a headline. "ctx" carries what came before and after the
      line on its page, the part of the page it sat in, and the kind of place it came from.
   2. judge(env, kit, work, lines, opts): what is left goes to Claude in one question for the whole look-up:
      for each numbered line "said" (a character says it), "narration" (the work's own words: a sentence of the
      book, a voice-over), "about" (anyone describing the work) or "unsure". Only "said" and "narration" stay, and
      an "unsure" line with the page's own proof and one of the work's characters named for it (marked to check).
      Each line goes with the words just before and after it on its page (up to 120 characters each), who it is
      credited to and where it was found, so a reviewer's own remark in quotation marks is told from a line quoted.
      Nothing about her is sent: only the work's public title and kind, and the lines.
      When Claude cannot be asked, only lines with strong proof in the page's own structure stay: a quotes
      page's own list item (Wikiquote, Goodreads, IMDb quotes), a line quoted in a review on the work's own
      MyDramaList page, or a speaker named who is one of the work's characters.

   Every kept line carries "is" ("said", "narration", or "structure" when kept on proof alone), so it is never
   judged twice. Reasons for refusals are short lower-case words: they are counted on the look-up's trail. */

// ---------------------------------------------------------------- words and shapes

const SMALL = new Set("a an the of in on and or to for with at by from as is be into vs".split(" "));
const PRONOUN = /\b(i|i'm|i’m|i'll|i’ll|i've|i’ve|i'd|i’d|me|my|mine|myself|you|you're|you’re|you'll|you’ll|your|yours|yourself|we|we're|we’re|us|our|ours|let's|let’s)\b/i;
// Words that only someone talking about a work uses. Kept narrow: a real line may well say "season" or "the
// drama" ("Spare me the drama"), so those count only in the forms below.
const ABOUT = new RegExp([
  "\\b[kcj]-?dramas?\\b", "\\bwebtoons?\\b", "\\bweb ?comics?\\b", "\\bmanhwa\\b", "\\bmanhua\\b", "\\bweb ?novels?\\b", "\\blight novels?\\b",
  "\\b(tv|television) (viewers|series|shows?|dramas?|adaptations?|ratings|audiences?|debut)\\b", "\\bviewers?\\b", "\\bviewership\\b",
  "\\bratings\\b", "\\bpremiere[sd]?\\b", "\\bepisodes?\\b", "\\bseason (one|two|three|four|\\d+)\\b",
  "\\bthe (film|movie|series|novel|adaptation|sequel|prequel|finale|storyline|screenplay|screenwriter|showrunner|female lead|male lead|second lead|webtoon)\\b",
  "\\bth(is|at) (film|movie|series|show|drama|novel|book|adaptation|sequel|finale|author|writer|director|actor|actress|cast)\\b",
  "\\badaptations?\\b", "\\badapted (from|into|for)\\b", "\\bbased on (the|a|an) (webtoon|novel|book|manga|comic|true story|web novel|bestselling)\\b",
  "\\bbox[- ]office\\b", "\\bco-?star(s|red|ring)?\\b", "\\bbinge[- ]?(watch|watched|watching|worthy)\\b", "\\bmust[- ](watch|read|see)\\b",
  "\\bwatchlist\\b", "\\brewatch(ed|ing)?\\b", "\\bnetflix\\b", "\\bviki\\b", "\\bost\\b", "\\bcinematography\\b", "\\bchemistry between\\b",
  "\\bbook club\\b", "\\bpage[- ]turner\\b", "\\bplot twists?\\b", "\\bspoilers?\\b", "\\breviewers?\\b", "\\bfandom\\b", "\\bbestsell(er|ing)\\b",
].join("|"), "i");
// The same, where a capital after the words shows a name follows ("directed by Kim", "starring Moon Ga-young").
const ABOUT_NAMED = /\b(directed|written|produced|created|narrated|adapted) by [A-Z]|\bstarring [A-Z]|\b(played|portrayed|voiced) by [A-Z]/;
const RATING = /\b\d+(\.\d)?\s*(\/|out of)\s*(5|10|100)\b|★|⭐|\b[1-5](\.5)? stars?\b|\bfive stars?\b|\bhighly recommend|\bi (would )?recommend\b|\brecommended\b|\boverrated\b|\bunderrated\b|\bmy rating\b|\bdnf\b/i;
const SYNOPSIS = /\b(tells the (story|tale) of|the story (of|follows|cent(er|re)s|revolves)|follows (the story|the life|the lives|the journey|a group|two|three)|cent(er|re)s (on|around)|revolves around|is (a|an) (\d{4} )?((south )?korean|chinese|japanese|taiwanese|thai|american|british|indian|romantic|coming-of-age|television|tv|web|fantasy|historical|romance|comedy|thriller|science fiction|sci-fi|animated|young adult|contemporary)\b|in this (drama|series|film|movie|book|novel|show)|the (plot|story) (is|was))\b/i;
// Before a quoted piece: what names it as a title or a tagline ("Episode 3:", "an article titled", "Its tagline reads").
const TITLED = /\b(episodes?|ep|eps|chapter|ch|part|vol|volume)\.?\s*#?\d+\s*[:.\-–—)]?\s*(titled\s*)?[“"'‘]?\s*$|\b(titled|entitled|headlined|headline|article|episode title|chapter title|episode name)\s*[:,]?\s*[“"'‘]?\s*$/i;
const TAGGED = /\b(tagline|slogan|logline|log line|catchphrase|poster|blurb)s?\b[^“"«]{0,30}[“"«]?\s*$/i;
const SUMMED = /\b(synopsis|summary|premise|description|plot)\b[^“"«]{0,20}[“"«]?\s*$/i;
// A citation: publisher, date, "Retrieved", "Archived" after the title; or an author and date in brackets before it.
const CITE_WORDS = /\b(Retrieved|Archived|Accessed|ISBN|ISSN|OCLC|doi)\b/;
const DATE = /\b(\d{1,2} )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}, )?\d{4}\b|\b(19|20)\d\d-\d\d-\d\d\b/;
const DATED_BEFORE = /\([^()]{0,30}\b(19|20)\d\d[a-z]?\b[^()]{0,6}\)\.?\s*[“"]?\s*$/;
// The parts of a page that are never lines: what it is called -> the reason counted for it.
const PARTS = [
  [/^(references?|notes?|citations?|footnotes?|sources?|bibliography|works cited|external links?|see also|further reading|links|navigation|menu|contents)$/, "a citation"],
  [/^(episodes?|episode list|list of episodes|episode guide|chapters?|table of contents)$/, "an episode title"],
  [/^(taglines?|slogans?)$/, "a tagline"],
  [/^(plot|synopsis|summary|plot summary|premise|overview|storyline|description|book description|about the book|blurb)$/, "a synopsis"],
  [/^(ratings|viewership|television ratings|reception|critical reception|critical response|response|accolades|awards?|awards and nominations|broadcast|release|production|development|casting|cast|main cast|supporting cast|cast and characters|characters|soundtracks?|original soundtrack|ost|music|trivia|goofs|did you know|box office|marketing|adaptations?|remake|related|more like this|recommendations|you might also like|about the author|editions|news|press|filming|legacy|impact|controversy|controversies|international broadcast)$/, "about the work"],
];
const cleanPart = (p) => String(p || "").toLowerCase().replace(/\[edit\]|edit$/g, "").replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim();
const LABEL = /^(from|in) the (tv |web )?(series|film|movie|book|novel|drama|show)\b/i;
const squash = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const endsSentence = (t) => /[.!?…]["'’”)]?$/.test(String(t).trim());

// Does the line name the work itself (its title as a title, in capitals as it is written, or its original
// title) or its actors? A title that is one word counts only away from the start of a sentence ("Home is ..."
// is a line, "I watched Home" is not).
function namesItself(text, work) {
  if (!work) return "";
  if (work.original && /[^\x00-\x7f]/.test(work.original) && text.includes(work.original)) return "about the work";
  for (const raw of [work.title, work.real, ...(work.aka || [])]) {
    const name = String(raw || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (name.length < 4 || !/[A-Z]/.test(name)) continue;
    const names = [name, ...(/^the /i.test(name) && name.split(" ").length >= 3 ? [name.replace(/^the /i, "")] : [])];
    for (const n of names.filter((x) => /[A-Z]/.test(x))) {
      for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + 1)) {
        const edge = (at === 0 || /[^\p{L}\p{N}]/u.test(text[at - 1])) && (at + n.length >= text.length || /[^\p{L}\p{N}]/u.test(text[at + n.length]));
        if (!edge) continue;
        if (n.includes(" ") && /[A-Z]/.test(n.split(" ").slice(1).join(" "))) return "about the work";
        if (at > 0 && !/[.!?…]["'’”]?\s*$/.test(text.slice(0, at))) return "about the work";
      }
    }
  }
  for (const who of [...(work.cast || []), ...(work.type === "book" && work.author && work.author.includes(" ") ? [work.author] : [])]) {
    const q = squash(who);
    if (q.length >= 6 && squash(text).includes(q)) return work.type === "book" ? "about the work" : "names its actors";
  }
  return "";
}
// A character described from outside: "Lim Ju-kyung is a high school student who ...": a full name (or one of
// the work's characters) and "is a", with nobody speaking to anyone.
const DESCRIBED = /^((?:[\p{Lu}][\p{L}'’-]+)(?: [\p{Lu}][\p{L}'’-]+)+),? (is|was|becomes|works as) (a|an|the)\b/u;
function described(text, work) {
  const m = DESCRIBED.exec(text);
  if (!m || PRONOUN.test(text)) return false;
  return m[1].split(" ").length >= 2 || isCharacter(work, m[1]);
}
// Title Case with no sentence in it: a heading, a list title ("The 25 Best K-Dramas on Viki").
function titleCase(text) {
  const words = text.replace(/[“”"«»]/g, "").split(/\s+/).filter(Boolean);
  const content = words.filter((w, i) => i === 0 || !SMALL.has(w.toLowerCase().replace(/[^a-z]/g, "")));
  if (content.length < 3 || endsSentence(text)) return false;
  return content.filter((w) => /^[\p{Lu}\p{N}]/u.test(w)).length / content.length >= 0.8;
}
// A known character's name, compared without spaces ("Shang Zhi Tao" is "Shang Zhitao").
export const isCharacter = (work, by) => !!(work && by && (work.characters || []).some((c) => squash(c).length >= 3 && squash(c) === squash(by)));

// ---------------------------------------------------------------- 1. the cheap refusals

// "line" is a string or { text, by }. "work" the work it was found for (public facts: title, real, original,
// aka, type, cast, characters, author), or null. "ctx" = { before, after, part, heading, place, quoted }:
// "place" is "quotes" (a quotes page's own list: Wikiquote, Goodreads, IMDb), "mdl" (a review on the work's
// own MyDramaList page), "page", "snippet" or "helper" (an answer from Gemini or OpenAI).
// Returns { ok, why, proof }: "why" the reason for a refusal, "proof" true when the page's structure alone
// shows the line is said in the work.
export function isSaid(line, work = null, ctx = {}) {
  const text = String(line && typeof line === "object" ? line.text : line || "").replace(/\s+/g, " ").trim();
  const by = String((line && typeof line === "object" && line.by) || ctx.by || "");
  const before = String(ctx.before || ""), after = String(ctx.after || "");
  const no = (why) => ({ ok: false, why, proof: false });
  if (!text) return no("a label");
  // What the card says under a line is never a line itself; nor is the title alone.
  if (LABEL.test(text) || (work && [work.title, work.real].some((t) => t && squash(t) === squash(text)))) return no("a label");
  // Where it sat on the page.
  if (ctx.heading) return no("a heading");
  const part = cleanPart(ctx.part);
  if (part && ctx.place !== "quotes") for (const [re, why] of PARTS) if (re.test(part)) return no(why);
  if (/^\s*\^/.test(text) || (CITE_WORDS.test(after.slice(0, 140)) && /^\s*["”'’]?\s*[.,]/.test(after)) || DATED_BEFORE.test(before)
    || (/^\s*["”'’]?\s*[.,]\s+[A-Z]/.test(after) && DATE.test(after.slice(0, 140)))) return no("a citation");
  if (TITLED.test(before) || /^(episode|chapter|part)\s+\d+\b/i.test(text)) return no("an episode title");
  if (TAGGED.test(before)) return no("a tagline");
  if (SUMMED.test(before)) return no("a synopsis");
  // What it says. On a quotes page's own list the page's structure already says it is a line, and that counts
  // for more than its words: only the judge may still say otherwise.
  if (RATING.test(text)) return no("a review");
  const listed = ctx.place === "quotes";
  if (!listed && (SYNOPSIS.test(text) || described(text, work))) return no("a synopsis");
  if (!listed && (ABOUT.test(text) || ABOUT_NAMED.test(text))) return no("about the work");
  const named = listed ? "" : namesItself(text, work);
  if (named) return no(named);
  if (!listed && titleCase(text)) return no("a heading");
  // A headline: no sentence of its own, nobody speaking to anyone, and the page goes on after it with a
  // full stop outside the quotation marks and a new capital (a publisher, a site's name).
  if (!listed && !endsSentence(text) && !PRONOUN.test(text) && text.split(" ").length <= 16 && /^\s*[.]\s+[A-Z]/.test(after)
    && !/^\s*[.]\s+(he|she|they|it|then|and|but)\b/i.test(after)) return no("a headline");
  const proof = ctx.place === "quotes" || isCharacter(work, by) || (ctx.place === "mdl" && (!!ctx.quoted || !!by)) || (!work && !!by);
  return { ok: true, why: "", proof };
}

// Counts a refusal on a tally ({ why: n }), for the trail.
export function count(tally, why) { if (tally && why) tally[why] = (tally[why] || 0) + 1; }

// ---------------------------------------------------------------- 2. Claude's judgement

export const JUDGE_SYSTEM = `You sort lines found on the web for a quotes page. The lines were found for one book, film or series (or, when no work is named, each is credited to a person).
Each line comes with the words just before and after it on its page, who the page credits it to, and where it was found. Read them as a reader of the page would.
For each numbered line say what it is:
- "said": a character in the work says it, or the person it is credited to said or wrote it. A line a reviewer quotes FROM the work is "said": the words around it show it is the work's (a character's name next to it, "my favourite line", "when she tells him", "this scene where he says").
- "narration": the work's own words that no character says: a sentence of the book, a voice-over, words shown on screen.
- "about": anyone describing or discussing the work from outside: a headline or article title, a review or rating, a summary of the plot, a tagline, a title, an episode or chapter name, news, trivia, words about its actors or its making. A reviewer's OWN words in quotation marks are "about" too: their reaction while watching (an exclamation that something will be good, surprise that something already happened), their verdict on the acting or the writing, a phrase they put in quotes for emphasis.
- "unsure": you cannot tell.
Reply with a JSON array only, one item for every line: [{"n": 1, "is": "said"}]`;
const MAX_JUDGED = 40;                          // lines in one question; more are left to the page's structure
const KINDS = { book: "book", film: "film", series: "TV series" };
const WHERE = { quotes: "on a quotes page", mdl: "in a review of it", page: "on a web page", snippet: "in a search result", helper: "in a web search answer" };
function workLine(work) {
  if (!work || !work.title) return "No work is named: each line is credited to a person or a work.";
  const kind = KINDS[work.type] || "work";
  return `Work: the ${[work.year || "", work.country || "", kind].filter(Boolean).join(" ")} "${work.real || work.title}"${work.type === "book" && work.author ? ` by ${work.author}` : ""}`;
}

// One line of the question: the line, who it is credited to and where it was found; under it, what came just
// before and after it on its page (up to WIDE characters each), as a reader of the page sees it.
const flatWords = (t) => String(t || "").replace(/\s+/g, " ").replace(/"/g, "'");
export function questionLine(l, i) {
  const c = l.ctx || {}, b = flatWords(c.wb ?? c.before).slice(-WIDE), a = flatWords(c.wa ?? c.after).slice(0, WIDE);
  return `${i + 1}. "${String(l.text).replace(/\s+/g, " ")}" (${[l.by && `credited to ${l.by}`, `found ${WHERE[c.place] || "on a web page"}`].filter(Boolean).join("; ")})`
    + (b.trim() ? `\n   before: "${b}"` : "") + (a.trim() ? `\n   after: "${a}"` : "");
}
// The lines that passed isSaid, judged together. "lines" are { text, by, ctx }. Returns { kept, refused, how }:
// the kept lines (each with "is" set, "ctx" taken off), a tally of the rest by reason, and how they were judged
// ("claude", "structure" or "" when there was nothing to judge). "state" (a look-up's) is charged for the call.
export async function judge(env, kit, work, lines, { state = null, ask = true } = {}) {
  const refused = {}, kept = [];
  if (!lines.length) return { kept, refused, how: "" };
  let answer = null;
  const asked = lines.slice(0, MAX_JUDGED);
  if (ask && env.ANTHROPIC_API_KEY) {
    try {
      if (state) state.spent += 2;              // the question, and the day's count of questions to Claude
      answer = kit.parseJson(await kit.claude(env, { system: JUDGE_SYSTEM, maxTokens: 1200, messages: [{ role: "user", content:
        `${workLine(work)}\n\n${asked.map((l, i) => questionLine(l, i)).join("\n")}` }] }));
    } catch (e) { answer = null; }
  }
  const verdicts = new Map();
  for (const a of Array.isArray(answer) ? answer : []) {
    const n = Number(a && a.n), is = String((a && a.is) || "").toLowerCase();
    if (n >= 1 && n <= asked.length && ["said", "narration", "about", "unsure"].includes(is)) verdicts.set(n - 1, is);
  }
  const how = verdicts.size ? "claude" : "structure";
  lines.forEach((l, i) => {
    const is = verdicts.get(i);
    const out = { ...l };
    delete out.ctx;
    if (is === "said" || is === "narration") kept.push({ ...out, is });
    else if (is === "about") count(refused, "judged about the work");
    // Unsure, but the page itself shows it is a line and names one of the work's characters for it: kept, to check.
    else if (is === "unsure" && isCharacter(work, l.by) && isSaid(l, work, l.ctx || {}).proof) kept.push({ ...out, is: "unsure", verify: true });
    else if (is === "unsure") count(refused, "judged unsure");
    // Not judged (Claude could not be asked, or said nothing of it): only the page's own structure decides.
    else if (isSaid(l, work, l.ctx || {}).proof) kept.push({ ...out, is: "structure" });
    else count(refused, "no proof without nishiii");
  });
  return { kept, refused, how };
}

// Both steps for a list of found lines: { kept, refused, how }.
export async function gate(env, kit, work, lines, opts = {}) {
  const refused = {}, pass = [];
  for (const l of lines) {
    const r = isSaid(l, work, l.ctx || {});
    if (r.ok) pass.push(l); else count(refused, r.why);
  }
  const j = await judge(env, kit, work, pass, opts);
  for (const [k, v] of Object.entries(j.refused)) refused[k] = (refused[k] || 0) + v;
  return { kept: j.kept, refused, how: j.how };
}

// "3 a citation, 1 a tagline": a tally in words.
export const tallyText = (t) => Object.entries(t || {}).map(([k, v]) => `${v} ${k}`).join(", ");
export const tallySum = (t) => Object.values(t || {}).reduce((a, b) => a + (Number(b) || 0), 0);

// ---------------------------------------------------------------- where a piece of text sat on its page

// The headings of a page's text ("== References ==", "## Plot"), in order: [{ at, name }].
export function partsOf(text) {
  const out = [];
  for (const m of String(text).matchAll(/^(?:={2,6}[ \t]*(.+?)[ \t]*={2,6}|#{1,6}[ \t]+(.+?))[ \t]*$/gm)) out.push({ at: m.index, name: (m[1] || m[2] || "").trim() });
  return out;
}
// The heading a position sits under.
export function partAt(parts, at) {
  let name = "";
  for (const p of parts) { if (p.at > at) break; name = p.name; }
  return name;
}
// What a position on a page looks like from the line it is on: { before, after, part, heading }.
export function around(text, parts, at, end = at) {
  const t = String(text);
  const start = t.lastIndexOf("\n", at - 1) + 1, stop = t.indexOf("\n", end) < 0 ? t.length : t.indexOf("\n", end);
  const line = t.slice(start, stop);
  return { before: t.slice(Math.max(start, at - 120), at), after: t.slice(end, Math.min(stop, end + 140)), part: partAt(parts, at), heading: /^\s*(={2,6}|#{1,6}\s)/.test(line), ...wide(t, at, end) };
}
// What a reader sees around a piece of text, across lines: up to WIDE characters before and after it (for the judge).
export const WIDE = 120;
export const wide = (text, at, end = at) => { const t = String(text); return { wb: t.slice(Math.max(0, at - WIDE), at), wa: t.slice(end, end + WIDE) }; };
// Where a line picked from a page (by Claude, so with no position of its own) sits on it, found by its first or
// last words: { before, after, part, heading, place, quoted }. Only "place" when it cannot be found.
export function contextOf(pg, text, place) {
  const t = String((pg && pg.text) || ""), s = String(text || "");
  if (!pg.parts) pg.parts = partsOf(t);
  let at = t.indexOf(s.slice(0, 30));
  if (at < 0 && s.length > 30) { const e = t.indexOf(s.slice(-30)); if (e >= 0) at = Math.max(0, e - (s.length - 30)); }
  if (at < 0) return { place };
  const quoted = /[“"«「]\s*$/.test(t.slice(Math.max(0, at - 2), at));
  const end = Math.min(t.length, at + s.length);
  return { ...around(t, pg.parts, quoted ? at - 1 : at, quoted && /^[”"»」]/.test(t.slice(end, end + 1)) ? end + 1 : end), place, quoted };
}
