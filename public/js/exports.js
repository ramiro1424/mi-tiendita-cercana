// public/js/exports.js
// Exporta inventario, clientes (front-only) y ventas por rango (vía Functions/Express)

import { db, auth } from './firebase-config.js';
import {
  collection, query, where, getDocs, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ---- helpers de UX ----
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function setMsg(text) {
  const box = document.getElementById('exports-msg');
  if (box) { box.textContent = text || ''; }
}
function downloadCSV(filename, rows, headers) {
  if (!rows || !rows.length) {
    setMsg('Nada para exportar.');
    return;
  }
  const fields = headers || Object.keys(rows[0] || {});
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const lines = [];
  lines.push(fields.map(esc).join(','));
  for (const r of rows) {
    lines.push(fields.map(f => esc(r[f])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---- Auth helper: current user o redirige ----
function getCurrentUserOrRedirect() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop?.();
      if (user) resolve(user);
      else { try { location.href = './index.html'; } catch {} }
    });
  });
}

// ---- API base (emulador vs prod) ----
function getApiBase() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    // Functions Emulator (nombre de tu proyecto)
    return 'http://127.0.0.1:5001/mi-tiendita-cercana/us-central1/api';
  }
  // Producción
  return 'https://us-central1-mi-tiendita-cercana.cloudfunctions.net/api';
}

// ---- Fetch flexible: productos ----
async function fetchProductos(uid) {
  // 1) nested: /tiendas/{uid}/productos
  const refNested = collection(db, 'tiendas', uid, 'productos');
  const probe = await getDocs(query(refNested, orderBy('nombre'), limit(1)));
  if (!probe.empty) {
    const allSnap = await getDocs(query(refNested, orderBy('nombre')));
    return allSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  // 2) fallback: /productos where tiendaId == uid
  const refFlat = collection(db, 'productos');
  const flatSnap = await getDocs(query(refFlat, where('tiendaId', '==', uid)));
  return flatSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- Fetch flexible: clientes ----
async function fetchClientes(uid) {
  const refNested = collection(db, 'tiendas', uid, 'clientes');
  const probe = await getDocs(query(refNested, orderBy('createdAt'), limit(1)));
  if (!probe.empty) {
    const all = await getDocs(query(refNested, orderBy('createdAt')));
    return all.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  // fallback plano
  const refFlat = collection(db, 'clientes');
  const flatSnap = await getDocs(query(refFlat, where('tiendaId', '==', uid)));
  return flatSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- Exportadores front-only ----
async function exportInventarioCSV() {
  setMsg('Preparando inventario…');
  const user = await getCurrentUserOrRedirect();
  const productos = await fetchProductos(user.uid);

  if (!productos.length) {
    setMsg('No hay productos para exportar.');
    return;
  }

  const rows = productos.map(p => ({
    id: p.id,
    nombre: p.nombre ?? '',
    precio: (p.precio ?? p.precioUnitario ?? 0),
    stock: (p.stock ?? p.inventario ?? 0),
    activo: (p.activo ?? p.visible ?? true),
    categoria: p.categoria ?? '',
    unidadBase: p.unidadBase ?? '',
    sku: p.sku ?? '',
    createdAt: p.createdAt?.toDate?.()?.toISOString?.() ?? '',
    updatedAt: p.updatedAt?.toDate?.()?.toISOString?.() ?? ''
  }));

  const headers = [
    'id','nombre','precio','stock','activo','categoria','unidadBase','sku','createdAt','updatedAt'
  ];

  const ymd = new Date().toISOString().slice(0,10).replace(/-/g,'');
  downloadCSV(`inventario-${ymd}.csv`, rows, headers);
  setMsg(`Inventario exportado (${rows.length} filas).`);
}

async function exportClientesCSV() {
  setMsg('Preparando clientes…');
  const user = await getCurrentUserOrRedirect();
  const clientes = await fetchClientes(user.uid);

  if (!clientes.length) {
    setMsg('No hay clientes para exportar.');
    return;
  }

  const rows = clientes.map(c => ({
    id: c.id,
    nombre: c.nombre ?? '',
    email: c.email ?? '',
    telefono: c.telefono ?? '',
    totalPedidos: c.totalPedidos ?? '',
    ultimoPedidoAt: c.ultimoPedidoAt?.toDate?.()?.toISOString?.() ?? '',
    createdAt: c.createdAt?.toDate?.()?.toISOString?.() ?? ''
  }));

  const headers = [
    'id','nombre','email','telefono','totalPedidos','ultimoPedidoAt','createdAt'
  ];

  const ymd = new Date().toISOString().slice(0,10).replace(/-/g,'');
  downloadCSV(`clientes-${ymd}.csv`, rows, headers);
  setMsg(`Clientes exportados (${rows.length} filas).`);
}

// ---- Exportar ventas (CSV) vía Functions/Express ----
async function exportVentasCSV() {
  setMsg('Preparando ventas…');
  const user = await getCurrentUserOrRedirect();
  const token = await user.getIdToken();

  const from = document.getElementById('ventas-desde')?.value || '';
  const to   = document.getElementById('ventas-hasta')?.value || '';

  const base = getApiBase();
  const url  = new URL(base + '/export/pedidos.csv');
  if (from) url.searchParams.set('from', from);
  if (to)   url.searchParams.set('to', to);

  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(()=>'');
    setMsg(`Error exportando ventas: ${resp.status} ${txt}`);
    return;
  }

  const blob = await resp.blob();
  // Nombre de archivo con fechas si existen
  const baseName = `ventas${from ? '-'+from : ''}${to ? '-'+to : ''}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = baseName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setMsg('Ventas exportadas.');
}

// ---- UI: inyecta tarjeta en Analíticas si no existe ----
function ensureExportsCard() {
  const container = document.getElementById('analytics-content');
  if (!container) return;

  if (!document.getElementById('exports-card')) {
    const card = el(`
      <div class="card" id="exports-card">
        <div class="card-header">
          <h2 class="card-title">Exportaciones (CSV)</h2>
          <div class="card-icon"><i class="fas fa-file-export" aria-hidden="true"></i></div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          <button class="btn" id="btn-export-inv"><i class="fas fa-boxes"></i> Exportar inventario</button>
          <button class="btn" id="btn-export-cli"><i class="fas fa-users"></i> Exportar clientes</button>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <label>Desde <input type="date" id="ventas-desde" class="form-control" style="min-width:160px"></label>
          <label>Hasta <input type="date" id="ventas-hasta" class="form-control" style="min-width:160px"></label>
          <button class="btn btn-outline" id="btn-export-ventas"><i class="fas fa-receipt"></i> Exportar ventas</button>
          <small id="exports-msg" class="seed-status"></small>
        </div>
      </div>
    `);
    container.appendChild(card);
  }

  document.getElementById('btn-export-inv')?.addEventListener('click', exportInventarioCSV);
  document.getElementById('btn-export-cli')?.addEventListener('click', exportClientesCSV);
  document.getElementById('btn-export-ventas')?.addEventListener('click', exportVentasCSV);
}

document.addEventListener('DOMContentLoaded', ensureExportsCard);
