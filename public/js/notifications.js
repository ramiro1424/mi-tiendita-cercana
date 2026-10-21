// ./public/js/notifications.js
// Suscribe a FCM, guarda el token y muestra toasts (cliente y comerciante)
// (ESM) — archivo único SIN duplicados

import { app, auth, db } from './firebase-config.js';
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  doc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  getDoc  // 🔥 NUEVO: para verificar pedidos
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
const API_BASE = window.API_BASE || 'http://localhost:3000';
const VAPID_KEY = window.__VAPID_KEY || undefined;
const IS_LOCAL  = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

/* ------------------------- UI: mini toast reutilizable ------------------------- */
function showToast(msg, { actionText, onAction } = {}) {
  let el = document.getElementById('global-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-msg';
    Object.assign(el.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 99999,
      maxWidth: '92vw',
      background: '#111827',
      color: '#fff',
      padding: '12px 14px',
      borderRadius: '12px',
      boxShadow: '0 10px 30px rgba(0,0,0,.3)',
      fontWeight: '600',
      display: 'grid',
      gridAutoFlow: 'column',
      alignItems: 'center',
      gap: '10px',
    });
    document.body.appendChild(el);
  }

  el.textContent = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);

  if (actionText && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.textContent = actionText;
    Object.assign(btn.style, {
      border: 'none',
      background: '#10b981',
      color: '#fff',
      padding: '8px 10px',
      borderRadius: '8px',
      cursor: 'pointer',
    });
    btn.onclick = onAction;
    el.appendChild(btn);
  }

  el.style.display = 'grid';
  clearTimeout(el.__to);
  el.__to = setTimeout(() => (el.style.display = 'none'), 6000);
}

/* ------------------------- Badge (campana + chat) ------------------------- */
function getBadges() {
  return [
    document.querySelector('#notification-icon .notification-badge'),
    document.getElementById('chat-notification'),
  ].filter(Boolean);
}

function setBadgeCount(n) {
  const v = Math.max(0, Number(n) || 0);
  getBadges().forEach(badge => {
    badge.textContent = String(v);
    badge.style.display = v > 0 ? 'inline-grid' : 'none';
  });
}

/* Si llega un mensaje FCM en primer plano (no pasa por Firestore), sube badge */
function incBadge() {
  const bell = document.querySelector('#notification-icon .notification-badge');
  const cur = parseInt(bell?.textContent || '0', 10) || 0;
  setBadgeCount(cur + 1);
}

/* ------------------------- helper fetch ------------------------- */
async function postJSON(url, body, idToken) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    try { return await r.json(); } catch { return { ok: r.ok }; }
  } catch {
    return { ok: false };
  }
}

/* --------------------- SW + suscripción y guardado de token -------------------- */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;

  // relativo a la página (panel-comerciante.html -> /public/firebase-messaging-sw.js)
  const swUrl = new URL('./firebase-messaging-sw.js', window.location.href).toString();

  try {
    return await navigator.serviceWorker.register(swUrl, { scope: './' });
  } catch (e) {
    console.warn('[push] registerSW fallo primario', e);
    try {
      return await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    } catch (e2) {
      console.warn('[push] registerSW fallo fallback', e2);
      return null;
    }
  }
}

/**
 * subscribeFCM(user, { prompt })
 * - prompt=false: NO pide permisos (solo se suscribe si ya está granted)
 * - prompt=true : pide permisos (ideal para botón "Activar notificaciones")
 */
let _lastToken = null;

async function subscribeFCM(user, { prompt = false } = {}) {
  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) return;

    const reg = await registerSW();
    if (!reg) return;

    if (Notification.permission !== 'granted') {
      if (!prompt) return; // 🔒 no molestamos automáticamente
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }

    if (!VAPID_KEY) {
      console.warn('[push] Falta VAPID_KEY (window.__VAPID_KEY).');
      // Sin VAPID normalmente no obtendrás token web push
      // Igual seguimos por si tu config lo permite.
    }

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      serviceWorkerRegistration: reg,
      vapidKey: VAPID_KEY,
    });

    if (!token) return;
    if (token === _lastToken) return; // evita escrituras repetidas
    _lastToken = token;

    // 🔥 GUARDAR TOKEN EN MÚLTIPLES LUGARES PARA QUE EL COMERCIANTE PUEDA NOTIFICAR AL CLIENTE
    // 1. Colección principal de tokens
    await setDoc(
      doc(db, 'tokens', token),
      { uid: user.uid, agregadoEn: serverTimestamp() },
      { merge: true }
    );

    // 2. En perfiles (cliente) - 🔥 CLAVE para que notificarClientePush() lo encuentre
    try {
      await setDoc(
        doc(db, 'perfiles', user.uid),
        { 
          fcmToken: token,
          fcmTokenUpdated: serverTimestamp()
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('[push] write perfiles fcmToken', e);
    }

    // 3. En perfiles/config/messaging
    try {
      await setDoc(
        doc(db, 'perfiles', user.uid, 'config', 'messaging'),
        { token, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('[push] write perfiles/config/messaging', e);
    }

    // 4. En usuarios (colección alternativa)
    try {
      await setDoc(
        doc(db, 'usuarios', user.uid),
        { 
          fcmToken: token,
          fcmTokenUpdated: serverTimestamp()
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('[push] write usuarios fcmToken', e);
    }

    // 5. Tienda (solo comerciante). Si no existe/permiso, lo ignoramos.
    try {
      await setDoc(
        doc(db, 'tiendas', user.uid, 'config', 'messaging'),
        { token, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('[push] write tiendas/config/messaging (ignorado si no es comerciante)', e);
    }

    // 6. Colección 'tokens' con subcolección por uid para fácil búsqueda
    try {
      await setDoc(
        doc(db, 'tokens', user.uid, 'devices', token),
        { token, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('[push] write tokens/devices', e);
    }

    // 👇 Evita CORS en localhost (tu error actual).
    // En producción sí puedes reactivar para depurar tokens inválidos.
    if (!IS_LOCAL) {
      try {
        const idt = await user.getIdToken();
        await postJSON(`${API_BASE}/fcm/subscribe`, { token }, idt);
      } catch (e) {
        console.warn('[push] /fcm/subscribe (ignorado)', e);
      }
    }

    console.log('[push] token guardado correctamente en todas las ubicaciones');
  } catch (e) {
    console.warn('[push] error suscripción', e);
  }
}

/* ------------------- Notificaciones Firestore: badge real (no vistos) ------------------- */
let _unsubCount = null;

function listenUnreadCount(user) {
  try {
    if (_unsubCount) { _unsubCount(); _unsubCount = null; }

    const qCount = query(
      collection(db, 'notificaciones', user.uid, 'items'),
      where('visto', '==', false)
    );

    _unsubCount = onSnapshot(
      qCount,
      (snap) => setBadgeCount(snap.size),
      (err) => console.warn('[badge] listener', err)
    );
  } catch (e) {
    console.warn('[badge] error', e);
  }
}

/* ------------------- Bandeja (Firestore) → toasts en tiempo real ------------------- */
let _unsubInbox = null;

function listenInboxToasts(user) {
  try {
    if (_unsubInbox) { _unsubInbox(); _unsubInbox = null; }

    const qInbox = query(
      collection(db, 'notificaciones', user.uid, 'items'),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    let firstSnapshot = true;

    _unsubInbox = onSnapshot(
      qInbox,
      (snap) => {
        // Primera carga: NO mostrar toasts viejas
        if (firstSnapshot) {
          firstSnapshot = false;
          return;
        }

        snap.docChanges().forEach((ch) => {
          if (ch.type !== 'added') return;

          const n = ch.doc.data() || {};
          const tipo = n.tipo || '';
          const estado = n.estado || '';
          const pedidoId = n.pedidoId || '';
          const txt = n.mensaje || n.titulo || 'Notificación';

          if (tipo === 'pedido_estado' && estado === 'aceptado' && pedidoId) {
            showToast(txt, {
              actionText: 'Pagar ahora',
              onAction: () => {
                if (typeof window.openCheckout === 'function') {
                  window.openCheckout(pedidoId);
                } else {
                  location.href = `./productos.html?pedido=${encodeURIComponent(pedidoId)}#pago`;
                }
              },
            });
          } else {
            showToast(txt);
          }
        });
      },
      (err) => console.warn('[inbox] listener', err)
    );
  } catch (e) {
    console.warn('[inbox] error', e);
  }
}

/* --------------- Mensajes FCM en primer plano (sin pasar por Firestore) --------------- */
let _onMessageReady = false;

(async () => {
  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) return;
    if (_onMessageReady) return;
    _onMessageReady = true;

    const messaging = getMessaging(app);

    onMessage(messaging, (payload) => {
      const title    = payload?.notification?.title || payload?.data?.title || 'Notificación';
      const body     = payload?.notification?.body  || payload?.data?.body  || '';
      const tipo     = payload?.data?.tipo || '';
      const estado   = payload?.data?.estado || '';
      const pedidoId = payload?.data?.pedidoId || '';

      showToast(body ? `${title} — ${body}` : title);
      // Esto sí suma porque FCM foreground puede NO crear doc en Firestore
      incBadge();

      if (tipo === 'pedido_estado' && estado === 'aceptado' && pedidoId) {
        if (typeof window.openCheckout === 'function') window.openCheckout(pedidoId);
      }
    });
  } catch (e) {
    console.warn('[push] onMessage', e);
  }
})();

/* --------------------------- API pública para el HTML --------------------------- */
window.enablePush = async function enablePush() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  const u = auth.currentUser;
  if (!u) return;
  await subscribeFCM(u, { prompt: true }); // aquí sí pedimos permiso (llamar desde botón)
};

/* ----------------------------- Arranque tras login ----------------------------- */
let _startedForUid = null;

onAuthStateChanged(auth, (u) => {
  if (!u) return;

  // Evita reenganchar listeners si Firebase dispara el callback varias veces
  if (_startedForUid === u.uid) return;
  _startedForUid = u.uid;

  // Badge real de no vistos (Firestore)
  listenUnreadCount(u);

  // Toasts (Firestore) en tiempo real
  listenInboxToasts(u);

  // Auto-suscripción SOLO si ya está granted (sin pedir permiso)
  if ('serviceWorker' in navigator && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      subscribeFCM(u, { prompt: false });
    }
  }
});

console.log('📱 Notifications module loaded (cliente + comerciante)');