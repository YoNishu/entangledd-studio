// Scratch: CPU time of one whole timed run of the scorer at several record sizes (best and median of many runs).
import { fresh, rng, cand, calmShort, suggestion, dayStr, noonOf, pick, THEMES, TONES, DAY } from "./a4kit.mjs";
import * as scorer from "../server/scorer.js";
const NOW = Date.now(), job = scorer.jobs[0];
for (const days of [60, 150, 300]) {
  const { env, kit } = fresh(), r = rng(50), rows = [];
  for (let ago = days; ago >= 1; ago--) {
    const date = dayStr(ago, NOW), five = Array.from({ length: 5 }, () => cand(r)), liked = five.map((c) => calmShort(c, r)), top = liked.indexOf(Math.max(...liked));
    five.forEach((c, i) => rows.push({ i: `d${ago}-${i}`, g: date, t: noonOf(date), s: i === top ? 1 : 0, u: 0, x: `k${ago}-${i}`, ...c }));
  }
  env.MEDIA.set("scorer/log", { v: 1, rows, fold: null, histAt: 0, since: 0, back: "done", backTo: "" });
  for (let ago = 0; ago <= 8; ago++) env.MEDIA.set(`suggestions/${dayStr(ago, NOW)}`, Array.from({ length: 5 }, () => suggestion()));
  env.MEDIA.set("posts", Array.from({ length: 300 }, (_, n) => ({ id: "p" + n, state: "published", created: NOW - n * DAY, published: NOW - n * DAY, theme: pick(r, THEMES), tone: pick(r, TONES), quote: "q " + n, metrics: { reach: 900, total_interactions: 40 + n % 30 } })));
  for (let i = 0; i < 30; i++) await job.run(env, kit);      // warm up
  const cpu = [], wall = [];
  for (let i = 0; i < 60; i++) { const c = process.cpuUsage(), t = performance.now(); await job.run(env, kit); const d = process.cpuUsage(c); cpu.push((d.user + d.system) / 1000); wall.push(performance.now() - t); }
  cpu.sort((a, b) => a - b); wall.sort((a, b) => a - b);
  console.log(`${env.MEDIA.doc("scorer/log").rows.length} rows, ${Math.round(env.MEDIA.raw("scorer/log").length / 1024)} KB: wall best ${wall[0].toFixed(2)} median ${wall[30].toFixed(2)} ms; cpu best ${cpu[0].toFixed(2)} median ${cpu[30].toFixed(2)} ms`);
}
