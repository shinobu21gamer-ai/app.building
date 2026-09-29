self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "BarangayResolve alert", {
      body: data.body || "You have a new community alert.",
      tag: data.alertId ? `barangayresolve-alert-${data.alertId}` : "barangayresolve-alert",
      requireInteraction: data.severity === "CRITICAL",
      data: { url: data.url || "/alerts" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/alerts"));
});