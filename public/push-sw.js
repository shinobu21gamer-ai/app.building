self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "BarangayResolve alert", {
      body: data.body || "You have a new community alert.",
      tag: data.alertId ? `barangayresolve-alert-${data.alertId}` : "barangayresolve-alert",
      requireInteraction: data.severity === "CRITICAL",
      // Browser notifications stay visual-only; alarm sound and vibration belong to the native app.
      silent: true,
      data: { url: data.url || "/alerts" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/alerts"));
});