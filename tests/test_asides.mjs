// A reviewer's aside inside a quoted line is not part of the line (real cases, 16 Nov 2026), and a line the page
// credits to one of the work's characters is kept, to check, even when the judge calls it a remark about the work.
import assert from "node:assert";
import * as S from "../server/said.js";
let bad = 0;
const check = (name, ok, got) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "   [" + JSON.stringify(got) + "]"}`); if (!ok) bad += 1; };
const cases = [
  ["Have I ever hit you? (ICK!)", "Have I ever hit you?"],
  ["No...I just wish you could be this gentle with me more often. (HOW HAS SHE ENDURED?!?)", "No...I just wish you could be this gentle with me more often."],
  ["So you like someone who's soft? (WHAT?! HOW DOES HE NOT KNOW?!?)", "So you like someone who's soft?"],
  ["You have become someone I trust. (JUST DIDN'T FEEL GOOD LIST", "You have become someone I trust."],
  ["I waited [lol] for the tide.", "I waited for the tide."],
  ["She said it softly (to her mother) and left.", "She said it softly (to her mother) and left."],
  ["You don't have to be perfect to be worthy of love.", "You don't have to be perfect to be worthy of love."],
];
for (const [from, to] of cases) check(`aside: ${from.slice(0, 44)}`, S.withoutAsides(from) === to, S.withoutAsides(from));
const work = { title: "The Early Spring", real: "The Early Spring", type: "series", year: 2026, characters: ["Luan Nian", "Shang Zhitao"], cast: ["Sun Qian"] };
const ctx = { place: "mdl", quoted: true, before: "", after: "" };
const env = { ANTHROPIC_API_KEY: "k" };
const kit = { parseJson: (t) => JSON.parse(t), claude: async () => JSON.stringify([{ n: 1, is: "about" }, { n: 2, is: "about" }, { n: 3, is: "about" }]) };
const r = await S.judge(env, kit, work, [
  { text: "In the height of summer, there are no ice sculptures.", by: "Luan Nian", ctx },
  { text: "Dr. Cutie and Love Song in Winter, with the last being my favourite.", by: "Sun Qian", ctx },
  { text: "Oh, this is going to be GOOD.", by: "", ctx }], {});
check("a character's own line the judge called a remark is kept, to check", r.kept.length === 1 && r.kept[0].text.startsWith("In the height") && r.kept[0].verify === true, r.kept);
check("an actor's name is not a character's: refused; a reviewer's remark: refused", r.refused["judged about the work"] === 2, r.refused);
console.log(bad ? `FAIL (${bad})` : "all ok");
process.exit(bad ? 1 : 0);
