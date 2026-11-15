"""Agent 15: starting a new piece of work never loses the earlier one (server side, no browser).
- draft A (her own words) is current; draft B arrives with a new id: A is set aside (data/drafts.json), B is current;
- A is opened again: A is current, B is set aside, and A is no longer listed among the set-aside ones;
- not set aside: a blank draft, one with only a style's sample words, a made reel's unchanged copy (named by `of`, or
  made from this very draft while she had already begun another); a changed copy of a made reel is set aside;
- at most 10, newest first; Delete removes one; late files (setAside) update the set-aside entry, never the current one;
- the cleaner keeps the files that set-aside drafts name, and drops entries past 30 days (then their files go);
- each save costs few storage calls.
Run:  python3 tests/test_a15_shelf.py"""
import where as _W
from a6lib import *

serve()
T = login()
DAYMS = 24 * 60 * 60 * 1000
RS = "dev-render-secret"          # the stand-in's made-up renderer key

def snap(text, **kw): return {"blocks": [{"text": text, "font": "lora", "size": 44}], "shape": "reel", "bg": None, "music": None, **kw}
def put(id, s, of="", **kw):
    st, b, _ = http("PUT", "/api/drafts/current", {"id": id, "of": of, "snap": s, **kw}, T)
    assert st == 200, (st, b)
    return b
def listing():
    s, b, _ = http("GET", "/api/drafts", None, T)
    assert s == 200, b
    return b
def shelf_ids(): return [d["id"] for d in listing()["drafts"]]
def current_id(): return (listing()["current"] or {}).get("id")
def made_reel(draft_id, s):
    j = http("POST", "/api/jobs", {"length": 8, "bgName": "b.jpg", "bgSize": 10}, T)[1]["id"]
    st, k, _ = http("PUT", f"/api/drafts/keep/{j}", {"draftId": draft_id, "of": "", "snap": s, "about": {"quote": "q"}}, T)
    assert st == 200, k
    return j, k["entryId"]
def done(j):
    s, b, _ = http("PUT", f"/api/render/{j}/reel", b"\0" * 2000, RS, {"Content-Type": "video/mp4"})
    assert s == 200, (s, b)

print("A new piece of work sets the earlier one aside")
A, B = new_id(), new_id()
put(A, snap("first quote, her own words", bg={"name": "sky.jpg", "kind": "image", "file": ""}))
r = put(B, snap("second quote"))
check("the answer names the draft set aside", r.get("aside") == A, r)
L = listing()
check("A is listed among the set-aside drafts, B is current", shelf_ids() == [A] and current_id() == B, [shelf_ids(), current_id()])
d = L["drafts"][0]
check("each comes with its words, when it changed and how long it is kept",
      d["snap"]["blocks"][0]["text"] == "first quote, her own words" and abs(d["keptUntil"] - d["updated"] - 30 * DAYMS) < 5, d)
check("the limit is given", L["limits"].get("drafts") == 10 and L["limits"].get("draftDays") == 30, L["limits"])
r = put(B, snap("second quote, changed"))
check("saving the same draft again sets nothing aside", r.get("aside") == "" and shelf_ids() == [A], [r, shelf_ids()])

print("Opening A again (Continue)")
r = put(A, d["snap"], d["of"])
check("A is current, B is set aside", current_id() == A and shelf_ids() == [B] and r.get("aside") == B, [current_id(), shelf_ids(), r])
check("B was set aside with its last words", listing()["drafts"][0]["snap"]["blocks"][0]["text"] == "second quote, changed")

print("Not worth keeping")
put(new_id(), snap(""))                      # A is set aside here; then a blank one is current
before = shelf_ids()
put(new_id(), snap("next"))
check("a blank draft is not set aside", shelf_ids() == before, [before, shelf_ids()])
put(new_id(), snap("a style's sample words", bg={"name": "sea.mp4", "kind": "video", "file": ""}), words=False)
before = shelf_ids()
put(new_id(), snap("her quote"))
# ("next" was set aside as the sample-words one arrived; the sample-words one itself must not be.)
check("only a style's sample words (the next piece keeps the background and music): not set aside",
      all(x["snap"]["blocks"][0]["text"] != "a style's sample words" for x in listing()["drafts"]) and len(shelf_ids()) == len(before), shelf_ids())

M = new_id(); sm = snap("made into a reel")
j, entry = made_reel(M, sm)
put(M, sm)
done(j)
put(M, sm, of=entry)                         # after the reel: the draft now goes on from it (as the app does)
n = len(shelf_ids())
put(new_id(), snap("after the reel"))
check("a made reel's unchanged copy is not set aside", len(shelf_ids()) == n and M not in shelf_ids(), shelf_ids())
E = new_id()
put(E, sm, of=entry)                         # Edit on that reel, then changed
put(E, snap("made into a reel, then changed"), of=entry)
put(new_id(), snap("something else"))
check("a changed copy of a made reel is set aside", E in shelf_ids())
# begun another while the reel was being made: the unchanged draft goes once the reel is in
R = new_id(); sr = snap("being made")
j2, _ = made_reel(R, sr)
put(R, sr)
put(new_id(), snap("began another while it rendered"))
check("while the reel is being made its draft is set aside", R in shelf_ids())
done(j2)
check("once the reel is in, its unchanged draft leaves the set-aside ones", R not in shelf_ids(), shelf_ids())

print("At most 10, newest first")
for i in range(12):
    put(new_id(), snap(f"draft {i}"))
ds = listing()["drafts"]
check("ten are kept", len(ds) == 10 and len(doc("drafts")) == 10, len(ds))
check("newest first", [x["updated"] for x in ds] == sorted([x["updated"] for x in ds], reverse=True)
      and ds[0]["snap"]["blocks"][0]["text"] == "draft 10", ds[0]["snap"]["blocks"][0]["text"])

print("Delete")
gone = ds[3]["id"]
s, b, _ = http("DELETE", f"/api/drafts/saved/{gone}", None, T)
check("deleted, and the answer is the new listing", s == 200 and gone not in [x["id"] for x in b["drafts"]] and len(b["drafts"]) == 9, s)

print("Files that arrive after she began something else")
F, G = new_id(), new_id()
put(F, snap("with a video", bg={"name": "sea.mp4", "kind": "video", "file": ""}))
put(G, snap("the next one"))
put(F, snap("with a video", bg={"name": "sea.mp4", "kind": "video", "file": "11111111-2222-4333-8444-555555555555"}), setAside=True)
f = [x for x in listing()["drafts"] if x["id"] == F]
check("the set-aside draft now names its file", f and f[0]["snap"]["bg"]["file"] == "11111111-2222-4333-8444-555555555555", f)
check("and the current draft is still the new one", current_id() == G)

print("Each save costs few storage calls")
ops(reset=True); put(G, snap("the next one, again")); same = ops()
ops(reset=True); put(new_id(), snap("yet another")); other = ops()
check("saving the same draft: at most two storage calls", same["storage"] <= 2, same)
check("a new piece of work: at most six", other["storage"] <= 6, other)

print("The cleaner")
http("DELETE", "/api/drafts/current", None, T)
for x in listing()["drafts"]: http("DELETE", f"/api/drafts/saved/{x['id']}", None, T)
def put_file(data, name="clip.mp4"):
    s, b, _ = http("POST", "/api/drafts/files", {"size": len(data), "name": name}, T)
    s2, part, _ = http("PUT", f"/api/drafts/files/{b['fileId']}/1?uploadId={b['uploadId']}", data, T, {"Content-Type": "application/octet-stream"})
    http("POST", f"/api/drafts/files/{b['fileId']}/complete", {"uploadId": b["uploadId"], "parts": [part]}, T)
    return b["fileId"]
kept, loose = put_file(b"v" * 100), put_file(b"w" * 100)
H = new_id()
put(H, snap("set aside with a file", bg={"name": "clip.mp4", "kind": "video", "file": kept}))
put(new_id(), snap("the one after"))
check("set aside with its file", H in shelf_ids())
age("drafts/", 30)
settle()
run_only("upkeep-drafts")
check("a set-aside draft's file stays", get_raw(f"drafts/{kept}") is not None)
check("a file nothing names still goes", get_raw(f"drafts/{loose}") is None)
sh = doc("drafts"); sh[0]["updated"] -= 31 * DAYMS; putdoc("drafts", sh)
check("past 30 days it is no longer listed", H not in shelf_ids())
run_only("upkeep-drafts")
check("the cleaner drops it", all(x["id"] != H for x in (doc("drafts") or [])), doc("drafts"))
run_only("upkeep-drafts")
check("and then its file", get_raw(f"drafts/{kept}") is None)
finish()
