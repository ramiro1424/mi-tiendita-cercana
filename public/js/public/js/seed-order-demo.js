// public/js/seed-order-demo.js
// Genera pedidos demo para una tienda (comerciante) usando productos existentes.
// Estados alineados al backend: pendiente, aceptado, en_preparacion, listo, entregado, cancelado, expirado.
// 🔥 AHORA CON SERVICIO ($800) Y ENVÍO INCLUIDOS

import { db, auth } from './firebase-config.js';
import {
  collection, query, where, getDocs, addDoc,
  serverTimestamp, Timestamp, doc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ================================================================
// 🔥 CONFIGURACIÓN DE SERVICIO Y ENVÍO
// ================================================================
const SERVICIO_FIJO = 800; // $800 COP por pedido
const OPCIONES_ENVIO = [0, 1500, 2500, 3000, 4000]; // Posibles costos de envío

const STATES = [
  'pendiente',
  'aceptado',
  'en_preparacion',
  'listo',
  'entregado',
  'cancelado',
  'expirado',
];

// Camino "natural" de un pedido hasta completarse
const FLOW = ['pendiente', 'aceptado', 'en_preparacion', 'listo', 'entregado'];

// Utilidad: entero aleatorio en [min, max]
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Utilidad: tomar N items aleatorios del array (sin reemplazo)
function takeRandom(arr, n) {
  const a = arr.slice();
  const out = [];
  n = Math.min(n, a.length);
  for (let i = 0; i < n; i++) {
    const idx = rndInt(0, a.length - 1);
    out.push(a[idx]);
    a.splice(idx, 1);
  }
  return out;
}

// Construye un historial consistente desde 'pendiente' hasta target.
function buildHistoryTo(target, baseMillis) {
  const entries = [];
  let current = 'pendiente';
  let t = baseMillis;

  function push(from, to, reason = '') {
    entries.push({
      from,
      to,
      at: Timestamp.fromMillis(t),
      actor: 'demo',
      reason,
      byUid: null,
    });
    // avanza el tiempo ~ 3–20 minutos por transición
    t += rndInt(3, 20) * 60 * 1000;
  }

  if (target === 'pendiente') {
    return entries;
  }

  if (target === 'expirado') {
    push('pendiente', 'expirado', 'demo: sin respuesta');
    return entries;
  }

  if (target === 'cancelado') {
    const cancelIndex = rndInt(0, 3);
    for (let i = 0; i < cancelIndex; i++) {
      push(FLOW[i], FLOW[i + 1]);
      current = FLOW[i + 1];
    }
    push(current, 'cancelado', 'demo: cancelado');
    return entries;
  }

  for (let i = 0; i < FLOW.length - 1; i++) {
    const from = FLOW[i];
    const to = FLOW[i + 1];
    push(from, to);
    current = to;
    if (to === target) break;
  }

  return entries;
}

// Crea un pedido demo con N ítems aleatorios de los productos de la tienda
function buildOrderPayload({ tiendaId, productos, targetState, baseMillis }) {
  const itemsCount = rndInt(1, Math.min(5, productos.length));
  const picked = takeRandom(productos, itemsCount);

  let subtotal = 0;
  const items = picked.map((p) => {
    const cantidad = rndInt(1, 3);
    const precio = Number(p.precio || 0);
    const itemSubtotal = Number((precio * cantidad).toFixed(2));
    subtotal += itemSubtotal;
    return {
      productoId: p.id,
      nombre: p.nombre,
      precio,
      cantidad,
      subtotal: itemSubtotal,
      categoria: p.categoria || 'otros',
      imagen: p.imagen || '',
    };
  });
  subtotal = Number(subtotal.toFixed(2));

  // 🔥 CALCULAR ENVÍO Y SERVICIO
  const envio = OPCIONES_ENVIO[rndInt(0, OPCIONES_ENVIO.length - 1)];
  const servicio = SERVICIO_FIJO;
  const total = subtotal + envio + servicio;

  // Fechas "realistas"
  const createdAt = Timestamp.fromMillis(baseMillis);
  const history = buildHistoryTo(targetState, baseMillis + rndInt(1, 10) * 60 * 1000);
  const updatedAt =
    history.length > 0 ? history[history.length - 1].at : createdAt;

  // Cliente de prueba
  const demoCustomers = ['demoCliente1', 'demoCliente2', 'demoCliente3', 'demoCliente4', 'demoCliente5'];
  const uid = demoCustomers[rndInt(0, demoCustomers.length - 1)];

  // Nombres de clientes demo
  const demoNombres = ['Carlos Pérez', 'María Gómez', 'Juan Rodríguez', 'Ana Martínez', 'Luis Fernández'];
  const clienteNombre = demoNombres[rndInt(0, demoNombres.length - 1)];

  // 🔥 BREAKDOWN COMPLETO
  const breakdown = {
    subtotal: subtotal,
    envio: envio,
    servicio: servicio,
    total: total
  };

  return {
    uid,
    tiendaId,
    clienteNombre,
    clienteId: uid,
    items,
    subtotal: subtotal,
    envio: envio,
    servicio: servicio,
    total: total,
    breakdown: breakdown,
    estado: targetState,
    pago: { 
      metodo: rndInt(0, 2) === 0 ? 'contraentrega' : 'efectivo',
      estado: targetState === 'entregado' ? 'pagado' : 'pendiente',
      breakdown: breakdown
    },
    createdAt,
    actualizadoEn: updatedAt,
    history,
  };
}

/**
 * Genera 'count' pedidos demo para la tienda indicada.
 * @param {string} tiendaId - normalmente el UID del comerciante/tienda
 * @param {object} options - { count?: number, daysBack?: number }
 */
export async function seedDemoOrdersForMerchant(tiendaId, options = {}) {
  const { count = 12, daysBack = 20 } = options;
  if (!tiendaId) throw new Error('tiendaId requerido');

  // Traer productos de la tienda
  const qProd = query(
    collection(db, 'productos'), 
    where('tiendaId', '==', tiendaId), 
    where('activo', '==', true)
  );
  const snap = await getDocs(qProd);
  if (snap.empty) {
    throw new Error('La tienda no tiene productos activos. Primero siembra productos.');
  }

  const productos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Distribución de estados para los demo (más entregados para gráficos)
  const distribution = [
    'pendiente',
    'aceptado',
    'en_preparacion',
    'listo',
    'entregado',
    'cancelado',
    'entregado',
    'entregado',
    'entregado',
    'pendiente',
    'expirado',
    'entregado',
  ];

  const ops = [];
  for (let i = 0; i < count; i++) {
    // Fecha base: dentro de los últimos X días
    const now = Date.now();
    const baseMillis =
      now - rndInt(0, daysBack) * 24 * 60 * 60 * 1000 - rndInt(0, 14) * 60 * 60 * 1000;

    const targetState = distribution[rndInt(0, distribution.length - 1)];
    const payload = buildOrderPayload({
      tiendaId,
      productos,
      targetState,
      baseMillis,
    });

    ops.push(addDoc(collection(db, 'pedidos'), payload));
  }

  await Promise.all(ops);
  return { created: ops.length };
}

/* ---------- UI opcional: botón en el panel ---------- */
function attachSeedOrdersButton() {
  const btn = document.getElementById('btn-seed-orders');
  const idEl = document.getElementById('tienda-id');
  if (!btn || !idEl) return;

  btn.addEventListener('click', async () => {
    let tiendaId = idEl.value?.trim();

    if (!tiendaId && auth?.currentUser?.uid) {
      tiendaId = auth.currentUser.uid;
    }
    if (!tiendaId) {
      return alert('No hay tiendaId (UID del comerciante). Guarda tu perfil primero.');
    }

    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sembrando…';

    try {
      const r = await seedDemoOrdersForMerchant(tiendaId, { count: 12, daysBack: 20 });
      alert(`✅ Pedidos demo creados: ${r.created}\n\n💰 Cada pedido incluye:\n- Subtotal\n- Envío (variable)\n- Servicio ($800)\n- Total con todo incluido`);
    } catch (e) {
      console.error(e);
      alert('❌ No se pudo sembrar pedidos. Revisa la consola.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  });
}

document.addEventListener('DOMContentLoaded', attachSeedOrdersButton);

// Exponer en ventana para uso manual desde la consola
window.seedOrdersFor = seedDemoOrdersForMerchant;

console.log('✅ seed-order-demo.js con SERVICIO $800 y ENVÍO cargado');