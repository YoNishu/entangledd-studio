"""Agent 14: how made reels and drafts are kept, replaced, limited and cleaned (server side, no browser).
- a finished reel goes into Made, not posted by itself (the renderer hands it in; the app may be closed);
- making an edited reel again replaces it and its old files go; one waiting to post (or posted) is kept and a new one made;
- at most 20 waiting, each 30 days; a posted one 7 days; the current draft 30 days;
- the cleaner removes draft files nothing names (after a day), keeps the files of waiting reels past the usual 7 days,
  and so does the tidy-up that runs when a reel is started; draft and made are backed up;
- a background or music kept with the draft is used by the reel as it is (not sent twice).
Run:  python3 tests/test_a14_keep.py"""
import where as _W
from a6lib import *

serve()
T = login()
DAYMS = 24 * 60 * 60 * 1000
RS = "dev-render-secret"          # the stand-in's made-up renderer key

def snap(text): return {"blocks": [{"text": text, "font": "lora", "size": 44}], "shape": "reel", "bg": None, "music": None}
def new_job(bg_file=None, size=10):
    s, b, _ = http("POST", "/api/jobs", {"length": 8, "bgName": "b.jpg", "bgSize": size, **({"bgFile": bg_file} if bg_file else {})}, T)
    assert s == 200, b
    return b
def keep(job, text, of=""):
    s, b, _ = http("PUT", f"/api/drafts/keep/{job}", {"draftId": new_id(), "of": of, "snap": snap(text), "about": {"quote": text}}, T)
    assert s == 200, b
    return b
def done(job):
    s, b, _ = http("PUT", f"/api/render/{job}/reel", b"\0" * 2000, RS, {"Content-Type": "video/mp4"})
    assert s == 200, (s, b)
def made_reel(text, of=""):
    j = new_job()["id"]
    k = keep(j, text, of)
    done(j)
    return j, k
def made(): return doc("made") or []
def listing():
    s, b, _ = http("GET", "/api/drafts", None, T)
    assert s == 200, b
    return b
def put_file(data, name="clip.mp4"):
    s, b, _ = http("POST", "/api/drafts/files", {"size": len(data), "name": name}, T)
    assert s == 200, b
    s2, part, _ = http("PUT", f"/api/drafts/files/{b['fileId']}/1?uploadId={b['uploadId']}", data, T, {"Content-Type": "application/octet-stream"})
    s3, ok, _ = http("POST", f"/api/drafts/files/{b['fileId']}/complete", {"uploadId": b["uploadId"], "parts": [part]}, T)
    assert s3 == 200, ok
    return b["fileId"]

print("A finished reel is kept by itself")
j1, k1 = made_reel("first one")
m = made()
check("the reel is in made.json once the renderer hands it in", len(m) == 1 and m[0]["jobId"] == j1 and m[0]["id"] == k1["entryId"], m)
L = listing()
check("listed as Made, not posted with 30 days to go", L["made"][0]["where"] == "made" and abs(L["made"][0]["keptUntil"] - m[0]["made"] - 30 * DAYMS) < 5, L["made"][0])

print("Edited and made again: replaced, old files gone")
j2, k2 = made_reel("first one, changed", of=k1["entryId"])
m = made()
check("the keep answer says it replaces", k2["replaces"] and k2["entryId"] == k1["entryId"], k2)
check("still one entry, now the new reel and the new words", len(m) == 1 and m[0]["jobId"] == j2 and m[0]["snap"]["blocks"][0]["text"] == "first one, changed", m)
check("the old reel's files are gone", keys(f"jobs/{j1}/") == [], keys(f"jobs/{j1}/"))

print("One waiting to post is not replaced")
s, b, _ = http("POST", "/api/queue", {"jobId": j2, "quote": "first one, changed"}, T)
check("queued", s == 200, b)
j3, k3 = made_reel("a new version", of=k1["entryId"])
check("the keep answer says it is a new reel", k3["newVersion"] and not k3["replaces"] and k3["wasWhere"] == "queue", k3)
m = made()
check("both are kept", sorted(x["jobId"] for x in m) == sorted([j2, j3]), m)
L = listing()
where = {x["jobId"]: x["where"] for x in L["made"]}
check("the queued one is listed as waiting, the new one as made", where.get(j2) == "queue" and where.get(j3) == "made", where)

print("At most 20 waiting: the oldest one only in Made makes room")
first = j3
for i in range(19):
    made_reel(f"reel {i}")
m = made()
waiting = [x for x in m if not x.get("posted")]
check("20 waiting, the oldest made-only one is gone with its files", len(waiting) == 20 and first not in [x["jobId"] for x in m] and keys(f"jobs/{first}/") == [],
      [len(waiting), first in [x["jobId"] for x in m]])
check("the queued one is never the one let go", j2 in [x["jobId"] for x in m])

print("Delete from Made, not posted")
victim = [x for x in listing()["made"] if x["where"] == "made"][0]
s, b, _ = http("DELETE", f"/api/drafts/made/{victim['id']}", None, T)
check("deleted, files gone", s == 200 and victim["id"] not in [x["id"] for x in made()] and keys(f"jobs/{victim['jobId']}/") == [], b)

print("Posted: kept 7 days for a version, then only the post's record stays")
target = [x for x in listing()["made"] if x["where"] == "made"][0]
putdoc("posts", [{"id": new_id(), "jobId": target["jobId"], "state": "published", "published": int(time.time() * 1000), "created": int(time.time() * 1000), "quote": "x"}])
L = listing()
t = [x for x in L["made"] if x["id"] == target["id"]][0]
check("marked posted, with its post and 7 days", t["where"] == "posted" and t["postId"] and abs(t["keptUntil"] - t["posted"] - 7 * DAYMS) < 5, t)
mm = made()
for x in mm:
    if x["id"] == target["id"]: x["posted"] -= 8 * DAYMS
putdoc("made", mm)
check("after 7 days the entry goes", target["id"] not in [x["id"] for x in listing()["made"]])

print("Reuse of kept files by a reel")
data = bytes(range(256)) * 40
fid = put_file(data)
j = new_job(bg_file=fid, size=len(data))
check("a reel names the kept background instead of receiving it", j.get("reused") is True, j)
s, got, _ = fetch("GET", f"/api/render/{j['id']}/bg", RS)
check("the renderer is given the kept file itself", s == 200 and got == data)
j_other = new_job(bg_file=fid, size=len(data) + 1)
check("a different size is sent as usual", not j_other.get("reused") and j_other.get("uploadId"), j_other)
s, b, _ = http("PUT", f"/api/jobs/{j_other['id']}/music?ext=mp3&start=1&volume=0.5&file={new_id()}", None, T)
check("music named but no longer kept: the app is told to send it", s == 409, (s, b))
mf = put_file(b"ID3" + b"\1" * 3000, "song.mp3")
s, b, _ = http("PUT", f"/api/jobs/{j_other['id']}/music?ext=mp3&start=1&volume=0.5&file={mf}", None, T)
jj = json.loads(get_raw(f"jobs/{j_other['id']}/job.json"))
check("music named from the draft is used as it is", s == 200 and jj["music"].get("key") == f"drafts/{mf}" and get_raw(f"jobs/{j_other['id']}/music") is None, jj.get("music"))

print("Cleaning")
settle()
# the current draft names one file; another file is named by nothing
named = put_file(b"x" * 500, "keep.jpg")
loose = put_file(b"y" * 500, "loose.jpg")
s, b, _ = http("PUT", "/api/drafts/current", {"id": new_id(), "of": "", "snap": {**snap("draft"), "bg": {"file": named, "name": "keep.jpg", "kind": "image"}}}, T)
check("the current draft is saved", s == 200, b)
age("drafts/", 30)
waiting_job = [x for x in listing()["made"] if x["where"] == "made"][0]["jobId"]
plain = new_job()["id"]                        # a reel never kept (as before this feature)
age("jobs/", 8 * 24)
run_only("upkeep-clean")
check("a draft file nothing names is removed after a day", get_raw(f"drafts/{loose}") is None)
check("the draft's own file stays", get_raw(f"drafts/{named}") is not None)
check("files of a reel waiting in Made, not posted outlive the usual 7 days", keys(f"jobs/{waiting_job}/reel.mp4") != [], keys(f"jobs/{waiting_job}/"))
check("other reels' files still go after 7 days", keys(f"jobs/{plain}/") == [], keys(f"jobs/{plain}/"))
# the tidy-up when a reel is started keeps them too
new_job()
time.sleep(0.5)
check("starting a reel doesn't remove a waiting reel's files", keys(f"jobs/{waiting_job}/reel.mp4") != [])
# 30 days later: the waiting reels and the draft go, and then their files
mm = made()
for x in mm: x["made"] -= 31 * DAYMS
putdoc("made", mm)
d = doc("draft"); d["updated"] -= 31 * DAYMS; putdoc("draft", d)
run_only("upkeep-clean")
check("after 30 days the waiting reels go", [x for x in made() if not x.get("posted")] == [], len(made()))
check("after 30 days the draft goes", doc("draft") is None)
run_only("upkeep-clean")
check("and then their files", keys("drafts/") == [] and keys(f"jobs/{waiting_job}/") == [], [keys("drafts/"), keys(f"jobs/{waiting_job}/")])

print("Backups: the settings, not the media")
putdoc("made", [{"id": new_id(), "jobId": new_id(), "made": int(time.time() * 1000), "snap": snap("backed up")}])
putdoc("draft", {"id": new_id(), "of": "", "updated": int(time.time() * 1000), "snap": snap("draft backed up")})
deldoc("backupstate")
for _ in range(4): run_only("upkeep-backup")
saved = keys("backup/")
check("draft and made are in the daily backup", any(k.endswith("/made.json") for k in saved) and any(k.endswith("/draft.json") for k in saved), saved)
check("no file under drafts/ is backed up", not any("drafts" in k for k in saved), saved)

print("Sign-in needed")
s, b, _ = http("GET", "/api/drafts")
check("the drafts are only for her", s == 401, s)
finish()
