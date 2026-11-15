// A pretend web search inside the pretend Claude, for quotes asked for from particular works.
// Loaded by server/dev.mjs; never part of the real app.
//   WEBSEARCH=off     the account has web search switched off: a request carrying the tool is refused (400)
//   WEBSEARCH=pause   the first answer is a "pause_turn", as a long search can be
// A work whose title contains "Nothing Online" has no lines on the web.
// GET /__websearch_log lists what each request carried (tools, whether it was a continuation).
const log = [];

export async function handle(req, res, url, tools) {
  if (url.pathname === "/__websearch_log") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(log));
    return true;
  }
  if (url.pathname !== "/__anthropic/v1/messages" || req.method !== "POST" || url.searchParams.has("plain")) return false;
  const raw = (await tools.readBody(req)).toString();
  const body = JSON.parse(raw);
  const search = (body.tools || []).find((t) => t && t.type === "web_search_20250305" && t.name === "web_search");
  if (!search) return replay(req, res, raw, tools);
  if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY) { res.writeHead(401).end("{}"); return true; }
  const continuing = body.messages.length > 1 && body.messages[body.messages.length - 1].role === "assistant";
  log.push({ maxUses: search.max_uses, continuing, system: (body.system || "").includes("Web search:") });
  const send = (status, out) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(out)); return true; };
  if (process.env.WEBSEARCH === "off") return send(400, { type: "error", error: { type: "invalid_request_error", message: "Web search is not enabled for this organization." } });
  if (body.model !== "claude-sonnet-5-5" || body.output_config?.effort !== "medium") return send(400, { error: { message: "wrong model or effort" } });

  const lookedUp = [
    { type: "text", text: "I'll look these up." },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "quotes" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://www.goodreads.com/quotes", title: "Quotes", encrypted_content: "x", page_age: null }] },
  ];
  if (process.env.WEBSEARCH === "pause" && !continuing) return send(200, { stop_reason: "pause_turn", content: lookedUp });

  const brief = JSON.parse(body.messages[0].content.replace(/^[^\n]*\n/, ""));
  const works = (brief.only || []).filter((w) => !/Nothing Online/.test(w.title));
  const items = [];
  for (let i = 0; i < brief.count && works.length; i++) {
    const w = works[i % works.length];
    items.push({ text: `A line found on the web from ${w.title}, number ${Math.floor(i / works.length) + 1}.`, author: w.type === "book" ? (w.author || "") : "A character",
      source: { type: w.type, title: w.title }, theme: "love", tone: "tender", verify: i % 2 === 0, found: `https://www.goodreads.com/work/quotes/${i + 1}` });
  }
  // A continuation carries on after the earlier blocks; a first answer has them in front of the reply.
  const reply = [{ type: "text", text: JSON.stringify(items) }];
  return send(200, { stop_reason: "end_turn", content: continuing ? reply : [...lookedUp, ...reply], usage: { server_tool_use: { web_search_requests: 1 } } });
}

// Requests without the search tool go to the built-in pretend Claude unchanged.
async function replay(req, res, raw, tools) {
  const r = await fetch(`http://localhost:${tools.PORT}/__anthropic/v1/messages?plain=1`, { method: "POST", headers: { "x-api-key": req.headers["x-api-key"] || "", "content-type": "application/json" }, body: raw });
  res.writeHead(r.status, { "Content-Type": "application/json" }).end(await r.text());
  return true;
}
