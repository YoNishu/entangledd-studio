"""Little notes from Nishiii: a rehearsal of the real delivery, step for step as the orchestrator
will do it after the first deploy.
  1. the app is live with no deliveries          -> GET /api/seal-key
  2. the notes are sealed with the real tool, into server/sealed.js of the repo
  3. a new version is deployed with that file    -> here: the server is started again from a
     copy of the repo, and the two stored documents are put back (Cloudflare's storage outlives
     a deploy; this pretend one does not)
  4. the delivery is opened with nobody around (timed job), and the key address says so
The other tests swap the deliveries through a hook; this one goes through the file itself, read
when the server starts. It works on a COPY of the repo in /tmp, never on the worktree.
Only made-up notes and a throwaway key. Uses port its own port; stops its server at the end.
Run: python3 tests/test_a5_deploy.py"""
import where as _W
import json, os, re, shutil, subprocess, time
from a5lib import ok, finish, raw, call, login, add, nxt, REPO, PORT

COPY = f"{_W.OUT}/work/deploy-copy"
PRIVATE = f"{_W.OUT}/work/private"
ORIGINAL = open(f"{REPO}/server/sealed.js").read()
FIRST = {"mode": "add", "notes": [
    {"text": "We met at the bakery on 3 March 2020.", "date": "2020-03-03"},
    {"text": "You still owe me a rematch at carrom."},
    {"text": "The yellow scooter was the best idea we ever had."}]}
SECOND = {"mode": "add", "notes": [
    {"text": "You still owe me a rematch at carrom."},
    {"text": "The kite that got away is still flying somewhere."}]}

def start():
    """Starts the copy's server afresh (as a deploy starts the new version): empty memory, empty pretend storage."""
    subprocess.run(["fuser", "-k", f"{PORT}/tcp"], capture_output=True)
    for _ in range(20):
        if subprocess.run(["fuser", f"{PORT}/tcp"], capture_output=True).returncode != 0: break
        time.sleep(0.2)
    log = open(f"{_W.OUT}/deploy.log", "w")
    subprocess.Popen(["node", "server/dev.mjs"], cwd=COPY, stdout=log, stderr=log, env={**os.environ, "PORT": str(PORT), "DEV_MEDIA": f"{_W.MEDIA}"})
    for _ in range(40):
        try:
            if raw("GET", "/api/status")[0] == 200: return
        except Exception: pass
        time.sleep(0.25)
    raise SystemExit(f"the copy's server did not start; see {_W.OUT}/deploy.log")

def keep():
    """What Cloudflare's storage would still hold after a deploy."""
    return {name: raw("GET", f"/__doc?name={name}")[1] for name in ("sealkey", "lovenotes")}

def put_back(docs):
    for name, text in docs.items():
        if text and text != "null": assert raw("PUT", f"/__doc?name={name}", body=text.encode())[0] == 204

def deploy():
    docs = keep(); start(); put_back(docs)

def seal(notes, expect):
    os.makedirs(PRIVATE, exist_ok=True)
    with open(f"{PRIVATE}/notes.json", "w") as f: json.dump(notes, f)
    k = call("GET", "/api/seal-key")[1]
    out = subprocess.run(["node", "tools/seal.mjs", "--key", *k["groups"].split(), "--check", k["check"], "--in", f"{PRIVATE}/notes.json", "--out", "server/sealed.js"],
                         capture_output=True, text=True, cwd=COPY)
    os.remove(f"{PRIVATE}/notes.json")
    ok(out.returncode == 0 and expect in out.stdout, f"the tool, run as the report says: {out.stdout.strip().splitlines()[0] if out.stdout.strip() else out.stderr.strip()[:150]}")
    return k

try:
    # a copy of the repo as it stands (tracked files, with any changes not yet committed)
    shutil.rmtree(COPY, ignore_errors=True); os.makedirs(COPY)
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=REPO, check=True).stdout
    subprocess.run(f"git ls-files -z | tar --null -T - -c | tar -x -C {COPY}", shell=True, cwd=REPO, check=True)
    ok("server/sealed.js" in files and open(f"{COPY}/server/sealed.js").read().strip().endswith("export const SEALED = [];"), "the repo starts with no deliveries in server/sealed.js")

    # ---------------- 1. live, no deliveries ----------------
    print("the first deploy: no deliveries yet")
    start()
    T = login()
    add(T, "A note that was typed in Settings before any delivery.")
    k0 = call("GET", "/api/seal-key")[1]
    ok(k0["deliveries"] == {"applied": 0, "failed": 0, "waiting": 0} and re.fullmatch(r"04[0-9a-f]{128}", k0["key"]) is not None, "the key address gives the key and counts nothing", k0["deliveries"])
    raw("GET", "/__cron")
    ok("lovenotes-deliveries" not in (call("GET", "/__doc?name=jobstamps")[1] or {}), "and there is no timed job for deliveries")

    # ---------------- 2. seal with the real tool into the repo's file ----------------
    print("sealing into server/sealed.js")
    seal(FIRST, "Sealed 3 notes (add)")
    written = open(f"{COPY}/server/sealed.js").read()
    ok(len(re.findall(r'^  "[A-Za-z0-9+/=]+",$', written, re.M)) == 1 and not any(w in written for w in ["bakery", "carrom", "scooter"]), "the file now holds one delivery and not a word of the notes")
    ok(subprocess.run(["node", "--check", "server/sealed.js"], cwd=COPY).returncode == 0 and subprocess.run(["node", "--check", "server/worker.js"], cwd=COPY).returncode == 0, "and is still code the server can load")
    ok(call("GET", "/api/seal-key")[1]["deliveries"] == {"applied": 0, "failed": 0, "waiting": 0}, "the version still running knows nothing of it yet (all three counts 0 = not deployed yet)")

    # ---------------- 3 + 4. deploy; opened with nobody around ----------------
    print("the deploy that carries the delivery")
    deploy()
    ticks = 0
    while ticks < 4:
        raw("GET", "/__cron"); ticks += 1
        doc = call("GET", "/__doc?name=lovenotes")[1]
        if doc and len(doc.get("notes", [])) == 4: break
    ok(doc and [n["text"] for n in doc["notes"]] == ["A note that was typed in Settings before any delivery."] + [n["text"] for n in FIRST["notes"]],
       f"nobody opens the app: the timed job brings the notes in (tick {ticks}), and the note from Settings is kept", doc and [n["text"][:20] for n in doc["notes"]])
    ok("lovenotes-deliveries" in (call("GET", "/__doc?name=jobstamps")[1] or {}), "(the job is on the timer's list because the file had a delivery when the server started)")
    k1 = call("GET", "/api/seal-key")[1]
    ok(k1["deliveries"] == {"applied": 1, "failed": 0, "waiting": 0} and k1["key"] == k0["key"], "the key address, with no sign-in: 1 applied, and the key is the same as before the deploy", k1["deliveries"])

    print("the same version starts again (as Cloudflare does all the time)")
    deploy()
    raw("GET", "/__notes_ops")
    k2 = call("GET", "/api/seal-key")[1]
    ops = call("GET", "/__notes_ops")[1]
    ok(k2["deliveries"] == {"applied": 1, "failed": 0, "waiting": 0} and not any(o.startswith("put ") for o in ops), "the key address still says 1 applied, and nothing is written or opened again", ops)
    T = login()
    seen = {nxt(T)[1]["text"] for _ in range(4)}
    ok(seen == {"A note that was typed in Settings before any delivery."} | {n["text"] for n in FIRST["notes"]}, "four openings show the four notes, one each")
    out = call("GET", "/api/lovenotes", token=T)[1]
    ok(len(out["deliveries"]) == 1 and out["deliveries"][0]["ok"] and out["deliveries"][0]["added"] == 3, "the editor's status: 3 notes arrived", out["deliveries"])

    # ---------------- a second delivery later on ----------------
    print("a second delivery, weeks later")
    seal(SECOND, "now holds 2 deliveries")
    deploy()
    k3 = call("GET", "/api/seal-key")[1]
    ok(k3["deliveries"] == {"applied": 2, "failed": 0, "waiting": 0}, "after its deploy the key address says 2 applied", k3["deliveries"])
    T = login()
    out = call("GET", "/api/lovenotes", token=T)[1]
    ok(len(out["notes"]) == 5 and out["deliveries"][-1]["added"] == 1 and out["deliveries"][-1]["skipped"] == 1, "it added the one new note and left the one already there alone", out["deliveries"][-1])

    # ---------------- a key that changed in between ----------------
    print("if the stored key were lost between sealing and deploying")
    docs = keep(); start(); put_back({"lovenotes": docs["lovenotes"]})        # the key document is gone: a new pair is made
    k4 = call("GET", "/api/seal-key")[1]
    seal({"mode": "add", "notes": [{"text": "Sealed for the new key."}]}, "now holds 3 deliveries")
    deploy()
    k5 = call("GET", "/api/seal-key")[1]
    ok(k4["key"] != k0["key"] and k5["deliveries"] == {"applied": 3, "failed": 0, "waiting": 0}, "deliveries already brought in stay counted as applied, and one sealed for the new key goes in", k5["deliveries"])
    docs = keep(); start(); put_back({"sealkey": docs["sealkey"]})            # the notes document is gone: everything is tried again
    k6 = call("GET", "/api/seal-key")[1]
    ok(k6["deliveries"] == {"applied": 1, "failed": 2, "waiting": 0}, "with the notes lost too, the old deliveries can't be opened with the new key, and the address says so plainly: 2 failed", k6["deliveries"])
finally:
    subprocess.run(["fuser", "-k", f"{PORT}/tcp"], capture_output=True)
    shutil.rmtree(COPY, ignore_errors=True); shutil.rmtree(PRIVATE, ignore_errors=True)

ok(open(f"{REPO}/server/sealed.js").read() == ORIGINAL, "the worktree's own server/sealed.js was never touched")
finish("test_a5_deploy")
