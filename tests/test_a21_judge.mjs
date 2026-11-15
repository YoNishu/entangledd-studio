// Agent 21: the judge sees what a reader sees (server/said.js). A review quotes lines from the drama and also puts
// the reviewer's own words in quotation marks; the cheap checks cannot tell them apart, so the judge is shown, for
// each line, the words just before and after it on its page, who it is credited to and where it was found.
// The real cases of 16 Nov ("The early spring" reviews on MyDramaList), both kinds; then the stand-in judge
// (server/devparts/gate.mjs) answering from those words, and what an "unsure" verdict keeps.
// Run: node tests/test_a21_judge.mjs
import { kit } from "../server/worker.js";
import * as O from "../server/opensearch.js";
import * as S from "../server/said.js";
import * as G from "../server/devparts/gate.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 500)}`); if (!ok) failed += 1; };

const es = { title: "The early spring", real: "The Early Spring", type: "series", year: 2026, country: "Chinese", original: "早春晴朗",
  cast: ["Jing Boran", "Sun Qian"], characters: ["Luan Nian", "Shang Zhitao"] };
const SAID = ["In the height of summer, there are no ice sculptures.", "The first time I drove you home, it wasn't on my way. It never was.", "Have you ever missed me?"];
const ABOUT = ["Oh, this is going to be GOOD.", "Wait, that happened already?!", "The rest of the actors are fantastic, and the writing is top-notch."];
// A review page as the app reads it (MyDramaList's reviews through Tavily's Extract: markdown made plain).
const PAGE = O.mdText(`# The Early Spring (2026) Reviews
### Review 1
Story 9.0 Acting/Cast 9.0 Music 8.5 Rewatch Value 8.0
When the first episode ended I was like "${ABOUT[0]}" and I was right. The scene by the frozen lake: "${SAID[0]}" (Luan Nian)
### Review 2
Story 8.0 Episode twenty had me yelling at my screen, "${ABOUT[1]}" because the timeline jumps.
My favourite line of the show: "${SAID[1]}" I melted.
### Review 3
Honestly, "${ABOUT[2]}" And then, in the rain, she finally asks him "${SAID[2]}" and I cried.
[2](https://mydramalist.com/761231-zao-chun-qing-lang/reviews?page=2) [Last](https://mydramalist.com/761231-zao-chun-qing-lang/reviews?page=30)`);

// ---- 1. every candidate carries the words around it, from every path
const cand = O.extractLines(PAGE, { names: [...es.cast, ...es.characters] });
const texts = cand.map((c) => c.text);
check("all six quoted pieces are candidates", [...SAID, ...ABOUT].every((t) => texts.includes(t)), texts);
check("each carries up to 120 characters before and after it", cand.every((c) => c.ctx && typeof c.ctx.wb === "string" && typeof c.ctx.wa === "string" && c.ctx.wb.length <= 120 && c.ctx.wa.length <= 120 && (c.ctx.wb + c.ctx.wa).trim()), cand.map((c) => c.ctx));
check("the words before a remark are the reviewer's own", (cand.find((c) => c.text === ABOUT[0]) || { ctx: {} }).ctx.wb.endsWith("I was like "), cand.find((c) => c.text === ABOUT[0]));
check("a speaker in brackets after a line is who says it", (cand.find((c) => c.text === SAID[0]) || {}).by === "Luan Nian", cand.find((c) => c.text === SAID[0]));
const spoken = O.extractLines("== Quotes ==\nLuan Nian: You don't have to be perfect to be worthy of love.\nSome words after it on the page.", { names: es.characters, list: true });
check("a 'Name: line' and a list line carry them too", spoken.length && spoken.every((c) => c.ctx && "wb" in c.ctx && "wa" in c.ctx), spoken);
const pg = { text: PAGE, site: "mydramalist.com" };
const picked = S.contextOf(pg, SAID[1], "mdl");
check("a line Claude picked (found on the page by its words) carries them too", !!picked.wb && picked.wb.includes("favourite line") && /^"? I melted/.test(picked.wa || ""), picked);
check("the page's list of review pages is read from its links", O.lastPage(`[2](x/reviews?page=2) [Last](x/reviews?page=30)`) === 30);

// ---- 2. the cheap checks let both kinds through: only the judge, seeing the words around, can tell
const gated = cand.filter((c) => [...SAID, ...ABOUT].includes(c.text)).map((c) => ({ ...c, ctx: { ...c.ctx, place: "mdl" } }));
check("both kinds pass the cheap checks", gated.every((c) => S.isSaid(c, es, c.ctx).ok), gated.map((c) => [c.text, S.isSaid(c, es, c.ctx).why]));

// ---- 3. the question: each line with who, where, and the words before and after it
let asked = [];
const judgeKit = (answer) => ({ ...kit, claude: async (env, req) => { asked.push(req); return JSON.stringify(typeof answer === "function" ? answer(req) : answer); } });
const stand = (req) => G.answerJudge(req.messages[0].content).out;           // the stand-in judge (server/devparts/gate.mjs)
const env = { ANTHROPIC_API_KEY: "dev-key" };
const j = await judge(gated);
async function judge(lines) { asked = []; return S.judge(env, judgeKit(stand), es, lines); }
const q = asked[0].messages[0].content;
check("the question carries the words before and after each line", /\n {3}before: ".*I was like ?"/.test(q) && /\n {3}after: ".*I melted/.test(q), q);
check("and who it is credited to and where it was found", q.includes("credited to Luan Nian") && q.includes("found in a review of it"), q);
check("nothing of hers in it", !/Dhruuu|letmein|theentangledd/.test(q));
check("the judge is told: a reviewer's own words in quotation marks are 'about'", /reviewer's OWN words in quotation marks are "about"/.test(asked[0].system), asked[0].system);
check("and a line a reviewer quotes from the work is 'said'", /A line a reviewer quotes FROM the work is "said"/.test(asked[0].system), asked[0].system);

// ---- 4. the stand-in judge, seeing them, keeps the lines and refuses the remarks (both kinds of the real cases)
check("the three real lines stay", SAID.every((t) => j.kept.some((l) => l.text === t && l.is === "said")), j.kept);
check("the three remarks go", ABOUT.every((t) => !j.kept.some((l) => l.text === t)) && j.refused["judged about the work"] === 3, j);
for (const t of SAID) check(`  said: ${t}`, G.standInVerdict({ text: t, before: (gated.find((c) => c.text === t) || { ctx: {} }).ctx.wb }) === "said");
for (const t of ABOUT) check(`  about: ${t}`, G.standInVerdict({ text: t, before: (gated.find((c) => c.text === t) || { ctx: {} }).ctx.wb }) === "about");

// ---- 5. "unsure": kept, to check, only with the page's proof and one of the work's characters named for it
const u = await S.judge(env, judgeKit((req) => G.answerJudge(req.messages[0].content).out.map((x) => ({ ...x, is: "unsure" }))), es, gated);
check("unsure with proof and a named character: kept, marked to check", u.kept.length === 1 && u.kept[0].text === SAID[0] && u.kept[0].is === "unsure" && u.kept[0].verify === true, u.kept);
check("other unsure lines go", u.refused["judged unsure"] === gated.length - 1, u.refused);

console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exit(failed ? 1 : 0);
