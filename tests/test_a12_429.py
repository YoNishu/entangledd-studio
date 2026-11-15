"""A 429 is not the end (server/findlines.js): a Gemini model with no allowance on a free key ("limit: 0") sends the
app to the next model the key may use, flash-lite ones included, and the model that worked is recorded; a passing
rate limit is waited out once and never rests the service for the day; OpenAI with no credit rests for the day after
one question; the health line says what each key lacks, in plain words, with refused searches counted as refused.
Also: IMDb's 202 (its challenge to robots) rests IMDb for a week, said once. Every work here is made up."""
import json
from a8lib import *

def steps(wid): return ((work(wid).get("found") or {}).get("trail") or {}).get("steps", [])
def qs(log, who): return [x for x in log if x["to"] == who and x.get("body")]
def health(T):
    return part_now(T, "services")[0]["lookups"]

# ---- 1. a flash model with no allowance: the flash-lite model is asked next, and works
serve("WEBSEARCH=unset", "GEMINI=lite", "GEMINI_MODEL=gemini-3.8-flash,gemini-2.5-flash-lite")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
s, got = ask(T, [w], 3)
log = calls()
g = qs(log, "gemini")
check("the flash model is asked, refuses with 'limit: 0', then the flash-lite model is asked", [x["model"] for x in g] == ["gemini-3.8-flash", "gemini-2.5-flash-lite"], [x["model"] for x in g])
rec = doc("lookups")
check("the model that worked is recorded", rec["last"]["gemini"].get("what") == "worked" and rec["last"]["gemini"].get("model") == "gemini-2.5-flash-lite", rec["last"])
check("the refused model is not asked again today, and Gemini is not rested", rec["gemini"].get("skip") == ["gemini-3.8-flash"] and not rec["gemini"].get("off"), rec["gemini"])
st = steps(w)
check("the trail has Google's own words for the refusal", any(x["where"] == "gemini" and x["what"] == "no allowance" and "limit: 0" in x.get("said", "") for x in st), st)
check("lines from the model that worked are kept", any(l["text"].startswith("Google found this first line") for l in kept(w)), kept(w))
line = health(T)["line"]
check("the health line counts one answered and one refused", "1 of 40 searches answered today, 1 refused" in line and "gemini-2.5-flash-lite" in line, line[:500])

# ---- 2. the models from the key's own list: the ones with a free search allowance first
serve("WEBSEARCH=unset", "GEMINI=lite")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
ask(T, [w], 3)
g = qs(calls(), "gemini")
check("from the key's list, gemini-2.5-flash-lite is asked first and answers", [x["model"] for x in g] == ["gemini-2.5-flash-lite"], [x["model"] for x in g])

# ---- 3. every model with no allowance: rested for the day, said plainly
serve("WEBSEARCH=unset", "GEMINI=limit0")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
ask(T, [w], 3)
g = qs(calls(), "gemini")
check("each model the key may use is tried once", sorted(x["model"] for x in g) == sorted(["gemini-3.5-flash-lite", "gemini-3.8-flash"]), [x["model"] for x in g])
rec = doc("lookups")
check("then Gemini rests for the day: no allowance", rec["gemini"].get("off") == "no allowance" and rec["gemini"].get("refused") == 2, rec["gemini"])
w2 = add_screen(T, "The Long Tide (2016)", "film")
ask(T, [w2], 3)
check("and is not asked again today", not qs(calls(), "gemini"))
h = health(T)
check("the health line: Google gives this free key no searches, with Google's words", "Google gives this free key no searches: 0 of 40 searches answered today, 2 refused" in h["line"] and "limit: 0" in h["line"], h["line"][:500])
check("with the one-line fix", any("Set up billing" in f for f in h.get("fix", [])), h.get("fix"))

# ---- 4. a passing rate limit: waited out once, never rests the service
serve("WEBSEARCH=unset", "GEMINI=busy")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
ask(T, [w], 3)
g = qs(calls(), "gemini")
check("a per-minute 429 is waited out and the same model asked again", len(g) == 2 and g[0]["model"] == g[1]["model"], [x["model"] for x in g])
check("and lines come back", any(l["text"].startswith("Google found") for l in kept(w)))
serve("WEBSEARCH=unset", "GEMINI=busy2")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
ask(T, [w], 3)
g = qs(calls(), "gemini")
rec = doc("lookups")
check("still busy after one wait: stops there, without resting for the day", len(g) == 2 and not rec["gemini"].get("off") and rec["last"]["gemini"]["what"] == "busy", (len(g), rec["gemini"], rec["last"]))
w2 = add_screen(T, "The Glass Orchard", "series")
ask(T, [w2], 3)
check("so the next look asks again", len(qs(calls(), "gemini")) >= 1)

# ---- 5. OpenAI: no credit rests it after one question; a passing limit is waited out
serve("WEBSEARCH=unset", "OPENAI=429")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
ask(T, [w], 3)
o = qs(calls(), "openai")
rec = doc("lookups")
check("insufficient_quota: one question, then no credit for the day", len(o) == 1 and rec["openai"].get("off") == "no credit", (len(o), rec["openai"]))
h = health(T)
check("the health line: OpenAI has no credit on this key, with the fix", "OpenAI has no credit on this key" in h["line"] and any("Add to credit balance" in f for f in h.get("fix", [])), (h["line"][:400], h.get("fix")))
serve("WEBSEARCH=unset", "OPENAI=ratelimit")
T = login()
w = add_screen(T, "The Long Tide", "series")
calls()
ask(T, [w], 3)
o = qs(calls(), "openai")
check("OpenAI's rate limit is waited out once, and it answers", len(o) >= 2 and o[0]["model"] == o[1]["model"] and any(l["text"].startswith("OpenAI found") for l in kept(w)), (len(o), kept(w)))

# ---- 6. IMDb's 202: rested for a week, said once
serve("WEBSEARCH=unset", "SITES=challenge")
T = login()
w = add_screen(T, "Quiet Harbour", "series")
calls()
ask(T, [w], 3)
st = steps(w)
blocked = [x for x in st if x["where"] == "imdb"]
check("IMDb's 202 is on the trail as 'blocked', with the week's rest", blocked and blocked[0]["what"] == "blocked" and "7 days" in blocked[0].get("why", ""), blocked)
site = doc("lookups")["sites"]["imdb"]
check("IMDb rests for seven days", site.get("blocked") and abs(site["until"] - site["failed"] - 7 * DAY) < 5000, site)
rec = doc("lookups"); rec["sites"]["imdb"]["failed"] -= 2 * DAY; putdoc("lookups", rec)
w2 = add_screen(T, "Quiet Harbour (2022)", "series")
calls()
ask(T, [w2], 3)
log = calls()
check("two days later IMDb is not asked, and the trail does not say so again", not [x for x in log if x["to"] == "imdb" and "/quotes" in x["path"]] and not [x for x in steps(w2) if x["where"] == "imdb"], [x["path"] for x in log if x["to"] == "imdb"])
rec = doc("lookups"); rec["sites"]["imdb"]["until"] -= 8 * DAY; putdoc("lookups", rec)
w3 = add_screen(T, "Quiet Harbour", "film")
calls()
ask(T, [w3], 3)
check("after the week IMDb is asked again", any(x["to"] == "imdb" for x in calls()))
finish()
