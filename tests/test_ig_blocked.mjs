// Meta pauses the app ("API access blocked"): her post gets a plain message, the app stops calling by itself,
// and starts again when Instagram answers.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const worker = (await import("../server/worker.js")).default;
let fails = 0; const check = (n, ok, d = "") => { console.log((ok ? "  ok   " : "  FAIL ") + n + (ok ? "" : "  [" + d + "]")); if (!ok) fails++; };
class Bucket { constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v == null ? null : { text: async () => v, json: async () => JSON.parse(v), body: v, size: v.length, httpMetadata: {}, writeHttpMetadata() {} }; }
  async put(k, v) { this.m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } async delete(k) { this.m.delete(k); }
  async list() { return { objects: [...this.m.keys()].map((key) => ({ key })) }; } async head(k) { return this.m.has(k) ? {} : null; } }
const MEDIA = new Bucket();
const env = { MEDIA, APP_PASSCODE: "letmein", META_APP_ID: "1", META_APP_SECRET: "s", GRAPH_API: "http://graph.test" };
await MEDIA.put("data/instagram.json", JSON.stringify({ igId: "17890", username: "t", userToken: "U", pageToken: "P", pageId: "1", userTokenExpires: Date.now() + 5e9 }));
let calls = 0, blocked = true;
globalThis.fetch = async (url) => { if (!String(url).startsWith("http://graph.test")) return new Response("{}", { status: 404 }); calls++;
  return blocked ? new Response(JSON.stringify({ error: { message: "API access blocked.", type: "OAuthException", code: 200, fbtrace_id: "Atrace" } }), { status: 400, headers: { "content-type": "application/json" } })
                 : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }); };
const login = await worker.fetch(new Request("http://app.test/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: "letmein" }) }), env);
const token = (await login.json()).token;
const get = (path) => worker.fetch(new Request("http://app.test" + path, { headers: { authorization: "Bearer " + token } }), env);
await MEDIA.put("data/handoffs.json", JSON.stringify([{ id: "h1", at: Date.now() - 60000, caption: "a line", quote: "a line", state: "waiting" }]));
let r = await worker.fetch(new Request("http://app.test/api/handoffs/check", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: "{}" }), env);
const said = await r.text();
if (!calls) { r = await get("/api/insights?range=30"); await r.text(); }
check("Instagram was asked, and the block is noted", calls > 0 && !!(await MEDIA.get("data/igblock.json")), calls + " " + said.slice(0, 160));
if (fails) { console.log("FAIL"); process.exit(1); }
const before = calls;
const waits = []; await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits.map((p) => p.catch(() => {})));
check("while paused, the timer asks Instagram nothing", calls === before, calls - before);
blocked = false; const doc = JSON.parse(await (await MEDIA.get("data/igblock.json")).text()); doc.at -= 3 * 60 * 60 * 1000; await MEDIA.put("data/igblock.json", JSON.stringify(doc));
blockedReset: {
  const w2 = []; await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2.map((p) => p.catch(() => {})));
  check("two hours on, it asks again, and the note goes when Instagram answers", calls > before && !(await MEDIA.get("data/igblock.json")), calls - before);
}
console.log(fails ? "FAIL" : "PASS"); process.exit(fails ? 1 : 0);
