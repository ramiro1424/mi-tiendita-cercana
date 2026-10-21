// public/js/panel-comerciante.js
// ============================================================
// 🎯 PANEL DEL COMERCIANTE - VERSIÓN COMPLETA MEJORADA
// ============================================================

/* -------------------------------------------------------------------------- */
/*                               Overlays & util                              */
/* -------------------------------------------------------------------------- */

function _forceCloseOverlays() {
  ['product-modal', 'catalogo-modal', 'chat-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      el.classList.remove('show');
      el.style.pointerEvents = 'none';
    }
  });
  document.getElementById('notification-dropdown')?.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', _forceCloseOverlays);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _forceCloseOverlays();
});

/* -------------------------------------------------------------------------- */
/*                                   IMPORTS                                  */
/* -------------------------------------------------------------------------- */

import { auth, db, storage, functions } from './firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, limit, startAfter,
  writeBatch, increment
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { isSupported, getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';

import * as Cat from './catalogo-adapter.js';

console.log('[panel-comerciante] loaded');
window.__auth = auth;
window.__db = db;

// ============================================================
// 🛎️ SISTEMA DE ALERTAS MEJORADAS PARA PEDIDOS PENDIENTES
// ============================================================

let audioContextAlerta = null;
const timersAlertaPedidos = new Map(); // 🔥 MULTIPEDIDO: { pedidoId: intervalId }
let pedidosEnAlerta = new Set();
let pedidosPendientesCount = 0;

// 1️⃣ REPRODUCIR SONIDO "TUCO TUCO"
function reproducirSonidoTuco() {
    try {
        if (!audioContextAlerta) {
            audioContextAlerta = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const notas = [523, 523, 523, 523, 523];
        const duracion = 0.08;
        const pausa = 0.05;
        
        notas.forEach((frecuencia, index) => {
            setTimeout(() => {
                const osc = audioContextAlerta.createOscillator();
                const gain = audioContextAlerta.createGain();
                osc.connect(gain);
                gain.connect(audioContextAlerta.destination);
                osc.type = 'square';
                osc.frequency.value = frecuencia;
                gain.gain.setValueAtTime(0.25, audioContextAlerta.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContextAlerta.currentTime + duracion);
                osc.start();
                osc.stop(audioContextAlerta.currentTime + duracion);
            }, index * (duracion + pausa) * 1000);
        });
    } catch (error) {
        console.warn('⚠️ Error reproduciendo sonido:', error);
    }
}

// 2️⃣ ANIMAR BOTÓN ACEPTAR
function animarBotonAceptar(pedidoId) {
    const boton = document.querySelector(`button.act[data-id="${pedidoId}"][data-a="aceptado"]`);
    if (!boton) return;
    
    boton.classList.remove('btn-pulse-alerta');
    void boton.offsetWidth;
    boton.classList.add('btn-pulse-alerta');
    
    boton.style.transform = 'scale(1.15)';
    boton.style.backgroundColor = '#ff6b6b';
    boton.style.borderColor = '#ff6b6b';
    boton.style.color = 'white';
    boton.style.fontWeight = 'bold';
    boton.style.boxShadow = '0 0 25px rgba(255, 107, 107, 0.6)';
    boton.style.transition = 'all 0.3s ease';
    
    if (!boton.querySelector('.alerta-badge')) {
        const badge = document.createElement('span');
        badge.className = 'alerta-badge';
        badge.textContent = '🔔';
        badge.style.cssText = 'margin-left:4px;font-size:0.8rem;';
        boton.appendChild(badge);
    }
}

// 3️⃣ RESALTAR FILA DEL PEDIDO
function resaltarFilaPedido(pedidoId) {
    const fila = document.querySelector(`#orders-content .order-table tbody tr[data-id="${pedidoId}"]`);
    if (!fila) return;
    
    fila.classList.remove('fila-nuevo-pedido');
    void fila.offsetWidth;
    fila.classList.add('fila-nuevo-pedido');
    
    setTimeout(() => {
        fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
}

// 4️⃣ ACTUALIZAR CONTADOR DE PENDIENTES
function actualizarContadorPendientes() {
    const badgePendientes = document.getElementById('pendientes-badge');
    const tabPedidos = document.querySelector('[data-tab="orders"]');
    
    // Actualizar el badge (contador visual)
    if (badgePendientes) {
        if (pedidosPendientesCount > 0) {
            badgePendientes.textContent = pedidosPendientesCount;
            badgePendientes.style.display = 'inline-flex';
            badgePendientes.style.background = '#ff6b6b';
            badgePendientes.style.color = 'white';
            badgePendientes.style.borderRadius = '999px';
            badgePendientes.style.padding = '2px 10px';
            badgePendientes.style.fontSize = '11px';
            badgePendientes.style.fontWeight = '700';
            badgePendientes.style.marginLeft = '6px';
            badgePendientes.style.animation = 'contador-pulse 1.5s ease-in-out infinite';
        } else {
            badgePendientes.style.display = 'none';
        }
    }
    
    // Actualizar el texto de la pestaña
    if (tabPedidos) {
        const span = tabPedidos.querySelector('span') || tabPedidos;
        if (pedidosPendientesCount > 0) {
            span.textContent = `📦 Pedidos (${pedidosPendientesCount})`;
        } else {
            span.textContent = '📦 Pedidos';
        }
    }
}

// 5️⃣ REGISTRAR TIEMPOS PARA TORRE DE CONTROL
function registrarTiempoRecepcion(pedidoId) {
    const timestamp = Date.now();
    const refPedido = doc(db, 'pedidos', pedidoId);
    updateDoc(refPedido, {
        'tiempos.recibido': timestamp,
        'tiempos.recibidoStr': new Date(timestamp).toISOString(),
        'tiempos.pendienteDesde': timestamp
    }).catch(err => console.warn('⚠️ Error guardando tiempo de recepción:', err));
}

function registrarTiempoAceptacion(pedidoId) {
    const timestamp = Date.now();
    const refPedido = doc(db, 'pedidos', pedidoId);
    const pedido = pedidosCache.find(p => p.id === pedidoId);
    const recibido = pedido?.tiempos?.recibido || timestamp;
    
    updateDoc(refPedido, {
        'tiempos.aceptado': timestamp,
        'tiempos.aceptadoStr': new Date(timestamp).toISOString(),
        'tiempos.tiempoRespuesta': (timestamp - recibido) / 1000
    }).catch(err => console.warn('⚠️ Error guardando tiempo de aceptación:', err));
}

// 6️⃣ NOTIFICACIÓN FLOTANTE MEJORADA
function mostrarNotificacionFlotanteMejorada(pedido) {
    document.querySelectorAll('.notice-nuevo-pedido').forEach(el => el.remove());
    
    const notif = document.createElement('div');
    notif.className = 'notice-nuevo-pedido';
    notif.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 9999;
        background: linear-gradient(135deg, #ff6b6b, #ee5a24);
        color: white; padding: 16px 24px; border-radius: 16px;
        box-shadow: 0 8px 30px rgba(255, 107, 107, 0.4);
        max-width: 380px;
        animation: slideInRight 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        display: flex; align-items: center; gap: 16px;
        cursor: pointer; font-family: 'Inter', sans-serif;
    `;
    
    const pedidoCorto = '#' + (pedido.id || '').slice(-6).toUpperCase();
    const total = money(pedido.total ?? pedido.subtotal ?? 0);
    const cliente = pedido.cliente?.nombre || pedido.clienteNombre || pedido.clienteEmail || 'Cliente';
    
    notif.innerHTML = `
        <div style="background:rgba(255,255,255,0.2);border-radius:50%;width:48px;height:48px;
                    display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">
            🛒
        </div>
        <div style="flex:1;min-width:0;">
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;opacity:0.8;">Nuevo pedido</div>
            <div style="font-weight:700;font-size:1.1rem;">${pedidoCorto}</div>
            <div style="font-size:0.85rem;opacity:0.9;">${cliente} · ${total}</div>
            <div style="font-size:0.7rem;opacity:0.7;margin-top:2px;">
                ⏱️ Hace ${Math.floor((Date.now() - (pedido.createdAt?.toDate?.() || new Date()).getTime()) / 1000)}s
            </div>
        </div>
        <div style="background:rgba(255,255,255,0.2);border-radius:50%;width:28px;height:28px;
                    display:flex;align-items:center;justify-content:center;cursor:pointer;
                    font-size:14px;transition:all 0.2s;flex-shrink:0;" class="close-notif">
            ✕
        </div>
    `;
    
    document.body.appendChild(notif);
    
    notif.querySelector('.close-notif')?.addEventListener('click', (e) => {
        e.stopPropagation();
        notif.style.animation = 'slideOutRight 0.4s ease forwards';
        setTimeout(() => notif.remove(), 400);
    });
    
    setTimeout(() => {
        if (notif.parentElement) {
            notif.style.animation = 'slideOutRight 0.4s ease forwards';
            setTimeout(() => notif.remove(), 400);
        }
    }, 8000);
    
    notif.addEventListener('click', () => {
        location.hash = '#orders';
        setTimeout(() => {
            try { openOrderDetail(pedido.id); } catch {}
        }, 200);
        notif.remove();
    });
}

// 7️⃣ ALERTA PERIÓDICA (cada 15 segundos) - VERSIÓN MULTIPEDIDO
function iniciarAlertaPeriodica(pedidoId) {
    // Ya existe un temporizador para este pedido
    if (timersAlertaPedidos.has(pedidoId)) return;
    if (pedidosEnAlerta.has(pedidoId)) return;
    pedidosEnAlerta.add(pedidoId);

    const timer = setInterval(() => {
        const pedido = pedidosCache.find(p => p.id === pedidoId);

        // Si el pedido ya no está pendiente, detener SOLO su alerta
        if (!pedido || (pedido.estado !== 'pendiente' && pedido.estado !== 'nuevo')) {
            detenerAlertaPedido(pedidoId);
            return;
        }

        // 🔊 Recordatorio sonoro
        try {
            if (audioContextAlerta) {
                const osc = audioContextAlerta.createOscillator();
                const gain = audioContextAlerta.createGain();
                osc.connect(gain);
                gain.connect(audioContextAlerta.destination);
                osc.type = 'sine';
                osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.15, audioContextAlerta.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContextAlerta.currentTime + 0.1);
                osc.start();
                osc.stop(audioContextAlerta.currentTime + 0.1);
            }
        } catch (e) {
            console.warn('⚠️ No se pudo reproducir el recordatorio sonoro:', e);
        }

        // 🔴 Volver a animar el botón Aceptar
        animarBotonAceptar(pedidoId);

        // ✨ Volver a resaltar la fila
        resaltarFilaPedido(pedidoId);

        console.log(`🔔 Recordatorio: Pedido ${pedidoId.slice(-6).toUpperCase()} aún pendiente`);
    }, 15000);

    timersAlertaPedidos.set(pedidoId, timer);
}

// 8️⃣ DETENER ALERTA - VERSIÓN CORREGIDA
function detenerAlertaPedido(pedidoId) {
    pedidosEnAlerta.delete(pedidoId);

    // 🛑 Detener SOLO el temporizador de este pedido
    const timer = timersAlertaPedidos.get(pedidoId);
    if (timer) {
        clearInterval(timer);
        timersAlertaPedidos.delete(pedidoId);
    }

    // 🔴 Restaurar botón Aceptar
    const boton = document.querySelector(`button.act[data-id="${pedidoId}"][data-a="aceptado"]`);
    if (boton) {
        boton.classList.remove('btn-pulse-alerta');
        boton.style.transform = '';
        boton.style.backgroundColor = '';
        boton.style.borderColor = '';
        boton.style.color = '';
        boton.style.fontWeight = '';
        boton.style.boxShadow = '';
        const badge = boton.querySelector('.alerta-badge');
        if (badge) badge.remove();
    }

    // ✨ Quitar resaltado de la fila
    const fila = document.querySelector(`#orders-content .order-table tbody tr[data-id="${pedidoId}"]`);
    if (fila) {
        fila.classList.remove('fila-nuevo-pedido');
    }
}

// 9️⃣ PROCESAR NUEVO PEDIDO CON ALERTAS
function procesarNuevoPedidoConAlertas(pedido) {
    if (!pedido || !pedido.id) return;
    if (pedido.estado !== 'pendiente' && pedido.estado !== 'nuevo') return;
    
    // ✅ INCREMENTAR CONTADOR
    pedidosPendientesCount++;
    actualizarContadorPendientes();
    
    registrarTiempoRecepcion(pedido.id);
    reproducirSonidoTuco();
    mostrarNotificacionFlotanteMejorada(pedido);
    
    setTimeout(() => { resaltarFilaPedido(pedido.id); }, 500);
    setTimeout(() => { animarBotonAceptar(pedido.id); }, 800);
    iniciarAlertaPeriodica(pedido.id);
    
    console.log(`🛎️ Alerta activada para pedido #${pedido.id.slice(-6).toUpperCase()}`);
}

// 🔟 RECALCULAR PENDIENTES - SOLO CUENTA, NO REACTIVA
function recalcularPendientes() {
    const pendientes = pedidosCache.filter(p =>
        p.estado === 'pendiente' || p.estado === 'nuevo'
    );
    pedidosPendientesCount = pendientes.length;
    actualizarContadorPendientes();
    
    // ✅ SOLO reactivar alertas si el pedido existe y no tiene alerta activa
    // Esto evita que pedidos que ya estaban pendientes vuelvan a sonar
    pendientes.forEach(p => {
        // Solo si NO tiene alerta activa Y NO tiene temporizador
        if (!pedidosEnAlerta.has(p.id) && !timersAlertaPedidos.has(p.id)) {
            // Verificar que realmente es un pedido nuevo pendiente
            // y no un pedido que ya tenía alerta pero se perdió
            procesarNuevoPedidoConAlertas(p);
        }
    });
}

// ============================================================
// FIN DEL SISTEMA DE ALERTAS
// ============================================================

/* ============================================================
   🗺️ MAPA CON SELECCIÓN DE UBICACIÓN Y DIRECCIÓN AUTOMÁTICA
   ============================================================ */

let coords = { lat: 0, lng: 0 };
let mapTiendas = null;
let markerTiendas = null;
let isMapReady = false;

function initLocationMap() {
  // Esta función se mantiene como stub
}

function initMapTiendas() {
  try {
    const el = document.getElementById('map-tienda') || document.getElementById('map');
    if (!el || !window.L) {
      console.warn('Mapa no disponible');
      return;
    }

    // 🔥 Si el mapa ya existe, solo redimensionar por si el contenedor estaba oculto
    if (mapTiendas) {
      setTimeout(() => {
        try { mapTiendas.invalidateSize(); } catch {}
      }, 200);
      return;
    }

    // 🔥 Coordenadas: si ya hay coords cargadas desde Firestore, usarlas
    if (!coords.lat || !coords.lng) {
      coords = { lat: 6.2442, lng: -75.5812 };
    }

    // Inicializar el mapa
    mapTiendas = L.map(el).setView([coords.lat, coords.lng], 16);

    // Capa de mapa
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(mapTiendas);

    // Marcador (arrastrable)
    markerTiendas = L.marker([coords.lat, coords.lng], {
      draggable: true
    }).addTo(mapTiendas);

    isMapReady = true;

    // ============================================================
    // 🔥 EVENTO: CLIC EN EL MAPA
    // ============================================================
    mapTiendas.on('click', async function(e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      markerTiendas.setLatLng([lat, lng]);
      coords = { lat, lng };

      const latInput = document.getElementById('tienda-lat');
      const lonInput = document.getElementById('tienda-lon');
      if (latInput) latInput.value = lat;
      if (lonInput) lonInput.value = lng;

      actualizarDisplayCoordenadas(lat, lng);

      setMsg('📍 Obteniendo dirección...', true);
      const direccion = await obtenerDireccionDesdeCoordenadas(lat, lng);

      if (direccion) {
        const dirInput = document.getElementById('tienda-direccion');
        const dirInput2 = document.getElementById('direccion');
        if (dirInput) dirInput.value = direccion;
        if (dirInput2) dirInput2.value = direccion;
        setMsg('✅ Dirección obtenida automáticamente', true);
      } else {
        setMsg('⚠️ No se pudo obtener la dirección exacta', false);
      }

      await guardarUbicacionEnFirestore(lat, lng, direccion);

      if (typeof window.updateLocationStatus === 'function') {
        window.updateLocationStatus(true);
      }
    });

    // ============================================================
    // 🔥 EVENTO: ARRASTRAR MARCADOR
    // ============================================================
    markerTiendas.on('dragend', async function() {
      const pos = markerTiendas.getLatLng();
      const lat = pos.lat;
      const lng = pos.lng;
      coords = { lat, lng };

      const latInput = document.getElementById('tienda-lat');
      const lonInput = document.getElementById('tienda-lon');
      if (latInput) latInput.value = lat;
      if (lonInput) lonInput.value = lng;

      actualizarDisplayCoordenadas(lat, lng);

      setMsg('📍 Obteniendo dirección...', true);
      const direccion = await obtenerDireccionDesdeCoordenadas(lat, lng);

      if (direccion) {
        const dirInput = document.getElementById('tienda-direccion');
        const dirInput2 = document.getElementById('direccion');
        if (dirInput) dirInput.value = direccion;
        if (dirInput2) dirInput2.value = direccion;
        setMsg('✅ Dirección actualizada al arrastrar', true);
      }

      await guardarUbicacionEnFirestore(lat, lng, direccion);

      if (typeof window.updateLocationStatus === 'function') {
        window.updateLocationStatus(true);
      }
    });

    // 🔥 Si ya veníamos con coords cargadas de Firestore, pintar el badge
    if (coords.lat && coords.lng) {
      actualizarDisplayCoordenadas(coords.lat, coords.lng);
      if (typeof window.updateLocationStatus === 'function') {
        window.updateLocationStatus(true);
      }
    }

    // 🔥 Forzar redibujado por si el contenedor estaba oculto al crear el mapa
    setTimeout(() => {
      try { mapTiendas.invalidateSize(); } catch {}
    }, 300);

  } catch (error) {
    console.warn('Error al inicializar el mapa:', error);
  }
}

// ============================================================
// 🔍 FUNCIÓN: OBTENER DIRECCIÓN DESDE COORDENADAS
// ============================================================

async function obtenerDireccionDesdeCoordenadas(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.display_name) {
      return data.display_name;
    }
    return null;
  } catch (error) {
    console.warn('Error al obtener dirección:', error);
    return null;
  }
}

// ============================================================
// 💾 FUNCIÓN: GUARDAR UBICACIÓN EN FIRESTORE
// ============================================================

async function guardarUbicacionEnFirestore(lat, lng, direccion) {
  try {
    if (!UID) {
      console.warn('No hay UID, no se puede guardar');
      return;
    }

    const dirInput = document.getElementById('tienda-direccion');
    const direccionFinal = direccion || dirInput?.value || '';

    await setDoc(doc(db, 'tiendas', UID), {
      lat: lat,
      lon: lng,
      lng: lng,
      direccion: direccionFinal,
      actualizadoEn: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, 'perfiles', UID), {
      lat: lat,
      lon: lng,
      direccion: direccionFinal,
      updatedAt: serverTimestamp()
    }, { merge: true });

    console.log('✅ Ubicación guardada:', { lat, lng, direccion: direccionFinal });

  } catch (error) {
    console.error('Error al guardar ubicación:', error);
    setMsg('❌ Error al guardar ubicación', false);
  }
}

// ============================================================
// 📍 FUNCIÓN: ACTUALIZAR DISPLAY DE COORDENADAS
// ============================================================

function actualizarDisplayCoordenadas(lat, lng) {
  const latDisplay = document.getElementById('coord-lat');
  const lonDisplay = document.getElementById('coord-lon');
  if (latDisplay) latDisplay.textContent = lat.toFixed(6);
  if (lonDisplay) lonDisplay.textContent = lng.toFixed(6);
}

// ============================================================
// 🎯 FUNCIÓN: MOVER MAPA (mejorada: inputs + marcador + badge)
// ============================================================

function moveMap(c) {
  coords = {
    lat: Number(c.lat) || 0,
    lng: Number(c.lng ?? c.lon) || 0
  };

  // 1) Actualizar inputs visibles
  const latInput = document.getElementById('tienda-lat');
  const lonInput = document.getElementById('tienda-lon');
  if (latInput) latInput.value = coords.lat;
  if (lonInput) lonInput.value = coords.lng;

  // 2) Actualizar texto de coordenadas
  actualizarDisplayCoordenadas(coords.lat, coords.lng);

  // 3) Mover mapa + marcador
  try {
    if (mapTiendas && markerTiendas) {
      mapTiendas.setView([coords.lat, coords.lng], mapTiendas.getZoom() || 16);
      markerTiendas.setLatLng([coords.lat, coords.lng]).update();
      setTimeout(() => {
        try { mapTiendas.invalidateSize(); } catch {}
      }, 200);
    }
  } catch (error) {
    console.warn('Error en moveMap:', error);
  }

  // 4) Badge "Ubicación guardada"
  if (typeof window.updateLocationStatus === 'function') {
    window.updateLocationStatus(true);
  }
}

/* ====== Mejora de tabla Pedidos Activos ====== */
(function enhanceOrdersTable() {
  const tbl = document.querySelector('.order-table');
  if (!tbl) return;

  window.showOrderSkeleton = function(rows = 5) {
    const tbody = tbl.querySelector('tbody');
    tbody.innerHTML = '';
    for (let i = 0; i < rows; i++) {
      const tr = document.createElement('tr');
      tr.className = 'skel';
      tr.innerHTML = `
        <td><span class="sk"></span></td>
        <td><span class="sk"></span></td>
        <td><span class="sk"></span></td>
        <td><span class="sk"></span></td>
        <td><span class="sk"></span></td>
        <td><span class="sk"></span></td>`;
      tbody.appendChild(tr);
    }
  };

  window.renderOrdersModern = function(rows) {
    const tbody = tbl.querySelector('tbody');
    tbody.innerHTML = rows.map(r => {
      const estadoBadge = stateToBadge(r.estado);
      return `
        <tr data-id="${r.id || ''}">
          <td>#${r.codigo || r.id || '—'}</td>
          <td>${r.fecha || '—'}</td>
          <td class="col-cliente">${r.cliente || '—'}</td>
          <td class="col-total">$ ${formatMoney(r.total || 0)}</td>
          <td>${estadoBadge}</td>
          <td>
            <div class="cell-actions">
              <button class="btn btn-success btn-sm" data-act="ver" data-id="${r.id}">Ver</button>
              <button class="btn btn-outline btn-sm" data-act="chat" data-id="${r.id}">Chat</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  };

  function stateToBadge(st) {
    const map = {
      pendiente: { cls: 'badge-warning', txt: 'Pendiente' },
      aceptado: { cls: 'badge-info', txt: 'Aceptado' },
      en_preparacion: { cls: 'badge-primary', txt: 'En preparación' },
      listo: { cls: 'badge-primary', txt: 'Listo' },
      entregado: { cls: 'badge-success', txt: 'Completado' },
      cancelado: { cls: 'badge-danger', txt: 'Cancelado' },
      expirado: { cls: 'badge-dark', txt: 'Expirado' },
    };
    const v = map[st] || { cls: 'badge-dark', txt: String(st || '—') };
    return `<span class="badge ${v.cls}">${v.txt}</span>`;
  }

  const formatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0 });
  const formatMoney = n => formatter.format(Math.round(n));

  const headerMap = [
    { thIndex: 0, key: 'codigo' },
    { thIndex: 1, key: 'fecha' },
    { thIndex: 2, key: 'cliente' },
    { thIndex: 3, key: 'total' },
    { thIndex: 4, key: 'estado' },
  ];

  headerMap.forEach(({ thIndex }) => {
    const th = tbl.tHead?.rows[0]?.cells[thIndex];
    if (!th) return;
    th.classList.add('sortable');
    th.dataset.sortIcon = '↕';
    th.addEventListener('click', () => toggleSort(thIndex));
  });

  let sortState = JSON.parse(localStorage.getItem('ordersSort') || 'null') || { index: 3, dir: 'desc' };

  function toggleSort(thIndex) {
    if (sortState.index === thIndex) {
      sortState.dir = (sortState.dir === 'asc') ? 'desc' : 'asc';
    } else {
      sortState = { index: thIndex, dir: 'asc' };
    }
    localStorage.setItem('ordersSort', JSON.stringify(sortState));
    indicateSort();
    document.getElementById('btn-filtrar-orders')?.click();
  }

  function indicateSort() {
    [...tbl.tHead.rows[0].cells].forEach((th, i) => {
      if (i === sortState.index) th.dataset.sortIcon = (sortState.dir === 'asc' ? '▲' : '▼');
      else th.dataset.sortIcon = '↕';
    });
  }
  indicateSort();

  const fEstado = document.getElementById('filtro-estado');
  const fMes = document.getElementById('filtro-mes');
  const fTxt = document.getElementById('filtro-texto');

  const saved = JSON.parse(localStorage.getItem('ordersFilters') || '{}');
  if (saved.estado) fEstado.value = saved.estado;
  if (saved.mes) fMes.value = saved.mes;
  if (saved.texto) fTxt.value = saved.texto;

  [fEstado, fMes, fTxt].forEach(el => {
    el?.addEventListener('change', saveFilters);
    el?.addEventListener('input', debounce(saveFilters, 400));
  });

  function saveFilters() {
    localStorage.setItem('ordersFilters', JSON.stringify({
      estado: fEstado?.value || '',
      mes: fMes?.value || '',
      texto: fTxt?.value || '',
    }));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t);
      t = setTimeout(() => fn(...args), ms); };
  }
})();

/* -------------------------------------------------------------------------- */
/*                       PUSH config guard (VAPID / HTTPS)                    */
/* -------------------------------------------------------------------------- */

const VAPID_PUBLIC_KEY = (typeof window !== 'undefined' && window.VAPID_PUBLIC_KEY) ? window.VAPID_PUBLIC_KEY : '';

function canUsePush() {
  const httpsOrLocal = (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  return httpsOrLocal && typeof Notification !== 'undefined' && !!VAPID_PUBLIC_KEY;
}

/* -------------------------------------------------------------------------- */
/*                               Helpers comunes                              */
/* -------------------------------------------------------------------------- */

function setForm(id, val) { const el = document.getElementById(id); if (el != null) { el.value = (val ?? ''); } }

function getForm(id) { const el = document.getElementById(id); return el ? el.value : ''; }

function fechaCorta(d) {
  try {
    const x = (d && typeof d.toDate === 'function') ? d.toDate() : (d instanceof Date ? d : new Date(d));
    if (!x || isNaN(x.getTime())) return '';
    return x.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return ''; }
}

function debounce(fn, wait = 250) { let t; return (...args) => { clearTimeout(t);
    t = setTimeout(() => fn(...args), wait); }; }

function money(v, currency = 'COP', locale = 'es-CO') {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
      .format(Number(v) || 0);
  } catch { return '$' + (Number(v) || 0).toLocaleString('es'); }
}

const UNIT_LABEL = {
  unidad: 'unidad',
  und: 'unidad',
  u: 'unidad',
  kg: 'kg',
  g: 'g',
  gr: 'g',
  lb: 'lb',
  l: 'L',
  lt: 'L',
  ml: 'ml',
  paquete: 'paquete',
  pack: 'pack'
};

function normalizeUnit(s = 'unidad') {
  s = (s || 'unidad').toLowerCase();
  if (['u', 'und', 'unit', 'unidad'].includes(s)) return 'unidad';
  if (['kg', 'kilo', 'kilogramo', 'kilogramos'].includes(s)) return 'kg';
  if (['g', 'gr', 'gramo', 'gramos'].includes(s)) return 'g';
  if (['l', 'lt', 'litro', 'litros'].includes(s)) return 'l';
  if (['ml'].includes(s)) return 'ml';
  if (['paquete', 'pack'].includes(s)) return 'paquete';
  return s;
}

const toNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

function setMsg(msg, ok = true) {
  const el = document.getElementById('global-msg');
  if (el) {
    el.textContent = msg;
    el.className = `toast ${ok ? 'ok' : 'err'}`;
    el.style.display = 'block';
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      el.style.display = 'none';
    }, 2500);
  } else {
    (ok ? console.log : console.warn)(msg);
  }
}

/* -------------------------------------------------------------------------- */
/*                               Tienda (Firestore)                           */
/* -------------------------------------------------------------------------- */

async function cargarMiTienda(uid) {
  try {
    const d = await getDoc(doc(db, 'tiendas', uid));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  } catch (e) { console.warn('cargarMiTienda', e); return null; }
}

async function guardarMiTienda(uid, payload) {
  try {
    await setDoc(doc(db, 'tiendas', uid), { ...payload, actualizadoEn: serverTimestamp() }, { merge: true });
  } catch (e) { console.error('guardarMiTienda', e); throw e; }
}

async function updatePublicProfile(uid, data) {
  try {
    await setDoc(doc(db, 'perfiles', uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) { console.warn('updatePublicProfile', e); }
}

function fillMiTiendaForm(t) {
  setForm('tienda-nombre', t?.nombre || '');
  setForm('tienda-direccion', t?.direccion || '');
  setForm('tienda-lat', t?.lat ?? '');
  setForm('tienda-lon', (t?.lon ?? t?.lng) ?? '');
  setForm('tienda-telefono', t?.telefono || '');
  setForm('tienda-horario', t?.horario || '');
  const chk = document.getElementById('tienda-activo');
  if (chk) chk.checked = !!t?.activo;
  if (t?.imageUrl) {
    const urlEl = document.getElementById('tienda-image-url');
    if (urlEl) urlEl.value = t.imageUrl;
    pintarPreviewImagen(t.imageUrl);
  }
  if (t?.tipoComercio) {
    const tipoEl = document.getElementById('tipo-comercio') || document.getElementById('tienda-tipo');
    if (tipoEl) tipoEl.value = t.tipoComercio;
  }
}

/* -------------------------------------------------------------------------- */
/*                             Chip usuario + tabs                             */
/* -------------------------------------------------------------------------- */

function pintarChipUsuario() {
  try {
    const badge = document.querySelector('.user-badge') || document.getElementById('nombre-usuario');
    const avatar = document.querySelector('.user-avatar');

    // 🔥 CORRECCIÓN: Leer SIEMPRE de Firebase Auth, no del localStorage
    const user = auth.currentUser;
    if (!user) return;

    const nombre = user.displayName || user.email?.split('@')[0] || 'Usuario';

    if (badge) badge.textContent = nombre;
    if (avatar) avatar.textContent = (nombre[0] || 'U').toUpperCase();
  } catch (e) { console.warn('pintarChipUsuario falló:', e); }
}
async function cargarPerfil(uid) {
  try {
    const s = await getDoc(doc(db, 'perfiles', uid));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  } catch (e) { console.warn('cargarPerfil', e); return null; }
}

async function asegurarPerfil(uid, user) {
  const nombre = (user.displayName && user.displayName.trim()) ||
    (user.email ? user.email.split('@')[0] : 'Comerciante');
  const base = {
    nombre,
    email: user.email || '',
    tipoUsuario: 'comerciante',
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'perfiles', uid), base, { merge: true });
  return base;
}

function pintarBienvenida(nombre) {
  const title = document.getElementById('welcome-title');
  if (title) title.textContent = `¡Bienvenido, ${nombre || 'Comerciante'}!`;
}

window.MTC = window.MTC || {};

(function() {
  function activate(tabId) {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tabId)
    );
    document.querySelectorAll('.tab-content').forEach(c =>
      c.classList.toggle('active', c.id === `${tabId}-content`)
    );
  }

  function applyOrdersFiltersFromHashSafe() {
    try { window.applyOrderFiltersNow?.(); } catch {}
  }

  // 🔥 Función helper para asegurar que el mapa de Configuración
  // cargue la ubicación guardada cuando se abre la pestaña.
  function ensureSettingsMapRendered() {
    setTimeout(() => {
      try {
        if (!mapTiendas && typeof initMapTiendas === 'function') {
          initMapTiendas();
        }
        if (mapTiendas) {
          mapTiendas.invalidateSize();
          if (coords.lat && coords.lng) {
            mapTiendas.setView([coords.lat, coords.lng], 16);
            if (markerTiendas) {
              markerTiendas.setLatLng([coords.lat, coords.lng]);
            }
            actualizarDisplayCoordenadas(coords.lat, coords.lng);
            if (typeof window.updateLocationStatus === 'function') {
              window.updateLocationStatus(true);
            }
          }
        }
      } catch (e) {
        console.warn('Error inicializando mapa en tab settings:', e);
      }
    }, 250);
  }

  function activateFromHash() {
    const raw = (location.hash || '').slice(1);
    const tabId = raw ? raw.split('?')[0] : 'dashboard';
    activate(tabId);
    if (tabId === 'orders') applyOrdersFiltersFromHashSafe();
    if (tabId === 'completed') cargarCompletados();
    if (tabId === 'settings') ensureSettingsMapRendered();
  }

  window.MTC.merchantSetupTabs = function(defaultTab = 'dashboard') {
    const tabsWrap = document.querySelector('.tabs');
    if (!tabsWrap) return;

    tabsWrap.addEventListener('click', (ev) => {
      const t = ev.target.closest('.tab');
      if (!t) return;
      ev.preventDefault();
      const tabId = t.dataset.tab;
      try { history.replaceState(null, '', `#${tabId}`); } catch {}
      activate(tabId);
      if (tabId === 'orders') applyOrdersFiltersFromHashSafe();
      if (tabId === 'completed') cargarCompletados();
      if (tabId === 'settings') ensureSettingsMapRendered();
    });

    tabsWrap.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const t = document.activeElement.closest('.tab');
      if (!t) return;
      ev.preventDefault();
      const tabId = t.dataset.tab;
      try { history.replaceState(null, '', `#${tabId}`); } catch {}
      activate(tabId);
      if (tabId === 'orders') applyOrdersFiltersFromHashSafe();
      if (tabId === 'completed') cargarCompletados();
      if (tabId === 'settings') ensureSettingsMapRendered();
    });

    const raw = (location.hash || '').slice(1);
    const initial = raw ? raw.split('?')[0] : defaultTab;
    activate(initial);
    if (initial === 'orders') applyOrdersFiltersFromHashSafe();
    if (initial === 'completed') cargarCompletados();
    if (initial === 'settings') ensureSettingsMapRendered();
  };

  window.addEventListener('hashchange', activateFromHash);

  document.addEventListener('DOMContentLoaded', () => {
    window.MTC.merchantSetupTabs('dashboard');
    activateFromHash();
  });
})();

/* -------------------------------------------------------------------------- */
/*                         META catálogo & precios mensuales                  */
/* -------------------------------------------------------------------------- */

async function catalogoYaSembrado(uid) {
  const ref = doc(db, 'tiendas', uid, 'meta', 'catalogo');
  const snap = await getDoc(ref);
  return snap.exists() && snap.data()?.sembrado === true;
}

async function marcarCatalogoSembrado(uid) {
  const ref = doc(db, 'tiendas', uid, 'meta', 'catalogo');
  await setDoc(ref, { sembrado: true, sembradoAt: serverTimestamp() }, { merge: true });
}

async function getUltimoMesActualizado(uid) {
  const ref = doc(db, 'tiendas', uid, 'config', 'precios');
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data()?.lastMonth || null) : null;
}

async function setUltimoMesActualizado(uid, yyyymm) {
  const ref = doc(db, 'tiendas', uid, 'config', 'precios');
  await setDoc(ref, { lastMonth: yyyymm, updatedAt: serverTimestamp() }, { merge: true });
}

async function accionarSembradoInicial(uid) {
  const ya = await catalogoYaSembrado(uid);

  if (ya) {
    setMsg('✅ El catálogo ya fue sembrado anteriormente.', true);
    return;
  }

  // 🚫 IMPORTANTE:
  // La siembra del catálogo ya NO se ejecuta desde este panel.
  // El catálogo oficial será gestionado por la ruta central de
  // siembra según el tipo de comerciante.
  //
  // Aquí no se llama:
  // - Cat.generarCatalogoBase()
  // - seedStoreIfNeeded()
  // - Cat.syncAllSubToRoot()

  console.log('ℹ️ La siembra del catálogo se gestiona desde la ruta central.');
  setMsg('ℹ️ El catálogo se gestionará mediante el sistema central de siembra.', true);
}

async function accionarActualizacionPrecios(uid) {
  const ahora = new Date();
  const yyyymm = String(ahora.getFullYear()) + String(ahora.getMonth() + 1).padStart(2, '0');
  const ultimo = await getUltimoMesActualizado(uid);
  if (ultimo === yyyymm) { setMsg('ℹ️ Los precios de este mes ya están actualizados.', true); return; }

  await Cat.actualizarPreciosEstandarMes(db, uid, {
    tabla: {
      yyyymm,
      productos: {
        'leche-entera-1l': 5400,
        'arroz-1kg': 4300,
      },
      factoresCategoria: { verduras: 1.03, abarrotes: 1.02 }
    },
    redondear: true
  });

  await Cat.syncAllSubToRoot(uid);

  await setUltimoMesActualizado(uid, yyyymm);
  await crearNotificacion(uid, {
    tipo: 'precio',
    titulo: 'Precios actualizados',
    mensaje: `Se aplicaron los precios estándar ${yyyymm}.`
  });
  setMsg(`✅ Precios actualizados para ${yyyymm}.`, true);
}

/* -------------------------------------------------------------------------- */
/*                               Notificaciones UI                            */
/* -------------------------------------------------------------------------- */

function ensureBadgeNode() {
  const bell = document.getElementById('notification-icon');
  if (!bell) return null;
  bell.style.position = 'relative';
  let badge = bell.querySelector('.notification-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.style.cssText = 'position:absolute;top:-6px;right:-6px;background:#ff5252;color:#fff;border-radius:999px;padding:2px 6px;font-size:12px;line-height:1;display:none;';
    bell.appendChild(badge);
  }
  return badge;
}

function renderBadgeNotificaciones(count) {
  const b = ensureBadgeNode();
  if (!b) return;
  b.textContent = count > 99 ? '99+' : String(count);
  b.style.display = count > 0 ? 'inline-block' : 'none';
}

function renderListaNotis(docs) {
  const list = document.getElementById('notification-list');
  if (!list) return;
  if (!docs.length) { list.innerHTML = '<li class="notification-empty">Sin notificaciones</li>'; return; }

  const iconByType = (t) => {
    switch ((t || '').toLowerCase()) {
      case 'pedido':
        return { ic: 'fa-receipt', bg: '#e8f1ff', color: '#174ea6' };
      case 'precio':
        return { ic: 'fa-percent', bg: '#ecfdf5', color: '#0f766e' };
      case 'producto':
        return { ic: 'fa-box', bg: '#fff7ed', color: '#9a6400' };
      default:
        return { ic: 'fa-bell', bg: '#eef2f7', color: '#334155' };
    }
  };
  const fmt = (d) => {
    const dt = d?.toDate?.() ? d.toDate() : (d instanceof Date ? d : new Date(d));
    if (!dt || isNaN(dt)) return '';
    return dt.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  list.innerHTML = docs.map(d => {
    const n = { id: d.id, ...d.data() };
    const ic = iconByType(n.tipo);
    return `
      <li class="notification-item ${n.leida ? '' : 'unread'}">
        <div class="n-icon" style="background:${ic.bg};color:${ic.color}">
          <i class="fa ${ic.ic}"></i>
        </div>
        <div class="notification-content">
          <div class="notification-title">${n.titulo || 'Notificación'}</div>
          <div class="notification-body">${n.mensaje || ''}</div>
        </div>
        <div class="notification-time">${fmt(n.creadoEn)}</div>
      </li>
    `;
  }).join('');
}

async function crearNotificacion(uid, data) {
  try {
    const colRef = collection(db, 'notificaciones', uid, 'items');
    await addDoc(colRef, { ...data, creadoEn: serverTimestamp(), leida: false });
  } catch (e) { console.warn('crearNotificacion', e); }
}

function setupCampanita(uid) {
  const colRef = collection(db, 'notificaciones', uid, 'items');
  const qUnread = query(colRef, where('leida', '==', false), orderBy('creadoEn', 'desc'), limit(50));
  const qLast = query(colRef, orderBy('creadoEn', 'desc'), limit(10));
  onSnapshot(qUnread, (snap) => { renderBadgeNotificaciones(snap.size); });
  onSnapshot(qLast, (snap) => { renderListaNotis(snap.docs); });
}

async function marcarNotificacionesLeidas(uid) {
  try {
    const colRef = collection(db, 'notificaciones', uid, 'items');
    const qUnread = query(colRef, where('leida', '==', false), limit(50));
    const snap = await getDocs(qUnread);
    await Promise.all(snap.docs.map(d => updateDoc(doc(db, 'notificaciones', uid, 'items', d.id), { leida: true })));
  } catch (e) { console.warn('marcarNotificacionesLeidas', e); }
}

/* -------------------------------------------------------------------------- */
/*                               PUSH (Firebase)                               */
/* -------------------------------------------------------------------------- */

async function initPushForUser(uid) {
  try {
    if (!canUsePush()) { console.log('Push deshabilitado (requiere HTTPS/localhost y VAPID_PUBLIC_KEY).'); return; }
    if (!await isSupported()) { console.warn('FCM no soportado en este navegador'); return; }

    let swReg = null;
    if ('serviceWorker' in navigator) {
      try { swReg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' }); } catch (e) { console
          .warn('No se pudo registrar SW de messaging:', e); }
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { console.log('Permiso de notificaciones no otorgado'); return; }

    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: swReg || undefined });
    if (!token) return;

    await setDoc(doc(db, 'tiendas', uid, 'config', 'messaging'), { token, updatedAt: serverTimestamp() }, { merge: true });

    onMessage(messaging, (payload) => {
      try {
        const title = payload.notification?.title || 'Notificación';
        const body = payload.notification?.body || '';
        new Notification(title, { body, icon: './favicon.png' });
      } catch (e) {}
    });
  } catch (e) { console.warn('initPushForUser error:', e); }
}

/* ============================================================
   💬 CHAT INTEGRADO - SISTEMA COMPLETO
   ============================================================ */

let currentChatUid = null;
let unsubConversaciones = null;
let unsubMensajes = null;
let pedidoChatActual = null;

// Elementos del chat
const chatModal = document.getElementById('chat-modal');
const chatBtn = document.getElementById('chat-btn');
const closeChatBtn = document.getElementById('close-chat');
const conversationsList = document.getElementById('conversations-list');
const messagesContainer = document.getElementById('messages-container');
const messageInputContainer = document.getElementById('message-input-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-message');
const chatBadge = document.getElementById('chat-notification');
const chatCurrentClient = document.querySelector('#chat-current-client .client-info span');

// ============================================================
// 🔍 ESCUCHAR CONVERSACIONES ACTIVAS (SIN ÍNDICE)
// ============================================================

function escucharConversaciones(uid) {
  if (unsubConversaciones) {
    unsubConversaciones();
    unsubConversaciones = null;
  }

  if (!uid || !conversationsList) return;

  console.log('🔍 Escuchando conversaciones para:', uid);

  const pedidosRef = collection(db, 'pedidos');
  const q = query(
    pedidosRef,
    where('tiendaId', '==', uid),
    orderBy('lastTs', 'desc'),
    limit(50)
  );

  unsubConversaciones = onSnapshot(q, (snapshot) => {
    const conversaciones = [];
    let totalNoLeidos = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.lastMsg) {
        conversaciones.push({
          id: doc.id,
          clienteId: data.clienteId || data.uid || 'cliente',
          clienteNombre: data.clienteNombre || data.cliente || 'Cliente',
          lastMsg: data.lastMsg || '',
          lastTs: data.lastTs,
          estado: data.estado || 'pendiente',
          mensajesNoLeidos: data.mensajesNoLeidos || 0
        });
        totalNoLeidos += (data.mensajesNoLeidos || 0);
      }
    });

    renderizarConversaciones(conversaciones);
    actualizarBadgeChat(totalNoLeidos);
  }, (error) => {
    console.warn('Error escuchando conversaciones:', error);
    if (conversationsList) {
      conversationsList.innerHTML = `
        <div class="empty-conversations">
          <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i>
          <p>Error al cargar conversaciones</p>
          <small>${error.message || 'Revisa la consola'}</small>
          <button onclick="location.reload()" style="margin-top:10px;padding:8px 16px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;">
            <i class="fas fa-sync"></i> Reintentar
          </button>
        </div>
      `;
    }
  });
}

// ============================================================
// 📋 RENDERIZAR CONVERSACIONES
// ============================================================

function renderizarConversaciones(conversaciones) {
  if (!conversationsList) return;

  if (conversaciones.length === 0) {
    conversationsList.innerHTML = `
      <div class="empty-conversations">
        <i class="fas fa-comment-slash"></i>
        <p>No hay conversaciones activas</p>
        <small>Los mensajes de clientes aparecerán aquí</small>
      </div>
    `;
    return;
  }

  conversationsList.innerHTML = conversaciones.map(conv => {
    const noLeidos = conv.mensajesNoLeidos || 0;
    const initial = (conv.clienteNombre || 'C')[0].toUpperCase();
    const estadoEmoji = conv.estado === 'pendiente' ? '⏳' : conv.estado === 'aceptado' ? '✅' : '📦';

    return `
      <div class="conversation-item" data-pedido="${conv.id}" data-cliente="${conv.clienteId}" style="
        ${noLeidos > 0 ? 'background: #ecfdf5; border-left: 3px solid #10b981;' : ''}
      ">
        <div class="avatar">
          ${initial}
          ${noLeidos > 0 ? `<span class="badge">${noLeidos}</span>` : ''}
        </div>
        <div class="info">
          <div class="name">
            ${conv.clienteNombre}
            <span class="estado">${estadoEmoji}</span>
          </div>
          <div class="last">${conv.lastMsg || '...'}</div>
        </div>
        <div class="time">${formatearTiempoChat(conv.lastTs)}</div>
      </div>
    `;
  }).join('');

  conversationsList.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => {
      const pedidoId = item.dataset.pedido;
      if (pedidoId) abrirChatPedido(pedidoId);
    });
  });
}

// ============================================================
// 💬 ABRIR CHAT POR PEDIDO
// ============================================================

async function abrirChatPedido(pedidoId) {
  if (!pedidoId || !currentChatUid) return;
  pedidoChatActual = pedidoId;

  try {
    const snap = await getDoc(doc(db, 'pedidos', pedidoId));
    if (!snap.exists()) return;
    const data = snap.data();
    const clienteNombre = data.clienteNombre || data.cliente || 'Cliente';

    if (chatCurrentClient) {
      chatCurrentClient.textContent = `${clienteNombre} - #${pedidoId.slice(-6).toUpperCase()}`;
    }

    if (messageInputContainer) messageInputContainer.style.display = 'flex';
    const noChat = document.querySelector('.no-chat-selected');
    if (noChat) noChat.style.display = 'none';

    escucharMensajesChat(pedidoId);
    await marcarMensajesLeidosChat(pedidoId);

  } catch (error) {
    console.warn('Error abriendo chat:', error);
  }
}

// ============================================================
// 📨 ESCUCHAR MENSAJES DEL CHAT
// ============================================================

function escucharMensajesChat(pedidoId) {
  if (unsubMensajes) { unsubMensajes();
    unsubMensajes = null; }
  if (!messagesContainer) return;
  messagesContainer.innerHTML = '';

  const msgsRef = collection(db, 'pedidos', pedidoId, 'mensajes');
  const q = query(msgsRef, orderBy('creadoEn', 'asc'), limit(200));

  unsubMensajes = onSnapshot(q, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return;
    messagesContainer.innerHTML = '';

    if (snapshot.empty) {
      messagesContainer.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:#6b7280;">
          <i class="fas fa-comment" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:10px;"></i>
          <p>No hay mensajes aún</p>
          <p style="font-size:0.85rem;color:#94a3b8;">Envía un mensaje para comenzar</p>
        </div>
      `;
      return;
    }

    snapshot.forEach((doc) => {
      const data = doc.data();
      appendMensajeChat({
        id: doc.id,
        texto: data.texto || '',
        uid: data.uid,
        tipo: data.tipo || 'text',
        creadoEn: data.creadoEn
      });
    });
    scrollBottomChat(messagesContainer);
  });
}

// ============================================================
// 📨 ESCUCHAR MENSAJES EN LA COLUMNA DERECHA
// ============================================================

function escucharMensajesColumna(pedidoId, container) {
  if (unsubMensajes) { unsubMensajes();
    unsubMensajes = null; }
  if (!container) return;
  container.innerHTML = '';

  const fmtTimeLocal = function(ts) {
    try {
      if (!ts) return '';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const formatearHora = (typeof fmtTimeChat === 'function') ? fmtTimeChat : fmtTimeLocal;

  const msgsRef = collection(db, 'pedidos', pedidoId, 'mensajes');
  const q = query(msgsRef, orderBy('creadoEn', 'asc'), limit(200));

  unsubMensajes = onSnapshot(q, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return;
    container.innerHTML = '';

    if (snapshot.empty) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:#9ca3af;">
          <i class="fas fa-comment-slash" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:12px;"></i>
          <p style="font-size:0.9rem;font-weight:500;">No hay mensajes aún</p>
          <p style="font-size:0.8rem;color:#d1d5db;">Envía un mensaje para comenzar</p>
        </div>
      `;
      return;
    }

    const user = auth.currentUser;
    snapshot.forEach((doc) => {
      const data = doc.data();
      const esMio = data.uid === user?.uid;

      const msgDiv = document.createElement('div');
      msgDiv.style.cssText = `
        display: flex;
        flex-direction: column;
        margin: 4px 0;
        align-items: ${esMio ? 'flex-end' : 'flex-start'};
        animation: fadeInMsg 0.3s ease;
      `;

      let nombre = data.nombre || 'Usuario';
      if (esMio) nombre = 'Tú';

      msgDiv.innerHTML = `
        <div style="
          max-width: 85%;
          padding: 10px 14px;
          border-radius: ${esMio ? '12px 12px 4px 12px' : '12px 12px 12px 4px'};
          background: ${esMio ? '#dcfce7' : '#f3f4f6'};
          border: 1px solid ${esMio ? '#86efac' : '#e5e7eb'};
        ">
          <div style="font-size:0.7rem;font-weight:600;color:#6b7280;margin-bottom:2px;">
            ${nombre}
          </div>
          <div style="font-size:0.9rem;word-break:break-word;">
            ${data.texto || ''}
          </div>
          <div style="font-size:0.6rem;color:#9ca3af;margin-top:4px;text-align:right;">
            ${formatearHora(data.creadoEn)}
          </div>
        </div>
      `;

      container.appendChild(msgDiv);
    });

    container.scrollTop = container.scrollHeight;
  }, (error) => {
    console.error('❌ Error escuchando mensajes:', error);
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#ef4444;">
        <i class="fas fa-exclamation-circle" style="font-size:2rem;display:block;margin-bottom:12px;"></i>
        <p style="font-size:0.9rem;">Error al cargar mensajes</p>
        <p style="font-size:0.8rem;color:#9ca3af;">${error.message || 'Revisa la consola'}</p>
      </div>
    `;
  });
}

// ============================================================
// 📤 RENDERIZAR MENSAJE DEL CHAT
// ============================================================

function appendMensajeChat(m) {
  if (!messagesContainer) return;
  const mine = (m.uid === currentChatUid);
  const div = document.createElement('div');
  div.className = `chat-message ${mine ? 'sent' : 'received'}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (m.texto) {
    const p = document.createElement('div');
    p.className = 'text';
    p.textContent = m.texto;
    bubble.appendChild(p);
  }

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = fmtTimeChat(m.creadoEn);
  bubble.appendChild(time);

  div.appendChild(bubble);
  messagesContainer.appendChild(div);
}

// ============================================================
// 📤 ENVIAR MENSAJE DEL CHAT
// ============================================================

async function enviarMensajeChat() {
  const texto = messageInput?.value?.trim();
  if (!texto || !pedidoChatActual || !currentChatUid) return;

  try {
    await addDoc(collection(db, 'pedidos', pedidoChatActual, 'mensajes'), {
      uid: currentChatUid,
      texto: texto,
      tipo: 'text',
      creadoEn: serverTimestamp()
    });

    await updateDoc(doc(db, 'pedidos', pedidoChatActual), {
      lastMsg: texto.slice(0, 120),
      lastTs: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });

    await crearNotificacionCliente(pedidoChatActual, texto);

    messageInput.value = '';
  } catch (error) {
    console.warn('Error enviando mensaje:', error);
  }
}

// ============================================================
// 🔔 NOTIFICAR AL CLIENTE
// ============================================================

async function crearNotificacionCliente(pedidoId, mensaje) {
  try {
    const snap = await getDoc(doc(db, 'pedidos', pedidoId));
    if (!snap.exists()) return;
    const data = snap.data();
    const clienteId = data.clienteId || data.uid;

    if (!clienteId) return;

    await crearNotificacion(clienteId, {
      tipo: 'mensaje_nuevo',
      titulo: '💬 Nuevo mensaje del comerciante',
      mensaje: mensaje.slice(0, 100),
      pedidoId: pedidoId,
      comercianteId: currentChatUid,
      enlace: `/chat-cliente.html?pedido=${pedidoId}`
    });

    console.log('✅ Notificación enviada al cliente:', clienteId);
  } catch (error) {
    console.warn('Error notificando al cliente:', error);
  }
}

// ============================================================
// ✅ MARCAR MENSAJES COMO LEÍDOS
// ============================================================

async function marcarMensajesLeidosChat(pedidoId) {
  try {
    const msgsRef = collection(db, 'pedidos', pedidoId, 'mensajes');
    const q = query(msgsRef, where('uid', '!=', currentChatUid), where('leido', '==', false));
    const snapshot = await getDocs(q);

    const promises = [];
    snapshot.forEach((doc) => promises.push(updateDoc(doc.ref, { leido: true })));
    await Promise.all(promises);

    await updateDoc(doc(db, 'pedidos', pedidoId), { mensajesNoLeidos: 0 });
  } catch (error) {
    console.warn('Error marcando leídos:', error);
  }
}

// ============================================================
// 🔔 ACTUALIZAR BADGE DEL CHAT
// ============================================================

function actualizarBadgeChat(total) {
  if (!chatBadge) return;
  if (total > 0) {
    chatBadge.textContent = total > 99 ? '99+' : total;
    chatBadge.style.display = 'inline-flex';
    chatBadge.classList.add('pop');
  } else {
    chatBadge.style.display = 'none';
    chatBadge.classList.remove('pop');
  }
}

// ============================================================
// 🛠️ UTILIDADES DEL CHAT
// ============================================================

function formatearTiempoChat(fecha) {
  if (!fecha) return '';
  const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} h`;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function fmtTimeChat(ts) {
  try {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function scrollBottomChat(el) {
  try { el.scrollTop = el.scrollHeight; } catch {}
}

// ============================================================
// 🎮 EVENTOS UI DEL CHAT
// ============================================================

chatBtn?.addEventListener('click', () => {
  if (chatModal) {
    chatModal.style.display = 'flex';
    chatModal.style.pointerEvents = 'auto';
    if (currentChatUid) escucharConversaciones(currentChatUid);
  }
});

closeChatBtn?.addEventListener('click', () => {
  if (chatModal) {
    chatModal.style.display = 'none';
    chatModal.style.pointerEvents = 'none';
    if (unsubMensajes) { unsubMensajes();
      unsubMensajes = null; }
    pedidoChatActual = null;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && chatModal?.style.display === 'flex') {
    chatModal.style.display = 'none';
    chatModal.style.pointerEvents = 'none';
  }
});

chatModal?.addEventListener('click', (e) => {
  if (e.target === chatModal) {
    chatModal.style.display = 'none';
    chatModal.style.pointerEvents = 'none';
  }
});

sendBtn?.addEventListener('click', (e) => { e.preventDefault();
  enviarMensajeChat(); });

messageInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault();
    enviarMensajeChat(); }
});

// ============================================================
// 🚀 INICIALIZAR CHAT CON LA AUTENTICACIÓN
// ============================================================

function initChatForUser(uid) {
  currentChatUid = uid;
  console.log('💬 Chat inicializado para:', uid);

  if (chatModal && chatModal.style.display === 'flex') {
    escucharConversaciones(uid);
  }
}

// ============================================================
// 📨 FUNCIÓN PARA ABRIR CHAT DESDE PEDIDO (global)
// ============================================================

window.openChatForPedido = async function(pedidoId) {
  if (!pedidoId) return;

  if (!currentChatUid) {
    const user = auth.currentUser;
    if (user) {
      currentChatUid = user.uid;
    } else {
      console.warn('No hay usuario autenticado para abrir chat');
      return;
    }
  }

  if (chatModal) {
    chatModal.style.display = 'flex';
    chatModal.style.pointerEvents = 'auto';
    await abrirChatPedido(pedidoId);
  }
};

/* -------------------------------------------------------------------------- */
/*                             AUTH + bootstrap                                */
/* -------------------------------------------------------------------------- */

let UID = null;

async function subirArchivo(uid, file, ruta = 'perfiles') {
  if (!file) return null;
  const cleanName = (file.name || 'archivo').replace(/\s+/g, '_');
  const storageRef = ref(storage, `${ruta}/${uid}/${Date.now()}_${cleanName}`);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

async function seedStoreIfNeeded(uid) {
  try {
    const refTi = doc(db, 'tiendas', uid);
    const snap = await getDoc(refTi);

    if (snap.exists() && snap.data().seeded) return;

    const tipo = (snap.data()?.tipoComercio || '').toLowerCase();

    const categoriasPorTipo = {
      licorera: ['licoreria'],
      farmacia: ['farmacia'],
      panaderia: ['panaderia'],
      restaurante: ['comidas'],
      ferreteria: ['ferreteria'],
      minimercado: ['abarrotes', 'bebidas', 'limpieza'],
      supermercado: ['abarrotes', 'bebidas', 'frutas', 'verduras', 'lacteos'],
      cafeteria: ['bebidas', 'panaderia'],
      carniceria: ['carnes'],
      tienda: ['abarrotes', 'bebidas']
    };
    const categorias = categoriasPorTipo[tipo] || ['otros'];

    let total = 0;

    for (const cat of categorias) {
      total += await Cat.sembrarCategoria(uid, cat);
    }

    await Cat.syncAllSubToRoot(uid);

    await setDoc(refTi, {
      seeded: true,
      actualizadoEn: serverTimestamp()
    }, { merge: true });

    await crearNotificacion(uid, {
      tipo: 'producto',
      titulo: 'Catálogo sembrado',
      mensaje: `Se sembraron ${total} productos para ${tipo}.`
    });

    setMsg(`Catálogo inicial sembrado (${total} productos) ✅`, true);

  } catch (e) {
    console.error('seedStoreIfNeeded error', e);
    setMsg('No se pudo sembrar el catálogo inicial', false);
  }
}

let _profileFile = null;
let _profileUrl = '';

function $(s) { return document.querySelector(s); }

function text(el, val) { if (el) el.textContent = val ?? ''; }

function src(el, val) { if (el && val) el.src = val; }

function pintarPreviewImagen(url) {
  const img = document.getElementById('preview-imagen') || document.querySelector('.store-image');
  if (img && url) img.src = url;
  const imgSmall = document.getElementById('tienda-image-preview');
  if (imgSmall && url) imgSmall.src = url;
}

function pintarPreviewPerfil(data = {}) {
  text(document.getElementById('preview-nombre'), data.nombre || getForm('nombre-comercio') || 'Mi comercio');
  text(document.getElementById('preview-desc'), data.descripcion || (document.getElementById('descripcion-publica')?.value || document
    .getElementById('descripcion')?.value || ''));
  text(document.getElementById('preview-direccion'), data.direccion || getForm('direccion') || getForm('tienda-direccion') || '');
  text(document.getElementById('preview-telefono'), data.telefono || getForm('telefono') || getForm('tienda-telefono') || '');
  text(document.getElementById('preview-horario'), data.horario || getForm('horario') || getForm('tienda-horario') || '');
  text(document.getElementById('preview-tipo'), data.tipoComercio || (document.getElementById('tipo-comercio')?.value || document
    .getElementById('tienda-tipo')?.value || ''));
  const estadoEl = document.getElementById('preview-estado');
  if (estadoEl) estadoEl.textContent = (data.activo ?? document.getElementById('tienda-activo')?.checked) ? 'Activa' : 'Inactiva';
  const fechaEl = document.getElementById('preview-fecha');
  if (fechaEl) fechaEl.textContent = fechaCorta(new Date());
  if (data.imageUrl || _profileUrl) pintarPreviewImagen(data.imageUrl || _profileUrl);
}

function bindConfigUI() {
  const fileEl = document.getElementById('tienda-image-file');
  const urlEl = document.getElementById('tienda-image-url');
  const descEl = document.getElementById('descripcion-publica') || document.getElementById('descripcion');
  const tipoEl = document.getElementById('tipo-comercio') || document.getElementById('tienda-tipo');

  if (fileEl && !fileEl._bound) {
    fileEl.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      _profileFile = f;
      const tmp = URL.createObjectURL(f);
      _profileUrl = tmp;
      pintarPreviewImagen(tmp);
    });
    fileEl._bound = true;
  }
  if (urlEl && !urlEl._bound) {
    urlEl.addEventListener('input', () => {
      _profileUrl = urlEl.value.trim();
      pintarPreviewImagen(_profileUrl);
    });
    urlEl._bound = true;
  }
    // 🔥 ACTUALIZAR VISTA PREVIA SIN BLOQUEAR LA ESCRITURA (DEBOUNCE)
  const actualizarPreviewDebounced = debounce(() => {
    pintarPreviewPerfil({});
  }, 500);

  [descEl, tipoEl, $('#nombre-comercio'), $('#direccion'), $('#telefono'), $('#horario')].forEach(el => {
    if (!el || el._bound) return;
    el.addEventListener('input', () => {
      actualizarPreviewDebounced();
    });
    el._bound = true;
  });

  // ============================================================
  // 📍 BOTÓN: MI UBICACIÓN ACTUAL
  // ============================================================
  document.getElementById('btn-use-my-location')?.addEventListener('click', () => {
    try {
      if (!navigator.geolocation) {
        setMsg('❌ Tu navegador no soporta geolocalización', false);
        return;
      }

      setMsg('📍 Obteniendo tu ubicación...', true);

      navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        if (mapTiendas && markerTiendas) {
          mapTiendas.setView([lat, lng], 16);
          markerTiendas.setLatLng([lat, lng]);
        }

        const latInput = document.getElementById('tienda-lat');
        const lonInput = document.getElementById('tienda-lon');
        if (latInput) latInput.value = lat;
        if (lonInput) lonInput.value = lng;

        actualizarDisplayCoordenadas(lat, lng);

        const direccion = await obtenerDireccionDesdeCoordenadas(lat, lng);
        if (direccion) {
          const dirInput = document.getElementById('tienda-direccion');
          const dirInput2 = document.getElementById('direccion');
          if (dirInput) dirInput.value = direccion;
          if (dirInput2) dirInput2.value = direccion;
        }

        await guardarUbicacionEnFirestore(lat, lng, direccion);

        setMsg('✅ Ubicación actualizada con tu posición', true);

        if (typeof window.updateLocationStatus === 'function') {
          window.updateLocationStatus(true);
        }

      }, (error) => {
        console.warn('Error de geolocalización:', error);
        setMsg('❌ No se pudo obtener tu ubicación', false);
      }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });

    } catch (error) {
      console.warn('Error en geolocalización:', error);
      setMsg('❌ Error al obtener ubicación', false);
    }
  });
}

/* ======= Bootstrap de Auth ======= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { console.log('Sin sesión Firebase'); return; }
  UID = user.uid;

  try { localStorage.removeItem('perfilUsuario'); } catch {}
  try { sessionStorage.removeItem('currentUser'); } catch {}

  let perfil = await cargarPerfil(UID);
  if (!perfil) {
    const base = await asegurarPerfil(UID, user);
    perfil = { id: UID, ...base };
  }
  localStorage.setItem('perfilUsuario', JSON.stringify({
    nombre: perfil.nombre || perfil.nombres || (user.email ? user.email.split('@')[0] : 'Comerciante'),
    email: user.email || '',
  }));
  sessionStorage.setItem('currentUser', JSON.stringify({ uid: UID, rol: 'comerciante' }));
  pintarChipUsuario();
  pintarBienvenida(perfil.nombre || perfil.nombres || (user.email ? user.email.split('@')[0] : 'Comerciante'));

  // 🚀 INICIALIZAR CHAT
  initChatForUser(UID);

  // 💰 INICIALIZAR SERVICIOS
  initServicios(UID);

  // 🗂️ INICIALIZAR COMPLETADOS
  cargarCompletados();

  const btnSembrar = document.getElementById('btn-sembrar-catalogo') || document.getElementById('btn-sembrar-300');
  const btnActualizar = document.getElementById('btn-actualizar-precios');
  const seedStatusEl = document.getElementById('seed-status');

  async function actualizarSeedStatus() {
    try {
      const sembrado = await catalogoYaSembrado(UID);
      const ahora = new Date();
      const yyyymm = String(ahora.getFullYear()) + String(ahora.getMonth() + 1).padStart(2, '0');
      const ultimo = await getUltimoMesActualizado(UID);

      if (seedStatusEl) {
        const partes = [];
        partes.push(sembrado ? 'Catálogo base: ✅ sembrado' : 'Catálogo base: ⏳ pendiente');
        partes.push(ultimo === yyyymm ? `Precios ${yyyymm}: ✅ al día` : `Precios ${yyyymm}: ⏳ pendientes`);
        seedStatusEl.textContent = partes.join(' · ');
      }
      if (btnSembrar) btnSembrar.disabled = !!sembrado;
    } catch (e) {
      console.warn('No se pudo actualizar el estado de siembra:', e);
      if (seedStatusEl) seedStatusEl.textContent = 'Estado de catálogo: —';
    }
  }

  btnSembrar?.addEventListener('click', async () => {
    if (btnSembrar.disabled) return;
    btnSembrar.disabled = true;
    try { await accionarSembradoInicial(UID); } finally { btnSembrar.disabled = false;
      actualizarSeedStatus();
      prodLoadPage({ reset: true }); }
  });

  btnActualizar?.addEventListener('click', async () => {
    if (btnActualizar.disabled) return;
    btnActualizar.disabled = true;
    try { await accionarActualizacionPrecios(UID); } finally { btnActualizar.disabled = false;
      actualizarSeedStatus();
      prodLoadPage({ reset: true }); }
  });

  initLocationMap();
  initMapTiendas();

  try {
    const tienda = await cargarMiTienda(UID);
    if (tienda) {
      setForm('nombre-comercio', tienda.nombre || '');
      setForm('direccion', tienda.direccion || '');
      setForm('ciudad', tienda.ciudad || '');
      setForm('pais', tienda.pais || '');
      setForm('telefono', tienda.telefono || '');
      setForm('horario', tienda.horario || '');
      const lat = toNum(tienda.lat);
      const lon = toNum(tienda.lon ?? tienda.lng);
      if (lat != null && lon != null) {
        coords = { lat, lng: lon };
        moveMap(coords);
        actualizarDisplayCoordenadas(lat, lon);
      }
      fillMiTiendaForm(tienda);
      pintarPreviewPerfil({ ...tienda, imageUrl: tienda.imageUrl });
    }

    // ============================================================
// 🚀 NO BLOQUEAR EL INICIO DEL PANEL
// La actualización de precios y la siembra siguen automáticas,
// pero se ejecutan en segundo plano.
// ============================================================

Promise.resolve().then(async () => {
  try {
    const ahora = new Date();
    const yyyymm =
      String(ahora.getFullYear()) +
      String(ahora.getMonth() + 1).padStart(2, '0');

    const ultimo = await getUltimoMesActualizado(UID);

    if (ultimo !== yyyymm) {
      await accionarActualizacionPrecios(UID);
    }
  } catch (e) {
    console.warn('⚠️ Auto-actualización mensual omitida:', e);
  }
});

Promise.resolve().then(async () => {
  try {
    const ya = await catalogoYaSembrado(UID);

    if (!ya) {
      await accionarSembradoInicial(UID);
    }

    // Cuando termine la siembra, actualizar la tabla
    await prodLoadPage({ reset: true });

  } catch (e) {
    console.warn('⚠️ Falla siembra base:', e);

    try {
      await seedStoreIfNeeded(UID);
    } catch (fallbackError) {
      console.warn('⚠️ Fallback de siembra omitido:', fallbackError);
    }
  }
});

// Actualizar estado sin detener la entrada al panel
Promise.resolve().then(() => {
  actualizarSeedStatus();
});
  } catch (e) { console.error(e); }

  initPushForUser(UID);
  setupCampanita(UID);
  document.getElementById('notification-icon')?.addEventListener('click', () => marcarNotificacionesLeidas(UID));

  bindConfigUI();
  initProductosModule();
  listenPedidos();
});

/* -------------------- Productos: KPI en tiempo real -------------------- */
let unsubProductosCount = null;

function listenProductosCount(uid) {
  if (unsubProductosCount) { try { unsubProductosCount(); } catch {} }
  const q = query(collection(db, 'productos'), where('tiendaId', '==', uid));
  unsubProductosCount = onSnapshot(q, (snap) => {
    const total = snap.size || 0;
    const el = document.querySelector('.stats-grid .stat-card .stat-value');
    if (el) el.textContent = String(total);
  }, (err) => console.error('Error listenProductosCount:', err));
}

/* -------------------------------------------------------------------------- */
/*                     Guardar configuración / Mi tienda                      */
/* -------------------------------------------------------------------------- */

const formTienda = document.querySelector('#form-tienda');
const previewCard = document.querySelector('#preview-card');
const msg = document.querySelector('#pc-msg');
const btnGuardar = document.querySelector('#btn-guardar');

const IN = {
  nombre: document.querySelector('#tienda-nombre'),
  descripcion: document.querySelector('#tienda-descripcion'),
  direccion: document.querySelector('#tienda-direccion'),
  telefono: document.querySelector('#tienda-telefono'),
  horario: document.querySelector('#tienda-horario'),
  lat: document.querySelector('#tienda-lat'),
  lon: document.querySelector('#tienda-lon'),
  activo: document.querySelector('#tienda-activo'),
  imgFile: document.querySelector('#tienda-image-file'),
  imgUrlHidden: document.querySelector('#tienda-image-url'),
  imgPreview: document.querySelector('#tienda-image-preview'),
};

const PV = {
  nombre: document.querySelector('#preview-nombre'),
  desc: document.querySelector('#preview-desc'),
  dir: document.querySelector('#preview-direccion'),
  tel: document.querySelector('#preview-telefono'),
  horario: document.querySelector('#preview-horario'),
  estado: document.querySelector('#preview-estado'),
  fecha: document.querySelector('#preview-fecha'),
  img: document.querySelector('#preview-img'),
};

function sanitize(obj) { const o = {};
  Object.keys(obj || {}).forEach(k => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }

function dataFromForm() {
  return sanitize({
    tipo: 'tienda',
    nombre: (IN.nombre?.value || '').trim(),
    descripcion: (IN.descripcion?.value || '').trim(),
    direccion: (IN.direccion?.value || '').trim(),
    telefono: (IN.telefono?.value || '').trim(),
    horario: (IN.horario?.value || '').trim(),
    lat: IN.lat?.value ? Number(IN.lat.value) : null,
    lon: IN.lon?.value ? Number(IN.lon.value) : null,
    activo: !!IN.activo?.checked,
    imageUrl: IN.imgUrlHidden?.value || IN.imgPreview?.src || '',
    actualizadoEn: serverTimestamp(),
  });
}

function fillForm(d = {}) {
  if (IN.nombre) IN.nombre.value = d.nombre || '';
  if (IN.descripcion) IN.descripcion.value = d.descripcion || '';
  if (IN.direccion) IN.direccion.value = d.direccion || '';
  if (IN.telefono) IN.telefono.value = d.telefono || '';
  if (IN.horario) IN.horario.value = d.horario || '';
  if (IN.lat) IN.lat.value = d.lat ?? '';
  if (IN.lon) IN.lon.value = d.lon ?? '';
  if (IN.activo) IN.activo.checked = d.activo !== false;

  if ((d.imageUrl || d.imagen) && IN.imgPreview) {
    IN.imgPreview.src = d.imageUrl || d.imagen;
    if (IN.imgUrlHidden) IN.imgUrlHidden.value = d.imageUrl || d.imagen;
  }
  updatePreview(d);
}

function updatePreview(src) {
  const d = src || dataFromForm();
  if (previewCard) previewCard.style.display = 'block';
  if (PV.nombre) PV.nombre.textContent = d.nombre || '—';
  if (PV.desc) PV.desc.textContent = d.descripcion || '—';
  if (PV.dir) PV.dir.textContent = d.direccion || '—';
  if (PV.tel) PV.tel.textContent = d.telefono || '—';
  if (PV.horario) PV.horario.textContent = d.horario || '—';
  if (PV.estado) PV.estado.textContent = d.activo === false ? 'Inactiva' : 'Activa';
  if (PV.img && (d.imageUrl || d.imagen)) PV.img.src = d.imageUrl || d.imagen;
  if (PV.fecha) PV.fecha.textContent = new Date().toLocaleString();
}

function toast(text, ok = true) {
  if (!msg) return;
  msg.classList.toggle('error', !ok);
  msg.style.display = 'inline-block';
  msg.textContent = text;
  if (ok) setTimeout(() => { msg.style.display = 'none'; }, 1600);
}

let savingProfile = false;

async function save(partial) {
  if (!UID) return;
  if (savingProfile) return;
  savingProfile = true;

  const oldHTML = btnGuardar?.innerHTML;
  if (btnGuardar) {
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
  }
  toast('Guardando…', true);

  try {
    const payload = sanitize({
      ...partial ?? dataFromForm(),
      actualizadoEn: serverTimestamp(),
      creadoEn: serverTimestamp(),
      aprobada: partial?.activo ?? IN.activo?.checked ?? true,
    });
    await setDoc(doc(db, 'tiendas', UID), payload, { merge: true });

    try {
      const d = partial ?? dataFromForm();
      await setDoc(doc(db, 'perfiles', UID), {
        nombre: d.nombre || '',
        descripcion: d.descripcion || '',
        horario: d.horario || '',
        telefono: d.telefono || '',
        lat: d.lat ?? null,
        lon: d.lon ?? null,
        imageUrl: d.imageUrl || '',
        tipoComercio: d.tipoComercio || '',
        direccion: d.direccion || '',
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {}

    toast('Configuración guardada ✓', true);
  } catch (e) {
    console.error('Error al guardar tienda:', e);
    toast('Error al guardar. Revisa la consola.', false);
  } finally {
    savingProfile = false;
    if (btnGuardar) {
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = oldHTML || '<i class="fas fa-save"></i> Guardar';
    }
  }
}

formTienda?.addEventListener('submit', (e) => { e.preventDefault();
  save(); });

const autoSave = debounce(() => save(), 700);

['input', 'change'].forEach(ev => {
  formTienda?.querySelectorAll('input,textarea').forEach(el => {
    if (el._saveBound) return;
    el._saveBound = true;

    el.addEventListener(ev, () => {
      // 🔥 LA CLAVE: debounce para que no guarde en cada tecla
      // y no le "robe" el texto al usuario
      clearTimeout(el._saveTimer);
      el._saveTimer = setTimeout(() => {
        updatePreview();
        autoSave();
      }, 800);
    });
  });
});

IN.imgFile?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (IN.imgPreview) IN.imgPreview.src = reader.result;
    if (IN.imgUrlHidden) IN.imgUrlHidden.value = String(reader.result || '');
    updatePreview();
    autoSave();
  };
  reader.readAsDataURL(file);
});

let unsubTiendaProfile = null;

function listenTiendaRealtime() {
  if (unsubTiendaProfile) { try { unsubTiendaProfile(); } catch {} }
  if (!UID) return;
  const ref = doc(db, 'tiendas', UID);

  unsubTiendaProfile = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const d = snap.data();

      // 🔥 Evitar que se borre lo que el usuario está escribiendo
      const activeEl = document.activeElement;
      const isEditing = activeEl && ['INPUT', 'TEXTAREA'].includes(activeEl.tagName);

      if (!(isEditing && activeEl.id === 'tienda-descripcion')) {
        fillForm(d);
      }

      if (d.lat && d.lon) {
        coords = { lat: d.lat, lng: d.lon };
        moveMap(coords);
        actualizarDisplayCoordenadas(d.lat, d.lon);
      }
    }
  });
}
 
onAuthStateChanged(auth, (u) => { if (u) { listenTiendaRealtime(); } });
/* -------------------------------------------------------------------------- */
/*                           CRUD Productos (básico)                           */
/* -------------------------------------------------------------------------- */

async function subirImagenProducto(file, uid) {
  if (!file) return null;
  const storageRef = ref(storage, `productos/${uid}/nuevo/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

document.getElementById('form-producto')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (!UID) throw new Error('Debes iniciar sesión');
    const nombre = document.getElementById('nombre')?.value?.trim() || '';
    const precio = parseFloat(document.getElementById('precio')?.value || '0');
    const categoria = document.getElementById('categoria')?.value || 'otros';
    const inventario = parseInt(document.getElementById('inventario')?.value || '0', 10);
    const imagenUrlEscrita = document.getElementById('imagen')?.value?.trim() || '';
    const descripcion = document.getElementById('descripcion')?.value?.trim() || '';
    const unidadBase = normalizeUnit(document.getElementById('unidadBase')?.value?.trim() || 'unidad');

    if (!nombre) return alert('Nombre de producto obligatorio');

    let imagenFinal = imagenUrlEscrita;
    const file = document.getElementById('imagen-file')?.files?.[0] || null;
    if (file) imagenFinal = await subirImagenProducto(file, UID);
    if (!imagenFinal) imagenFinal = 'https://placehold.co/300x200?text=Producto';

    const rootRef = await addDoc(collection(db, 'productos'), {
      tiendaId: UID,
      nombre,
      precio,
      categoria,
      inventario,
      imagen: imagenFinal,
      descripcion,
      unidadBase,
      activo: true,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
    await setDoc(doc(db, 'tiendas', UID, 'productos', rootRef.id), {
      nombre,
      precio,
      categoria,
      inventario,
      imagen: imagenFinal,
      descripcion,
      unidadBase,
      activo: true,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    }, { merge: true });

    await crearNotificacion(UID, { tipo: 'producto', titulo: 'Producto agregado', mensaje: `${nombre} creado correctamente.` });

    alert(`Producto "${nombre}" agregado con éxito!`);
    e.target.reset();
    await prodLoadPage({ reset: true });
  } catch (err) { console.error(err);
    alert('No se pudo agregar el producto.'); }
});

/* -------------------------------------------------------------------------- */
/*                     MÓDULO PRODUCTOS (lista + paginación)                  */
/* -------------------------------------------------------------------------- */

const PROD_PAGE_SIZE = 20;
let _uid = null;
let _prodLastDoc = null;
let _prodLoading = false;
let _prodInitialized = false;
let _prodOrderField = 'actualizadoEn';

function prodEls() {
  return {
    tbody: document.getElementById('product-list'),
    btnFiltrar: document.getElementById('btn-filtrar') || document.querySelector('.product-filters button'),
    btnVerMas: document.getElementById('btn-ver-mas'),
    search: document.getElementById('product-search'),
    cat: document.getElementById('product-filter'),
    sort: document.getElementById('product-sort'),
  };
}

function getProdFilters() {
  const { search, cat, sort } = prodEls();
  return {
    term: (search?.value || '').trim(),
    cat: (cat?.value || 'todas'),
    sort: (sort?.value || 'recientes'),
  };
}

function prodSetVerMasEnabled(enabled) {
  const { btnVerMas } = prodEls();
  if (!btnVerMas) return;
  btnVerMas.disabled = !enabled;
  btnVerMas.style.opacity = enabled ? '1' : '.5';
}

function prodRowHTML(d) {
  const p = d.data();
  const img = p.imagenThumb || p.imagen || 'https://placehold.co/60x60?text=60×60';
  const fid = `file-${d.id}`;
  const safeName = (p.nombre || '').replace(/"/g, '&quot;');

  return `
    <tr data-id="${d.id}">
      <td style="width:70px">
        <label for="${fid}" class="pc-thumb" title="Cambiar imagen" style="cursor:pointer;display:inline-block">
          <img src="${img}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;background:#f8fafc">
        </label>
        <input id="${fid}" type="file" accept="image/*" class="file-thumb" data-id="${d.id}" hidden>
      </td>

      <td>
        <input class="in-nombre" type="text" value="${safeName}"
               placeholder="Nombre del producto"
               style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px">
      </td>

      <td><span class="cell-precio">${typeof p.precio === 'number' ? money(p.precio) : '-'}</span></td>
      <td><span class="cell-stock">${p.inventario ?? 0}</span></td>
      <td>${p.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-warning">Pausado</span>'}</td>
      <td>${p.categoria || '-'}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-sm btn-primary btn-edit">Editar</button>
        <button class="btn btn-sm ${p.activo ? 'btn-outline' : 'btn-primary'} btn-toggle" data-estado="${p.activo ? 'on' : 'off'}">${p.activo ? 'Pausar' : 'Activar'}</button>
        <button class="btn btn-sm btn-outline btn-del">Eliminar</button>
      </td>
    </tr>
  `;
}

function prodAttachDelegates() {
  const { tbody } = prodEls();
  if (!tbody || tbody._delegated) return;
  tbody._delegated = true;

  tbody.addEventListener('click', async (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.getAttribute('data-id');
    const btn = ev.target.closest('button');

    if (btn?.classList.contains('btn-edit')) {
      const snap = await getDoc(doc(db, 'productos', id));
      if (!snap.exists()) return alert('No encontrado');

      const p = snap.data();
      setForm('edit-id', id);
      setForm('edit-nombre', p.nombre || '');
      setForm('edit-precio', p.precio ?? 0);
      setForm('edit-inventario', p.inventario ?? 0);
      setForm('edit-categoria', p.categoria || 'otros');
      setForm('edit-imagen', p.imagen || '');
      setForm('edit-descripcion', p.descripcion || '');
      const ub = document.getElementById('edit-unidadBase');
      if (ub) ub.value = p.unidadBase || 'unidad';
      const act = document.getElementById('edit-activo');
      if (act) act.checked = !!p.activo;

      showOverlay('product-modal');
      return;
    }

    if (btn?.classList.contains('btn-toggle')) {
      const currentlyOn = btn.dataset.estado === 'on';
      const turnOn = !currentlyOn;
      try {
        await updateDoc(doc(db, 'productos', id), { activo: turnOn, actualizadoEn: serverTimestamp() });
        await setDoc(doc(db, 'tiendas', UID, 'productos', id), { activo: turnOn, actualizadoEn: serverTimestamp() }, { merge: true });

        btn.dataset.estado = turnOn ? 'on' : 'off';
        btn.textContent = turnOn ? 'Pausar' : 'Activar';
        btn.classList.toggle('btn-outline', turnOn);
        btn.classList.toggle('btn-primary', !turnOn);

        const estadoTd = tr.querySelector('td:nth-child(5)');
        if (estadoTd) estadoTd.innerHTML = turnOn ?
          '<span class="badge badge-success">Activo</span>' :
          '<span class="badge badge-warning">Pausado</span>';

        setMsg(turnOn ? 'Producto activado ✅' : 'Producto pausado ✅', true);
      } catch (e) { console.error(e);
        setMsg('No se pudo cambiar el estado', false); }
      return;
    }

    if (btn?.classList.contains('btn-del')) {
      if (!confirm('¿Eliminar este producto?')) return;
      try {
        const snap = await getDoc(doc(db, 'productos', id));
        const nombre = snap.data()?.nombre || 'Producto';
        await deleteDoc(doc(db, 'productos', id));
        await deleteDoc(doc(db, 'tiendas', UID, 'productos', id)).catch(() => {});
        setMsg('Producto eliminado ✅', true);
        await crearNotificacion(UID, { tipo: 'producto', titulo: 'Producto eliminado', mensaje: `${nombre} fue eliminado.` });
        tr.remove();
      } catch (e) { console.error(e);
        setMsg('No se pudo eliminar el producto', false); }
    }
  });

  tbody.addEventListener('change', async (ev) => {
    const input = ev.target.closest('.file-thumb');
    if (!input) return;
    const id = input.dataset.id;
    const file = input.files && input.files[0];
    if (!file || !id || !UID) return;

    const tr = tbody.querySelector(`tr[data-id="${id}"]`);
    const img = tr?.querySelector('td img');
    if (img) img.src = URL.createObjectURL(file);

    try {
      const url = await subirImagenProducto(file, UID);
      if (!url) throw new Error('Sin URL');

      await updateDoc(doc(db, 'productos', id), { imagen: url, actualizadoEn: serverTimestamp() });
      await setDoc(doc(db, 'tiendas', UID, 'productos', id), { imagen: url, actualizadoEn: serverTimestamp() }, { merge: true });

      setMsg('Imagen actualizada ✅', true);
    } catch (e) {
      console.error(e);
      setMsg('No se pudo subir la imagen', false);
    } finally {
      input.value = '';
    }
  });

  async function guardarNombreInline(id, nuevo) {
    const name = (nuevo || '').trim();
    if (!id || !name) return;
    try {
      await updateDoc(doc(db, 'productos', id), { nombre: name, actualizadoEn: serverTimestamp() });
      await setDoc(doc(db, 'tiendas', UID, 'productos', id), { nombre: name, actualizadoEn: serverTimestamp() }, { merge: true });
      setMsg('Nombre guardado ✅', true);
    } catch (e) {
      console.error(e);
      setMsg('No se pudo guardar el nombre', false);
    }
  }

  tbody.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('.in-nombre');
    if (!el) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const tr = el.closest('tr[data-id]');
      guardarNombreInline(tr?.dataset.id, el.value);
      el.blur();
    }
  });

  tbody.addEventListener('blur', (ev) => {
    const el = ev.target.closest('.in-nombre');
    if (!el) return;
    const tr = el.closest('tr[data-id]');
    guardarNombreInline(tr?.dataset.id, el.value);
  }, true);
}

function prodRenderRows(docs) {
  const { tbody } = prodEls();
  if (!tbody) return;

  const { term, cat } = getProdFilters();
  const frag = document.createDocumentFragment();

  for (const d of docs) {
    const p = d.data();

    if (cat && cat !== 'todas' && (p.categoria || 'otros') !== cat) continue;

    if (term) {
      const needle = term.toLowerCase();
      const hay = `${p.nombre || ''} ${p.descripcion || ''}`;
      if (!hay.toLowerCase().includes(needle)) continue;
    }

    const tpl = document.createElement('template');
    tpl.innerHTML = prodRowHTML(d).trim();
    const tr = tpl.content.firstElementChild;
    if (tr) frag.appendChild(tr);
  }

  tbody.appendChild(frag);
  prodAttachDelegates();
}

async function prodFetchPage(orderField) {
  let qRef = query(
    collection(db, 'productos'),
    where('tiendaId', '==', _uid),
    orderBy(orderField, 'desc'),
    limit(PROD_PAGE_SIZE)
  );

  if (_prodLastDoc) qRef = query(qRef, startAfter(_prodLastDoc));
  return await getDocs(qRef);
}

async function prodLoadPage({ reset = false } = {}) {
  if (!_uid || _prodLoading) return;
  _prodLoading = true;

  const { tbody } = prodEls();
  if (reset && tbody) {
    tbody.innerHTML = '';
    _prodLastDoc = null;
  }

  const { sort } = getProdFilters();
  if (sort === 'precio-asc' || sort === 'precio-desc') _prodOrderField = 'precio';
  else if (sort === 'stock-asc' || sort === 'stock-desc') _prodOrderField = 'inventario';
  else _prodOrderField = 'actualizadoEn';

  try {
    let snap;
    try {
      snap = await prodFetchPage(_prodOrderField);
    } catch (e) {
      if (_prodOrderField === 'actualizadoEn') {
        _prodOrderField = 'creadoEn';
        snap = await prodFetchPage(_prodOrderField);
      } else {
        throw e;
      }
    }

    const docs = snap.docs;
    if (docs.length) {
      if (sort === 'precio-asc' || sort === 'stock-asc') docs.reverse();

      prodRenderRows(docs);
      _prodLastDoc = docs[docs.length - 1];
      prodSetVerMasEnabled(docs.length === PROD_PAGE_SIZE);
    } else {
      prodSetVerMasEnabled(false);
    }
  } catch (err) {
    console.error('[Productos] Error listando:', err);
    prodSetVerMasEnabled(false);
  } finally {
    _prodLoading = false;
  }
}

function prodHookUI() {
  const { btnFiltrar, btnVerMas, search, cat, sort } = prodEls();

  if (btnFiltrar && !btnFiltrar._prodHooked) {
    btnFiltrar.addEventListener('click', () => prodLoadPage({ reset: true }));
    btnFiltrar._prodHooked = true;
  }
  if (btnVerMas && !btnVerMas._prodHooked) {
    btnVerMas.addEventListener('click', () => prodLoadPage({ reset: false }));
    btnVerMas._prodHooked = true;
  }

  search?.addEventListener('input', debounce(() => prodLoadPage({ reset: true }), 250));
  cat?.addEventListener('change', () => prodLoadPage({ reset: true }));
  sort?.addEventListener('change', () => prodLoadPage({ reset: true }));
}

function isProductsView() {
  const hashSays = (location.hash || '').includes('#products');
  const activeSays = document.getElementById('products-content')?.classList.contains('active');
  return !!(hashSays || activeSays);
}

function initProductosOnce() {
  if (_prodInitialized) return;
  _prodInitialized = true;
  prodHookUI();
  prodLoadPage({ reset: true });
}

function initProductosModule() {
  const cached = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

  if (cached?.uid) {
    _uid = cached.uid;
  }

  onAuthStateChanged(auth, async (u) => {
    if (!u) return;

    _uid = u.uid;

    let tipoComerciante = 'tienda';

    try {
      const perfilSnap = await getDoc(doc(db, 'perfiles', _uid));

      if (perfilSnap.exists()) {
        const data = perfilSnap.data();

        tipoComerciante =
          data.tipoComerciante ||
          data.tipo ||
          'tienda';
      }
    } catch (e) {
      console.warn('No se pudo obtener tipoComerciante:', e);
    }

    sessionStorage.setItem(
      'currentUser',
      JSON.stringify({
        uid: _uid,
        rol: 'comerciante',
        tipoComerciante
      })
    );

    if (isProductsView()) {
      initProductosOnce();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (_uid && isProductsView()) {
      initProductosOnce();
    }
  });

  window.addEventListener('hashchange', () => {
    if (_uid && isProductsView()) {
      initProductosOnce();
    }
  });
}

/* -------------------------------------------------------------------------- */
/*                                   Pedidos                                  */
/* -------------------------------------------------------------------------- */

let unsubPedidos = null;
let pedidosCache = [];

function badgeByStatus(s) {
  switch ((s || '').toLowerCase()) {
    case 'pendiente':
      return 'badge-warning';
    case 'proceso':
      return 'badge-info';
    case 'envio':
      return 'badge-primary';
    case 'completado':
      return 'badge-success';
    case 'cancelado':
      return 'badge-danger';
    default:
      return 'badge-secondary';
  }
}

async function setEstadoPedido(pedidoId, nuevoEstado) {
  try {
    const p = pedidosCache.find(x => x.id === pedidoId);
    if (!p) return alert('Pedido no encontrado');

    // 🔥 TRANSICIONES SIMPLIFICADAS - FLUJO CORRECTO
    const VALID_TRANSITIONS = {
      pendiente: ['aceptado', 'cancelado'],
      aceptado: ['en_preparacion', 'cancelado'],
      en_preparacion: ['enviado', 'cancelado'],
      preparando: ['enviado', 'cancelado'],
      enviado: [], // Solo el cliente puede marcar como entregado
      entregado: [],
      completado: [],
      cancelado: []
    };

    const allowed = VALID_TRANSITIONS[p.estado] || [];
    if (!allowed.includes(nuevoEstado)) {
      return alert(`No se puede pasar de "${p.estado}" a "${nuevoEstado}"`);
    }

    // 🔥 SI SE ACEPTA, DETENER ALERTA Y REGISTRAR TIEMPO
    if (nuevoEstado === 'aceptado') {
        detenerAlertaPedido(pedidoId);
        registrarTiempoAceptacion(pedidoId);
        pedidosPendientesCount = Math.max(0, pedidosPendientesCount - 1);
        actualizarContadorPendientes();
    }

    await updateDoc(doc(db, 'pedidos', pedidoId), {
      estado: nuevoEstado,
      actualizadoEn: serverTimestamp()
    });

    setMsg(`✅ Estado cambiado a ${nuevoEstado}`, true);

    await crearNotificacion(UID, {
      tipo: 'pedido',
      titulo: '📦 Estado de pedido',
      mensaje: `Pedido #${pedidoId.slice(-6).toUpperCase()} → ${nuevoEstado}`
    });

    await notificarClientePush(p, nuevoEstado);

    // 🔄 RECARGAR EL DETALLE PARA ACTUALIZAR BOTONES
    setTimeout(() => {
      openOrderDetail(pedidoId);
    }, 300);

  } catch (e) {
    console.error(e);
    setMsg('❌ No se pudo cambiar el estado', false);
  }
}

async function notificarClientePush(pedido, nuevoEstado) {
  try {
    if (!pedido || !pedido.clienteId && !pedido.uid) {
      console.warn('No se puede notificar: falta clienteId');
      return;
    }

    const clienteId = pedido.clienteId || pedido.uid;
    if (!clienteId) return;

    const clienteRef = doc(db, 'usuarios', clienteId);
    const clienteSnap = await getDoc(clienteRef);

    let token = null;
    if (clienteSnap.exists()) {
      const data = clienteSnap.data();
      token = data.fcmToken || data.token || null;
    }

    if (!token) {
      const perfilRef = doc(db, 'perfiles', clienteId);
      const perfilSnap = await getDoc(perfilRef);
      if (perfilSnap.exists()) {
        token = perfilSnap.data().fcmToken || perfilSnap.data().token || null;
      }
    }

    if (!token) {
      console.warn('Cliente sin token FCM:', clienteId);
      return;
    }

    const estadoLabels = {
      'pendiente': '⏳ Pendiente',
      'proceso': '🔄 En proceso',
      'envio': '📦 En camino',
      'aceptado': '✅ Aceptado',
      'en_preparacion': '👨‍🍳 En preparación',
      'listo': '🍽️ Listo para recoger',
      'completado': '✅ Completado',
      'cancelado': '❌ Cancelado',
      'entregado': '📦 Entregado'
    };

    const estadoLabel = estadoLabels[nuevoEstado] || nuevoEstado;
    const tiendaNombre = pedido.tiendaNombre || 'Tu tienda';

    const titulo = `📦 Actualización de tu pedido #${pedido.id?.slice(-6)?.toUpperCase() || '---'}`;
    const cuerpo = `${estadoLabel} - ${tiendaNombre}`;

    await enviarPushNotification(token, titulo, cuerpo, {
      pedidoId: pedido.id,
      estado: nuevoEstado,
      tiendaId: pedido.tiendaId
    });

    console.log(`✅ Notificación push enviada a cliente ${clienteId}: ${nuevoEstado}`);

  } catch (error) {
    console.warn('Error enviando notificación push al cliente:', error);
  }
}

async function enviarPushNotification(token, titulo, cuerpo, data = {}) {
  try {
    if (!token || token.length < 20) {
      console.warn('Token FCM inválido');
      return;
    }

    if (data.pedidoId) {
      const notifRef = collection(db, 'notificaciones', data.pedidoId, 'push');
      await addDoc(notifRef, {
        titulo: titulo,
        cuerpo: cuerpo,
        leida: false,
        creadoEn: serverTimestamp(),
        data: data
      });
    }

    console.log('📨 Notificación push registrada para el cliente');

  } catch (error) {
    console.warn('Error enviando push notification:', error);
  }
}

function renderTablaPedidos(pedidos) {
  const tbody = document.querySelector('#orders-content .order-table tbody');
  if (!tbody) return;
  if (!pedidos.length) { tbody.innerHTML = `<tr><td colspan="6">No hay pedidos</td></tr>`; return; }

  tbody.innerHTML = pedidos.map(p => {
    const acciones = [];
    if (p.estado === 'pendiente') acciones.push(`<button class="btn btn-sm btn-primary act" data-a="aceptado" data-id="${p.id}">Aceptar</button>`);
    if (p.estado === 'aceptado') acciones.push(`<button class="btn btn-sm btn-primary act" data-a="en_preparacion" data-id="${p.id}">Preparar</button>`);
    if (p.estado === 'en_preparacion' || p.estado === 'preparando') acciones.push(`<button class="btn btn-sm btn-primary act" data-a="enviado" data-id="${p.id}">Enviar</button>`);
    if (p.estado !== 'entregado' && p.estado !== 'cancelado' && p.estado !== 'completado' && p.estado !== 'enviado') {
      acciones.push(`<button class="btn btn-sm btn-outline act" data-a="cancelado" data-id="${p.id}">Cancelar</button>`);
    }
    acciones.push(`<button class="btn btn-sm btn-outline btn-chat" data-id="${p.id}"><i class="fas fa-comments"></i> Chat</button>`);
    return `
      <tr data-id="${p.id}">
        <td>#${p.id.slice(-6).toUpperCase()}</td>
        <td>${fechaCorta(p.createdAt)}</td>
        <td>${p.cliente?.nombre || p.clienteEmail || 'Cliente'}</td>
        <td>${money(p.total ?? p.subtotal ?? 0)}</td>
        <td><span class="badge ${badgeByStatus(p.estado)}">${p.estado?.[0]?.toUpperCase()}${p.estado?.slice(1) || ''}</span></td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary btn-ver" data-id="${p.id}">Ver</button>
          ${acciones.join('')}
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-ver').forEach(b => b.addEventListener('click', () => openOrderDetail(b.dataset.id)));
  tbody.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => setEstadoPedido(b.dataset.id, b.dataset.a)));
  tbody.querySelectorAll('.btn-chat').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.id) window.openChatForPedido(b.dataset.id);
  }));
}

function filtrarPorMes(p, yyyymm) {
  if (!yyyymm) return true;
  const d = p.createdAt?.toDate?.() || p.createdAt;
  if (!d) return false;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}` === yyyymm;
}

function aplicaFiltroPedidos() {
  const estadoSel = document.getElementById('filtro-estado')?.value || 'todos';
  const mesSel = document.getElementById('filtro-mes')?.value || '';
  const termRaw = document.getElementById('filtro-texto')?.value || '';
  const term = termRaw.trim().toLowerCase();

  let lista = [...pedidosCache];

  if (estadoSel !== 'todos') {
    lista = lista.filter(p => (p.estado || '').toLowerCase() === estadoSel);
  }
  if (mesSel) {
    lista = lista.filter(p => filtrarPorMes(p, mesSel));
  }
  if (term) {
    lista = lista.filter(p => {
      const id = (p.id || '').toLowerCase();
      const cliente = (p.cliente?.nombre || p.clienteEmail || '').toLowerCase();
      const corto = ('#' + (p.id || '').slice(-6)).toLowerCase();
      return id.includes(term) || cliente.includes(term) || corto.includes(term.replace('#', ''));
    });
  }

  renderTablaPedidos(lista);
}

function hookFiltrosPedidosUI() {

  document
    .getElementById('btn-filtrar-orders')
    ?.addEventListener('click', aplicaFiltroPedidos);

  document
    .getElementById('btn-limpiar-orders')
    ?.addEventListener('click', () => {

      const est = document.getElementById('filtro-estado');
      const mes = document.getElementById('filtro-mes');
      const txt = document.getElementById('filtro-texto');

      // Restablecer filtros visuales
      if (est) est.value = 'todos';
      if (mes) mes.value = '';
      if (txt) txt.value = '';

      // 🔥 Eliminar filtros antiguos guardados
      localStorage.removeItem('ordersFilters');

      // Mostrar todos los pedidos inmediatamente
      aplicaFiltroPedidos();

    });

  document
    .getElementById('filtro-estado')
    ?.addEventListener('change', aplicaFiltroPedidos);

  document
    .getElementById('filtro-mes')
    ?.addEventListener('change', aplicaFiltroPedidos);

  document
    .getElementById('filtro-texto')
    ?.addEventListener(
      'input',
      debounce(aplicaFiltroPedidos, 250)
    );

}

function getHashParams() {
  const h = location.hash || '';
  const i = h.indexOf('?');
  if (i === -1) return {};
  const qs = new URLSearchParams(h.slice(i + 1));
  const o = {};
  qs.forEach((v, k) => o[k] = v);
  return o;
}

function applyOrdersFiltersFromHash() {
  const p = getHashParams();
  if (p.estado && document.getElementById('filtro-estado')) document.getElementById('filtro-estado').value = p.estado;
  if (p.mes && document.getElementById('filtro-mes')) document.getElementById('filtro-mes').value = p.mes;
  if (p.q && document.getElementById('filtro-texto')) document.getElementById('filtro-texto').value = p.q;
  aplicaFiltroPedidos();
}
window.applyOrderFiltersNow = aplicaFiltroPedidos;
window.applyOrdersFiltersNow = window.applyOrderFiltersNow;

function isSameDay(d1, d2) { const a = new Date(d1); const b = new Date(d2); return a.getFullYear() === b.getFullYear() && a
    .getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

async function updateDashboardStats(pedidos) {
  const hoy = new Date();

  function paintChipsResumen(pedidos) {
    const el = document.getElementById('chips-resumen');
    if (!el) return;

    const S = s => pedidos.filter(p => (p.estado || '').toLowerCase() === s).length;
    const enCurso = S('aceptado') + S('en_preparacion') + S('preparando') + S('enviado');

    const chips = [
      { label: 'Pendientes', val: S('pendiente'), cls: 'chip chip--warn', jump: 'pendiente' },
      { label: 'En curso', val: enCurso, cls: 'chip chip--muted', jump: 'proceso' },
      { label: 'Entregados', val: S('entregado'), cls: 'chip chip--ok', jump: 'entregado' },
      { label: 'Cancelados', val: S('cancelado'), cls: 'chip chip--bad', jump: 'cancelado' },
    ];

    el.innerHTML = chips.map(k => `
      <button class="${k.cls}" data-jump-orders="${k.jump}" style="cursor:pointer;border:none;background:inherit;">
        <span class="dot"></span>
        <span>${k.val}</span> ${k.label}
      </button>
    `).join('');

    el.querySelectorAll('[data-jump-orders]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const estado = btn.getAttribute('data-jump-orders') || 'todos';
        const sel = document.getElementById('filtro-estado');
        if (sel) sel.value = estado;
        location.hash = '#orders';
        setTimeout(() => { try { applyOrderFiltersNow?.(); } catch {} }, 60);
      });
    });
  }

  const hoyPedidos = pedidos.filter(p => p.createdAt && isSameDay(p.createdAt?.toDate?.() || p.createdAt, hoy));
  const hoyCompletados = hoyPedidos.filter(p => (p.estado || '').toLowerCase() === 'entregado');
  const ingresosHoy = hoyCompletados.reduce((s, p) => s + (Number(p.total) || 0), 0);

  const statCards = document.querySelectorAll('.stats-grid .stat-card .stat-value');
  if (statCards[1]) statCards[1].textContent = String(hoyPedidos.length);
  if (statCards[2]) statCards[2].textContent = String(hoyCompletados.length);
  if (statCards[3]) statCards[3].textContent = money(Number(ingresosHoy) || 0);

  if (UID) {
    const qP = query(collection(db, 'productos'), where('tiendaId', '==', UID));
    const snapP = await getDocs(qP);
    if (statCards[0]) statCards[0].textContent = String(snapP.size || 0);
  }

  const by = (s) => pedidos.filter(p => (p.estado || '').toLowerCase() === s).length;
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  setTxt('sum-pendientes', by('pendiente'));
  setTxt('sum-aceptados', by('aceptado'));
  setTxt('sum-preparacion', by('en_preparacion') + by('preparando'));
  setTxt('sum-entregados', by('entregado'));

  renderPedidosRecientesDashboard(pedidos, 7);
}

function listenPedidos() {
  if (!UID) return;

  if (unsubPedidos) {
    try { unsubPedidos(); } catch {}
  }

  const qRef = query(
    collection(db, 'pedidos'),
    where('tiendaId', '==', UID),
    orderBy('createdAt', 'desc')
  );

  let firstRun = true;
  const known = new Set();

  unsubPedidos = onSnapshot(qRef, (snap) => {
    pedidosCache = [];

    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      pedidosCache.push(data);

      const esPendiente =
        data.estado === 'pendiente' ||
        data.estado === 'nuevo';

      const esNuevoPedido =
        !firstRun && !known.has(d.id);

      // 🛎️ SOLO ALERTAR CUANDO REALMENTE ENTRA UN PEDIDO NUEVO
      if (esNuevoPedido && esPendiente) {
        crearNotificacion(UID, {
          tipo: 'pedido',
          titulo: '🛒 Nuevo pedido',
          mensaje: `Pedido #${d.id.slice(-6).toUpperCase()} recibido.`
        });

        procesarNuevoPedidoConAlertas(data);
      }

      // 🛑 SI DEJÓ DE ESTAR PENDIENTE, DETENER SU ALERTA
      if (!esPendiente) {
        detenerAlertaPedido(data.id);
      }

      known.add(d.id);
    });

    firstRun = false;

    // 🔢 CONTADOR REAL DE PEDIDOS PENDIENTES
    recalcularPendientes();

    // 📊 ACTUALIZAR DASHBOARD
    updateDashboardStats(pedidosCache).catch(console.error);

    // 📋 ACTUALIZAR TABLA
    aplicaFiltroPedidos();

  }, (err) => {
    console.error('onSnapshot pedidos:', err);

    const tbody = document.querySelector(
      '#orders-content .order-table tbody'
    );

    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6">❌ Error al cargar pedidos</td></tr>';
    }
  });
}

function mostrarNotificacionFlotante(pedido) {
  const existing = document.querySelector('.notice-nuevo-pedido');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'notice-nuevo-pedido';
  notif.innerHTML = `
    <i class="fas fa-shopping-bag" aria-hidden="true"></i>
    <div>
      <div style="font-size: 0.75rem; opacity: 0.85;">🆕 Nuevo pedido</div>
      <div style="font-weight: 700; font-size: 1.1rem;">#${pedido.id?.slice(-6)?.toUpperCase() || '---'}</div>
      <div style="font-size: 0.8rem; opacity: 0.7;">${money(pedido.total || 0)}</div>
    </div>
    <i class="fas fa-times" style="cursor:pointer;opacity:0.5;font-size:0.8rem;margin-left:auto;" onclick="this.closest('.notice-nuevo-pedido').remove()"></i>
  `;
  document.body.appendChild(notif);

  setTimeout(() => {
    if (notif.parentNode) {
      notif.style.opacity = '0';
      notif.style.transition = 'opacity 0.4s ease';
      setTimeout(() => {
        if (notif.parentNode) notif.remove();
      }, 400);
    }
  }, 4500);
}

document.querySelector('[data-tab="orders"]')?.addEventListener('click', () => {
  if (!UID) return;
  listenPedidos();
  hookFiltrosPedidosUI();
  applyOrdersFiltersFromHash();
});

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#orders')) applyOrdersFiltersFromHash();
});

function renderPedidosRecientesDashboard(pedidos, n = 7) {
  const listWrap = document.querySelector('#lista-pedidos .list') || document.getElementById('lista-pedidos');
  if (!listWrap) return;

  const sorted = [...(pedidos || [])].sort((a, b) => {
    const da = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
    const db = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
    return db - da;
  }).slice(0, n);

  if (!sorted.length) {
    listWrap.innerHTML = '<li class="list-item"><div class="item-info"><p>No hay pedidos aún</p></div></li>';
    return;
  }

  listWrap.innerHTML = sorted.map(p => {
    const code = '#' + (p.id || '').slice(-6).toUpperCase();
    const estado = (p.estado || '');
    const estadoClass = badgeByStatus(estado);
    const totalStr = money(Number(p.total) || 0);
    const cliente = p.cliente?.nombre || p.clienteEmail || 'Cliente';
    return `
      <li class="list-item" data-id="${p.id}">
        <div class="item-info">
          <h4>${code}</h4>
          <p>Cliente: ${cliente}</p>
          <p>Total: ${totalStr}</p>
        </div>
        <div><span class="badge ${estadoClass}">${estado.charAt(0).toUpperCase() + estado.slice(1)}</span></div>
      </li>`;
  }).join('');

  listWrap.querySelectorAll('.list-item').forEach(li => {
    li.addEventListener('click', () => {
      const id = li.getAttribute('data-id');
      location.hash = '#orders';
      setTimeout(() => { try { openOrderDetail(id); } catch {} }, 60);
    });
  });
}

async function cargarDatosCliente(clienteId, pedidoData = {}) {

  const container = document.getElementById('cliente-info-content');

  if (!container) {
    console.warn('⚠️ No existe #cliente-info-content');
    return;
  }

  console.log('👤 CARGANDO DATOS ACTUALES DEL CLIENTE');
  console.log('🆔 clienteId recibido:', clienteId);

  if (!clienteId) {
    container.innerHTML = `
      <div style="
        padding:10px;
        color:#b45309;
        background:#fef3c7;
        border-radius:8px;
      ">
        ⚠️ No se pudo identificar al cliente.
      </div>
    `;
    return;
  }

  // ============================================================
  // FUNCIÓN PARA CONVERTIR UNA DIRECCIÓN EN TEXTO
  // ============================================================

  function convertirDireccion(valor) {

    if (!valor) {
      return 'No especificada';
    }

    if (typeof valor === 'string') {
      return valor;
    }

    if (typeof valor === 'object') {

      const partes = [
        valor.direccion,
        valor.direccionEntrega,
        valor.address,
        valor.calle,
        valor.carrera,
        valor.clle,
        valor.numero,
        valor.numeroCasa,
        valor.barrio,
        valor.ciudad,
        valor.municipio
      ].filter(Boolean);

      if (partes.length) {
        return partes.join(', ');
      }

      try {
        return Object.values(valor)
          .filter(v =>
            typeof v === 'string' ||
            typeof v === 'number'
          )
          .join(', ') || 'No especificada';
      } catch {
        return 'No especificada';
      }
    }

    return String(valor);
  }

  // ============================================================
  // DATOS VACÍOS
  // ============================================================

  let datos = {
    nombre: 'Cliente',
    email: 'No especificado',
    telefono: 'No especificado',
    direccion: 'No especificada'
  };

  try {

    // ==========================================================
    // 1. PERFIL ACTUAL DEL CLIENTE
    // ==========================================================
    //
    // ESTE ES EL ORIGEN PRINCIPAL.
    //
    // Si el cliente cambia su nombre desde su perfil,
    // aquí aparecerá el nuevo nombre.
    // ==========================================================

    const perfilRef = doc(db, 'perfiles', clienteId);
    const perfilSnap = await getDoc(perfilRef);

    if (perfilSnap.exists()) {

      const perfil = perfilSnap.data();

      console.log(
        '✅ PERFIL ACTUAL DEL CLIENTE ENCONTRADO:',
        perfil
      );

      const nombres =
        perfil.nombres ||
        perfil.nombre ||
        '';

      const apellidos =
        perfil.apellidos ||
        perfil.apellido ||
        '';

      const nombreCompleto =
        `${nombres} ${apellidos}`.trim();

      if (nombreCompleto) {
        datos.nombre = nombreCompleto;
      }

      if (perfil.email) {
        datos.email = perfil.email;
      }

      if (perfil.telefono || perfil.phone) {
        datos.telefono =
          perfil.telefono ||
          perfil.phone;
      }

      const direccionPerfil =
        perfil.direccion ||
        perfil.direccionEntrega ||
        perfil.ubicacion ||
        perfil.address;

      if (direccionPerfil) {
        datos.direccion =
          convertirDireccion(direccionPerfil);
      }

    } else {

      // ========================================================
      // 2. SOLO SI NO EXISTE PERFIL:
      //    BUSCAR EN usuarios
      // ========================================================
      //
      // Esto sirve para clientes antiguos que todavía no tengan
      // documento en perfiles.
      //
      // IMPORTANTE:
      // NO usamos pedidoData como fuente del nombre.
      // ========================================================

      console.warn(
        '⚠️ No existe perfiles/' + clienteId +
        '. Se intentará consultar usuarios.'
      );

      const usuarioRef = doc(db, 'usuarios', clienteId);
      const usuarioSnap = await getDoc(usuarioRef);

      if (usuarioSnap.exists()) {

        const usuario = usuarioSnap.data();

        console.log(
          '✅ USUARIO ENCONTRADO COMO RESPALDO:',
          usuario
        );

        const nombres =
          usuario.nombres ||
          usuario.nombre ||
          '';

        const apellidos =
          usuario.apellidos ||
          usuario.apellido ||
          '';

        const nombreCompleto =
          `${nombres} ${apellidos}`.trim();

        if (nombreCompleto) {
          datos.nombre = nombreCompleto;
        }

        if (usuario.email) {
          datos.email = usuario.email;
        }

        if (usuario.telefono || usuario.phone) {
          datos.telefono =
            usuario.telefono ||
            usuario.phone;
        }

        const direccionUsuario =
          usuario.direccion ||
          usuario.direccionEntrega ||
          usuario.ubicacion ||
          usuario.address;

        if (direccionUsuario) {
          datos.direccion =
            convertirDireccion(direccionUsuario);
        }

      } else {

        console.warn(
          '⚠️ No existe ni perfil ni usuario para:',
          clienteId
        );
      }
    }

  } catch (error) {

    console.error(
      '❌ ERROR CONSULTANDO DATOS ACTUALES DEL CLIENTE:',
      error
    );

    container.innerHTML = `
      <div style="
        padding:10px;
        color:#b91c1c;
        background:#fee2e2;
        border-radius:8px;
      ">
        ❌ No se pudieron cargar los datos actuales del cliente.
      </div>
    `;

    return;
  }

  // ============================================================
  // 3. MOSTRAR DATOS ACTUALES DEL CLIENTE
  // ============================================================

  container.innerHTML = `
    <div style="
      display:grid;
      gap:10px;
      font-size:15px;
    ">

      <div>
        <strong>👤 Cliente:</strong>
        ${datos.nombre}
      </div>

      <div>
        <strong>📧 Email:</strong>
        ${datos.email}
      </div>

      <div>
        <strong>📞 Teléfono:</strong>
        ${datos.telefono}
      </div>

      <div>
        <strong>📍 Dirección:</strong>
        ${datos.direccion}
      </div>

    </div>
  `;

  console.log(
    '✅ DATOS ACTUALES DEL CLIENTE MOSTRADOS AL COMERCIANTE:',
    datos
  );
}

// ============================================================
// 🎯 openOrderDetail - VERSIÓN CORREGIDA CON CARGA DE PERFIL
// ============================================================

function openOrderDetail(id) {
  const contTabla = document.querySelector('#orders-content .card');
  const detailWrap = document.getElementById('order-detail-container');
  if (!contTabla || !detailWrap) return;
  const p = pedidosCache.find(x => x.id === id);
  if (!p) return;

  console.log('🔎 PEDIDO COMPLETO:', p);
  console.log('🔎 clienteId:', p.clienteId);
  console.log('🔎 usuarioId:', p.usuarioId);
  console.log('🔎 clienteUid:', p.clienteUid);
  console.log('🔎 uidCliente:', p.uidCliente);
  console.log('🔎 cliente:', p.cliente);

  contTabla.style.display = 'none';
  detailWrap.style.display = 'block';

  // ============================================================
  // 🎯 NUEVO LAYOUT: 2 COLUMNAS (PEDIDO | CHAT)
  // ============================================================

  // Obtener estado del pedido
  const estado = p.estado || 'pendiente';
  const estadoLabels = {
    'pendiente': { label: '⏳ Pendiente', color: '#F59E0B' },
    'aceptado': { label: '✅ Aceptado', color: '#3B82F6' },
    'en_preparacion': { label: '👨‍🍳 En preparación', color: '#8B5CF6' },
    'preparando': { label: '👨‍🍳 En preparación', color: '#8B5CF6' },
    'enviado': { label: '🚚 Enviado', color: '#3B82F6' },
    'entregado': { label: '📦 Entregado', color: '#10B981' },
    'completado': { label: '✅ Completado', color: '#10B981' },
    'cancelado': { label: '❌ Cancelado', color: '#EF4444' }
  };
  const estadoInfo = estadoLabels[estado] || { label: estado, color: '#6B7280' };

  // Productos
  const itemsHtml = (p.items || []).map(it => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:0.85rem;">
      <span>${it.nombre} × ${it.cantidad ?? it.qty ?? 1}</span>
      <span style="font-weight:600;color:#10b981;">${money((Number(it.unitPrice || it.precio) || 0) * (Number(it.cantidad || it.qty) || 0))}</span>
    </div>

  `).join('');

  // Totales
  const total = money(p.total ?? p.subtotal ?? 0);
  const subtotal = money(p.subtotal ?? 0);
  const envio = money(p.envio ?? 0);
  const pedidoId = p.id;

  // 🔥 Determinar si es comerciante
  const esComerciante = UID && p.tiendaId === UID;

  // ============================================================
  // HTML COMPLETO CON 2 COLUMNAS + CARGA DE CLIENTE
  // ============================================================

  // 🎯 Detectar móvil para elegir 1 o 2 columnas
const anchoActual = window.innerWidth || document.documentElement.clientWidth || 9999;
const esMovilDetalle = anchoActual <= 767;
console.log('📐 Ancho actual:', anchoActual, '→ esMovilDetalle:', esMovilDetalle);
const gridCols = esMovilDetalle ? '1fr' : '1fr 1.2fr';
const gridMaxH = esMovilDetalle ? 'none' : '80vh';
const gridMinH = esMovilDetalle ? 'auto' : '500px';
// 🆕 Altura del chat según dispositivo
const chatMinH = esMovilDetalle ? '400px' : '500px';
const chatMaxH = esMovilDetalle ? '500px' : '80vh';
const chatMsgMinH = esMovilDetalle ? '220px' : '300px';

detailWrap.innerHTML = `
    <div style="display:grid;grid-template-columns:${gridCols};gap:20px;max-height:${gridMaxH};min-height:${gridMinH};">

      <!-- ===== COLUMNA IZQUIERDA: DETALLE DEL PEDIDO ===== -->
      <div style="display:flex;flex-direction:column;gap:16px;overflow-y:auto;padding-right:12px;">

        <!-- Header del pedido -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:12px;border-bottom:2px solid #f1f5f9;">
          <div>
            <h3 style="margin:0;font-size:1.2rem;display:flex;align-items:center;gap:8px;">
              <i class="fas fa-receipt" style="color:#10b981;"></i> Pedido #${pedidoId.slice(-6).toUpperCase()}
            </h3>
            <span style="font-size:0.85rem;color:#6b7280;">${fechaCorta(p.createdAt)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge ${badgeByStatus(estado)}" style="font-size:0.8rem;">${estadoInfo.label}</span>
          </div>
        </div>

        <!-- 🔥 CLIENTE - CON CARGA DESDE PERFIL -->
        ${esComerciante ? `
          <div id="cliente-info-container" style="margin-bottom:16px;padding:12px 16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;border-left:4px solid #3b82f6;">
            <h3 style="margin:0 0 8px 0;font-size:1rem;display:flex;align-items:center;gap:8px;">
              <i class="fas fa-user" style="color:#3b82f6;"></i> Información del cliente
            </h3>
            <div id="cliente-info-content" style="display:grid;grid-template-columns:1fr;gap:4px;font-size:0.9rem;">
              <div style="text-align:center;padding:8px;color:#6b7280;">
                <i class="fas fa-spinner fa-spin"></i> Cargando datos del cliente...
              </div>
            </div>
          </div>
        ` : ''}
                             <!-- 🔥 MÉTODO DE PAGO ELEGIDO POR EL CLIENTE -->
        <div style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:#f8fafc; border-radius:12px; border-left:4px solid #10b981;">
          <div style="display:flex; align-items:center; gap:8px; color:#0f172a; font-weight:600; font-size:0.95rem;">
            <i class="fas fa-credit-card" style="color:#10b981;"></i> Método de pago:
          </div>
          <div style="font-weight:700; color:#059669; font-size:1rem; text-transform: capitalize;">
            ${(() => {
               const m = String(p.metodoPago || p.paymentMethod || p.metodo || '').toLowerCase().trim();
               if (m === 'transferencia' || m === 'online') return 'Transferencia';
               if (m === 'contraentrega') return 'Contra Entrega';
               return 'No especificado';
            })()}
          </div>
        </div>
        <!-- Productos -->
        <div style="background:#f8fafc;border-radius:10px;padding:12px 16px;">
          <div style="font-weight:600;font-size:0.85rem;color:#0f172a;margin-bottom:8px;">📦 Productos</div>
          ${itemsHtml || '<p style="font-size:0.85rem;color:#6b7280;">Sin productos</p>'}
          <div style="border-top:2px solid #e5e7eb;margin-top:8px;padding-top:8px;">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
              <span>📦 Subtotal</span>
              <span>${subtotal}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#6b7280;">
              <span>🚚 Envío</span>
              <span>${envio}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#6b7280;">
              <span>⚡ Servicio</span>
              <span>${money(p.servicio ?? 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;margin-top:6px;border-top:2px solid #e5e7eb;padding-top:8px;">
              <span>💰 Total pagado</span>
              <span style="color:#10b981;">${total}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#0f172a;margin-top:4px;border-top:1px dashed #d1d5db;padding-top:6px;">
              <span>📌 Recibe el comercio</span>
              <span style="font-weight:700;color:#059669;">${money((p.total ?? p.subtotal ?? 0) - (p.servicio ?? 0))}</span>
            </div>
          </div>
        </div>

        <!-- ============================================================ -->
        <!-- 🔥 BOTONES DE ESTADO - VERSIÓN SIMPLIFICADA                   -->
        <!-- ============================================================ -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">

                 <!-- 1. PENDIENTE → AGREGAR PRODUCTOS + ACEPTAR o CANCELAR -->
        ${estado === 'pendiente' ? `
          <button class="btn btn-sm btn-primary" onclick="window.agregarProductoSolicitud('${pedidoId}')" 
                  style="background:#3b82f6;border:none;padding:10px 18px;border-radius:8px;color:white;font-weight:600;cursor:pointer;grid-column: span 2;">
            ➕ Agregar / editar productos
          </button>
          <button class="btn btn-sm btn-success act" data-a="aceptado" data-id="${pedidoId}" 
                  style="background:#10b981;border:none;padding:8px 20px;border-radius:8px;color:white;font-weight:600;cursor:pointer;">
            ✅ Aceptar
          </button>
          <button class="btn btn-sm btn-danger act" data-a="cancelado" data-id="${pedidoId}" 
                  style="background:#ef4444;border:none;padding:8px 20px;border-radius:8px;color:white;font-weight:600;cursor:pointer;">
            ❌ Cancelar
          </button>
        ` : ''}

          <!-- 2. ACEPTADO → EN PREPARACIÓN o CANCELAR -->
          ${estado === 'aceptado' ? `
            <button class="btn btn-sm btn-primary act" data-a="en_preparacion" data-id="${pedidoId}" 
                    style="background:#8B5CF6;border:none;padding:8px 20px;border-radius:8px;color:white;font-weight:600;cursor:pointer;">
              👨‍🍳 En preparación
            </button>
            <button class="btn btn-sm btn-danger act" data-a="cancelado" data-id="${pedidoId}" 
                    style="background:#ef4444;border:none;padding:8px 20px;border-radius:8px;color:white;font-weight:600;cursor:pointer;">
              ❌ Cancelar
            </button>
          ` : ''}

          <!-- 3. EN PREPARACIÓN → ENVIAR -->
          ${estado === 'en_preparacion' || estado === 'preparando' ? `
            <button class="btn btn-sm btn-primary act" data-a="enviado" data-id="${pedidoId}" 
                    style="background:#3B82F6;border:none;padding:8px 20px;border-radius:8px;color:white;font-weight:600;cursor:pointer;">
              🚚 Enviar pedido
            </button>
            <button class="btn btn-sm btn-danger act" data-a="cancelado" data-id="${pedidoId}" 
                    style="background:#ef4444;border:none;padding:8px 20px;border-radius:8px;color:white;font-weight:600;cursor:pointer;">
              ❌ Cancelar
            </button>
          ` : ''}

          <!-- 4. ENVIADO → Esperando confirmación del cliente -->
          ${estado === 'enviado' ? `
            <span style="background:#fef3c7;color:#92400e;padding:8px 16px;border-radius:8px;font-weight:600;font-size:0.85rem;display:flex;align-items:center;gap:8px;border:1px solid #fcd34d;">
              <i class="fas fa-clock"></i> ⏳ Esperando confirmación del cliente...
            </span>
          ` : ''}

          <!-- 5. ENTREGADO o COMPLETADO → Pedido finalizado -->
          ${estado === 'entregado' || estado === 'completado' ? `
            <span style="background:#d1fae5;color:#065f46;padding:8px 16px;border-radius:8px;font-weight:600;font-size:0.85rem;display:flex;align-items:center;gap:8px;border:1px solid #6ee7b7;">
              <i class="fas fa-check-circle"></i> ✅ Pedido entregado
            </span>
          ` : ''}

          <!-- 6. CANCELADO → Pedido cancelado -->
          ${estado === 'cancelado' ? `
            <span style="background:#fee2e2;color:#991b1b;padding:8px 16px;border-radius:8px;font-weight:600;font-size:0.85rem;display:flex;align-items:center;gap:8px;border:1px solid #fca5a5;">
              <i class="fas fa-times-circle"></i> ❌ Pedido cancelado
            </span>
          ` : ''}

        </div>

        <!-- Botón Volver -->
        <button id="back-to-orders" style="background:#6b7280;color:white;border:none;border-radius:8px;padding:10px;font-weight:600;cursor:pointer;margin-top:8px;">
          ← Volver a Pedidos
        </button>
      </div>

      <!-- ===== COLUMNA DERECHA: CHAT ===== -->
      <div id="chat-columna-derecha" style="
  display:flex;
  flex-direction:column;
  background:#f9fafb;
  border-radius:16px;
  border:1px solid #e5e7eb;
  overflow:hidden;
  min-height:${chatMinH};
  max-height:${chatMaxH};
">
        <!-- Header del chat -->
        <div style="
          padding:14px 18px;
          background:linear-gradient(135deg,#10b981,#0ea5e9);
          color:white;
          display:flex;
          align-items:center;
          gap:10px;
          flex-shrink:0;
        ">
          <i class="fas fa-comments" style="font-size:1.2rem;"></i>
          <span style="font-weight:700;font-size:1rem;">💬 Conversación</span>
          <span style="font-size:0.75rem;opacity:0.8;margin-left:auto;">
            Cliente: ${p.cliente?.nombre || p.clienteEmail || 'Cliente'}
          </span>
        </div>

        <!-- Contenedor de mensajes -->
        <div id="messages-container-columna" style="
  flex:1;
  overflow-y:auto;
  padding:16px;
  display:flex;
  flex-direction:column;
  gap:4px;
  min-height:${chatMsgMinH};
  background:#ffffff;
">
          <div style="text-align:center;padding:40px 20px;color:#9ca3af;">
            <i class="fas fa-comment-slash" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:12px;"></i>
            <p style="font-size:0.9rem;font-weight:500;">No hay mensajes aún</p>
            <p style="font-size:0.8rem;color:#d1d5db;">Envía un mensaje para comenzar</p>
          </div>
        </div>

        <!-- Input de chat -->
        <div id="chat-input-columna" style="
          display:flex;
          gap:10px;
          padding:12px 16px;
          background:#f9fafb;
          border-top:1px solid #e5e7eb;
          flex-shrink:0;
        ">
          <input id="input-mensaje-columna" type="text" placeholder="Escribe un mensaje..." style="
            flex:1;
            padding:10px 16px;
            border:2px solid #e5e7eb;
            border-radius:24px;
            font-size:0.9rem;
            outline:none;
            transition:border-color 0.2s;
            background:white;
          " onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e5e7eb'"/>
          <button id="btn-enviar-columna" style="
            background:#3b82f6;
            color:white;
            border:none;
            border-radius:50%;
            width:44px;
            height:44px;
            font-size:1.2rem;
            cursor:pointer;
            transition:all 0.2s;
            display:flex;
            align-items:center;
            justify-content:center;
            flex-shrink:0;
          ">📤</button>
        </div>
      </div>

    </div>
  `;

  // ============================================================
  // 🔥 CARGAR PERFIL ACTUAL DEL CLIENTE DESDE FIRESTORE
  // ============================================================

  if (esComerciante) {

    const clienteId =
      p.clienteId ||
      p.clienteUid ||
      p.uidCliente ||
      p.usuarioId ||
      p.cliente?.uid ||
      p.cliente?.id;

    console.log('👤 UID DEL CLIENTE PARA CARGAR PERFIL:', clienteId);

    if (clienteId) {

      cargarDatosCliente(clienteId, p).catch(error => {
        console.error(
          '❌ Error cargando perfil actual del cliente:',
          error
        );
      });

    } else {

      console.warn(
        '⚠️ EL PEDIDO NO TIENE UID DEL CLIENTE:',
        p
      );

      const clienteContainer =
        document.getElementById('cliente-info-content');

      if (clienteContainer) {
        clienteContainer.innerHTML = `
          <div style="
            padding:10px;
            color:#b45309;
            background:#fef3c7;
            border-radius:8px;
          ">
            ⚠️ No se pudo identificar al cliente de este pedido.
          </div>
        `;
      }
    }
  }

  // ============================================================
  // 🔥 CONECTAR EVENTOS
  // ============================================================

  // 1. Botones de estado
  detailWrap.querySelectorAll('.act').forEach(b => {
    b.addEventListener('click', () => {
      setEstadoPedido(b.dataset.id, b.dataset.a);
    });
  });

  // 2. Botón volver
  detailWrap.querySelector('#back-to-orders')?.addEventListener('click', () => {
    detailWrap.style.display = 'none';
    contTabla.style.display = 'block';
    // Limpiar listener del chat
    if (unsubMensajes) { unsubMensajes();
      unsubMensajes = null; }
  });

  // 3. 🔥 INICIAR CHAT AUTOMÁTICAMENTE EN LA COLUMNA DERECHA
  const messagesContainerColumna = document.getElementById('messages-container-columna');
  const inputColumna = document.getElementById('input-mensaje-columna');
  const btnEnviarColumna = document.getElementById('btn-enviar-columna');

  // Limpiar listener anterior
  if (unsubMensajes) { unsubMensajes();
    unsubMensajes = null; }

  if (messagesContainerColumna) {
    escucharMensajesColumna(pedidoId, messagesContainerColumna);
  }

  // 4. Enviar mensaje desde la columna derecha
  const enviarMensajeColumna = async () => {
    const texto = inputColumna?.value?.trim();
    if (!texto || !pedidoId) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
      await addDoc(collection(db, 'pedidos', pedidoId, 'mensajes'), {
        uid: user.uid,
        texto: texto,
        tipo: 'text',
        creadoEn: serverTimestamp()
      });

      await updateDoc(doc(db, 'pedidos', pedidoId), {
        lastMsg: texto.slice(0, 120),
        lastTs: serverTimestamp()
      });

      inputColumna.value = '';
    } catch (error) {
      console.warn('Error enviando mensaje:', error);
    }
  };

  // Eventos del input
  btnEnviarColumna?.addEventListener('click', enviarMensajeColumna);
  inputColumna?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensajeColumna();
    }
  });

  // 5. Marcar mensajes como leídos al abrir
  if (currentChatUid) {
    marcarMensajesLeidosChat(pedidoId);
  }

  // 6. Actualizar badge del chat
  actualizarBadgeChat(0);

  // 7. 🔥 CARGAR DATOS DEL CLIENTE DESDE PERFIL
  if (esComerciante) {

    const clienteId =
      p.clienteId ||
      p.clienteUid ||
      p.uidCliente ||
      p.usuarioId ||
      p.cliente?.uid ||
      p.cliente?.id;

    console.log('👤 ID CLIENTE FINAL:', clienteId);

    if (clienteId) {

      cargarDatosCliente(clienteId, p).catch(error => {
        console.error('❌ Error cargando datos del cliente:', error);

        const clienteContainer =
          document.getElementById('cliente-info-content');

        if (clienteContainer) {
          clienteContainer.innerHTML = `
            <div style="
              padding:10px;
              color:#b45309;
              background:#fef3c7;
              border-radius:8px;
            ">
              ⚠️ No se pudieron cargar los datos del cliente.
            </div>
          `;
        }
      });

    } else {

      console.warn(
        '⚠️ No se encontró ningún ID del cliente dentro del pedido:',
        p
      );

      const clienteContainer =
        document.getElementById('cliente-info-content');

      if (clienteContainer) {
        clienteContainer.innerHTML = `
          <div style="
            padding:10px;
            color:#b45309;
            background:#fef3c7;
            border-radius:8px;
          ">
            ⚠️ No se pudo identificar al cliente de este pedido.
          </div>
        `;
      }
    }
  }
}

/* --------------------------- Notificaciones UI ----------------------------- */

const notificationIcon = document.getElementById('notification-icon');
const notificationDropdown = document.getElementById('notification-dropdown');

notificationIcon?.addEventListener('click', (e) => {
  e.stopPropagation();
  notificationDropdown?.classList.toggle('active');
});

document.getElementById('mark-all-read')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  await marcarNotificacionesLeidas(UID);
  document.querySelectorAll('.notification-item.unread').forEach(i => i.classList.remove('unread'));
  renderBadgeNotificaciones(0);
});

document.body.addEventListener('click', () => notificationDropdown?.classList.remove('active'));

/* --------------------------------- Logout --------------------------------- */

document.getElementById('logout')?.addEventListener('click', () => {
  try { auth.signOut?.(); } catch {}
  localStorage.removeItem('carrito');
  localStorage.removeItem('perfilUsuario');
  sessionStorage.removeItem('currentUser');
  window.location.href = 'index.html';
});

/* ------------------------------ UI miscelánea ------------------------------ */

function animateCounters(duration = 1200) {
  const counters = document.querySelectorAll('.stat-value');
  counters.forEach(counter => {
    const raw = counter.textContent.trim();
    const isCurrency = raw.includes('$');
    const target = parseFloat(raw.replace(/[$,]/g, '')) || 0;
    const t0 = performance.now();

    function tick(now) {
      const p = Math.min((now - t0) / duration, 1);
      const v = target * p;
      counter.textContent = isCurrency ? ('$' + Math.round(v).toLocaleString()) : Math.floor(v).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
      else counter.textContent = isCurrency ? ('$' + Math.round(target).toLocaleString()) : Math.round(target).toLocaleString();
    }
    requestAnimationFrame(tick);
  });
}
document.addEventListener('DOMContentLoaded', () => { pintarChipUsuario();
  animateCounters(); });

/* -------------------------- Analíticas (Chart.js) -------------------------- */

function buildMonthlySeries(pedidos, months = 12) {
  const now = new Date();
  const labels = [];
  const ventas = new Array(months).fill(0);
  const unidades = new Array(months).fill(0);
  const categorias = {};
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleString('es', { month: 'short' }));
  }
  pedidos.filter(p => p.estado === 'entregado' || p.estado === 'completado').forEach(p => {
    const d = p.createdAt?.toDate?.() || p.createdAt;
    if (!d) return;
    const idx = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (idx >= 0 && idx < months) {
      ventas[months - 1 - idx] += Number(p.total) || 0;
      (p.items || []).forEach(it => {
        unidades[months - 1 - idx] += Number(it.cantidad || it.qty) || 0;
        const c = it.categoria || 'otros';
        categorias[c] = (categorias[c] || 0) + Number(it.cantidad || it.qty) || 0;
      });
    }
  });
  const catLabels = Object.keys(categorias);
  const catValues = catLabels.map(k => categorias[k]);
  return { labels, ventas, unidades, catLabels, catValues };
}

let _charts = [];

function initChartsFromData(series) {
  _charts.forEach(ch => { try { ch.destroy(); } catch {} });
  _charts = [];
  const salesCtx = document.getElementById('sales-chart')?.getContext('2d');
  if (salesCtx && window.Chart) _charts.push(new Chart(salesCtx, {
    type: 'line',
    data: { labels: series.labels, datasets: [{ label: 'Ventas Mensuales ($)', data: series.ventas, borderColor: '#22cc77',
        backgroundColor: 'rgba(34,204,119,0.1)', borderWidth: 2, tension: 0.4, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
  }));
  const productsCtx = document.getElementById('products-chart')?.getContext('2d');
  if (productsCtx && window.Chart) _charts.push(new Chart(productsCtx, {
    type: 'bar',
    data: { labels: series.labels, datasets: [{ label: 'Unidades Vendidas', data: series.unidades }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
  }));
  const categoriesCtx = document.getElementById('categories-chart')?.getContext('2d');
  if (categoriesCtx && window.Chart) _charts.push(new Chart(categoriesCtx, {
    type: 'doughnut',
    data: { labels: series.catLabels, datasets: [{ label: 'Distribución de Categorías', data: series.catValues }] },
    options: { responsive: true, maintainAspectRatio: false }
  }));
}

document.querySelector('[data-tab="analytics"]')?.addEventListener('click', () => {
  const series = buildMonthlySeries(pedidosCache || [], 12);
  setTimeout(() => initChartsFromData(series), 150);
});

/* -------------------------- Catálogo (modal/grid) -------------------------- */

function renderCatalogo(items = []) {
  const grid = document.getElementById('cat-grid');
  if (!grid) return;
  if (!items.length) { grid.innerHTML = '<p>No hay resultados</p>'; return; }
  grid.innerHTML = items.map(it => `
    <div class="producto-card" data-id="${it.id}">
      <img class="producto-img" src="${it.imagen || 'https://placehold.co/600x400?text=Producto'}" alt="" loading="lazy">
      <div class="producto-info">
        <span class="producto-categoria">${it.categoria || 'otros'}</span>
        <div class="producto-titulo">${it.nombre || ''}</div>
        <div class="producto-acciones">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" class="cat-select"> Seleccionar
          </label>
        </div>
      </div>
    </div>
  `).join('');
}

async function openCatalogoModal() {
  showOverlay('catalogo-modal');
  const items = await Cat.buscarCatalogo({});
  renderCatalogo(items);
}

function closeCatalogoModal() { hideOverlay('catalogo-modal'); }

document.getElementById('btn-agregar-catalogo')?.addEventListener('click', openCatalogoModal);
document.getElementById('catalogo-close')?.addEventListener('click', closeCatalogoModal);

document.getElementById('cat-search')?.addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const categoria = document.getElementById('cat-filter')?.value || '';
  const items = await Cat.buscarCatalogo({ term: q, categoria });
  renderCatalogo(items);
}, 250));

document.getElementById('cat-filter')?.addEventListener('change', async (e) => {
  const categoria = e.target.value;
  const q = document.getElementById('cat-search')?.value?.trim() || '';
  const items = await Cat.buscarCatalogo({ term: q, categoria });
  renderCatalogo(items);
});

document.getElementById('cat-add-selected')?.addEventListener('click', async () => {
  if (!UID) return alert('Debes iniciar sesión');
  const ids = Array.from(document.querySelectorAll('#cat-grid .producto-card'))
    .filter(card => card.querySelector('.cat-select')?.checked)
    .map(card => card.getAttribute('data-id'));
  if (!ids.length) return alert('Selecciona al menos uno');
  const n = await Cat.agregarDesdeCatalogo(UID, ids);
  await Cat.syncIdsToRoot(UID, ids);

  await crearNotificacion(UID, { tipo: 'producto', titulo: 'Desde catálogo', mensaje: `Se añadieron ${n} producto(s).` });
  setMsg(`Añadidos ${n} producto(s) del catálogo ✅`, true);
  closeCatalogoModal();
});

document.getElementById('btn-sembrar-categoria')?.addEventListener('click', async () => {
  if (!UID) return alert('Debes iniciar sesión');
  const cat = document.getElementById('seed-categoria')?.value || '';
  if (!cat) return alert('Elige una categoría');
  const n = await Cat.sembrarCategoria(UID, cat);
  await Cat.syncCategoryToRoot(UID, cat);

  await crearNotificacion(UID, { tipo: 'producto', titulo: 'Sembrado por categoría', mensaje: `${n} producto(s) en "${cat}".` });
  setMsg(`Sembrados ${n} producto(s) de "${cat}" ✅`, true);
});

/* ---------------------------- Helpers de Overlays -------------------------- */

function showOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'flex';
  el.classList.add('show');
  el.style.pointerEvents = 'auto';
}

function hideOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'none';
  el.classList.remove('show');
  el.style.pointerEvents = 'none';
}

/* --------------------------- Guardar edición modal ------------------------- */

document.getElementById('close-modal')?.addEventListener('click', () => hideOverlay('product-modal'));

document.getElementById('edit-product-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const id = getForm('edit-id');
    const nombre = (getForm('edit-nombre') || '').trim();
    const precio = Number(getForm('edit-precio')) || 0;
    const inventario = parseInt(getForm('edit-inventario') || '0', 10);
    const categoria = getForm('edit-categoria') || 'otros';
    const descripcion = getForm('edit-descripcion') || '';
    const activo = !!document.getElementById('edit-activo')?.checked;
    const ubSel = document.getElementById('edit-unidadBase');
    const unidadBase = normalizeUnit(ubSel && ubSel.value ? ubSel.value.trim() : 'unidad');

    let imagen = (getForm('edit-imagen') || '').trim();
    const file = document.getElementById('edit-imagen-file')?.files?.[0] || null;
    if (file && UID) {
      try { imagen = await subirImagenProducto(file, UID); } catch (e) { console.warn('No se pudo subir nueva imagen', e); }
    }

    if (!id) return alert('ID de producto inválido');
    if (!nombre) return alert('El nombre es obligatorio');

    const payload = {
      nombre,
      precio,
      inventario,
      categoria,
      descripcion,
      imagen,
      unidadBase,
      activo,
      actualizadoEn: serverTimestamp()
    };

    await updateDoc(doc(db, 'productos', id), payload);

    hideOverlay('product-modal');
    setMsg('Producto actualizado ✅', true);
    await crearNotificacion(UID, { tipo: 'producto', titulo: 'Producto actualizado', mensaje: `${nombre} fue actualizado.` });
    await prodLoadPage({ reset: true });
  } catch (err) { console.error(err);
    alert('No se pudo guardar'); }
});

/* ------------------------------ Debug helpers ----------------------------- */

window.__pingProducts = async function() {
  const q = query(collection(db, 'productos'), where('tiendaId', '==', UID), limit(5));
  const snap = await getDocs(q);
  console.log('ROOT count=', snap.size);
  snap.forEach(d => console.log(d.id, d.data().nombre));
};

window.debugTools = {
  syncAllSubToRoot: (uid) => Cat.syncAllSubToRoot(uid),
  generarCatalogoBase: (uid) => Cat.generarCatalogoBase(db, uid),
  diagnosticarProductos: async (uid) => {
    console.log('=== DIAGNÓSTICO PRODUCTOS ===');
    console.log('UID:', uid);
    const subSnapshot = await getDocs(query(collection(db, 'tiendas', uid, 'productos')));
    const rootSnapshot = await getDocs(query(collection(db, 'productos'), where('tiendaId', '==', uid)));
    console.log('📦 SUB:', subSnapshot.size, ' | 🏠 ROOT:', rootSnapshot.size);
    return { sub: subSnapshot.size, root: rootSnapshot.size };
  }
};

function hookDashboardNav() {
  document.querySelectorAll('.stats-grid .stat-card[data-go]').forEach(card => {
    card.setAttribute('tabindex', '0');
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      const go = card.dataset.go;
      if (go === 'products') {
        location.hash = '#products';
      } else if (go === 'orders-all') {
        const sel = document.getElementById('filtro-estado');
        if (sel) sel.value = 'todos';
        location.hash = '#orders';
        setTimeout(() => { try { applyOrderFiltersNow?.(); } catch {} }, 50);
      } else if (go === 'orders-completed') {
        const sel = document.getElementById('filtro-estado');
        if (sel) sel.value = 'entregado';
        location.hash = '#orders';
        setTimeout(() => { try { applyOrderFiltersNow?.(); } catch {} }, 50);
      } else if (go === 'analytics') {
        location.hash = '#analytics';
      }
    });
  });

  document.querySelectorAll('[data-jump-orders]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const estado = el.getAttribute('data-jump-orders') || 'todos';
      const sel = document.getElementById('filtro-estado');
      if (sel) sel.value = estado;
      location.hash = '#orders';
      setTimeout(() => { try { applyOrderFiltersNow?.(); } catch {} }, 50);
    });
  });
}
document.addEventListener('DOMContentLoaded', hookDashboardNav);

/* ------------------------------- Mini estilos ------------------------------ */
const __pcStyle = document.createElement('style');
__pcStyle.textContent = `
  .pc-thumb:hover img{ outline:2px solid #0ea5e9; outline-offset:2px; }
  .in-nombre:focus{ outline:none; box-shadow:0 0 0 3px rgba(16,185,129,.18); }
  .stat-card.kpi{ transition:.2s ease; }
  .stat-card.kpi:hover{ transform:translateY(-3px); }
`;

document.head.appendChild(__pcStyle);

(function() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const go = (hash) => { try { location.hash = hash; } catch (e) {} };

  document.querySelectorAll('.stat-card.kpi[data-go]').forEach(card => {
    card.addEventListener('click', () => {
      const dest = card.getAttribute('data-go');
      if (dest === 'products') {
        go('#products');
      } else if (dest === 'orders-all') {
        // ✅ VAMOS A PEDIDOS SIN FILTROS PARA VER TODOS
        go('#orders');
      } else if (dest === 'orders-completed') {
        go(`#orders?estado=entregado&mes=${ym}`);
      } else if (dest === 'analytics') {
        go('#analytics');
      }
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });
})();

/* ============================================================
   💰 SERVICIOS PENDIENTES - MÓDULO COMPLETO (SIN ÍNDICE)
   ============================================================ */

let serviciosUnsubscribe = null;
let serviciosCache = [];

/**
 * Carga los servicios pendientes del comerciante
 * SIN ÍNDICE COMPUESTO
 */
export async function cargarServiciosPendientes(comercianteId) {
    if (!comercianteId) return [];

    try {
        // 🔹 SOLO FILTRAMOS POR comercianteId
        const q = query(
            collection(db, 'servicios_comerciante'),
            where('comercianteId', '==', comercianteId)
        );

        const snap = await getDocs(q);

        // 🔹 FILTRAMOS estado LOCALMENTE
        const servicios = snap.docs
            .map(d => ({
                id: d.id,
                ...d.data()
            }))
            .filter(s =>
                String(s.estado || '').toLowerCase() === 'pendiente'
            );

        // 🔹 SUMAR LOS SERVICIOS PENDIENTES
        const total = servicios.reduce(
            (sum, s) => sum + (Number(s.monto) || 0),
            0
        );

        const cantidad = servicios.length;

        serviciosCache = servicios;

        actualizarUIServicios(total, cantidad);

        console.log('💰 Servicios pendientes cargados:', {
            comercianteId,
            cantidad,
            total,
            servicios
        });

        return servicios;

    } catch (error) {
        console.error('❌ Error cargando servicios pendientes:', error);

        // Mantener la tarjeta en cero si realmente hay error
        actualizarUIServicios(0, 0);

        return [];
    }
}


/**
 * Escucha cambios en tiempo real de los servicios pendientes
 * SIN ÍNDICE COMPUESTO
 */
export function escucharServicios(comercianteId) {

    if (serviciosUnsubscribe) {
        serviciosUnsubscribe();
        serviciosUnsubscribe = null;
    }

    if (!comercianteId) return;

    // 🔹 SOLO CONSULTAMOS comercianteId
    const q = query(
        collection(db, 'servicios_comerciante'),
        where('comercianteId', '==', comercianteId)
    );

    serviciosUnsubscribe = onSnapshot(
        q,
        (snap) => {

            // 🔹 FILTRAR estado LOCALMENTE
            const servicios = snap.docs
                .map(d => ({
                    id: d.id,
                    ...d.data()
                }))
                .filter(s =>
                    String(s.estado || '').toLowerCase() === 'pendiente'
                );

            // 🔹 CALCULAR TOTAL
            const total = servicios.reduce(
                (sum, s) => sum + (Number(s.monto) || 0),
                0
            );

            const cantidad = servicios.length;

            serviciosCache = servicios;

            // 🔹 ACTUALIZAR CUADRO NEGRO
            actualizarUIServicios(total, cantidad);

            console.log('🔄 Servicios actualizados en tiempo real:', {
                cantidad,
                total,
                servicios
            });

            // 🔹 Avisar a otros componentes
            window.dispatchEvent(
                new CustomEvent('servicios:actualizados', {
                    detail: {
                        servicios,
                        total,
                        cantidad
                    }
                })
            );
        },
        (error) => {
            console.error(
                '❌ Error en escucha de servicios:',
                error
            );

            actualizarUIServicios(0, 0);
        }
    );
}


/**
 * Actualiza la tarjeta negra del Dashboard
 */
function actualizarUIServicios(total, cantidad) {

    const totalEl =
        document.getElementById('servicios-total');

    const cantidadEl =
        document.getElementById('servicios-cantidad');

    // 💰 TOTAL
    if (totalEl) {
        totalEl.textContent =
            new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: 'COP',
                maximumFractionDigits: 0
            }).format(total);
    }

    // 🔢 CANTIDAD
    if (cantidadEl) {
        cantidadEl.textContent = cantidad;
    }

    // 🎯 ESTILO DE LA TARJETA
    const card =
        document.getElementById('servicios-card');

    if (card) {

        if (cantidad > 0) {

            card.style.border =
                '2px solid #fbbf24';

            card.style.boxShadow =
                '0 0 20px rgba(251, 191, 36, 0.15)';

            card.style.background =
                'linear-gradient(135deg, #1e293b, #0f172a)';

        } else {

            card.style.border =
                '1px solid rgba(255,255,255,0.08)';

            card.style.boxShadow = 'none';

            card.style.background =
                'linear-gradient(135deg, #1e293b, #0f172a)';
        }
    }
}


/**
 * Obtener detalle de servicios pendientes
 * SIN ÍNDICE COMPUESTO
 */
export async function obtenerDetalleServicios(comercianteId) {

    if (!comercianteId) return [];

    try {

        const q = query(
            collection(db, 'servicios_comerciante'),
            where('comercianteId', '==', comercianteId)
        );

        const snap = await getDocs(q);

        return snap.docs
            .map(d => ({
                id: d.id,
                ...d.data()
            }))
            .filter(s =>
                String(s.estado || '').toLowerCase() === 'pendiente'
            )
            .sort((a, b) => {

                const fechaA =
                    a.fechaGenerado?.toDate
                        ? a.fechaGenerado.toDate()
                        : new Date(a.fechaGenerado || 0);

                const fechaB =
                    b.fechaGenerado?.toDate
                        ? b.fechaGenerado.toDate()
                        : new Date(b.fechaGenerado || 0);

                return fechaB - fechaA;
            });

    } catch (error) {

        console.error(
            '❌ Error obteniendo detalle de servicios:',
            error
        );

        return [];
    }
}




/**
 * Inicializar sistema de servicios
 */
export function initServicios(comercianteId) {

    if (!comercianteId) {
        console.warn(
            '⚠️ No se pudo iniciar servicios: falta comercianteId'
        );
        return;
    }

    console.log(
        '💰 Inicializando servicios para comerciante:',
        comercianteId
    );

    // 🔹 Carga inicial
    cargarServiciosPendientes(comercianteId);

    // 🔹 Tiempo real
    escucharServicios(comercianteId);
}

// ============================================================
// ============================================================
// 🖱️ CLICK EN TARJETA - ABRIR MODAL DE PAGO DIRECTAMENTE
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    const card = document.getElementById('servicios-card');
    if (card) {
        // ✅ UN SOLO CLIC → ABRE EL MODAL DE PAGO
        card.addEventListener('click', () => {
            abrirModalPago();
        });
    }
});
/* ============================================================
   🗂️ COMPLETADOS - MÓDULO COMPLETO
   ============================================================ */

let unsubCompletados = null;
let completadosCache = [];

/**
 * Cargar pedidos completados
 */
export async function cargarCompletados(uid = UID) {
    const uidFinal = uid || UID;

    if (!uidFinal) {
        console.warn('⚠️ No hay UID para cargar completados');
        return;
    }

    const listaEl = document.getElementById('completados-list');
    if (!listaEl) return;

    listaEl.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:#6b7280;">
            <i class="fas fa-spinner fa-spin"
               style="font-size:2rem;display:block;margin-bottom:12px;"></i>
            <p>Cargando pedidos completados...</p>
        </div>
    `;

    try {

        // =====================================================
        // 🔹 CONSULTA SIMPLE: SIN ÍNDICE COMPUESTO
        // =====================================================
        const q = query(
            collection(db, 'pedidos'),
            where('tiendaId', '==', uidFinal)
        );

        const snap = await getDocs(q);

        // =====================================================
        // 🔹 FILTRAR Y ORDENAR LOCALMENTE
        // =====================================================
        completadosCache = snap.docs 
    .map(d => ({ 
        id: d.id, 
        ...d.data() 
    })) 
    .filter(p => {
    const estado = String(p.estado || '').toLowerCase();
    return ['completado', 'entregado', 'recibido'].includes(estado);
})
    .sort((a, b) => { 

        const fechaA = a.createdAt?.toDate 
            ? a.createdAt.toDate() 
            : new Date(a.createdAt || 0); 

        const fechaB = b.createdAt?.toDate 
            ? b.createdAt.toDate() 
            : new Date(b.createdAt || 0); 

        return fechaB - fechaA; 
    }) 
    .slice(0, 100);
        // =====================================================
        // 🖥️ MOSTRAR PEDIDOS
        // =====================================================
        renderCompletados(completadosCache);

        // =====================================================
        // 💰 CARGAR SERVICIOS DEL COMERCIANTE
        // =====================================================
        await enriquecerCompletadosConServicios(uidFinal);

    } catch (error) {

        console.error(
            '❌ Error cargando completados:',
            error
        );

        listaEl.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:#ef4444;">
                <i class="fas fa-exclamation-circle"
                   style="font-size:2rem;display:block;margin-bottom:12px;"></i>

                <p>Error al cargar pedidos completados</p>

                <small>
                    ${error.message || 'Revisa la consola'}
                </small>
            </div>
        `;
    }
}
/**
 * Enriquecer completados con datos de servicios
 */
async function enriquecerCompletadosConServicios(uid) {
    try {
        const q = query(
            collection(db, 'servicios_comerciante'),
            where('comercianteId', '==', uid)
        );
        const snap = await getDocs(q);
        const servicios = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Mapear servicio por pedidoId
        const servicioMap = {};
        servicios.forEach(s => {
            if (s.pedidoId) {
                servicioMap[s.pedidoId] = s;
            }
        });

        // Actualizar cada completado con su servicio
        completadosCache = completadosCache.map(p => {
            const servicio = servicioMap[p.id];
            return {
                ...p,
                servicio: servicio || null
            };
        });

        renderCompletados(completadosCache);

    } catch (error) {
        console.warn('⚠️ Error enriqueciendo completados:', error);
    }
}

/**
 * Renderizar la lista de completados
 */
function renderCompletados(pedidos) {
    const listaEl = document.getElementById('completados-list');
    if (!listaEl) return;

    if (!pedidos || pedidos.length === 0) {
        listaEl.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:#6b7280;">
                <i class="fas fa-check-circle" style="font-size:2.5rem;color:#10b981;display:block;margin-bottom:12px;"></i>
                <p style="font-size:1rem;">No hay pedidos completados aún</p>
                <small>Los pedidos que los clientes confirmen aparecerán aquí</small>
            </div>
        `;
        return;
    }

    // Calcular estadísticas
    let totalCompletados = pedidos.length;
    let totalPendientes = 0;
    let totalPagados = 0;

    pedidos.forEach(p => {
        if (p.servicio) {
            if (p.servicio.estado === 'pendiente') {
                totalPendientes += (p.servicio.monto || 800);
            } else if (p.servicio.estado === 'pagado') {
                totalPagados += (p.servicio.monto || 800);
            }
        }
    });

    // Actualizar estadísticas
    document.getElementById('comp-total').textContent = totalCompletados;
    document.getElementById('comp-pendientes').textContent = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    }).format(totalPendientes);
    document.getElementById('comp-pagados').textContent = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    }).format(totalPagados);

    // Renderizar lista
    listaEl.innerHTML = pedidos.map(p => {
        const fecha = p.createdAt?.toDate?.() || new Date(p.createdAt);
        const fechaStr = fecha.toLocaleDateString('es-CO', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        const pedidoCorto = '#' + (p.id || '').slice(-6).toUpperCase();
        const cliente = p.cliente?.nombre || p.clienteNombre || 'Cliente';
        const total = money(p.total ?? p.subtotal ?? 0);

        // Estado del servicio
        let servicioTag = '';
        if (p.servicio) {
            if (p.servicio.estado === 'pendiente') {
                servicioTag = `<span class="tag pendiente">⏳ Servicio pendiente</span>`;
            } else if (p.servicio.estado === 'pagado') {
                servicioTag = `<span class="tag pagado">✅ Servicio pagado</span>`;
            }
        } else {
            servicioTag = `<span class="tag" style="background:#f3f4f6;color:#6b7280;">⚠️ Sin servicio</span>`;
        }

        return `
            <div class="completado-item" data-id="${p.id}">
                <div class="icono">
                    <i class="fas fa-check-circle"></i>
                </div>
                <div class="info">
                    <div class="pedido-id">${pedidoCorto}</div>
                    <div class="detalle">
                        👤 ${cliente} · 💰 ${total}
                        <br>
                        ${servicioTag}
                    </div>
                </div>
                <div class="fecha">${fechaStr}</div>
                <div class="acciones">
                    <button class="btn btn-sm btn-primary btn-ver-completado" data-id="${p.id}">Ver</button>
                    ${p.servicio && p.servicio.estado === 'pendiente' ? `
                        <button class="btn btn-sm btn-success btn-pagar-servicio" data-id="${p.id}" data-servicio="${p.servicio.id}">
                            💰 Pagar
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Eventos de los botones
    listaEl.querySelectorAll('.btn-ver-completado').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            location.hash = '#orders';
            setTimeout(() => {
                try { openOrderDetail(id); } catch {}
            }, 100);
        });
    });

    listaEl.querySelectorAll('.btn-pagar-servicio').forEach(btn => {
        btn.addEventListener('click', () => {
            const servicioId = btn.dataset.servicio;
            if (servicioId) {
                // Abrir modal de pago con ese servicio seleccionado
                if (typeof window.abrirModalPago === 'function') {
                    window.abrirModalPago();
                    // TODO: Preseleccionar el servicio
                } else {
                    alert('El módulo de pago no está disponible');
                }
            }
        });
    });
}

/**
 * Carga los datos de la cuenta oficial desde la Torre de Control
 */
async function cargarDatosOficiales() {
    try {
        const docRef = doc(db, 'configuracion', 'recaudo');
        const docSnap = await getDoc(docRef);
        const container = document.getElementById('ps-datos-oficiales');
        
        if (!container) return;
        
        if (!docSnap.exists() || !docSnap.data().activo) {
            container.style.display = 'none';
            return;
        }

        const data = docSnap.data();
        container.style.display = 'block';
        document.getElementById('ps-oficial-banco').textContent = data.banco || '--';
        document.getElementById('ps-oficial-tipo').textContent = data.tipoCuenta || '--';
        document.getElementById('ps-oficial-numero').textContent = data.numeroCuenta || '--';
        document.getElementById('ps-oficial-titular').textContent = data.titular || '--';
        document.getElementById('ps-oficial-documento').textContent = data.documento || '--';
        document.getElementById('ps-oficial-texto').textContent = data.instrucciones || 'Sigue las instrucciones de pago.';
        
        console.log('✅ Datos oficiales cargados:', data);
        
    } catch (error) {
        console.warn('⚠️ Error cargando datos oficiales:', error);
        const container = document.getElementById('ps-datos-oficiales');
        if (container) container.style.display = 'none';
    }
}
/**
 * Escuchar cambios en tiempo real de completados
 */
export function escucharCompletados(uid) {
    if (unsubCompletados) {
        unsubCompletados();
        unsubCompletados = null;
    }

    if (!uid) return;

    // 🔹 Consultamos solamente por tienda.
    // El filtrado de estado y ordenamiento se hace localmente
    // para evitar depender de un índice compuesto de Firestore.
    const q = query(
        collection(db, 'pedidos'),
        where('tiendaId', '==', uid)
    );

    unsubCompletados = onSnapshot(q, async (snap) => {

        // 🔹 Filtrar únicamente pedidos entregados/completados
        // y ordenarlos por fecha más reciente.
        completadosCache = snap.docs
            .map(d => ({
                id: d.id,
                ...d.data()
            }))
            .filter(p =>
    ['entregado', 'completado'].includes(
        String(p.estado || '').toLowerCase()
    )
)
            .sort((a, b) => {
                const fechaA = a.createdAt?.toDate
                    ? a.createdAt.toDate()
                    : new Date(a.createdAt || 0);

                const fechaB = b.createdAt?.toDate
                    ? b.createdAt.toDate()
                    : new Date(b.createdAt || 0);

                return fechaB - fechaA;
            })
            .slice(0, 100);

        // =====================================================
        // 💰 ENRIQUECER PEDIDOS CON SERVICIOS DEL COMERCIANTE
        // =====================================================
        try {
            const qServ = query(
                collection(db, 'servicios_comerciante'),
                where('comercianteId', '==', uid)
            );

            const snapServ = await getDocs(qServ);

            const servicioMap = {};

            snapServ.docs.forEach(d => {
                const data = d.data();

                if (data.pedidoId) {
                    servicioMap[data.pedidoId] = {
                        id: d.id,
                        ...data
                    };
                }
            });

            completadosCache = completadosCache.map(p => ({
                ...p,
                servicio: servicioMap[p.id] || null
            }));

        } catch (e) {
            console.warn(
                '⚠️ Error en escucha de servicios:',
                e
            );
        }

        // =====================================================
        // 🖥️ ACTUALIZAR UI SI LA PESTAÑA ESTÁ ACTIVA
        // =====================================================
        const tabActive =
            document
                .getElementById('completed-content')
                ?.classList.contains('active');

        if (tabActive) {
            renderCompletados(completadosCache);
        }

    }, (error) => {
        console.warn(
            '⚠️ Error en escucha de completados:',
            error
        );
    });
}


// =========================================================
// 🟢 INICIALIZAR COMPLETADOS CON EL UID DEL COMERCIANTE
// =========================================================
export function initCompletados(uid) {
    if (!uid) return;

    escucharCompletados(uid);
    cargarCompletados(uid);
}


// 🔥 RECALCULAR PENDIENTES AL CARGAR LA PÁGINA
setTimeout(() => {
    recalcularPendientes();
}, 1500);

console.log('💰 Módulo de servicios cargado');
console.log('🗂️ Módulo de completados cargado');
console.log('✅ Panel del comerciante cargado correctamente');
console.log('💬 Chat integrado listo');
console.log('🔍 Carga de perfil de cliente integrada');


// ============================================================
// 💳 MÉTODOS DE PAGO - GUARDAR Y CARGAR DESDE FIRESTORE
// ============================================================

/**
 * Carga los métodos de pago guardados del comerciante
 */
export async function cargarMetodosPago(uid) {
    if (!uid) return;

    try {
        const docRef = doc(db, 'tiendas', uid);
        const snap = await getDoc(docRef);

        if (!snap.exists()) return;

        const data = snap.data();
        const metodos = data.metodosPago || {};

        // Rellenar campos con los datos guardados
        if (metodos.nequi) {
            const activo = document.getElementById('pago-nequi-activo');
            const numero = document.getElementById('pago-nequi-numero');
            const titular = document.getElementById('pago-nequi-titular');

            if (activo) activo.checked = !!metodos.nequi.activo;
            if (numero) numero.value = metodos.nequi.numero || '';
            if (titular) titular.value = metodos.nequi.titular || '';
        }

        if (metodos.breb) {
            const activo = document.getElementById('pago-breb-activo');
            const llave = document.getElementById('pago-breb-llave');
            const titular = document.getElementById('pago-breb-titular');

            if (activo) activo.checked = !!metodos.breb.activo;
            if (llave) llave.value = metodos.breb.llave || '';
            if (titular) titular.value = metodos.breb.titular || '';
        }

        if (metodos.transferencia) {
            const activo = document.getElementById('pago-banco-activo');
            const banco = document.getElementById('pago-banco-nombre');
            const tipo = document.getElementById('pago-banco-tipo');
            const numero = document.getElementById('pago-banco-numero');
            const titular = document.getElementById('pago-banco-titular');

            if (activo) activo.checked = !!metodos.transferencia.activo;
            if (banco) banco.value = metodos.transferencia.banco || '';
            if (tipo) tipo.value = metodos.transferencia.tipo || '';
            if (numero) numero.value = metodos.transferencia.numero || '';
            if (titular) titular.value = metodos.transferencia.titular || '';
        }

        console.log('✅ Métodos de pago cargados:', metodos);

    } catch (error) {
        console.warn('⚠️ Error cargando métodos de pago:', error);
    }
}

/**
 * Guarda los métodos de pago en Firestore
 */
export async function guardarMetodosPago(uid) {
    if (!uid) {
        setMsg('❌ No se pudo identificar el comerciante', false);
        return false;
    }

    const msgEl = document.getElementById('metodos-pago-msg');
    const btn = document.getElementById('btn-guardar-metodos-pago');

    // Deshabilitar botón
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    }

    if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#2563eb';
        msgEl.textContent = '💾 Guardando métodos de pago...';
    }

    try {
        // Recolectar datos
        const metodosPago = {
            nequi: {
                activo: !!document.getElementById('pago-nequi-activo')?.checked,
                numero: document.getElementById('pago-nequi-numero')?.value || '',
                titular: document.getElementById('pago-nequi-titular')?.value || ''
            },
            breb: {
                activo: !!document.getElementById('pago-breb-activo')?.checked,
                llave: document.getElementById('pago-breb-llave')?.value || '',
                titular: document.getElementById('pago-breb-titular')?.value || ''
            },
            transferencia: {
                activo: !!document.getElementById('pago-banco-activo')?.checked,
                banco: document.getElementById('pago-banco-nombre')?.value || '',
                tipo: document.getElementById('pago-banco-tipo')?.value || '',
                numero: document.getElementById('pago-banco-numero')?.value || '',
                titular: document.getElementById('pago-banco-titular')?.value || ''
            }
        };

        // Guardar en Firestore
        await setDoc(doc(db, 'tiendas', uid), {
            metodosPago: metodosPago,
            actualizadoEn: serverTimestamp()
        }, { merge: true });

        // También guardar en perfiles para acceso público
        await setDoc(doc(db, 'perfiles', uid), {
            metodosPago: metodosPago,
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Mostrar mensaje de éxito
        if (msgEl) {
            msgEl.style.color = '#16a34a';
            msgEl.textContent = '✅ Métodos de pago guardados correctamente';
            setTimeout(() => {
                msgEl.style.display = 'none';
            }, 3000);
        }

        setMsg('✅ Métodos de pago guardados', true);

        // Notificar
        await crearNotificacion(uid, {
            tipo: 'configuracion',
            titulo: '💳 Métodos de pago actualizados',
            mensaje: 'Los métodos de pago de tu tienda han sido actualizados.'
        });

        console.log('✅ Métodos de pago guardados:', metodosPago);

        return true;

    } catch (error) {
        console.error('❌ Error guardando métodos de pago:', error);

        if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = '❌ Error al guardar: ' + error.message;
            setTimeout(() => {
                msgEl.style.display = 'none';
            }, 4000);
        }

        setMsg('❌ Error al guardar métodos de pago', false);
        return false;

    } finally {
        // Restaurar botón
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar métodos de pago';
        }
    }
}

// ============================================================
// 🎯 CONECTAR BOTÓN GUARDAR MÉTODOS DE PAGO
// ============================================================

function initMetodosPago() {
    const btnGuardar = document.getElementById('btn-guardar-metodos-pago');
    if (!btnGuardar) return;

    btnGuardar.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) {
            setMsg('❌ Debes iniciar sesión', false);
            return;
        }

        await guardarMetodosPago(user.uid);
    });

    console.log('💳 Métodos de pago inicializados');
}

// ============================================================
// 🚀 INICIALIZAR MÉTODOS DE PAGO CON AUTENTICACIÓN
// ============================================================

// Escuchar autenticación para cargar métodos de pago
onAuthStateChanged(auth, async (user) => {
    if (user) {
        setTimeout(() => {
            cargarMetodosPago(user.uid);
            initMetodosPago();
        }, 800);
    }
});

// También inicializar cuando se carga la pestaña de configuración
document.addEventListener('DOMContentLoaded', () => {
    const user = auth.currentUser;
    if (user) {
        setTimeout(() => {
            cargarMetodosPago(user.uid);
            initMetodosPago();
        }, 1000);
    }

    // Si la pestaña de configuración se activa, recargar
    const settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab) {
        settingsTab.addEventListener('click', () => {
            const user = auth.currentUser;
            if (user) {
                cargarMetodosPago(user.uid);
            }
        });
    }
});

console.log('💳 Módulo de métodos de pago cargado');

// ============================================================
// 💰 PAGO DE SERVICIOS - MÓDULO COMPLETO (SIN ÍNDICE)
// ============================================================

/**
 * Abre el modal de pago de servicios
 */
export function abrirModalPago() {
    const modal = document.getElementById('pagar-servicios-modal');
    if (!modal) {
        console.warn('⚠️ Modal de pago no encontrado en el HTML');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        alert('Debes iniciar sesión para pagar servicios');
        return;
    }

    const uidComerciante = user.uid;

    // Resetear selecciones
    window.serviciosSeleccionados = new Set();
    window.metodoSeleccionado = null;

    // Limpiar checkbox anteriores
    document.querySelectorAll('.servicio-checkbox').forEach(chk => chk.checked = false);

    // Ocultar sección de comprobante
    const comprobanteSection = document.getElementById('ps-comprobante-section');
    if (comprobanteSection) comprobanteSection.style.display = 'none';

    // Limpiar mensaje
    const msg = document.getElementById('ps-metodo-seleccionado');
    if (msg) msg.textContent = 'Selecciona un método de pago';

    // Deshabilitar botón confirmar
    const confirmBtn = document.getElementById('ps-confirmar');
    if (confirmBtn) confirmBtn.disabled = true;

    // Mostrar modal
    modal.style.display = 'flex';
    modal.style.pointerEvents = 'auto';
    modal.classList.add('show');

    // Cargar servicios
    cargarServiciosModal(uidComerciante);

    // ✅ CARGAR DATOS OFICIALES DE LA TORRE
    cargarDatosOficiales();

    console.log('💰 Modal de pago abierto para:', uidComerciante);
}
/**
 * Carga los servicios pendientes en el modal
 */
async function cargarServiciosModal(comercianteId) {
    const lista = document.getElementById('ps-lista-servicios');
    if (!lista) return;

    if (!comercianteId) {
        lista.innerHTML = `
            <div style="text-align:center;padding:20px;color:#ef4444;">
                ❌ No se pudo identificar al comerciante
            </div>
        `;
        return;
    }

    lista.innerHTML = `
        <div style="text-align:center;padding:20px;color:#6b7280;">
            <i class="fas fa-spinner fa-spin"></i> Cargando servicios...
        </div>
    `;

    try {
        // 🔹 CONSULTA SIMPLE: SOLO POR comercianteId
        const q = query(
            collection(db, 'servicios_comerciante'),
            where('comercianteId', '==', comercianteId)
        );

        const snap = await getDocs(q);

        // 🔹 FILTRAR pendientes LOCALMENTE
        const servicios = snap.docs
            .map(d => ({
                id: d.id,
                ...d.data()
            }))
            .filter(s =>
                String(s.estado || '').toLowerCase() === 'pendiente'
            )
            .sort((a, b) => {
                const fechaA = a.fechaGenerado?.toDate?.() || new Date(a.fechaGenerado || 0);
                const fechaB = b.fechaGenerado?.toDate?.() || new Date(b.fechaGenerado || 0);
                return fechaB - fechaA;
            });

        window.serviciosPendientes = servicios;

        if (servicios.length === 0) {
            lista.innerHTML = `
                <div style="text-align:center;padding:30px 20px;color:#6b7280;">
                    <i class="fas fa-check-circle" style="color:#10b981;font-size:2rem;display:block;margin-bottom:10px;"></i>
                    <p style="font-size:1rem;">🎉 No tienes servicios pendientes</p>
                </div>
            `;
            document.getElementById('ps-total-servicios').textContent = '0';
            document.getElementById('ps-total-monto').textContent = '$0';
            document.getElementById('ps-confirmar').disabled = true;
            return;
        }

        renderizarListaServicios();
        actualizarTotalServicios();

    } catch (error) {
        console.error('❌ Error cargando servicios:', error);
        lista.innerHTML = `
            <div style="text-align:center;padding:20px;color:#ef4444;">
                ❌ Error al cargar servicios: ${error.message}
                <br>
                <button onclick="location.reload()" style="margin-top:10px;padding:8px 16px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;">
                    <i class="fas fa-sync"></i> Reintentar
                </button>
            </div>
        `;
    }
}

/**
 * Renderiza la lista de servicios en el modal
 */
function renderizarListaServicios() {
    const lista = document.getElementById('ps-lista-servicios');
    if (!lista) return;

    const servicios = window.serviciosPendientes || [];

    if (servicios.length === 0) {
        lista.innerHTML = `
            <div style="text-align:center;padding:30px 20px;color:#6b7280;">
                <i class="fas fa-check-circle" style="color:#10b981;font-size:2rem;display:block;margin-bottom:10px;"></i>
                <p style="font-size:1rem;">🎉 No tienes servicios pendientes</p>
            </div>
        `;
        return;
    }

    lista.innerHTML = servicios.map(s => {
        const fecha = s.fechaGenerado?.toDate?.() || new Date();
        const fechaStr = fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
        const pedidoCorto = (s.pedidoId || '').slice(-6).toUpperCase() || '---';
        const monto = s.monto || 800;

        return `
            <div class="servicio-item" data-id="${s.id}">
                <input type="checkbox" class="servicio-checkbox" data-id="${s.id}" data-monto="${monto}">
                <div class="servicio-info">
                    <div class="pedido-id">📦 Pedido #${pedidoCorto}</div>
                    <div class="fecha">📅 ${fechaStr} · ${s.clienteNombre || 'Cliente'}</div>
                </div>
                <div class="servicio-monto">$${monto.toLocaleString()}</div>
            </div>
        `;
    }).join('');

    // Eventos de los checkboxes
    lista.querySelectorAll('.servicio-checkbox').forEach(chk => {
        chk.addEventListener('change', function() {
            const id = this.dataset.id;
            if (this.checked) {
                window.serviciosSeleccionados.add(id);
            } else {
                window.serviciosSeleccionados.delete(id);
            }
            actualizarTotalServicios();
        });
    });
}

/**
 * Actualiza el total de servicios seleccionados
 */
function actualizarTotalServicios() {
    let total = 0;
    let count = 0;

    const servicios = window.serviciosPendientes || [];
    const seleccionados = window.serviciosSeleccionados || new Set();

    servicios.forEach(s => {
        if (seleccionados.has(s.id)) {
            total += (s.monto || 800);
            count++;
        }
    });

    const totalServicios = document.getElementById('ps-total-servicios');
    const totalMonto = document.getElementById('ps-total-monto');
    const confirmBtn = document.getElementById('ps-confirmar');

    if (totalServicios) totalServicios.textContent = count;
    if (totalMonto) {
        totalMonto.textContent = new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            maximumFractionDigits: 0
        }).format(total);
    }

    if (confirmBtn) {
        confirmBtn.disabled = (count === 0 || !window.metodoSeleccionado);
    }
}

/**
 * Guarda el método de pago seleccionado
 */
function seleccionarMetodoPago(metodo) {
    window.metodoSeleccionado = metodo;

    const labels = {
        'nequi': '📱 Nequi',
        'breb': '📱 Bre-B',
        'transferencia': '🏦 Transferencia bancaria'
    };

    const msg = document.getElementById('ps-metodo-seleccionado');
    if (msg) msg.textContent = `✅ Método seleccionado: ${labels[metodo] || metodo}`;

    const comprobanteSection = document.getElementById('ps-comprobante-section');
    if (comprobanteSection) comprobanteSection.style.display = 'block';

    actualizarTotalServicios();
}

/**
 * Confirma el pago de servicios
 */
async function confirmarPago() {
    const confirmBtn = document.getElementById('ps-confirmar');
    if (!confirmBtn || confirmBtn.disabled) return;

    const selectedIds = Array.from(window.serviciosSeleccionados || new Set());
    if (selectedIds.length === 0) {
        alert('Selecciona al menos un servicio para pagar');
        return;
    }

    if (!window.metodoSeleccionado) {
        alert('Selecciona un método de pago');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        alert('Debes iniciar sesión');
        return;
    }

    const uidComerciante = user.uid;

    // Calcular total
    let total = 0;
    const servicios = window.serviciosPendientes || [];
    servicios.forEach(s => {
        if (window.serviciosSeleccionados.has(s.id)) {
            total += (s.monto || 800);
        }
    });

    // Subir comprobante
    let comprobanteUrl = '';
    const fileInput = document.getElementById('ps-comprobante');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        try {
            const file = fileInput.files[0];
            const storageRef = ref(storage, `comprobantes/${uidComerciante}/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            comprobanteUrl = await getDownloadURL(storageRef);
        } catch (error) {
            console.warn('Error subiendo comprobante:', error);
        }
    }

    const confirmar = confirm(
        `💰 Confirmar pago\n\n` +
        `Servicios a pagar: ${selectedIds.length}\n` +
        `Total: $${total.toLocaleString()}\n` +
        `Método: ${window.metodoSeleccionado.toUpperCase()}\n\n` +
        (comprobanteUrl ? '✅ Comprobante adjunto\n\n' : '⚠️ Sin comprobante\n\n') +
        `¿Confirmas el pago?`
    );

    if (!confirmar) return;

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

    try {
        const batch = writeBatch(db);
        const now = serverTimestamp();

        // ✅ CORREGIDO: estado = 'por_verificar' (NO pagado)
        for (const id of selectedIds) {
            const ref = doc(db, 'servicios_comerciante', id);
            batch.update(ref, {
                estado: 'por_verificar',     // ← ✅ EL COMERCIANTE REPORTA, NO AUTO-MARCA
                fechaPago: now,
                metodoPago: window.metodoSeleccionado,
                comprobanteUrl: comprobanteUrl || null
            });
        }

        // Crear registro de pago
        const pagoRef = doc(collection(db, 'pagos_comerciante'));
        batch.set(pagoRef, {
            comercianteId: uidComerciante,
            servicioIds: selectedIds,
            total: total,
            metodo: window.metodoSeleccionado,
            comprobanteUrl: comprobanteUrl || null,
            estado: 'verificacion',          // ← ✅ PAGO EN VERIFICACIÓN
            createdAt: now,
            updatedAt: now
        });

        await batch.commit();

// ============================================================
// 📊 ACTUALIZAR RESUMEN PERSISTENTE DEL COMERCIANTE
// ============================================================
try {
    const resumenRef = doc(db, 'resumen_servicios_comerciante', uidComerciante);
    await setDoc(resumenRef, {
        totalPendiente: increment(-total),
        totalPorVerificar: increment(total),
        ultimaActualizacion: serverTimestamp()
    }, { merge: true });
    console.log('✅ Resumen actualizado');
} catch (error) {
    console.warn('⚠️ Error actualizando resumen:', error);
}

        // Notificar al comerciante
        await crearNotificacion(uidComerciante, {
            tipo: 'pago',
            titulo: '💰 Pago reportado',
            mensaje: `Has reportado el pago de ${selectedIds.length} servicios por $${total.toLocaleString()} vía ${window.metodoSeleccionado.toUpperCase()}. Espera la verificación de la Torre de Control.`
        });

        alert(`✅ Pago reportado exitosamente!\n\nTotal: $${total.toLocaleString()}\nMétodo: ${window.metodoSeleccionado.toUpperCase()}\n\nEl comprobante será verificado por el equipo de Mi Tiendita.`);

        // Cerrar modal y recargar
        cerrarModalPago();
        setTimeout(() => {
            window.location.reload();
        }, 800);

    } catch (error) {
        console.error('❌ Error procesando pago:', error);
        alert('❌ Error al procesar el pago. Intenta nuevamente.\n\n' + error.message);
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check-circle"></i> Pagar ahora';
    }
}

/**
 * Cierra el modal de pago
 */
function cerrarModalPago() {
    const modal = document.getElementById('pagar-servicios-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.style.pointerEvents = 'none';
        modal.classList.remove('show');
    }
}

// ============================================================
// 🎯 CONECTAR EVENTOS DEL MODAL DE PAGO
// ============================================================

function initModalPago() {
    // Botón Pagar (abrir modal) - si existe en el HTML
    const btnPagar = document.getElementById('btn-pagar-servicios') || document.querySelector('[data-action="pagar-servicios"]');
    if (btnPagar) {
        btnPagar.addEventListener('click', abrirModalPago);
    }

    // Botón Confirmar (dentro del modal)
    const confirmBtn = document.getElementById('ps-confirmar');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmarPago);
    }

    // Botón Cancelar (dentro del modal)
    const cancelBtn = document.getElementById('ps-cancelar');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', cerrarModalPago);
    }

    // Cerrar modal con X
    const closeBtn = document.getElementById('close-pagar-servicios');
    if (closeBtn) {
        closeBtn.addEventListener('click', cerrarModalPago);
    }

    // Cerrar modal click fuera
    const modal = document.getElementById('pagar-servicios-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cerrarModalPago();
        });
    }

    // Cerrar con Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cerrarModalPago();
    });

    // Métodos de pago
    document.querySelectorAll('.btn-metodo-pago').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.btn-metodo-pago').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            seleccionarMetodoPago(this.dataset.metodo);
        });
    });

    console.log('💰 Modal de pago inicializado');
}

// ============================================================
// 🚀 INICIALIZAR CUANDO EL DOM ESTÉ LISTO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initModalPago, 500);
});

// También inicializar cuando el usuario está autenticado
onAuthStateChanged(auth, (user) => {
    if (user) {
        setTimeout(initModalPago, 1000);
    }
});

console.log('💰 Módulo de pago de servicios cargado');
console.log('📌 Los servicios se reportan como "por_verificar" y esperan aprobación de la Torre de Control');



// ============================================================
// 🗑️ ELIMINAR CUENTA DEL COMERCIANTE
// ============================================================

const btnEliminarCuentaComerciante = document.getElementById(
  "btn-eliminar-cuenta-comerciante"
);

if (btnEliminarCuentaComerciante) {
  btnEliminarCuentaComerciante.addEventListener("click", async () => {

    const confirmar = confirm(
      "¿Realmente quieres eliminar tu cuenta?\n\n" +
      "Se eliminarán tu cuenta y los datos asociados.\n\n" +
      "Esta acción no se puede deshacer."
    );

    if (!confirmar) return;

    try {

      btnEliminarCuentaComerciante.disabled = true;
      btnEliminarCuentaComerciante.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Eliminando...';

      const eliminarCuentaFn = httpsCallable(
        functions,
        "eliminarCuenta"
      );

      await eliminarCuentaFn();

      alert("Tu cuenta fue eliminada correctamente.");

      await auth.signOut();

      window.location.href = "./index.html";

    } catch (error) {

      console.error("❌ Error eliminando cuenta:", error);

      alert(
        "No fue posible eliminar la cuenta.\n\n" +
        "Por favor, inténtalo nuevamente."
      );
           btnEliminarCuentaComerciante.disabled = false;
      btnEliminarCuentaComerciante.innerHTML =
        '<i class="fas fa-trash-alt"></i> Eliminar mi cuenta';
    }
  });

// ============================================================
// 💜 SOLICITUD POR CHAT — FUNCIONES DEL COMERCIANTE
// ============================================================
/**
 * 🔍 Detecta valores monetarios en un texto.
 * Solo toma valores que empiecen con "$" para evitar falsos positivos.
 * 
 * Ejemplos:
 *   "2 libras de carne $40.000, 2 pollos $10.000" → [40000, 10000]
 *   "Son $50.000 en total"                        → [50000]
 *   "Te llega en 30 minutos"                       → []
 * 
 * @param {string} texto
 * @returns {number[]} Array de valores detectados
 */
function detectarPrecios(texto) {
    if (!texto || typeof texto !== 'string') return [];

    const precios = [];

    // Regex: $ seguido de dígitos con puntos opcionales
    // Ej: $40.000, $40000, $1.500.000, $500
    const regex = /\$\s*([\d.]+)/g;
    let match;

    while ((match = regex.exec(texto)) !== null) {
        // Quitar los puntos de miles
        const limpio = match[1].replace(/\./g, '');
        const num = Number(limpio);
        if (Number.isFinite(num) && num > 0) {
            precios.push(num);
        }
    }

    return precios;
}
/**
 * Agrega un producto a la solicitud por chat
 */
window.agregarProductoSolicitud = async function(pedidoId) {
    const user = auth.currentUser;
    if (!user) { alert('Debes iniciar sesión'); return; }

    const nombre = prompt('Nombre del producto:');
    if (!nombre) return;
    const precioStr = prompt('Precio unitario (sin puntos):', '0');
    if (precioStr === null) return;
    const precio = Number(precioStr.replace(/[^0-9]/g, '')) || 0;
    const qtyStr = prompt('Cantidad:', '1');
    if (qtyStr === null) return;
    const qty = Number(qtyStr) || 1;

    const item = {
        nombre: nombre.trim(),
        unitPrice: precio,
        qty: qty,
        unitLabel: 'und.'
    };

    try {
        const pedidoRef = doc(db, 'pedidos', pedidoId);
        const snap = await getDoc(pedidoRef);
        if (!snap.exists()) { alert('Pedido no encontrado'); return; }

        const data = snap.data();
        const items = [...(data.items || []), item];
        const subtotal = items.reduce((s, i) => s + Number(i.unitPrice || 0) * Number(i.qty || 1), 0);
        const envio = Number(data.envio || 0);
        const servicio = Number(data.servicio || 800);

        await updateDoc(pedidoRef, {
            items,
            subtotal,
            servicio,
            total: subtotal + envio + servicio,
            actualizadoEn: serverTimestamp()
        });

        await addDoc(collection(db, 'pedidos', pedidoId, 'mensajes'), {
            texto: `➕ Producto agregado: ${item.nombre} × ${item.qty} — $${(item.unitPrice * item.qty).toLocaleString('es-CO')}`,
            uid: user.uid,
            nombre: user.displayName || user.email || 'Comerciante',
            creadoEn: serverTimestamp(),
            sistema: true
        });

        setMsg('✅ Producto agregado', true);

        document.getElementById('order-detail-container').style.display = 'none';
        setTimeout(() => openOrderDetail(pedidoId), 300);

    } catch (e) {
        console.error('Error agregando producto:', e);
        alert('❌ Error al agregar producto: ' + e.message);
    }
};

/**
 * Envía el resumen de la solicitud al cliente por el chat
 */
window.enviarResumenAlCliente = async function(pedidoId) {
    const user = auth.currentUser;
    if (!user) { alert('Debes iniciar sesión'); return; }

    try {
        const snap = await getDoc(doc(db, 'pedidos', pedidoId));
        if (!snap.exists()) return;
        const data = snap.data();
        const items = data.items || [];

        if (items.length === 0) {
            alert('⚠️ No hay productos todavía. Agrega productos primero.');
            return;
        }

        const subtotal = items.reduce((s, i) => s + Number(i.unitPrice || 0) * Number(i.qty || 1), 0);
        const envio = Number(data.envio || 0);
        const servicio = Number(data.servicio || 800);
        const total = subtotal + envio + servicio;

        const resumen = items.map(i => `• ${i.nombre} × ${i.qty} — $${(i.unitPrice * i.qty).toLocaleString('es-CO')}`).join('\n');

        const texto = `📋 Resumen del pedido:\n${resumen}\n\nSubtotal: $${subtotal.toLocaleString('es-CO')}\nEnvío: ${envio === 0 ? 'GRATIS' : '$' + envio.toLocaleString('es-CO')}\nServicio: $${servicio.toLocaleString('es-CO')}\nTotal: $${total.toLocaleString('es-CO')}\n\nSi estás de acuerdo, confirma el pedido para enviarlo formalmente.`;

        await addDoc(collection(db, 'pedidos', pedidoId, 'mensajes'), {
            texto,
            uid: user.uid,
            nombre: user.displayName || user.email || 'Comerciante',
            creadoEn: serverTimestamp(),
            sistema: true
        });

        setMsg('✅ Resumen enviado al cliente', true);

    } catch (e) {
        console.error('Error enviando resumen:', e);
        alert('❌ Error al enviar resumen: ' + e.message);
    }
};

/**
 * Convierte la solicitud por chat en un pedido formal
 */
window.convertirAPedidoFormal = async function(pedidoId) {
    const user = auth.currentUser;
    if (!user) { alert('Debes iniciar sesión'); return; }

    if (!confirm('¿Convertir esta solicitud en pedido formal?\n\nEl cliente verá el pedido en su lista.')) return;

    try {
        const pedidoRef = doc(db, 'pedidos', pedidoId);
        const snap = await getDoc(pedidoRef);
        if (!snap.exists()) return;

        const data = snap.data();
        const items = data.items || [];
        const subtotal = items.reduce((s, i) => s + Number(i.unitPrice || 0) * Number(i.qty || 1), 0);
        const envio = Number(data.envio || 0);
        const servicio = Number(data.servicio || 800);
        const total = subtotal + envio + servicio;

        await updateDoc(pedidoRef, {
            estado: 'pendiente',
            origenPedido: 'chat',
            subtotal,
            envio,
            servicio,
            total,
            actualizadoEn: serverTimestamp()
        });

        await addDoc(collection(db, 'pedidos', pedidoId, 'mensajes'), {
            texto: `✅ El comerciante convirtió la solicitud en pedido formal. Total: $${total.toLocaleString('es-CO')}`,
            uid: user.uid,
            nombre: user.displayName || user.email || 'Comerciante',
            creadoEn: serverTimestamp(),
            sistema: true
        });

        setMsg('✅ Pedido formal creado. Ahora puedes aceptarlo.', true);

        document.getElementById('order-detail-container').style.display = 'none';
        setTimeout(() => openOrderDetail(pedidoId), 300);

    } catch (e) {
        console.error('Error convirtiendo:', e);
        alert('❌ Error al convertir en pedido formal: ' + e.message);
    }
};

console.log('💜 Funciones de solicitud por chat cargadas');
  
}