"""The health record's line for looking things up (server/probes.js): each place's last outcome from
data/lookups.json, and a free check that each search key is accepted, so Nishith learns from the weekly check
when Gemini or OpenAI refuse the key or a site turns the app away."""
import json
from a8lib import *

def line(T):
    """The line as the signed-in record has it, with its short reason ("brief") from the stored record."""
    items, _ = part_now(T, "services")
    stored = next(i for i in doc("health")["items"] if i["id"] == "lookups")
    return {**items["lookups"], "brief": stored.get("brief", "")}

# ---- nothing set up, nothing looked up
serve("WEBSEARCH=unset")
T = login()
settle()
pub = {i["id"]: i for i in http("GET", "/api/health")[1]["items"]}
check("the open record has the line, with its state only", "lookups" in pub and set(pub["lookups"]) == {"id", "state", "daysLeft", "checked"} and pub["lookups"]["state"] == "ok", pub.get("lookups"))
l = line(T)
check("with no keys and nothing looked up, it is calm and says so", l["state"] == "ok" and "Gemini: no key." in l["line"] and "OpenAI: no key." in l["line"], l)
ask(T, [add_book(T, "The Salt Road", "Mira Kessel")], 2)       # found on Wikiquote
ask(T, [add_book(T, "Glass Rivers", "Ana Vale")], 2)            # found on Goodreads
l = line(T)
check("a place that worked says when", l["state"] == "ok" and "Wikiquote worked on " in l["line"] and "Goodreads worked on " in l["line"], l)
s, b, _ = http("GET", "/api/health")
check("and the open summary stays 'Everything is working.'", b["message"] == "Everything is working.", b["message"])

# ---- a site that turns the app away
lines_set(sites="blocked", wikiquote="down")
other = add_book(T, "Winter Orchard", "Mira Kessel")
ask(T, [other], 2)
l = line(T)
check("a site that turned the app away is raised, with the reason", l["state"] == "soon" and "Goodreads turned the app away on " in l["line"] and "(search answered 403)" in l["line"], l)
check("so is Wikiquote not answering", "Wikiquote turned the app away" in l["line"] and "answered 503" in l["line"], l["line"])
check("with what to do about it", any("QUOTE_SITES" in f for f in l.get("fix", [])) and "Goodreads turns the app away" in l["brief"], l)
check("and the weekly summary names it", "Looking things up: " in http("GET", "/api/health")[1]["message"], http("GET", "/api/health")[1]["message"])
lines_set(sites="ok", wikiquote="ok")

# ---- keys
serve("WEBSEARCH=unset", "GEMINI=on", "OPENAI=on")
T = login(); calls()
l = line(T)
asked = calls()
check("both keys accepted: calm, with the day's count", l["state"] == "ok" and "Gemini: key accepted, 0 of 40 searches today." in l["line"] and "OpenAI: key accepted, 0 of 20 searches today." in l["line"], l)
check("the key check only reads the model, so it asks nothing and costs nothing", [(x["to"], x["path"]) for x in asked] == [("gemini", "/v1beta/models/gemini-3.8-flash"), ("openai", "/v1/models/gpt-6-luna")]
      and not any(x.get("body") for x in asked), asked)
ops(reset=True); part_now(T, "services"); cost = ops()
check("the services run still costs under twenty calls", cost["storage"] + cost["outside"] <= 20, (cost["storage"], cost["outside"]))
rec = {"day": india_day(), "gemini": {"calls": 40}, "openai": {"calls": 3}, "sites": {}, "last": {"gemini": {"at": 1, "what": "limit"}, "openai": {"at": 1, "what": "used up"}}}
putdoc("lookups", rec)
l = line(T)
check("a limit reached is told plainly, and is no alarm", l["state"] == "ok" and "40 of 40 searches today. The last search stopped at the app's daily limit" in l["line"]
      and "the account's allowance was used up" in l["line"], l)
lines_set(gemini="gone")
l = line(T)
check("a first model that is gone, with a second one offered, is no alarm", l["state"] == "ok" and "Gemini: key accepted" in l["line"], l)

lines_set(gemini="badkey")
l = line(T)
check("a Gemini key that is refused needs attention", l["state"] == "attention" and "Gemini refuses its key." in l["line"] and "Gemini refuses its key" in l["brief"], l)
check("with the steps to make and set a new one", any("GEMINI_API_KEY" in f for f in l["fix"]) and any("aistudio.google.com" in f for f in l["fix"]), l["fix"])
lines_set(gemini="on", openai="refused")
l = line(T)
check("so does an OpenAI key that is refused", l["state"] == "attention" and "OpenAI refuses its key." in l["line"] and any("OPENAI_API_KEY" in f for f in l["fix"]), l)
lines_set(openai="on", gemini="refused"); deldoc("lookups")
book = add_book(T, "Nobody Knows This Book", ""); ask(T, [book], 2)
l = line(T)
check("a key that is accepted but may not search is raised too", l["state"] == "soon" and "Gemini accepts the key but refused to search" in l["line"], l)
no_secrets_ok = "dev-gemini-key" not in json.dumps(l) and "dev-openai-key" not in json.dumps(l)
check("no key is ever in the line", no_secrets_ok)

finish()
