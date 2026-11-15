"""Little notes from Nishiii: the sealed box itself, checked against a second, independent
implementation (Python's cryptography library) so the format is proved to be what it says:
  1 byte version | 65 bytes fresh P-256 public key | 12 bytes nonce | AES-256-GCM text and tag
  key = HKDF-SHA-256(ECDH secret, salt = fresh key + app key, info = "ds-studio/sealed-notes/v1")
  the label "ds-studio-notes-v1" is checked along with the text.
What tools/seal.mjs seals, Python opens; what Python seals, the app's code opens; and a box
changed anywhere at all, or made with any other constant, is refused. Throwaway keys and made-up
notes only. Needs no server.
Run: python3 tests/test_a5_box.py"""
import where as _W
import base64, hashlib, json, os, subprocess
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from a5lib import ok, finish, REPO

WORK = f"{_W.OUT}/work"
os.makedirs(WORK, exist_ok=True)
INFO, LABEL = b"ds-studio/sealed-notes/v1", b"ds-studio-notes-v1"
NOTES = {"mode": "add", "notes": [{"text": "We met at the bakery on 3 March 2020.", "date": "2020-03-03"},
                                  {"text": "Tea on the terrace, with the rain coming in sideways — મારી \U0001F499."}]}

raw_point = lambda key: key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
b64u = lambda n: base64.urlsafe_b64encode(n.to_bytes(32, "big")).rstrip(b"=").decode()

def aes_key(secret, fresh_pub, app_pub, info=INFO, salt=None):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt if salt is not None else fresh_pub + app_pub, info=info).derive(secret)

def py_open(app_key, box):
    raw = base64.b64decode(box)
    assert raw[0] == 1 and len(raw) >= 1 + 65 + 12 + 16
    fresh_pub, nonce, locked = raw[1:66], raw[66:78], raw[78:]
    secret = app_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), fresh_pub))
    return AESGCM(aes_key(secret, fresh_pub, raw_point(app_key))).decrypt(nonce, locked, LABEL).decode()

def py_seal(app_pub, plain, version=1, info=INFO, label=LABEL, salt_order="fresh+app", nonce_len=12):
    fresh = ec.generate_private_key(ec.SECP256R1())
    fresh_pub = raw_point(fresh)
    secret = fresh.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), app_pub))
    salt = {"fresh+app": fresh_pub + app_pub, "app+fresh": app_pub + fresh_pub, "none": b""}[salt_order]
    nonce = os.urandom(nonce_len)
    locked = AESGCM(aes_key(secret, fresh_pub, app_pub, info, salt)).encrypt(nonce, plain.encode(), label)
    return base64.b64encode(bytes([version]) + fresh_pub + nonce + locked).decode()

def node_open(app_key, boxes):
    nums = app_key.private_numbers()
    jwk = {"kty": "EC", "crv": "P-256", "d": b64u(nums.private_value), "x": b64u(nums.public_numbers.x), "y": b64u(nums.public_numbers.y), "ext": True, "key_ops": ["deriveBits"]}
    path = f"{WORK}/unseal_in.json"
    with open(path, "w") as f: json.dump({"privateJwk": jwk, "publicHex": raw_point(app_key).hex(), "boxes": boxes}, f)
    out = subprocess.run(["node", f"{_W.HERE}/unseal_raw.mjs", path], capture_output=True, text=True)
    os.remove(path)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)

app = ec.generate_private_key(ec.SECP256R1())          # a throwaway stand-in for the app's own pair
app_pub = raw_point(app)
key_hex, check = app_pub.hex(), hashlib.sha256(app_pub).hexdigest()[:16]

# ---------------- the tool seals, Python opens ----------------
print("what the tool seals, a second implementation opens")
with open(f"{WORK}/box_notes.json", "w") as f: json.dump(NOTES, f)
out = subprocess.run(["node", f"{REPO}/tools/seal.mjs", "--key", key_hex, "--check", check, "--in", f"{WORK}/box_notes.json", "--out", "-"], capture_output=True, text=True, cwd=WORK)
ok(out.returncode == 0, "the tool sealed for a key made elsewhere", out.stderr)
box = out.stdout.strip()
raw = base64.b64decode(box)
ok(raw[0] == 1 and raw[1] == 4 and len(raw) > 94, "the box starts with version 1, then an uncompressed P-256 point")
inside = json.loads(py_open(app, box))
ok(inside["mode"] == "add" and inside["notes"] == NOTES["notes"] and inside["v"] == 1, "Python opens it and finds exactly the notes, every character", inside)
ok(len(raw) == 1 + 65 + 12 + len(json.dumps(inside, ensure_ascii=False, separators=(",", ":")).encode()) + 16, "its length is header + text + a 16-byte tag, nothing else")
out2 = subprocess.run(["node", f"{REPO}/tools/seal.mjs", "--key", key_hex, "--check", check, "--in", f"{WORK}/box_notes.json", "--out", "-"], capture_output=True, text=True, cwd=WORK)
raw2 = base64.b64decode(out2.stdout.strip())
ok(raw2[1:66] != raw[1:66] and raw2[66:78] != raw[66:78], "a second sealing uses a new fresh key and a new nonce")
text = box + json.dumps(NOTES)
ok(not any(n["text"][:12] in box or n["text"][:12].encode() in raw for n in NOTES["notes"]), "no note can be read in the box, as text or as bytes")
os.remove(f"{WORK}/box_notes.json")

# ---------------- Python seals, the app's code opens ----------------
print("what a second implementation seals, the app's code opens")
plain = json.dumps({"v": 1, **NOTES}, ensure_ascii=False)
got = node_open(app, [py_seal(app_pub, plain)])
ok(got[0]["ok"] and got[0]["text"] == plain, "a box made in Python to the written format opens in the app's code", got)

# ---------------- anything else is refused ----------------
print("changed anywhere, or made with any other constant: refused")
good = base64.b64decode(py_seal(app_pub, plain))
def flipped(i): return base64.b64encode(good[:i] + bytes([good[i] ^ 1]) + good[i + 1:]).decode()
spots = {"the version byte": 0, "the point's first byte": 1, "the fresh key (x)": 20, "the fresh key (y)": 50, "the nonce": 70, "the first byte of text": 78,
         "the middle of the text": 78 + (len(good) - 94) // 2, "the last byte of text": len(good) - 17, "the tag's first byte": len(good) - 16, "the tag's last byte": len(good) - 1}
res = node_open(app, [flipped(i) for i in spots.values()])
bad = [name for name, r in zip(spots, res) if r["ok"]]
ok(bad == [], f"one bit changed in any of {len(spots)} places and it won't open", bad)
every = node_open(app, [flipped(i) for i in range(len(good))])
ok(not any(r["ok"] for r in every), f"and the same for a changed bit in each of all {len(good)} bytes, one at a time", sum(r["ok"] for r in every))
cuts = {"cut by one byte": good[:-1], "cut to the header": good[:78], "cut to nothing": b"", "one extra byte": good + b"\0", "the tag only": good[:78] + good[-16:]}
res = node_open(app, [base64.b64encode(c).decode() for c in cuts.values()])
ok(not any(r["ok"] for r in res), "cut short, or with a byte added: refused", [n for n, r in zip(cuts, res) if r["ok"]])
other = ec.generate_private_key(ec.SECP256R1())
variants = {
    "sealed for another key": py_seal(raw_point(other), plain),
    "another label": py_seal(app_pub, plain, label=b"ds-studio-notes-v2"),
    "no label": py_seal(app_pub, plain, label=None),
    "another info": py_seal(app_pub, plain, info=b"ds-studio/sealed-notes/v2"),
    "salt the other way round": py_seal(app_pub, plain, salt_order="app+fresh"),
    "no salt": py_seal(app_pub, plain, salt_order="none"),
    "version 2": py_seal(app_pub, plain, version=2),
    "version 0": py_seal(app_pub, plain, version=0),
    "a point that is not on the curve": base64.b64encode(good[:1] + b"\x04" + b"\x01" * 64 + good[66:]).decode(),
    "a compressed point padded out": base64.b64encode(good[:1] + b"\x02" + good[2:34] + b"\0" * 32 + good[66:]).decode(),
    "not base64 at all": "not base64 at all!",
    "an empty string": "",
}
res = node_open(app, list(variants.values()))
ok(not any(r["ok"] for r in res), f"{len(variants)} other ways of getting it wrong are all refused", [n for n, r in zip(variants, res) if r["ok"]])
ok(node_open(other, [base64.b64encode(good).decode()])[0]["ok"] is False, "and the holder of a different private key can't open a good box")

finish("test_a5_box")
