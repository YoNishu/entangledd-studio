"""Looking up a new work whose title is also a plain phrase (server/findlines.js, server/verify.js): the work is
known before it is searched for, every question says which work it is, lines about the phrase are left out, lines
found only on social posts behind Google's redirect links are kept and marked to check with their site, every
look leaves a truthful trail, the models are chosen by asking the services, and a look that found nothing is
tried again. "The Late Thaw" (春迟) is a made-up 2026 Chinese drama of the stand-in."""
import json
from a8lib import *

PRIVATE = ("PRIVATE", "Dhruuu", "Nishith", "longing", "hustle", "taste", "letmein")
def personal(T):
    putdoc("taste", {"profile": {"summary": "You lean towards PRIVATE-SUMMARY lines.", "loves": ["PRIVATE-LOVES"], "avoids": [], "voice": [], "saidTo": "you"},
                     "notes": [{"id": "n1", "text": "PRIVATE-NOTE hustle", "at": 1}], "updatedAt": 1})
def lists(reset=True): return http("GET", "/__lines_log?list=models" + ("&reset=1" if reset else ""))[1]
def steps(wid): return ((work(wid).get("found") or {}).get("trail") or {}).get("steps", [])
def where_what(st): return [(s["where"], s["what"]) for s in st]
def questions(log): return [x for x in log if x["to"] in ("gemini", "openai") and x.get("body")]
def prompt_of(x): return x["body"]["contents"][0]["parts"][0]["text"] if x["to"] == "gemini" else x["body"]["input"]

# ---- 1. the drama, typed in lower case, never checked: known first, then asked about with its facts
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
personal(T)
w = add_screen(T, "the late thaw", "series", checked=False)
calls(); lists()
s, got = ask(T, [w], 3, about="PRIVATE-SUBJECT longing")
log = calls()
qs = questions(log)
check("the title is checked first, with one search question", len(qs) == 2 and "that someone calls" in prompt_of(qs[0]) and "original language" in prompt_of(qs[0]), [prompt_of(q)[:90] for q in qs])
k = work(w).get("known") or {}
check("and the work is known: its proper title, original title, year, country and leads", k.get("real") == "The Late Thaw" and k.get("original") == "春迟" and k.get("year") == 2026
      and k.get("country") == "Chinese" and k.get("cast") == ["Lin Qiao", "Shen Mo"] and k.get("title") == "the late thaw", k)
lines_q = prompt_of(qs[1]) if len(qs) > 1 else ""
check("the question for lines names the work with its facts", 'the 2026 Chinese TV series "The Late Thaw" (春迟), with Lin Qiao and Shen Mo' in lines_q, lines_q[:200])
check("and for a new Chinese drama it reads MyDramaList and social posts", "MyDramaList" in lines_q and "Instagram" in lines_q and "Pinterest" in lines_q, lines_q[:400])
check("nothing personal in any question", not any(x in json.dumps(q["body"], ensure_ascii=False) for q in qs for x in PRIVATE), [json.dumps(q["body"])[:200] for q in qs])
by = {i["text"]: i for i in got} if s == 200 else {}
bloom = by.get("You don't have to bloom early to be worth the wait.")
check("the drama's line is found", s == 200 and bloom is not None, (s, got))
check("found on an Instagram post behind a Google redirect: marked to check, with its site", bloom and bloom["verify"] is True and bloom["source"]["site"] == "instagram.com"
      and bloom["source"]["url"] == "https://www.instagram.com/p/LateThaw01/", bloom)
window = by.get("I kept the window open all winter, in case you came back with the spring.")
check("a line behind a page whose site Google did not name: the page the answer names gives the site, to check", window and window["verify"] is True and window["source"]["site"] == "tumblr.com", window)
arrive = by.get("Some people arrive like spring: late, and all at once.")
check("a line two sites agree on needs no checking", arrive and arrive["verify"] is False, arrive)
check("the line about the season, credited to no work, is left out", not any("forgives the winter" in l["text"] for l in kept(w)), kept(w))
st = steps(w)
check("the trail names each step truthfully, in order", where_what(st) == [("gemini", "models"), ("title", "known"), ("wikiquote", "no page"), ("mydramalist", "no page"), ("imdb", "no page"), ("gemini", "found")], where_what(st))
g = next((x for x in st if x["where"] == "gemini" and x["what"] == "found"), {})
check("with the model, the count, the sites read and why a line was left out", g.get("model") == "gemini-3.5-flash-lite" and g.get("n") == 3
      and "instagram.com" in g.get("read", []) and "1 not said to be from this work" in g.get("why", ""), g)
rec = doc("lookups")
check("the last trails are in data/lookups.json too", rec["trails"][-1]["title"] == "the late thaw" and rec["uses"]["lookup"]["what"] == "found", rec.get("uses"))
check("the models were chosen by asking Google, once", [x["to"] for x in lists()] == ["gemini"] and rec["models"]["gemini"]["list"] == ["gemini-3.5-flash-lite", "gemini-3.8-flash"], rec.get("models"))

# ---- 2. a near-duplicate entry: the same work, offered to fold into one, never folded alone
d = add_screen(T, "The late thaw cdrama", "series", checked=False)
s2, lib, _ = http("POST", f"/api/library/screen/{d}/title", {}, T)
dup = next(x for x in lib["screen"] if x["id"] == d)
check("'The late thaw cdrama' is known as the same work", s2 == 200 and (dup.get("known") or {}).get("real") == "The Late Thaw" and not dup.get("maybe"), dup)
check("nothing is merged by itself", len(doc("library")["screen"]) == 2)
s2, lib, _ = http("POST", f"/api/library/screen/{d}/merge", {"into": w}, T)
check("merged on her word: one entry, the lines kept", s2 == 200 and [x["id"] for x in lib["screen"]] == [w] and len(kept(w)) == 3, lib.get("screen") if isinstance(lib, dict) else lib)
other = add_screen(T, "Quiet Harbour", "series")
s2, b, _ = http("POST", f"/api/library/screen/{other}/merge", {"into": w}, T)
check("two different works are never merged", s2 == 409, (s2, b))

# ---- 3. asked about plainly (title checked, nothing known): the season's lines are all left out, and the trail says why
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
w = add_screen(T, "The Late Thaw", "series")             # checked, as if the check had found nothing
calls()
s, got = ask(T, [w], 3)
qs = questions(calls())
check("a plain question was asked, twice, in two ways", len(qs) == 2 and prompt_of(qs[0]).startswith("Search the web for real quotes from the TV series")
      and prompt_of(qs[1]).startswith("Search the web for the best lines and dialogue"), [prompt_of(q)[:80] for q in qs])
check("the lines about spring are not kept", kept(w) == [] and not any("spring" in i["text"].lower() and i.get("source", {}).get("url") for i in (got if s == 200 else [])), kept(w))
st = steps(w)
rejected = [x for x in st if x["where"] == "gemini" and x["what"] == "no line passed"]
check("the trail says Google answered but no line passed, and why", len(rejected) == 2 and all("2 not said to be from this work" in x["why"] for x in rejected), st)
said = work(w)["found"]["trail"]["said"]
check("in one plain sentence for her", said == "Looked on Wikiquote, IMDb and Google: nothing yet.", said)
check("the feature's last search reads 'all rejected'", doc("lookups")["uses"]["lookup"]["what"] == "all rejected", doc("lookups")["uses"])

# ---- 4. a look that found nothing is tried again soon, and "Look again" works
s, got = ask(T, [w], 3)
check("not again at once", questions(calls()) == [], work(w)["found"].get("tries"))
age_found(w, 3 / 24)
s, got = ask(T, [w], 3)
check("but after a couple of hours", len(questions(calls())) == 2 and work(w)["found"]["tries"] == 2, work(w)["found"].get("tries"))
s, b, _ = http("POST", f"/api/library/screen/{w}/look", {}, T)
check("'Look again' a moment later is asked to wait a minute", s == 429, (s, b))
age_found(w, 1 / 24)
s, lib, _ = http("POST", f"/api/library/screen/{w}/look", {}, T)
row = next(x for x in lib["screen"] if x["id"] == w) if s == 200 else {}
check("'Look again' looks now and answers the Library with the new trail", s == 200 and len(questions(calls())) == 2 and row["found"]["trail"]["said"].startswith("Looked on"), (s, row.get("found", {}).get("trail")))

# ---- 5. the record for Nishith: signed in only, with every step and no key
s, b, _ = http("GET", "/api/lookups")
check("the record of lookups needs sign-in", s == 401, s)
s, b, _ = http("GET", "/api/lookups", None, T)
check("signed in: the trails in full, newest first", s == 200 and b["trails"][0]["title"] == "The Late Thaw" and "Gemini: no line passed" in b["trails"][0]["text"]
      and b["trails"][0]["said"].startswith("Looked on"), b.get("trails", [{}])[0] if s == 200 else b)
check("and no key anywhere in it", "dev-gemini-key" not in json.dumps(b) and b["keys"] == {"gemini": True, "openai": False}, b.get("keys"))

# ---- 6. models: one that may not search is passed over, and the one that worked is asked first next time
serve("WEBSEARCH=unset", "GEMINI=nosearch")
T = login()
a = add_book(T, "A Brand New Novel", "")
calls(); lists()
s, got = ask(T, [a], 3)
asked = [x["model"] for x in questions(calls())]
check("the first model is refused the search tool, the next works", asked == ["gemini-3.5-flash-lite", "gemini-3.8-flash"] and len(kept(a)) == 3, (asked, kept(a)))
st = steps(a)
ref = next((x for x in st if x["what"] == "may not search"), {})
check("the refusal is on the trail with the status and Google's own words", ref.get("status") == 400 and ref.get("said") == "Search Grounding is not supported for this model.", st)
check("which model worked is remembered", doc("lookups")["models"]["gemini"].get("worked") == "gemini-3.8-flash", doc("lookups")["models"])
b2 = add_book(T, "Another Brand New Novel", "")
calls(); lists()
ask(T, [b2], 3)
check("next time it is asked first, and the list is not read again", [x["model"] for x in questions(calls())] == ["gemini-3.8-flash"] and lists() == [])
rec = doc("lookups"); rec["models"]["gemini"]["at"] -= 8 * DAY; putdoc("lookups", rec)
ask(T, [add_book(T, "A Third Brand New Novel", "")], 3)
check("after a week the list is read again", [x["to"] for x in lists()] == ["gemini"])

serve("WEBSEARCH=unset", "GEMINI=nolist")
T = login()
a = add_book(T, "A Brand New Novel", "")
calls()
s, got = ask(T, [a], 3)
st = steps(a)
check("a list that can't be read: the built-in names are tried, and the trail says so", ("gemini", "models unknown") in where_what(st) and len(kept(a)) == 3
      and next(x for x in st if x["what"] == "models unknown").get("status") == 503, st)

serve("WEBSEARCH=unset", "GEMINI=on", "GEMINI_MODEL=gemini-3.5-flash-lite")
T = login()
a = add_book(T, "A Brand New Novel", "")
calls(); lists()
ask(T, [a], 3)
check("the setting GEMINI_MODEL still decides, without reading the list", [x["model"] for x in questions(calls())] == ["gemini-3.5-flash-lite"] and lists() == [])

# ---- 7. both keys, nothing anywhere: three questions at most, and her message says where Nishiii looked
serve("WEBSEARCH=unset", "GEMINI=on", "OPENAI=on")
T = login()
n = add_screen(T, "Nobody Knows This Show", "series")
calls(); ops(reset=True)
s, said = ask(T, [n], 3)
qs = questions(calls())
cost = ops()
check("at most three questions for one look", [x["to"] for x in qs] == ["gemini", "openai", "gemini"], [x["to"] for x in qs])
check("and the request stays inside the free plan", cost["storage"] + cost["outside"] + len(qs) + 2 <= 45, cost)
check("her message says where Nishiii looked", s == 502 and "Looked on Wikiquote, IMDb, Google and OpenAI: nothing yet." in said, (s, said))
finish()
