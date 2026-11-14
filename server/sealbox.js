/* A sealed box: text that anyone holding the public key can lock, and only the holder of the
   private key can open. The app's server keeps the private key in its own storage, so a locked
   box can sit in the public repo without anyone being able to read it.

   How (version 1): a fresh P-256 key is made for each box; that key and the server's public key
   give a shared secret (ECDH); HKDF-SHA-256 turns the secret into an AES-256-GCM key; the box is
     1 byte version | 65 bytes fresh public key | 12 bytes nonce | the locked text and its tag
   written as base64. Uses only WebCrypto, so the same file runs in the Worker and in Node
   (tools/seal.mjs). */

const CURVE = { name: "ECDH", namedCurve: "P-256" };
const VERSION = 1;
const text = new TextEncoder();
const INFO = text.encode("ds-studio/sealed-notes/v1");     // ties the derived key to this one use
const LABEL = text.encode("ds-studio-notes-v1");           // checked along with the locked text

export const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
const toBase64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

export async function sha256Hex(data) {
  return toHex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? text.encode(data) : data));
}

// A public key is written as 130 lowercase hex characters (the point, uncompressed: 04 | x | y).
// Spaces are allowed and ignored, so the grouped form can be pasted as it is.
export function tidyKey(hex) {
  const key = String(hex || "").replace(/\s+/g, "").toLowerCase();
  if (!/^04[0-9a-f]{128}$/.test(key)) throw new Error("That isn't a key from the app: it should be 130 letters and digits starting with 04.");
  return key;
}
// A short check for a key, so a copy that went wrong on the way is caught before anything is locked with it.
export const keyCheck = async (hex) => (await sha256Hex(fromHex(tidyKey(hex)))).slice(0, 16);

export async function makeKeys() {
  const pair = await crypto.subtle.generateKey(CURVE, true, ["deriveBits"]);
  return {
    publicHex: toHex(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

async function aesKey(secret, freshPublic, serverPublic, use) {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: join(freshPublic, serverPublic), info: INFO },
    base, { name: "AES-GCM", length: 256 }, false, [use]);
}

// Locks bytes (or a string) for the holder of the private half of publicHex. Returns base64.
export async function seal(publicHex, plain) {
  const serverPublic = fromHex(tidyKey(publicHex));
  const theirs = await crypto.subtle.importKey("raw", serverPublic, CURVE, false, []);     // also refuses a point that is not on the curve
  const fresh = await crypto.subtle.generateKey(CURVE, true, ["deriveBits"]);
  const freshPublic = new Uint8Array(await crypto.subtle.exportKey("raw", fresh.publicKey));
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, fresh.privateKey, 256);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret, freshPublic, serverPublic, "encrypt");
  const locked = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: LABEL }, key,
    typeof plain === "string" ? text.encode(plain) : plain);
  return toBase64(join(Uint8Array.of(VERSION), freshPublic, nonce, new Uint8Array(locked)));
}

// Opens a box with the server's own keys. Throws if it was locked for another key or changed on the way.
export async function unseal(keys, box) {
  const raw = fromBase64(String(box || ""));
  if (raw.length < 1 + 65 + 12 + 16 || raw[0] !== VERSION) throw new Error("not a sealed box this app understands");
  const freshPublic = raw.slice(1, 66), nonce = raw.slice(66, 78), locked = raw.slice(78);
  const mine = await crypto.subtle.importKey("jwk", keys.privateJwk, CURVE, false, ["deriveBits"]);
  const theirs = await crypto.subtle.importKey("raw", freshPublic, CURVE, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, mine, 256);
  const key = await aesKey(secret, freshPublic, fromHex(tidyKey(keys.publicHex)), "decrypt");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: LABEL }, key, locked));
}
