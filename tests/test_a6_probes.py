"""The app checks the real services by itself: read-only probes, merged into the health record, each telling the truth."""
import where as _W
import json, sys
from a6lib import *

ALL = ["instagram", "github", "reels", "nishiii", "backgrounds", "music", "timers",
       "books", "tracks", "photos", "selfcheck", "lookups", "feed", "numbers", "comments", "backup", "cleaning", "errors"]
def states(items): return {k: v["state"] for k, v in items.items()}
def public(): return http("GET", "/api/health")[1]
def writes(): return [x for x in glog() if x["method"] != "GET" and x["path"] not in ("/oauth/access_token",)]

# ---- nothing connected yet, straight after an update
serve()
pub = public()
check("before any check has run, the open record says so and lists nothing", pub["needsAttention"] and pub["items"] == [] and "No check has run yet" in pub["message"], pub)
T = login()
settle()
pub = public()
check("after the timers' first turns, all eighteen lines are there, in order", [i["id"] for i in pub["items"]] == ALL, [i["id"] for i in pub["items"]])
st = {i["id"]: i["state"] for i in pub["items"]}
check("with Instagram not connected its three probes are 'off', not alarms", st["feed"] == st["numbers"] == st["comments"] == "off" and st["selfcheck"] == "off", st)
check("the services and the housekeeping are fine", all(st[k] == "ok" for k in ["books", "tracks", "photos", "backup", "cleaning", "errors"]), st)
check("and nothing needs attention", not pub["needsAttention"] and pub["message"] == "Everything is working.", pub["message"])
check("every line carries when it was checked", all(i["checked"] for i in pub["items"]))
check("the open record has only states, counts and fixed words", set(pub) == {"app", "needsAttention", "message", "asOf", "ageHours", "counts", "notes", "items"}
      and all(set(i) == {"id", "state", "daysLeft", "checked"} for i in pub["items"]), list(pub))
check("it stays small", len(json.dumps(pub)) < 2600, len(json.dumps(pub)))

# ---- connected, with posts
connect(T)
http("GET", "/__seed_posts")
n_writes = len(writes())
check_now(T)
ops(reset=True); items, _ = part_now(T, "services"); cost_s = ops()
ops(reset=True); items, full = part_now(T, "page"); cost_p = ops()
check("connected: every probe is fine", all(items[k]["state"] == "ok" for k in ["books", "tracks", "photos", "feed", "numbers", "comments"]), states(items))
check("the services run costs under twenty calls", cost_s["storage"] + cost_s["outside"] <= 20, (cost_s["storage"], cost_s["outside"], cost_s["what"]))
check("the page run costs under twenty calls", cost_p["storage"] + cost_p["outside"] <= 20, (cost_p["storage"], cost_p["outside"], cost_p["what"]))
asked = [w for w in cost_s["what"] + cost_p["what"] if not w.startswith(("get ", "put ", "head ", "list ", "delete "))]
check("the probes asked the book catalogue, a book's text, the music library, a photo, and Instagram three times",
      any(w.startswith("gutendex GET") for w in asked) and any("book.txt" in w for w in asked) and any(w.startswith("openverse GET /v1/audio/") for w in asked)
      and any("/cdn/" in w for w in asked) and sum(1 for w in asked if w.startswith("graph GET")) >= 3, asked)
check("nothing was posted or written to Instagram", len(writes()) == n_writes and all(w.split()[1] == "GET" for w in asked if w.startswith("graph")), asked)
check("no question was put to Claude by the probes", not any(w.startswith("anthropic POST") for w in asked), asked)
check("the numbers were tried on the newest post made with the app", any("/M1/insights" in w for w in asked), asked)
check("the lines read plainly", "numbers were read" in items["numbers"]["line"] and "tracks" in items["tracks"]["line"] and "a book's text can be read" in items["books"]["line"], [items[k]["line"] for k in ("numbers", "tracks", "books")])
s, b, _ = http("POST", "/api/checkup?part=page", token=T)
check("a group can be asked for at most once a minute", s == 429, (s, b))
check("an unknown group is not found, and a group needs sign-in", http("POST", "/api/checkup?part=everything", token=T)[0] == 404 and http("POST", "/api/checkup?part=page")[0] == 401)
# The probe's music search is kept for her like any other search.
before = len([x for x in hlog() if x["service"] == "openverse"])
s, b, _ = http("GET", "/api/music", token=T)
check("the Music tab's opening search is then answered from the app's own copy", s == 200 and b["items"] and len([x for x in hlog() if x["service"] == "openverse"]) == before)

# ---- the free-books catalogue
hset(gutendex="notext"); items, _ = part_now(T, "services")
check("a catalogue that stops offering plain text is flagged", items["books"]["state"] == "soon" and "from memory" in items["books"]["line"], items["books"])
check("with something to do about it", len(items["books"].get("fix", [])) == 2)
hset(gutendex="textgone"); items, _ = part_now(T, "services")
check("so is a text that can no longer be fetched", items["books"]["state"] == "soon" and "status 403" in items["books"]["line"], items["books"])
hset(gutendex="ok"); items, _ = part_now(T, "services")
check("it clears by itself when the catalogue is back", items["books"]["state"] == "ok")
hset(gutendex="busy"); items, _ = part_now(T, "services")
check("a catalogue that is only busy is no verdict: the last known state stays", items["books"]["state"] == "ok", items["books"])
rec = doc("health")
for i in rec["items"]:
    if i["id"] == "books": i["unknownSince"] = now_ms() - 4 * DAY
putdoc("health", rec); items, _ = part_now(T, "services")
check("busy for over three days is raised", items["books"]["state"] == "attention", items["books"])
hset(gutendex="ok"); part_now(T, "services")

# ---- the music search
hset(tracks="empty"); items, _ = part_now(T, "services")
check("a music library that answers with nothing usable is flagged", items["tracks"]["state"] == "soon" and "no tracks" in items["tracks"]["line"], items["tracks"])
hset(tracks="429"); items, _ = part_now(T, "services")
check("the hourly limit is no verdict", items["tracks"]["state"] == "soon", items["tracks"])      # what was known before stays
hset(tracks="ok"); items, _ = part_now(T, "services")
check("it clears by itself", items["tracks"]["state"] == "ok")
hset(tracks="429"); items, _ = part_now(T, "services")
check("at the limit, a working library stays 'working'", items["tracks"]["state"] == "ok", items["tracks"])
hset(tracks="ok")

# ---- the reel maker's self-test
def dispatches(): return [x for x in hlog() if x["service"] == "github" and "render-check.yml" in x["path"] and x["method"] != "GET"]
hset(selfcheck="pass", selfcheckDays=1); items, _ = part_now(T, "services")
check("a self-test that passed yesterday reads as passed", items["selfcheck"]["state"] == "ok" and items["selfcheck"]["line"].startswith("Passed on "), items["selfcheck"])
check("and the app starts nothing", dispatches() == [], dispatches())
hset(selfcheckDays=9); items, _ = part_now(T, "services")
d = dispatches()
check("when the last run is over eight days old the app switches it on and starts one itself",
      [x["method"] for x in d] == ["PUT", "POST"] and d[0]["path"].endswith("/enable") and d[1]["path"].endswith("/dispatches"), d)
check("and stays calm", items["selfcheck"]["state"] == "ok" and "asked for this week's run" in items["selfcheck"]["line"], items["selfcheck"])
hset(selfcheckDays=30); items, _ = part_now(T, "services")
check("three weeks without a run is flagged", items["selfcheck"]["state"] == "soon" and "Enable workflow" in " ".join(items["selfcheck"]["fix"]), items["selfcheck"])
before = len(dispatches())
hset(selfcheck="fail", selfcheckDays=1); items, _ = part_now(T, "services")
check("one failed run is no alarm yet: the app asks for another run by itself", items["selfcheck"]["state"] == "unknown" and "failed once" in items["selfcheck"]["line"]
      and "asked for another run" in items["selfcheck"]["line"] and len(dispatches()) == before + 2, (items["selfcheck"], dispatches()))
check("and the open record stays quiet about it", "self-test" not in public()["message"], public()["message"])
hset(selfcheck="fail", selfcheckDays=6); items, _ = part_now(T, "services")
check("a failure that nothing has followed for days is raised", items["selfcheck"]["state"] == "attention", items["selfcheck"])
hset(selfcheck="fail2", selfcheckDays=1); items, _ = part_now(T, "services")
check("two failures in a row are raised", items["selfcheck"]["state"] == "attention" and "twice running" in items["selfcheck"]["line"], items["selfcheck"])
check("the open record names it", "Reel maker's self-test: the reel maker's self-test failed" in public()["message"], public()["message"])
hset(selfcheck="none"); items, _ = part_now(T, "services")
check("one that has never run is started, and is no alarm", items["selfcheck"]["state"] == "unknown" and "started for the first time" in items["selfcheck"]["line"], items["selfcheck"])
hset(selfcheck=""); items, _ = part_now(T, "services")
check("no self-test on GitHub at all reads as 'off'", items["selfcheck"]["state"] == "off", items["selfcheck"])

# ---- Instagram: the version, the permissions
hset(graphVersion="v27.0"); items, _ = part_now(T, "page")
check("Meta answering as a newer version than the app asks for is flagged", items["feed"]["state"] == "soon" and "v25.0" in items["feed"]["line"] and "v27.0" in items["feed"]["line"], items["feed"])
check("the open record says it in fixed words", "Your posts on Instagram: Meta has withdrawn the version" in public()["message"], public()["message"])
hset(graphVersion="v25.0"); items, _ = part_now(T, "page")
check("the version the app asks for is fine", items["feed"]["state"] == "ok", items["feed"])
hset(graphVersion="")
# A permission that was there and has gone: the Instagram line raises it; the probes don't say it a second time.
hset(scopes="instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement"); check_now(T)
items, _ = part_now(T, "page")
check("a permission that has gone is raised by the Instagram line", items["instagram"]["state"] == "attention" and "permission" in items["instagram"]["line"], items["instagram"])
check("and not a second and third time by the probes", items["numbers"]["state"] == "off" and items["comments"]["state"] == "off", states(items))
check("so the open record counts one thing", public()["message"].startswith("1 thing needs attention. Instagram: a permission is missing"), public()["message"])
hset(scopes="instagram_basic,instagram_content_publish,instagram_manage_insights,instagram_manage_comments,pages_show_list,pages_read_engagement"); check_now(T)
items, _ = part_now(T, "page")
check("with the permissions back, both clear", items["numbers"]["state"] == "ok" and items["comments"]["state"] == "ok", states(items))

# ---- the probes themselves going quiet
rec = doc("health"); rec["probed"]["services"] = now_ms() - 4 * DAY; rec["firstAt"] = now_ms() - 9 * DAY; putdoc("health", rec)
check_now(T)
pub = public()
check("probes that haven't run for three days are themselves reported", pub["needsAttention"] and "haven't run for three days" in pub["message"], pub["message"])
part_now(T, "services")
check("and that clears when they run again", not public()["needsAttention"], public()["message"])
text = json.dumps(public()) + json.dumps(http("GET", "/api/checkup", token=T)[1]) + open(f"{_W.OUT}/dev.log").read().replace("passcode: letmein", "")
check("no key or token in the open record, the full record or the log", not no_secrets(text), no_secrets(text))

# ---- Instagram refusing comments although the permission is listed; photos that can't be fetched
serve("NO_COMMENTS=1", "PHOTOS=allrefused")
T = login(); connect(T); http("GET", "/__seed_posts"); check_now(T)
items, _ = part_now(T, "page")
check("Instagram refusing to show comments is flagged whatever the permissions say", items["comments"]["state"] == "soon", items["comments"])
items, _ = part_now(T, "services")
check("a photo that can't be fetched through the server is flagged", items["photos"]["state"] == "soon" and "addresses tried" in items["photos"]["line"], items["photos"])
check("the search key itself is still reported as working", {i["id"]: i for i in http("GET", "/api/checkup", token=T)[1]["items"]}["backgrounds"]["state"] == "ok")

# ---- permissions never given when Instagram was connected: only the probes can say so
serve()
hset(scopes="instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement")
T = login(); connect(T); http("GET", "/__seed_posts"); check_now(T)
items, _ = part_now(T, "page")
check("the Instagram line itself is calm (posting works)", items["instagram"]["state"] == "ok", items["instagram"])
check("without the permission for numbers: raised, with the permission named", items["numbers"]["state"] == "attention" and "instagram_manage_insights" in " ".join(items["numbers"]["fix"]), items["numbers"])
check("without the permission for comments: flagged, with the permission named", items["comments"]["state"] == "soon" and "instagram_manage_comments" in " ".join(items["comments"]["fix"]), items["comments"])
check("both offer Connect again", items["numbers"].get("action") == "reconnect" and items["comments"].get("action") == "reconnect")
pub = public()
check("the open record tells the truth about both", "Post numbers: the permission to read post numbers is missing" in pub["message"] and "Comments: the permission for comments is missing" in pub["message"], pub["message"])

# ---- a page with nothing posted yet
serve()
T = login(); connect(T); check_now(T)
items, _ = part_now(T, "page")
check("nothing posted yet: the list answers, numbers and comments are ready", items["feed"]["state"] == "ok" and "nothing posted yet" in items["feed"]["line"]
      and items["numbers"]["state"] == "ok" and items["comments"]["state"] == "ok", [items[k]["line"] for k in ("feed", "numbers", "comments")])
finish()
