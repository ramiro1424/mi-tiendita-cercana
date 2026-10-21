// functions/orders/state.js
import admin, { db, TS } from "../_admin.js";        // ✅ usa el bootstrap
import * as functions from "firebase-functions";     // ✅

export const STATES = {
  PENDIENTE: "pendiente",
  ACEPTADO: "aceptado",
  EN_PREPARACION: "en_preparacion",
  LISTO: "listo",
  ENTREGADO: "entregado",
  CANCELADO: "cancelado",
  EXPIRADO: "expirado",
};

export const VALID_TRANSITIONS = {
  [STATES.PENDIENTE]:      [STATES.ACEPTADO, STATES.CANCELADO, STATES.EXPIRADO],
  [STATES.ACEPTADO]:       [STATES.EN_PREPARACION, STATES.CANCELADO],
  [STATES.EN_PREPARACION]: [STATES.LISTO, STATES.CANCELADO],
  [STATES.LISTO]:          [STATES.ENTREGADO, STATES.CANCELADO],
  [STATES.ENTREGADO]:      [],
  [STATES.CANCELADO]:      [],
  [STATES.EXPIRADO]:       [],
};

function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const allowed = (VALID_TRANSITIONS[from] || []).join(", ") || "(ninguna)";
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Transición inválida: ${from} → ${to}. Permitidas: ${allowed}`
    );
  }
}

// httpsCallable('transitionOrder')({ pedidoId, next, reason?, actor? })
export const transitionOrder = functions.https.onCall(async (data, context) => {
  const { auth } = context;
  const { pedidoId, next, reason = "", actor = "sistema" } = data || {};

  if (!auth) throw new functions.https.HttpsError("unauthenticated", "No autenticado");
  if (!pedidoId || !next) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan pedidoId y next");
  }

  const ref = db.collection("pedidos").doc(String(pedidoId));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", `Pedido no encontrado: ${pedidoId}`);
  }

  const pedido = snap.data() || {};
  const from = pedido.estado || STATES.PENDIENTE;
  assertTransition(from, next);

  const historyEntry = {
    from,
    to: next,
    at: TS(),
    actor,
    reason: String(reason || ""),
    byUid: auth.uid || null,
  };

  await ref.update({
    estado: next,
    updatedAt: TS(),
    history: admin.firestore.FieldValue.arrayUnion(historyEntry),
  });

  return { ok: true, pedidoId, from, next };
});
