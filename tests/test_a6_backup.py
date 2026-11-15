"""Backups: once a day the documents that can't be made again are copied to backup/<day>/, unchanged ones skipped,
two weeks kept, and a copy can be put back. What is inside a copy is never shown to any caller."""
import where as _W
import json
from a6lib import *

serve()
T = login()
settle()
SECRET_NOTE = "a little note only she may read 7421"
# Each document in the shape the app itself keeps it in.
SHAPES = {"library": {"quotes": [{"id": "q1", "text": "version 1", "added": 1}], "books": [], "screen": [], "accounts": []},
  "posts": [], "taste": {"profile": None, "notes": [{"id": "n1", "text": "no hustle quotes", "at": 1}], "updatedAt": 0}, "looks": [], "queue": [],
  "history": [{"text": "a line", "action": "used", "source": "own", "at": 1}], "rewords": [], "inspirations": [], "account": {"days": []}, "passkeys": []}
for n, shape in SHAPES.items(): putdoc(n, shape)
connect(T)                                                      # the Instagram sign-in, as the app saves it
putdoc("scorer/decisions", {"rows": [1, 2, 3]})
deldoc("backupstate")                                           # as on the morning of a new day: nothing copied yet
s, b, _ = http("POST", "/api/lovenotes", {"text": SECRET_NOTE}, T)
check("a little note is saved through the app", s == 200, (s, b))
http("GET", "/api/seal-key")                                   # makes the key document, as the first visit does
putdoc("health", {"asOf": 1, "items": []}); putdoc("stockcache/zz", {"at": 1})      # not worth keeping: never copied
today = india_day()
# The scorer keeps its own documents (its record, its model, the mark left by "forget everything"): whatever is there is worth keeping.
scorer_docs = {k[len("data/"):-5] for k in keys("data/scorer/")}
check("the scorer's record is among the documents to keep", "scorer/decisions" in scorer_docs and "scorer/log" in scorer_docs, sorted(scorer_docs))
want = set(list(SHAPES) + ["instagram", "lovenotes", "sealkey"]) | scorer_docs

early = {k[len(f"backup/{today}/"):-5] for k in keys(f"backup/{today}/")}      # what the very first look copied, before these documents existed
cost1 = run_only("upkeep-backup")
copied = {k[len(f"backup/{today}/"):-5] for k in keys(f"backup/{today}/")}
made = [w for w in cost1["what"] if w.startswith("put backup/")]
check("the first run copies as many as one run may (seven)", len(made) == 7 and copied <= want and len(copied - early) >= 5, (made, sorted(copied - early)))
check("and stays within the allowance, the timer's own calls included", cost1["storage"] + cost1["outside"] <= 24, (cost1["storage"], cost1["what"]))
check("the day is not marked complete yet", doc("backupstate")["day"] != today and doc("backupstate")["left"] == len(want) - 7, doc("backupstate"))
cost2 = run_only("upkeep-backup")
runs = 2
while doc("backupstate")["left"] > 0 and runs < 6:             # seven at a time: the rest follow on the next hourly looks
    c = run_only("upkeep-backup"); runs += 1
    check(f"run {runs} stays within the allowance", c["storage"] + c["outside"] <= 24, (c["storage"], c["what"]))
copied = {k[len(f"backup/{today}/"):-5] for k in keys(f"backup/{today}/")}
check("a few runs finish the day: every document worth keeping has a copy", copied == want and runs <= -(-len(want) // 7), (runs, sorted(want - copied) + sorted(copied - want)))
check("caches and the health record are not copied", "health" not in copied and not any("stockcache" in c for c in copied))
check("a copy is the document, byte for byte", get_raw(f"backup/{today}/library.json") == get_raw("data/library.json") and get_raw(f"backup/{today}/lovenotes.json") == get_raw("data/lovenotes.json"))
check("the second run stays within the allowance too", cost2["storage"] + cost2["outside"] <= 24, (cost2["storage"], cost2["what"]))
st = doc("backupstate")
check("the day is now complete", st["day"] == today and st["left"] == 0, st)
if st["prunedDay"] != today: run_only("upkeep-backup")
cost3 = run_only("upkeep-backup")
check("once the day is done, the hourly look costs one read and writes nothing of its own",
      [w for w in cost3["what"] if "jobstamps" not in w and w not in ("get data/posts.json", "get data/handoffs.json")] == ["get data/backupstate.json"], cost3["what"])

# What a caller can see: days and names. Never the content.
s, listing, _ = http("GET", "/api/backups")
check("the list of copies needs sign-in", s == 401, s)
s, listing, _ = http("GET", "/api/backups", token=T)
day0 = [d for d in listing["days"] if d["day"] == today]
check("signed in, it lists the day and the names", s == 200 and day0 and set(day0[0]["docs"]) == want and listing["lastComplete"] == today, listing)
text = json.dumps(listing)
key = json.loads(get_raw("data/sealkey.json"))
private = [v for v in json.dumps(key).replace('"', " ").replace(",", " ").split() if len(v) > 30]
check("the list holds no note and nothing of the sealing key", SECRET_NOTE not in text and "7421" not in text and not any(p in text for p in private), text[:200])
s, pub, _ = http("GET", "/api/health", raw=True)
check("nor does the open health record", SECRET_NOTE not in pub and not any(p in pub for p in private))
log = open(f"{_W.OUT}/dev.log").read()
check("nor the server's log", SECRET_NOTE not in log and not any(p in log for p in private))

# The next day: only what changed is copied again.
day1 = india_day(1); set_day(day1)
putdoc("library", {"quotes": [{"id": "q1", "text": "version 2", "added": 1}], "books": [], "screen": [], "accounts": []})
cost = run_only("upkeep-backup")
check("the next day only the changed document is copied", keys(f"backup/{day1}/") == [f"backup/{day1}/library.json"], keys(f"backup/{day1}/"))
check("with the new content", "version 2" in get_raw(f"backup/{day1}/library.json"))
check("a quiet day's run is cheap", cost["storage"] + cost["outside"] <= 13, (cost["storage"], cost["what"]))

# Putting a copy back.
putdoc("library", {"quotes": [{"id": "q1", "text": "version 3", "added": 1}], "books": [], "screen": [], "accounts": []})
bad = [({"day": today, "name": "health"}, 400), ({"day": today, "name": "../data/instagram"}, 400), ({"day": "2026-1-1", "name": "library"}, 400),
       ({"day": "2020-01-01", "name": "library"}, 404), ({"name": "library"}, 400)]
for body, code in bad:
    s, b, _ = http("POST", "/api/backups/restore", body, T)
    check(f"restore refuses {body}", s == code, (s, b))
s, b, _ = http("POST", "/api/backups/restore", {"day": today, "name": "library"})
check("restoring needs sign-in", s == 401, s)
s, b, _ = http("POST", "/api/backups/restore", {"day": today, "name": "library"}, T)
check("a copy is put back", s == 200 and b["restored"] == "library" and doc("library")["quotes"][0]["text"] == "version 1", (s, b, doc("library")))
check("the answer carries no content", "version" not in json.dumps(b) and "quotes" not in json.dumps(b), b)
check("what was live is kept so the restore can be undone", "version 3" in get_raw("backup/undo/library.json"))
s, b, _ = http("POST", "/api/backups/restore", {"day": "undo", "name": "library"}, T)
check("and undoing brings it back", s == 200 and doc("library")["quotes"][0]["text"] == "version 3", (s, b))
s, b, _ = http("POST", "/api/backups/restore", {"day": today, "name": "scorer/decisions"}, T)
check("a scorer document can be put back too", s == 200 and doc("scorer/decisions") == {"rows": [1, 2, 3]}, (s, b))

# Three weeks on: old copies go, but never a document's only copy; an erased document's copies age out.
day20 = india_day(20); set_day(day20)
putdoc("library", {"quotes": [{"id": "q1", "text": "version 4", "added": 1}], "books": [], "screen": [], "accounts": []})
deldoc("taste")                                              # she asked Nishiii to forget
run_only("upkeep-backup")
if doc("backupstate")["prunedDay"] != day20: run_only("upkeep-backup")
left = set(keys("backup/"))
check("a copy older than two weeks goes once a newer one exists", f"backup/{today}/library.json" not in left and f"backup/{day1}/library.json" not in left and f"backup/{day20}/library.json" in left, sorted(k for k in left if "library" in k))
check("a document that hasn't changed keeps its one copy, however old", f"backup/{today}/looks.json" in left and f"backup/{today}/sealkey.json" in left and f"backup/{today}/lovenotes.json" in left)
check("a document she erased is gone from the backups two weeks later", f"backup/{today}/taste.json" not in left)

# The health record.
items, _ = part_now(T, "page")
check("the health record says the backup is fine", items["backup"]["state"] == "ok" and "two weeks of copies" in items["backup"]["line"], items["backup"])
set_day(india_day(24))
items, _ = part_now(T, "page")
check("a backup that hasn't been made for days is raised", items["backup"]["state"] == "attention" and "4 days" in items["backup"]["line"], items["backup"])
s, pub, _ = http("GET", "/api/health")
check("and the open record names it", "Backups: no backup has been made for 4 days" in pub["message"], pub["message"])
set_day()
finish()
