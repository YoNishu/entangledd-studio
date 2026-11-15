/* Health of the app's keys and connections.

   What happens here:
   - the Instagram sign-in is renewed by the app itself, for as long as Meta allows it (a timed job);
   - once a day every key and connection is checked, and the result kept in a small record;
   - /api/health (open to anyone) reads that record and nothing else: coarse states, no names, no keys;
   - /api/checkup (signed in) gives the whole record with the steps to fix things, and can check now;
   - real use leaves notes too: a reel GitHub refused to start, Claude turning the key down.

   No key or token is ever logged, stored in the record, or sent back in an answer.

   This file is one of the app's add-on sections (see SECTIONS in worker.js).
   Handlers are called as handler(request, env, parts, kit); jobs as run(env, kit). */

import * as claudeuse from "./claudeuse.js";
import { PARTS, PROBE_IDS, PROBE_TITLES } from "./probes.js";
import { coarseText } from "./findlines.js";

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR, WEEK = 7 * DAY;
const RENEW_WHEN_DAYS_LEFT = 30;   // start asking Meta for a fresh sign-in this long before the old one ends
const WARN_DAYS = 21;              // start telling Nishith this long before anything runs out
const STALE_HOURS = 36;            // a record older than this means the timers have stopped
const TIMER_QUIET_HOURS = 30;      // the daily jobs run every 24 hours; this much silence is not normal
const NEVER = 4102444800000;       // 1 January 2100: how "no end date" is kept
const TRIES = { outside: 8000 };   // how long an outside service gets to answer, in milliseconds

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ist = (ms) => new Date(ms + 5.5 * HOUR);
export const dayIST = (ms) => { const d = ist(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const timeIST = (ms) => {
  const d = ist(ms), h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
};
const daysUntil = (ms) => Math.floor((ms - Date.now()) / DAY);
const inDays = (n) => (n <= 0 ? "today" : n === 1 ? "in 1 day" : `in ${n} days`);
const short = (text, max = 160) => String(text || "").replace(/\s+/g, " ").trim().slice(0, max);

// An outside service's own words may repeat what it was sent, a key or token included. Before any such text
// is kept, shown or logged, the values named are cut out of it, and so is anything shaped like a key:
// a long unbroken run of the letters, digits and marks that keys are made of.
export function hide(text, ...values) {
  let out = String(text ?? "");
  for (const v of values) if (v && String(v).length >= 8) out = out.split(String(v)).join("[hidden]");
  return out.replace(/[A-Za-z0-9_|%-]{24,}/g, "[hidden]");
}
// The keys the checks below send out, for hide().
const keysOf = (env) => [env.GITHUB_TOKEN, env.ANTHROPIC_API_KEY, env.PIXABAY_API_KEY, env.PEXELS_API_KEY,
  env.META_APP_SECRET, env.OPENVERSE_CLIENT_SECRET, env.RENDER_SECRET];

// Where a key is replaced in Cloudflare. The same three taps for every key.
const inCloudflare = (name) => `In Cloudflare: Workers & Pages, entangledd-studio, Settings, Variables and Secrets. Edit ${name}, paste the new value, then Deploy.`;

// ---------------------------------------------------------------- Instagram

// What the app is allowed to do on Instagram, and what stops working without each permission.
const PERMISSIONS = [
  ["instagram_basic", "reading the account", true],
  ["instagram_content_publish", "posting", true],
  ["instagram_manage_insights", "the numbers in Posts and Insights", false],
  ["instagram_manage_comments", "reading and answering comments", false],
  ["pages_show_list", "finding the Facebook Page", false],
  ["pages_read_engagement", "reading the linked Facebook Page", false],
];
export const RECONNECT = [
  "On a computer, open developers.facebook.com/tools/explorer and choose the app made for D's Studio.",
  "Tap Generate Access Token and approve the same permissions as before.",
  "Copy the token. In D's Studio open Settings, tap Connect again under Instagram, paste it and tap Connect Instagram.",
];

// Asks Meta what it knows about one token. A token Meta has dropped comes back as valid: false, not as an error.
async function debugToken(env, kit, token) {
  const out = await kit.graph(env, "GET", "/debug_token", { input_token: token, access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}` });
  const d = out.data || {};
  const valid = !!d.is_valid;
  return {
    valid,
    expires: Number(d.expires_at) > 0 ? Number(d.expires_at) * 1000 : valid ? NEVER : 0,
    dataUntil: Number(d.data_access_expires_at) > 0 ? Number(d.data_access_expires_at) * 1000 : 0,
    scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [],
    appId: String(d.app_id || ""),
    userId: String(d.user_id || ""),
  };
}
const farEnd = (ms) => (ms > 0 ? ms : NEVER);          // no date from Meta means no end

// Is a new token fit to take the place of a working one of the same kind, going by Meta's own report on each?
// Returns "" when it is, or the plain reason why not. Nothing that fails here is ever taken over.
function unfit(env, fresh, old) {
  if (!fresh.valid) return "Meta's new sign-in didn't pass Meta's own check.";
  if (fresh.appId && fresh.appId !== String(env.META_APP_ID)) return "Meta's new sign-in belongs to a different app.";
  if (fresh.userId && old.userId && fresh.userId !== old.userId) return "Meta's new sign-in is for a different person.";
  if (PERMISSIONS.some(([name]) => old.scopes.includes(name) && !fresh.scopes.includes(name))) {
    return "Meta's new sign-in has fewer permissions than the current one.";
  }
  return "";
}

// The Page token that goes with a user sign-in, for the Page the app is already connected through.
async function pageTokenFor(env, kit, ig, userToken) {
  const pages = await kit.graph(env, "GET", "/me/accounts", {
    fields: "id,access_token,instagram_business_account{id}", access_token: userToken,
  });
  const page = (pages.data || []).find((p) => String(p.id) === String(ig.pageId) && p.access_token &&
    p.instagram_business_account && String(p.instagram_business_account.id) === String(ig.igId));
  if (!page) return null;
  const info = await debugToken(env, kit, page.access_token);
  return info.valid ? { token: page.access_token, info } : null;
}

// Saves changes to the connection only if nobody has connected again in the meantime.
async function saveIfSame(env, kit, before, changes) {
  const now = await kit.loadIg(env);
  if (!now || now.userToken !== before.userToken || now.pageToken !== before.pageToken) return false;
  await kit.saveDoc(env, "instagram", { ...now, ...changes });
  return true;
}

// Once a day, when the sign-in is within a month of its end: ask Meta for a fresh one.
//
// A working connection is never thrown away. What is in use stays in use unless Meta itself reports the new
// one as valid, for the same app and the same person, with every permission the old one has, ending no
// sooner on either of its dates and more than a week later on at least one. Anything less, a refusal, or an
// answer that can't be read: nothing is changed except a plain note of why, and tomorrow it is tried again.
export async function renewInstagram(env, kit) {
  if (!kit.igReady(env)) return "off";
  const ig = await kit.loadIg(env);
  if (!ig) return "not connected";
  const now = Date.now();
  if (ig.userTokenExpires <= now) return "ended";          // an ended sign-in can't be renewed; the check says what to do
  const dataDue = ig.dataAccessUntil > 0 && ig.dataAccessUntil - now <= RENEW_WHEN_DAYS_LEFT * DAY;
  if (ig.userTokenExpires - now > RENEW_WHEN_DAYS_LEFT * DAY && !dataDue) return "not due";
  if (ig.renewTriedAt && now - ig.renewTriedAt < 20 * HOUR) return "tried today";

  const changes = {};
  let note = "";
  try {
    const got = await kit.graph(env, "GET", "/oauth/access_token", {
      grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: ig.userToken,
    });
    const token = String(got.access_token || "");
    if (!token) note = "Meta sent nothing back.";
    else {
      // Meta's own report on the new sign-in and on the one in use, side by side.
      const [fresh, old] = await Promise.all([debugToken(env, kit, token), debugToken(env, kit, ig.userToken)]);
      if (Number(got.expires_in) > 0) fresh.expires = Math.min(fresh.expires, now + Number(got.expires_in) * 1000);   // of two end dates, believe the sooner
      note = unfit(env, fresh, old);
      if (!note && old.valid) {
        const sooner = fresh.expires < old.expires - HOUR || farEnd(fresh.dataUntil) < farEnd(old.dataUntil) - HOUR;
        const later = fresh.expires > old.expires + WEEK || farEnd(fresh.dataUntil) > farEnd(old.dataUntil) + WEEK;
        if (sooner) note = "Meta's new sign-in would end sooner than the current one.";
        else if (!later) note = "Meta gave the same end date as before.";
      }
      if (!note) Object.assign(changes, { userToken: token, userTokenExpires: fresh.expires });

      // The Page token does the posting, and has no end date of its own. It is made again only when Meta's
      // 90-day clock is what is running out and the sign-in in use from here on has really moved that clock;
      // and it is taken only if, set beside the Page token in use, it passes the same checks and moves the clock too.
      const signIn = note ? { token: ig.userToken, info: old } : { token, info: fresh };
      if (dataDue && signIn.info.valid && farEnd(signIn.info.dataUntil) > ig.dataAccessUntil + WEEK) {
        const [page, oldPage] = await Promise.all([
          pageTokenFor(env, kit, ig, signIn.token).catch(() => null), debugToken(env, kit, ig.pageToken).catch(() => null)]);
        if (page && oldPage && !unfit(env, page.info, oldPage) && farEnd(page.info.dataUntil) > ig.dataAccessUntil + WEEK) {
          Object.assign(changes, { pageToken: page.token, dataAccessUntil: soonest(signIn.info.dataUntil, page.info.dataUntil) });
        }
      }
    }
  } catch (e) {
    // Couldn't reach Meta: the timer tries again in about an hour. The error itself is not passed on (the
    // timer logs whatever it is handed, and the address that was asked carries the sign-in).
    if (!(e instanceof kit.UserError)) throw new Error("Meta couldn't be reached just now");
    note = e.expired ? "Meta no longer accepts the current sign-in."
      : short(hide(e.message, ig.userToken, ig.pageToken, ...keysOf(env)));
  }
  const renewed = !!(changes.userToken || changes.pageToken);
  Object.assign(changes, { renewTriedAt: now, renewNote: renewed ? "" : note }, renewed ? { renewedAt: now } : {});
  if (!(await saveIfSame(env, kit, ig, changes))) return "connected again meanwhile";
  return renewed ? "renewed" : `kept: ${note}`;
}
const soonest = (...times) => { const real = times.filter((t) => t > 0); return real.length ? Math.min(...real) : 0; };

async function checkInstagram(env, kit, ctx) {
  const title = "Instagram";
  if (!kit.igReady(env)) {
    return { title, state: "off", line: "Posting isn't set up yet.", brief: "",
      fix: ["Add META_APP_ID and META_APP_SECRET from the Meta developer app. " + inCloudflare("each of them")] };
  }
  const ig = ctx.ig;
  if (!ig) return { title, state: "off", line: "Not connected. Connect it above to post and see your numbers.", brief: "" };

  let user, page;
  try { [user, page] = await Promise.all([debugToken(env, kit, ig.userToken), debugToken(env, kit, ig.pageToken)]); }
  catch (e) {
    // Meta turning down the question itself (not the token asked about) points at the app's own ID and secret.
    // Anything else is Meta being busy or briefly down, which is no verdict on anything.
    if (!(e instanceof kit.UserError) || ![100, 101, 102, 190].includes(e.code)) throw new Error("Meta couldn't answer just now");
    return { title, state: "attention", brief: "Meta no longer accepts the app's ID and secret",
      line: "Meta no longer accepts the app's own ID and secret, so Instagram can't be checked or renewed.",
      fix: ["On developers.facebook.com open the app, then App settings, Basic. Copy the App ID and the App secret.", inCloudflare("META_APP_ID and META_APP_SECRET"),
        "If they were right already (the Meta app itself was changed), connect Instagram again in Settings, with a token made for this app."] };
  }

  // The Page token does the posting. If Meta dropped it while the sign-in still stands, make a new one
  // (Meta's own check has just said the old one is dead, so nothing that works is replaced).
  const changes = {};
  if (!page.valid && user.valid) {
    const mended = await pageTokenFor(env, kit, ig, ig.userToken).catch(() => null);
    if (mended) { changes.pageToken = mended.token; page = mended.info; }
  }
  // Keep the stored dates true to what Meta says (they started life as an estimate).
  const dataUntil = soonest(user.valid ? user.dataUntil : 0, page.dataUntil);
  const userUntil = user.valid ? user.expires : Math.min(ig.userTokenExpires, Date.now());
  if (page.valid && (Math.abs(userUntil - ig.userTokenExpires) > HOUR || (dataUntil || 0) !== (ig.dataAccessUntil || 0))) {
    Object.assign(changes, { userTokenExpires: userUntil, dataAccessUntil: dataUntil });
  }
  // One save for both. If Instagram was connected again while this was going on, what was learned is about a
  // connection that is gone: say nothing now, and let the next check look at the new one.
  if (Object.keys(changes).length && !(await saveIfSame(env, kit, ig, changes))) throw new Error("the connection changed during the check");
  if (!page.valid) {
    return { title, state: "attention", action: "reconnect", fix: RECONNECT,
      brief: "the connection has stopped working, so posting is off",
      line: "Instagram has stopped accepting the app's connection. Posting and numbers are off until it is connected again." };
  }

  // Permissions: one that was there before and is gone now is a real loss; one never given is only mentioned.
  const scopes = [...new Set([...page.scopes, ...user.scopes])];
  ctx.seenScopes = [...new Set([...(ctx.old?.seenScopes || []), ...scopes])];
  ctx.scopes = scopes;                                   // what the connection may do today (the probes read this)
  const missing = scopes.length ? PERMISSIONS.filter(([name]) => !scopes.includes(name)) : [];
  const lost = missing.filter(([name, , vital]) => vital || (ctx.old?.seenScopes || []).includes(name));
  if (lost.length) {
    const what = lost.map(([, does]) => does).join(" and ");
    return { title, state: "attention", action: "reconnect", brief: "a permission is missing",
      line: `Instagram is connected, but the permission for ${what} is missing, so that part doesn't work.`,
      fix: [RECONNECT[0], `Tap Generate Access Token and tick every permission, including ${lost.map(([name]) => name).join(", ")}.`, RECONNECT[2]] };
  }
  const without = missing.length ? ` Not switched on: ${missing.map(([, does]) => does).join(", ")}.` : "";
  const who = ig.username ? `Connected as @${ig.username}.` : "Connected.";

  const dataDays = dataUntil ? daysUntil(dataUntil) : null;
  if (dataDays !== null && dataDays <= WARN_DAYS) {
    return { title, state: dataDays <= 0 ? "attention" : "soon", daysLeft: Math.max(dataDays, 0), action: "reconnect", fix: RECONNECT,
      brief: dataDays <= 0 ? "Meta wants a fresh sign-in now" : `Meta wants a fresh sign-in ${inDays(dataDays)}`,
      line: dataDays <= 0
        ? "Meta wants a fresh sign-in before the app may go on using Instagram, so posting and numbers may stop. Connect Instagram again."
        : `Meta wants a fresh sign-in by ${dayIST(dataUntil)} (${inDays(dataDays)}). After that, posting and numbers may stop until Instagram is connected again.` };
  }
  if (!user.valid || userUntil <= Date.now()) {
    return { title, state: "soon", daysLeft: 0, action: "reconnect", fix: RECONNECT,
      brief: "the music search has stopped (posting still works)",
      line: `${who} Posting and numbers work. Instagram's music search has stopped until Instagram is connected again.${without}` };
  }
  if (userUntil >= NEVER) return { title, state: "ok", brief: "", line: `${who} The sign-in has no end date.${without}` };
  const days = daysUntil(userUntil);
  if (days <= WARN_DAYS) {
    const why = ig.renewNote ? ` The app tried to renew it itself: ${ig.renewNote}` : "";
    return { title, state: "soon", daysLeft: Math.max(days, 0), action: "reconnect", fix: RECONNECT,
      brief: `the music search stops ${inDays(days)} unless Instagram is connected again (posting keeps working)`,
      line: `${who} Instagram's music search stops on ${dayIST(userUntil)} (${inDays(days)}) unless Instagram is connected again. Posting keeps working.${why}${without}` };
  }
  const renews = ig.renewedAt
    ? `The app renewed the sign-in by itself on ${dayIST(ig.renewedAt)}; it is good until ${dayIST(userUntil)}.`
    : `Instagram's music search is good until ${dayIST(userUntil)}; the app will try to renew it by itself before then.`;
  return { title, state: "ok", daysLeft: days, brief: "", line: `${who} ${renews}${without}` };
}

// ---------------------------------------------------------------- the reel maker (GitHub)

const NEW_GITHUB_KEY = (env) => [
  "On github.com: your photo, Settings, Developer settings, Personal access tokens. Open the token made for D's Studio (under Fine-grained tokens, or under Tokens (classic)).",
  `Tap Regenerate token and, for Expiration, choose No expiration, so this never comes back. (If you make a new one instead: give it the repository ${env.GITHUB_REPO} and the permission Actions: Read and write.)`,
  "Copy the token. " + inCloudflare("GITHUB_TOKEN"),
];
// GitHub writes the end date like "2027-02-03 10:20:30 UTC" (or with "+0000").
function githubDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?/.exec(String(text || "").trim());
  if (!m) return 0;
  const zone = !m[7] || m[7] === "UTC" || m[7] === "Z" ? "Z" : m[7].length === 5 ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : m[7];
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`);
  return Number.isFinite(ms) ? ms : 0;
}

async function checkGithub(env, kit, ctx) {
  const title = "Reel maker's key";
  if (!kit.reelsReady(env)) return { title, state: "off", line: "Reels aren't set up yet.", brief: "" };
  const api = env.GITHUB_API || "https://api.github.com";
  const res = await fetch(`${api}/repos/${env.GITHUB_REPO}/actions/workflows/render-job.yml`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "entangledd-studio" },
    signal: AbortSignal.timeout(TRIES.outside),
  });
  if (res.status === 401) {
    return { title, state: "attention", fix: NEW_GITHUB_KEY(env), brief: "GitHub no longer accepts the key that starts reels",
      line: "GitHub no longer accepts the key that starts the reel maker (it has run out or was removed), so reels can't be made." };
  }
  if (res.status === 404) {
    return { title, state: "attention", fix: NEW_GITHUB_KEY(env), brief: "the key can't see the reel maker on GitHub",
      line: "The key can't see the reel maker on GitHub: it was made for a different repository, or the repository was renamed." };
  }
  // (403 is also how GitHub says "slow down": those answers carry a count of zero or a time to wait, and are no verdict.)
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") !== "0" && !res.headers.get("retry-after")) {
    return { title, state: "attention", fix: NEW_GITHUB_KEY(env), brief: "the key isn't allowed to use the reel maker",
      line: "GitHub says the key isn't allowed to use the reel maker. It needs the permission Actions: Read and write." };
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);          // busy or briefly down: not a verdict on the key
  let flow = {};
  try { flow = await res.json(); } catch (e) { /* the status was enough */ }
  if (flow.state && flow.state !== "active") {
    return { title, state: "attention", brief: "the reel maker is switched off on GitHub",
      line: "The reel maker is switched off on GitHub, so reels can't be made.",
      fix: [`On github.com open ${env.GITHUB_REPO}, then Actions, Render job, and tap Enable workflow.`] };
  }
  // The last real try to start a reel is the only proof that the key may start one.
  const reel = ctx.notes.reel || {};
  if (reel.refusedAt && reel.refusedAt > (reel.startedAt || 0)) {
    return { title, state: "attention", fix: NEW_GITHUB_KEY(env), brief: "GitHub refused to start the last reel",
      line: `GitHub refused to start a reel on ${dayIST(reel.refusedAt)} (status ${Number(reel.refusedStatus) || 0}). The key most likely lacks the permission Actions: Read and write.` };
  }
  const ends = githubDate(res.headers.get("github-authentication-token-expiration"));
  if (!ends) return { title, state: "ok", brief: "", line: "The key that starts the reel maker is working and has no end date." };
  const days = daysUntil(ends);
  if (days <= WARN_DAYS) {
    return { title, state: "soon", daysLeft: Math.max(days, 0), fix: NEW_GITHUB_KEY(env),
      brief: `the key that starts reels runs out ${inDays(days)}`,
      line: `The key that starts the reel maker runs out on ${dayIST(ends)} (${inDays(days)}). After that, reels can't be made until it is replaced.` };
  }
  return { title, state: "ok", daysLeft: days, brief: "", line: `The key that starts the reel maker is working, and good until ${dayIST(ends)}.` };
}

function checkReels(env, kit, ctx) {
  const title = "Reel maker";
  if (!kit.reelsReady(env)) return { title, state: "off", line: "Reels aren't set up yet.", brief: "" };
  const r = ctx.notes.reel || {};
  const settled = Math.max(r.okAt || 0, r.failAt || 0);
  const SEE = ["Try once more, with a different background.",
    `If it fails again: on github.com open ${env.GITHUB_REPO}, then Actions, and the newest Render job. The step marked red says what went wrong.`,
    "Tell Claude, in the chat where the app was built, what that step says."];
  if (r.startedAt && r.startedAt > settled && Date.now() - r.startedAt > 20 * 60 * 1000) {
    return { title, state: "attention", fix: SEE, brief: "the last reel never came back",
      line: `A reel was started on ${dayIST(r.startedAt)} at ${timeIST(r.startedAt)} and never came back.` };
  }
  if ((r.fails || 0) >= 2) {
    return { title, state: "attention", fix: SEE, brief: `the last ${r.fails} reels didn't finish`,
      line: `The last ${r.fails} reels didn't finish. ${short(r.why, 140)}` };
  }
  if (r.fails === 1) {
    return { title, state: "ok", brief: "",
      line: `The last reel didn't finish (${short(r.why, 100) || "no reason given"}). One miss can be the background; two in a row will be flagged.` };
  }
  if (r.okAt) return { title, state: "ok", brief: "", line: `Working. The last reel was made on ${dayIST(r.okAt)}.` };
  return { title, state: "ok", brief: "", line: "Ready. No reel has been made since this check began." };
}

// ---------------------------------------------------------------- Nishiii (Claude)

// The day's questions against the day's limit, the model in use, and whether the app has had to move to a
// newer model by itself (see claudeuse.js). Added to whatever the check of the key found.
function withUse(got, use) {
  if (got.state !== "ok") return got;
  const LIMIT = ["If that was real, heavy use: in Cloudflare (Workers & Pages, entangledd-studio, Settings, Variables and Secrets) add CLAUDE_DAILY_CAP with a higher number, then Deploy.",
    "If the app wasn't used that much, something is asking in a loop. Tell Claude, in the chat where the app was built: \"Nishiii reached the daily limit without being used much.\""];
  if (use.capHitToday || use.capHitYesterday) {
    return { ...got, state: "soon", fix: LIMIT, brief: `Nishiii reached the day's limit of ${use.cap} questions`,
      line: `Nishiii reached the day's limit of ${use.cap} questions ${use.capHitToday ? "today" : "yesterday"} and stopped answering until midnight.` };
  }
  const moved = use.moved ? ` The app moved Nishiii to ${short(use.moved.name || use.moved.id, 60)} by itself on ${dayIST(use.moved.since)}, when the earlier Claude model was retired.` : "";
  return { ...got, line: `${got.line}${moved} ${use.yesterday} questions yesterday, ${use.today} so far today; the limit is ${use.cap} a day.` };
}

async function checkNishiii(env, kit, ctx) {
  if (!env.ANTHROPIC_API_KEY) return { title: "Nishiii", state: "off", line: "Nishiii isn't switched on yet.", brief: "" };
  ctx.use = await claudeuse.usage(env, kit, kit.CLAUDE_MODEL);
  const got = await checkNishiiiKey(env, kit, ctx, ctx.use.model);
  // If the check put a question to Claude, look again: that question may have moved the model on.
  // (No storage read this time: the question just asked left the newest state with this running copy.)
  if (ctx.askedClaude) ctx.use = await claudeuse.usage(env, kit, kit.CLAUDE_MODEL, false);
  return withUse(got, ctx.use);
}

async function checkNishiiiKey(env, kit, ctx, modelInUse) {
  const title = "Nishiii";
  const NEW_KEY = ["On platform.claude.com (the Claude Console) open Settings, API keys, tap Create key and copy it.", inCloudflare("ANTHROPIC_API_KEY")];
  const NEW_MODEL = ["The app looks for the newest Claude Sonnet by itself when its model is retired, and found none it could use.",
    "Open the Claude chat where the app was built and say: \"Nishiii's Claude model was retired and the app couldn't move to a new one by itself.\""];
  const GONE = { title, state: "attention", fix: NEW_MODEL, brief: "the Claude model Nishiii runs on has been retired, and the app couldn't move to a newer one",
    line: "The Claude model Nishiii runs on is no longer offered, and the app couldn't move to a newer one by itself, so suggestions, rewording and chat are off." };
  // One very small real question. It is the only proof that Nishiii can answer, and asking it is also what
  // moves the app to a newer model when the old one has gone (see claudeRaw in worker.js).
  const ask = () => { ctx.askedClaude = true; return kit.claudeRaw(env, { system: "Answer with the single word OK.", messages: [{ role: "user", content: "OK?" }], maxTokens: 5 }); };
  const base = env.ANTHROPIC_API || "https://api.anthropic.com";
  const res = await fetch(`${base}/v1/models/${modelInUse}`, {
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(TRIES.outside),
  });
  if (res.status === 401 || res.status === 403) {
    return { title, state: "attention", fix: NEW_KEY, brief: "Anthropic no longer accepts Nishiii's key",
      line: "Anthropic no longer accepts Nishiii's key, so suggestions, rewording and chat are off." };
  }
  let model = {};
  if (res.ok) { try { model = await res.json(); } catch (e) { /* the status was enough */ } }
  else if (res.status !== 404) throw new Error(`Anthropic answered ${res.status}`);
  // Anthropic says ahead of time when a model will be withdrawn: "lifecycle" stops being "active" and "retires_at"
  // gives the day. Whatever word it uses for a model on its way out, the day is what counts.
  const leaving = typeof model.lifecycle === "string" && model.lifecycle !== "" && model.lifecycle !== "active";
  const retires = Date.parse(model.retires_at || "");
  if (res.status === 404 || model.lifecycle === "retired" || (leaving && retires <= Date.now())) {
    // The model has gone. Ask once: that moves the app to the newest Sonnet, or shows that it can't.
    claudeTrouble = false; claudeLooked = Date.now();
    try { await ask(); ctx.clearClaude = true; }
    catch (e) {
      claudeTrouble = true;
      if (!(e instanceof kit.UserError)) throw e;
      return GONE;
    }
    return { title, state: "ok", brief: "", line: "Nishiii's key is working." };
  }

  // What real use last showed. A key that passed just now clears an old "key refused" note by itself;
  // being out of credit only shows on a real question, so one very small one is asked to see if it has passed.
  let trouble = ctx.notes.claude || null;
  if (trouble && trouble.kind !== "credit") { trouble = null; ctx.clearClaude = true; }
  if (trouble) {
    claudeTrouble = false; claudeLooked = Date.now();      // a good answer is noted once, below, not twice
    try {
      await ask();
      trouble = null; ctx.clearClaude = true;
    } catch (e) {
      claudeTrouble = true;                                // still on record: the next good answer in real use clears it
      if (!(e instanceof kit.UserError)) throw e;
    }
  }
  if (trouble) {
    return { title, state: "attention", brief: "Nishiii's Anthropic account is out of credit",
      line: `Nishiii's Anthropic account ran out of credit on ${dayIST(trouble.at)}, so suggestions, rewording and chat are off.`,
      fix: ["On platform.claude.com (the Claude Console) open Settings, Billing, and add credit.",
        "On the same page tap Set up auto-reload, so it tops itself up and this never comes back."] };
  }
  if (retires > Date.now() || leaving) {
    // A model on its way out needs nobody: on the day it goes, the app moves to the newest Sonnet by itself.
    const when = retires > Date.now() ? ` on ${dayIST(retires)} (${inDays(daysUntil(retires))})` : " before long";
    return { title, state: "ok", brief: "", ...(retires > Date.now() ? { daysLeft: daysUntil(retires) } : {}),
      line: `Working. The Claude model Nishiii runs on will be retired${when}; the app will move to the newest one by itself then.` };
  }
  return { title, state: "ok", brief: "", line: "Nishiii's key is working." };
}

// ---------------------------------------------------------------- backgrounds and music

async function checkBackgrounds(env, kit) {
  const title = "Background search";
  const who = kit.stockProvider(env);
  if (!who) return { title, state: "off", line: "Searching for backgrounds isn't set up. Your own photos and videos work.", brief: "" };
  const res = who === "pixabay"
    ? await fetch(`${env.PIXABAY_API || "https://pixabay.com"}/api/?key=${encodeURIComponent(env.PIXABAY_API_KEY)}&q=sea&per_page=3&safesearch=true`,
        { signal: AbortSignal.timeout(TRIES.outside) })
    : await fetch(`${env.PEXELS_API || "https://api.pexels.com"}/v1/search?query=sea&per_page=1`,
        { headers: { Authorization: env.PEXELS_API_KEY }, signal: AbortSignal.timeout(TRIES.outside) });
  const name = who === "pixabay" ? "Pixabay" : "Pexels";
  if ([400, 401, 403].includes(res.status)) {
    return { title, state: "attention", brief: `${name} no longer accepts the key for background search`,
      line: `${name} no longer accepts the key, so searching for backgrounds is off. Your own photos and videos still work.`,
      fix: who === "pixabay"
        ? ["Log in at pixabay.com and open pixabay.com/api/docs. Your key is shown there, under Parameters.", inCloudflare("PIXABAY_API_KEY")]
        : ["Log in at pexels.com/api and copy your key.", inCloudflare("PEXELS_API_KEY")] };
  }
  if (res.status === 429) return { title, state: "ok", brief: "", line: "Working (busy this minute: many searches in a short time)." };
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  return { title, state: "ok", brief: "", line: "Working." };
}

async function checkMusic(env) {
  const title = "Free music";
  if (!env.OPENVERSE_CLIENT_ID || !env.OPENVERSE_CLIENT_SECRET) {
    return { title, state: "ok", brief: "", line: "Working on the free allowance: a few new searches an hour. Searches you've made stay ready for a week." };
  }
  const res = await fetch(`${env.OPENVERSE_API || "https://api.openverse.org"}/v1/auth_tokens/token/`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(TRIES.outside),
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.OPENVERSE_CLIENT_ID, client_secret: env.OPENVERSE_CLIENT_SECRET }),
  });
  if ([400, 401, 403].includes(res.status)) {
    return { title, state: "soon", brief: "the free music library refuses the app's registered key",
      line: "The free music library refuses the app's registered key, so only a few new searches an hour are possible.",
      fix: ["Register again with the music library (Openverse) and copy the new client ID and secret.", inCloudflare("OPENVERSE_CLIENT_ID and OPENVERSE_CLIENT_SECRET")] };
  }
  if (!res.ok) throw new Error(`Openverse answered ${res.status}`);
  return { title, state: "ok", brief: "", line: "Working, with the app's registered key." };
}

// ---------------------------------------------------------------- the timers

function checkTimers(env, kit, ctx) {
  const title = "Daily routines";
  const TIMERS = ["In Cloudflare: Workers & Pages, entangledd-studio, Settings, Trigger Events. Two Cron Triggers should be listed.",
    "If they are missing or stay silent, open Deployments and deploy the newest version again (or push any small change to GitHub)."];
  const last = Math.max(0, ...Object.values(ctx.stamps || {}).map(Number).filter(Number.isFinite));
  if (!ctx.fromTimer) {
    if (!last) {
      // Nothing has ever run. For a few minutes after an update that is normal; an hour later it is not.
      const since = (ctx.old?.items || []).find((i) => i.id === "timers")?.unknownSince || 0;
      if (since && Date.now() - since > HOUR) {
        return { title, state: "attention", fix: TIMERS, keepSince: true, brief: "the app's timers have never run",
          line: "The app's timers haven't run at all since the app was updated, so nothing is refreshed or renewed in the background." };
      }
      return { title, state: "unknown", brief: "", line: "The timers haven't run yet since the app was updated. They start within five minutes." };
    }
    if (Date.now() - last > TIMER_QUIET_HOURS * HOUR) {
      return { title, state: "attention", fix: TIMERS, brief: "the app's timers have stopped",
        line: `The app's timers haven't run since ${dayIST(last)}, so nothing is refreshed or renewed in the background.` };
    }
  }
  // 6 am in India is when the day's quotes are prepared. Looked at only once that hour is well past.
  const hourIST = ist(Date.now()).getUTCHours() + ist(Date.now()).getUTCMinutes() / 60;
  const morningDue = hourIST >= 6.75 && !!env.ANTHROPIC_API_KEY;
  if (morningDue && !ctx.todayReady) {
    ctx.missedMornings = (ctx.old?.missedDay === kit.todayIST() ? (ctx.old?.missedMornings || 1) : (ctx.old?.missedMornings || 0) + 1);
    ctx.missedDay = kit.todayIST();
    if (ctx.missedMornings >= 2) {
      return { title, state: "soon", fix: TIMERS, brief: "the morning's quotes weren't prepared two days running",
        line: `The day's quotes weren't prepared at 6 am for ${ctx.missedMornings} days running. They are still made when you open Today, only a little slower.` };
    }
    return { title, state: "ok", brief: "", line: "Running. Today's quotes weren't prepared at 6 am; they are made when you open Today instead." };
  }
  if (morningDue) ctx.missedMornings = 0;
  else { ctx.missedMornings = ctx.old?.missedMornings || 0; ctx.missedDay = ctx.old?.missedDay || ""; }
  return { title, state: "ok", brief: "", line: morningDue ? "Running. This morning's quotes were ready on time." : "Running." };
}

// ---------------------------------------------------------------- the whole check

const ORDER = ["instagram", "github", "reels", "nishiii", "backgrounds", "music", "timers"];
const ALL_IDS = [...ORDER, ...PROBE_IDS];           // the daily check's lines, then the probes' (see probes.js)

// Reads one of this section's own two documents. If it can't be read or isn't what it should be, the answer
// is the fallback, as if it had never been written.
async function readOwn(env, kit, name, fallback) {
  try {
    const doc = await kit.loadDoc(env, name, fallback);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : fallback;
  } catch (e) {
    console.error(`the ${name} record couldn't be read`, hide(e && e.message));
    return fallback;
  }
}

// Runs every check. Each one stands alone: one that can't be reached doesn't stop the others,
// and the record is saved with whatever was learned.
export async function checkAll(env, kit, { fromTimer = false } = {}) {
  const now = Date.now();
  // A record of its own that can't be read must not stop the checks for good: the check starts again from nothing.
  const [old, notes, stamps, ig, today] = await Promise.all([
    readOwn(env, kit, "health", null), readOwn(env, kit, "healthnotes", {}),
    fromTimer ? {} : kit.loadDoc(env, "jobstamps", {}),      // a check the timer itself makes needs no proof that the timer runs
    kit.igReady(env) ? kit.loadIg(env) : null,
    env.MEDIA.head(`data/suggestions/${kit.todayIST()}.json`),
  ]);
  sane(old);
  const ctx = { old, notes, stamps, ig, fromTimer, todayReady: !!today };
  const checks = { instagram: checkInstagram, github: checkGithub, reels: checkReels, nishiii: checkNishiii,
    backgrounds: checkBackgrounds, music: checkMusic, timers: checkTimers };
  const items = await Promise.all(ORDER.map((id) => oneCheck(id, checks[id], env, kit, ctx, old, now)));
  // The probes' lines (see probes.js) are kept as they are; their own jobs renew them.
  const probed = old?.probed && typeof old.probed === "object" ? old.probed : {};
  const firstAt = Number(old?.firstAt) || now;
  const record = { asOf: now, items: [...items, ...(old?.items || []).filter((i) => PROBE_IDS.includes(i.id))],
    seenScopes: ctx.seenScopes || old?.seenScopes || [], scopes: ctx.scopes || old?.scopes || [],
    missedMornings: ctx.missedMornings || 0, missedDay: ctx.missedDay || "",
    probed, firstAt, errorsLastDay: Number(old?.errorsLastDay) || 0,
    // A group of probes that hasn't run for three days has stopped: said plainly in the open answer.
    quiet: Object.keys(PARTS).filter((part) => now - (Number(probed[part]) || firstAt) > 3 * DAY),
    use: ctx.use ? { today: ctx.use.today, yesterday: ctx.use.yesterday, cap: ctx.use.cap, movedAt: ctx.use.moved ? ctx.use.moved.since : 0 } : old?.use || null };
  await kit.saveDoc(env, "health", record);
  if (ctx.clearClaude && notes.claude) {
    const latest = await readOwn(env, kit, "healthnotes", {});
    delete latest.claude;
    await kit.saveDoc(env, "healthnotes", latest);
    claudeTrouble = false; claudeLooked = now;
  }
  return record;
}
const titleOf = (id) => ({ instagram: "Instagram", github: "Reel maker's key", reels: "Reel maker", nishiii: "Nishiii",
  backgrounds: "Background search", music: "Free music", timers: "Daily routines", ...PROBE_TITLES })[id] || id;

// Runs one check and turns its answer into a line of the record.
async function oneCheck(id, check, env, kit, ctx, old, now) {
  const before = (old?.items || []).find((i) => i.id === id);
  try {
    const got = await check(env, kit, ctx);
    const item = { id, title: got.title, state: got.state, line: got.line, brief: got.brief || "", checked: now };
    if (got.fix && got.state !== "ok") item.fix = got.fix;
    if (Number.isFinite(got.daysLeft)) item.daysLeft = got.daysLeft;
    if (got.action && got.state !== "ok") item.action = got.action;
    if (got.state === "unknown" || got.keepSince) item.unknownSince = before?.unknownSince || now;
    return item;
  } catch (e) {
    // The check itself couldn't be made (a service was down or slow). Keep what was known, say so,
    // and only raise it if it stays that way for three days.
    console.error(`health check "${id}" couldn't run`, hide(e && e.message, ...keysOf(env)));
    const since = before?.unknownSince || now;
    const base = before && before.state !== "unknown" ? before : { id, title: titleOf(id), state: "unknown", brief: "", checked: 0 };
    if (now - since > 3 * DAY) {
      return { id, title: base.title, state: "attention", unknownSince: since, checked: base.checked || 0,
        brief: "one check hasn't been possible for three days", line: `This couldn't be checked since ${dayIST(since)}.` };
    }
    return { ...base, unknownSince: since, line: before && before.state !== "unknown" ? before.line : "This couldn't be checked just now. It is tried again tomorrow." };
  }
}

// Whatever shape a stored record is in, the checks get lists to read.
function sane(old) {
  if (!old) return old;
  old.items = (Array.isArray(old.items) ? old.items : []).filter((i) => i && typeof i === "object");
  old.seenScopes = (Array.isArray(old.seenScopes) ? old.seenScopes : []).map(String);
  old.scopes = (Array.isArray(old.scopes) ? old.scopes : []).map(String);
  old.missedMornings = Number(old.missedMornings) || 0;
  old.missedDay = typeof old.missedDay === "string" ? old.missedDay : "";
  return old;
}

// One group of probes (see probes.js), merged into the record the daily check keeps.
export async function probe(env, kit, part) {
  const group = PARTS[part];
  const now = Date.now();
  const ctx = { old: sane(await readOwn(env, kit, "health", null)) };
  await group.prepare(env, kit, ctx);
  const items = await Promise.all(group.ids.map((id) => oneCheck(id, group.checks[id], env, kit, ctx, ctx.old, now)));
  // Read once more just before saving, so a daily check that finished meanwhile isn't undone.
  const latest = sane(await readOwn(env, kit, "health", null)) || { asOf: 0, items: [], firstAt: now };
  const record = { ...latest, items: [...latest.items.filter((i) => !group.ids.includes(i.id)), ...items],
    probed: { ...(latest.probed || {}), [part]: now }, quiet: (latest.quiet || []).filter((x) => x !== part) };
  if (ctx.errorsLastDay !== undefined) record.errorsLastDay = ctx.errorsLastDay;
  await kit.saveDoc(env, "health", record);
  return record;
}

// ---------------------------------------------------------------- what real use shows

// What this running copy of the server knows about Claude trouble on record: null = hasn't looked.
let claudeTrouble = null, claudeLooked = 0;

// Called from worker.js when real use shows something: a reel started, refused, done or failed, and Claude
// answering or turning the key down. It never throws, and a normal Claude answer costs nothing here:
// storage is read at most once every six hours per running copy, and written only when something changes.
export async function saw(env, kit, what, detail = {}) {
  try {
    if (!env.MEDIA) return;
    const now = Date.now();
    if (what === "claude-ok" && claudeTrouble === false && now - claudeLooked < 6 * HOUR) return;
    const notes = await readOwn(env, kit, "healthnotes", {});
    const reel = notes.reel || {};
    let changed = true;
    if (what === "claude-ok") { changed = !!notes.claude; delete notes.claude; claudeTrouble = false; claudeLooked = now; }
    else if (what === "claude-fail") {
      changed = !notes.claude || notes.claude.kind !== detail.kind;
      if (changed) notes.claude = { kind: detail.kind, at: now };
      claudeTrouble = true;
    }
    else if (what === "reel-started") notes.reel = { ...reel, startedAt: now };
    else if (what === "reel-refused") notes.reel = { ...reel, refusedAt: now, refusedStatus: Number(detail.status) || 0 };
    else if (what === "reel-done") notes.reel = { ...reel, okAt: now, fails: 0, why: "" };
    else if (what === "reel-failed") notes.reel = { ...reel, failAt: now, fails: (reel.fails || 0) + 1, why: short(hide(detail.why, ...keysOf(env)), 200) };
    else changed = false;
    if (changed) await kit.saveDoc(env, "healthnotes", notes);
  } catch (e) { console.error("health note failed", e && e.message); }
}

// ---------------------------------------------------------------- the two addresses

const STATES = ["ok", "soon", "attention", "off", "unknown"];
const needsHim = (item) => item.state === "attention" || item.state === "soon";

// What anyone may see: states and day counts, a sentence built from fixed phrases. Nothing else:
// no names, no ids, no steps, none of an outside service's own words.
function openView(record) {
  const head = { app: "D's Studio" };
  if (!record || !(record.asOf > 0) || !Array.isArray(record.items)) {
    return { ...head, needsAttention: true, asOf: null, ageHours: null, items: [],
      message: "No check has run yet. The first one runs within ten minutes of the app being updated. If this is still the answer after that, the app's timers are not running." };
  }
  const ageHours = Math.max(0, Math.round((Date.now() - record.asOf) / HOUR));
  const stale = ageHours > STALE_HOURS;
  // Every line the record should have, in a fixed order; one not looked at yet is shown as "unknown".
  const items = ALL_IDS.map((id) => record.items.find((i) => i && i.id === id) || { id, state: "unknown" });
  const need = items.filter(needsHim);
  const parts = need.map((i) => `${titleOf(i.id)}: ${i.brief || (i.state === "soon" ? "needs attention soon" : "needs attention")}`);
  // The checks of the outside services run on their own timers; if those go quiet, that is said too.
  const quiet = (Array.isArray(record.quiet) ? record.quiet : []).filter((x) => Object.hasOwn(PARTS, x)).length > 0;
  if (quiet) parts.push("The checks of the outside services and of the app's own housekeeping haven't run for three days");
  const count = need.length + (quiet ? 1 : 0);
  let message = count
    ? `${count === 1 ? "1 thing needs" : `${count} things need`} attention. ${parts.join(". ")}.`
    : "Everything is working.";
  const ago = ageHours < 48 ? `${ageHours} hours ago` : `${Math.floor(ageHours / 24)} days ago`;
  if (stale) message = `The daily check last ran ${ago}, so the app's timers may have stopped. ${count ? message : "What follows is the last known state."}`;
  const use = record.use && typeof record.use === "object" ? record.use : null;
  const whole = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : null);
  return {
    ...head, needsAttention: stale || count > 0, message, asOf: new Date(record.asOf).toISOString(), ageHours,
    // Plain counts, so that a climbing number is seen before it becomes a problem.
    counts: { questionsYesterday: use ? whole(use.yesterday) : null, questionsDailyLimit: use ? whole(use.cap) : null, problemsLastDay: whole(record.errorsLastDay) },
    notes: use && use.movedAt > 0 ? [`Nishiii moved to a newer Claude model by itself on ${dayIST(Number(use.movedAt))}.`] : [],
    items: items.map((i) => ({ id: i.id, state: STATES.includes(i.state) ? i.state : "unknown", daysLeft: Number.isFinite(i.daysLeft) ? i.daysLeft : null,
      checked: Number.isFinite(i.checked) && i.checked > 0 ? new Date(i.checked).toISOString() : null })),
  };
}

// What she and Nishith see in Settings: everything, with the steps.
function fullView(record) {
  if (!record || !Number.isFinite(record.asOf) || !Array.isArray(record.items)) return { asOf: 0, items: [], summary: "Not checked yet." };
  const items = ALL_IDS.map((id) => record.items.find((i) => i && i.id === id)).filter(Boolean);
  const need = items.filter(needsHim).length;
  return { asOf: record.asOf, summary: need ? `${need === 1 ? "1 thing needs" : `${need} things need`} Nishith.` : "Everything is working.",
    items: items.map(({ unknownSince, brief, ...rest }) => rest) };
}

export const open = {
  // GET /api/health: reads the stored record only. It never calls an outside service, so it can't be used
  // to burn the app's allowances, however often it is asked.
  health: async (request, env, parts, kit) => {
    if (request.method !== "GET" || parts.length !== 1) return kit.fail(404, "Not found.");
    const record = env.MEDIA ? await readOwn(env, kit, "health", null) : null;
    // The last look for quotes from a work, coarse: what each step did and its counts, no title, no line.
    const looks = env.MEDIA ? await kit.loadDoc(env, "lookups", null).catch(() => null) : null;
    const c = looks && looks.coarse;
    const lastLookup = c && c.at ? { at: c.at, identified: !!c.identified, kind: c.kind || "", year: c.year || 0, kept: c.kept || 0, said: coarseText(c).slice(0, 900) } : null;
    return new Response(JSON.stringify({ ...openView(record), lastLookup }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  },
};

export const routes = {
  // GET /api/checkup: the full record.  POST /api/checkup: check now (at most once a minute).
  checkup: async (request, env, parts, kit) => {
    if (parts.length !== 1) return kit.fail(404, "Not found.");
    if (request.method === "GET") return kit.json(fullView(await readOwn(env, kit, "health", null)));
    if (request.method !== "POST") return kit.fail(404, "Not found.");
    const old = await readOwn(env, kit, "health", null);
    // POST /api/checkup?part=services or ?part=page: one group of probes, now (each at most once a minute).
    const part = new URL(request.url).searchParams.get("part");
    if (part) {
      if (!Object.hasOwn(PARTS, part)) return kit.fail(404, "Not found.");
      if (old && Date.now() - (Number(old.probed?.[part]) || 0) < 60 * 1000) return kit.fail(429, "Checked a moment ago. Try again in a minute.");
      return kit.json(fullView(await probe(env, kit, part)));
    }
    if (old && Date.now() - old.asOf < 60 * 1000) return kit.fail(429, "Checked a moment ago. Try again in a minute.");
    await renewInstagram(env, kit).catch((e) => console.error("renewing Instagram failed", e && e.message));
    return kit.json(fullView(await checkAll(env, kit)));
  },
};

// The renewal goes first, so that the check five minutes later reports what it achieved.
export const jobs = [
  { name: "instagram-renew", everyHours: 24, run: (env, kit) => renewInstagram(env, kit) },
  { name: "health-check", everyHours: 24, run: (env, kit) => checkAll(env, kit, { fromTimer: true }) },
];
// (The probes of probes.js run as two more timed jobs, listed in upkeep.js after the cleaning and the
// backup, so that their first report already includes those.)
