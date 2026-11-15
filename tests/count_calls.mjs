// Prints the storage calls of the scorer's timed job, run after run, on a small made-up app (scratch, not a test).
import { fresh, suggestion, dayStr } from "./a4kit.mjs";
import * as scorer from "../server/scorer.js";
const { env, kit } = fresh(), job = scorer.jobs[0];
for (let ago = 1; ago <= 14; ago++) env.MEDIA.set(`suggestions/${dayStr(ago)}`, Array.from({ length: 5 }, (_, i) => suggestion({ state: i === 0 ? "used" : "new" })));
for (let run = 1; run <= 6; run++) {
  env.MEDIA.calls = [];
  const m = await job.run(env, kit);
  console.log(`run ${run}: ${env.MEDIA.calls.length} storage calls (${env.MEDIA.count("get")} reads, ${env.MEDIA.count("list")} listing, ${env.MEDIA.count("put")} writes); picks ${m.picks}; older days ${env.MEDIA.doc("scorer/log").back || "still being read"}`);
}
