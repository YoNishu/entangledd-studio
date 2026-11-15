// Agent 17: a quote is something said IN the work, never something said ABOUT it (server/said.js), in Node.
// The real shapes: the True Beauty headline from Wikipedia's reference list ("K-dramas based on webtoons hailed by
// TV viewers", The Korea Times), "From the series True Beauty", and for a series, a film and a book: reference
// titles, episode and chapter titles, taglines, review and rating sentences, plot summaries, refused; real lines
// (with and without a speaker, from a quotes page, from a review that quotes a line, a book's sentence) kept.
// Then Claude's judgement (one question, batched, nothing of hers in it) and what stays without Claude.
// Run: node tests/test_a17_unit.mjs
import { kit } from "../server/worker.js";
import { extractLines, pageText, snippetLines, pickLines } from "../server/opensearch.js";
import { isSaid, judge, gate } from "../server/said.js";

let failed = 0, cases = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 400)}`); if (!ok) failed += 1; };
const refused = (name, line, work, ctx = {}, why = null) => { cases += 1; const r = isSaid(line, work, ctx); check(`refused: ${name}${why ? ` (${why})` : ""}`, !r.ok && (!why || r.why === why), r); };
const kept = (name, line, work, ctx = {}) => { cases += 1; const r = isSaid(line, work, ctx); check(`kept: ${name}`, r.ok, r); return r; };

const tb = { title: "True Beauty", real: "True Beauty", type: "series", year: 2020, country: "South Korean", original: "여신강림",
  cast: ["Moon Ga-young", "Cha Eun-woo", "Hwang In-youp"], characters: ["Lim Ju-kyung", "Lee Su-ho", "Han Seo-jun"] };
const es = { title: "The early spring", real: "The Early Spring", type: "series", year: 2026, country: "Chinese", original: "早春晴朗",
  cast: ["Jing Boran", "Sun Qian"], characters: ["Luan Nian", "Shang Zhitao"] };
const film = { title: "Interstellar", real: "Interstellar", type: "film", year: 2014, cast: ["Matthew McConaughey", "Anne Hathaway"], characters: ["Cooper", "Murph", "Brand"] };
const book = { title: "Twisted love", real: "Twisted Love", type: "book", author: "Ana Huang", characters: ["Alex Volkov", "Ava Chen"] };

// ---- 1. the line the owner saw, as the app met it: the reference list of Wikipedia's True Beauty page
const WIKI_HTML = `<html><head><title>True Beauty (South Korean TV series) - Wikipedia</title></head><body>
<h1>True Beauty (South Korean TV series)</h1>
<p><b>True Beauty</b> (Korean: 여신강림) is a 2020–2021 South Korean television series starring Moon Ga-young, Cha Eun-woo and Hwang In-youp.<sup id="cite_ref-4" class="reference"><a href="#cite_note-4">[4]</a></sup> It is based on the webtoon of the same name.</p>
<div class="mw-heading mw-heading2"><h2 id="Synopsis">Synopsis</h2></div>
<p>Lim Ju-kyung is a high school student who becomes a "goddess" with the help of makeup.</p>
<div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
<div class="reflist"><ol class="references">
<li id="cite_note-4"><span class="mw-cite-backlink"><b><a href="#cite_ref-4">^</a></b></span> <span class="reference-text"><cite id="CITEREFKwak2020" class="citation news cs1">Kwak, Yeon-soo (December 16, 2020). <a rel="nofollow" class="external text" href="https://www.koreatimes.co.kr/">"K-dramas based on webtoons hailed by TV viewers"</a>. <i>The Korea Times</i>. Archived from the original on December 27, 2020<span class="reference-accessdate">. Retrieved <span class="nowrap">December 27,</span> 2020</span>.</cite></span></li>
<li id="cite_note-5"><span class="reference-text"><cite class="citation web cs1">Kim, Ji-won (December 1, 2020). <a href="https://example.org/">"'True Beauty' stars feel pressure to satisfy fans with TV adaptation of web comic"</a>. <i>The Korea Herald</i>.</cite></span></li>
</ol></div></body></html>`;
const wikiText = pageText(WIKI_HTML);
check("the reference list, its citations and footnote marks are not page text", !/hailed by TV viewers|feel pressure|\[4\]/.test(wikiText), wikiText);
check("headings stay readable as headings", /^== Synopsis ==$/m.test(wikiText) && /^== References ==$/m.test(wikiText), wikiText);
check("the rest of the page is still there", wikiText.includes("Lim Ju-kyung is a high school student"), wikiText);
// The same page as a search service sends it, already plain text (as Tavily does): the headline is there.
const PLAIN = `True Beauty (Korean: 여신강림) is a 2020–2021 South Korean television series starring Moon Ga-young, Cha Eun-woo and Hwang In-youp.
== Synopsis ==
Lim Ju-kyung is a high school student who becomes a "goddess" with the help of makeup.
== References ==
^ Kwak, Yeon-soo (December 16, 2020). "K-dramas based on webtoons hailed by TV viewers". The Korea Times. Archived from the original on December 27, 2020. Retrieved December 27, 2020.
^ Kim, Ji-won (December 1, 2020). "'True Beauty' stars feel pressure to satisfy fans with TV adaptation of web comic". The Korea Herald.`;
const found = extractLines(PLAIN, { names: [...tb.cast, ...tb.characters] });
const headline = found.find((l) => l.text.startsWith("K-dramas based on webtoons"));
check("the extractor alone still takes the headline for a line (the hole: it passes spanOk)", !!headline, found.map((l) => l.text));
check("and knows where it sat: under References, a publisher and a date after it", headline && headline.ctx.part === "References" && /Korea Times/.test(headline.ctx.after), headline && headline.ctx);
refused("the True Beauty headline, where it sat", headline || "K-dramas based on webtoons hailed by TV viewers", tb, headline ? { ...headline.ctx, place: "page" } : {}, "a citation");
refused("the True Beauty headline, with nothing known of where it sat", "K-dramas based on webtoons hailed by TV viewers", tb, {}, "about the work");
refused("the headline as a citation outside a references part", "K-dramas based on webtoons hailed by TV viewers", tb, { before: "Kwak, Yeon-soo (December 16, 2020). ", after: ". The Korea Times. Retrieved December 27, 2020.", place: "page" }, "a citation");
refused("the label under a card, \"From the series True Beauty\"", "From the series True Beauty", tb, {}, "a label");
refused("the title alone", "True Beauty", tb, {}, "a label");
const other = found.find((l) => /feel pressure/.test(l.text));
refused("another reference title (series)", other || "'True Beauty' stars feel pressure to satisfy fans with TV adaptation of web comic", tb, other ? { ...other.ctx, place: "page" } : {});
refused("a list title", "The 25 Best K-Dramas on Viki", tb, { place: "page" });
refused("an episode title (series)", "The day I met you, everything changed", tb, { before: "Episode 3: “", after: "”", place: "page" }, "an episode title");
refused("a tagline (series)", "Beauty is only skin deep, but love goes all the way down.", tb, { before: "The poster's tagline reads “", place: "page" }, "a tagline");
refused("a synopsis sentence (series)", "Lim Ju-kyung is a high school student who becomes a goddess with the help of makeup.", tb, { place: "page" }, "a synopsis");
refused("a line from the plot part of a page (series)", "Ju-kyung transfers to a new school and hides her bare face from everyone.", tb, { part: "Synopsis", place: "page" }, "a synopsis");
refused("a review sentence (series)", "The chemistry between the leads is unreal, a 10/10 for me.", tb, { place: "mdl" });
refused("a rating sentence (series)", "I would give it 4.5 stars for the acting alone.", tb, { place: "mdl" }, "a review");
refused("words about its actors (series)", "Moon Ga-young shines as Lim Ju-kyung in every single scene.", tb, { place: "page" }, "names its actors");
refused("a line that names the work (series)", "Watching True Beauty made me believe in second chances again.", tb, { place: "page" });
refused("a reference title (film)", "Interstellar review: Christopher Nolan's space epic", film, { before: "Bradshaw, Peter (6 November 2014). ", after: ". The Guardian. Retrieved 10 November 2014.", place: "page" }, "a citation");
refused("a tagline (film)", "The end of Earth will not be the end of us.", film, { part: "Taglines", place: "page" }, "a tagline");
refused("a synopsis sentence (film)", "Interstellar is a 2014 epic science fiction film directed by Christopher Nolan.", film, { place: "helper" });
refused("a review sentence (film)", "A must-watch for anyone who loves science fiction and big ideas.", film, { place: "page" }, "about the work");
refused("trivia (film)", "Matthew McConaughey learned to fly a plane for his part as the pilot.", film, { part: "Trivia", place: "page" });
refused("a reference (book)", "Twisted Love", book, { before: "Huang, Ana (2021). ", after: ". Bloom Books. ISBN 978-1-7354-0000-0.", place: "page" });
refused("a review sentence (book)", "This book broke me in the best way, five stars.", book, { place: "page" });
refused("a synopsis sentence (book)", "Twisted Love is a contemporary romance novel about Alex Volkov and Ava Chen.", book, { place: "helper" });
refused("a chapter title (book)", "The night everything burned down around us", book, { before: "Chapter 12: \"", after: "\"", place: "page" }, "an episode title");
refused("a blurb (book)", "He has a heart of ice. But for her, he would burn the world.", book, { part: "Description", place: "page" }, "a synopsis");

// ---- 2. real lines are kept
const ju = kept("a character's line with her name before it (series)", { text: "I want to be loved for who I am, not for my face.", by: "Lim Ju-kyung" }, tb, { place: "page" });
check("  and a named character is proof on its own", ju.proof === true, ju);
const plain = kept("a quoted line in a review, nobody named (series)", "You don't have to be pretty to be loved, you just have to be you.", tb, { before: "My favourite line: ", after: " and then the rain started.", place: "page", quoted: true });
check("  with no proof of its own: it waits for the judge", plain.proof === false, plain);
const mdl = kept("a line quoted in a review on the work's own MyDramaList page", "Some things only grow when no one is watching them.", es, { place: "mdl", quoted: true });
check("  which is proof on its own", mdl.proof === true, mdl);
kept("a line with its speaker after it", { text: "I'll protect you, whatever it takes.", by: "Lee Su-ho" }, tb, { after: " Su-ho says.", place: "page", quoted: true });
const wq = kept("a quotes page's own list item (film)", { text: "Mankind was born on Earth. It was never meant to die here.", by: "Cooper" }, film, { part: "Cooper", place: "quotes" });
check("  a quotes page's own list is proof", wq.proof === true, wq);
kept("an IMDb exchange line (film)", { text: "Do not go gentle into that good night.", by: "Professor Brand" }, film, { place: "quotes" });
kept("a line about stars that is no rating (film)", "We used to look up at the sky and wonder at our place in the stars.", film, { place: "quotes" });
kept("a famous film line that says 'critic'", "In many ways, the work of a critic is easy.", null, { place: "helper", by: "Anton Ego" });
const gr = kept("a Goodreads quote, the book's own sentence", { text: "Deep love. Tell me who or what I need to kill.", by: "Ana Huang" }, book, { place: "quotes" });
check("  a quotes page's list is proof for a book too", gr.proof === true, gr);
kept("a book's opening sentence that says 'is a'", "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", { title: "Pride and Prejudice", type: "book", author: "Jane Austen" }, { place: "quotes" });
kept("the title's words in a line, as words (The Early Spring)", "Their love survived the bitter winter, and finally welcomed the early spring.", es, { place: "mdl", quoted: true });
kept("a line that says 'season' as a season", "In the height of summer, there are no ice sculptures.", es, { place: "mdl", quoted: true });
kept("a line that says 'drama' as a word", "Spare me the drama, I only came to say goodbye.", tb, { place: "page", quoted: true });
kept("a line that says 'seasons'", "The seasons change, but I stay right here with you.", es, { place: "page", quoted: true });
kept("a one-word title at the start of a sentence is a word", "Home is wherever you are standing when it rains.", { title: "Home", type: "film" }, { place: "page", quoted: true });
refused("a one-word title inside a sentence names the work", "I watched Home three times and cried each time.", { title: "Home", type: "film" }, { place: "page", quoted: true }, "about the work");

// No real line lost from what the earlier tests keep (test_a13_unit's real review shapes).
const review = "Story 8.0 Acting/Cast 9.0 This review may contain spoilers You don't have to be perfect to be worthy of love.. Oh man, the moral puzzle.. "
  + "Luan Nian: You don’t have to be perfect to be worthy of love. Shang Zhi Tao: As much as I longed for love, I was still struggling with reality. 💗The Reconciliation💗 "
  + "It was all so perfect! \"Their love survived the bitter winter, and finally welcomed the early spring. From there through the blazing summer, they entered the brightest season of their lives. And that warmth will never fade.\" 💗";
const real = 'He asks, "Can you control your feelings of love?" Then: "In the height of summer, there are no ice sculptures."\n'
  + 'Favourite line: "You don\'t have to be perfect to be worthy love." and later Luan Nian: You don\'t have to be perfect to be worthy of love.';
const earlier = [...extractLines(review, { names: [...es.cast, ...es.characters] }), ...extractLines(real, { names: [...es.cast, ...es.characters] })];
const lost = earlier.filter((l) => !isSaid(l, es, { ...l.ctx, place: "mdl" }).ok);
check(`none of the ${earlier.length} lines the earlier tests keep from real review pages is refused`, earlier.length >= 5 && !lost.length, lost);
const wqPage = extractLines("Interstellar is a 2014 science fiction film about astronauts and a wormhole near Saturn.\n== Cooper ==\nMankind was born on Earth. It was never meant to die here.\n[to Murph] I don't care much for this, pretending we're back where we started.\n== Season 1 ==\nA line under a season heading, with nobody named.", { list: true });
check("Wikiquote's own lines all pass, as its own list", wqPage.length === 3 && wqPage.every((l) => isSaid(l, film, { ...l.ctx, place: "quotes" }).ok), wqPage);

// ---- 2b. real cases, as the pages had them on 15 Nov 2026: a film (Interstellar) and a book (Twisted Love)
const FILM_PAGE = `Interstellar is a 2014 epic science fiction film directed by Christopher Nolan.
== Plot ==
In the near future, humanity faces extinction due to dust storms and widespread crop blights.
== Reception ==
Scott Foundas of Variety said the film is "as visually and conceptually audacious as anything Nolan has yet done." James Berardinelli called Interstellar "an amazing achievement."
== Taglines ==
"Mankind's next step will be our greatest."
== References ==
^ Fernandez, Jay A. (March 28, 2007). "Writer with real stars in his eyes". Los Angeles Times. Retrieved May 14, 2014.
^ Fleming, Michael (June 14, 2006). "Space chase pic on Par launch pad". Variety. Retrieved October 1, 2014.
^ Lawson, Richard (December 11, 2024). "So, Is 'Interstellar' a Masterpiece or Not?". Vanity Fair. Retrieved April 22, 2026.
^ Clery, Daniel (November 6, 2014). "Physicist who inspired Interstellar spills the backstory—and the scene that makes him cringe". sciencemag.org. Retrieved December 31, 2015.`;
const filmFound = extractLines(FILM_PAGE, { names: [...film.cast, ...film.characters] });
check("film: the old reader takes Wikipedia's reference titles for Interstellar's lines too (the same hole)", filmFound.some((l) => l.text === "Writer with real stars in his eyes"), filmFound.map((l) => l.text));
const filmPass = filmFound.filter((l) => isSaid(l, film, { ...l.ctx, place: "page" }).ok);
cases += filmFound.length;
check(`film: none of the ${filmFound.length} candidates on its Wikipedia page passes (references, tagline, reception)`, filmFound.length >= 4 && filmPass.length === 0, filmPass.map((l) => l.text));
refused("film: the plot's first sentence, where it sat", "In the near future, humanity faces extinction due to dust storms and widespread crop blights.", film, { part: "Plot", place: "page" }, "a synopsis");
refused("film: a reference title that names the film, even with nothing around it", "Inside 'Interstellar,' Christopher Nolan's emotional space odyssey", film, { place: "helper" });
for (const [by, text] of [["Cooper", "This world's a treasure, but it's been telling us to leave for a while now."], ["Cooper", "Once you're a parent, you're the ghost of your children's future."],
  ["Amelia Brand", "Love is the one thing that transcends time and space."], ["TARS", "I have a cue light I can use to show you when I'm joking, if you like."],
  ["Cooper", "Murphy's law doesn't mean that something bad will happen. It means that whatever can happen will happen."]]) {
  kept(`film: Wikiquote's line, on its page (${by})`, { text, by }, film, { place: "quotes" });
  kept(`film: the same line from a search answer, with no page around it (${by})`, { text, by }, film, { place: "helper" });
}
for (const text of ["If you wanted, I would burn down the world for you.", "If you let lesser people determine your self-worth, you'll never reach higher than their limited imagination.",
  "You don't have to work overtime to get people to love you, Ava. Love isn't earned, it's given.", "That's my girl. Hate me. Don't cry over me. Never cry over me. I'm not worth it.",
  "I'd do anything for you. No matter how twisted or impossible.", "Consider it a lesson for the future. Pretty words and pretty faces don't equal pretty souls."]) {
  kept(`book: Goodreads' line "${text.slice(0, 30)}...", on its page`, { text, by: "Ana Huang" }, book, { place: "quotes" });
  kept(`book: the same line from a search answer`, { text, by: "Ana Huang" }, book, { place: "helper" });
}

// ---- 3. two search snippets that carry the same headline are no line either
const snip = snippetLines(kit, [
  { url: "https://a.example/tb", host: "a.example", title: "True Beauty (2020) cast", snippet: 'Kwak (December 16, 2020). "K-dramas based on webtoons hailed by TV viewers". The Korea Times. True Beauty with Moon Ga-young' },
  { url: "https://b.example/tb", host: "b.example", title: "True Beauty drama", snippet: '"K-dramas based on webtoons hailed by TV viewers". True Beauty, with Moon Ga-young, 2020' },
  { url: "https://a.example/q", host: "a.example", title: "True Beauty quotes, Moon Ga-young", snippet: '"I want to be loved for who I am, not for my face." said Ju-kyung' },
  { url: "https://b.example/q", host: "b.example", title: "True Beauty lines 2020", snippet: 'best: "I want to be loved for who I am, not for my face."' },
], tb, new Set(), {});
check("snippets: the headline two sites carry is refused, the real line two sites carry stays", snip.length === 1 && snip[0].text.startsWith("I want to be loved"), snip.map((l) => l.text));

// ---- 4. the whole web path without Claude picking: the page with a references list gives nothing from it
const pages = [{ url: "https://en.wikipedia.org/wiki/True_Beauty", site: "en.wikipedia.org", title: "True Beauty (South Korean TV series)", head: "True Beauty", text: PLAIN + "\n== Reception ==\nCritics wrote: \"A sparkling rom-com that never takes itself too seriously.\"" }];
const noPick = { ...kit, claude: async () => "[]" };
const tally = {};
const got = await pickLines({}, noPick, pages, { work: tb, want: 8, have: new Set(), near: ["True Beauty"], refused: tally });
check("a page with a references list: nothing from it is offered", got.lines.length === 0, got.lines.map((l) => l.text));
check("and the refusals are counted by reason", (tally["a citation"] || 0) >= 1 && (tally["about the work"] || 0) >= 1, tally);

// ---- 5. Claude's judgement: one question for all, nothing of hers, only "said" and "narration" stay
const asked = [];
const judgeKit = (answer) => ({ ...kit, claude: async (env, req) => { asked.push(req); if (answer instanceof Error) throw answer; return JSON.stringify(answer); } });
const cand = [
  { text: "I want to be loved for who I am, not for my face.", by: "Lim Ju-kyung", ctx: { place: "page" } },
  { text: "A sparkling story that never takes itself too seriously.", by: "", ctx: { place: "page", quoted: true } },
  { text: "Maybe the mirror was never the problem.", by: "", ctx: { place: "page", quoted: true } },
  { text: "Every morning I become someone braver than I feel.", by: "", ctx: { place: "page", quoted: true } },
];
const env = { ANTHROPIC_API_KEY: "test" };
const state = { spent: 0 };
const j = await judge(env, judgeKit([{ n: 1, is: "said" }, { n: 2, is: "about" }, { n: 3, is: "unsure" }, { n: 4, is: "narration" }]), tb, cand, { state });
check("one question to Claude for the whole batch", asked.length === 1, asked.length);
check("only 'said' and 'narration' stay, each marked so it is never judged again", j.kept.map((l) => l.is).join(",") === "said,narration" && j.kept.every((l) => !l.ctx), j.kept);
check("the rest counted by reason", j.refused["judged about the work"] === 1 && j.refused["judged unsure"] === 1, j.refused);
check("the question costs the look-up its calls", state.spent === 2, state);
const content = asked[0].messages[0].content;
check("the question holds only the work's public title and kind, and the lines", content.startsWith('Work: the 2020 South Korean TV series "True Beauty"') && content.includes('1. "I want to be loved') && !/taste|loves|avoids|herNotes|Dhruuu/i.test(content), content);
check("the judge's rules: said, narration, about, unsure", /"said"/.test(asked[0].system) && /"narration"/.test(asked[0].system) && /"about"/.test(asked[0].system) && /"unsure"/.test(asked[0].system), asked[0].system);
asked.length = 0;
const down = await judge(env, judgeKit(new kit.UserError(429, "resting")), tb, [...cand, { text: "Mankind was born on Earth. It was never meant to die here.", by: "Cooper", ctx: { place: "quotes" } }]);
check("Claude cannot be asked: only lines with proof in the page's structure stay", down.how === "structure" && down.kept.map((l) => l.text).join("|") === "I want to be loved for who I am, not for my face.|Mankind was born on Earth. It was never meant to die here." && down.kept.every((l) => l.is === "structure"), down);
check("  the rest marked out, counted", down.refused["no proof without nishiii"] === 3, down.refused);
const nokey = await judge({}, judgeKit([]), tb, cand);
check("no key at all: the same, and no question sent", nokey.how === "structure" && asked.length === 1 && nokey.kept.length === 1, { nokey, n: asked.length });
const both = await gate(env, judgeKit([{ n: 1, is: "said" }]), tb, [{ text: "K-dramas based on webtoons hailed by TV viewers", ctx: {} }, cand[0]]);
check("gate(): the cheap refusals first, then the judge for what is left", both.kept.length === 1 && both.refused["about the work"] === 1, both);

console.log(`\n${cases} cases of lines, refused and kept.`);
check("at least 25 cases, both ways", cases >= 25, cases);
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
