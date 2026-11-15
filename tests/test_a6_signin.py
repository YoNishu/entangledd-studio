"""Sign-in: the passcode's length never shows, wrong tries are limited per address and across all addresses
together (also when they arrive in the same instant), and a Face ID reply that names no saved device writes nothing."""
import where as _W
import base64, json
from concurrent.futures import ThreadPoolExecutor
from a6lib import *

def tryit(code, ip):
    s, b, _ = http("POST", "/api/login", {"passcode": code}, headers={"CF-Connecting-IP": ip})
    return s, b
RESTING = "Too many wrong tries. Wait an hour and try again."
def puts(cost, prefix): return [w for w in cost["what"] if w.startswith("put " + prefix)]

print("Comparing the passcode")
serve()
T = login()
settle()                                                  # the health record's first look, as after any update
wrong = ["", "letmei", "letmeinn", "LETMEIN", " letmein", "letmein ", "x" * 5000, 0, None, {"a": 1}]
for i, w in enumerate(wrong):
    s, b = tryit(w, f"10.0.0.{i}")
    check(f"a wrong passcode ({str(w)[:12]!r}) is refused in the same words", s == 401 and b == {"error": "That passcode isn't right."}, (s, b))
s, b = tryit("letmein", "10.0.9.9")
check("the right one signs in, and gives the same token every time", s == 200 and b["token"] == T and b["status"]["signedIn"] is True, (s, b))
src = open(f"{_W.ROOT}/server/worker.js").read()
check("the passcode is only ever compared after a keyed hash of both sides", "safeEqual(String(body.passcode" not in src and "passcodeIs(env, body.passcode)" in src)
marks = len(keys("auth/try/"))
ops(reset=True); login(); cost = ops()
check("a sign-in costs at most five storage calls", cost["storage"] <= 5, (cost["storage"], cost["what"]))
check("and leaves nothing behind", len(keys("auth/try/")) == marks, (marks, len(keys("auth/try/"))))

print("One address")
for i in range(10 - 0): tryit("nope", "10.1.1.1")
s, b = tryit("letmein", "10.1.1.1")
check("ten wrong tries from one address lock that address for 15 minutes, even for the right passcode", s == 429 and "15 minutes" in b["error"], (s, b))
check("another address still signs in", tryit("letmein", "10.1.1.2")[0] == 200)

print("All addresses together")
used = len(wrong) + 10                                   # wrong tries so far this hour (the one refused at the door isn't a try)
check("every wrong try so far left one marker", len(keys("auth/try/")) == used, (len(keys("auth/try/")), used))
answers = [tryit("guess%d" % i, f"10.2.{i // 200}.{i % 200}") for i in range(60 - used)]
check("up to sixty wrong tries an hour are each answered", all(s == 401 for s, _ in answers), [s for s, _ in answers if s != 401][:5])
s, b = tryit("guess", "10.3.0.1")
check("the sixty-first is turned away before the passcode is looked at", s == 429 and b == {"error": RESTING}, (s, b))
ops(reset=True); s, b = tryit("letmein", "10.3.0.2"); cost = ops()
check("so is the right passcode, from any address, until the hour is over", s == 429 and b == {"error": RESTING}, (s, b))
check("a try turned away writes nothing", [w for w in cost["what"] if w.startswith("put ")] == [], cost["what"])
check("someone already signed in carries on", http("GET", "/api/library", token=T)[0] == 200)
check("and Face ID still gets its challenge", http("POST", "/api/passkey/challenge", {})[0] == 200)
errs = doc("errors")
note = [e for e in errs["list"] if e["where"] == "sign-in"]
check("it is written into the record of problems, once", len(note) == 1 and "wrong passcodes" in note[0]["what"], errs)
check("with no passcode, tried or real, in it", "letmein" not in json.dumps(errs) and "guess" not in json.dumps(errs))
items, _ = part_now(T, "page")
check("the health record raises it with what to do", items["errors"]["state"] == "soon" and "APP_PASSCODE" in " ".join(items["errors"]["fix"]) and "Nobody got in" in items["errors"]["line"], items["errors"])
pub = http("GET", "/api/health")[1]
check("and the open record names it", pub["needsAttention"] and "Problems noticed: someone tried many wrong passcodes" in pub["message"], pub["message"])
set_day(india_day(1))
check("the next hour sign-in by passcode works again", tryit("letmein", "10.3.0.3")[0] == 200)
set_day()

print("Right sign-ins are never counted")
serve()
ok = [tryit("letmein", f"10.4.0.{i}")[0] for i in range(70)]
check("seventy sign-ins in a row all work", ok == [200] * 70, [s for s in ok if s != 200][:3])
check("and leave no markers", keys("auth/try/") == [])

print("A burst in the same instant")
serve()
with ThreadPoolExecutor(max_workers=40) as pool:
    got = list(pool.map(lambda i: tryit("burst%d" % i, f"10.5.{i // 200}.{i % 200}"), range(150)))
looked = [s for s, _ in got if s == 401]
check("of 150 guesses sent at once, no more than sixty are looked at", 1 <= len(looked) <= 60 and all(s in (401, 429) for s, _ in got), (len(looked), sorted({s for s, _ in got})))
check("and the rest are turned away", tryit("letmein", "10.5.9.9") == (429, {"error": RESTING}))

print("Face ID replies")
serve()
T = login()
def reply(challenge, cred):
    client = base64.urlsafe_b64encode(json.dumps({"type": "webauthn.get", "challenge": challenge, "origin": B}).encode()).decode().rstrip("=")
    return http("POST", "/api/passkey/login", {"credentialId": cred, "clientDataJSON": client, "authenticatorData": "AAAA", "signature": "AAAA"})
putdoc("passkeys", [{"id": "saved-device-0001", "publicKey": "A" * 120, "label": "iPhone", "added": 1}])
c1 = http("POST", "/api/passkey/challenge", {})[1]["challenge"]
ops(reset=True); s, b, _ = reply(c1, "someone-elses-device"); cost = ops()
check("a reply naming a device the app doesn't know is refused", s == 401 and "isn't recognised" in b["error"], (s, b))
check("and writes nothing to storage", [w for w in cost["what"] if w.startswith("put ")] == [] and keys("auth/used-") == [], cost["what"])
ops(reset=True); s, b, _ = reply(c1, "saved-device-0001"); cost = ops()
check("a reply naming a saved device, with a signature that doesn't fit, is refused", s == 401 and "couldn't be confirmed" in b["error"], (s, b))
check("and its challenge is used up", len(keys("auth/used-")) == 1 and len(puts(cost, "auth/used-")) == 1, cost["what"])
s, b, _ = reply(c1, "saved-device-0001")
check("so the same challenge can't be answered twice", s == 400 and "expired" in b["error"], (s, b))
s, b, _ = reply("AAAA", "saved-device-0001")
check("a made-up challenge is refused", s in (400, 401), (s, b))
log = open(f"{_W.OUT}/dev.log").read()
check("no passcode reached the log", "letmein" not in log.replace("passcode: letmein", ""))
finish()
