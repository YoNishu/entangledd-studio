import where as _W
import json, sys, urllib.request
B = f"{_W.URL}"
def call(path, data=None, token=None, method=None):
    req = urllib.request.Request(B + path, data=json.dumps(data).encode() if data is not None else None, method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))
T = call("/api/login", {"passcode": "letmein"})["token"]
print("empty, not connected:", {k: (v if k in ("measured","connected","followers","page","audience") else "…") for k, v in call("/api/insights?range=all", None, T).items() if k in ("measured","connected","followers","page","audience")})
call("/api/instagram/connect", {"token": "SHORT-" + "a" * 60}, T)
urllib.request.urlopen(B + "/__seed_insights")
for r in ["7", "30", "all"]:
    i = call(f"/api/insights?range={r}", None, T)
    t = i["totals"]
    print(f"--- range {r}: posts {t['posts']} reach {t['reach']} rate {t['rate']}% saves {t['saved']} watch {t['watch']}s skip {t['skip']}% | before:", i["before"] and i["before"]["posts"], "| measured", i["measured"])
    print("   followers:", i["followers"] and {k: i["followers"][k] for k in ("now", "change", "since")}, "| series", len(i["followers"]["series"]), "| page:", i["page"])
    print("   trend:", i["trend"]["by"], len(i["trend"]["bars"]), "| dims:", [(d["id"], len(d["groups"])) for d in i["dimensions"]])
i = call("/api/insights?range=all", None, T)
for d in i["dimensions"]:
    print("  ", d["name"], "->", [(g["name"], g["posts"], g["reach"], g["rate"]) for g in d["groups"][:4]])
print("standouts:"); [print("   ", s) for s in i["standouts"]]
print("times: enough", i["times"]["enough"], "| byPart", i["times"]["byPart"], "| byDay", i["times"]["byDay"][:3])
print("grid row Mon:", i["times"]["grid"][0])
print("rhythm:", i["rhythm"]["streak"], "week streak |", [w["posts"] for w in i["rhythm"]["weeks"]], "| since last", i["rhythm"]["sinceLast"], "| per week", i["rhythm"]["perWeek"])
print("audience:", i["audience"])
print("top post row:", i["posts"][0])
print("advice:", call("/api/insights/advice?range=all", None, T))
