import where as _W
import json, sys, urllib.request
B = f"{_W.URL}"
def call(path, data=None, token=None, method=None):
    req = urllib.request.Request(B + path, data=json.dumps(data).encode() if data is not None else None, method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))
T = call("/api/login", {"passcode": "letmein"})["token"]
mode = sys.argv[1]
if mode == "old":
    urllib.request.urlopen(B + "/__seed_old_taste")
    t = call("/api/taste", None, T)
    print("old profile, on first open:", t["profile"]["summary"][:60], "| marked:", t["profile"].get("saidTo"), "| notes kept:", [n["text"] for n in t["notes"]])
else:
    call("/api/taste/notes", {"text": "I love lines about the sea"}, T)
    t = call("/api/taste/refresh", {}, T)
    print(f"[{mode}] profile:", t["profile"]["summary"][:60], "| marked:", t["profile"].get("saidTo"))
    urllib.request.urlopen(B + "/__seed_posts")
    print(f"[{mode}] weekly note:", call("/api/report", None, T)["note"])
