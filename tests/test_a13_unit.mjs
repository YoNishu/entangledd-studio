// Agent 13: the pieces that make "quotes from a new series" work on real pages, in Node, from the shapes seen on
// the live run (tests/live): words compared the way pages differ; lines found on a page without Claude; which
// page is about the work; what Wikipedia's opening words and cast list tell; MyDramaList's search page; Bing's
// RSS; the queries; a "prove you are human" page told from a big real page; the coarse record for /api/health.
import { kit } from "../server/worker.js";
import { sameWords, onPage, extractLines, namesWork, readMdlSearch, mdlPick, readBingRss, queriesFor, agrees } from "../server/opensearch.js";
import { factsIn, wikiQueries } from "../server/verify.js";
import { coarseText } from "../server/findlines.js";

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 400)}`); if (!ok) failed += 1; };

// ---- the same words, whatever the marks
const review = "Story 8.0 Acting/Cast 9.0 This review may contain spoilers You don't have to be perfect to be worthy of love.. Oh man, the moral puzzle.. "
  + "Luan Nian: You don’t have to be perfect to be worthy of love. Shang Zhi Tao: As much as I longed for love, I was still struggling with reality. 💗The Reconciliation💗 "
  + "It was all so perfect! \"Their love survived the bitter winter, and finally welcomed the early spring. From there through the blazing summer, they entered the brightest season of their lives. And that warmth will never fade.\" 💗 "
  + "“Spring is the time of plans and projects.” — Leo Tolstoy";
const words = sameWords(review);
check("a curly apostrophe on the page matches a straight one in the line", onPage(words, "You don't have to be perfect to be worthy of love."));
check("dashes, ellipses, non-breaking and repeated spaces, and case do not matter", onPage(sameWords("Wait… it’s  you — always you"), "wait... it's you - ALWAYS you"));
check("words that are not on the page do not match", !onPage(words, "You have to be perfect to be loved."));

// ---- lines without Claude, from a review page in the real layout
const names = ["Luan Nian", "Shang Zhitao", "Jing Boran", "Sun Qian"];
const got = extractLines(review, { names });
const by = Object.fromEntries(got.map((l) => [l.text, l]));
check("a known character's line in the middle of a review, with the speaker", by["You don’t have to be perfect to be worthy of love."]?.by === "Luan Nian", got);
check("a name the page spells with another space is still the character", by["As much as I longed for love, I was still struggling with reality."]?.by === "Shang Zhitao", got);
check("a quoted passage of three sentences is one line", !!by["Their love survived the bitter winter, and finally welcomed the early spring. From there through the blazing summer, they entered the brightest season of their lives. And that warmth will never fade."], got);
check("a line credited after a dash to someone else is marked as theirs", by["Spring is the time of plans and projects."]?.other === "Leo Tolstoy", got);
check("labels such as 'Story 8.0' and review titles are not lines", !got.some((l) => /^(8\.0|Acting)/.test(l.text)), got.map((l) => l.text));
const recap = "Notable Actors\nJing Bo Ran : Luan Nian\nRating: 9 out of 10 for this whole drama\nLuan Nian: Nobody walks you home unless they want to.\nEpisode 3: The day everything changed for them all";
const r = extractLines(recap, { names });
check("'Speaker: line' on a line of its own, but not 'Rating:' or 'Episode 3:'", r.length === 1 && r[0].text === "Nobody walks you home unless they want to." && r[0].by === "Luan Nian", r);
const nested = extractLines("“Deep love. \"Tell me who or what I need to kill,\" he said and then left the room.” ― Ana Huang", {});
check("dialogue inside a longer quote is not a line of its own", nested.length === 1 && nested[0].text.startsWith("Deep love."), nested);
const wq = extractLines("Interstellar is a 2014 science fiction film about astronauts and a wormhole near Saturn.\n== Cooper ==\nMankind was born on Earth. It was never meant to die here.\n[to Murph] I don't care much for this, pretending we're back where we started.\n== Season 1 ==\nA line under a season heading, with nobody named.", { list: true });
check("Wikiquote's own pages: each line under a character's heading, not the opening description", wq.length === 3 && wq[0].by === "Cooper" && !wq.some((l) => l.text.startsWith("Interstellar is")), wq);
check("a stage direction in brackets is left off the line", wq[1] && wq[1].text.startsWith("I don't care much"), wq);
check("a season heading is not a speaker", wq[2] && wq[2].by === "", wq);

// ---- the real reviews page (live run 2): words between two quotations, a reviewer's sentence, two wordings
const real = 'The Chinese title "Zao Chun" means early spring as it is missing from their relationship, and it could also be for "Qing Lang", bright and clear in the romantic sense, and maybe that is why it was translated as "Early Spring" here.\n'
  + 'The opening "weather is chilly, and overcast. It is unpredictable and mirrors the six years of intense misunderstandings." sets the tone.\n'
  + 'Favourite line: "You don\'t have to be perfect to be worthy love." and later Luan Nian: You don\'t have to be perfect to be worthy of love. He repeats it: "You don\'t have to be perfect to be worthy of love."\n'
  + 'He asks, "Can you control your feelings of love?" Then: "In the height of summer, there are no ice sculptures."';
const rl = extractLines(real, { names });
const rt = rl.map((l) => l.text);
check("never the words between two quotations", !rt.some((t) => /missing from their relationship|translated as/.test(t)), rt);
check("never a quoted piece that starts in the middle of a sentence", !rt.some((t) => /^weather/.test(t)), rt);
check("of two wordings of one line, the one the page has more often", rt.includes("You don't have to be perfect to be worthy of love.") && !rt.includes("You don't have to be perfect to be worthy love."), rt);
check("real quoted lines stay, and 'He' is no speaker", rt.includes("In the height of summer, there are no ice sculptures.") && (rl.find((l) => l.text.startsWith("Can you control")) || {}).by === "", rl);

// ---- which page is about the work
const work = { title: "The early spring", real: "The Early Spring", original: "早春晴朗", year: 2026, country: "Chinese", type: "series",
  cast: ["Jing Boran", "Sun Qian"], characters: ["Luan Nian", "Shang Zhitao"], aka: ["Zao Chun Qing Lang", "Bright Early Spring"], network: "Youku" };
const bare = { ...work, original: "" };
check("the title with a character's name is the work", namesWork(kit, bare, "The Early Spring: Luan Nian is my favourite"));
check("the title with the network is the work", namesWork(kit, bare, "The Early Spring, now on Youku"));
check("the title in the page's own title and address, with the kind of work, is the work", namesWork(kit, bare, "Early spring review, episode by episode", { title: "", head: "Recap", url: "https://blog.example/2026/08/the-early-spring.html" }));
check("the romanised title in MyDramaList's address counts as the title", namesWork(kit, bare, "Zao Chun Qing Lang reviews, a drama I loved", { url: "https://mydramalist.com/761231-zao-chun-qing-lang/reviews" }));
check("a page of quotes about the season is not the work", !namesWork(kit, bare, "Early spring quotes to welcome the season: 50 sayings about early spring and new beginnings"));
check("nor is a page that only says the title and 'drama' when more is known", !namesWork(kit, bare, "The early spring drama of the garden"));

// ---- what Wikipedia's page says
const intro = "The Early Spring (Chinese: 早春晴朗; pinyin: Zǎo Chūn Qíng Lǎng) is a 2026 Chinese television series starring Jing Boran and Sun Qian. It is adapted from the web novel of the same name.";
const full = intro + "\n\n== Cast ==\nJing Boran as Luan Nian / Luke\nA top-tier advertising executive.\nSun Qian as Shang Zhitao / Flora\nZhao Zhenyu as Tan Mian\n\n== Release ==\nIt will be distributed internationally via Youku's global streaming service.";
const f1 = factsIn(kit, intro), f2 = factsIn(kit, full, true);
check("the original title, the romanised one and the leads, from the opening", f1.original === "早春晴朗" && f1.aka.includes("Zao Chun Qing Lang") && f1.cast.join() === "Jing Boran,Sun Qian", f1);
check("the characters and the network, from the whole page", f2.characters.join() === "Luan Nian,Shang Zhitao,Tan Mian" && f2.network === "Youku" && f2.cast.includes("Zhao Zhenyu"), f2);
check("a romanised title with no 'pinyin:' before it", (factsIn(kit, "The Late Thaw (春迟; Chūn Chí) is a 2026 Chinese drama.").aka || []).includes("Chun Chi"));
const wqs = wikiQueries({ title: "the early spring cdrama" }, "series");
check("the title is searched without 'cdrama', with the kind, then with the kind in brackets", wqs[0] === "the early spring TV series" && wqs[1] === "The Early Spring (TV series)", wqs);

// ---- MyDramaList's search page
const mdl = `<div class="box"><a href="/761231-zao-chun-qing-lang" class="block"><img alt="x"></a><h6 class="text-primary title"><a href="/761231-zao-chun-qing-lang">The Early Spring</a></h6><span class="text-muted">Chinese Drama - 2026, 24 episodes</span></div>`
  + `<div class="box"><h6 class="title"><a href="https://mydramalist.com/5501-early-spring">Early Spring</a></h6><span>Japanese Movie - 1956</span></div>`;
const list = readMdlSearch(mdl);
check("MyDramaList's search: each work's address, title and year", list.length === 2 && list[0].path === "/761231-zao-chun-qing-lang" && list[0].year === 2026 && list[1].year === 1956, list);
check("the entry with her title and its year is chosen", mdlPick(kit, work, list)?.path === "/761231-zao-chun-qing-lang");
check("an entry of another year is not", mdlPick(kit, { ...work, year: 2019 }, list) === null);
const mdl2 = readMdlSearch(`<a href="/735043-life" class="block"><img class="img-responsive cover lazy" data-src="x.jpg" alt="When Life Gives You Tangerines"/></a> #5 <h6 class="title"><a href="/735043-life">When Life Gives You Tangerines</a></h6><span class="text-muted">Korean Drama - 2025, 16 episodes</span>`);
check("MyDramaList's search: the title from the cover's alt text when the address says little", mdl2.length === 1 && mdl2[0].title === "When Life Gives You Tangerines" && mdl2[0].year === 2025, mdl2);
check("a Korean original title with a space is kept whole", factsIn(kit, "When Life Gives You Tangerines (Korean: 폭싹 속았수다; RR: Pokssak sogatsuda) is a 2025 South Korean television series.").original === "폭싹 속았수다");
check("an entry found by its romanised title in the address", mdlPick(kit, { ...work, real: "Bright and Clear" }, [{ path: "/761231-zao-chun-qing-lang", slug: "zao-chun-qing-lang", title: "早春晴朗", year: 2026 }])?.slug === "zao-chun-qing-lang");

// ---- Bing's RSS, and the queries
const rss = readBingRss(`<?xml version="1.0"?><rss><channel><item><title>The Early Spring (2026) - MyDramaList</title><link>https://mydramalist.com/761231-zao-chun-qing-lang</link><description>Chinese Drama &amp; more</description></item><item><title>No link</title></item></channel></rss>`);
check("Bing's RSS: link, title and description", rss.length === 1 && rss[0].url === "https://mydramalist.com/761231-zao-chun-qing-lang" && rss[0].snippet === "Chinese Drama & more", rss);
const qs = queriesFor(work);
check("the first query has the proper title in quotes, its year, country and kind", qs[0] === '"The Early Spring" 2026 Chinese drama quotes', qs);
check("then with the main characters, then MyDramaList's reviews", qs[1] === '"The Early Spring" drama quotes Luan Nian Shang Zhitao' && /mydramalist reviews/.test(qs[2]), qs);
check("nothing in the queries but public facts about the work", qs.every((q) => !/dhruuu|nishi|theentangledd/i.test(q)));

// ---- two sites that agree make a line sure
const have = new Set(["x"]); have.kept = new Map([["x", { site: "mydramalist.com", verify: true }]]);
agrees(have, "x", { site: "cyn-lynn.blogspot.com", url: "https://cyn-lynn.blogspot.com/2026/08/the-early-spring.html" });
check("a line found again on another site is no longer marked to check", have.kept.get("x").verify === false);

// ---- the coarse record for the open health page
const said = coarseText({ identified: true, kind: "series", year: 2026, kept: 2, steps: [{ where: "title", what: "known" }, { where: "wikiquote", what: "no page" },
  { where: "web", what: "found", n: 2, counts: { results: 5, read: 4, about: 3, tried: 12, dropped: { "not on the page": 9, "too short or too long": 1 } } }] });
check("the coarse record in words: identified, each step and its counts", said === "work identified: yes (series, 2026); title check: known; wikiquote: no page; web: 5 results, 4 pages read, 3 about the work, 12 candidates, 2 kept (9 not on the page, 1 too short or too long); lines kept: 2", said);

console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
