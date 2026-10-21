// public/js/catalogo-adapter.js
// Catálogo base -> tienda y root (auto-detecta productos_base o catalogo)
// Agrega banderas de importación: importado, origen, baseCollection, importadoEn

import { db as _db } from './firebase-config.js';
import {
  collection, doc, getDocs, getDoc, query, where, writeBatch,
  serverTimestamp, limit, orderBy, startAt, endAt
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* --------------------------------- Utils --------------------------------- */

const useDb = (dbMaybe) => dbMaybe || _db;
const chunk = (arr, n = 400) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const TS = () => serverTimestamp();

const PLACEHOLDER = 'https://placehold.co/600x400?text=Producto';

const nowYYYYMM = () => {
  const d = new Date();
  return String(d.getFullYear()) + String(d.getMonth()+1).padStart(2,'0');
};

// 🔒 Firestore no acepta undefined
const sanitize = (obj) => {
  const out = {};
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// Normaliza unidades
function normalizeUnit(s = 'unidad') {
  s = (s || 'unidad').toString().toLowerCase();
  if (['u','und','unit','unidad'].includes(s)) return 'unidad';
  if (['kg','kilo','kilogramo','kilogramos'].includes(s)) return 'kg';
  if (['g','gr','gramo','gramos'].includes(s)) return 'g';
  if (['l','lt','litro','litros'].includes(s)) return 'l';
  if (['ml'].includes(s)) return 'ml';
  if (['paquete','pack'].includes(s)) return 'paquete';
  return s;
}

/* --------------- Auto-detección de colección base y mapeo ---------------- */

const BASE_CANDIDATES = ['productos_base', 'catalogo'];

async function pickBaseCollection(db) {
  for (const name of BASE_CANDIDATES) {
    try {
      const snap = await getDocs(query(collection(db, name), limit(1)));
      if (!snap.empty) return name;
    } catch {}
  }
  return 'catalogo';
}

// Mapea un doc de productos_base O catalogo -> shape unificado base
function mapRawBase(id, raw = {}) {
  const nombre = raw.nombre || raw.nombreBase || id || 'Producto';
  const imagen = raw.imagen || raw.imagenUrl || raw.imagenURL || PLACEHOLDER;

  const categoria = (raw.categoria || raw.categoriaBase || 'otros').toString().toLowerCase();
  const unidadBase = normalizeUnit(raw.unidadBase || raw.unidad || 'unidad');

  const precio = Number(raw.precio ?? raw.precioSugerido ?? 0) || 0;
  const inventario = Number(raw.inventario ?? raw.stock ?? 10) || 0;
  const activo = (raw.activo ?? true) === true;

  const descripcion = raw.descripcion || raw.nombreBase || raw.variante || '';
  const marca = raw.marca || '';

  return {
    id, nombre, categoria, imagen, unidadBase, precio, inventario, activo, descripcion, marca,
    nombreLower: (nombre || '').toLowerCase()
  };
}

/* ---------------------- Normalización hacia la tienda --------------------- */
const normalizeSub = (
  p,
  { activoPorDefecto = false, origen = 'manual', baseCollection = null } = {}
) => ({
  catalogoId: p.catalogoId || p.id || null,
  nombre: p.nombre || 'Producto',
  nombreLower: (p.nombre || 'Producto').toLowerCase(),
  categoria: (p.categoria || 'otros').toString().toLowerCase(),
  imagen: p.imagen || '',
  unidadBase: normalizeUnit(p.unidadBase || 'unidad'),
  precio: Number(p.precio ?? p.precioSugerido ?? 0) || 0,
  inventario: Number(p.inventario ?? 0) || 0,
  activo: (p.activo ?? activoPorDefecto) === true,
  creadoEn: p.creadoEn || TS(),
  actualizadoEn: TS(),

  descripcion: p.descripcion || '',
  marca: p.marca || '',

  importado: p.importado === true ? true : (origen !== 'manual'),
  origen,
  baseCollection,
  importadoEn: p.importadoEn ?? (origen !== 'manual' ? TS() : null) // nunca undefined
});

/* -------------------- Búsqueda simple en catálogo base -------------------- */
export async function buscarCatalogo({ term = '', categoria = null, max = 100 } = {}) {
  const db = useDb();
  const baseName = await pickBaseCollection(db);
  const col = collection(db, baseName);

  let snap;

  if (categoria) {
    try {
      const q1 = query(col, where('categoria', '==', categoria), limit(Math.max(max, 100)));
      snap = await getDocs(q1);
    } catch {
      snap = await getDocs(query(col, limit(Math.max(max, 200))));
    }
  } else if (term) {
    try {
      const t = term.toString();
      const q2 = query(col, orderBy('nombre'), startAt(t), endAt(t + '\uf8ff'), limit(Math.max(max, 100)));
      snap = await getDocs(q2);
    } catch {
      snap = await getDocs(query(col, limit(Math.max(max, 200))));
    }
  } else {
    snap = await getDocs(query(col, limit(Math.max(max, 200))));
  }

  let docs = snap.docs.map(d => mapRawBase(d.id, d.data()));

  if (term) {
    const t = term.toString().toLowerCase();
    docs = docs.filter(p => p.nombreLower?.includes(t));
  }
  if (categoria) {
    const cat = categoria.toString().toLowerCase();
    docs = docs.filter(p => p.categoria === cat);
  }

  return docs.slice(0, max);
}

/* -------------------- Sembrar por categoría (subcolección) ---------------- */
export async function sembrarCategoria(uid, categoria, { activar = false } = {}) {
  if (!uid || !categoria) throw new Error('Datos incompletos');
  try {
    const db = useDb();
    const baseName = await pickBaseCollection(db);
    const qref = query(collection(db, baseName), where('categoria', '==', categoria), limit(200));
    const snap = await getDocs(qref);
    if (snap.empty) return 0;

    const docs = snap.docs.map(d => mapRawBase(d.id, d.data()));
    let total = 0;

    for (const slice of chunk(docs, 400)) {
      const batch = writeBatch(db);
      slice.forEach(base => {
        // Subcolección
        const subRef = doc(db, 'tiendas', uid, 'productos', base.id);
        const subData = normalizeSub(base, { activoPorDefecto: activar, origen: 'catalogo_base', baseCollection: baseName });
        batch.set(subRef, sanitize(subData), { merge: true });

        // Raíz con ID compuesto uid__productoId
        const rootRef = doc(db, 'productos', `${uid}__${base.id}`);
        batch.set(rootRef, sanitize({
          tiendaId: uid,
          nombre: base.nombre,
          nombreLower: base.nombre.toLowerCase(),
          precio: Number(base.precio)||0,
          categoria: base.categoria,
          inventario: Number(base.inventario)||0,
          imagen: base.imagen || '',
          descripcion: base.descripcion || '',
          unidadBase: base.unidadBase || 'unidad',
          activo: true,
          importado: true,
          origen: 'catalogo_base',
          baseCollection: baseName,
          importadoEn: TS(),
          creadoEn: TS(), actualizadoEn: TS()
        }), { merge: true });

        total++;
      });
      await batch.commit();
    }
    return total;
  } catch (err) {
    console.error('sembrarCategoria error:', err);
    return 0;
  }
}

/* ------------------ Agregar selección del modal (por IDs) ----------------- */
export async function agregarDesdeCatalogo(uid, ids = [], { activar = false } = {}) {
  if (!uid || !ids.length) return 0;
  try {
    const db = useDb();
    const baseName = await pickBaseCollection(db);

    let count = 0;
    for (const slice of chunk(ids, 60)) {
      const batch = writeBatch(db);
      for (const id of slice) {
        const d = await getDoc(doc(db, baseName, id));
        if (!d.exists()) continue;
        const base = mapRawBase(id, d.data());

        const subData = normalizeSub(base, { activoPorDefecto: activar, origen: 'catalogo_base', baseCollection: baseName });
        batch.set(doc(db, 'tiendas', uid, 'productos', id), sanitize(subData), { merge: true });

        batch.set(doc(db, 'productos', `${uid}__${id}`), sanitize({
          tiendaId: uid,
          nombre: base.nombre,
          nombreLower: base.nombre.toLowerCase(),
          precio: Number(base.precio)||0,
          categoria: base.categoria,
          inventario: Number(base.inventario)||0,
          imagen: base.imagen || '',
          descripcion: base.descripcion || '',
          unidadBase: base.unidadBase || 'unidad',
          activo: true,
          importado: true,
          origen: 'catalogo_base',
          baseCollection: baseName,
          importadoEn: TS(),
          creadoEn: TS(), actualizadoEn: TS()
        }), { merge: true });

        count++;
      }
      await batch.commit();
    }
    return count;
  } catch (err) {
    console.error('agregarDesdeCatalogo error:', err);
    return 0;
  }
}

/* --------- Generar catálogo base COMPLETO en subcolección de la tienda --------- */
export async function generarCatalogoBase(dbMaybe, uid, { max = 1000, activar = true } = {}) {
  const db = useDb(dbMaybe);

  if (!uid) throw new Error('uid requerido');

  try {
    const baseName = await pickBaseCollection(db);

    // 🔥 Cargar TODO el catálogo base, no solo 300 productos
    const snap = await getDocs(
      query(collection(db, baseName), limit(max))
    );

    const docs = snap.docs.map(d => mapRawBase(d.id, d.data()));

    if (!docs.length) return 0;

    let total = 0;

    for (const slice of chunk(docs, 400)) {
      const batch = writeBatch(db);

      slice.forEach(base => {

        // ============================================================
        // SUBCOLECCIÓN
        // tiendas/{uid}/productos/{productoId}
        // ============================================================
        const subRef = doc(
          db,
          'tiendas',
          uid,
          'productos',
          base.id
        );

        const subData = normalizeSub(base, {
          activoPorDefecto: activar,
          origen: 'catalogo_base',
          baseCollection: baseName
        });

        batch.set(
          subRef,
          sanitize(subData),
          { merge: true }
        );


        // ============================================================
        // COLECCIÓN RAÍZ
        // productos/{uid}__{productoId}
        // ============================================================
        const rootRef = doc(
          db,
          'productos',
          `${uid}__${base.id}`
        );

        batch.set(
          rootRef,
          sanitize({
            tiendaId: uid,
            nombre: base.nombre,
            nombreLower: base.nombre.toLowerCase(),
            precio: Number(base.precio) || 0,
            categoria: base.categoria,
            inventario: Number(base.inventario) || 0,
            imagen: base.imagen || '',
            descripcion: base.descripcion || '',
            unidadBase: base.unidadBase || 'unidad',
            activo: true,
            importado: true,
            origen: 'catalogo_base',
            baseCollection: baseName,
            importadoEn: TS(),
            creadoEn: TS(),
            actualizadoEn: TS()
          }),
          { merge: true }
        );

        total++;
      });

      await batch.commit();
    }

    console.log(`✅ Catálogo base completo cargado para ${uid}: ${total} productos`);

    return total;

  } catch (e) {
    console.error('generarCatalogoBase error:', e);
    return 0;
  }
}

/* ------------------- Sync subcolección -> colección raíz ------------------ */
export async function syncAllSubToRoot(uid, dbMaybe) {
  const db = useDb(dbMaybe);
  if (!uid) throw new Error('uid requerido');
  try {
    const subSnap = await getDocs(collection(db, 'tiendas', uid, 'productos'));
    if (subSnap.empty) return 0;

    const docs = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let total = 0;

    for (const slice of chunk(docs, 400)) {
      const batch = writeBatch(db);
      slice.forEach(p => {
        batch.set(doc(db, 'productos', `${uid}__${p.id}`), sanitize({
          tiendaId: uid,
          nombre: p.nombre || '',
          nombreLower: (p.nombre || '').toLowerCase(),
          precio: Number(p.precio) || 0,
          categoria: p.categoria || 'otros',
          inventario: Number(p.inventario) || 0,
          imagen: p.imagen || '',
          descripcion: p.descripcion || '',
          unidadBase: p.unidadBase || 'unidad',
          activo: p.activo !== false,
          importado: p.importado === true ? true : undefined,
          origen: p.origen || undefined,
          baseCollection: p.baseCollection || undefined,
          importadoEn: p.importadoEn ?? null,
          creadoEn: p.creadoEn || TS(),
          actualizadoEn: TS()
        }), { merge: true });
      });
      await batch.commit();
      total += slice.length;
    }
    return total;
  } catch (e) {
    console.error('syncAllSubToRoot error:', e);
    return 0;
  }
}

export async function syncIdsToRoot(uid, ids = [], dbMaybe) {
  const db = useDb(dbMaybe);
  if (!uid || !ids.length) return 0;
  try {
    let total = 0;
    for (const slice of chunk(ids, 400)) {
      const batch = writeBatch(db);
      for (const id of slice) {
        const s = await getDoc(doc(db, 'tiendas', uid, 'productos', id));
        if (!s.exists()) continue;
        const p = s.data();
        batch.set(doc(db, 'productos', `${uid}__${id}`), sanitize({
          tiendaId: uid,
          nombre: p.nombre || '',
          nombreLower: (p.nombre || '').toLowerCase(),
          precio: Number(p.precio) || 0,
          categoria: p.categoria || 'otros',
          inventario: Number(p.inventario) || 0,
          imagen: p.imagen || '',
          descripcion: p.descripcion || '',
          unidadBase: p.unidadBase || 'unidad',
          activo: p.activo !== false,
          importado: p.importado === true ? true : undefined,
          origen: p.origen || undefined,
          baseCollection: p.baseCollection || undefined,
          importadoEn: p.importadoEn ?? null,
          creadoEn: p.creadoEn || TS(),
          actualizadoEn: TS()
        }), { merge: true });
        total++;
      }
      await batch.commit();
    }
    return total;
  } catch (e) {
    console.error('syncIdsToRoot error:', e);
    return 0;
  }
}

export async function syncCategoryToRoot(uid, categoria, dbMaybe) {
  const db = useDb(dbMaybe);
  if (!uid || !categoria) return 0;
  try {
    const subSnap = await getDocs(query(collection(db, 'tiendas', uid, 'productos'), where('categoria', '==', categoria)));
    if (subSnap.empty) return 0;

    let total = 0;
    for (const slice of chunk(subSnap.docs, 400)) {
      const batch = writeBatch(db);
      slice.forEach(d => {
        const p = d.data();
        batch.set(doc(db, 'productos', `${uid}__${d.id}`), sanitize({
          tiendaId: uid,
          nombre: p.nombre || '',
          nombreLower: (p.nombre || '').toLowerCase(),
          precio: Number(p.precio) || 0,
          categoria: p.categoria || 'otros',
          inventario: Number(p.inventario) || 0,
          imagen: p.imagen || '',
          descripcion: p.descripcion || '',
          unidadBase: p.unidadBase || 'unidad',
          activo: p.activo !== false,
          importado: p.importado === true ? true : undefined,
          origen: p.origen || undefined,
          baseCollection: p.baseCollection || undefined,
          importadoEn: p.importadoEn ?? null,
          creadoEn: p.creadoEn || TS(),
          actualizadoEn: TS()
        }), { merge: true });
        total++;
      });
      await batch.commit();
    }
    return total;
  } catch (e) {
    console.error('syncCategoryToRoot error:', e);
    return 0;
  }
}


/* ------------------- Actualización mensual de precios --------------------- */
/**
 * Actualiza precios del mes aplicando:
 * - overrides por producto (tabla.productos[id] = precioNuevo)
 * - multiplicadores por categoría (tabla.factoresCategoria[categoria] = factor)
 * - factor global (opts.factor, por defecto 1)
 * - redondeo (opts.redondear, por defecto true)
 *
 * Escribe en subcolección tiendas/{uid}/productos y en raíz productos/{uid__id}.
 */
export async function actualizarPreciosEstandarMes(dbMaybe, uid, opts = {}) {
  const db = useDb(dbMaybe);
  if (!uid) throw new Error('uid requerido');

  const {
    factor = 1,
    redondear = true,
    tabla = null,
    yyyymm = nowYYYYMM(),
  } = opts || {};

  // Estructura de control (si no te pasan tabla, sólo aplica el factor global)
  const TABLE = tabla || { yyyymm, productos: {}, factoresCategoria: {} };
  const overrides = TABLE.productos || {};                 // { idProducto: precioFijo }
  const factCat   = TABLE.factoresCategoria || {};         // { categoria: factor }

  try {
    const subSnap = await getDocs(collection(db, 'tiendas', uid, 'productos'));
    if (subSnap.empty) return 0;

    const productos = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let total = 0;

    for (const slice of chunk(productos, 400)) {
      const batch = writeBatch(db);

      slice.forEach(p => {
        const id = p.id;
        const categoria = (p.categoria || 'otros').toString().toLowerCase();
        const precioActual = Number(p.precio) || 0;

        let nuevo;

        // 1) override por producto si existe
        if (Object.prototype.hasOwnProperty.call(overrides, id)) {
          nuevo = Number(overrides[id]) || precioActual;

        // 2) si no, aplica factor global * factor por categoría (si existe)
        } else {
          const fCat = Number(factCat[categoria]) || 1;
          nuevo = precioActual * Number(factor) * fCat;
          if (!Number.isFinite(nuevo) || nuevo < 0) nuevo = precioActual;
          if (redondear) nuevo = Math.round(nuevo);
        }

        // Subcolección
        batch.set(
          doc(db, 'tiendas', uid, 'productos', id),
          sanitize({ precio: nuevo, actualizadoEn: TS() }),
          { merge: true }
        );

        // Raíz
        batch.set(
          doc(db, 'productos', `${uid}__${id}`),
          sanitize({
            tiendaId: uid,
            precio: nuevo,
            actualizadoEn: TS(),
            // conservar metadatos si ya estaban
            importado: p.importado === true ? true : undefined,
            origen: p.origen || undefined,
            baseCollection: p.baseCollection || undefined,
            importadoEn: p.importadoEn ?? null,
          }),
          { merge: true }
        );

        total++;
      });

      await batch.commit();
    }

    return total;
  } catch (e) {
    console.warn('actualizarPreciosEstandarMes error:', e);
    return 0;
  }
}


/**
 * 🔥 OBTENER PRODUCTOS DE LICORERÍA
 * Busca en catalogos/licoreria/productos
 */
export async function obtenerCatalogoLicoreria({ term = '', max = 100 } = {}) {
  const db = useDb();
  const col = collection(db, 'catalogos', 'licoreria', 'productos');
  
  let snap;
  try {
    const q = query(col, limit(max));
    snap = await getDocs(q);
  } catch (e) {
    console.warn('Error obteniendo catálogo de licorería:', e);
    return [];
  }

  const docs = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  if (term) {
    const t = term.toString().toLowerCase();
    return docs.filter(p => (p.nombre || '').toLowerCase().includes(t));
  }

  return docs;
}

/* -------------------- Sembrado automático al registrarse ------------------ */
/**
 * Sembrar catálogo base para una tienda nueva.
 * Llama esto justo después de crear el doc tiendas/{uid} (tipo 'tienda').
 */
export async function seedNewStore(
  uid,
  {
    tipoComerciante = 'tienda',
    max = 1000,
    activar = true
  } = {}
) {
    if (!uid) throw new Error('uid requerido');

  const db = useDb();

  try {

    // =========================
    // TIENDA NORMAL
    // =========================
    if (tipoComerciante === 'tienda') {

      const inserted = await generarCatalogoBase(
        db,
        uid,
        { max, activar }
      );

      if (inserted > 0) {
        await syncAllSubToRoot(uid, db);
      }

      console.log('✅ Catálogo TIENDA cargado:', inserted);

      return inserted;
    }

    // =========================
    // LICORERÍA
    // =========================
    if (tipoComerciante === 'licoreria') {

      let inserted = 0;

      // 🔥 PRIMERO INTENTA DESDE catalogos/licoreria/productos
      try {
        const productosLicoreria = await obtenerCatalogoLicoreria({ max: 200 });
        
        if (productosLicoreria.length > 0) {
          for (const slice of chunk(productosLicoreria, 400)) {
            const batch = writeBatch(db);
            slice.forEach(data => {
              const id = data.id;
              
              // Subcolección
              const subRef = doc(db, 'tiendas', uid, 'productos', id);
              batch.set(subRef, sanitize({
                nombre: data.nombre || 'Producto',
                nombreLower: (data.nombre || 'Producto').toLowerCase(),
                categoria: data.categoria || 'licores',
                imagen: data.imagen || data.imagenUrl || '',
                unidadBase: data.unidadBase || 'unidad',
                precio: Number(data.precio) || 0,
                inventario: Number(data.inventario) || 0,
                activo: true,
                creadoEn: TS(),
                actualizadoEn: TS(),
                descripcion: data.descripcion || '',
                marca: data.marca || '',
                importado: true,
                origen: 'catalogo_licoreria',
                baseCollection: 'catalogos/licoreria/productos',
                importadoEn: TS()
              }), { merge: true });

              // Raíz
              batch.set(doc(db, 'productos', `${uid}__${id}`), sanitize({
                tiendaId: uid,
                nombre: data.nombre || 'Producto',
                nombreLower: (data.nombre || 'Producto').toLowerCase(),
                precio: Number(data.precio) || 0,
                categoria: data.categoria || 'licores',
                inventario: Number(data.inventario) || 0,
                imagen: data.imagen || data.imagenUrl || '',
                descripcion: data.descripcion || '',
                unidadBase: data.unidadBase || 'unidad',
                activo: true,
                importado: true,
                origen: 'catalogo_licoreria',
                baseCollection: 'catalogos/licoreria/productos',
                importadoEn: TS(),
                creadoEn: TS(),
                actualizadoEn: TS()
              }), { merge: true });

              inserted++;
            });
            await batch.commit();
          }
        }
      } catch (e) {
        console.warn('Error sembrando desde catalogos/licoreria:', e);
      }

      // 🔥 SI NO ENCONTRÓ, INTENTA POR CATEGORÍA
      if (inserted === 0) {
        inserted = await sembrarCategoria(uid, 'licores', { activar: true });
      }
      if (inserted === 0) {
        inserted = await sembrarCategoria(uid, 'licoreria', { activar: true });
      }
      if (inserted === 0) {
        inserted = await sembrarCategoria(uid, 'bebidas', { activar: true });
      }

      // sincroniza a raíz
      if (inserted > 0) {
        await syncAllSubToRoot(uid, db);
      }

      console.log('🍺 Catálogo LICORERÍA cargado:', inserted);

      return inserted;
    }

    // =========================
    // FARMACIA
    // =========================
    if (tipoComerciante === 'farmacia') {

      const inserted = await sembrarCategoria(
        uid,
        'farmacia',
        { activar: true }
      );

      if (inserted > 0) {
        await syncAllSubToRoot(uid, db);
      }

      console.log('💊 Catálogo FARMACIA cargado:', inserted);

      return inserted;
    }

    // =========================
    // CARNICERÍA
    // =========================
    if (tipoComerciante === 'carniceria') {

      const inserted = await sembrarCategoria(
        uid,
        'carnes',
        { activar: true }
      );

      if (inserted > 0) {
        await syncAllSubToRoot(uid, db);
      }

      console.log('🥩 Catálogo CARNICERÍA cargado:', inserted);

      return inserted;
    }

    // =========================
    // FRUTAS Y VERDURAS
    // =========================
    if (tipoComerciante === 'frutas y verduras') {

      const inserted = await sembrarCategoria(
        uid,
        'frutas',
        { activar: true }
      );

      if (inserted > 0) {
        await syncAllSubToRoot(uid, db);
      }

      console.log('🍎 Catálogo FRUTAS cargado:', inserted);

      return inserted;
    }

    // =========================
    // DEFAULT
    // =========================
    const inserted = await generarCatalogoBase(
      db,
      uid,
      { max, activar }
    );

    if (inserted > 0) {
      await syncAllSubToRoot(uid, db);
    }

    return inserted;

  } catch (e) {

    console.error('seedNewStore error:', e);

    return 0;
  }
}

/* --------------------------------- Export --------------------------------- */
export default {
  buscarCatalogo,
  sembrarCategoria,
  agregarDesdeCatalogo,
  syncAllSubToRoot,
  syncIdsToRoot,
  syncCategoryToRoot,
  actualizarPreciosEstandarMes,
  generarCatalogoBase,
  seedNewStore,
  obtenerCatalogoLicoreria
};