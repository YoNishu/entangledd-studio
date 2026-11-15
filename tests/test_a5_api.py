"""Little notes from Nishiii: the server side.
Sign-in, limits, taking turns (the shuffle bag), a note's own day and its markers, 29 February,
what the phone's date may decide, and privacy. Starts its own fresh servers.
Run: python3 tests/test_a5_api.py"""
import json
from a5lib import ok, finish, serve, raw, call, login, add, day, nxt

# ---------------- signed out ----------------
print("signed out")
serve()
for method, path in [("GET", "/api/lovenotes"), ("GET", "/api/lovenotes/next?today=2026-08-20"), ("POST", "/api/lovenotes"),
                     ("PUT", "/api/lovenotes/abc"), ("DELETE", "/api/lovenotes/abc")]:
    status, out = call(method, path, {"text": "x"} if method in ("POST", "PUT") else None)
    ok(status == 401, f"{method} {path} needs sign-in", status)
status, out = call("GET", "/api/lovenotes", token="wrong-token")
ok(status == 401, "a wrong sign-in is refused too", status)

# ---------------- nothing stored ----------------
print("nothing stored")
T = login()
day("2026-08-20")
status, out = nxt(T, "2026-08-20")
ok(status == 200 and out == {}, "no notes: next answers with nothing", out)
status, out = call("GET", "/api/lovenotes", token=T)
ok(status == 200 and out["notes"] == [] and out["max"] == 60 and out["maxLength"] == 280, "the list is empty and states its limits", out)

# ---------------- what may be stored ----------------
print("limits and checks")
status, out = call("POST", "/api/lovenotes", {}, T)
ok(status == 400 and "Write the note" in out["error"], "an empty note is refused in plain words", out)
status, out = call("POST", "/api/lovenotes", {"text": "   \n  "}, T)
ok(status == 400, "a note of only spaces is refused", out)
status, out = raw("POST", "/api/lovenotes", token=T, body=b"{not json")
ok(status == 400, "a body that isn't JSON is refused", status)
status, out = call("POST", "/api/lovenotes", {"text": "x" * 281}, T)
ok(status == 400 and "280" in out["error"] and "281" in out["error"], "281 characters is refused, saying both numbers", out)
status, out = call("POST", "/api/lovenotes", {"text": "y" * 280}, T)
ok(status == 200, "exactly 280 characters is fine", out)
long_id = out["note"]["id"]
for bad in ["2020-02-30", "03/03/2020", "2020-3-3", "1850-01-01", "next week"]:
    status, out = call("POST", "/api/lovenotes", {"text": "dated " + bad, "date": bad}, T)
    ok(status == 400 and "date" in out["error"], f"the date {bad!r} is refused", out)
status, out = call("POST", "/api/lovenotes", {"text": "  We met   at the\n bakery.  ", "date": "2020-03-03"}, T)
ok(status == 200 and out["note"]["text"] == "We met at the bakery." and out["note"]["date"] == "2020-03-03", "spaces are tidied, the date is kept", out)
bakery = out["note"]["id"]
status, out = call("POST", "/api/lovenotes", {"text": "We met at the bakery."}, T)
ok(status == 400 and "already" in out["error"], "the same words twice are refused", out)
status, out = call("PUT", "/api/lovenotes/" + bakery, {"text": "We met at the old bakery.", "date": ""}, T)
ok(status == 200 and out["note"] == {"id": bakery, "text": "We met at the old bakery.", "date": ""}, "a note can be changed and its date taken off", out)
status, out = call("PUT", "/api/lovenotes/" + bakery, {"text": "y" * 280}, T)
ok(status == 400 and "already" in out["error"], "changing a note into a copy of another is refused", out)
status, out = call("PUT", "/api/lovenotes/" + bakery, {"text": "We met at the old bakery."}, T)
ok(status == 200, "saving a note unchanged is fine", out)
status, out = call("PUT", "/api/lovenotes/nope", {"text": "x"}, T)
ok(status == 404, "changing a note that isn't there: 404", status)
status, out = call("DELETE", "/api/lovenotes/nope", token=T)
ok(status == 404, "removing a note that isn't there: 404", status)
status, out = call("DELETE", "/api/lovenotes/" + long_id, token=T)
ok(status == 200 and [n["id"] for n in out["notes"]] == [bakery], "a note can be removed", out)
for path, method in [("/api/lovenotes/a/b", "GET"), ("/api/lovenotes/next", "POST"), ("/api/lovenotes", "PATCH")]:
    status, out = call(method, path, {"text": "x"} if method != "GET" else None, T)
    ok(status == 404, f"{method} {path}: 404", status)
for i in range(59):
    add(T, f"filler number {i}")
status, out = call("GET", "/api/lovenotes", token=T)
ok(len(out["notes"]) == 60, "60 notes fit", len(out["notes"]))
status, out = call("POST", "/api/lovenotes", {"text": "one too many"}, T)
ok(status == 400 and "60" in out["error"], "the 61st is refused, saying why", out)

# ---------------- taking turns ----------------
print("taking turns")
def run(n_notes, calls):
    serve(); t = login(); day("2026-08-20")
    texts = [f"ordinary note {i}" for i in range(n_notes)]
    for x in texts: add(t, x)
    seq = []
    for _ in range(calls):
        status, out = nxt(t, "2026-08-20")
        assert status == 200, (status, out)
        seq.append(out)
    return texts, seq

texts, seq = run(7, 70)
rounds = [seq[i:i + 7] for i in range(0, 70, 7)]
ok(all(sorted(n["text"] for n in r) == sorted(texts) for r in rounds), "7 notes, 10 rounds: every round shows each note exactly once")
ok(all(rounds[i][0]["id"] != rounds[i - 1][-1]["id"] for i in range(1, 10)), "no round opens with the note that closed the one before")
ok(all(seq[i]["then"] == seq[i + 1]["text"] for i in range(69)), "each answer names the note the next opening will show")
ok(all(n["marker"] == "" and n["soon"] == [] for n in seq), "ordinary day: no marker, nothing special coming")
ok(len({tuple(n["text"] for n in r) for r in rounds}) > 1, "the order differs from round to round")
texts, seq = run(3, 60)
ok(all(seq[i]["id"] != seq[i + 1]["id"] for i in range(59)), "3 notes, 60 openings: the same note never comes twice in a row")
ok(all(len({n["id"] for n in seq[i:i + 3]}) == 3 for i in range(0, 60, 3)), "3 notes: each round of three is complete")
texts, seq = run(2, 20)
ok(all(seq[i]["id"] != seq[i + 1]["id"] for i in range(19)), "2 notes simply alternate")
texts, seq = run(1, 4)
ok(all(n["text"] == texts[0] and n["then"] == texts[0] for n in seq), "a single note is shown every time")

print("adding and removing in the middle of a round")
serve(); T = login(); day("2026-08-20")
ids = {add(T, f"round note {i}"): f"round note {i}" for i in range(5)}
first = [nxt(T, "2026-08-20")[1] for _ in range(3)]
late = add(T, "the late arrival")
rest = [nxt(T, "2026-08-20")[1] for _ in range(3)]
ok(len({n["id"] for n in first + rest}) == 6 and late in [n["id"] for n in rest], "a note added mid-round is shown within that round, with no repeats")
status, out = nxt(T, "2026-08-20")
lined_up = [i for i, t in {**ids, late: "the late arrival"}.items() if t == out["then"]][0]
call("DELETE", "/api/lovenotes/" + lined_up, token=T)
after = [nxt(T, "2026-08-20")[1] for _ in range(12)]
ok(all(n["id"] != lined_up for n in after), "a removed note never comes up again, even if it was next in line")
ok(all(after[i]["then"] == after[i + 1]["text"] for i in range(11)), "the line-up stays truthful after a removal")

# ---------------- a note's own day ----------------
print("a note's own day")
serve(); T = login(); day("2026-11-14")
A = add(T, "The first time we talked.", "2025-11-14")
Bn = add(T, "The day this app arrived.", "2026-11-14")
F = add(T, "Something still to come.", "2030-11-14")
G = add(T, "A summer day.", "2026-06-21")
plain = [add(T, f"an everyday note {i}") for i in range(4)]
seq = [nxt(T, "2026-11-14")[1] for _ in range(6)]
ok([n["id"] for n in seq] == [A, Bn, A, Bn, A, Bn], "on their day the two notes take turns, the older memory first", [n["text"] for n in seq])
ok([n["marker"] for n in seq[:2]] == ["1 year ago today", "Today"], "markers: '1 year ago today' and 'Today'", [n["marker"] for n in seq[:2]])
ok(seq[0]["soon"] == [{"day": "2026-11-14", "text": "The day this app arrived.", "marker": "Today"}], "the answer says what a later opening today will show", seq[0]["soon"])
# (Any note but the one just shown can be next in line: the draw is random over the whole round, so the other
# note of the day is a fair answer too. Leaving it out made this check fail about one run in seven.)
ok(seq[0]["then"] in [f"an everyday note {i}" for i in range(4)] + ["Something still to come.", "A summer day.", "The day this app arrived."], "and what an ordinary day would show next", seq[0]["then"])
status, out = nxt(T, "2026-11-13")
ok(out["marker"] == "" and out["id"] not in (A, Bn), "the phone's own date decides: a phone still on the 13th gets an everyday note", out)
ok(out["soon"] and out["soon"][0]["day"] == "2026-11-14", "and is told that tomorrow is a note's own day", out["soon"])
status, out = nxt(T, "2026-06-21")
ok(out["id"] in (A, Bn), "a phone whose date is months off is not believed: the server's day is used", out)
status, out = nxt(T)
ok(status == 200 and out["id"] in (A, Bn), "with no date sent, the server's day in India is used", out)
status, out = nxt(T, "")
ok(status == 200 and out["id"] in (A, Bn), "an empty date counts as none", out)
for bad in ["14-11-2026", "2026-02-30", "2026-13-01", "today", "20261114"]:
    status, out = nxt(T, bad)
    ok(status == 400 and "date" in out["error"], f"today={bad!r} is refused", (status, out))

day("2026-11-15")
status, out = nxt(T, "2026-11-15")
ok(out["marker"] == "" and out["id"] not in (A, Bn), "the next day the ordinary turns go on", out)

day("2027-11-14")
seq = [nxt(T, "2027-11-14")[1] for _ in range(2)]
ok([(n["id"], n["marker"]) for n in seq] == [(A, "2 years ago today"), (Bn, "1 year ago today")], "a year on: '2 years ago today' and '1 year ago today'", [(n["text"], n["marker"]) for n in seq])
day("2030-11-14")
seq = [nxt(T, "2030-11-14")[1] for _ in range(4)]
ok([(n["id"], n["marker"]) for n in seq] == [(A, "5 years ago today"), (Bn, "4 years ago today"), (F, "Today"), (A, "5 years ago today")],
   "a note about a day still to come waits for its year, then joins the turns", [(n["text"], n["marker"]) for n in seq])
day("2029-11-14")
seq = [nxt(T, "2029-11-14")[1] for _ in range(3)]
ok(F not in [n["id"] for n in seq], "before its year, that note is not treated as special")

print("after a note's own day")
for attempt in range(8):                      # the order is random, so the same promise is checked several times over
    serve(); T = login(); day("2026-11-14")
    special = add(T, "Our day.", "2025-11-14")
    everyday = {add(T, f"an everyday note {i}") for i in range(5)}
    first = nxt(T, "2026-11-14")[1]
    day("2026-11-15")
    seq = [nxt(T, "2026-11-15")[1] for _ in range(5)]
    good = first["id"] == special and {n["id"] for n in seq} == everyday
    if not good: break
ok(good, "a note shown once on its own day waits a whole round before it comes again (8 fresh runs)", [n["text"] for n in seq])
status, out = nxt(T, "2026-11-15")
ok(out["id"] != seq[-1]["id"], "and the round after that opens with a different note than the last one")

print("29 February")
serve(); T = login()
L = add(T, "The leap day we will never forget.", "2024-02-29")
for i in range(3): add(T, f"an everyday note {i}")
def on(d):
    day(d); return nxt(T, d)[1]
out = on("2025-02-28"); ok(out["id"] == L and out["marker"] == "1 year ago today", "in a year without a 29th, the note keeps its day on 28 February", out)
out = on("2025-03-01"); ok(out["id"] != L or out["marker"] == "", "and not on 1 March", out)
out = on("2028-02-28"); ok(out["marker"] == "", "in a leap year the 28th is an ordinary day", out)
out = on("2028-02-29"); ok(out["id"] == L and out["marker"] == "4 years ago today", "and the 29th is its day: '4 years ago today'", out)
out = on("2024-02-29"); ok(out["id"] == L and out["marker"] == "Today", "on the day itself: 'Today'", out)

# ---------------- privacy ----------------
print("privacy")
serve(); T = login(); day("2026-08-20")
secret_words = ["zebrafinch lullaby", "marmalade lighthouse", "quokka umbrella"]
for w in secret_words: add(T, f"Our private memory about the {w}.", "2021-05-05" if w.startswith("z") else None)
nxt(T, "2026-08-20")
status, key_text = raw("GET", "/api/seal-key")
key = json.loads(key_text)
ok(status == 200 and sorted(key) == ["check", "deliveries", "groups", "key"], "the open key address returns only the public key, its check and counts", sorted(key))
status, keydoc = call("GET", "/__doc?name=sealkey")
private = keydoc["privateJwk"]["d"]
ok(len(private) > 30, "(the test can see the private half through the test hook)")
open_answers = [raw("GET", "/api/seal-key")[1], raw("GET", "/api/status")[1], raw("GET", "/api/health")[1], raw("GET", "/api/lovenotes")[1]]
ok(all(not any(w in a for w in secret_words) for a in open_answers), "no note appears in anything a signed-out visitor can fetch")
signed = [raw("GET", "/api/lovenotes", token=T)[1], raw("GET", "/api/lovenotes/next?today=2026-08-20", token=T)[1], key_text]
ok(all(private not in a for a in signed + open_answers), "the private half of the key is in no answer, signed in or not")
status, keys = call("GET", "/__keys?prefix=")
holders = [k for k in keys if k.endswith(".json") and private in raw("GET", "/__doc?name=" + k[len("data/"):-len(".json")])[1]] if all(k.startswith("data/") for k in keys) else ["(unexpected keys)"]
ok(holders == ["data/sealkey.json"], "in storage, the private half sits only in its own document", holders)
note_docs = [k for k in keys if any(w in raw("GET", "/__doc?name=" + k[len("data/"):-len(".json")])[1] for w in secret_words)]
ok(note_docs == ["data/lovenotes.json"], "and the notes sit only in theirs", note_docs)

# Everything that talks to Claude, run with the notes in place: none of it may carry a note.
raw("GET", "/api/suggestions", token=T)
raw("POST", "/api/chat", {"messages": [{"role": "user", "content": "What do you know about me? Tell me everything you can see."}]}, T)
raw("POST", "/api/taste/refresh", {}, T)
raw("POST", "/api/caption", {"quote": "the sea keeps no calendar", "author": ""}, T)
raw("GET", "/__cron?cron=30%200%20*%20*%20*")
raw("GET", "/__cron")
status, sent = call("GET", "/__notes_claude_log")
ok(len(sent) >= 3, f"(Claude was really called: {len(sent)} requests logged)")
ok(not any(w in body for body in sent for w in secret_words), "no note was in anything sent to Claude")
status, stamps = call("GET", "/__doc?name=jobstamps")
ok(not stamps or "lovenotes-deliveries" not in stamps, "with no deliveries there is no timed job at all", stamps)

finish("test_a5_api")
