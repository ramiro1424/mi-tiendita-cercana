// public/js/chat-pedido.js
// ============================================================
// 💬 CHAT POR PEDIDO - VERSIÓN COMPLETA (COMERCIANTE)
// ============================================================

import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, serverTimestamp,
  collection, addDoc, onSnapshot, query, orderBy, limit,
  where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ============================================================
// 🛠️ HELPERS DOM
// ============================================================

const $ = (s) => document.querySelector(s);

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

function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// 🔔 CREAR NOTIFICACIÓN EN BANDEJA
// ============================================================

async function crearNotificacionBandeja(usuarioId, data) {
  try {
    if (!usuarioId) return;
    const notifRef = collection(db, 'notificaciones', usuarioId, 'items');
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
// 🔄 ESTADO DEL CHAT
// ============================================================

let state = {
  uid: null,
  pedidoId: null,
  tiendaId: null,
  clienteId: null,
  clienteNombre: 'Cliente',
  unsubMessages: null,
  nombreComerciante: 'Comerciante'
};

// Elementos del DOM
const modalBackdrop = $('#chat-modal');
const messagesBox = $('#messages-container');
const inputContainer = $('#message-input-container');
const inputMsg = $('#message-input');
const btnSend = $('#send-message');
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
  
  const pedidosRef = collection(db, 'pedidos');
  const q = query(
    pedidosRef,
    where('comercianteId', '==', comercianteId),
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
    const estadoLabel = conv.estado === 'pendiente' ? '⏳' : 
                        conv.estado === 'en_camino' ? '🚚' :
                        conv.estado === 'recibido' ? '✅' : '📦';
    
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
  
  const totalNoLeidos = conversaciones.reduce((sum, conv) => sum + (conv.mensajesNoLeidos || 0), 0);
  
  if (totalNoLeidos > 0) {
    chatBadge.textContent = totalNoLeidos > 99 ? '99+' : totalNoLeidos;
    chatBadge.style.display = 'inline-flex';
  } else {
    chatBadge.style.display = 'none';
  }
}

// ============================================================
// 💬 ABRIR MODAL DE CHAT
// ============================================================

function openModal() {
  show(modalBackdrop, true);
  if (state.uid) {
    escucharConversacionesActivas(state.uid);
  }
}

function closeModal() {
  show(modalBackdrop, false);
  if (state.pedidoId && state.uid) {
    marcarMensajesLeidos(state.pedidoId, state.uid);
  }
  if (state.unsubMessages) {
    state.unsubMessages();
    state.unsubMessages = null;
  }
}

// ============================================================
// 📨 CARGAR CHAT POR PEDIDO
// ============================================================

export async function openChatForPedido(pedidoId) {
  if (!pedidoId) return;
  
  if (!state.uid) {
    await new Promise((resolve) => {
      const off = onAuthStateChanged(auth, (u) => {
        if (u) state.uid = u.uid;
        off();
        resolve();
      });
    });
  }
  if (!state.uid) {
    alert('Debes iniciar sesión para chatear');
    return;
  }

  try {
    const pedidoRef = doc(db, 'pedidos', pedidoId);
    const pedidoSnap = await getDoc(pedidoRef);
    
    if (!pedidoSnap.exists()) {
      alert('El pedido no existe');
      return;
    }
    
    const pedidoData = pedidoSnap.data();
    const uid = state.uid;
    
    const esComerciante = pedidoData.comercianteId === uid || pedidoData.tiendaId === uid;
    const esCliente = pedidoData.clienteId === uid || pedidoData.uid === uid;
    
    if (!esComerciante && !esCliente) {
      alert('No tienes acceso a este pedido');
      return;
    }
    
    state.pedidoId = pedidoId;
    state.tiendaId = pedidoData.comercianteId || pedidoData.tiendaId;
    state.clienteId = pedidoData.clienteId || pedidoData.uid;
    state.clienteNombre = pedidoData.clienteNombre || 'Cliente';
    
    if (pedidoData.estado === 'cancelado' || pedidoData.estado === 'rechazado') {
      alert('Este pedido fue cancelado. No se pueden enviar mensajes.');
      if (inputMsg) { inputMsg.disabled = true; inputMsg.placeholder = '❌ Pedido cancelado'; }
      if (btnSend) btnSend.disabled = true;
    } else {
      if (inputMsg) { inputMsg.disabled = false; inputMsg.placeholder = 'Escribe un mensaje...'; }
      if (btnSend) btnSend.disabled = false;
    }
    
    if (pedidoData.estado === 'recibido' || pedidoData.estado === 'entregado' || pedidoData.estado === 'completado') {
      if (inputMsg) { inputMsg.disabled = true; inputMsg.placeholder = '📦 Pedido completado - Solo lectura'; }
      if (btnSend) btnSend.disabled = true;
    }
    
  } catch (error) {
    console.error('Error verificando pedido:', error);
    alert('Error al verificar el pedido');
    return;
  }

  const noChatSelected = document.querySelector('.no-chat-selected');
  if (noChatSelected) show(noChatSelected, false);
  if (inputContainer) show(inputContainer, true);

  const clientInfo = document.getElementById('chat-current-client');
  if (clientInfo) {
    const span = clientInfo.querySelector('.client-info span');
    if (span) {
      const esComerciante = state.uid === state.tiendaId;
      const nombre = esComerciante ? state.clienteNombre : 'Comerciante';
      span.textContent = `${nombre} - #${pedidoId.slice(-6).toUpperCase()}`;
    }
  }

  listenMessages(pedidoId);
  openModal();
  await marcarMensajesLeidos(pedidoId, state.uid);
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
        texto: d.texto || d.mensaje || d.text || '',
        tipo: d.tipo || 'text',
        mediaUrl: d.mediaUrl || '',
        creadoEn: d.creadoEn,
        nombre: d.nombre || 'Usuario'
      });
    });
    scrollBottom(messagesBox);
    if (state.uid) {
      marcarMensajesLeidos(pedidoId, state.uid);
    }
  }, (error) => {
    console.error('Error escuchando mensajes:', error);
    if (messagesBox) {
      messagesBox.innerHTML = `
        <div style="text-align:center;padding:20px;color:#ef4444;">
          <i class="fas fa-exclamation-circle"></i>
          <p style="font-size:0.85rem;">Error al cargar mensajes</p>
        </div>
      `;
    }
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

  const nombre = document.createElement('div');
  nombre.textContent = mine ? 'Tú' : (m.nombre || 'Usuario');
  nombre.style.fontSize = '0.7rem';
  nombre.style.fontWeight = '600';
  nombre.style.color = '#6b7280';
  nombre.style.marginBottom = '4px';
  bubble.appendChild(nombre);

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
    p.style.fontSize = '0.9rem';
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
  
  if (inputMsg?.disabled) {
    alert('No puedes enviar mensajes en este pedido');
    return;
  }

  try {
    const pedidoRef = doc(db, 'pedidos', state.pedidoId);
    const pedidoSnap = await getDoc(pedidoRef);
    if (!pedidoSnap.exists()) {
      alert('El pedido no existe');
      return;
    }
    const pedidoData = pedidoSnap.data();
    const esComerciante = pedidoData.comercianteId === state.uid || pedidoData.tiendaId === state.uid;
    const esCliente = pedidoData.clienteId === state.uid || pedidoData.uid === state.uid;
    
    if (!esComerciante && !esCliente) {
      alert('No tienes permiso para enviar mensajes');
      return;
    }
    
    if (pedidoData.estado === 'cancelado' || pedidoData.estado === 'rechazado') {
      alert('No puedes enviar mensajes en un pedido cancelado');
      return;
    }
    
    const msgRef = collection(db, 'pedidos', state.pedidoId, 'mensajes');
    await addDoc(msgRef, {
      texto: txt,
      uid: state.uid,
      nombre: auth.currentUser?.displayName || auth.currentUser?.email || 
              (esComerciante ? state.nombreComerciante : state.clienteNombre || 'Usuario'),
      creadoEn: serverTimestamp()
    });

    await updateDoc(doc(db, 'pedidos', state.pedidoId), {
      lastMsg: txt.slice(0, 120),
      lastTs: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });

    if (esComerciante && state.clienteId) {
      await crearNotificacionCliente(state.clienteId, state.pedidoId, txt);
    } else if (esCliente && state.tiendaId) {
      await crearNotificacionComerciante(state.tiendaId, state.pedidoId, txt);
    }

    inputMsg.value = '';
    
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    alert('Error al enviar el mensaje');
  }
}

// ============================================================
// 🔔 NOTIFICACIONES
// ============================================================

async function crearNotificacionCliente(clienteId, pedidoId, mensaje) {
  try {
    await crearNotificacionBandeja(clienteId, {
      tipo: 'mensaje_nuevo',
      titulo: '💬 Nuevo mensaje del comerciante',
      mensaje: mensaje.slice(0, 100),
      pedidoId: pedidoId,
      comercianteId: state.uid,
      enlace: `/chat-cliente.html?pedido=${pedidoId}`
    });
    console.log('✅ Notificación creada para cliente');
  } catch (error) {
    console.warn('Error notificando al cliente:', error);
  }
}

async function crearNotificacionComerciante(comercianteId, pedidoId, mensaje) {
  try {
    await crearNotificacionBandeja(comercianteId, {
      tipo: 'mensaje_nuevo',
      titulo: '💬 Nuevo mensaje del cliente',
      mensaje: mensaje.slice(0, 100),
      pedidoId: pedidoId,
      clienteId: state.uid,
      enlace: `/chat.html?pedido=${pedidoId}`
    });
    console.log('✅ Notificación creada para comerciante');
  } catch (error) {
    console.warn('Error notificando al comerciante:', error);
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
    
    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`✅ ${promises.length} mensajes marcados como leídos`);
    }
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

btnCloseChat?.addEventListener('click', () => closeModal());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

modalBackdrop?.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

// ============================================================
// 🚀 INICIALIZAR
// ============================================================

onAuthStateChanged(auth, (user) => {
  if (user) {
    state.uid = user.uid;
    getDoc(doc(db, 'perfiles', user.uid)).then(snap => {
      if (snap.exists()) {
        state.nombreComerciante = snap.data().nombre || 'Comerciante';
      }
    });
  }
});

window.openChatForPedido = openChatForPedido;
window.closeChatModal = closeModal;

console.log('💬 Chat por pedido cargado correctamente');