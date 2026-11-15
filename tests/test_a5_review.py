"""Little notes from Nishiii: the sealing code and the open key address, looked at closely.
Runs tests/harness_a5.mjs, which drives server/lovenotes.js directly against a pretend storage
that can be slowed, failed and watched: two first calls at once, a save that fails, deliveries
made to break things, what a call to the open address costs, damaged stored documents, and that
no private key or note ever reaches an answer or a log line. Needs no server. Only made-up notes.
Run: python3 tests/test_a5_review.py"""
import where as _W
import re, subprocess, sys

out = subprocess.run(["node", f"{_W.HERE}/harness_a5.mjs"], capture_output=True, text=True, timeout=300)
print(out.stdout, end="")
if out.stderr.strip(): print(out.stderr)
tally = re.search(r"harness_a5: (\d+) checks passed, (\d+) failed", out.stdout)
good = out.returncode == 0 and tally is not None and int(tally.group(1)) >= 60 and tally.group(2) == "0" and "  FAIL " not in out.stdout
print("PASS" if good else "FAIL")
sys.exit(0 if good else 1)
