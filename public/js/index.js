// functions/index.js — ESM (Node 18+) con admin v12 / functions v5
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";

/* --------------------------- Región Firebase ----------------------------- */
const REGION = "southamerica-east1";
const fns = functions.region(REGION);

/* --------------------------- Inicializar Admin --------------------------- */
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const TS = () => admin.firestore.FieldValue.serverTimestamp();

/* ========================================================================
   CONFIGURACIÓN DE SERVICIO Y DOMICILIO
========================================================================= */
const SERVICIO_FIJO = 800; // $800 COP por pedido

/* ========================================================================
   EXPRESS API con CORS (incluye /fcm/subscribe)
========================================================================= */
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://mi-tiendita-cercana.web.app",
  "https://mi-tiendita-cercana.firebaseapp.com",
]);

const app = express();

// Middleware manual de CORS + preflight
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allow =
    !origin ||
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/.*\.cloudfunctions\.net$/.test(origin);

  if (allow) {
    res.set("Access-Control-Allow-Origin", origin || "*");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
    res.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Requested-With"
    );
    res.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
  }
  if (req.method === "OPTIONS") return res.status(204).send("");
  next();
});

// (extra) cors "relajado" por si algún origen se te escapa en dev
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      if (/^https:\/\/.*\.cloudfunctions\.net$/.test(origin)) return cb(null, true);
      return cb(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());

// Salud
app.get("/", (_req, res) => res.send("Servidor API listo 🚀"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, region: REGION, time: new Date().toISOString() })
);

// Auth Bearer para rutas privadas
async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Token requerido" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/* ========================================================================
   🔥 OBTENER CONFIGURACIÓN DE DOMICILIO
========================================================================= */
async function getDomicilioConfig(tiendaId) {
  try {
    const docRef = db.collection("tiendas").doc(tiendaId);
    const snap = await docRef.get();
    if (!snap.exists) return { activo: false, costo: 0, coberturaKm: 2 };
    
    const data = snap.data();
    return data.domicilio || { activo: false, costo: 0, coberturaKm: 2 };
  } catch (error) {
    console.warn('Error obteniendo configuración de domicilio:', error);
    return { activo: false, costo: 0, coberturaKm: 2 };
  }
}

// Guarda token FCM y espejos (usado por notifications.js)
app.post("/fcm/subscribe", requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: "token requerido" });

    const uid = req.user.uid;

    await db.collection("tokens").doc(token).set({ uid, agregadoEn: TS() }, { merge: true });
    await db.collection("perfiles").doc(uid).collection("config").doc("messaging")
      .set({ token, updatedAt: TS() }, { merge: true });
    await db.collection("tiendas").doc(uid).collection("config").doc("messaging")
      .set({ token, updatedAt: TS() }, { merge: true });

    res.json({ ok: true });
  } catch (e) {
    console.error("/fcm/subscribe", e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ========================================================================
   🔥 POST /pedidos - Crear pedido con DOMICILIO, SERVICIO y DATOS DEL CLIENTE
========================================================================= */
app.post("/pedidos", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { 
      tiendaId, 
      items, 
      subtotal, 
      envio, 
      servicio, 
      total,
      // 🔥 DATOS DEL CLIENTE (recibidos desde checkout-client.js)
      clienteNombre,
      clienteEmail,
      clienteTelefono,
      clienteDireccion
    } = req.body || {};

    if (!tiendaId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan datos del pedido" });
    }

    // 🔥 OBTENER CONFIGURACIÓN DE DOMICILIO DESDE FIRESTORE
    const domicilioConfig = await getDomicilioConfig(tiendaId);
    let costoEnvio = envio || 0;
    
    if (!domicilioConfig.activo) {
      costoEnvio = 0;
    } else {
      costoEnvio = domicilioConfig.costo || 0;
    }

    // 🔥 SERVICIO FIJO
    const servicioFijo = SERVICIO_FIJO;

    // ✅ CORREGIDO: Procesar items y obtener nombres COMPLETOS
    const itemsProcesados = [];
    let subtotalCalculado = subtotal || 0;

    for (const it of items) {
      // 🔥 BUSCAR PRODUCTO EN FIRESTORE
      const productoId = it.productoId || it.id;
      const cantidad = Number(it.cantidad || it.qty || 1);
      
      // Intentar obtener el producto desde Firestore
      let nombre = it.nombre || it.title || 'Producto';
      let precio = Number(it.precio || it.unitPrice || it.price || 0);
      let imagen = it.imagen || it.imageUrl || '';
      let unitLabel = it.unitLabel || it.unit || 'und.';
      let unidadBase = it.unit || 'unidad';
      
      // Si no tiene nombre o precio, buscarlo en Firestore
      if (!it.nombre || it.nombre === 'Producto' || !it.precio) {
        try {
          const pDoc = await db.collection("tiendas").doc(tiendaId).collection("productos").doc(productoId).get();
          if (pDoc.exists) {
            const p = pDoc.data();
            nombre = p.nombre || p.titulo || nombre;
            precio = Number(p.precio || p.price || 0);
            imagen = p.imagen || p.imagenUrl || imagen;
            unitLabel = p.unitLabel || p.unidad || 'und.';
            unidadBase = p.unidadBase || 'unidad';
          } else {
            // Buscar en productos_base
            const pDocBase = await db.collection("productos_base").doc(productoId).get();
            if (pDocBase.exists) {
              const p = pDocBase.data();
              nombre = p.nombre || p.titulo || nombre;
              precio = Number(p.precio || p.price || 0);
              imagen = p.imagen || p.imagenUrl || imagen;
              unitLabel = p.unitLabel || p.unidad || 'und.';
              unidadBase = p.unidadBase || 'unidad';
            }
          }
        } catch (e) {
          console.warn(`Producto no encontrado: ${productoId}`, e);
        }
      }
      
      const subtotalItem = precio * cantidad;
      subtotalCalculado += subtotalItem;
      
      itemsProcesados.push({
        productoId: productoId,
        nombre: nombre, // ✅ NOMBRE CORREGIDO
        cantidad: cantidad,
        precio: precio,
        subtotal: subtotalItem,
        imagen: imagen,
        unitLabel: unitLabel,
        unit: unidadBase
      });
    }

    const totalCalculado = subtotalCalculado + servicioFijo + costoEnvio;

    const pedido = {
      uid,
      tiendaId,
      items: itemsProcesados, // ✅ ITEMS CON NOMBRES
      subtotal: subtotalCalculado,
      envio: costoEnvio,
      servicio: servicioFijo,
      total: totalCalculado,
      estado: "pendiente",
      
      // 🔥 DATOS DEL CLIENTE (guardados en Firestore)
      clienteNombre: clienteNombre || 'Cliente',
      clienteEmail: clienteEmail || '',
      clienteTelefono: clienteTelefono || 'No especificado',
      clienteDireccion: clienteDireccion || 'No especificada',
      
      pago: {
        metodo: "contraentrega",
        estado: "pendiente",
        breakdown: {
          subtotal: subtotalCalculado,
          envio: costoEnvio,
          servicio: servicioFijo,
          total: totalCalculado
        }
      },
      breakdown: {
        subtotal: subtotalCalculado,
        envio: costoEnvio,
        servicio: servicioFijo,
        total: totalCalculado
      },
      createdAt: TS(),
      actualizadoEn: TS(),
    };

    const ref = await db.collection("pedidos").add(pedido);

    // Notificar al comerciante
    try {
      const cfg = await db.doc(`tiendas/${tiendaId}/config/messaging`).get();
      const token = cfg.exists ? cfg.data().token : null;
      if (token) {
        await admin.messaging().send({
          token,
          notification: {
            title: "🛒 Nuevo pedido",
            body: `Total $${totalCalculado.toLocaleString("es-CO")}`
          },
          data: {
            tipo: "pedido_nuevo",
            pedidoId: ref.id,
            tiendaId: String(tiendaId)
          }
        });
      }
    } catch (e) {
      console.warn("Error enviando notificación:", e);
    }

    res.status(201).json({
      ok: true,
      id: ref.id,
      total: totalCalculado,
      subtotal: subtotalCalculado,
      envio: costoEnvio,
      servicio: servicioFijo,
      items: itemsProcesados, // ✅ DEVOLVER ITEMS CON NOMBRES
      // 🔥 Devolver datos del cliente para confirmación
      clienteNombre: clienteNombre || 'Cliente',
      clienteEmail: clienteEmail || '',
      clienteTelefono: clienteTelefono || 'No especificado',
      clienteDireccion: clienteDireccion || 'No especificada'
    });

  } catch (e) {
    console.error("POST /pedidos", e);
    res.status(500).json({ error: "Error creando pedido" });
  }
});

/* ========================================================================
   🔥 POST /pedidos/state - Actualizar estado del pedido
========================================================================= */
app.post("/pedidos/state", requireAuth, async (req, res) => {
  try {
    const { pedidoId, estado, etaMin } = req.body || {};
    if (!pedidoId || !estado) {
      return res.status(400).json({ ok: false, error: "Faltan parámetros" });
    }

    const ref = db.collection("pedidos").doc(pedidoId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "Pedido no existe" });
    
    const p = snap.data();
    if (p.tiendaId !== req.user.uid) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const patch = {
      estado: String(estado),
      actualizadoEn: TS()
    };

    if (etaMin) {
      patch.etaMin = Number(etaMin);
    }

    await ref.update(patch);
    return res.json({ ok: true, estado: String(estado) });

  } catch (e) {
    console.error("POST /pedidos/state", e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ========================================================================
   🔥 GET /pedidos/mis-pedidos - Obtener pedidos del cliente
========================================================================= */
app.get("/pedidos/mis-pedidos", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db.collection("pedidos")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(pedidos);
  } catch (e) {
    console.error("GET /pedidos/mis-pedidos", e);
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});

/* ========================================================================
   🔥 GET /pedidos/tienda/:tiendaId - Obtener pedidos de una tienda
========================================================================= */
app.get("/pedidos/tienda/:tiendaId", requireAuth, async (req, res) => {
  try {
    const tiendaId = req.params.tiendaId;
    const uid = req.user.uid;

    if (tiendaId !== uid) {
      return res.status(403).json({ error: "No autorizado para ver estos pedidos" });
    }

    const snap = await db.collection("pedidos")
      .where("tiendaId", "==", tiendaId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(pedidos);
  } catch (e) {
    console.error("GET /pedidos/tienda/:tiendaId", e);
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});

/* ========================================================================
   Exporta el servidor Express
========================================================================= */
export const api = fns.https.onRequest(app);


/* ========================================================================
   Helpers catálogo
========================================================================= */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function copyBaseCatalogToStore(uid) {
  const productosRef = db.collection("tiendas").doc(uid).collection("productos");
  const first = await productosRef.limit(1).get();
  if (!first.empty) return 0;

  const baseSnap = await db.collection("productos_base").get();
  if (baseSnap.empty) return 0;

  const docs = baseSnap.docs;
  const groups = chunk(docs, 450);

  for (const group of groups) {
    const batch = db.batch();
    for (const docBase of group) {
      const d = docBase.data() || {};
      const pid = docBase.id;
      batch.set(
        productosRef.doc(pid),
        {
          ...d,
          fuente: "base",
          activo: d.activo ?? true,
          precio: d.precio ?? 0,
          stock: d.stock ?? 1000,
          creadoEn: TS(),
          actualizadoEn: TS(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
  return docs.length;
}


// functions/index.js — ESM (Node 18+) con admin v12 / functions v5
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";

/* --------------------------- Región Firebase ----------------------------- */
const REGION = "southamerica-east1";
const fns = functions.region(REGION);

/* --------------------------- Inicializar Admin --------------------------- */
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const TS = () => admin.firestore.FieldValue.serverTimestamp();

/* ========================================================================
   CONFIGURACIÓN DE SERVICIO Y DOMICILIO
========================================================================= */
const SERVICIO_FIJO = 800; // $800 COP por pedido

/* ========================================================================
   EXPRESS API con CORS (incluye /fcm/subscribe)
========================================================================= */
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://mi-tiendita-cercana.web.app",
  "https://mi-tiendita-cercana.firebaseapp.com",
]);

const app = express();

// Middleware manual de CORS + preflight
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allow =
    !origin ||
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/.*\.cloudfunctions\.net$/.test(origin);

  if (allow) {
    res.set("Access-Control-Allow-Origin", origin || "*");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
    res.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Requested-With"
    );
    res.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
  }
  if (req.method === "OPTIONS") return res.status(204).send("");
  next();
});

// (extra) cors "relajado" por si algún origen se te escapa en dev
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      if (/^https:\/\/.*\.cloudfunctions\.net$/.test(origin)) return cb(null, true);
      return cb(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());

// Salud
app.get("/", (_req, res) => res.send("Servidor API listo 🚀"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, region: REGION, time: new Date().toISOString() })
);

// Auth Bearer para rutas privadas
async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Token requerido" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/* ========================================================================
   🔥 OBTENER CONFIGURACIÓN DE DOMICILIO
========================================================================= */
async function getDomicilioConfig(tiendaId) {
  try {
    const docRef = db.collection("tiendas").doc(tiendaId);
    const snap = await docRef.get();
    if (!snap.exists) return { activo: false, costo: 0, coberturaKm: 2 };
    
    const data = snap.data();
    return data.domicilio || { activo: false, costo: 0, coberturaKm: 2 };
  } catch (error) {
    console.warn('Error obteniendo configuración de domicilio:', error);
    return { activo: false, costo: 0, coberturaKm: 2 };
  }
}

// Guarda token FCM y espejos (usado por notifications.js)
app.post("/fcm/subscribe", requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: "token requerido" });

    const uid = req.user.uid;

    await db.collection("tokens").doc(token).set({ uid, agregadoEn: TS() }, { merge: true });
    await db.collection("perfiles").doc(uid).collection("config").doc("messaging")
      .set({ token, updatedAt: TS() }, { merge: true });
    await db.collection("tiendas").doc(uid).collection("config").doc("messaging")
      .set({ token, updatedAt: TS() }, { merge: true });

    res.json({ ok: true });
  } catch (e) {
    console.error("/fcm/subscribe", e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ========================================================================
   🔥 POST /pedidos - Crear pedido con DOMICILIO, SERVICIO y DATOS DEL CLIENTE
========================================================================= */
app.post("/pedidos", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { 
      tiendaId, 
      items, 
      subtotal, 
      envio, 
      servicio, 
      total,
      // 🔥 DATOS DEL CLIENTE (recibidos desde checkout-client.js)
      clienteNombre,
      clienteEmail,
      clienteTelefono,
      clienteDireccion
    } = req.body || {};

    if (!tiendaId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan datos del pedido" });
    }

    // 🔥 OBTENER CONFIGURACIÓN DE DOMICILIO DESDE FIRESTORE
    const domicilioConfig = await getDomicilioConfig(tiendaId);
    let costoEnvio = envio || 0;
    
    if (!domicilioConfig.activo) {
      costoEnvio = 0;
    } else {
      costoEnvio = domicilioConfig.costo || 0;
    }

    // 🔥 SERVICIO FIJO
    const servicioFijo = SERVICIO_FIJO;

    // ✅ CORREGIDO: Procesar items y obtener nombres COMPLETOS
    const itemsProcesados = [];
    let subtotalCalculado = subtotal || 0;

    for (const it of items) {
      // 🔥 BUSCAR PRODUCTO EN FIRESTORE
      const productoId = it.productoId || it.id;
      const cantidad = Number(it.cantidad || it.qty || 1);
      
      // Intentar obtener el producto desde Firestore
      let nombre = it.nombre || it.title || 'Producto';
      let precio = Number(it.precio || it.unitPrice || it.price || 0);
      let imagen = it.imagen || it.imageUrl || '';
      let unitLabel = it.unitLabel || it.unit || 'und.';
      let unidadBase = it.unit || 'unidad';
      
      // Si no tiene nombre o precio, buscarlo en Firestore
      if (!it.nombre || it.nombre === 'Producto' || !it.precio) {
        try {
          const pDoc = await db.collection("tiendas").doc(tiendaId).collection("productos").doc(productoId).get();
          if (pDoc.exists) {
            const p = pDoc.data();
            nombre = p.nombre || p.titulo || nombre;
            precio = Number(p.precio || p.price || 0);
            imagen = p.imagen || p.imagenUrl || imagen;
            unitLabel = p.unitLabel || p.unidad || 'und.';
            unidadBase = p.unidadBase || 'unidad';
          } else {
            // Buscar en productos_base
            const pDocBase = await db.collection("productos_base").doc(productoId).get();
            if (pDocBase.exists) {
              const p = pDocBase.data();
              nombre = p.nombre || p.titulo || nombre;
              precio = Number(p.precio || p.price || 0);
              imagen = p.imagen || p.imagenUrl || imagen;
              unitLabel = p.unitLabel || p.unidad || 'und.';
              unidadBase = p.unidadBase || 'unidad';
            }
          }
        } catch (e) {
          console.warn(`Producto no encontrado: ${productoId}`, e);
        }
      }
      
      const subtotalItem = precio * cantidad;
      subtotalCalculado += subtotalItem;
      
      itemsProcesados.push({
        productoId: productoId,
        nombre: nombre, // ✅ NOMBRE CORREGIDO
        cantidad: cantidad,
        precio: precio,
        subtotal: subtotalItem,
        imagen: imagen,
        unitLabel: unitLabel,
        unit: unidadBase
      });
    }

    const totalCalculado = subtotalCalculado + servicioFijo + costoEnvio;

    const pedido = {
      uid,
      tiendaId,
      items: itemsProcesados, // ✅ ITEMS CON NOMBRES
      subtotal: subtotalCalculado,
      envio: costoEnvio,
      servicio: servicioFijo,
      total: totalCalculado,
      estado: "pendiente",
      
      // 🔥 DATOS DEL CLIENTE (guardados en Firestore)
      clienteNombre: clienteNombre || 'Cliente',
      clienteEmail: clienteEmail || '',
      clienteTelefono: clienteTelefono || 'No especificado',
      clienteDireccion: clienteDireccion || 'No especificada',
      
      pago: {
        metodo: "contraentrega",
        estado: "pendiente",
        breakdown: {
          subtotal: subtotalCalculado,
          envio: costoEnvio,
          servicio: servicioFijo,
          total: totalCalculado
        }
      },
      breakdown: {
        subtotal: subtotalCalculado,
        envio: costoEnvio,
        servicio: servicioFijo,
        total: totalCalculado
      },
      createdAt: TS(),
      actualizadoEn: TS(),
    };

    const ref = await db.collection("pedidos").add(pedido);

    // Notificar al comerciante
    try {
      const cfg = await db.doc(`tiendas/${tiendaId}/config/messaging`).get();
      const token = cfg.exists ? cfg.data().token : null;
      if (token) {
        await admin.messaging().send({
          token,
          notification: {
            title: "🛒 Nuevo pedido",
            body: `Total $${totalCalculado.toLocaleString("es-CO")}`
          },
          data: {
            tipo: "pedido_nuevo",
            pedidoId: ref.id,
            tiendaId: String(tiendaId)
          }
        });
      }
    } catch (e) {
      console.warn("Error enviando notificación:", e);
    }

    res.status(201).json({
      ok: true,
      id: ref.id,
      total: totalCalculado,
      subtotal: subtotalCalculado,
      envio: costoEnvio,
      servicio: servicioFijo,
      items: itemsProcesados, // ✅ DEVOLVER ITEMS CON NOMBRES
      // 🔥 Devolver datos del cliente para confirmación
      clienteNombre: clienteNombre || 'Cliente',
      clienteEmail: clienteEmail || '',
      clienteTelefono: clienteTelefono || 'No especificado',
      clienteDireccion: clienteDireccion || 'No especificada'
    });

  } catch (e) {
    console.error("POST /pedidos", e);
    res.status(500).json({ error: "Error creando pedido" });
  }
});

/* ========================================================================
   🔥 POST /pedidos/state - Actualizar estado del pedido
========================================================================= */
app.post("/pedidos/state", requireAuth, async (req, res) => {
  try {
    const { pedidoId, estado, etaMin } = req.body || {};
    if (!pedidoId || !estado) {
      return res.status(400).json({ ok: false, error: "Faltan parámetros" });
    }

    const ref = db.collection("pedidos").doc(pedidoId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "Pedido no existe" });
    
    const p = snap.data();
    if (p.tiendaId !== req.user.uid) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const patch = {
      estado: String(estado),
      actualizadoEn: TS()
    };

    if (etaMin) {
      patch.etaMin = Number(etaMin);
    }

    await ref.update(patch);
    return res.json({ ok: true, estado: String(estado) });

  } catch (e) {
    console.error("POST /pedidos/state", e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

/* ========================================================================
   🔥 GET /pedidos/mis-pedidos - Obtener pedidos del cliente
========================================================================= */
app.get("/pedidos/mis-pedidos", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db.collection("pedidos")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(pedidos);
  } catch (e) {
    console.error("GET /pedidos/mis-pedidos", e);
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});

/* ========================================================================
   🔥 GET /pedidos/tienda/:tiendaId - Obtener pedidos de una tienda
========================================================================= */
app.get("/pedidos/tienda/:tiendaId", requireAuth, async (req, res) => {
  try {
    const tiendaId = req.params.tiendaId;
    const uid = req.user.uid;

    if (tiendaId !== uid) {
      return res.status(403).json({ error: "No autorizado para ver estos pedidos" });
    }

    const snap = await db.collection("pedidos")
      .where("tiendaId", "==", tiendaId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(pedidos);
  } catch (e) {
    console.error("GET /pedidos/tienda/:tiendaId", e);
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});

/* ========================================================================
   Exporta el servidor Express
========================================================================= */
export const api = fns.https.onRequest(app);

/* ========================================================================
   🔥 POST /pedidos/:pedidoId/confirmar-recibido
   El cliente confirma que recibió el pedido.
   Genera el servicio de $800 para el comerciante.
========================================================================= */
app.post("/pedidos/:pedidoId/confirmar-recibido", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const pedidoId = req.params.pedidoId;

    if (!pedidoId) {
      return res.status(400).json({ error: "Falta pedidoId" });
    }

    const pedidoRef = db.collection("pedidos").doc(pedidoId);
    const pedidoSnap = await pedidoRef.get();

    if (!pedidoSnap.exists) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const pedido = pedidoSnap.data() || {};

    // Verificar que quien confirma es el cliente del pedido
    const esCliente = pedido.uid === uid || pedido.clienteId === uid;
    if (!esCliente) {
      return res.status(403).json({ error: "No autorizado para confirmar este pedido" });
    }

    // Si ya está confirmado, no duplicar servicio
    if (pedido.clienteConfirmado === true) {
      return res.json({
        ok: true,
        mensaje: "El pedido ya estaba confirmado",
        pedidoId
      });
    }

    const tiendaId = pedido.tiendaId;
    if (!tiendaId) {
      return res.status(400).json({ error: "El pedido no tiene tiendaId" });
    }

    const SERVICIO_MONTO = 800;
    const servicioRef = db.collection("servicios_comerciante").doc(`PEDIDO_${pedidoId}`);

    // 1. Crear servicio de $800 SOLO si no existe
    const servicioSnap = await servicioRef.get();
    if (!servicioSnap.exists) {
      await servicioRef.set({
        pedidoId,
        comercianteId: tiendaId,
        clienteId: uid,
        monto: SERVICIO_MONTO,
        estado: "pendiente",
        fechaGenerado: TS(),
        creadoEn: TS()
      });
    }

    // 2. Marcar el pedido como recibido
    await pedidoRef.update({
      estado: "recibido",
      clienteConfirmado: true,
      fechaConfirmacionCliente: TS(),
      actualizadoEn: TS()
    });

    // 3. Actualizar resumen del comerciante (opcional, pero útil)
    try {
      const resumenRef = db.collection("resumen_servicios_comerciante").doc(tiendaId);
      await resumenRef.set({
        totalPendiente: admin.firestore.FieldValue.increment(SERVICIO_MONTO),
        ultimaActualizacion: TS()
      }, { merge: true });
    } catch (e) {
      console.warn("No se pudo actualizar resumen:", e);
    }

    // 4. Notificación al comerciante
    try {
      const cfg = await db.doc(`tiendas/${tiendaId}/config/messaging`).get();
      const token = cfg.exists ? cfg.data().token : null;
      if (token) {
        await admin.messaging().send({
          token,
          notification: {
            title: "✅ Pedido confirmado",
            body: `El cliente confirmó el pedido #${pedidoId.slice(-6).toUpperCase()}`
          },
          data: {
            tipo: "pedido_confirmado",
            pedidoId: String(pedidoId),
            tiendaId: String(tiendaId)
          }
        });
      }
    } catch (e) {
      console.warn("Error notificando al comerciante:", e);
    }

    return res.json({
      ok: true,
      pedidoId,
      servicioId: `PEDIDO_${pedidoId}`,
      monto: SERVICIO_MONTO
    });

  } catch (e) {
    console.error("POST /pedidos/:pedidoId/confirmar-recibido", e);
    res.status(500).json({ error: "Error confirmando recepción" });
  }
});
/* ========================================================================
   Helpers catálogo
========================================================================= */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function copyBaseCatalogToStore(uid) {
  const productosRef = db.collection("tiendas").doc(uid).collection("productos");
  const first = await productosRef.limit(1).get();
  if (!first.empty) return 0;

  const baseSnap = await db.collection("productos_base").get();
  if (baseSnap.empty) return 0;

  const docs = baseSnap.docs;
  const groups = chunk(docs, 450);

  for (const group of groups) {
    const batch = db.batch();
    for (const docBase of group) {
      const d = docBase.data() || {};
      const pid = docBase.id;
      batch.set(
        productosRef.doc(pid),
        {
          ...d,
          fuente: "base",
          activo: d.activo ?? true,
          precio: d.precio ?? 0,
          stock: d.stock ?? 1000,
          creadoEn: TS(),
          actualizadoEn: TS(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
  return docs.length;
}

/* ========================================================================
   TRIGGERS / CALLABLES (tus funciones existentes)
========================================================================= */

// Pedido creado -> notificación + push
export const onPedidoCreate = fns.firestore
  .document("pedidos/{pedidoId}")
  .onCreate(async (snap, ctx) => {
    try {
      const pedido = snap.data() || {};
      const pedidoId = ctx.params.pedidoId;
      const tiendaId = pedido.tiendaId;
      if (!tiendaId) return;

      const notif = {
        type: "pedido:nuevo",
        title: "Nuevo pedido",
        body: `Pedido #${String(pedidoId).slice(-6).toUpperCase()} recibido`,
        pedidoId,
        createdAt: TS(),
        read: false,
      };
      await db.collection("tiendas").doc(tiendaId).collection("notificaciones").add(notif);

      const cfg = await db.doc(`tiendas/${tiendaId}/config/messaging`).get();
      const token = cfg.exists ? cfg.data().token : null;
      if (!token) return;

      await admin.messaging().send({
        token,
        notification: { title: "Nuevo pedido", body: `Pedido #${String(pedidoId).slice(-6).toUpperCase()} recibido` },
        data: { tipo: "pedido_nuevo", pedidoId: String(pedidoId), tiendaId: String(tiendaId) },
      });
    } catch (e) {
      console.error("onPedidoCreate", e);
    }
  });

// Marcar notificación como leída (callable)
export const marcarNotificacionLeida = fns.https.onCall(async (data) => {
  const { tiendaId, notifId } = data || {};
  if (!tiendaId || !notifId) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan argumentos");
  }
  await db.doc(`tiendas/${tiendaId}/notificaciones/${notifId}`).set({ read: true }, { merge: true });
  return { ok: true };
});

// Siembra automática del catálogo al crear tienda
export const onTiendaCreate_seedCatalog = fns.firestore
  .document("tiendas/{uid}")
  .onCreate(async (_snap, ctx) => {
    try {
      const uid = ctx.params.uid;
      await copyBaseCatalogToStore(uid);
    } catch (e) {
      console.error("onTiendaCreate_seedCatalog", e);
    }
  });

// Callable para resembrar catálogo
export const reseedCatalogForMyStore = fns.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Inicia sesión.");
  }
  try {
    const uid = context.auth.uid;
    const tiendaSnap = await db.collection("tiendas").doc(uid).get();
    if (!tiendaSnap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "La tienda no existe.");
    }
    const count = await copyBaseCatalogToStore(uid);
    return { ok: true, count };
  } catch (e) {
    console.error("reseedCatalogForMyStore", e);
    throw new functions.https.HttpsError("internal", e?.message || "Error al resembrar");
  }
});

// ========================================================================
// 🔥 TRIGGER: Actualizar notificación cuando cambia estado del pedido
// ========================================================================
export const onPedidoUpdate = fns.firestore
  .document("pedidos/{pedidoId}")
  .onUpdate(async (change, ctx) => {
    try {
      const before = change.before.data() || {};
      const after = change.after.data() || {};
      const pedidoId = ctx.params.pedidoId;

      if (before.estado === after.estado) return;

      const tiendaId = after.tiendaId;
      const uid = after.uid;
      const estado = after.estado || "pendiente";

      // Notificar al cliente
      if (uid) {
        const notif = {
          type: "pedido:estado",
          title: `Pedido ${estado}`,
          body: `Tu pedido #${String(pedidoId).slice(-6).toUpperCase()} está en: ${estado}`,
          pedidoId,
          createdAt: TS(),
          read: false,
        };
        await db.collection("usuarios").doc(uid).collection("notificaciones").add(notif);
      }

      // Notificar a la tienda
      if (tiendaId) {
        const notif = {
          type: "pedido:estado",
          title: `Pedido ${estado}`,
          body: `Pedido #${String(pedidoId).slice(-6).toUpperCase()} actualizado a: ${estado}`,
          pedidoId,
          createdAt: TS(),
          read: false,
        };
        await db.collection("tiendas").doc(tiendaId).collection("notificaciones").add(notif);
      }
    } catch (e) {
      console.error("onPedidoUpdate", e);
    }
  });

console.log('✅ Cloud Functions con DOMICILIO, SERVICIO y DATOS DEL CLIENTE listas');

/* ========================================================================
   TRIGGERS / CALLABLES (tus funciones existentes)
========================================================================= */

// Pedido creado -> notificación + push
export const onPedidoCreate = fns.firestore
  .document("pedidos/{pedidoId}")
  .onCreate(async (snap, ctx) => {
    try {
      const pedido = snap.data() || {};
      const pedidoId = ctx.params.pedidoId;
      const tiendaId = pedido.tiendaId;
      if (!tiendaId) return;

      const notif = {
        type: "pedido:nuevo",
        title: "Nuevo pedido",
        body: `Pedido #${String(pedidoId).slice(-6).toUpperCase()} recibido`,
        pedidoId,
        createdAt: TS(),
        read: false,
      };
      await db.collection("tiendas").doc(tiendaId).collection("notificaciones").add(notif);

      const cfg = await db.doc(`tiendas/${tiendaId}/config/messaging`).get();
      const token = cfg.exists ? cfg.data().token : null;
      if (!token) return;

      await admin.messaging().send({
        token,
        notification: { title: "Nuevo pedido", body: `Pedido #${String(pedidoId).slice(-6).toUpperCase()} recibido` },
        data: { tipo: "pedido_nuevo", pedidoId: String(pedidoId), tiendaId: String(tiendaId) },
      });
    } catch (e) {
      console.error("onPedidoCreate", e);
    }
  });

// Marcar notificación como leída (callable)
export const marcarNotificacionLeida = fns.https.onCall(async (data) => {
  const { tiendaId, notifId } = data || {};
  if (!tiendaId || !notifId) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan argumentos");
  }
  await db.doc(`tiendas/${tiendaId}/notificaciones/${notifId}`).set({ read: true }, { merge: true });
  return { ok: true };
});

// Siembra automática del catálogo al crear tienda
export const onTiendaCreate_seedCatalog = fns.firestore
  .document("tiendas/{uid}")
  .onCreate(async (_snap, ctx) => {
    try {
      const uid = ctx.params.uid;
      await copyBaseCatalogToStore(uid);
    } catch (e) {
      console.error("onTiendaCreate_seedCatalog", e);
    }
  });

// Callable para resembrar catálogo
export const reseedCatalogForMyStore = fns.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Inicia sesión.");
  }
  try {
    const uid = context.auth.uid;
    const tiendaSnap = await db.collection("tiendas").doc(uid).get();
    if (!tiendaSnap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "La tienda no existe.");
    }
    const count = await copyBaseCatalogToStore(uid);
    return { ok: true, count };
  } catch (e) {
    console.error("reseedCatalogForMyStore", e);
    throw new functions.https.HttpsError("internal", e?.message || "Error al resembrar");
  }
});

// ========================================================================
// 🔥 TRIGGER: Actualizar notificación cuando cambia estado del pedido
// ========================================================================
export const onPedidoUpdate = fns.firestore
  .document("pedidos/{pedidoId}")
  .onUpdate(async (change, ctx) => {
    try {
      const before = change.before.data() || {};
      const after = change.after.data() || {};
      const pedidoId = ctx.params.pedidoId;

      if (before.estado === after.estado) return;

      const tiendaId = after.tiendaId;
      const uid = after.uid;
      const estado = after.estado || "pendiente";

      // Notificar al cliente
      if (uid) {
        const notif = {
          type: "pedido:estado",
          title: `Pedido ${estado}`,
          body: `Tu pedido #${String(pedidoId).slice(-6).toUpperCase()} está en: ${estado}`,
          pedidoId,
          createdAt: TS(),
          read: false,
        };
        await db.collection("usuarios").doc(uid).collection("notificaciones").add(notif);
      }

      // Notificar a la tienda
      if (tiendaId) {
        const notif = {
          type: "pedido:estado",
          title: `Pedido ${estado}`,
          body: `Pedido #${String(pedidoId).slice(-6).toUpperCase()} actualizado a: ${estado}`,
          pedidoId,
          createdAt: TS(),
          read: false,
        };
        await db.collection("tiendas").doc(tiendaId).collection("notificaciones").add(notif);
      }
    } catch (e) {
      console.error("onPedidoUpdate", e);
    }
  });

console.log('✅ Cloud Functions con DOMICILIO, SERVICIO y DATOS DEL CLIENTE listas');