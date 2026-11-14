/* Little notes from Nishiii, shown one at a time.

   Each time she opens the app, the line under the heading on Today is one note. A note that is
   about a particular day comes first on that day of the year; on other days the notes take
   turns, and none comes back until all have been shown.

   The notes are private: they live only in the app's storage and are sent only to a signed-in
   phone. They can also arrive as "sealed deliveries" (server/sealed.js): text locked with the
   app's own public key, so it can travel through the public repo unread (see server/sealbox.js).

   This file is one of the app's add-on sections (see SECTIONS in worker.js).
   Handlers are called as handler(request, env, parts, kit); jobs as run(env, kit). */

import { SEALED } from "./sealed.js";
import { makeKeys, unseal, keyCheck, sha256Hex } from "./sealbox.js";

const MAX_NOTES = 60, MAX_CHARS = 280;
const DOC = "lovenotes";     // the notes, and whose turn it is
const KEY_DOC = "sealkey";   // the app's own key pair for sealed deliveries; the private half is never sent anywhere
const DAY_MS = 24 * 60 * 60 * 1000;

const tidy = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const count = (s) => [...s].length;

// "YYYY-MM-DD" for a day that exists on the calendar, as { y, mo, d }; otherwise null.
function realDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2200 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, mo, d };
}
const leapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Is today this note's day of the year? Only from the note's own year onward.
// A note about 29 February keeps its day on the 28th in years that have no 29th.
function onThisDay(note, today) {
  const n = realDate(note.date);
  if (!n || n.y > today.y) return false;
  if (n.mo === today.mo && n.d === today.d) return true;
  return n.mo === 2 && n.d === 29 && today.mo === 2 && today.d === 28 && !leapYear(today.y);
}
function markerFor(note, today) {
  const years = today.y - realDate(note.date).y;
  return years === 0 ? "Today" : years === 1 ? "1 year ago today" : `${years} years ago today`;
}

const blank = () => ({ notes: [], bag: [], upNext: null, last: null, turn: null, sealed: [] });
async function load(env, kit) {
  const doc = await kit.loadDoc(env, DOC, null);
  const state = { ...blank(), ...(doc || {}) };
  for (const k of ["notes", "bag", "sealed"]) if (!Array.isArray(state[k])) state[k] = [];
  return state;
}
const save = (env, kit, state) => kit.saveDoc(env, DOC, state);
function newId(state) {
  for (;;) {
    const id = crypto.randomUUID().slice(0, 8);
    if (!state.notes.some((n) => n.id === id)) return id;
  }
}

// ---------- whose turn it is ----------
// bag     the notes not yet shown in this round (and not already lined up)
// upNext  the note lined up for the next ordinary opening. It is chosen one opening ahead so the
//         phone can keep exactly the right space for it and nothing moves when it arrives.
// turn    on a note's own day: which of that day's notes was shown last, so they take turns

// Takes one note out of the bag at random, starting a new round when the bag is empty.
// "avoid" keeps a new round from opening with the note that was shown last.
function draw(state, avoid) {
  if (!state.bag.length) state.bag = state.notes.map((n) => n.id);
  if (!state.bag.length) return null;
  const choices = state.bag.filter((id) => id !== avoid);
  const pool = choices.length ? choices : state.bag;
  const id = pool[Math.floor(Math.random() * pool.length)];
  state.bag = state.bag.filter((b) => b !== id);
  return id;
}

// The notes whose own day this is, oldest first, so on a shared day the earlier memory greets her first.
const notesOfTheDay = (notes, today) => notes.filter((n) => onThisDay(n, today))
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
// Of those, the one whose turn it is on that day.
function turnOf(state, special, dayText) {
  const last = state.turn && state.turn.day === dayText ? state.turn.last : null;
  return special[(special.findIndex((n) => n.id === last) + 1) % special.length];
}

// Picks the note for this opening and lines up the one after it. Changes state; returns the note or null.
function choose(state, today, dayText) {
  const notes = state.notes;
  if (!notes.length) { Object.assign(state, { bag: [], upNext: null, last: null, turn: null }); return null; }
  const byId = (id) => notes.find((n) => n.id === id) || null;
  if (!byId(state.upNext)) state.upNext = null;
  state.bag = [...new Set(state.bag)].filter((id) => byId(id) && id !== state.upNext);

  const special = notesOfTheDay(notes, today);
  let shown;
  if (special.length) {
    shown = turnOf(state, special, dayText);
    state.turn = { day: dayText, last: shown.id };
    if (state.upNext === shown.id) state.upNext = null;
  } else {
    state.turn = null;
    shown = byId(state.upNext) || byId(draw(state, state.last));
    state.upNext = null;
  }
  state.last = shown.id;
  if (!state.upNext) state.upNext = draw(state, shown.id);
  // A note shown on its own day has had its turn in this round too (also when the round began just now).
  if (special.length) state.bag = state.bag.filter((id) => id !== shown.id);
  return shown;
}

// ---------- sealed deliveries ----------
// The deliveries this version of the app was deployed with. (The local stand-in server swaps the
// list through setDeliveries to act out a new deploy.)
const deliveries = { list: SEALED.map(String) };
const seen = new Map();      // delivery hash → opened fine (true) or not (false), as far as this running copy knows
const hashes = new Map();    // delivery text → its hash
async function hashOf(box) {
  if (!hashes.has(box)) hashes.set(box, await sha256Hex(box));
  return hashes.get(box);
}

const NOT_OPENED = "This delivery couldn't be opened: it was sealed for a different key, or it was changed on the way.";
const NOT_NOTES = "This delivery opened, but what was inside isn't a usable list of notes.";

// Opens one delivery and puts its notes in. Never throws: a delivery that can't be used is described instead.
async function openAndMerge(state, keys, box) {
  let inside;
  try {
    if (!keys) throw new Error("no key yet");
    inside = JSON.parse(await unseal(keys, box));
  } catch (e) { return { ok: false, why: NOT_OPENED }; }
  const mode = inside && inside.mode, list = inside && inside.notes;
  if (!["add", "replace"].includes(mode) || !Array.isArray(list) || !list.length || list.length > MAX_NOTES) return { ok: false, why: NOT_NOTES };
  const fresh = [];
  for (const item of list) {
    const text = tidy(item && item.text), date = item && item.date ? String(item.date) : "";
    if (!text || count(text) > MAX_CHARS || (date && !realDate(date))) return { ok: false, why: NOT_NOTES };
    fresh.push({ text, date });
  }
  if (mode === "replace") Object.assign(state, { notes: [], bag: [], upNext: null, last: null, turn: null });
  let added = 0, skipped = 0;
  for (const n of fresh) {
    if (state.notes.some((have) => have.text === n.text) || state.notes.length >= MAX_NOTES) { skipped++; continue; }
    const note = { id: newId(state), text: n.text, ...(n.date ? { date: n.date } : {}), added: Date.now() };
    state.notes.push(note);
    state.bag.push(note.id);
    added++;
  }
  return { ok: true, mode, added, skipped };
}

// Brings in every delivery not dealt with yet. Each is dealt with once, whatever the outcome,
// and remembered by its hash. Returns true if the stored document needs saving.
async function applyDeliveries(env, kit, state) {
  let changed = false, keys;
  for (const box of deliveries.list) {
    const hash = await hashOf(box);
    const done = state.sealed.find((s) => s.hash === hash);
    if (done) { seen.set(hash, !!done.ok); continue; }
    if (keys === undefined) keys = await kit.loadDoc(env, KEY_DOC, null);
    const result = await openAndMerge(state, keys, box);
    state.sealed.push({ hash, at: Date.now(), ...result });
    seen.set(hash, result.ok);
    changed = true;
  }
  return changed;
}
// The same, but a problem with a delivery (storage being briefly unreachable, say) never gets in the way of the notes.
async function deliver(env, kit, state) {
  if (!deliveries.list.length) return false;
  try { return await applyDeliveries(env, kit, state); }
  catch (e) { console.error("little notes: a delivery could not be checked just now"); return false; }
}
async function allSeen() {
  for (const box of deliveries.list) if (!seen.has(await hashOf(box))) return false;
  return true;
}
// Makes sure every delivery has been dealt with, touching storage only if this running copy hasn't seen one of them.
async function catchUp(env, kit) {
  if (!deliveries.list.length || (await allSeen())) return;
  const state = await load(env, kit);
  if (await deliver(env, kit, state)) await save(env, kit, state);
}

// ---------- the app's own key pair ----------
let publicKey = { hex: "", at: 0 };
async function ownPublicKey(env, kit) {
  if (publicKey.hex && Date.now() - publicKey.at < 5 * 60 * 1000) return publicKey.hex;
  let doc = await kit.loadDoc(env, KEY_DOC, null);
  if (!doc) {
    await kit.saveDoc(env, KEY_DOC, { v: 1, created: Date.now(), ...(await makeKeys()) });
    doc = await kit.loadDoc(env, KEY_DOC, null);      // read back, so two first requests at once end up agreeing on the stored one
  }
  publicKey = { hex: doc.publicHex, at: Date.now() };
  return doc.publicHex;
}

// GET /api/seal-key (open): the public key to seal a delivery with, and how past deliveries went (numbers only).
async function sealKey(request, env, parts, kit) {
  if (request.method !== "GET" || parts.length > 1) return kit.fail(404, "Not found.");
  if (!env.MEDIA) return kit.fail(503, "The app's storage isn't set up yet.");
  const key = await ownPublicKey(env, kit);
  await catchUp(env, kit);
  const counts = { applied: 0, failed: 0, waiting: 0 };
  for (const hash of new Set(await Promise.all(deliveries.list.map(hashOf)))) {
    counts[!seen.has(hash) ? "waiting" : seen.get(hash) ? "applied" : "failed"]++;
  }
  return kit.json({ key, groups: key.match(/.{1,10}/g).join(" "), check: await keyCheck(key), deliveries: counts });
}

// ---------- the notes themselves (signed in) ----------
const forEditor = (state) => ({
  notes: state.notes.map(({ id, text, date }) => ({ id, text, date: date || "" })),
  max: MAX_NOTES, maxLength: MAX_CHARS,
  deliveries: state.sealed.map(({ at, ok, mode, added, skipped, why }) => ({ at, ok, mode, added, skipped, why })),
});

// What she typed, checked. Throws a plain message when it can't be used.
function checked(kit, input, state, selfId) {
  const text = tidy(input && input.text), date = input && input.date ? String(input.date) : "";
  if (!text) throw new kit.UserError(400, "Write the note first.");
  if (count(text) > MAX_CHARS) throw new kit.UserError(400, `Keep a note to ${MAX_CHARS} characters. This one has ${count(text)}.`);
  if (date && !realDate(date)) throw new kit.UserError(400, "That date doesn't look right. Pick it again, or leave it empty.");
  if (state.notes.some((n) => n.text === text && n.id !== selfId)) throw new kit.UserError(400, "That note is already there.");
  return { text, date };
}

async function nextNote(request, env, kit) {
  const asked = new URL(request.url).searchParams.get("today");
  if (asked && !realDate(asked)) return kit.fail(400, "That date doesn't look right.");
  // Her phone's calendar decides the day, so a note's own day begins at her midnight.
  // A phone whose date is far from the server's is not believed; India's date is used instead.
  const serverDay = kit.todayIST();
  const day = asked && Math.abs(Date.parse(asked) - Date.parse(serverDay)) <= 2 * DAY_MS ? asked : serverDay;
  const today = realDate(day);
  const state = await load(env, kit);
  const delivered = await deliver(env, kit, state);
  const note = choose(state, today, day);
  if (!note) {
    if (delivered) await save(env, kit, state);
    return kit.json({});
  }
  await save(env, kit, state);
  // What the next opening will show, so the phone can keep exactly the right space for it:
  // "then" on an ordinary day, and "soon" for each of the next few days that is some note's own day.
  const after = state.notes.find((n) => n.id === state.upNext);
  const soon = [];
  for (let i = 0; i < 3; i++) {
    const dayText = new Date(Date.parse(day) + i * DAY_MS).toISOString().slice(0, 10), d = realDate(dayText);
    const special = notesOfTheDay(state.notes, d);
    if (!special.length) continue;
    const n = turnOf(state, special, dayText);
    soon.push({ day: dayText, text: n.text, marker: markerFor(n, d) });
  }
  return kit.json({ id: note.id, text: note.text, marker: onThisDay(note, today) ? markerFor(note, today) : "",
    then: after ? after.text : "", soon });
}

async function notes(request, env, parts, kit) {
  const id = parts[1] || "", method = request.method;
  if (parts.length > 2) return kit.fail(404, "Not found.");
  if (id === "next") return method === "GET" ? nextNote(request, env, kit) : kit.fail(404, "Not found.");
  const state = await load(env, kit);
  const delivered = await deliver(env, kit, state);

  if (!id && method === "GET") {
    if (delivered) await save(env, kit, state);
    return kit.json(forEditor(state));
  }
  if (!id && method === "POST") {
    if (state.notes.length >= MAX_NOTES) return kit.fail(400, `There's room for ${MAX_NOTES} notes. Remove one to add another.`);
    const { text, date } = checked(kit, await kit.body(request), state, "");
    const note = { id: newId(state), text, ...(date ? { date } : {}), added: Date.now() };
    state.notes.push(note);
    state.bag.push(note.id);                       // it joins the round that is already going
    await save(env, kit, state);
    return kit.json({ ...forEditor(state), note: { id: note.id, text, date } });
  }
  const note = state.notes.find((n) => n.id === id);
  if (id && method === "PUT") {
    if (!note) return kit.fail(404, "That note isn't there any more.");
    const { text, date } = checked(kit, await kit.body(request), state, id);
    note.text = text;
    if (date) note.date = date; else delete note.date;
    await save(env, kit, state);
    return kit.json({ ...forEditor(state), note: { id, text, date } });
  }
  if (id && method === "DELETE") {
    if (!note) return kit.fail(404, "That note isn't there any more.");
    state.notes = state.notes.filter((n) => n.id !== id);
    state.bag = state.bag.filter((b) => b !== id);
    if (state.upNext === id) state.upNext = null;
    if (state.last === id) state.last = null;
    await save(env, kit, state);
    return kit.json(forEditor(state));
  }
  return kit.fail(404, "Not found.");
}

export const open = { "seal-key": sealKey };   // paths anyone may call: /api/<name>
export const routes = { lovenotes: notes };     // paths that need sign-in: /api/<name>

// Timed job: bring in a new delivery even if nobody opens the app. With no deliveries there is no
// job at all; with deliveries already dealt with, a run ends without touching storage.
const DELIVERY_JOB = { name: "lovenotes-deliveries", everyHours: 1, run: (env, kit) => catchUp(env, kit) };
export let jobs = deliveries.list.length ? [DELIVERY_JOB] : [];   // { name, everyHours, run }

// For the local stand-in server only: act out "a new version was deployed with these deliveries".
export function setDeliveries(list) {
  deliveries.list = list.map(String);
  seen.clear();
  jobs = list.length ? [DELIVERY_JOB] : [];
}
