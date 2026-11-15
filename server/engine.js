/* The engine: one place that gathers quote candidates from every source and scores them on every signal the app
   holds, so that each suggestion comes with a short, true reason.

   This file is one of the app's add-on sections (see SECTIONS in worker.js): a route GET /api/engine (where it
   stands, for the Nishiii section and Insights) and four timed jobs that fill the pool ahead of time.

   Sources (each candidate carries "src"):
     own       her own lines from the Library
     found     real lines found on the web for her books, films and series (kept on the work by findlines.js)
     discover  real lines found by web search beyond her list, for the themes, authors and works her signals
               point to, and for recent works close to them (kept in data/engine/bank.json)
     echo      the real, attributed quote behind lines read off the pages she follows and the reels she shared
               (never another page's own writing: only lines with a nameable author or work)
     memory    Nishiii (Claude) from memory, guided by her taste profile (worker.js asks)

   Score = the sum over parts of weight x evidence x value. Each value is worked out from stored signals and is
   about -1 to 1 (an "avoid" can reach -2); "evidence" is n / (n + K) for the amount of evidence n behind that
   part, so a part with little behind it moves little, and every part works from the first day.
     picks     her own picks and skips (the counts in scorer.js), self-tested; resting if clearly worse than chance
     taste     what she said and what Nishiii learnt: loves, avoids and her notes; an avoid is a strong negative
     own       likeness to her own lines (theme, tone, length) and to what she asks for when rewording
     pages     what she saved from other pages and what does well on them, relative to each account's usual
     audience  how her own posts did (saves and shares count most; per person reached; small groups shrunk)
     trust     word for word on a page, two sites agreeing, the book's own text; unchecked is lower
     fresh     not like what she has had in the last days
   Nothing personal is ever sent to Gemini or OpenAI: only words from the shared vocabulary (tags.js), titles and
   authors, or the words of a public quote. */

import * as tags from "./tags.js";
import * as scorer from "./scorer.js";
import * as findlines from "./findlines.js";

const DAY = 24 * 3600 * 1000;
// id, starting weight, K: the evidence at which the part counts half its weight (0: always full weight).
export const PARTS = [["picks", 1.0, 40], ["taste", 1.0, 2], ["own", 0.6, 5], ["pages", 0.8, 6], ["audience", 0.9, 10], ["trust", 0.5, 0], ["fresh", 0.4, 0]];
const PART_NAME = { picks: "your picks", taste: "what you told Nishiii", own: "your own lines", pages: "pages you follow", audience: "how your posts did", trust: "how sure the wording is", fresh: "variety" };
const REASON_MIN = 0.08;                         // a part must add at least this much to be named as a reason
const BURIED = -1.4;                             // a taste value this low (an avoid) keeps a line out unless nothing else is left
const CAP = { theme: 2, author: 2, src: 2, own: 1 };
const POOL = { own: 4, found: 14, discover: 10, echo: 6 };
const BANK_MAX = 300, ASKED_MAX = 200, TAGS_MAX = 2500;
export const A_DAY = { claude: 8, gemini: 4, openai: 2, found: 4 };   // the engine's own share of each day's limits
const HALF_LIFE_PAGES = 90 * DAY;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x) => Math.round(x * 1000) / 1000;
const low = (s, n = 80) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, n);
const cap1 = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const short = (s, n = 42) => { const t = String(s || "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, ""); if (t.length <= n) return t; const cut = t.slice(0, n); return cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : n) + "…"; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const median = (list) => { if (!list.length) return 0; const s = list.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const KIND_WORDS = { book: "books", film: "films", series: "series", classic: "well-known voices" };
const surname = (a) => { const w = low(a).split(/[^a-z]+/).filter((x) => x.length >= 3); return w.length ? w[w.length - 1] : ""; };
const keyOf = (t) => scorer.keyOf(t);

export const emptyBank = () => ({ v: 1, lines: [], asked: {}, tried: {}, day: "", used: {} });
const soundBank = (b) => (b && b.v === 1 && Array.isArray(b.lines) ? { ...emptyBank(), ...b, asked: b.asked || {}, tried: b.tried || {}, used: b.used || {} } : emptyBank());
const soundTags = (t) => (t && t.v === 1 && t.items && typeof t.items === "object" ? t : { v: 1, items: {} });
function today(bank, kit) { const d = kit.todayIST(); if (bank.day !== d) { bank.day = d; bank.used = {}; } return bank; }

// ---------------------------------------------------------------- the facts about one candidate
function factsOf(item, tagsDoc) {
  const text = item.text != null ? item.text : item.quote;
  const stored = tagsDoc && (!item.theme || !item.tone) ? tagsDoc.items[keyOf(text)] : null;
  const src = item.source;
  const kind = low(src && typeof src === "object" ? src.type : src, 12);
  return {
    th: tags.theme(item.theme || (stored && stored.th) || ""), to: tags.tone(item.tone || (stored && stored.to) || ""),
    len: tags.lenOf(text), n: tags.wordsIn(text), a: low(item.author || item.by, 60), w: low(src && typeof src === "object" ? src.title : item.work, 80),
    k: kind, src: item.src || (kind === "own" ? "own" : item.found ? "found" : "memory"),
  };
}

// ---------------------------------------------------------------- what each part has learnt (built once per request)
function tasteOf(doc) {
  const loves = [], avoids = [];
  const take = (list, into, note) => { for (const p of list || []) { const t = tags.tagsIn(p); const named = low(p, 200); if (t.themes.length || t.tones.length || t.len || t.kinds.length || named) into.push({ p: String(p), t, named, note }); } };
  const prof = (doc && doc.profile) || {};
  take(prof.loves, loves, false); take(prof.voice, loves, false); take(prof.avoids, avoids, false);
  const neg = /\b(no|not|never|don'?t|avoid|less|stop|hate|without|fewer|skip)\b/i;
  for (const n of (doc && doc.notes) || []) take([n.text], neg.test(n.text) ? avoids : loves, true);
  const n = (prof.loves || []).length + (prof.avoids || []).length + (prof.voice || []).length + 2 * ((doc && doc.notes) || []).length;
  return { loves, avoids, n };
}
// Does a taste phrase fit this candidate? Every kind of thing the phrase names must fit ("full"); some fitting is "part".
function fit(ph, f) {
  const asks = [], t = ph.t;
  if (t.themes.length) asks.push(t.themes.includes(f.th));
  else if (f.th && t.words.includes(f.th)) asks.push(true);       // a theme outside the vocabulary, named in her words
  if (t.tones.length) asks.push(t.tones.includes(f.to));
  if (t.len) asks.push(t.len === f.len || (t.len === "short" && f.n <= 14));
  if (t.kinds.length) asks.push(t.kinds.includes(f.k));
  const sn = surname(f.a), names = !!sn && ` ${ph.named} `.includes(` ${sn} `) || (f.w.length >= 4 && ph.named.includes(f.w));
  if (names) asks.push(true);
  if (!asks.length) return "";
  return asks.every(Boolean) ? "full" : asks.some(Boolean) ? "part" : "";
}

function ownOf(lib, rewords, tagsDoc) {
  const themes = new Map(), tones = new Map(), lens = [];
  for (const q of lib.quotes || []) {
    const f = factsOf({ text: q.text, theme: q.theme, tone: q.tone }, tagsDoc);
    if (f.th) themes.set(f.th, (themes.get(f.th) || 0) + 1);
    if (f.to) tones.set(f.to, (tones.get(f.to) || 0) + 1);
    if (f.n) lens.push(f.n);
  }
  let shorter = 0, longer = 0;
  for (const r of Array.isArray(rewords) ? rewords.slice(-40) : []) {
    const asked = low(r && r.asked, 300);
    if (/\b(short|shorter|shorten|cut|trim|fewer words|less words|brief)\b/.test(asked)) shorter++;
    if (/\b(long|longer|expand|more words)\b/.test(asked)) longer++;
    const n = tags.wordsIn(r && r.after);
    if (n) lens.push(n);
  }
  const maxOf = (m) => Math.max(1, ...m.values());
  const target = (median(lens) || 0) * (shorter > longer ? 0.75 : longer > shorter ? 1.25 : 1);
  return { themes, tones, tMax: maxOf(themes), oMax: maxOf(tones), target, n: (lib.quotes || []).length + (Array.isArray(rewords) ? Math.min(40, rewords.length) : 0), shorter: shorter > longer };
}

// What she saved from other pages and how it did there: each reference post weighs by how far above its own
// account's usual numbers it did (a small account's hit counts more than a big account's ordinary post), and by how
// recent it is; a reel she shared herself counts more than a page she merely added.
function pagesOf(insp, tagsDoc, now) {
  const items = [];
  const engage = (t) => (Number(t.likes) || 0) + 3 * (Number(t.comments) || 0) + (Number(t.views) || 0) / 50;
  const fade = (at) => { const t = typeof at === "number" ? at : Date.parse(at || ""); return Number.isFinite(t) && t > 0 ? Math.pow(2, -Math.max(0, now - t) / HALF_LIFE_PAGES) : 0.7; };
  for (const i of Array.isArray(insp) ? insp : []) {
    if (!i) continue;
    const handle = low(i.handle, 30);
    if (i.kind === "account") {
      const top = (i.top || []).filter((t) => t && t.quote);
      const es = top.map(engage);
      const usual = es.length >= 3 ? median(es) : i.followers ? i.followers * 0.02 : 0;
      top.forEach((t, n) => {
        const rel = usual > 0 ? Math.log((1 + es[n]) / (1 + usual)) : 0;
        const v = clamp(0.25 + 0.75 * rel, 0, 1.5) * fade(t.at);
        items.push({ ...factsOf({ text: t.quote, author: t.author }, tagsDoc), v, handle, shared: false, rel });
      });
    } else if (i.quote) {
      items.push({ ...factsOf({ text: i.quote, author: i.author }, tagsDoc), v: 1.5 * fade(i.added), handle, shared: true, rel: 0 });
    }
  }
  const total = items.reduce((a, x) => a + x.v, 0);
  const by = (field) => { const m = new Map(); for (const x of items) if (x[field] && x.v > 0) { const e = m.get(x[field]) || { sum: 0, best: null }; e.sum += x.v; if (!e.best || x.v > e.best.v) e.best = x; m.set(x[field], e); } return m; };
  return { items, total, n: items.filter((x) => x.th || x.to).length, theme: by("th"), tone: by("to"), len: by("len"), author: by("a") };
}

// How her own posts did, per theme, tone, length, kind and author: saves and shares count three times a like,
// comments twice; everything per person reached; each group compared with her usual post; groups of under three
// posts say nothing, and small groups are shrunk towards "as usual".
function audienceOf(posts, tagsDoc) {
  const measured = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    const m = p && p.metrics;
    if (!p || p.state !== "published" || !m) continue;
    const reach = Number(m.reach != null ? m.reach : m.views) || 0;
    if (reach <= 0) continue;
    const y = (3 * (Number(m.saved) || 0) + 3 * (Number(m.shares) || 0) + 2 * (Number(m.comments) || 0) + (Number(m.likes) || 0)) / reach;
    measured.push({ f: factsOf({ text: p.quote, theme: p.theme, tone: p.tone, author: p.author, source: p.source }, tagsDoc), y });
  }
  const usual = median(measured.map((x) => x.y)) || 1e-4;
  const out = { n: measured.length };
  for (const [field, key] of [["theme", "th"], ["tone", "to"], ["len", "len"], ["kind", "k"], ["author", "a"]]) {
    const g = new Map();
    for (const x of measured) if (x.f[key]) g.set(x.f[key], [...(g.get(x.f[key]) || []), Math.log((x.y + 1e-4) / (usual + 1e-4))]);
    out[field] = new Map();
    for (const [v, list] of g) if (list.length >= 3) out[field].set(v, clamp((list.reduce((a, b) => a + b, 0) / list.length) * (list.length / (list.length + 3)), -1, 1));
  }
  return out;
}

function recentOf(history, day, posts, now) {
  const authors = new Map(), works = new Set(), posted = new Set(), seen14 = new Set();
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || !(now - h.at < 14 * DAY)) continue;
    seen14.add(tags.theme(h.theme));
    if (now - h.at < 7 * DAY && h.author) authors.set(low(h.author, 60), (authors.get(low(h.author, 60)) || 0) + 1);
  }
  for (const i of Array.isArray(day) ? day : []) { if (i && i.author) authors.set(low(i.author, 60), (authors.get(low(i.author, 60)) || 0) + 1); if (i) seen14.add(tags.theme(i.theme)); }
  for (const p of Array.isArray(posts) ? posts : []) {
    const at = Number(p && (p.published || p.created)) || 0;
    if (!p || now - at > 14 * DAY) continue;
    if (now - at < 5 * DAY) posted.add(tags.theme(p.theme));
    if (p.author) authors.set(low(p.author, 60), (authors.get(low(p.author, 60)) || 0) + 1);
    seen14.add(tags.theme(p.theme));
  }
  seen14.delete("");
  return { authors, works, posted, seen14 };
}

// Everything the parts need, worked out once from the stored signals.
export function build(sig, now = Date.now()) {
  const lib = sig.lib || {}, m = sig.scorerModel;
  const pick = scorer.pickScorer(m);
  const pickN = m ? (Number(m.picks) || 0) + (Number(m.passes) || 0) : 0;
  const state = m && m.state;
  let pickE = pickN / (pickN + 40);
  if (state === "live") pickE = Math.max(pickE, 0.8);
  if (scorer.worse(m && m.eval) || state === "resting") pickE *= 0.05;      // the safety net
  const taste = tasteOf(sig.tasteDoc), own = ownOf(lib, sig.rewords, sig.tagsDoc), pages = pagesOf(sig.insp, sig.tagsDoc, now);
  const aud = audienceOf(sig.posts, sig.tagsDoc), recent = recentOf(sig.history, sig.day, sig.posts, now);
  const ev = { picks: pickE, taste: taste.n / (taste.n + 2), own: own.n / (own.n + 5), pages: pages.n / (pages.n + 6), audience: aud.n / (aud.n + 10), trust: 1, fresh: 1 };
  return { pick, pickN, picks: m ? Number(m.picks) || 0 : 0, pickState: state || "", lately: (m && m.lately) || "", taste, own, pages, aud, recent, ev, tagsDoc: sig.tagsDoc };
}

// ---------------------------------------------------------------- the parts: each gives { x, why }
const PICK_SAYS = {
  theme: (v) => `You often pick lines about ${v}`, tone: (v) => `You often pick ${v} lines`,
  kind: (v) => `You often pick lines from ${KIND_WORDS[v] || v}`, len: (v) => `You often pick ${v === "medium" ? "medium-length" : v} lines`,
  voice: (v) => (v === "you" ? "You often pick lines that speak to you" : ""), sure: (v) => (v === "exact" ? "You often pick lines with exact wording" : ""),
};
const part = {
  picks(P, f, item) {
    if (!P.pick) return { x: 0 };
    const r = P.pick(item), x = Math.tanh(r.s / 2);
    let why = "";
    if (r.top && r.top[2] >= 0.2) {
      const [name, v] = r.top;
      why = name === "author" ? `You often pick ${item.author || cap1(v)}` : name === "work" ? `You often pick lines from ${(item.source && item.source.title) || v}` : (PICK_SAYS[name] || (() => ""))(v);
    }
    return { x, why };
  },
  taste(P, f) {
    let x = 0, why = "";
    for (const ph of P.taste.loves) { const k = fit(ph, f); if (k === "full") { x += ph.note ? 1.2 : 1; if (!why) why = ph.note ? `As you asked: ${short(ph.p)}` : `You like ${short(ph.p)}`; } else if (k === "part") x += 0.3; }
    for (const ph of P.taste.avoids) { const k = fit(ph, f); if (k === "full") x -= 2; else if (k === "part") x -= 0.6; }
    return { x: clamp(x, -2, 1.5), why: x > 0 ? why : "" };
  },
  own(P, f) {
    const o = P.own;
    if (!o.n) return { x: 0 };
    const th = f.th ? (o.themes.get(f.th) || 0) / o.tMax : 0, to = f.to ? (o.tones.get(f.to) || 0) / o.oMax : 0;
    const lenFit = o.target && f.n ? Math.exp(-(Math.log(f.n / o.target) ** 2) / 0.5) : 0;
    const x = clamp(0.6 * th + 0.2 * to + 0.4 * lenFit - 0.3, -0.5, 1);
    const why = th >= 0.5 ? `Like your own lines about ${f.th}` : lenFit >= 0.8 && o.shorter ? "As short as you like your lines" : lenFit >= 0.8 ? "The length of your own lines" : "";
    return { x, why: x > 0.2 ? why : "" };
  },
  pages(P, f) {
    const g = P.pages;
    if (!g.total) return { x: 0 };
    const at = (map, v) => (v && map.get(v)) || null;
    const T = at(g.theme, f.th), O = at(g.tone, f.to), L = at(g.len, f.len), A = at(g.author, f.a);
    const share = (e) => (e ? e.sum / (g.total + 3) : 0);
    const x = clamp(1.5 * share(T) + 0.8 * share(O) + 0.4 * share(L) + 1.0 * share(A), 0, 1);
    const best = [A, T].filter(Boolean).map((e) => e.best).sort((a, b) => b.v - a.v)[0];
    let why = "";
    if (best) why = best.shared ? "Like a reel you saved" : best.handle && best.rel >= 0.5 ? `Doing well on @${best.handle}` : best.handle ? `Like posts on @${best.handle}` : "";
    return { x, why };
  },
  audience(P, f) {
    const a = P.aud;
    if (!a.n) return { x: 0 };
    const terms = [["theme", f.th, 1], ["tone", f.to, 0.6], ["len", f.len, 0.4], ["kind", f.k, 0.5], ["author", f.a, 0.5]]
      .map(([field, v, w]) => [field, v, v && a[field].has(v) ? w * a[field].get(v) : 0]);
    const x = clamp(terms.reduce((s, t) => s + t[2], 0), -1, 1);
    const top = terms.slice().sort((p, q) => q[2] - p[2])[0];
    let why = "";
    if (top && top[2] >= 0.1) {
      const [field, v] = top;
      why = field === "theme" ? `Posts about ${v} do well for you` : field === "tone" ? `${cap1(v)} posts do well for you` : field === "len" ? `${cap1(v === "medium" ? "medium-length" : v)} posts do well for you`
        : field === "kind" ? `Lines from ${KIND_WORDS[v] || v} do well for you` : `Your posts of ${cap1(v)} do well`;
    }
    return { x, why };
  },
  trust(P, f, item) {
    if (item.fromText) return { x: 1, why: "From the book's own text" };
    if (f.src === "own") return { x: 0.5, why: "" };
    if (item.verify) return { x: -0.6, why: "" };
    const site = item.source && item.source.site;
    if ((item.found || f.src === "found") && site) return { x: 0.9, why: `Found word for word on ${site}` };
    if (f.src === "discover" || f.src === "echo") return { x: 0.9, why: "Two sites agree on the wording" };
    return { x: 0.3, why: "" };
  },
  fresh(P, f) {
    const r = P.recent;
    let x = f.th && r.seen14.size >= 3 && !r.seen14.has(f.th) ? 0.3 : 0;     // "new to you" means something only once she has had a few
    if (f.a && r.authors.has(f.a)) x -= Math.min(1, 0.5 * r.authors.get(f.a));
    if (f.th && r.posted.has(f.th)) x -= 0.3;
    return { x: clamp(x, -1, 0.3), why: x >= 0.3 ? "Something you haven't had lately" : "" };
  },
};

// One candidate's score, its parts and its reason (the two parts that add the most, in her words).
export function score(P, item) {
  const f = factsOf(item, P.tagsDoc);
  let s = 0;
  const parts = {}, said = [];
  for (const [id, weight] of PARTS) {
    const { x, why } = part[id](P, f, item);
    const c = weight * P.ev[id] * x;
    parts[id] = round(c);
    s += c;
    if (why && c >= REASON_MIN) said.push([c, why]);
  }
  said.sort((a, b) => b[0] - a[0]);
  return { s, parts, why: said.slice(0, 2).map((x) => x[1]).join(" · "), f };
}

// The best "want" of a pool: best first, never more than two on one theme, by one author or from one source, at
// most one of her own lines (and one of hers whenever there is one, as always); a line her avoids bury only when
// nothing else is left; one wildcard (the best line on a theme none of the others has). Handed back in a random
// order, so her habit of taking the first card can't flatter the engine.
export function choose(P, pool, want, already = [], { wild = true, mix = true } = {}) {
  if (want < 1 || !pool.length) return [];
  const scored = pool.map((item, i) => ({ item, i, ...score(P, item) }));
  const byScore = scored.slice().sort((a, b) => b.s - a.s || a.i - b.i);
  const count = { theme: new Map(), author: new Map(), src: new Map() };
  const bump = (map, v) => v && map.set(v, (map.get(v) || 0) + 1);
  const note = (f) => { bump(count.theme, f.th); bump(count.author, f.a); bump(count.src, f.src); };
  for (const a of already) note(factsOf(a, P.tagsDoc));
  // level 0: every cap; level 1: any number from one source (when one source is all there is), but still at most
  // two per theme and per author; level 2: no caps (a batch from a single book, say).
  const fits = (e, level = 0) => level >= 2 || ((!e.f.th || (count.theme.get(e.f.th) || 0) < CAP.theme) && (!e.f.a || (count.author.get(e.f.a) || 0) < CAP.author)
    && (level >= 1 || (count.src.get(e.f.src) || 0) < (e.f.src === "own" ? CAP.own : CAP.src)));
  const buried = (e) => e.parts.taste <= BURIED * P.ev.taste * 0.999 && e.parts.taste < 0;
  const chosen = [];
  const take = (e) => { chosen.push(e); note(e.f); };
  const ownFirst = mix && !already.some((a) => factsOf(a, P.tagsDoc).src === "own") ? byScore.find((e) => e.f.src === "own" && !buried(e)) : null;
  if (ownFirst) take(ownFirst);
  const room = wild && want >= 3 ? want - 1 : want;
  for (const level of [0, 1]) for (const e of byScore) { if (chosen.length >= room) break; if (!chosen.includes(e) && !buried(e) && fits(e, level)) take(e); }
  let w = null;
  if (wild && want >= 3) {
    const themes = new Set(chosen.map((e) => e.f.th));
    for (const level of [0, 1]) {
      w = w || byScore.find((e) => !chosen.includes(e) && !buried(e) && e.parts.trust >= 0 && e.f.th && !themes.has(e.f.th) && fits(e, level)) || null;
    }
    w = w || byScore.find((e) => !chosen.includes(e) && !buried(e) && fits(e, 1)) || null;
    if (w) take(w);
  }
  for (const level of [1, 2]) for (const e of byScore) { if (chosen.length >= want) break; if (!chosen.includes(e) && !buried(e) && fits(e, level)) take(e); }
  for (const e of byScore) { if (chosen.length >= want) break; if (!chosen.includes(e)) take(e); }
  const out = chosen.map((e) => ({ ...e.item, src: e.f.src, why: e.why, score: round(e.s), ...(e === w ? { wild: true } : {}) }));
  return mix ? shuffle(out) : out;
}

// ---------------------------------------------------------------- the pool
// A banked line as a suggestion. "elsewhere": its work is not one of hers, so the card doesn't say "from your book list".
function bankLine(l, mine = new Set()) {
  const type = ["book", "film", "series"].includes(l.type) && l.work ? l.type : "classic";
  return { text: l.text, author: l.by || "", source: { type, title: l.work || "", url: l.url || undefined, site: l.site || undefined, ...(type !== "classic" && !mine.has(low(l.work, 120)) ? { elsewhere: true } : {}) },
    theme: l.th || "", tone: l.to || "", verify: !!l.verify, src: l.from };
}
const titlesOf = (lib) => new Set([...((lib && lib.books) || []), ...((lib && lib.screen) || [])].map((w) => low(w.title, 120)));
// Candidates from every source but memory, each marked with where it came from. Adds what it takes to "seen".
export function gather(kit, sig, seen, max = POOL) {
  const out = [];
  const add = (list, n) => { let k = 0; for (const q of list) { if (k >= n) break; const t = kit.norm(q.text); if (!q.text || seen.has(t)) continue; seen.add(t); out.push(q); k++; } };
  add(shuffle((sig.lib.quotes || []).map((q) => ({ text: q.text, author: q.author || "", source: { type: "own", title: q.from || "" }, theme: "", tone: "", verify: false, src: "own" }))), max.own);
  add(findlines.keptPool(kit, sig.lib, seen, max.found * 2).map((q) => ({ ...q, src: "found" })), max.found);
  const bank = sig.bank || emptyBank(), mine = titlesOf(sig.lib);
  add(shuffle(bank.lines.filter((l) => l.from === "discover")).map((l) => bankLine(l, mine)), max.discover);
  add(shuffle(bank.lines.filter((l) => l.from === "echo" && (l.work || l.by))).map((l) => bankLine(l, mine)), max.echo);
  return out;
}
// Bank lines on a subject she asked about (its words, or the theme they name).
export function onSubject(kit, sig, about, seen, n = 6) {
  const words = kit.norm(about).split(" ").filter((w) => w.length > 3), th = tags.theme(about);
  const bank = sig.bank || emptyBank();
  const hits = bank.lines.filter((l) => !seen.has(kit.norm(l.text)) && (l.th === th || words.some((w) => kit.norm(l.text).includes(w))));
  const mine = titlesOf(sig.lib), out = shuffle(hits).slice(0, n).map((l) => bankLine(l, mine));
  for (const q of out) seen.add(kit.norm(q.text));
  return out;
}

// Loads whatever the caller has not already loaded, side by side, and returns the engine for this request.
export async function start(env, kit, have = {}) {
  const want = { lib: ["library", { books: [], screen: [], quotes: [] }], history: ["history", []], day: [`suggestions/${kit.todayIST()}`, []], tasteDoc: ["taste", null],
    insp: ["inspirations", []], posts: ["posts", []], rewords: ["rewords", []], scorerModel: ["scorer/model", null], tagsDoc: ["engine/tags", null], bank: ["engine/bank", null] };
  const names = Object.keys(want).filter((k) => have[k] === undefined);
  const got = await Promise.all(names.map((k) => kit.loadDoc(env, want[k][0], want[k][1]).catch(() => want[k][1])));
  const sig = { ...have };
  names.forEach((k, n) => { sig[k] = got[n]; });
  sig.tagsDoc = soundTags(sig.tagsDoc); sig.bank = soundBank(sig.bank);
  const P = build(sig);
  return {
    sig, P,
    gather: (seen, max) => gather(kit, sig, seen, max),
    onSubject: (about, seen, n) => onSubject(kit, sig, about, seen, n),
    choose: (pool, want, already, opts) => choose(P, pool, want, already, opts),
    // A reason for items chosen some other way (her own lines asked for by name, say).
    explain: (items) => items.map((i) => (i.why !== undefined ? i : { ...i, why: score(P, i).why, src: i.src || factsOf(i, P.tagsDoc).src })),
  };
}

// ---------------------------------------------------------------- hashtags and background words that did well for her
// The hashtags in her own captions (or the words she searched for backgrounds with) that came with more saves, shares,
// comments and likes per person reached than her usual post: real, and in use (she used them), best first. At least
// two posts behind each; shrunk when few.
const hashtagsOf = (p) => [...new Set(String(p.caption || "").toLowerCase().match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, 30);
const bgWordsOf = (p) => (p.made && p.made.bgFrom === "search" && p.made.bgWords ? [low(p.made.bgWords, 60)] : []);
export const hashtagsThatWork = (posts, max = 6) => thatWork(posts, hashtagsOf, max);
export const bgWordsThatWork = (posts, max = 4) => thatWork(posts, bgWordsOf, max);
function thatWork(posts, namesOf, max) {
  const rows = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    const m = p && p.metrics, reach = m ? Number(m.reach != null ? m.reach : m.views) || 0 : 0;
    if (!p || p.state !== "published" || reach <= 0) continue;
    const y = (3 * (Number(m.saved) || 0) + 3 * (Number(m.shares) || 0) + 2 * (Number(m.comments) || 0) + (Number(m.likes) || 0)) / reach;
    rows.push({ y, tags: namesOf(p) });
  }
  const usual = median(rows.map((r) => r.y)) || 1e-4, by = new Map();
  for (const r of rows) for (const t of r.tags) by.set(t, [...(by.get(t) || []), Math.log((r.y + 1e-4) / (usual + 1e-4))]);
  return [...by.entries()].filter(([, l]) => l.length >= 2).map(([t, l]) => [t, (l.reduce((a, b) => a + b, 0) / l.length) * (l.length / (l.length + 2))])
    .filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
}

// ---------------------------------------------------------------- where it stands, in her words
// What does well, in a few plain phrases: her own posts' groups that did clearly better per person reached (saves
// and shares counting most), then the theme doing best on the pages she follows. For Insights, the advice and the
// weekly note, so they speak from the same numbers as the suggestions.
export function works(posts, insp, tagsDoc, now = Date.now()) {
  const t = soundTags(tagsDoc), aud = audienceOf(posts, t), pages = pagesOf(insp, t, now);
  const say = { theme: (v) => `posts about ${v} do well for you`, tone: (v) => `${v} posts do well for you`,
    len: (v) => `${v === "medium" ? "medium-length" : v} posts do well for you`, kind: (v) => `lines from ${KIND_WORDS[v] || v} do well for you` };
  const all = [];
  for (const field of Object.keys(say)) for (const [v, lift] of aud[field] || []) if (lift >= 0.1) all.push([lift, say[field](v)]);
  const out = all.sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => x[1]);
  const best = [...pages.theme.entries()].filter(([, e]) => e.best && e.best.rel >= 0.5 && e.best.handle).sort((a, b) => b[1].sum - a[1].sum)[0];
  if (best) out.push(`${best[0]} does well on @${best[1].best.handle}`);
  return { phrases: out, posts: aud.n };
}
export function status(P, sig) {
  const bank = sig.bank || emptyBank();
  const found = findlines.keptPool({ norm: (t) => low(t, 400) }, sig.lib || {}, new Set(), 10000).length;
  const sources = { own: ((sig.lib || {}).quotes || []).length, found, discover: bank.lines.filter((l) => l.from === "discover").length, echo: bank.lines.filter((l) => l.from === "echo").length };
  const from = [];
  if (P.picks) from.push(`${P.picks} pick${P.picks === 1 ? "" : "s"}`);
  if (P.taste.n) from.push("what you told Nishiii");
  if (P.pages.n) from.push(`${P.pages.n} post${P.pages.n === 1 ? "" : "s"} from pages you follow`);
  if (P.aud.n) from.push(`${P.aud.n} of your posts`);
  const learnt = [];
  if (P.lately && P.ev.picks > 0.2) learnt.push(`you pick ${P.lately}`);
  const w = works(sig.posts, sig.insp, sig.tagsDoc);
  if (w.phrases[0] && P.aud.n) learnt.push(w.phrases[0]);
  const pg = [...P.pages.theme.entries()].sort((a, b) => b[1].sum - a[1].sum)[0];
  if (pg && P.pages.n >= 3) learnt.push(`${pg[0]} does well on pages you follow`);
  if (!learnt.length && P.taste.loves[0]) learnt.push(`you like ${short(P.taste.loves[0].p, 50)}`);
  const sure = P.pickState === "resting" ? "Your picks are set aside for now: they didn't predict well." : P.pickState === "live" ? "Fairly sure now." : P.picks ? "Still early." : "";     // sure once its picks are proven on her own days
  const line = [from.length ? `Learning from ${from.slice(0, -1).join(", ")}${from.length > 1 ? " and " : ""}${from[from.length - 1]}.` : "Learning from your first picks.",
    learnt.length ? `So far: ${learnt.slice(0, 2).join("; ")}.` : "", sure].filter(Boolean).join(" ");
  const parts = PARTS.map(([id, w]) => ({ id, name: PART_NAME[id], weight: round(w * P.ev[id]) }));
  return { line, learnt, works: w.phrases, bgWords: bgWordsThatWork(sig.posts), sources, parts, picks: P.picks, state: P.pickState || "learning" };
}

// ---------------------------------------------------------------- timed jobs (one per tick; each well under 20 outside calls)
const TAG_SYSTEM = `You tag quotes for a quotes page. For each numbered line, give its theme and its tone.
Reply with a JSON array only: [{"n": 1, "theme": "one word", "tone": "one word"}]
Themes are single plain words such as love, loss, hope, self, growth, healing, courage, fear, time, change, purpose, mind, peace, solitude, friendship, family, nature, sea, life, death, freedom, kindness, longing, memory, faith, joy, strength, wisdom, patience, beauty.
Tones are single plain words such as calm, warm, wistful, sad, hopeful, firm, playful, dark, plain, romantic.`;

async function tagJob(env, kit) {
  const [lib, insp, bank0, tags0, posts] = await Promise.all([kit.loadDoc(env, "library", null), kit.loadDoc(env, "inspirations", []), kit.loadDoc(env, "engine/bank", null),
    kit.loadDoc(env, "engine/tags", null), kit.loadDoc(env, "posts", [])]);
  const bank = today(soundBank(bank0), kit), tagsDoc = soundTags(tags0);
  if ((bank.used.claude || 0) >= A_DAY.claude || !env.ANTHROPIC_API_KEY) return { tagged: 0 };
  const texts = [];
  const want = (t) => { const k = keyOf(t); if (t && !tagsDoc.items[k] && !texts.some((x) => x.k === k)) texts.push({ k, t: String(t).slice(0, 400) }); };
  for (const q of (lib && lib.quotes) || []) if (!q.theme) want(q.text);
  for (const i of Array.isArray(insp) ? insp : []) { if (i.quote) want(i.quote); for (const t of i.top || []) if (t.quote) want(t.quote); }
  for (const l of bank.lines) if (!l.th) want(l.text);
  for (const p of Array.isArray(posts) ? posts : []) if (p && p.quote && !p.theme) want(p.quote);
  const batch = texts.slice(0, 40);
  if (!batch.length) return { tagged: 0 };
  bank.used.claude = (bank.used.claude || 0) + 1;
  await kit.saveDoc(env, "engine/bank", bank);
  const answer = kit.parseJson(await kit.claude(env, { system: TAG_SYSTEM, maxTokens: 1800, messages: [{ role: "user", content: batch.map((b, n) => `${n + 1}. ${b.t.replace(/\s+/g, " ")}`).join("\n") }] }));
  const now = Date.now();
  let tagged = 0;
  for (const a of Array.isArray(answer) ? answer : []) {
    const b = batch[(Number(a && a.n) || 0) - 1];
    if (!b) continue;
    tagsDoc.items[b.k] = { th: tags.theme(kit.oneLine(a.theme, 30)), to: tags.tone(kit.oneLine(a.tone, 20)), at: now };
    tagged++;
  }
  const keys = Object.keys(tagsDoc.items);
  if (keys.length > TAGS_MAX) keys.sort((x, y) => tagsDoc.items[x].at - tagsDoc.items[y].at).slice(0, keys.length - TAGS_MAX).forEach((k) => delete tagsDoc.items[k]);
  const fresh = soundBank(await kit.loadDoc(env, "engine/bank", null));     // read again: another run may have added lines
  for (const l of fresh.lines) if (!l.th && tagsDoc.items[keyOf(l.text)]) { l.th = tagsDoc.items[keyOf(l.text)].th; l.to = tagsDoc.items[keyOf(l.text)].to; }
  await Promise.all([kit.saveDoc(env, "engine/tags", tagsDoc), kit.saveDoc(env, "engine/bank", { ...fresh, day: bank.day, used: { ...fresh.used, claude: bank.used.claude } })]);
  return { tagged };
}

async function foundJob(env, kit) {
  const [lib, bank0] = await Promise.all([kit.loadDoc(env, "library", null), kit.loadDoc(env, "engine/bank", null)]);
  const bank = today(soundBank(bank0), kit);
  if (!lib || (bank.used.found || 0) >= A_DAY.found) return null;
  const works = [...(lib.books || []), ...(lib.screen || [])];
  if (!works.length) return null;
  bank.used.found = (bank.used.found || 0) + 1;
  await kit.saveDoc(env, "engine/bank", bank);
  return findlines.refreshOne(env, kit, lib, { budget: 13 });
}

// What to search the web for next: the themes her signals point to (vocabulary words only), the authors and works
// in her Library and of the lines she picked, and recent works on her themes. Nothing else about her.
export function questions(sig, year) {
  const score = new Map();
  const bump = (t, w) => { if (tags.THEME_LIST.includes(t)) score.set(t, (score.get(t) || 0) + w); };
  for (const h of sig.history || []) bump(tags.theme(h.theme), h.action === "used" ? 2 : -1);
  const t = tasteOf(sig.tasteDoc);
  for (const ph of t.loves) for (const th of ph.t.themes) bump(th, 3);
  for (const ph of t.avoids) for (const th of ph.t.themes) bump(th, -10);
  for (const q of (sig.lib && sig.lib.quotes) || []) { const k = sig.tagsDoc && sig.tagsDoc.items[keyOf(q.text)]; if (k) bump(k.th, 1); }
  const themes = [...score.entries()].filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  if (!themes.length) themes.push("hope", "love", "self");
  const safe = (s) => String(s || "").replace(/["\n\r]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  const authors = [...new Set([...((sig.lib && sig.lib.books) || []).map((b) => safe(b.author)), ...(sig.history || []).filter((h) => h.action === "used" && h.source !== "own").map((h) => safe(h.author))].filter((a) => a && /^[\p{L} .'-]+$/u.test(a)))];
  const works = [...((sig.lib && sig.lib.books) || []), ...((sig.lib && sig.lib.screen) || [])].map((w) => ({ title: safe(w.title), kind: w.kind || "book" })).filter((w) => w.title);
  const ask = (q, text) => ({ q, text: `${text}
Reply with a JSON array only, no other text, of up to 8 items:
[{"text": "the line, word for word as the page has it", "by": "who wrote or says it", "work": "the book, film or series it is from, or an empty string", "type": "book, film, series or classic", "page": "the address of the page it is on", "also": "the address of a second page on another site that gives the same wording, or an empty string"}]
Keep a line only when a page you read gives its wording and who it is by. Never fill gaps from memory and never guess. One to three sentences each, under 45 words. If you find nothing real, reply with [].` });
  const out = [];
  for (let i = 0; i < Math.max(themes.length, authors.length, works.length); i++) {
    if (themes[i]) out.push(ask("theme:" + themes[i], `Search the web for real, well-known quotes about ${themes[i]} from books, films, TV series or well-known people.`));
    if (authors[i]) out.push(ask("author:" + low(authors[i]), `Search the web for real quotes by ${authors[i]}.`));
    if (works[i]) out.push(ask("like:" + low(works[i].title), `Search the web for real quotes from ${works[i].kind === "book" ? "books" : works[i].kind === "film" ? "films" : "TV series"} similar to "${works[i].title}" (not from "${works[i].title}" itself).`));
    if (themes[i] && i < 3) out.push(ask(`new:${year}:` + themes[i], `Search the web for real quotes about ${themes[i]} from books, films or TV series that came out in ${year - 1} or ${year}.`));
  }
  return out;
}

async function discoverJob(env, kit) {
  const [lib, history, tasteDoc, bank0, tags0] = await Promise.all([kit.loadDoc(env, "library", { books: [], screen: [], quotes: [] }), kit.loadDoc(env, "history", []),
    kit.loadDoc(env, "taste", null), kit.loadDoc(env, "engine/bank", null), kit.loadDoc(env, "engine/tags", null)]);
  const bank = today(soundBank(bank0), kit);
  const allow = { gemini: env.GEMINI_API_KEY ? A_DAY.gemini : 0, openai: env.OPENAI_API_KEY ? A_DAY.openai : 0 };
  if ((bank.used.gemini || 0) >= allow.gemini && (bank.used.openai || 0) >= allow.openai) return null;
  const now = Date.now();
  const next = questions({ lib, history, tasteDoc, tagsDoc: soundTags(tags0) }, new Date(now).getUTCFullYear()).find((x) => !(now - (bank.asked[x.q] || 0) < 30 * DAY));
  if (!next) return null;
  bank.asked[next.q] = now;
  const have = new Set([...bank.lines.map((l) => kit.norm(l.text)), ...history.map((h) => kit.norm(h.text))]);
  const used = { gemini: bank.used.gemini || 0, openai: bank.used.openai || 0 };
  const got = await findlines.searchWeb(env, kit, next.text, 8, have, { allow, used });
  const th = next.q.startsWith("theme:") || next.q.startsWith("new:") ? next.q.split(":").pop() : "";
  const lines = got.lines.filter((l) => l.by || l.work).map((l) => ({ text: l.text, by: l.by, work: l.work || "", type: l.type || "classic", url: l.url, site: l.site, verify: l.verify, th, to: "", from: "discover", q: next.q, at: now }));
  addLines(bank, lines);
  bank.used.gemini = used.gemini; bank.used.openai = used.openai;
  await kit.saveDoc(env, "engine/bank", bank);
  return { q: next.q, added: lines.length };
}
function addLines(bank, lines) {
  const known = new Set(bank.lines.map((l) => keyOf(l.text)));
  for (const l of lines) if (!known.has(keyOf(l.text))) { bank.lines.push(l); known.add(keyOf(l.text)); }
  if (bank.lines.length > BANK_MAX) bank.lines = bank.lines.slice(-BANK_MAX);
  const asked = Object.entries(bank.asked);
  if (asked.length > ASKED_MAX) bank.asked = Object.fromEntries(asked.sort((a, b) => b[1] - a[1]).slice(0, ASKED_MAX));
  const tried = Object.entries(bank.tried);
  if (tried.length > 600) bank.tried = Object.fromEntries(tried.sort((a, b) => b[1] - a[1]).slice(0, 600));
}

const ECHO_SYSTEM = `You identify quotes. Each numbered line was read off a post on another Instagram quotes page.
For each line, say whether it is a real, published quote by a nameable person or from a nameable book, film or series (it may be slightly reworded or shortened on the post).
Reply with a JSON array only: [{"n": 1, "known": true or false, "text": "the original wording, exactly as published", "author": "who wrote or said it", "work": "the book, film or series, or an empty string", "type": "book, film, series or classic"}]
- "known" is false when you do not recognise the line for certain, when it seems to be the page's own writing, or when it is commonly misattributed and the real source is unknown. Never guess an author.
- Never invent wording. If you are not sure of the exact original wording, known is false.`;

async function echoJob(env, kit) {
  const [insp, bank0] = await Promise.all([kit.loadDoc(env, "inspirations", []), kit.loadDoc(env, "engine/bank", null)]);
  const bank = today(soundBank(bank0), kit);
  if ((bank.used.claude || 0) >= A_DAY.claude || !env.ANTHROPIC_API_KEY) return null;
  const lines = [];
  const push = (text, handle, shared) => { const k = keyOf(text); if (text && !bank.tried[k] && !lines.some((x) => x.k === k)) lines.push({ k, text: String(text).slice(0, 400), handle: low(handle, 30), shared }); };
  for (const i of Array.isArray(insp) ? insp : []) if (i && i.kind !== "account") push(i.quote, i.handle, true);      // reels she shared herself first
  for (const i of Array.isArray(insp) ? insp : []) if (i && i.kind === "account") for (const t of i.top || []) push(t.quote, i.handle, false);
  const batch = lines.slice(0, 12);
  if (!batch.length) return null;
  bank.used.claude = (bank.used.claude || 0) + 1;
  const now = Date.now();
  for (const b of batch) bank.tried[b.k] = now;
  await kit.saveDoc(env, "engine/bank", bank);
  const answer = kit.parseJson(await kit.claude(env, { system: ECHO_SYSTEM, maxTokens: 2000, messages: [{ role: "user", content: batch.map((b, n) => `${n + 1}. ${b.text.replace(/\s+/g, " ")}`).join("\n") }] }));
  const out = [];
  for (const a of Array.isArray(answer) ? answer : []) {
    const b = batch[(Number(a && a.n) || 0) - 1];
    const by = kit.oneLine(a && a.author, 80), text = kit.flatten(a && a.text).replace(/^["“”]+|["“”]+$/g, "");
    if (!b || !a.known || !by || !text || text.length < 15 || /unknown|anonymous|unattributed/i.test(by)) continue;
    if (b.handle && low(by).replace(/[^a-z0-9._]/g, "") === b.handle.replace(/[^a-z0-9._]/g, "")) continue;     // the page itself: its own writing
    out.push({ text, by, work: kit.oneLine(a.work, 120), type: ["book", "film", "series"].includes(a.type) ? a.type : "classic", url: "", site: "", verify: true, th: "", to: "",
      from: "echo", of: b.handle, shared: b.shared, at: now });
  }
  // One of them checked on the web: the exact wording as a page gives it, and sure when two sites agree.
  const allow = { gemini: env.GEMINI_API_KEY ? A_DAY.gemini : 0, openai: env.OPENAI_API_KEY ? A_DAY.openai : 0 };
  const used = { gemini: bank.used.gemini || 0, openai: bank.used.openai || 0 };
  const first = out[0];
  if (first && (used.gemini < allow.gemini || used.openai < allow.openai)) {
    const prompt = `Search the web for the quote "${first.text.replace(/"/g, "")}" by ${first.by.replace(/"/g, "")}. Find pages that give its exact wording and who it is by.
Reply with a JSON array only, no other text: [{"text": "the line, word for word as the page has it", "by": "who wrote or said it", "work": "the book, film or series, or an empty string", "type": "book, film, series or classic", "page": "the address of the page", "also": "the address of a second page on another site with the same wording, or an empty string"}]
If no page you read gives this line, reply with [].`;
    const got = await findlines.searchWeb(env, kit, prompt, 1, new Set(), { allow, used });
    const same = got.lines.find((l) => kit.norm(l.text).includes(kit.norm(first.text).slice(0, 40)) || kit.norm(first.text).includes(kit.norm(l.text)));
    if (same) Object.assign(first, { text: same.text, url: same.url, site: same.site, verify: same.verify, checked: true, work: first.work || same.work || "" });
    bank.used.gemini = used.gemini; bank.used.openai = used.openai;
  }
  addLines(bank, out);
  await kit.saveDoc(env, "engine/bank", bank);
  return { read: batch.length, added: out.length };
}

// "Forget everything": what the engine keeps goes too.
export async function forget(env) {
  await env.MEDIA.delete(["data/engine/bank.json", "data/engine/tags.json"]);
}

export const routes = {
  // GET /api/engine: where the engine stands, in a line for the Nishiii section and Insights.
  engine: async (request, env, parts, kit) => {
    if (request.method !== "GET" || parts.length !== 1) return kit.fail(404, "Not found.");
    const e = await start(env, kit, { scorerModel: await scorer.upToDate(env, kit) });      // her latest picks counted first
    return kit.json(status(e.P, e.sig));
  },
};
export const jobs = [
  { name: "engine-tags", everyHours: 2, run: tagJob },
  { name: "engine-found", everyHours: 3, run: foundJob },
  { name: "engine-discover", everyHours: 4, run: discoverJob },
  { name: "engine-echo", everyHours: 6, run: echoJob },
];
export const run = { tagJob, foundJob, discoverJob, echoJob };
