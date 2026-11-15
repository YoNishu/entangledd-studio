/* The second half of the health record: does each outside service still do what the app needs of it,
   and is the app's own housekeeping running?

   Every probe here only reads. Nothing is posted, nothing is written to Instagram, nothing costs money.
   They run in two small timed jobs, apart from the daily check of keys in health.js, so that no single
   run makes too many calls:
     services   book texts, the music search, a photo fetched the way the app fetches it, the reel maker's self-test
     page       Instagram's list of her posts, the newest post's numbers, comments, and the app's own
                backups, cleaning and record of problems

   Each probe answers like the checks in health.js: { title, state, line, brief, fix }. A probe that can't
   be made (a service was slow or down) throws; health.js then keeps what was known and raises it only
   if it stays that way for three days. */
import { hide, dayIST, RECONNECT } from "./health.js";
import { upkeepState } from "./upkeep.js";
import { A_DAY, FEATURES, listModels, sayTrail, stepsText } from "./findlines.js";
import { OPEN_A_DAY } from "./opensearch.js";

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const SLOW_MS = 15000;
const ASK_CLAUDE = (what) => `If it stays this way for a few days, tell Claude, in the chat where the app was built: "${what}"`;

// Gives an outside service a fair time to answer, and no longer.
const inTime = (promise, what) => Promise.race([promise,
  new Promise((_, no) => setTimeout(() => no(new Error(`${what} took too long to answer`)), SLOW_MS))]);
// A service's own "no" that is no verdict on anything: it is busy, or it couldn't be reached.
const notNow = (e, kit, what) => new Error(`${what} couldn't be asked just now${e instanceof kit.UserError ? "" : `: ${hide(e && e.message)}`}`);

// ---------------------------------------------------------------- services

// A book old enough to be free, which the catalogue has always had.
const KNOWN_BOOK = { title: "Walden", author: "Henry David Thoreau" };

async function probeBooks(env, kit) {
  const title = "Book texts";
  const CHANGED = ["Nothing to do at once: quotes from books still come, from Nishiii's memory instead of the book's own text.",
    ASK_CLAUDE("The free-books catalogue (Gutendex) has changed; quotes from book text have stopped.")];
  let found;
  try { found = await inTime(kit.findBookText(env, KNOWN_BOOK), "The free-books catalogue"); }
  catch (e) { throw notNow(e, kit, "The free-books catalogue"); }
  if (!found.textUrl) {
    return { title, state: "soon", fix: CHANGED, brief: "the free-books catalogue no longer offers the text of a book it always had",
      line: "The free-books catalogue answered, but without the plain text of a book it has always had. Quotes copied from a book's own text are off; Nishiii quotes books from memory meanwhile." };
  }
  let target;
  try { target = new URL(found.textUrl); } catch (e) { target = null; }
  const local = !!env.STOCK_HOSTS && target && target.protocol === "http:";
  const allowed = !!target && (target.protocol === "https:" || local) && kit.textHostAllowed(env, target.hostname);
  let res = null;
  if (allowed) {
    try { res = await fetch(target, { headers: { Range: "bytes=0-2047", "User-Agent": "DsStudio/1.0 (personal quotes app; health check)" }, signal: AbortSignal.timeout(SLOW_MS) }); }
    catch (e) { throw new Error("the book's text couldn't be reached just now"); }
    if (res.body) await res.body.cancel().catch(() => {});            // only the headers matter here
  }
  if (!allowed || !res.ok || !/^text\/plain/i.test(res.headers.get("Content-Type") || "")) {
    return { title, state: "soon", fix: CHANGED, brief: "the text of a free book can no longer be fetched",
      line: `The free-books catalogue answered, but the text of a book couldn't be fetched from where it points${res ? ` (status ${res.status})` : ""}. Nishiii quotes books from memory meanwhile.` };
  }
  return { title, state: "ok", brief: "", line: "Working. The catalogue of free books answers, and a book's text can be read." };
}

async function probeTracks(env, kit) {
  const title = "Music search";
  let found;
  // The same search the Music tab opens with, asked afresh; a good answer is kept for her like any other search.
  try { found = await inTime(kit.musicSearchCached(env, "calm piano", 1, true), "The free music library"); }
  catch (e) { throw notNow(e, kit, "The free music library"); }
  if (!found.items.length) {
    return { title, state: "soon", brief: "the free music library answers with no tracks the app can use",
      line: "The free music library answered a test search with no tracks the app can use, so the Music tab finds nothing new. Your own music files still work.",
      fix: ["Nothing to do at once: your own music files and Instagram's music still work.",
        ASK_CLAUDE("The free music library (Openverse) answers, but none of its tracks pass the app's checks any more.")] };
  }
  return { title, state: "ok", brief: "", line: `Working. A test search found ${found.items.length} tracks with licences the app accepts.` };
}

async function probePhotos(env, kit) {
  const title = "Photos from the search";
  const who = kit.stockProvider(env);
  if (!who) return { title, state: "off", line: "Searching for backgrounds isn't set up. Your own photos and videos work.", brief: "" };
  const info = kit.PROVIDERS[who];
  let found;
  try { found = await inTime(who === "pixabay" ? kit.searchPixabay(env, "photo", "sea", 1) : kit.searchPexels(env, "photo", "sea", 1), info.name); }
  catch (e) { throw notNow(e, kit, info.name); }          // a refused key is the Background search line's to report
  const photo = found.items[0];
  const FIX = ["Nothing to do at once: videos from the search and your own photos are not affected.",
    ASK_CLAUDE(`Photos from ${info.name} can no longer be fetched through the app's server.`)];
  if (!photo) {
    return { title, state: "soon", fix: FIX, brief: `${info.name} answers a photo search with nothing`,
      line: `${info.name} answered a test search for photos with nothing at all.` };
  }
  // The same addresses, in the same order, with the same request the app itself makes; only the headers are read.
  const targets = kit.stockTargets(env, photo.files || [photo.file]);
  const got = await inTime(kit.fetchStockFile(env, info, targets), info.name);
  if (got.res && got.res.body) await got.res.body.cancel().catch(() => {});
  if (!got.res) {
    return { title, state: "soon", fix: FIX, brief: `photos from ${info.name} can't be fetched through the app's server`,
      line: `A photo from ${info.name} couldn't be fetched through the app's server (${targets.length} addresses tried${got.last ? `, last status ${got.last}` : ""}). Photos picked from the search may not load.` };
  }
  return { title, state: "ok", brief: "", line: `Working. A photo from ${info.name} was fetched the way the app fetches one.` };
}

// The reel maker's own test on GitHub ("Render check"): it makes sample reels with the real renderer and
// checks them. It runs when the renderer changes and once a week. GitHub switches weekly jobs off in a
// repository nobody has touched for 60 days, so when the latest run is over eight days old the app starts
// one itself, with the same key that starts reels.
const SELFCHECK = "render-check.yml";
async function probeSelfcheck(env, kit) {
  const title = "Reel maker's self-test";
  if (!kit.reelsReady(env)) return { title, state: "off", line: "Reels aren't set up yet.", brief: "" };
  const api = `${env.GITHUB_API || "https://api.github.com"}/repos/${env.GITHUB_REPO}/actions/workflows/${SELFCHECK}`;
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "entangledd-studio" };
  const res = await fetch(`${api}/runs?per_page=5`, { headers, signal: AbortSignal.timeout(SLOW_MS) });
  if (res.status === 404) return { title, state: "off", brief: "", line: "The reel maker has no self-test on GitHub." };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);       // the key itself is the Reel maker's key line's to report
  const runs = ((await res.json()).workflow_runs || []).filter((r) => r && typeof r === "object");
  const newest = runs[0] ? Date.parse(runs[0].created_at) || 0 : 0;
  const verdicts = runs.filter((r) => r.status === "completed" && ["success", "failure", "timed_out", "startup_failure"].includes(r.conclusion));
  const judged = verdicts[0];
  const when = (r) => Date.parse(r.updated_at || r.created_at) || Date.now();
  const failedAt = judged && judged.conclusion !== "success" ? when(judged) : 0;
  const SEE = [`On github.com open ${env.GITHUB_REPO}, then Actions, Render check, and the newest run. The step marked red says what went wrong.`,
    "Tell Claude, in the chat where the app was built, what that step says."];

  // Keep it running without anyone: start a run when the last one is over eight days old. One failed run is
  // tried again too (GitHub's machines have their off days), once the failed run is an hour old and nothing
  // newer has started; only a second failure in a row, or a failure nothing has followed for days, is raised.
  let asked = false;
  const again = failedAt && runs[0] === judged && Date.now() - failedAt > 60 * 60 * 1000;
  if (Date.now() - newest > 8 * DAY || again) {
    const post = (path, body) => fetch(`${api}/${path}`, { method: path === "enable" ? "PUT" : "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(SLOW_MS) }).catch(() => null);
    await post("enable");                                   // harmless when it is already on
    const started = await post("dispatches", { ref: "main" });
    asked = !!started && started.status === 204;
  }
  if (failedAt) {
    const twice = verdicts[1] && verdicts[1].conclusion !== "success";
    if (!twice && Date.now() - failedAt < 5 * DAY) {
      return { title, state: "unknown", brief: "",
        line: `The self-test failed once, on ${dayIST(failedAt)}. ${asked ? "The app has asked for another run" : "Another run is awaited"}; its result is read tomorrow.` };
    }
    return { title, state: "attention", fix: SEE, brief: "the reel maker's self-test failed",
      line: `The reel maker's self-test failed on ${dayIST(failedAt)}${twice ? ", twice running" : ""}, so reels may not come out right until it is looked at.` };
  }
  const passed = judged ? when(judged) : 0;
  if (!passed) {
    return { title, state: "unknown", brief: "", line: asked ? "The self-test has been started for the first time. Its result is read tomorrow." : "The self-test hasn't finished a run yet." };
  }
  if (Date.now() - passed > 21 * DAY) {
    return { title, state: "soon", brief: "the reel maker's self-test hasn't run for three weeks",
      line: `The reel maker's self-test last passed on ${dayIST(passed)} and hasn't run since${asked ? "; the app has just asked for a new run" : ", and the app couldn't start one"}.`,
      fix: [`On github.com open ${env.GITHUB_REPO}, then Actions, Render check. If it says the workflow is disabled, tap Enable workflow; then tap Run workflow.`] };
  }
  return { title, state: "ok", brief: "", line: `Passed on ${dayIST(passed)}.${asked ? " The app has asked for this week's run." : ""}` };
}

// ---------------------------------------------------------------- her page on Instagram

const NEED = (permission) => [RECONNECT[0], `Tap Generate Access Token and tick every permission, including ${permission}.`, RECONNECT[2]];

// Asked once, before the three probes that use it: Instagram's own list of what is on her page.
async function readFeed(env, kit, ctx) {
  if (!kit.igReady(env) || !ctx.ig) return;
  try {
    const out = await inTime(kit.graphAny(env, ctx.ig, "GET", `/${ctx.ig.igId}/media`, { fields: "id,media_type,media_product_type,timestamp", limit: "5" }), "Instagram");
    ctx.feed = Array.isArray(out.data) ? out.data : [];
  } catch (e) { ctx.feedError = e; }
  // The post to try the numbers and comments on: the newest one made with the app, else the newest on the page.
  const mine = (ctx.posts || []).filter((p) => p && p.state === "published" && p.mediaId).slice(-1)[0];
  ctx.newest = mine ? String(mine.mediaId) : ctx.feed && ctx.feed[0] ? String(ctx.feed[0].id) : "";
}
const notConnected = (title) => ({ title, state: "off", brief: "", line: "Instagram isn't connected." });
// A permission that was there and has gone is the Instagram line's to report, with the steps. Said once, not twice.
const missing = (ctx, title, alarm) => (ctx.igTrouble ? { title, state: "off", brief: "", line: "Off until the Instagram line above is seen to." } : alarm);

function probeFeed(env, kit, ctx) {
  const title = "Your posts on Instagram";
  if (!kit.igReady(env) || !ctx.ig) return notConnected(title);
  if (ctx.feedError) throw notNow(ctx.feedError, kit, "Instagram");      // an ended sign-in is the Instagram line's to report
  // Meta names the version of its interface that really answered. When it stops being the one the app was
  // written for, Meta has withdrawn that version and moved the app along: things may change under it.
  const answered = kit.graphAnswered();
  if (answered && answered !== kit.GRAPH_VERSION) {
    return { title, state: "soon", brief: "Meta has withdrawn the version of its Instagram interface the app was written for",
      line: `Instagram still answers, but Meta has withdrawn version ${kit.GRAPH_VERSION} of its interface and now answers as ${hide(answered).slice(0, 12)}. Posting and numbers may start to behave differently.`,
      fix: [`Tell Claude, in the chat where the app was built: "Meta has withdrawn Graph API ${kit.GRAPH_VERSION}; please move D's Studio to the current version and run the tests."`] };
  }
  return { title, state: "ok", brief: "", line: `Working. Instagram lists what is on your page${ctx.feed.length ? "" : " (nothing posted yet)"}, which is how a reel finished in Instagram is found.` };
}

async function probeNumbers(env, kit, ctx) {
  const title = "Post numbers";
  if (!kit.igReady(env) || !ctx.ig) return notConnected(title);
  const MISSING = { title, state: "attention", fix: NEED("instagram_manage_insights"), action: "reconnect",
    brief: "the permission to read post numbers is missing",
    line: "Instagram doesn't let the app read how posts did: the connection lacks that permission. Posts and Insights show no new numbers." };
  if (ctx.scopes.length && !ctx.scopes.includes("instagram_manage_insights")) return missing(ctx, title, MISSING);
  if (!ctx.newest) return { title, state: "ok", brief: "", line: "Ready. Nothing has been posted yet, so there are no numbers to read." };
  try {
    await inTime(kit.graphAny(env, ctx.ig, "GET", `/${ctx.newest}/insights`, { metric: "reach,likes,comments,saved,shares" }), "Instagram");
  } catch (e) {
    if (e instanceof kit.UserError && e.denied) return missing(ctx, title, MISSING);
    if (e instanceof kit.UserError && e.gone) return { title, state: "ok", brief: "", line: "Ready. The newest post has been removed on Instagram, so there was nothing to read today." };
    throw notNow(e, kit, "Instagram");
  }
  return { title, state: "ok", brief: "", line: "Working. The newest post's numbers were read from Instagram." };
}

async function probeComments(env, kit, ctx) {
  const title = "Comments";
  if (!kit.igReady(env) || !ctx.ig) return notConnected(title);
  const MISSING = { title, state: "soon", fix: NEED("instagram_manage_comments"), action: "reconnect",
    brief: "the permission for comments is missing, so comments can't be read or answered",
    line: "Reading and answering comments is off: the Instagram connection was made without that permission. Everything else works." };
  if (ctx.scopes.length && !ctx.scopes.includes("instagram_manage_comments")) return missing(ctx, title, MISSING);
  if (!ctx.newest) return { title, state: "ok", brief: "", line: "Ready. Nothing has been posted yet, so there are no comments to read." };
  try {
    await inTime(kit.graphAny(env, ctx.ig, "GET", `/${ctx.newest}/comments`, { fields: "id", limit: "1" }), "Instagram");
  } catch (e) {
    if (e instanceof kit.UserError && e.denied) return missing(ctx, title, MISSING);
    if (e instanceof kit.UserError && e.gone) return { title, state: "ok", brief: "", line: "Ready. The newest post has been removed on Instagram, so there was nothing to read today." };
    throw notNow(e, kit, "Instagram");
  }
  return { title, state: "ok", brief: "", line: "Working. The newest post's comments can be read." };
}

// ---------------------------------------------------------------- the app's own housekeeping

const TIMERS_FIX = ["Open Settings, Check everything: the line Daily routines says whether the app's timers run.",
  ASK_CLAUDE("D's Studio's housekeeping (backups or cleaning) has stopped; the health record says so.")];
const since = (ctx, id) => (ctx.old?.items || []).find((i) => i.id === id)?.unknownSince || 0;
const size = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);

function probeBackup(env, kit, ctx) {
  const title = "Backups";
  const b = ctx.upkeep.backed;
  if (!b || !b.day) {
    if (since(ctx, "backup") && Date.now() - since(ctx, "backup") > 2 * DAY) {
      return { title, state: "attention", fix: TIMERS_FIX, keepSince: true, brief: "no backup has ever been made",
        line: "No backup of your library, posts and notes has been made since the app was updated." };
    }
    return { title, state: "unknown", brief: "", line: "The first backup is made within a few hours of the app being updated." };
  }
  const days = Math.round((Date.parse(kit.todayIST()) - Date.parse(b.day)) / DAY);
  if (!(days <= 2)) {
    return { title, state: "attention", fix: TIMERS_FIX, brief: `no backup has been made for ${days} days`,
      line: `The last backup of your library, posts and notes was made ${days} days ago; it should be daily.` };
  }
  const n = Object.keys(b.docs || {}).length;
  return { title, state: "ok", brief: "", line: `Working. Your library, posts, notes and sign-ins were last copied on ${dayIST(Date.parse(b.day))} (${n} documents; two weeks of copies are kept).` };
}

function probeCleaning(env, kit, ctx) {
  const title = "Tidying up";
  const c = ctx.upkeep.cleaned;
  if (!c || !c.at) {
    if (since(ctx, "cleaning") && Date.now() - since(ctx, "cleaning") > 2 * DAY) {
      return { title, state: "attention", fix: TIMERS_FIX, keepSince: true, brief: "old files have never been cleared",
        line: "Old reels and searches haven't been cleared since the app was updated." };
    }
    return { title, state: "unknown", brief: "", line: "Old files are cleared for the first time within a few hours of the app being updated." };
  }
  if (Date.now() - c.at > 2 * DAY) {
    return { title, state: "attention", fix: TIMERS_FIX, brief: "old files are no longer being cleared",
      line: `Old reels and searches were last cleared on ${dayIST(c.at)}; it should happen several times a day.` };
  }
  if (c.bytes > ctx.upkeep.STORAGE_WARN_BYTES) {
    return { title, state: "soon", brief: "the app's storage is nearly full",
      line: `The app is holding ${size(c.bytes)} of reels and backgrounds; Cloudflare's free storage is 10 GB.`,
      fix: ["In D's Studio open Posts and remove reels waiting to be posted that are no longer wanted.",
        ASK_CLAUDE("D's Studio's storage is nearly full; please shorten how long finished reels are kept.")] };
  }
  return { title, state: "ok", brief: "", line: `Working. Tidied on ${dayIST(c.at)}; ${c.files} files kept (${size(c.bytes)}). Reels are cleared after seven days.` };
}

function probeErrors(env, kit, ctx) {
  const title = "Problems noticed";
  const n = ctx.upkeep.errorsLastDay, latest = ctx.upkeep.latestError;
  ctx.errorsLastDay = n;
  if (!n) return { title, state: "ok", brief: "", line: "None in the last day." };
  if (ctx.upkeep.guessing) {
    return { title, state: "soon", brief: "someone tried many wrong passcodes",
      line: `On ${dayIST(ctx.upkeep.guessing.at)} so many wrong passcodes were tried within an hour that sign-in by passcode rested for the remainder of that hour. Nobody got in that way.`,
      fix: ["If that was you or Dhruuu, nothing is needed: this clears itself in a day.",
        "If not, choose a longer passcode. In Cloudflare: Workers & Pages, entangledd-studio, Settings, Variables and Secrets. Edit APP_PASSCODE, type the new one, then Deploy.",
        "Dhruuu then signs in once with the new passcode. Face ID keeps working."] };
  }
  const what = latest ? ` The latest, at ${latest.where}: ${latest.what}` : "";
  if (n >= 10) {
    return { title, state: "soon", brief: `${n} problems in the last day`, line: `${n} problems in the last day.${what}`,
      fix: ["Try the part of the app the line above names. If it works, nothing more is needed: the count clears itself in a day.",
        "If it doesn't, tell Claude, in the chat where the app was built, what the line above says."] };
  }
  return { title, state: "ok", brief: "", line: `${n === 1 ? "1 problem" : `${n} problems`} in the last day, which is within the ordinary.${what}` };
}

// ---------------------------------------------------------------- looking things up (findlines.js, verify.js)

// The free places, as data/lookups.json names them, and the two search helpers with their settings.
const PLACES = [["wikiquote", "Wikiquote"], ["quoteinvestigator", "Quote Investigator"], ["goodreads", "Goodreads"], ["imdb", "IMDb"],
  ["wikipedia", "Wikipedia"], ["openlibrary", "Open Library"], ["tavily", "Tavily"], ["serper", "Serper"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"]];
const HELPERS = [["gemini", "Gemini", "GEMINI_API_KEY", "GEMINI_MODEL", "Google AI Studio (aistudio.google.com), API keys"],
  ["openai", "OpenAI", "OPENAI_API_KEY", "OPENAI_MODEL", "platform.openai.com, API keys"]];
const LAST = { worked: "worked", limit: "stopped at the app's daily limit", "used up": "stopped: the account's allowance was used up",
  refused: "was refused", "may not search": "was refused the search tool", "no model": "found no model it may use", "no answer": "got no answer",
  "no allowance": "was refused: no model has an allowance on this key", "no credit": "was refused: the account has no credit", busy: "was asked to wait (a passing limit)" };
// What a key with no allowance needs, in one line each.
const NO_ALLOWANCE = {
  gemini: ["Gemini: Google gives a free key no searches on its newer models. Nothing to do: the app searches the web without it. To add Google: aistudio.google.com, Get API key, the key's project, Set up billing (Gemini 3 and newer: 5,000 searches a month free, then $14 per 1,000; the app asks at most 40 a day)."],
  openai: ["OpenAI: the key has no credit. Nothing to do: the app searches the web without it. To add OpenAI: platform.openai.com, Settings, Billing, Add to credit balance (from $5), then Limits, set a monthly budget."] };
// The features that search the web through Gemini or OpenAI, as data/lookups.json names them (findlines.js).
const FEATURE_NAMES = { lookup: "quotes from a work", discover: "finding new lines", echo: "checking new lines", check: "\"Who said this?\"", title: "checking a title" };
const USE_SAID = { found: "worked", answered: "answered", "all rejected": "answered, but every line was left out", "no answer": "got no answer",
  "key refused": "was refused: the key", "may not search": "was refused the search tool", "no model": "found no model", "used up": "stopped: allowance used up",
  "no allowance": "was refused: no allowance on this model", "no credit": "was refused: no credit", busy: "was asked to wait",
  limit: "stopped at the app's daily limit", resting: "rested after an earlier refusal" };
const BAD_USE = new Set(["key refused", "may not search", "no model", "used up", "no allowance", "no credit"]);
const inCloudflare = (name) => `In Cloudflare: Workers & Pages, entangledd-studio, Settings, Variables and Secrets. Edit ${name}, paste the new value, then Deploy.`;

async function probeLookups(env, kit) {
  const title = "Looking things up";
  const rec = (await kit.loadDoc(env, "lookups", null)) || {};
  const sites = rec.sites || {}, last = rec.last || {}, today = rec.day === kit.todayIST();
  const said = [], soon = [], urgent = [], fix = [];
  for (const [id, name] of PLACES) {
    const s = sites[id];
    if (!s || !(s.ok || s.failed)) continue;
    if ((s.failed || 0) > (s.ok || 0)) {
      said.push(`${name} ${s.blocked ? "turned the app away" : "didn't answer"} on ${dayIST(s.failed)}${s.why ? ` (${s.why})` : ""}.`);
      soon.push(`${name} ${s.blocked ? "turns the app away" : "doesn't answer"}`);
    } else said.push(`${name} worked on ${dayIST(s.ok)}.`);
  }
  if (soon.length) fix.push("Nothing urgent: what isn't found comes from the other places, and from Nishiii's memory, clearly marked.",
    ...(soon.some((x) => /^(Goodreads|IMDb)/.test(x)) ? ["If Goodreads or IMDb keep turning the app away, stop asking them: " + inCloudflare("QUOTE_SITES").replace("paste the new value", "set it to off")] : []));
  for (const [id, name, KEY, MODEL, where] of HELPERS) {
    if (!env[KEY]) { said.push(`${name}: no key.`); continue; }
    // The list of models the key may use: reading it asks nothing and costs nothing.
    let got;
    try { got = await inTime(listModels(env, id, SLOW_MS), name); } catch (e) { got = null; }
    const l = last[id], use = today ? rec[id] || {} : {}, calls = use.calls || 0, refusedN = use.refused || 0, answered = use.answered ?? Math.max(0, calls - refusedN);
    const count = `${answered} of ${A_DAY[id]} searches answered today${refusedN ? `, ${refusedN} refused` : ""}`;
    const theirWords = (() => { const u = Object.values(rec.uses || {}).filter((x) => x && x.who === id && x.said).sort((a, b) => b.at - a.at)[0]; return u ? ` (${id === "gemini" ? "Google" : "OpenAI"} said: "${hide(u.said).slice(0, 140)}")` : ""; })();
    const lastly = l && LAST[l.what] ? ` The last search ${LAST[l.what]} on ${dayIST(l.at)}.` : "";
    const refused = got && [400, 401, 403].includes(got.status) && !got.list.length;
    if (refused) {
      said.push(`${name} refuses its key. It answered status ${got.status}${got.said ? `: "${hide(got.said)}"` : ""}.${lastly}`); urgent.push(`${name} refuses its key`);
      fix.push(`Make a new ${name} key: ${where}.`, inCloudflare(KEY));
    } else if (got && got.status === 200 && !got.list.length && !env[MODEL]) {
      said.push(`${name} lists no model the app can search with.`); soon.push(`${name} offers none of the app's models`);
      fix.push(`Find a current ${name} model that can search the web, then ${inCloudflare(MODEL).replace("In Cloudflare", "in Cloudflare").replace("paste the new value", "type its name")}`);
    } else if (l && (l.what === "no allowance" || l.what === "no credit")) {
      said.push(`${l.what === "no allowance" ? "Google gives this free key no searches" : "OpenAI has no credit on this key"}: ${count}${theirWords}. The app searches the web without it.`);
      soon.push(`${name} has no ${l.what === "no allowance" ? "free searches" : "credit"}`);
      fix.push(...NO_ALLOWANCE[id]);
    } else if (l && (l.what === "refused" || l.what === "may not search")) {
      said.push(`${name} accepts the key but refused to search.${lastly}`); soon.push(`${name} refuses to search`);
      fix.push(`In ${where.split(",")[0]}, check that the plan allows web search, or remove ${KEY} in Cloudflare.`);
    } else {
      const models = env[MODEL] ? `the setting ${MODEL}: ${env[MODEL]}` : got && got.list.length ? `models it may use: ${got.list.join(", ")}` : "";
      said.push(`${name}: ${got && got.status === 200 ? "key accepted" : "couldn't be asked just now"}${models ? `, ${models}` : ""}, ${count}.${lastly}${l && l.what === "worked" && l.model ? ` The model that answered: ${l.model}.` : ""}`);
    }
  }
  // The web with no paid allowance (opensearch.js).
  const open = rec.open && rec.open.day === kit.todayIST() ? rec.open : {};
  const keyed = [["TAVILY_API_KEY", "Tavily", "tavily"], ["SERPER_API_KEY", "Serper", "serper"]].filter(([k]) => env[k]).map(([, n, id]) => `${n} ${open[id] || 0} of ${OPEN_A_DAY[id]}`);
  said.push(env.OPEN_SEARCH === "off" && !keyed.length ? "The web without a key: switched off (OPEN_SEARCH)." :
    `The web without a key${env.OPEN_SEARCH === "off" ? " (results pages switched off)" : ""}: ${open.results || 0} results pages and ${open.pages || 0} pages read today${keyed.length ? `; ${keyed.join(", ")} searches` : ""}.`);
  // Tavily's page reader (Extract): pages it read today for the app, and whether it rests.
  if (env.TAVILY_API_KEY) {
    const x = sites.extract || {}, rests = !!(x.blocked && (x.failed || 0) > (x.ok || 0) && Date.now() < (x.until || (x.failed || 0) + 24 * 3600 * 1000));
    said.push(`Tavily's page reader: ${open.extract || 0} of ${OPEN_A_DAY.extract} pages read today${rests ? `; resting until ${dayIST(x.until || (x.failed || 0) + 24 * 3600 * 1000)}${x.why ? ` (${x.why})` : ""}` : x.ok ? `; worked on ${dayIST(x.ok)}` : ""}.`);
    if (rests) soon.push(x.used ? "Tavily's allowance is used up until tomorrow" : "Tavily's page reader rests");
  }
  // Each feature that searches: how its last search went.
  const uses = rec.uses || {};
  const perFeature = FEATURES.filter((f) => uses[f]).map((f) => {
    const u = uses[f];
    const bits = [u.who === "gemini" ? "Gemini" : u.who === "openai" ? "OpenAI" : u.who === "web" ? "the web" : u.who, u.model, u.status && `status ${u.status}`, u.why, u.said && `"${hide(u.said)}"`].filter(Boolean).join(", ");
    if (BAD_USE.has(u.what) && !soon.some((x) => x.startsWith("A search"))) soon.push("A search was refused");
    return `${FEATURE_NAMES[f]}: ${USE_SAID[u.what] || u.what} on ${dayIST(u.at)} (${bits})`;
  });
  if (perFeature.length) said.push(`Last search, by feature. ${perFeature.join("; ")}.`);
  // The last look at a work, step by step.
  const trail = (Array.isArray(rec.trails) ? rec.trails : []).filter((t) => t && t.type !== "discover" && t.type !== "echo" && t.type !== "check" && t.type !== "title").pop();
  if (trail) said.push(`Last look, for "${hide(trail.title)}" on ${dayIST(trail.at)}: ${sayTrail(trail.steps, trail.n)} In full: ${hide(stepsText(trail.steps)).slice(0, 900)}`);
  const state = urgent.length ? "attention" : soon.length ? "soon" : "ok";
  const line = (state === "ok" ? "Working. " : "") + (said.length ? said.join(" ") : "Nothing has been looked up yet.");
  return { title, state, line, brief: [...urgent, ...soon].join("; "), ...(fix.length && state !== "ok" ? { fix } : {}) };
}

// ---------------------------------------------------------------- the two groups

export const PARTS = {
  services: { ids: ["books", "tracks", "photos", "selfcheck", "lookups"],
    checks: { books: probeBooks, tracks: probeTracks, photos: probePhotos, selfcheck: probeSelfcheck, lookups: probeLookups },
    prepare: async () => {} },
  page: { ids: ["feed", "numbers", "comments", "backup", "cleaning", "errors"],
    checks: { feed: probeFeed, numbers: probeNumbers, comments: probeComments, backup: probeBackup, cleaning: probeCleaning, errors: probeErrors },
    prepare: async (env, kit, ctx) => {
      const connected = kit.igReady(env);
      [ctx.ig, ctx.posts, ctx.upkeep] = await Promise.all([
        connected ? kit.loadIg(env) : null, connected ? kit.loadDoc(env, "posts", []) : [], upkeepState(env, kit)]);
      ctx.scopes = Array.isArray(ctx.old?.scopes) ? ctx.old.scopes : [];
      ctx.igTrouble = (ctx.old?.items || []).some((i) => i.id === "instagram" && i.state === "attention");
      await readFeed(env, kit, ctx);
    } },
};
export const PROBE_IDS = [...PARTS.services.ids, ...PARTS.page.ids];
export const PROBE_TITLES = { books: "Book texts", tracks: "Music search", photos: "Photos from the search", selfcheck: "Reel maker's self-test", lookups: "Looking things up",
  feed: "Your posts on Instagram", numbers: "Post numbers", comments: "Comments", backup: "Backups", cleaning: "Tidying up", errors: "Problems noticed" };
