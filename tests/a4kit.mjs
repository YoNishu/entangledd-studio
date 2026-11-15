// Agent 4: a pretend storage bucket and the worker's small helpers, for testing server/scorer.js on its own in Node.
// The bucket can be told to fail a read or write, or to pause one until the test lets it go, and it keeps a list
// of every call, so a test can count them.
export const DAY = 24 * 3600 * 1000, IST = 5.5 * 3600 * 1000, HOUR = 3600 * 1000;
export const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
export const noonOf = (date) => Date.parse(date + "T12:00:00+05:30");
export const dayStr = (ago, now = Date.now()) => dateOf(now - ago * DAY);

export class Bucket {
  constructor() { this.objects = new Map(); this.calls = []; this.failing = []; this.holds = []; }
  // fail("get", "scorer/log", 2): the next two reads of that document throw, as a storage hiccup would.
  fail(op, key, times = 1, error = () => new Error("storage hiccup")) { this.failing.push({ op, key, left: times, error }); }
  // hold("put", "scorer/log"): the next such call waits. Returns { reached, release }: await reached, do things, then release().
  hold(op, key, skip = 0) {
    const h = { op, key, skip, done: false };
    h.reachedPromise = new Promise((res) => { h.reached = res; });
    h.releasePromise = new Promise((res) => { h.release = res; });
    this.holds.push(h);
    return { reached: h.reachedPromise, release: h.release };
  }
  async gate(op, key) {
    this.calls.push(op + " " + key);
    for (const h of this.holds) {
      if (h.done || h.op !== op || !key.includes(h.key)) continue;
      if (h.skip-- > 0) continue;
      h.done = true; h.reached(); await h.releasePromise;
    }
    const f = this.failing.find((x) => x.left > 0 && x.op === op && key.includes(x.key));
    if (f) { f.left--; throw f.error(); }
  }
  async get(key) {
    await this.gate("get", key);
    const v = this.objects.get(key);
    return v == null ? null : { json: async () => JSON.parse(v), text: async () => v };
  }
  async put(key, body) { await this.gate("put", key); this.objects.set(key, String(body)); }
  async delete(keys) { for (const k of [].concat(keys)) { await this.gate("delete", k); this.objects.delete(k); } }
  async list({ prefix = "" } = {}) {
    await this.gate("list", prefix);
    return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
  }
  // Straight access for the test itself (not counted, never fails).
  doc(name) { const v = this.objects.get(`data/${name}.json`); return v == null ? null : JSON.parse(v); }
  raw(name) { return this.objects.get(`data/${name}.json`); }
  set(name, value) { this.objects.set(`data/${name}.json`, typeof value === "string" ? value : JSON.stringify(value)); }
  count(op, part = "") { return this.calls.filter((c) => c.startsWith(op + " ") && c.includes(part)).length; }
}

// The same few helpers worker.js hands to its add-on sections.
export function makeKit() {
  return {
    loadDoc: async (env, name, fallback) => { const obj = await env.MEDIA.get(`data/${name}.json`); return obj ? obj.json() : fallback; },
    saveDoc: (env, name, doc) => env.MEDIA.put(`data/${name}.json`, JSON.stringify(doc), { httpMetadata: { contentType: "application/json" } }),
    todayIST: () => dateOf(Date.now()),
    json: (data, status = 200) => ({ status, data }),
    fail: (status, message) => ({ status, data: { error: message } }),
  };
}
export const fresh = () => ({ env: { MEDIA: new Bucket() }, kit: makeKit() });

// ---------- made-up quotes and histories ----------
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
export const pick = (r, list) => list[Math.floor(r() * list.length)];
export const THEMES = ["love", "loss", "courage", "time", "self", "change", "hope", "sea", "home", "work"];
export const TONES = ["calm", "tender", "direct", "wry", "hopeful", "plain"];
export const KINDS = ["book", "film", "series", "classic"];
export const AUTHORS = Array.from({ length: 12 }, (_, i) => "author " + i);
// A row of the scorer's record, as describe() would make it.
export const cand = (r) => ({ th: pick(r, THEMES), to: pick(r, TONES), k: pick(r, KINDS), w: "", a: pick(r, AUTHORS), n: pick(r, [7, 18, 32]), v: "plain", c: pick(r, [0, 1]) });
export const calmShort = (c, r, strength = 1) => strength * (2 * (c.to === "calm") + 1.5 * (c.n <= 10)) + 0.5 * gauss(r);
export const directLong = (c, r) => 2 * (c.to === "direct") + 1.5 * (c.n > 25) - 1.5 * (c.to === "calm") + 0.5 * gauss(r);
export const atRandom = (c, r) => r();

const WORDS = "quiet water keeps its own slow counsel under every passing weather and leaves the hurried shore to argue with itself about what the tide has taken and what it means to stay when staying costs".split(" ");
let serial = 0;
// A suggestion as the app stores it in a day's list or the asked-for list.
export function suggestion(over = {}) {
  serial++;
  const n = over.words || 7;
  return { id: over.id || `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`, state: over.state || "new",
    text: over.text || `S${serial} ${WORDS.slice(0, Math.max(1, n - 1)).join(" ")}`, author: over.author || "Author " + (serial % 9),
    source: over.source || { type: "classic", title: "" }, theme: over.theme || "sea", tone: over.tone || "calm", verify: false,
    ...(over.askedAt ? { askedFor: "the sea", askedAt: over.askedAt } : {}) };
}

export function checker() {
  const fails = [];
  const check = (name, ok, detail = "") => { console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? `  [${detail}]` : "")); if (!ok) fails.push(name); return ok; };
  const finish = (title) => { console.log((fails.length ? "FAIL" : "PASS") + ": " + title + (fails.length ? ` (${fails.length} failed: ${fails.join("; ")})` : "")); process.exit(fails.length ? 1 : 0); };
  return { check, finish, fails };
}
