// Stand-ins and test hooks for the engine (server/engine.js). Loaded by server/dev.mjs; never part of the real app.
//
//   pretend Claude:  "You tag quotes"       a theme from the first vocabulary word in each line (else "life"), tone "calm"
//                    "You identify quotes"  a line written "words — Name" is a known quote by Name; any other line is not
//   pretend Gemini and OpenAI, for the engine's own questions (the rest goes on to devparts/findlines.mjs):
//                    "Search the web for real ..."   three lines on the subject, two sites behind each
//                    "Search the web for the quote"  that quote, word for word, on two sites
//   GET  /__engine_log            every request answered here, in order ({ to, body }); ?reset=1 empties it
//   GET  /__engine_job?name=      makes only that timed job due and runs the five-minute timer once
//   GET  /__engine_set?web=off|empty   the pretend web search answers normally, refuses (429), or finds nothing
import * as health from "../health.js";
import * as scorer from "../scorer.js";
import * as lovenotes from "../lovenotes.js";
import * as upkeep from "../upkeep.js";
import * as engine from "../engine.js";

let log = [];
const mode = { web: "on" };
const WORDS = ["hope", "sea", "love", "death", "fear", "loss", "courage", "time", "mind", "peace", "self", "growth"];

function tagAnswer(content) {
  return content.split("\n").map((line) => {
    const m = /^(\d+)\. (.*)$/.exec(line);
    if (!m) return null;
    const low = m[2].toLowerCase();
    return { n: Number(m[1]), theme: WORDS.find((w) => low.includes(w)) || "life", tone: low.includes("hope") ? "hopeful" : "calm" };
  }).filter(Boolean);
}
function echoAnswer(content) {
  return content.split("\n").map((line) => {
    const m = /^(\d+)\. (.*)$/.exec(line);
    if (!m) return null;
    const k = /^(.*?)\s+[—-]\s+([A-Z][\w .'-]+)$/.exec(m[2].trim());
    return k ? { n: Number(m[1]), known: true, text: k[1], author: k[2], work: "", type: "classic" } : { n: Number(m[1]), known: false, text: "", author: "", work: "", type: "" };
  }).filter(Boolean);
}
function webLines(prompt) {
  const quote = /Search the web for the quote "([^"]+)" by ([^.]+)\./.exec(prompt);
  if (quote) return [{ text: quote[1], by: quote[2], work: "", type: "classic", page: "https://en.wikiquote.org/wiki/X", also: "https://www.goodreads.com/quotes/9" }];
  const about = (/quotes about (\w+)/.exec(prompt) || /quotes by ([^.]+)\./.exec(prompt) || /similar to "([^"]+)"/.exec(prompt) || [])[1] || "life";
  const tag = /came out in/.test(prompt) ? "new " : "";
  return [1, 2, 3].map((n) => ({ text: `A ${tag}line about ${about} the web gave, number ${n}.`, by: `Writer ${n}`, work: `Book of ${about} ${n}`, type: "book",
    page: "https://www.goodreads.com/quotes/" + n, also: "https://en.wikiquote.org/wiki/Q" + n }));
}

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(out)); return true; };
  if (p === "/__engine_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (p === "/__engine_set") { for (const [k, v] of url.searchParams) if (k in mode) mode[k] = v; return send(200, mode); }
  if (p === "/__engine_job") {
    const names = [health, scorer, lovenotes, upkeep, engine].flatMap((s) => s.jobs || []).map((j) => j.name);
    const key = "data/jobstamps.json", now = Date.now();
    const stamps = Object.fromEntries(names.map((n) => [n, n === url.searchParams.get("name") ? 0 : now]));
    await tools.env.MEDIA.put(key, JSON.stringify(stamps));
    await tools.runCron("*/5 * * * *");
    return send(200, { ran: url.searchParams.get("name") });
  }
  if (req.method !== "POST" || !/^\/__(anthropic|gemini|openai)\//.test(p)) return false;
  // Read the body once; if it is not one of ours, hand it on by putting it back for the next stand-in.
  const raw = await tools.readBody(req);
  const body = JSON.parse(raw.toString() || "{}");
  // Every stand-in reads a body with req.on("data") and req.on("end"): those now replay the body already read.
  const again = () => {
    const orig = req.on.bind(req);
    req.on = (ev, fn) => { if (ev === "data") queueMicrotask(() => fn(raw)); else if (ev === "end") queueMicrotask(() => queueMicrotask(fn)); else orig(ev, fn); return req; };
    return false;
  };
  if (p.startsWith("/__anthropic/")) {
    const system = String(body.system || "");
    if (!system.startsWith("You tag quotes") && !system.startsWith("You identify quotes")) return again();
    if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY) return send(401, {});
    log.push({ to: "claude", body });
    const content = body.messages[0].content;
    const out = system.startsWith("You tag quotes") ? tagAnswer(content) : echoAnswer(content);
    return send(200, { content: [{ type: "text", text: JSON.stringify(out) }] });
  }
  const prompt = p.startsWith("/__gemini/") ? (((body.contents || [])[0] || {}).parts || [{}])[0].text || "" : String(body.input || "");
  if (!/^Search the web for (real|the quote)/.test(prompt) || /^Search the web for real quotes from the /.test(prompt)) return again();
  log.push({ to: p.startsWith("/__gemini/") ? "gemini" : "openai", body });
  if (p.startsWith("/__gemini/") && req.headers["x-goog-api-key"] !== tools.env.GEMINI_API_KEY) return send(400, { error: { message: "API key not valid." } });
  if (p.startsWith("/__openai/") && req.headers.authorization !== "Bearer " + tools.env.OPENAI_API_KEY) return send(401, { error: { message: "Incorrect API key provided." } });
  if (mode.web === "off") return send(429, { error: { message: "You exceeded your current quota." } });
  const lines = mode.web === "empty" ? [] : webLines(prompt);
  const text = JSON.stringify(lines);
  if (p.startsWith("/__gemini/")) {
    return send(200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/A", title: "goodreads.com" } }, { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/B", title: "wikiquote.org" } }],
      groundingSupports: lines.map((l) => ({ segment: { text: l.text }, groundingChunkIndices: [0, 1] })) } }] });
  }
  return send(200, { output: [
    { type: "web_search_call", action: { sources: [{ url: "https://www.goodreads.com/quotes/1" }, { url: "https://en.wikiquote.org/wiki/Q1" }] } },
    { type: "message", content: [{ type: "output_text", text, annotations: [] }] }] });
}
