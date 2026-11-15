// Agent 9: the engine (server/engine.js) in made-up worlds, in Node. Each part alone moves the order the right
// way; an avoid buries a line; a small account's hit outranks a big account's ordinary post; day one gives a varied
// five from several sources; one source alone still gives five; reasons are true; picks are trusted from the first
// pick, smoothly, with a safety net; 500 candidates are scored in a few milliseconds.
import { build, score, choose, gather, questions, PARTS } from "../server/engine.js";
import * as tags from "../server/tags.js";
import { keyOf, nextState, decide, statusOf, pickScorer, worse } from "../server/scorer.js";

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 300)}`); if (!ok) failed++; };
const NOW = Date.now(), DAY = 864e5;
const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const kit = { norm, todayIST: () => new Date(NOW + 5.5 * 3600e3).toISOString().slice(0, 10) };
const world = (over = {}) => ({ lib: { books: [], screen: [], quotes: [] }, history: [], day: [], tasteDoc: null, insp: [], posts: [], rewords: [],
  scorerModel: null, tagsDoc: { v: 1, items: {} }, bank: { v: 1, lines: [], asked: {}, tried: {}, used: {} }, ...over });
const q = (text, theme, extra = {}) => ({ text, author: extra.author || "Someone " + text.length, source: { type: "classic", title: "" }, theme, tone: extra.tone || "plain", verify: false, src: "memory", ...extra });
const order = (P, list) => list.map((i) => ({ t: i.text, s: score(P, i).s })).sort((a, b) => b.s - a.s).map((x) => x.t);
const top = (P, a, b) => score(P, a).s > score(P, b).s;

// ---- the vocabulary
check("hope, hopeful and hoping meet", tags.theme("hope") === "hope" && tags.theme("hopeful") === "hope" && tags.theme("Hoping") === "hope");
check("tones meet too", tags.tone("peaceful") === "calm" && tags.tone("quiet") === "calm" && tags.tone("uplifting") === "hopeful");
check("an unknown word keeps a plain form that meets itself", tags.theme("wanderings") === tags.theme("wandering"));
check("phrases are read for tags", JSON.stringify(tags.tagsIn("quiet lines about the sea")) === JSON.stringify({ themes: ["sea"], tones: ["calm"], len: "", kinds: [], words: [] }));

const A = q("Hope is the thing with feathers that perches in the soul.", "hope"), B = q("Fear is the mind-killer, the little death.", "fear");

// ---- picks: learnt from the first pick, weight growing smoothly, with the safety net
const model = (P, N, feat, extra = {}) => ({ v: 1, at: NOW, base: [P, N], feat, picks: P, passes: N, state: "learning", eval: { days: 0, mean: 0.5, z: 0, recent: 0.5 }, ...extra });
const hopeFan = (n) => model(n, n, { theme: { hope: [n * 0.9, n * 0.1], fear: [n * 0.1, n * 0.9] } });
const gap = (m) => { const P = build(world({ scorerModel: m })); return score(P, A).parts.picks - score(P, B).parts.picks; };
check("picks: her picks put hope above fear", gap(hopeFan(30)) > 0);
check("picks count from the very first ones", gap(hopeFan(1)) > 0);
check("but one or two picks move little (strong shrinkage)", gap(hopeFan(1)) < 0.1 * gap(hopeFan(100)), [gap(hopeFan(1)), gap(hopeFan(100))]);
check("and the weight grows smoothly with evidence", gap(hopeFan(5)) < gap(hopeFan(20)) && gap(hopeFan(20)) < gap(hopeFan(80)));
const bad = { ...hopeFan(80), eval: { days: 30, mean: 0.3, z: -4, recent: 0.3 } };
check("safety net: clearly worse than chance on her history, picks fall to near zero", gap(bad) < 0.08 * gap(hopeFan(80)), [gap(bad), gap(hopeFan(80))]);
check("worse() is that test", worse(bad.eval) && !worse({ days: 30, mean: 0.48, z: -0.5 }) && !worse({ days: 5, mean: 0.2, z: -5 }));
check("no gate at 50: the state can go live with fewer picks", nextState("learning", 20, { days: 25, mean: 0.7, z: 4, recent: 0.7 }) === "live");
check("decide() rests a model that tests clearly worse", decide({ state: "live" }, { picks: 80, days: Array(30).fill(0.2), starts: Array(30).fill(1) }, NOW).state === "resting");
const st = statusOf({ picks: 12, lately: "short lines about hope" });
check("the scorer's own line says what is learnt, with no 'of 50'", st.line === "Learning from your picks: 12 so far. Lately: short lines about hope." && !("need" in st) && !("progress" in st), st);
check("pickScorer names the strongest feature", pickScorer(hopeFan(30))(A).top[1] === "hope");

// ---- taste: loves lift, an avoid buries
const tasteDoc = { profile: { loves: ["quiet lines about the sea"], avoids: ["lines about death"], voice: [] }, notes: [{ text: "never anything about money" }] };
const SEA = q("The sea does not reward those who are too anxious.", "sea", { tone: "calm" }), DEATH = q("Death smiles at us all.", "death"), PLAIN = q("A line on the weather today.", "weather");
let P = build(world({ tasteDoc }));
check("taste: a loved theme and tone go up", top(P, SEA, PLAIN));
check("taste: an avoid goes far down", score(P, DEATH).s < score(P, PLAIN).s - 1, [score(P, DEATH).s, score(P, PLAIN).s]);
const MONEY = q("Money can't buy happiness.", "money");
check("her own note 'never ... money' is an avoid", score(P, MONEY).s < score(P, PLAIN).s - 1);
const many = [DEATH, ...Array.from({ length: 8 }, (_, i) => q(`Ordinary line number ${i} about walking.`, ["walk", "road", "rain", "light"][i % 4], { author: "A" + i }))];
check("an avoid is not chosen while other lines are left", !choose(P, many, 5).some((x) => x.text === DEATH.text));
check("the reason names what she said she likes", score(P, SEA).why.includes("You like quiet lines about the sea"), score(P, SEA).why);

// ---- own voice
const ownLib = { books: [], screen: [], quotes: ["hope stays", "hope, again", "hope is a quiet room"].map((t) => ({ text: t, theme: "hope" })) };
P = build(world({ lib: ownLib }));
const H2 = q("A short hopeful line.", "hopeful"), F2 = q("A short fearful line.", "fear");
check("own voice: like her own lines (theme) goes up", top(P, H2, F2));
const longOne = q("This is a long line that keeps on going and going well past the point where anyone would stop to read it on a reel.", "hope");
check("own voice: near the length of her own lines goes up", top(P, H2, longOne));
P = build(world({ rewords: Array.from({ length: 6 }, () => ({ asked: "make it shorter", after: "one two three four five six" })) }));
check("own voice: asking to shorten favours shorter lines", top(P, q("Five words is quite enough.", "x"), q("Twelve words is a lot more than she ever asks for in her rewording.", "x")));

// ---- pages: relative to each account's usual numbers; a shared reel counts more
const post = (quote, likes, at = NOW - 5 * DAY) => ({ quote, likes, comments: 0, views: 0, at: new Date(at).toISOString() });
const small = { kind: "account", handle: "small.page", followers: 900, top: [post("hope hit", 400), post("a plain one", 40), post("another plain one", 40), post("yet another", 40)] };
const big = { kind: "account", handle: "big.page", followers: 900000, top: [post("love ordinary", 20000), post("x one", 20000), post("x two", 20000), post("x three", 20000)] };
const tagsDoc = { v: 1, items: { [keyOf("hope hit")]: { th: "hope" }, [keyOf("love ordinary")]: { th: "love" }, [keyOf("a plain one")]: { th: "a" }, [keyOf("another plain one")]: { th: "b" },
  [keyOf("yet another")]: { th: "c" }, [keyOf("x one")]: { th: "d" }, [keyOf("x two")]: { th: "e" }, [keyOf("x three")]: { th: "f" } } };
P = build(world({ insp: [small, big], tagsDoc }));
const HOPE = q("Hope is a good breakfast.", "hope"), LOVE = q("Love is patient.", "love");
check("pages: a small account's hit outranks a big account's ordinary post", score(P, HOPE).parts.pages > score(P, LOVE).parts.pages, [score(P, HOPE).parts.pages, score(P, LOVE).parts.pages]);
check("its reason names the page where it does well", score(P, HOPE).why.includes("Doing well on @small.page"), score(P, HOPE).why);
check("and the big page's ordinary post is not called 'doing well'", !score(P, LOVE).why.includes("Doing well"), score(P, LOVE).why);
const shared = { kind: "screenshot", handle: "", quote: "love saved", added: NOW - DAY };
P = build(world({ insp: [big, shared], tagsDoc: { v: 1, items: { ...tagsDoc.items, [keyOf("love saved")]: { th: "courage" } } } }));
check("pages: a reel she shared counts more than an ordinary post of a page", score(P, q("Courage!", "courage")).parts.pages > score(P, LOVE).parts.pages);

// ---- audience: per reach, saves and shares count more, small groups say nothing
const mk = (theme, saved, likes, reach = 1000) => ({ state: "published", quote: theme + " " + Math.random(), theme, tone: "plain", author: "", metrics: { reach, saved, shares: 0, likes, comments: 0 } });
const posts = [...Array(4).fill(0).map(() => mk("hope", 60, 50)), ...Array(4).fill(0).map(() => mk("love", 2, 120)), ...Array(4).fill(0).map(() => mk("time", 5, 60))];
P = build(world({ posts }));
check("audience: saves weigh more than likes", score(P, HOPE).parts.audience > score(P, LOVE).parts.audience, [score(P, HOPE).parts.audience, score(P, LOVE).parts.audience]);
check("and its reason says so", score(P, HOPE).why.includes("Posts about hope do well for you"), score(P, HOPE).why);
P = build(world({ posts: [mk("hope", 90, 50), mk("love", 1, 1), mk("love", 1, 1), mk("love", 1, 1), mk("x", 1, 1)] }));
check("audience: one post on a theme says nothing", score(P, HOPE).parts.audience === score(P, q("Joy is a good breakfast.", "joy")).parts.audience);
P = build(world({ posts: [...Array(4).fill(0).map(() => mk("hope", 30, 50, 100000)), ...Array(4).fill(0).map(() => mk("love", 30, 50, 1000))] }));
check("audience: per person reached (a big reach with the same numbers did worse)", score(P, LOVE).parts.audience > score(P, HOPE).parts.audience);

// ---- trust
P = build(world());
const sure = { ...q("Found on a page.", "x"), found: true, src: "found", source: { type: "book", title: "B", site: "wikiquote.org" } }, unsure = { ...q("Unchecked line.", "x"), verify: true };
check("trust: found word for word beats unchecked", top(P, sure, unsure) && score(P, sure).why.includes("Found word for word on wikiquote.org"));
check("trust: the book's own text is named", score(P, { ...q("From text.", "x"), fromText: true }).why.includes("From the book's own text"));

// ---- fresh
const hist = [{ text: "x", author: "Rumi", theme: "love", action: "used", at: NOW - DAY }, { text: "y", author: "", theme: "time", action: "used", at: NOW - DAY }, { text: "z", theme: "loss", action: "used", at: NOW - DAY }];
P = build(world({ history: hist }));
check("fresh: an author she just had goes down", top(P, q("Another one.", "joy", { author: "Seneca" }), q("Another one.", "joy", { author: "Rumi" })));
check("fresh: a theme she hasn't had lately goes up", top(P, q("Joy line.", "joy"), q("Love line.", "love")) && score(P, q("Joy line.", "joy")).why.includes("Something you haven't had lately"));

// ---- day one, no picks: a sensible, varied five from several sources
const day1 = world({
  lib: { quotes: [{ text: "My own small line about the sea." }, { text: "Another line of mine." }], books: [{ id: "b1", title: "The Book", author: "Ada", found: { at: NOW, lines: [1, 2, 3, 4].map((n) => ({ text: `Found line ${n} from the book about ${["hope", "sea", "time", "love"][n - 1]}.`, theme: ["hope", "sea", "time", "love"][n - 1], tone: "calm", url: "https://en.wikiquote.org/wiki/B", site: "wikiquote.org", verify: false })) } }], screen: [] },
  bank: { v: 1, asked: {}, tried: {}, used: {}, lines: [
    ...[1, 2, 3].map((n) => ({ text: `Discovered line ${n} about ${["courage", "peace", "joy"][n - 1]}.`, by: "W" + n, work: "Work " + n, type: "book", th: ["courage", "peace", "joy"][n - 1], verify: false, from: "discover", url: "https://www.goodreads.com/q", site: "goodreads.com" })),
    ...[1, 2].map((n) => ({ text: `Echo line ${n} about ${["growth", "self"][n - 1]}.`, by: "E" + n, work: "", type: "classic", th: ["growth", "self"][n - 1], verify: true, from: "echo" }))] },
  tasteDoc,
});
P = build(day1);
const seen = new Set();
const pool = [...gather(kit, day1, seen), ...[1, 2, 3, 4].map((n) => q(`Memory line ${n} about ${["mind", "fear", "life", "wisdom"][n - 1]}.`, ["mind", "fear", "life", "wisdom"][n - 1]))];
const srcs = new Set(pool.map((x) => x.src));
check("the pool draws on every source", ["own", "found", "discover", "echo", "memory"].every((s) => srcs.has(s)), [...srcs]);
let ok = true, stats = [];
for (let r = 0; r < 30; r++) {
  const five = choose(P, pool, 5);
  const by = (k) => { const m = new Map(); for (const x of five) m.set(x[k], (m.get(x[k]) || 0) + 1); return m; };
  const s = by("src"), th = new Map(); for (const x of five) th.set(tags.theme(x.theme), (th.get(tags.theme(x.theme)) || 0) + 1);
  const good = five.length === 5 && s.size >= 3 && Math.max(...s.values()) <= 2 && (s.get("own") || 0) === 1 && Math.max(...th.values()) <= 2 && five.filter((x) => x.wild).length === 1 && five.every((x) => typeof x.why === "string");
  if (!good) { ok = false; stats = five.map((x) => [x.src, x.theme, x.wild]); break; }
}
check("day one: five, from at least three sources, at most two from one, one of her own, at most two per theme, one wildcard", ok, stats);

// ---- one source alone still gives five
const lone = world({ lib: { quotes: [], screen: [], books: [{ id: "b", title: "T", author: "A", found: { at: NOW, lines: Array.from({ length: 7 }, (_, i) => ({ text: `Only found line ${i}.`, theme: "hope", verify: false, site: "wikiquote.org" })) } }] } });
const lonePool = gather(kit, lone, new Set());
check("only found lines, one theme, one author: still five", choose(build(lone), lonePool, 5).length === 5);
check("nothing at all: nothing invented", choose(build(world()), [], 5).length === 0);

// ---- reasons are truthful: every phrase is one a part produced for a real match
const P1 = build(day1);
for (const x of choose(P1, pool, 5)) {
  const r = score(P1, x);
  const claims = r.why ? r.why.split(" · ") : [];
  const fine = claims.every((c) => (c.startsWith("You like ") && tasteDoc.profile.loves.some((l) => c.includes(l))) || (c.startsWith("Found word for word on ") && x.source.site && c.endsWith(x.source.site))
    || c === "Two sites agree on the wording" && !x.verify || c.startsWith("Like your own lines about ") && c.endsWith(tags.theme(x.theme)) || c === "The length of your own lines" || c === "Something you haven't had lately");
  check(`reason for "${x.text.slice(0, 30)}" is true: ${r.why || "(none)"}`, fine && claims.length <= 2, r);
}

// ---- questions for the web search hold nothing about her
const qs = questions({ lib: { books: [{ title: "Quiet Book", author: "Ada Writer" }], screen: [], quotes: [{ text: "my secret line about Dhruuu" }] }, history: [{ action: "used", theme: "hopeful", author: "Mary Oliver" }],
  tasteDoc: { profile: { loves: ["calm lines about the sea"], avoids: [] }, notes: [{ text: "my fiance Nishith loves this" }] }, tagsDoc: { v: 1, items: {} } }, 2026);
const all = qs.map((x) => x.text).join("\n");
check("web questions name themes, authors and titles", /about sea/.test(all) && /about hope/.test(all) && /by Mary Oliver/.test(all) && /similar to "Quiet Book"/.test(all) && /came out in 2025 or 2026/.test(all));
check("and never her notes, her lines or names from them", !/Dhruuu|Nishith|fiance|secret|my own/i.test(all));

// ---- timing: 500 candidates
const big500 = Array.from({ length: 500 }, (_, i) => q(`Candidate number ${i} about ${tags.THEME_LIST[i % tags.THEME_LIST.length]} and more words here`, tags.THEME_LIST[i % tags.THEME_LIST.length], { author: "Au" + (i % 40) }));
const heavy = world({ ...day1, posts: Array.from({ length: 300 }, (_, i) => mk(tags.THEME_LIST[i % 20], i % 7, 40)), insp: Array.from({ length: 20 }, (_, i) => ({ ...small, handle: "p" + i })), scorerModel: hopeFan(200) });
for (let i = 0; i < 3; i++) choose(build(heavy), big500, 5);           // warm up
const t0 = process.hrtime.bigint();
const runs = 10;
for (let i = 0; i < runs; i++) choose(build(heavy), big500, 5);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
console.log(`build + score + choose, 500 candidates, 300 posts, 20 pages: ${ms.toFixed(2)} ms`);
check("500 candidates are scored and chosen in a few milliseconds", ms < 25, ms);
check("the parts and their starting weights", JSON.stringify(PARTS.map((p) => p[1])) === "[1,1,0.6,0.8,0.9,0.5,0.4]");

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
