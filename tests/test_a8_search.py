"""Gemini with Google Search and OpenAI with web search, as the later places to look: only with their keys,
only when the free places gave too few lines, never more than their daily limit, never with anything personal,
and "not today" whenever they refuse. Then Anthropic's paid search (only if switched on), then a plain message."""
import json
from a8lib import *

SECRET = "PRIVATE-NOTE-never-hustle"
def personal(T):
    """Things about her that must never leave for Gemini or OpenAI."""
    putdoc("taste", {"profile": {"summary": "You lean towards PRIVATE-SUMMARY lines.", "loves": ["PRIVATE-LOVES"], "avoids": [], "voice": [], "saidTo": "you"}, "notes": [{"id": "n1", "text": SECRET, "at": 1}], "updatedAt": 1})
    http("POST", "/api/library/quotes", {"text": "PRIVATE-OWN-LINE that she wrote in her notebook.", "author": "", "from": ""}, T)
def used(): return doc("lookups") or {}

# ---- no keys: neither is ever asked
serve("WEBSEARCH=unset")
T = login()
new = add_book(T, "Twisted Love", "Ana Huang")
calls()
s, got = ask(T, [new], 3)
log = calls()
check("without keys, Gemini and OpenAI are never asked", to(log, "gemini") == [] and to(log, "openai") == [] and s == 200, [x["to"] for x in log])

# ---- Gemini alone
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
personal(T)
new = add_book(T, "Twisted Love", "Ana Huang")
calls()
s, got = ask(T, [new], 3, about="PRIVATE-SUBJECT longing")
log = calls()
g = to(log, "gemini")
check("a new book nobody free knows is found through Gemini", s == 200 and len(got) == 3 and all("Google found this" in i["text"] for i in got), (s, got))
check("the free places were asked first", [x["to"] for x in log] == ["wikiquote", "goodreads", "gemini"], [x["to"] for x in log])
by = {i["text"].split(" line ")[0].split()[-1]: i for i in got}
check("a line two sites agree on needs no checking", by["first"]["verify"] is False, by["first"])
check("a line on one site only is marked to check", by["second"]["verify"] is True and by["fourth"]["verify"] is True, got)
check("a line whose page was never read is left out", not any("never read" in l["text"] for l in kept(new)), kept(new))
check("each carries the page and its site", all(i["source"]["url"].startswith("https://www.") and i["source"]["site"] in ("goodreads.com", "imdb.com") for i in got), [i["source"] for i in got])
body = g[0]["body"]
sent = json.dumps(body)
check("the question goes to a model the key may use, flash-lite first, with the search tool", g[0]["model"] == "gemini-3.5-flash-lite" and body["tools"] == [{"google_search": {}}], g[0]["model"])
check("it names the work: title, kind and author", '\\"Twisted Love\\"' in sent and "by Ana Huang" in sent and " book " in sent, sent[:300])
check("and nothing personal: no notes, taste, own lines, subject or name", not any(x in sent for x in ("PRIVATE", "Dhruuu", "longing", "hustle", "taste")), sent)
check("only the question, the tool and one setting are sent", sorted(body) == ["contents", "generationConfig", "tools"] and len(body["contents"]) == 1, sorted(body))
check("the day's count is kept", used()["gemini"]["calls"] == 1 and used()["day"] == india_day(), used())

# ---- Wikiquote gave enough: Gemini is not asked
film = add_screen(T, "The Long Tide", "film")
calls()
s, got = ask(T, [film], 3)
check("when Wikiquote gives enough, Gemini is not asked", s == 200 and to(calls(), "gemini") == [] and used()["gemini"]["calls"] == 1)

# ---- the daily limit
rec = used(); rec["gemini"]["calls"] = 39; putdoc("lookups", rec)
a = add_book(T, "A Brand New Novel", "")
calls()
ask(T, [a], 3)
check("the 40th question of the day is still asked", len(to(calls(), "gemini")) == 1 and used()["gemini"]["calls"] == 40, used())
b = add_book(T, "Another Brand New Novel", "")
s, got = ask(T, [b], 3)
check("past 40 a day Gemini is not asked, and the request is still answered", to(calls(), "gemini") == [] and s == 200 and used()["gemini"]["calls"] == 40, (s, used()))
rec = used(); rec["day"] = india_day(-1); putdoc("lookups", rec)
c = add_book(T, "A Third Brand New Novel", "")
ask(T, [c], 3)
check("the next day the count starts again", len(to(calls(), "gemini")) == 1 and used()["gemini"]["calls"] == 1 and used()["day"] == india_day(), used())

# ---- "not today": the free allowance is used up (429), or the key may not search (403, on every model it may use)
for how, why, asked in (("429", "used up", 2), ("refused", "may not search", 2)):     # a 429 without details: used up on that model, so the next is tried (Agent 12)
    serve("WEBSEARCH=unset", "GEMINI=" + how)
    T = login()
    a = add_book(T, "A Brand New Novel", "")
    calls()
    s, got = ask(T, [a], 3)
    check(f"Gemini answering {how}: quietly nothing, the request is still answered", s == 200 and len(to(calls(), "gemini")) == asked and kept(a) == [], (s, got))
    check(f"and it rests until tomorrow ({why})", used()["gemini"].get("off") == why, used())
    b = add_book(T, "Another Brand New Novel", "")
    ask(T, [b], 3)
    check("so it is not asked again that day", to(calls(), "gemini") == [])

# ---- a model that is no longer offered: the next one is tried
serve("WEBSEARCH=unset", "GEMINI=gone", "GEMINI_MODEL=gemini-3.8-flash,gemini-3.5-flash-lite")     # in that order, so the gone one is asked first
T = login()
a = add_book(T, "A Brand New Novel", "")
calls()
s, got = ask(T, [a], 3)
check("a model that is gone is passed over for the next", [x["model"] for x in to(calls(), "gemini")] == ["gemini-3.8-flash", "gemini-3.5-flash-lite"] and s == 200 and len(kept(a)) == 3, (s, kept(a)))
check("both questions are counted", used()["gemini"]["calls"] == 2, used())

# ---- an answer from memory (no pages read) is not kept
serve("WEBSEARCH=unset", "GEMINI=memory")
T = login()
a = add_book(T, "A Brand New Novel", "")
s, got = ask(T, [a], 3)
check("an answer with no pages behind it is not kept", kept(a) == [] and s == 200 and not any("Google found" in i["text"] for i in got), (s, got))

# ---- OpenAI alone
serve("WEBSEARCH=unset", "OPENAI=on")
T = login()
personal(T)
new = add_screen(T, "The Early Spring", "series")
calls()
s, got = ask(T, [new], 2, about="PRIVATE-SUBJECT longing")
log = calls()
o = to(log, "openai")
check("a new series is found through OpenAI's web search", s == 200 and len(got) == 2 and all("OpenAI found this" in i["text"] for i in got), (s, got))
check("after the free places", [x["to"] for x in log] == ["wikiquote", "imdb", "openai"], [x["to"] for x in log])
by = {i["text"].split(" line ")[0].split()[-1]: i for i in got}
check("two sites agreeing: no checking needed; one site: marked to check", by["first"]["verify"] is False and by["second"]["verify"] is True, got)
check("a line whose page was never opened is left out", len(kept(new)) == 2, kept(new))
check("each carries its page", all(i["source"]["url"] == "https://www.goodreads.com/work/quotes/2" and i["source"]["site"] == "goodreads.com" for i in got), [i["source"] for i in got])
body = o[0]["body"]
sent = json.dumps(body)
check("the question uses the cheapest model and the web search tool, and must search", body["model"] == "gpt-6-luna" and body["tools"] == [{"type": "web_search"}] and body["tool_choice"] == "required", body)
check("it is not stored there, and asks for the pages that were opened", body["store"] is False and body["include"] == ["web_search_call.action.sources"], body)
check("it names the work: title and kind", '\\"The Early Spring\\"' in sent and "TV series" in sent, sent[:300])
check("and nothing personal", not any(x in sent for x in ("PRIVATE", "Dhruuu", "longing", "hustle", "taste")), sent)
check("only what is needed is sent", sorted(body) == ["include", "input", "model", "store", "tool_choice", "tools"], sorted(body))

rec = used(); rec["openai"]["calls"] = 19; putdoc("lookups", rec)
a = add_screen(T, "A Brand New Show", "series")
ask(T, [a], 2)
check("the 20th question of the day is still asked", len(to(calls(), "openai")) == 1 and used()["openai"]["calls"] == 20, used())
b = add_screen(T, "Another Brand New Show", "series")
s, got = ask(T, [b], 2)
check("past 20 a day OpenAI is not asked", to(calls(), "openai") == [] and s == 200 and used()["openai"]["calls"] == 20, (s, used()))

# (a key that is refused already shows in the list of models it may use, so no question is spent on it)
for how, why, asked in (("429", "no credit", 1), ("refused", "refused", 0)):          # insufficient_quota: no credit (Agent 12)
    serve("WEBSEARCH=unset", "OPENAI=" + how)
    T = login()
    a = add_screen(T, "A Brand New Show", "series")
    calls()
    s, got = ask(T, [a], 2)
    check(f"OpenAI answering {how}: quietly nothing, and it rests until tomorrow", s == 200 and len(to(calls(), "openai")) == asked and used()["openai"].get("off") == why, (s, used()))
    b = add_screen(T, "Another Brand New Show", "series")
    ask(T, [b], 2)
    check("so it is not asked again that day", to(calls(), "openai") == [])

serve("WEBSEARCH=unset", "OPENAI=nomodel")
T = login()
a = add_screen(T, "A Brand New Show", "series")
calls()
s, got = ask(T, [a], 2)
check("a model that may not search is passed over for the next", [x["model"] for x in to(calls(), "openai")] == ["gpt-6-luna", "gpt-6.1-terra"] and len(kept(a)) == 2, kept(a))

# ---- both keys: Gemini first, OpenAI only when Gemini gave too few
serve("WEBSEARCH=unset", "GEMINI=on", "OPENAI=on")
T = login()
a = add_book(T, "A Brand New Novel", "")
calls()
s, got = ask(T, [a], 3)
check("Gemini gave enough: OpenAI is not asked", s == 200 and [x["to"] for x in calls() if x["to"] in ("gemini", "openai")] == ["gemini"])
b = add_book(T, "Another Brand New Novel", "")
s, got = ask(T, [b], 5)
check("Gemini gave too few: OpenAI is asked next", s == 200 and len(got) == 5 and [x["to"] for x in calls() if x["to"] in ("gemini", "openai")] == ["gemini", "openai"], (s, got))

# ---- what one request may cost: two works, every place asked, well inside the free plan's 50 calls
c = add_screen(T, "Quiet Harbour", "series")
d = add_book(T, "The Salt Road", "Mira Kessel")
calls(); ops(reset=True)
s, got = ask(T, [c, d], 8)
cost = ops(); outside = len(calls())
total = cost["storage"] + cost["outside"] + outside
check("a request that looks two works up everywhere stays under 45 calls in all", s == 200 and total <= 45, {"storage": cost["storage"], "claude": cost["outside"], "lookups": outside})

# ---- a look that runs out of time stops there, and the next request carries on where it stopped
serve("WEBSEARCH=unset", "GEMINI=on", "LOOKUP_SECONDS=1")
T = login()
a = add_book(T, "A Brand New Novel", "")
lines_set(slow=700)
calls()
s, got = ask(T, [a], 3)
log = [x["to"] for x in calls()]
check("out of time after the free places: the request is answered with what there is", s == 200 and log == ["wikiquote", "goodreads"] and work(a)["found"].get("resume") == 4, (s, log, work(a)["found"]))     # 2 is MyDramaList (off for a book), 3 the web with no key (off here)
lines_set(slow=0)
s, got = ask(T, [a], 3)
log = [x["to"] for x in calls()]
check("the next request carries on at Gemini, without asking the free places again", s == 200 and log == ["gemini"] and "resume" not in work(a)["found"] and len(kept(a)) == 3, (s, log, work(a)["found"]))

# ---- Anthropic's paid search comes last, and only when it is switched on
serve("GEMINI=on", "OPENAI=on")
T = login()
n = add_screen(T, "Nobody Knows This Show", "series")
calls()
s, got = ask(T, [n], 2)
log = [x["to"] for x in calls()]
# (three questions in all: its quotes to Gemini and to OpenAI, then its best lines to Gemini)
check("with the paid search on, it is used after everything else found nothing", s == 200 and all("found on the web" in i["text"] for i in got) and log == ["wikiquote", "imdb", "gemini", "openai", "gemini"] and len(http("GET", "/__websearch_log")[1]) == 1, (s, log))
film = add_screen(T, "The Long Tide", "film")
ask(T, [film], 3)
check("and not at all when a free place gave enough", len(http("GET", "/__websearch_log")[1]) == 1)

# ---- nothing anywhere: a plain message, with nothing for her to do by hand but the Library
serve("WEBSEARCH=unset", "GEMINI=on", "OPENAI=on")
T = login()
n = add_book(T, "Nobody Knows This Book", "")
s, said = ask(T, [n], 3)
check("nothing anywhere: said plainly", s == 502 and "found no real lines from Nobody Knows This Book" in said and "Library" in said, (s, said))
check("with no steps to do by hand on Google", not any(x in said.lower() for x in ("screenshot", "search yourself", "search google", "google it")), said)
check("and it says where Nishiii looked", "Looked on Wikiquote, Goodreads, Google and OpenAI: nothing yet." in said, said)
finish()
