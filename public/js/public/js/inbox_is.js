// public/js/inbox_is.js
// Inbox por usuario: /inbox/{uid}/items/{mensajeId}

import { db, auth } from './firebase-config.js';
import {
  collection, onSnapshot, query, orderBy, limit, addDoc, serverTimestamp, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeInbox = null;

// Construye la referencia a la bandeja del usuario
function userInboxRef(uid) {
  return collection(db, 'inbox', uid, 'items');
}

// Suscribe el listener cuando hay sesión
export function startInboxListener(renderFn) {
  stopInboxListener(); // por si ya había uno
  const uid = auth?.currentUser?.uid;
  if (!uid) return;

  const q = query(userInboxRef(uid), orderBy('createdAt', 'desc'), limit(50));
  unsubscribeInbox = onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Pasa los items a tu UI
    try { renderFn?.(items); } catch(e) { console.warn('renderFn error:', e); }
  }, (err) => {
    console.error('inbox listener error:', err);
  });
}

// Cancela el listener
export function stopInboxListener() {
  if (typeof unsubscribeInbox === 'function') {
    unsubscribeInbox();
    unsubscribeInbox = null;
  }
}

// Enviar una notificación a MI bandeja
export async function pushToMyInbox(payload = {}) {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error('Sin sesión');
  await addDoc(userInboxRef(uid), {
    titulo: payload.titulo || 'Notificación',
    cuerpo: payload.cuerpo || '',
    createdAt: serverTimestamp(),
    leido: false,
    tipo: payload.tipo || 'info',
    data: payload.data || null
  });
}

// Marcar como leído
export async function markAsRead(id) {
  const uid = auth?.currentUser?.uid;
  if (!uid || !id) return;
  await updateDoc(doc(db, 'inbox', uid, 'items', id), { leido: true });
}

/* ---------- Auto-inicio cuando cambia la sesión ---------- */
auth.onAuthStateChanged((u) => {
  if (u) {
    // Puedes pasar una función que pinte los ítems en tu UI
    startInboxListener(window.renderInboxItems);
  } else {
    stopInboxListener();
  }
});

// Exponer helpers al HTML si usas onclick="..."
window.pushToMyInbox = pushToMyInbox;
window.markAsRead = markAsRead;
