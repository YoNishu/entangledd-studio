// Stand-ins and test hooks for the scorer. Loaded by server/dev.mjs; never part of the real app.
//
//   PUT    /__scorer_pool    body: a JSON array of quotes ({ text, author, source: { type, title }, theme, tone, verify }).
//                            From then on the pretend Claude answers every "suggest quotes" request from this
//                            list, in order, going round again when it runs out (each text gets a number so
//                            none repeats). Other requests to the pretend Claude get an empty answer.
//   DELETE /__scorer_pool    back to the built-in pretend Claude
//   GET    /__scorer_calls   every "suggest quotes" request seen while the pool was set: [{ want, maxTokens, count }]
//   DELETE /__scorer_calls   empties that list

let pool = null, cursor = 0;
const calls = [];

export async function handle(req, res, url, tools) {
  const sendJson = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data)); return true; };
  if (url.pathname === "/__scorer_pool") {
    if (req.method === "PUT") { pool = JSON.parse((await tools.readBody(req)).toString()); cursor = 0; }
    else if (req.method === "DELETE") pool = null;
    res.writeHead(204).end();
    return true;
  }
  if (url.pathname === "/__scorer_calls") {
    if (req.method === "DELETE") calls.length = 0;
    return sendJson(200, calls);
  }
  if (pool && url.pathname.startsWith("/__anthropic/") && req.method === "POST") {
    if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY) { res.writeHead(401).end("{}"); return true; }
    const body = JSON.parse((await tools.readBody(req)).toString());
    let text = "{}";
    if (String(body.system || "").startsWith("You choose quotes")) {
      const said = body.messages[0].content;
      const want = Number((said.match(/Suggest (\d+)/) || [])[1] || 5);
      let count = null;
      try { count = JSON.parse(said.split("as JSON:\n")[1]).count; } catch (e) { /* no details given */ }
      calls.push({ want, count, maxTokens: body.max_tokens });
      const items = [];
      for (let i = 0; i < want && pool.length; i++) {
        const q = pool[cursor % pool.length];
        cursor++;
        items.push({ ...q, text: `${q.text} (${cursor})` });
      }
      text = JSON.stringify(items);
    }
    return sendJson(200, { content: [{ type: "text", text }] });
  }
  return false;
}
