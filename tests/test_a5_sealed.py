"""Little notes from Nishiii: sealed delivery, end to end on the stand-in server.
The key address, tools/seal.mjs, the three ways a delivery gets opened, and everything that must
be refused. Only made-up notes are used. Starts its own fresh servers.
Run: python3 tests/test_a5_sealed.py"""
import where as _W
import hashlib, json, os, re, subprocess, threading
from a5lib import ok, finish, serve, raw, call, login, add, day, nxt, REPO

WORK = f"{_W.OUT}/work"
os.makedirs(WORK, exist_ok=True)
TOOL = f"{REPO}/tools/seal.mjs"
NOTES_A = {"mode": "add", "notes": [
    {"text": "We met at the bakery on 3 March 2020.", "date": "2020-03-03"},
    {"text": "You still owe me a rematch at carrom."},
    {"text": "The yellow scooter was the best idea we ever had."}]}
NOTES_B = {"mode": "add", "notes": [
    {"text": "You still owe me a rematch at carrom."},
    {"text": "The yellow scooter was the best idea we ever had."},
    {"text": "The kite that got away is still flying somewhere."}]}
NOTES_R = {"mode": "replace", "notes": [{"text": "A brand new beginning."}, {"text": "And a second line of it.", "date": "2022-01-01"}]}

def put_file(name, data):
    path = f"{WORK}/{name}"
    with open(path, "w") as f: f.write(data if isinstance(data, str) else json.dumps(data))
    return path

def tool(*args):
    out = subprocess.run(["node", TOOL, *args], capture_output=True, text=True, cwd=WORK)
    return out.returncode, out.stdout, out.stderr

def seal(key, check, notes, out="-"):
    code, stdout, stderr = tool("--key", key, "--check", check, "--in", put_file("in.json", notes), "--out", out)
    assert code == 0, (code, stdout, stderr)
    return stdout.strip()

def seal_raw(first, plain):
    out = subprocess.run(["node", f"{_W.HERE}/seal_raw.mjs", first, plain], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()

def deploy(*boxes):
    """Stands in for: a new version went live with these deliveries in server/sealed.js."""
    status, _ = raw("PUT", "/__notes_sealed", list(boxes))
    assert status == 204, status

def fresh():
    serve(); t = login(); day("2026-08-20")
    k = call("GET", "/api/seal-key")[1]
    return t, k

def texts(token):
    return [n["text"] for n in call("GET", "/api/lovenotes", token=token)[1]["notes"]]

# ---------------- the key address ----------------
print("the key address")
T, K = fresh()
ok(re.fullmatch(r"04[0-9a-f]{128}", K["key"]) is not None, "the key is 130 lowercase hex characters starting with 04", K["key"][:12])
ok(K["groups"].replace(" ", "") == K["key"] and all(len(g) == 10 for g in K["groups"].split()), "the grouped form is the same key in tens")
ok(K["check"] == hashlib.sha256(bytes.fromhex(K["key"])).hexdigest()[:16], "the check is the start of the key's SHA-256")
ok(call("GET", "/api/seal-key")[1]["key"] == K["key"] and call("GET", "/api/seal-key?again=2")[1]["key"] == K["key"], "the key stays the same from one call to the next")
ok(K["deliveries"] == {"applied": 0, "failed": 0, "waiting": 0}, "no deliveries yet", K["deliveries"])
ok(call("POST", "/api/seal-key")[0] == 404 and call("GET", "/api/seal-key/private")[0] == 404, "nothing else lives at that address")

# ---------------- the tool ----------------
print("the sealing tool")
out_file = f"{WORK}/sealed.js"
if os.path.exists(out_file): os.remove(out_file)
code, stdout, stderr = tool("--key", *K["groups"].split(), "--check", K["check"], "--in", put_file("a.json", NOTES_A), "--out", out_file)
ok(code == 0 and "Sealed 3 notes (add)" in stdout and "1 delivery" in stdout, "it seals three notes, given the key in its grouped form", stdout + stderr)
ok(f"check {K['check']}" in stdout, "and says which key it sealed for, by its check", stdout)
written = open(out_file).read()
boxes = re.findall(r'^  "([A-Za-z0-9+/=]+)",$', written, re.M)
ok(len(boxes) == 1 and written.rstrip().endswith("];") and "export const SEALED = [" in written, "the file is a list with one delivery")
ok(not any(w in written + stdout for w in ["bakery", "carrom", "scooter"]), "neither the file nor what the tool prints shows a word of the notes")
ok("Delete that file" in stdout, "it reminds you to delete the plain notes")
code, stdout, stderr = tool("--key", K["key"], "--check", K["check"], "--in", put_file("b.json", NOTES_B), "--out", out_file)
boxes2 = re.findall(r'^  "([A-Za-z0-9+/=]+)",$', open(out_file).read(), re.M)
ok(code == 0 and len(boxes2) == 2 and boxes2[0] == boxes[0] and "2 deliveries" in stdout, "a second run adds to the deliveries already in the file", stdout + stderr)
one = seal(K["key"], K["check"], NOTES_A)
ok(re.fullmatch(r"[A-Za-z0-9+/=]+", one) is not None and one != boxes[0], "--out - prints one delivery; sealing the same notes twice gives different text")

before = open(out_file).read()
def refused(label, *args, needs=""):
    code, stdout, stderr = tool(*args)
    ok(code != 0 and "Not sealed" in stderr and needs in stderr and open(out_file).read() == before, label, stderr.strip()[:160])
wrong_check = ("0" if K["check"][0] != "0" else "1") + K["check"][1:]
refused("a wrong check is refused and nothing is written", "--key", K["key"], "--check", wrong_check, "--in", f"{WORK}/a.json", "--out", out_file, needs="check")
damaged = K["key"][:40] + ("0" if K["key"][40] != "0" else "1") + K["key"][41:]
refused("a key damaged by one character is refused", "--key", damaged, "--check", K["check"], "--in", f"{WORK}/a.json", "--out", out_file, needs="check")
refused("a key cut short is refused", "--key", K["key"][:100], "--check", K["check"], "--in", f"{WORK}/a.json", "--out", out_file, needs="130")
groups = K["groups"].split()
swapped = groups[:3] + [groups[4], groups[3]] + groups[5:]
refused("a key with two of its groups changed round is refused", "--key", *swapped, "--check", K["check"], "--in", f"{WORK}/a.json", "--out", out_file, needs="check")
refused("a key with a letter that can't be in it (O for 0) is refused", "--key", K["key"][:50] + "O" + K["key"][51:], "--check", K["check"], "--in", f"{WORK}/a.json", "--out", out_file, needs="130")
refused("a key from somewhere else, with this key's check, is refused", "--key", "04" + hashlib.sha512(b"not the app").hexdigest(), "--check", K["check"], "--in", f"{WORK}/a.json", "--out", out_file, needs="check")
refused("a check cut short is refused", "--key", K["key"], "--check", K["check"][:12], "--in", f"{WORK}/a.json", "--out", out_file, needs="16")
refused("a check with a letter that can't be in it is refused", "--key", K["key"], "--check", K["check"][:15] + "z", "--in", f"{WORK}/a.json", "--out", out_file, needs="16")
refused("a check made of nothing but spaces is refused", "--key", K["key"], "--check", " ", "--in", f"{WORK}/a.json", "--out", out_file, needs="16")
refused("no check at all is refused", "--key", K["key"], "--in", f"{WORK}/a.json", "--out", out_file, needs="--check")
code, stdout, stderr = tool("--key", K["key"].upper(), "--check", K["check"][:8].upper(), K["check"][8:], "--in", f"{WORK}/a.json", "--out", "-")
ok(code == 0 and re.fullmatch(r"[A-Za-z0-9+/=]+", stdout.strip()) is not None, "capitals, and a check that arrived in two pieces, are still the same key and check", stderr)
refused("a notes file inside the public repo is refused", "--key", K["key"], "--check", K["check"], "--in", f"{REPO}/notes.json", "--out", out_file, needs="inside the repo")
refused("a missing notes file is refused", "--key", K["key"], "--check", K["check"], "--in", f"{WORK}/nope.json", "--out", out_file, needs="no file")
for label, bad in [("a note that is too long", {"mode": "add", "notes": [{"text": "x" * 281}]}),
                   ("a date that doesn't exist", {"mode": "add", "notes": [{"text": "ok", "date": "2021-02-30"}]}),
                   ("a mode it doesn't know", {"mode": "merge", "notes": [{"text": "ok"}]}),
                   ("an empty list", {"mode": "add", "notes": []}),
                   ("a note with no words", {"mode": "add", "notes": [{"text": "  "}]}),
                   ("more than 60 notes", {"mode": "add", "notes": [{"text": f"n{i}"} for i in range(61)]})]:
    refused(f"{label} is refused", "--key", K["key"], "--check", K["check"], "--in", put_file("bad.json", bad), "--out", out_file)
refused("text that isn't JSON is refused", "--key", K["key"], "--check", K["check"], "--in", put_file("bad.json", "{oops"), "--out", out_file, needs="JSON")
refused("a missing option is named", "--key", K["key"], "--check", K["check"], "--out", out_file, needs="--in")
code, stdout, stderr = tool("--key", K["key"], "--check", K["check"], "--in", f"{WORK}/a.json", "--out", f"{WORK}/no-such-folder/sealed.js")
ok(code != 0 and "Not sealed" in stderr and "couldn't be written" in stderr and "at " not in stderr.split("Not sealed")[1], "an output file that can't be written: a plain message, no stack of code", stderr.strip()[:200])
with open(f"{WORK}/bom.json", "wb") as f: f.write(b"\xef\xbb\xbf" + json.dumps(NOTES_A).encode())
code, stdout, stderr = tool("--key", K["key"], "--check", K["check"], "--in", f"{WORK}/bom.json", "--out", "-")
ok(code == 0 and re.fullmatch(r"[A-Za-z0-9+/=]+", stdout.strip()) is not None, "a notes file saved with a byte-order mark at its start is still read", stderr)

# ---------------- the very first calls, all at once ----------------
print("many first calls at the same moment")
serve()
answers = []
def first_call():
    answers.append(call("GET", "/api/seal-key")[1])
threads = [threading.Thread(target=first_call) for _ in range(24)]
for t in threads: t.start()
for t in threads: t.join()
stored = call("GET", "/__doc?name=sealkey")[1]["publicHex"]
ok(len(answers) == 24 and all(a and a.get("key") == stored for a in answers), "24 callers at once are all handed the one key that is stored", sorted({(a or {}).get("key", "?")[:10] for a in answers}))
ok(all(a["check"] == hashlib.sha256(bytes.fromhex(stored)).hexdigest()[:16] for a in answers), "each with the right check")
ok(call("GET", "/api/seal-key")[1]["key"] == stored, "and the key is still that one afterwards")

# ---------------- a delivery arrives: three ways it gets opened ----------------
print("opened when she next uses the app")
T, K = fresh()
box_a = seal(K["key"], K["check"], NOTES_A)
deploy(box_a)
ok(sorted(texts(T)) == sorted(n["text"] for n in NOTES_A["notes"]), "the notes are there on the next signed-in request")
status, out = call("GET", "/api/lovenotes", token=T)
ok([n["date"] for n in out["notes"] if "bakery" in n["text"]] == ["2020-03-03"], "the date came along", out["notes"])
ok(len(out["deliveries"]) == 1 and out["deliveries"][0]["ok"] and out["deliveries"][0]["added"] == 3 and out["deliveries"][0]["mode"] == "add", "the editor is told: 3 added", out["deliveries"])
ok("hash" not in json.dumps(out), "(no internals in that answer)")
seq = [nxt(T, "2026-08-20")[1]["text"] for _ in range(3)]
ok(sorted(seq) == sorted(n["text"] for n in NOTES_A["notes"]), "and they take turns on Today like any other notes")
day("2027-03-03"); out = nxt(T, "2027-03-03")[1]
ok("bakery" in out["text"] and out["marker"] == "7 years ago today", "a delivered date works as the note's own day", out)

print("opened by her very first request of the day (next)")
T, K = fresh()
deploy(seal(K["key"], K["check"], NOTES_A))
status, out = nxt(T, "2026-08-20")
ok(status == 200 and out.get("text") in [n["text"] for n in NOTES_A["notes"]], "the opening that follows a delivery already shows one of its notes", out)

print("opened when the key address is fetched (how the orchestrator checks a delivery)")
T, K = fresh()
deploy(seal(K["key"], K["check"], NOTES_A))
status, out = call("GET", "/api/seal-key?check=2")
ok(out["deliveries"] == {"applied": 1, "failed": 0, "waiting": 0} and out["key"] == K["key"], "the key address reports 1 applied, with no sign-in", out["deliveries"])
ok(len(texts(T)) == 3, "and the notes are in")

print("opened by the timed job, with nobody around")
T, K = fresh()
deploy(seal(K["key"], K["check"], NOTES_A))
ticks = 0
while ticks < 6:
    raw("GET", "/__cron"); ticks += 1
    doc = call("GET", "/__doc?name=lovenotes")[1]
    if doc and doc.get("notes"): break
ok(doc and len(doc["notes"]) == 3, f"the five-minute timer brings the delivery in (after {ticks} tick{'s' if ticks > 1 else ''})")
ok("lovenotes-deliveries" in (call("GET", "/__doc?name=jobstamps")[1] or {}), "the job is on the timer's list once there is a delivery")

print("a quiet job touches nothing")
def tick_ops():
    stamps = call("GET", "/__doc?name=jobstamps")[1] or {}
    stamps["lovenotes-deliveries"] = 0                       # make the job due again without waiting an hour
    for name in list(stamps) + ["instagram-renew", "health-check", "scorer", "upkeep", "backup", "cleanup"]:
        if name != "lovenotes-deliveries": stamps[name] = 9e15   # and keep any other section's job out of this tick
    raw("PUT", "/__doc?name=jobstamps", stamps)
    raw("GET", "/__notes_ops")
    raw("GET", "/__cron")
    return [o for o in call("GET", "/__notes_ops")[1] if "lovenotes" in o or "sealkey" in o]
ops = tick_ops()
ok(ops == [], "with every delivery already dealt with, the job reads and writes nothing of its own", ops)
deploy()                                                   # a version with no deliveries at all
ok(tick_ops() == [], "with no deliveries, likewise")
T, K = fresh()
box_a = seal(K["key"], K["check"], NOTES_A)
deploy(box_a); texts(T)
deploy(box_a)                                               # the server restarts: its memory is gone, storage remembers
ops = tick_ops()
ok(ops == ["get data/lovenotes.json"], "after a restart the job looks once (one read) and writes nothing", ops)
ok(tick_ops() == [], "and from then on is quiet again")

# ---------------- what must be refused ----------------
print("deliveries that must be refused")
T, K = fresh()
add(T, "A note that was already here.")
good = seal(K["key"], K["check"], NOTES_A)
i = len(good) // 2
tampered = good[:i] + ("A" if good[i] != "A" else "B") + good[i + 1:]
stranger = seal_raw("--stranger", json.dumps({"v": 1, "mode": "add", "notes": [{"text": "from a stranger"}]}))
not_list = seal_raw(K["key"], json.dumps({"v": 1, "mode": "add", "notes": "nope"}))
too_long = seal_raw(K["key"], json.dumps({"v": 1, "mode": "add", "notes": [{"text": "fine"}, {"text": "x" * 300}]}))
bad_mode = seal_raw(K["key"], json.dumps({"v": 1, "mode": "wipe", "notes": [{"text": "fine"}]}))
not_json = seal_raw(K["key"], "just some words")
deploy(tampered, stranger, not_list, too_long, bad_mode, not_json, "not-a-delivery!!", "QUJD")
status, out = call("GET", "/api/lovenotes", token=T)
ok(status == 200 and len(out["deliveries"]) == 4, "one request deals with four deliveries and leaves the rest for the next", len(out["deliveries"]))
status, out = call("GET", "/api/lovenotes", token=T)
ok(status == 200 and [n["text"] for n in out["notes"]] == ["A note that was already here."], "none of eight bad deliveries changed the notes", out["notes"])
why = [d.get("why", "") for d in out["deliveries"]]
ok(len(why) == 8 and all(not d["ok"] for d in out["deliveries"]), "each is recorded as not usable", why)
ok(all("couldn't be opened" in w for w in [why[0], why[1], why[5], why[6], why[7]]), "changed on the way / sealed for another key / not a delivery: 'couldn't be opened'", why)
ok(all("isn't a usable list" in w for w in why[2:5]), "opened but wrong inside: says so (and nothing from it is kept)", why)
ok(not any(w in json.dumps(out) for w in ["stranger", "fine"]), "no word from a refused delivery is stored or shown")
first_at = [d["at"] for d in out["deliveries"]]
k2 = call("GET", "/api/seal-key?check=3")[1]
ok(k2["deliveries"] == {"applied": 0, "failed": 8, "waiting": 0}, "the key address counts them as failed", k2["deliveries"])
nxt(T, "2026-08-20"); raw("GET", "/__cron"); raw("GET", "/api/seal-key?check=4")
out2 = call("GET", "/api/lovenotes", token=T)[1]
ok([d["at"] for d in out2["deliveries"]] == first_at, "a refused delivery is not tried again and again")
status, out = nxt(T, "2026-08-20")
ok(status == 200 and out["text"] == "A note that was already here.", "and the notes themselves keep working")

print("a delivery made to break things does not hold up the ones after it")
T, K = fresh()
deep = '{"v":1,"mode":"add","notes":[{"text":' + "[" * 20000 + "]" * 20000 + '}]}'
with open(f"{WORK}/deep.txt", "w") as f: f.write(deep)
made = subprocess.run(["node", "-e", f'import("{REPO}/server/sealbox.js").then(async (b) => console.log(await b.seal(process.argv[1], require("fs").readFileSync("{WORK}/deep.txt", "utf8"))))', K["key"]], capture_output=True, text=True)
assert made.returncode == 0, made.stderr
hostile = made.stdout.strip()
odd = seal_raw(K["key"], json.dumps({"v": 1, "mode": "add", "notes": [{"text": ["smuggled", "words"]}, {"text": 7}]}))
deploy(hostile, odd, seal(K["key"], K["check"], NOTES_A))
status, out = call("GET", "/api/lovenotes", token=T)
ok(status == 200 and len(out["notes"]) == 3 and [d["ok"] for d in out["deliveries"]] == [False, False, True], "the two bad ones are refused and the good one behind them goes in", out["deliveries"])
ok(not any(w in json.dumps(out) for w in ["smuggled", "object Object"]), "text that isn't text is never turned into a note")
raw("GET", "/api/seal-key"); raw("GET", "/__notes_ops")
for _ in range(3): call("GET", "/api/lovenotes", token=T); nxt(T, "2026-08-20")
raw("GET", "/api/seal-key"); raw("GET", "/__cron")
ops = call("GET", "/__notes_ops")[1]
ok(not any("sealkey" in o for o in ops), "and afterwards nothing is opened again: the key document is not read by later requests, the key address or the job", [o for o in ops if "sealkey" in o])
ok(call("GET", "/api/seal-key")[1]["deliveries"] == {"applied": 1, "failed": 2, "waiting": 0}, "the key address counts 1 applied, 2 failed")

print("the same delivery twice; adding; replacing; edits afterwards")
T, K = fresh()
box_a = seal(K["key"], K["check"], NOTES_A)
deploy(box_a, box_a)
ok(len(texts(T)) == 3 and len(call("GET", "/api/lovenotes", token=T)[1]["deliveries"]) == 1, "the same delivery listed twice is applied once")
deploy(box_a); deploy(box_a)
ok(len(texts(T)) == 3, "deploying again with the same delivery adds nothing")
box_b = seal(K["key"], K["check"], NOTES_B)
deploy(box_a, box_b)
out = call("GET", "/api/lovenotes", token=T)[1]
ok(len(out["notes"]) == 4 and any("kite" in n["text"] for n in out["notes"]), "'add' brings only the note that is new", [n["text"] for n in out["notes"]])
ok(out["deliveries"][-1]["added"] == 1 and out["deliveries"][-1]["skipped"] == 2, "and says so: 1 added, 2 skipped", out["deliveries"][-1])
kite = [n["id"] for n in out["notes"] if "kite" in n["text"]][0]
call("DELETE", "/api/lovenotes/" + kite, token=T)
call("PUT", "/api/lovenotes/" + [n["id"] for n in out["notes"] if "carrom" in n["text"]][0], {"text": "You owe me TWO rematches at carrom."}, T)
deploy(box_a, box_b)
now = texts(T)
ok(len(now) == 3 and not any("kite" in t for t in now) and "You owe me TWO rematches at carrom." in now, "a later deploy with the same deliveries does not undo edits made in Settings", now)
box_r = seal(K["key"], K["check"], NOTES_R)
deploy(box_a, box_b, box_r)
ok(texts(T) == ["A brand new beginning.", "And a second line of it."], "'replace' swaps the whole set", texts(T))
seq = {nxt(T, "2026-08-20")[1]["text"] for _ in range(6)}
ok(seq == {"A brand new beginning.", "And a second line of it."}, "and only the new notes take turns afterwards", seq)

print("a full set and an over-full delivery")
T, K = fresh()
for i in range(58): add(T, f"filler {i}")
deploy(seal(K["key"], K["check"], NOTES_A))
out = call("GET", "/api/lovenotes", token=T)[1]
ok(len(out["notes"]) == 60 and out["deliveries"][-1]["added"] == 2 and out["deliveries"][-1]["skipped"] == 1, "a delivery fills the room there is and reports the rest as skipped", out["deliveries"][-1])

print("the private half stays put")
T, K = fresh()
deploy(seal(K["key"], K["check"], NOTES_A)); texts(T)
private = call("GET", "/__doc?name=sealkey")[1]["privateJwk"]["d"]
answers = [raw("GET", "/api/seal-key")[1], raw("GET", "/api/lovenotes", token=T)[1], raw("GET", "/api/lovenotes/next", token=T)[1], raw("GET", "/api/status")[1]]
ok(all(private not in a for a in answers), "after a delivery, still no answer carries the private half of the key")
ok(json.loads(answers[0]).keys() == {"key", "groups", "check", "deliveries"}, "and the key address still returns only public things")

finish("test_a5_sealed")
