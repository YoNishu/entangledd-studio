/* Sealed deliveries for the little notes: text that only the app's own server can open.
   Written by tools/seal.mjs. Safe to keep in a public repo: every entry is locked with a key
   whose private half never leaves the app's storage (see server/sealbox.js). */
export const SEALED = [];
