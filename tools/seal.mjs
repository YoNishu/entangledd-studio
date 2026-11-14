#!/usr/bin/env node
/* Seals a list of little notes so that only the app's own server can read them, and adds the
   sealed delivery to server/sealed.js. The sealed text is safe in the public repo; the plain
   file is not, so keep it outside the repo and delete it afterwards.

   1. Get the app's public key:   GET https://<the app>/api/seal-key   → { key, groups, check }
   2. Write the notes somewhere outside the repo, for example /tmp/private/notes.json:
        { "mode": "add", "notes": [ { "text": "We met at the bakery.", "date": "2020-03-03" }, { "text": "No date on this one." } ] }
      "add" keeps the notes already in the app (a note with the same words is skipped);
      "replace" swaps the whole set. "date" is optional: the day the note is about.
   3. node tools/seal.mjs --key <key or groups> --check <check> --in /tmp/private/notes.json --out server/sealed.js
   4. Commit server/sealed.js and deploy. The app opens the delivery by itself.

   --out -   prints the one sealed delivery instead of writing a file.
   Needs Node 20 or newer. No packages. */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seal, keyCheck, tidyKey } from "../server/sealbox.js";

const MAX_NOTES = 60, MAX_CHARS = 280;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const stop = (message) => { console.error("Not sealed: " + message); process.exit(1); };

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!["--key", "--check", "--in", "--out"].includes(name)) stop(`"${name}" isn't an option. Use --key, --check, --in and --out.`);
    const values = [];
    while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) values.push(argv[++i]);     // a key pasted in groups arrives as several words
    if (!values.length) stop(`${name} needs a value.`);
    out[name.slice(2)] = values.join(name === "--key" ? "" : " ");
  }
  for (const need of ["key", "check", "in", "out"]) if (!out[need]) stop(`--${need} is missing.`);
  return out;
}

const realDate = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && y <= 2200 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

// The notes file, checked the same way the app will check it. Never prints the notes.
export function readNotes(textOfFile) {
  let data;
  try { data = JSON.parse(textOfFile.replace(/^\uFEFF/, "")); } catch (e) { throw new Error("the notes file isn't valid JSON."); }
  if (!data || !["add", "replace"].includes(data.mode)) throw new Error('the notes file needs "mode": "add" or "replace".');
  if (!Array.isArray(data.notes) || !data.notes.length) throw new Error('the notes file needs a "notes" list with at least one note.');
  if (data.notes.length > MAX_NOTES) throw new Error(`there is room for ${MAX_NOTES} notes; the file has ${data.notes.length}.`);
  const notes = data.notes.map((n, i) => {
    const text = String((n && n.text) ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error(`note ${i + 1} has no text.`);
    if ([...text].length > MAX_CHARS) throw new Error(`note ${i + 1} is ${[...text].length} characters long; the most is ${MAX_CHARS}.`);
    if (n.date != null && n.date !== "" && !realDate(n.date)) throw new Error(`note ${i + 1} has a date that isn't a real day written as YYYY-MM-DD.`);
    return n.date ? { text, date: String(n.date) } : { text };
  });
  return { v: 1, mode: data.mode, notes, sealedAt: Date.now() };
}

const FILE_HEAD = `/* Sealed deliveries for the little notes: text that only the app's own server can open.
   Written by tools/seal.mjs. Safe to keep in a public repo: every entry is locked with a key
   whose private half never leaves the app's storage (see server/sealbox.js). */
`;

async function main() {
  const opt = options(process.argv.slice(2));
  let key;
  try { key = tidyKey(opt.key); } catch (e) { stop(e.message); }
  // Nothing is sealed with a key that can't prove it arrived whole: a delivery sealed with a damaged key could never be opened.
  const check = opt.check.replace(/\s+/g, "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(check)) stop("the check should be 16 letters and digits (0-9 and a-f), as /api/seal-key gives it. Fetch it again.");
  if ((await keyCheck(key)) !== check) {
    stop("the key and its check don't match, so one of them was damaged while being copied. Fetch /api/seal-key again.");
  }
  const from = path.resolve(opt.in);
  if (from === repo || from.startsWith(repo + path.sep)) {
    stop("the notes file is inside the repo, which is public. Move it somewhere outside (for example /tmp/private/) and try again.");
  }
  let delivery;
  try { delivery = readNotes(await readFile(from, "utf8")); } catch (e) { stop(e.code === "ENOENT" ? `there is no file at ${from}.` : e.message); }
  let box;
  try { box = await seal(key, JSON.stringify(delivery)); } catch (e) { stop("that key can't be used: it isn't a point the app could have made. Fetch /api/seal-key again."); }

  if (opt.out === "-") { console.log(box); return; }
  const to = path.resolve(opt.out);
  let have = [];
  try { have = (await import(pathToFileURL(to).href + "?t=" + Date.now())).SEALED; }
  catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND" && e.code !== "ENOENT") stop(`${to} exists but couldn't be read as a list of deliveries. Fix or remove it first.`); }
  if (!Array.isArray(have) || have.some((b) => typeof b !== "string")) stop(`${to} doesn't hold a list of deliveries. Fix or remove it first.`);
  const all = [...have, box];
  try { await writeFile(to, `${FILE_HEAD}export const SEALED = [\n${all.map((b) => `  ${JSON.stringify(b)},\n`).join("")}];\n`); }
  catch (e) { stop(`${to} couldn't be written (${e.code || "no reason given"}). Run this from the top folder of the repo, with --out server/sealed.js.`); }
  const n = delivery.notes.length;
  console.log(`Sealed ${n} ${n === 1 ? "note" : "notes"} (${delivery.mode}) for the key with check ${check}. ${path.relative(process.cwd(), to) || to} now holds ${all.length} ${all.length === 1 ? "delivery" : "deliveries"}.`);
  console.log(`The plain notes are still at ${from}. Delete that file once the delivery is committed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
