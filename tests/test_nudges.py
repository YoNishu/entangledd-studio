"""The daily reminder speaks as Nishiii: one short, flirty line, of the kind that fits the morning (she has been
away two days / a reel is made and waiting / she posted yesterday / today's quotes), never the same line again
while others of its kind are unsaid, and none at all on a day she has already posted.
A pretend phone opens what it is sent the way RFC 8291 says. Run: python3 tests/test_nudges.py"""
import base64, json, os, re, subprocess, time, urllib.parse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from a3lib import *

def b64u(data): return base64.urlsafe_b64encode(data).rstrip(b"=").decode()
class Phone:
    def __init__(self, name):
        self.private = ec.generate_private_key(ec.SECP256R1())
        self.public = self.private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.auth = os.urandom(16)
        self.endpoint = f"{B}/__push/{name}"
    def subscription(self): return {"endpoint": self.endpoint, "expirationTime": None, "keys": {"p256dh": b64u(self.public), "auth": b64u(self.auth)}}
    def read(self, entry):
        body = base64.b64decode(entry["body"])
        salt, idlen = body[:16], body[20]
        sender, locked = body[21:21 + idlen], body[21 + idlen:]
        shared = self.private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender))
        ikm = HKDF(hashes.SHA256(), 32, self.auth, b"WebPush: info\0" + self.public + sender).derive(shared)
        key = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\0").derive(ikm)
        nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\0").derive(ikm)
        return json.loads(AESGCM(key).decrypt(nonce, locked, None).rstrip(b"\0")[:-1].decode())

LINES = json.loads(subprocess.run(["node", "--input-type=module", "-e", "import * as n from './server/nudges.js'; console.log(JSON.stringify(n.LINES))"],
                                  capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), "..")).stdout)
kind_of = {body: k for k, lines in LINES.items() for _, body in lines}
every = [body for lines in LINES.values() for _, body in lines]
check("there are plenty of lines, each its own, each short enough for a notification", len(every) >= 50 and len(set(every)) == len(every) and all(20 <= len(b) <= 120 for b in every), [b for b in every if len(b) > 120])
check("ids are not used twice", len({i for lines in LINES.values() for i, _ in lines}) == len(every))

def clock(iso): http("GET", "/__push_clock?at=" + urllib.parse.quote(iso))
def cron(): assert http("GET", "/__cron?cron=" + urllib.parse.quote("41 5 * * *"))[0] == 204
def pushes(): return http("GET", "/__push_log?reset=1")[1]
def opened(day): putdoc(f"suggestions/{day}", [{"id": "00000000-0000-4000-8000-000000000001", "text": "A line.", "author": "Someone"}])
def morning(day):
    clock(f"{day}T05:41:01Z"); cron()
    got = pushes()
    return phone.read(got[0])["notification"] if got else None

serve()
T = login()
phone = Phone("hers")
clock("2026-11-10T03:00:00Z")
s, b, _ = http("POST", "/api/reminders", {"subscription": phone.subscription(), "time": "11:11"}, T)
check("the reminder is on", s == 200 and b.get("on") is True, (s, b))

n = morning("2026-11-10")
check("away for two days: a come-back line, from Nishiii", n and n["title"] == "Nishiii 💌" and kind_of.get(n["body"]) == "back", n)
opened("2026-11-10")
n2 = morning("2026-11-11")
check("she opened the studio yesterday: a line about today's quotes", n2 and kind_of.get(n2["body"]) == "today", n2)
opened("2026-11-11")
putdoc("made", [{"id": "m1", "jobId": "55555555-5555-4555-8555-555555555555", "made": 1, "snap": {}, "about": {"quote": "A kept line."}}])
n3 = morning("2026-11-12")
check("a reel is made and waiting: a line about it", n3 and kind_of.get(n3["body"]) == "draft", n3)
putdoc("made", [])
opened("2026-11-12")
putdoc("posts", [{"id": "p1", "jobId": "66666666-6666-4666-8666-666666666666", "state": "published", "published": 1794477600000, "created": 1794477600000, "quote": "x"}])   # 12 Nov 2026, India time
n4 = morning("2026-11-13")
check("she posted yesterday: a line that says so", n4 and kind_of.get(n4["body"]) == "streak", n4)
check("one plain sentence each: no quote pasted in, no second line", all("\n" not in x["body"] and "“" not in x["body"] for x in (n, n2, n3, n4)))

# No line twice while others of its kind are unsaid: the rest of the "today" lot, morning after morning.
NAMES = ["Dhruuu", "penguin", "sunflower", "baby", "waifu"]
check("every line of the lot uses one of the names he calls her", all(any(k.lower() in b.lower() for k in NAMES) for b in every), [b for b in every if not any(k.lower() in b.lower() for k in NAMES)])
import datetime
def days(start, n): return [(datetime.date.fromisoformat(start) + datetime.timedelta(days=i)).isoformat() for i in range(n)]
def a_morning(day):
    opened((datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat())
    x = morning(day)
    return x["body"] if x else None
left_today = len(LINES["today"]) - 1                       # one went out above
seen = [a_morning(d) for d in days("2026-11-14", left_today)]
check("the whole lot goes out before anything else: every morning a different line of it", all(seen) and len(set(seen + [n2["body"]])) == len(LINES["today"]) and all(kind_of.get(x) == "today" for x in seen), seen)
check("the lines said are remembered with the reminders", len(doc("reminders").get("said") or []) >= len(LINES["today"]) + 3, doc("reminders").get("said"))

# The lot is finished: from now on a fresh line is written for each day.
after = days("2026-11-14", left_today + 3)[-3:]
w1, w2 = a_morning(after[0]), a_morning(after[1])
check("once the lot is finished, a fresh line is written for the day", w1 and w1 not in kind_of and w1.startswith("Penguin, today's quotes keep asking for you"), w1)
check("tidied for a notification: no quotation marks, no hashtag, short", w1 and '"' not in w1 and "#" not in w1 and len(w1) <= 130, w1)
check("a different one the next day, and each is kept so it is not echoed", w2 and w2 != w1 and w2 not in kind_of and doc("reminders").get("written") == [w1, w2], (w2, doc("reminders").get("written")))
asked = [c for c in http("GET", "/__claude_log")[1] if str(c.get("system", "")).startswith("You write one push notification")] if http("GET", "/__claude_log")[0] == 200 else None
if asked is not None:
    sent = json.dumps(asked)
    check("what goes to Claude for it: the kind of morning and his names for her, nothing she wrote", "today's five quotes are ready" in sent and w1 in sent and "A line." not in sent and "letmein" not in sent, sent[:400])

day = after[2]
stamp = int(datetime.datetime.fromisoformat(day + "T04:00:00+00:00").timestamp() * 1000)
putdoc("posts", doc("posts") + [{"id": "p2", "jobId": "77777777-7777-4777-8777-777777777777", "state": "published", "published": stamp, "created": stamp, "quote": "y"}])
opened((datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat())
check("on a day she has already posted: no reminder", morning(day) is None)
s, b, _ = http("POST", "/api/reminders/test", {"endpoint": phone.endpoint}, T)
got = pushes()
check("the test reminder reads as Nishiii too", bool(got) and phone.read(got[0])["notification"]["title"] == "Nishiii 💌", (s, b))
finish()
