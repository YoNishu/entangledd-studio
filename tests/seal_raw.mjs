// Test helper: seals any text (even text the real tool would refuse) for a key, or for a key nobody has.
//   node seal_raw.mjs <key hex> <plain text>      → one sealed delivery
//   node seal_raw.mjs --stranger <plain text>     → sealed for a freshly made key that is thrown away
import { seal, makeKeys } from "../server/sealbox.js";
const [first, plain] = process.argv.slice(2);
const key = first === "--stranger" ? (await makeKeys()).publicHex : first;
console.log(await seal(key, plain));
