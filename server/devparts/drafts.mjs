// Test hook for drafts (server/drafts.js). Loaded by server/dev.mjs; never part of the real app.
//   DELETE /__drafts_del?key=<storage key>   removes one stored file, as the cleaner would
export async function handle(req, res, url, tools) {
  if (url.pathname === "/__drafts_del" && req.method === "DELETE") {
    await tools.env.MEDIA.delete(url.searchParams.get("key") || "");
    res.writeHead(204).end();
    return true;
  }
  return false;
}
