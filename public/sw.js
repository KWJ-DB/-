// 알림용 서비스워커
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const isCall = d.tag === "call" || String(d.tag || "").startsWith("sos") && d.tag !== "sosok";
    // 앱이 열려 있으면 바로 전화 화면이 뜨게
    if (d.tag === "call") for (const w of wins) { try { w.postMessage({ type: "call" }); } catch {} }
    // 앱을 보고 있으면 알림이 쌓이지 않게: 아이폰은 푸시마다 알림을 꼭 띄워야 해서, 띄우고 바로 지움
    const open = wins.some((w) => w.visibilityState === "visible");
    await self.registration.showNotification(d.title || "", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag || "msg",
      renotify: true,
      requireInteraction: isCall,
      vibrate: isCall ? [300, 150, 300, 150, 300, 150, 300] : [90],
      data: { url: d.url || "/" },
    });
    if (open && !isCall) {
      const ns = await self.registration.getNotifications();
      ns.forEach((n) => n.close());
    }
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { await w.focus(); w.postMessage({ type: "open", url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});

// 앱이 열리면 쌓인 알림 전부 지우기
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "clearNotis") {
    e.waitUntil(self.registration.getNotifications().then((ns) => ns.forEach((n) => { if (n.tag !== "call") n.close(); })));
  }
});
