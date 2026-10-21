// public/js/catalogo-base.js
// Provee:
//  - actualizarPreciosEstandarMes(db, uid, opts)
//  - sincronizarImagenesDesdeCatalogo(db, uid)
//
// NOTA:
// La siembra del catálogo YA NO se realiza desde este archivo.
// La siembra oficial está centralizada en:
//   public/js/catalogo-adapter.js
//
// Para tiendas:
//   productos_base → 465 productos
//
// Para otros tipos de comercio:
//   la lógica correspondiente se maneja desde la arquitectura
//   central de catálogo.

/* ============================================================
   IMPORTS
   ============================================================ */

import {
  collection,
  doc,
  getDocs,
  query,
  orderBy,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


/* ============================================================
   HELPERS INTERNOS
   ============================================================ */

async function commitChunks(db, writes) {
  // Firestore permite máximo 500 operaciones por batch.
  // Usamos 400 como margen de seguridad.
  const SIZE = 400;

  for (let i = 0; i < writes.length; i += SIZE) {
    const batch = writeBatch(db);

    const slice = writes.slice(i, i + SIZE);

    slice.forEach(({ ref, data, merge = true }) => {
      batch.set(ref, data, { merge });
    });

    await batch.commit();
  }
}


const toNum = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};


function roundToStep(v, step = 50) {
  if (!step) return Math.round(v);

  return Math.round(v / step) * step;
}


/* ============================================================
   1) ACTUALIZACIÓN MENSUAL DE PRECIOS
   ============================================================ */

/**
 * Recorre:
 *
 *   /tiendas/{uid}/productos
 *
 * y ajusta el campo `precio`.
 *
 * Modos de actualización, en este orden:
 *
 * 1) Si opts.tabla.productos[id] existe:
 *      usa ese precio EXACTO.
 *
 * 2) Si no existe precio fijo y hay:
 *
 *      opts.tabla.factoresCategoria[categoria]
 *
 *    aplica ese factor.
 *
 * 3) Si no existe ninguno de los anteriores:
 *
 *      < $50       => +3%
 *      $50–$200    => +2%
 *      > $200      => +1%
 *
 * Además:
 *
 * - opts.redondear
 *     default: true
 *
 * - opts.pasoRedondeo
 *     default: 50
 *
 * Esta función NO sincroniza al root.
 *
 * El espejo al root se realiza mediante:
 *
 *   syncAllSubToRoot
 *
 *
 * @param {*} db
 * @param {string} uid
 * @param {object} opts
 *
 * Ejemplo:
 *
 * opts = {
 *   tabla: {
 *     yyyymm: '202509',
 *
 *     productos: {
 *       'id-prod-1': 5400,
 *       'id-prod-2': 4300
 *     },
 *
 *     factoresCategoria: {
 *       verduras: 1.03,
 *       abarrotes: 1.02
 *     }
 *   },
 *
 *   redondear: true,
 *   pasoRedondeo: 50
 * }
 */

export async function actualizarPreciosEstandarMes(
  db,
  uid,
  opts = {}
) {
  if (!db || !uid) {
    throw new Error(
      'actualizarPreciosEstandarMes: parámetros inválidos'
    );
  }

  const {
    tabla = {},
    redondear = true,
    pasoRedondeo = 50
  } = opts || {};

  const preciosFijos = tabla.productos || {};

  const factoresCat = tabla.factoresCategoria || {};


  /* ==========================================================
     LEER PRODUCTOS DE LA TIENDA
     ========================================================== */

  const qref = query(
    collection(
      db,
      'tiendas',
      uid,
      'productos'
    ),
    orderBy('nombre')
  );

  const snap = await getDocs(qref);

  if (snap.empty) {
    return 0;
  }


  /* ==========================================================
     PREPARAR ACTUALIZACIONES
     ========================================================== */

  const writes = [];

  snap.forEach((d) => {
    const p = d.data() || {};

    const id = d.id;

    const categoria = (
      p.categoria || 'otros'
    ).toString();


    let nuevoPrecio;


    /* ========================================================
       1) PRECIO FIJO POR ID
       ======================================================== */

    if (id in preciosFijos) {
      nuevoPrecio = toNum(
        preciosFijos[id]
      );


    /* ========================================================
       2) FACTOR POR CATEGORÍA
       ======================================================== */

    } else if (categoria in factoresCat) {

      const factor =
        Number(
          factoresCat[categoria]
        ) || 1;

      nuevoPrecio =
        toNum(p.precio || 0) * factor;


    /* ========================================================
       3) REGLAS ESTÁNDAR
       ======================================================== */

    } else {

      const precio =
        toNum(p.precio || 0);

      let factor = 1;

      if (precio < 50) {

        factor = 1.03;

      } else if (precio <= 200) {

        factor = 1.02;

      } else {

        factor = 1.01;
      }

      nuevoPrecio =
        precio * factor;
    }


    /* ========================================================
       VALIDAR PRECIO
       ======================================================== */

    if (!Number.isFinite(nuevoPrecio)) {
      return;
    }


    /* ========================================================
       REDONDEO
       ======================================================== */

    const finalPrecio = redondear
      ? roundToStep(
          Math.max(0, nuevoPrecio),
          pasoRedondeo
        )
      : Math.max(
          0,
          Math.round(nuevoPrecio)
        );


    /* ========================================================
       REFERENCIA
       ======================================================== */

    const ref = doc(
      db,
      'tiendas',
      uid,
      'productos',
      id
    );


    writes.push({
      ref,

      data: {
        precio: finalPrecio,
        actualizadoEn: serverTimestamp()
      },

      merge: true
    });
  });


  /* ==========================================================
     ESCRIBIR EN LOTES
     ========================================================== */

  await commitChunks(
    db,
    writes
  );


  return writes.length;
}


/* ============================================================
   2) SINCRONIZAR IMÁGENES DESDE /catalogo
   ============================================================ */

/**
 * Sincroniza el campo `imagen` de:
 *
 *   /catalogo
 *
 * hacia:
 *
 *   /tiendas/{uid}/productos
 *
 *
 * REGLA:
 *
 * Si el producto de la tienda YA tiene imagen,
 * se respeta la imagen existente.
 *
 * Si NO tiene imagen y existe una imagen en /catalogo,
 * se copia.
 *
 *
 * IMPORTANTE:
 *
 * Esta función es solamente para sincronización de imágenes.
 *
 * NO realiza la siembra del catálogo.
 */

export async function sincronizarImagenesDesdeCatalogo(
  db,
  uid
) {
  if (!db || !uid) {
    throw new Error(
      'sincronizarImagenesDesdeCatalogo: parámetros inválidos'
    );
  }


  /* ==========================================================
     1) LEER CATÁLOGO GLOBAL
     ========================================================== */

  const catQ = query(
    collection(
      db,
      'catalogo'
    ),
    orderBy('nombre')
  );

  const catSnap =
    await getDocs(catQ);


  if (catSnap.empty) {

    console.warn(
      'sincronizarImagenesDesdeCatalogo: /catalogo está vacío'
    );

    return 0;
  }


  /* ==========================================================
     CREAR MAPA DE IMÁGENES
     ========================================================== */

  const mapaImagenes =
    new Map();


  catSnap.forEach((d) => {

    const data =
      d.data() || {};

    const img =
      data.imagen || '';

    mapaImagenes.set(
      d.id,
      img
    );
  });


  /* ==========================================================
     2) LEER PRODUCTOS DE LA TIENDA
     ========================================================== */

  const prodQ = query(
    collection(
      db,
      'tiendas',
      uid,
      'productos'
    ),
    orderBy('nombre')
  );

  const prodSnap =
    await getDocs(prodQ);


  if (prodSnap.empty) {

    console.warn(
      `sincronizarImagenesDesdeCatalogo: la tienda ${uid} no tiene productos`
    );

    return 0;
  }


  /* ==========================================================
     PREPARAR ACTUALIZACIONES
     ========================================================== */

  const writes = [];


  prodSnap.forEach((d) => {

    const p =
      d.data() || {};

    const id =
      d.id;


    const imgCatalogo =
      mapaImagenes.get(id) || '';


    const imagenActual =
      p.imagen || '';


    /*
     * Si ya existe una imagen del producto,
     * la conservamos.
     *
     * Si no existe,
     * usamos la imagen del catálogo.
     */

    const nuevaImagen =
      imagenActual ||
      imgCatalogo ||
      '';


    /* ========================================================
       SI NO HAY CAMBIO, NO ESCRIBIR
       ======================================================== */

    if (
      nuevaImagen === imagenActual
    ) {
      return;
    }


    const ref = doc(
      db,
      'tiendas',
      uid,
      'productos',
      id
    );


    writes.push({

      ref,

      data: {
        imagen: nuevaImagen,
        actualizadoEn: serverTimestamp()
      },

      merge: true

    });

  });


  /* ==========================================================
     NO HAY NADA QUE ACTUALIZAR
     ========================================================== */

  if (!writes.length) {

    console.log(
      `sincronizarImagenesDesdeCatalogo: nada que actualizar para la tienda ${uid}`
    );

    return 0;
  }


  /* ==========================================================
     ESCRIBIR CAMBIOS
     ========================================================== */

  await commitChunks(
    db,
    writes
  );


  console.log(
    `sincronizarImagenesDesdeCatalogo: actualizados ${writes.length} productos en tienda ${uid}`
  );


  return writes.length;
}