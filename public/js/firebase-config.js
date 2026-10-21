// public/js/firebase-config.js

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore
  // ❌ Persistencia IndexedDB desactivada
  // enableIndexedDbPersistence,
  // enableMultiTabIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

import {
  getFunctions
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";


/* ============================================================================
   ⚠️ CONFIGURACIÓN DE TU PROYECTO FIREBASE
============================================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyCKTIItYQ-FRvTyq6iF7KeNMTeeQNK1e9Y",
  authDomain: "mi-tiendita-cercana.firebaseapp.com",
  projectId: "mi-tiendita-cercana",
  storageBucket: "mi-tiendita-cercana.appspot.com",
  messagingSenderId: "573896078459",
  appId: "1:573896078459:web:f788745bde9c35d61e1ede",
  measurementId: "G-WW5XVRY1ZR"
};


/* ============================================================================
   🔥 APP ÚNICA
   ---------------------------------------------------------------------------
   Reutiliza la aplicación Firebase si ya fue inicializada.
============================================================================ */

export const app =
  getApps().length
    ? getApp()
    : initializeApp(firebaseConfig);


/* ============================================================================
   🔐 SERVICIOS BASE
============================================================================ */

export const auth = getAuth(app);

export const db = getFirestore(app);

export const storage = getStorage(app);


/* ============================================================================
   ☁️ CLOUD FUNCTIONS
   ---------------------------------------------------------------------------
   IMPORTANTE:
   Tu functions/index.js trabaja en:

       southamerica-east1

   Por eso el frontend debe conectarse explícitamente a esa misma región.
============================================================================ */

export const functions = getFunctions(
  app,
  "southamerica-east1"
);


/* ============================================================================
   🌎 IDIOMA DE FIREBASE AUTH
============================================================================ */

try {
  auth.useDeviceLanguage?.();
} catch {}


/* ============================================================================
   🔥 PERSISTENCIA DE FIRESTORE DESACTIVADA
   ---------------------------------------------------------------------------
   Se mantiene desactivada para evitar errores como:

       QuotaExceededError

   y problemas de almacenamiento/localStorage.

   Firestore funcionará en modo memoria durante la sesión.
============================================================================ */

// ❌ NO ACTIVAR POR AHORA:
//
// try {
//   await enableMultiTabIndexedDbPersistence(db);
// } catch (e1) {
//   try {
//     await enableIndexedDbPersistence(db, {
//       experimentalForceOwningTab: true
//     });
//   } catch (e2) {
//     console.info(
//       "[Firestore] Persistencia deshabilitada (memoria). Motivo:",
//       e2?.code || e2
//     );
//   }
// }

console.log(
  "🔥 Firestore configurado SIN persistencia (modo memoria)"
);


/* ============================================================================
   📊 ANALYTICS — OPCIONAL
============================================================================ */

try {
  const {
    getAnalytics,
    isSupported
  } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js"
  );

  if (await isSupported()) {
    getAnalytics(app);
  }

} catch {}


/* ============================================================================
   📦 RE-EXPORTS FIRESTORE
   ---------------------------------------------------------------------------
   Se mantienen para no romper los demás archivos del proyecto.
============================================================================ */

export {
  collection,
  collectionGroup,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  updateDoc,
  doc,
  where,
  getDoc,
  setDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


/* ============================================================================
   🔐 RE-EXPORTS AUTH
   ---------------------------------------------------------------------------
   Se mantienen para compatibilidad con el resto del proyecto.
============================================================================ */

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";


/* ============================================================================
   🧪 EMULADORES — OPCIONAL / DESACTIVADO
   ---------------------------------------------------------------------------

   Si en algún momento trabajamos con Firebase Emulator Suite,
   este bloque puede activarse.

============================================================================ */

/*
import {
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";


if (location.hostname === "localhost") {

  connectAuthEmulator(
    auth,
    "http://localhost:9099"
  );

  connectFirestoreEmulator(
    db,
    "localhost",
    8080
  );

  connectStorageEmulator(
    storage,
    "localhost",
    9199
  );

}
*/