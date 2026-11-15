// Pretend versions of the places the app looks for real lines (server/findlines.js): Wikiquote, Goodreads,
// IMDb, Gemini with Google Search and OpenAI with web search. Loaded by server/dev.mjs; never part of the
// real app. Every work here is made up; only the shapes of the answers are the real services' shapes.
//
//   GEMINI=on|429|refused|gone|memory|badkey|nosearch|nolist   a Gemini key is set, and Gemini answers that way (no
//                                        setting: no key; badkey: the key is not one Google knows, answered with 400 as
//                                        Google does; nosearch: the first model refuses the search tool, the next works;
//                                        nolist: the list of models can't be read, so the built-in names are tried)
//   OPENAI=on|429|refused|nomodel        the same for OpenAI
//   GET /__gemini/v1beta/models, GET /__openai/v1/models   the lists of models a key may use (logged apart: /__lines_log?list=models)
//   "The Late Thaw" is a made-up 2026 Chinese drama (春迟): asked about plainly, the pretend search brings back lines
//   about the season; asked about with its facts, its lines, found on social posts behind Google's redirect links.
//   SITES=ok|blocked|captcha|empty       how Goodreads and IMDb answer (default ok)
//   WIKIQUOTE=ok|down                    Wikiquote answers, or turns everything away with 503
//   GET /__lines_set?gemini=..&openai=..&sites=..&wikiquote=..   changes any of these while running ("off" takes a key away)
//   GET /__lines_set?slow=700           every pretend service here waits that many milliseconds before answering
//   GET /__lines_log                     every request these pretend services received, in order (?reset=1 empties it)
const GEMINI_KEY = "dev-gemini-key", OPENAI_KEY = "dev-openai-key";
const mode = { gemini: process.env.GEMINI || "off", openai: process.env.OPENAI || "off", sites: process.env.SITES || "ok", wikiquote: process.env.WIKIQUOTE || "ok", slow: "0" };
let log = [], listLog = [];

export function env(PORT) {
  const at = `http://localhost:${PORT}`;
  return { ...(process.env.LOOKUP_SECONDS ? { LOOKUP_SECONDS: process.env.LOOKUP_SECONDS } : {}), ...(process.env.GEMINI_MODEL ? { GEMINI_MODEL: process.env.GEMINI_MODEL } : {}), WIKIQUOTE_API: at + "/__wikiquote", GOODREADS_SITE: at + "/__goodreads", IMDB_SUGGEST: at + "/__imdbsug", IMDB_SITE: at + "/__imdb",
    GEMINI_API: at + "/__gemini", OPENAI_API: at + "/__openai",
    ...(mode.gemini !== "off" ? { GEMINI_API_KEY: GEMINI_KEY } : {}), ...(mode.openai !== "off" ? { OPENAI_API_KEY: OPENAI_KEY } : {}) };
}

// ---------------------------------------------------------------- Wikiquote: pages in the real layout
// A film page: sections by character, then Dialogue, Taglines, Cast, what others said, links.
const FILM = `The Long Tide is a 2016 drama film about a lighthouse keeper's daughter who returns to the island she left. Directed by Odile Marchetti. Written by Odile Marchetti and Ben Aro.
What the sea takes, it takes slowly. (taglines)


== Mara ==
You can leave an island, but the island keeps your shape.
I used to think the tide was leaving. It was only ever coming back.
[to her father] Nobody teaches you how to return to a place that forgave you.


== Captain Ilves ==
A harbour is only a promise the land makes to the sea.
We do not own the water. We borrow the crossing.


== Dialogue ==
Mara: How long does the light stay on?
Captain Ilves: As long as someone is still out there.
[Mara looks at the lamp room]
Mara: And when nobody is?
Captain Ilves: Then it stays on for us.


== Taglines ==
What the sea takes, it takes slowly.
Some shores wait for you.


== Cast ==
Lena Dvorak — Mara
Tomas Ilgner — Captain Ilves


== Quotes about The Long Tide ==
A patient film that trusts silence more than most films trust dialogue.
Peter Hanlon, The Evening Courier


== External links ==
The Long Tide quotes at the Internet Movie Database
`;
const NOVEL = `The Long Tide is a 2009 novel by Jonas Reed, the first of his Estuary books.


== Chapter 1 ==
The river did not hurry, and so it arrived everywhere.
Grief is a tide table nobody prints.


== Chapter 7 ==
He had mistaken being needed for being loved, and the bill had come due.


== External links ==
The Long Tide at Goodreads
`;
// A page without a note in brackets after its title: only its opening words say what it is.
const SMALL = `Small Hours is a 2019 drama film directed by Ilse Brandt, about two night-shift nurses.


== Noor ==
The small hours are when the truth stops being polite.
Everybody is brave at noon. Try it at four in the morning.


== Cast ==
Amira Sol — Noor
`;
// An author's page: one heading for each book.
const AUTHOR = `Mira Kessel (born 1984) is a novelist.


== Quotes ==


=== Winter Orchard (2018) ===
An orchard in winter is not dead, only keeping its word quietly.
Some apologies arrive as weather.


=== The Salt Road (2021) ===
We carried salt because it was the one thing that remembered the sea.
Love is not the road. Love is whoever is still walking beside you at dusk.
Every map is a letter from someone who went first.


== Quotes about Kessel ==
Kessel writes like someone folding a letter she will never send.


== External links ==
Mira Kessel at Wikipedia
`;
// A series page, long enough that the app reads samples of it rather than all of it.
const SERIES = (() => {
  const who = ["Ines", "Tobias", "Old Marit", "Jonah"];
  const said = ["The harbour keeps every promise the sea forgets", "Nobody drowns in the past unless they keep swimming back to it", "A lamp does not argue with the dark, it simply stays",
    "We are all somebody's weather", "You can mend a net a hundred times and it is still the same net", "The quiet ones are not empty, they are full and careful"];
  let out = "Harbour Lights (2020–2023) is a Norwegian television drama series about a fishing town and the people who stay.\n";
  for (let s = 1; s <= 3; s++) {
    out += `\n\n== Season ${s} ==\n`;
    for (let e = 1; e <= 8; e++) {
      out += `\n\n=== Episode ${e} ===\n`;
      for (let l = 0; l < 10; l++) out += `${who[(s + e + l) % who.length]}: ${said[(s * e + l) % said.length]}, as told in season ${s}, episode ${e}, line ${l + 1}.\n${l === 4 ? "[The foghorn sounds]\n" : ""}`;
    }
  }
  return out + "\n\n== Cast ==\nSigrid Aune — Ines\n\n\n== External links ==\nHarbour Lights at the Internet Movie Database\n";
})();
// A person's page, laid out as Wikiquote lays them out: sourced lines, then "Disputed" and "Misattributed"
// sections, each line with a note under it (server/verify.js reads these for "Who said this?").
const PERSON = `Edda Marlowe (1931–2004) was a poet from the Orkney Islands.


== Quotes ==
The lamp is lit for the ones who are still walking.
** Harbour Songs (1968), p. 12
Every tide is a small forgiveness.
** Harbour Songs (1968), p. 40


== Disputed ==
Wait for the light; it has never once forgotten the way.
** Credited to Marlowe from 1990 on; no earlier source is known.


== Misattributed ==
Kindness is the only language the tide understands.
** Often credited to Marlowe online. It is really by Pell Arden, from a greeting card of 2011.


== External links ==
Edda Marlowe at Wikipedia
`;
const WIKI = [
  { title: "The Long Tide (novel)", text: NOVEL, cats: ["2009 novels", "Novels by Jonas Reed"] },
  { title: "The Long Tide (film)", text: FILM, cats: ["2016 films", "Drama films"] },
  { title: "Harbour Lights (TV series)", text: SERIES, cats: ["2020s television series"] },
  { title: "Small Hours", text: SMALL, cats: ["2019 films"] },
  { title: "Mira Kessel", text: AUTHOR, cats: ["Novelists", "1984 births"], mentions: ["The Salt Road", "Winter Orchard"] },
  { title: "Edda Marlowe", text: PERSON, cats: ["Poets", "1931 births"] },
];
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function wikiquote(url) {
  const q = url.searchParams;
  if (q.get("list") === "search" && q.get("srwhat") === "text") {
    // A search of the pages' text: pages that have the first five words of the search, in that order.
    const want = norm(q.get("srsearch")).split(" ").slice(0, 5).join(" ");
    const hits = WIKI.filter((p) => norm(p.text).includes(want));
    return { batchcomplete: true, query: { searchinfo: { totalhits: hits.length }, search: hits.map((p) => ({ ns: 0, title: p.title, pageid: 9000 + WIKI.indexOf(p), size: p.text.length })) } };
  }
  if (q.get("list") === "search") {
    const want = norm(q.get("srsearch"));
    const hits = WIKI.filter((p) => want.includes(norm(p.title.replace(/\s*\(.*\)$/, ""))) || (p.mentions || []).some((m) => want.includes(norm(m))));
    return { batchcomplete: true, query: { searchinfo: { totalhits: hits.length }, search: hits.map((p, i) => ({ ns: 0, title: p.title, pageid: 9000 + i, size: p.text.length,
      wordcount: p.text.split(/\s+/).length, snippet: `<span class="searchmatch">${p.title.split(" ")[0]}</span> ${p.text.slice(0, 80)}`, timestamp: "2026-10-01T09:00:00Z" })) } };
  }
  const p = WIKI.find((x) => x.title === q.get("titles"));
  if (!p) return { batchcomplete: true, query: { pages: [{ ns: 0, title: q.get("titles"), missing: true }] } };
  return { batchcomplete: true, query: { pages: [{ pageid: 9000 + WIKI.indexOf(p), ns: 0, title: p.title, extract: p.text, categories: p.cats.map((c) => ({ ns: 14, title: "Category:" + c })) }] } };
}

// ---------------------------------------------------------------- Goodreads: the suggestion list and a book's quotes page
const BOOKS = [
  { imageUrl: "https://i.gr-assets.com/x.jpg", bookId: "71001", workId: "5550002", bookUrl: "/book/show/71001", title: "The Salt Road", bookTitleBare: "The Salt Road", author: { id: 31, name: "Tom Brandt" } },
  { imageUrl: "https://i.gr-assets.com/y.jpg", bookId: "71002", workId: "5550001", bookUrl: "/book/show/71002", title: "The Salt Road (Tidewater, #1)", bookTitleBare: "The Salt Road", author: { id: 32, name: "Mira Kessel" } },
  { imageUrl: "https://i.gr-assets.com/z.jpg", bookId: "71003", workId: "5550003", bookUrl: "/book/show/71003", title: "Glass Rivers", bookTitleBare: "Glass Rivers", author: { id: 33, name: "Ana Vale" } },
];
const quoteBlock = (text, author, title, work, n) => `
<div class="quote">
  <div class="quoteDetails">
    <div class="quoteText">
      &ldquo;${text}&rdquo;
  <br>  &#8213;
  <span class="authorOrTitle">
    ${author},
  </span>
    <span id="quote_book_link_${work}${n}">
      <a class="authorOrTitle" href="/work/quotes/${work}">${title}</a>
    </span>
</div>
    <div class="quoteFooter">
      <div class="greyText smallText left"><strong>tags:</strong> <a href="/quotes/tag/love">love</a></div>
      <div class="right"><a class="smallText" title="View this quote" href="/quotes/${1000 + n}-x">${90 - n} likes</a></div>
    </div>
  </div>
</div>`;
const QUOTES = {
  5550001: [["Salt keeps what the sea lets go.", "Mira Kessel"], ["She had learned that waiting is also a kind of travelling &mdash; slower, and with better company.", "Mira Kessel"],
    ["Don&#39;t ask the road where it ends.<br />Ask who you&rsquo;ll be when you get there.", "Mira Kessel"], ["A line that some other writer wrote, filed here by mistake.", "Someone Else"]],
  5550002: [["This belongs to another book that happens to share the name.", "Tom Brandt"]],
  5550003: [["A river of glass still remembers how to run.", "Ana Vale"], ["I was not lost. I was only between the names for where I was.", "Ana Vale"], ["Tenderness is a decision you keep making.", "Ana Vale"]],
};
function goodreadsPage(id) {
  const book = BOOKS.find((b) => b.workId === id), rows = mode.sites === "empty" ? [] : QUOTES[id] || [];
  return `<!DOCTYPE html><html><head><title>${book ? book.bookTitleBare : "Book"} Quotes by ${book ? book.author.name : ""}</title></head><body>
<div class="mainContentFloat"><h1>${book ? book.bookTitleBare : "Book"} Quotes</h1><span class="smallText">Showing 1-${rows.length} of ${rows.length}</span>
${rows.map(([t, a], n) => quoteBlock(t, a, book.bookTitleBare, id, n)).join("\n")}
</div></body></html>`;
}

// ---------------------------------------------------------------- IMDb: the suggestion list and a title's quotes page
const TITLES = [
  { id: "nm7000009", l: "Quiet Harbour Jones", s: "Actor" },
  { id: "tt7000001", l: "Quiet Harbour", q: "feature", qid: "movie", y: 1999, s: "Per Lund, Aino Sarv", rank: 90211 },
  { id: "tt7000002", l: "Quiet Harbour", q: "TV series", qid: "tvSeries", y: 2022, yr: "2022-2024", s: "Sigrid Aune, Olav Berg", rank: 1422 },
  { id: "tt7000003", l: "Quiet Harbour", q: "feature", qid: "movie", y: 2012, s: "Lene Dahl", rank: 30400 },     // a remake: only its year tells it apart
];
const SAID = {
  tt7000001: [[["Edvard", "A film line that belongs to the old picture, not the series."]]],
  tt7000003: [[["Lene", "The remake keeps its own line, and this is it."]]],
  tt7000002: [[["Ines", "The tide does not ask permission to come home."]], [["Tobias", "You keep saying sorry like it is a place we can live in."], ["Ines", "Then let&#39;s at least visit."]],
    [["Old Marit", "People think patience is waiting. It is choosing, again and again, not to leave."]]],
};
function imdbPage(id) {
  const t = TITLES.find((x) => x.id === id), items = mode.sites === "empty" ? [] : SAID[id] || [];
  return `<!DOCTYPE html><html><head><title>${t ? t.l : ""} - Quotes - IMDb</title></head><body><main><h1>Quotes</h1><h2>${t ? t.l : ""}</h2>
${items.map((lines, n) => `<div data-testid="item-id" class="ipc-list-card--border-line"><div class="ipc-html-content ipc-html-content--base" role="presentation"><div class="ipc-html-content-inner-div" role="presentation"><ul>${
    lines.map(([who, what]) => `<li><a class="ipc-md-link ipc-md-link--entity" href="/name/nm${n}/?ref_=ttqu_qu">${who}</a>: ${what}</li>`).join("")}</ul></div></div><span class="ipc-voting__label__count">${40 - n}</span></div>`).join("\n")}
</main><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script></body></html>`;
}
const CAPTCHA = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><h1>Verify you are human</h1><p>Complete the captcha to continue.</p></body></html>`;

// ---------------------------------------------------------------- Gemini and OpenAI
const titleIn = (text) => (/"([^"]+)"/.exec(text) || [])[1] || "";
// The questions of server/verify.js: who said a quote, and which work a title is. Their answers, as JSON text,
// with the pages "read" (sites) behind them.
function verifyAnswer(prompt) {
  if (prompt.startsWith("Search the web for where this quote comes from")) {
    const quote = (/^Quote: "(.*)"$/m.exec(prompt) || [])[1] || "";
    if (unknown(quote)) return { text: "{}", sites: [] };
    return { sites: ["quoteinvestigator.com", "wikiquote.org"], text: JSON.stringify({ author: "Ilse Varga", work: "", wording: "", misattributed: true,
      summary: "The pages say the line is really by Ilse Varga, from a 1997 interview.", pages: ["https://quoteinvestigator.com/2020/03/03/moon-minutes/"] }) };
  }
  const titleQuestion = prompt.startsWith("Search the web for the ") && prompt.includes("that someone calls");
  if (titleQuestion && /late thaw/i.test(titleIn(prompt))) {
    return { sites: ["mydramalist.com", "en.wikipedia.org"], text: JSON.stringify({ title: "The Late Thaw", original: "春迟", aka: ["Late Thaw"], by: "Wen Lu", year: 2026, country: "Chinese",
      cast: ["Lin Qiao", "Shen Mo"], kind: "series", page: "https://mydramalist.com/790001-the-late-thaw" }) };
  }
  if (titleQuestion) {
    const title = titleIn(prompt);
    if (unknown(title)) return { text: "{}", sites: [] };
    return { sites: ["en.wikipedia.org"], text: JSON.stringify({ title: "The Winter Ledger", by: "Hana Moll", year: 2017, kind: /^Search the web for the TV series/.test(prompt) ? "series" : /^Search the web for the film/.test(prompt) ? "film" : "book",
      page: "https://en.wikipedia.org/wiki/The_Winter_Ledger" }) };
  }
  return null;
}
const unknown = (title) => /Nothing Online|Nobody Knows/.test(title);
// The Late Thaw: a plain question finds lines about the season; one that says which work (its country or its
// original title) finds the drama's lines, on Instagram, Pinterest and a page whose site Google does not name.
function lateThaw(prompt) {
  const title = titleIn(prompt);
  if (!/late thaw/i.test(title) || !/^Search the web for (real quotes|the best lines|English quotes)/.test(prompt)) return null;
  const knows = /Chinese|春迟/.test(prompt);
  const lines = knows ? [
    { text: "You don't have to bloom early to be worth the wait.", by: "Xia Lan", from: "The Late Thaw (春迟)", page: "https://www.instagram.com/p/LateThaw01/", also: "" },
    { text: "I kept the window open all winter, in case you came back with the spring.", by: "Lu Yan", from: "The Late Thaw", page: "https://www.tumblr.com/latethaw/7001", also: "" },
    { text: "Some people arrive like spring: late, and all at once.", by: "Xia Lan", from: "The Late Thaw", page: "https://www.instagram.com/p/LateThaw02/", also: "https://www.pinterest.com/pin/880001/" },
    { text: "Spring is the season that forgives the winter for everything.", by: "Unknown", from: "", page: "https://www.pinterest.com/pin/880002/", also: "" },
  ] : [
    { text: "The late thaw is just the earth remembering how to be soft again.", by: "Unknown", from: "", page: "https://www.pinterest.com/pin/880003/", also: "" },
    { text: "Every spring arrives late for someone who waited all winter.", by: "Anonymous", from: "Spring poems", page: "https://www.goodreads.com/quotes/tag/spring", also: "" },
  ];
  const text = JSON.stringify(lines);
  const chunks = knows ? [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/IG1", title: "Instagram" } },
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/PN1", title: "Pinterest" } },
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/XX1", title: "Late Thaw quotes \u273f love lines" } }]
    : [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/PN9", title: "pinterest.com" } }, { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/GR9", title: "goodreads.com" } }];
  const support = (l, idx) => ({ segment: { startIndex: text.indexOf(l.text), endIndex: text.indexOf(l.text) + l.text.length, text: l.text }, groundingChunkIndices: idx });
  const supports = knows ? [support(lines[0], [0]), support(lines[1], [2]), support(lines[2], [0, 1]), support(lines[3], [1])] : [support(lines[0], [0]), support(lines[1], [1])];
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0,
    groundingMetadata: { webSearchQueries: [knows ? "The Late Thaw 2026 Chinese drama quotes" : "the late thaw quotes"], groundingChunks: chunks, groundingSupports: supports } }] };
}
// The lists of models each key may use, in the real shapes (with models the app must not pick among them).
function modelList(who, req, url) {
  listLog.push({ to: who, query: Object.fromEntries(url.searchParams) });
  if (who === "gemini") {
    if (req.headers["x-goog-api-key"] !== GEMINI_KEY || mode.gemini === "badkey") return [400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }];
    if (mode.gemini === "nolist") return [503, { error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } }];
    const m = (name, methods = ["generateContent", "countTokens"]) => ({ name: "models/" + name, baseModelId: name.replace(/-\d{3}$/, ""), version: "001", displayName: name, supportedGenerationMethods: methods });
    return [200, { models: [m("gemini-2.5-flash-preview-tts"), m("gemini-3.1-pro-preview"), m("gemini-3.5-flash-lite"), m("gemini-embedding-001", ["embedContent"]),
      m("gemini-3.8-flash"), m("gemini-3.8-flash-image-preview"), m("imagen-5.0-generate", ["predict"]), m("gemma-4-27b-it")] }];
  }
  if (req.headers.authorization !== "Bearer " + OPENAI_KEY || mode.openai === "refused") return [401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" } }];
  const m = (id, created) => ({ id, object: "model", created, owned_by: "openai" });
  return [200, { object: "list", data: [m("gpt-realtime-2.1", 1770000000), m("gpt-6-astra", 1771000000), m("gpt-image-2.6-flare", 1772000000), m("gpt-6.1-terra", 1773000000),
    m("gpt-6-luna", 1769000000), m("gpt-6.1-sol", 1773500000), m("gpt-transcribe", 1760000000)] }];
}
function gemini(body, model) {
  const fail = (code, status, message) => ({ status: code, body: { error: { code, message, status } } });
  if (mode.gemini === "429") return fail(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details.");
  if (mode.gemini === "refused") return fail(403, "PERMISSION_DENIED", "Grounding with Google Search is not available on the free tier for this project.");
  if (mode.gemini === "gone" && model === "gemini-3.8-flash") return fail(404, "NOT_FOUND", "This model models/gemini-3.8-flash is no longer available to new users. Please update your code to use a newer model.");
  if (mode.gemini === "nosearch" && model === "gemini-3.8-flash") return fail(400, "INVALID_ARGUMENT", "Search Grounding is not supported for this model.");
  const asked = verifyAnswer(body.contents[0].parts[0].text);
  const thaw = !asked && lateThaw(body.contents[0].parts[0].text);
  if (thaw) return { status: 200, body: thaw };
  if (asked) return { status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text: asked.text }] }, finishReason: "STOP", index: 0,
    groundingMetadata: { webSearchQueries: ["who said it"], groundingChunks: asked.sites.map((site, i) => ({ web: { uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/V${i}`, title: site } })), groundingSupports: [] } }] } };
  const title = titleIn(body.contents[0].parts[0].text);
  const lines = unknown(title) ? [] : [
    { text: `Google found this first line from ${title}, word for word.`, by: "Someone in it", from: title, page: "https://www.goodreads.com/work/quotes/1", also: "" },
    { text: `Google found this second line from ${title}, on one page only.`, by: "Someone in it", from: title, page: "https://www.goodreads.com/work/quotes/1", also: "" },
    { text: `This third line about ${title} names a page that was never read.`, by: "", from: title, page: "https://made-up.example.org/quotes", also: "" },
    { text: `Google found this fourth line from ${title}, named on a site it read.`, by: "", from: title, page: "https://www.imdb.com/title/tt1/quotes/", also: "" }];
  const text = "```json\n" + JSON.stringify(lines) + "\n```";
  const answer = { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 200, totalTokenCount: 320 }, modelVersion: model };
  if (mode.gemini !== "memory") {
    answer.candidates[0].groundingMetadata = {
      webSearchQueries: [`"${title}" quotes`], searchEntryPoint: { renderedContent: "<div class=\"container\"></div>" },
      groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAAgoodreads", title: "goodreads.com" } },
        { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBBimdb", title: "imdb.com" } }],
      groundingSupports: lines.slice(0, 2).map((l, i) => ({ segment: { startIndex: text.indexOf(l.text), endIndex: text.indexOf(l.text) + l.text.length, text: l.text }, groundingChunkIndices: i === 0 ? [0, 1] : [0] })),
    };
  }
  return { status: 200, body: answer };
}
function openai(body) {
  const fail = (status, type, message) => ({ status, body: { error: { message, type, param: null, code: type } } });
  if (mode.openai === "429") return fail(429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details.");
  if (mode.openai === "refused") return fail(401, "invalid_api_key", "Incorrect API key provided.");
  if (mode.openai === "nomodel" && body.model === "gpt-6-luna") return fail(400, "invalid_request_error", "Hosted tool 'web_search' is not supported with gpt-6-luna.");
  const asked = verifyAnswer(body.input);
  if (asked) return { status: 200, body: { id: "resp_2", object: "response", status: "completed", model: body.model, output: [
    { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "search", query: "who said it", sources: asked.sites.map((site) => ({ type: "url", url: `https://${site}/a-page` })) } },
    { type: "message", id: "msg_2", status: "completed", role: "assistant", content: [{ type: "output_text", text: asked.text, annotations: [] }] }] } };
  const title = titleIn(body.input);
  const lines = unknown(title) ? [] : [
    { text: `OpenAI found this first line from ${title}, on two sites.`, by: "Someone in it", from: title, page: "https://www.goodreads.com/work/quotes/2", also: "https://www.imdb.com/title/tt2/quotes/" },
    { text: `OpenAI found this second line from ${title}, on one site.`, by: "", from: title, page: "https://www.goodreads.com/work/quotes/2", also: "" },
    { text: `This third line about ${title} names a page that was never opened.`, by: "", from: title, page: "https://made-up.example.org/quotes", also: "" }];
  const text = JSON.stringify(lines);
  return { status: 200, body: { id: "resp_1", object: "response", status: "completed", model: body.model, output: [
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: `"${title}" quotes`,
      sources: [{ type: "url", url: "https://www.goodreads.com/work/quotes/2" }, { type: "url", url: "https://www.imdb.com/title/tt2/quotes/" }] } },
    { type: "message", id: "msg_1", status: "completed", role: "assistant", content: [{ type: "output_text", text,
      annotations: lines.length ? [{ type: "url_citation", start_index: text.indexOf(lines[1].text), end_index: text.indexOf(lines[1].text) + lines[1].text.length, url: "https://www.goodreads.com/work/quotes/2", title: "Quotes" }] : [] }] }] } };
}

// ---------------------------------------------------------------- answering
export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out, type = "application/json") => { res.writeHead(status, { "Content-Type": type }).end(typeof out === "string" ? out : JSON.stringify(out)); return true; };
  if (p === "/__lines_log" && url.searchParams.get("list") === "models") { const was = listLog; if (url.searchParams.get("reset")) listLog = []; return send(200, was); }
  if (p === "/__lines_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (req.method === "GET" && (p === "/__gemini/v1beta/models" || p === "/__openai/v1/models")) return send(...modelList(p.includes("gemini") ? "gemini" : "openai", req, url));
  if (p === "/__lines_set") {
    for (const [k, v] of url.searchParams) if (k in mode) mode[k] = v;
    for (const [k, name, key] of [["gemini", "GEMINI_API_KEY", GEMINI_KEY], ["openai", "OPENAI_API_KEY", OPENAI_KEY]]) { if (mode[k] === "off") delete tools.env[name]; else tools.env[name] = key; }
    return send(200, mode);
  }
  const to = (/^\/__(wikiquote|goodreads|imdbsug|imdb|gemini|openai)\//.exec(p) || [])[1];
  if (!to) return false;
  const entry = { to: to === "imdbsug" ? "imdb" : to, path: p.replace(/^\/__[a-z]+/, ""), query: Object.fromEntries(url.searchParams), agent: req.headers["user-agent"] || "" };
  log.push(entry);
  if (Number(mode.slow) > 0) await new Promise((done) => setTimeout(done, Number(mode.slow)));
  if (to === "wikiquote") return mode.wikiquote === "down" ? send(503, "Service unavailable", "text/plain") : send(200, wikiquote(url));
  if (to === "goodreads" || to === "imdb" || to === "imdbsug") {
    if (mode.sites === "blocked") return send(403, "<html><body>Forbidden</body></html>", "text/html");
    if (to === "imdbsug") {
      const q = norm(decodeURIComponent(p.split("/").pop().replace(/\.json$/, "")));
      return send(200, { d: TITLES.filter((t) => norm(t.l).includes(q)), q, v: 1 });
    }
    if (p.endsWith("/book/auto_complete")) return send(200, BOOKS.filter((b) => norm(b.title).includes(norm(url.searchParams.get("q")))));
    if (mode.sites === "captcha") return send(200, CAPTCHA, "text/html");
    const id = (/\/(?:work\/quotes|title)\/([a-z0-9]+)/.exec(p) || [])[1];
    return send(200, to === "goodreads" ? goodreadsPage(id) : imdbPage(id), "text/html");
  }
  if (req.method === "GET" && (to === "gemini" || to === "openai")) {
    // The health record's check that a key is accepted and its model offered: reading the model costs nothing.
    const model = p.split("/").pop();
    entry.model = model;
    if (to === "gemini") {
      if (req.headers["x-goog-api-key"] !== GEMINI_KEY || mode.gemini === "badkey") return send(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
      if (mode.gemini === "gone" && model === "gemini-3.8-flash") return send(404, { error: { code: 404, message: "models/gemini-3.8-flash is not found", status: "NOT_FOUND" } });
      return send(200, { name: "models/" + model, displayName: model, supportedGenerationMethods: ["generateContent"] });
    }
    if (req.headers.authorization !== "Bearer " + OPENAI_KEY || mode.openai === "refused") return send(401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" } });
    return send(200, { id: model, object: "model", created: 1760000000, owned_by: "openai" });
  }
  const body = JSON.parse((await tools.readBody(req)).toString() || "{}");
  entry.body = body;
  if (to === "gemini") {
    entry.model = (/models\/([^:]+):generateContent$/.exec(p) || [])[1] || "";
    if (req.headers["x-goog-api-key"] !== GEMINI_KEY || mode.gemini === "badkey") return send(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
    const out = gemini(body, entry.model);
    return send(out.status, out.body);
  }
  entry.model = body.model;
  if (req.headers.authorization !== "Bearer " + OPENAI_KEY) return send(401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" } });
  const out = openai(body);
  return send(out.status, out.body);
}
