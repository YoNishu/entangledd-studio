"""The Instagram sign-in renews itself: works and saves; a refusal keeps the old one; nothing leaks.
Run: python3 tests/test_a3_renew.py   (starts its own fresh servers on its own port)"""
import where as _W
import json, subprocess
from a3lib import *

USER, PAGE = "LONG-user-token-0123456789", "PAGE-token-0123456789"
def exchanges(): return sum(1 for c in hlog() if c["path"].endswith("/oauth/access_token"))
def fresh(**mode):
    serve(); t = login(); connect(t)
    if mode: hset(**mode)
    return t
def set_ig(**changes):
    ig = doc("instagram"); ig.update(changes); putdoc("instagram", ig); return ig
near = lambda a, b, slack=3600 * 1000: abs(a - b) <= slack

print("A. 20 days left, Meta extends: the app renews by itself")
t = fresh(userDays=20, exchange="extend")
set_ig(userTokenExpires=now_ms() + 20 * DAY)
check("the renewal job had its turn", tick_job("instagram-renew"))
ig = doc("instagram")
check("a new sign-in was saved", ig["userToken"] == "LONG-user-token-R1", ig["userToken"][:22])
check("it is good for about 60 days", near(ig["userTokenExpires"], now_ms() + 60 * DAY), ig["userTokenExpires"])
check("when it was renewed is recorded", near(ig.get("renewedAt", 0), now_ms()) and ig.get("renewNote") == "")
check("the Page token was left alone", ig["pageToken"] == PAGE)
check("exactly one renewal call was made", exchanges() == 2, exchanges())      # 1 at connect + 1 renewal
s, b, _ = http("GET", "/api/instagram/audio?q=", token=t)
check("Instagram's music search works with the renewed sign-in", s == 200 and len(b["items"]) == 3, (s, b))
check("the check job had its turn", tick_job("health-check"))
rec = doc("health"); item = next(i for i in rec["items"] if i["id"] == "instagram")
check("the record says the app renewed it", item["state"] == "ok" and "renewed the sign-in by itself" in item["line"], item["line"])
check("about 59 days are shown as left", 58 <= item.get("daysLeft", -1) <= 60, item.get("daysLeft"))
s, b, _ = http("GET", "/api/instagram", token=t)
check("Settings can tell it was renewed", b.get("renewedAt", 0) > 0 and near(b["musicUntil"], now_ms() + 60 * DAY))
leaks = []
for path in ["/api/checkup", "/api/health", "/api/instagram"]:
    leaks += no_secrets(http("GET", path, token=t, raw=True)[1])
check("no key or token appears in any answer", not leaks, leaks)

print("B. 60 days left: nothing to do, nothing is touched")
t = fresh()
before = doc("instagram")
tick_job("instagram-renew")
check("no renewal call", exchanges() == 1, exchanges())
check("the connection is untouched", doc("instagram") == before)

print("C. Meta refuses: the old sign-in stays, a reason is kept, and it waits a day")
t = fresh(userDays=20, exchange="refuse")
set_ig(userTokenExpires=now_ms() + 20 * DAY)
tick_job("instagram-renew")
ig = doc("instagram")
check("the old sign-in is still there", ig["userToken"] == USER and ig["pageToken"] == PAGE)
check("a plain reason is recorded", ig.get("renewNote") == "Meta no longer accepts the current sign-in.", ig.get("renewNote"))
check("nothing claims it was renewed", not ig.get("renewedAt"))
n = exchanges(); make_due("instagram-renew"); tick_job("instagram-renew")
check("it is not tried again the same day", exchanges() == n, (n, exchanges()))
ig["renewTriedAt"] -= 21 * 3600 * 1000; putdoc("instagram", ig); make_due("instagram-renew"); tick_job("instagram-renew")
check("it is tried again the next day", exchanges() == n + 1, (n, exchanges()))
items, _ = check_now(t)
i = items["instagram"]
check("the check warns 20 days ahead, with the steps", i["state"] == "soon" and 19 <= i["daysLeft"] <= 20 and len(i.get("fix", [])) == 3 and i.get("action") == "reconnect", i)
check("it says what the app tried", "tried to renew it itself" in i["line"], i["line"])

for label, how, note in [("D. Meta gives the same end date", "same", "Meta gave the same end date as before."),
                         ("E. Meta's new sign-in fails Meta's own check", "invalid", "Meta's new sign-in didn't pass Meta's own check."),
                         ("F. Meta is having a bad moment", "busy", None)]:
    print(label + ": the old sign-in stays")
    t = fresh(userDays=20, exchange=how)
    set_ig(userTokenExpires=now_ms() + 20 * DAY)
    tick_job("instagram-renew")
    ig = doc("instagram")
    check("old sign-in kept", ig["userToken"] == USER and not ig.get("renewedAt"), ig["userToken"][:22])
    check("reason recorded", (ig.get("renewNote") == note) if note else bool(ig.get("renewNote")), ig.get("renewNote"))

print("G. The sign-in has already ended: no pointless call")
t = fresh(userDays=-2)
set_ig(userTokenExpires=now_ms() - 2 * DAY)
tick_job("instagram-renew")
check("no renewal call", exchanges() == 1, exchanges())

print("H. Meta's 90-day clock is near its end: renewing brings new dates and a new Page token")
t = fresh(dataDays=10, newDataDays=90, exchange="extend")
set_ig(dataAccessUntil=now_ms() + 10 * DAY)
tick_job("instagram-renew")
ig = doc("instagram")
check("new sign-in saved", ig["userToken"].startswith("LONG-user-token-R"), ig["userToken"][:22])
check("new Page token saved", ig["pageToken"].startswith("PAGE-token-R"), ig["pageToken"][:16])
check("the new date is about 90 days away", near(ig.get("dataAccessUntil", 0), now_ms() + 90 * DAY), ig.get("dataAccessUntil"))
items, _ = check_now(t)
check("the check is content", items["instagram"]["state"] == "ok", items["instagram"])

print("I. Meta dropped the Page token but the sign-in stands: the app makes a new one")
t = fresh(pageValid="no")
items, _ = check_now(t)
ig = doc("instagram")
check("a new Page token was saved", ig["pageToken"].startswith("PAGE-token-R"), ig["pageToken"][:16])
check("Instagram is reported as working", items["instagram"]["state"] == "ok", items["instagram"])
s, b, _ = http("GET", "/api/posts", token=t)
check("posts can still be read with it", s == 200, (s, b))

print("J. Meta dropped both: that needs Nishith, and says how")
t = fresh(pageValid="no", userValid="no")
items, _ = check_now(t)
i = items["instagram"]
check("needs attention, with the three steps and Connect again", i["state"] == "attention" and len(i["fix"]) == 3 and i["action"] == "reconnect", i)
check("the old tokens were not thrown away", doc("instagram")["pageToken"] == PAGE)

print("K. Someone connects again while a renewal is under way: theirs is left alone")
out = subprocess.run(["node", f"{_W.HERE}/unit_renew.mjs"], capture_output=True, text=True)
print("   ", out.stdout.strip().replace("\n", "\n    "))
check("unit check of the save guard", out.returncode == 0, out.stderr[-300:])

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()
