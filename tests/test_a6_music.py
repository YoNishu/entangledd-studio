"""A post's Instagram song always reads as words: never "[object Object]", whatever shape the record holds it in."""
import json, urllib.request
from a3lib import *

serve()
T = login(); connect(T)
http("GET", "/__seed_insights")                       # these pretend posts hold the song as {id, title}
posts = doc("posts")
check("the seeded record really holds a song as an object", any(isinstance(p.get("music"), dict) for p in posts))
posts[0]["music"] = "Paper Boats"                    # the shape the app itself writes: plain text
posts[1]["music"] = {"id": "A9"}                     # an object with no title at all
putdoc("posts", posts)

s, ins, _ = http("GET", "/api/insights?range=all", token=T)
rows = ins["posts"]
check("insights answers", s == 200 and len(rows) >= 10)
check("no row says [object Object]", "[object Object]" not in json.dumps(ins), [r["music"] for r in rows][:4])
with_song = [r["music"] for r in rows if r["music"].startswith("Instagram: ")]
check("a song kept as an object shows its title", "Instagram: Slow Tide" in with_song, with_song[:3])
check("a song kept as text is unchanged", "Instagram: Paper Boats" in with_song, with_song[:3])
check("a song with no title still reads as words", "Instagram: a song" in with_song, with_song[:3])

s, out, _ = http("GET", "/api/posts", token=T)
names = [p["music"] for p in out["posts"]]
check("the Posts list gets the song as text or nothing", all(m is None or isinstance(m, str) for m in names) and "Slow Tide" in names, names[:5])
check("nothing in the Posts answer says [object Object]", "[object Object]" not in json.dumps(out))

# What Nishiii is told about her posts (the chat tool and the taste update) carries the name too.
s, chat, _ = http("POST", "/api/chat", {"messages": [{"role": "user", "content": "how did my posts do?"}]}, T)
check("the chat reply has no [object Object]", s == 200 and "[object Object]" not in json.dumps(chat), chat)
s, taste, _ = http("POST", "/api/taste/refresh", token=T)
check("the taste update still works with such posts", s == 200 and taste.get("profile"), s)
sent = json.dumps(http("GET", "/__notes_claude_log")[1])
check("nothing sent to Claude says [object Object]", "[object Object]" not in sent)
check("Claude was told the song by name", "Slow Tide" in sent)
finish()
