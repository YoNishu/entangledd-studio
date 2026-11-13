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
};

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
