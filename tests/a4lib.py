"""Shared helpers for Agent 4's scorer tests. Server: the test server (restart with tests/serve)."""
import where as _W
import json, random, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

BASE = f"{_W.URL}"
IST = timezone(timedelta(hours=5, minutes=30))
FAILS = []

def serve(*settings):
    """A fresh server with empty storage. The machine is shared, so starting can be slow: wait, and try again if needed."""
    for attempt in range(4):
        subprocess.run([f"{_W.HERE}/serve", *settings], capture_output=True)
        for _ in range(60):
            try:
                urllib.request.urlopen(BASE + "/api/status", timeout=2).read()
                if call("GET", "/__keys?prefix=data/")[1] == []: return     # really fresh
                break
            except Exception:
                time.sleep(0.25)
    raise SystemExit("server did not start fresh")

def stop():
    subprocess.run([f"{_W.HERE}/stop"], capture_output=True)

def call(method, path, data=None, token=None, raw=None):
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if data is not None: req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text.strip() else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try: return e.code, json.loads(text)
        except Exception: return e.code, text

def login():
    status, out = call("POST", "/api/login", {"passcode": "letmein"})
    assert status == 200, out
    return out["token"]

def doc(name, value=None, delete=False, raw=None):
    if delete: return call("DELETE", f"/__doc?name={name}")
    if raw is not None: return call("PUT", f"/__doc?name={name}", raw=raw)
    if value is not None: return call("PUT", f"/__doc?name={name}", value)
    return call("GET", f"/__doc?name={name}")[1]

def run_job():
    """Runs the scorer's timed job the way Cloudflare would (one due job per five-minute tick)."""
    before = (doc("scorer/model") or {}).get("at", 0)
    for _ in range(10):
        # only the scorer's job is due: the other sections' jobs are stamped far in the future
        doc("jobstamps", {**{n: 9e15 for n in ("instagram-renew", "health-check", "lovenotes-deliveries", "upkeep", "backup", "cleanup", "probes")}, "scorer": 0})
        time.sleep(0.003)
        call("GET", "/__cron")
        m = doc("scorer/model")
        if m and m.get("at", 0) > before: return m
    raise AssertionError("the scorer's timed job never ran")

def check(name, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok: FAILS.append(name)
    return ok

def finish(title):
    print(("PASS" if not FAILS else "FAIL") + f": {title}" + (f" ({len(FAILS)} failed: {FAILS})" if FAILS else ""))
    stop()
    sys.exit(1 if FAILS else 0)

# ---------- made-up histories ----------
THEMES = ["love", "loss", "courage", "time", "self", "change", "hope", "sea", "home", "work"]
TONES = ["calm", "tender", "direct", "wry", "hopeful", "plain"]
KINDS = ["book", "film", "series", "classic"]
AUTHORS = ["ada north", "ben okri", "cy lake", "dee moss", "eli rain", "fay stone", "gus hale", "ivy pine", "jo wren", "kit vale", "lou marsh", "mo reed"]

def day_str(days_ago):
    return (datetime.now(IST) - timedelta(days=days_ago)).strftime("%Y-%m-%d")

def shift(date, days):
    """A date string moved forward by a number of days."""
    return (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")

def noon_ms(date):
    return int(datetime.strptime(date + " 12:00 +0530", "%Y-%m-%d %H:%M %z").timestamp() * 1000)

def candidate(rng):
    return {"th": rng.choice(THEMES), "to": rng.choice(TONES), "k": rng.choice(KINDS), "w": "", "a": rng.choice(AUTHORS),
            "n": rng.choice([7, 18, 32]), "v": "plain", "c": rng.choice([0, 1])}

def likes_calm_short(c, rng):   # a clear taste: calm and short, with a little whim
    return 2.0 * (c["to"] == "calm") + 1.5 * (c["n"] <= 10) + rng.gauss(0, 0.5)

def likes_direct_long(c, rng):  # the opposite taste
    return 2.0 * (c["to"] == "direct") + 1.5 * (c["n"] > 25) - 1.5 * (c["to"] == "calm") + rng.gauss(0, 0.5)

def at_random(c, rng):
    return rng.random()

def history(first_days_ago, last_days_ago, taste, seed=1, picks_per_day=1, tag="d"):
    """Rows for the scorer's record: five suggestions a day, of which she picks the one(s) she likes most."""
    rng = random.Random(seed)
    rows = []
    for ago in range(first_days_ago, last_days_ago - 1, -1):
        date = day_str(ago)
        five = [candidate(rng) for _ in range(5)]
        ranked = sorted(range(5), key=lambda i: -taste(five[i], rng))
        chosen = set(ranked[:picks_per_day])
        for i, c in enumerate(five):
            rid = f"{tag}{ago}-{i}"
            rows.append({"i": rid, "g": date, "t": noon_ms(date), "s": 1 if i in chosen else 0, "u": 0, "x": "k" + rid, **c})
    return rows

def put_log(rows, **extra):
    doc("scorer/log", {"v": 1, "rows": rows, "fold": None, "histAt": 0, "postsAt": 0, "since": 0, "back": "done", "backTo": "", **extra})

WORDS = "quiet water keeps its own slow counsel under every passing weather and leaves the hurried shore to argue with itself about what the tide has taken and what it means to stay when staying costs".split()
def quote(tag, tone, n_words, theme, author, kind="classic", title="", verify=False):
    """A candidate for the pretend Claude. The pool adds a number to each text, which counts as one word."""
    body = " ".join(WORDS[: max(1, n_words - 2)])
    return {"text": f"{tag} {body}", "author": author, "source": {"type": kind, "title": title}, "theme": theme, "tone": tone, "verify": verify}
def pool_calm_short_late():
    """Ten candidates in 'Claude's order': the four she would like (calm and short) come 6th to 9th."""
    return [
        quote("Q1", "direct", 30, "work", "Author One"), quote("Q2", "wry", 30, "change", "Author Two"),
        quote("Q3", "direct", 18, "loss", "Author Three"), quote("Q4", "plain", 30, "time", "Author Four"),
        quote("Q5", "tender", 18, "home", "Author Five"), quote("Q6", "calm", 7, "sea", "Author Six"),
        quote("Q7", "calm", 7, "hope", "Author Seven"), quote("Q8", "calm", 7, "love", "Author Eight"),
        quote("Q9", "calm", 7, "self", "Author Nine"), quote("Q10", "hopeful", 18, "courage", "Author Ten"),
    ]
tags = lambda items: [i["text"].split()[0] for i in items]
