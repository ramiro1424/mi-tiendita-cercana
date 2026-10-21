// public/js/cliente-notificaciones.js
// Módulo para que el cliente reciba notificaciones y vea el estado de su pedido en tiempo real
// Conectado con: productos.js, panel-comerciante.js, notifications.js

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
  doc, onSnapshot, getDoc, serverTimestamp,
  collection, query, where, orderBy, limit, addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let pedidoListener = null;
let pedidoIdActual = null;

// ============================================================
// 1. ESCUCHAR CAMBIOS EN EL PEDIDO (Firestore en tiempo real)
// ============================================================
function escucharPedidoCliente(pedidoId) {
  // Limpiar listener anterior
  if (pedidoListener) {
    pedidoListener();
    pedidoListener = null;
  }
  
  if (!pedidoId) return;
  pedidoIdActual = pedidoId;
  
  console.log('🔔 Escuchando pedido:', pedidoId);
  
  const ref = doc(db, 'pedidos', pedidoId);
  pedidoListener = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      console.warn('⚠️ Pedido no encontrado:', pedidoId);
      return;
    }
    
    const data = snap.data();
    const estado = data.estado || 'pendiente';
    
    console.log('📦 Estado actualizado:', estado);
    
    // 🔥 NOTIFICACIONES FLOTANTES (toast abajo a la derecha) - SE MANTIENEN
    if (estado === 'aceptado' || estado === 'en_preparacion' || estado === 'proceso') {
      mostrarNotificacionFlotante('✅ Pedido aceptado', 'Tu pedido está en preparación');
      reproducirSonido();
    }
    
    if (estado === 'listo' || estado === 'entregado' || estado === 'completado') {
      mostrarNotificacionFlotante('📦 Pedido listo', '¡Tu pedido está listo para recoger!');
      reproducirSonido();
    }
    
    if (estado === 'cancelado') {
      mostrarNotificacionFlotante('❌ Pedido cancelado', 'Tu pedido fue cancelado');
      reproducirSonido();
    }
    
    // Guardar estado actual en localStorage para referencia
    localStorage.setItem('pedido_estado_actual', estado);
    localStorage.setItem('pedido_estado_actualizado', new Date().toISOString());
    
    // Disparar evento para otros módulos (Mis Pedidos, seguimiento, etc.)
    window.dispatchEvent(new CustomEvent('pedido:estado-cambiado', {
      detail: { pedidoId, estado, data }
    }));
    
  }, (error) => {
    console.warn('⚠️ Error escuchando pedido:', error);
  });
}

// ============================================================
// 2. MOSTRAR ESTADO DEL PEDIDO EN LA UI - 🚫 ELIMINADA TARJETA AMARILLA
// ============================================================
function mostrarEstadoPedidoUI(pedidoId, estado, data) {
  // 🚫 TARJETA AMARILLA ELIMINADA
  // Las notificaciones de estado ahora solo se muestran en:
  // 1. Toast flotante (abajo a la derecha) - ver mostrarNotificacionFlotante()
  // 2. Pestaña "Mis Pedidos" donde el cliente hace seguimiento
  // 3. Confirmación de recibido cuando el cliente acepta el pedido
  
  // Solo registramos en consola para depuración
  console.log('📊 Estado del pedido', pedidoId, ':', estado);
}

// ============================================================
// 3. FUNCIÓN PARA VER DETALLE DEL PEDIDO
// ============================================================
window.verDetallePedido = function(pedidoId) {
  if (pedidoId) {
    // Redirigir al detalle del pedido (Mis Pedidos)
    location.href = `./productos.html?pedido=${encodeURIComponent(pedidoId)}#detalle`;
  }
};

// ============================================================
// 4. NOTIFICACIÓN FLOTANTE (estilo toast) - SE MANTIENE
// ============================================================
function mostrarNotificacionFlotante(titulo, mensaje) {
  // Eliminar notificaciones anteriores
  const existing = document.querySelector('.notif-flotante-cliente');
  if (existing) existing.remove();
  
  const notif = document.createElement('div');
  notif.className = 'notif-flotante-cliente';
  notif.style.cssText = `
    position: fixed;
    bottom: 180px;
    right: 20px;
    background: #1f2937;
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.35);
    max-width: 380px;
    z-index: 99999;
    animation: slideInRight 0.5s cubic-bezier(0.22, 1, 0.36, 1);
    border-left: 5px solid #10b981;
    font-family: system-ui, -apple-system, sans-serif;
  `;
  notif.innerHTML = `
    <div style="display:flex;align-items:start;gap:12px;">
      <span style="font-size:1.5rem;">${titulo.split(' ')[0]}</span>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:1rem;color:white;">${titulo}</div>
        <div style="font-size:0.9rem;opacity:0.85;margin-top:4px;color:#d1d5db;">${mensaje}</div>
      </div>
      <button onclick="this.closest('.notif-flotante-cliente').remove()" 
              style="background:none;border:none;color:#9ca3af;font-size:1.2rem;cursor:pointer;padding:0 4px;">✕</button>
    </div>
  `;
  document.body.appendChild(notif);
  
  // Eliminar después de 6 segundos
  setTimeout(() => {
    if (notif.parentNode) {
      notif.style.opacity = '0';
      notif.style.transition = 'opacity 0.4s ease';
      setTimeout(() => {
        if (notif.parentNode) notif.remove();
      }, 400);
    }
  }, 6000);
}

// ============================================================
// 5. REPRODUCIR SONIDO (desactivado temporalmente)
// ============================================================
function reproducirSonido() {
  // ⚠️ SONIDO DESACTIVADO - Evita error 404
  // Para activarlo:
  // 1. Coloca un archivo notification.mp3 en la carpeta public/
  // 2. Descomenta el código de abajo
  // 3. Vuelve a comentar la línea console.log
  
  /*
  try {
    const audio = new Audio('/notification.mp3');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  } catch {}
  */
  
  // Solo registrar en consola que se reprodujo la notificación
  console.log('🔔 Notificación (sonido desactivado)');
}

// ============================================================
// 6. FUNCIÓN GLOBAL PARA INICIAR SEGUIMIENTO - SE MANTIENE
// ============================================================
window.iniciarSeguimientoPedido = function(pedidoId) {
  if (pedidoId) {
    console.log('🔔 Iniciando seguimiento del pedido:', pedidoId);
    localStorage.setItem('pedido_activo_id', pedidoId);
    escucharPedidoCliente(pedidoId);
    return true;
  }
  return false;
};

// ============================================================
// 7. DETENER SEGUIMIENTO - SE MANTIENE
// ============================================================
window.detenerSeguimientoPedido = function() {
  if (pedidoListener) {
    pedidoListener();
    pedidoListener = null;
  }
  localStorage.removeItem('pedido_activo_id');
  console.log('🔕 Seguimiento detenido');
};

// ============================================================
// 8. RECUPERAR PEDIDO ACTIVO AL CARGAR LA PÁGINA - SE MANTIENE
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Si no hay sesión, limpiar
    detenerSeguimientoPedido();
    return;
  }
  
  // Buscar pedido activo en localStorage
  let pedidoId = localStorage.getItem('pedido_activo_id');
  
  // Si no hay en localStorage, buscar en el carrito del usuario
  if (!pedidoId) {
    try {
      const cartRef = doc(db, 'carritos', user.uid);
      const cartSnap = await getDoc(cartRef);
      if (cartSnap.exists()) {
        const data = cartSnap.data();
        if (data.pedidoId && data.estado !== 'cerrado') {
          pedidoId = data.pedidoId;
          localStorage.setItem('pedido_activo_id', pedidoId);
        }
      }
    } catch (e) {
      console.warn('Error buscando pedido en carrito:', e);
    }
  }
  
  // Si hay pedido activo, iniciar seguimiento
  if (pedidoId) {
    // Verificar que el pedido aún existe y no está completado
    try {
      const pedidoRef = doc(db, 'pedidos', pedidoId);
      const pedidoSnap = await getDoc(pedidoRef);
      if (pedidoSnap.exists()) {
        const estado = pedidoSnap.data().estado || 'pendiente';
        if (estado !== 'completado' && estado !== 'entregado' && estado !== 'cancelado') {
          escucharPedidoCliente(pedidoId);
          console.log('🔔 Pedido activo restaurado:', pedidoId);
        } else {
          // Pedido ya finalizado, limpiar
          localStorage.removeItem('pedido_activo_id');
          console.log('🧹 Pedido finalizado, limpiando seguimiento');
        }
      } else {
        // Pedido no existe, limpiar
        localStorage.removeItem('pedido_activo_id');
      }
    } catch (e) {
      console.warn('Error verificando pedido:', e);
    }
  }
});

// ============================================================
// 9. INYECTAR ESTILOS (animaciones) - SE MANTIENE
// ============================================================
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    0% { transform: translateX(100px); opacity: 0; }
    100% { transform: translateX(0); opacity: 1; }
  }
`;
document.head.appendChild(style);

// ============================================================
// 10. ESCUCHAR EVENTOS DE PEDIDO CREADO (desde productos.js) - SE MANTIENE
// ============================================================
window.addEventListener('pedido:creado', (event) => {
  const detail = event.detail || {};
  const pedidoId = detail.pedidoId;
  if (pedidoId) {
    console.log('🔔 Pedido creado, iniciando seguimiento:', pedidoId);
    setTimeout(() => {
      window.iniciarSeguimientoPedido(pedidoId);
    }, 500);
  }
});

console.log('📱 Cliente notificaciones cargado y sincronizado ✅');