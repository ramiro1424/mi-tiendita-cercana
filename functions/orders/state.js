// functions/orders/state.js

import * as functions from "firebase-functions";
import admin, { db, TS } from "../_admin.js";

const REGION = "southamerica-east1";

/* ============================================================================
   ESTADOS OFICIALES DE LOS PEDIDOS
   ----------------------------------------------------------------------------
   Este archivo debe utilizar los mismos estados que maneja index.js.
============================================================================ */

const VALID_STATES = new Set([
  "pendiente",
  "aceptado",
  "en_preparacion",
  "preparando",
  "enviado",
  "entregado",
  "recibido",
  "cancelado",
]);

/* ============================================================================
   TRANSICIONES PERMITIDAS
============================================================================ */

const VALID_TRANSITIONS = {
  pendiente: [
    "aceptado",
    "cancelado",
  ],

  aceptado: [
    "en_preparacion",
    "preparando",
    "cancelado",
  ],

  en_preparacion: [
    "enviado",
    "cancelado",
  ],

  preparando: [
    "enviado",
    "cancelado",
  ],

  enviado: [
    "recibido",
  ],

  entregado: [],

  recibido: [],

  cancelado: [],
};

/* ============================================================================
   TRANSICIÓN DE PEDIDOS
   ----------------------------------------------------------------------------
   Mantiene la Cloud Function existente para no romper referencias actuales.
============================================================================ */

export const transitionOrder = functions
  .region(REGION)
  .https.onCall(async (data, context) => {

    try {

      /* ----------------------------------------------------------------------
         1. AUTENTICACIÓN
      ---------------------------------------------------------------------- */

      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "Requiere login"
        );
      }

      const uid = context.auth.uid;

      /* ----------------------------------------------------------------------
         2. DATOS RECIBIDOS
      ---------------------------------------------------------------------- */

      const orderId = String(
        data?.orderId || ""
      ).trim();

      const nextState = String(
        data?.nextState || ""
      ).trim().toLowerCase();

      const etaFromPayload =
        Number(
          data?.etaMin ??
          data?.tiempo ??
          data?.tiempoEspera ??
          0
        ) || 0;

      if (
        !orderId ||
        !nextState ||
        !VALID_STATES.has(nextState)
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "orderId/nextState inválidos"
        );
      }

      /* ----------------------------------------------------------------------
         3. BUSCAR PEDIDO
      ---------------------------------------------------------------------- */

      const ref = db
        .collection("pedidos")
        .doc(orderId);

      const snap = await ref.get();

      if (!snap.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "Pedido no existe"
        );
      }

      const pedido = snap.data() || {};

      const estadoActual = String(
        pedido.estado || "pendiente"
      )
        .trim()
        .toLowerCase();

      /* ----------------------------------------------------------------------
         4. IDENTIFICAR CLIENTE
      ---------------------------------------------------------------------- */

      const esCliente =
        pedido.uid === uid ||
        pedido.clienteUid === uid ||
        pedido.clienteId === uid;

      /* ----------------------------------------------------------------------
         5. IDENTIFICAR COMERCIANTE
      ---------------------------------------------------------------------- */

      let esComerciante = false;

      /*
       * En algunos pedidos tiendaId corresponde directamente
       * al UID del comerciante.
       */

      if (
        pedido.tiendaId &&
        String(pedido.tiendaId) === String(uid)
      ) {
        esComerciante = true;
      }

      /*
       * En otros pedidos tiendaId corresponde al ID del documento
       * de la tienda. En ese caso verificamos la tienda.
       */

      if (
        !esComerciante &&
        pedido.tiendaId
      ) {

        const tiendaSnap = await db
          .collection("tiendas")
          .doc(String(pedido.tiendaId))
          .get();

        if (tiendaSnap.exists) {

          const tiendaData =
            tiendaSnap.data() || {};

          const tiendaUid =
            tiendaData.uid ||
            tiendaData.comercianteId ||
            tiendaData.ownerId ||
            tiendaData.userId ||
            "";

          if (
            String(tiendaUid) === String(uid)
          ) {
            esComerciante = true;
          }
        }
      }

      /*
       * Compatibilidad adicional:
       * buscar una tienda cuyo campo uid sea el usuario autenticado.
       */

      if (
        !esComerciante &&
        !esCliente
      ) {

        const tiendaQuery = await db
          .collection("tiendas")
          .where(
            "uid",
            "==",
            uid
          )
          .limit(1)
          .get();

        if (!tiendaQuery.empty) {

          const tiendaId =
            tiendaQuery.docs[0].id;

          if (
            String(pedido.tiendaId) ===
            String(tiendaId)
          ) {
            esComerciante = true;
          }
        }
      }

      /* ----------------------------------------------------------------------
         6. AUTORIZACIÓN
         ----------------------------------------------------------------------
         Un usuario que no sea ni el cliente ni el comerciante del pedido
         NO puede modificarlo.
      ---------------------------------------------------------------------- */

      if (
        !esCliente &&
        !esComerciante
      ) {

        throw new functions.https.HttpsError(
          "permission-denied",
          "No tienes autorización para modificar este pedido"
        );
      }

      /* ----------------------------------------------------------------------
         7. CLIENTE
         ----------------------------------------------------------------------
         El cliente únicamente puede confirmar que recibió un pedido.
      ---------------------------------------------------------------------- */

      if (esCliente) {

        if (
          nextState !== "recibido"
        ) {

          throw new functions.https.HttpsError(
            "permission-denied",
            "El cliente solamente puede confirmar la recepción del pedido"
          );
        }

        if (
          estadoActual !== "enviado"
        ) {

          throw new functions.https.HttpsError(
            "failed-precondition",
            "El pedido todavía no está enviado"
          );
        }
      }

      /* ----------------------------------------------------------------------
         8. COMERCIANTE
         ----------------------------------------------------------------------
         El comerciante no puede marcar recibido.
      ---------------------------------------------------------------------- */

      if (esComerciante) {

        if (
          nextState === "recibido"
        ) {

          throw new functions.https.HttpsError(
            "permission-denied",
            "El comerciante no puede confirmar la recepción del cliente"
          );
        }

        const estadosComerciante = new Set([
          "aceptado",
          "en_preparacion",
          "preparando",
          "enviado",
          "entregado",
          "cancelado",
        ]);

        if (
          !estadosComerciante.has(nextState)
        ) {

          throw new functions.https.HttpsError(
            "invalid-argument",
            "Estado no permitido para comerciante"
          );
        }
      }

      /* ----------------------------------------------------------------------
         9. VALIDAR TRANSICIÓN
      ---------------------------------------------------------------------- */

      const estadosPermitidos =
        VALID_TRANSITIONS[estadoActual] || [];

      /*
       * Permitimos conservar el mismo estado para evitar que una doble
       * pulsación o una actualización repetida rompa la operación.
       */

      if (
        nextState !== estadoActual &&
        !estadosPermitidos.includes(nextState)
      ) {

        throw new functions.https.HttpsError(
          "failed-precondition",
          `No se puede pasar de "${estadoActual}" a "${nextState}"`
        );
      }

      /* ----------------------------------------------------------------------
         10. PREPARAR ACTUALIZACIÓN
      ---------------------------------------------------------------------- */

      const updates = {

        estado: nextState,

        actualizadoEn: TS(),

      };

      /* ----------------------------------------------------------------------
         11. TIEMPO ESTIMADO
      ---------------------------------------------------------------------- */

      if (
        nextState === "aceptado" ||
        nextState === "en_preparacion" ||
        nextState === "preparando"
      ) {

        if (
          etaFromPayload > 0
        ) {

          updates.etaMin =
            etaFromPayload;

          updates.tiempoEsperaMin =
            etaFromPayload;
        }
      }

      /* ----------------------------------------------------------------------
         12. FECHA DE ENVÍO
      ---------------------------------------------------------------------- */

      if (
        nextState === "enviado" &&
        estadoActual !== "enviado"
      ) {

        updates.enviadoEn = TS();
      }

      /* ----------------------------------------------------------------------
         13. CONFIRMACIÓN DEL CLIENTE
      ---------------------------------------------------------------------- */

      if (
        nextState === "recibido" &&
        estadoActual === "enviado"
      ) {

        updates.recibidoEn = TS();

        updates.clienteConfirmoRecibido = true;

        updates.clienteConfirmado = true;

        updates.recibidoPor = uid;
      }

      /* ----------------------------------------------------------------------
         14. CANCELACIÓN
      ---------------------------------------------------------------------- */

      if (
        nextState === "cancelado"
      ) {

        updates.canceladoEn = TS();

        updates.canceladoPor = uid;
      }

      /* ----------------------------------------------------------------------
         15. GUARDAR
      ---------------------------------------------------------------------- */

      await ref.set(
        updates,
        {
          merge: true
        }
      );

      /* ----------------------------------------------------------------------
         16. RESPUESTA
      ---------------------------------------------------------------------- */

      console.log(
        "✅ [transitionOrder]",
        {
          orderId,
          estadoAnterior: estadoActual,
          nextState,
          uid,
          esCliente,
          esComerciante
        }
      );

      return {

        ok: true,

        orderId,

        previousState:
          estadoActual,

        nextState,

        etaMin:
          updates.etaMin ||
          null,

        clienteConfirmoRecibido:
          updates.clienteConfirmoRecibido ||
          false,

      };

    } catch (error) {

      /*
       * Si ya es un HttpsError, lo devolvemos sin convertirlo
       * en un error interno.
       */

      if (
        error instanceof
        functions.https.HttpsError
      ) {

        throw error;
      }

      console.error(
        "❌ [transitionOrder] Error:",
        error
      );

      throw new functions.https.HttpsError(
        "internal",
        "Error interno al cambiar el estado del pedido"
      );
    }
  });