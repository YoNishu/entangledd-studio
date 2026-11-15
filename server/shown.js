// What she has already been shown when she asked for quotes ("Find quotes" in the Library), so that asking
// again, even straight away, only ever brings new lines.
//
// data/asked-shown.json: { works: { <work id or "other">: { at, t: [line in plain lower-case words, ...] } } }.
// Every line shown is noted under its work, whatever became of it (kept, used, skipped). Bounded: the newest
// SHOWN_PER_WORK lines of each work and the SHOWN_WORKS works asked about most recently; a line is cut to 160
// letters. At those bounds the document stays under about 200 KB.
export const SHOWN_PER_WORK = 150;
export const SHOWN_WORKS = 40;
const CUT = 160;

export const words = (n) => String(n || "").split(" ").filter(Boolean);

// Two lines are near the same when their words differ by at most two (a word changed, added or left out),
// counted on the words of each as a bag. Short lines must match more closely: under six words only one may
// differ, under four none.
export function near(a, b) {
  if (a === b) return true;
  const x = words(a), y = words(b);
  const most = Math.min(x.length, y.length) < 4 ? 0 : Math.min(x.length, y.length) < 6 ? 1 : 2;
  if (!most || Math.abs(x.length - y.length) > most) return false;
  const bag = new Map();
  for (const w of x) bag.set(w, (bag.get(w) || 0) + 1);
  let extra = 0;
  for (const w of y) { const n = bag.get(w) || 0; if (n) bag.set(w, n - 1); else if (++extra > most) return false; }
  let missing = 0;
  for (const n of bag.values()) if ((missing += n) > most) return false;
  return true;
}

// A Set of plain lines that also answers like(line): is there one in it near that line? Lines are kept in
// buckets by their number of words, so a check only compares lines of about the same length (cheap enough
// for a few thousand lines inside the free plan's 10 ms).
export function nearSet(lines = []) {
  const set = new Set();
  const byLength = new Map();
  const add = set.add.bind(set), has = set.has.bind(set);
  set.has = (n) => has(String(n || "").slice(0, CUT));
  set.add = (n) => {
    n = String(n || "").slice(0, CUT);
    if (!n) return set;
    if (!has(n)) { const k = words(n).length; if (!byLength.has(k)) byLength.set(k, []); byLength.get(k).push(n); }
    return add(n);
  };
  set.like = (n) => {
    n = String(n || "").slice(0, CUT);
    if (!n) return false;
    if (has(n)) return true;
    const k = words(n).length;
    for (let d = -2; d <= 2; d++) for (const m of byLength.get(k + d) || []) if (near(n, m)) return true;
    return false;
  };
  set.seenOrLike = (n) => set.has(n) || set.like(n);
  set.exact = (n) => add(String(n || "").slice(0, CUT));     // counted as seen word for word only, not compared for nearness
  for (const n of lines) set.add(n);
  return set;
}

export const emptyShown = () => ({ works: {} });

// The lines shown for these works (ids), as one list.
export function shownFor(doc, ids) {
  const out = [];
  for (const id of ids) { const w = (doc && doc.works ? doc.works : {})[id]; if (w && Array.isArray(w.t)) out.push(...w.t); }
  return out;
}

// Notes newly shown lines under their works. "pairs" are [work id, plain line].
export function note(doc, pairs, now = Date.now()) {
  if (!doc.works || typeof doc.works !== "object") doc.works = {};
  for (const [id, n] of pairs) {
    const key = String(id || "other").slice(0, 60), line = String(n || "").slice(0, CUT);
    if (!line) continue;
    const w = doc.works[key] || (doc.works[key] = { at: now, t: [] });
    if (!w.t.includes(line)) w.t.push(line);
    w.t = w.t.slice(-SHOWN_PER_WORK);
    w.at = now;
  }
  const keys = Object.keys(doc.works).sort((a, b) => (doc.works[b].at || 0) - (doc.works[a].at || 0));
  for (const k of keys.slice(SHOWN_WORKS)) delete doc.works[k];
  return doc;
}
