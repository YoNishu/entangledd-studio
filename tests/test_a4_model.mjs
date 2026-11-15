// Agent 4: the scorer's arithmetic on its own (no server): speed, how often chance fools it, how soon a clear
// taste is recognised, and how long it lags when her taste turns around.
// Run: node tests/test_a4_model.mjs
import { learn, judge, decide, choose, START_AT } from "../server/scorer.js";

const DAY = 24 * 3600 * 1000, IST = 5.5 * 3600 * 1000;
const fails = [];
const check = (name, ok, detail = "") => { console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? `  [${detail}]` : "")); if (!ok) fails.push(name); };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const pick = (r, list) => list[Math.floor(r() * list.length)];
const THEMES = ["love", "loss", "courage", "time", "self", "change", "hope", "sea", "home", "work"];
const TONES = ["calm", "tender", "direct", "wry", "hopeful", "plain"];
const KINDS = ["book", "film", "series", "classic"];
const AUTHORS = Array.from({ length: 12 }, (_, i) => "author " + i);
const cand = (r) => ({ th: pick(r, THEMES), to: pick(r, TONES), k: pick(r, KINDS), w: "", a: pick(r, AUTHORS), n: pick(r, [7, 18, 32]), v: "plain", c: pick(r, [0, 1]) });
const calmShort = (c, r, strength = 1) => strength * (2 * (c.to === "calm") + 1.5 * (c.n <= 10)) + 0.5 * gauss(r);
const directLong = (c, r) => 2 * (c.to === "direct") + 1.5 * (c.n > 25) - 1.5 * (c.to === "calm") + 0.5 * gauss(r);
const random = (c, r) => r();
const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const NOW = Date.parse("2026-11-14T12:00:00+05:30");

// One day's five suggestions, of which she picks the one she likes most. "ago" = days before NOW.
function day(r, ago, taste, tag) {
  const t = NOW - ago * DAY, g = dateOf(t);
  const five = Array.from({ length: 5 }, () => cand(r));
  const liked = five.map((c) => taste(c, r));
  const top = liked.indexOf(Math.max(...liked));
  return five.map((c, i) => ({ i: `${tag}${ago}-${i}`, g, t, s: i === top ? 1 : 0, u: 0, x: `k${tag}${ago}-${i}`, ...c }));
}
const history = (r, from, to, taste, tag = "d") => { const rows = []; for (let ago = from; ago >= to; ago--) rows.push(...day(r, ago, taste, tag)); return rows; };
// What the scorer would decide if its job ran "ago" days before NOW, seeing only the days before that.
// "prev" is what it decided the day before ({ state, back }), or just "learning" / "live".
function stateAt(rows, ago, prev) {
  const now = NOW - ago * DAY;
  const seen = rows.filter((r) => r.t < now - DAY / 2);
  const res = learn({ rows: seen, fold: null }, now, dateOf(now));
  const out = decide(typeof prev === "string" ? { state: prev, back: 0 } : prev, res, now);
  return { state: out.state, back: out.back, res, ev: out.ev };
}
const modelOf = (res) => ({ v: 1, at: NOW, base: [res.counts.P, res.counts.N], feat: res.counts.f, aud: null });
const item = (tone, words, theme, n) => ({ text: Array.from({ length: words }, (_, i) => "w" + i).join(" ") + " " + n, author: "someone " + n, source: { type: "classic", title: "" }, theme, tone, verify: false });
const POOL = [item("calm", 6, "sea", 1), item("calm", 6, "hope", 2), item("calm", 6, "love", 3), item("direct", 30, "work", 4), item("direct", 30, "time", 5),
  item("direct", 30, "loss", 6), item("wry", 18, "home", 7), item("plain", 18, "self", 8), item("tender", 18, "change", 9), item("hopeful", 18, "courage", 10)];
// Which taste the kept quotes follow: all three calm ones kept, all three direct ones, or neither. (The wildcard is not one of the kept.)
const leans = (res) => { const kept = choose(modelOf(res), POOL, 5).filter((q) => !q.wild).map((q) => q.tone); const n = (t) => kept.filter((x) => x === t).length; return n("calm") === 3 ? "calm" : n("direct") === 3 ? "direct" : "mixed"; };

// ---------- speed ----------
console.log("Speed");
{
  const rows = history(rng(7), 600, 1, calmShort);            // 3,000 rows
  const text = JSON.stringify({ v: 1, rows });
  const time = (fn) => { let best = Infinity; for (let i = 0; i < 25; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); } return best; };
  const tLearn = time(() => judge(learn({ rows, fold: null }, NOW, dateOf(NOW)).days));
  const tParse = time(() => JSON.parse(text)), tWrite = time(() => JSON.stringify({ v: 1, rows }));
  const res = learn({ rows, fold: null }, NOW, dateOf(NOW));
  const tChoose = time(() => choose(modelOf(res), POOL, 5));
  console.log(`     ${rows.length} rows (${Math.round(text.length / 1024)} KB as stored): learn and test ${tLearn.toFixed(2)} ms, read ${tParse.toFixed(2)} ms, write ${tWrite.toFixed(2)} ms, choose 5 of 10: ${tChoose.toFixed(3)} ms`);
  check("learning and testing 3,000 rows takes a few milliseconds", tLearn < 8, tLearn.toFixed(2) + " ms");
  check("choosing among ten candidates is instant", tChoose < 1, tChoose.toFixed(3) + " ms");
}

// ---------- chance must not fool it ----------
console.log("Random picks");
{
  let liveAt60 = 0, everLive = 0, liveDays = 0, days = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const rows = history(rng(1000 + seed), 180, 1, random);
    let prev = "learning", ever = false;
    for (let ago = 120; ago >= 0; ago--) {                    // the job runs daily from day 60 to day 180
      prev = stateAt(rows, ago, prev);
      const s = prev.state;
      if (ago === 120 && s === "live") liveAt60++;
      if (s === "live") { ever = true; liveDays++; }
      days++;
    }
    everLive += ever;
  }
  console.log(`     ${N} made-up histories of random picks: live on day 60 in ${liveAt60}; live at some point within 180 days in ${everLive}; share of days spent live ${(100 * liveDays / days).toFixed(1)}%`);
  check("random picks: live on day 60 in at most 3% of histories", liveAt60 <= N * 0.03, String(liveAt60));
  check("random picks: under 3% of all days are spent live", liveDays / days < 0.03, (100 * liveDays / days).toFixed(1) + "%");
}

// ---------- a real taste is recognised ----------
console.log("A clear taste, and a mild one");
for (const [label, strength, need] of [["clear", 1, 0.97], ["mild", 0.35, 0.5]]) {
  let at50 = 0, at90 = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const rows = history(rng(5000 + seed), 90, 1, (c, r) => calmShort(c, r, strength));
    let prev = "learning";
    for (let ago = 45; ago >= 0; ago--) {
      prev = stateAt(rows, ago, prev);
      if (ago === 40 && prev.state === "live") at50++;         // 50 days seen = 50 picks
    }
    if (prev.state === "live") at90++;
  }
  console.log(`     ${label} taste: live at 50 picks in ${at50} of ${N}; live at 90 picks in ${at90} of ${N}`);
  check(`${label} taste: live by 90 picks in at least ${need * 100}% of histories`, at90 >= N * need, String(at90));
  if (label === "clear") check("clear taste: live at 50 picks in at least 90%", at50 >= N * 0.9, String(at50));
}
check("the starting line is 50 picks", START_AT === 50);
{
  const rows = history(rng(11), 49, 1, calmShort);
  const s = stateAt(rows, 0, "learning");
  check("49 picks, however clear: not live", s.res.picks === 49 && s.state === "learning", `${s.res.picks} ${s.state}`);
}

// ---------- her taste turns around ----------
console.log("Her taste turns around");
{
  const lags = [], backs = [], returns = [];
  const N = 60;
  for (let seed = 1; seed <= N; seed++) {
    const r = rng(9000 + seed);
    const rows = [...history(r, 180, 121, calmShort, "o"), ...history(r, 120, 1, directLong, "n")];
    let prev = "learning", wrongDays = 0, back = null, again = null;
    for (let ago = 125; ago >= 0; ago--) {
      const s = stateAt(rows, ago, prev);
      const since = 120 - ago;                                // days since the change
      if (since >= 1 && s.state === "live" && leans(s.res) === "calm") wrongDays++;
      if (since >= 1 && back === null && (s.state === "learning" || leans(s.res) !== "calm")) back = since;
      if (back !== null && again === null && s.state === "live" && leans(s.res) === "direct") again = since;
      prev = s;
    }
    lags.push(wrongDays); backs.push(back === null ? 999 : back); returns.push(again === null ? 999 : again);
  }
  const mid = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const worst = (a) => Math.max(...a);
  console.log(`     ${N} histories: days it kept ranking by the old taste: typical ${mid(lags)}, worst ${worst(lags)}; first stepped back or adapted on day: typical ${mid(backs)}; live on the new taste by day: typical ${mid(returns)}, worst ${worst(returns)}`);
  check("it stops ranking by the old taste within three weeks (typical)", mid(lags) <= 21, String(mid(lags)));
  check("it never keeps the old taste longer than five weeks", worst(lags) <= 35, String(worst(lags)));
  check("it is live again on the new taste within 120 days (typical)", mid(returns) <= 120, String(mid(returns)));
}

console.log((fails.length ? "FAIL" : "PASS") + ": scorer arithmetic" + (fails.length ? ` (${fails.length} failed: ${fails.join("; ")})` : ""));
process.exit(fails.length ? 1 : 0);
