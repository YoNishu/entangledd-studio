/* Upkeep: the housekeeping nobody should have to remember.

   What happens here:
   - cleaning: every kind of file the app stores has a lifetime, and a timed job removes what has outlived it;
   - backups: once a day the documents that can't be made again are copied to backup/<day>/ in the same storage;
   - a short record of problems: the last 30 things that went wrong on the server or in the app on her phone.

   The health record (server/health.js, server/probes.js) reads what these leave behind, so a cleaner or a
   backup that stops shows up there by itself.

   This file is one of the app's add-on sections (see SECTIONS in worker.js).
   Handlers are called as handler(request, env, parts, kit); jobs as run(env, kit). */
import { hide, probe } from "./health.js";
import { tidy as tidyDrafts, keptJobs } from "./drafts.js";

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const dayOf = (ms) => new Date(ms + 5.5 * HOUR).toISOString().slice(0, 10);     // the India day a moment falls on
const tagOf = (o) => String(o.etag || `${o.size}-${new Date(o.uploaded).getTime()}`);

// ---------------------------------------------------------------- cleaning

// How long each kind of stored file is kept. Anything not listed here is a single document that is
// overwritten in place and has a size limit of its own (see the table in docs/SPEC.md).
export const LIFETIMES = [
  { prefix: "jobs/", days: 7 },                   // a reel and what it was made from (the app promises seven days)
  { prefix: "slides/", days: 7 },                 // carousel pictures, fetched by Instagram within minutes
  { prefix: "data/stockcache/", days: 2 },        // background searches, each good for a day
  { prefix: "data/musiccache/", days: 8 },        // music searches, each good for a week
  { prefix: "auth/", days: 1 },                   // wrong-passcode counts (15 minutes) and Face ID challenges (5 minutes)
  { prefix: "data/suggestions/", days: 60 },      // a day's suggestions; the app shows the last seven days
];
const INPUTS = /^jobs\/[0-9a-f-]{36}\/(bg|overlay\.png|music)$/;
const INPUTS_AFTER_MS = HOUR;                      // once the reel exists, what it was made from is only weight
const STORAGE_WARN_BYTES = 8 * 1024 * 1024 * 1024;   // Cloudflare's free storage is 10 GB

// A suggestions file is named for its day, which says more than when it was last saved.
function ageMs(o, now) {
  const named = /^data\/suggestions\/(\d{4}-\d{2}-\d{2})\.json$/.exec(o.key);
  const at = named ? Date.parse(named[1] + "T00:00:00Z") : new Date(o.uploaded).getTime();
  return now - (Number.isFinite(at) ? at : now);
}

// One pass over everything that has a lifetime: one listing per kind, one delete for all of it.
// (Each listing shows up to 1,000 files; anything beyond that waits for the next pass, six hours later.)
export async function clean(env, kit) {
  const now = Date.now();
  // A reel still waiting to be posted (server/drafts.js) keeps its files for 30 days instead of 7.
  const [lists, keep] = await Promise.all([Promise.all(LIFETIMES.map((l) => env.MEDIA.list({ prefix: l.prefix, limit: 1000 }))), keptJobs(env, kit)]);
  const doomed = [];
  let bytes = 0, files = 0, more = false;
  lists.forEach((list, i) => {
    const objects = list.objects || [];
    more = more || !!list.truncated;
    // A reel that has been made no longer needs its background, text layer and music.
    const done = new Map();
    if (LIFETIMES[i].prefix === "jobs/") {
      for (const o of objects) if (o.key.endsWith("/reel.mp4")) done.set(o.key.slice(0, -"reel.mp4".length), new Date(o.uploaded).getTime());
    }
    for (const o of objects) {
      const old = ageMs(o, now) > LIFETIMES[i].days * DAY && !(LIFETIMES[i].prefix === "jobs/" && keep.has(o.key.split("/")[1]));
      const spent = INPUTS.test(o.key) && now - (done.get(o.key.replace(/[^/]+$/, "")) || now) > INPUTS_AFTER_MS;
      if (old || spent) doomed.push(o.key);
      else { bytes += o.size || 0; files += 1; }
    }
  });
  const batch = doomed.slice(0, 1000);
  if (batch.length) await env.MEDIA.delete(batch);
  const state = { at: now, removed: batch.length, waiting: doomed.length - batch.length, files, bytes, more };
  await kit.saveDoc(env, "upkeep", state);
  return state;
}

// ---------------------------------------------------------------- backups

// The documents that can't be made again if they are lost: what she has put in, what the app has learned,
// what was posted and how it did, and the sign-ins. (Caches, counters and the health record are left out:
// the app rebuilds those by itself.) Everything under data/scorer/ is included too.
export const BACKED_UP = ["library", "posts", "taste", "looks", "queue", "history", "rewords", "inspirations",
  "account", "instagram", "passkeys", "lovenotes", "sealkey", "scorer", "draft", "made"];
const KEEP_BACKUP_DAYS = 14;
const COPIES_PER_RUN = 7;                         // each copy is one read and one write; a timed run has about 20 to spend
const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/;
const DOC_NAME = /^(?:[a-z]{2,20}|scorer\/[a-z0-9-]{1,40})$/;
const wanted = (name) => BACKED_UP.includes(name) || /^scorer\/[a-z0-9-]{1,40}$/.test(name);
const emptyBackup = () => ({ day: "", lastAt: 0, docs: {}, prunedDay: "" });

// What is in storage right now for the documents worth keeping: name -> a tag that changes when the document does.
async function currentDocs(env) {
  const [top, scorer] = await Promise.all([
    env.MEDIA.list({ prefix: "data/", delimiter: "/", limit: 1000 }), env.MEDIA.list({ prefix: "data/scorer/", limit: 200 })]);
  const found = new Map();
  for (const o of [...(top.objects || []), ...(scorer.objects || [])]) {
    const name = (/^data\/(.+)\.json$/.exec(o.key) || [])[1];
    if (name && wanted(name)) found.set(name, tagOf(o));
  }
  return found;
}

// Removes copies older than two weeks, but never the newest copy of a document that still exists: one that
// hasn't changed for months keeps its one copy. (A document she has erased, such as with "forget everything",
// is gone from the backups too, two weeks later.)
async function pruneBackups(env, today, live) {
  const list = await env.MEDIA.list({ prefix: "backup/", limit: 1000 });
  const copies = (list.objects || []).map((o) => ({ key: o.key, m: /^backup\/(\d{4}-\d{2}-\d{2})\/(.+)\.json$/.exec(o.key) })).filter((c) => c.m);
  const newest = new Map();
  for (const c of copies) if (!newest.has(c.m[2]) || c.m[1] > newest.get(c.m[2])) newest.set(c.m[2], c.m[1]);
  const cutoff = dayOf(Date.parse(today + "T00:00:00Z") - KEEP_BACKUP_DAYS * DAY);
  const old = copies.filter((c) => c.m[1] < cutoff && !(live.has(c.m[2]) && newest.get(c.m[2]) === c.m[1])).map((c) => c.key);
  if (old.length) await env.MEDIA.delete(old.slice(0, 1000));
  return old.length;
}

// Asked every hour, and nearly free once the day's copy is complete: then it reads one small document and stops.
// A day with many changed documents is finished over two or three runs.
export async function backup(env, kit) {
  const state = { ...emptyBackup(), ...(await kit.loadDoc(env, "backupstate", emptyBackup())) };
  const today = dayOf(Date.now());
  if (state.day === today && state.prunedDay === today) return "done today";
  const live = await currentDocs(env);
  let room = true;
  if (state.day !== today) {
    const changed = [...live].filter(([name, tag]) => (state.docs[name] || {}).tag !== tag);
    for (const [name, tag] of changed.slice(0, COPIES_PER_RUN)) {
      const obj = await env.MEDIA.get(`data/${name}.json`);
      if (!obj) continue;
      await env.MEDIA.put(`backup/${today}/${name}.json`, await obj.arrayBuffer(), { httpMetadata: { contentType: "application/json" } });
      state.docs[name] = { tag, day: today };
    }
    if (changed.length <= COPIES_PER_RUN) { state.day = today; state.lastAt = Date.now(); }
    state.left = Math.max(0, changed.length - COPIES_PER_RUN);
    room = changed.length <= 2;                   // on a day with little to copy there is room left to prune in the same run
  }
  if (state.day === today && room) { await pruneBackups(env, today, live); state.prunedDay = today; }
  await kit.saveDoc(env, "backupstate", state);
  return state.day === today ? "copied" : "more to copy";
}

// GET  /api/backups           which copies exist: days and document names, never what is in them
// POST /api/backups/restore   { day, name }: puts that copy back in place of the live document.
//                             The live one is first kept as backup/undo/<name>.json, so a restore can be undone.
async function backups(request, env, parts, kit) {
  if (request.method === "GET" && parts.length === 1) {
    const list = await env.MEDIA.list({ prefix: "backup/", limit: 1000 });
    const days = new Map();
    for (const o of list.objects || []) {
      const m = /^backup\/(\d{4}-\d{2}-\d{2}|undo)\/(.+)\.json$/.exec(o.key);
      if (m) days.set(m[1], [...(days.get(m[1]) || []), m[2]]);
    }
    const state = { ...emptyBackup(), ...(await kit.loadDoc(env, "backupstate", emptyBackup())) };
    return kit.json({ lastComplete: state.day, days: [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, docs]) => ({ day, docs: docs.sort() })) });
  }
  if (request.method === "POST" && parts[1] === "restore" && parts.length === 2) {
    const b = await kit.body(request);
    const day = String(b.day || ""), name = String(b.name || "");
    if (!(DAY_NAME.test(day) || day === "undo") || !DOC_NAME.test(name) || !wanted(name)) return kit.fail(400, "Say which day and which document to bring back.");
    const copy = await env.MEDIA.get(`backup/${day}/${name}.json`);
    if (!copy) return kit.fail(404, "There is no copy of that document from that day.");
    const fresh = await copy.arrayBuffer();
    const meta = { httpMetadata: { contentType: "application/json" } };
    const live = await env.MEDIA.get(`data/${name}.json`);
    if (live && day !== "undo") await env.MEDIA.put(`backup/undo/${name}.json`, await live.arrayBuffer(), meta);
    await env.MEDIA.put(`data/${name}.json`, fresh, meta);
    return kit.json({ ok: true, restored: name, from: day, undo: live && day !== "undo" ? "undo" : "" });
  }
  return kit.fail(404, "Not found.");
}

// ---------------------------------------------------------------- a short record of problems

const KEEP_ERRORS = 30;
const WRITE_EVERY_MS = 60 * 1000;
let waiting = [];                                  // problems seen by this running copy and not yet written down

// A short, safe description of what went wrong. An error's own words can quote whatever was being handled
// at the time (a line of text, an address, a key), so anything in quotes is dropped, anything shaped like
// a key is hidden, and only the first 140 characters are kept.
export function plainError(e) {
  const name = e && e.name && e.name !== "Error" ? `${e.name}: ` : "";
  const said = String((e && e.message) || e || "unknown")
    .replace(/"[^"]*"|`[^`]*`/g, "…").replace(/(^|[\s(:=,[])'[^']*'(?=$|[\s).,:;\]])/g, "$1…")       // (an apostrophe inside a word is left alone)
    .replace(/https?:\/\/\S+/g, "(an address)");
  return hide(name + said).replace(/\s+/g, " ").trim().slice(0, 140);
}
// "POST /api/posts/:id/comments": the path with every id taken out, and nothing after a question mark.
export function plainPath(method, parts) {
  const safe = (parts || []).slice(0, 4).map((p) => (/^[a-z][a-z-]{1,24}$/.test(p) ? p : ":id"));
  return `${method} /api/${safe.join("/")}`;
}

// Never throws. Written at most once a minute, however many problems arrive; the ones in between wait in
// memory and go in with the next write.
export async function noteError(env, kit, where, e) {
  try {
    if (!env.MEDIA) return;
    waiting.push({ at: Date.now(), where: String(where).slice(0, 80), what: plainError(e) });
    waiting = waiting.slice(-10);
    const doc = await kit.loadDoc(env, "errors", { list: [], writtenAt: 0 });
    if (Date.now() - (Number(doc.writtenAt) || 0) < WRITE_EVERY_MS) return;
    const list = [...(Array.isArray(doc.list) ? doc.list : []), ...waiting].slice(-KEEP_ERRORS);
    waiting = [];
    await kit.saveDoc(env, "errors", { list, writtenAt: Date.now() });
  } catch (err) { console.error("the record of problems couldn't be written", err && err.message); }
}

// POST /api/oops  { what, where }: something went wrong in the app on her phone (a script error).
// Kept in the same record, so a screen that breaks on her iPhone doesn't go unnoticed.
async function oops(request, env, parts, kit) {
  if (request.method !== "POST" || parts.length !== 1) return kit.fail(404, "Not found.");
  const b = await kit.body(request);
  const where = kit.oneLine(b.where, 60).replace(/[^\w./:-]+/g, " ").replace(/^.*\//, "");
  await noteError(env, kit, `in the app${where ? `, ${where}` : ""}`, { message: kit.oneLine(b.what, 200) });
  return kit.json({ ok: true });
}

// ---------------------------------------------------------------- what the health record reads

// Three small documents, read once a day by the health record's own job. No outside calls.
export async function upkeepState(env, kit) {
  const [cleaned, backed, errors] = await Promise.all([
    kit.loadDoc(env, "upkeep", null), kit.loadDoc(env, "backupstate", null), kit.loadDoc(env, "errors", { list: [] })]);
  const list = Array.isArray(errors && errors.list) ? errors.list : [];
  const lastDay = list.filter((x) => x && Date.now() - x.at < DAY);
  return { cleaned, backed, errorsLastDay: lastDay.length, latestError: lastDay.length ? lastDay[lastDay.length - 1] : null, STORAGE_WARN_BYTES,
    guessing: lastDay.find((x) => x.where === "sign-in") || null };       // someone tried a great many wrong passcodes (see login in worker.js)
}

export const routes = { backups, oops };
export const jobs = [
  { name: "upkeep-clean", everyHours: 6, run: (env, kit) => clean(env, kit) },
  { name: "upkeep-backup", everyHours: 1, run: (env, kit) => backup(env, kit) },
  // Drafts and made reels (server/drafts.js): entries past their keeping, and the files nothing names any more.
  { name: "upkeep-drafts", everyHours: 6, run: (env, kit) => tidyDrafts(env, kit) },
  // The health record's probes (server/probes.js), in two small runs. They come after the two jobs above
  // so that, after an update, their first report already says how the cleaning and the backup went.
  { name: "health-services", everyHours: 24, run: (env, kit) => probe(env, kit, "services") },
  { name: "health-page", everyHours: 24, run: (env, kit) => probe(env, kit, "page") },
];
