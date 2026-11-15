import where as _W
import json, sys, urllib.request
B = f"{_W.URL}"
def call(path, data=None, token=None):
    req = urllib.request.Request(B + path, data=json.dumps(data).encode() if data is not None else None)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))
T = call("/api/login", {"passcode": "letmein"})["token"]
call("/api/instagram/connect", {"token": "SHORT-" + "a" * 60}, T)
urllib.request.urlopen(B + "/__seed_insights"); urllib.request.urlopen(B + "/__stale_numbers")
i = call("/api/insights?range=all", None, T)
reel = next(r for r in i["posts"] if r["kind"] == "reel" and r["reach"]); car = next((r for r in i["posts"] if r["kind"] == "carousel" and r["reach"]), None)
print(sys.argv[1], "| refreshed posts:", sum(1 for r in i["posts"] if r["reach"]), "of", len(i["posts"]), "| reel: reach", reel["reach"], "interactions", reel["interactions"], "watch", reel["watch"], "s, skip", reel["skip"], "| carousel:", car and (car["reach"], car["watch"]))
log = json.load(urllib.request.urlopen(B + "/__graph_log"))
asks = [e["params"].get("metric", "") for e in log if e["path"].endswith("/insights") and e["path"].startswith("/M")]
print("   requests for post numbers:", len(asks), "| distinct lists:", sorted({len(a.split(",")) for a in asks}))
