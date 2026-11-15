"""Storage that only grows: every kind of stored file has a lifetime, and the timed cleaner removes what has outlived it."""
import json
from a6lib import *

serve()
T = login()
settle()                                              # every timed job has had its first turn on empty storage
D = 24                                                # hours in a day
A, B, C, E = new_id(), new_id(), new_id(), new_id()
big = b"v" * 5000
# A: a reel finished over a week ago. Everything goes.
for n in ["job.json", "bg", "overlay.png", "music", "reel.mp4"]: put_raw(f"jobs/{A}/{n}", big, 8 * D)
# B: a reel finished two hours ago. What it was made from goes; the reel and its record stay.
for n in ["job.json", "bg", "overlay.png", "music"]: put_raw(f"jobs/{B}/{n}", big, 3)
put_raw(f"jobs/{B}/reel.mp4", big, 2)
# C: never finished, a day old. Nothing goes yet.
for n in ["job.json", "bg", "overlay.png"]: put_raw(f"jobs/{C}/{n}", big, D)
# E: finished ten minutes ago. Nothing goes yet.
for n in ["job.json", "bg", "overlay.png"]: put_raw(f"jobs/{E}/{n}", big, 0.4)
put_raw(f"jobs/{E}/reel.mp4", big, 0.2)
put_raw("slides/old.jpg", big, 8 * D); put_raw("slides/new.jpg", big, D)
put_raw("data/stockcache/old.json", "{}", 3 * D); put_raw("data/stockcache/new.json", "{}", D)
put_raw("data/musiccache/old.json", "{}", 9 * D); put_raw("data/musiccache/new.json", "{}", 6 * D)
put_raw("auth/oldtries.json", "{}", 2 * D); put_raw("auth/challenge-old.json", "{}", 2 * D); put_raw("auth/challenge-new.json", "{}", 1)
put_raw(f"data/suggestions/{india_day(-61)}.json", "[]", 0)       # saved just now, but named for a day two months back
put_raw(f"data/suggestions/{india_day(-10)}.json", "[]", 0)
put_raw("data/library.json", json.dumps({"quotes": [], "books": [], "screen": [], "accounts": []}), 400 * D)   # a document: never cleaned
put_raw("backup/2020-01-01/library.json", "{}", 400 * D)          # backups are pruned by the backup job, not here

cost = run_only("upkeep-clean")
left = set(keys())
gone = lambda k: k not in left
check("a reel over a week old is removed with everything it was made from", all(gone(f"jobs/{A}/{n}") for n in ["job.json", "bg", "overlay.png", "music", "reel.mp4"]))
check("a finished reel loses what it was made from after an hour", all(gone(f"jobs/{B}/{n}") for n in ["bg", "overlay.png", "music"]))
check("the finished reel itself and its record stay for the week", f"jobs/{B}/reel.mp4" in left and f"jobs/{B}/job.json" in left)
check("a reel still being made is left alone", all(f"jobs/{C}/{n}" in left for n in ["job.json", "bg", "overlay.png"]))
check("a reel finished minutes ago keeps its parts for now", all(f"jobs/{E}/{n}" in left for n in ["job.json", "bg", "overlay.png", "reel.mp4"]))
check("old carousel pictures go, new ones stay", gone("slides/old.jpg") and "slides/new.jpg" in left)
check("background searches are kept two days", gone("data/stockcache/old.json") and "data/stockcache/new.json" in left)
check("music searches are kept eight days", gone("data/musiccache/old.json") and "data/musiccache/new.json" in left)
check("old wrong-passcode counts and Face ID challenges go", gone("auth/oldtries.json") and gone("auth/challenge-old.json") and "auth/challenge-new.json" in left)
check("suggestions older than sixty days go, by the day in their name", gone(f"data/suggestions/{india_day(-61)}.json") and f"data/suggestions/{india_day(-10)}.json" in left)
check("documents and backups are never touched by the cleaner", "data/library.json" in left and "backup/2020-01-01/library.json" in left)

state = doc("upkeep")
check("the cleaner writes down what it did", state and state["removed"] == 14 and state["waiting"] == 0, state)
check("and how much is being kept", state["files"] >= 12 and state["bytes"] >= 9 * 5000, state)
total = cost["storage"] + cost["outside"]
check("one cleaning run costs well under twenty calls, the timer's own included", total <= 14, (total, cost["what"]))
check("it deletes with a single call", sum(1 for w in cost["what"] if w.startswith("delete")) == 1, cost["what"])

cost2 = run_only("upkeep-clean")
check("a second run finds nothing more to remove", doc("upkeep")["removed"] == 0 and set(keys()) == left)
check("and deletes nothing", not any(w.startswith("delete") for w in cost2["what"]), cost2["what"])

# Through the app itself: a wrong passcode leaves a count, and the cleaner removes it a day later.
http("POST", "/api/login", {"passcode": "wrong"})
tries = [k for k in keys("auth/")]
check("a wrong passcode leaves a small count in storage", len(tries) == 2, tries)      # this one and challenge-new
age("auth/", 30)
run_only("upkeep-clean")
check("a day later the cleaner has removed it", keys("auth/") == [], keys("auth/"))

# The health record says how the cleaning is going.
items, _ = part_now(T, "page")
check("the health record has a line for it, and it is fine", items["cleaning"]["state"] == "ok" and "files kept" in items["cleaning"]["line"], items["cleaning"])
up = doc("upkeep"); up["at"] -= 3 * 24 * HOUR; putdoc("upkeep", up)
items, _ = part_now(T, "page")
check("a cleaner that has stopped for days is raised", items["cleaning"]["state"] == "attention", items["cleaning"])
up["at"] += 3 * 24 * HOUR; up["bytes"] = 9 * 1024 ** 3; putdoc("upkeep", up)
items, _ = part_now(T, "page")
check("storage close to the free 10 GB is flagged ahead of time", items["cleaning"]["state"] == "soon" and "9.0 GB" in items["cleaning"]["line"], items["cleaning"])
s, pub, _ = http("GET", "/api/health")
check("and the open record says so in fixed words", pub["needsAttention"] and "Tidying up: the app's storage is nearly full" in pub["message"], pub["message"])
finish()
