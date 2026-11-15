"""The web with no paid allowance (server/opensearch.js): with both search keys out of allowance, a new drama's real
lines are still found, through a public results page and the pages it points to; a page about the season is left
out; nothing past the reading limit of a page is read; snippets alone give a line only when two sites agree, marked
to check; a results page that turns the app away is on the trail and the next one is used; the daily cap, the
switch and the per-search limits hold; Tavily and Serper are used when their keys are set; the title check, "Who
said this?", the engine's discover and echo all reach the same layer; nothing personal is in any request.
"The Late Thaw" (春迟) is a made-up 2026 Chinese drama of the stand-in."""
import json, time
from a8lib import *

PRIVATE = ("PRIVATE", "Dhruuu", "Nishith", "longing", "letmein")
def olog(reset=True): return http("GET", "/__open_log" + ("?reset=1" if reset else ""))[1]
def oset(**kw): return http("GET", "/__open_set?" + urllib.parse.urlencode(kw))[1]
def steps(wid): return ((work(wid).get("found") or {}).get("trail") or {}).get("steps", [])
def where_what(st): return [(s["where"], s["what"]) for s in st]
def engine_job(name): return http("GET", "/__engine_job?name=" + name)[1]
def personal():
    putdoc("taste", {"profile": {"summary": "You lean towards PRIVATE-SUMMARY lines.", "loves": ["PRIVATE-LOVES"], "avoids": [], "voice": [], "saidTo": "you"},
                     "notes": [{"id": "n1", "text": "PRIVATE-NOTE", "at": 1}], "updatedAt": 1})
def outside(log):
    """What went to the outside search services and pages (Claude, the app's own assistant, aside)."""
    return [x for x in log if x["to"] != "claude"]

# ---- 1. both keys out of allowance, a drama never checked: known from the results, its lines from the pages
serve("WEBSEARCH=unset", "GEMINI=limit0", "OPENAI=429", "OPEN_SEARCH=on")
T = login()
personal()
w = add_screen(T, "the late thaw", "series", checked=False)
olog(); calls()
s, got = ask(T, [w], 6, about="PRIVATE-SUBJECT longing")
log = olog()
k = work(w).get("known") or {}
check("the title check knows the drama from the results page alone", k.get("real") == "The Late Thaw" and k.get("original") == "春迟" and k.get("year") == 2026
      and k.get("country") == "Chinese" and k.get("cast") == ["Lin Qiao", "Shen Mo"], k)
lines = kept(w)
texts_ = [l["text"] for l in lines]
check("the drama's lines are found with no key at all", s == 200 and "You don't have to bloom early to be worth the wait." in texts_
      and "I kept the window open all winter, in case you came back with the spring." in texts_, (s, texts_))
blog = [l for l in lines if l["text"].startswith("You don't have to bloom")]
check("each with its speaker and the page it was read on, not marked to check", blog and blog[0]["by"] == "Xia Lan" and "/__web/thaw-blog" in blog[0]["url"] and blog[0]["verify"] is False, blog)
check("the page about the season gives nothing", not any("teaches the river" in t or "promise the earth" in t for t in texts_), texts_)
check("a line the page credits to another show is left out", not any("season turns" in t for t in texts_), texts_)
check("lines not on the page word for word are left out", not any("no page at all" in t or "Changed." in t for t in texts_), texts_)
check("nothing past the 400 KB reading limit of a page is read", not any("past the reading limit" in t for t in texts_), texts_)
check("nothing from a script on a page", not any("sits in a script" in t for t in texts_), texts_)
snip = [l for l in lines if l["text"].startswith("Some people arrive like spring")]
check("a line two sites' snippets agree on is kept, marked to check", snip and snip[0]["verify"] is True and snip[0]["site"] in ("instagram.com", "pinterest.com"), snip)
st = steps(w)
web = [x for x in st if x["where"] == "web"]
check("the trail says where it looked and why pages were left out", web and web[0]["what"] == "found" and "not about this work" in web[0].get("why", ""), web)
ddg = [x for x in log if x["to"] == "ddg"]
pages = [x for x in log if x["to"] == "web"]
check("at most 2 results pages and 4 pages for the look (one more results page for the title check)", len(ddg) <= 3 and len(pages) <= 4, (len(ddg), len(pages)))
check("never a page on a site that needs signing in", not any("instagram" in x.get("path", "") or "pinterest" in x.get("path", "") for x in log))
check("every request says who is asking", all(x["agent"].startswith("DsStudio/") for x in outside(log)), {x["agent"] for x in outside(log)})
blob = json.dumps(outside(log))
check("nothing personal in any search or page request", not any(p in blob for p in PRIVATE), [p for p in PRIVATE if p in blob])
check("the searches name the work by its public facts", any("2026" in x["query"].get("q", "") and "Chinese" in x["query"].get("q", "") for x in ddg), [x["query"] for x in ddg])
rec = doc("lookups")
check("the daily count of results pages and pages is kept", rec["open"]["results"] == len(ddg) and rec["open"]["pages"] == len(pages), rec.get("open"))
check("Gemini, with no allowance on any model, rests for the day as 'no allowance'", rec["gemini"].get("off") == "no allowance" and rec["gemini"].get("refused", 0) >= 1, rec["gemini"])
check("OpenAI, with no credit, rests for the day as 'no credit'", rec["openai"].get("off") == "no credit", rec["openai"])
line = part_now(T, "services")[0]["lookups"]["line"]
check("the health line says Google gives the free key no searches, and OpenAI has no credit", "Google gives this free key no searches" in line and "OpenAI has no credit on this key" in line, line[:600])
check("the health line counts refused searches as refused", "0 of 40 searches answered today" in line and "refused" in line, line[:600])
check("the health line counts the keyless pages", "results pages and" in line, line[:600])

# ---- 2. DuckDuckGo turns the app away: the trail says so, Bing answers
serve("WEBSEARCH=unset", "OPEN_SEARCH=on", "DDG=blocked")
T = login()
w = add_screen(T, "The Late Thaw", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
x["known"] = {"title": "The Late Thaw", "real": "The Late Thaw", "original": "春迟", "year": 2026, "country": "Chinese", "cast": ["Lin Qiao"], "kind": "series"}; putdoc("library", lib)
olog()
s, got = ask(T, [w], 3)
log = olog()
st = steps(w)
check("DuckDuckGo's 202 page is on the trail as 'blocked'", ("duckduckgo", "blocked") in where_what(st), where_what(st))
check("Bing's results are used instead, and the lines found", any(x["to"] == "bing" for x in log) and "You don't have to bloom early to be worth the wait." in [l["text"] for l in kept(w)], [l["text"] for l in kept(w)])
check("DuckDuckGo rests for the day", (doc("lookups")["sites"].get("duckduckgo") or {}).get("blocked") is True)

# ---- 3. the daily cap, and the switch
rec = doc("lookups"); rec["open"]["results"] = 60; rec["sites"] = {}; putdoc("lookups", rec)
w2 = add_screen(T, "The Late Thaw (2026)", "series")
olog()
ask(T, [w2], 3)
check("at the daily cap no results page is asked for", not any(x["to"] in ("ddg", "bing") for x in olog()))
serve("WEBSEARCH=unset", "OPEN_SEARCH=on")
oset(open="off")
T = login()
w = add_screen(T, "The Late Thaw", "series")
olog()
ask(T, [w], 3)
check("OPEN_SEARCH=off: no results page is asked for", not any(x["to"] in ("ddg", "bing", "web") for x in olog()))

# ---- 4. Tavily, then Serper, when their keys are set (and the keyless pages switched off)
serve("WEBSEARCH=unset", "TAVILY=on")
T = login()
w = add_screen(T, "The Late Thaw", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w); x["known"] = {"title": "The Late Thaw", "real": "The Late Thaw", "original": "春迟", "year": 2026, "kind": "series"}; putdoc("library", lib)
olog()
ask(T, [w], 3)
log = olog()
tv = [x for x in log if x["to"] == "tavily"]
check("Tavily is asked, and the pages' text it sends is read without fetching them again", len(tv) == 1 and not any(x["to"] == "web" and "thaw-blog" in x["path"] for x in log)
      and "You don't have to bloom early to be worth the wait." in [l["text"] for l in kept(w)], [(x["to"], x["path"]) for x in log])
check("Tavily is asked for the work only", "PRIVATE" not in json.dumps(tv) and "Late Thaw" in tv[0]["body"]["query"], tv[0]["body"] if tv else None)
oset(tavily="off", serper="on")
w = add_screen(T, "The Late Thaw (2026)", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w); x["known"] = {"title": "The Late Thaw (2026)", "real": "The Late Thaw", "original": "春迟", "year": 2026, "kind": "series"}; putdoc("library", lib)
ask(T, [w], 3)
log = olog()
check("Serper is asked, its result pages fetched, and lines kept only from them", any(x["to"] == "serper" for x in log) and any(x["to"] == "web" and "thaw-blog" in x["path"] for x in log)
      and "You don't have to bloom early to be worth the wait." in [l["text"] for l in kept(w)], [(x["to"], x["path"]) for x in log])

# ---- 5. the other callers: "Who said this?", the engine's discover and echo
serve("WEBSEARCH=unset", "GEMINI=limit0", "OPEN_SEARCH=on")
T = login()
olog()
s, b, _ = http("POST", "/api/check", {"text": "We are not late; we are only on our way.", "author": "Teo Brandt"}, T)
check("'Who said this?' rests on a page found through the keyless search", s == 200 and b.get("basis") == "web" and any("hope-quotes" in x.get("url", "") for x in b.get("sources", [])), b)
check("and its search names only the line and the author", all("PRIVATE" not in json.dumps(x) for x in olog()))
personal()
out = engine_job("engine-discover")
bank = doc("engine/bank") or {}
found = [l for l in bank.get("lines", []) if l.get("from") == "discover"]
check("discover finds real lines through the keyless search", any(l["text"] == "Hope is the thing that keeps the light on in the window." and l["by"] == "Ada Vey" for l in found), (out, found[:3]))
check("discover keeps no line without someone named for it", not any("only for getting through" in l["text"] for l in found), found)
b0 = doc("engine/bank"); b0["lines"] = []; putdoc("engine/bank", b0)      # discover found that line already: echo must find it afresh
putdoc("inspirations", [{"id": "s1", "kind": "screenshot", "handle": "", "quote": "Hope is the thing that keeps the light on in the window — Ada Vey", "added": int(time.time() * 1000)}])
olog()
engine_job("engine-echo")
bank = doc("engine/bank") or {}
echo = [l for l in bank.get("lines", []) if l.get("from") == "echo"]
check("echo checks a line through the keyless search", echo and echo[0].get("checked") is True and "hope-quotes" in (echo[0].get("url") or ""), echo)
uses = (doc("lookups") or {}).get("uses", {})
trails = (doc("lookups") or {}).get("trails", [])
check("each caller searched the web first: its trail starts there", all(any(t["type"] == f and t["steps"] and t["steps"][0]["where"] in ("duckduckgo", "web") for t in trails) for f in ("check", "discover", "echo")),
      [(t["type"], where_what(t["steps"])[:3]) for t in trails])
check("nothing personal reaches the outside in any of them", not any(p in json.dumps(outside(olog(False))) for p in PRIVATE))
finish()
