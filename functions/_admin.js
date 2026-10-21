// functions/_admin.js

import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
  console.log("[admin] Inicializado con credenciales por defecto");
}

export const db = admin.firestore();

export const TS = admin.firestore.FieldValue.serverTimestamp;

export default admin;