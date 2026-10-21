// public/js/chat-pedido.js
// ============================================================
// 💬 CHAT POR PEDIDO - VERSIÓN COMPLETA
// ============================================================

import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, setDoc, serverTimestamp,
  collection, addDoc, onSnapshot, query, orderBy, limit,
  where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ============================================================
// 🛠️ HELPERS DOM
// ============================================================

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function show(el, on = true) {
  if (el) { el.style.display = on ? '' : 'none'; }
}

function scrollBottom(container) {
  try { container.scrollTop = container.scrollHeight + 1000; } catch {}
}

function fmtTime(ts) {
  try {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function fmtFecha(ts) {
  try {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('es-CO', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch { return ''; }
}

// ============================================================
// 🔔 CREAR NOTIFICACIÓN EN BANDEJA
// ============================================================

async function crearNotificacionBandeja(comercianteId, data) {
  try {
    if (!comercianteId) return;
    const notifRef = collection(db, 'notificaciones', comercianteId, 'items');
    await addDoc(notifRef, {
      ...data,
      leida: false,
      creadoEn: serverTimestamp()
    });
    console.log('✅ Notificación creada en bandeja');
  } catch (error) {
    console.warn('Error creando notificación en bandeja:', error);
  }
}

// ============================================================
// 📨 ENVIAR NOTIFICACIÓN PUSH AL COMERCIANTE
// ============================================================

async function enviarPushComerciante(comercianteId, titulo, cuerpo, pedidoId) {
  try {
    // Buscar token FCM del comerciante
    const perfilRef = doc(db, 'perfiles', comercianteId);
    const perfilSnap = await getDoc(perfilRef);
    
    if (!perfilSnap.exists()) return;
    
    const token = perfilSnap.data().fcmToken || perfilSnap.data().token;
    if (!token) return;
    
    // Enviar notificación push
    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${window.FCM_SERVER_KEY || ''}`
      },
      body: JSON.stringify({
        to: token,
        notification: {
          title: titulo,
          body: cuerpo,
          icon: '/favicon.png',
          sound: 'default',
          badge: '1'
        },
        data: {
          pedidoId: pedidoId || '',
          type: 'chat'
        }
      })
    });
    
    console.log('✅ Push enviado al comerciante');
  } catch (error) {
    console.warn('Error enviando push al comerciante:', error);
  }
}

// ============================================================
// 🔄 ESTADO DEL CHAT
// ============================================================

let state = {
  uid: null,
  pedidoId: null,
  tiendaId: null,
  clienteId: null,
  unsubMessages: null,
  nombreComerciante: 'Comerciante'
};

// Elementos del DOM
const modalBackdrop = $('#chat-modal');
const messagesBox = $('#messages-container');
const inputContainer = $('#message-input-container');
const inputMsg = $('#message-input');
const btnSend = $('#send-message');
const btnOpenChat = $('#chat-btn');
const btnCloseChat = $('#close-chat');
const convList = $('#conversations-list');
const chatBadge = $('#chat-notification');

// ============================================================
// 📋 LISTA DE CONVERSACIONES ACTIVAS
// ============================================================

let conversacionesActivas = [];
let unsubscribeConversaciones = null;

export function escucharConversacionesActivas(comercianteId) {
  if (unsubscribeConversaciones) {
    unsubscribeConversaciones();
    unsubscribeConversaciones = null;
  }
  
  if (!comercianteId || !convList) return;
  
  // Buscar pedidos con mensajes activos
  const pedidosRef = collection(db, 'pedidos');
  const q = query(
    pedidosRef,
    where('tiendaId', '==', comercianteId),
    orderBy('lastTs', 'desc')
  );
  
  unsubscribeConversaciones = onSnapshot(q, (snapshot) => {
    const conversaciones = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.lastMsg) {
        conversaciones.push({
          id: doc.id,
          clienteId: data.clienteId || data.uid,
          clienteNombre: data.clienteNombre || 'Cliente',
          lastMsg: data.lastMsg,
          lastTs: data.lastTs,
          estado: data.estado || 'pendiente'
        });
      }
    });
    
    conversacionesActivas = conversaciones;
    renderizarListaConversaciones(conversaciones);
    actualizarBadgeChat(conversaciones);
  }, (error) => {
    console.warn('Error escuchando conversaciones:', error);
  });
}

// ============================================================
// 📋 RENDERIZAR LISTA DE CONVERSACIONES
// ============================================================

function renderizarListaConversaciones(conversaciones) {
  if (!convList) return;
  
  if (conversaciones.length === 0) {
    convList.innerHTML = `
      <div class="empty-conversations" style="text-align:center;padding:20px;color:#6b7280;">
        <i class="fas fa-comment-slash" style="font-size:1.5rem;opacity:0.3;display:block;margin-bottom:8px;"></i>
        <p style="font-size:0.85rem;">No hay conversaciones activas</p>
      </div>
    `;
    return;
  }
  
  convList.innerHTML = conversaciones.map(conv => {
    const noLeidos = conv.mensajesNoLeidos || 0;
    const initial = (conv.clienteNombre || 'C')[0].toUpperCase();
    const estadoLabel = conv.estado === 'pendiente' ? '⏳' : '✅';
    
    return `
      <div class="conversation-item" data-pedido="${conv.id}" data-cliente="${conv.clienteId}">
        <div class="conversation-avatar">
          <span>${initial}</span>
          ${noLeidos > 0 ? `<span class="badge-unread">${noLeidos}</span>` : ''}
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${conv.clienteNombre || 'Cliente'}</div>
          <div class="conversation-last">${conv.lastMsg || '...'}</div>
        </div>
        <div class="conversation-meta">
          <div class="conversation-time">${formatearTiempo(conv.lastTs)}</div>
          <div class="conversation-estado">${estadoLabel}</div>
        </div>
      </div>
    `;
  }).join('');
  
  // Eventos de clic
  convList.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => {
      const pedidoId = item.dataset.pedido;
      if (pedidoId) {
        openChatForPedido(pedidoId);
      }
    });
  });
}

// ============================================================
// 🔔 ACTUALIZAR BADGE DE CHAT
// ============================================================

function actualizarBadgeChat(conversaciones) {
  if (!chatBadge) return;
  
  // Contar mensajes no leídos (simulado)
  const totalNoLeidos = conversaciones.reduce((sum, conv) => sum + (conv.mensajesNoLeidos || 0), 0);
  
  if (totalNoLeidos > 0) {
    chatBadge.textContent = totalNoLeidos > 99 ? '99+' : totalNoLeidos;
    chatBadge.style.display = 'inline-flex';
    chatBadge.classList.add('pop');
  } else {
    chatBadge.style.display = 'none';
    chatBadge.classList.remove('pop');
  }
}

// ============================================================
// 💬 ABRIR MODAL DE CHAT
// ============================================================

function openModal() {
  show(modalBackdrop, true);
  // Actualizar lista de conversaciones al abrir
  if (state.uid) {
    escucharConversacionesActivas(state.uid);
  }
}

function closeModal() {
  show(modalBackdrop, false);
  // Marcar mensajes como leídos al cerrar
  if (state.pedidoId && state.uid) {
    marcarMensajesLeidos(state.pedidoId, state.uid);
  }
}

// ============================================================
// 📨 CARGAR CHAT POR PEDIDO
// ============================================================

export async function openChatForPedido(pedidoId) {
  if (!pedidoId) return;
  
  // Asegurar sesión
  if (!state.uid) {
    await new Promise((resolve) => {
      const off = onAuthStateChanged(auth, (u) => {
        if (u) state.uid = u.uid;
        off();
        resolve();
      });
    });
  }
  if (!state.uid) return;

  // ============================================================
  // 🔥 NUEVA VALIDACIÓN DE ESTADO DEL PEDIDO
  // ============================================================
  try {
    const pedidoRef = doc(db, 'pedidos', pedidoId);
    const pedidoSnap = await getDoc(pedidoRef);
    
    if (!pedidoSnap.exists()) {
      alert('El pedido no existe');
      return;
    }
    
    const pedidoData = pedidoSnap.data();
    
    // ❌ BLOQUEAR SOLO PEDIDOS CANCELADOS
    if (pedidoData.estado === 'cancelado') {
      alert('Este pedido fue cancelado. No se pueden enviar mensajes.');
      return;
    }
    
    // ✅ PERMITIR PEDIDOS ENTREGADOS (modo solo lectura)
    if (pedidoData.estado === 'entregado') {
      console.log('ℹ️ Pedido entregado - modo solo lectura');
      // Deshabilitar input para evitar envío de mensajes
      if (inputMsg) inputMsg.disabled = true;
      if (btnSend) btnSend.disabled = true;
      if (inputMsg) inputMsg.placeholder = 'Pedido entregado - solo lectura';
    } else {
      // Habilitar input para pedidos activos
      if (inputMsg) inputMsg.disabled = false;
      if (btnSend) btnSend.disabled = false;
      if (inputMsg) inputMsg.placeholder = 'Escribir mensaje...';
    }
    
  } catch (error) {
    console.error('Error verificando pedido:', error);
    alert('Error al verificar el pedido');
    return;
  }

  state.pedidoId = pedidoId;
  state.tiendaId = state.uid;

  try {
    const { clienteId, clienteNombre } = await ensureChatForPedido(pedidoId);
    state.clienteId = clienteId;
    state.clienteNombre = clienteNombre || 'Cliente';

    // UI
    show($('.no-chat-selected'), false);
    show(inputContainer, true);

    // Título del chat
    const header = $('#chat-current-client .client-info span');
    if (header) {
      header.textContent = `${clienteNombre || 'Cliente'} - #${pedidoId.slice(-6).toUpperCase()}`;
    }

    // Listar mensajes
    listenMessages(pedidoId);
    openModal();
    
    // Marcar mensajes como leídos
    await marcarMensajesLeidos(pedidoId, state.uid);
    
  } catch (e) {
    console.warn('No se pudo abrir chat:', e);
    show(inputContainer, false);
  }
}

// ============================================================
// 🔍 OBTENER DATOS DEL PEDIDO
// ============================================================

async function ensureChatForPedido(pedidoId) {
  const pSnap = await getDoc(doc(db, 'pedidos', pedidoId));
  if (!pSnap.exists()) throw new Error('Pedido no existe');
  const pedido = pSnap.data() || {};
  const clienteId = pedido.clienteId || pedido.uid || pedido.userId || null;
  const clienteNombre = pedido.clienteNombre || pedido.cliente || 'Cliente';
  if (!clienteId) throw new Error('Pedido sin clienteId');
  return { clienteId, clienteNombre };
}

// ============================================================
// 📨 ESCUCHAR MENSAJES
// ============================================================

function listenMessages(pedidoId) {
  if (state.unsubMessages) {
    try { state.unsubMessages(); } catch {}
    state.unsubMessages = null;
  }
  clearMessages();
  if (!messagesBox) return;

  const msgsRef = collection(db, 'pedidos', pedidoId, 'mensajes');
  const qy = query(msgsRef, orderBy('creadoEn', 'asc'), limit(200));

  state.unsubMessages = onSnapshot(qy, (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    clearMessages();
    snap.forEach(docSnap => {
      const d = docSnap.data() || {};
      appendMessage({
        id: docSnap.id,
        uid: d.uid,
        texto: d.texto || '',
        tipo: d.tipo || 'text',
        mediaUrl: d.mediaUrl || '',
        creadoEn: d.creadoEn
      });
    });
  });
}

// ============================================================
// 📤 RENDERIZAR MENSAJES
// ============================================================

function clearMessages() {
  if (!messagesBox) return;
  messagesBox.innerHTML = '';
}

function appendMessage(m) {
  if (!messagesBox) return;
  messagesBox.appendChild(renderMessage(m));
  scrollBottom(messagesBox);
}

function renderMessage(m) {
  const li = document.createElement('div');
  li.className = 'chat-message';
  li.style.display = 'flex';
  li.style.gap = '8px';
  li.style.margin = '6px 0';

  const mine = (m.uid === state.uid);
  li.style.justifyContent = mine ? 'flex-end' : 'flex-start';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.maxWidth = '70%';
  bubble.style.padding = '10px 14px';
  bubble.style.borderRadius = '12px';
  bubble.style.background = mine ? '#DCFCE7' : '#F3F4F6';
  bubble.style.border = '1px solid #e5e7eb';
  bubble.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';

  if (m.tipo === 'img' && m.mediaUrl) {
    const img = document.createElement('img');
    img.src = m.mediaUrl;
    img.alt = 'imagen';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '8px';
    img.style.maxHeight = '200px';
    img.style.objectFit = 'cover';
    bubble.appendChild(img);
  }
  
  if (m.texto) {
    const p = document.createElement('div');
    p.textContent = m.texto;
    p.style.wordBreak = 'break-word';
    bubble.appendChild(p);
  }

  const meta = document.createElement('div');
  meta.textContent = fmtTime(m.creadoEn);
  meta.style.fontSize = '11px';
  meta.style.color = '#6b7280';
  meta.style.marginTop = '4px';
  meta.style.textAlign = 'right';
  bubble.appendChild(meta);

  li.appendChild(bubble);
  return li;
}

// ============================================================
// 📤 ENVIAR MENSAJE
// ============================================================

async function sendText() {
  const txt = (inputMsg?.value || '').trim();
  if (!txt || !state.pedidoId || !state.uid) return;
  
  // Verificar si el input está deshabilitado (pedido entregado)
  if (inputMsg?.disabled) {
    alert('Este pedido ya fue entregado. No se pueden enviar más mensajes.');
    return;
  }

  // Guardar mensaje
  const msgRef = collection(db, 'pedidos', state.pedidoId, 'mensajes');
  await addDoc(msgRef, {
    uid: state.uid,
    texto: txt,
    tipo: 'text',
    creadoEn: serverTimestamp()
  });

  // Actualizar cabecera del pedido
  try {
    await updateDoc(doc(db, 'pedidos', state.pedidoId), {
      lastMsg: txt.slice(0, 120),
      lastTs: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
  } catch {}

  // 🔔 NOTIFICAR AL CLIENTE
  if (state.clienteId) {
    await crearNotificacionCliente(state.clienteId, state.pedidoId, txt);
  }

  inputMsg.value = '';
}

// ============================================================
// 🔔 NOTIFICAR AL CLIENTE
// ============================================================

async function crearNotificacionCliente(clienteId, pedidoId, mensaje) {
  try {
    // 1. Notificación en la bandeja del cliente
    await crearNotificacionBandeja(clienteId, {
      tipo: 'mensaje_nuevo',
      titulo: '💬 Nuevo mensaje del comerciante',
      mensaje: mensaje.slice(0, 100),
      pedidoId: pedidoId,
      comercianteId: state.uid,
      enlace: `/chat-cliente.html?pedido=${pedidoId}`
    });
    
    // 2. Notificación push al cliente
    await enviarPushCliente(clienteId, '📦 Actualización de tu pedido', mensaje, pedidoId);
    
    // 3. Actualizar badge de notificaciones (si existe función global)
    if (window.actualizarBadgeNotificaciones) {
      window.actualizarBadgeNotificaciones();
    }
    
  } catch (error) {
    console.warn('Error notificando al cliente:', error);
  }
}

async function enviarPushCliente(clienteId, titulo, cuerpo, pedidoId) {
  try {
    const perfilRef = doc(db, 'perfiles', clienteId);
    const perfilSnap = await getDoc(perfilRef);
    
    if (!perfilSnap.exists()) return;
    
    const token = perfilSnap.data().fcmToken || perfilSnap.data().token;
    if (!token) return;
    
    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${window.FCM_SERVER_KEY || ''}`
      },
      body: JSON.stringify({
        to: token,
        notification: {
          title: titulo,
          body: cuerpo,
          icon: '/favicon.png',
          sound: 'default'
        },
        data: {
          pedidoId: pedidoId || '',
          type: 'chat'
        }
      })
    });
  } catch (error) {
    console.warn('Error enviando push al cliente:', error);
  }
}

// ============================================================
// ✅ MARCAR MENSAJES COMO LEÍDOS
// ============================================================

async function marcarMensajesLeidos(pedidoId, uid) {
  try {
    const msgsRef = collection(db, 'pedidos', pedidoId, 'mensajes');
    const q = query(msgsRef, where('uid', '!=', uid), where('leido', '==', false));
    const snapshot = await getDocs(q);
    
    const promises = [];
    snapshot.forEach((doc) => {
      promises.push(updateDoc(doc.ref, { leido: true }));
    });
    
    await Promise.all(promises);
    console.log('✅ Mensajes marcados como leídos');
  } catch (error) {
    console.warn('Error marcando mensajes como leídos:', error);
  }
}

// ============================================================
// 🛠️ UTILIDADES
// ============================================================

function formatearTiempo(fecha) {
  if (!fecha) return '';
  const ahora = new Date();
  const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
  const diff = ahora - d;
  
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} h`;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

// ============================================================
// 🎮 EVENTOS UI
// ============================================================

btnSend?.addEventListener('click', (e) => { e.preventDefault(); sendText(); });

inputMsg?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

btnOpenChat?.addEventListener('click', () => {
  openModal();
  if (state.uid) {
    escucharConversacionesActivas(state.uid);
  }
});

btnCloseChat?.addEventListener('click', () => closeModal());

// Cerrar con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Cerrar al hacer clic fuera del modal
modalBackdrop?.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

// ============================================================
// 🔗 AUTO-ABRIR POR HASH (#pedido=ID)
// ============================================================

(function autoOpenByHash() {
  try {
    const h = location.hash || '';
    const m = h.match(/pedido=([^&]+)/i);
    if (m && m[1]) {
      const pedidoId = decodeURIComponent(m[1]);
      onAuthStateChanged(auth, (u) => {
        if (!u) return;
        state.uid = u.uid;
        // Obtener nombre del comerciante
        getDoc(doc(db, 'perfiles', u.uid)).then(snap => {
          if (snap.exists()) {
            state.nombreComerciante = snap.data().nombre || 'Comerciante';
          }
        });
        setTimeout(() => openChatForPedido(pedidoId), 500);
      });
    }
  } catch {}
})();

// ============================================================
// 🚀 INICIALIZAR AL AUTENTICAR
// ============================================================

onAuthStateChanged(auth, (user) => {
  if (user) {
    state.uid = user.uid;
    // Cargar nombre del comerciante
    getDoc(doc(db, 'perfiles', user.uid)).then(snap => {
      if (snap.exists()) {
        state.nombreComerciante = snap.data().nombre || 'Comerciante';
      }
    });
    // Iniciar escucha de conversaciones si el modal está abierto
    if (modalBackdrop && modalBackdrop.style.display !== 'none') {
      escucharConversacionesActivas(user.uid);
    }
  }
});

// ============================================================
// 🌐 FUNCIONES GLOBALES
// ============================================================

window.openChatForPedido = openChatForPedido;
window.closeChatModal = closeModal;

console.log('💬 Chat por pedido cargado correctamente');  