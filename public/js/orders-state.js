// public/js/orders-state.js
// Actualiza el estado del pedido desde el panel del comerciante
// y, si pasa a "Aceptado", guarda etaMin (=24 por defecto).
import { app, auth, db } from './firebase-config.js';
import {
  doc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// -------- helpers DOM muy tolerantes al HTML actual ----------
function findOrderIdFromDOM() {
  // 1) data-order-id en algún contenedor
  const withData = document.querySelector('[data-order-id]');
  if (withData?.dataset?.orderId) return withData.dataset.orderId;

  // 2) primer texto que empiece con "#"
  const all = Array.from(document.querySelectorAll('body *'))
    .filter(el => el.childNodes?.length && el.childNodes[0].nodeType === Node.TEXT_NODE);

  for (const el of all) {
    const t = (el.textContent || '').trim();
    if (t.startsWith('#') && t.length > 1) return t.slice(1);
  }

  // 3) querystring ?orderId=
  const u = new URL(location.href);
  const q = u.searchParams.get('orderId');
  if (q) return q;

  return null;
}

function findStateSelect() {
  return (
    document.querySelector('#order-state-select') ||
    document.querySelector('select[name="order-state"]') ||
    // fallback: el único select visible en el detalle
    document.querySelector('main select, .content select, .order select')
  );
}

function findUpdateButton() {
  return (
    document.querySelector('#order-state-update') ||
    Array.from(document.querySelectorAll('button'))
      .find(b => /actualizar\s*estado/i.test(b.textContent || ''))
  );
}

function findEtaInput() {
  // si agregas un input/selector para ETA en minutos, lo tomamos
  return document.querySelector('#eta-min') || document.querySelector('input[name="etaMin"]');
}

function toast(msg, type = 'ok') {
  console.log('[orders-state]', type, msg);
  try {
    // si tienes tu propio sistema de alertas, úsalo aquí
    alert(msg);
  } catch { /* no-op */ }
}

// --------------- main ----------------
(async function initOrderState() {
  const orderId = findOrderIdFromDOM();
  const sel = findStateSelect();
  const btn = findUpdateButton();
  if (!orderId || !sel || !btn) {
    console.warn('[orders-state] elementos no encontrados', { orderId, sel, btn });
    return;
  }

  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const estado = (sel.value || '').toLowerCase().trim();
    if (!estado) return;

    const etaInput = findEtaInput();
    let etaMin = parseInt(etaInput?.value || '24', 10);
    if (!Number.isFinite(etaMin) || etaMin <= 0) etaMin = 24;

    btn.disabled = true;
    try {
      const ref = doc(db, 'pedidos', orderId);
      const payload = {
        estado,
        actualizadoEn: serverTimestamp(),
      };
      if (estado === 'aceptado') {
        payload.etaMin = etaMin;           // <- se usa en la notificación del backend
        payload.tiempoEsperaMin = etaMin;  // alias por si el front lo lee con otro nombre
      }
      await updateDoc(ref, payload);

      toast('Estado actualizado correctamente', 'ok');
    } catch (e) {
      console.error(e);
      toast('No se pudo actualizar el estado', 'err');
    } finally {
      btn.disabled = false;
    }
  });
})();
