"""A reel waiting in the app that she posted from Instagram herself: one tap moves it to Posted; when the app
can see the page again, the real reel is linked to it."""
from a3lib import *
import time, urllib.parse
serve()
T = login(); connect(T)
now = int(time.time() * 1000)
job = "11111111-1111-4111-8111-111111111111"
putdoc("queue", [{"id": "q1", "jobId": job, "created": now - 3600000, "quote": "It is our choices that show what we truly are.", "author": "", "theme": "choice", "tone": "calm", "source": "film", "suggestionId": "", "made": {}}])
s, b, _ = http("POST", "/api/queue/q1/posted", {}, T)
check("the tap is accepted", s == 200, (s, b))
posts = doc("posts")
check("it is in Posted, marked as posted by hand, with no Instagram link yet", len(posts) == 1 and posts[0]["byHand"] and posts[0]["state"] == "published" and posts[0]["mediaId"] == "", posts)
check("and gone from the waiting list", doc("queue") == [])
s, b, _ = http("GET", "/api/posts", None, T)
mine = [p for p in b["posts"] if p["quote"].startswith("It is our choices")]
check("the app shows it as posted, link still to come", s == 200 and mine and mine[0]["state"] == "published" and mine[0]["unlinked"] is True, b)
# she posted it in Instagram: the reel appears on the page; the app finds it
http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote("It is our choices that show what we truly are. #quotes") + "&ago=60&type=REELS")
s, b, _ = http("POST", "/api/handoffs/check", {}, T)
posts = doc("posts")
check("the real reel is linked to the same post, not added twice", len(posts) == 1 and posts[0]["mediaId"] and posts[0]["permalink"], (b, posts))
s, b, _ = http("POST", "/api/queue/nope/posted", {}, T)
check("an unknown reel is refused", s == 404, s)
s, b, _ = http("POST", "/api/queue/q1/posted", {})
check("signed out is refused", s == 401, s)

# ---- no tap at all: a reel only waiting in the app, posted from Instagram, is found by itself when Posts opens
serve()
T = login(); connect(T)
putdoc("queue", [{"id": "q2", "jobId": "22222222-2222-4222-8222-222222222222", "created": int(time.time() * 1000) - 3600000, "quote": "Happiness can be found even in the darkest of times.", "author": "", "theme": "hope", "tone": "warm", "source": "film", "suggestionId": "", "made": {}}])
s, b, _ = http("GET", "/api/queue", None, T)
check("the app says it can see Instagram, so no tap is asked for", s == 200 and b["sees"] is True and len(b["queue"]) == 1, b)
http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote("some caption of her own, no quote in it") + "&ago=120&type=REELS")
s, b, _ = http("GET", "/api/posts", None, T)
mine = [p for p in b["posts"] if p["quote"].startswith("Happiness can be found")]
check("one waiting reel and a reel on the page with other words: not assumed to be it", s == 200 and not mine and len(http("GET", "/api/queue", None, T)[1]["queue"]) == 1, b)
http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote("Happiness can be found even in the darkest of times. #quotes") + "&ago=30&type=REELS")
s, b, _ = http("GET", "/api/posts", None, T)
mine = [p for p in b["posts"] if p["quote"].startswith("Happiness can be found")]
check("with its words in the caption, opening Posts finds the reel and moves it to Posted, linked", s == 200 and len(mine) == 1 and mine[0]["state"] == "published" and mine[0]["permalink"] and not mine[0]["unlinked"], b)
check("and it has left the waiting list", http("GET", "/api/queue", None, T)[1]["queue"] == [])
# two reels waiting and a reel on the page with neither quote in its caption: not guessed
serve()
T = login(); connect(T)
putdoc("queue", [{"id": "a", "jobId": "33333333-3333-4333-8333-333333333333", "created": int(time.time() * 1000) - 3600000, "quote": "First waiting line of some length here.", "author": "", "theme": "", "tone": "", "source": "", "suggestionId": "", "made": {}},
                 {"id": "b", "jobId": "44444444-4444-4444-8444-444444444444", "created": int(time.time() * 1000) - 3000000, "quote": "Second waiting line, also long enough.", "author": "", "theme": "", "tone": "", "source": "", "suggestionId": "", "made": {}}])
http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote("nothing to go by") + "&ago=60&type=REELS")
http("GET", "/api/posts", None, T)
check("two waiting and nothing to tell them apart: neither is guessed", len(http("GET", "/api/queue", None, T)[1]["queue"]) == 2)
http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote("Second waiting line, also long enough. #quotes") + "&ago=30&type=REELS")
http("GET", "/api/posts", None, T)
q = http("GET", "/api/queue", None, T)[1]["queue"]
check("with the quote in the caption, the right one is linked", [x["id"] for x in q] == ["a"], q)
# a reel kept under "Made, not posted" (not waiting, not handed over), posted from Instagram: found by its words
serve()
T = login(); connect(T)
mj = "55555555-5555-4555-8555-555555555555"
putdoc("made", [{"id": "m1", "jobId": mj, "made": int(time.time() * 1000) - 7200000, "snap": {}, "about": {"quote": "A kept line she made last week and posted later.", "author": "", "theme": "", "tone": "", "source": "own", "suggestionId": "", "made": None}},
                {"id": "m2", "jobId": "66666666-6666-4666-8666-666666666666", "made": int(time.time() * 1000) - 9200000, "snap": {}, "about": {"quote": "Another kept line that stays where it is.", "author": "", "theme": "", "tone": "", "source": "own", "suggestionId": "", "made": None}}])
http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote("A kept line she made last week and posted later. #love") + "&ago=60&type=REELS")
s, b, _ = http("GET", "/api/posts", None, T)
got = [p for p in doc("posts") if p.get("jobId") == mj]
check("a made, not posted reel is found on Instagram and moved to Posted", len(got) == 1 and got[0]["mediaId"] and got[0]["quote"].startswith("A kept line she made"), doc("posts"))
check("the other kept reel is left alone", not [p for p in doc("posts") if p.get("jobId", "").startswith("6666")])
finish()
