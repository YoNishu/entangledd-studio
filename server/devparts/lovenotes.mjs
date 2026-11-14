// Stand-ins and test hooks for the little notes. Loaded by server/dev.mjs; never part of the real app.
//
//   PUT /__notes_sealed       body: ["<sealed delivery>", ...]   acts out "a new version was deployed
//                             with these deliveries in server/sealed.js" (the app's memory of what it has
//                             already dealt with is cleared too, as it would be after a deploy)
//   GET /__notes_day?day=YYYY-MM-DD   makes the pretend server believe it is noon in India on that day;
//                             without "day" the real time comes back
//   GET /__notes_claude_log   everything this pretend server has sent to the pretend Claude, so a test
//                             can prove that no note was ever in it
import { setDeliveries } from "../lovenotes.js";

const realNow = Date.now.bind(Date);
let shift = 0;
Date.now = () => realNow() + shift;

const realFetch = globalThis.fetch;
const sentToClaude = [];
globalThis.fetch = (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.includes("/__anthropic/")) sentToClaude.push(init && typeof init.body === "string" ? init.body : "(a body this log can't read)");
  return realFetch(input, init);
};

export async function handle(req, res, url, tools) {
  if (url.pathname === "/__notes_sealed" && req.method === "PUT") {
    setDeliveries(JSON.parse((await tools.readBody(req)).toString() || "[]"));
    res.writeHead(204).end();
    return true;
  }
  if (url.pathname === "/__notes_day") {
    const day = url.searchParams.get("day");
    shift = day ? Date.parse(day + "T06:30:00Z") - realNow() : 0;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ now: new Date(Date.now()).toISOString() }));
    return true;
  }
  if (url.pathname === "/__notes_claude_log") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(sentToClaude));
    return true;
  }
  return false;
}
