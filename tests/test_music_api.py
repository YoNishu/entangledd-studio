import where as _W
import json, sys, urllib.request, urllib.error, urllib.parse
B = f"{_W.URL}"
def call(path, token=None, raw=False):
    req = urllib.request.Request(B + path)
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        r = urllib.request.urlopen(req)
        return (r.status, r.headers.get("Content-Type"), len(r.read())) if raw else json.load(r)
    except urllib.error.HTTPError as e:
        return {"status": e.code, **json.load(e)}
req = urllib.request.Request(B + "/api/login", data=json.dumps({"passcode": "letmein"}).encode()); req.add_header("Content-Type", "application/json")
T = json.load(urllib.request.urlopen(req))["token"]
mode = sys.argv[1]
r = call("/api/music?q=calm%20piano", T)
if "items" not in r: print(f"[{mode}]", r); sys.exit()
print(f"[{mode}] kept {len(r['items'])} of 7:", [(i["title"][:14], i["licence"], i["seconds"], i["needsCredit"]) for i in r["items"]], "| more:", r["more"])
print("   credit line:", r["items"][0]["credit"])
call("/api/music?q=calm%20piano", T); call("/api/music?q=Calm%20%20Piano", T)
print("   library asked:", json.load(urllib.request.urlopen(B + "/__openverse_log")))
f = r["items"][0]["file"]
print("   fetch a track:", call("/api/music/file?url=" + urllib.parse.quote(f, safe=""), T, raw=True))
print("   fetch from a host not allowed:", call("/api/music/file?url=" + urllib.parse.quote("https://evil.example/a.mp3", safe=""), T))
print("   fetch something that isn't sound:", call("/api/music/file?url=" + urllib.parse.quote(f"{_W.URL}/__media/sky.jpg", safe=""), T))
print("   without signing in:", call("/api/music?q=x"))
print("   nothing found:", call("/api/music?q=nothing%20here", T))
