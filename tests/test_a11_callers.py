"""Every feature that searches the web through Gemini (findlines.js's shared helper) leaves its outcome on record:
quotes from a work (lookup), the title check (title), "Who said this?" (check), and the engine's discovery
(discover) and its check of the quotes behind other pages' posts (echo). A refused key and a model that is not
offered must each show, per feature, in data/lookups.json, in the trail and in the signed-in health line, never
pass silently."""
import json, time
from a8lib import *

def engine_job(name): return http("GET", "/__engine_job?name=" + name)[1]
def uses(): return (doc("lookups") or {}).get("uses", {})
def wake():
    """Lets Gemini be asked again today (a refusal rests it until tomorrow), keeping what was recorded."""
    rec = doc("lookups"); rec["gemini"] = {"calls": 0}; putdoc("lookups", rec)
def seed_posts():
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime())
    putdoc("inspirations", [{"id": "s1", "kind": "screenshot", "handle": "", "quote": "Hope is the thing with feathers — Emily Dickinson", "added": int(time.time() * 1000)},
        {"id": "a1", "kind": "account", "handle": "tiny.verses", "followers": 800, "added": int(time.time() * 1000), "top": [
            {"quote": "The wound is the place where the Light enters you — Rumi", "likes": 900, "comments": 40, "views": 0, "at": now_iso}]}])
NAMES = {"lookup": "quotes from a work", "title": "checking a title", "check": '"Who said this?"', "discover": "finding new lines", "echo": "checking new lines"}

for case, settings, what, words in (
        ("a refused key", ["GEMINI=badkey"], "key refused", "API key not valid"),
        ("a model that is not offered", ["GEMINI=gone", "GEMINI_MODEL=gemini-3.8-flash"], "no model", "no longer available")):
    serve("WEBSEARCH=unset", *settings)
    T = login()
    seed_posts()
    # lookup
    a = add_book(T, "A Brand New Novel", "")
    ask(T, [a], 2)
    u = uses().get("lookup", {})
    check(f"{case}: quotes from a work record it", u.get("what") == what and words in u.get("said", ""), u)
    trail = (work(a).get("found") or {}).get("trail", {}).get("steps", [])
    check(f"{case}: and its trail shows it", any(s["where"] == "gemini" and s["what"] == what and words in s.get("said", "") for s in trail), trail)
    wake()
    # title
    t = add_screen(T, "Nobody Knows This Show", "series", checked=False)
    http("POST", f"/api/library/screen/{t}/title", {}, T)
    u = uses().get("title", {})
    check(f"{case}: the title check records it", u.get("what") == what and words in u.get("said", ""), u)
    last = doc("lookups")["trails"][-1]
    check(f"{case}: with its own trail", last["type"] == "title" and any(s["what"] == what for s in last["steps"]), last)
    wake()
    # check
    http("POST", "/api/check", {"text": "The moon keeps the minutes of the sea, they say.", "author": "Edda Marlowe"}, T)
    u = uses().get("check", {})
    check(f"{case}: 'Who said this?' records it", u.get("what") == what and words in u.get("said", ""), u)
    check(f"{case}: with its own trail", doc("lookups")["trails"][-1]["type"] == "check", doc("lookups")["trails"][-1])
    wake()
    # discover
    engine_job("engine-discover")
    u = uses().get("discover", {})
    check(f"{case}: the engine's discovery records it", u.get("what") == what and words in u.get("said", ""), u)
    wake()
    # echo
    engine_job("engine-echo")
    u = uses().get("echo", {})
    check(f"{case}: the engine's check of others' posts records it", u.get("what") == what and words in u.get("said", ""), u)
    # the health line, signed in: one entry per feature, and the problem raised
    items, _ = part_now(T, "services")
    l = items["lookups"]
    check(f"{case}: the health line names every feature and how its last search went",
          all(f"{NAMES[f]}: {'was refused: the key' if what == 'key refused' else 'found no model'}" in l["line"] for f in NAMES), l["line"])
    check(f"{case}: and needs Nishith", l["state"] in ("attention", "soon"), l["state"])
    check(f"{case}: no key in the line or the record", "dev-gemini-key" not in json.dumps(l) and "dev-gemini-key" not in json.dumps(doc("lookups")))
    pub = http("GET", "/api/health")[1]
    check(f"{case}: the open record stays coarse", "Gemini" not in json.dumps(pub["items"]) and words not in json.dumps(pub), pub["items"][:2])

# ---- and when a search works but every line is left out, that shows too
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
w = add_screen(T, "The Late Thaw", "series")
ask(T, [w], 2)
items, _ = part_now(T, "services")
check("all lines rejected: said per feature", "quotes from a work: answered, but every line was left out" in items["lookups"]["line"], items["lookups"]["line"])
check("with the last look step by step", 'Last look, for "The Late Thaw"' in items["lookups"]["line"] and "Gemini: no line passed" in items["lookups"]["line"], items["lookups"]["line"])
finish()
