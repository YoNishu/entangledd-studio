/* Entangledd Studio server (Cloudflare Worker).

   Files in web/ are served by Cloudflare directly; this code only handles /api/*.

   Secrets (set in the Cloudflare dashboard, never in the repo):
     APP_PASSCODE   what she types to open the app
     RENDER_SECRET  shared with GitHub Actions so only the renderer can fetch and return files
     GITHUB_TOKEN   lets the app start a render on GitHub
   Bindings and vars (wrangler.jsonc):
     MEDIA          R2 bucket for uploads and finished reels
     GITHUB_REPO    "owner/repo" that holds the render workflow
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PART_SIZE = 8 * 1024 * 1024;        // R2 needs equal parts of at least 5 MB
const MAX_BG_BYTES = 500 * 1024 * 1024;
const MAX_OVERLAY_BYTES = 8 * 1024 * 1024;
const MAX_REEL_BYTES = 95 * 1024 * 1024;  // Cloudflare's free plan caps a request at 100 MB
const KEEP_DAYS = 7;
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_TRIES = 10, LOGIN_WINDOW_MS = 15 * 60 * 1000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const fail = (status, message) => json({ error: message }, status);

async function hmacHex(key, message) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Compares without stopping at the first difference, so timing reveals nothing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const bearer = (request) => {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
};
const sessionToken = (env) => hmacHex(env.APP_PASSCODE, "entangledd-session-v1");
async function signedIn(request, env) {
  return !!env.APP_PASSCODE && safeEqual(bearer(request), await sessionToken(env));
}
const isRenderer = (request, env) => !!env.RENDER_SECRET && safeEqual(bearer(request), env.RENDER_SECRET);
const reelsReady = (env) => !!(env.MEDIA && env.GITHUB_TOKEN && env.RENDER_SECRET && env.GITHUB_REPO);

const jobKey = (id, name) => `jobs/${id}/${name}`;
async function readJob(env, id) {
  const obj = await env.MEDIA.get(jobKey(id, "job.json"));
  return obj ? obj.json() : null;
}
const writeJob = (env, job) => env.MEDIA.put(jobKey(job.id, "job.json"), JSON.stringify(job), {
  httpMetadata: { contentType: "application/json" },
});

// ---------- sign in ----------
async function login(request, env) {
  if (!env.APP_PASSCODE) return fail(503, "The passcode hasn't been set up yet.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `auth/${await hmacHex(env.APP_PASSCODE, "ip:" + ip)}.json`;
  let tries = { n: 0, since: Date.now() };
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) tries = await obj.json();
    if (Date.now() - tries.since > LOGIN_WINDOW_MS) tries = { n: 0, since: Date.now() };
    if (tries.n >= LOGIN_TRIES) return fail(429, "Too many wrong tries. Wait 15 minutes and try again.");
  }
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, "Send the passcode as JSON."); }
  if (!safeEqual(String(body.passcode || ""), env.APP_PASSCODE)) {
    if (env.MEDIA) await env.MEDIA.put(key, JSON.stringify({ n: tries.n + 1, since: tries.since }));
    return fail(401, "That passcode isn't right.");
  }
  if (env.MEDIA && tries.n) await env.MEDIA.delete(key);
  return json({ token: await sessionToken(env) });
}

// ---------- jobs, called by the app ----------
async function purgeOld(env) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const list = await env.MEDIA.list({ prefix: "jobs/", limit: 500 });
  const old = list.objects.filter((o) => new Date(o.uploaded).getTime() < cutoff).map((o) => o.key);
  if (old.length) await env.MEDIA.delete(old);
}

async function createJob(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return fail(400, "Send the reel settings as JSON."); }
  const length = Number(b.length), bgSize = Number(b.bgSize);
  const bgName = String(b.bgName || "").slice(0, 120);
  if (!(length >= 5 && length <= 90)) return fail(400, "Reel length must be between 5 and 90 seconds.");
  if (!(bgSize > 0 && bgSize <= MAX_BG_BYTES)) return fail(400, "The background file must be under 500 MB.");
  const ext = (bgName.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
  if (!ext || !/^(mp4|mov|m4v|webm|jpg|jpeg|png)$/i.test(ext)) return fail(400, "That background file type isn't supported.");

  await purgeOld(env);
  const job = {
    id: crypto.randomUUID(), created: Date.now(), state: "uploading", error: null,
    length, keepAudio: !!b.keepAudio, fade: !!b.fade, bgExt: ext.toLowerCase(),
  };
  const upload = await env.MEDIA.createMultipartUpload(jobKey(job.id, "bg"));
  await writeJob(env, job);
  return json({ id: job.id, uploadId: upload.uploadId, partSize: PART_SIZE });
}

async function uploadPart(request, env, id, n, uploadId) {
  if (!(n >= 1 && n <= 1000) || !uploadId) return fail(400, "Missing part number or upload id.");
  const upload = env.MEDIA.resumeMultipartUpload(jobKey(id, "bg"), uploadId);
  const part = await upload.uploadPart(n, await request.arrayBuffer());
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function completeUpload(request, env, id) {
  let b;
  try { b = await request.json(); } catch (e) { return fail(400, "Send the uploaded parts as JSON."); }
  if (!b.uploadId || !Array.isArray(b.parts) || !b.parts.length) return fail(400, "No uploaded parts were listed.");
  const upload = env.MEDIA.resumeMultipartUpload(jobKey(id, "bg"), b.uploadId);
  await upload.complete(b.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
  return json({ ok: true });
}

async function putOverlay(request, env, id) {
  const size = Number(request.headers.get("Content-Length") || 0);
  if (!(size > 0 && size <= MAX_OVERLAY_BYTES)) return fail(400, "The text layer is missing or too large.");
  await env.MEDIA.put(jobKey(id, "overlay.png"), await request.arrayBuffer(), { httpMetadata: { contentType: "image/png" } });
  return json({ ok: true });
}

async function startJob(request, env, id, job) {
  const [bg, overlay] = await Promise.all([env.MEDIA.head(jobKey(id, "bg")), env.MEDIA.head(jobKey(id, "overlay.png"))]);
  if (!bg || !overlay) return fail(409, "The background or text layer hasn't finished uploading.");
  const api = env.GITHUB_API || "https://api.github.com";
  const res = await fetch(`${api}/repos/${env.GITHUB_REPO}/actions/workflows/render-job.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "entangledd-studio", "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { job_id: id, app_url: new URL(request.url).origin } }),
  });
  if (!res.ok) {
    job.state = "failed";
    job.error = `GitHub wouldn't start the render (status ${res.status}). The GitHub token may be wrong or expired.`;
    await writeJob(env, job);
    return fail(502, job.error);
  }
  job.state = "rendering"; job.started = Date.now();
  await writeJob(env, job);
  return json({ state: job.state });
}

function publicState(job) {
  if (job.state === "rendering" && Date.now() - (job.started || job.created) > RENDER_TIMEOUT_MS) {
    return { state: "failed", error: "The render took too long and was given up on. Try again." };
  }
  return { state: job.state, error: job.error };
}

const stream = (obj, type) => new Response(obj.body, {
  headers: { "Content-Type": type, "Content-Length": String(obj.size), "Cache-Control": "no-store" },
});

async function appRoutes(request, env, parts) {
  const method = request.method;
  if (!reelsReady(env)) return fail(503, "Reels aren't set up on the server yet.");
  if (parts.length === 1 && method === "POST") return createJob(request, env);

  const id = parts[1];
  if (!UUID.test(id || "")) return fail(404, "No such reel.");
  const job = await readJob(env, id);
  if (!job) return fail(404, "No such reel.");
  const rest = parts.slice(2).join("/");
  const url = new URL(request.url);

  if (rest === "" && method === "GET") return json(publicState(job));
  if (rest === "" && method === "DELETE") {
    await env.MEDIA.delete(["job.json", "bg", "overlay.png", "reel.mp4"].map((n) => jobKey(id, n)));
    return json({ ok: true });
  }
  if (rest === "reel" && method === "GET") {
    const obj = await env.MEDIA.get(jobKey(id, "reel.mp4"));
    return obj ? stream(obj, "video/mp4") : fail(404, "The reel isn't ready yet.");
  }
  if (job.state !== "uploading") return fail(409, "This reel has already been sent for rendering.");
  if (/^bg\/\d+$/.test(rest) && method === "PUT") {
    return uploadPart(request, env, id, Number(rest.split("/")[1]), url.searchParams.get("uploadId"));
  }
  if (rest === "bg/complete" && method === "POST") return completeUpload(request, env, id);
  if (rest === "overlay" && method === "PUT") return putOverlay(request, env, id);
  if (rest === "start" && method === "POST") return startJob(request, env, id, job);
  return fail(404, "Not found.");
}

// ---------- called by the renderer on GitHub ----------
async function renderRoutes(request, env, parts) {
  const id = parts[1], what = parts[2], method = request.method;
  if (!UUID.test(id || "")) return fail(404, "No such reel.");
  const job = await readJob(env, id);
  if (!job) return fail(404, "No such reel.");

  if (what === "job" && method === "GET") return json(job);
  if (what === "bg" && method === "GET") {
    const obj = await env.MEDIA.get(jobKey(id, "bg"));
    return obj ? stream(obj, "application/octet-stream") : fail(404, "No background.");
  }
  if (what === "overlay" && method === "GET") {
    const obj = await env.MEDIA.get(jobKey(id, "overlay.png"));
    return obj ? stream(obj, "image/png") : fail(404, "No text layer.");
  }
  if (what === "reel" && method === "PUT") {
    const size = Number(request.headers.get("Content-Length") || 0);
    if (!(size > 0 && size <= MAX_REEL_BYTES)) return fail(413, "The finished reel is missing or over 95 MB.");
    await env.MEDIA.put(jobKey(id, "reel.mp4"), request.body, { httpMetadata: { contentType: "video/mp4" } });
    job.state = "done"; job.error = null; job.finished = Date.now();
    await writeJob(env, job);
    return json({ ok: true });
  }
  if (what === "status" && method === "POST") {
    let b;
    try { b = await request.json(); } catch (e) { return fail(400, "Send the status as JSON."); }
    if (b.state !== "failed") return fail(400, "Only a failed status can be reported here.");
    job.state = "failed"; job.error = String(b.error || "The reel could not be put together.").slice(0, 300);
    await writeJob(env, job);
    return json({ ok: true });
  }
  return fail(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    const parts = url.pathname.slice(5).split("/").filter(Boolean);
    try {
      if (parts[0] === "status" && request.method === "GET") {
        return json({ configured: !!env.APP_PASSCODE, signedIn: await signedIn(request, env), reels: reelsReady(env) });
      }
      if (parts[0] === "login" && request.method === "POST") return login(request, env);
      if (parts[0] === "render") {
        if (!isRenderer(request, env)) return fail(401, "Not allowed.");
        return renderRoutes(request, env, parts);
      }
      if (parts[0] === "jobs") {
        if (!(await signedIn(request, env))) return fail(401, "Enter the passcode to continue.");
        return appRoutes(request, env, parts);
      }
      return fail(404, "Not found.");
    } catch (e) {
      console.error(e);
      return fail(500, "Something went wrong on the server. Try again.");
    }
  },
};
