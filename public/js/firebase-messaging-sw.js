/* Firebase Messaging Service Worker (compat) */
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

/* ⚠️ Usa el mismo config que en firebase-config.js */
firebase.initializeApp({
  apiKey: "AIzaSyCKTIItYQ-FRvTyq6iF7KeNMTeeQNK1e9Y",
  authDomain: "mi-tiendita-cercana.firebaseapp.com",
  projectId: "mi-tiendita-cercana",
  storageBucket: "mi-tiendita-cercana.appspot.com",
  messagingSenderId: "573896078459",
  appId: "1:573896078459:web:f788745bde9c35d61e1ede",
  measurementId: "G-WW5XVRY1ZR"
});

const messaging = firebase.messaging();

// Toma control rápido del SW
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evt) => evt.waitUntil(self.clients.claim()));

// Notificaciones en background
messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  const title = payload?.notification?.title || data.title || "Notificación";
  const body  = payload?.notification?.body  || data.body  || "Tienes una actualización";
  const pedidoId = data.pedidoId || null;

  self.registration.showNotification(title, {
    body,
    icon: "./favicon.png",
    badge: "./favicon.png",
    data: { ...data, pedidoId },
  });
});

/* =========================================================
   CLICK en la notificación
   - Si es "pedido_estado" => abre productos.html (vista cliente)
   - En cualquier otro caso => abre panel-comerciante.html (vista tienda)
   - Si viene pedidoId, lo pasa en el hash #pedido=<id>
   ========================================================= */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const pedidoId = data.pedidoId || "";
  const tipo = (data.tipo || "").toLowerCase(); // ej: 'pedido_estado', 'pedido_nuevo', etc.

  const base = new URL(self.registration.scope);
  const urlCliente = new URL("productos.html", base).toString();
  const urlPanel   = new URL("panel-comerciante.html", base).toString();

  // Heurística: estado de pedido => cliente; resto => panel
  const preferred = (tipo === "pedido_estado") ? urlCliente : urlPanel;
  const url = pedidoId ? `${preferred}#pedido=${encodeURIComponent(pedidoId)}` : preferred;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña abierta del sitio, reúsala
      for (const client of clientList) {
        try {
          const isPanel   = client.url.includes("panel-comerciante.html");
          const isCliente = client.url.includes("productos.html");
          if (isPanel || isCliente) {
            if ("navigate" in client) client.navigate(url);
            if ("focus" in client)   return client.focus();
          }
        } catch {}
      }
      // Si no hay, abre una nueva
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
