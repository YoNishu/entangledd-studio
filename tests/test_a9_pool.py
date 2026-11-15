"""Agent 9: the pool from every source and the engine, through the stand-in server.
The timed jobs fill the pool (tags, found lines, web discovery, the real quotes behind other pages' posts); the
day's five come from several sources, each with a true reason; with Nishiii unavailable the other sources still
give five; budgets hold; nothing personal goes to Gemini or OpenAI; "Forget everything" clears the engine.
Everything named here is made up."""
from a8lib import *

def engine_job(name): return http("GET", "/__engine_job?name=" + name)[1]
def elog(reset=True): return http("GET", "/__engine_log" + ("?reset=1" if reset else ""))[1]
PERSONAL = ["Dhruuu", "Nishith", "fiance", "my secret", "letmein", "a small room of my own", "never anything about death"]

serve("GEMINI=on", "OPENAI=on")
T = login()
calls(); elog()

# ---- her world: a film, her own lines, a note, two pages she follows and a reel she shared
film = add_screen(T, "The Long Tide", "film")
for text in ["hope lives in a small room of my own", "my secret line, for Dhruuu only", "the sea keeps my hope"]:
    http("POST", "/api/library/quotes", {"text": text}, T)
http("POST", "/api/taste/notes", {"text": "never anything about death"}, T)
now_iso = time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime())
putdoc("inspirations", [
    {"id": "a1", "kind": "account", "handle": "tiny.verses", "followers": 800, "added": int(time.time() * 1000), "top": [
        {"quote": "The wound is the place where the Light enters you — Rumi", "likes": 900, "comments": 40, "views": 0, "at": now_iso},
        {"quote": "our own words for you tonight about hope", "likes": 30, "comments": 1, "views": 0, "at": now_iso},
        {"quote": "a plain post about time", "likes": 35, "comments": 2, "views": 0, "at": now_iso},
        {"quote": "another plain post about love", "likes": 32, "comments": 1, "views": 0, "at": now_iso}]},
    {"id": "s1", "kind": "screenshot", "handle": "", "quote": "Hope is the thing with feathers — Emily Dickinson", "added": int(time.time() * 1000)}])

# ---- tags: one batched question, stored with the item
engine_job("engine-tags")
tg = doc("engine/tags") or {"items": {}}
check("her own lines and the pages' posts are tagged once, in one question", len(tg["items"]) >= 7 and len([x for x in elog(False) if x["to"] == "claude"]) == 1, (len(tg["items"]), elog(False)))
check("tags use the shared vocabulary", {v["th"] for v in tg["items"].values()} <= {"hope", "sea", "love", "death", "fear", "loss", "courage", "time", "mind", "peace", "self", "growth", "life"}, tg)
engine_job("engine-tags")
check("nothing is tagged twice", len([x for x in elog(False) if x["to"] == "claude"]) == 1)

# ---- found: a work never looked up is looked up by the timed job, before she asks
engine_job("engine-found")
check("the timed job found real lines for her film", len(kept(film)) >= 2 and all(l.get("url") for l in kept(film)), kept(film))
check("and counted it against the day's share", (doc("engine/bank") or {}).get("used", {}).get("found") == 1, doc("engine/bank"))

# ---- discover: web search beyond her list, nothing personal sent
elog(); calls()
engine_job("engine-discover")
bank = doc("engine/bank")
disc = [l for l in bank["lines"] if l["from"] == "discover"]
check("discovery added real, attributed lines with their pages", len(disc) >= 3 and all(l["url"].startswith("https://") and (l["by"] or l["work"]) for l in disc), disc)
check("two sites behind each: no checking needed", all(l["verify"] is False for l in disc), disc)
check("the question asked is remembered, so it is not repeated", len(bank["asked"]) == 1, bank["asked"])

# ---- echo: the real quote behind a post that does well, never a page's own writing
engine_job("engine-echo")
bank = doc("engine/bank")
echo = [l for l in bank["lines"] if l["from"] == "echo"]
check("the real quotes behind the posts were found, with their authors", {l["by"] for l in echo} == {"Rumi", "Emily Dickinson"}, echo)
check("the page's own writing is never offered", not any("our own words" in l["text"] for l in bank["lines"]), bank["lines"])
check("one was checked on the web: its page kept and sure", any(l.get("checked") and l["url"] and l["verify"] is False for l in echo), echo)

# ---- nothing personal to Gemini or OpenAI, in any request this test caused
web = [x for x in elog(False) if x["to"] in ("gemini", "openai")] + [x for x in calls(False) if x["to"] in ("gemini", "openai")]
sent = json.dumps([x.get("body") for x in web])
check("web searches were made", len(web) >= 2, len(web))
check("nothing personal went to Gemini or OpenAI", not any(p.lower() in sent.lower() for p in PERSONAL), [p for p in PERSONAL if p.lower() in sent.lower()])

# ---- the day's five: several sources, a reason each, the avoid kept out
s, today, _ = http("GET", "/api/suggestions", token=T)
items = today["items"] if s == 200 else []
srcs = {i.get("src") for i in items}
check("five for today", s == 200 and len(items) == 5, (s, today))
check("drawn from at least three sources", len(srcs) >= 3, [(i.get("src"), i["text"][:40]) for i in items])
check("one of her own lines among them", sum(1 for i in items if i.get("src") == "own") == 1, srcs)
check("each carries a reason (or none, never a made-up one)", all(isinstance(i.get("why"), str) for i in items) and sum(1 for i in items if i["why"]) >= 3, [i.get("why") for i in items])
check("nothing about death (her note)", not any("death" in (i.get("theme") or "").lower() for i in items))
for i in items:
    for c in filter(None, (i.get("why") or "").split(" · ")):
        ok = (c.startswith("Found word for word on ") and c.endswith((i["source"] or {}).get("site") or "?")) or c == "Two sites agree on the wording" and not i["verify"] \
            or c.startswith("Like your own lines about ") or c in ("The length of your own lines", "Like a reel you saved", "From the book's own text", "Something you haven't had lately") \
            or c.startswith("Doing well on @tiny.verses") or c.startswith("Like posts on @tiny.verses")
        check(f"reason '{c}' is one the engine can stand behind", ok, i)

# ---- Nishiii unavailable: the other sources still give five
deldoc("suggestions/" + india_day())
hset(claudeAsk="credit")
s, again, _ = http("GET", "/api/suggestions", token=T)
check("with Nishiii unavailable, still five from the other sources", s == 200 and len(again["items"]) == 5 and not any(i.get("src") == "memory" for i in again["items"]), (s, again))
hset(claudeAsk="")

# ---- budgets: the engine's own share of the web searches holds, whatever the timer does
for _ in range(10): engine_job("engine-discover")
bank = doc("engine/bank")
look = doc("lookups")
check("discovery stays within its share: 4 Gemini and 2 OpenAI questions a day", bank["used"].get("gemini", 0) <= 4 and bank["used"].get("openai", 0) <= 2, bank["used"])
check("and within the shared daily limits", look["gemini"]["calls"] <= 40 and look["openai"]["calls"] <= 20, look)
for _ in range(10): engine_job("engine-echo"); engine_job("engine-tags")
check("the engine's Claude questions stay within its share (8 a day)", doc("engine/bank")["used"].get("claude", 0) <= 8, doc("engine/bank")["used"])

# ---- status for the Nishiii section
s, st, _ = http("GET", "/api/engine", token=T)
print("  status:", st.get("line"))
check("the status line says what it learns from, with no count to fifty", s == 200 and st["line"].startswith("Learning from") and "50" not in st["line"], st)
check("and where the candidates come from", st["sources"]["found"] >= 2 and st["sources"]["discover"] >= 3 and st["sources"]["echo"] >= 2 and st["sources"]["own"] == 3, st["sources"])

# ---- quotes on request: the same engine, with reasons
s, got = ask(T, [film], 3)
check("quotes on request are ranked by the engine and carry reasons", s == 200 and len(got) == 3 and all("why" in i and i.get("src") for i in got), got)
s, sub = ask(T, [], 4, about="hope")
check("a subject alone also draws on lines found on the web", s == 200 and any(i.get("src") == "discover" and "web gave" in i["text"] for i in sub), [(i.get("src"), i["text"][:40]) for i in sub] if s == 200 else sub)

# ---- "Forget everything" clears the engine
s, _, _ = http("DELETE", "/api/taste?scope=all", token=T)
check("forgetting everything clears the engine's bank and tags", s == 200 and doc("engine/bank") is None and doc("engine/tags") is None, (doc("engine/bank") or {}).keys())
finish()
