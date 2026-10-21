// js/tiendas.js
import { db } from './firebase-config.js';
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/** Trae solo tiendas activas (alineado con reglas) */
export async function cargarTiendas() {
  try {
    const q = query(collection(db, 'tiendas'), where('activo', '==', true));
    const snap = await getDocs(q);
    const arr = [];
    snap.forEach(d => {
      const data = d.data() || {};
      arr.push({
        id: d.id,
        nombre: data.nombre || 'Tienda',
        lat: (typeof data.lat === 'number') ? data.lat : data.latitude,
        lon: (typeof data.lon === 'number') ? data.lon : data.lng
      });
    });
    return arr;
  } catch (e) {
    console.error('Error cargando tiendas:', e);
    return [];
  }
}

/** Distancia simple Haversine (km) */
function distanciaKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof a.lon !== 'number'
      || typeof b.lat !== 'number' || typeof b.lon !== 'number') return null;

  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const x = Math.sin(dLat/2)**2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)**2;
  const d = 2 * R * Math.asin(Math.sqrt(x));
  return d;
}

/**
 * Pinta las tiendas en el <select>.
 * productos.js espera que option.value sea el ÍNDICE del array.
 */
export function renderTiendasSelect(tiendas) {
  const select = document.getElementById('selector-tienda');
  const badge  = document.getElementById('badge-distancia');
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una tienda cercana…</option>`;

  const user = (window.userPos && typeof window.userPos.lat === 'number')
    ? window.userPos
    : null;

  (tiendas || []).forEach((t, i) => {
    const option = document.createElement('option');
    option.value = String(i); // índice, no id
    let label = t.nombre || 'Tienda';

    if (user && typeof t.lat === 'number' && typeof t.lon === 'number') {
      const km = distanciaKm({ lat: user.lat, lon: user.lon }, { lat: t.lat, lon: t.lon });
      if (km !== null) label += ` – ${km.toFixed(1)} km`;
      option.dataset.distanciaKm = (km != null) ? km.toFixed(2) : '';
    }

    option.textContent = label;
    select.appendChild(option);
  });

  if (badge) badge.textContent = '';
}
