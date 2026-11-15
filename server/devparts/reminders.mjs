// Stand-ins and test hooks for the daily reminder. Loaded by server/dev.mjs; never part of the real app.
//
//   POST /__push/<name>        a pretend push service: the address a pretend phone hands the app. It keeps what
//                              it was sent and answers 201, or whatever /__push_mode was told.
//   GET  /__push_log           everything received so far: [{ name, at, headers, body (base64) }]; ?reset=1 empties it
//   GET  /__push_mode?status=410[&name=<name>]   from now on answer with that status (for one phone, or for all);
//                              a status of 201 puts it back. The answer carries {"reason": ...} the way Apple's does.
//   GET  /__push_clock?at=2026-11-16T05:41:00Z   makes the pretend server believe it is that moment
//                              (and time runs on from there); without "at" the real time comes back
//
// The local server may send to "localhost" only because PUSH_HOSTS says so here; the real app never has it.

export const env = () => ({ PUSH_HOSTS: "localhost" });

const base = Date.now;              // whatever clock the stand-ins loaded before this one have set up
let offset = 0;
Date.now = () => base() + offset;

const log = [];
const modes = new Map();            // name (or "*") -> status
const REASONS = { 400: "BadWebPushRequest", 403: "BadJwtToken", 404: "BadPath", 410: "Unregistered", 413: "PayloadTooLarge", 429: "TooManyRequests", 500: "InternalServerError", 503: "ServiceUnavailable" };

export async function handle(req, res, url, tools) {
  const sendJson = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data)); return true; };
  if (url.pathname.startsWith("/__push/") && req.method === "POST") {
    const name = url.pathname.slice("/__push/".length);
    const body = await tools.readBody(req);
    const keep = ["authorization", "content-encoding", "content-type", "ttl", "urgency", "topic"];
    log.push({ name, at: Date.now(), headers: Object.fromEntries(keep.map((h) => [h, req.headers[h] ?? null])), body: body.toString("base64") });
    const status = modes.get(name) || modes.get("*") || 201;
    if (status === 201) { res.writeHead(201, { Location: `http://localhost:${tools.PORT}/__push_receipt/${log.length}` }).end(); return true; }
    return sendJson(status, { reason: REASONS[status] || "InternalServerError" });
  }
  if (url.pathname === "/__push_log") {
    const out = log.slice();
    if (url.searchParams.get("reset")) log.length = 0;
    return sendJson(200, out);
  }
  if (url.pathname === "/__push_mode") {
    const status = Number(url.searchParams.get("status") || 201), name = url.searchParams.get("name") || "*";
    if (status === 201) modes.delete(name); else modes.set(name, status);
    return sendJson(200, Object.fromEntries(modes));
  }
  if (url.pathname === "/__push_clock") {
    const at = url.searchParams.get("at");
    offset = at ? Date.parse(at) - base() : 0;
    return sendJson(200, { now: new Date(Date.now()).toISOString() });
  }
  return false;
}
