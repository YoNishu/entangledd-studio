/* A small shared vocabulary for what a quote is about and how it feels, so that tags written at different
   times and by different hands meet: "hope", "hopeful" and "hoping" are one theme; "peaceful" and "calm" one tone.
   Used by the scorer (server/scorer.js) and the engine (server/engine.js). Words outside the vocabulary are
   kept in a plain form (lower case, a common ending taken off), so two of them that are the same word still meet. */

// Canonical theme: the words that mean it.
const THEMES = {
  love: "love loving loved romance romantic affection heart hearts adore devotion",
  loss: "loss lose losing lost grief grieving mourning goodbye goodbyes heartbreak heartbroken",
  hope: "hope hopes hopeful hoping optimism",
  self: "self identity selfworth selflove",
  growth: "growth growing grow becoming progress",
  healing: "healing heal heals recovery mend mending",
  courage: "courage brave bravery bold boldness daring",
  fear: "fear fears afraid anxiety worry worries dread",
  time: "time",
  change: "change changes changing transformation",
  purpose: "purpose meaning calling",
  mind: "mind minds thoughts thought thinking",
  peace: "peace stillness serenity",
  solitude: "solitude alone loneliness lonely",
  friendship: "friendship friends friend",
  family: "family mother father",
  home: "home belonging",
  nature: "nature trees forest flowers sky",
  sea: "sea ocean oceans waves tide tides shore",
  life: "life living alive",
  death: "death dying mortality",
  freedom: "freedom free liberty",
  kindness: "kindness compassion gentleness",
  longing: "longing yearning missing",
  memory: "memory memories remembering nostalgia",
  faith: "faith belief believing",
  joy: "joy happiness happy delight",
  strength: "strength strong resilience endurance",
  wisdom: "wisdom wise",
  patience: "patience patient waiting",
  stoic: "stoic stoicism stoics",
  beauty: "beauty beautiful",
};
// Canonical tone: the words that mean it.
const TONES = {
  calm: "calm quiet peaceful gentle soft still serene",
  warm: "warm warmth comforting tender loving",
  wistful: "wistful nostalgic bittersweet longing",
  sad: "sad melancholy melancholic sorrowful heavy",
  hopeful: "hopeful uplifting bright optimistic",
  firm: "firm direct steady",
  playful: "playful funny witty",
  dark: "dark grim bleak",
  plain: "plain",
  romantic: "romantic",
};

const plainForm = (w) => {
  let s = String(w || "").toLowerCase().replace(/[^a-z]/g, "");
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5) s = s.replace(/(fulness|ness|ment|ful|ing|ity|ly|ed)$/, "");
  return s;
};
function index(table) {
  const map = new Map();
  for (const [canon, words] of Object.entries(table)) {
    for (const w of [canon, ...words.split(" ")]) {
      if (!map.has(w)) map.set(w, canon);
      const p = plainForm(w);
      if (p && !map.has(p)) map.set(p, canon);
    }
  }
  return map;
}
const THEME_OF = index(THEMES), TONE_OF = index(TONES);
const memo = new Map();

// One tag in canonical form: the vocabulary word when any word of it is in the vocabulary, else its plain form.
function canon(map, kind, s) {
  const raw = String(s || "").toLowerCase().trim().slice(0, 40);
  if (!raw) return "";
  const k = kind + raw;
  if (memo.has(k)) return memo.get(k);
  const words = raw.split(/[^a-z]+/).filter(Boolean);
  let out = "";
  for (const w of words) { out = map.get(w) || map.get(plainForm(w)) || ""; if (out) break; }
  if (!out) out = words.map(plainForm).filter(Boolean).join(" ");
  if (memo.size > 5000) memo.clear();
  memo.set(k, out);
  return out;
}
export const theme = (s) => canon(THEME_OF, "t:", s);
export const tone = (s) => canon(TONE_OF, "o:", s);

// Every vocabulary tag named in a phrase such as "calm lines about the sea": { themes, tones, len, kinds }.
export function tagsIn(phrase) {
  const words = String(phrase || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const themes = new Set(), tones = new Set(), kinds = new Set();
  let len = "";
  for (const w of words) {
    const p = plainForm(w);
    const th = THEME_OF.get(w) || THEME_OF.get(p), to = TONE_OF.get(w) || TONE_OF.get(p);
    if (th) themes.add(th);
    if (to) tones.add(to);
    if (/^(short|shorter|brief|tiny|small)$/.test(w)) len = "short";
    if (/^(long|longer|lengthy)$/.test(w)) len = "long";
    if (/^(film|films|movie|movies|cinema)$/.test(w)) kinds.add("film");
    if (/^(series|show|shows|tv)$/.test(w)) kinds.add("series");
    if (/^(book|books|novel|novels|reading)$/.test(w)) kinds.add("book");
  }
  // Other words of four letters or more, in plain form: "never anything about money" can still meet a theme "money".
  const other = words.filter((w) => w.length >= 4 && !STOP.has(w)).map(plainForm).filter((p) => p && !THEME_OF.has(p) && !TONE_OF.has(p));
  return { themes: [...themes], tones: [...tones], len, kinds: [...kinds], words: [...new Set(other)] };
}

const STOP = new Set("about anything everything something nothing never always lines line quote quotes more less please like with from that this they them their there what when where which your yours just very much many some only also into over under than then even ever really things thing kind sort feel feels make makes made".split(" "));
export const wordsIn = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
// The length group the scorer uses too: up to 10 words short, up to 25 medium, longer long.
export const lenOf = (text) => { const n = wordsIn(text); return !n ? "" : n <= 10 ? "short" : n <= 25 ? "medium" : "long"; };
export const THEME_LIST = Object.keys(THEMES);
