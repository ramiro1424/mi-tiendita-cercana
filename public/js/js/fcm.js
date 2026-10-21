// public/js/fcm.js
import { app } from './firebase-config.js';
import { auth } from './firebase-config.js';
import {
  getMessaging, isSupported, getToken, onMessage
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';

const VAPID_KEY = 'BMgRazEsUxbwj4fSjhEDPA99kNjPkwJVBcvjAkOxW0xfiPNrNLwMIf7wQcv0eZrgfs2EZeztxekbq0IoqAAq5hA'; // <- TU clave pública

let messaging;
let swReg;

/** Registra el service worker y pide permiso de notificación */
export async function enablePush() {
  try {
    if (!(await isSupported())) {
      console.warn('[FCM] Navegador no soporta FCM');
      return null;
    }

    // 1) Registrar SW (raíz)
    swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });

    // 2) Pedir permiso
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('[FCM] Permiso denegado');
      return null;
    }

    // 3) Obtener token
    messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return null;

    // 4) Guardar token en el backend
    await saveToken(token);
    console.log('[FCM] Token guardado:', token.slice(0, 12) + '…');

    // 5) Mensajes en primer plano
    onMessage(messaging, (payload) => {
      console.log('[FCM] onMessage:', payload);
      const n = payload?.notification || {};
      // muestra un toast simple (usa tu propio toast si quieres)
      try {
        window.showToast?.(n.title || 'Notificación', n.body || '');
      } catch {}
      // badge simple en campana
      try {
        const b = document.querySelector('#notification-icon .notification-badge');
        if (b) { b.style.display = 'inline-grid'; b.textContent = String(Number(b.textContent||0)+1); }
      } catch {}
    });

    return token;
  } catch (e) {
    console.error('[FCM] enablePush error:', e);
    return null;
  }
}

export async function disablePush(token) {
  try {
    if (!token) return;
    const idToken = await auth.currentUser?.getIdToken();
    await fetch('/api/fcm/subscribe', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body: JSON.stringify({ token })
    });
  } catch (e) {
    console.warn('[FCM] disablePush:', e);
  }
}

async function saveToken(token) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('No auth token');

  await fetch('/api/fcm/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + idToken
    },
    body: JSON.stringify({ token })
  });
}

// Exponer helpers para UI si quieres enganchar a un botón
window.enablePush = enablePush;
window.disablePush = disablePush;
