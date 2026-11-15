/* D's Studio: the daily reminder in Settings.
   Shared helpers: window.StudioKit. Signals used: "studio:settings" (Settings just opened) and
   "studio:ready" (the app is open and unlocked).

   Under "Daily reminder" she turns on one notification a day, at a time she picks (11:11 unless she changes
   it; always India time). Turning it on asks the phone's own question ("Allow notifications?") straight from
   her tap, then hands the server this phone's address for reminders. The server does the rest
   (server/reminders.js); the notification itself is shown by web/sw.js.

   On an iPhone this only works in the app opened from the Home Screen (iOS 16.4 or later). Where it can't
   work, one sentence says why and what to do. */
(() => {
  "use strict";
  const K = window.StudioKit;
  const $ = (id) => document.getElementById(id);
  // Its place in Settings: right under the Face ID lock, before Instagram. Made here, so the page's own markup stays as it is.
  function mount() {
    const after = $("faceid-toggle");
    if (!$("settings-reminders") && after) after.insertAdjacentElement("afterend", K.el("div", { id: "settings-reminders" }));
    return $("settings-reminders");
  }
  const DEFAULT_TIME = "11:11";
  const MEMO = "ds.reminder.v1";          // kept on this phone: that the reminder is on, its time, and the day it was last looked after
  const WORKER = "/sw.js";

  const memo = {
    get: () => { try { return JSON.parse(localStorage.getItem(MEMO) || "null") || {}; } catch (e) { return {}; } },
    set: (v) => { try { localStorage.setItem(MEMO, JSON.stringify(v)); } catch (e) { /* no storage: asked afresh next time */ } },
    clear: () => { try { localStorage.removeItem(MEMO); } catch (e) { /* nothing to remove */ } },
  };
  const state = { on: !!memo.get().on, time: memo.get().time || DEFAULT_TIME, missed: false, busy: false, message: "" };

  // ---------- what this phone can do ----------
  const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const fromHomeScreen = () => navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const can = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const blocked = () => can() && Notification.permission === "denied";
  // One plain sentence when reminders can't work here, "" when they can.
  function whyNot() {
    if (blocked()) {
      return isIphone()
        ? "Notifications are off for D's Studio. Turn them on in your iPhone's Settings, under Notifications, then try again."
        : "Notifications are blocked for D's Studio. Allow them in your browser's settings for this site, then try again.";
    }
    if (can()) return "";
    if (isIphone() && !fromHomeScreen()) return "Add D's Studio to your Home Screen first: Share, then Add to Home Screen, then open it from there.";
    return isIphone() ? "Reminders need iOS 16.4 or later." : "This browser can't show reminders.";
  }

  const today = () => new Date().toDateString();
  const inIndia = () => new Date().getTimezoneOffset() === -330;
  // The time written the way this phone writes times, so the sentence matches the field above it.
  const niceTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
  const toBytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // ---------- the phone's side: service worker and subscription ----------
  // Registering again on every open is how a new version of sw.js is picked up; it is never taken from a cache.
  async function register() {
    await navigator.serviceWorker.register(WORKER, { scope: "/", updateViaCache: "none" });
    return navigator.serviceWorker.ready;
  }
  async function currentSub() {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }
  const subscribe = (reg, key) => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  // Older Safari hands the answer to a callback, newer browsers return it.
  const askPermission = () => new Promise((resolve) => {
    const asked = Notification.requestPermission(resolve);
    if (asked && asked.then) asked.then(resolve, () => resolve("denied"));
  });
  function settle(out) {
    state.on = !!out.on;
    state.missed = !!out.on && !!out.missed;          // the last reminder for this phone never got through
    if (out.on) { state.time = out.time; memo.set({ on: true, time: out.time, looked: today() }); }
    else memo.clear();
  }

  // ---------- the section in Settings ----------
  function build() {
    const m = mount();
    if (!m || $("remind-title")) return;
    const box = K.el("input", { type: "checkbox", id: "remind-on", className: "switch" });
    box.setAttribute("role", "switch");
    m.append(
      K.el("h3", { id: "remind-title", className: "ic ic-bell", textContent: "Daily reminder" }),
      K.el("label", { className: "remind-row", id: "remind-row" }, K.el("span", { textContent: "Remind me to post" }), box),
      K.el("label", { className: "remind-row", id: "remind-time-row", hidden: true },
        K.el("span", { textContent: "Time" }), K.el("input", { type: "time", id: "remind-time", value: state.time })),
      K.el("p", { className: "note", id: "remind-note" }),
      K.el("button", { className: "btn", id: "remind-test", type: "button", textContent: "Send a test", hidden: true }),
    );
    m.setAttribute("role", "region");
    m.setAttribute("aria-labelledby", "remind-title");
    $("remind-note").setAttribute("role", "status");
    box.addEventListener("change", () => (box.checked ? turnOn() : turnOff()));
    $("remind-time").addEventListener("change", timeChanged);
    $("remind-test").addEventListener("click", sendTest);
  }

  function render() {
    if (!$("remind-title")) return;
    const no = whyNot(), on = state.on && !no;
    const box = $("remind-on");
    box.checked = on;
    box.disabled = state.busy || !can();
    $("remind-time-row").hidden = !on;
    if (document.activeElement !== $("remind-time")) $("remind-time").value = state.time;
    $("remind-test").hidden = !on;
    $("remind-test").disabled = state.busy;
    $("remind-note").textContent = state.message || no || (!on ? "One nudge a day, none once you've posted."
      : state.missed ? "The last reminder didn't get through. Tap Send a test to check."
        : `Every day at ${niceTime(state.time)}${inIndia() ? "" : " India time"}, unless you've already posted.`);
  }

  // Runs one change: the switch and the test button wait meanwhile, and what went wrong is said in plain words.
  async function work(job) {
    if (state.busy) return;
    state.busy = true; state.message = "";
    render();
    try { await job(); }
    catch (e) {
      // The server's own sentences are passed on; a browser's are not meant for her.
      const offline = !!e && /fetch|load failed/i.test(e.message || "");
      state.message = offline ? "You seem to be offline. Check your internet and try again."
        : e && e.name === "Error" ? K.friendly(e) : "That didn't work just now. Try again.";
      await look().catch(() => {});
    }
    finally { state.busy = false; render(); }
  }

  // Asks the server whether this phone is on its list, and for when.
  async function look() {
    const sub = can() ? await currentSub() : null;
    settle(sub ? await K.send("reminders/state", "POST", { endpoint: sub.endpoint }) : { on: false });
  }

  function turnOn() {
    // The phone's question has to be asked straight from her tap, before anything else is waited for.
    const asking = can() && !blocked() ? askPermission() : Promise.resolve("denied");
    work(async () => {
      if ((await asking) !== "granted") { state.on = false; return; }        // render() says why, if the phone said no for good
      const reg = await register();
      const { key } = await K.getJson("reminders");
      const old = await reg.pushManager.getSubscription();
      if (old) {                                                              // always a fresh address: an old one may have lapsed
        await K.send("reminders/off", "POST", { endpoint: old.endpoint }).catch(() => {});
        await old.unsubscribe().catch(() => {});
      }
      const sub = await subscribe(reg, key);
      try { settle(await K.send("reminders", "POST", { subscription: sub.toJSON(), time: $("remind-time").value || state.time })); }
      catch (e) { await leave(reg, sub); throw e; }                           // the server said no: nothing stays behind on the phone
    });
  }
  async function leave(reg, sub) {
    if (sub) await sub.unsubscribe().catch(() => {});
    if (reg) await reg.unregister().catch(() => {});
  }

  function turnOff() {
    work(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) await K.send("reminders/off", "POST", { endpoint: sub.endpoint });
      await leave(reg, sub);                                                  // nothing is left behind on the phone
      settle({ on: false });
    });
  }

  // The time field tells of every turn of the wheel: the server is told once she has settled on a time.
  let timeWait = 0;
  function timeChanged() {
    clearTimeout(timeWait);
    timeWait = setTimeout(saveTime, 700);
  }
  function saveTime() {
    const time = $("remind-time").value;
    if (!state.on || time === state.time) return;
    if (!/^\d\d:\d\d$/.test(time)) { $("remind-time").value = state.time; return; }   // the field was emptied: back to what it was
    if (state.busy) { timeChanged(); return; }
    work(async () => {
      const sub = await currentSub();
      if (!sub) { settle({ on: false }); return; }
      settle(await K.send("reminders", "POST", { subscription: sub.toJSON(), time }));
    });
  }

  function sendTest() {
    work(async () => {
      const sub = await currentSub();
      if (!sub) { settle({ on: false }); return; }
      $("remind-test").textContent = "Sending…";
      try {
        await K.send("reminders/test", "POST", { endpoint: sub.endpoint });
        state.message = "Sent. It should arrive in a moment.";
      } finally { $("remind-test").textContent = "Send a test"; }
    });
  }

  document.addEventListener("studio:settings", async () => {
    build();
    state.message = "";
    render();                                  // what this phone remembers, at once
    if (state.busy) return;
    try { await look(); } catch (e) { state.message = K.friendly(e); }
    render();
  });

  // ---------- looking after it, once a day, when the app is opened ----------
  // Keeps sw.js current, and makes sure the address the server holds for this phone still works:
  // a phone can replace it, and the server drops one its push service calls gone.
  async function keepUp() {
    const kept = memo.get();
    if (!kept.on || !can()) return;
    if (Notification.permission !== "granted") { memo.clear(); state.on = false; return; }
    const reg = await register();
    if (kept.looked === today()) return;
    const { key } = await K.getJson("reminders");
    let sub = await reg.pushManager.getSubscription();
    const sameKey = sub && (!sub.options || !sub.options.applicationServerKey || toB64u(sub.options.applicationServerKey) === key);
    const known = sameKey && (await K.send("reminders/state", "POST", { endpoint: sub.endpoint })).on;
    if (!known) {
      if (sub) await sub.unsubscribe().catch(() => {});
      sub = await subscribe(reg, key);
      await K.send("reminders", "POST", { subscription: sub.toJSON(), time: kept.time || DEFAULT_TIME });
    }
    memo.set({ on: true, time: kept.time || DEFAULT_TIME, looked: today() });
  }
  let kept = false;
  document.addEventListener("studio:ready", () => {
    if (kept) return;
    kept = true;
    setTimeout(() => keepUp().catch(() => {}), 4000);       // well after the app has opened: nothing here may slow that down
  });

  // A tapped reminder brings the app forward: turn to Today (sw.js sends this when the app was already open).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      const lock = $("lock"), go = $("nav-today");
      if (e.data && e.data.type === "reminder-open" && go && (!lock || lock.hidden)) go.click();
    });
  }
})();
