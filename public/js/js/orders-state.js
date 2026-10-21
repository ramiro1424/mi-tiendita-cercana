// public/js/orders-state.js
import { getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

const app = getApp();              // ya estás inicializando el app en firebase-config.js
const functions = getFunctions(app);

export async function moverPedido(pedidoId, next, reason='') {
  const call = httpsCallable(functions, 'transitionOrder');
  const res = await call({ pedidoId, next, reason, actor: 'comerciante' });
  return res.data; // { ok: true }
}

// --- wiring rápido a botones con data-attrs ---
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-transition]');
  if (!btn) return;

  const pedidoId = btn.getAttribute('data-pedido');
  const next = btn.getAttribute('data-transition');
  if (!pedidoId || !next) return;

  btn.disabled = true;
  try {
    await moverPedido(pedidoId, next);
    // aquí refresca la UI/lista si hace falta
    console.log(`Pedido ${pedidoId} → ${next} OK`);
  } catch (err) {
    alert(err.message || 'No se pudo cambiar el estado');
  } finally {
    btn.disabled = false;
  }
});
