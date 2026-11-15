"""'Who said this?' looks the line up (server/verify.js): Wikiquote and Quote Investigator first, then Gemini or
OpenAI, and the verdict names the pages it rests on. A misattribution is caught; with nothing to search the
answer is from memory and says so; nothing personal is sent; the searches share the daily limits and never
keep her waiting long. Every person and line here is made up."""
import time, json, re
from a8lib import *

def verify_log(reset=True): return http("GET", "/__verify_log" + ("?reset=1" if reset else ""))[1]
def verify_set(**kw): return http("GET", "/__verify_set?" + urllib.parse.urlencode(kw))[1]
def check_quote(T, text, author=""):
    t0 = time.time()
    s, b, _ = http("POST", "/api/check", {"text": text, "author": author}, T)
    return s, b, time.time() - t0
def sites(b): return [x["site"] for x in b.get("sources", [])]

serve("WEBSEARCH=unset")
T = login()

# ---- a misattribution, caught on Wikiquote's "Misattributed" section and Quote Investigator's article
calls(); verify_log()
s, b, _ = check_quote(T, "Kindness is the only language the tide understands.", "Edda Marlowe")
check("a misattributed line is caught", s == 200 and b["verdict"] == "different_author" and b["author"] == "Pell Arden", b)
check("the verdict rests on the web and names the page", b.get("basis") == "web" and b["sources"] and b["sources"][0]["url"].startswith("https://en.wikiquote.org/wiki/Edda_Marlowe#Misattributed"), b.get("sources"))
wq = to(calls(), "wikiquote")
check("Wikiquote's text was searched, then the claimed author's page read", len(wq) == 2 and wq[0]["query"].get("srwhat") == "text" and wq[1]["query"].get("titles") == "Edda Marlowe", wq)
qi = verify_log()
check("Quote Investigator was searched and its article read", [x["to"] for x in qi] == ["qi", "qi"] and qi[1]["path"] == "/wp-json/wp/v2/posts/41001", qi)
check("every lookup says who is asking", all(x["agent"].startswith("DsStudio/") for x in wq + qi), [x["agent"] for x in wq + qi])

# ---- a line that is where it is said to be
s, b, _ = check_quote(T, "The lamp is lit for the ones who are still walking.", "Edda Marlowe")
check("a real line is confirmed, from her page", s == 200 and b["verdict"] == "matches" and b["basis"] == "web" and sites(b) == ["wikiquote.org"]
      and b["sources"][0]["url"] == "https://en.wikiquote.org/wiki/Edda_Marlowe#Quotes", b)
s, b, _ = check_quote(T, "A small door is still a door.", "Tomas Reyna")
check("Quote Investigator alone can settle it", s == 200 and b["verdict"] == "matches" and sites(b) == ["quoteinvestigator.com"]
      and b["sources"][0]["url"] == "https://quoteinvestigator.com/2021/08/09/small-door/", b)

# ---- nothing on the web, no search helper: from memory, and marked so
calls(); verify_log()
s, b, _ = check_quote(T, "The happiness of your life depends upon the quality of your thoughts.", "Marcus Aurelius")
check("with nothing found, the answer is from memory and says so", s == 200 and b["basis"] == "memory" and b["sources"] == [] and b["verdict"] == "matches", b)
check("without a key, no search helper was asked", not to(calls(), "gemini") and not to(calls(), "openai"))

# ---- the free places down: still an answer, from memory, and the record notes it
lines_set(wikiquote="down"); verify_set(mode="down")
s, b, _ = check_quote(T, "Kindness is the only language the tide understands.", "Edda Marlowe")
rec = doc("lookups") or {}
check("with Wikiquote and Quote Investigator down, the check still answers, from memory", s == 200 and b["basis"] == "memory" and b["sources"] == [], b)
check("the record of lookups notes both as not answering", rec["sites"]["wikiquote"].get("failed") and rec["sites"]["quoteinvestigator"].get("failed")
      and rec["sites"]["wikiquote"]["why"] == "answered 503", rec.get("sites"))
lines_set(wikiquote="ok"); verify_set(mode="ok")

# ---- slow places: a few seconds, then on without them
lines_set(slow=6000); verify_set(slow=6000)
s, b, took = check_quote(T, "Every tide is a small forgiveness.", "Edda Marlowe")
check("slow places never keep her waiting more than a few seconds", s == 200 and took < 12 and b["basis"] == "memory", (round(took, 1), b))
lines_set(slow=0); verify_set(slow=0)

# ---- a search helper, when the free places have nothing
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
calls(); verify_log()
s, b, _ = check_quote(T, "The moon keeps the minutes of the sea, they say.", "Edda Marlowe")
g = to(calls(), "gemini")
check("when Wikiquote and Quote Investigator have nothing, Gemini searches", len(g) == 1 and g[0]["body"]["tools"] == [{"google_search": {}}], g)
check("its answer catches the misattribution, with a page it read", s == 200 and b["verdict"] == "different_author" and b["author"] == "Ilse Varga"
      and b["basis"] == "web" and b["sources"][0]["url"] == "https://quoteinvestigator.com/2020/03/03/moon-minutes/", b)
prompt = g[0]["body"]["contents"][0]["parts"][0]["text"]
check("nothing personal is sent: only the line and the name on it", 'Quote: "The moon keeps the minutes of the sea, they say."' in prompt and "Credited to: Edda Marlowe" in prompt
      and not re.search(r"\b(dhruuu|nishiii|nishith|entangledd|taste|instagram|her|she)\b", prompt.lower()) and set(g[0]["body"]) == {"contents", "tools", "generationConfig"}, prompt)
check("the question counts against Gemini's daily limit", (doc("lookups") or {}).get("gemini", {}).get("calls") == 1 and doc("lookups")["last"]["gemini"]["what"] == "worked", doc("lookups"))
s, b, _ = check_quote(T, "Kindness is the only language the tide understands.", "Edda Marlowe")
check("a line the free places settle does not use a search", s == 200 and b["basis"] == "web" and not to(calls(), "gemini"), b)
s, b, _ = check_quote(T, "Nobody Knows who wrote this line, not even the sea.", "")
check("a search that finds nothing leaves the answer to memory, marked", s == 200 and b["basis"] == "memory" and b["sources"] == [], b)

# ---- the shared daily limit
rec = doc("lookups"); rec["gemini"]["calls"] = 40; putdoc("lookups", rec); calls()
s, b, _ = check_quote(T, "The moon keeps the minutes of the sea, they say.", "Edda Marlowe")
check("at the day's limit Gemini is not asked", s == 200 and not to(calls(), "gemini") and b["basis"] == "memory", b)
check("and the record says the limit was reached", doc("lookups")["last"]["gemini"]["what"] == "limit", doc("lookups")["last"])

# ---- a key Google does not know is read as refused, not as a missing model
serve("WEBSEARCH=unset", "GEMINI=badkey")
T = login(); calls()
s, b, _ = check_quote(T, "The moon keeps the minutes of the sea, they say.", "Edda Marlowe")
rec = doc("lookups") or {}
check("a refused Gemini key: the check still answers", s == 200 and b["basis"] == "memory", b)
check("the refusal is recorded as such, and the second model is not tried", rec["gemini"].get("off") == "refused" and rec["last"]["gemini"]["what"] == "refused"
      and len(to(calls(), "gemini")) == 1, rec)

# ---- OpenAI as the second helper
serve("WEBSEARCH=unset", "OPENAI=on")
T = login(); calls()
s, b, _ = check_quote(T, "The moon keeps the minutes of the sea, they say.", "")
o = to(calls(), "openai")
check("with only OpenAI, it searches instead", len(o) == 1 and o[0]["body"]["tools"] == [{"type": "web_search"}] and "Credited to: nobody" in o[0]["body"]["input"], o)
check("and its answer rests on a page it opened", s == 200 and b["basis"] == "web" and b["sources"][0]["site"] in ("quoteinvestigator.com", "wikiquote.org"), b)

# ---- an empty canvas
s, b, _ = check_quote(T, "  ", "Edda Marlowe")
check("an empty quote is turned away kindly", s == 400 and "no quote" in b["error"].lower(), (s, b))
finish()
