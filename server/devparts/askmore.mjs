// A pretend Wikiquote page for "Find quotes" (Agent 18): "The Lantern Years", a made-up series with 36 different
// lines, enough to ask for ten and ten again and see only new ones. Every other request goes on to the other
// stand-ins (server/devparts/findlines.mjs answers the rest of Wikiquote). Never part of the real app.
const WHO = ["Edith", "Rafe", "Old Corran", "Mina", "The ferryman", "Isolde"];
const LINES = [
  "A lantern is only brave because someone carried it outside",
  "Grief keeps the house tidy so that nobody notices it lives there",
  "We were never lost, we were just walking in the long way round",
  "Some doors open only after you stop knocking on them",
  "The river forgives the bridge for standing in its way",
  "You cannot hurry a letter that has decided to arrive late",
  "Every winter I promise the garden that I will stay",
  "Kindness is the oldest map in this valley",
  "I kept your chair by the window because the light asked me to",
  "Forgetting is a slow tide and I have learnt to swim in it",
  "Nobody tells you that coming home is its own kind of leaving",
  "The quietest people in this town hold up the loudest roofs",
  "My mother counted stars the way other people counted debts",
  "Hope is a candle that does not care how big the dark is",
  "We sang badly and loudly and it was the best night of the year",
  "Rain on the slate roof sounds like somebody saying stay a while",
  "If you love a place long enough it starts to love you back",
  "The ferry runs on time but the heart never does",
  "A promise made at the harbour weighs more than a ring",
  "Old wounds make the best lanterns because the light gets through",
  "Bread rises whether or not you believe in it",
  "Courage is mostly just staying in the room",
  "The hills do not wait for us but they do remember",
  "I learnt your laugh before I learnt your name",
  "Some silences are full of everything we meant to say",
  "There is no small kindness in a town this size",
  "Winter teaches the patient ones how to be gentle",
  "You can carry a sorrow without letting it choose the road",
  "The stars over the quarry were the only church I needed",
  "Leaving was easy and returning took me twenty years",
  "Even a broken clock is right about the evenings",
  "Love arrived like the tide, a little more every day",
  "Nobody owns the sea, we are only allowed to borrow the crossing",
  "A good goodbye leaves the door a little open",
  "The orchard keeps its secrets until the frost has gone",
  "Every lamp in this window was lit for somebody still walking home",
];
const TITLE = "The Lantern Years (TV series)";
const TEXT = (() => {
  let out = "The Lantern Years (2021–2024) is a British television drama series about a valley town and the people who return to it.\n";
  WHO.forEach((who, w) => {
    out += `\n\n== ${who} ==\n`;
    for (let l = w; l < LINES.length; l += WHO.length) out += LINES[l] + ".\n";
  });
  return out + "\n\n== Cast ==\nHelen Arden — Edith\n\n\n== External links ==\nThe Lantern Years at the Internet Movie Database\n";
})();
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function handle(req, res, url) {
  if (!url.pathname.startsWith("/__wikiquote/")) return false;
  const q = url.searchParams;
  const send = (out) => { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out)); return true; };
  const page = { ns: 0, title: TITLE, pageid: 9900, size: TEXT.length };
  if (q.get("list") === "search" && q.get("srwhat") === "text") {
    const want = norm(q.get("srsearch")).split(" ").slice(0, 5).join(" ");
    if (!want || !norm(TEXT).includes(want)) return false;
    return send({ batchcomplete: true, query: { searchinfo: { totalhits: 1 }, search: [page] } });
  }
  if (q.get("list") === "search") {
    if (!norm(q.get("srsearch")).includes("lantern years")) return false;
    return send({ batchcomplete: true, query: { searchinfo: { totalhits: 1 }, search: [{ ...page, wordcount: TEXT.split(/\s+/).length,
      snippet: `<span class="searchmatch">The Lantern Years</span> ${TEXT.slice(0, 80)}`, timestamp: "2026-10-01T09:00:00Z" }] } });
  }
  if (q.get("titles") !== TITLE) return false;
  return send({ batchcomplete: true, query: { pages: [{ pageid: 9900, ns: 0, title: TITLE, extract: TEXT, categories: [{ ns: 14, title: "Category:2020s television series" }] }] } });
}
