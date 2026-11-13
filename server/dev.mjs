/* Local stand-in for Cloudflare and GitHub, for trying the whole app on one machine.

     node server/dev.mjs            then open http://localhost:8787  (passcode: letmein)

   It serves web/, runs server/worker.js against in-memory storage, and when the app asks
   GitHub to start a render it runs render/run_job.sh right here instead.
   Needs Node 20+, Python 3 with Pillow, and ffmpeg. */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".ttf": "font/ttf", ".webmanifest": "application/manifest+json", ".json": "application/json" };

// ---- a small in-memory imitation of an R2 bucket ----
class MemoryBucket {
  constructor() { this.objects = new Map(); this.uploads = new Map(); }
  async #bytes(body) {
    if (body == null) return Buffer.alloc(0);
    if (typeof body === "string") return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    return Buffer.from(await new Response(body).arrayBuffer());   // ReadableStream
  }
  #wrap(key, o) {
    return { key, size: o.data.length, uploaded: o.uploaded, httpMetadata: o.httpMetadata,
      body: new Response(o.data).body, json: async () => JSON.parse(o.data.toString()),
      text: async () => o.data.toString(), arrayBuffer: async () => o.data };
  }
  async put(key, body, opts = {}) {
    this.objects.set(key, { data: await this.#bytes(body), uploaded: new Date(), httpMetadata: opts.httpMetadata || {} });
  }
  async get(key) { const o = this.objects.get(key); return o ? this.#wrap(key, o) : null; }
  async head(key) { const o = this.objects.get(key); return o ? { key, size: o.data.length, uploaded: o.uploaded } : null; }
  async delete(keys) { for (const k of [].concat(keys)) this.objects.delete(k); }
  async list({ prefix = "", limit = 1000 } = {}) {
    const objects = [...this.objects].filter(([k]) => k.startsWith(prefix)).slice(0, limit)
      .map(([key, o]) => ({ key, size: o.data.length, uploaded: o.uploaded }));
    return { objects, truncated: false };
  }
  async createMultipartUpload(key) {
    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, { key, parts: new Map() });
    return this.resumeMultipartUpload(key, uploadId);
  }
  resumeMultipartUpload(key, uploadId) {
    const up = this.uploads.get(uploadId);
    return {
      key, uploadId,
      uploadPart: async (n, body) => {
        if (!up) throw new Error("unknown upload");
        up.parts.set(n, await this.#bytes(body));
        return { partNumber: n, etag: "etag-" + n };
      },
      complete: async (parts) => {
        if (!up) throw new Error("unknown upload");
        const data = Buffer.concat(parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => up.parts.get(p.partNumber)));
        this.objects.set(key, { data, uploaded: new Date(), httpMetadata: {} });
        this.uploads.delete(uploadId);
      },
    };
  }
}

const env = {
  MEDIA: new MemoryBucket(),
  APP_PASSCODE: process.env.APP_PASSCODE || "letmein",
  RENDER_SECRET: process.env.RENDER_SECRET || "dev-render-secret",
  GITHUB_TOKEN: "dev-token",
  GITHUB_REPO: "local/dev",
  GITHUB_API: `http://localhost:${PORT}/__github`,
  // Stand-ins for Claude and Pexels, so nothing here costs money or needs a key.
  ANTHROPIC_API_KEY: "dev-key",
  ANTHROPIC_API: `http://localhost:${PORT}/__anthropic`,
  // Pixabay by default; run with STOCK=pexels to try the Pexels path instead.
  ...(process.env.STOCK === "pexels"
    ? { PEXELS_API_KEY: "dev-key", PEXELS_API: `http://localhost:${PORT}/__pexels` }
    : { PIXABAY_API_KEY: "dev-key", PIXABAY_API: `http://localhost:${PORT}/__pixabay` }),
  STOCK_HOSTS: "localhost",
};
const MEDIA_DIR = process.env.DEV_MEDIA || "";   // folder holding sea.mp4 and sky.jpg for the pretend Pexels

const CANNED = [
  ["The happiness of your life depends upon the quality of your thoughts.", "Marcus Aurelius", "book", "Meditations", "mind", "calm", false],
  ["We suffer more often in imagination than in reality.", "Seneca", "classic", "Letters", "fear", "steady", false],
  ["Knowing yourself is the beginning of all wisdom.", "Aristotle", "classic", "", "self", "plain", true],
  ["It is not death that a man should fear, but he should fear never beginning to live.", "Marcus Aurelius", "book", "Meditations", "courage", "direct", true],
  ["What we achieve inwardly will change outer reality.", "Plutarch", "classic", "", "growth", "warm", true],
  ["He who has a why to live can bear almost any how.", "Friedrich Nietzsche", "classic", "Twilight of the Idols", "purpose", "firm", false],
  ["No man ever steps in the same river twice.", "Heraclitus", "classic", "", "change", "quiet", true],
  ["The soul becomes dyed with the colour of its thoughts.", "Marcus Aurelius", "book", "Meditations", "mind", "quiet", false],
];
let cannedAt = 0;
function pretendClaude(req) {
  const system = req.system || "";
  if (req.model !== "claude-sonnet-5-5" || req.output_config?.effort !== "medium") return { status: 400, body: { error: { message: "wrong model or effort" } } };
  let text;
  if (system.startsWith("You choose quotes")) {
    const want = Number((req.messages[0].content.match(/Suggest (\d+)/) || [])[1] || 6);
    const items = [];
    for (let i = 0; i < want; i++) {
      const [t, author, type, title, theme, tone, verify] = CANNED[(cannedAt++) % CANNED.length];
      items.push({ text: t, author, source: { type, title }, theme, tone, verify });
    }
    text = "Here are the quotes:\n```json\n" + JSON.stringify(items) + "\n```";
  } else if (system.startsWith("You are Nishiii")) {
    const first = req.messages[0].content;
    const original = (first.match(/Original quote:\n([\s\S]*?)\nAuthor:/) || [])[1] || "";
    const short = original.split(/\s+/).slice(0, 5).join(" ") + ".";
    text = JSON.stringify({ reply: "Shortened it. This is no longer the author's exact words.", quote: short, altered: true });
  } else if (system.startsWith("You read photographed")) {
    const hasImage = req.messages[0].content.some((c) => c.type === "image" && c.source?.data?.length > 100);
    text = JSON.stringify({ passages: hasImage ? ["The sea keeps no calendar.", "Whatever you can do, begin it."] : [] });
  } else text = "{}";
  return { status: 200, body: { content: [{ type: "text", text }] } };
}
function pretendPixabay(url) {
  const media = `http://localhost:${PORT}/__media`;
  const rendition = (w, h, name) => ({ url: `${media}/${name}`, width: w, height: h, size: 1000, thumbnail: `${media}/sky.jpg` });
  if (url.pathname.endsWith("/videos/")) {
    const hit = (id, upright) => ({ id, pageURL: "https://pixabay.com/videos/id-" + id, duration: 6, user: "Sample Filmer " + id,
      videos: upright
        ? { large: rendition(2160, 3840, "sea.mp4?4k"), medium: rendition(1080, 1920, "sea.mp4"), small: rendition(540, 960, "sea.mp4?s"), tiny: rendition(360, 640, "sea.mp4?t") }
        : { large: { url: "", width: 0, height: 0, size: 0, thumbnail: "" }, medium: rendition(1920, 1080, "sea.mp4?wide"), small: rendition(1280, 720, "sea.mp4?ws") } });
    return { total: 3, totalHits: 3, hits: [hit(11, false), hit(12, true), hit(13, true)] };
  }
  return { total: 2, totalHits: 2, hits: [1, 2].map((n) => ({ id: n, pageURL: "https://pixabay.com/photos/id-" + n, user: "Sample Shooter " + n,
    webformatURL: `${media}/sky.jpg`, largeImageURL: `${media}/sky.jpg` })) };
}
function pretendPexels(url) {
  const media = `http://localhost:${PORT}/__media`;
  if (url.pathname.endsWith("/videos/search")) {
    return { next_page: null, videos: [1, 2, 3].map((n) => ({ id: n, image: `${media}/sky.jpg`, duration: 6, url: "https://www.pexels.com/video/" + n,
      user: { name: "Sample Creator " + n }, video_files: [
        { file_type: "video/mp4", width: 2160, height: 3840, link: `${media}/sea.mp4?size=4k` },
        { file_type: "video/mp4", width: 1080, height: 1920, link: `${media}/sea.mp4` },
        { file_type: "application/x-mpegURL", width: null, height: null, link: `${media}/x.m3u8` }] })) };
  }
  return { next_page: null, photos: [1, 2].map((n) => ({ id: n, photographer: "Sample Photographer " + n, url: "https://www.pexels.com/photo/" + n,
    src: { medium: `${media}/sky.jpg`, original: `${media}/sky.jpg` } })) };
}

function runRenderJob(inputs) {
  const child = spawn("bash", [path.join(root, "render", "run_job.sh")], {
    env: { ...process.env, JOB_ID: inputs.job_id, APP_URL: inputs.app_url, RENDER_SECRET: env.RENDER_SECRET },
    stdio: "inherit",
  });
  child.on("exit", (code) => console.log(`render job ${inputs.job_id} exited with ${code}`));
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
});

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/__github/")) {           // pretend to be GitHub's "start workflow" call
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      if (process.env.FAIL_DISPATCH) { res.writeHead(401).end(); return; }
      runRenderJob(body.inputs || {});
      res.writeHead(204).end();
      return;
    }
    if (url.pathname.startsWith("/__anthropic/")) {
      if (req.headers["x-api-key"] !== env.ANTHROPIC_API_KEY) { res.writeHead(401).end("{}"); return; }
      const out = pretendClaude(JSON.parse((await readBody(req)).toString()));
      res.writeHead(out.status, { "Content-Type": "application/json" }).end(JSON.stringify(out.body));
      return;
    }
    if (url.pathname.startsWith("/__pixabay/")) {
      if (url.searchParams.get("key") !== env.PIXABAY_API_KEY) { res.writeHead(400).end("[ERROR 400] Invalid or missing API key"); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(pretendPixabay(url)));
      return;
    }
    if (url.pathname.startsWith("/__pexels/")) {
      if (req.headers.authorization !== env.PEXELS_API_KEY) { res.writeHead(401).end("{}"); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(pretendPexels(url)));
      return;
    }
    if (url.pathname.startsWith("/__media/") && MEDIA_DIR) {
      const data = await readFile(path.join(MEDIA_DIR, path.basename(url.pathname)));
      res.writeHead(200, { "Content-Type": url.pathname.endsWith(".mp4") ? "video/mp4" : "image/jpeg", "Content-Length": data.length }).end(data);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const hasBody = !["GET", "HEAD"].includes(req.method);
      const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === "string"));
      const request = new Request(url, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = path.join(root, "web", path.normalize(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(path.join(root, "web"))) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(data);
  } catch (e) {
    if (e.code === "ENOENT") res.writeHead(404).end("Not found");
    else { console.error(e); res.writeHead(500).end("Server error"); }
  }
}).listen(PORT, () => console.log(`Entangledd Studio (local) on http://localhost:${PORT}  passcode: ${env.APP_PASSCODE}`));
