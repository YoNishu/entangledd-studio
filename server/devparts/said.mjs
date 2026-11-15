// A pretend Claude for the gate's judge (server/said.js): for each numbered line, "said", "narration" (when the
// work is a book), "about" or "unsure". Loaded by server/dev.mjs; never part of the real app.
//   A line is "about" when it praises or describes the work from outside (praised, hailed, fans, critics,
//   audiences, viewers, "this drama", "recommend"); "unsure" when it holds the word "unsure"; else "said", or
//   "narration" for a book.
//   SAID=down                  the judge answers 500 (Claude cannot be asked): only lines with proof stay
//   GET /__said_set?mode=on|down   changes that while running
//   GET /__said_log            every question the judge received ({ work, lines }), in order (?reset=1 empties it)
let log = [];
const mode = { judge: process.env.SAID === "down" ? "down" : "on" };
const ABOUT = /\b(praised|hailed|loved by|fans|critics|audiences?|viewers|this drama|recommend)\b/i;

export function env() { return {}; }

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(out)); return true; };
  if (p === "/__said_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (p === "/__said_set") { if (url.searchParams.has("mode")) mode.judge = url.searchParams.get("mode"); return send(200, mode); }
  if (req.method !== "POST" || !p.startsWith("/__anthropic/")) return false;
  const raw = await tools.readBody(req);
  const body = JSON.parse(raw.toString() || "{}");
  if (!String(body.system || "").startsWith("You sort lines found on the web for a quotes page")) {
    // Not the judge: put the body back for the next stand-in.
    const orig = req.on.bind(req);
    req.on = (ev, fn) => { if (ev === "data") queueMicrotask(() => fn(raw)); else if (ev === "end") queueMicrotask(() => queueMicrotask(fn)); else orig(ev, fn); return req; };
    return false;
  }
  if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY) return send(401, {});
  const content = String((body.messages && body.messages[0] && body.messages[0].content) || "");
  const work = content.split("\n")[0];
  const lines = [...content.matchAll(/^(\d+)\. "(.*)" \((.*)\)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2], note: m[3] }));
  log.push({ work, lines });
  if (mode.judge === "down") return send(500, { error: { message: "pretend outage" } });
  const book = /^Work: the .*\bbook\b/.test(work);
  const out = lines.map((l) => ({ n: l.n, is: ABOUT.test(l.text) ? "about" : /\bunsure\b/i.test(l.text) ? "unsure" : book ? "narration" : "said" }));
  return send(200, { content: [{ type: "text", text: JSON.stringify(out) }] });
}
