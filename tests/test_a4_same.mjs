// Agent 4: until the scorer is live, the day's quotes and asked-for quotes are made exactly as they were before
// the scorer existed. The worker as it was at the starting commit (d576d40, unpacked into $STUDIO_OUT/base by tests/prepare.sh) and the worker
// as it is now are given the same storage and the same pretend Claude; every request to Claude and every storage
// call is written down and compared. Also counts the outside calls of the whole daily pass.
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
console.log(`     before the scorer: ${was.claude.length} requests to Claude, ${was.storage.length} storage calls; now: ${now.claude.length} and ${now.storage.length}`);
check("the same requests go to Claude, word for word (prompt, count asked for, room for the answer)", same(was.claude, now.claude) && was.claude.length === 2);
check("the same five quotes are stored", same(was.day, now.day) && now.day.length === 5, `${now.day.length} stored`);
check("no quote carries the wildcard mark", now.day.every((q) => !("wild" in q)));
check("storage: the one extra call is a single read of the scorer's model", !!without(own(now.storage), READ) && same(sorted(without(own(now.storage), READ)), sorted(was.storage)), `${now.storage.length} against ${was.storage.length}`);
check("the whole daily pass stays well inside fifty outside calls", now.storage.length + now.claude.length <= 40, `${now.storage.length + now.claude.length}`);

console.log("2. The same with a scorer that is still learning, or whose model cannot be believed");
const learning = { v: 1, at: NOW, seen: 0, state: "learning", since: NOW, back: 0, picks: 49, passes: 150, base: [40, 120], feat: { tone: { calm: [30, 10] } }, eval: { days: 30, mean: 0.7, z: 5, recent: 0.7 }, aud: null, lately: "" };
const cases = [
  ["49 picks, learning", { "scorer/model": learning }],
  ["a model that says live with only 49 picks", { "scorer/model": { ...learning, state: "live" } }],
  ["a live model that nobody has rebuilt for four days", { "scorer/model": { ...learning, state: "live", picks: 80, at: NOW - 4 * DAY } }],
  ["a model damaged beyond reading", { "scorer/model": "{ not json" }],
  ["a model of the wrong shape", { "scorer/model": { v: 1, state: "live", picks: 80, base: "oops", feat: null, at: NOW } }],
  ["a model that is not an object", { "scorer/model": [1, 2, 3] }],
];
for (const [name, extra] of cases) {
  const got = await daily(head, world(extra));
  check(`${name}: same requests to Claude, same five quotes`, same(got.claude, was.claude) && same(got.day, was.day), `${got.claude.length} requests, ${got.day.length} quotes`);
}
{
  const env = world({ "scorer/model": { ...learning, state: "live", picks: 80 } });
  env.MEDIA.fail("get", "scorer/model", 5);
  const got = await daily(head, env);
  check("a model that cannot be loaded just now: same requests, same five quotes", same(got.claude, was.claude) && same(got.day, was.day), `${got.day.length} quotes`);
}

{
  const got = await daily(head, world({ "scorer/model": { ...learning, state: "live", picks: 80, at: NOW - 2 * DAY } }));
  check("(the check above is not empty: the same model rebuilt two days ago does rank)", got.day.filter((q) => q.wild).length === 1 && !same(got.claude, was.claude));
}

console.log("3. An asked-for batch of five");
const askedWas = await ask(base, world()), askedNow = await ask(head, world());
check("it answers", askedWas.status === 200 && askedNow.status === 200, `${askedWas.status} ${askedNow.status}`);
check("the same request goes to Claude, word for word", same(askedWas.claude, askedNow.claude) && askedNow.claude.length === 1);
check("the same quotes come back", same(askedWas.items, askedNow.items) && askedNow.items.length === 5, `${askedNow.items.length}`);
check("storage: the one extra call is a single read of the scorer's model", !!without(own(askedNow.storage), READ) && same(sorted(without(own(askedNow.storage), READ)), sorted(askedWas.storage)), `${askedNow.storage.length} against ${askedWas.storage.length}`);

console.log("4. Once live: what changes, and what it costs");
{
  const live = { ...learning, state: "live", picks: 60 };
  const got = await daily(head, world({ "scorer/model": live }));
  const asked = got.claude.find((c) => /^Suggest \d+ quotes/.test(c.body.messages[0].content)), silent = was.claude.find((c) => /^Suggest \d+ quotes/.test(c.body.messages[0].content));
  console.log(`     live: "${asked.body.messages[0].content.slice(0, 17)}", room ${asked.body.max_tokens}; silent: "${silent.body.messages[0].content.slice(0, 17)}", room ${silent.body.max_tokens}`);
  check("still one request for the day's quotes, no extra one", got.claude.length === was.claude.length);
  check("it asks for twice as many (8 for the 4 places beside her own line), with more room", /^Suggest 8 quotes/.test(asked.body.messages[0].content) && asked.body.max_tokens === 4500 && JSON.parse(asked.body.messages[0].content.split("as JSON:\n")[1]).count === 8);
  check("nothing else in the request changes", same({ ...silent.body, max_tokens: 0, messages: 0 }, { ...asked.body, max_tokens: 0, messages: 0 }));
  check("five quotes are stored, one marked as the wildcard", got.day.length === 5 && got.day.filter((q) => q.wild).length === 1, `${got.day.length}, ${got.day.filter((q) => q.wild).length} wild`);
  check("her own line still comes first, untouched", got.day[0].source.type === "own" && !got.day[0].wild);
  check("no more storage calls than while learning", own(got.storage).length === own(now.storage).length, `${own(got.storage).length} against ${own(now.storage).length}`);
}
finish("before it is live, quotes are made exactly as before");
