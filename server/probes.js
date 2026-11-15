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
    try { res = await fetch(target, { headers: { Range: "bytes=0-2047" }, signal: AbortSignal.timeout(SLOW_MS) }); }
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
  const what = latest ? ` The latest, at ${latest.where}: ${latest.what}` : "";
  if (n >= 10) {
    return { title, state: "soon", brief: `${n} problems in the last day`, line: `${n} problems in the last day.${what}`,
      fix: ["Try the part of the app the line above names. If it works, nothing more is needed: the count clears itself in a day.",
        "If it doesn't, tell Claude, in the chat where the app was built, what the line above says."] };
  }
  return { title, state: "ok", brief: "", line: `${n === 1 ? "1 problem" : `${n} problems`} in the last day, which is within the ordinary.${what}` };
}

// ---------------------------------------------------------------- the two groups

export const PARTS = {
  services: { ids: ["books", "tracks", "photos", "selfcheck"],
    checks: { books: probeBooks, tracks: probeTracks, photos: probePhotos, selfcheck: probeSelfcheck },
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
export const PROBE_TITLES = { books: "Book texts", tracks: "Music search", photos: "Photos from the search", selfcheck: "Reel maker's self-test",
  feed: "Your posts on Instagram", numbers: "Post numbers", comments: "Comments", backup: "Backups", cleaning: "Tidying up", errors: "Problems noticed" };
