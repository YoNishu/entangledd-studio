"""Every line of the health record, in every state it can be in.
Run: python3 tests/test_a3_states.py   (starts its own fresh servers on port its own port)"""
import where as _W
import datetime, subprocess
from a3lib import *

def fresh(*settings, **mode):
    serve(*settings); t = login(); connect(t)
    if mode: hset(**mode)
    return t
def state(items, id, want, **more):
    i = items[id]; ok = i["state"] == want
    for k, v in more.items():
        if k == "says": ok = ok and v in i["line"]
        elif k == "fix": ok = ok and (len(i.get("fix", [])) >= v if v else "fix" not in i)
        elif k == "days": ok = ok and v[0] <= i.get("daysLeft", -999) <= v[1]
    return check(f"{id}: {want}" + (f" ({more.get('says')})" if more.get("says") else ""), ok, i)

print("Instagram")
serve(); t = login()
items, _ = check_now(t)
state(items, "instagram", "off", says="Not connected")
connect(t)
items, body = check_now(t)
state(items, "instagram", "ok", says="Connected as @theentangledd", fix=0, days=(58, 60))
check("all seven lines are there, in order", [i["id"] for i in body["items"]] == ["instagram", "github", "reels", "nishiii", "backgrounds", "music", "timers"])
hset(userDays=21, exchange="same"); ig = doc("instagram"); ig["userTokenExpires"] = now_ms() + 21 * DAY; putdoc("instagram", ig)
items, _ = check_now(t); state(items, "instagram", "soon", says="music search stops on", fix=3, days=(20, 21))
hset(userDays=23); ig = doc("instagram"); ig["userTokenExpires"] = now_ms() + 23 * DAY; ig["renewTriedAt"] = now_ms(); putdoc("instagram", ig)
items, _ = check_now(t); state(items, "instagram", "ok", days=(22, 23))
check("22 whole days left: not yet a warning (it starts at 21)", items["instagram"]["state"] == "ok" and "fix" not in items["instagram"])
hset(userValid="no")
items, _ = check_now(t); state(items, "instagram", "soon", says="music search has stopped", fix=3)
check("the dead sign-in is no longer tried first", doc("instagram")["userTokenExpires"] <= now_ms())
hset(userValid="yes", userDays=None, dataDays=10); ig = doc("instagram"); ig["userTokenExpires"] = now_ms() + 60 * DAY; ig["renewTriedAt"] = now_ms(); putdoc("instagram", ig)
items, _ = check_now(t); state(items, "instagram", "soon", says="Meta wants a fresh sign-in by", fix=3, days=(9, 10))
hset(dataDays=-1)
items, _ = check_now(t); state(items, "instagram", "attention", says="Meta wants a fresh sign-in before", fix=3)
hset(dataDays=None, scopes="instagram_basic,instagram_manage_insights,instagram_manage_comments,pages_show_list,pages_read_engagement")
items, _ = check_now(t); state(items, "instagram", "attention", says="permission for posting is missing", fix=3)
hset(appSecret="refused")
items, _ = check_now(t); state(items, "instagram", "attention", says="app's own ID and secret", fix=2)

print("Instagram: a permission never given is only mentioned; one that disappears is raised")
t = fresh(scopes="instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement")
items, _ = check_now(t); state(items, "instagram", "ok", says="Not switched on: reading and answering comments")
t = fresh()
check_now(t)                                         # sees all six permissions
hset(scopes="instagram_basic,instagram_content_publish,instagram_manage_comments,pages_show_list,pages_read_engagement")
items, _ = check_now(t); state(items, "instagram", "attention", says="the numbers in Posts and Insights is missing")

print("Instagram: Meta being briefly down is not a verdict")
t = fresh()
items, _ = check_now(t); was = items["instagram"]
hset(graphBusy="yes")
items, _ = check_now(t)
check("the last known state is kept", items["instagram"]["state"] == "ok" and items["instagram"]["line"] == was["line"] and items["instagram"]["checked"] == was["checked"], items["instagram"])

print("Reel maker's key (GitHub)")
t = fresh()
items, _ = check_now(t); state(items, "github", "ok", says="no end date", fix=0)
hset(githubEnds=200); items, _ = check_now(t); state(items, "github", "ok", says="good until", days=(199, 200))
hset(githubEnds=12); items, _ = check_now(t); state(items, "github", "soon", says="runs out on", fix=3, days=(11, 12))
hset(githubEnds=12, githubStyle="offset"); items, _ = check_now(t); state(items, "github", "soon", days=(11, 12))
check("the fix says how to make it never run out", any("No expiration" in s for s in items["github"]["fix"]))
hset(githubEnds="", github="401"); items, _ = check_now(t); state(items, "github", "attention", says="no longer accepts the key", fix=3)
hset(github="404"); items, _ = check_now(t); state(items, "github", "attention", says="can't see the reel maker", fix=3)
hset(github="403"); items, _ = check_now(t); state(items, "github", "attention", says="isn't allowed", fix=3)
hset(github="off"); items, _ = check_now(t); state(items, "github", "attention", says="switched off on GitHub", fix=1)
hset(github="ok"); items, _ = check_now(t); was = items["github"]
hset(github="busy"); items, body = check_now(t)
check("GitHub briefly down: last known state kept, the other six still checked",
      items["github"]["line"] == was["line"] and items["github"]["checked"] == was["checked"] and len(body["items"]) == 7 and items["nishiii"]["checked"] > was["checked"])

print("One check that can't be made for three days is raised")
rec = doc("health")
for i in rec["items"]:
    if i["id"] == "github": i["state"] = "unknown"; i["unknownSince"] = now_ms() - 4 * DAY
putdoc("health", rec)
items, _ = check_now(t); state(items, "github", "attention", says="couldn't be checked since")
hset(github="ok"); items, _ = check_now(t); state(items, "github", "ok")

print("Reel maker (what real use showed)")
t = fresh()
items, _ = check_now(t); state(items, "reels", "ok", says="No reel has been made")
putdoc("healthnotes", {"reel": {"okAt": now_ms() - 3600000, "startedAt": now_ms() - 3700000, "fails": 0}})
items, _ = check_now(t); state(items, "reels", "ok", says="The last reel was made on")
putdoc("healthnotes", {"reel": {"okAt": now_ms() - DAY, "failAt": now_ms() - 60000, "startedAt": now_ms() - 90000, "fails": 1, "why": "That music file has no sound the app can read."}})
items, _ = check_now(t); state(items, "reels", "ok", says="didn't finish", fix=0)
putdoc("healthnotes", {"reel": {"okAt": now_ms() - DAY, "failAt": now_ms() - 60000, "startedAt": now_ms() - 90000, "fails": 2, "why": "The reel could not be put together."}})
items, _ = check_now(t); state(items, "reels", "attention", says="The last 2 reels didn't finish", fix=3)
putdoc("healthnotes", {"reel": {"okAt": now_ms() - DAY, "startedAt": now_ms() - 30 * 60000}})
items, _ = check_now(t); state(items, "reels", "attention", says="never came back", fix=3)
putdoc("healthnotes", {"reel": {"okAt": now_ms() - DAY, "startedAt": now_ms() - 5 * 60000}})
items, _ = check_now(t); state(items, "reels", "ok")
check("a reel still being made is not called lost", items["reels"]["state"] == "ok")
putdoc("healthnotes", {"reel": {"okAt": now_ms() - DAY, "startedAt": now_ms() - DAY - 5000, "refusedAt": now_ms() - 1000, "refusedStatus": 403}})
items, _ = check_now(t); state(items, "github", "attention", says="refused to start a reel", fix=3)

print("Nishiii (Anthropic)")
t = fresh()
items, _ = check_now(t); state(items, "nishiii", "ok", says="key is working", fix=0)
hset(model="deprecated", modelDays=200); items, _ = check_now(t); state(items, "nishiii", "ok", says="will be retired on", fix=0, days=(199, 200))
check("a retirement months away is mentioned, not raised", "will move to the newest one by itself" in items["nishiii"]["line"] and http("GET", "/api/health")[1]["needsAttention"] is False, items["nishiii"])
# (Agent 6: a model on its way out no longer needs anyone. The app moves to the newest Sonnet by itself on
#  the day, so an announced retirement is mentioned and never raised; see test_a6_model.py for the move.)
hset(model="deprecated", modelDays=32); items, _ = check_now(t); state(items, "nishiii", "ok", days=(31, 32))
hset(model="deprecated", modelDays=30); items, _ = check_now(t); state(items, "nishiii", "ok", says="will be retired on", fix=0, days=(29, 30))
hset(model="legacy", modelDays=12); items, _ = check_now(t); state(items, "nishiii", "ok", says="will be retired on", fix=0, days=(11, 12))
hset(model="active-dated", modelDays=-2000); items, _ = check_now(t); state(items, "nishiii", "ok", says="key is working", fix=0)
hset(model="active-dated", modelDays=20); items, _ = check_now(t); state(items, "nishiii", "ok", says="will be retired on", days=(19, 20))
hset(model="deprecated", modelDays=""); items, _ = check_now(t); state(items, "nishiii", "ok", says="retired before long", fix=0)
# A lookup that says "gone" is tested with one small real question: while that is still answered, nothing is wrong.
hset(model="deprecated", modelDays=-1); items, _ = check_now(t); state(items, "nishiii", "ok", says="key is working", fix=0)
hset(model="retired"); items, _ = check_now(t); state(items, "nishiii", "ok", says="key is working", fix=0)
hset(model="404"); items, _ = check_now(t); state(items, "nishiii", "ok", says="key is working", fix=0)
# Really gone, and no other Sonnet to move to: that is raised.
hset(model="retired", modelGone="yes", modelList="none"); items, _ = check_now(t); state(items, "nishiii", "attention", says="couldn't move to a newer one", fix=2)
hset(modelGone="", modelList="ok")
hset(model="active", claudeKey="401"); items, _ = check_now(t); state(items, "nishiii", "attention", says="no longer accepts Nishiii's key", fix=2)
hset(claudeKey="ok"); items, _ = check_now(t); state(items, "nishiii", "ok")

print("Background search and free music")
hset(pixabay="400"); items, _ = check_now(t); state(items, "backgrounds", "attention", says="no longer accepts the key", fix=2)
hset(pixabay="429"); items, _ = check_now(t); state(items, "backgrounds", "ok", says="busy this minute")
hset(pixabay="ok"); items, _ = check_now(t); state(items, "backgrounds", "ok", says="Working.")
state(items, "music", "ok", says="free allowance")
t = fresh("OV_KEYS=1")
items, _ = check_now(t); state(items, "music", "ok", says="registered key")
hset(openverse="401"); items, _ = check_now(t); state(items, "music", "soon", says="refuses the app's registered key", fix=2)

print("Daily routines (the timers)")
t = fresh()
items, _ = check_now(t); state(items, "timers", "unknown", says="haven't run yet")
ist = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)
morning_due = ist.hour + ist.minute / 60 >= 6.75
tick_job("health-check")
rec = doc("health"); tm = next(i for i in rec["items"] if i["id"] == "timers")
check("a check made by the timer itself reports the timers as running", tm["state"] == "ok" and tm["line"].startswith("Running"), tm)
if morning_due:
    check("first morning without prepared quotes: mentioned, not raised", "weren't prepared at 6 am" in tm["line"] and rec["missedMornings"] == 1, (tm, rec.get("missedMornings")))
    rec["missedDay"] = "2026-01-01"; putdoc("health", rec)        # as if that was yesterday
    items, _ = check_now(t); state(items, "timers", "soon", says="2 days running", fix=2)
    cron("30 0 * * *")                                             # the daily pass prepares today's quotes
    items, _ = check_now(t); state(items, "timers", "ok", says="ready on time")
    check("the count of missed mornings starts again", doc("health")["missedMornings"] == 0)
else:
    print("  (before 6:45 am in India: the morning check is skipped at this hour, as designed)")
    check("no morning verdict this early", tm["line"] == "Running.", tm)
stamps = doc("jobstamps"); putdoc("jobstamps", {k: now_ms() - 31 * 3600000 for k in stamps})
items, _ = check_now(t); state(items, "timers", "attention", says="timers haven't run since", fix=2)
putdoc("jobstamps", {k: now_ms() - 29 * 3600000 for k in stamps})
items, _ = check_now(t)
check("29 quiet hours are still normal", items["timers"]["state"] == "ok", items["timers"])

print("Nothing private in the record itself")
blob = json.dumps(doc("health")) + json.dumps(doc("healthnotes") or {})
check("no key or token is stored in the record", not no_secrets(blob), no_secrets(blob))

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()
