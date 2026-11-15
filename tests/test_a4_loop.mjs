// Agent 4: the scorer in a closed loop, where what she sees depends on the scorer once it is live and she has a strong
// habit of taking the first card. Checks that the habit cannot switch it on or keep it on, that a clear taste still
// does, that the wildcard gets its chance, and that it lets go of a taste she has left.
// Run: bash tests/prepare.sh && node tests/test_a4_loop.mjs      (about a minute)
import { choose } from "../server/scorer.js";
import { lives, mid, mean, steady, turning, calmShort, none } from "./a4loop.mjs";
import { checker } from "./a4kit.mjs";
const { check, finish } = checker();
const N = 10;

console.log("The order of what it hands back");
{
  const q = (tag, tone, words, theme) => ({ text: tag + " " + Array.from({ length: words - 1 }, (_, i) => "w" + i).join(" "), author: "Writer " + tag, source: { type: "classic", title: "" }, theme, tone, verify: false });
  // a model that likes calm: the calm quotes stand 2nd, 5th, 7th and last in Nishiii's order
  const model = { v: 1, at: 1, base: [20, 80], feat: { tone: { calm: [18, 6], direct: [0, 20], wry: [1, 18], plain: [1, 18], tender: [0, 18] } }, aud: null };
  const pool = [q("A", "direct", 12, "work"), q("B", "calm", 12, "sea"), q("C", "wry", 12, "time"), q("D", "plain", 12, "home"), q("E", "calm", 12, "hope"),
    q("F", "tender", 12, "loss"), q("G", "calm", 12, "love"), q("H", "direct", 12, "self"), q("I", "hopeful", 12, "change"), q("J", "calm", 12, "courage")];
  const got = choose(model, pool, 5), tags = got.map((x) => x.text[0]);
  const wild = got.filter((x) => x.wild);
  check("the four calm quotes are kept, and one wildcard", ["B", "E", "G", "J"].every((t) => tags.includes(t)) && wild.length === 1 && !"BEGJ".includes(wild[0].text[0]), tags.join(""));
  check("they come back in Nishiii's order, not best-scored first", tags.join("") === tags.slice().sort().join(""), tags.join(""));
  check("the wildcard stands where Nishiii put it, not in the last place", tags[4] === "J" && !got[4].wild && got.findIndex((x) => x.wild) < 4, tags.join("") + ", wildcard " + (wild[0] && wild[0].text[0]));
  check("the pool itself is not changed (no mark left on Nishiii's own list)", pool.every((x) => !("wild" in x)));
  // fewer wanted than three: no wildcard, the best ones only; and nothing to choose from: handed back as it came
  check("two wanted: the two best, no wildcard", choose(model, pool, 2).map((x) => x.text[0]).join("") === "BE" && !choose(model, pool, 2).some((x) => x.wild));
  check("no more candidates than wanted: all of them, untouched", choose(model, pool.slice(0, 5), 5).map((x) => x.text[0]).join("") === "ABCDE" && !choose(model, pool.slice(0, 5), 5).some((x) => x.wild));
}

console.log("Made-up lives in a closed loop, with a strong habit of taking the first card");
{
  const out = lives(N, { taste: steady(none), habit: 2, insight: 0 });
  check("no taste at all, only the habit: it never switches on", out.every((o) => o.firstLive < 0), `${out.filter((o) => o.firstLive >= 0).length} of ${N}`);
}
{
  const out = lives(N, { taste: steady(calmShort), habit: 2, insight: 0.5 });
  console.log(`     clear taste: live ${(100 * mean(out.map((o) => o.live))).toFixed(0)}% of days; changes of state typical ${mid(out.map((o) => o.flips))}, most ${Math.max(...out.map((o) => o.flips))}; closer to her taste by ${mean(out.map((o) => o.gain)).toFixed(2)}; wildcard taken on ${(100 * mean(out.map((o) => o.wildRate))).toFixed(1)}% of live days`);
  check("a clear taste switches it on in every life, and it stays on", out.every((o) => o.firstLive >= 0 && o.flips === 1), JSON.stringify(out.map((o) => o.flips)));
  check("what she is shown is closer to her taste than Nishiii's first five", mean(out.map((o) => o.gain)) > 0.2, mean(out.map((o) => o.gain)).toFixed(2));
  check("the wildcard does get taken now and then", mean(out.map((o) => o.wildRate)) > 0.01, mean(out.map((o) => o.wildRate)).toFixed(3));
}
{
  const out = lives(N, { taste: turning, habit: 2, insight: 0.5 }), wrong = out.map((o) => o.wrongAfterTurn);
  console.log(`     her taste turns around: days still ranking by the taste she left: typical ${mid(wrong)}, most ${Math.max(...wrong)}; changes of state typical ${mid(out.map((o) => o.flips))}, most ${Math.max(...out.map((o) => o.flips))}`);
  check("after her taste turns, it lets go of the old one within about a month (typical)", mid(wrong) <= 30, String(mid(wrong)));
  check("and within seven weeks at the very most", Math.max(...wrong) <= 49, String(Math.max(...wrong)));
  check("without flipping back and forth", Math.max(...out.map((o) => o.flips)) <= 5, String(Math.max(...out.map((o) => o.flips))));
}
finish("scorer in a closed loop");
