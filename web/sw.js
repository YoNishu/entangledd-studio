/* D's Studio: the service worker. It does two things and nothing else:
     - when the server sends a reminder, it shows it as a notification;
     - when the notification is tapped, it brings the app forward on Today (or opens it).
   On purpose it does not answer page requests and keeps no stored copy of the app:
   the app is always loaded fresh from the server, so an old version can never get stuck on a phone. */

// A new version of this file takes over at once.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const FALLBACK = { title: "Nishiii 💌", body: "Psst. Your quotes are ready. I'm ready. The only thing missing is you.", tag: "daily-reminder", url: "/" };

// Only ever opens a page of this app.
function ownPage(address) {
  try {
    const url = new URL(address || "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/";
  } catch (e) { return self.location.origin + "/"; }
}

// What the server sent: { web_push: 8030, notification: { title, body, navigate, tag } }.
// Whatever arrives, something is shown: a phone takes the permission away from an app that stays silent.
function read(event) {
  let sent = {};
  try { sent = (event.data && event.data.json().notification) || {}; } catch (e) { /* not ours: the fallback is shown */ }
  const words = (v, max, or) => (typeof v === "string" && v.trim() ? v.slice(0, max) : or);
  return {
    title: words(sent.title, 80, FALLBACK.title),
    body: words(sent.body, 300, FALLBACK.body),
    tag: words(sent.tag, 40, FALLBACK.tag),
    url: ownPage(sent.navigate),
  };
}

self.addEventListener("push", (event) => {
  const n = read(event);
  event.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, icon: "/icon-192.png", lang: "en", data: { url: n.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = ownPage(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = pages.find((p) => new URL(p.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(url);
    open.postMessage({ type: "reminder-open" });         // the app turns to Today (web/reminders.js)
    return open.focus().catch(() => {});
  })());
});
