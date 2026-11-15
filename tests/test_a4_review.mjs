// Agent 4 (third run): one check for every flaw found when reviewing server/scorer.js.
//   1. the self-test never looks ahead        5. a record that fails to load is never overwritten
//   2. her own lines don't earn it "live"     6. folded days are not gathered twice
//   3. a pick known from a post stays a pick  7. forgetting wins over a count already under way
//   4. the status answers through a hiccup    8. the audience's smaller voice; 9. cost of one run
// Run: node tests/test_a4_review.mjs
import * as scorer from "../server/scorer.js";
import { DAY, HOUR, dateOf, noonOf, dayStr, fresh, rng, pick, cand, calmShort, atRandom, suggestion, checker, THEMES, TONES } from "./a4kit.mjs";

const { learn, judge, nextState, choose, audience, jobs, routes, forget } = scorer;
const { check, finish } = checker();
const NOW = Date.now(), TODAY = dateOf(NOW);
const job = jobs.find((j) => j.name === "scorer");
const status = async (env, kit) => routes.scorer({ method: "GET" }, env, ["scorer"], kit);
const verdict = (rows, prev = "learning") => { const res = learn({ rows, fold: null }, NOW, TODAY), ev = judge(res.days); return { res, ev, state: nextState(prev, res.picks, ev) }; };
const dayRows = (ago, five, picked, tag = "d", extra = () => ({})) => {
  const date = dayStr(ago, NOW);
  return five.map((c, i) => ({ i: `${tag}${ago}-${i}`, g: date, t: noonOf(date), s: picked.includes(i) ? 1 : 0, u: 0, x: `k${tag}${ago}-${i}`, ...c, ...extra(i) }));
};

// ---------- 1. no looking ahead ----------
console.log("1. The self-test predicts a day only from what was settled before that day began");
{
  // (a) Random picks, but every morning there is also an asked-for batch whose outcome gives the day's answer away:
  //     the quote she picks from Today's five is from the same work as the one she picked from the batch.
  let live = 0, sum = 0;
  const N = 12;
  for (let seed = 1; seed <= N; seed++) {
    const r = rng(300 + seed), rows = [];
    for (let ago = 80; ago >= 1; ago--) {
      const date = dayStr(ago, NOW), top = Math.floor(r() * 5), btop = Math.floor(r() * 5), at = noonOf(date) - 3 * HOUR;
      const mark = (hit) => ({ w: hit ? `picked on ${date}` : `passed on ${date}` });
      rows.push(...dayRows(ago, Array.from({ length: 5 }, () => cand(r)), [top], "d", (i) => mark(i === top)));
      Array.from({ length: 5 }, () => cand(r)).forEach((c, i) => rows.push({ i: `b${ago}-${i}`, g: "a" + at, t: at, s: i === btop ? 1 : 0, u: 0, x: `kb${ago}-${i}`, ...c, ...mark(i === btop) }));
    }
    const v = verdict(rows);
    live += v.state === "live"; sum += v.ev.mean;
  }
  console.log(`     same-day batch that gives the answer away: live in ${live} of ${N}; it was right ${(100 * sum / N).toFixed(1)}% of the time (chance is 50%)`);
  check("a batch from the same day cannot help it guess that day's pick", live === 0 && sum / N < 0.55, `live ${live}, mean ${(sum / N).toFixed(3)}`);
}
{
  // (b) Random picks again. On every other day she goes back to yesterday's five and picks one, and that late pick
  //     gives away what she picks today. The late choice was made today, so it must not help to "predict" today.
  let live = 0, sum = 0;
  const N = 12;
  for (let seed = 1; seed <= N; seed++) {
    const r = rng(400 + seed), rows = [];
    for (let ago = 80; ago >= 2; ago -= 2) {
      const target = dayStr(ago - 1, NOW), top = Math.floor(r() * 5), echo = Math.floor(r() * 5);
      const mark = (hit) => ({ w: hit ? `picked on ${target}` : `passed on ${target}` });
      const late = noonOf(target) + HOUR;                                      // she chose it the next day, at one o'clock
      rows.push(...dayRows(ago, Array.from({ length: 5 }, () => cand(r)), [echo], "e", (i) => ({ ...mark(i === echo), u: i === echo ? late : 0 })));
      rows.push(...dayRows(ago - 1, Array.from({ length: 5 }, () => cand(r)), [top], "t", (i) => mark(i === top)));
    }
    const v = verdict(rows);
    live += v.state === "live"; sum += v.ev.mean;
  }
  console.log(`     late picks that give the next day away: live in ${live} of ${N}; right ${(100 * sum / N).toFixed(1)}% of the time`);
  check("a choice made later cannot help it guess an earlier day's pick", live === 0 && sum / N < 0.55, `live ${live}, mean ${(sum / N).toFixed(3)}`);
}
{
  // (c) The rule itself, checked from outside: take any tested day; scramble everything that was not yet settled
  //     when that day began (other than the day's own quotes); the day's result must not move.
  const r = rng(77), rows = [];
  for (let ago = 70; ago >= 1; ago--) {
    const date = dayStr(ago, NOW);
    const five = Array.from({ length: 5 }, () => cand(r)), liked = five.map((c) => calmShort(c, r));
    const top = liked.indexOf(Math.max(...liked));
    const lateBy = r() < 0.25 ? Math.floor(1 + r() * 4) * DAY : 0;             // one pick in four is made days later
    rows.push(...dayRows(ago, five, [top], "d", (i) => ({ u: i === top && lateBy ? noonOf(date) + lateBy : 0 })));
    if (r() < 0.4) {                                                           // some days also have an asked-for batch
      const at = noonOf(date) + Math.floor((r() * 16 - 8) * HOUR), batch = Array.from({ length: 4 }, () => cand(r)), bl = batch.map((c) => calmShort(c, r));
      batch.forEach((c, i) => rows.push({ i: `b${ago}-${i}`, g: "a" + at, t: at, s: bl[i] === Math.max(...bl) ? 1 : r() < 0.2 ? 2 : 0, u: r() < 0.3 ? at + Math.floor(r() * 3 * DAY) : 0, x: `kb${ago}-${i}`, ...c }));
    }
  }
  const base = learn({ rows, fold: null }, NOW, TODAY);
  const named = Array.isArray(base.at) && base.at.length === base.days.length;
  check("learn() says which day each test result belongs to", named, "no list of tested groups");
  if (named) {
    const groupDay = (g, t) => (/^\d{4}-/.test(g) ? g : dateOf(t)), startOf = (day) => noonOf(day) - DAY / 2;
    const closes = (g, t) => (/^\d{4}-/.test(g) ? noonOf(g) + DAY / 2 : g[0] === "a" ? Number(g.slice(1)) + DAY : t);
    const settled = new Map();                                                 // group -> the moment nothing in it changed any more
    for (const row of rows) settled.set(row.g, Math.max(settled.get(row.g) || closes(row.g, row.t), row.s ? row.u : 0));
    let moved = 0, checked = 0, control = 0;
    const r2 = rng(5);
    for (let n = 0; n < base.at.length; n += 3) {
      const g = base.at[n], t = rows.find((x) => x.g === g).t, start = startOf(groupDay(g, t));
      // Other words and other outcomes for every group on one side of the line. Each group keeps the moment it was
      // settled (a late choice stays a late choice), so only what it says changes, not when it was known.
      const scramble = (unsettledOnly) => {
        const first = new Set();
        return rows.map((row) => {
          if (row.g === g) return row;
          const was = settled.get(row.g), open = was > start;
          if (open !== unsettledOnly) return row;
          const lateOne = was > closes(row.g, row.t) && !first.has(row.g);      // one row carries the group's late choice
          first.add(row.g);
          return { ...row, ...cand(r2), s: lateOne ? pick(r2, [1, 2]) : pick(r2, [0, 1, 2]), u: lateOne ? was : 0 };
        });
      };
      const after = learn({ rows: scramble(true), fold: null }, NOW, TODAY);
      const i2 = after.at.indexOf(g);
      checked++;
      if (i2 < 0 || Math.abs(after.days[i2] - base.days[n]) > 1e-12) moved++;
      const other = learn({ rows: scramble(false), fold: null }, NOW, TODAY), i3 = other.at.indexOf(g);
      if (i3 < 0 || Math.abs(other.days[i3] - base.days[n]) > 1e-12) control++;
    }
    console.log(`     ${checked} tested days: results moved by scrambling what came later: ${moved}; moved by scrambling what came before: ${control}`);
    check("scrambling everything not yet settled never changes a day's result", moved === 0, `${moved} of ${checked}`);
    check("scrambling what was settled before does change results (the check is not empty)", control >= checked * 0.5, `${control} of ${checked}`);
  }
}

// ---------- 2. her own lines ----------
console.log("2. Her own lines are never among the quotes it ranks, so they earn it nothing in the self-test");
{
  const own = (r) => ({ th: "", to: "", k: "own", w: "", a: "", n: pick(r, [7, 18, 32]), v: "i", c: 0 });
  let liveAlways = 0, liveNever = 0, liveReal = 0;
  const N = 20;
  for (let seed = 1; seed <= N; seed++) {
    const r = rng(600 + seed), always = [], never = [], real = [];
    for (let ago = 90; ago >= 1; ago--) {
      const four = Array.from({ length: 4 }, () => cand(r));
      always.push(...dayRows(ago, [own(r), ...four], [0], "a"));                              // she always takes her own line
      never.push(...dayRows(ago, [own(r), ...four], [1 + Math.floor(r() * 4)], "n"));         // never her own; the others at random
      const liked = four.map((c) => calmShort(c, r)), best = 1 + liked.indexOf(Math.max(...liked));
      real.push(...dayRows(ago, [own(r), ...four], [r() < 0.3 ? 0 : best], "r"));             // a real taste, and her own line now and then
    }
    liveAlways += verdict(always).state === "live"; liveNever += verdict(never).state === "live"; liveReal += verdict(real).state === "live";
  }
  console.log(`     live in: always her own line ${liveAlways} of ${N}; never her own, the rest at random ${liveNever} of ${N}; a real taste with her own lines mixed in ${liveReal} of ${N}`);
  check("always picking her own line does not switch it on", liveAlways === 0, String(liveAlways));
  check("never picking her own line (the rest at random) does not switch it on", liveNever <= 1, String(liveNever));
  check("a real taste among Nishiii's finds still switches it on", liveReal >= N * 0.9, String(liveReal));
}

// ---------- 3. a pick known only from a post ----------
console.log("3. A post made from a suggestion that was never marked used stays a pick");
{
  const { env, kit } = fresh();
  const date = dayStr(2, NOW), list = Array.from({ length: 5 }, () => suggestion());
  env.MEDIA.set(`suggestions/${date}`, list);
  env.MEDIA.set("posts", [{ id: "p1", state: "published", suggestionId: list[2].id, quote: list[2].text, theme: "sea", tone: "calm", source: "classic", created: noonOf(date) + HOUR, published: noonOf(date) + 2 * HOUR }]);
  const first = await job.run(env, kit);
  const second = await job.run(env, kit);
  const third = await job.run(env, kit);
  check("counted on the first run", first.picks === 1 && first.passes === 4, `${first.picks} ${first.passes}`);
  check("still counted on the second and third runs", second.picks === 1 && second.passes === 4 && third.picks === 1, `${second.picks} ${second.passes} ${third.picks}`);
  // a hand-over finished in Instagram gets the time of the hand-over, which can be earlier than a post already seen
  const posts = env.MEDIA.doc("posts");
  posts.push({ id: "p2", state: "published", via: "instagram", suggestionId: list[4].id, quote: list[4].text, created: noonOf(date) + HOUR / 2, published: NOW - HOUR });
  env.MEDIA.set("posts", posts);
  const fourth = await job.run(env, kit);
  check("a post filed with an earlier time than the last one seen is still found", fourth.picks === 2 && fourth.passes === 3, `${fourth.picks} ${fourth.passes}`);
  check("no repeats in the record", new Set(env.MEDIA.doc("scorer/log").rows.map((x) => x.i)).size === env.MEDIA.doc("scorer/log").rows.length);
}

// ---------- 4 and 5. storage hiccups ----------
console.log("4. A record that fails to load is left alone, and the status still answers");
{
  const { env, kit } = fresh();
  const rows = [];
  const r = rng(9);
  for (let ago = 30; ago >= 1; ago--) { const five = Array.from({ length: 5 }, () => cand(r)); rows.push(...dayRows(ago, five, [Math.floor(r() * 5)])); }
  env.MEDIA.set("scorer/log", { v: 1, rows, fold: null, histAt: 0, postsAt: 0, since: 0, back: "done", backTo: "" });
  const before = await job.run(env, kit);
  check("30 picks counted to begin with", before.picks === 30, String(before.picks));
  const kept = env.MEDIA.raw("scorer/log"), keptModel = env.MEDIA.raw("scorer/model");

  env.MEDIA.fail("get", "scorer/log", 5);
  let threw = false;
  try { await job.run(env, kit); } catch (e) { threw = true; }
  check("the timed job stops with an error (so it is tried again within the hour)", threw);
  check("the record is exactly as it was", env.MEDIA.raw("scorer/log") === kept);
  check("the model is exactly as it was", env.MEDIA.raw("scorer/model") === keptModel);

  // the same while she is looking at the Nishiii section, after a new choice (which makes the stored status stale)
  env.MEDIA.set("history", [{ text: "A line she just picked", action: "used", at: Date.now() }]);
  env.MEDIA.fail("get", "scorer/log", 5);
  const s = await status(env, kit);
  check("the status still answers, from what was stored", s.status === 200 && s.data.picks === 30 && s.data.line.startsWith("Learning from your picks: 30 so far"), JSON.stringify(s.data));
  check("and the record is still exactly as it was", env.MEDIA.raw("scorer/log") === kept);
  env.MEDIA.failing.length = 0;

  env.MEDIA.fail("get", "scorer/log", 1);
  const once = await job.run(env, kit);
  check("a single hiccup is simply tried again", once.picks === 31, String(once.picks));

  // the model failing to load must not be read as "not live yet"
  const live = { ...env.MEDIA.doc("scorer/model"), state: "live" };
  env.MEDIA.set("scorer/model", live);
  env.MEDIA.fail("get", "scorer/model", 5);
  let threw2 = false;
  try { await job.run(env, kit); } catch (e) { threw2 = true; }
  check("a model that fails to load stops the run rather than being taken for none", threw2 && env.MEDIA.doc("scorer/model").state === "live");
  env.MEDIA.failing.length = 0;

  // a status nobody has managed to rebuild for days is not shown as if it were current
  env.MEDIA.set("scorer/model", { ...live, at: Date.now() - 2 * DAY });
  env.MEDIA.fail("get", "scorer/log", 5);
  const recent = await status(env, kit);
  check("a status two days old is still shown when the count cannot be made", recent.status === 200 && recent.data.state === "live", JSON.stringify(recent.data));
  env.MEDIA.failing.length = 0;
  env.MEDIA.set("scorer/model", { ...live, at: Date.now() - 4 * DAY });
  env.MEDIA.fail("get", "scorer/log", 5);
  let threw3 = false;
  try { await status(env, kit); } catch (e) { threw3 = true; }
  check("one four days old is not: the line is left out rather than say it is ranking", threw3);
  check("and nothing is ranked by a model that old", (await scorer.ranker(env, kit)) === null);
  env.MEDIA.failing.length = 0;
  env.MEDIA.set("scorer/model", live);

  // damaged beyond reading: there is nothing to save, so it starts again and nothing breaks
  env.MEDIA.set("scorer/log", "[1,2");
  const again = await job.run(env, kit);
  check("a record damaged beyond reading starts again", again.picks === 1 && Array.isArray(env.MEDIA.doc("scorer/log").rows), String(again.picks));
  // other lists failing: nothing is lost, they are read on the next run
  env.MEDIA.fail("get", "data/history", 1); env.MEDIA.fail("get", "data/asked", 1); env.MEDIA.fail("get", "data/posts", 1);
  const soft = await job.run(env, kit);
  check("the app's other lists failing to load does no harm", soft.picks === 1, String(soft.picks));

  // a time that is no time at all (in the record itself, or in one of the app's lists) must not stop every later run
  const oddGood = env.MEDIA.doc("scorer/log");
  const odd = { ...oddGood.rows[0], i: "odd-1", g: "hodd-1", x: "kodd-1", t: 1e20, u: 1e20, s: 1 };
  env.MEDIA.set("scorer/log", { ...oddGood, rows: [...oddGood.rows, odd] });
  let oddRun = null, oddErr = "";
  try { oddRun = await job.run(env, kit); } catch (e) { oddErr = String(e); }
  check("a row with an impossible time does not stop the run", !!oddRun && oddRun.picks >= 1, oddErr || JSON.stringify(oddRun && oddRun.picks));
  env.MEDIA.set("scorer/log", oddGood);
  env.MEDIA.set("history", [{ text: "a line with a broken time", author: "x", theme: "sea", tone: "calm", source: "classic", action: "used", at: 1e20 }]);
  let oddRun2 = null, oddErr2 = "";
  try { oddRun2 = await job.run(env, kit); } catch (e) { oddErr2 = String(e); }
  check("nor does a choice with an impossible time in the app's record", !!oddRun2 && oddRun2.picks >= 1, oddErr2 || JSON.stringify(oddRun2 && oddRun2.picks));
  const oddBase = oddRun2 ? oddRun2.picks : -1;
  env.MEDIA.set("history", [...env.MEDIA.doc("history"), { text: "a later line with a real time", author: "y", theme: "sea", tone: "calm", source: "classic", action: "used", at: Date.now() }]);
  let oddRun3 = null, oddErr3 = "";
  try { oddRun3 = await job.run(env, kit); } catch (e) { oddErr3 = String(e); }
  check("and a real choice made after it is still counted", !!oddRun3 && oddRun3.picks === oddBase + 1, oddErr3 || `${oddBase} -> ${oddRun3 && oddRun3.picks}`);
  const oddKept = env.MEDIA.doc("scorer/log");
  check("no impossible time is kept in the record", oddKept.rows.every((r) => r.t > 0 && r.t < Date.now() + 3 * DAY) && oddKept.histAt <= Date.now(), String(oddKept.histAt));
  const oddModel = env.MEDIA.doc("scorer/model");
  check("and the counts stay ordinary numbers", Number.isFinite(oddModel.base[0]) && Number.isFinite(oddModel.base[1]) && oddModel.base[0] < 1e6, JSON.stringify(oddModel.base));
  // an asked-for quote and a post with such times are left out as well
  env.MEDIA.set("asked", [suggestion({ state: "used", askedFor: "x", askedAt: 1e20 })]);
  env.MEDIA.set("posts", [{ id: "podd", state: "published", suggestionId: "11111111-1111-4111-8111-111111111111", quote: "a post with a broken time", created: 1e20, published: 1e20 }]);
  let oddRun4 = null, oddErr4 = "";
  try { oddRun4 = await job.run(env, kit); } catch (e) { oddErr4 = String(e); }
  check("an asked-for quote or a post with an impossible time is left out, nothing else changes", !!oddRun4 && oddRun4.picks === oddBase + 1, oddErr4 || String(oddRun4 && oddRun4.picks));
  for (const k of ["history", "asked", "posts"]) env.MEDIA.objects.delete(`data/${k}.json`);
}

// ---------- 6. folded days ----------
console.log("5. Once old days are folded into running counts, nothing from them is gathered a second time");
{
  const { env, kit } = fresh();
  const r = rng(21), rows = [];
  for (let ago = 330; ago >= 9; ago--) { const five = Array.from({ length: 5 }, () => cand(r)); rows.push(...dayRows(ago, five, [Math.floor(r() * 5)])); }
  // eight asked-for batches from long ago (she rarely asks) whose quotes are still on her asked-for list
  const asked = [];
  for (let n = 0; n < 8; n++) {
    const at = NOW - (325 - n * 5) * DAY;
    for (let i = 0; i < 5; i++) {
      const sug = suggestion({ askedAt: at, state: i === 0 ? "used" : "new", theme: pick(r, THEMES), tone: pick(r, TONES) });
      asked.push(sug);
      rows.push({ i: sug.id, g: "a" + at, t: at, s: i === 0 ? 1 : 0, u: 0, ...scorer.describe(sug) });
    }
  }
  env.MEDIA.set("asked", asked);
  env.MEDIA.set("scorer/log", { v: 1, rows, fold: null, histAt: 0, postsAt: 0, since: 0, back: "done", backTo: "" });
  const total = 322 + 8;
  const one = await job.run(env, kit), log1 = env.MEDIA.doc("scorer/log");
  check("the record was folded down to size", log1.rows.length <= 1500 && !!log1.fold && log1.fold.picks > 0, `${log1.rows.length} rows`);
  check("every pick is still counted once", one.picks === total, `${one.picks} against ${total}`);
  const two = await job.run(env, kit), three = await job.run(env, kit), log3 = env.MEDIA.doc("scorer/log");
  check("later runs do not count the folded asked-for quotes again", two.picks === total && three.picks === total, `${two.picks} ${three.picks}`);
  check("and do not put them back in the record", log3.rows.length === log1.rows.length, `${log1.rows.length} -> ${log3.rows.length}`);
  // far too big (a burst of asking): whatever is finished is folded, days still on the week's lists included, and nothing doubles
  const big = [];
  for (let b = 0; b < 640; b++) {
    const at = NOW - 25 * HOUR - b * 180000;                                   // 640 batches, from 25 to 57 hours ago
    Array.from({ length: 5 }, () => cand(r)).forEach((c, i) => big.push({ i: `x${b}-${i}`, g: "a" + at, t: at, s: i === 0 ? 1 : 0, u: 0, x: `kx${b}-${i}`, ...c }));
  }
  for (const ago of [3, 4, 5]) {                                               // three days that are still on the week's lists
    const d = dayStr(ago, NOW), list = Array.from({ length: 5 }, (_, i) => suggestion({ state: i === 1 ? "used" : "new" }));
    env.MEDIA.set(`suggestions/${d}`, list);
    list.forEach((sug, i) => big.push({ i: sug.id, g: d, t: noonOf(d), s: i === 1 ? 1 : 0, u: 0, ...scorer.describe(sug) }));
  }
  env.MEDIA.set("scorer/log", { v: 1, rows: big, fold: null, histAt: 0, postsAt: 0, since: 0, back: "done", backTo: "" });
  env.MEDIA.set("asked", []);
  const b1 = await job.run(env, kit), rows1 = env.MEDIA.doc("scorer/log").rows.length;
  const b2 = await job.run(env, kit), rows2 = env.MEDIA.doc("scorer/log").rows.length;
  check("a record far too big is folded hard", rows1 <= 1500 && b1.picks === 643, `${rows1} rows, ${b1.picks} picks`);
  check("and the days still on the week's lists are not counted twice", b2.picks === 643 && rows2 === rows1, `${b2.picks} picks, ${rows1} -> ${rows2} rows`);
}

{
  // (R1) She rarely asks, so a batch from ten months ago is still on her asked-for list, and yesterday she went back
  //      and picked one of its quotes. When the record is next folded, that old batch must not be folded with the
  //      old days around it: its outcome is yesterday's news, and folding it would leave no earlier day testable.
  const { env, kit } = fresh();
  const r = rng(91);
  const days = (from, to) => { const out = []; for (let ago = from; ago >= to; ago--) { const five = Array.from({ length: 5 }, () => cand(r)), liked = five.map((c) => calmShort(c, r)); out.push(...dayRows(ago, five, [liked.indexOf(Math.max(...liked))])); } return out; };
  const recent = days(290, 9), at = NOW - 300 * DAY, asked = [], batch = [];
  for (let i = 0; i < 5; i++) {
    const sug = suggestion({ askedAt: at, state: i === 2 ? "used" : "new", theme: pick(r, THEMES), tone: "calm" });
    asked.push(sug);
    batch.push({ i: sug.id, g: "a" + at, t: at, s: i === 2 ? 1 : 0, u: i === 2 ? NOW - DAY : 0, ...scorer.describe(sug) });
  }
  env.MEDIA.set("asked", asked);
  env.MEDIA.set("scorer/log", { v: 1, rows: [...batch, ...recent], fold: null, histAt: 0, since: 0, back: "done", backTo: "" });
  const before = await job.run(env, kit);
  check("(set-up) live on a clear taste, nothing folded yet", before.state === "live" && !env.MEDIA.doc("scorer/log").fold, `${before.state} ${JSON.stringify(before.eval)}`);
  const older = days(330, 291), kept = env.MEDIA.doc("scorer/log");
  env.MEDIA.set("scorer/log", { ...kept, rows: [...older, ...kept.rows] });
  const after = await job.run(env, kit), log = env.MEDIA.doc("scorer/log");
  check("(set-up) the record was folded", !!log.fold && log.rows.length <= 1500, `${log.rows.length} rows`);
  check("an old batch she picked from yesterday is not folded with the old days", log.rows.filter((x) => x.g === "a" + at).length === 5, `${log.rows.filter((x) => x.g === "a" + at).length} of its 5 rows left`);
  check("so the self-test keeps its tested days", after.eval.days >= 20, `${after.eval.days} tested days`);
  check("and a live scorer stays live through the fold", after.state === "live", `${after.state} ${JSON.stringify(after.eval)}`);
  check("no pick is lost or doubled by it", after.picks === before.picks + 40, `${before.picks} -> ${after.picks}`);
}

{
  // Three years of use, every quote by an author and from a work never seen again. The rows are folded into running
  // counts; the counts themselves must not grow for ever either, and nothing she chose may be lost from the totals.
  const { env, kit } = fresh();
  const r = rng(55);
  let size = 0, values = 0, picks = 0, total = 0;
  for (let year = 3; year >= 1; year--) {
    const rows = [];
    for (let ago = year * 365; ago > (year - 1) * 365 + 8; ago--) {
      const five = Array.from({ length: 5 }, (_, i) => ({ ...cand(r), a: `writer ${ago}-${i}`, w: `work ${ago}-${i}` }));
      rows.push(...dayRows(ago, five, [Math.floor(r() * 5)], "y")); total++;
    }
    const kept = env.MEDIA.doc("scorer/log") || { v: 1, rows: [], fold: null, histAt: 0, since: 0, back: "done", backTo: "" };
    env.MEDIA.set("scorer/log", { ...kept, rows: [...kept.rows, ...rows] });
    picks = (await job.run(env, kit)).picks;
    const log = env.MEDIA.doc("scorer/log");
    size = env.MEDIA.raw("scorer/log").length; values = Object.keys(log.fold.f.author).length + Object.keys(log.fold.f.work).length;
    console.log(`     after year ${4 - year}: ${log.rows.length} rows, ${values} authors and works in the running counts, ${Math.round(size / 1024)} KB stored`);
  }
  check("three years on, the running counts hold only what still counts", values < 600, `${values} values`);
  check("the stored record stays under 300 KB", size < 300 * 1024, `${Math.round(size / 1024)} KB`);
  check("the themes and tones she keeps meeting are all still there", Object.keys(env.MEDIA.doc("scorer/log").fold.f.theme).length === THEMES.length && Object.keys(env.MEDIA.doc("scorer/log").fold.f.tone).length === TONES.length);
  check("and every pick is still in the total", picks === total, `${picks} against ${total}`);
}

// ---------- 7. forgetting against a count under way ----------
console.log("6. Forget everything wins, even over a count that had already started");
{
  const seed = (env) => {
    const r = rng(33), rows = [];
    for (let ago = 30; ago >= 1; ago--) rows.push(...dayRows(ago, Array.from({ length: 5 }, () => cand(r)), [Math.floor(r() * 5)]));
    env.MEDIA.set("scorer/log", { v: 1, rows, fold: null, histAt: 0, postsAt: 0, since: 0, back: "done", backTo: "" });
  };
  const cleared = (env) => { const l = env.MEDIA.doc("scorer/log"); return !!l && l.rows.length === 0 && l.since > 0; };
  {
    // the count has read everything; then she forgets; then the count gets to its last look before saving
    const { env, kit } = fresh(); seed(env);
    await job.run(env, kit);
    const paused = env.MEDIA.hold("get", "scorer/forgot", 1);                   // its second look at the "forgotten" mark
    const running = job.run(env, kit);
    const got = await Promise.race([paused.reached.then(() => true), new Promise((res) => setTimeout(() => res(false), 1500))]);
    check("the count takes a last look at the mark before it saves", got);
    await forget(env, kit);
    paused.release();
    const out = await running;
    check("the count under way saves nothing", cleared(env) && env.MEDIA.doc("scorer/model") === null, JSON.stringify(env.MEDIA.doc("scorer/model"))?.slice(0, 80));
    check("and reports an empty start", (out.picks || 0) === 0 && out.state !== "live", JSON.stringify(out).slice(0, 80));
    const s = await status(env, kit);
    check("the line starts again from nothing", s.data.line === "Learning from your picks: none yet.", s.data.line);
  }
  {
    // the narrowest case: she forgets in the instant between that last look and the writing
    const { env, kit } = fresh(); seed(env);
    await job.run(env, kit);
    const paused = env.MEDIA.hold("put", "scorer/log");
    const running = job.run(env, kit);
    await paused.reached;
    await forget(env, kit);
    paused.release();
    await running;
    const next = await job.run(env, kit);
    check("even then the next run puts it right", next.picks === 0 && cleared(env), `${next.picks} rows ${env.MEDIA.doc("scorer/log").rows.length}`);
    const s = await status(env, kit);
    check("and the line says none yet", s.data.line === "Learning from your picks: none yet.", s.data.line);
  }
  {
    // forgetting when part of it fails: the error is passed on (so she is told), and a second tap finishes it
    const { env, kit } = fresh(); seed(env);
    await job.run(env, kit);
    env.MEDIA.fail("delete", "scorer/model", 1);
    let threw = false;
    try { await forget(env, kit); } catch (e) { threw = true; }
    check("a forget that could not finish says so", threw);
    await forget(env, kit);
    const s = await status(env, kit);
    check("the second try clears it", s.data.picks === 0 && cleared(env), JSON.stringify(s.data));
  }
  {
    // a model left behind by a forget that half failed must not survive her next look
    const { env, kit } = fresh(); seed(env);
    await job.run(env, kit);
    env.MEDIA.set("history", [{ text: "x", action: "used", at: NOW - HOUR }]);
    await status(env, kit);
    const stale = env.MEDIA.raw("scorer/model");
    await forget(env, kit);
    env.MEDIA.objects.delete("data/history.json");                             // the taste route erases this at the same moment
    env.MEDIA.set("scorer/model", stale);                                      // ... but the model's removal was lost
    const s = await status(env, kit);
    check("a leftover model is not believed once the record is gone", s.data.picks === 0, JSON.stringify(s.data));
  }
}

// ---------- 8. the audience's smaller voice ----------
console.log("7. The audience's voice: small, needs three posts, never louder than her own picks");
{
  const post = (n, theme, tone, reactions) => ({ id: "p" + n, state: "published", published: NOW - (60 - n) * DAY, theme, tone, metrics: { reach: 1000, total_interactions: reactions } });
  const posts = [];
  for (let n = 0; n < 24; n++) {
    const theme = n % 4 === 0 ? "Sea" : n % 4 === 1 ? "work" : n === 6 || n === 14 ? "rare" : "time";
    posts.push(post(n, theme, n % 2 ? "calm" : "wry", theme === "Sea" ? 400 : theme === "work" ? 25 : theme === "rare" ? 5000 : 100));
  }
  const a = audience(posts);
  console.log("     lifts by theme:", JSON.stringify(a.theme), "by tone:", JSON.stringify(a.tone));
  check("a theme that draws more than the posts around it gets a lift", a.theme.sea > 0.1, JSON.stringify(a.theme));
  check("a theme that draws less gets a small push down", a.theme.work < -0.1, JSON.stringify(a.theme));
  check("no lift is larger than the cap", Object.values({ ...a.theme, ...a.tone }).every((v) => Math.abs(v) <= 0.5));
  check("a theme with only two posts is left out, however well they did", !("rare" in a.theme));
  check("fewer than six measured posts: no voice at all", Object.keys(audience(posts.slice(0, 5)).theme).length === 0);
  check("posts without numbers are ignored", audience(posts.map((p) => ({ ...p, metrics: null }))).posts === 0);
  check("odd input does not throw", audience(null).posts === 0 && audience([null, 3, {}]).posts === 0);

  const r = rng(4), rows = [];
  for (let ago = 80; ago >= 1; ago--) { const five = Array.from({ length: 5 }, () => cand(r)); const liked = five.map((c) => calmShort(c, r)); rows.push(...dayRows(ago, five, [liked.indexOf(Math.max(...liked))])); }
  const res = learn({ rows, fold: null }, NOW, TODAY);
  const model = (aud) => ({ v: 1, at: NOW, base: [res.counts.P, res.counts.N], feat: res.counts.f, aud });
  const q = (tag, tone, words, theme) => ({ text: tag + " " + Array.from({ length: words - 1 }, (_, i) => "w" + i).join(" "), author: "Writer " + tag, source: { type: "classic", title: "" }, theme, tone, verify: false });
  const tags = (items) => items.map((x) => x.text.split(" ")[0]);
  // two quotes her taste cannot tell apart: the audience decides between them
  const even = [q("A", "plain", 18, "time"), q("B", "plain", 18, "sea"), q("C", "wry", 30, "home"), q("D", "tender", 30, "loss")];
  check("between two quotes her taste rates the same, the audience's favourite wins", tags(choose(model({ posts: 24, theme: { sea: 0.4 }, tone: {} }), even, 1))[0] === "B"
    && tags(choose(model({ posts: 24, theme: { time: 0.4 }, tone: {} }), even, 1))[0] === "A");
  // a quote she clearly prefers is not overturned by the audience, even at the cap, even if the stored numbers are too big
  const clear = [q("A", "direct", 30, "sea"), q("B", "calm", 7, "work"), q("C", "wry", 30, "home"), q("D", "tender", 30, "loss")];
  check("her clear preference beats the audience's", tags(choose(model({ posts: 24, theme: { sea: 0.5, work: -0.5 }, tone: {} }), clear, 1))[0] === "B"
    && tags(choose(model({ posts: 24, theme: { sea: 99, work: -99 }, tone: { direct: 99 } }), clear, 1))[0] === "B");
}

// ---------- 9. what one run costs ----------
console.log("8. What one run costs: storage calls and computing");
{
  const { env, kit } = fresh();
  const r = rng(50), rows = [];
  for (let ago = 300; ago >= 1; ago--) { const five = Array.from({ length: 5 }, () => cand(r)); const liked = five.map((c) => calmShort(c, r)); rows.push(...dayRows(ago, five, [liked.indexOf(Math.max(...liked))])); }
  env.MEDIA.set("scorer/log", { v: 1, rows, fold: null, histAt: 0, postsAt: 0, since: 0, back: "", backTo: "" });
  for (let ago = 0; ago <= 20; ago++) env.MEDIA.set(`suggestions/${dayStr(ago, NOW)}`, Array.from({ length: 5 }, () => suggestion()));
  env.MEDIA.set("posts", Array.from({ length: 300 }, (_, n) => ({ id: "p" + n, state: "published", created: NOW - n * DAY, published: NOW - n * DAY, theme: pick(r, THEMES), tone: pick(r, TONES), quote: "q " + n, metrics: { reach: 900, total_interactions: 50 + n } })));
  env.MEDIA.calls.length = 0;
  await job.run(env, kit);
  const jobCalls = env.MEDIA.calls.length;
  console.log(`     the timed job, first run with older days to read: ${jobCalls} storage calls (${env.MEDIA.count("get")} reads, ${env.MEDIA.count("list")} listing, ${env.MEDIA.count("put")} writes)`);
  check("the timed job stays within twenty storage calls", jobCalls <= 20, String(jobCalls));
  env.MEDIA.set("history", [{ text: "new choice", action: "used", at: Date.now() }]);
  env.MEDIA.calls.length = 0;
  await status(env, kit);
  const lookCalls = env.MEDIA.calls.length;
  check("the quick look after a new choice: at most sixteen", lookCalls <= 16, String(lookCalls));
  env.MEDIA.calls.length = 0;
  await status(env, kit);
  check("the status with nothing new: two reads, no writes", env.MEDIA.calls.length === 2 && env.MEDIA.count("put") === 0, env.MEDIA.calls.join(", "));
  env.MEDIA.calls.length = 0;
  await scorer.ranker(env, kit);
  check("asking whether to rank costs one read", env.MEDIA.calls.length === 1 && env.MEDIA.calls[0] === "get data/scorer/model.json", env.MEDIA.calls.join(", "));

  // computing: the whole job (read, gather, learn, test, write) on a full-size record, best of several runs
  let best = Infinity;
  for (let i = 0; i < 12; i++) { const t = performance.now(); await job.run(env, kit); best = Math.min(best, performance.now() - t); }
  const size = Math.round(env.MEDIA.raw("scorer/log").length / 1024);
  console.log(`     a whole run on ${env.MEDIA.doc("scorer/log").rows.length} rows (${size} KB stored): ${best.toFixed(1)} ms on this machine`);
  check("a whole run on a full-size record takes a few milliseconds", best < 10, best.toFixed(1) + " ms");
}

finish("review fixes in the scorer");
