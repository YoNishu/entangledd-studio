// Stand-ins and test hooks for the upkeep section. Loaded by server/dev.mjs; never part of the real app.
//
//   PUT /__upkeep_put?key=<any storage key>&hours=N   stores the request body under that key, as if N hours ago
//   GET /__upkeep_age?prefix=<prefix>&hours=N         makes everything stored under the prefix N hours older
//   GET /__upkeep_now                                 what time the pretend server believes it is (see /__notes_day)
//   GET /__upkeep_get?key=<any storage key>           the raw content of one stored file (404 if there is none)
//
// It also makes the pretend storage's listing answer more like Cloudflare's: each file has an "etag" that
// changes when its content does, and "delimiter" lists only what sits directly under the prefix.
import { createHash } from "node:crypto";

const HOUR = 60 * 60 * 1000;
let wrapped = false;
function likeCloudflare(bucket) {
  if (wrapped) return;
  wrapped = true;
  const list = bucket.list.bind(bucket);
  bucket.list = async (opts = {}) => {
    const out = await list({ ...opts, limit: 100000 });
    let objects = out.objects;
    if (opts.delimiter) objects = objects.filter((o) => !o.key.slice((opts.prefix || "").length).includes(opts.delimiter));
    const limit = opts.limit || 1000;
    return { truncated: objects.length > limit, objects: objects.slice(0, limit).map((o) => ({ ...o,
      etag: createHash("md5").update(bucket.objects.get(o.key).data).digest("hex") })) };
  };
}

export async function handle(req, res, url, tools) {
  const bucket = tools.env.MEDIA;
  likeCloudflare(bucket);
  const back = Number(url.searchParams.get("hours") || 0) * HOUR;
  if (url.pathname === "/__upkeep_put" && req.method === "PUT") {
    const key = url.searchParams.get("key");
    await bucket.put(key, await tools.readBody(req));
    bucket.objects.get(key).uploaded = new Date(Date.now() - back);
    res.writeHead(204).end();
    return true;
  }
  if (url.pathname === "/__upkeep_now") {                 // what time the pretend server believes it is
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ now: Date.now() }));
    return true;
  }
  if (url.pathname === "/__upkeep_get") {                 // the raw content of any stored file
    const o = bucket.objects.get(url.searchParams.get("key"));
    res.writeHead(o ? 200 : 404, { "Content-Type": "application/octet-stream" }).end(o ? o.data : "");
    return true;
  }
  if (url.pathname === "/__upkeep_age") {
    let n = 0;
    for (const [key, o] of bucket.objects) {
      if (key.startsWith(url.searchParams.get("prefix") || "\0")) { o.uploaded = new Date(new Date(o.uploaded).getTime() - back); n += 1; }
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ aged: n }));
    return true;
  }
  return false;
}
