import where as _W
import json, time, urllib.request, urllib.parse, uuid
B = f"{_W.URL}"
def call(path, data=None, token=None, method=None):
    req = urllib.request.Request(B + path, data=json.dumps(data).encode() if data is not None else None, method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))
def outside(caption, ago=0, kind="REELS"): urllib.request.urlopen(f"{B}/__posted_in_instagram?caption={urllib.parse.quote(caption)}&ago={ago}&type={kind}")
T = call("/api/login", {"passcode": "letmein"})["token"]
call("/api/instagram/connect", {"token": "SHORT-" + "a" * 60}, T)
outside("an old reel from last week", ago=7*86400)                       # already on the page before anything was handed over
a, b = str(uuid.uuid4()), str(uuid.uuid4())
call("/api/handoffs", {"jobId": a, "quote": "the sea keeps no calendar", "caption": "for anyone who needed a slower day\n\n#quotes", "theme": "calm", "made": {"bg": "video", "bgFrom": "search", "bgWords": "ocean waves", "seconds": 8, "font": "lora"}}, T)
time.sleep(0.05)
h = call("/api/handoffs", {"jobId": b, "quote": "you are allowed to start again", "caption": "start again, as often as it takes", "theme": "growth"}, T)
print("handed over:", [x["quote"] for x in h["handoffs"]])
print("look now, nothing posted yet:", call("/api/handoffs/check", {}, T)["linked"], "| posts:", len(call("/api/posts", None, T)["posts"]))
outside("a photo post, not a reel", kind="FEED")
outside("Start again, as often as it takes 🌊 #growth")                   # the second one, posted first, caption pasted and tweaked
r = call("/api/handoffs/check", {}, T)
posts = call("/api/posts", None, T)["posts"]
print("after one reel posted in Instagram -> linked:", r["linked"], "| still waiting:", [x["quote"] for x in r["handoffs"]])
print("   post:", posts[0]["quote"], "| via", posts[0]["via"], "| music:", posts[0]["music"], "| link:", posts[0]["permalink"], "| reach:", (posts[0]["metrics"] or {}).get("reach"))
outside("no caption match at all")                                       # the first one, posted with a different caption
posts = call("/api/posts", None, T)["posts"]                             # just opening Posts is enough
print("after the other, on opening Posts:", [(p["quote"], p["via"]) for p in posts], "| waiting:", len(call("/api/handoffs", None, T)["handoffs"]))
i = call("/api/insights?range=all", None, T)
print("in Insights:", i["totals"]["posts"], "posts, reach", i["totals"]["reach"], "| a row:", {k: i["posts"][0][k] for k in ("quote", "background", "music", "watch")})
c = str(uuid.uuid4()); h = call("/api/handoffs", {"jobId": c, "quote": "never posted"}, T)["handoffs"]
print("\"I didn't post it\":", len(call("/api/handoffs/" + h[0]["id"], None, T, "DELETE")["handoffs"]), "left | old reel and photo never linked:", len(call("/api/posts", None, T)["posts"]) == 2)
