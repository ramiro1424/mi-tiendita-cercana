/* functions/index.js */
/* ------------------------------ Imports ---------------------------------- */
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import * as functions from "firebase-functions";
import dotenv from "dotenv";
import fs from "fs";

/* --------------------------- Región Firebase ----------------------------- */
const REGION = "southamerica-east1";
const fns = functions.region(REGION);

/* --------------------------- Cargar variables ---------------------------- */
dotenv.config();

/* ================== CONFIG SERVICIO ======================================= */

const SERVICIO_FIJO = Number(
  process.env.SERVICIO_FIJO || "800"
);

/* --------------------------- Inicializar Admin ---------------------------- */

(() => {
  if (admin.apps.length) return;

  if (!admin.apps.length) {
  admin.initializeApp();

  console.log(
    "[admin] Inicializado con credenciales por defecto"
  );
}
})();

const db =
  admin.firestore();

const messaging =
  admin.messaging();

const TS = () =>
  admin.firestore.FieldValue.serverTimestamp();

/* ========================================================================== */
/* TRANSICIÓN DE ESTADOS                                                      */
/* ========================================================================== */

export {
  transitionOrder
} from "./orders/state.js";

/* ========================================================================== */
/* HELPERS                                                                    */
/* ========================================================================== */

const requireAuth =
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        req.method ===
        "OPTIONS"
      ) {
        return res
          .status(204)
          .send("");
      }

      const authHeader =
        req.headers.authorization ||
        "";

      const token =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : null;

      if (!token) {
        return res
          .status(401)
          .json({
            error:
              "Token requerido"
          });
      }

      const decoded =
        await admin.auth()
          .verifyIdToken(
            token
          );

      req.user =
        decoded;

      next();
    } catch (e) {
      console.error(
        "Auth error:",
        e
      );

      res
        .status(401)
        .json({
          error:
            "Token inválido o expirado"
        });
    }
  };

const shortId =
  (id = "") =>
    "#" +
    String(id || "")
      .slice(-6)
      .toUpperCase();

/* ========================================================================== */
/* IMÁGENES AUTOMÁTICAS                                                       */
/* ========================================================================== */

function generarImagenProducto(
  nombre = "",
  categoria = ""
) {
  const texto =
    encodeURIComponent(
      `${nombre} ${categoria}`.trim()
    );

  return `https://source.unsplash.com/600x400/?${texto}`;
}

function asegurarImagenProducto(
  data = {}
) {
  const tieneImagen =
    data.imagen ||
    data.imagenUrl ||
    data.foto ||
    data.image;

  if (tieneImagen) {
    return String(
      tieneImagen
    );
  }

  return generarImagenProducto(
    data.nombre || "",
    data.categoria || ""
  );
}

/* ========================================================================== */
/* FEE                                                                        */
/* ========================================================================== */

async function getFeePctForStore(
  tiendaId
) {
  try {
    const snap =
      await db
        .collection("tiendas")
        .doc(tiendaId)
        .collection("config")
        .doc("payments")
        .get();

    if (snap.exists) {
      const v =
        Number(
          snap.data()?.feePct
        );

      if (
        !Number.isNaN(v) &&
        v >= 0 &&
        v <= 1
      ) {
        return v;
      }
    }
  } catch {}

  return 0;
}

/* ========================================================================== */
/* BREAKDOWN                                                                  */
/* ========================================================================== */

function calcBreakdown({
  subtotal = 0,
  envio = 0,
  impuestos = 0,
  feePct = 0,
  totalOverride = null
}) {
  const base =
    Math.round(
      Number(subtotal || 0)
    );

  const ship =
    Math.round(
      Number(envio || 0)
    );

  const tax =
    Math.round(
      Number(impuestos || 0)
    );

  const appFee =
    SERVICIO_FIJO;

  const total =
    totalOverride != null
      ? Math.round(
          Number(totalOverride)
        )
      : base +
        ship +
        tax +
        appFee;

  const merchantNet =
    Math.max(
      0,
      total - appFee
    );

  return {
    subtotal: base,
    shipping: ship,
    tax,
    appFee,
    merchantNet,
    total,
    servicioFijo:
      appFee
  };
}

/* ========================================================================== */
/* DISTANCIA                                                                  */
/* ========================================================================== */

function haversineKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R = 6371;

  const toRad =
    (d) =>
      (d * Math.PI) /
      180;

  const dLat =
    toRad(
      lat2 - lat1
    );

  const dLon =
    toRad(
      lon2 - lon1
    );

  const a =
    Math.sin(
      dLat / 2
    ) **
      2 +
    Math.cos(
      toRad(lat1)
    ) *
      Math.cos(
        toRad(lat2)
      ) *
      Math.sin(
        dLon / 2
      ) **
        2;

  return (
    R *
    (
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(
          1 - a
        )
      )
    )
  );
}

/* ========================================================================== */
/* PUSH                                                                       */
/* ========================================================================== */

async function sendPushToUser(
  uid,
  {
    title,
    body
  },
  data = {}
) {
  if (!uid) {
    return {
      sent: 0,
      failed: 0
    };
  }

  const snap =
    await db
      .collection("tokens")
      .where(
        "uid",
        "==",
        uid
      )
      .get();

  const tokens =
    snap.docs.map(
      (d) => d.id
    );

  if (!tokens.length) {
    return {
      sent: 0,
      failed: 0
    };
  }

  const message = {
    tokens,

    notification: {
      title,
      body
    },

    data:
      Object.fromEntries(
        Object.entries(
          data || {}
        ).map(
          ([k, v]) => [
            String(k),
            String(v)
          ]
        )
      )
  };

  const resp =
    await messaging
      .sendEachForMulticast(
        message
      );

  const toDelete = [];

  resp.responses.forEach(
    (r, i) => {
      if (!r.success) {
        const code =
          r.error?.code ||
          "";

        if (
          code.includes(
            "registration-token-not-registered"
          ) ||
          code.includes(
            "invalid-argument"
          )
        ) {
          toDelete.push(
            tokens[i]
          );
        }
      }
    }
  );

  if (
    toDelete.length
  ) {
    const batch =
      db.batch();

    toDelete.forEach(
      (tk) => {
        batch.delete(
          db
            .collection(
              "tokens"
            )
            .doc(tk)
        );
      }
    );

    await batch.commit();
  }

  return {
    sent:
      resp.successCount,
    failed:
      resp.failureCount
  };
}

async function getTokenTienda(
  tiendaId
) {
  try {
    const snap =
      await db
        .collection(
          "tiendas"
        )
        .doc(tiendaId)
        .collection(
          "config"
        )
        .doc(
          "messaging"
        )
        .get();

    return snap.exists
      ? snap.data().token ||
          ""
      : "";
  } catch {
    return "";
  }
}

async function getTokenPerfil(
  uid
) {
  try {
    const snap =
      await db
        .collection(
          "perfiles"
        )
        .doc(uid)
        .collection(
          "config"
        )
        .doc(
          "messaging"
        )
        .get();

    return snap.exists
      ? snap.data().token ||
          ""
      : "";
  } catch {
    return "";
  }
}

async function sendPush(
  tokens = [],
  notification = {},
  data = {}
) {
  const clean =
    (tokens || [])
      .filter(Boolean);

  if (!clean.length) {
    return {
      successCount: 0,
      failureCount: 0
    };
  }

  try {
    const resp =
      await messaging
        .sendEachForMulticast({
          tokens: clean,

          notification,

          data:
            Object.fromEntries(
              Object.entries(
                data || {}
              ).map(
                ([k, v]) => [
                  String(k),
                  String(v)
                ]
              )
            )
        });

    return {
      successCount:
        resp.successCount,

      failureCount:
        resp.failureCount
    };
  } catch (e) {
    console.warn(
      "sendPush error:",
      e
    );

    return {
      successCount: 0,
      failureCount:
        clean.length
    };
  }
}

/* ========================================================================== */
/* PERFIL Y UBICACIÓN                                                         */
/* ========================================================================== */

function extraerUbicacion(
  data = {}
) {
  const ubicacion =
    data.ubicacion ||
    data.location ||
    data.geolocalizacion ||
    {};

  const lat =
    Number(
      ubicacion.lat ??
      ubicacion.latitude ??
      data.lat ??
      data.latitude ??
      data.latitud ??
      NaN
    );

  const lng =
    Number(
      ubicacion.lng ??
      ubicacion.lon ??
      ubicacion.longitude ??
      data.lng ??
      data.lon ??
      data.longitude ??
      data.longitud ??
      NaN
    );

  const direccion =
    ubicacion.direccion ||
    ubicacion.address ||
    data.direccion ||
    data.address ||
    "";

  const mapsUrl =
    ubicacion.mapsUrl ||
    data.mapsUrl ||
    (
      Number.isFinite(lat) &&
      Number.isFinite(lng)
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : ""
    );

  return {
    lat:
      Number.isFinite(lat)
        ? lat
        : null,

    lng:
      Number.isFinite(lng)
        ? lng
        : null,

    direccion:
      String(
        direccion || ""
      ),

    mapsUrl:
      String(
        mapsUrl || ""
      )
  };
}

async function obtenerPerfilCompleto(
  uid
) {
  if (!uid) {
    return null;
  }

  let usuario = {};
  let perfil = {};

  try {
    const usuarioSnap =
      await db
        .collection(
          "usuarios"
        )
        .doc(uid)
        .get();

    if (
      usuarioSnap.exists
    ) {
      usuario =
        usuarioSnap.data() ||
        {};
    }
  } catch (e) {
    console.warn(
      `No se pudo obtener usuarios/${uid}:`,
      e.message
    );
  }

  try {
    const perfilSnap =
      await db
        .collection(
          "perfiles"
        )
        .doc(uid)
        .get();

    if (
      perfilSnap.exists
    ) {
      perfil =
        perfilSnap.data() ||
        {};
    }
  } catch (e) {
    console.warn(
      `No se pudo obtener perfiles/${uid}:`,
      e.message
    );
  }

  const nombres =
    usuario.nombres ||
    perfil.nombres ||
    "";

  const apellidos =
    usuario.apellidos ||
    perfil.apellidos ||
    "";

  const nombre =
    usuario.nombre ||
    perfil.nombre ||
    `${nombres} ${apellidos}`.trim() ||
    "Usuario";

  const email =
    usuario.email ||
    perfil.email ||
    "";

  const telefono =
    usuario.telefono ||
    usuario.phone ||
    perfil.telefono ||
    perfil.phone ||
    "";

  const direccion =
    usuario.direccion ||
    usuario.address ||
    usuario.ubicacion?.direccion ||
    perfil.direccion ||
    perfil.address ||
    perfil.ubicacion?.direccion ||
    "";

  const ubicacion =
    extraerUbicacion({
      ...usuario,
      ...perfil,
      direccion
    });

  return {
    uid,

    nombre,

    nombres,

    apellidos,

    email,

    telefono,

    direccion,

    ubicacion,

    tipo:
      perfil.tipo ||
      usuario.tipo ||
      "",

    tipoComerciante:
      perfil.tipoComerciante ||
      usuario.tipoComerciante ||
      "",

    foto:
      perfil.foto ||
      perfil.imagen ||
      perfil.imagenUrl ||
      usuario.foto ||
      usuario.imagen ||
      "",

    usuario,

    perfil
  };
}

/* ========================================================================== */
/* PERFIL DEL COMERCIANTE                                                     */
/* ========================================================================== */

async function obtenerPerfilComerciante(
  tiendaId
) {
  if (!tiendaId) {
    return null;
  }

  let tienda = {};

  try {
    const tiendaSnap =
      await db
        .collection(
          "tiendas"
        )
        .doc(tiendaId)
        .get();

    if (
      tiendaSnap.exists
    ) {
      tienda =
        tiendaSnap.data() ||
        {};
    }
  } catch (e) {
    console.warn(
      `No se pudo obtener tiendas/${tiendaId}:`,
      e.message
    );
  }

  const perfil =
    await obtenerPerfilCompleto(
      tiendaId
    );

  if (!perfil) {
    return {
      uid: tiendaId,

      tiendaId,

      nombre:
        tienda.nombre ||
        tienda.nombreTienda ||
        tienda.nombreComercial ||
        "Comercio",

      email:
        tienda.email ||
        "",

      telefono:
        tienda.telefono ||
        tienda.phone ||
        "",

      direccion:
        tienda.direccion ||
        "",

      ubicacion:
        extraerUbicacion(
          tienda
        ),

      tipoComerciante:
        tienda.tipoComerciante ||
        "",

      foto:
        tienda.foto ||
        tienda.imagen ||
        tienda.imagenUrl ||
        ""
    };
  }

  const ubicacionTienda =
    extraerUbicacion({
      ...tienda,
      ...perfil.perfil,
      direccion:
        tienda.direccion ||
        perfil.direccion
    });

  return {
    uid: tiendaId,

    tiendaId,

    nombreTienda:
      tienda.nombre ||
      tienda.nombreTienda ||
      tienda.nombreComercial ||
      "",

    nombreComerciante:
      perfil.nombre ||
      tienda.nombreComerciante ||
      tienda.propietarioNombre ||
      "",

    nombre:
      perfil.nombre ||
      tienda.nombreComerciante ||
      tienda.nombre ||
      "Comercio",

    email:
      tienda.email ||
      perfil.email ||
      "",

    telefono:
      tienda.telefono ||
      tienda.phone ||
      perfil.telefono ||
      "",

    direccion:
      tienda.direccion ||
      perfil.direccion ||
      "",

    ubicacion:
      ubicacionTienda,

    tipoComerciante:
      tienda.tipoComerciante ||
      perfil.tipoComerciante ||
      "",

    foto:
      tienda.foto ||
      tienda.imagen ||
      tienda.imagenUrl ||
      perfil.foto ||
      "",

    activo:
      tienda.activo !== false,

    tienda
  };
}

/* ========================================================================== */
/* EXPRESS                                                                    */
/* ========================================================================== */

const app =
  express();

app.disable(
  "x-powered-by"
);

/* ========================================================================== */
/* CORS                                                                       */
/* ========================================================================== */

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  (
    req,
    res,
    next
  ) => {
    const origin =
      req.headers.origin ||
      "";

    const allowed = [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://mi-tiendita-cercana.web.app",
      "https://mi-tiendita-cercana.firebaseapp.com"
    ];

    if (
      allowed.includes(
        origin
      ) ||
      process.env.NODE_ENV ===
        "development"
    ) {
      res.header(
        "Access-Control-Allow-Origin",
        origin
      );
    } else {
      res.header(
        "Access-Control-Allow-Origin",
        "*"
      );
    }

    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    res.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Requested-With"
    );

    res.header(
      "Access-Control-Allow-Credentials",
      "true"
    );

    if (
      req.method ===
      "OPTIONS"
    ) {
      return res
        .status(204)
        .send("");
    }

    next();
  }
);

app.use(
  express.json({
    limit: "1mb"
  })
);

/* ========================================================================== */
/* RUTAS PÚBLICAS                                                             */
/* ========================================================================== */

app.get(
  "/",
  (_req, res) => {
    res.send(
      "Servidor Functions + Express listo 🚀"
    );
  }
);

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,
      region:
        REGION,
      time:
        new Date().toISOString()
    });
  }
);

/* ========================================================================== */
/* DOMICILIO                                                                  */
/* ========================================================================== */

function calcularEnvio(
  subtotal
) {
  if (
    subtotal < 20000
  ) {
    return 1500;
  }

  if (
    subtotal >= 30000
  ) {
    return 2500;
  }

  return 800;
}

async function getDomicilioConfig(
  tiendaId
) {
  try {
    const docRef =
      db
        .collection(
          "tiendas"
        )
        .doc(tiendaId);

    const snap =
      await docRef.get();

    if (
      !snap.exists
    ) {
      return {
        activo: false,
        costo: 0,
        coberturaKm: 2
      };
    }

    const data =
      snap.data();

    return (
      data.domicilio || {
        activo: false,
        costo: 0,
        coberturaKm: 2
      }
    );
  } catch (error) {
    console.warn(
      "Error obteniendo configuración de domicilio:",
      error
    );

    return {
      activo: false,
      costo: 0,
      coberturaKm: 2
    };
  }
}

/* ========================================================================== */
/* REGISTRO DE USUARIOS                                                       */
/* ========================================================================== */

app.post(
  "/usuarios",
  async (
    req,
    res
  ) => {
    try {
      const {
        nombres,
        apellidos,
        email,
        telefono,
        password,
        tipo
      } = req.body;

      if (
        !nombres ||
        !email ||
        !password ||
        !tipo
      ) {
        return res
          .status(400)
          .json({
            error:
              "Faltan campos requeridos"
          });
      }

      const userRecord =
        await admin.auth()
          .createUser({
            email,
            password,

            displayName:
              `${nombres} ${apellidos || ""}`.trim(),

            disabled: false
          });

      const perfilBase = {
        uid:
          userRecord.uid,

        tipo,

        nombres,

        apellidos:
          apellidos || "",

        email,

        telefono:
          telefono || "",

        direccion: "",

        fechaRegistro:
          TS(),

        estado:
          "activo"
      };

      await db
        .collection(
          "usuarios"
        )
        .doc(
          userRecord.uid
        )
        .set(
          perfilBase,
          {
            merge: true
          }
        );

      if (
        String(tipo)
          .toLowerCase() ===
        "comerciante"
      ) {
        await db
          .collection(
            "perfiles"
          )
          .doc(
            userRecord.uid
          )
          .set(
            {
              uid:
                userRecord.uid,

              email,

              nombre:
                `${nombres} ${apellidos || ""}`.trim(),

              tipo:
                "comerciante",

              tipoComerciante:
                "tienda",

              createdAt:
                TS(),

              updatedAt:
                TS()
            },
            {
              merge: true
            }
          );

        await db
          .collection(
            "tiendas"
          )
          .doc(
            userRecord.uid
          )
          .set(
            {
              activo: true,

              uid: userRecord.uid,

              tipoComerciante:
                "tienda",

              createdAt:
                TS(),

              updatedAt:
                TS()
            },
            {
              merge: true
            }
          );
      }

      return res
        .status(201)
        .json({
          message:
            "Usuario registrado correctamente",

          uid:
            userRecord.uid
        });
    } catch (error) {
      console.error(
        "Error registrando usuario:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            error.message ||
            "Error interno"
        });
    }
  }
);

/* ========================================================================== */
/* REGISTRO COMERCIANTE                                                       */
/* ========================================================================== */
/* ✅ CAMBIO: se ELIMINÓ la llamada a copyBaseToStore() aquí.                 */
/* El seed se encarga ÚNICAMENTE el trigger seedBaseOnStoreCreate.            */
/* ========================================================================== */

app.post(
  "/register-comerciante",
  async (
    req,
    res
  ) => {
    try {
      const {
        nombres,
        apellidos,
        email,
        telefono,
        password,
        tipoComerciante
      } = req.body;

      if (
        !nombres ||
        !email ||
        !password
      ) {
        return res
          .status(400)
          .json({
            error:
              "Faltan campos requeridos"
          });
      }

      try {
        await admin.auth()
          .getUserByEmail(
            email
          );

        return res
          .status(409)
          .json({
            error:
              "El correo ya está registrado"
          });
      } catch {}

      const tipoComercioFinal =
        String(
          tipoComerciante ||
          "tienda"
        )
          .toLowerCase()
          .trim();

      const userRecord =
        await admin.auth()
          .createUser({
            email,
            password,

            displayName:
              `${nombres} ${apellidos || ""}`.trim(),

            disabled: false
          });

      const uid =
        userRecord.uid;

      await db
        .collection(
          "usuarios"
        )
        .doc(uid)
        .set(
          {
            uid,

            tipo:
              "comerciante",

            nombres,

            apellidos:
              apellidos || "",

            email,

            telefono:
              telefono || "",

            direccion: "",

            fechaRegistro:
              TS(),

            estado:
              "activo"
          },
          {
            merge: true
          }
        );

      await db
        .collection(
          "perfiles"
        )
        .doc(uid)
        .set(
          {
            uid,

            email,

            nombre:
              `${nombres} ${apellidos || ""}`.trim(),

            tipo:
              "comerciante",

            tipoComerciante:
              tipoComercioFinal,

            createdAt:
              TS(),

            updatedAt:
              TS()
          },
          {
            merge: true
          }
        );

      await db
        .collection(
          "tiendas"
        )
        .doc(uid)
        .set(
          {
            activo: true,

            uid: uid,

            tipoComerciante:
              tipoComercioFinal,

            createdAt:
              TS(),

            updatedAt:
              TS()
          },
          {
            merge: true
          }
        );

      /* --------------------------------------------------------------------- */
      /* El seed del catálogo lo hace el trigger seedBaseOnStoreCreate.        */
      /* No lo llamamos aquí para evitar duplicados y condiciones de carrera.  */
      /* --------------------------------------------------------------------- */

      return res
        .status(201)
        .json({
          ok: true,
          uid,
          tipoComerciante:
            tipoComercioFinal,
          mensaje:
            "Registro exitoso. El catálogo se está sembrando automáticamente."
        });
    } catch (e) {
      console.error(
        "POST /register-comerciante",
        e
      );

      return res
        .status(500)
        .json({
          error:
            e.message ||
            "Error interno"
        });
    }
  }
);

/* ========================================================================== */
/* PERFIL ACTUAL                                                              */
/* ========================================================================== */

app.get(
  "/me",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const uid =
        req.user.uid;

      const authEmail =
        req.user.email ||
        "";

      const uidRef =
        db
          .collection(
            "usuarios"
          )
          .doc(uid);

      const snap =
        await uidRef.get();

      if (
        snap.exists
      ) {
        return res.json(
          snap.data()
        );
      }

      if (
        authEmail
      ) {
        const q =
          await db
            .collection(
              "usuarios"
            )
            .where(
              "email",
              "==",
              authEmail
            )
            .limit(1)
            .get();

        if (
          !q.empty
        ) {
          const oldDoc =
            q.docs[0];

          const data =
            oldDoc.data();

          const merged = {
            ...data,

            uid,

            email:
              authEmail,

            nombres:
              data.nombres ||
              req.user.name ||
              req.user.displayName ||
              "",

            apellidos:
              data.apellidos ||
              "",

            direccion:
              data.direccion ||
              ""
          };

          await uidRef.set(
            merged,
            {
              merge: true
            }
          );

          if (
            oldDoc.id !==
            uid
          ) {
            await oldDoc.ref.delete();
          }

          console.log(
            `[MIGRADO] usuarios/${oldDoc.id} -> usuarios/${uid}`
          );

          return res.json(
            merged
          );
        }
      }

      const displayName =
        req.user.name ||
        req.user.displayName ||
        "";

      let nombres =
        displayName;

      let apellidos = "";

      if (
        displayName &&
        displayName.includes(
          " "
        )
      ) {
        const parts =
          displayName.split(
            " "
          );

        nombres =
          parts
            .slice(0, -1)
            .join(" ");

        apellidos =
          parts
            .slice(-1)
            .join(" ");
      }

      const perfil = {
        uid,

        email:
          authEmail,

        nombres,

        apellidos,

        tipo:
          "cliente",

        telefono: "",

        direccion: "",

        ubicacion: {
          lat: null,
          lng: null,
          direccion: "",
          mapsUrl: ""
        },

        fechaRegistro:
          TS(),

        estado:
          "activo"
      };

      await uidRef.set(
        perfil,
        {
          merge: true
        }
      );

      console.log(
        `[AUTOPROVISION] usuarios/${uid}`
      );

      return res.json(
        perfil
      );
    } catch (e) {
      console.error(
        "GET /me error:",
        e
      );

      res
        .status(500)
        .json({
          error:
            "Error interno"
        });
    }
  }
);

/* ========================================================================== */
/* ACTUALIZAR PERFIL                                                          */
/* ========================================================================== */

app.put(
  "/me",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const uid =
        req.user.uid;

      const {
        nombres,
        apellidos,
        telefono,
        direccion,
        ubicacion,
        lat,
        lng,
        latitude,
        longitude,
        mapsUrl
      } = req.body;

      if (
        "password" in
        req.body
      ) {
        return res
          .status(400)
          .json({
            error:
              "Campo no permitido: password"
          });
      }

      const cambios = {};

      if (
        typeof nombres ===
        "string"
      ) {
        cambios.nombres =
          nombres;
      }

      if (
        typeof apellidos ===
        "string"
      ) {
        cambios.apellidos =
          apellidos;
      }

      if (
        typeof telefono ===
        "string"
      ) {
        cambios.telefono =
          telefono;
      }

      if (
        typeof direccion ===
        "string"
      ) {
        cambios.direccion =
          direccion;
      }

      /* ------------------------------------------------------------------ */
      /* UBICACIÓN DEL CLIENTE                                              */
      /* ------------------------------------------------------------------ */

      const tieneUbicacion =
        ubicacion ||
        lat !== undefined ||
        lng !== undefined ||
        latitude !== undefined ||
        longitude !== undefined;

      if (
        tieneUbicacion
      ) {
        const ubicacionActual =
          extraerUbicacion({
            ubicacion,
            lat,
            lng,
            latitude,
            longitude,
            mapsUrl,

            direccion:
              typeof direccion ===
              "string"
                ? direccion
                : ""
          });

        cambios.ubicacion =
          ubicacionActual;

        if (
          ubicacionActual.lat !==
          null
        ) {
          cambios.lat =
            ubicacionActual.lat;
        }

        if (
          ubicacionActual.lng !==
          null
        ) {
          cambios.lng =
            ubicacionActual.lng;
        }

        if (
          ubicacionActual.mapsUrl
        ) {
          cambios.mapsUrl =
            ubicacionActual.mapsUrl;
        }
      }

      await db
        .collection(
          "usuarios"
        )
        .doc(uid)
        .set(
          cambios,
          {
            merge: true
          }
        );

      return res.json({
        ok: true
      });
    } catch (e) {
      console.error(
        "PUT /me error:",
        e
      );

      res
        .status(500)
        .json({
          error:
            "Error actualizando perfil"
        });
    }
  }
);

/* ========================================================================== */
/* FCM TOKENS                                                                 */
/* ========================================================================== */

app.post(
  "/fcm/subscribe",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const { token } =
        req.body;

      if (!token) {
        return res
          .status(400)
          .json({
            error:
              "token requerido"
          });
      }

      await db
        .collection(
          "tokens"
        )
        .doc(token)
        .set(
          {
            uid:
              req.user.uid,

            agregadoEn:
              TS()
          },
          {
            merge: true
          }
        );

      res.json({
        ok: true
      });
    } catch (e) {
      console.error(
        "POST /fcm/subscribe",
        e
      );

      res
        .status(500)
        .json({
          error:
            "No se pudo guardar token"
        });
    }
  }
);

app.delete(
  "/fcm/subscribe",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const { token } =
        req.body;

      if (!token) {
        return res
          .status(400)
          .json({
            error:
              "token requerido"
          });
      }

      await db
        .collection(
          "tokens"
        )
        .doc(token)
        .delete();

      res.json({
        ok: true
      });
    } catch (e) {
      console.error(
        "DELETE /fcm/subscribe",
        e
      );

      res
        .status(500)
        .json({
          error:
            "No se pudo eliminar token"
        });
    }
  }
);

/* ========================================================================== */
/* COTIZADOR                                                                  */
/* ========================================================================== */

app.post(
  "/fees/quote",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const {
        items = [],
        tiendaId
      } = req.body || {};

      if (
        !Array.isArray(
          items
        ) ||
        !tiendaId
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Datos inválidos"
          });
      }

      let subtotal = 0;

      for (
        const it of items
      ) {
        const qty =
          Number(
            it.cantidad ||
            it.qty ||
            0
          );

        if (!qty) continue;

        let precio =
          Number(
            it.precio || 0
          );

        if (
          !precio &&
          it.productoId
        ) {
          const pid =
            String(
              it.productoId
            );

          const root =
            await db
              .collection(
                "productos"
              )
              .doc(pid)
              .get();

          if (
            root.exists
          ) {
            precio =
              Number(
                root.data()?.precio ||
                0
              );
          }
        }

        subtotal +=
          (precio || 0) *
          qty;
      }

      subtotal =
        Math.max(
          0,
          Math.round(
            subtotal
          )
        );

      const appFee =
        SERVICIO_FIJO;

      const total =
        subtotal +
        appFee;

      return res.json({
        ok: true,

        breakdown: {
          subtotal,

          appFee,

          servicio:
            appFee,

          feePct: 0,

          total,

          currency:
            "COP"
        }
      });
    } catch (e) {
      console.error(
        "/fees/quote",
        e
      );

      res
        .status(500)
        .json({
          ok: false,
          error:
            "Error interno"
        });
    }
  }
);

/* ========================================================================== */
/* CREAR PEDIDO                                                               */
/* ========================================================================== */

app.post(
  "/pedidos",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const uid =
        req.user.uid;

      const {
        tiendaId,
        items,
        subtotal,
        envio,
        servicio,
        total,

        clienteNombre,
        clienteEmail,
        clienteTelefono,
        clienteDireccion,

        ubicacion
      } =
        req.body || {};

      if (
        !tiendaId ||
        !Array.isArray(
          items
        ) ||
        items.length === 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "Faltan datos del pedido"
          });
      }

      /* ------------------------------------------------------------------ */
      /* PERFIL REAL DEL CLIENTE                                            */
      /* ------------------------------------------------------------------ */

      const perfilCliente =
        await obtenerPerfilCompleto(
          uid
        );

      let datosCliente = {
        uid,

        nombre:
          perfilCliente?.nombre ||
          "",

        email:
          perfilCliente?.email ||
          req.user.email ||
          "",

        telefono:
          perfilCliente?.telefono ||
          "",

        direccion:
          perfilCliente?.direccion ||
          ""
      };

      /* ------------------------------------------------------------------ */
      /* FALLBACK FRONTEND                                                   */
      /* ------------------------------------------------------------------ */

      if (
        !datosCliente.nombre &&
        clienteNombre
      ) {
        datosCliente.nombre =
          clienteNombre;
      }

      if (
        !datosCliente.email &&
        clienteEmail
      ) {
        datosCliente.email =
          clienteEmail;
      }

      if (
        !datosCliente.telefono &&
        clienteTelefono
      ) {
        datosCliente.telefono =
          clienteTelefono;
      }

      if (
        !datosCliente.direccion &&
        clienteDireccion
      ) {
        datosCliente.direccion =
          clienteDireccion;
      }

      if (
        !datosCliente.nombre
      ) {
        datosCliente.nombre =
          "Cliente";
      }

      if (
        !datosCliente.telefono
      ) {
        datosCliente.telefono =
          "No especificado";
      }

      if (
        !datosCliente.direccion
      ) {
        datosCliente.direccion =
          "No especificada";
      }

      /* ------------------------------------------------------------------ */
      /* UBICACIÓN CLIENTE                                                   */
      /* ------------------------------------------------------------------ */

      const ubicacionClienteFinal =
        extraerUbicacion({
          ...(perfilCliente?.usuario ||
            {}),
          ...(perfilCliente?.perfil ||
            {}),
          ubicacion:
            ubicacion ||
            perfilCliente?.ubicacion,

          direccion:
            clienteDireccion ||
            perfilCliente?.direccion ||
            datosCliente.direccion
        });

      /* ------------------------------------------------------------------ */
      /* INFORMACIÓN COMERCIANTE                                             */
      /* ------------------------------------------------------------------ */

      const datosComerciante =
        await obtenerPerfilComerciante(
          tiendaId
        );

      console.log(
        "👤 CLIENTE:",
        datosCliente
      );

      console.log(
        "📍 UBICACIÓN CLIENTE:",
        ubicacionClienteFinal
      );

      console.log(
        "🏪 COMERCIANTE:",
        datosComerciante
      );

      /* ------------------------------------------------------------------ */
      /* DOMICILIO                                                           */
      /* ------------------------------------------------------------------ */

      const domicilioConfig =
        await getDomicilioConfig(
          tiendaId
        );

      let costoEnvio =
        envio || 0;

      if (
        !domicilioConfig.activo
      ) {
        costoEnvio = 0;
      } else {
        costoEnvio =
          envio !== undefined
            ? envio
            : (
                domicilioConfig.costo ||
                0
              );
      }

      /* ------------------------------------------------------------------ */
      /* SERVICIO FIJO                                                       */
      /* ------------------------------------------------------------------ */

      const servicioFijo =
        servicio ||
        SERVICIO_FIJO;

      /* ------------------------------------------------------------------ */
      /* ENRIQUECER PRODUCTOS                                                */
      /* ------------------------------------------------------------------ */

      let subtotalCalculado =
        0;

      const itemsEnriquecidos =
        [];

      for (
        const it of items
      ) {
        if (
          !it.productoId ||
          !it.cantidad
        ) {
          continue;
        }

        let nombre =
          it.nombre ||
          it.title ||
          "";

        let precio =
          Number(
            it.precio || 0
          );

        let imagen =
          it.imagen || "";

        let unidad =
          it.unidad ||
          "und.";

        let unitLabel =
          it.unitLabel ||
          "und.";

        const cantidad =
          Number(
            it.cantidad || 1
          );

        if (
          !nombre ||
          precio === 0
        ) {
          try {
            const pDoc =
              await db
                .collection(
                  "tiendas"
                )
                .doc(
                  tiendaId
                )
                .collection(
                  "productos"
                )
                .doc(
                  it.productoId
                )
                .get();

            if (
              pDoc.exists
            ) {
              const p =
                pDoc.data();

              if (!nombre) {
                nombre =
                  p.nombre ||
                  p.nombreBase ||
                  "";
              }

              if (
                !precio ||
                precio === 0
              ) {
                precio =
                  Number(
                    p.precio || 0
                  );
              }

              if (!imagen) {
                imagen =
                  p.imagen ||
                  p.imageUrl ||
                  "";
              }

              if (!unidad) {
                unidad =
                  p.unidadBase ||
                  "und.";
              }

              if (!unitLabel) {
                unitLabel =
                  p.unitLabel ||
                  p.unidadLabel ||
                  "und.";
              }
            }
          } catch (e) {
            console.warn(
              `No se pudo obtener producto ${it.productoId}:`,
              e.message
            );
          }
        }

        if (!nombre) {
          nombre =
            it.productoId ||
            "Producto";
        }

        const subtotalItem =
          precio *
          cantidad;

        subtotalCalculado +=
          subtotalItem;

        itemsEnriquecidos.push({
          productoId:
            it.productoId,

          nombre,

          precio,

          cantidad,

          imagen,

          unidad,

          unitLabel,

          subtotal:
            subtotalItem
        });
      }

      /* ------------------------------------------------------------------ */
      /* TOTALES                                                             */
      /* ------------------------------------------------------------------ */

      const subtotalFinal =
        subtotal ||
        subtotalCalculado;

      const totalCalculado =
        subtotalFinal +
        servicioFijo +
        costoEnvio;

      /* ------------------------------------------------------------------ */
      /* PEDIDO                                                               */
      /* ------------------------------------------------------------------ */

      const pedido = {
        /* CLIENTE */

        uid,

        clienteUid:
          uid,

        clienteId:
          uid,

        usuarioId:
          uid,

        uidCliente:
          uid,

        clienteNombre:
          datosCliente.nombre,

        clienteEmail:
          datosCliente.email,

        clienteTelefono:
          datosCliente.telefono,

        clienteDireccion:
          datosCliente.direccion,

        cliente: {
          uid,

          clienteUid:
            uid,

          clienteId:
            uid,

          nombre:
            datosCliente.nombre,

          email:
            datosCliente.email,

          telefono:
            datosCliente.telefono,

          direccion:
            datosCliente.direccion,

          ubicacion:
            ubicacionClienteFinal
        },

        ubicacionCliente:
          ubicacionClienteFinal,

        /* COMERCIANTE */

        tiendaId,

        comerciante:
          datosComerciante
            ? {
                uid:
                  datosComerciante.uid,

                tiendaId:
                  datosComerciante.tiendaId,

                nombreTienda:
                  datosComerciante.nombreTienda ||
                  "",

                nombreComerciante:
                  datosComerciante.nombreComerciante ||
                  datosComerciante.nombre ||
                  "",

                nombre:
                  datosComerciante.nombre ||
                  "",

                email:
                  datosComerciante.email ||
                  "",

                telefono:
                  datosComerciante.telefono ||
                  "",

                direccion:
                  datosComerciante.direccion ||
                  "",

                ubicacion:
                  datosComerciante.ubicacion ||
                  {
                    lat: null,
                    lng: null,
                    direccion: "",
                    mapsUrl: ""
                  },

                tipoComerciante:
                  datosComerciante.tipoComerciante ||
                  "",

                foto:
                  datosComerciante.foto ||
                  "",

                activo:
                  datosComerciante.activo !==
                  false
              }
            : null,

        comercianteUid:
          tiendaId,

        comercianteNombre:
          datosComerciante?.nombreComerciante ||
          datosComerciante?.nombre ||
          "",

        comercianteEmail:
          datosComerciante?.email ||
          "",

        comercianteTelefono:
          datosComerciante?.telefono ||
          "",

        comercianteDireccion:
          datosComerciante?.direccion ||
          "",

        comercianteNombreTienda:
          datosComerciante?.nombreTienda ||
          "",

        comercianteTipo:
          datosComerciante?.tipoComerciante ||
          "",

        comercianteFoto:
          datosComerciante?.foto ||
          "",

        ubicacionComerciante:
          datosComerciante?.ubicacion ||
          null,

        /* PRODUCTOS */

        items:
          itemsEnriquecidos,

        /* VALORES */

        subtotal:
          subtotalFinal,

        envio:
          costoEnvio,

        servicio:
          servicioFijo,

        total:
          totalCalculado,

        /* ESTADO INICIAL */

        estado:
          "pendiente",

        /* PAGO */

        pago: {
          metodo:
            "contraentrega",

          estado:
            "pendiente",

          breakdown: {
            subtotal:
              subtotalFinal,

            envio:
              costoEnvio,

            servicio:
              servicioFijo,

            appFee:
              servicioFijo,

            total:
              totalCalculado
          }
        },

        breakdown: {
          subtotal:
            subtotalFinal,

          envio:
            costoEnvio,

          servicio:
            servicioFijo,

          appFee:
            servicioFijo,

          total:
            totalCalculado
        },

        createdAt:
          TS(),

        actualizadoEn:
          TS()
      };

      /* ------------------------------------------------------------------ */
      /* GUARDAR PEDIDO                                                      */
      /* ------------------------------------------------------------------ */

      const ref =
        await db
          .collection(
            "pedidos"
          )
          .add(
            pedido
          );

      /*
       * IMPORTANTE:
       * NO enviamos aquí la notificación.
       *
       * La única notificación de nuevo pedido
       * la genera onPedidoCreate.
       */

      return res
        .status(201)
        .json({
          ok: true,

          id:
            ref.id,

          total:
            totalCalculado,

          subtotal:
            subtotalFinal,

          envio:
            costoEnvio,

          servicio:
            servicioFijo,

          clienteUid:
            uid,

          clienteNombre:
            datosCliente.nombre,

          clienteEmail:
            datosCliente.email,

          clienteTelefono:
            datosCliente.telefono,

          clienteDireccion:
            datosCliente.direccion,

          ubicacionCliente:
            ubicacionClienteFinal,

          comerciante:
            datosComerciante,

          ubicacionComerciante:
            datosComerciante?.ubicacion ||
            null
        });
    } catch (e) {
      console.error(
        "POST /pedidos",
        e
      );

      return res
        .status(500)
        .json({
          error:
            "Error creando pedido"
        });
    }
  }
);

/* ========================================================================== */
/* ESTADO DEL PEDIDO - 🔥 VERSIÓN CORREGIDA                                 */
/* ========================================================================== */

app.post(
  "/pedidos/state",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const {
        pedidoId,
        estado,
        etaMin
      } =
        req.body || {};

      if (
        !pedidoId ||
        !estado
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Faltan parámetros"
          });
      }

      const ref =
        db
          .collection(
            "pedidos"
          )
          .doc(
            pedidoId
          );

      const snap =
        await ref.get();

      if (
        !snap.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Pedido no existe"
          });
      }

      const p =
        snap.data();

      /* ================================================================ */
      /* 🔥 VALIDACIÓN CORREGIDA - BUSCAR LA TIENDA DEL COMERCIANTE      */
      /* ================================================================ */

      // 1. Obtener el perfil del usuario autenticado
      const perfilSnap =
        await db
          .collection("perfiles")
          .doc(req.user.uid)
          .get();

      const perfil =
        perfilSnap.exists
          ? perfilSnap.data()
          : {};

      // 2. Verificar que sea comerciante
      if (
        !perfil ||
        String(perfil.tipo || "")
          .toLowerCase() !== "comerciante"
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "Solo los comerciantes pueden cambiar el estado del pedido"
          });
      }

      // 3. Obtener la tienda del comerciante (buscar por el campo 'uid')
      const tiendaQuery =
        await db
          .collection("tiendas")
          .where(
            "uid",
            "==",
            req.user.uid
          )
          .limit(1)
          .get();

      if (
        tiendaQuery.empty
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "No tienes una tienda registrada"
          });
      }

      const tienda =
        tiendaQuery.docs[0];

      const tiendaIdDelComerciante =
        tienda.id;

      // 4. Verificar que el pedido pertenece a esta tienda
      if (
        p.tiendaId !==
        tiendaIdDelComerciante
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "No autorizado para este pedido"
          });
      }

      // ✅ El usuario es el dueño legítimo de la tienda

      /* ================================================================ */
      /* VALIDACIÓN DE ESTADOS                                            */
      /* ================================================================ */

      const nuevoEstado =
        String(
          estado
        ).toLowerCase();

      const esCliente =
        p.uid ===
          req.user.uid ||
        p.clienteUid ===
          req.user.uid ||
        p.clienteId ===
          req.user.uid;

      /* ------------------------------------------------------------------ */
      /* COMERCIANTE - PUEDE CAMBIAR A ESTOS ESTADOS                        */
      /* ------------------------------------------------------------------ */

      const estadosComerciante =
        new Set([
          "pendiente",
          "aceptado",
          "enviado",
          "rechazado",
          "cancelado",
          "entregado"
        ]);

      if (
        !estadosComerciante.has(
          nuevoEstado
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Estado no permitido para comerciante"
          });
      }

      /* ------------------------------------------------------------------ */
      /* CLIENTE: SOLO PUEDE CONFIRMAR RECIBIDO                            */
      /* ------------------------------------------------------------------ */

      if (
        esCliente &&
        nuevoEstado ===
          "recibido"
      ) {
        if (
          String(
            p.estado || ""
          ).toLowerCase() !==
          "enviado"
        ) {
          return res
            .status(400)
            .json({
              ok: false,
              error:
                "El pedido todavía no está enviado"
            });
        }
      }

      /* ------------------------------------------------------------------ */
      /* ACTUALIZAR EL PEDIDO                                              */
      /* ------------------------------------------------------------------ */

      const appFee =
        SERVICIO_FIJO;

      const subtotalValue =
        Number(
          p.subtotal || 0
        );

      const envioValue =
        Number(
          p.envio || 0
        );

      const totalValue =
        subtotalValue +
        envioValue +
        appFee;

      const patch = {
        estado:
          nuevoEstado,

        breakdown: {
          subtotal:
            subtotalValue,

          envio:
            envioValue,

          appFee,

          servicio:
            appFee,

          total:
            totalValue
        },

        pago: {
          ...(p.pago || {}),

          breakdown: {
            subtotal:
              subtotalValue,

            envio:
              envioValue,

            appFee,

            servicio:
              appFee,

            total:
              totalValue
          },

          estado:
            p.pago?.estado ||
            "pendiente"
        },

        ...(etaMin
          ? {
              etaMin:
                Number(
                  etaMin
                )
            }
          : {}),

        actualizadoEn:
          TS()
      };

      await ref.set(
        patch,
        {
          merge: true
        }
      );

      return res.json({
        ok: true,

        estado:
          nuevoEstado,

        breakdown:
          patch.breakdown
      });
    } catch (e) {
      console.error(
        "POST /pedidos/state",
        e
      );

      res
        .status(500)
        .json({
          ok: false,
          error:
            "Error interno"
        });
    }
  }
);

/* ========================================================================== */
/* 🔥 CONFIRMAR RECIBIDO - CLIENTE (GENERACIÓN OBLIGATORIA DE SERVICIO $800) */
/* ========================================================================== */

app.post(
  "/pedidos/:pedidoId/confirmar-recibido",
  requireAuth,
  async (req, res) => {
    try {
      const pedidoId = req.params.pedidoId;
      const uid = req.user.uid;

      if (!pedidoId) {
        return res.status(400).json({
          ok: false,
          error: "Falta el ID del pedido"
        });
      }

      // Obtener el pedido
      const ref = db.collection("pedidos").doc(pedidoId);
      const snap = await ref.get();

      if (!snap.exists) {
        return res.status(404).json({
          ok: false,
          error: "Pedido no encontrado"
        });
      }

      const pedido = snap.data() || {};

      // 🔥 VERIFICAR QUE EL PEDIDO PERTENEZCA AL CLIENTE
      const esCliente =
        pedido.uid === uid ||
        pedido.clienteUid === uid ||
        pedido.clienteId === uid ||
        pedido.usuarioId === uid;

      if (!esCliente) {
        return res.status(403).json({
          ok: false,
          error: "No tienes permiso para confirmar este pedido"
        });
      }

      // 🔥 VERIFICAR QUE EL PEDIDO ESTÉ EN ESTADO "enviado"
      const estadoActual = String(pedido.estado || "").toLowerCase();

      if (estadoActual !== "enviado" && estadoActual !== "entregado" && estadoActual !== "listo") {
        return res.status(400).json({
          ok: false,
          error: `El pedido está en estado "${estadoActual}" y no puede confirmarse`
        });
      }

      // 🔥 VERIFICAR QUE NO ESTÉ YA CONFIRMADO
      if (pedido.clienteConfirmado === true) {
        return res.status(400).json({
          ok: false,
          error: "Este pedido ya fue confirmado"
        });
      }

      // ───────────────────────────────────────────────────────────────
      // 🟢 GENERAR SERVICIO MI TIENDITA ($800) - OBLIGATORIO
      // ───────────────────────────────────────────────────────────────
      // El servicio se crea ANTES de actualizar el pedido.
      // Si falla, NO se confirma el pedido.
      // ───────────────────────────────────────────────────────────────

      const servicioId = `PEDIDO_${pedidoId}`;
const servicioRef = db.collection('servicios_comerciante').doc(servicioId);

// ============================================================
// 🔐 IDEMPOTENCIA + CUENTA DE SERVICIOS DEL COMERCIANTE
// ============================================================
// Un pedido solamente puede generar UN servicio.
// Además mantenemos un resumen independiente por comerciante
// para poder sincronizar posteriormente:
// - Panel del comerciante
// - Torre de Control
// - Saldo / recargas
// - Alertas
// ============================================================

const servicioDoc = await servicioRef.get();

if (!servicioDoc.exists) {

  // ----------------------------------------------------------
  // Obtener datos del comerciante
  // ----------------------------------------------------------

  const comercianteSnapshot = await db
    .collection('tiendas')
    .doc(pedido.tiendaId)
    .get();

  const comercianteData = comercianteSnapshot.exists
    ? comercianteSnapshot.data()
    : {};

  // ----------------------------------------------------------
  // Obtener datos del cliente
  // ----------------------------------------------------------

  const clienteSnapshot = await db
    .collection('usuarios')
    .doc(pedido.clienteUid || pedido.uid || uid)
    .get();

  const clienteData = clienteSnapshot.exists
    ? clienteSnapshot.data()
    : {};

  // ----------------------------------------------------------
  // Datos principales
  // ----------------------------------------------------------

  const comercianteId = pedido.tiendaId;

  const clienteId =
    pedido.clienteUid ||
    pedido.uid ||
    uid;

  const montoServicio =
    parseInt(SERVICIO_FIJO) || 800;

  // ----------------------------------------------------------
  // Documento resumen de servicios del comerciante
  // ----------------------------------------------------------
  //
  // Este documento NO representa dinero bancario.
  //
  // Representa únicamente el estado operativo de los
  // servicios pendientes del comerciante.
  //
  // Más adelante aquí podremos conectar:
  // - saldo
  // - recargas
  // - consumos
  // - movimientos
  // ----------------------------------------------------------

  const resumenRef = db
    .collection('resumen_servicios_comerciante')
    .doc(comercianteId);

  // ----------------------------------------------------------
  // Obtener resumen actual
  // ----------------------------------------------------------

  const resumenDoc = await resumenRef.get();

  const resumenActual = resumenDoc.exists
    ? resumenDoc.data()
    : {};

  const serviciosPendientesActuales =
    Number(
      resumenActual.serviciosPendientes || 0
    );

  const totalPendienteActual =
    Number(
      resumenActual.totalPendiente || 0
    );

  // ----------------------------------------------------------
  // Nuevo contador
  // ----------------------------------------------------------

  const nuevoTotalServiciosPendientes =
    serviciosPendientesActuales + 1;

  const nuevoTotalPendiente =
    totalPendienteActual + montoServicio;

  // ----------------------------------------------------------
  // Crear servicio
  // ----------------------------------------------------------

  await servicioRef.set({

    pedidoId: pedidoId,

    comercianteId: comercianteId,

    tiendaNombre:
      comercianteData.nombre ||
      comercianteData.nombreTienda ||
      'Tienda',

    tiendaEmail:
      comercianteData.email || '',

    clienteId: clienteId,

    clienteNombre:
      pedido.clienteNombre ||
      clienteData.nombres ||
      'Cliente',

    clienteEmail:
      pedido.clienteEmail ||
      clienteData.email ||
      '',

    // ========================================================
    // 💰 SERVICIO DE LA PLATAFORMA
    // ========================================================

    monto: montoServicio,

    tipo: 'servicio_mi_tiendita',

    // Se mantiene pendiente.
    // NO significa que el comerciante haya pagado.
    estado: 'pendiente',

    // ========================================================
    // FECHAS
    // ========================================================

    fechaGenerado:
      admin.firestore.FieldValue.serverTimestamp(),

    fechaVencimiento: null,

    fechaPago: null,

    metodoPago: null,

    referenciaPago: null,

    // ========================================================
    // METADATOS DEL PEDIDO
    // ========================================================

    pedidoTotal:
      pedido.total || 0,

    pedidoProductos:
      pedido.items
        ? pedido.items.length
        : 0,

    generadoDesde:
      'confirmacion_cliente',

    // ========================================================
    // CONTROL
    // ========================================================

    servicioUnico: true,

    servicioId: servicioId,

    // Preparado para futura lógica de saldo
    descontadoDeSaldo: false,

    fechaDescuentoSaldo: null
  });

  console.log(
    `✅ Servicio ${servicioId} creado para pedido ${pedidoId}`
  );

  // ==========================================================
  // 📊 ACTUALIZAR RESUMEN DEL COMERCIANTE
  // ==========================================================
  //
  // Este documento será la fuente rápida para:
  //
  // PANEL COMERCIANTE
  // TORRE DE CONTROL
  // ALERTAS
  // FUTURO SISTEMA DE SALDO
  //
  // ==========================================================

  await resumenRef.set({

    comercianteId: comercianteId,

    // --------------------------------------------------------
    // Servicios pendientes actuales
    // --------------------------------------------------------

    serviciosPendientes:
      nuevoTotalServiciosPendientes,

    // --------------------------------------------------------
    // Valor acumulado pendiente
    // --------------------------------------------------------

    totalPendiente:
      nuevoTotalPendiente,

    // --------------------------------------------------------
    // Último servicio generado
    // --------------------------------------------------------

    ultimoServicioId:
      servicioId,

    ultimoPedidoId:
      pedidoId,

    // --------------------------------------------------------
    // Datos de referencia del comerciante
    // --------------------------------------------------------

    tiendaNombre:
      comercianteData.nombre ||
      comercianteData.nombreTienda ||
      'Tienda',

    tiendaEmail:
      comercianteData.email ||
      '',

    // --------------------------------------------------------
    // Hito de 8 servicios
    // --------------------------------------------------------

    limiteAlertaServicios:
      8,

    ultimoHitoServicios:
      nuevoTotalServiciosPendientes >= 8
        ? 8
        : nuevoTotalServiciosPendientes,

    // --------------------------------------------------------
    // Estado operativo
    // --------------------------------------------------------

    estadoCuenta:
      'pendiente',

    // --------------------------------------------------------
    // Preparación futura para saldo
    // --------------------------------------------------------

    saldoDisponible:
      Number(
        resumenActual.saldoDisponible || 0
      ),

    totalRecargado:
      Number(
        resumenActual.totalRecargado || 0
      ),

    totalDescontado:
      Number(
        resumenActual.totalDescontado || 0
      ),

    // --------------------------------------------------------
    // Auditoría
    // --------------------------------------------------------

    fechaActualizacion:
      admin.firestore.FieldValue.serverTimestamp(),

    creadoDesde:
      'confirmacion_cliente'
  }, {
    merge: true
  });

  // ==========================================================
  // 🔔 ALERTA AL LLEGAR A 8 SERVICIOS
  // ==========================================================
  //
  // IMPORTANTE:
  // No enviamos una alerta por cada servicio.
  //
  // La alerta se dispara cuando el comerciante alcanza
  // exactamente 8 servicios pendientes.
  //
  // ==========================================================

  if (nuevoTotalServiciosPendientes === 8) {

    const alertaId =
      `servicios_8_${comercianteId}`;

    const alertaRef = db
      .collection('notificaciones')
      .doc(comercianteId)
      .collection('items')
      .doc(alertaId);

    // --------------------------------------------------------
    // Evitar duplicar la alerta
    // --------------------------------------------------------

    const alertaExistente =
      await alertaRef.get();

    if (!alertaExistente.exists) {

      await alertaRef.set({

        uid: comercianteId,

        tipo:
          'servicios_pendientes',

        categoria:
          'servicios',

        titulo:
          '⚠️ Tienes 8 servicios pendientes',

        mensaje:
          'Has acumulado 8 servicios pendientes de la plataforma. El valor acumulado es de $6.400. Consulta el detalle de tus servicios.',

        serviciosPendientes:
          nuevoTotalServiciosPendientes,

        montoPendiente:
          nuevoTotalPendiente,

        pedidoId:
          pedidoId,

        servicioId:
          servicioId,

        leida:
          false,

        importante:
          true,

        fecha:
          admin.firestore.FieldValue.serverTimestamp(),

        createdAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(
        `🔔 Alerta de 8 servicios creada para comerciante ${comercianteId}`
      );

    } else {

      console.log(
        `ℹ️ La alerta de 8 servicios ya existe para comerciante ${comercianteId}`
      );

    }
  }

  // ==========================================================
  // 🔔 NOTIFICACIÓN OPERATIVA DEL SERVICIO
  // ==========================================================
  //
  // Conservamos una notificación individual del servicio.
  // Esto NO sustituye la alerta especial del octavo servicio.
  //
  // ==========================================================

  try {

    const notificacionServicioId =
      `servicio_${servicioId}`;

    const notificacionServicioRef =
      db
        .collection('notificaciones')
        .doc(comercianteId)
        .collection('items')
        .doc(notificacionServicioId);

    await notificacionServicioRef.set({

      uid: comercianteId,

      tipo:
        'servicio_generado',

      categoria:
        'servicios',

      titulo:
        '💰 Nuevo servicio registrado',

      mensaje:
        `Se ha registrado un servicio de $${montoServicio.toLocaleString('es-CO')} correspondiente al pedido #${pedidoId}.`,

      pedidoId:
        pedidoId,

      servicioId:
        servicioId,

      monto:
        montoServicio,

      estado:
        'pendiente',

      leida:
        false,

      importante:
        false,

      fecha:
        admin.firestore.FieldValue.serverTimestamp(),

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    console.log(
      `🔔 Notificación de servicio creada para comerciante ${comercianteId}`
    );

  } catch (notificacionError) {

    // --------------------------------------------------------
    // La notificación NO debe romper la creación del servicio.
    // --------------------------------------------------------

    console.warn(
      '⚠️ No se pudo crear la notificación del servicio:',
      notificacionError?.message ||
      notificacionError
    );
  }

} else {

  console.log(
    `ℹ️ Servicio ${servicioId} ya existe para pedido ${pedidoId}`
  );
}
      // ───────────────────────────────────────────────────────────────
      // ✅ ACTUALIZAR PEDIDO (SOLO DESPUÉS DE CREAR EL SERVICIO)
      // ───────────────────────────────────────────────────────────────

      await ref.update({
        clienteConfirmado: true,
        clienteConfirmadoAt: admin.firestore.FieldValue.serverTimestamp(),
        estado: "entregado",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
      });

      // ───────────────────────────────────────────────────────────────
      // 📨 NOTIFICACIONES
      // ───────────────────────────────────────────────────────────────

      const tiendaId = pedido.tiendaId;

      if (tiendaId) {
        // Notificación de servicio generado
        try {
          const notifRef = db
            .collection("notificaciones")
            .doc(tiendaId)
            .collection("items");

          await notifRef.add({
            tipo: "servicio_generado",
            pedidoId: pedidoId,
            tiendaId: tiendaId,
            titulo: "💰 Servicio generado",
            mensaje: `Se generó 1 servicio de $${SERVICIO_FIJO} para el pedido #${pedidoId.slice(-6).toUpperCase()}`,
            visto: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          console.log(`📨 Notificación de servicio generada para comerciante: ${tiendaId}`);

        } catch (notifError) {
          console.warn("Error guardando notificación de servicio:", notifError);
        }

        // Notificación de confirmación de recepción
        try {
          const notifRef = db
            .collection("notificaciones")
            .doc(tiendaId)
            .collection("items");

          await notifRef.add({
            tipo: "cliente_confirmo",
            pedidoId: pedidoId,
            tiendaId: tiendaId,
            titulo: "🎉 Cliente confirmó recepción",
            mensaje: `El cliente confirmó que recibió el pedido #${pedidoId.slice(-6).toUpperCase()}`,
            visto: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          console.log("📨 Notificación guardada para el comerciante:", tiendaId);

        } catch (notifError) {
          console.warn("Error guardando notificación:", notifError);
        }
      }

      return res.json({
        ok: true,
        pedidoId: pedidoId,
        estado: "entregado",
        clienteConfirmado: true,
        message: "Pedido confirmado correctamente"
      });

    } catch (error) {
      console.error("❌ Error confirmando recepción:", error);

      return res.status(500).json({
        ok: false,
        error: "Error confirmando recepción del pedido"
      });
    }
  }
);

/* ========================================================================== */
/* PAGO DEMO                                                                  */
/* ========================================================================== */

app.post(
  "/pedidos/:pedidoId/pay-demo",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const pedidoId =
        req.params.pedidoId;

      const snap =
        await db
          .collection(
            "pedidos"
          )
          .doc(
            pedidoId
          )
          .get();

      if (
        !snap.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "No existe"
          });
      }

      const p =
        snap.data();

      if (
        p.uid !==
        req.user.uid
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "Forbidden"
          });
      }

      const base =
        Number(
          p.subtotal || 0
        );

      const envio =
        Number(
          p.envio || 0
        );

      const appFee =
        SERVICIO_FIJO;

      const total =
        base +
        envio +
        appFee;

      await snap.ref.set(
        {
          pago: {
            ...(p.pago || {}),

            estado:
              "pagado",

            metodo:
              "demo",

            appFee,

            servicio:
              appFee,

            totalCobrado:
              total,

            pagadoEn:
              TS()
          },

          actualizadoEn:
            TS()
        },
        {
          merge: true
        }
      );

      res.json({
        ok: true,

        totalCobrado:
          total,

        appFee
      });
    } catch (e) {
      console.error(
        "pay-demo",
        e
      );

      res
        .status(500)
        .json({
          ok: false,
          error:
            "Error interno"
        });
    }
  }
);

/* ========================================================================== */
/* PAGO ONLINE                                                                */
/* ========================================================================== */

app.post(
  "/pedidos/:pedidoId/pay",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const pedidoId =
        req.params.pedidoId;

      const snap =
        await db
          .collection(
            "pedidos"
          )
          .doc(
            pedidoId
          )
          .get();

      if (
        !snap.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "No existe"
          });
      }

      const p =
        snap.data();

      if (
        p.uid !==
        req.user.uid
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "Forbidden"
          });
      }

      const redirectUrl =
        `https://httpbin.org/anything?pedido=${encodeURIComponent(
          pedidoId
        )}`;

      return res.json({
        redirectUrl
      });
    } catch (e) {
      console.error(
        "pay",
        e
      );

      res
        .status(500)
        .json({
          ok: false,
          error:
            "Error iniciando pago"
        });
    }
  }
);

/* ========================================================================== */
/* CATÁLOGO BASE                                                              */
/* ========================================================================== */

/* ========================================================================== */
/* CATEGORÍAS POR TIPO DE COMERCIANTE                                         */
/* ========================================================================== */

const CATEGORIAS_POR_TIPO = {
  tienda: [
  'ABARROTES', 'FRUTAS', 'VERDURAS', 'LACTEOS',
  'MECATOS', 'PANADERIA', 'CARNES', 'CONGELADOS',
  'LIMPIEZA', 'CUIDADO PERSONAL', 'BEBES', 'MASCOTAS',
  'HOGAR', 'BEBIDAS'
],
  
  licoreria: ['BEBIDAS', 'LICORES'],
  farmacia: ['MEDICAMENTOS', 'CUIDADO PERSONAL'],
  carniceria: ['CARNES'],
  verduleria: ['FRUTAS', 'VERDURAS']
};


const MAESTRO_COLL =
  "productos_base";

const TIENDAS_COLL =
  "tiendas";

const DEST_SUBCOLL =
  "productos";

const BATCH_LIMIT =
  450;

/* ========================================================================== */
/* COPIAR CATÁLOGO — VERSIÓN DEFINITIVA                                       */
/* ========================================================================== */
/*
 * CAMBIOS RESPECTO A LA VERSIÓN ANTERIOR:
 *
 * ✅ Solo escribe en tiendas/{uid}/productos (NO en productos/ raíz)
 * ✅ ID determinístico (mismo producto = mismo ID por tienda)
 * ✅ Idempotente (no duplica si ya está sembrado)
 * ✅ Normaliza nombre + nombreBase + precio + imagen
 * ✅ Salta productos inválidos (sin nombre o precio 0)
 * ✅ Fuente: catalogos/{tipo}/productos (fallback a productos_base)
 * ✅ Guarda marca de catálogo sembrado en la tienda
 * ✅ Normaliza "licores"/"licorería" → "licoreria" antes de buscar
 * ✅ FILTRA CATEGORÍAS SIEMPRE (no solo cuando fuente es productos_base)
 * ✅ Marca "en_proceso" al inicio para evitar doble siembra
 * ✅ NO pisa precio en productos existentes (salvo overwrite explícito)
 * ========================================================================== */

async function copyBaseToStore(
  tiendaId,
  {
    overwrite = false,
    tipoComerciante = 'tienda'
  } = {}
) {
  if (!tiendaId) {
    throw new Error('Falta tiendaId');
  }

  // 🔥 NORMALIZACIÓN DE TIPO
  const tipoOriginal = String(
    tipoComerciante || "tienda"
  )
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const tipo = ["licoreria", "licores"].includes(tipoOriginal)
    ? "licoreria"
    : tipoOriginal;

  if (!["tienda", "licoreria"].includes(tipo)) {
    throw new Error(
      `Tipo de comerciante no compatible: ${tipoOriginal}`
    );
  }

  const tiendaRef = db.collection('tiendas').doc(tiendaId);
  const tiendaSnap = await tiendaRef.get();

  // IDEMPOTENCIA: si ya está sembrado o en proceso y no es overwrite,
  // no hacer nada.
  const estadoSeed =
    tiendaSnap.exists
      ? tiendaSnap.data()?.catalogoSembrado
      : null;

  if (
    (estadoSeed === true || estadoSeed === 'en_proceso') &&
    !overwrite
  ) {
    console.log(
      `[seed] ${tiendaId} ya está ${estadoSeed}. Skip.`
    );
    return {
      copied: 0,
      skipped: 0,
      totalBase: 0,
      tipo,
      yaSembrado: true
    };
  }

  // 🔒 MARCAR "en_proceso" ANTES DE EMPEZAR
  // Así, si algo falla a mitad, un reintento no vuelve a sembrar.
  await tiendaRef.set(
    {
      catalogoSembrado: 'en_proceso',
      seedStartedAt: TS()
    },
    { merge: true }
  );

  // Fuente: catalogos/{tipo}/productos (fallback a productos_base)
  let baseDocs = [];
  let fuente = `catalogos/${tipo}/productos`;

  const catSnap = await db
    .collection('catalogos')
    .doc(tipo)
    .collection('productos')
    .get();

  baseDocs = catSnap.docs;

  if (baseDocs.length === 0) {
    const baseSnap = await db.collection('productos_base').get();
    baseDocs = baseSnap.docs;
    fuente = 'productos_base';
  }

  if (baseDocs.length === 0) {
    console.warn(`[seed] Sin fuente de catálogo para tipo=${tipo}`);

    // Si no hay fuente, marcamos sembrado para no reintentar en bucle
    await tiendaRef.set(
      {
        catalogoSembrado: true,
        seeded: true,
        productosSembrados: 0,
        seedStartedAt: null,
        actualizadoEn: TS()
      },
      { merge: true }
    );

    return {
      copied: 0,
      skipped: 0,
      totalBase: 0,
      tipo,
      error: 'sin_fuente'
    };
  }

  // Categorías permitidas para este tipo
  const permitidas =
    CATEGORIAS_POR_TIPO[tipo] ||
    CATEGORIAS_POR_TIPO.tienda;

  const productosRef = tiendaRef.collection('productos');
  const existentesSnap = await productosRef.get();
  const existentes = new Set(
    existentesSnap.docs.map(d => d.id)
  );

  let batch = db.batch();
  let ops = 0;
  let copied = 0;
  let skipped = 0;

  for (const docBase of baseDocs) {
    const data = docBase.data() || {};

    // 🔥 FILTRAR SIEMPRE POR CATEGORÍA (sin importar la fuente)
    const cat = String(data.categoria || '')
      .toUpperCase()
      .trim();

    if (!permitidas.includes(cat)) {
      skipped++;
      continue;
    }

    const id = docBase.id;

    if (!overwrite && existentes.has(id)) {
      skipped++;
      continue;
    }

    // Normalizar nombre y precio
    const nombre = String(
      data.nombreBase || data.nombre || ''
    ).trim();

    const precio = Number(data.precio) || 0;

    // No sembrar basura
    if (!nombre || precio <= 0) {
      skipped++;
      continue;
    }

    const imagenUrl = String(
      data.imagenUrl || data.imagen || ''
    ).trim();

    const producto = {
      nombre,
      nombreBase: nombre,
      categoria: data.categoria || '',
      subcategoria: data.subcategoria || '',
      marca: data.marca || '',
      variante: data.variante || '',
      presentacion: data.presentacion || '',
      unidadBase: data.unidadBase || '',
      precio,
      imagenUrl,
      imagen: imagenUrl,
      activo: data.activo !== false,
      volumenMl: data.volumenMl ?? null,
      pesoKg: data.pesoKg ?? null,
      stock: data.stock ?? 1000,
      origen: 'catalogo_base',
      baseCollection: fuente,
      tipoComerciante: tipo,
      tiendaId,
      productoId: id,
      creadoEn: data.creadoEn || TS(),
      actualizadoEn: TS()
    };

    // ⚠️ SOLO escritura en la subcolección. NO en productos/ raíz.
    // Si es overwrite, actualizar sin tocar precio.
    if (!overwrite) {
      batch.set(
        productosRef.doc(id),
        producto,
        { merge: true }
      );
    } else {
      // Reseed explícito: actualizar todo MENOS precio
      const { precio: _omit, ...sinPrecio } = producto;
      batch.set(
        productosRef.doc(id),
        sinPrecio,
        { merge: true }
      );
    }

    copied++;
    ops++;

    if (ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
  }

  // Marcar la tienda como sembrada
  await tiendaRef.set(
    {
      catalogoSembrado: true,
      seeded: true,
      productosSembrados: copied,
      tipoComerciante: tipo,
      seedStartedAt: null,
      actualizadoEn: TS()
    },
    { merge: true }
  );

  console.log(
    `[seed] ${tiendaId} → ${copied} productos (${fuente})`
  );

  return {
    copied,
    skipped,
    totalBase: baseDocs.length,
    tipo,
    fuente
  };
}

/* ========================================================================== */
/* ENSURE SEED                                                                */
/* ========================================================================== */

app.post(
  "/tools/ensure-seed/:tiendaId",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const tiendaId =
        req.params.tiendaId;

      if (!tiendaId) {
        return res
          .status(400)
          .json({
            error:
              "Falta tiendaId"
          });
      }

      const yaHay =
        await db
          .collection(
            "tiendas"
          )
          .doc(tiendaId)
          .collection(
            "productos"
          )
          .limit(1)
          .get();

      if (
        !yaHay.empty
      ) {
        return res.json({
          ok: true,
          seeded: false,
          reason:
            "ya_tiene_productos"
        });
      }

                      const tiendaSnapTipo =
        await db
          .collection("tiendas")
          .doc(tiendaId)
          .get();

      const tipoTienda =
        String(
          tiendaSnapTipo.data()?.tipoComerciante ||
          "tienda"
        ).toLowerCase();

      const r =
        await copyBaseToStore(
          tiendaId,
          {
            overwrite:
              false,
            tipoComerciante:
              tipoTienda
          }
        );

      res.json({
        ok: true,
        seeded: true,
        ...r
      });
    } catch (e) {
      console.error(
        "ensure-seed",
        e
      );

      res
        .status(500)
        .json({
          error:
            e.message ||
            "Error"
        });
    }
  }
);

/* ========================================================================== */
/* RESEED BASE                                                                */
/* ========================================================================== */

app.post(
  "/tools/reseed-base/:tiendaId",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      const tiendaId =
        req.params.tiendaId;

      const overwrite =
        String(
          req.query.overwrite ||
          "false"
        ) === "true";

            
               const tiendaSnapTipo2 =
        await db
          .collection("tiendas")
          .doc(tiendaId)
          .get();

      const tipoTienda2 =
        String(
          tiendaSnapTipo2.data()?.tipoComerciante ||
          "tienda"
        ).toLowerCase();

      const r =
        await copyBaseToStore(
          tiendaId,
          {
            overwrite,
            tipoComerciante:
              tipoTienda2
          }
        );
      res.json({
        ok: true,
        ...r
      });
    } catch (e) {
      res
        .status(500)
        .json({
          error:
            e.message ||
            "Error"
        });
    }
  }
);

/* ========================================================================== */
/* TRIGGER: NUEVO PEDIDO                                                      */
/* ========================================================================== */

export const onPedidoCreate =
  fns.firestore
    .document(
      "pedidos/{pedidoId}"
    )
    .onCreate(
      async (
        snap,
        ctx
      ) => {
        const pedido =
          snap.data();

        const pedidoId =
          ctx.params.pedidoId;

        if (
          !pedido ||
          !pedido.tiendaId
        ) {
          return null;
        }

        const tiendaId =
          pedido.tiendaId;

        const clienteNombre =
          pedido.clienteNombre ||
          pedido.cliente?.nombre ||
          "Un cliente";

        const total =
          Number(
            pedido.total ||
            pedido.subtotal ||
            0
          );

        /* -------------------------------------------------------------- */
        /* UNA SOLA NOTIFICACIÓN AL COMERCIANTE                           */
        /* -------------------------------------------------------------- */

        await db
          .collection(
            "notificaciones"
          )
          .doc(tiendaId)
          .collection(
            "items"
          )
          .add({
            tipo:
              "pedido_nuevo",

            pedidoId,

            tiendaId,

            uid:
              pedido.uid ||
              pedido.clienteUid ||
              "",

            clienteUid:
              pedido.clienteUid ||
              pedido.uid ||
              "",

            titulo:
              "Nuevo pedido",

            mensaje:
              `${clienteNombre} realizó el pedido ${shortId(
                pedidoId
              )} por $${total.toLocaleString(
                "es-CO"
              )}.`,

            visto:
              false,

            createdAt:
              TS()
          });

        const tokenTienda =
          await getTokenTienda(
            tiendaId
          );

        const payload = {
          title:
            "Nuevo pedido",

          body:
            `${clienteNombre} realizó el pedido ${shortId(
              pedidoId
            )}.`
        };

        const data = {
          tipo:
            "pedido_nuevo",

          pedidoId,

          tiendaId
        };

        if (
          tokenTienda
        ) {
          await sendPush(
            [tokenTienda],
            payload,
            data
          );
        } else {
          await sendPushToUser(
            tiendaId,
            payload,
            data
          );
        }

        return null;
      }
    );

/* ========================================================================== */
/* TRIGGER: CAMBIO ESTADO PEDIDO                                             */
/* ========================================================================== */

export const onPedidoUpdate =
  fns.firestore
    .document(
      "pedidos/{pedidoId}"
    )
    .onUpdate(
      async (
        change,
        ctx
      ) => {
        const before =
          change.before.data() ||
          {};

        const after =
          change.after.data() ||
          {};

        const pedidoId =
          ctx.params.pedidoId;

        const estadoAntes =
          String(
            before.estado ||
            ""
          ).toLowerCase();

        const estadoDespues =
          String(
            after.estado ||
            ""
          ).toLowerCase();

        if (
          estadoAntes ===
          estadoDespues
        ) {
          return null;
        }

        const tiendaId =
          after.tiendaId;

        const clienteUid =
          after.clienteUid ||
          after.uid ||
          after.clienteId;

        /* ================================================================ */
        /* COMERCIANTE -> ENVIADO -> CLIENTE                               */
        /* ================================================================ */

        if (
          estadoDespues ===
          "enviado"
        ) {
          if (
            !clienteUid
          ) {
            return null;
          }

          const titulo =
            "Pedido enviado 📦";

          const mensaje =
            `El pedido ${shortId(
              pedidoId
            )} ya fue enviado. Cuando lo recibas, confírmalo.`;

          await db
            .collection(
              "notificaciones"
            )
            .doc(
              clienteUid
            )
            .collection(
              "items"
            )
            .add({
              tipo:
                "pedido_enviado",

              pedidoId,

              tiendaId,

              estado:
                "enviado",

              titulo,

              mensaje,

              visto:
                false,

              createdAt:
                TS()
            });

          const tokenCliente =
            await getTokenPerfil(
              clienteUid
            );

          const data = {
            tipo:
              "pedido_enviado",

            pedidoId,

            tiendaId:
              String(
                tiendaId || ""
              ),

            estado:
              "enviado"
          };

          if (
            tokenCliente
          ) {
            await sendPush(
              [tokenCliente],
              {
                title:
                  titulo,

                body:
                  mensaje
              },
              data
            );
          } else {
            await sendPushToUser(
              clienteUid,
              {
                title:
                  titulo,

                body:
                  mensaje
              },
              data
            );
          }

          return null;
        }

        /* ================================================================ */
        /* CLIENTE -> RECIBIDO -> COMERCIANTE                              */
        /* ================================================================ */

        if (
          estadoDespues ===
          "recibido"
        ) {
          if (
            !tiendaId
          ) {
            return null;
          }

          const titulo =
            "Pedido recibido ✅";

          const clienteNombre =
            after.clienteNombre ||
            after.cliente?.nombre ||
            "El cliente";

          const mensaje =
            `${clienteNombre} confirmó que recibió el pedido ${shortId(
              pedidoId
            )}.`;

          await db
            .collection(
              "notificaciones"
            )
            .doc(tiendaId)
            .collection(
              "items"
            )
            .add({
              tipo:
                "pedido_recibido",

              pedidoId,

              tiendaId,

              estado:
                "recibido",

              clienteUid,

              titulo,

              mensaje,

              visto:
                false,

              createdAt:
                TS()
            });

          const tokenTienda =
            await getTokenTienda(
              tiendaId
            );

          const data = {
            tipo:
              "pedido_recibido",

            pedidoId,

            tiendaId:
              String(
                tiendaId
              ),

            estado:
              "recibido",

            clienteUid:
              String(
                clienteUid || ""
              )
          };

          if (
            tokenTienda
          ) {
            await sendPush(
              [tokenTienda],
              {
                title:
                  titulo,

                body:
                  mensaje
              },
              data
            );
          } else {
            await sendPushToUser(
              tiendaId,
              {
                title:
                  titulo,

                body:
                  mensaje
              },
              data
            );
          }

          return null;
        }

        /*
         * NINGÚN OTRO CAMBIO DE ESTADO
         * GENERA NOTIFICACIÓN.
         */

        return null;
      }
    );

/* ========================================================================== */
/* LIMPIEZA DE NOTIFICACIONES                                                 */
/* ========================================================================== */

export const cleanupNotificaciones =
  fns.pubsub
    .schedule(
      "every 24 hours"
    )
    .onRun(
      async () => {
        const THIRTY_DAYS =
          30 *
          24 *
          60 *
          60 *
          1000;

        const cutoff =
          admin.firestore.Timestamp.fromMillis(
            Date.now() -
              THIRTY_DAYS
          );

        const batchSize =
          400;

        let total = 0;

        while (true) {
          const q =
            await db
              .collectionGroup(
                "items"
              )
              .where(
                "createdAt",
                "<",
                cutoff
              )
              .limit(
                batchSize
              )
              .get();

          if (
            q.empty
          ) {
            break;
          }

          const batch =
            db.batch();

          q.docs.forEach(
            (d) =>
              batch.delete(
                d.ref
              )
          );

          await batch.commit();

          total +=
            q.size;

          if (
            q.size <
            batchSize
          ) {
            break;
          }
        }

        console.log(
          `[cleanupNotificaciones] eliminadas: ${total}`
        );
      }
    );



/* ========================================================================== */
/* SEED AL CREAR TIENDA                                                       */
/* ========================================================================== */
/* ✅ CAMBIO: acepta TODOS los tipos de comercio (no solo "tienda").         */
/* Es el ÚNICO trigger que siembra el catálogo.                             */
/* ✅ Normaliza "licores"/"licorería" → "licoreria" antes de sembrar.        */
/* ✅ Acepta 'en_proceso' además de true como estado de idempotencia.        */
/* ========================================================================== */

export const seedBaseOnStoreCreate =
  fns.firestore
    .document(
      `${TIENDAS_COLL}/{tiendaId}`
    )
    .onCreate(
      async (
        snap,
        ctx
      ) => {
        const tiendaId =
          ctx.params.tiendaId;

        const data =
          snap.data() || {};

        // 🔥 NORMALIZACIÓN DE TIPO
        const tipoOriginal = String(
          data.tipoComerciante ||
          data.categoria ||
          "tienda"
        )
          .toLowerCase()
          .trim()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        const tipo = ["licoreria", "licores"].includes(tipoOriginal)
          ? "licoreria"
          : tipoOriginal;

        if (!["tienda", "licoreria"].includes(tipo)) {
          console.warn(
            "[seedBaseOnStoreCreate] Tipo no compatible:",
            tipoOriginal
          );
          return null;
        }

        // Idempotencia: si ya está sembrado o en proceso, no hacer nada
        if (
          data.catalogoSembrado === true ||
          data.catalogoSembrado === 'en_proceso'
        ) {
          return null;
        }

        // Verificar si ya hay productos (por si acaso)
        const yaHay =
          await db
            .collection(
              TIENDAS_COLL
            )
            .doc(tiendaId)
            .collection(
              DEST_SUBCOLL
            )
            .limit(1)
            .get();

        if (!yaHay.empty) {
          await db
            .collection(
              TIENDAS_COLL
            )
            .doc(tiendaId)
            .set(
              {
                catalogoSembrado: true,
                seeded: true,
                actualizadoEn: TS()
              },
              { merge: true }
            );
          return null;
        }

        const r =
          await copyBaseToStore(
            tiendaId,
            {
              overwrite: false,
              tipoComerciante: tipo
            }
          );

        console.log(
          "[seedBaseOnStoreCreate]",
          tiendaId,
          r
        );

        return null;
      }
    );

/* ========================================================================== */
/* ELIMINAR CUENTA                                                            */
/* ========================================================================== */

export const eliminarCuenta =
  fns.https.onCall(
    async (
      data,
      context
    ) => {

      /* -------------------------------------------------------------------- */
      /* 🔐 AUTENTICACIÓN                                                     */
      /* -------------------------------------------------------------------- */

      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "Debes iniciar sesión para eliminar tu cuenta"
        );
      }

      /* -------------------------------------------------------------------- */
      /* 🆔 UID DEL USUARIO AUTENTICADO                                      */
      /* -------------------------------------------------------------------- */

      const uid =
        context.auth.uid;

      console.log(
        `🗑️ Iniciando eliminación de cuenta: ${uid}`
      );

      try {

        /* ------------------------------------------------------------------ */
        /* 1️⃣ ELIMINAR TOKENS FCM                                            */
        /* ------------------------------------------------------------------ */

        const tokensSnap =
          await db
            .collection("tokens")
            .where(
              "uid",
              "==",
              uid
            )
            .get();

        if (!tokensSnap.empty) {

          let batch =
            db.batch();

          let contador =
            0;

          for (
            const tokenDoc of tokensSnap.docs
          ) {

            batch.delete(
              tokenDoc.ref
            );

            contador++;

            if (
              contador >= 400
            ) {
              await batch.commit();

              batch =
                db.batch();

              contador =
                0;
            }
          }

          if (
            contador > 0
          ) {
            await batch.commit();
          }
        }

        console.log(
          `🗑️ Tokens eliminados: ${tokensSnap.size}`
        );


        /* ------------------------------------------------------------------ */
        /* 2️⃣ ELIMINAR NOTIFICACIONES                                        */
        /* ------------------------------------------------------------------ */

        const notificacionesRef =
          db
            .collection("notificaciones")
            .doc(uid);

        if (
          typeof db.recursiveDelete ===
          "function"
        ) {

          await db.recursiveDelete(
            notificacionesRef
          );

        } else {

          await notificacionesRef
            .delete()
            .catch(
              () => {}
            );
        }


        /* ------------------------------------------------------------------ */
        /* 3️⃣ ELIMINAR INBOX                                                 */
        /* ------------------------------------------------------------------ */

        const inboxRef =
          db
            .collection("inbox")
            .doc(uid);

        if (
          typeof db.recursiveDelete ===
          "function"
        ) {

          await db.recursiveDelete(
            inboxRef
          );

        } else {

          await inboxRef
            .delete()
            .catch(
              () => {}
            );
        }


        /* ------------------------------------------------------------------ */
        /* 4️⃣ ELIMINAR PERFIL                                                 */
        /* ------------------------------------------------------------------ */

        await db
          .collection("perfiles")
          .doc(uid)
          .delete()
          .catch(
            () => {}
          );


        /* ------------------------------------------------------------------ */
        /* 5️⃣ ELIMINAR USUARIO                                                */
        /* ------------------------------------------------------------------ */

        await db
          .collection("usuarios")
          .doc(uid)
          .delete()
          .catch(
            () => {}
          );


        /* ------------------------------------------------------------------ */
        /* 6️⃣ COMPROBAR SI TIENE TIENDA                                      */
        /* ------------------------------------------------------------------ */

        const tiendaRef =
          db
            .collection("tiendas")
            .doc(uid);

        const tiendaSnap =
          await tiendaRef.get();


        /* ------------------------------------------------------------------ */
        /* 7️⃣ SI ES COMERCIANTE, ELIMINAR SU TIENDA                         */
        /* ------------------------------------------------------------------ */

        if (
          tiendaSnap.exists
        ) {

          if (
            typeof db.recursiveDelete ===
            "function"
          ) {

            await db.recursiveDelete(
              tiendaRef
            );

          } else {

            await tiendaRef
              .delete()
              .catch(
                () => {}
              );
          }

          console.log(
            `🏪 Tienda eliminada: ${uid}`
          );
        }


        /* ------------------------------------------------------------------ */
        /* 8️⃣ ELIMINAR CUENTA DE FIREBASE AUTH                               */
        /* ------------------------------------------------------------------ */

        await admin
          .auth()
          .deleteUser(
            uid
          );


        /* ------------------------------------------------------------------ */
        /* 9️⃣ CONFIRMACIÓN                                                   */
        /* ------------------------------------------------------------------ */

        console.log(
          `✅ Cuenta eliminada correctamente: ${uid}`
        );

        return {
          ok: true,
          message:
            "Tu cuenta fue eliminada correctamente"
        };

      } catch (error) {

        console.error(
          `❌ Error eliminando cuenta ${uid}:`,
          error
        );

        throw new functions.https.HttpsError(
          "internal",
          "No fue posible eliminar la cuenta completamente"
        );
      }
    }
  );


/* ========================================================================== */
/* EXPORTAR EXPRESS                                                           */
/* ========================================================================== */

export const api =
  fns.https.onRequest(
    app
  );


/* ========================================================================== */
/* LOGS                                                                       */
/* ========================================================================== */

console.log(
  "✅ Cloud Functions listas"
);

console.log(
  "🔥 SERVICIO FIJO: $800 COP por pedido"
);

console.log(
  "🔥 DATOS COMPLETOS DEL CLIENTE Y COMERCIANTE EN EL PEDIDO"
);

console.log(
  "🔥 NOTIFICACIONES: NUEVO PEDIDO → ENVIADO → RECIBIDO"
);

console.log(
  "🔥 CLIENTE SOLO PUEDE CONFIRMAR RECIBIDO DESPUÉS DE ENVIADO"
);

console.log(
  "🔥 CONFIRMACIÓN: POST /pedidos/:pedidoId/confirmar-recibido"
);

console.log(
  "🔥 GENERACIÓN OBLIGATORIA DE SERVICIO $800 ANTES DE CONFIRMAR"
);

console.log(
  "🔐 AUTORIZACIÓN CORREGIDA: Comerciante valida por dueño de tienda"
);

console.log(
  "🌱 SEED: copyBaseToStore idempotente + seedBaseOnStoreCreate (único)"
);

console.log(
  "🍾 NORMALIZACIÓN: licores/licorería → licoreria en seed"
);

console.log(
  "🧱 FILTRO DE CATEGORÍAS: se aplica SIEMPRE (no solo con productos_base)"
);

console.log(
  "🔒 EN_PROCESO: marca al inicio para evitar doble siembra"
);

console.log(
  "💾 PRECIOS: no se pisan en productos existentes (salvo overwrite)"
);