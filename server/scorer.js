/* Learns which suggested quotes she picks, and ranks new ones by it.

   This file is one of the app's add-on sections (see SECTIONS in worker.js).
   Handlers are called as handler(request, env, parts, kit); jobs as run(env, kit).

   How it works, in short:
   - It keeps its own lasting record of every suggestion and what became of it (the document
     "scorer/log"), gathered from the day lists, the asked-for list and the record of choices.
     Those are trimmed or shown for a week only; this record stays.
   - A pick is a suggestion she tapped "Use this" or "Reword" on. A pass is one she skipped, or one
     she left untouched on a day (or in an asked-for batch) from which she did pick something.
     Untouched quotes on a day with no pick at all say nothing either way, so they are not counted.
   - For each thing a quote can be (its theme, tone, where it is from, its author, its length, who it
     speaks to, whether its wording is certain) it counts how often she picks that, compared with how
     often she picks anything. Recent choices count more; a value seen only a few times moves little.
   - It counts from her very first pick or skip: the engine (server/engine.js) uses these counts from the first
     day, with a weight that grows with the number of choices behind them. It is still tested on her own past
     choices: going day by day, would what it knew before that day began have put the quote she picked above
     the ones she passed, clearly more often than chance? Proven, it is "live" and the engine trusts it more;
     clearly worse than chance, it is "resting" and the engine all but ignores it until it recovers.
     "Knew before" is taken strictly: a day's list (or an asked-for batch) is learned from only once
     nothing in it can change by itself and her last choice in it has been made, and only for the
     days that begin after that. Her own lines are left out of this test, since it never ranks them.
   - choose() and ranker() below are the older way of ranking, kept for callers that still use them; the day's
     quotes are now ranked by the engine.
   - A smaller second voice: themes and tones that did better than the posts around them on her
     own page get a small lift. Her picks stay the main voice. */

import * as tags from "./tags.js";

const DAY_MS = 24 * 3600 * 1000, IST_MS = 5.5 * 3600 * 1000;
const HALF_LIFE_MS = 60 * DAY_MS;           // a choice from two months ago counts half as much as today's
const MAX_ROWS = 1500, FOLD_TO = 1300, FOLD_OLDER_MS = 45 * DAY_MS;
const WARMUP_PICKS = 15;                    // picks it must have seen before its guesses are tested
const MIN_DAYS = 20, WINDOW = 60;           // tested days needed, and how many recent ones are looked at
const GO_MEAN = 0.56, GO_Z = 2.5;           // to go live: right this often, and this sure it isn't luck
const STOP_MEAN = 0.52, STOP_Z = 1.0;       // to step back: lower bars, so it doesn't flip back and forth
const RECENT = 10, GO_RECENT = 0.56, STOP_RECENT = 0.4;  // and the last ten tested days on their own: a sudden change of taste shows here first
const WORSE_DAYS = 10, WORSE_MEAN = 0.42, WORSE_Z = -2;  // the safety net: this many tested days, clearly worse than chance
const LOOKBACK_DAYS = 7, BACKFILL_PER_RUN = 2, DAILY = 5;
const MAX_ASK = 12, SAME_THEME = 2, SAME_AUTHOR = 2;
const AUDIENCE_MIN_POSTS = 3, AUDIENCE_CAP = 0.5;
const REFRESH_MS = 6 * 3600 * 1000;
const TRUST_MS = 3 * DAY_MS;                // a model nobody has rebuilt for three days is not ranked by (see ranker)
const FAINT = 0.05;                         // a value whose faded count is under a twentieth of one choice is let go

// What is looked at on a quote: its name here, how much it counts, and how many "ordinary" examples
// each value starts with. The more values a feature can take, the more evidence one value needs.
const FEATURES = [
  ["theme", 1, 8], ["tone", 1, 8], ["kind", 1, 6], ["work", 0.6, 10], ["author", 0.6, 10],
  ["len", 1, 6], ["voice", 0.7, 6], ["sure", 0.5, 6],
];
const VALUE = {
  theme: (r) => tags.theme(r.th), tone: (r) => tags.tone(r.to), kind: (r) => r.k, work: (r) => r.w, author: (r) => r.a,
  len: (r) => (!r.n ? "" : r.n <= 10 ? "short" : r.n <= 25 ? "medium" : "long"),
  voice: (r) => r.v,
  sure: (r) => (r.k === "own" || r.c == null || r.c < 0 ? "" : r.c ? "check" : "exact"),
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
const low = (s, max) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, max);
const wordsIn = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
const istDate = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const noonOf = (date) => Date.parse(date + "T12:00:00+05:30");
const isDay = (g) => /^\d{4}-\d\d-\d\d$/.test(g);

// A short fingerprint of the wording, to recognise the same quote where its id isn't known.
export function keyOf(text) {
  const s = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let a = 0x811c9dc5, b = 0x9e3779b9 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = (Math.imul(b ^ c, 0x85ebca6b) + 0x27d4eb2f) | 0;
  }
  return (a >>> 0).toString(36) + "-" + (b >>> 0).toString(36);
}
// Who the line speaks to: "you", "i", "we", or nobody in particular.
function voiceOf(text) {
  const t = " " + String(text || "").toLowerCase().replace(/[^a-z]+/g, " ") + " ";
  if (/ (you|your|yours|yourself) /.test(t)) return "you";
  if (/ (i|me|my|mine|myself) /.test(t)) return "i";
  if (/ (we|us|our|ours) /.test(t)) return "we";
  return "plain";
}
// The facts about a quote that are known the moment it is offered.
// Works for a suggestion (source is { type, title }), a choice from the record, or a post (source is a word).
export function describe(item) {
  const src = item.source, text = item.text != null ? item.text : item.quote;
  return {
    th: low(item.theme, 30), to: low(item.tone, 20),
    k: low(src && typeof src === "object" ? src.type : src, 12),
    w: low(src && typeof src === "object" ? src.title : "", 60),
    a: low(item.author, 60), n: wordsIn(text), v: voiceOf(text),
    c: item.verify == null ? -1 : item.verify ? 1 : 0, x: keyOf(text),
  };
}

// ---------- counting ----------
const emptyCounts = () => ({ P: 0, N: 0, f: Object.fromEntries(FEATURES.map(([name]) => [name, Object.create(null)])) });
function add(c, r, picked, weight) {
  if (picked) c.P += weight; else c.N += weight;
  for (const [name] of FEATURES) {
    const v = VALUE[name](r);
    if (!v) continue;
    const map = c.f[name];
    const e = Object.hasOwn(map, v) ? map[v] : (map[v] = [0, 0]);
    e[picked ? 0 : 1] += weight;
  }
}
// Counts read back from storage are plain data: anything odd in them is simply skipped.
const pairAt = (map, v) => {
  const e = map && Object.hasOwn(map, v) ? map[v] : null;
  return Array.isArray(e) && Number.isFinite(e[0]) && Number.isFinite(e[1]) ? e : null;
};
// Her usual rate of picking, worked out once for a set of counts ("scale" brings old counts to a given day).
function prepare(c, scale = 1) {
  const P = c.P * scale, N = c.N * scale;
  const base = (P + 1) / (P + N + 2);
  return { c, scale, base, baseLogit: Math.log(base / (1 - base)) };
}
// How much more (or less) often than usual she picks quotes with this value. 0 = as usual.
function leaning(ctx, name, prior, v) {
  const e = pairAt(ctx.c.f[name], v);
  if (!e) return 0;
  const p = e[0] * ctx.scale, n = e[1] * ctx.scale;
  const rate = (p + prior * ctx.base) / (p + n + prior);
  return clamp(Math.log(rate / (1 - rate)) - ctx.baseLogit, -2, 2);
}
function tasteScore(ctx, r) {
  let s = 0;
  for (const [name, weight, prior] of FEATURES) {
    const v = VALUE[name](r);
    if (v) s += weight * leaning(ctx, name, prior, v);
  }
  return s;
}

// ---------- learning from the record ----------
const emptyLog = () => ({ v: 1, rows: [], fold: null, histAt: 0, since: 0, back: "", backTo: "" });
const soundLog = (l) => !!l && l.v === 1 && Array.isArray(l.rows);

function closed(g, now, today) {
  if (isDay(g)) return g < today;                              // a day's list: once the day is over
  if (g[0] === "a") return now - Number(g.slice(1)) >= DAY_MS; // an asked-for batch: a day after she asked
  return true;                                                 // a single choice known only from the record
}
// The moment a group stops changing by itself (the same rule as above, as a time), and the start of the day it belongs to.
const closesAt = (g, t) => (isDay(g) ? noonOf(g) + DAY_MS / 2 : g[0] === "a" ? Number(g.slice(1)) + DAY_MS : t);
const dayStart = (g, t) => noonOf(isDay(g) ? g : istDate(t)) - DAY_MS / 2;
// When everything about a finished group was known: when it closed, or her last choice in it if that came later
// (she can go back to a quote from earlier in the week). Only after this moment may anything be learned from it.
function settledAt(grp) {
  let at = closesAt(grp.g, grp.t);
  for (const r of grp.rows) if (r.s && r.u > at) at = r.u;
  return Number.isFinite(at) ? at : Infinity;
}
// Her own lines go into a day's five as they are, one chosen at random; it never ranks them. So the test of
// whether it ranks well compares only the quotes it could have ranked.
const canRank = (r) => r.k !== "own";
function grouped(rows) {
  const groups = new Map();
  for (const r of rows) {
    let g = groups.get(r.g);
    if (!g) groups.set(r.g, (g = { g: r.g, t: r.t, rows: [] }));
    g.rows.push(r);
    if (r.t < g.t) g.t = r.t;
  }
  return [...groups.values()].sort((a, b) => a.t - b.t);
}
// Picks and passes in one day's list or one asked-for batch.
function outcomes(grp, shut) {
  const anyPick = grp.rows.some((r) => r.s === 1);
  const pos = [], neg = [];
  for (const r of grp.rows) {
    if (r.s === 1) pos.push(r);
    else if (r.s === 2 || (shut && anyPick)) neg.push(r);
  }
  return { pos, neg };
}

// One pass over the record. Returns the counts as they stand now, and, for each tested day, how often what was
// known before that day began put the quote she picked above one she passed ("days"; the group each belongs to is
// in "at" and the moment its day began in "starts"). Nothing is used to predict a day unless it was settled before
// that day started: not the day itself, not anything else from the same day, and not a choice she made later about
// an earlier day's quotes.
export function learn(log, now, today) {
  const order = grouped(log.rows);
  const fold = log.fold && Number.isFinite(log.fold.at) ? log.fold : null;
  const t0 = Math.min(order.length ? order[0].t : now, fold ? fold.at : now);
  const grow = (t) => Math.pow(2, (t - t0) / HALF_LIFE_MS);   // later choices weigh more; brought back to scale when read
  const c = emptyCounts();
  let picks = 0, passes = 0;
  if (fold) {
    const g = grow(fold.at);
    c.P += (fold.P || 0) * g; c.N += (fold.N || 0) * g;
    for (const [name] of FEATURES) {
      const map = fold.f && fold.f[name];
      for (const v in map || {}) { const e = pairAt(map, v); if (e) c.f[name][v] = [e[0] * g, e[1] * g]; }
    }
    picks = fold.picks || 0; passes = fold.passes || 0;
  }
  const take = (grp) => {
    const u = grow(grp.t);
    for (const r of grp.pos) add(c, r, true, u);
    for (const r of grp.neg) add(c, r, false, u);
    picks += grp.pos.length; passes += grp.neg.length;
  };
  for (const grp of order) {
    grp.shut = closed(grp.g, now, today);
    Object.assign(grp, outcomes(grp, grp.shut));
    grp.settled = grp.shut ? settledAt(grp) : Infinity;
    grp.start = dayStart(grp.g, grp.t);
  }
  // Finished groups in the order in which they were settled: the order in which it could have learned from them.
  const feed = order.filter((grp) => grp.shut).sort((a, b) => a.settled - b.settled);
  // The folded counts hold days up to "known"; a day before that cannot be tested fairly against them.
  const known = fold && Number.isFinite(fold.known) ? fold.known : 0;
  const days = [], at = [], starts = [];
  let fed = 0;
  for (const grp of order.filter((x) => x.shut && Number.isFinite(x.start)).sort((a, b) => a.start - b.start)) {
    const pos = grp.pos.filter(canRank), neg = grp.neg.filter(canRank);
    if (!pos.length || !neg.length) continue;
    while (fed < feed.length && feed[fed].settled <= grp.start) take(feed[fed++]);
    if (picks < WARMUP_PICKS || grp.start < known) continue;
    const ctx = prepare(c, 1 / grow(grp.t));
    const sp = pos.map((r) => tasteScore(ctx, r)), sn = neg.map((r) => tasteScore(ctx, r));
    let won = 0;
    for (const a of sp) for (const b of sn) won += Math.abs(a - b) < 1e-9 ? 0.5 : a > b ? 1 : 0;
    days.push(won / (sp.length * sn.length)); at.push(grp.g); starts.push(grp.start);
  }
  // Everything else counts for what it knows now: the days settled since, and her choices so far in what is still open.
  while (fed < feed.length) take(feed[fed++]);
  for (const grp of order) if (!grp.shut) take(grp);
  const back = 1 / grow(now);
  c.P *= back; c.N *= back;
  for (const [name] of FEATURES) for (const v in c.f[name]) { c.f[name][v][0] *= back; c.f[name][v][1] *= back; }
  return { counts: c, days, at, starts, picks, passes };
}

// Is it better than chance, over the recent tested days?
export function judge(days) {
  const span = days.slice(-WINDOW), n = span.length;
  if (!n) return { days: 0, mean: 0.5, z: 0, recent: 0.5 };
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const mean = avg(span);
  const spread = Math.sqrt(span.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { days: n, mean, z: (mean - 0.5) / (Math.max(0.25, spread) / Math.sqrt(n)),
    recent: days.length >= RECENT ? avg(days.slice(-RECENT)) : mean };
}
export function nextState(prev, picks, ev) {
  if (prev === "live") return ev.days < MIN_DAYS || ev.mean < STOP_MEAN || ev.z < STOP_Z || ev.recent < STOP_RECENT ? "learning" : "live";
  return ev.days >= MIN_DAYS && ev.mean >= GO_MEAN && ev.z >= GO_Z && ev.recent >= GO_RECENT ? "live" : "learning";
}

// The safety net: over enough tested days it put the quote she passed above the one she picked clearly more
// often than chance would. Then its guesses are worse than none, and the engine leaves them out until they recover.
export const worse = (ev) => !!ev && ev.days >= WORSE_DAYS && ev.mean <= WORSE_MEAN && ev.z <= WORSE_Z;

// Where it stands after a count: "live" or "learning", with the test result that decided it. Once it has stepped
// back, what it got right (or wrong) before that no longer speaks for it: from then on it is judged only on the
// days tested since. "back" is the moment it last stepped back; 0 if it never has.
export function decide(prev, res, now) {
  const wasLive = !!prev && prev.state === "live", back = (prev && Number(prev.back)) || 0;
  const ev = judge(back ? res.days.filter((_, n) => res.starts[n] >= back) : res.days);
  const state = worse(ev) ? "resting" : nextState(wasLive ? "live" : "learning", res.picks, ev);
  return { state, ev, back: wasLive && state !== "live" ? now : back };
}

// Keeps the record a steady size: the oldest days are folded into running counts, not dropped.
function foldOld(log, now, today) {
  if (log.rows.length <= MAX_ROWS) return;
  const order = grouped(log.rows);
  const decay = (t) => Math.pow(2, -(now - t) / HALF_LIFE_MS);
  // upTo: the time of the newest group folded (nothing at or before it is gathered again);
  // known: the latest moment anything folded was settled (no day before that is tested against these counts).
  const fold = { at: now, upTo: 0, known: 0, picks: 0, passes: 0, ...emptyCounts() };
  const old = log.fold && Number.isFinite(log.fold.at) ? log.fold : null;
  if (old) {
    const d = decay(old.at);
    fold.P = (old.P || 0) * d; fold.N = (old.N || 0) * d; fold.picks = old.picks || 0; fold.passes = old.passes || 0;
    fold.upTo = Number(old.upTo) || 0; fold.known = Number(old.known) || 0;
    for (const [name] of FEATURES) for (const v in (old.f && old.f[name]) || {}) { const e = pairAt(old.f[name], v); if (e) fold.f[name][v] = [e[0] * d, e[1] * d]; }
  }
  const gone = new Set();
  let left = log.rows.length;
  for (const grp of order) {
    if (left <= FOLD_TO) break;
    const pressing = log.rows.length > MAX_ROWS * 2;            // far too big: fold whatever is finished
    if (!closed(grp.g, now, today) || (!pressing && now - grp.t < FOLD_OLDER_MS)) break;
    // She can go back to an old quote (an asked-for batch stays on its list for months). A group she chose from
    // not long ago waits as rows: folded, it would leave no day before that choice testable (see "known").
    const settled = settledAt(grp);
    if (!pressing && now - settled < FOLD_OLDER_MS) continue;
    const { pos, neg } = outcomes(grp, true);
    for (const r of pos) add(fold, r, true, decay(grp.t));
    for (const r of neg) add(fold, r, false, decay(grp.t));
    fold.picks += pos.length; fold.passes += neg.length;
    fold.upTo = Math.max(fold.upTo, grp.t); fold.known = Math.max(fold.known, Number.isFinite(settled) ? settled : now);
    for (const r of grp.rows) gone.add(r);
    left -= grp.rows.length;
  }
  if (!gone.size) return;
  // The running counts stay small too: an author or a book last seen so long ago that it no longer counts is let go.
  for (const [name] of FEATURES) for (const v of Object.keys(fold.f[name])) {
    const e = fold.f[name][v].map(round3);
    if (e[0] + e[1] < FAINT) delete fold.f[name][v]; else fold.f[name][v] = e;
  }
  log.rows = log.rows.filter((r) => !gone.has(r));
  log.fold = fold;
}

// ---------- the audience's smaller voice ----------
// For each theme and tone with at least three posts: did those posts draw more reaction than the
// posts around them in time? Comparing with neighbours keeps a growing page from flattering recent themes.
export function audience(posts) {
  const reactions = (m) => (m.total_interactions != null ? m.total_interactions : (m.likes || 0) + (m.comments || 0) + (m.saved || 0) + (m.shares || 0));
  const reach = (m) => (m.reach != null ? m.reach : m.views || 0);
  const measured = (Array.isArray(posts) ? posts : [])
    .filter((p) => p && p.state === "published" && p.published && p.metrics && reach(p.metrics) > 0)
    .sort((a, b) => a.published - b.published)
    .map((p) => ({ theme: low(p.theme, 30), tone: low(p.tone, 20), y: Math.log(1 + Math.max(0, Number(reactions(p.metrics)) || 0)) }));
  const out = { posts: measured.length, theme: Object.create(null), tone: Object.create(null) };
  if (measured.length < 6) return out;
  const rel = measured.map((p, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(measured.length - 1, i + 4); j++) if (j !== i) { sum += measured[j].y; n++; }
    return p.y - sum / n;
  });
  for (const field of ["theme", "tone"]) {
    const groups = new Map();
    measured.forEach((p, i) => { if (p[field]) groups.set(p[field], [...(groups.get(p[field]) || []), rel[i]]); });
    for (const [v, g] of groups) {
      if (g.length < AUDIENCE_MIN_POSTS) continue;
      const lift = clamp((g.reduce((a, b) => a + b, 0) / g.length) * (g.length / (g.length + 3)), -AUDIENCE_CAP, AUDIENCE_CAP);
      if (Math.abs(lift) >= 0.02) out[field][v] = round3(lift);
    }
  }
  return out;
}
function audienceScore(aud, r) {
  if (!aud) return 0;
  const at = (map, v) => (v && map && Object.hasOwn(map, v) && Number.isFinite(map[v]) ? map[v] : 0);
  return clamp(at(aud.theme, r.th) + at(aud.tone, r.to), -AUDIENCE_CAP, AUDIENCE_CAP);
}

// ---------- the stored model ----------
const usable = (m) => !!m && m.v === 1 && Array.isArray(m.base) && Number.isFinite(m.base[0]) && Number.isFinite(m.base[1])
  && !!m.feat && typeof m.feat === "object" && Number.isFinite(m.at);
// The timed job rebuilds and re-tests the model four times a day. If that has stopped, for whatever reason, a model
// left saying "live" could never step back again, so after three days it is no longer ranked by.
const current = (m) => Date.now() - m.at <= TRUST_MS;
const countsOf = (m) => ({ P: m.base[0], N: m.base[1], f: Object.fromEntries(FEATURES.map(([name]) => [name, (m.feat && typeof m.feat[name] === "object" && m.feat[name]) || {}])) });

// What it has learned, in a few plain words: "short, hopeful lines from books".
export function lately(c) {
  const ctx = prepare(c);
  const best = (name, prior) => {
    let top = null;
    for (const v in c.f[name]) {
      const e = pairAt(c.f[name], v);
      if (!e || e[0] < 3) continue;                              // needs a few real picks behind it
      // Named only when she picks it clearly more often than chance alone would explain.
      const seen = e[0] + e[1], sure = (e[0] - ctx.base * seen) / Math.sqrt(ctx.base * (1 - ctx.base) * seen);
      const w = leaning(ctx, name, prior, v);
      if (w >= 0.3 && sure >= 2.5 && (!top || w > top.w)) top = { v, w };
    }
    return top ? top.v : "";
  };
  const prior = Object.fromEntries(FEATURES.map(([name, , p]) => [name, p]));
  const len = best("len", prior.len), tone = best("tone", prior.tone), theme = best("theme", prior.theme), kind = best("kind", prior.kind);
  const how = [len === "medium" ? "medium-length" : len, tone].filter(Boolean).join(", ");
  const from = { book: "from books", film: "from films", series: "from series", classic: "from well-known voices", own: "from your own collection" }[kind] || "";
  if (!how && !theme && !from) return "";
  return [how ? `${how} lines` : "lines", theme ? `about ${theme}` : "", from].filter(Boolean).join(" ");
}

// What she sees in the Nishiii section. One line.
export function statusOf(m) {
  const picks = (m && m.picks) || 0, state = m && ["live", "resting"].includes(m.state) ? m.state : "learning";
  const line = !picks ? "Learning from your picks: none yet."
    : m.lately ? `Learning from your picks: ${picks} so far. Lately: ${m.lately}.`
    : `Learning from your picks: ${picks} so far, no clear pattern yet.`;
  return { state, picks, line };
}

// For the engine: a function that says how well a quote fits her picks (s, about -6 to 6, 0 = as usual) and which
// single thing about it counts most (top: [feature, value, weight]). Null when there is no sound model.
export function pickScorer(m) {
  if (!usable(m)) return null;
  const ctx = prepare(countsOf(m));
  return (item) => {
    const r = describe(item);
    let s = 0, top = null;
    for (const [name, weight, prior] of FEATURES) {
      const v = VALUE[name](r);
      if (!v) continue;
      const w = weight * leaning(ctx, name, prior, v);
      s += w;
      if (!top || w > top[2]) top = [name, v, w];
    }
    return { s, top };
  };
}

// ---------- choosing among candidates (only when live) ----------
// Keeps the best "want" of the pool: the top matches, never more than two on one theme or by one
// author, and one wildcard (the least familiar of the rest). They are handed back in the order Nishiii
// gave them, the wildcard wherever it happened to stand, not best-scored first: she may well have a habit
// of taking the first card, and if the scorer decided which card came first, that habit would look like
// proof that its scoring works (and the wildcard, always last, would hardly ever get its chance).
export function choose(model, pool, want, already = []) {
  if (want < 1) return [];
  if (pool.length <= want) return pool.slice(0, want);
  const c = countsOf(model), ctx = prepare(c);
  const seenOf = (name, v) => { const e = v ? pairAt(c.f[name], v) : null; return e ? e[0] + e[1] : 0; };
  const scored = pool.map((item, i) => {
    const r = describe(item), taste = tasteScore(ctx, r);
    const fresh = ["theme", "tone", "kind", "work", "author"].reduce((sum, name) => { const v = VALUE[name](r); return v ? sum + 1 / (1 + seenOf(name, v)) : sum; }, 0);
    return { item, i, r, taste, s: taste + audienceScore(model.aud, r), fresh };
  });
  const byScore = scored.slice().sort((a, b) => b.s - a.s || a.i - b.i);
  const themes = new Map(), authors = new Map();
  const note = (r) => { if (r.th) themes.set(r.th, (themes.get(r.th) || 0) + 1); if (r.a) authors.set(r.a, (authors.get(r.a) || 0) + 1); };
  for (const a of already) note(describe(a));
  const fits = (e) => (!e.r.th || (themes.get(e.r.th) || 0) < SAME_THEME) && (!e.r.a || (authors.get(e.r.a) || 0) < SAME_AUTHOR);
  const chosen = [];
  const wildcard = want >= 3;
  for (const e of byScore) {
    if (chosen.length >= (wildcard ? want - 1 : want)) break;
    if (fits(e)) { chosen.push(e); note(e.r); }
  }
  let wild = null;
  if (wildcard) {
    // Something different, but not something she clearly turns down.
    const rest = scored.filter((e) => !chosen.includes(e)).sort((a, b) => b.fresh - a.fresh || a.i - b.i);
    const open = rest.filter((e) => e.taste > -1);
    wild = open.find(fits) || rest.find(fits) || open[0] || rest[0] || null;
    if (wild) note(wild.r);
  }
  // Too few passed the variety rule (a batch from a single book, say): fill up with the best of the rest.
  for (const e of byScore) {
    if (chosen.length + (wild ? 1 : 0) >= want) break;
    if (!chosen.includes(e) && e !== wild) chosen.push(e);
  }
  const kept = wild ? [...chosen, wild] : chosen;
  return kept.sort((a, b) => a.i - b.i).map((e) => (e === wild ? { ...e.item, wild: true } : e.item));
}

// Used by worker.js when it gathers suggestions. Gives nothing back unless the scorer is live and
// sound, so any trouble here leaves the day's quotes exactly as they have always been made.
export async function ranker(env, kit) {
  try {
    const m = await kit.loadDoc(env, "scorer/model", null);
    if (!usable(m) || m.state === "resting" || !current(m)) return null;
    return {
      ask: (want) => Math.min(MAX_ASK, Math.max(want + 2, want * 2)),
      choose: (pool, want, already) => {
        try { return choose(m, pool, want, already); }
        catch (e) { console.error("scorer: choosing failed", e); return pool.slice(0, want); }
      },
    };
  } catch (e) { console.error("scorer: not available", e); return null; }
}

// "Forget everything" in the Nishiii section: the record and the model go, and nothing from before
// this moment is gathered again. The mark is written first and is never touched by anything else, so a
// count that happens to be under way sees it and stops, and a record older than the mark is never believed.
export async function forget(env, kit) {
  const now = Date.now();
  await kit.saveDoc(env, "scorer/forgot", { at: now });
  await Promise.all([
    kit.saveDoc(env, "scorer/log", { ...emptyLog(), since: now, back: "done" }),
    env.MEDIA.delete("data/scorer/model.json"),
  ]);
}
// Is there anything of hers here that "Forget everything" would erase? Asked before that button offers to.
export async function remembers(env, kit) {
  try {
    const m = await kit.loadDoc(env, "scorer/model", null);
    return !!m && (Number(m.picks) || 0) + (Number(m.passes) || 0) > 0;
  } catch (e) { return true; }                    // can't tell just now: better to offer than to say there is nothing
}

// ---------- gathering the record, then rebuilding the model ----------
const lastAt = (history) => (Array.isArray(history) ? history : []).reduce((m, h) => Math.max(m, (h && h.at) || 0), 0);

// The scorer's own documents must never be taken for "nothing there" just because they failed to load: that
// would start the lasting record again from nothing and save over it. One more try; if it still can't be had,
// the run stops and saves nothing. Only a document damaged beyond reading counts as gone.
async function mustLoad(env, kit, name) {
  for (let tries = 1; ; tries++) {
    try { return await kit.loadDoc(env, name, null); }
    catch (e) {
      if (tries < 2) continue;
      if (e && e.name === "SyntaxError") return null;
      throw e;
    }
  }
}
const forgottenAt = async (env, kit) => { const d = await mustLoad(env, kit, "scorer/forgot"); return (d && Number(d.at)) || 0; };

// light: the quick version run when she opens the Nishiii section (no posts, no older days).
async function refresh(env, kit, opts = {}) {
  const now = Date.now(), today = kit.todayIST();
  const dates = [today, ...Array.from({ length: LOOKBACK_DAYS }, (_, i) => istDate(now - (i + 1) * DAY_MS))];
  const later = (p) => Promise.resolve(p).catch(() => null);   // the app's own lists: one that can't be read now is read on the next run
  const [log0, prev0, forgot, asked, history, posts, ...dayDocs] = await Promise.all([
    mustLoad(env, kit, "scorer/log"),
    opts.model !== undefined ? opts.model : mustLoad(env, kit, "scorer/model"),
    forgottenAt(env, kit),
    later(kit.loadDoc(env, "asked", [])),
    opts.history || later(kit.loadDoc(env, "history", [])),
    opts.light ? null : later(kit.loadDoc(env, "posts", [])),
    ...dates.map((d) => later(kit.loadDoc(env, `suggestions/${d}`, []))),
  ]);
  let log = soundLog(log0) ? { ...emptyLog(), ...log0 } : emptyLog();
  let prev = usable(prev0) ? prev0 : null;
  if (forgot > (log.since || 0)) {                // "Forget everything" came after this record was saved: none of it counts
    log = { ...emptyLog(), since: forgot, back: "done" };
    prev = null;
  }
  // A time that cannot be real (not a number, or later than tomorrow) is never let in, from this record or from the
  // app's lists: a single one would outweigh every real choice in the counts, or stop this run and every later one.
  const real = (t) => Number.isFinite(t) && t > 0 && t <= now + 2 * DAY_MS;
  log.rows = log.rows.filter((r) => r && typeof r.i === "string" && typeof r.g === "string" && r.g && real(r.t));
  for (const r of log.rows) if (r.u && !real(r.u)) r.u = now;
  if (!real(log.histAt)) log.histAt = 0;
  const since = log.since || 0, sinceDay = since ? istDate(since) : "";
  // Days already folded into the running counts: nothing at or before this time is taken in again.
  const horizon = log.fold && Number.isFinite(log.fold.upTo) ? log.fold.upTo : 0;

  const byId = new Map(log.rows.map((r) => [r.i, r]));
  const touched = new Set(), dropped = new Set();
  const upsert = (item, g, t) => {
    if (!item || typeof item.id !== "string" || !item.text || !real(t)) return;
    const stated = item.state === "used" ? 1 : item.state === "rejected" ? 2 : 0;
    let r = byId.get(item.id);
    if (!r) {
      if (t <= horizon) return;
      r = { i: item.id, g, t, s: stated, u: stated ? now : 0, ...describe(item) };
      log.rows.push(r); byId.set(r.i, r);
      dropped.add("h" + r.x);          // the same quote known only from the record of choices: this fuller entry replaces it
    } else {
      const s = stated || (r.p ? 1 : 0);          // a post was made from it: a pick, even if the list never said "used"
      if (r.s !== s) { r.s = s; r.u = now; }
      if (r.g !== g) { r.g = g; r.t = t; }
    }
    touched.add(r.x);
  };
  const takeDay = (date, doc) => {
    if (!Array.isArray(doc) || (sinceDay && date <= sinceDay)) return;
    let shown = 0;
    for (const item of doc) {
      if (item && item.askedFor) {               // older days kept asked-for quotes in the day's list
        const at = Number(item.askedAt) || noonOf(date);
        if (at > since) upsert(item, "a" + at, at);
      } else if (shown++ < DAILY) upsert(item, date, noonOf(date));
    }
  };
  dates.forEach((d, n) => takeDay(d, dayDocs[n]));
  for (const item of Array.isArray(asked) ? asked : []) {
    const at = Number(item && item.askedAt) || 0;
    if (at > since) upsert(item, "a" + at, at);
  }

  // Days older than a week, read once, a few per run, so the record starts as complete as it can be.
  if (!opts.light && log.back !== "done") {
    let older = null;
    try {
      const listed = await env.MEDIA.list({ prefix: "data/suggestions/", limit: 1000 });
      older = listed.objects.map((o) => (o.key.match(/suggestions\/(\d{4}-\d\d-\d\d)\.json$/) || [])[1])
        .filter((d) => d && d < dates[dates.length - 1] && (!sinceDay || d > sinceDay) && (!log.backTo || d < log.backTo))
        .sort().reverse();
    } catch (e) { console.error("scorer: could not list older days", e); }
    if (older) {                                  // if the listing failed, try again on the next run
      const batch = older.slice(0, BACKFILL_PER_RUN);
      const docs = await Promise.all(batch.map((d) => later(kit.loadDoc(env, `suggestions/${d}`, []))));
      if (docs.every(Array.isArray)) {            // one of them could not be read: the same days are tried again next time
        batch.forEach((d, n) => takeDay(d, docs[n]));
        if (batch.length) log.backTo = batch[batch.length - 1];
        if (older.length <= BACKFILL_PER_RUN) log.back = "done";
      }
    }
  }

  // The record of choices: it knows about quotes that have since left the lists (a skipped asked-for
  // quote is removed at once), and about choices made before this record began.
  const byKey = new Map();
  for (const r of log.rows) { if (!byKey.has(r.x)) byKey.set(r.x, []); byKey.get(r.x).push(r); }
  const from = Math.max(log.histAt || 0, since);
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || !h.text || !real(h.at) || !(h.at > from) || !["used", "rejected"].includes(h.action)) continue;
    const s = h.action === "used" ? 1 : 2, d = describe(h);
    if (touched.has(d.x)) continue;              // still on a list: the list itself is the truth
    const same = (byKey.get(d.x) || []).filter((r) => !dropped.has(r.i)).sort((a, b) => b.t - a.t)[0];
    if (same) { if (h.at > (same.u || 0)) { same.s = s; same.u = h.at; } continue; }
    const r = { i: "h" + d.x, g: "h" + d.x, t: h.at, s, u: h.at, ...d };
    log.rows.push(r); byId.set(r.i, r); byKey.set(d.x, [r]);
  }
  log.histAt = (Array.isArray(history) ? history : []).reduce((m, h) => (h && real(h.at) && h.at > m ? h.at : m), log.histAt || 0);

  // Posts made from a suggestion: a pick, even where the list never said "used". Every post is looked at on each
  // full run (a reel finished in Instagram is filed under the time she handed it over, so there is no "newest so far"
  // to go by); the mark "p" on the row keeps a post from being counted twice, and keeps the pick from being undone.
  if (posts) {
    for (const p of Array.isArray(posts) ? posts : []) {
      if (!p || !p.suggestionId || !p.quote || !real(p.created) || !(p.created > since) || !["published", "processing"].includes(p.state)) continue;
      const r = byId.get(p.suggestionId);
      if (r) { if (!r.p) { r.p = 1; if (r.s === 0) { r.s = 1; r.u = now; } } continue; }
      if (p.created <= horizon) continue;
      const d = describe(p);
      if ((byKey.get(d.x) || []).some((x) => !dropped.has(x.i))) continue;
      const row = { i: p.suggestionId, g: "p" + p.suggestionId, t: p.created, s: 1, u: p.created, p: 1, ...d };
      log.rows.push(row); byId.set(row.i, row); byKey.set(d.x, [row]);
    }
  }
  if (dropped.size) log.rows = log.rows.filter((r) => !dropped.has(r.i));

  foldOld(log, now, today);
  const res = learn(log, now, today);
  const { state, ev, back } = decide(prev, res, now);
  const feat = {};
  for (const [name] of FEATURES) {
    feat[name] = {};
    for (const v in res.counts.f[name]) {
      const [p, n] = res.counts.f[name][v];
      if (p + n >= FAINT && v !== "__proto__") feat[name][v] = [round3(p), round3(n)];
    }
  }
  const model = {
    v: 1, at: now, seen: history ? lastAt(history) : (prev && prev.seen) || 0, state, since: prev && prev.state === state ? prev.since || now : now, back,
    picks: res.picks, passes: res.passes, base: [round3(res.counts.P), round3(res.counts.N)], feat,
    eval: { days: ev.days, mean: round3(ev.mean), z: round3(ev.z), recent: round3(ev.recent) },
    aud: posts ? audience(posts) : (prev && prev.aud) || null,
    lately: lately(res.counts),
  };
  // A last look before saving: if she tapped "Forget everything" while this was being worked out, none of it is kept.
  if ((await forgottenAt(env, kit)) > since) return { v: 1, state: "learning", picks: 0, passes: 0 };
  await Promise.all([kit.saveDoc(env, "scorer/log", log), kit.saveDoc(env, "scorer/model", model)]);
  return model;
}

export const open = {};

export const routes = {
  // GET /api/scorer: where the scorer stands, in one line for the Nishiii section.
  scorer: async (request, env, parts, kit) => {
    if (request.method !== "GET" || parts.length !== 1) return kit.fail(404, "Not found.");
    return kit.json(statusOf(await upToDate(env, kit)));
  },
};

// The model as it stands, counted again first when it is old or her record of choices has changed since.
// Used by GET /api/scorer and by the engine's status (server/engine.js).
export async function upToDate(env, kit) {
  let model = null;
  try {
    const [stored, history] = await Promise.all([mustLoad(env, kit, "scorer/model"), kit.loadDoc(env, "history", []).catch(() => null)]);
    model = usable(stored) ? stored : null;
    // Gather and count again first if there is no status yet, if it is a while old, or if the record of her
    // choices is not the one it was built from: a newer choice, or the record erased ("Forget everything").
    const stale = !model || Date.now() - model.at > REFRESH_MS || (history !== null && lastAt(history) !== (model.seen || 0));
    if (stale) model = await refresh(env, kit, { light: true, history: history || undefined, model });
  } catch (e) {
    if (!model || !current(model)) throw e;       // nothing stored, or only something long out of date: the line is left out
    console.error("scorer: could not count again; showing the stored status", e);
  }
  return model;
}

// Four times a day: gather what she chose, rebuild the counts, test them, and set the status.
export const jobs = [{ name: "scorer", everyHours: 6, run: (env, kit) => refresh(env, kit) }];
