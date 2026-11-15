// Stand-ins for fresh numbers (Agent 16). Loaded by server/dev.mjs; never part of the real app.
//   GET /__ig?bump=N        every post's numbers (and the follower count) go up by N, as if time had passed on Instagram
//   GET /__ig?mode=down     Instagram doesn't answer (every Graph call fails); mode=paused: Meta has paused the app; mode=ok
//   GET /__ig?size=BYTES    the size of the file Instagram serves for a reel (default 6,000,000)
//   GET /__ig               what is set now, and how many Graph calls were made ({ calls })
// The served file itself answers at /__served/<media id>.mp4, to a one-byte range request, with its size only.
const state = { bump: 0, mode: "ok", size: 6000000, followers: null, calls: 0 };

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  if (p === "/__ig") {
    for (const k of ["bump", "size", "followers"]) if (url.searchParams.has(k)) state[k] = Number(url.searchParams.get(k));
    if (url.searchParams.has("mode")) state.mode = url.searchParams.get("mode");
    if (url.searchParams.has("reset")) state.calls = 0;
    send(res, 200, state); return true;
  }
  if (p.startsWith("/__served/")) {
    send(res, 206, "x", { "Content-Type": "video/mp4", "Content-Range": `bytes 0-0/${state.size}` }); return true;
  }
  const m = /^\/__graph\/v[\d.]+(\/.*)$/.exec(p);
  if (!m) return false;
  state.calls += 1;
  const path = m[1], q = url.searchParams;
  if (state.mode === "down") { res.writeHead(503, { "Content-Type": "text/html" }); res.end("<h1>Service unavailable</h1>"); return true; }
  if (state.mode === "paused") { send(res, 400, { error: { message: "API access blocked.", type: "OAuthException", code: 200 } }); return true; }
  if (/^\/M\d+$/.test(path) && (q.get("fields") || "") === "media_url") {
    send(res, 200, { id: path.slice(1), media_url: `http://localhost:${tools.PORT}/__served/${path.slice(1)}.mp4` }); return true;
  }
  if (state.bump && /^\/M\d+\/insights$/.test(path)) {
    const n = Number(path.slice(2).split("/")[0]), b = state.bump;
    const val = { reach: 1200 * n + b, views: 2100 * n + b, likes: 90 * n + b, comments: 4 * n + b, saved: 31 * n + b, shares: 12 * n + b, total_interactions: 137 * n + b,
      ig_reels_avg_watch_time: 4200 + 100 * n, ig_reels_video_view_total_time: 900000 * n, reels_skip_rate: 0.41, reposts: n, follows: n, profile_visits: 3 * n };
    const asked = (q.get("metric") || "").split(",");
    const unknown = asked.find((name) => !(name in val));
    if (unknown) { send(res, 400, { error: { message: `(#100) ${unknown} is not a valid metric`, code: 100 } }); return true; }
    send(res, 200, { data: asked.map((name) => ({ name, period: "lifetime", values: [{ value: val[name] }] })) }); return true;
  }
  if (state.bump && path === "/17890" && /followers_count/.test(q.get("fields") || "") && !/business_discovery/.test(q.get("fields") || "")) {
    send(res, 200, { followers_count: Number(process.env.FOLLOWERS || 64) + state.bump, media_count: 18, id: "17890" }); return true;
  }
  return false;
}
