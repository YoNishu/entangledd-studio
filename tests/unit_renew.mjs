// The renewal of the Instagram sign-in, tested straight against the section's code with a scripted Meta.
// The rule under test: what is in use is never replaced unless Meta itself reports the new one as valid, for the
// same app and person, with every permission, ending no sooner and really later; and nothing key-shaped is kept.
//   node tests/unit_renew.mjs
import { renewInstagram, hide } from "../server/health.js";

const DAY = 86400000, HOUR = 3600000;
const ALL = ["instagram_basic", "instagram_content_publish", "instagram_manage_insights", "instagram_manage_comments", "pages_show_list", "pages_read_engagement", "public_profile"];
class UserError extends Error {}
const now = Date.now();
const at = (days) => (days === null ? 0 : Math.floor((now + days * DAY) / 1000));     // Meta counts in seconds; 0 = no date
const tok = (days, more = {}) => ({ is_valid: true, app_id: "app", user_id: "1001", expires_at: at(days), data_access_expires_at: 0, scopes: ALL, ...more });

// A pretend Meta and a pretend store. "tokens" is what debug_token says about each token; "pages" what /me/accounts lists for each sign-in.
function world({ ig = {}, second, exchange, tokens = {}, pages = {} }) {
  const first = { igId: "17890", pageId: "111", username: "theentangledd", userToken: "OLD-USER", pageToken: "OLD-PAGE", userTokenExpires: now + 20 * DAY, ...ig };
  let loads = 0; const saves = [], calls = [];
  const kit = {
    UserError, igReady: () => true,
    loadIg: async () => { calls.push("load"); return ++loads === 1 ? first : second === undefined ? first : second; },
    saveDoc: async (env, name, doc) => { calls.push("save"); saves.push([name, doc]); },
    graph: async (env, method, path, params) => {
      calls.push(path);
      if (path === "/oauth/access_token") return exchange(params);
      if (path === "/debug_token") return { data: tokens[params.input_token] || { is_valid: false, scopes: [] } };
      if (path === "/me/accounts") return { data: pages[params.access_token] || [] };
      throw new Error("unexpected call " + path);
    },
  };
  return { kit, saves, calls, first, graphCalls: () => calls.filter((c) => c.startsWith("/")).length };
}
const env = { META_APP_ID: "app", META_APP_SECRET: "app-secret-0123456789abcdef0123" };
const give = (token, days = 60) => async () => ({ access_token: token, token_type: "bearer", expires_in: days * DAY / 1000 });
const page = (token) => [{ id: "111", access_token: token, instagram_business_account: { id: "17890" } }];
const near = (a, b, slack = 2 * HOUR) => Math.abs(a - b) <= slack;

let bad = 0;
const expect = (name, ok, detail) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(detail))); if (!ok) bad++; };
// "kept" = one save that only notes the try: both tokens as they were, the reason recorded, nothing claimed as renewed.
const kept = (w, out, note) => out === `kept: ${note}` && w.saves.length === 1 && w.saves[0][1].userToken === w.first.userToken
  && w.saves[0][1].pageToken === w.first.pageToken && w.saves[0][1].renewNote === note && !w.saves[0][1].renewedAt;

console.log("The ordinary renewal");
{
  const w = world({ exchange: give("NEW-USER"), tokens: { "OLD-USER": tok(20), "NEW-USER": tok(60) } });
  const out = await renewInstagram(env, w.kit); const d = w.saves[0]?.[1] || {};
  expect("20 days left, Meta gives 60: the new sign-in is saved, once", out === "renewed" && w.saves.length === 1 && d.userToken === "NEW-USER", { out, d });
  expect("the Page token is left alone", d.pageToken === "OLD-PAGE");
  expect("the new end date, the day and an empty note are recorded", near(d.userTokenExpires, now + 60 * DAY) && near(d.renewedAt, now) && d.renewNote === "" && near(d.renewTriedAt, now), d);
  expect("it took three calls to Meta and three to storage", w.graphCalls() === 3 && w.calls.filter((c) => c === "load").length === 2 && w.calls.filter((c) => c === "save").length === 1, w.calls);
}
{
  const w = world({ exchange: async () => ({ access_token: "NEW-USER", expires_in: 30 * DAY / 1000 }), tokens: { "OLD-USER": tok(20), "NEW-USER": tok(60) } });
  await renewInstagram(env, w.kit);
  expect("of two end dates Meta gives for the new one, the sooner is believed", near(w.saves[0][1].userTokenExpires, now + 30 * DAY), w.saves[0][1].userTokenExpires);
}
{
  const w = world({ exchange: give("NEW-USER"), tokens: { "OLD-USER": { is_valid: false, scopes: [], expires_at: at(-1) }, "NEW-USER": tok(60) } });
  const out = await renewInstagram(env, w.kit);
  expect("Meta has meanwhile dropped the old one: any new one that passes is taken", out === "renewed" && w.saves[0][1].userToken === "NEW-USER", out);
}

console.log("Nothing to do: no call to Meta at all");
for (const [name, ig, want] of [["60 days left", { userTokenExpires: now + 60 * DAY }, "not due"], ["no end date", { userTokenExpires: 4102444800000 }, "not due"],
  ["already ended", { userTokenExpires: now - DAY }, "ended"], ["tried 5 hours ago", { renewTriedAt: now - 5 * HOUR }, "tried today"]]) {
  const w = world({ ig, exchange: give("NEW-USER"), tokens: {} });
  const out = await renewInstagram(env, w.kit);
  expect(`${name}: "${want}"`, out === want && w.graphCalls() === 0 && w.saves.length === 0, { out, calls: w.calls });
}

console.log("A new sign-in that is not at least as good is never taken; the old one stays, with a plain reason");
for (const [name, fresh, note] of [
  ["it fails Meta's own check", tok(60, { is_valid: false }), "Meta's new sign-in didn't pass Meta's own check."],
  ["it belongs to a different app", tok(60, { app_id: "another-app" }), "Meta's new sign-in belongs to a different app."],
  ["it is for a different person", tok(60, { user_id: "2002" }), "Meta's new sign-in is for a different person."],
  ["it lacks the permission to post", tok(60, { scopes: ALL.filter((s) => s !== "instagram_content_publish") }), "Meta's new sign-in has fewer permissions than the current one."],
  ["it lists no permissions at all", tok(60, { scopes: [] }), "Meta's new sign-in has fewer permissions than the current one."],
  ["it ends sooner", tok(12), "Meta's new sign-in would end sooner than the current one."],
  ["its 90-day clock ends sooner", tok(60, { data_access_expires_at: at(40) }), "Meta's new sign-in would end sooner than the current one."],
  ["it ends on the same day", tok(20), "Meta gave the same end date as before."],
  ["it ends only three days later", tok(23), "Meta gave the same end date as before."],
]) {
  const w = world({ exchange: give("NEW-USER", (fresh.expires_at * 1000 - now) / DAY), tokens: { "OLD-USER": tok(20, name.includes("90-day") ? { data_access_expires_at: at(80) } : {}), "NEW-USER": fresh } });
  const out = await renewInstagram(env, w.kit);
  expect(name, kept(w, out, note), { out, saved: w.saves.map((s) => ({ ...s[1] })) });
}
{
  const w = world({ exchange: async () => ({ token_type: "bearer" }), tokens: { "OLD-USER": tok(20) } });
  expect("Meta answers without a token", kept(w, await renewInstagram(env, w.kit), "Meta sent nothing back."), w.saves);
}
{
  const w = world({ exchange: async () => { const e = new UserError("x"); e.expired = true; e.code = 190; throw e; }, tokens: { "OLD-USER": tok(20) } });
  expect("Meta refuses outright", kept(w, await renewInstagram(env, w.kit), "Meta no longer accepts the current sign-in."), w.saves);
}

console.log("Nothing key-shaped is kept, whatever Meta says back");
{
  const w = world({ ig: { userToken: "EAAGm0PX4ZCpsBAOLDTOKEN0123456789abcdefXYZ", pageToken: "EAAGm0PX4ZCpsBAPAGETOKEN0123456789abcdefXY" },
    exchange: async (p) => { throw new UserError(`Instagram said: Invalid parameter. fb_exchange_token=${p.fb_exchange_token} with client_secret ${p.client_secret} was not accepted`); } });
  const out = await renewInstagram(env, w.kit); const d = w.saves[0][1]; const blob = JSON.stringify(d.renewNote) + out;
  expect("the old sign-in stays", d.userToken === w.first.userToken && d.pageToken === w.first.pageToken && !d.renewedAt);
  expect("the note carries Meta's words but not the token or the app's secret", d.renewNote.startsWith("Instagram said: Invalid parameter.") && !blob.includes("EAAG") && !blob.includes("OLDTOKEN") && !blob.includes("app-secret") && blob.includes("[hidden]"), d.renewNote);
}
expect("hide(): a long unbroken run is cut out", hide("Malformed access token EAAGm0PX4ZCpsBAxyz0123456789ABCDEFGHIJ end") === "Malformed access token [hidden] end");
expect("hide(): a value named is cut out even if short or oddly shaped", hide("key=ab.cd/ef+gh12 was refused", "ab.cd/ef+gh12") === "key=[hidden] was refused");
expect("hide(): an app token (id|secret) is cut out whole", !/\d{6}|abcdef/.test(hide("bad token 1234567890123456|abcdef0123456789abcdef0123456789")));
expect("hide(): ordinary sentences pass untouched", hide("Error validating access token: Session has expired on Friday, 13-Nov-26 02:00:00 PST. The current time is later.") === "Error validating access token: Session has expired on Friday, 13-Nov-26 02:00:00 PST. The current time is later.");
expect("hide(): nothing and null are an empty text", hide(undefined) === "" && hide(null) === "");

console.log("Someone connects again, or disconnects, while a renewal is under way");
{
  const w = world({ second: { userToken: "SOMEONE-ELSES", pageToken: "P2", userTokenExpires: now + 60 * DAY }, exchange: give("NEW-USER"), tokens: { "OLD-USER": tok(20), "NEW-USER": tok(60) } });
  const out = await renewInstagram(env, w.kit);
  expect("a connection made meanwhile is left alone", out === "connected again meanwhile" && w.saves.length === 0, { out, saves: w.saves.length });
}
{
  const w = world({ second: null, exchange: give("NEW-USER"), tokens: { "OLD-USER": tok(20), "NEW-USER": tok(60) } });
  const out = await renewInstagram(env, w.kit);
  expect("a disconnect meanwhile is respected: nothing is brought back", out === "connected again meanwhile" && w.saves.length === 0, { out });
}
{
  const w = world({ exchange: async () => { throw new TypeError("fetch failed"); }, tokens: {} });
  let threw = false;
  try { await renewInstagram(env, w.kit); } catch (e) { threw = true; }
  expect("no connection to Meta at all: passed up for the timer to retry, nothing saved", threw && w.saves.length === 0, { threw, saves: w.saves.length });
}
{
  let n = 0;
  const w = world({ exchange: give("NEW-USER"), tokens: { "OLD-USER": tok(20), "NEW-USER": tok(60) } });
  const real = w.kit.graph;
  w.kit.graph = async (e, m, path, p) => { if (path === "/debug_token" && ++n === 1) { w.calls.push(path); throw new UserError("Instagram said: Service temporarily unavailable"); } return real(e, m, path, p); };
  const out = await renewInstagram(env, w.kit);
  expect("Meta goes quiet halfway (after handing out a new sign-in): the old one stays", out.startsWith("kept: Instagram said: Service temporarily") && w.saves[0][1].userToken === "OLD-USER" && !w.saves[0][1].renewedAt, { out });
}

console.log("Meta's 90-day clock: the Page token is made again only for a real gain, and only if it passes the same checks");
const clock = { ig: { userTokenExpires: now + 50 * DAY, dataAccessUntil: now + 10 * DAY } };
const oldUser = tok(50, { data_access_expires_at: at(10) }), newUser = tok(60, { data_access_expires_at: at(90) });
const oldPage = tok(null, { data_access_expires_at: at(10) });
{
  const w = world({ ...clock, exchange: give("NEW-USER"), tokens: { "OLD-USER": oldUser, "OLD-PAGE": oldPage, "NEW-USER": newUser, "NEW-PAGE": tok(null, { data_access_expires_at: at(90) }) }, pages: { "NEW-USER": page("NEW-PAGE") } });
  const out = await renewInstagram(env, w.kit); const d = w.saves[0][1];
  expect("both are renewed and the new date is kept", out === "renewed" && d.userToken === "NEW-USER" && d.pageToken === "NEW-PAGE" && near(d.dataAccessUntil, now + 90 * DAY), { out, d });
  expect("the heaviest renewal costs six calls to Meta and three to storage", w.graphCalls() === 6 && w.calls.length === 9, w.calls);
}
for (const [name, pageInfo, list] of [
  ["the new Page token can't post", tok(null, { data_access_expires_at: at(90), scopes: ALL.filter((s) => s !== "instagram_content_publish") }), page("NEW-PAGE")],
  ["the new Page token fails Meta's check", tok(null, { is_valid: false }), page("NEW-PAGE")],
  ["the new Page token carries the old date", tok(null, { data_access_expires_at: at(10) }), page("NEW-PAGE")],
  ["the new Page token is for somebody else", tok(null, { data_access_expires_at: at(90), user_id: "2002" }), page("NEW-PAGE")],
  ["the Page isn't listed for the new sign-in", null, []],
  ["a different Page is listed", tok(null, { data_access_expires_at: at(90) }), [{ id: "999", access_token: "NEW-PAGE", instagram_business_account: { id: "17890" } }]],
  ["the Page is linked to a different Instagram account", tok(null, { data_access_expires_at: at(90) }), [{ id: "111", access_token: "NEW-PAGE", instagram_business_account: { id: "55555" } }]],
]) {
  const w = world({ ...clock, exchange: give("NEW-USER"), tokens: { "OLD-USER": oldUser, "OLD-PAGE": oldPage, "NEW-USER": newUser, ...(pageInfo ? { "NEW-PAGE": pageInfo } : {}) }, pages: { "NEW-USER": list } });
  const out = await renewInstagram(env, w.kit); const d = w.saves[0][1];
  expect(`${name}: the working Page token stays; the sign-in is still renewed`, out === "renewed" && d.userToken === "NEW-USER" && d.pageToken === "OLD-PAGE" && d.dataAccessUntil === clock.ig.dataAccessUntil, { out, d });
}
{
  const w = world({ ...clock, exchange: give("NEW-USER"), tokens: { "OLD-USER": oldUser, "NEW-USER": newUser, "NEW-PAGE": tok(null, { data_access_expires_at: at(90) }) }, pages: { "NEW-USER": page("NEW-PAGE") } });
  const real = w.kit.graph;
  w.kit.graph = async (e, m, path, p) => { if (path === "/debug_token" && p.input_token === "OLD-PAGE") { w.calls.push(path); throw new UserError("Instagram said: busy"); } return real(e, m, path, p); };
  const out = await renewInstagram(env, w.kit); const d = w.saves[0][1];
  expect("Meta can't report on the Page token in use: nothing to set the new one beside, so it stays", out === "renewed" && d.userToken === "NEW-USER" && d.pageToken === "OLD-PAGE", { out, d });
}
{ // the day after: the sign-in is already the new one, the Page token still the old one
  const w = world({ ig: { userTokenExpires: now + 59 * DAY, dataAccessUntil: now + 9 * DAY }, exchange: give("NEWER-USER"),
    tokens: { "OLD-USER": tok(59, { data_access_expires_at: at(89) }), "OLD-PAGE": tok(null, { data_access_expires_at: at(9) }), "NEWER-USER": tok(60, { data_access_expires_at: at(89) }), "NEW-PAGE": tok(null, { data_access_expires_at: at(89) }) },
    pages: { "OLD-USER": page("NEW-PAGE"), "NEWER-USER": page("WRONG") } });
  const out = await renewInstagram(env, w.kit); const d = w.saves[0][1];
  expect("the Page token is tried again from the sign-in in use, without swapping the sign-in once more", out === "renewed" && d.userToken === "OLD-USER" && d.pageToken === "NEW-PAGE" && near(d.dataAccessUntil, now + 89 * DAY), { out, d });
}
{ // Meta's clock does not move without the person: the sign-in gains ten days once, and then is left in peace
  const w = world({ ...clock, exchange: give("NEW-USER"), tokens: { "OLD-USER": oldUser, "NEW-USER": tok(60, { data_access_expires_at: at(10) }) }, pages: { "NEW-USER": page("NEW-PAGE") } });
  const out = await renewInstagram(env, w.kit); const d = w.saves[0][1];
  expect("the clock didn't move: the Page token isn't touched (and /me/accounts isn't even asked)", out === "renewed" && d.pageToken === "OLD-PAGE" && !w.calls.includes("/me/accounts"), { out, calls: w.calls });
  const w2 = world({ ig: { userTokenExpires: now + 59 * DAY, dataAccessUntil: now + 9 * DAY }, exchange: give("NEWER-USER"),
    tokens: { "OLD-USER": tok(59, { data_access_expires_at: at(9) }), "NEWER-USER": tok(60, { data_access_expires_at: at(9) }) } });
  const out2 = await renewInstagram(env, w2.kit);
  expect("and the next day nothing is swapped for a single day's gain", kept(w2, out2, "Meta gave the same end date as before."), { out2 });
}

console.log(bad ? `\nFAIL (${bad})` : "\nPASS");
process.exit(bad ? 1 : 0);
