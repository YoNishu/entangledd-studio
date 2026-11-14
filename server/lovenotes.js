/* Little notes from Nishiii, shown one at a time.

   This file is one of the app's add-on sections (see SECTIONS in worker.js).
   Handlers are called as handler(request, env, parts, kit); jobs as run(env, kit). */

export const open = {};     // paths anyone may call: /api/<name>
export const routes = {};   // paths that need sign-in: /api/<name>
export const jobs = [];      // { name, everyHours, run }
