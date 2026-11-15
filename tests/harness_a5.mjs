// Close-up checks of server/lovenotes.js: the sealing code and the open key address, run against a
// pretend storage that can be slowed, failed and watched. Only made-up notes.
//   node tests/harness_a5.mjs            (run by test_a5_review.py)
//   A5_REPO=/some/other/copy node ...      checks another copy of the code (used to prove the checks bite)
import { cp, mkdir, writeFile, rm } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";

const REPO = process.env.A5_REPO || fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const KEY = "data/sealkey.json", NOTES = "data/lovenotes.json";
const MIN = 60 * 1000;
const PER_PASS = 4;                  // how many deliveries one request or job run opens (as in server/lovenotes.js)

// ---------- watching everything that could leak or cost ----------
let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;

const logged = [];
for (const name of ["log", "error", "warn", "info"]) {
  console[name] = (...args) => logged.push(args.map((a) => (a instanceof Error ? `${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
}
const say = (line) => process.stdout.write(line + "\n");

const work = { generateKey: 0, deriveBits: 0, decrypt: 0, encrypt: 0, digest: 0, importKey: 0 };
const breakCrypto = { decrypt: 0 };
const privates = new Set();          // every private key this process ever exported, kept or thrown away
for (const name of Object.keys(work)) {
  const real = crypto.subtle[name].bind(crypto.subtle);
  crypto.subtle[name] = (...args) => {
    work[name]++;
    if (breakCrypto[name] > 0) { breakCrypto[name]--; return Promise.reject(new Error("this runtime can't do that")); }
    return real(...args);
  };
}
const realExport = crypto.subtle.exportKey.bind(crypto.subtle);
crypto.subtle.exportKey = async (format, key) => {
  const out = await realExport(format, key);
  if (format === "jwk" && out.d) privates.add(out.d);
  return out;
};
const workNow = () => ({ ...work });
const workSince = (before, names = Object.keys(work)) => names.reduce((n, k) => n + work[k] - before[k], 0);

// ---------- pretend storage ----------
const stores = [];                   // every pretend storage this run made
class Store {
  // condition: what this storage does with "keep it only if nothing is there yet":
  //   "honoured" (as Cloudflare's does), "ignored" (writes anyway), "refused" (never writes), "throws"
  constructor(condition = "honoured") { this.objects = new Map(); this.ops = []; this.condition = condition; this.gates = []; this.breaks = []; this.conditional = 0; stores.push(this); }
  view(who) { return { get: (k, o) => this.get(who, k, o), put: (k, b, o) => this.put(who, k, b, o) }; }
  // The next <op> on <key> by <who> stops when it starts and waits for release().
  pause(who, op, key) {
    const g = { who, op, key, used: false };
    g.reached = new Promise((r) => (g.hit = r));
    g.wait = new Promise((r) => (g.release = r));
    this.gates.push(g);
    return g;
  }
  breakNext(op, key, times = 1) { this.breaks.push({ op, key, times }); }
  async before(who, op, key) {
    this.ops.push(`${who} ${op} ${key}`);
    const g = this.gates.find((x) => x.who === who && x.op === op && x.key === key && !x.used);
    if (g) { g.used = true; g.hit(); await g.wait; }
    const b = this.breaks.find((x) => x.op === op && x.key === key && x.times > 0);
    if (b) { b.times--; throw new Error("storage could not be reached"); }
  }
  async get(who, key) {
    await this.before(who, "get", key);
    const v = this.objects.get(key);
    return v === undefined ? null : { json: async () => JSON.parse(v), text: async () => v };
  }
  async put(who, key, body, opts = {}) {
    await this.before(who, "put", key);
    if (opts.onlyIf instanceof Headers && opts.onlyIf.get("If-None-Match") === "*") {
      this.conditional++;
      if (this.condition === "throws") throw new TypeError("this storage takes no conditions");
      if (this.condition === "refused") return null;
      if (this.condition === "honoured" && this.objects.has(key)) return null;
    }
    this.objects.set(key, String(body));
    return { key };
  }
  doc(key) { const v = this.objects.get(key); return v === undefined ? null : JSON.parse(v); }
  opsOn(key, op) { return this.ops.filter((o) => o.endsWith(` ${key}`) && (!op || o.split(" ")[1] === op)).length; }
}

class UserError extends Error { constructor(status, message) { super(message); this.status = status; } }
const kit = {
  json: (data, status = 200) => new Response(JSON.stringify(data), { status }),
  fail: (status, message) => new Response(JSON.stringify({ error: message }), { status }),
  UserError,
  body: async (request) => { try { return await request.json(); } catch (e) { throw new UserError(400, "That request couldn't be read."); } },
  loadDoc: async (env, name, fallback) => { const o = await env.MEDIA.get(`data/${name}.json`); return o ? o.json() : fallback; },
  saveDoc: (env, name, doc) => env.MEDIA.put(`data/${name}.json`, JSON.stringify(doc), { httpMetadata: { contentType: "application/json" } }),
  todayIST: () => new Date(Date.now() + 5.5 * 60 * MIN).toISOString().slice(0, 10),
};

// A new running copy of the server code, with its own memory (as a fresh start on Cloudflare has).
let copies = 0;
const copy = (root = REPO) => import(pathToFileURL(`${root}/server/lovenotes.js`).href + `?copy=${++copies}`);
const box = await import(pathToFileURL(`${REPO}/server/sealbox.js`).href);

const said = [];                     // every answer the server gave, as text
// One request, the way worker.js would hand it over. Returns { status, out }.
async function call(mod, media, method, path, body) {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const request = new Request("http://app.test/api/" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const handler = (mod.open && mod.open[parts[0]]) || mod.routes[parts[0]];
  let res;
  try { res = await handler(request, { MEDIA: media }, parts, kit); }
  catch (e) {
    if (e instanceof UserError) res = kit.fail(e.status, e.message);
    else { logged.push(String(e && e.stack)); res = kit.fail(500, "Something went wrong on our side. Try again."); }   // as worker.js does
  }
  const text = await res.text();
  said.push(text);
  return { status: res.status, out: JSON.parse(text) };
}

const results = [];
function ok(cond, label, detail) {
  results.push(!!cond);
  say((cond ? "  ok   " : "  FAIL ") + label + (!cond && detail !== undefined ? `  [${typeof detail === "string" ? detail : JSON.stringify(detail)}]`.slice(0, 400) : ""));
}
const group = (name) => say(name);
const sealFor = (store, payload) => box.seal(store.doc(KEY).publicHex, typeof payload === "string" ? payload : JSON.stringify(payload));
const noteTexts = (store) => ((store.doc(NOTES) || {}).notes || []).map((n) => n.text);
const add = (...texts) => ({ v: 1, mode: "add", notes: texts.map((text) => ({ text })) });

// ======================= the key: made once, whatever happens at the start =======================
group("two first calls at the same moment");
for (const condition of ["honoured", "ignored"]) {
  const store = new Store(condition);
  const A = await copy(), B = await copy();
  const gA = store.pause("A", "put", KEY), gB = store.pause("B", "put", KEY);
  const pA = call(A, store.view("A"), "GET", "seal-key"), pB = call(B, store.view("B"), "GET", "seal-key");
  await Promise.all([gA.reached, gB.reached]);       // both found no key, both made one, both are about to store theirs
  gA.release(); const a = await pA;                   // A stores its pair, reads back, answers
  gB.release(); const b = await pB;                   // only now does B's write arrive
  const stored = store.doc(KEY).publicHex;
  if (condition === "honoured") {
    ok(a.status === 200 && b.status === 200 && a.out.key === b.out.key && a.out.key === stored,
      "both are handed the same key, the one that was stored first", [a.out.key === stored, b.out.key === stored]);
    ok(store.conditional === 2 && store.opsOn(KEY, "put") === 2, "(each asked storage to keep its pair only if none was there)", store.ops);
  } else {
    ok(b.out.key === stored, "storage that ignores the condition: the later writer is handed what is stored");
  }
  const a2 = await call(A, store.view("A"), "GET", "seal-key"), b2 = await call(B, store.view("B"), "GET", "seal-key");
  ok(a2.out.key === stored && b2.out.key === stored, `asked again, both copies hand out the stored key (storage: condition ${condition})`, [a2.out.key === stored, b2.out.key === stored]);
  ok(a2.out.check === (await box.keyCheck(stored)) && a2.out.groups.replace(/ /g, "") === stored, "(with its check and its grouped form)");
}

group("storage that won't take a condition at all");
for (const condition of ["refused", "throws"]) {
  const store = new Store(condition);
  const C = await copy();
  const first = await call(C, store.view("C"), "GET", "seal-key");
  const again = await call(C, store.view("C"), "GET", "seal-key");
  ok(first.status === 200 && store.doc(KEY) && first.out.key === store.doc(KEY).publicHex && again.out.key === first.out.key,
    `condition ${condition}: the key is still made, kept and handed out`, first);
}

group("a key is tried out before it is kept");
{
  const store = new Store();
  const C = await copy();
  breakCrypto.decrypt = 1;                            // the very next attempt to open anything fails
  const bad = await call(C, store.view("C"), "GET", "seal-key");
  ok(bad.status === 503 && /key isn't ready/.test(bad.out.error) && !store.objects.has(KEY) && store.opsOn(KEY, "put") === 0,
    "a pair that can't open its own test delivery is not stored and not handed out", [bad, store.ops]);
  const opsBefore = store.ops.length, workBefore = workNow();
  const soon = await call(C, store.view("C"), "GET", "seal-key");
  ok(soon.status === 503 && store.ops.length === opsBefore && workSince(workBefore) === 0, "asked again at once: no work at all, the same plain answer", [soon.status, store.ops.slice(opsBefore), workSince(workBefore)]);
  skew += MIN + 1000;
  const later = await call(C, store.view("C"), "GET", "seal-key");
  ok(later.status === 200 && later.out.key === store.doc(KEY).publicHex, "a minute later it is made properly");
}

group("a damaged key document");
for (const damaged of [{}, { publicHex: "zz", privateJwk: {} }, "nonsense", { v: 1, publicHex: "04" + "g".repeat(128) }]) {
  const store = new Store();
  store.objects.set(KEY, JSON.stringify(damaged));
  const C = await copy();
  const out = await call(C, store.view("C"), "GET", "seal-key");
  ok(out.status === 503 && store.objects.get(KEY) === JSON.stringify(damaged) && store.opsOn(KEY, "put") === 0,
    `${JSON.stringify(damaged).slice(0, 30)}: a plain "not ready", and the document is left alone (never overwritten)`, [out, store.ops]);
  const opsBefore = store.ops.length;
  await call(C, store.view("C"), "GET", "seal-key");
  ok(store.ops.length === opsBefore, "  asked again at once: storage is not even read");
}

// ======================= the open address does next to nothing =======================
group("what a call to the open key address costs");
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  ok(store.ops.join(", ") === `C get ${KEY}, C put ${KEY}, C get ${KEY}`, "the first call ever: look, store, read back", store.ops);
  await call(C, store.view("C"), "GET", "seal-key");
  ok(store.ops.length === 4 && store.ops[3] === `C get ${KEY}`, "the second: one read (a key made a moment ago is taken from storage, not from memory)", store.ops);
  let opsBefore = store.ops.length, workBefore = workNow();
  const keys = new Set();
  for (let i = 0; i < 200; i++) keys.add((await call(C, store.view("C"), "GET", `seal-key?n=${i}`)).out.key);
  ok(store.ops.length === opsBefore && workSince(workBefore) === 0 && keys.size === 1, "200 more calls: no storage, no computing, the same key", [store.ops.length - opsBefore, workSince(workBefore)]);
  skew += 5 * MIN + 1000;
  opsBefore = store.ops.length;
  for (let i = 0; i < 20; i++) await call(C, store.view("C"), "GET", "seal-key");
  ok(store.ops.slice(opsBefore).join() === `C get ${KEY}`, "five minutes on: one read, then quiet again", store.ops.slice(opsBefore));

  // with a delivery waiting
  const delivery = await sealFor(store, add("We met at the bakery.", "You still owe me a rematch at carrom."));
  C.setDeliveries([delivery]);
  opsBefore = store.ops.length; workBefore = workNow();
  const first = await call(C, store.view("C"), "GET", "seal-key");
  ok(first.out.deliveries.applied === 1 && store.ops.slice(opsBefore).join(", ") === `C get ${NOTES}, C get ${KEY}, C put ${NOTES}` && work.decrypt - workBefore.decrypt === 1,
    "a waiting delivery is opened by the first call: two reads, one write, one opening", [first.out, store.ops.slice(opsBefore)]);
  opsBefore = store.ops.length; workBefore = workNow();
  for (let i = 0; i < 200; i++) await call(C, store.view("C"), "GET", "seal-key");
  ok(store.ops.length === opsBefore && workSince(workBefore) === 0, "200 more calls: nothing is read, written or opened again");
  const D = await copy(); D.setDeliveries([delivery]);
  opsBefore = store.ops.length; workBefore = workNow();
  let d;
  for (let i = 0; i < 50; i++) d = await call(D, store.view("D"), "GET", "seal-key");
  ok(d.out.deliveries.applied === 1 && store.ops.slice(opsBefore).join(", ") === `D get ${KEY}, D get ${NOTES}` && work.decrypt === workBefore.decrypt,
    "a fresh copy of the server, called 50 times: two reads in all, no write, nothing opened", store.ops.slice(opsBefore));
  ok(store.opsOn(KEY, "put") === 1 && store.opsOn(NOTES, "put") === 1, "all told: the key was written once and the notes once");
  ok(noteTexts(store).join("|") === "We met at the bakery.|You still owe me a rematch at carrom.", "(and the notes are in)");
}

// ======================= a delivery counts only once storage holds it =======================
group("a save that fails");
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  C.setDeliveries([await sealFor(store, add("The kite that got away is still flying somewhere."))]);
  store.breakNext("put", NOTES);
  const first = await call(C, store.view("C"), "GET", "seal-key");
  ok(first.status === 200 && first.out.key === store.doc(KEY).publicHex, "the key address still answers with the key", first);
  ok(JSON.stringify(first.out.deliveries) === JSON.stringify({ applied: 0, failed: 0, waiting: 1 }) && !store.objects.has(NOTES),
    "and says the delivery is still waiting: it is not called applied before storage holds it", first.out.deliveries);
  const opsBefore = store.ops.length, workBefore = workNow();
  const soon = await call(C, store.view("C"), "GET", "seal-key");
  ok(soon.out.deliveries.waiting === 1 && store.ops.length === opsBefore && workSince(workBefore) === 0, "asked again at once, the open address does not try again (no storage, no opening)", store.ops.slice(opsBefore));
  await C.jobs[0].run({ MEDIA: store.view("job") }, kit);
  ok(store.ops.length === opsBefore, "nor does the timed job, for that minute");
  skew += MIN + 1000;
  const later = await call(C, store.view("C"), "GET", "seal-key");
  ok(later.out.deliveries.applied === 1 && noteTexts(store).length === 1, "a minute later it is tried again and goes in", later.out.deliveries);
}
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  C.setDeliveries([await sealFor(store, add("The yellow scooter was the best idea we ever had."))]);
  store.breakNext("put", NOTES);
  const first = await call(C, store.view("her"), "GET", "lovenotes/next?today=" + kit.todayIST());
  ok(first.status === 200 && JSON.stringify(first.out) === "{}" && !store.objects.has(NOTES),
    "her own request while the save fails: no error, and no note from a delivery that isn't stored yet", first);
  const second = await call(C, store.view("her"), "GET", "lovenotes/next?today=" + kit.todayIST());
  ok(second.out.text === "The yellow scooter was the best idea we ever had." && store.doc(NOTES).sealed.length === 1, "her next request brings it in and shows it", second.out);
}
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  C.setDeliveries([await sealFor(store, add("A delivered note."))]);
  const refused = await call(C, store.view("her"), "POST", "lovenotes", { text: "   " });
  ok(refused.status === 400 && noteTexts(store).join() === "A delivered note." && store.doc(NOTES).sealed.length === 1,
    "a request that is refused for its own reasons still leaves the delivery stored (it is not opened all over again next time)", [refused, noteTexts(store)]);
  const workBefore = workNow();
  await call(C, store.view("her"), "GET", "lovenotes");
  ok(work.decrypt === workBefore.decrypt, "(nothing is opened on the next request)");
}
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  C.setDeliveries([await sealFor(store, add("Unreachable for a moment."))]);
  store.breakNext("get", NOTES);
  const first = await call(C, store.view("C"), "GET", "seal-key");
  ok(first.status === 200 && first.out.deliveries.waiting === 1, "storage that can't be read: the key address still answers, the delivery waits", first);
  store.breakNext("get", KEY);
  skew += MIN + 1000;
  const second = await call(C, store.view("her"), "GET", "lovenotes");
  ok(second.status === 200 && second.out.notes.length === 0 && second.out.deliveries.length === 0, "the key can't be read while a delivery waits: her list still loads, the delivery is not marked as failed", second);
  const third = await call(C, store.view("her"), "GET", "lovenotes");
  ok(third.out.notes.length === 1 && third.out.deliveries[0].ok === true, "and it goes in as soon as storage answers again", third.out);
}

// ======================= hostile and malformed deliveries =======================
group("deliveries made to break things");
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  await call(C, store.view("her"), "POST", "lovenotes", { text: "A note that was already here." });
  const deep = (n) => "[".repeat(n) + "]".repeat(n);
  const hostile = {
    "text nested 20,000 deep": `{"mode":"add","notes":[{"text":${deep(20000)}}]}`,
    "date nested 20,000 deep": `{"mode":"add","notes":[{"text":"fine","date":${deep(20000)}}]}`,
    "text that is a list": { mode: "add", notes: [{ text: ["smuggled", "words"] }] },
    "text that is an object": { mode: "add", notes: [{ text: { toString: "x" } }] },
    "text that is a number": { mode: "add", notes: [{ text: 12345 }] },
    "text that is true": { mode: "add", notes: [{ text: true }] },
    "a date that is a number": { mode: "add", notes: [{ text: "fine", date: 20200303 }] },
    "a date wrapped in a list": { mode: "add", notes: [{ text: "fine", date: ["2020-03-03"] }] },
    "a note that is null": { mode: "add", notes: [null] },
    "a note that is bare text": { mode: "add", notes: ["fine"] },
    "notes that only look like a list": { mode: "add", notes: { length: 1, 0: { text: "fine" } } },
    "mode hidden in __proto__": `{"__proto__":{"mode":"add"},"notes":[{"text":"fine"}]}`,
    "nothing but null": "null",
    "a bare list": "[]",
    "a bare number": "42",
    "one good note then one bad": { mode: "replace", notes: [{ text: "fine" }, { text: 7 }] },
    "one too many notes": { mode: "add", notes: Array.from({ length: 61 }, (_, i) => ({ text: `fine ${i}` })) },
  };
  const boxes = [];
  for (const payload of Object.values(hostile)) boxes.push(await sealFor(store, payload));
  const names = Object.keys(hostile);
  let passes = 0, list;
  C.setDeliveries(boxes);
  do { list = await call(C, store.view("her"), "GET", "lovenotes"); passes++; } while (list.out.deliveries.length < boxes.length && passes < 10);
  ok(list.status === 200 && list.out.deliveries.length === boxes.length && passes === Math.ceil(boxes.length / PER_PASS), `all ${boxes.length} are dealt with, ${PER_PASS} to a request, and no request fails`, [list.status, passes, list.out.deliveries && list.out.deliveries.length]);
  const wrong = names.filter((_, i) => !(list.out.deliveries[i] && list.out.deliveries[i].ok === false && /isn't a usable list/.test(list.out.deliveries[i].why)));
  ok(wrong.length === 0, "each is recorded as opened but not usable", wrong);
  ok(list.out.notes.map((n) => n.text).join() === "A note that was already here.", "and not one word of them is kept (not even the good note beside a bad one)", list.out.notes);
  ok(!/smuggled|fine|12345|object Object/.test(JSON.stringify(store.doc(NOTES))), "(nor stored anywhere)");
  await call(C, store.view("C"), "GET", "seal-key");          // (so the public half is in this copy's memory)
  const opsBefore = store.ops.length, workBefore = workNow();
  for (let i = 0; i < 5; i++) await call(C, store.view("her"), "GET", "lovenotes");
  await call(C, store.view("her"), "GET", "lovenotes/next?today=" + kit.todayIST());
  await call(C, store.view("C"), "GET", "seal-key");
  await C.jobs[0].run({ MEDIA: store.view("job") }, kit);
  ok(!store.ops.slice(opsBefore).some((o) => o.endsWith(` ${KEY}`)) && work.decrypt === workBefore.decrypt && work.deriveBits === workBefore.deriveBits,
    "none of them is ever opened again: later requests, the key address and the job don't even fetch the key document", store.ops.slice(opsBefore));
  const D = await copy(); D.setDeliveries(boxes);
  const fromFresh = await call(D, store.view("D"), "GET", "seal-key");
  ok(JSON.stringify(fromFresh.out.deliveries) === JSON.stringify({ applied: 0, failed: boxes.length, waiting: 0 }) && work.decrypt === workBefore.decrypt,
    "a fresh copy of the server counts them as failed without opening one", fromFresh.out.deliveries);
}
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  const huge = await sealFor(store, { mode: "add", notes: [{ text: "fine" }], filler: "x".repeat(160000) });
  const nullDate = await sealFor(store, { mode: "add", notes: [{ text: "A note whose date was left as null.", date: null }, { text: "And one with a real date.", date: "2020-03-03" }] });
  C.setDeliveries([huge, nullDate]);
  const workBefore = workNow();
  const list = await call(C, store.view("her"), "GET", "lovenotes");
  ok(huge.length > 200000 && list.out.deliveries[0].ok === false && work.decrypt - workBefore.decrypt === 1, "a delivery far too long to be notes is refused without being opened", [huge.length, list.out.deliveries, work.decrypt - workBefore.decrypt]);
  ok(list.out.deliveries[1].ok === true && list.out.notes.length === 2 && list.out.notes[0].date === "" && list.out.notes[1].date === "2020-03-03", "a date given as null simply means no date", list.out.notes);
}

group("more deliveries than one request takes on");
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  const boxes = [];
  for (let i = 0; i < 9; i++) boxes.push(await sealFor(store, add(`early note ${i}`)));
  boxes.push(await sealFor(store, { mode: "replace", notes: [{ text: "the tenth starts again" }] }));
  boxes.push(await sealFor(store, add("then an eleventh")), await sealFor(store, add("and a twelfth")));
  C.setDeliveries(boxes);
  let workBefore = workNow();
  const one = await call(C, store.view("her"), "GET", "lovenotes");
  ok(one.out.notes.length === PER_PASS && one.out.deliveries.length === PER_PASS && work.decrypt - workBefore.decrypt === PER_PASS, `the first request opens ${PER_PASS} and stops`, [one.out.notes.length, work.decrypt - workBefore.decrypt]);
  const D = await copy(); D.setDeliveries(boxes);
  const seenByD = [];
  for (let i = 0; i < 3; i++) seenByD.push((await call(D, store.view("D"), "GET", "seal-key")).out.deliveries);
  ok(JSON.stringify(seenByD) === JSON.stringify([{ applied: 8, failed: 0, waiting: 4 }, { applied: 12, failed: 0, waiting: 0 }, { applied: 12, failed: 0, waiting: 0 }]),
    "the next passes take the rest, and the key address shows how far along it is", seenByD);
  ok(noteTexts(store).join("|") === "the tenth starts again|then an eleventh|and a twelfth", "in their order, across the passes: add, replace, add", noteTexts(store));
  const E = await copy(); E.setDeliveries(Array.from({ length: 30 }, (_, i) => `not-a-delivery-${i}`));
  const counts = [];
  for (let i = 0; i < 9; i++) counts.push((await call(E, store.view("E"), "GET", "seal-key")).out.deliveries.waiting);
  ok(counts.join() === "26,22,18,14,10,6,2,0,0", `thirty at once through the open address: ${PER_PASS} a call, then nothing more to do`, counts);
}

// ======================= stored documents that are not what they should be =======================
group("a damaged notes document");
for (const [label, damaged, expectText] of [
  ["just a word", "garbage", null],
  ["a list", [1, 2, 3], null],
  ["wrong kinds everywhere", { notes: "x", bag: 5, sealed: [null, 7, { hash: 5 }], upNext: 7, turn: "x", last: {} }, null],
  ["one good note among broken ones", { notes: [null, 5, { id: "aa" }, { text: "no id" }, { id: "bb", text: "The one good note." }], bag: ["zz", null, "bb", "bb"], sealed: "none", turn: { day: 1 } }, "The one good note."],
]) {
  const store = new Store();
  store.objects.set(NOTES, JSON.stringify(damaged));
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  C.setDeliveries([await sealFor(store, add("Delivered into the mess."))]);
  const next = await call(C, store.view("her"), "GET", "lovenotes/next?today=" + kit.todayIST());
  const list = await call(C, store.view("her"), "GET", "lovenotes");
  const added = await call(C, store.view("her"), "POST", "lovenotes", { text: "Added afterwards." });
  const want = [...(expectText ? [expectText] : []), "Delivered into the mess.", "Added afterwards."];
  ok(next.status === 200 && list.status === 200 && added.status === 200 && want.includes(next.out.text) && noteTexts(store).join("|") === want.join("|"),
    `${label}: the notes still work, and a delivery and a new note go in`, [next, noteTexts(store)]);
}

group("a notes document that can't be read at all");
{
  const store = new Store();
  const C = await copy();
  await call(C, store.view("C"), "GET", "seal-key");
  const broken = '{"notes":[{"id":"aa","text":"The lighthouse keeper waved back';      // cut off mid-way: not JSON any more
  store.objects.set(NOTES, broken);
  C.setDeliveries([await sealFor(store, add("Delivered while unreadable."))]);
  const before = logged.length;
  const next = await call(C, store.view("her"), "GET", "lovenotes/next?today=" + kit.todayIST());
  const list = await call(C, store.view("her"), "GET", "lovenotes");
  const post = await call(C, store.view("her"), "POST", "lovenotes", { text: "Added afterwards." });
  const key = await call(C, store.view("out"), "GET", "seal-key");
  const lines = logged.slice(before);
  ok([next, list, post].every((r) => r.status === 503 && /couldn't be read/.test(r.out.error)), "the notes requests say so plainly (503), nothing breaks", [next, list, post]);
  ok(store.objects.get(NOTES) === broken && store.opsOn(NOTES, "put") === 0, "the unreadable document is left exactly as it is (never overwritten)", store.ops);
  ok(key.status === 200 && key.out.deliveries.waiting === 1, "the key address still answers, and the delivery waits", key);
  ok(lines.length > 0 && !lines.some((l) => /lighthouse|keeper|notes":|Unexpected|JSON/.test(l)), "no log line quotes the document or the storage's own error", lines);
  skew += 2 * MIN;
  store.objects.delete(NOTES);
  const later = await call(C, store.view("her"), "GET", "lovenotes");
  ok(later.status === 200 && later.out.notes.length === 1 && later.out.notes[0].text === "Delivered while unreadable.", "once the document can be read again, the waiting delivery goes in", later);
}

group("a deliveries file that isn't a list");
{
  const dir = `${process.env.STUDIO_OUT || "/tmp/studio-tests"}/work/odd-copy-${process.pid}`;      // its own folder, so two runs at once don't trip over each other
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir + "/server", { recursive: true });
  for (const f of ["lovenotes.js", "sealbox.js"]) await cp(`${REPO}/server/${f}`, `${dir}/server/${f}`);
  const loaded = [];
  for (const [i, text] of ["null", '"one long string"', '["text-one", 5, null, { "a": 1 }, "text-two"]'].entries()) {
    await writeFile(`${dir}/server/sealed.js`, `export const SEALED = ${text};\n`);
    await mkdir(`${dir}/${i}/server`, { recursive: true });
    for (const f of ["lovenotes.js", "sealbox.js", "sealed.js"]) await cp(`${dir}/server/${f}`, `${dir}/${i}/server/${f}`);
    try { loaded.push((await copy(`${dir}/${i}`)).jobs.length); } catch (e) { loaded.push("did not start: " + e.message); }
  }
  ok(loaded.join() === "0,0,1", "the server still starts: null and a bare string mean no deliveries; in a mixed list only the text entries count", loaded);
  await rm(dir, { recursive: true, force: true });
}

// ======================= the editor's own checks =======================
group("what the editor may store");
{
  const store = new Store();
  const C = await copy();
  const her = store.view("her");
  const tries = [{ text: { a: 1 } }, { text: ["a", "b"] }, { text: 5 }, { text: true }, null, [], "words", 7];
  const statuses = [];
  for (const t of tries) statuses.push((await call(C, her, "POST", "lovenotes", t)).status);
  ok(statuses.every((s) => s === 400) && noteTexts(store).length === 0, "a note whose text isn't text is refused, never turned into words", statuses);
  const badDates = [{ text: "ok", date: 20200303 }, { text: "ok", date: ["2020-03-03"] }, { text: "ok", date: { y: 2020 } }, { text: "ok", date: true }];
  const dateStatuses = [];
  for (const t of badDates) dateStatuses.push((await call(C, her, "POST", "lovenotes", t)).status);
  ok(dateStatuses.every((s) => s === 400) && noteTexts(store).length === 0, "a date that isn't text is refused", dateStatuses);
  const fine = await call(C, her, "POST", "lovenotes", { text: "No date on this one.", date: null });
  ok(fine.status === 200 && fine.out.note.date === "", "a date of null means no date");
}

// ======================= nothing private ever leaves =======================
group("the private half of every key");
{
  const kept = new Set(), inKeyDocs = [];
  ok(privates.size >= 20, `(this run made ${privates.size} key pairs, counting the ones that lost a race or failed their test)`);
  const leaks = [...privates].filter((d) => said.some((t) => t.includes(d)) || logged.some((t) => t.includes(d)));
  ok(leaks.length === 0 && said.length > 500, `is in no answer (${said.length} answers) and no log line`, leaks.length);
  let elsewhere = 0, keyDocs = 0, strays = 0;
  for (const store of stores) {
    for (const [name, text] of store.objects) {
      const holds = [...privates].filter((d) => text.includes(d)).length;
      if (name === KEY) { keyDocs++; if (holds > 1) strays++; } else elsewhere += holds;
    }
  }
  ok(elsewhere === 0 && strays === 0 && keyDocs >= 15, `in storage it sits only in its own document, one pair to a storage (${stores.length} storages, ${keyDocs} key documents); a pair that lost a race is kept nowhere`, [elsewhere, strays, keyDocs]);
  ok(!logged.some((line) => /bakery|carrom|scooter|kite|lighthouse|Delivered into|fine/.test(line)) && logged.length > 0, `no note is in a log line either (${logged.length} lines were logged)`, logged.filter((l) => /bakery|carrom|scooter|kite|Delivered|fine/.test(l)).slice(0, 2));
  ok(logged.every((line) => /^little notes: /.test(line)), "every log line is one of the fixed, plain ones", logged.filter((l) => !/^little notes: /.test(l)).slice(0, 2));
}

const bad = results.filter((r) => !r).length;
say(`harness_a5: ${results.length - bad} checks passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
