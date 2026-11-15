/* Nishiii's use of Claude: a ceiling on the day's questions, and which Claude model answers them.

   - Every question the app puts to Claude is counted, per India day, in one small document. Past the day's
     limit (400 unless the setting CLAUDE_DAILY_CAP says otherwise) no more are sent until midnight, so a
     fault or a stolen passcode can't run up a bill.
   - The model is the one written in worker.js until Anthropic says it no longer exists. Then the newest
     Sonnet on Anthropic's own list is chosen and remembered here, so a retired model needs no new version
     of the app.

   Used by worker.js (claudeRaw) and by the health record. Functions take the same "kit" as the add-on sections. */

const HOUR = 60 * 60 * 1000;
export const DEFAULT_CAP = 400;
const REREAD_MS = 60 * 1000;          // a running copy of the server trusts its own count this long before reading storage again
const DOC = "claudeuse";

export const capOf = (env) => (Number(env.CLAUDE_DAILY_CAP) >= 1 ? Math.floor(Number(env.CLAUDE_DAILY_CAP)) : DEFAULT_CAP);
const empty = () => ({ day: "", n: 0, prev: null, capDay: "", model: null });
let mem = null, memAt = 0;

async function read(env, kit, fresh) {
  if (!mem || fresh || Date.now() - memAt > REREAD_MS) {
    let doc = null;
    try { doc = await kit.loadDoc(env, DOC, null); } catch (e) { doc = null; }      // unreadable: start counting again
    mem = { ...empty(), ...(doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {}) };
    memAt = Date.now();
  }
  const today = kit.todayIST();
  if (mem.day !== today) mem = { ...mem, prev: mem.day ? { day: mem.day, n: Number(mem.n) || 0 } : mem.prev, day: today, n: 0 };
  return mem;
}

// Called before each question to Claude. Counts it, and says which model to ask.
// At the day's limit it refuses instead, in words she can read. Costs one storage write (and a read about once a minute).
export async function ticket(env, kit, fallbackModel) {
  const use = await read(env, kit);
  const cap = capOf(env);
  if (use.n >= cap) {
    if (use.capDay !== use.day) { use.capDay = use.day; await kit.saveDoc(env, DOC, use).catch(() => {}); }
    throw new kit.UserError(429, "Nishiii has answered a lot today and is resting until tomorrow. Everything else in the app still works.");
  }
  use.n += 1;
  await kit.saveDoc(env, DOC, use).catch((e) => console.error("the count of questions couldn't be saved", e && e.message));
  return { model: (use.model && use.model.id) || fallbackModel, plain: !!(use.model && use.model.plain) };
}

// The newest Sonnet on Anthropic's list that isn't the one just refused. Null when the list can't be read
// or holds none.
async function newestSonnet(env, not) {
  const res = await fetch((env.ANTHROPIC_API || "https://api.anthropic.com") + "/v1/models?limit=100", {
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const offered = (Array.isArray(data.data) ? data.data : [])
    .filter((m) => m && typeof m.id === "string" && /^claude-[a-z0-9.-]*sonnet/.test(m.id) && m.id !== not)
    .filter((m) => !m.lifecycle || m.lifecycle === "active")
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  return offered[0] || null;
}

// Called when Anthropic answers that the model no longer exists. Chooses the newest Sonnet, remembers it,
// and returns { model, plain } to ask again with; null if there is nothing to move to.
export async function moveOn(env, kit, gone) {
  const use = await read(env, kit, true);
  // Another running copy of the server may have moved already: use its choice rather than choosing again.
  if (use.model && use.model.id && use.model.id !== gone) return { model: use.model.id, plain: !!use.model.plain };
  const next = await newestSonnet(env, gone);
  if (!next) return null;
  use.model = { id: next.id, name: kit.oneLine(next.display_name, 60) || next.id, since: Date.now(), was: gone };
  await kit.saveDoc(env, DOC, use);
  return { model: next.id, plain: false };
}

// A newer model may not know every option the app sends. Called when it refuses the request for that reason:
// from then on the question is sent without the optional setting.
export async function goPlain(env, kit) {
  const use = await read(env, kit, true);
  if (!use.model || use.model.plain) return false;
  use.model.plain = true;
  await kit.saveDoc(env, DOC, use);
  return true;
}

// For the health record: today's and yesterday's counts, the limit, and the model in use.
export async function usage(env, kit, fallbackModel, fresh = true) {
  const use = await read(env, kit, fresh);
  const yesterday = new Date(Date.now() + 5.5 * HOUR - 24 * HOUR).toISOString().slice(0, 10);
  return { today: use.n, yesterday: use.prev && use.prev.day === yesterday ? use.prev.n : 0, cap: capOf(env),
    capHitToday: use.capDay === use.day, capHitYesterday: use.capDay === yesterday,
    model: (use.model && use.model.id) || fallbackModel, moved: use.model && use.model.id ? { ...use.model } : null };
}
