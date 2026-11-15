/* Drafts: what she is working on in Create, and the reels she has made, kept so she can come back and change them.

   What is stored:
   - data/draft.json   the current draft: { id, of, updated, snap }. One per app; the last save wins (two phones).
   - data/made.json    the reels made from the app: [{ id, jobId, made, snap, about, posted?, postId? }].
                       At most 20 not posted, each kept 30 days; a posted one keeps what it was made from for
                       7 days ("Make a version of this"), then the entry goes (the post's own record stays).
   - drafts/<fileId>   a background or a music file exactly as she chose it. Uploaded once; a reel made from it
                       uses the same file (see bgFile and file= in worker.js), so nothing is sent twice.
   - jobs/<jobId>/keep.json   what a reel is being made from. When the renderer hands in the finished reel, the
                       server turns it into an entry of made.json, so closing the app while it renders loses nothing.
   - jobs/<jobId>/thumb.jpg   a small still for the card in Posts.

   A "snap" is the whole composer as plain data (web/app.js snapshot()); the server only keeps it and gives it back.

   This file is one of the app's add-on sections (see SECTIONS in worker.js); the cleaner in upkeep.js calls tidy().
   Handlers are called as handler(request, env, parts, kit). */

const DAY = 24 * 60 * 60 * 1000;
export const MADE_MAX = 20, MADE_DAYS = 30, DRAFT_DAYS = 30, POSTED_DAYS = 7;
const HANDOFF_HOURS = 72;                         // as in worker.js: a hand-over is looked for this long
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PART_SIZE = 8 * 1024 * 1024;                // as for a reel's background: equal parts of at least 5 MB
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_SNAP_CHARS = 64 * 1024;
const MAX_THUMB_BYTES = 300 * 1024;
const FILE_TYPES = /^(jpg|jpeg|png|heic|webp|gif|mp4|mov|m4v|webm|mp3|m4a|aac|wav|ogg|oga|flac)$/;
const FILE_GRACE_MS = DAY;                        // a file not (yet) named by any draft is left alone this long

export const fileKey = (id) => `drafts/${id}`;
const jobKey = (id, name) => `jobs/${id}/${name}`;
const JOB_FILES = ["job.json", "bg", "overlay.png", "music", "reel.mp4", "keep.json", "thumb.jpg"];

// The files a snap names (background, music).
const filesOf = (snap) => [snap && snap.bg && snap.bg.file, snap && snap.music && snap.music.file].filter((f) => UUID.test(f || ""));

function cleanSnap(snap, kit) {
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.blocks)) throw new kit.UserError(400, "That draft couldn't be read.");
  if (JSON.stringify(snap).length > MAX_SNAP_CHARS) throw new kit.UserError(400, "That draft is too large to keep.");
  return snap;
}
const cleanAbout = (a, kit) => {
  const o = a && typeof a === "object" ? a : {};
  return { quote: kit.lines(o.quote, 600), author: kit.oneLine(o.author, 80), theme: kit.oneLine(o.theme, 30), tone: kit.oneLine(o.tone, 20),
    source: kit.oneLine(o.source, 20), suggestionId: UUID.test(o.suggestionId || "") ? o.suggestionId : "",
    made: o.made && typeof o.made === "object" && JSON.stringify(o.made).length < 2000 ? o.made : null };
};

const alive = (h, now) => now - h.at < HANDOFF_HOURS * 3600 * 1000;
const keptUntil = (m) => (m.posted ? m.posted + POSTED_DAYS * DAY : m.made + MADE_DAYS * DAY);
const draftAlive = (d, now) => !!d && now - (d.updated || 0) < DRAFT_DAYS * DAY;

// Marks the reels that have been posted (the record of posts says so), and drops what has outlived its keeping.
// Returns true when something changed.
function settle(made, posts, now) {
  let changed = false;
  const byJob = new Map(posts.filter((p) => p.jobId && p.state === "published").map((p) => [p.jobId, p]));
  for (const m of made) {
    const p = byJob.get(m.jobId);
    if (p && !m.posted) { m.posted = p.published || p.created || now; m.postId = p.id; changed = true; }
  }
  const left = made.filter((m) => keptUntil(m) > now);
  if (left.length !== made.length) changed = true;
  return { made: left, changed };
}

async function readAll(env, kit) {
  const [draft, made, posts, queue, handoffs] = await Promise.all([kit.loadDoc(env, "draft", null), kit.loadDoc(env, "made", []),
    kit.loadDoc(env, "posts", []), kit.loadDoc(env, "queue", []), kit.loadDoc(env, "handoffs", [])]);
  return { draft, made, posts, queue, handoffs };
}
// Where a made reel is now: "made" (only in Made, not posted), "queue", "handoff", "posting" or "posted".
function placeOf(m, all, now) {
  if (m.posted) return "posted";
  if (all.posts.some((p) => p.jobId === m.jobId && p.state === "processing")) return "posting";
  if (all.queue.some((q) => q.jobId === m.jobId)) return "queue";
  if (all.handoffs.some((h) => h.jobId === m.jobId && alive(h, now))) return "handoff";
  return "made";
}

async function listing(env, kit) {
  const now = Date.now(), all = await readAll(env, kit);
  const s = settle(all.made, all.posts, now);
  if (s.changed) await kit.saveDoc(env, "made", s.made);
  return kit.json({
    current: draftAlive(all.draft, now) ? all.draft : null,
    made: s.made.slice().sort((a, b) => b.made - a.made).map((m) => ({ id: m.id, jobId: m.jobId, made: m.made, posted: m.posted || 0, postId: m.postId || "",
      keptUntil: keptUntil(m), where: placeOf(m, all, now), snap: m.snap, about: m.about || null })),
    limits: { made: MADE_MAX, madeDays: MADE_DAYS, postedDays: POSTED_DAYS },
  });
}

// ---------------------------------------------------------------- files (multipart, like a reel's background)

async function fileRoutes(request, env, parts, kit) {
  const method = request.method, id = parts[2], url = new URL(request.url);
  if (parts.length === 2 && method === "POST") {
    const b = await kit.body(request);
    const size = Number(b.size), ext = (String(b.name || "").match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    if (!(size > 0 && size <= MAX_FILE_BYTES)) return kit.fail(400, "That file is too large to keep.");
    if (!ext || !FILE_TYPES.test(ext.toLowerCase())) return kit.fail(400, "That file type can't be kept.");
    const fileId = crypto.randomUUID();
    const upload = await env.MEDIA.createMultipartUpload(fileKey(fileId));
    return kit.json({ fileId, uploadId: upload.uploadId, partSize: PART_SIZE });
  }
  if (!UUID.test(id || "")) return kit.fail(404, "No such file.");
  if (parts.length === 3 && method === "GET") {
    const obj = await env.MEDIA.get(fileKey(id));
    if (!obj) return kit.fail(404, "That file is no longer kept.");
    return new Response(obj.body, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(obj.size), "Cache-Control": "no-store" } });
  }
  if (parts.length === 4 && parts[3] === "complete" && method === "POST") {
    const b = await kit.body(request);
    if (!b.uploadId || !Array.isArray(b.parts) || !b.parts.length) return kit.fail(400, "No uploaded parts were listed.");
    await env.MEDIA.resumeMultipartUpload(fileKey(id), String(b.uploadId)).complete(b.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
    return kit.json({ ok: true });
  }
  if (parts.length === 4 && /^\d+$/.test(parts[3]) && method === "PUT") {
    const n = Number(parts[3]), uploadId = url.searchParams.get("uploadId");
    if (!(n >= 1 && n <= 1000) || !uploadId) return kit.fail(400, "Missing part number or upload id.");
    const part = await env.MEDIA.resumeMultipartUpload(fileKey(id), uploadId).uploadPart(n, await request.arrayBuffer());
    return kit.json({ partNumber: part.partNumber, etag: part.etag });
  }
  return kit.fail(404, "Not found.");
}

// ---------------------------------------------------------------- a reel being made, and when it is done

// PUT /api/drafts/keep/<jobId> { draftId, of, snap, about }: what this reel is made from. Answers which entry of
// Made, not posted it will be: the one it was edited from when that one is only there (it is replaced), otherwise new.
async function keep(request, env, jobId, kit) {
  const b = await kit.body(request);
  const job = await env.MEDIA.get(jobKey(jobId, "job.json"));
  if (!job) return kit.fail(404, "No such reel.");
  const snap = cleanSnap(b.snap, kit), now = Date.now(), all = await readAll(env, kit);
  const was = UUID.test(b.of || "") ? all.made.find((m) => m.id === b.of) : null;
  const replaces = !!was && placeOf(was, all, now) === "made";
  const entryId = replaces ? was.id : crypto.randomUUID();
  await env.MEDIA.put(jobKey(jobId, "keep.json"), JSON.stringify({ draftId: kit.oneLine(b.draftId, 40), entryId, snap, about: cleanAbout(b.about, kit) }),
    { httpMetadata: { contentType: "application/json" } });
  return kit.json({ entryId, replaces, newVersion: !!was && !replaces, wasWhere: was ? placeOf(was, all, now) : "" });
}

// Called by worker.js the moment the renderer has handed in a finished reel.
export async function reelDone(env, kit, jobId) {
  const obj = await env.MEDIA.get(jobKey(jobId, "keep.json"));
  if (!obj) return null;
  const k = await obj.json(), now = Date.now(), all = await readAll(env, kit);
  let made = settle(all.made, all.posts, now).made;
  const gone = [];
  let entry = made.find((m) => m.id === k.entryId);
  if (entry && entry.jobId !== jobId && placeOf(entry, all, now) === "made") {
    gone.push(entry.jobId);                      // the version it replaces, and its files, go
    Object.assign(entry, { jobId, made: now, snap: k.snap, about: k.about });
  } else if (!entry || entry.jobId !== jobId) {
    entry = { id: entry ? crypto.randomUUID() : k.entryId, jobId, made: now, snap: k.snap, about: k.about };
    made.push(entry);
  }
  // At most MADE_MAX waiting: the oldest that is only in Made, not posted makes room.
  for (;;) {
    const waiting = made.filter((m) => !m.posted);
    if (waiting.length <= MADE_MAX) break;
    const oldest = waiting.filter((m) => m !== entry && placeOf(m, all, now) === "made").sort((a, b) => a.made - b.made)[0];
    if (!oldest) break;
    made = made.filter((m) => m !== oldest);
    gone.push(oldest.jobId);
  }
  await kit.saveDoc(env, "made", made);
  if (gone.length) await env.MEDIA.delete(gone.flatMap((j) => JOB_FILES.map((n) => jobKey(j, n))));
  return entry.id;
}

// The reels whose files must outlive the usual seven days for jobs/: those still waiting to be posted.
export async function keptJobs(env, kit) {
  const made = await kit.loadDoc(env, "made", []);
  const now = Date.now();
  return new Set(made.filter((m) => !m.posted && keptUntil(m) > now).map((m) => m.jobId));
}

// The cleaner's part (upkeep.js clean): drops entries and the current draft once they have outlived their keeping,
// and lists the files under drafts/ that nothing names any more. Returns the jobs to keep and the files to remove.
export async function tidy(env, kit, now) {
  const [draft, madeAll, posts, list] = await Promise.all([kit.loadDoc(env, "draft", null), kit.loadDoc(env, "made", []),
    kit.loadDoc(env, "posts", []), env.MEDIA.list({ prefix: "drafts/", limit: 1000 })]);
  const s = settle(madeAll, posts, now);
  if (s.changed) await kit.saveDoc(env, "made", s.made);
  const live = draftAlive(draft, now);
  if (draft && !live) await env.MEDIA.delete("data/draft.json");
  const named = new Set([...(live ? filesOf(draft.snap) : []), ...s.made.flatMap((m) => filesOf(m.snap))].map(fileKey));
  const doomed = [];
  let bytes = 0, files = 0;
  for (const o of list.objects || []) {
    if (!named.has(o.key) && now - new Date(o.uploaded).getTime() > FILE_GRACE_MS) doomed.push(o.key);
    else { bytes += o.size || 0; files += 1; }
  }
  return { jobs: new Set(s.made.filter((m) => !m.posted).map((m) => m.jobId)), doomed, bytes, files, more: !!list.truncated };
}

// ---------------------------------------------------------------- routes

async function drafts(request, env, parts, kit) {
  const method = request.method, what = parts[1] || "";
  if (!what && method === "GET") return listing(env, kit);
  if (what === "current" && parts.length === 2 && method === "PUT") {
    const b = await kit.body(request);
    if (!UUID.test(b.id || "")) return kit.fail(400, "That draft has no name.");
    const draft = { id: b.id, of: UUID.test(b.of || "") ? b.of : "", updated: Date.now(), snap: cleanSnap(b.snap, kit) };
    await kit.saveDoc(env, "draft", draft);
    return kit.json({ ok: true, updated: draft.updated });
  }
  if (what === "current" && parts.length === 2 && method === "DELETE") {
    await env.MEDIA.delete("data/draft.json");
    return kit.json({ ok: true });
  }
  if (what === "files") return fileRoutes(request, env, parts, kit);
  const id = parts[2];
  if (!UUID.test(id || "")) return kit.fail(404, "Not found.");
  if (what === "keep" && method === "PUT") return keep(request, env, id, kit);
  if (what === "thumb" && method === "PUT") {
    const size = Number(request.headers.get("Content-Length") || 0);
    if (!(size > 0 && size <= MAX_THUMB_BYTES)) return kit.fail(400, "The small picture is missing or too large.");
    if (!(await env.MEDIA.head(jobKey(id, "job.json")))) return kit.fail(404, "No such reel.");
    await env.MEDIA.put(jobKey(id, "thumb.jpg"), await request.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
    return kit.json({ ok: true });
  }
  if (what === "thumb" && method === "GET") {
    const obj = await env.MEDIA.get(jobKey(id, "thumb.jpg"));
    if (!obj) return kit.fail(404, "No picture.");
    return new Response(obj.body, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(obj.size), "Cache-Control": "private, max-age=86400" } });
  }
  if (what === "made" && method === "DELETE") {
    const all = await readAll(env, kit);
    const m = all.made.find((x) => x.id === id);
    if (!m) return listing(env, kit);
    await kit.saveDoc(env, "made", all.made.filter((x) => x !== m));
    // The reel's own files go too, unless it is still waiting somewhere else (post later, Instagram) or was posted.
    if (placeOf(m, all, Date.now()) === "made") await env.MEDIA.delete(JOB_FILES.map((n) => jobKey(m.jobId, n)));
    return listing(env, kit);
  }
  return kit.fail(404, "Not found.");
}

export const routes = { drafts };
