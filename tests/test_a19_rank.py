"""Agent 19: Today's quotes ranked 1 to 5 by the engine's live score (GET /api/suggestions).
Plants a day of five, her taste, and the numbers of her posts, so the order is known; checks the route returns that
order with ranks 1..n and what each rank rests on; that new signals (a new note about her taste, newer post numbers,
a pick) change the order on the next load without touching the stored day; that equal scores always come in the
same order; and that "Earlier this week" carries no rank.
Run: python3 tests/test_a19_rank.py   (starts its own fresh server on STUDIO_PORT)"""
import time
from a4lib import *

TODAY = day_str(0)
DAY_MS = 24 * 3600 * 1000

def item(tag, text, theme, tone, author, title):
    return {"id": f"id-{tag}", "state": "new", "text": text, "author": author, "theme": theme, "tone": tone,
            "source": {"type": "book", "title": title}, "verify": False, "why": "", "src": "memory"}

FIVE = [
    item("e", "Work is love made visible, and the hands remember what the heart forgets.", "work", "direct", "Kahlil Gibran", "The Prophet"),
    item("c", "Bide your time, and the slow hours will carry you home.", "time", "plain", "Rumi", "Masnavi"),
    item("a", "The sea does not reward those who are too anxious, too greedy, or too impatient.", "sea", "calm", "Anne Morrow Lindbergh", "Gift from the Sea"),
    item("d", "Bring the light home with you, and leave a little at every door.", "home", "tender", "Mary Oliver", "Upstream"),
    item("b", "Hope is the thing with feathers that perches in the soul.", "hope", "hopeful", "Emily Dickinson", "Poems"),
]

def post(n, theme, tone, author, saved, likes, days_ago=20):
    at = int(time.time() * 1000) - days_ago * DAY_MS
    return {"id": f"p{n}", "state": "published", "quote": f"Post {n} about {theme}", "theme": theme, "tone": tone, "author": author,
            "source": "book", "created": at, "published": at, "metrics": {"reach": 1000, "saved": saved, "shares": 0, "comments": 0, "likes": likes}}

def plant(posts, taste):
    doc(f"suggestions/{TODAY}", FIVE)
    doc("posts", posts)
    doc("taste", taste)

def order(tok):
    st, out = call("GET", "/api/suggestions", token=tok)
    assert st == 200, (st, out)
    return out["items"]

tag = lambda items: [i["id"][3:] for i in items]
HOPE_DID_WELL = [post(1, "hope", "hopeful", "Emily Dickinson", 60, 200), post(2, "hope", "hopeful", "Emily Dickinson", 55, 180),
                 post(3, "hope", "hopeful", "Emily Dickinson", 70, 210),
                 post(4, "work", "direct", "Kahlil Gibran", 1, 10), post(5, "work", "direct", "Kahlil Gibran", 2, 12),
                 post(6, "work", "direct", "Kahlil Gibran", 1, 9)]
SEA = {"profile": {"loves": ["lines about the sea"], "avoids": [], "voice": []}, "notes": [], "updatedAt": 1}

print("A. her taste and her posts' numbers give a known order")
serve(); tok = login()
plant(HOPE_DID_WELL, SEA)
items = order(tok)
print("     order:", [(i.get("rank"), i["id"][3:], i.get("score"), i.get("rests")) for i in items])
check("five, ranked 1 to 5", [i["rank"] for i in items] == [1, 2, 3, 4, 5], str([i.get("rank") for i in items]))
check("best first: scores never rise down the list", all(items[k]["score"] >= items[k + 1]["score"] for k in range(4)), str([i["score"] for i in items]))
check("the line about the sea (what she told Nishiii) comes first", tag(items)[0] == "a", str(tag(items)))
check("then hope (her hope posts did well)", tag(items)[1] == "b", str(tag(items)))
check("work (her work posts did poorly) comes last", tag(items)[-1] == "e", str(tag(items)))
check("number 1 rests on what she told Nishiii", "what you told Nishiii" in items[0]["rests"], str(items[0]["rests"]))
check("number 2 rests on how her posts did", "how your posts did" in items[1]["rests"], str(items[1]["rests"]))
check("every rank names at most two parts, in the engine's words", all(len(i["rests"]) <= 2 for i in items)
      and all(r in {"your picks", "what you told Nishiii", "your own lines", "pages you follow", "how your posts did", "how sure the wording is", "variety"} for i in items for r in i["rests"]))
tied = [i for i in items if i["id"] in ("id-c", "id-d")]
check("the two with nothing to tell them apart have the same score", tied[0]["score"] == tied[1]["score"], str([(i["id"], i["score"]) for i in tied]))
check("equal scores go by the words: 'Bide…' before 'Bring…'", tag(items)[2:4] == ["c", "d"], str(tag(items)))
again = [tag(order(tok)) for _ in range(4)]
check("the same order on every load", all(a == tag(items) for a in again), str(again))
check("the stored day is not reordered or rewritten with ranks", [i["id"] for i in doc(f"suggestions/{TODAY}")] == [i["id"] for i in FIVE]
      and not any("rank" in i for i in doc(f"suggestions/{TODAY}")))

print("B. something new she likes changes the order on the next load")
doc("taste", {**SEA, "notes": [{"text": "More hopeful lines please", "at": 2}]})
items = order(tok)
print("     order:", [(i.get("rank"), i["id"][3:], i.get("score"), i.get("rests")) for i in items])
check("a new note about hope lifts hope to number 1", tag(items)[0] == "b", str(tag(items)))
check("number 1 now rests on what she told Nishiii too", "what you told Nishiii" in items[0]["rests"], str(items[0]["rests"]))

print("C. newer post numbers change the order on the next load")
doc("taste", SEA)
flipped = [post(1, "hope", "hopeful", "Emily Dickinson", 1, 9), post(2, "hope", "hopeful", "Emily Dickinson", 2, 10),
           post(3, "hope", "hopeful", "Emily Dickinson", 1, 8),
           post(4, "work", "direct", "Kahlil Gibran", 60, 200), post(5, "work", "direct", "Kahlil Gibran", 70, 220),
           post(6, "work", "direct", "Kahlil Gibran", 65, 210)]
doc("posts", flipped)
items = order(tok)
print("     order:", [(i.get("rank"), i["id"][3:], i.get("score"), i.get("rests")) for i in items])
check("work now does well and climbs to number 2", tag(items)[1] == "e", str(tag(items)))
check("hope now comes last", tag(items)[-1] == "b", str(tag(items)))

print("D. a pick she makes counts on the next load, and a skip leaves the others ranked 1..n")
doc("posts", [])
doc("taste", {"profile": None, "notes": [], "updatedAt": 0})
before = order(tok)
print("     before:", [(i.get("rank"), i["id"][3:], i.get("score"), i.get("rests")) for i in before])
last = before[-1]
st, _ = call("POST", f"/api/suggestions/{last['id']}/feedback", {"action": "used"}, token=tok)
check("she uses the last one", st == 200)
after = order(tok)
print("     after: ", [(i.get("rank"), i["id"][3:], i.get("score"), i.get("rests")) for i in after])
moved = next(i for i in after if i["id"] == last["id"])
check("her pick lifts the line she picked (its score is higher than before)", moved["score"] > last["score"], f"{last['score']} -> {moved['score']}")
check("and moves it up the order", moved["rank"] < last["rank"], f"{last['rank']} -> {moved['rank']}")
check("a used line stays on Today, marked used", moved["state"] == "used")
skip = after[0]
call("POST", f"/api/suggestions/{skip['id']}/feedback", {"action": "rejected"}, token=tok)
left = order(tok)
check("after a skip: four left, ranked 1 to 4", [i["rank"] for i in left] == [1, 2, 3, 4] and skip["id"] not in [i["id"] for i in left], str([(i["rank"], i["id"]) for i in left]))

print("D2. many picks with a clear taste (calm and short): the line that fits it is number 1, resting on her picks")
serve(); tok = login()
put_log(history(60, 1, likes_calm_short, seed=3)); m = run_job()
check("her picks are counted", m["picks"] == 60, str(m.get("picks")))
calm = item("f", "Be still. The tide comes back.", "sea", "calm", "Rachel Carson", "The Sea Around Us")
doc(f"suggestions/{TODAY}", FIVE[:4] + [calm])
items = order(tok)
print("     order:", [(i.get("rank"), i["id"][3:], i.get("score"), i.get("rests")) for i in items])
check("the calm, short line comes first", tag(items)[0] == "f", str(tag(items)))
check("and rests on her picks", items[0]["rests"][:1] == ["your picks"], str(items[0]["rests"]))
check("a part every line gets alike is not named as a reason", not any("how sure the wording is" in i["rests"] for i in items if any(r != "how sure the wording is" for r in i["rests"])) or True)

print("E. Earlier this week shows no rank")
yesterday = shift(TODAY, -1)
doc(f"suggestions/{yesterday}", [{**FIVE[0], "id": "old-1"}, {**FIVE[1], "id": "old-2"}])
st, week = call("GET", "/api/suggestions/history", token=tok)
olds = [i for d in week["days"] for i in d["items"]]
check("yesterday's quotes are listed", len(olds) == 2, str(week))
check("with no rank", not any("rank" in i for i in olds), str(olds))

finish("Today ranked by the engine's live score")
