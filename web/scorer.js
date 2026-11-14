/* D's Studio: what the taste scorer is up to.
   Starts when the app is open and unlocked ("studio:ready"). Shared helpers: window.StudioKit and window.Studio.
   Other signals: "studio:view" (detail = the section now showing) and "studio:settings" (Settings just opened).
   One line in the Nishiii section (#scorer-slot): how many picks it has learned from, or that it now ranks
   her daily quotes. The numbers come from the signed-in GET /api/scorer (server/scorer.js). */
(() => {
  "use strict";
  const slot = document.getElementById("scorer-slot");
  if (!slot) return;
  let busy = false, last = 0;

  function render(s) {
    const { el } = window.StudioKit;
    const bar = el("div", { id: "scorer-bar", className: "scorer-bar" }, el("span", { id: "scorer-fill" }));
    bar.firstChild.style.width = Math.round((s.progress || 0) * 100) + "%";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(s.need || 50));
    bar.setAttribute("aria-valuenow", String(Math.min(s.picks || 0, s.need || 50)));
    bar.setAttribute("aria-label", "Picks learned from");
    slot.replaceChildren(
      el("p", { className: "note", id: "scorer-line", textContent: s.line || "" }),
      s.state === "live" ? null : bar);
    slot.dataset.state = s.state || "learning";
  }

  async function load() {
    if (busy || !window.StudioKit) return;
    busy = true; last = Date.now();
    try { render(await window.StudioKit.getJson("scorer")); }
    catch (e) { slot.replaceChildren(); }          // nothing to say is better than an error here
    finally { busy = false; }
  }

  document.addEventListener("studio:view", (e) => { if (e.detail === "nishiii") load(); });
  // After "Forget everything" the count starts again: the taste note changes, so look again.
  const note = document.getElementById("taste-note");
  if (note) new MutationObserver(() => { if (Date.now() - last > 1500 && !document.getElementById("view-nishiii").hidden) load(); })
    .observe(note, { childList: true, characterData: true, subtree: true });
})();
