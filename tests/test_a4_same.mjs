// Agent 4, updated by Agent 9: there is no longer a time "before it is live" (Nishith's rule: the engine ranks from the
// first day), so this no longer compares with the worker as it was at d576d40. It now checks that a scorer model in any
// state (none, learning, old, damaged, of the wrong shape, unreadable) never stops the day: five quotes, one request to
// Claude for them, a reason on each, the picks part simply left out when the model can't be believed; and it counts the
// outside calls of the daily pass and of an asked-for batch. The older worker is still loaded, for the call counts.
// Run: bash tests/prepare.sh && node tests/test_a4_same.mjs
import { Bucket, checker, suggestion, DAY, dateOf } from "./a4kit.mjs";
const OUT = process.env.STUDIO_OUT || "/tmp/studio-tests";       // where tests/prepare.sh puts the code as it once was
const base = (await import(OUT + "/base/server/worker.js")).default;
const head = (await import("../server/worker.js")).default;
const { check, finish } = checker();
const NOW = Date.now();

// The pretend Claude: answers "suggest N quotes" with N quotes, anything else with a small profile.
let sent = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  // The rule about lines already found for her works (server/findlines.js) came later than the scorer and is not
  // the scorer's doing: it is set aside, so the comparison stays about the scorer alone.
  const system = typeof body.system === "string" ? body.system.split("\n").filter((l) => !l.startsWith('- "foundLines"')).join("\n") : body.system;
  sent.push({ url: String(url), body: { ...body, system } });
  let text = JSON.stringify({ summary: "You like quiet lines.", loves: ["the sea"], avoids: [], voice: [], look: [], performs: [] });
  const said = body.messages[0].content;
  const m = typeof said === "string" && said.match(/^Suggest (\d+) quotes/);
  if (m) text = JSON.stringify(Array.from({ length: Number(m[1]) }, (_, i) => ({ text: `Line ${i + 1} about the tide and what it leaves`, author: `Writer ${i % 3}`,
    source: { type: i % 2 ? "book" : "classic", title: i % 2 ? "The Sea Book" : "" }, theme: ["sea", "time", "home"][i % 3], tone: ["calm", "wry"][i % 2], verify: false })));
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200, headers: { "content-type": "application/json" } });
};

// The same starting storage for both: a little of everything the suggestion code reads.
function world(extra = {}) {
  const MEDIA = new Bucket();
  MEDIA.set("library", { books: [{ id: "b1", title: "The Sea Book", author: "A. Writer" }], screen: [{ id: "s1", kind: "film", title: "Tide" }], quotes: [{ id: "q1", text: "My own line about the shore", author: "" }] });
  MEDIA.set("history", Array.from({ length: 12 }, (_, i) => ({ text: `Old line ${i}`, author: "Someone", theme: "sea", tone: "calm", source: "classic", action: i % 3 ? "used" : "rejected", at: NOW - (20 - i) * DAY })));
  MEDIA.set("taste", { profile: { summary: "You like quiet lines.", loves: ["the sea"] }, notes: [{ id: "n1", text: "no hustle" }], updatedAt: NOW - DAY });
  MEDIA.set("inspirations", [{ id: "i1", kind: "reel", handle: "somepage", quote: "A line she loved elsewhere", top: [] }]);
  for (const [name, value] of Object.entries(extra)) MEDIA.set(name, value);
  return { MEDIA, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_API: "http://claude.test", APP_PASSCODE: "letmein" };
}
async function daily(worker, env) {
  sent = []; env.MEDIA.calls = [];
  const waits = [];
  await worker.scheduled({ cron: "30 0 * * *" }, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { claude: sent, storage: env.MEDIA.calls.slice(), day: (env.MEDIA.doc(`suggestions/${dateOf(Date.now())}`) || []).map(({ id, ...rest }) => rest) };
}
async function ask(worker, env) {
  const login = await worker.fetch(new Request("http://app.test/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: "letmein" }) }), env);
  const token = (await login.json()).token;
  sent = []; env.MEDIA.calls = [];
  const res = await worker.fetch(new Request("http://app.test/api/asked", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ about: "the sea", count: 5 }) }), env);
  const out = await res.json();
  return { status: res.status, claude: sent, storage: env.MEDIA.calls.slice(), items: (out.items || []).map(({ id, askedAt, ...rest }) => rest) };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const without = (calls, key) => { const i = calls.findIndex((c) => c === key); return i < 0 ? null : [...calls.slice(0, i), ...calls.slice(i + 1)]; };
const READ = "get data/scorer/model.json";
const sorted = (list) => list.slice().sort();
// The health section reads its own notes once after a call to Claude; that read is not the scorer's.
// Left out of the comparison: the health record's note, and the day's count of questions to Claude (one read
// and one write per question, which is what keeps a ceiling on the spending).
const own = (list) => list.filter((c) => c !== "get data/healthnotes.json" && !c.endsWith(" data/claudeuse.json"));

console.log("1. The daily pass (insights, taste, the day's five) with no scorer record at all");
const was = await daily(base, world()), now = await daily(head, world());
const quoteAsks = (r) => r.claude.filter((c) => /^Suggest \d+ quotes/.test(c.body.messages[0].content));
console.log(`     the old worker: ${was.claude.length} requests to Claude, ${was.storage.length} storage calls; now: ${now.claude.length} and ${now.storage.length}`);
check("one request to Claude for the day's quotes, as before", quoteAsks(now).length === 1 && now.claude.length === was.claude.length);
check("five quotes are stored, one marked as the wildcard, each with its reason", now.day.length === 5 && now.day.filter((q) => q.wild).length === 1 && now.day.every((q) => typeof q.why === "string"), `${now.day.length} stored`);
check("her own line is among them", now.day.filter((q) => q.source.type === "own").length === 1);
check("the whole daily pass stays well inside fifty outside calls", now.storage.length + now.claude.length <= 40, `${now.storage.length + now.claude.length}`);
check("the engine's extra reads are side by side, a handful", own(now.storage).length - was.storage.length <= 6, `${own(now.storage).length} against ${was.storage.length}`);

console.log("2. A scorer model in any state never stops the day");
const learning = { v: 1, at: NOW, seen: 0, state: "learning", since: NOW, back: 0, picks: 49, passes: 150, base: [40, 120], feat: { tone: { calm: [30, 10] } }, eval: { days: 30, mean: 0.7, z: 5, recent: 0.7 }, aud: null, lately: "" };
const cases = [
  ["49 picks, learning", { "scorer/model": learning }, true],
  ["a model that says live", { "scorer/model": { ...learning, state: "live" } }, true],
  ["a model nobody has rebuilt for four days", { "scorer/model": { ...learning, state: "live", picks: 80, at: NOW - 4 * DAY } }, true],
  ["a model that tests clearly worse than chance", { "scorer/model": { ...learning, state: "resting", eval: { days: 30, mean: 0.3, z: -4, recent: 0.3 } } }, false],
  ["a model damaged beyond reading", { "scorer/model": "{ not json" }, false],
  ["a model of the wrong shape", { "scorer/model": { v: 1, state: "live", picks: 80, base: "oops", feat: null, at: NOW } }, false],
  ["a model that is not an object", { "scorer/model": [1, 2, 3] }, false],
];
for (const [name, extra, counts] of cases) {
  const got = await daily(head, world(extra));
  const picksSaid = got.day.some((q) => /You often pick/.test(q.why || ""));
  check(`${name}: five quotes, one request for them`, got.day.length === 5 && quoteAsks(got).length === 1, `${quoteAsks(got).length} requests, ${got.day.length} quotes`);
  if (!counts) check(`${name}: its picks are left out of the reasons`, !picksSaid, got.day.map((q) => q.why));
}
{
  const env = world({ "scorer/model": { ...learning, state: "live", picks: 80 } });
  env.MEDIA.fail("get", "scorer/model", 5);
  const got = await daily(head, env);
  check("a model that cannot be loaded just now: still five", got.day.length === 5, `${got.day.length} quotes`);
}
{
  const got = await daily(head, world({ "scorer/model": { ...learning, state: "live", picks: 120, passes: 400, base: [120, 400], feat: { tone: { calm: [110, 40], wry: [10, 360] } } } }));
  check("(not empty: a model with clear evidence for calm lines is named in the reasons)", got.day.some((q) => /You often pick calm lines/.test(q.why || "")), got.day.map((q) => [q.tone, q.why]));
}

console.log("3. An asked-for batch of five");
const askedNow = await ask(head, world());
check("it answers with five, each with its reason", askedNow.status === 200 && askedNow.items.length === 5 && askedNow.items.every((q) => "why" in q), `${askedNow.status} ${askedNow.items.length}`);
check("one request to Claude", askedNow.claude.length === 1);
check("and stays well inside fifty outside calls", askedNow.storage.length + askedNow.claude.length <= 30, `${askedNow.storage.length}`);
finish("a scorer model in any state never stops the day");
