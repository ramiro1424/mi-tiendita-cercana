// public/js/bootstrap-merchant.js

import { db } from './firebase-config.js';

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  runTransaction,
  collection,
  getDocs,
  limit,
  query,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ============================================================
// TIPOS SOPORTADOS
// ============================================================

const TIPOS_SOPORTADOS = ['tienda', 'licoreria'];


// ============================================================
// NORMALIZACIÓN DE TIPO
// ============================================================

function normalizarTipo(valor) {
  const original = String(valor || 'tienda')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return ['licoreria', 'licores'].includes(original)
    ? 'licoreria'
    : original;
}


// ============================================================
// LOCK LIGERO PARA EVITAR DOBLE SIEMBRA CONCURRENTE
// TTL: 5 minutos
// ============================================================

async function tryLockSeed(uid) {
  const lockRef = doc(
    db,
    'tiendas',
    uid,
    'meta',
    'seedLock'
  );

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(lockRef);

    const now = Date.now();
    const ttlMs = 5 * 60 * 1000;

    if (
      snap.exists() &&
      (now - (snap.data()?.ts || 0)) < ttlMs
    ) {
      // Otro proceso está sembrando todavía.
      return false;
    }

    tx.set(
      lockRef,
      { ts: now },
      { merge: true }
    );

    return true;
  });
}


// Libera el lock.
async function releaseLock(uid) {
  try {
    await setDoc(
      doc(db, 'tiendas', uid, 'meta', 'seedLock'),
      { ts: 0 },
      { merge: true }
    );
  } catch {}
}


// ============================================================
// BOOTSTRAP PRINCIPAL
// ============================================================
/**
 * Bootstrap para todo comerciante nuevo.
 *
 * IMPORTANTE:
 * Este archivo YA NO siembra el catálogo.
 *
 * La siembra real la realiza el trigger
 * seedBaseOnStoreCreate en functions/index.js,
 * que sí conoce el tipo de comerciante y filtra
 * las categorías correctamente.
 *
 * Aquí solo:
 *   - Nos aseguramos de que exista tiendas/{uid}.
 *   - Conservamos el tipoComerciante real.
 *   - Marcamos catalogoSembrado en el documento de la tienda
 *     (no en meta/) para que el panel y el trigger lo vean.
 *   - Usamos el mismo lock para no chocar con el trigger.
 */
export async function bootstrapMerchant(
  uid,
  {
    nombre = 'Mi Tienda',
    email = '',
  } = {}
) {
  if (!uid) return;

  const tiendaRef = doc(db, 'tiendas', uid);

  let tiendaSnap;
  let tiendaData = {};

  try {
    tiendaSnap = await getDoc(tiendaRef);
    tiendaData = tiendaSnap.exists() ? (tiendaSnap.data() || {}) : {};
  } catch (e) {
    console.warn('[bootstrap-merchant] no se pudo leer la tienda:', e);
  }

  const tipo = normalizarTipo(
    tiendaData.tipoComerciante ||
    tiendaData.tipoComercio ||
    tiendaData.tipo ||
    'tienda'
  );

  console.log('[bootstrap-merchant] start', uid, 'tipo=', tipo);


  // ==========================================================
  // 1) UPSERT DE LA TIENDA (SIN PISAR EL TIPO REAL)
  // ==========================================================

  try {
    await setDoc(
      tiendaRef,
      {
        nombre:
          tiendaData.nombre ||
          nombre ||
          (email?.split?.('@')[0] || 'Mi Tienda'),

        activo: true,

        aprobada: true,

        // Conservamos el tipo real
        tipoComerciante: tipo,
        tipoComercio: tipo,

        actualizadoEn: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('[bootstrap-merchant] no se pudo actualizar la tienda:', e);
  }


  // ==========================================================
  // 2) EVITA RESEMBRAR SI YA QUEDÓ MARCADO EN LA TIENDA
  // ==========================================================

  if (tiendaData.catalogoSembrado === true) {
    console.log('[bootstrap-merchant] catálogo ya estaba marcado como sembrado');
    return;
  }


  // ==========================================================
  // 3) SI EL TIPO NO ESTÁ SOPORTADO AÚN, DELEGAR Y SALIR
  // ==========================================================

  if (!TIPOS_SOPORTADOS.includes(tipo)) {
    console.log('[bootstrap-merchant] tipo no soportado aún:', tipo);
    return;
  }


  // ==========================================================
  // 4) LOCK PARA NO CHOCAR CON EL TRIGGER
  // ==========================================================

  let gotLock = false;

  try {
    gotLock = await tryLockSeed(uid);
  } catch (e) {
    console.warn('[bootstrap-merchant] no se pudo obtener lock:', e);
  }

  if (!gotLock) {
    console.log('[bootstrap-merchant] otro proceso está sembrando');
    return;
  }


  try {
    // ========================================================
    // 5) RE-CHECK: por si el trigger terminó mientras tomábamos el lock
    // ========================================================

    try {
      const recheck = await getDoc(tiendaRef);
      if (recheck.exists() && recheck.data()?.catalogoSembrado === true) {
        console.log('[bootstrap-merchant] el trigger ya sembró, skip');
        return;
      }
    } catch (e) {
      console.warn('[bootstrap-merchant] re-check falló:', e);
    }


    // ========================================================
    // 6) SI YA HAY PRODUCTOS EN LA SUBCCOLECCIÓN, MARCAR Y SALIR
    //    (no escribimos productos, solo leemos)
    // ========================================================

    let yaHayProductos = false;

    try {
      const yaHay = await getDocs(
        query(
          collection(db, 'tiendas', uid, 'productos'),
          limit(1)
        )
      );
      yaHayProductos = !yaHay.empty;
    } catch (e) {
      console.warn('[bootstrap-merchant] no se pudo comprobar productos:', e);
    }

    if (yaHayProductos) {
      try {
        await setDoc(
          tiendaRef,
          {
            catalogoSembrado: true,
            seeded: true,
            actualizadoEn: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('[bootstrap-merchant] no se pudo marcar sembrado:', e);
      }

      console.log('[bootstrap-merchant] ya había productos, marcado como sembrado');
      return;
    }


    // ========================================================
    // 7) NO SEMBRAMOS DESDE AQUÍ.
    //    El trigger seedBaseOnStoreCreate lo hará en el backend
    //    cuando esté configurado con el tipo correcto.
    // ========================================================

    console.log(
      '[bootstrap-merchant] delego la siembra al trigger seedBaseOnStoreCreate'
    );

  } finally {
    await releaseLock(uid);
  }
}


// ============================================================
// ATAJO PARA USAR DESPUÉS DEL LOGIN
// ============================================================

/**
 * Pásale:
 * - uid del comerciante
 * - email del usuario
 *
 * El email se utiliza únicamente como respaldo para nombrar
 * la tienda si no se proporciona un nombre.
 */
export async function ensureSeedForCurrentUser(
  uid,
  email
) {
  try {
    await bootstrapMerchant(uid, { email });
  } catch (e) {
    console.warn('[ensureSeedForCurrentUser]', e);
  }
}