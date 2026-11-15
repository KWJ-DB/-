// 알림용 서비스워커
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const isCall = d.tag === "call";
    // 앱이 열려 있으면 바로 전화 화면이 뜨게
    if (isCall) for (const w of wins) { try { w.postMessage({ type: "call" }); } catch {} }
    // 이미 채팅 화면을 보고 있으면 디엠 알림 생략
    const viewing = wins.some((w) => w.visibilityState === "visible" && w.url.includes("#chat"));
    if (viewing && d.tag === "dm") return;
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
