/* The daily reminder to post: a notification on her phone at the time she chose (11:11 in the morning,
   India time, unless she changes it).

   How it reaches the phone: "web push". When she turns the reminder on, her phone's own push service
   (Apple's, for an iPhone) hands the app an address and two keys for that phone. At the chosen time this
   server locks a few words with those keys, so that only her phone can read them, and sends them to that
   address; the phone shows them. No other app and no outside account is involved.

   What happens here:
   - /api/reminders (signed in): turn it on for a phone, change the time, turn it off, send a test;
   - tick(): called by the timers (every five minutes, and at 11:11 exactly). It sends each phone its
     reminder at the first run at or after its time, at most once a day, and not at all on a day she
     has already posted;
   - a phone whose push service says it is gone (404 or 410) is taken off the list;
   - healthCheck(): one line on how the reminders are doing, in the shape the health checks use
     (answered at /api/reminders/health; not yet among the lines under "Check everything").

   The standards followed, with no library: RFC 8030 (sending), RFC 8291 (locking the message:
   ECDH on P-256, HKDF-SHA-256, AES-128-GCM, "aes128gcm"), RFC 8292 (VAPID: a signed note saying which
   server is sending). The signing key is made here the first time it is needed and kept in storage;
   its private half never leaves the server, is never logged and is never sent back in an answer.

   This file is one of the app's add-on sections (see SECTIONS in worker.js).
   Handlers are called as handler(request, env, parts, kit). */

const DOC = "reminders";            // data/reminders.json: the phones, each with its time and the day it was last reminded
const KEY_DOC = "pushkeys";         // data/pushkeys.json: this server's signing key pair
const MAX_PHONES = 10;
const DEFAULT_TIME = "11:11";
const DAILY = 5;                    // how many quotes Today shows (the same number worker.js uses)
const GRACE_MINUTES = 60;           // a reminder that could not go out on time is still sent this much later, then dropped for the day
const TRIES_A_DAY = 3;              // how often one phone's reminder is tried again when the push service is in trouble
const TOKEN_HOURS = 12;             // how long one signed note is used (Apple: at most 24 hours, and not a new one every hour)
const REMINDER_TTL = 8 * 60 * 60;   // seconds a push service keeps a reminder for a phone that is switched off
const TEST_TTL = 5 * 60;
const TEST_GAP_MS = 10 * 1000;
const RECORD_SIZE = 4096, MAX_MESSAGE_BYTES = 3000;   // push services accept about 4 KB in all
const PUSH_TIMEOUT_MS = 8000;
// Who is sending, for the push service to see. An address of the app itself, on purpose: never anyone's email.
const SUBJECT = "https://entangledd-studio.neogenesis-ksn.workers.dev";
// The push services of the phones and browsers this can reach. Nothing is ever sent to any other host.
const PUSH_HOSTS = ["push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com"];
// The timer line in wrangler.jsonc that exists only for the reminders: 05:41 UTC is 11:11 in India.
export const CRON = "41 5 * * *";

const MIN_MS = 60 * 1000, IST_MS = 5.5 * 60 * MIN_MS, DAY_MIN = 24 * 60;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const text = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" }, ECDSA = { name: "ECDSA", namedCurve: "P-256" };

// ---------------------------------------------------------------- small helpers

const toB64u = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
// Reads base64 in either alphabet, with or without padding. Anything else gives null.
function fromB64u(value) {
  const s = String(value ?? "").replace(/=+$/, "");
  if (!/^[A-Za-z0-9_+/-]+$/.test(s) || s.length % 4 === 1) return null;
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// India time: UTC + 5:30 all year round.
const dayIST = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const minuteIST = (ms) => { const d = new Date(ms + IST_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const niceDay = (day) => { const [y, m, d] = String(day).split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const niceTime = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// When a phone's time last came round: how many minutes ago, at which moment, and which day (India time) that was.
function lastTurn(time, now) {
  const late = (minuteIST(now) - minutesOf(time) + DAY_MIN) % DAY_MIN;
  const at = Math.floor(now / MIN_MS) * MIN_MS - late * MIN_MS;
  return { late, at, day: dayIST(at) };
}
// The day a phone is owed a reminder for right now, or "" when nothing is owed: its time came round within
// the last hour, that day's reminder has not been seen to, and the time was chosen before it came round
// (turning the reminder on at noon for 11:11 starts tomorrow, not at once).
function dueDay(sub, now) {
  const { late, at, day } = lastTurn(sub.time, now);
  return late <= GRACE_MINUTES && sub.lastDay !== day && at >= (sub.since || 0) ? day : "";
}

// ---------------------------------------------------------------- the list of phones

const isSub = (s) => !!s && typeof s === "object" && typeof s.endpoint === "string" && typeof s.p256dh === "string" &&
  typeof s.auth === "string" && TIME.test(s.time || "");

async function load(env, kit) {
  const doc = await kit.loadDoc(env, DOC, null);
  const ok = !!doc && typeof doc === "object" && !Array.isArray(doc);
  return {
    subs: ok && Array.isArray(doc.subs) ? doc.subs.filter(isSub) : [],
    tokens: ok && doc.tokens && typeof doc.tokens === "object" ? doc.tokens : {},
    last: ok && doc.last && typeof doc.last === "object" ? doc.last : null,
  };
}
// Reads the list, lets "change" alter it, and saves it. Read afresh every time, so that a change made
// by another request a moment ago (a phone turned on while reminders were going out) is not lost.
async function update(env, kit, change) {
  const doc = await load(env, kit);
  const out = await change(doc);
  await kit.saveDoc(env, DOC, doc);
  return out;
}

function hostAllowed(env, url) {
  const local = !!env.PUSH_HOSTS && env.PUSH_HOSTS.split(",").includes(url.hostname);   // used only by the local stand-in server
  if (local) return true;
  return url.protocol === "https:" && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h));
}

// Checks what a phone sent when the reminder was turned on, and returns it in the shape it is kept in.
async function readSubscription(env, kit, given) {
  const wrong = () => new kit.UserError(400, "This phone's reminder details couldn't be read. Turn the reminder off and on again.");
  const s = given && typeof given === "object" ? given : {};
  let url;
  try { url = new URL(String(s.endpoint || "")); } catch (e) { throw wrong(); }
  if (url.href.length > 1000 || url.username || url.password || !hostAllowed(env, url)) throw wrong();
  const keys = s.keys && typeof s.keys === "object" ? s.keys : {};
  const point = fromB64u(keys.p256dh), secret = fromB64u(keys.auth);
  if (!point || point.length !== 65 || point[0] !== 4 || !secret || secret.length !== 16) throw wrong();
  try { await crypto.subtle.importKey("raw", point, ECDH, false, []); }      // refuses a point that is not on the curve
  catch (e) { throw wrong(); }
  return { endpoint: String(s.endpoint), p256dh: toB64u(point), auth: toB64u(secret) };   // the address exactly as the phone gave it
}
const readTime = (kit, value) => {
  const time = value == null || value === "" ? DEFAULT_TIME : String(value);
  if (!TIME.test(time)) throw new kit.UserError(400, "Choose a time like 11:11.");
  return time;
};
const readEndpoint = (kit, b) => {
  const endpoint = typeof (b && b.endpoint) === "string" ? b.endpoint : "";
  if (!endpoint || endpoint.length > 1000) throw new kit.UserError(400, "That request couldn't be read.");
  return endpoint;
};

// ---------------------------------------------------------------- this server's signing key (VAPID)

let keysInMemory = null;            // the key pair never changes, so one running copy reads it from storage once

const keysLookRight = (k) => !!k && typeof k === "object" && typeof k.publicKey === "string" && !!k.privateJwk && typeof k.privateJwk === "object";

async function signWith(keys, bytes) {
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, ECDSA, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes));
}

// Makes the key pair, on the very first call only. It is tried out before it is kept. Storage is asked to
// keep it only if no key is there yet, and what storage holds is then read back: when two first calls
// come at once, both hand out the pair that was stored first (a phone must be given the same key the
// server later signs with).
async function makeAndKeepKeys(env, kit) {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const made = {
    v: 1, created: Date.now(),
    publicKey: toB64u(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  const sample = text.encode("a first try");
  if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, await signWith(made, sample), sample))) {
    throw new Error("the new signing key failed its own test");
  }
  try {
    await env.MEDIA.put(`data/${KEY_DOC}.json`, JSON.stringify(made),      // the same place kit.saveDoc would use
      { httpMetadata: { contentType: "application/json" }, onlyIf: new Headers({ "If-None-Match": "*" }) });
  } catch (e) { /* storage that can't take a condition: dealt with just below */ }
  let doc = await kit.loadDoc(env, KEY_DOC, null);
  if (!keysLookRight(doc)) {                // the write with a condition was refused outright: keep the pair the plain way
    await kit.saveDoc(env, KEY_DOC, made);
    doc = await kit.loadDoc(env, KEY_DOC, null);
  }
  if (!keysLookRight(doc)) throw new Error("the signing key could not be kept");
  return doc;
}
async function keysFor(env, kit) {
  if (keysInMemory) return keysInMemory;
  const doc = await kit.loadDoc(env, KEY_DOC, null);
  keysInMemory = keysLookRight(doc) ? doc : await makeAndKeepKeys(env, kit);
  return keysInMemory;
}

// The signed note for one push service ("audience"). A note that still has a good while to run is used
// again; "tokens" is the list kept in data/reminders.json, and "fresh" collects what was newly made.
async function tokenFor(keys, tokens, fresh, audience, now) {
  const kept = fresh[audience] || tokens[audience];
  if (kept && typeof kept.jwt === "string" && kept.key === keys.publicKey && kept.exp * 1000 - now > 10 * MIN_MS) return kept.jwt;
  const exp = Math.floor(now / 1000) + TOKEN_HOURS * 3600;
  const part = (o) => toB64u(text.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp, sub: SUBJECT })}`;
  const jwt = `${unsigned}.${toB64u(await signWith(keys, text.encode(unsigned)))}`;
  fresh[audience] = { jwt, exp, key: keys.publicKey };
  return jwt;
}

// ---------------------------------------------------------------- locking a message for one phone (RFC 8291)

async function hkdf(secret, salt, info, length) {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, base, length * 8));
}

// Returns the bytes to send: 16 bytes salt | record size | 65 | this message's own public key | the locked words.
// A fresh key pair and a fresh salt are made for every message.
export async function lock(sub, plain) {
  const phonePublic = fromB64u(sub.p256dh), phoneSecret = fromB64u(sub.auth);
  const theirs = await crypto.subtle.importKey("raw", phonePublic, ECDH, false, []);
  const mine = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const myPublic = new Uint8Array(await crypto.subtle.exportKey("raw", mine.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, mine.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await hkdf(shared, phoneSecret, join(text.encode("WebPush: info\0"), phonePublic, myPublic), 32);
  const contentKey = await hkdf(material, salt, text.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(material, salt, text.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  // One record holds everything; the byte 2 after the words marks it as the last one.
  const locked = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, join(plain, Uint8Array.of(2))));
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, RECORD_SIZE);
  head[20] = myPublic.length;
  return join(head, myPublic, locked);
}

// ---------------------------------------------------------------- sending

// Sends one message to one phone. Never throws: the answer is the push service's status
// (0 when it could not be reached) and, when it gave one, its one-word reason.
async function push(keys, tokens, fresh, sub, message, { ttl, topic }, now) {
  try {
    const plain = text.encode(JSON.stringify(message));
    if (plain.length > MAX_MESSAGE_BYTES) return { status: 0, reason: "TooLong" };
    const jwt = await tokenFor(keys, tokens, fresh, new URL(sub.endpoint).origin, now);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        TTL: String(ttl), Urgency: "high", Topic: topic,
      },
      body: await lock(sub, plain),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    let reason = "";
    try { reason = String(JSON.parse(await res.text()).reason || ""); } catch (e) { /* no reason given */ }
    return { status: res.status, reason: /^[A-Za-z]{3,40}$/.test(reason) ? reason : "" };
  } catch (e) {
    console.error("a reminder could not be sent", e && e.name);      // the name only: nothing about the phone
    return { status: 0, reason: "" };
  }
}
const delivered = (r) => r.status >= 200 && r.status < 300;
const gone = (r) => r.status === 404 || r.status === 410;

// What the phone shows. The shape is the one newer iPhones can show by themselves ("declarative web push");
// older phones hand the very same words to the app's service worker (web/sw.js), which shows them.
const notice = (sub, body, tag) => ({
  web_push: 8030,
  notification: { title: "D's Studio", body, navigate: `${sub.origin || SUBJECT}/`, tag, lang: "en" },
});

// How a quote begins, for the reminder: up to its first pause if that comes early, otherwise seven words.
function opening(quote) {
  const words = String(quote || "").replace(/\s+/g, " ").replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "").split(" ").filter(Boolean);
  const pause = words.findIndex((w, i) => i >= 3 && i < 9 && /[,;:.!?—–]$/.test(w));
  let out = words.slice(0, pause >= 0 ? pause + 1 : 7).join(" ");
  if (out.length > 60) out = out.slice(0, 60).replace(/\s+\S*$/, "");
  const cut = out.length < words.join(" ").length;
  return out ? `“${out.replace(/[\s,;:.!?…-]+$/, "")}${cut ? "…" : ""}”` : "";
}

// What to say on a given day (India time), or null when she has already posted that day.
async function wordsFor(env, kit, day) {
  const [posts, list] = await Promise.all([kit.loadDoc(env, "posts", []), kit.loadDoc(env, `suggestions/${day}`, [])]);
  const posted = (Array.isArray(posts) ? posts : []).some((p) => p && (p.state === "published" || p.state === "processing") &&
    dayIST(Number(p.published || p.created) || 0) === day);
  if (posted) return null;
  const five = (Array.isArray(list) ? list : []).filter((i) => i && !i.askedFor).slice(0, DAILY);
  const waiting = five.filter((i) => i.state !== "used" && i.state !== "rejected");
  if (!five.length) return "Your studio is ready when you are ✨";
  if (!waiting.length) return "A good moment to post today ✨";
  const first = opening(waiting[0].text);
  return `${waiting.length === DAILY ? "Today's five are ready" : "Today's quotes are ready"} ✨${first ? `\n${first}` : ""}`;
}

// ---------------------------------------------------------------- the timer

// Called by every timer run. Most runs read the list once and find nothing owed.
export async function tick(env, kit, now = Date.now()) {
  if (!env.MEDIA) return { sent: 0 };
  const before = await load(env, kit);
  const owed = before.subs.map((s) => ({ endpoint: s.endpoint, day: dueDay(s, now), was: s.lastDay || "" })).filter((o) => o.day);
  if (!owed.length) return { sent: 0 };

  // The day is marked before anything is sent, so that two timer runs close together can't both send.
  await update(env, kit, (doc) => {
    for (const o of owed) {
      const sub = doc.subs.find((s) => s.endpoint === o.endpoint);
      if (sub && dueDay(sub, now) === o.day) { sub.tries = sub.triesDay === o.day ? (sub.tries || 0) + 1 : 1; sub.triesDay = o.day; sub.lastDay = o.day; }
      else o.day = "";                                   // turned off, or already seen to, a moment ago
    }
  });
  const todo = owed.filter((o) => o.day);
  if (!todo.length) return { sent: 0 };

  // Whatever goes wrong from here on (storage, the signing key), every phone still gets an outcome,
  // so a day that was marked above is never left marked with nothing sent.
  const fresh = {};
  try {
    const words = new Map();                             // day -> what to say, or null: she has posted
    for (const day of new Set(todo.map((o) => o.day))) words.set(day, await wordsFor(env, kit, day));
    for (const o of todo) o.posted = words.get(o.day) === null;
    const sending = todo.filter((o) => !o.posted);
    if (sending.length) {
      const keys = await keysFor(env, kit);
      const subOf = (o) => before.subs.find((s) => s.endpoint === o.endpoint);
      // One signed note per push service, made before the phones are served side by side.
      for (const audience of new Set(sending.map((o) => new URL(o.endpoint).origin))) await tokenFor(keys, before.tokens, fresh, audience, now);
      await Promise.all(sending.map(async (o) => {
        o.result = await push(keys, before.tokens, fresh, subOf(o), notice(subOf(o), words.get(o.day), "daily-reminder"), { ttl: REMINDER_TTL, topic: "daily-reminder" }, now);
      }));
    }
  } catch (e) {
    console.error("reminders could not be prepared", e && e.message);
  }
  for (const o of todo) if (!o.posted && !o.result) o.result = { status: 0, reason: "" };

  const count = { sent: 0, failed: 0, gone: 0, posted: 0 };
  await update(env, kit, (doc) => {
    Object.assign(doc.tokens, fresh);
    for (const o of todo) {
      const sub = doc.subs.find((s) => s.endpoint === o.endpoint);
      if (o.posted) { count.posted++; if (sub) sub.lastWhy = "posted"; continue; }
      if (delivered(o.result)) { count.sent++; if (sub) { sub.lastWhy = "sent"; sub.lastSent = now; } continue; }
      if (gone(o.result)) { count.gone++; doc.subs = doc.subs.filter((s) => s.endpoint !== o.endpoint); continue; }
      count.failed++;
      if (!sub) continue;
      sub.lastWhy = "failed";
      sub.trouble = o.result.reason || (o.result.status ? `status ${o.result.status}` : "no answer");
      if ((sub.tries || 0) < TRIES_A_DAY) sub.lastDay = o.was;       // not sent: the next timer run tries again
    }
    doc.last = { day: todo[0].day, at: now, ...count };              // for the health check
  });
  return count;
}

// ---------------------------------------------------------------- the addresses the app calls

// A phone whose reminder failed on every try of its day. One miss that is still being tried again doesn't count.
const missed = (sub) => sub.lastWhy === "failed" && (sub.tries || 0) >= TRIES_A_DAY;
const answer = (doc, sub) => ({ on: !!sub, time: sub ? sub.time : DEFAULT_TIME, phones: doc.subs.length, ...(sub && missed(sub) ? { missed: true } : {}) });

// Turning it on, or changing the time. "since" is when the time now kept was chosen (see dueDay).
async function turnOn(request, env, kit, b) {
  const [given, time] = [await readSubscription(env, kit, b.subscription), readTime(kit, b.time)];
  const now = Date.now();
  return update(env, kit, (doc) => {
    let sub = doc.subs.find((s) => s.endpoint === given.endpoint);
    if (!sub) {
      if (doc.subs.length >= MAX_PHONES) throw new kit.UserError(409, `Reminders are already on for ${MAX_PHONES} phones. Turn one off first.`);
      sub = { ...given, added: now, lastDay: "" };
      doc.subs.push(sub);
    }
    if (sub.time !== time) sub.since = now;
    Object.assign(sub, given, { time, origin: new URL(request.url).origin });
    return answer(doc, sub);
  });
}

async function sendTest(env, kit, endpoint) {
  const now = Date.now();
  const doc = await load(env, kit);
  const sub = doc.subs.find((s) => s.endpoint === endpoint);
  if (!sub) throw new kit.UserError(404, "Turn the reminder on first.");
  if (now - (sub.lastTest || 0) < TEST_GAP_MS) throw new kit.UserError(429, "Sent a moment ago. Give it a few seconds.");
  const fresh = {};
  const result = await push(await keysFor(env, kit), doc.tokens, fresh, sub,
    notice(sub, "This is how your reminder will look ✨", "reminder-test"), { ttl: TEST_TTL, topic: "reminder-test" }, now);
  await update(env, kit, (latest) => {
    Object.assign(latest.tokens, fresh);
    if (gone(result)) latest.subs = latest.subs.filter((s) => s.endpoint !== endpoint);
    const mine = latest.subs.find((s) => s.endpoint === endpoint);
    if (mine) mine.lastTest = now;
    if (mine && delivered(result) && mine.lastWhy === "failed") mine.lastWhy = "tested";      // it gets through again
  });
  if (gone(result)) throw new kit.UserError(410, "This phone's reminder had lapsed. Turn it on again.");
  if (!delivered(result)) throw new kit.UserError(502, "The test couldn't be sent just now. Try again in a minute.");
  return { ok: true };
}

export const routes = {
  // GET  /api/reminders          the public half of the signing key, which the phone needs to turn reminders on
  // POST /api/reminders          { subscription, time }  turn it on for this phone, or change its time
  // POST /api/reminders/state    { endpoint }            is it on for this phone, and for when?
  // POST /api/reminders/off      { endpoint }            turn it off for this phone
  // POST /api/reminders/test     { endpoint }            send this phone a test now
  // GET  /api/reminders/health   how many phones, and how the last reminder went (the line healthCheck() makes)
  reminders: async (request, env, parts, kit) => {
    const what = parts[1] || "";
    if (parts.length > 2) return kit.fail(404, "Not found.");
    if (request.method === "GET" && !what) return kit.json({ key: (await keysFor(env, kit)).publicKey, time: DEFAULT_TIME, max: MAX_PHONES });
    if (request.method === "GET" && what === "health") return kit.json(await healthCheck(env, kit));
    if (request.method !== "POST") return kit.fail(404, "Not found.");
    const b = await kit.body(request);
    if (!what) return kit.json(await turnOn(request, env, kit, b && typeof b === "object" ? b : {}));
    const endpoint = readEndpoint(kit, b);
    if (what === "state") {
      const doc = await load(env, kit);
      return kit.json(answer(doc, doc.subs.find((s) => s.endpoint === endpoint)));
    }
    if (what === "off") {
      return kit.json(await update(env, kit, (doc) => {
        doc.subs = doc.subs.filter((s) => s.endpoint !== endpoint);
        return answer(doc, null);
      }));
    }
    if (what === "test") return kit.json(await sendTest(env, kit, endpoint));
    return kit.fail(404, "Not found.");
  },
};

// ---------------------------------------------------------------- for the health record

// One line about the reminders, in the shape the checks in health.js give ({ title, state, line, brief, fix }):
// how many phones, and how the last reminder went. Reads one small document and calls nothing outside.
// It is answered at /api/reminders/health; it is not yet one of the lines under "Check everything".
export async function healthCheck(env, kit) {
  const title = "Daily reminder";
  const doc = await load(env, kit);
  const n = doc.subs.length, last = doc.last;
  if (!n) return { title, state: "off", brief: "", line: "No phone has the daily reminder on. It is turned on in Settings, under Daily reminder." };
  const phones = n === 1 ? "On for 1 phone" : `On for ${n} phones`;
  const times = [...new Set(doc.subs.map((s) => niceTime(s.time)))].join(", ");
  const failing = doc.subs.filter(missed);
  if (failing.length) {
    const who = n === 1 ? "" : failing.length === n ? " to any of them" : ` to ${failing.length} of them`;
    return { title, state: "attention", brief: "the last daily reminder couldn't be sent",
      line: `${phones}, but the reminder on ${niceDay(failing[0].triesDay)} couldn't be sent${who} (${failing[0].trouble || "no answer"}).`,
      fix: ["On each phone: open D's Studio from the Home Screen, Settings, Daily reminder. Turn it off, then on again, and tap Send a test.",
        "If the test doesn't arrive either, tell Claude, in the chat where the app was built, what this line says."] };
  }
  if (!last || !last.day) return { title, state: "ok", brief: "", line: `${phones}, at ${times}. None has been due yet.` };
  const how = last.sent ? `The last one went out on ${niceDay(last.day)}.`
    : last.posted ? `None was needed on ${niceDay(last.day)}: she had already posted.`
      : last.failed ? `The one for ${niceDay(last.day)} didn't go through at first and is being tried again.`
        : `A phone that no longer takes reminders was taken off the list on ${niceDay(last.day)}.`;
  return { title, state: "ok", brief: "", line: `${phones}, at ${times}. ${how}` };
}
