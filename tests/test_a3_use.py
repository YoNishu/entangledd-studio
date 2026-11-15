"""What she is told when a key fails while she is using the app, and what real use leaves for the health check.
Run: python3 tests/test_a3_use.py   (starts its own fresh server on port its own port; two short renders are attempted)"""
import where as _W
import subprocess, time
from a3lib import *

RENDERER = "dev-render-secret"
bg = open(f"{_W.MEDIA}/sky.jpg", "rb").read()
def new_job(t, overlay=b"this is not a picture"):
    s, j, _ = http("POST", "/api/jobs", {"length": 6, "bgSize": len(bg), "bgName": "sky.jpg"}, t); assert s == 200, j
    s, part, _ = http("PUT", f"/api/jobs/{j['id']}/bg/1?uploadId={j['uploadId']}", bg, t, {"Content-Type": "application/octet-stream"}); assert s == 200, part
    s, b, _ = http("POST", f"/api/jobs/{j['id']}/bg/complete", {"uploadId": j["uploadId"], "parts": [part]}, t); assert s == 200, b
    s, b, _ = http("PUT", f"/api/jobs/{j['id']}/overlay", overlay, t, {"Content-Type": "image/png"}); assert s == 200, b
    return j["id"]
def start(t, id): return http("POST", f"/api/jobs/{id}/start", token=t)
def wait_notes(cond, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        n = doc("healthnotes") or {}
        if cond(n.get("reel") or {}): return n
        time.sleep(0.5)
    return doc("healthnotes") or {}
HOW = "Ask Nishith to renew it (Settings, Check everything, shows how)."

serve(); t = login(); connect(t)

print("A successful question to Nishiii costs the health notes nothing")
for _ in range(3):
    s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t); assert s == 200, b
check("no note is written when all is well", doc("healthnotes") is None, doc("healthnotes"))

print("Starting a reel when GitHub refuses the key")
for status, why in [(401, "GitHub no longer accepts the key that starts them (it has run out or was removed)"),
                    (403, "the key isn't allowed to start the reel maker on GitHub"),
                    (404, "the key can't find the reel maker on GitHub")]:
    hset(dispatch=status); id = new_job(t); s, b, _ = start(t, id)
    check(f"status {status}: one sentence, what and who", s == 502 and b["error"] == f"Reels can't be made right now: {why}. {HOW}", b)
    check(f"status {status}: the reel shows the same reason", http("GET", f"/api/jobs/{id}", token=t)[1].get("error") == b["error"])
    check(f"status {status}: noted for the health check", (doc("healthnotes") or {}).get("reel", {}).get("refusedStatus") == status)
noted = doc("healthnotes")["reel"]["refusedAt"]
hset(dispatch=422); id = new_job(t); s, b, _ = start(t, id)
check("another refusal: said plainly, without blaming the key", s == 502 and b["error"] == "GitHub couldn't start the reel just now (status 422). Try again in a minute.", b)
check("and not noted as a key problem", doc("healthnotes")["reel"]["refusedAt"] == noted)
items, _ = check_now(t)
check("the health check now says GitHub refused to start a reel", items["github"]["state"] == "attention" and "refused to start a reel" in items["github"]["line"], items["github"])

print("A reel that starts, then fails; then another; then one that works")
hset(dispatch=""); id = new_job(t); s, b, _ = start(t, id)
check("starts normally", s == 200 and b["state"] == "rendering", b)
n = wait_notes(lambda r: r.get("fails") == 1)
check("the failed render was noted once", n.get("reel", {}).get("fails") == 1 and n["reel"]["startedAt"] > n["reel"]["refusedAt"], n)
items, _ = check_now(t)
check("the key is trusted again (a reel did start)", items["github"]["state"] == "ok", items["github"])
check("one miss is mentioned, not raised", items["reels"]["state"] == "ok" and "didn't finish" in items["reels"]["line"], items["reels"])
id2 = new_job(t); start(t, id2)
n = wait_notes(lambda r: r.get("fails") == 2)
items, _ = check_now(t)
check("two in a row are raised, with what to do", items["reels"]["state"] == "attention" and len(items["reels"]["fix"]) == 3, items["reels"])
s, b, _ = http("PUT", f"/api/render/{id2}/reel", b"x" * 4000, RENDERER, {"Content-Type": "video/mp4"})
check("the renderer hands a finished reel back", s == 200, (s, b))
n = doc("healthnotes")["reel"]
check("a finished reel clears the count", n["fails"] == 0 and n["okAt"] >= n["failAt"], n)
items, _ = check_now(t)
check("and the line says when the last reel was made", items["reels"]["state"] == "ok" and "The last reel was made on" in items["reels"]["line"], items["reels"])

print("Nishiii when the Anthropic account is out of credit")
hset(claudeAsk="credit")
s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
check("one sentence, what and who", s == 502 and b["error"] == "Nishiii can't answer right now: the Anthropic account is out of credit. Ask Nishith to top it up (Settings, Check everything, shows how).", b)
first = doc("healthnotes").get("claude")
check("noted", bool(first) and first["kind"] == "credit", first)
http("POST", "/api/check", {"text": "again", "author": ""}, t)
check("a second failure of the same kind writes nothing new", doc("healthnotes")["claude"] == first)
items, _ = check_now(t)
check("the health check says it, with the two steps", items["nishiii"]["state"] == "attention" and "ran out of credit" in items["nishiii"]["line"] and len(items["nishiii"]["fix"]) == 2, items["nishiii"])
hset(claudeAsk="")
items, _ = check_now(t)
check("after a top-up, Check now finds out by itself", items["nishiii"]["state"] == "ok" and "claude" not in doc("healthnotes"), (items["nishiii"], doc("healthnotes")))

print("Nishiii when the key is refused, or the model is gone")
hset(claudeAsk="401")
s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
check("key refused: one sentence, what and who", s == 502 and b["error"] == "Nishiii can't answer right now: Anthropic no longer accepts the key. " + HOW, b)
check("noted as a key problem", doc("healthnotes")["claude"]["kind"] == "key")
hset(claudeAsk="")
s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
check("the next good answer clears the note by itself", s == 200 and "claude" not in doc("healthnotes"), doc("healthnotes"))
hset(claudeAsk="404")
s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
check("model retired: says so", s == 502 and "the Claude model the app uses has been retired" in b["error"], b)
hset(claudeAsk="")

print("Searching for backgrounds when Pixabay refuses the key")
hset(pixabay="400")
s, b, _ = http("GET", "/api/stock?kind=photo&q=quiet+harbour+at+dawn", token=t)
check("one sentence, what and who, and what still works", s == 502 and b["error"] == "Searching for backgrounds isn't working: Pixabay no longer accepts the key. " + HOW + " Your own photos and videos still work.", b)
hset(pixabay="429")
s, b, _ = http("GET", "/api/stock?kind=photo&q=another+quiet+harbour", token=t)
check("too many searches: unchanged, no blame", s == 502 and b["error"] == "Too many searches in a short time. Try again in a minute.", b)
hset(pixabay="ok")

print("Instagram when the sign-in is no longer accepted")
ig = doc("instagram"); ig["userToken"] = "LONG-gone-0123456789"; putdoc("instagram", ig)
s, b, _ = http("GET", "/api/instagram/audio?q=", token=t)
check("one sentence, what and who", s == 502 and b["error"] == "Instagram didn't accept the sign-in: it has ended or was withdrawn. Ask Nishith to connect Instagram again (Settings, Check everything, shows how).", b)
s, b, _ = http("POST", "/api/instagram/connect", {"token": "WRONG-" + "0123456789" * 6}, t)
check("pasting a bad token gets its own, different sentence", s == 400 and b["error"].startswith("Meta didn't accept that token. Generate a fresh one"), (s, b))
check("and the existing connection is not lost by it", doc("instagram")["pageToken"] == "PAGE-token-0123456789")

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()
