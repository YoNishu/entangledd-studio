// Agent 4: a made-up life with the app in a closed loop. Unlike the other made-up histories, what she is shown each
// day depends on the scorer itself once it is live (it keeps 4 of 10 and adds a wildcard), and she may have a habit
// of taking whichever card comes first. Used by sim_closed.mjs (comparison) and test_a4_loop.mjs (checks).
import { learn, judge, nextState, decide, choose, describe } from "../server/scorer.js";
import { DAY, dateOf, noonOf, rng, gauss, pick, THEMES, TONES, KINDS } from "./a4kit.mjs";
// The scorer as first built (best-scored first, wildcard last), taken from the repo's history by tests/prepare.sh.
const { choose: chooseBestFirst } = await import((process.env.STUDIO_OUT || "/tmp/studio-tests") + "/scorer_at_4d6c348.js");

export const DAYS = 300, TURN = 150;
const NOW = Date.parse("2026-11-14T12:00:00+05:30");
const WORDS = "quiet water keeps its own slow counsel under every passing weather and leaves the hurried shore to argue with itself about what the tide has taken and what it means to stay when staying costs".split(" ");
const AUTHORS = Array.from({ length: 12 }, (_, i) => "Author " + i);
let serial = 0;
const quote = (r) => { const n = pick(r, [7, 18, 32]); serial++; return { text: `Q${serial} ${WORDS.slice(0, n - 1).join(" ")}`, author: pick(r, AUTHORS), source: { type: pick(r, KINDS), title: "" }, theme: pick(r, THEMES), tone: pick(r, TONES), verify: r() < 0.5, n }; };
export const calmShort = (q) => 2 * (q.tone === "calm") + 1.5 * (q.n <= 10);
export const directLong = (q) => 2 * (q.tone === "direct") + 1.5 * (q.n > 25) - 1.5 * (q.tone === "calm");
export const none = () => 0;
export const steady = (f) => () => f, turning = (d) => (d < TURN ? calmShort : directLong);
const PLACE = [1, 0.6, 0.3, 0.1, 0];                           // how much more the first cards draw the eye

// taste(day) gives her taste that day; habit = how strongly she takes the first cards; insight = how well Nishiii's
// own order already matches her taste (0 = not at all).
// order: "given" = as the scorer hands them back (Nishiii's order, the rule in the code); "score" = best-scored first and
//        the wildcard last (as first built); "random" = shuffled.
// rule:  "since" = the rule in the code (after stepping back it must prove itself again on later days); "all" = as first built.
export function life(seed, { order = "given", rule = "since", taste, habit, insight }) {
  const r = rng(seed), rows = [];
  let prev = { state: "learning", back: 0 }, live = 0, flips = 0, shownTaste = 0, baseTaste = 0, firstLive = -1, wrongAfterTurn = 0, pickedWild = 0;
  for (let d = 0; d < DAYS; d++) {
    const now = NOW - (DAYS - d) * DAY, date = dateOf(now), like = taste(d);
    const res = learn({ rows, fold: null }, now, date);
    const next = rule === "since" ? decide(prev, res, now) : { state: nextState(prev.state, res.picks, judge(res.days)), back: 0 };
    if (next.state !== prev.state) flips++;
    prev = next;
    // Nishiii's ten, in Nishiii's order (partly informed by her taste)
    const pool = Array.from({ length: 10 }, () => quote(r)).map((q) => ({ q, key: insight * like(q) + 1.5 * gauss(r) })).sort((a, b) => b.key - a.key).map((x) => x.q);
    const usual = pool.slice(0, 5);
    let shown = usual;
    if (next.state === "live") {
      live++; if (firstLive < 0) firstLive = d;
      const model = { v: 1, at: now, base: [res.counts.P, res.counts.N], feat: res.counts.f, aud: null };
      shown = order === "score" ? chooseBestFirst(model, pool, 5) : choose(model, pool, 5);
      if (order === "random") shown = shown.map((q) => [r(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      // is it still ranking by a taste she no longer has? (only asked after her taste turns)
      if (d > TURN && taste(0) !== taste(DAYS - 1)) {
        const old = taste(0), mean = (list, f) => list.reduce((s, q) => s + f(q), 0) / list.length;
        if (mean(shown.filter((q) => !q.wild), old) > mean(pool, old) + 0.5) wrongAfterTurn++;
      }
    }
    const avg = (list) => list.reduce((s, q) => s + like(q), 0) / list.length;
    shownTaste += avg(shown); baseTaste += avg(usual);
    // she takes the one she likes most, with a pull towards the first cards and a little whim; one day in six she takes nothing
    const felt = shown.map((q, i) => like(q) + habit * PLACE[i] + 0.5 * gauss(r));
    const top = r() < 1 / 6 ? -1 : felt.indexOf(Math.max(...felt));
    if (next.state === "live" && top >= 0 && shown[top].wild) pickedWild++;
    shown.forEach((q, i) => rows.push({ i: `d${d}-${i}`, g: date, t: noonOf(date), s: i === top ? 1 : 0, u: 0, ...describe(q) }));
  }
  return { live: live / DAYS, liveDays: live, flips, gain: (shownTaste - baseTaste) / DAYS, firstLive, wrongAfterTurn, wildRate: live ? pickedWild / live : 0 };
}
export const mid = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
export const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const lives = (n, world) => Array.from({ length: n }, (_, k) => life(7001 + k, world));
