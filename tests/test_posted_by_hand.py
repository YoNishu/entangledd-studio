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
finish()
