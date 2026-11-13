/* Entangledd Studio server (Cloudflare Worker).

   Files in web/ are served by Cloudflare directly; this code only handles /api/*.

   Secrets (set in the Cloudflare dashboard, never in the repo):
     APP_PASSCODE   what she types to open the app
     RENDER_SECRET  shared with GitHub Actions so only the renderer can fetch and return files
     GITHUB_TOKEN   lets the app start a render on GitHub
     ANTHROPIC_API_KEY  for Nishiii: quote suggestions, rewording, reading a scanned page
     PIXABAY_API_KEY    for the free footage search (or PEXELS_API_KEY; Pixabay is used if both are set)
     META_APP_ID, META_APP_SECRET   the Meta developer app, for connecting and posting to Instagram
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
  const lists = await Promise.all(["jobs/", "data/stockcache/"].map((prefix) => env.MEDIA.list({ prefix, limit: 500 })));
  const old = lists.flatMap((l) => l.objects).filter((o) => new Date(o.uploaded).getTime() < cutoff).map((o) => o.key);
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

// ---------- small JSON documents kept in storage ----------
async function loadDoc(env, name, fallback) {
  const obj = await env.MEDIA.get(`data/${name}.json`);
  return obj ? obj.json() : fallback;
}
const saveDoc = (env, name, doc) => env.MEDIA.put(`data/${name}.json`, JSON.stringify(doc), {
  httpMetadata: { contentType: "application/json" },
});
const emptyLibrary = () => ({ quotes: [], books: [], screen: [], accounts: [] });
const oneLine = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lines = (v, max) => String(v ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const todayIST = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
async function body(request) {
  try { return await request.json(); } catch (e) { throw new UserError(400, "That request couldn't be read."); }
}
class UserError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---------- her library: own quotes, books, accounts ----------
const LIMITS = { quotes: 500, books: 100, screen: 150, accounts: 50 };
async function libraryRoutes(request, env, parts) {
  const lib = { ...emptyLibrary(), ...(await loadDoc(env, "library", emptyLibrary())) };
  const kind = parts[1], id = parts[2], method = request.method;
  if (!kind && method === "GET") return json(lib);
  if (!["quotes", "books", "screen", "accounts"].includes(kind)) return fail(404, "Not found.");

  if (method === "DELETE" && id) {
    lib[kind] = lib[kind].filter((x) => x.id !== id);
    await saveDoc(env, "library", lib);
    return json(lib);
  }
  if (method !== "POST") return fail(404, "Not found.");
  if (lib[kind].length >= LIMITS[kind]) return fail(400, "That list is full. Remove something first.");
  const b = await body(request);
  let item;
  if (kind === "quotes") {
    item = { text: lines(b.text, 500), author: oneLine(b.author, 80), from: oneLine(b.from, 120) };
    if (!item.text) return fail(400, "Write the quote first.");
    if (lib.quotes.some((q) => norm(q.text) === norm(item.text))) return fail(409, "That quote is already saved.");
  } else if (kind === "books") {
    item = { title: oneLine(b.title, 120), author: oneLine(b.author, 80) };
    if (!item.title) return fail(400, "Add the book's title.");
    if (lib.books.some((x) => norm(x.title) === norm(item.title))) return fail(409, "That book is already on the list.");
  } else if (kind === "screen") {
    item = { title: oneLine(b.title, 120), kind: b.kind === "series" ? "series" : "film" };
    if (!item.title) return fail(400, "Add the title.");
    if (lib.screen.some((x) => norm(x.title) === norm(item.title) && x.kind === item.kind)) return fail(409, "That's already on the list.");
  } else {
    const handle = oneLine(b.handle, 80).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?].*$/, "");
    if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return fail(400, "That doesn't look like an Instagram username.");
    item = { handle: handle.toLowerCase() };
    if (lib.accounts.some((x) => x.handle === item.handle)) return fail(409, "That account is already on the list.");
  }
  lib[kind].push({ id: crypto.randomUUID(), added: Date.now(), ...item });
  await saveDoc(env, "library", lib);
  return json(lib);
}

// ---------- Claude ----------
async function claude(env, { system, messages, maxTokens = 2000 }) {
  if (!env.ANTHROPIC_API_KEY) throw new UserError(503, "Nishiii isn't connected yet: the Anthropic key is missing.");
  const res = await fetch((env.ANTHROPIC_API || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: maxTokens, output_config: { effort: "medium" }, system, messages }),
  });
  if (res.status === 401 || res.status === 403) throw new UserError(502, "The Anthropic key was rejected. Check it in Cloudflare.");
  if (res.status === 429) throw new UserError(502, "Claude is busy right now. Try again in a minute.");
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch (e) { /* no detail */ }
    console.error("Claude error", res.status, detail);
    throw new UserError(502, /credit|billing/i.test(detail)
      ? "The Anthropic account is out of credit. Add credit in the Anthropic console."
      : `Claude couldn't answer (status ${res.status}). Try again.`);
  }
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}
// Claude is asked for JSON only; this copes with stray text or code fences around it.
function parseJson(text) {
  const t = String(text).replace(/```(?:json)?/gi, "");
  const start = t.search(/[[{]/);
  if (start < 0) throw new UserError(502, "Claude's answer couldn't be read. Try again.");
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  try { return JSON.parse(t.slice(start, end + 1)); }
  catch (e) { throw new UserError(502, "Claude's answer couldn't be read. Try again."); }
}

// ---------- daily suggestions ----------
const SUGGEST_SYSTEM = `You choose quotes for a quiet, reflective Instagram quotes page.
Reply with a JSON array only, no other text. Each item:
{"text": "...", "author": "...", "source": {"type": "book", "film", "series" or "classic", "title": "..."}, "theme": "one or two words", "tone": "one word", "verify": true or false}

Rules:
- Real quotes only, in the author's real words. Never invent a quote or an attribution.
- "book" means a line from one of the reader's listed books; use it only for passages you actually know from that book, and put the book's title in source.title.
- "film" and "series" mean a line of dialogue or narration from one of the reader's listed films or series; put its title in source.title and the character or person who says it in "author". Use only lines you actually know from it.
- "classic" means a well-known line from elsewhere; put the work or occasion in source.title, or "" if unknown.
- If the request has an "only" list, every quote must come from those works and nowhere else; spread them across the works listed. If it has "inTheSpiritOf", choose real, attributable quotes that match the feel of those pages. If it has "about", keep to that subject or mood.
- Set "verify" to true whenever you are not sure the wording is exact or the attribution is right. Be strict: when in doubt, true.
- Keep each quote under 45 words, complete on its own, with no surrounding quotation marks.
- Lean towards what the reader has picked before and away from what she skipped, while keeping some variety.
- "taste" is a profile of what she likes, built up over time; follow it, and treat "herNotes" inside it as instructions from her.
- "lovedElsewhere" are lines from other pages she admires. Use them only to understand her taste. Never suggest them or close rewordings of them.
- Do not repeat anything in the "avoid" list.`;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function generateSuggestions(env, count) {
  const date = todayIST();
  const [lib, history, day, taste, insp] = await Promise.all([
    loadDoc(env, "library", emptyLibrary()), loadDoc(env, "history", []), loadDoc(env, `suggestions/${date}`, []),
    tasteBrief(env), loadDoc(env, "inspirations", []),
  ]);
  const seen = new Set([...history, ...day].map((x) => norm(x.text)));
  const fresh = [];

  // Her own quotes go in word for word, chosen here rather than by Claude.
  const own = shuffle((lib.quotes || []).filter((q) => !seen.has(norm(q.text)))).slice(0, Math.min(2, count));
  for (const q of own) {
    fresh.push({ text: q.text, author: q.author || "", source: { type: "own", title: q.from || "" }, theme: "", tone: "", verify: false });
    seen.add(norm(q.text));
  }

  const want = count - fresh.length;
  if (want > 0) {
    const brief = {
      count: want,
      books: (lib.books || []).map((b) => ({ title: b.title, author: b.author })),
      films: (lib.screen || []).filter((x) => x.kind === "film").map((x) => x.title),
      series: (lib.screen || []).filter((x) => x.kind === "series").map((x) => x.title),
      picked: history.filter((h) => h.action === "used").slice(-30).map((h) => ({ text: h.text, theme: h.theme, tone: h.tone })),
      skipped: history.filter((h) => h.action === "rejected").slice(-30).map((h) => ({ text: h.text, theme: h.theme, tone: h.tone })),
      avoid: [...history, ...day].slice(-120).map((x) => x.text),
      // What Nishiii has learned about her taste over time, and lines she loved on other pages.
      // Those lines show the kind of thing she likes; they belong to their creators and are not to be suggested themselves.
      taste: taste || undefined,
      lovedElsewhere: shuffle(insp.flatMap((i) => [i.quote, ...(i.top || []).map((t) => t.quote)]).filter(Boolean)).slice(0, 15),
    };
    const answer = parseJson(await claude(env, {
      system: SUGGEST_SYSTEM, maxTokens: 3000,
      messages: [{ role: "user", content: `Suggest ${want} quotes. Reader details as JSON:\n${JSON.stringify(brief)}` }],
    }));
    for (const s of Array.isArray(answer) ? answer : []) {
      const text = lines(s && s.text, 400).replace(/^["“”']+|["“”']+$/g, "");
      if (!text || seen.has(norm(text))) continue;
      fresh.push(cleanSuggestion(s, text));
      seen.add(norm(text));
      if (fresh.length >= count) break;
    }
  }
  const items = fresh.map((f) => ({ id: crypto.randomUUID(), state: "new", ...f }));
  await saveDoc(env, `suggestions/${date}`, [...day, ...items]);
  return { date, items: [...day, ...items] };
}
function cleanSuggestion(s, text) {
  const t = s.source && s.source.type;
  const type = ["book", "film", "series"].includes(t) ? t : "classic";
  return { text, author: oneLine(s.author, 80), source: { type, title: oneLine(s.source && s.source.title, 120) },
    theme: oneLine(s.theme, 30), tone: oneLine(s.tone, 20), verify: s.verify !== false };
}

// Quotes on request, from sources she picks: any mix of her books, films, series, pages she loves,
// her own lines, and an optional subject. The results join today's list, marked with what she asked for.
async function suggestFrom(env, b) {
  const date = todayIST();
  const count = Math.min(8, Math.max(1, Number(b.count) || 5));
  const about = oneLine(b.about, 120);
  const [lib, history, day, taste, insp] = await Promise.all([
    loadDoc(env, "library", emptyLibrary()), loadDoc(env, "history", []), loadDoc(env, `suggestions/${date}`, []),
    tasteBrief(env), loadDoc(env, "inspirations", []),
  ]);
  const ids = new Set((Array.isArray(b.sources) ? b.sources : []).map(String));
  const books = (lib.books || []).filter((x) => ids.has(x.id));
  const screen = (lib.screen || []).filter((x) => ids.has(x.id));
  const pages = insp.filter((x) => ids.has(x.id));
  const wantOwn = ids.has("own");
  if (!books.length && !screen.length && !pages.length && !wantOwn && !about) throw new UserError(400, "Pick at least one source, or say what the quotes should be about.");

  const label = [...books.map((x) => x.title), ...screen.map((x) => x.title), ...pages.map((x) => (x.handle ? "@" + x.handle : "a reel you saved")),
    wantOwn ? "your own lines" : "", about ? `about ${about}` : ""].filter(Boolean).join(", ").slice(0, 160);
  const seen = new Set([...history, ...day].map((x) => norm(x.text)));
  const fresh = [];
  const fromWorks = books.length + screen.length + pages.length > 0 || !!about;

  if (wantOwn) {
    const mine = shuffle((lib.quotes || []).filter((q) => !seen.has(norm(q.text)))).slice(0, fromWorks ? 2 : count);
    for (const q of mine) { fresh.push({ text: q.text, author: q.author || "", source: { type: "own", title: q.from || "" }, theme: "", tone: "", verify: false }); seen.add(norm(q.text)); }
    if (!mine.length && !fromWorks) throw new UserError(409, "There are no unused lines of your own left. Add some in the Library.");
  }
  const want = count - fresh.length;
  if (want > 0 && fromWorks) {
    const brief = {
      count: want,
      only: books.length || screen.length ? [...books.map((x) => ({ type: "book", title: x.title, author: x.author })), ...screen.map((x) => ({ type: x.kind, title: x.title }))] : undefined,
      inTheSpiritOf: pages.length ? pages.map((x) => ({ page: x.handle ? "@" + x.handle : "saved reel", look: x.style || "",
        linesSheLoved: [x.quote, ...(x.top || []).map((t) => t.quote)].filter(Boolean).slice(0, 6) })) : undefined,
      about: about || undefined,
      avoid: [...history, ...day].slice(-120).map((x) => x.text),
      taste: taste || undefined,
    };
    const answer = parseJson(await claude(env, { system: SUGGEST_SYSTEM, maxTokens: 2500,
      messages: [{ role: "user", content: `Suggest ${want} quotes. Request details as JSON:\n${JSON.stringify(brief)}` }] }));
    for (const s of Array.isArray(answer) ? answer : []) {
      const text = lines(s && s.text, 400).replace(/^["“”']+|["“”']+$/g, "");
      if (!text || seen.has(norm(text))) continue;
      fresh.push(cleanSuggestion(s, text));
      seen.add(norm(text));
      if (fresh.length >= count) break;
    }
  }
  if (!fresh.length) throw new UserError(502, "Nothing new came back for that. Try other sources or a different subject.");
  const now = Date.now();
  const items = fresh.map((f) => ({ id: crypto.randomUUID(), state: "new", askedFor: label, askedAt: now, ...f }));
  await saveDoc(env, `suggestions/${date}`, [...day, ...items]);
  return { date, items: [...day, ...items] };
}

async function suggestionRoutes(request, env, parts) {
  const method = request.method, date = todayIST();
  // Each suggestion is marked with what really happened to it: "posted", or "deleted" if the post
  // made from it was later removed on Instagram. "Used" alone only means it was opened in Create.
  const visible = async (r, checkInstagram) => {
    const posts = await loadDoc(env, "posts", []);
    const ids = new Set(r.items.map((i) => i.id));
    const linked = posts.filter((p) => p.suggestionId && ids.has(p.suggestionId));
    if (checkInstagram && linked.some((p) => p.state === "published") && igReady(env)) {
      const ig = await loadIg(env);
      if (ig && (await checkRemoved(env, ig, posts, linked))) await saveDoc(env, "posts", posts);
    }
    const fate = (id) => {
      const mine = linked.filter((p) => p.suggestionId === id);
      if (mine.some((p) => p.state === "published" || p.state === "processing")) return "posted";
      return mine.some((p) => p.state === "removed") ? "deleted" : "";
    };
    return json({ date: r.date, items: r.items.filter((i) => i.state !== "rejected").map((i) => ({ ...i, posted: fate(i.id) })) });
  };
  if (parts.length === 1 && method === "GET") {
    const day = await loadDoc(env, `suggestions/${date}`, []);
    if (day.length || !env.ANTHROPIC_API_KEY) return visible({ date, items: day }, true);
    return visible(await generateSuggestions(env, 8), false);
  }
  if (parts[1] === "more" && method === "POST") return visible(await generateSuggestions(env, 6), false);
  if (parts[1] === "from" && method === "POST") return visible(await suggestFrom(env, await body(request)), false);
  if (parts[2] === "feedback" && method === "POST") {
    const b = await body(request);
    if (!["used", "rejected"].includes(b.action)) return fail(400, "Unknown action.");
    const day = await loadDoc(env, `suggestions/${date}`, []);
    const item = day.find((i) => i.id === parts[1]);
    if (!item) return fail(404, "That suggestion is no longer on today's list.");
    item.state = b.action;
    const history = await loadDoc(env, "history", []);
    history.push({ text: item.text, author: item.author, theme: item.theme, tone: item.tone, source: item.source.type, action: b.action, at: Date.now() });
    await Promise.all([saveDoc(env, `suggestions/${date}`, day), saveDoc(env, "history", history.slice(-400))]);
    return json({ ok: true });
  }
  return fail(404, "Not found.");
}

// ---------- rewording a quote with Nishiii ----------
const EDIT_SYSTEM = `You are Nishiii, the assistant inside Entangledd Studio, an app for making quote posts. You are talking with Dhruuu.
She has chosen a quote and wants help changing it. Do what she asks: shorten, reword, change tone, fix line breaks, translate, and so on.
Reply with a JSON object only, no other text:
{"reply": "one short friendly sentence about what you changed", "quote": "the full revised quote", "altered": true or false}
- "quote" is always the complete current version, ready to post, without surrounding quotation marks. Use \\n for line breaks she asks for.
- "altered" is true when the wording now differs from the original author's words in more than line breaks or capitalisation. If the quote has a named author and you altered it, say in "reply" that it is no longer the author's exact words.
- If she asks something that isn't about the quote, answer briefly in "reply" and return the quote unchanged.`;

async function editQuote(request, env) {
  const b = await body(request);
  const quote = lines(b.quote, 600), author = oneLine(b.author, 80);
  const turns = (Array.isArray(b.messages) ? b.messages : []).slice(-20)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: lines(m.content, 1200) }))
    .filter((m) => m.content);
  if (!quote || !turns.length || turns[turns.length - 1].role !== "user") return fail(400, "Tell Nishiii what to change.");
  if (turns[0].role !== "user") turns.shift();
  turns[0] = { role: "user", content: `Original quote:\n${quote}\nAuthor: ${author || "none given"}\n\n${turns[0].content}` };
  const asked = lines((Array.isArray(b.messages) ? b.messages : []).filter((m) => m.role !== "assistant").slice(-1)[0]?.content, 300);
  const taste = await tasteBrief(env);
  const system = taste ? `${EDIT_SYSTEM}\n\nWhat you know about her taste (follow it unless she asks otherwise):\n${JSON.stringify({ voice: taste.voice, herNotes: taste.herNotes })}` : EDIT_SYSTEM;
  const answer = parseJson(await claude(env, { system, messages: turns, maxTokens: 1200 }));
  const revised = lines(answer.quote, 600) || quote;
  // Remember what she asked for: it says a lot about the wording she likes.
  const rewords = await loadDoc(env, "rewords", []);
  rewords.push({ at: Date.now(), asked, before: quote, after: revised });
  await saveDoc(env, "rewords", rewords.slice(-80));
  return json({ reply: lines(answer.reply, 400) || "Here you go.", quote: revised, altered: !!answer.altered });
}

// ---------- reading quotes off a photographed page ----------
const SCAN_SYSTEM = `You read photographed book pages and handwritten notes.
Reply with a JSON object only: {"passages": ["...", "..."]}
Copy up to 6 quotable passages exactly as written, one to three sentences each. Do not reword, summarise or correct them. If a passage is underlined or highlighted, list it first. If no text can be read, return {"passages": []}.`;

async function scanPage(request, env) {
  const b = await body(request);
  const image = String(b.image || "");
  if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length < 200 || image.length > 4_000_000) return fail(400, "The photo is missing or too large.");
  const answer = parseJson(await claude(env, {
    system: SCAN_SYSTEM, maxTokens: 1500,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
      { type: "text", text: "Find the quotable passages on this page." },
    ] }],
  }));
  const passages = (Array.isArray(answer.passages) ? answer.passages : []).map((p) => lines(p, 500)).filter(Boolean).slice(0, 6);
  return json({ passages });
}

// ---------- free footage (Pixabay or Pexels, whichever key is set) ----------
const PROVIDERS = {
  pixabay: { name: "Pixabay", url: "https://pixabay.com", hosts: ["pixabay.com"] },
  pexels: { name: "Pexels", url: "https://www.pexels.com", hosts: ["pexels.com"] },
};
const stockProvider = (env) => (env.PIXABAY_API_KEY ? "pixabay" : env.PEXELS_API_KEY ? "pexels" : null);

function stockHostAllowed(env, host) {
  for (const p of Object.values(PROVIDERS)) for (const h of p.hosts) if (host === h || host.endsWith("." + h)) return true;
  return !!env.STOCK_HOSTS && env.STOCK_HOSTS.split(",").includes(host);   // used only by the local dev server
}
function stockError(name, status) {
  if (status === 400 || status === 401 || status === 403) return new UserError(502, `The ${name} key was rejected. Check it in Cloudflare.`);
  if (status === 429) return new UserError(502, `${name}'s request limit was reached. Try again in a minute.`);
  return new UserError(502, `${name} couldn't be searched (status ${status}).`);
}

async function searchPexels(env, kind, q, page) {
  const base = env.PEXELS_API || "https://api.pexels.com";
  const path = kind === "video" ? "/v1/videos/search" : "/v1/search";
  const res = await fetch(`${base}${path}?query=${encodeURIComponent(q)}&orientation=portrait&per_page=18&page=${page}`, {
    headers: { Authorization: env.PEXELS_API_KEY },
  });
  if (!res.ok) throw stockError("Pexels", res.status);
  const data = await res.json();
  let items;
  if (kind === "video") {
    items = (data.videos || []).map((v) => {
      // The MP4 closest to 1080x1920: big enough to look sharp, small enough to download quickly.
      const files = (v.video_files || []).filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.link);
      files.sort((a, b2) => Math.abs(a.height - 1920) - Math.abs(b2.height - 1920));
      return files.length ? { id: String(v.id), kind, thumb: v.image, seconds: v.duration, credit: v.user && v.user.name,
        page: v.url, file: files[0].link } : null;
    }).filter(Boolean);
  } else {
    items = (data.photos || []).filter((p) => p.src && p.src.original).map((p) => ({
      id: String(p.id), kind, thumb: p.src.medium, credit: p.photographer, page: p.url,
      file: `${p.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1920`,
    }));
  }
  return { items, more: !!data.next_page };
}

async function searchPixabay(env, kind, q, page) {
  const base = env.PIXABAY_API || "https://pixabay.com";
  const common = `key=${encodeURIComponent(env.PIXABAY_API_KEY)}&q=${encodeURIComponent(q)}&safesearch=true&page=${page}`;
  if (kind === "photo") {
    const res = await fetch(`${base}/api/?${common}&image_type=photo&orientation=vertical&per_page=18`);
    if (!res.ok) throw stockError("Pixabay", res.status);
    const data = await res.json();
    const items = (data.hits || []).filter((h) => h.largeImageURL).map((h) => ({
      id: String(h.id), kind, thumb: h.webformatURL, credit: h.user, page: h.pageURL, file: h.largeImageURL,
    }));
    return { items, more: page * 18 < (data.totalHits || 0) };
  }
  // Pixabay can't filter videos by shape, so ask for a larger batch and put the upright ones first.
  const res = await fetch(`${base}/api/videos/?${common}&per_page=60`);
  if (!res.ok) throw stockError("Pixabay", res.status);
  const data = await res.json();
  const items = (data.hits || []).map((h) => {
    const files = Object.values(h.videos || {}).filter((f) => f && f.url && f.width && f.height);
    if (!files.length) return null;
    // The rendition whose long side is closest to 1920: sharp enough, quick to download.
    files.sort((a, b2) => Math.abs(Math.max(a.width, a.height) - 1920) - Math.abs(Math.max(b2.width, b2.height) - 1920));
    const f = files[0];
    return { id: String(h.id), kind, thumb: f.thumbnail, seconds: h.duration, credit: h.user, page: h.pageURL,
      file: f.url, upright: f.height > f.width };
  }).filter(Boolean);
  items.sort((a, b2) => Number(b2.upright) - Number(a.upright));
  return { items: items.slice(0, 24), more: page * 60 < (data.totalHits || 0) };
}

async function stockRoutes(request, env, parts) {
  const provider = stockProvider(env);
  if (!provider) return fail(503, "Free footage isn't connected yet: its key is missing on the server.");
  const info = PROVIDERS[provider];
  const url = new URL(request.url);
  if (parts.length === 1) {
    const kind = url.searchParams.get("kind") === "photo" ? "photo" : "video";
    const q = oneLine(url.searchParams.get("q"), 80) || "ocean";
    const page = Math.min(20, Math.max(1, Number(url.searchParams.get("page")) || 1));
    // Searches are kept for a day, which Pixabay's terms ask for and which saves requests.
    const cacheName = `stockcache/${await hmacHex("stock", `${provider}|${kind}|${norm(q)}|${page}`)}`;
    if (env.MEDIA) {
      const hit = await loadDoc(env, cacheName, null);
      if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return json(hit.data);
    }
    const found = provider === "pixabay" ? await searchPixabay(env, kind, q, page) : await searchPexels(env, kind, q, page);
    const data = { ...found, provider: { name: info.name, url: info.url } };
    if (env.MEDIA && found.items.length) await saveDoc(env, cacheName, { at: Date.now(), data });
    return json(data);
  }
  if (parts[1] === "file") {
    let target;
    try { target = new URL(url.searchParams.get("url")); } catch (e) { return fail(400, "Bad file address."); }
    const local = !!env.STOCK_HOSTS && target.protocol === "http:";
    if ((target.protocol !== "https:" && !local) || !stockHostAllowed(env, target.hostname)) return fail(400, "Only stock-library files can be fetched.");
    const res = await fetch(target, { headers: { "User-Agent": "entangledd-studio" } });
    if (!res.ok) return fail(502, `That file couldn't be downloaded from ${info.name}.`);
    const size = Number(res.headers.get("Content-Length") || 0);
    if (size > 250 * 1024 * 1024) return fail(413, "That file is too large. Pick a different one.");
    const headers = { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "no-store" };
    if (size) headers["Content-Length"] = String(size);
    return new Response(res.body, { headers });
  }
  return fail(404, "Not found.");
}

// ---------- Instagram: connect, music, post ----------
const GRAPH_VERSION = "v25.0";
async function graph(env, method, path, params) {
  const url = new URL((env.GRAPH_API || "https://graph.facebook.com") + "/" + GRAPH_VERSION + path);
  const init = { method };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  const res = await fetch(url, init);
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON: handled below */ }
  if (!res.ok || data.error) {
    const e = data.error || {};
    console.error("Graph error", res.status, e.code, e.error_subcode, e.message);
    const err = new UserError(502, `Instagram said: ${e.error_user_msg || e.message || `the request failed (status ${res.status})`}`);
    err.expired = e.code === 190;
    // Instagram's answer for something that has been deleted (or was never visible to this app).
    err.gone = e.code === 100 && (e.error_subcode === 33 || /does not exist/i.test(e.message || ""));
    throw err;
  }
  return data;
}
const igReady = (env) => !!(env.META_APP_ID && env.META_APP_SECRET && env.MEDIA);
const loadIg = (env) => loadDoc(env, "instagram", null);
const publicIg = (ig) => (ig
  ? { connected: true, username: ig.username, page: ig.pageName, musicUntil: ig.userTokenExpires }
  : { connected: false });

async function igRoutes(request, env, parts) {
  const method = request.method;
  if (!igReady(env)) return fail(503, "Instagram isn't set up on the server yet: the Meta app ID and secret are missing.");
  if (parts.length === 1 && method === "GET") return json(publicIg(await loadIg(env)));
  if (parts.length === 1 && method === "DELETE") { await env.MEDIA.delete("data/instagram.json"); return json({ connected: false }); }

  if (parts[1] === "connect" && method === "POST") {
    const b = await body(request);
    const short = String(b.token || "").trim();
    if (short.length < 50 || /\s/.test(short)) return fail(400, "Paste the access token exactly as Meta's Graph API Explorer shows it.");
    // Swap the short-lived token (about an hour) for a long-lived one (about 60 days).
    const long = await graph(env, "GET", "/oauth/access_token", {
      grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short,
    });
    const pages = await graph(env, "GET", "/me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username}", access_token: long.access_token,
    });
    const page = (pages.data || []).find((pg) => pg.instagram_business_account && pg.access_token);
    if (!page) return fail(400, "That token can't see a Facebook Page with an Instagram professional account linked. Check the Page link and the permissions ticked in the Explorer.");
    const ig = {
      igId: page.instagram_business_account.id, username: page.instagram_business_account.username || "",
      pageId: page.id, pageName: page.name || "", pageToken: page.access_token,
      userToken: long.access_token, userTokenExpires: Date.now() + (Number(long.expires_in) || 60 * 24 * 3600) * 1000,
      connectedAt: Date.now(),
    };
    await saveDoc(env, "instagram", ig);
    return json(publicIg(ig));
  }

  if (parts[1] === "audio" && method === "GET") {
    const ig = await loadIg(env);
    if (!ig) return fail(409, "Connect Instagram first, in Posts.");
    if (Date.now() > ig.userTokenExpires) return fail(409, "Music search needs Instagram reconnecting in Posts. Posting still works.");
    const q = oneLine(new URL(request.url).searchParams.get("q"), 80);
    const params = { audio_type: "music", user_id: ig.igId, access_token: ig.userToken };
    if (q) params.search_query = q;
    const data = await graph(env, "GET", "/ig_audio", params);
    const items = (data.audio || data.data || []).filter((a) => a && a.audio_id).slice(0, 25).map((a) => ({
      id: String(a.audio_id), title: a.title || "Untitled", artist: a.display_artist || a.ig_username || "",
      seconds: Math.round((a.duration_in_ms || 0) / 1000), preview: a.download_url || a.on_platform_audio_preview_link || "",
    }));
    return json({ items });
  }
  return fail(404, "Not found.");
}

// A link Instagram can fetch the finished reel from, valid for a day and impossible to guess.
async function publicReelUrl(request, env, jobId) {
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  const sig = await hmacHex(env.RENDER_SECRET, `reel|${jobId}|${exp}`);
  return `${new URL(request.url).origin}/api/public/reel/${jobId}.mp4?exp=${exp}&sig=${sig}`;
}
async function publicReel(request, env, parts) {
  const url = new URL(request.url);
  const id = String(parts[2] || "").replace(/\.mp4$/, ""), exp = Number(url.searchParams.get("exp"));
  if (!env.RENDER_SECRET || !env.MEDIA || !UUID.test(id) || !(exp > Date.now())) return new Response("Not found", { status: 404 });
  if (!safeEqual(url.searchParams.get("sig") || "", await hmacHex(env.RENDER_SECRET, `reel|${id}|${exp}`))) return new Response("Not found", { status: 404 });
  const key = jobKey(id, "reel.mp4");
  const base = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (request.method === "HEAD") {
    const head = await env.MEDIA.head(key);
    return head ? new Response(null, { headers: { ...base, "Content-Length": String(head.size) } }) : new Response(null, { status: 404 });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") || "");
  if (m && (m[1] || m[2])) {
    const head = await env.MEDIA.head(key);
    if (!head) return new Response("Not found", { status: 404 });
    const start = m[1] ? Number(m[1]) : Math.max(0, head.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
    if (start > end || start >= head.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}` } });
    const part = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
    return new Response(part.body, { status: 206, headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${head.size}` } });
  }
  const obj = await env.MEDIA.get(key);
  return obj ? new Response(obj.body, { headers: { ...base, "Content-Length": String(obj.size) } }) : new Response("Not found", { status: 404 });
}

const publicPost = (p) => ({ id: p.id, state: p.state, error: p.error, caption: p.caption, quote: p.quote, author: p.author,
  music: p.music, created: p.created, published: p.published, permalink: p.permalink, metrics: p.metrics || null });
const tokenFor = (ig, post) => (post.tokenKind === "user" ? ig.userToken : ig.pageToken);

// Moves a post forward: once Instagram has finished processing the video, publish it.
async function advancePost(env, ig, post) {
  if (post.state !== "processing") return false;
  try {
    const st = await graph(env, "GET", `/${post.containerId}`, { fields: "status_code,status", access_token: tokenFor(ig, post) });
    if (st.status_code === "FINISHED") {
      const out = await graph(env, "POST", `/${ig.igId}/media_publish`, { creation_id: post.containerId, access_token: tokenFor(ig, post) });
      post.state = "published"; post.mediaId = out.id; post.published = Date.now();
      try { post.permalink = (await graph(env, "GET", `/${out.id}`, { fields: "permalink", access_token: tokenFor(ig, post) })).permalink || ""; }
      catch (e) { post.permalink = ""; }
      return true;
    }
    if (st.status_code === "PUBLISHED") { post.state = "published"; post.published = Date.now(); return true; }
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      post.state = "failed"; post.error = `Instagram couldn't process the video${st.status ? `: ${String(st.status).slice(0, 200)}` : "."}`;
      return true;
    }
    if (Date.now() - post.created > 30 * 60 * 1000) { post.state = "failed"; post.error = "Instagram took too long to process the video. Try posting again."; return true; }
  } catch (e) {
    if (e instanceof UserError && Date.now() - post.created > 30 * 60 * 1000) { post.state = "failed"; post.error = e.message; return true; }
    if (!(e instanceof UserError)) throw e;
  }
  return false;
}

async function createContainer(env, ig, params, wantUser) {
  const userOk = Date.now() < ig.userTokenExpires;
  const order = wantUser && userOk ? ["user", "page"] : userOk ? ["page", "user"] : ["page"];
  let last;
  for (const kind of order) {
    try {
      const out = await graph(env, "POST", `/${ig.igId}/media`, { ...params, access_token: kind === "user" ? ig.userToken : ig.pageToken });
      return { containerId: out.id, tokenKind: kind };
    } catch (e) { if (!(e instanceof UserError)) throw e; last = e; }
  }
  throw last;
}

async function postRoutes(request, env, parts) {
  const method = request.method;
  if (!igReady(env)) return fail(503, "Instagram isn't set up on the server yet.");
  const ig = await loadIg(env);
  const posts = await loadDoc(env, "posts", []);

  if (parts.length === 1 && method === "GET") {
    // Opening the list is when numbers are refreshed and posts deleted on Instagram are noticed.
    if (ig) {
      const removed = await checkRemoved(env, ig, posts);
      const updated = await refreshInsights(env, ig, posts, { max: 6 });
      if (removed || updated) await saveDoc(env, "posts", posts);
    }
    return json({ posts: posts.filter((p) => p.state !== "removed").slice(-50).reverse().map(publicPost) });
  }

  if (parts.length === 1 && method === "POST") {
    if (!ig) return fail(409, "Connect Instagram first, in Posts.");
    const b = await body(request);
    if (!UUID.test(b.jobId || "")) return fail(400, "Create the reel first.");
    const job = await readJob(env, b.jobId);
    if (!job || job.state !== "done" || !(await env.MEDIA.head(jobKey(b.jobId, "reel.mp4")))) return fail(409, "That reel is no longer on the server. Create it again, then post.");
    if (posts.some((p) => p.jobId === b.jobId && (p.state === "processing" || p.state === "published"))) return fail(409, "This reel has already been posted.");
    const caption = String(b.caption || "").trim().slice(0, 2200);
    const params = { media_type: "REELS", video_url: await publicReelUrl(request, env, b.jobId), caption, share_to_feed: "true" };
    let music = null;
    if (b.audio && /^\d{5,25}$/.test(String(b.audio.id || ""))) {
      const vol = (v, d) => Math.min(100, Math.max(0, Math.round(Number.isFinite(Number(v)) ? Number(v) : d)));
      params.audio_configuration = JSON.stringify({ audio_id: String(b.audio.id), audio_volume: vol(b.audio.musicVolume, 100), video_volume: vol(b.audio.videoVolume, 0) });
      music = oneLine(b.audio.title, 120);
    }
    const made = await createContainer(env, ig, params, !!music);
    const post = { id: crypto.randomUUID(), jobId: b.jobId, ...made, state: "processing", error: null, caption, music,
      quote: lines(b.quote, 600), author: oneLine(b.author, 80), theme: oneLine(b.theme, 30), tone: oneLine(b.tone, 20),
      source: oneLine(b.source, 20), suggestionId: UUID.test(b.suggestionId || "") ? b.suggestionId : "",
      created: Date.now(), published: null, permalink: "" };
    posts.push(post);
    await saveDoc(env, "posts", posts.slice(-500));
    return json(publicPost(post));
  }

  const post = posts.find((p) => p.id === parts[1]);
  if (post && method === "DELETE") {
    // Takes it off the app's list only. Deleting from Instagram itself is done in Instagram.
    await saveDoc(env, "posts", posts.filter((p) => p.id !== post.id));
    return json({ ok: true });
  }
  if (!post || method !== "GET") return fail(404, "No such post.");
  if (ig && (await advancePost(env, ig, post))) await saveDoc(env, "posts", posts);
  return json(publicPost(post));
}

// ---------- caption and hashtags ----------
const CAPTION_SYSTEM = `You write Instagram captions for a quiet, reflective quotes page.
Reply with a JSON object only: {"caption": "...", "hashtags": ["#...", "#..."]}
- "caption": one or two short lines that sit beside the quote without repeating it. Calm, plain, lowercase is fine. No emojis unless they add something. If the quote has a named author, end with a credit line such as "— Seneca".
- "hashtags": 8 to 12, mixing a few broad ones with more specific ones that fit this quote. No spaces inside a tag.`;

async function writeCaption(request, env) {
  const b = await body(request);
  const quote = lines(b.quote, 600);
  if (!quote) return fail(400, "There is no quote to write a caption for.");
  const taste = await tasteBrief(env);
  const answer = parseJson(await claude(env, { system: CAPTION_SYSTEM, maxTokens: 700,
    messages: [{ role: "user", content: `Quote:\n${quote}\nAuthor: ${oneLine(b.author, 80) || "none"}${taste ? `\n\nHer taste, for the caption's voice:\n${JSON.stringify({ voice: taste.voice, herNotes: taste.herNotes })}` : ""}` }] }));
  const tags = (Array.isArray(answer.hashtags) ? answer.hashtags : []).map((t) => "#" + String(t).replace(/[^\p{L}\p{N}_]/gu, "")).filter((t) => t.length > 1).slice(0, 14);
  return json({ caption: lines(answer.caption, 600), hashtags: tags });
}

// ---------- Instagram helpers shared by insights and inspirations ----------
// Tries the long-lived user token first while it is valid, then the Page token.
async function graphAny(env, ig, method, path, params) {
  const tokens = Date.now() < ig.userTokenExpires ? [ig.userToken, ig.pageToken] : [ig.pageToken];
  let last;
  for (const access_token of tokens) {
    try { return await graph(env, method, path, { ...params, access_token }); }
    catch (e) { if (!(e instanceof UserError)) throw e; last = e; }
  }
  throw last;
}

// ---------- insights: how her own posts did ----------
const INSIGHT_METRICS = ["reach", "views", "likes", "comments", "saved", "shares"];
async function refreshInsights(env, ig, posts, { force = false, max = 15 } = {}) {
  let changed = false, done = 0;
  const recent = posts.filter((p) => p.state === "published" && p.mediaId).slice(-60).reverse();
  for (const post of recent) {
    if (done >= max) break;
    const age = Date.now() - (post.published || post.created);
    const every = age < 3 * 24 * 3600 * 1000 ? 2 * 3600 * 1000 : 24 * 3600 * 1000;   // fresh posts change fastest
    if (!force && post.insightsAt && Date.now() - post.insightsAt < every) continue;
    done += 1;
    try {
      const data = await graphAny(env, ig, "GET", `/${post.mediaId}/insights`, { metric: INSIGHT_METRICS.join(",") });
      const m = {};
      for (const row of data.data || []) {
        const v = row.total_value ? row.total_value.value : row.values && row.values[0] ? row.values[0].value : null;
        if (INSIGHT_METRICS.includes(row.name) && Number.isFinite(Number(v))) m[row.name] = Number(v);
      }
      post.metrics = { ...(post.metrics || {}), ...m };
      post.insightsAt = Date.now(); changed = true;
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      // Numbers unavailable: find out whether the post still exists on Instagram.
      try { await graphAny(env, ig, "GET", `/${post.mediaId}`, { fields: "id" }); post.insightsAt = Date.now(); changed = true; }
      catch (e2) {
        if (!(e2 instanceof UserError)) throw e2;
        if (e2.gone) { post.state = "removed"; post.removedAt = Date.now(); changed = true; }
      }
    }
  }
  return changed;
}

// Notices posts she has deleted on Instagram, so the app's list matches. Checked every time the list opens.
async function checkRemoved(env, ig, posts, only) {
  const latest = (only || posts).filter((p) => p.state === "published" && p.mediaId).slice(-8);
  const gone = await Promise.all(latest.map(async (post) => {
    try { await graphAny(env, ig, "GET", `/${post.mediaId}`, { fields: "id" }); return false; }
    catch (e) { if (!(e instanceof UserError)) throw e; return !!e.gone; }
  }));
  latest.forEach((post, i) => { if (gone[i]) { post.state = "removed"; post.removedAt = Date.now(); } });
  return gone.some(Boolean);
}

// ---------- inspiration: accounts, reels and screenshots she loves ----------
const INSPIRE_LIMIT = 80;
const SHOT_SYSTEM = `You look at a screenshot or frame of an Instagram quote post that the user loves.
Reply with a JSON object only:
{"quote": "the quote text exactly as shown, with line breaks as \\n, or \"\" if none is readable", "author": "the credited author if shown, else \"\"", "handle": "the account username if visible, without @, else \"\"", "style": "one or two plain sentences on the look: typeface feel, text size and placement, colours, background, mood"}
Copy the quote exactly; do not correct or reword it.`;
const READ_POSTS_SYSTEM = `You read the quote text off Instagram post images. You get several images in order.
Reply with a JSON object only: {"quotes": ["text of image 1", "text of image 2", ...]}
One entry per image, in the same order, copied exactly as shown with line breaks as \n. Use "" for an image with no readable quote.`;

function parseInspiration(input) {
  const raw = String(input || "").trim();
  const m = /instagram\.com\/(?:([a-z0-9._]{1,30})\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,40})/i.exec(raw);
  if (m) return { kind: "reel", handle: (m[1] || "").toLowerCase(), code: m[3], url: `https://www.instagram.com/${m[2].toLowerCase() === "p" ? "p" : "reel"}/${m[3]}/` };
  const handle = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  if (/^[a-z0-9._]{1,30}$/i.test(handle)) return { kind: "account", handle: handle.toLowerCase(), url: `https://www.instagram.com/${handle.toLowerCase()}/` };
  return null;
}

async function discover(env, ig, handle, limit) {
  const rich = "caption,like_count,comments_count,view_count,media_type,media_product_type,media_url,permalink,timestamp";
  const ask = (fields) => graphAny(env, ig, "GET", `/${ig.igId}`, {
    fields: `business_discovery.username(${handle}){followers_count,media_count,media.limit(${limit}){${fields}}}`,
  });
  let data;
  try { data = await ask(rich); }
  catch (e) { if (!(e instanceof UserError)) throw e; data = await ask("caption,like_count,comments_count,permalink,timestamp"); }
  const bd = data.business_discovery || {};
  const media = ((bd.media && bd.media.data) || []).map((x) => ({
    caption: lines(x.caption, 500), likes: Number(x.like_count) || 0, comments: Number(x.comments_count) || 0,
    views: Number(x.view_count) || 0, type: x.media_type || "", image: x.media_type === "IMAGE" || x.media_type === "CAROUSEL_ALBUM" ? x.media_url || "" : "",
    permalink: x.permalink || "", at: x.timestamp || "",
  }));
  return { followers: Number(bd.followers_count) || 0, mediaCount: Number(bd.media_count) || 0, media };
}
const score = (x) => x.likes + x.comments * 3 + x.views / 50;

// Reads the quote off the top picture posts. Optional: if the pictures can't be fetched, captions still serve.
async function readPostImages(env, top) {
  const withImage = top.filter((t) => t.image).slice(0, 5);
  if (!withImage.length || !env.ANTHROPIC_API_KEY) return;
  try {
    const answer = parseJson(await claude(env, { system: READ_POSTS_SYSTEM, maxTokens: 1500, messages: [{ role: "user", content: [
      ...withImage.map((t) => ({ type: "image", source: { type: "url", url: t.image } })),
      { type: "text", text: `Read the quote on each of these ${withImage.length} images.` },
    ] }] }));
    (Array.isArray(answer.quotes) ? answer.quotes : []).forEach((q, i) => { if (withImage[i]) withImage[i].quote = lines(q, 400); });
  } catch (e) { if (!(e instanceof UserError)) throw e; }
}

async function examine(env, item) {
  const ig = igReady(env) ? await loadIg(env) : null;
  if (!ig) { item.status = "Saved. It will be read once Instagram is connected."; return; }
  try {
    if (item.kind === "account") {
      const d = await discover(env, ig, item.handle, 40);
      const top = d.media.slice().sort((a, b) => score(b) - score(a)).slice(0, 8);
      await readPostImages(env, top);
      item.followers = d.followers;
      item.top = top.map(({ image, ...rest }) => rest);
      item.status = top.length ? `Read ${d.media.length} recent posts; keeping the ${top.length} that did best.` : "The account has no posts that could be read.";
    } else if (item.kind === "reel" && item.handle) {
      const d = await discover(env, ig, item.handle, 50);
      const hit = d.media.find((x) => x.permalink.includes(`/${item.code}`));
      if (hit) {
        if (hit.image) await readPostImages(env, [hit]);
        item.caption = hit.caption; item.quote = hit.quote || item.quote || "";
        item.metrics = { likes: hit.likes, comments: hit.comments, views: hit.views };
        item.status = item.quote ? "Read from Instagram." : "Numbers and caption read. Add a screenshot so the words on the reel can be read too.";
      } else item.status = "Saved. The post wasn't among that account's latest; add a screenshot so it can be read.";
    } else if (item.kind === "reel") {
      item.status = "Link saved. Instagram doesn't let apps open a reel from its link alone, so add a screenshot of it and Nishiii will read it.";
    }
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    item.status = /does not exist|cannot be found|not found|Invalid user/i.test(e.message)
      ? "Instagram can't show this account's posts to apps. That happens with personal (non-professional) accounts. A screenshot still works."
      : `Couldn't be read right now. ${e.message}`;
  }
  item.examinedAt = Date.now();
}

async function loadInspirations(env) {
  const list = await loadDoc(env, "inspirations", []);
  // Accounts saved before this feature existed move across once.
  const lib = await loadDoc(env, "library", emptyLibrary());
  if (lib.accounts && lib.accounts.length) {
    for (const a of lib.accounts) {
      if (!list.some((i) => i.kind === "account" && i.handle === a.handle)) {
        list.push({ id: crypto.randomUUID(), kind: "account", handle: a.handle, url: `https://www.instagram.com/${a.handle}/`, added: a.added || Date.now(), status: "Not read yet." });
      }
    }
    lib.accounts = [];
    await Promise.all([saveDoc(env, "library", lib), saveDoc(env, "inspirations", list)]);
  }
  return list;
}
const publicInspiration = (i) => ({ id: i.id, kind: i.kind, handle: i.handle || "", url: i.url || "", quote: i.quote || "", author: i.author || "",
  caption: i.caption || "", style: i.style || "", metrics: i.metrics || null, followers: i.followers || 0, status: i.status || "",
  top: (i.top || []).slice(0, 5).map((t) => ({ quote: t.quote || "", caption: (t.caption || "").slice(0, 200), likes: t.likes, comments: t.comments, views: t.views, permalink: t.permalink })) });

async function inspirationRoutes(request, env, parts) {
  const method = request.method;
  const list = await loadInspirations(env);
  const reply = () => json({ items: list.slice().reverse().map(publicInspiration) });
  if (parts.length === 1 && method === "GET") return reply();
  if (parts.length === 2 && method === "DELETE") {
    await saveDoc(env, "inspirations", list.filter((i) => i.id !== parts[1]));
    return json({ items: list.filter((i) => i.id !== parts[1]).reverse().map(publicInspiration) });
  }
  if (parts.length === 3 && parts[2] === "refresh" && method === "POST") {
    const item = list.find((i) => i.id === parts[1]);
    if (!item) return fail(404, "That item is no longer in the list.");
    await examine(env, item);
    await saveDoc(env, "inspirations", list);
    return reply();
  }
  if (parts.length !== 1 || method !== "POST") return fail(404, "Not found.");
  if (list.length >= INSPIRE_LIMIT) return fail(400, "The inspiration list is full. Remove something first.");
  const b = await body(request);
  let item;
  if (b.image) {
    const image = String(b.image);
    if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length < 200 || image.length > 4_000_000) return fail(400, "The screenshot is missing or too large.");
    const a = parseJson(await claude(env, { system: SHOT_SYSTEM, maxTokens: 900, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
      { type: "text", text: "Read this post." },
    ] }] }));
    const handle = oneLine(a.handle, 40).replace(/^@/, "").toLowerCase();
    item = { kind: "screenshot", handle: /^[a-z0-9._]{1,30}$/.test(handle) ? handle : "", quote: lines(a.quote, 500), author: oneLine(a.author, 80),
      style: oneLine(a.style, 300), status: lines(a.quote, 500) ? "Read from your screenshot." : "No quote could be read. The look was still noted." };
  } else {
    const parsed = parseInspiration(b.input);
    if (!parsed) return fail(400, "Paste an Instagram username, a profile link, or a link to a reel or post.");
    if (list.some((i) => i.kind === parsed.kind && (parsed.kind === "account" ? i.handle === parsed.handle : i.code === parsed.code))) return fail(409, "That's already in the list.");
    item = { ...parsed, status: "" };
    await examine(env, item);
  }
  // A screenshot can be added to a link or account she saved earlier, to fill in what couldn't be read.
  const target = b.forId && item.kind === "screenshot" ? list.find((i) => i.id === b.forId) : null;
  if (target) {
    Object.assign(target, { quote: item.quote, author: item.author || target.author, style: item.style, handle: target.handle || item.handle, status: item.status });
    await saveDoc(env, "inspirations", list);
    return reply();
  }
  list.push({ id: crypto.randomUUID(), added: Date.now(), ...item });
  await saveDoc(env, "inspirations", list);
  return reply();
}

// ---------- taste: what Nishiii has learned about what she likes ----------
const TASTE_SYSTEM = `You keep a living profile of one person's taste in quotes, for an app that suggests quotes for her Instagram page.
You get the previous profile (may be empty), notes she wrote herself, and recent evidence: quotes she picked and skipped, how she asked for quotes to be reworded, her own saved lines, posts she published with their results, and posts from other accounts she loves.
Write the updated profile. Keep what earlier evidence established unless new evidence contradicts it; her own notes always win. Be specific and concrete, never generic. Do not invent preferences the evidence doesn't show; with little evidence, say less.
Reply with a JSON object only:
{"summary": "three to five plain sentences describing her taste as it stands now",
 "loves": ["up to 8 specific things she is drawn to: themes, moods, kinds of line"],
 "avoids": ["up to 6 things she passes over or dislikes"],
 "voice": ["up to 5 points on wording she prefers: length, register, lowercase, line breaks, and so on"],
 "look": ["up to 4 points on the visual style she likes, if the evidence shows any"],
 "performs": ["up to 4 points on what has done well or badly on her page, with numbers where given; empty if no results yet"]}`;

const emptyTaste = () => ({ profile: null, notes: [], updatedAt: 0 });
async function gatherEvidence(env) {
  const [history, rewords, lib, posts, insp] = await Promise.all([
    loadDoc(env, "history", []), loadDoc(env, "rewords", []), loadDoc(env, "library", emptyLibrary()),
    loadDoc(env, "posts", []), loadDoc(env, "inspirations", []),
  ]);
  const slim = (h) => ({ text: h.text, author: h.author, theme: h.theme, tone: h.tone, source: h.source });
  return {
    picked: history.filter((h) => h.action === "used").slice(-40).map(slim),
    skipped: history.filter((h) => h.action === "rejected").slice(-40).map(slim),
    rewordRequests: rewords.slice(-25).map((r) => ({ asked: r.asked, before: r.before, after: r.after })),
    ownLines: (lib.quotes || []).slice(-25).map((q) => q.text),
    posted: posts.filter((p) => p.state === "published").slice(-30).map((p) => ({ quote: p.quote, author: p.author, music: p.music || "", ...(p.metrics || {}) })),
    loved: insp.slice(-30).map((i) => ({ from: i.handle ? "@" + i.handle : i.kind, quote: i.quote || "", look: i.style || "",
      topPosts: (i.top || []).slice(0, 5).map((t) => ({ quote: t.quote || "", caption: (t.caption || "").slice(0, 160), likes: t.likes, views: t.views })) })),
  };
}
const evidenceCount = (e) => e.picked.length + e.skipped.length + e.rewordRequests.length + e.ownLines.length + e.posted.length + e.loved.length;

async function buildTaste(env) {
  const taste = { ...emptyTaste(), ...(await loadDoc(env, "taste", emptyTaste())) };
  const evidence = await gatherEvidence(env);
  const count = evidenceCount(evidence);
  if (!count && !taste.notes.length) return { ...taste, evidence: 0 };
  const a = parseJson(await claude(env, { system: TASTE_SYSTEM, maxTokens: 1800, messages: [{ role: "user", content:
    `Previous profile:\n${JSON.stringify(taste.profile || {})}\n\nHer own notes:\n${JSON.stringify(taste.notes.map((n) => n.text))}\n\nRecent evidence:\n${JSON.stringify(evidence)}` }] }));
  const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => oneLine(x, 200)).filter(Boolean).slice(0, n);
  taste.profile = { summary: lines(a.summary, 900), loves: list(a.loves, 8), avoids: list(a.avoids, 6), voice: list(a.voice, 5), look: list(a.look, 4), performs: list(a.performs, 4) };
  taste.updatedAt = Date.now(); taste.evidence = count;
  await saveDoc(env, "taste", taste);
  return taste;
}
// The short form handed to Claude whenever it suggests, rewords or captions.
async function tasteBrief(env) {
  const t = await loadDoc(env, "taste", emptyTaste());
  if (!t.profile && !(t.notes || []).length) return null;
  const p = t.profile || {};
  return { summary: p.summary || "", loves: p.loves || [], avoids: p.avoids || [], voice: p.voice || [], performs: p.performs || [], herNotes: (t.notes || []).map((n) => n.text) };
}

async function tasteRoutes(request, env, parts) {
  const method = request.method;
  const taste = { ...emptyTaste(), ...(await loadDoc(env, "taste", emptyTaste())) };
  const out = async (t) => {
    const [history, rewords] = await Promise.all([loadDoc(env, "history", []), loadDoc(env, "rewords", [])]);
    return json({ profile: t.profile, notes: t.notes, updatedAt: t.updatedAt, evidence: evidenceCount(await gatherEvidence(env)),
      // What each "forget" would actually erase right now.
      canForget: { profile: !!t.profile, all: !!t.profile || t.notes.length > 0 || history.length > 0 || rewords.length > 0 } });
  };
  if (parts.length === 1 && method === "GET") return out(taste);
  if (parts[1] === "refresh" && method === "POST") return out(await buildTaste(env));
  if (parts.length === 1 && method === "DELETE") {
    // "profile": erase what Nishiii has written; it is rebuilt from her activity at the next update.
    // "all": also erase the record of picks, skips and rewording requests, and her notes.
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "all") {
      await env.MEDIA.delete(["data/taste.json", "data/history.json", "data/rewords.json"]);
      return out(emptyTaste());
    }
    if (scope !== "profile") return fail(400, "Say what to forget.");
    taste.profile = null; taste.updatedAt = 0;
    await saveDoc(env, "taste", taste);
    return out(taste);
  }
  if (parts[1] === "notes" && method === "POST") {
    const text = lines((await body(request)).text, 300);
    if (!text) return fail(400, "Write the note first.");
    if (taste.notes.length >= 30) return fail(400, "That's the most notes Nishiii keeps. Remove one first.");
    taste.notes.push({ id: crypto.randomUUID(), text, at: Date.now() });
    await saveDoc(env, "taste", taste);
    return out(taste);
  }
  if (parts[1] === "notes" && parts[2] && method === "DELETE") {
    taste.notes = taste.notes.filter((n) => n.id !== parts[2]);
    await saveDoc(env, "taste", taste);
    return out(taste);
  }
  return fail(404, "Not found.");
}

// ---------- Face ID lock (passkeys) ----------
// The phone holds a private key that only Face ID (or Touch ID, or the screen lock) can use.
// To unlock, the server sends a random challenge, the phone signs it, and the signature is checked
// here against the public key saved when the lock was switched on. Only then is the session issued.
const b64u = {
  dec: (str) => Uint8Array.from(atob(String(str).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
};
// WebAuthn signatures arrive in DER form; the verifier wants the two 32-byte numbers side by side.
function derToRaw(der) {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad signature");
  if (der[i++] & 0x80) i += der[i - 1] & 0x7f;
  const int = () => {
    if (der[i++] !== 0x02) throw new Error("bad signature");
    const len = der[i++];
    let v = der.slice(i, i + len); i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("bad signature");
    const out = new Uint8Array(32); out.set(v, 32 - v.length);
    return out;
  };
  const raw = new Uint8Array(64);
  raw.set(int(), 0); raw.set(int(), 32);
  return raw;
}
async function takeChallenge(env, id, clientDataB64, type, request) {
  if (!UUID.test(id || "")) throw new UserError(400, "That unlock attempt has expired. Try again.");
  const key = `auth/challenge-${id}.json`;
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new UserError(400, "That unlock attempt has expired. Try again.");
  const saved = await obj.json();
  await env.MEDIA.delete(key);                       // each challenge works once
  let client;
  try { client = JSON.parse(new TextDecoder().decode(b64u.dec(clientDataB64))); } catch (e) { throw new UserError(400, "The device's reply couldn't be read."); }
  if (Date.now() > saved.exp || client.type !== type || !safeEqual(String(client.challenge), saved.challenge) || client.origin !== new URL(request.url).origin) {
    throw new UserError(401, "That unlock attempt wasn't valid. Try again.");
  }
}

async function passkeyRoutes(request, env, parts, authed) {
  const method = request.method;
  if (!env.APP_PASSCODE || !env.MEDIA) return fail(503, "The app lock isn't set up on the server yet.");
  const keys = await loadDoc(env, "passkeys", []);

  if (parts[1] === "challenge" && method === "POST") {
    const id = crypto.randomUUID(), challenge = b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
    await env.MEDIA.put(`auth/challenge-${id}.json`, JSON.stringify({ challenge, exp: Date.now() + 5 * 60 * 1000 }));
    return json({ id, challenge });
  }

  if (parts[1] === "login" && method === "POST") {
    const b = await body(request);
    const saved = keys.find((k) => k.id === b.credentialId);
    if (!saved) return fail(401, "This device's Face ID lock isn't known to the server. Use the passcode, then switch the lock on again in Settings.");
    await takeChallenge(env, b.challengeId, b.clientDataJSON, "webauthn.get", request);
    let ok = false;
    try {
      const auth = b64u.dec(b.authenticatorData), client = b64u.dec(b.clientDataJSON);
      const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(new URL(request.url).hostname)));
      const flags = auth[32];
      const rpOk = auth.length >= 37 && rpHash.every((v, i) => v === auth[i]);
      const key = await crypto.subtle.importKey("spki", b64u.dec(saved.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", client));
      const signed = new Uint8Array(auth.length + 32); signed.set(auth, 0); signed.set(clientHash, auth.length);
      // 0x01 = someone was present, 0x04 = they were verified (face, finger or device passcode)
      ok = rpOk && (flags & 0x01) === 0x01 && (flags & 0x04) === 0x04 &&
        await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64u.dec(b.signature)), signed);
    } catch (e) { ok = false; }
    if (!ok) return fail(401, "Face ID couldn't be confirmed. Try again or use the passcode.");
    return json({ token: await sessionToken(env) });
  }

  if (!authed) return fail(401, "Enter the passcode to continue.");
  if (parts.length === 1 && method === "GET") return json({ devices: keys.map((k) => ({ id: k.id, label: k.label, added: k.added })) });
  if (parts[1] === "register" && method === "POST") {
    const b = await body(request);
    if (Number(b.alg) !== -7) return fail(400, "This device's lock uses a kind of key the app doesn't support.");
    await takeChallenge(env, b.challengeId, b.clientDataJSON, "webauthn.create", request);
    const id = String(b.credentialId || ""), publicKey = String(b.publicKey || "");
    if (!/^[A-Za-z0-9_-]{16,1400}$/.test(id) || !/^[A-Za-z0-9_-]{80,400}$/.test(publicKey)) return fail(400, "The device's reply couldn't be read.");
    try { await crypto.subtle.importKey("spki", b64u.dec(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); }
    catch (e) { return fail(400, "The device's key couldn't be read."); }
    const next = keys.filter((k) => k.id !== id).slice(-9);
    next.push({ id, publicKey, label: oneLine(b.label, 60) || "A device", added: Date.now() });
    await saveDoc(env, "passkeys", next);
    return json({ ok: true });
  }
  if (parts[1] && method === "DELETE") {
    await saveDoc(env, "passkeys", keys.filter((k) => k.id !== parts[1]));
    return json({ ok: true });
  }
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

// Decides which handler answers a request under /api/.
async function route(request, env, parts) {
  if (parts[0] === "status" && request.method === "GET") {
    return json({ configured: !!env.APP_PASSCODE, signedIn: await signedIn(request, env), reels: reelsReady(env),
      ai: !!(env.ANTHROPIC_API_KEY && env.MEDIA), stock: !!stockProvider(env), instagram: igReady(env) });
  }
  if (parts[0] === "login" && request.method === "POST") return login(request, env);
  if (parts[0] === "passkey") return passkeyRoutes(request, env, parts, await signedIn(request, env));
  if (parts[0] === "public" && parts[1] === "reel" && ["GET", "HEAD"].includes(request.method)) return publicReel(request, env, parts);
  if (parts[0] === "render") {
    if (!isRenderer(request, env)) return fail(401, "Not allowed.");
    return renderRoutes(request, env, parts);
  }
  if (["jobs", "library", "suggestions", "edit", "scan", "stock", "instagram", "posts", "caption", "inspirations", "taste"].includes(parts[0])) {
    if (!(await signedIn(request, env))) return fail(401, "Enter the passcode to continue.");
    if (parts[0] === "jobs") return appRoutes(request, env, parts);
    if (parts[0] === "stock") return stockRoutes(request, env, parts);
    if (!env.MEDIA) return fail(503, "Storage isn't set up on the server yet.");
    if (parts[0] === "library") return libraryRoutes(request, env, parts);
    if (parts[0] === "instagram") return igRoutes(request, env, parts);
    if (parts[0] === "posts") return postRoutes(request, env, parts);
    if (parts[0] === "inspirations") return inspirationRoutes(request, env, parts);
    if (parts[0] === "taste") return tasteRoutes(request, env, parts);
    if (parts[0] === "caption" && request.method === "POST") return writeCaption(request, env);
    if (parts[0] === "suggestions") return suggestionRoutes(request, env, parts);
    if (parts[0] === "edit" && request.method === "POST") return editQuote(request, env);
    if (parts[0] === "scan" && request.method === "POST") return scanPage(request, env);
  }
  return fail(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    const parts = url.pathname.slice(5).split("/").filter(Boolean);
    try {
      // "await" matters here: without it, an error inside a handler would skip the catch below.
      return await route(request, env, parts);
    } catch (e) {
      if (e instanceof UserError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, "Something went wrong on the server. Try again.");
    }
  },

  // Timed jobs (see "triggers" in wrangler.jsonc).
  async scheduled(event, env, ctx) {
    if (!env.MEDIA) return;
    if (event.cron === "30 0 * * *") {
      // Once a day, in order: fetch how her posts did, update what Nishiii knows about her taste,
      // then choose the day's quotes with that fresh in mind.
      ctx.waitUntil((async () => {
        const step = async (name, fn) => { try { await fn(); } catch (e) { console.error(`daily ${name} failed`, e); } };
        await step("insights", async () => {
          const ig = igReady(env) ? await loadIg(env) : null;
          if (!ig) return;
          const posts = await loadDoc(env, "posts", []);
          if (await refreshInsights(env, ig, posts, { max: 15 })) await saveDoc(env, "posts", posts);
        });
        if (!env.ANTHROPIC_API_KEY) return;
        await step("taste", () => buildTaste(env));
        await step("suggestions", async () => {
          const day = await loadDoc(env, `suggestions/${todayIST()}`, []);
          if (!day.length) await generateSuggestions(env, 8);
        });
      })());
      return;
    }
    // Every few minutes: finish any post still waiting on Instagram, in case she closed the app.
    ctx.waitUntil((async () => {
      const posts = await loadDoc(env, "posts", []);
      const waiting = posts.filter((p) => p.state === "processing");
      if (!waiting.length) return;
      const ig = await loadIg(env);
      if (!ig) return;
      let changed = false;
      for (const p of waiting) changed = (await advancePost(env, ig, p)) || changed;
      if (changed) await saveDoc(env, "posts", posts);
    })().catch((e) => console.error("finishing posts failed", e)));
  },
};
