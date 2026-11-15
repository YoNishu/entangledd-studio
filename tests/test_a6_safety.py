"""The safety pass: what each open path gives away, how secrets are compared, and the headers on the app's own files."""
import where as _W
import hashlib, hmac, json, time, urllib.request
from a6lib import *

serve()

print("The app's own files")
want = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'"}
for path in ["/", "/app.js", "/app.css", "/manifest.webmanifest", "/icon-180.png"]:
    s, body, hd = fetch("GET", path)
    check(f"{path} carries the four headers", s == 200 and all(hd.get(k.lower()) == v for k, v in want.items()), {k: hd.get(k.lower()) for k in want})
check("the headers file itself is never served", http("GET", "/_headers")[0] == 404)
check("the headers file asks for nothing a stand-in can't prove (no script or style rules)", "script-src" not in open(f"{_W.ROOT}/web/_headers").read() and "default-src" not in open(f"{_W.ROOT}/web/_headers").read())

print("Answers from the server")
s, raw, hd = fetch("GET", "/api/status")
b = json.loads(raw)
check("JSON answers say never to guess a type, and never to keep a copy", hd.get("x-content-type-options") == "nosniff" and hd.get("cache-control") == "no-store", hd)
check("the open status gives only yes/no answers", s == 200 and all(isinstance(v, bool) for v in b.values()), b)
T = login()
s, b, hd = fetch("GET", "/api/stock/file?url=" + urllib.parse.quote(f"{B}/__media/cdn/sky1_1280.jpg"), token=T)
check("a file passed on from a library says never to guess its type", s == 200 and hd.get("x-content-type-options") == "nosniff" and hd.get("content-type") == "image/jpeg", (s, hd))
s, b, hd = fetch("GET", "/api/music/file?url=" + urllib.parse.quote(f"{B}/__media/steps.mp3"), token=T)
check("so does a track passed on from the music library", s == 200 and hd.get("x-content-type-options") == "nosniff" and hd.get("content-type") == "audio/mpeg", (s, hd))

print("Paths that need sign-in say nothing without it")
SIGNED = ["library", "suggestions", "asked", "posts", "taste", "looks", "queue", "insights", "handoffs", "inspirations", "instagram", "checkup", "lovenotes", "backups", "report", "music", "stock", "jobs/" + new_id()]
for path in SIGNED:
    s, b, _ = http("GET", "/api/" + path)
    check(f"/api/{path} without sign-in: 401 and one fixed sentence", s == 401 and b == {"error": "Enter the passcode to continue."}, (s, b))
for method, path in [("POST", "oops"), ("POST", "backups/restore"), ("POST", "chat"), ("POST", "checkup?part=page"), ("PUT", "slides"), ("POST", "edit"), ("DELETE", "taste?scope=all")]:
    s, b, _ = http(method, "/api/" + path, {} if method != "DELETE" else None)
    check(f"{method} /api/{path} without sign-in: 401", s == 401, (s, b))
s, b, _ = http("GET", "/api/library", token="0" * 64)
check("a made-up session of the right length is refused", s == 401)
s, b, _ = http("GET", "/api/render/" + new_id() + "/job", token="dev-render-secre")
check("the renderer's paths refuse a secret that is nearly right", s == 401 and b == {"error": "Not allowed."}, (s, b))
check("and the app's own session is not the renderer's secret", http("GET", "/api/render/" + new_id() + "/job", token=T)[0] == 401)

print("Links Instagram fetches reels and pictures from")
jid = new_id()
put_raw(f"jobs/{jid}/reel.mp4", b"0" * 4000)
exp = int(time.time() * 1000) + 3600 * 1000
sig = hmac.new(b"dev-render-secret", f"reel|{jid}|{exp}".encode(), hashlib.sha256).hexdigest()
check("a signed link gives the reel", fetch("GET", f"/api/public/reel/{jid}.mp4?exp={exp}&sig={sig}")[0] == 200)
check("a link signed for another reel does not", fetch("GET", f"/api/public/reel/{new_id()}.mp4?exp={exp}&sig={sig}")[0] == 404)
check("nor one with a later end date than was signed", fetch("GET", f"/api/public/reel/{jid}.mp4?exp={exp + 1}&sig={sig}")[0] == 404)
check("nor one with the signature cut short or missing", fetch("GET", f"/api/public/reel/{jid}.mp4?exp={exp}&sig={sig[:-1]}")[0] == 404 and fetch("GET", f"/api/public/reel/{jid}.mp4?exp={exp}")[0] == 404)
old = int(time.time() * 1000) - 1000
sig_old = hmac.new(b"dev-render-secret", f"reel|{jid}|{old}".encode(), hashlib.sha256).hexdigest()
check("nor one whose time is up", fetch("GET", f"/api/public/reel/{jid}.mp4?exp={old}&sig={sig_old}")[0] == 404)
check("a reel's link does not open a picture", fetch("GET", f"/api/public/slide/{jid}.jpg?exp={exp}&sig={sig}")[0] == 404)

print("What the open paths give away")
connect(T); settle()
s, raw, _ = http("GET", "/api/health", raw=True)
s2, key, _ = http("GET", "/api/seal-key", raw=True)
private = ["theentangledd", "17890", "111", "Entangledd"]
check("the open health record names no account, page or id", not any(p in raw for p in private), [p for p in private if p in raw])
check("neither open answer holds a key, a token or the passcode", not no_secrets(raw + key), no_secrets(raw + key))
sealed = json.loads(get_raw("data/sealkey.json"))
secret_half = sealed["privateJwk"]["d"]                       # never printed: only looked for
everywhere = raw + key + json.dumps(http("GET", "/api/checkup", token=T)[1]) + json.dumps(http("GET", "/api/backups", token=T)[1]) + open(f"{_W.OUT}/dev.log").read()
check("the private half of the sealing key is in no answer and no log", len(secret_half) > 30 and secret_half not in everywhere)
check("the open sealing key is the public half", json.loads(key)["key"] == sealed["publicHex"])
finish()
