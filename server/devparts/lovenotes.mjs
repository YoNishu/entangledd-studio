// Stand-ins and test hooks for the little notes. Loaded by server/dev.mjs; never part of the real app.
//
//   PUT /__notes_sealed       body: ["<sealed delivery>", ...]   acts out "a new version was deployed
//                             with these deliveries in server/sealed.js" (the app's memory of what it has
//                             already dealt with is cleared too, as it would be after a deploy)
//   GET /__notes_day?day=YYYY-MM-DD   makes the pretend server believe it is noon in India on that day;
//                             without "day" the real time comes back
//   GET /__notes_claude_log   everything this pretend server has sent to the pretend Claude, so a test
//                             can prove that no note was ever in it
//   GET /__notes_ops          every storage read and write since this was last asked ("get data/x.json", ...),
//                             so a test can prove that a quiet job really touches nothing
//
// The stand-in starts with no deliveries, whatever server/sealed.js holds: a real delivery is sealed for the
// real app's key, which the stand-in never has, so it could only ever be counted as "couldn't be opened".
// DEV_SEALED=file keeps the file's deliveries (for acting out a deploy from a copy of the repo).
import { setDeliveries } from "../lovenotes.js";

if (process.env.DEV_SEALED !== "file") setDeliveries([]);

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

let ops = null;
function watchStorage(bucket) {
  if (ops) return;
  ops = [];
  for (const name of ["get", "put", "delete", "head", "list"]) {
    const real = bucket[name].bind(bucket);
    bucket[name] = async (key, ...rest) => {
      ops.push(`${name} ${typeof key === "string" ? key : JSON.stringify(key)}`);
      if (ops.length > 5000) ops.splice(0, 1000);
      // What Cloudflare's storage does with "keep this only if nothing is there yet"
      // (onlyIf: If-None-Match: *): when something is there, nothing is written and null comes back.
      const onlyIf = name === "put" && rest[1] && rest[1].onlyIf;
      if (onlyIf instanceof Headers && onlyIf.get("If-None-Match") === "*" && bucket.objects.has(key)) return null;
      return real(key, ...rest);
    };
  }
}

export async function handle(req, res, url, tools) {
  watchStorage(tools.env.MEDIA);
  if (url.pathname === "/__notes_ops") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(ops.splice(0)));
    return true;
  }
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
