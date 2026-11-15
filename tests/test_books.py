import where as _W
import json
import urllib.request

B = f"{_W.URL}"


def call(path, data=None, token=None, method=None):
    req = urllib.request.Request(B + path, data=json.dumps(data).encode() if data is not None else None, method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))


T = call("/api/login", {"passcode": "letmein"})["token"]


def add(title, author=""):
    return call("/api/library/books", {"title": title, "author": author}, T)["books"][-1]["id"]


def find(book_id, data=None):
    lib = call(f"/api/library/books/{book_id}/text", data or {}, T)
    b = next(x for x in lib["books"] if x["id"] == book_id)
    print("  ", b["title"], "/", b.get("author") or "(no author)", "->", b.get("textTitle") or "no text", "|", b.get("textAuthor", ""), "|", b["textNote"][:62])


w = add("Walden", "Henry David Thoreau"); find(w)
c = add("The Alchemist", "Paulo Coelho"); find(c)
call(f"/api/library/books/{c}", None, T, "DELETE")
n = add("The Alchemist"); find(n); find(n, {"forget": True})
book = " ".join(open(f"{_W.MEDIA}/book.txt").read().split())
items = call("/api/asked", {"sources": [w], "count": 5}, T)["items"]
print("from text:", [(i.get("fromText"), i["text"] in book) for i in items])
