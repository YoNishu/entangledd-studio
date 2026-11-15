// Test helper: opens sealed deliveries with a throwaway test key, using the app's own code.
//   node unseal_raw.mjs <file with { privateJwk, publicHex, boxes: [...] }>
// Prints one JSON line: for each box either { ok: true, text } or { ok: false }.
import { readFileSync } from "node:fs";
import { unseal } from "../server/sealbox.js";
const { privateJwk, publicHex, boxes } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = [];
for (const box of boxes) {
  try { out.push({ ok: true, text: await unseal({ privateJwk, publicHex }, box) }); }
  catch (e) { out.push({ ok: false }); }
}
console.log(JSON.stringify(out));
