// Pretend versions of the places server/verify.js looks things up: Quote Investigator (its WordPress search and
// articles), Wikipedia's search with short descriptions, and Open Library's book search. Loaded by
// server/dev.mjs; never part of the real app. Every person, line and work here is made up; only the shapes of
// the answers are the real services' shapes.
//
//   VERIFY=ok|down               how all three answer (down: 503 for everything)
//   GET /__verify_set?mode=ok|down|blocked&slow=700   changes that while running (blocked: 403; slow: milliseconds before each answer)
//   GET /__verify_log            every request these pretend services received (?reset=1 empties it)
const mode = { mode: process.env.VERIFY || "ok", slow: "0" };
let log = [];

export function env(PORT) {
  const at = `http://localhost:${PORT}`;
  return { QUOTEINV_SITE: at + "/__qi", WIKIPEDIA_API: at + "/__wikipedia", OPENLIBRARY_SITE: at + "/__openlibrary" };
}

const norm = (t) => String(t || "").toLowerCase().replace(/&#8217;|&rsquo;/g, "'").replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------- Quote Investigator
const ARTICLES = [
  { id: 41001, slug: "2019/05/02/tide-kindness", title: "Kindness Is the Only Language the Tide Understands",
    body: `<p>Dear Quote Investigator: A line about kindness and the tide is credited online to the poet Edda Marlowe. Is that right?</p>
<p>Quote Investigator: QI found no match in anything Marlowe published. The earliest match is a greeting card of 2011.</p>
<p>In conclusion, the saying is really by Pell Arden, who wrote it for a greeting card in 2011. Marlowe did not write it; the credit to her appeared in 2015.</p>` },
  { id: 41002, slug: "2021/08/09/small-door", title: "Quote Origin: A Small Door Is Still a Door",
    body: `<p>Dear Quote Investigator: People say "A small door is still a door" and credit it to the novelist Tomas Reyna. Did he say it?</p>
<p>The words appear in his novel of 1984, chapter three, spoken by the ferryman.</p>
<p>In conclusion, QI believes Tomas Reyna should receive credit for this line. It appeared in his 1984 novel.</p>` },
];
function qi(url, p) {
  if (p === "/wp-json/wp/v2/search") {
    const want = norm(url.searchParams.get("search")).split(" ");
    const hits = ARTICLES.filter((a) => want.every((w) => norm(a.title + " " + a.body).split(" ").includes(w)));
    return hits.slice(0, Number(url.searchParams.get("per_page")) || 10).map((a) => ({ id: a.id, title: a.title.replace(/'/g, "&#8217;"), url: `https://quoteinvestigator.com/${a.slug}/`, type: "post", subtype: "post",
      _links: { self: [{ embeddable: true, href: `https://quoteinvestigator.com/wp-json/wp/v2/posts/${a.id}` }] } }));
  }
  const id = Number((/^\/wp-json\/wp\/v2\/posts\/(\d+)$/.exec(p) || [])[1]);
  const a = ARTICLES.find((x) => x.id === id);
  return a ? { title: { rendered: a.title }, link: `https://quoteinvestigator.com/${a.slug}/`, content: { rendered: a.body + "<p>" + "Notes and citations. ".repeat(20) + "</p>", protected: false } } : null;
}

// ---------------------------------------------------------------- Wikipedia: search with short descriptions
const PAGES = [
  { title: "Glass Rivers", description: "2014 novel by Ana Vale" },
  { title: "The Long Tide (film)", description: "2016 drama film by Odile Marchetti" },
  { title: "The Long Tide (novel)", description: "2009 novel by Jonas Reed" },
  { title: "Harbour Lights (TV series)", description: "Norwegian television drama series (2020–2023)" },
  { title: "Small Hours", description: "2019 drama film by Ilse Brandt" },
  { title: "Long Tide", description: "Disambiguation page providing links to topics that could be referred to by the same term" },
  // Two works of one name, as Wikipedia has them: the older with a short description, the new one with none yet
  // (a new page often has none), so its opening words must say what it is.
  { title: "The Quiet Orchard (2011 TV series)", description: "Taiwanese television series", extract: "The Quiet Orchard is a 2011 Taiwanese television series starring Chen Hao." },
  { title: "The Quiet Orchard", description: "", extract: "The Quiet Orchard (Chinese: 静果园; pinyin: Jìng Guǒ Yuán) is a 2026 Chinese television series starring Wen Lu and Bai Qing. It is adapted from a web novel.",
    full: "The Quiet Orchard (Chinese: 静果园; pinyin: Jìng Guǒ Yuán) is a 2026 Chinese television series starring Wen Lu and Bai Qing. It is adapted from a web novel.\n\n== Synopsis ==\nA letter writer returns to her family's orchard.\n\n== Cast ==\nWen Lu as Jiang Yu / June\nA letter writer.\nBai Qing as Lin Qing\nZhou Ke as Old Mo\n\n== Release ==\nThe series premiered on Youku on 3 October 2026." },
];
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function wikipedia(url) {
  const q = url.searchParams;
  // One page's whole text (prop=extracts with titles=).
  if (q.get("titles")) {
    const p = PAGES.find((x) => x.title === q.get("titles"));
    return { batchcomplete: true, query: { pages: [p ? { pageid: 7000 + PAGES.indexOf(p), ns: 0, title: p.title, extract: p.full || p.extract || "" } : { ns: 0, title: q.get("titles"), missing: true }] } };
  }
  // As the real search does with no exact hit, a title spelt a little wrong still finds its page.
  const want = norm(q.get("gsrsearch")).replace(/ (novel|film|tv series)$/, "");
  const extracts = /extracts/.test(q.get("prop") || "");
  const bare = (t) => norm(t.replace(/\s*\(.*\)$/, ""));
  const hits = PAGES.filter((p) => want.includes(bare(p.title)) || distance(want, bare(p.title)) <= 2);
  if (!hits.length) return { batchcomplete: true };
  return { batchcomplete: true, query: { pages: hits.map((p, i) => ({ pageid: 7000 + PAGES.indexOf(p), ns: 0, title: p.title, index: i + 1, description: p.description, descriptionsource: "central", ...(extracts && p.extract ? { extract: p.extract } : {}) })) } };
}

// ---------------------------------------------------------------- Open Library: book search
const BOOKS = [
  { key: "/works/OL4001W", title: "Glass Rivers", author_name: ["Ana Vale"], first_publish_year: 2014 },
  { key: "/works/OL4002W", title: "The Salt Road", author_name: ["Mira Kessel"], first_publish_year: 2021 },
  { key: "/works/OL4003W", title: "The Salt Road", author_name: ["Tom Brandt"], first_publish_year: 1962 },
];
function openLibrary(url) {
  const q = url.searchParams, title = norm(q.get("title")), author = norm(q.get("author"));
  const docs = BOOKS.filter((b) => norm(b.title).includes(title) && (!author || norm(b.author_name.join(" ")).includes(author.split(" ").pop())));
  return { numFound: docs.length, start: 0, numFoundExact: true, docs, q: "", offset: null };
}

export async function handle(req, res, url, tools) {
  const p = url.pathname;
  const send = (status, out, type = "application/json") => { res.writeHead(status, { "Content-Type": type }).end(typeof out === "string" ? out : JSON.stringify(out)); return true; };
  if (p === "/__verify_log") { const was = log; if (url.searchParams.get("reset")) log = []; return send(200, was); }
  if (p === "/__verify_set") { for (const [k, v] of url.searchParams) if (k in mode) mode[k] = v; return send(200, mode); }
  const to = (/^\/__(qi|wikipedia|openlibrary)(\/.*)$/.exec(p) || []);
  if (!to[1]) return false;
  log.push({ to: to[1], path: to[2], query: Object.fromEntries(url.searchParams), agent: req.headers["user-agent"] || "" });
  if (Number(mode.slow) > 0) await new Promise((done) => setTimeout(done, Number(mode.slow)));
  if (mode.mode === "down") return send(503, "Service unavailable", "text/plain");
  if (mode.mode === "blocked") return send(403, "<html><body>Forbidden</body></html>", "text/html");
  if (to[1] === "qi") { const out = qi(url, to[2]); return out ? send(200, out) : send(404, { code: "rest_post_invalid_id", message: "Invalid post ID.", data: { status: 404 } }); }
  if (to[1] === "wikipedia") return send(200, wikipedia(url));
  return send(200, openLibrary(url));
}
