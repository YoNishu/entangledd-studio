// Stand-ins and test hooks for the speed work. Loaded by server/dev.mjs; never part of the real app.
//   GET /__ops            every storage operation so far ([{ op, key, at }]); add ?reset=1 to clear the list
//   GET /__clock?add=ms   moves the server's clock forward (to test things that expire)
//   GET /__slow?path=/api/status&ms=1500   makes one path answer late (ms=0 to stop)
// Start with R2_DELAY=40 to make every storage operation take 40 ms, as real storage roughly does.
const ops = [];
const delay = Number(process.env.R2_DELAY || 0);
const realNow = Date.now.bind(Date);
let ahead = 0, wrapped = false;
const slow = new Map();
Date.now = () => realNow() + ahead;

function watch(bucket) {
  if (wrapped) return;
  wrapped = true;
  for (const op of ["get", "put", "head", "delete", "list"]) {
    const real = bucket[op].bind(bucket);
    bucket[op] = async (...args) => {
      const a = args[0];
      ops.push({ op, key: Array.isArray(a) ? a.join(",") : a && typeof a === "object" ? "prefix:" + (a.prefix || "") : String(a), at: realNow() });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return real(...args);
    };
  }
}

export async function handle(req, res, url, tools) {
  watch(tools.env.MEDIA);
  if (url.pathname === "/__ops") {
    const out = JSON.stringify(ops);
    if (url.searchParams.get("reset")) ops.length = 0;
    res.writeHead(200, { "Content-Type": "application/json" }).end(out);
    return true;
  }
  if (url.pathname === "/__slow") {
    const ms = Number(url.searchParams.get("ms") || 0), path = url.searchParams.get("path");
    if (ms > 0) slow.set(path, ms); else slow.delete(path);
    res.writeHead(204).end();
    return true;
  }
  if (slow.has(url.pathname)) await new Promise((r) => setTimeout(r, slow.get(url.pathname)));
  if (url.pathname === "/__clock") {
    ahead += Number(url.searchParams.get("add") || 0);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ahead }));
    return true;
  }
  return false;
}
