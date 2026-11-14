// Stand-ins and test hooks for the health section. Loaded by server/dev.mjs; never part of the real app.
//
// Pretend answers for what the health check asks the outside services, each switchable from a test:
//   /__health_set?name=value&...   change how the pretend services behave (see "mode" below); "null" clears a value
//   /__health_log                  every call the app made to a pretend outside service, in order
//   /__health_reset                back to "everything is fine", log emptied
//   /__health_ops                  how many storage operations and outside calls the app has made since
//                                  /__health_ops?reset=1 (what one timed run or one request costs)
//
// These are asked before the built-in stand-ins in dev.mjs, so they can answer particular paths themselves
// and leave the rest alone.

const DAY = 24 * 60 * 60 * 1000;
const USER = "LONG-user-token-0123456789", PAGE = "PAGE-token-0123456789";
const ALL_SCOPES = "instagram_basic,instagram_content_publish,instagram_manage_insights,instagram_manage_comments,pages_show_list,pages_read_engagement";

const fine = () => ({
  // Meta
  userDays: null,       // days left on the first user sign-in, as Meta reports it (null = 60)
  userValid: "yes",     // "no": Meta has dropped the user sign-in
  pageValid: "yes",     // "no": Meta has dropped the first Page token
  dataDays: null,       // days until "data access" ends on the first tokens (null = Meta gives no such date)
  newDataDays: null,    // the same, for tokens handed out by a renewal
  scopes: ALL_SCOPES,
  exchange: "extend",   // what asking for a fresh sign-in gets: extend | same | refuse | invalid | busy
                        //   | empty (an answer with no token) | echo (a refusal that repeats the token it was sent)
                        //   | person (a sign-in for somebody else) | fewer (one without the permission to post)
                        //   | sooner (one that ends before the current one)
  pageMake: "",         // the Page token made from a renewed sign-in: "" = good | fewer (can't post) | stale (old dates) | none (Page not listed)
  appSecret: "ok",      // "refused": Meta turns down the app's own ID and secret
  graphBusy: "",        // "yes": Meta is briefly unavailable
  graphEcho: "",        // "yes": Meta turns down a music search with words that repeat the token it was sent
  // GitHub
  github: "ok",         // ok | 401 | 403 | 404 | off (workflow disabled) | busy
  githubEnds: "",       // days until the token ends ("" = it has no end date)
  githubStyle: "utc",   // how the end date is written: utc | offset
  dispatch: "",         // "" = starts normally; 401 | 403 | 404 | 422 = GitHub refuses to start a reel
  // Anthropic
  claudeKey: "ok",      // ok | 401
  model: "active",      // active | deprecated | retired | 404
  modelDays: 90,        // days until a deprecated model is retired ("" = no date given)
  claudeAsk: "",        // how a real question is answered: "" = normally | credit | 401 | 404
  // the rest
  pixabay: "ok",        // ok | 400 | 429 | busy
  openverse: "ok",      // ok | 401
});
let mode = fine();
let log = [];
let issued = new Map();   // tokens handed out by renewals: token -> { kind, expires, valid, dataDays, person, scopes }
let made = 0;

// Counts what the app spends: every storage operation and every call to a pretend outside service.
// Cloudflare's free plan allows 50 of these, together, per request or timed run.
let ops = { storage: 0, outside: 0, what: [] };
let counting = false;
function countStorage(bucket) {
  if (counting) return;
  counting = true;
  for (const name of ["get", "put", "head", "delete", "list"]) {
    const real = bucket[name].bind(bucket);
    bucket[name] = (...args) => { ops.storage += 1; ops.what.push(`${name} ${typeof args[0] === "string" ? args[0] : ""}`.trim()); return real(...args); };
  }
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(typeof body === "string" ? body : JSON.stringify(body));
  return true;
};
const secs = (ms) => Math.floor(ms / 1000);
const userEnds = () => Date.now() + (mode.userDays === null ? 60 : Number(mode.userDays)) * DAY;

function debug(token) {
  const now = Date.now();
  const dataAt = (days) => (days === null || days === "" ? 0 : secs(now + Number(days) * DAY));
  const base = { app_id: "dev-app", application: "D's Studio (local)", user_id: "1001", issued_at: secs(now - DAY),
    scopes: String(mode.scopes).split(",").filter(Boolean) };
  if (token === USER) {
    const ends = userEnds(), valid = mode.userValid === "yes" && ends > now;
    return { ...base, type: "USER", is_valid: valid, expires_at: secs(ends), data_access_expires_at: dataAt(mode.dataDays),
      ...(valid ? {} : { error: { code: 190, subcode: 463, message: "Error validating access token: Session has expired." } }) };
  }
  if (token === PAGE) {
    const valid = mode.pageValid === "yes";
    return { ...base, type: "PAGE", profile_id: "111", is_valid: valid, expires_at: 0, data_access_expires_at: dataAt(mode.dataDays),
      ...(valid ? {} : { error: { code: 190, subcode: 460, message: "The session has been invalidated because the user changed their password." } }) };
  }
  const t = issued.get(token);
  if (!t) return { is_valid: false, scopes: [], error: { code: 190, message: "Malformed access token" } };
  return { ...base, type: t.kind === "page" ? "PAGE" : "USER", is_valid: t.valid && (t.expires === 0 || t.expires > now),
    expires_at: t.expires ? secs(t.expires) : 0, data_access_expires_at: dataAt(t.dataDays),
    ...(t.person ? { user_id: t.person } : {}), ...(t.scopes ? { scopes: t.scopes } : {}) };
}

function graph(req, res, url) {
  const p = url.pathname.replace(/^\/__graph\/v[\d.]+/, "");
  const q = url.searchParams, token = q.get("access_token") || "";
  const err = (status, code, message, extra = {}) => send(res, status, { error: { message, type: "OAuthException", code, ...extra } });

  if (p === "/debug_token") {
    if (mode.graphBusy === "yes") return err(503, 2, "Service temporarily unavailable");
    if (mode.appSecret !== "ok" || token !== "dev-app|dev-secret") return err(400, 190, "Invalid OAuth access token signature.");
    return send(res, 200, { data: debug(q.get("input_token") || "") });
  }
  // A token pasted wrongly (anything starting with MALFORMED): Meta's refusal repeats it, as the real one does.
  if (p === "/oauth/access_token" && String(q.get("fb_exchange_token")).startsWith("MALFORMED")) {
    return err(400, 190, `Malformed access token ${q.get("fb_exchange_token")}`);
  }
  if (p === "/ig_audio" && mode.graphEcho === "yes") return err(400, 100, `Unsupported get request with access token ${token}`);
  // Asking for a fresh sign-in with one that is already long-lived (the first connection, with a SHORT token, is built in).
  if (p === "/oauth/access_token" && String(q.get("fb_exchange_token")).startsWith("LONG")) {
    if (q.get("client_id") !== "dev-app" || q.get("client_secret") !== "dev-secret") return err(400, 101, "Error validating application. Invalid application secret.");
    const old = q.get("fb_exchange_token");
    const oldEnds = old === USER ? userEnds() : issued.get(old)?.expires || 0;
    const oldValid = old === USER ? mode.userValid === "yes" && oldEnds > Date.now() : !!issued.get(old)?.valid;
    if (mode.exchange === "busy") return err(500, 1, "An unknown error occurred");
    if (mode.exchange === "echo") return err(400, 100, `Invalid parameter: fb_exchange_token ${old} was not accepted`);
    if (mode.exchange === "refuse" || !oldValid) return err(400, 190, "Error validating access token: Session has expired.", { error_subcode: 463 });
    if (mode.exchange === "empty") return send(res, 200, { token_type: "bearer" });
    const fresh = `LONG-user-token-R${++made}`;
    const ends = mode.exchange === "same" ? oldEnds : mode.exchange === "sooner" ? oldEnds - 5 * DAY : Date.now() + 60 * DAY;
    issued.set(fresh, { kind: "user", expires: ends, valid: mode.exchange !== "invalid", dataDays: mode.exchange === "same" ? mode.dataDays : mode.newDataDays,
      person: mode.exchange === "person" ? "2002" : "",
      scopes: mode.exchange === "fewer" ? String(mode.scopes).split(",").filter((s) => s && s !== "instagram_content_publish") : null });
    return send(res, 200, { access_token: fresh, token_type: "bearer", expires_in: secs(ends - Date.now()) });
  }
  // The Page token that goes with a sign-in: for a renewed sign-in, or when the first Page token has been dropped.
  if (p === "/me/accounts" && (issued.has(token) || (token === USER && mode.pageValid !== "yes"))) {
    const t = issued.get(token);
    if (t ? !t.valid : mode.userValid !== "yes") return err(400, 190, "Invalid OAuth access token.");
    if (mode.pageMake === "none") return send(res, 200, { data: [] });
    const fresh = `PAGE-token-R${++made}`;
    issued.set(fresh, { kind: "page", expires: 0, valid: true, dataDays: mode.pageMake === "stale" ? mode.dataDays : t ? t.dataDays : mode.newDataDays,
      scopes: mode.pageMake === "fewer" ? String(mode.scopes).split(",").filter((s) => s && s !== "instagram_content_publish") : null });
    return send(res, 200, { data: [{ id: "111", access_token: fresh, instagram_business_account: { id: "17890" } }] });
  }
  // Everything else is left to the built-in pretend Instagram, which only knows the first two tokens:
  // a renewed token that is still good is shown to it as the one it replaced.
  const t = issued.get(token);
  if (t && t.valid && req.method === "GET") q.set("access_token", t.kind === "page" ? PAGE : USER);
  return false;
}

function github(req, res, url, tools) {
  if (req.method === "POST") {                       // starting a reel
    if (!mode.dispatch) return false;
    return send(res, Number(mode.dispatch), { message: Number(mode.dispatch) === 401 ? "Bad credentials" : "Refused" });
  }
  if (!/\/actions\/workflows\/render-job\.yml$/.test(url.pathname)) return send(res, 404, { message: "Not Found" });
  if (req.headers.authorization !== `Bearer ${tools.env.GITHUB_TOKEN}` || mode.github === "401") return send(res, 401, { message: "Bad credentials" });
  if (mode.github === "403") return send(res, 403, { message: "Resource not accessible by personal access token" }, { "x-ratelimit-remaining": "4990" });
  if (mode.github === "404") return send(res, 404, { message: "Not Found" });
  if (mode.github === "busy") return send(res, 503, { message: "Service unavailable" });
  const headers = {};
  if (mode.githubEnds !== "" && mode.githubEnds !== null) {
    const at = new Date(Date.now() + Number(mode.githubEnds) * DAY).toISOString().replace("T", " ").slice(0, 19);
    headers["github-authentication-token-expiration"] = at + (mode.githubStyle === "offset" ? " +0000" : " UTC");
  }
  return send(res, 200, { id: 1, name: "Render job", path: ".github/workflows/render-job.yml",
    state: mode.github === "off" ? "disabled_manually" : "active" }, headers);
}

function anthropic(req, res, url, tools) {
  const refuse = () => send(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  if (req.method === "GET" && url.pathname.startsWith("/__anthropic/v1/models/")) {
    if (req.headers["x-api-key"] !== tools.env.ANTHROPIC_API_KEY || mode.claudeKey === "401") return refuse();
    const id = decodeURIComponent(url.pathname.split("/").pop());
    if (mode.model === "404") return send(res, 404, { type: "error", error: { type: "not_found_error", message: `model: ${id}` } });
    const iso = (ms) => new Date(ms).toISOString();
    const leaving = mode.model !== "active";
    return send(res, 200, { type: "model", id, display_name: "Claude Sonnet 5.5", created_at: "2026-09-21T00:00:00Z", line: "sonnet",
      lifecycle: mode.model, deprecated_at: leaving ? iso(Date.now() - 10 * DAY) : null,
      retires_at: leaving && mode.modelDays !== "" && mode.modelDays !== null ? iso(Date.now() + Number(mode.modelDays) * DAY) : null });
  }
  if (req.method === "POST" && url.pathname === "/__anthropic/v1/messages") {
    if (mode.claudeAsk === "401" || mode.claudeKey === "401") return refuse();
    if (mode.claudeAsk === "credit") {
      return send(res, 400, { type: "error", error: { type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } });
    }
    if (mode.claudeAsk === "404") return send(res, 404, { type: "error", error: { type: "not_found_error", message: "model: claude-sonnet-5-5" } });
    return false;      // any other question goes to the built-in pretend Claude
  }
  return false;
}

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  countStorage(tools.env.MEDIA);
  if (p === "/__health_ops") {
    if (url.searchParams.get("reset")) ops = { storage: 0, outside: 0, what: [] };
    return send(res, 200, ops);
  }
  if (p === "/__health_set") {
    for (const [k, v] of url.searchParams) if (k in mode) mode[k] = v === "null" ? null : v;
    return send(res, 200, mode);
  }
  if (p === "/__health_log") return send(res, 200, log);
  if (p === "/__health_reset") { mode = fine(); log = []; issued = new Map(); made = 0; return send(res, 200, mode); }

  const service = /^\/__(graph|github|anthropic|pixabay|pexels|openverse|gutendex)\//.exec(p)?.[1];
  if (!service) return false;
  log.push({ service, method: req.method, path: p.replace(/^\/__\w+/, "") });
  ops.outside += 1; ops.what.push(`${service} ${req.method} ${p.replace(/^\/__\w+/, "")}`);
  if (service === "graph") return graph(req, res, url);
  if (service === "github") return github(req, res, url, tools);
  if (service === "anthropic") return anthropic(req, res, url, tools);
  if (service === "pixabay" && mode.pixabay !== "ok") {
    return mode.pixabay === "busy" ? send(res, 503, "busy") : send(res, Number(mode.pixabay), mode.pixabay === "429" ? "API rate limit exceeded" : "[ERROR 400] Invalid or missing API key");
  }
  if (service === "openverse" && p === "/__openverse/v1/auth_tokens/token/" && mode.openverse !== "ok") {
    return send(res, 401, { error: "invalid_client" });
  }
  return false;
}
