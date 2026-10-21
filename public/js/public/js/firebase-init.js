// public/js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// 👇 Pega aquí TU CONFIG de Firebase (la misma que usas en index.html)
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "XXXXXXX",
  appId: "1:XXXXXXX:web:YYYYYY"
};

export const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);

// Helper opcional: asegura sesión (si no hay, abre Google)
export function ensureLogin() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (u) => {
      if (u) return resolve(u);
      try {
        const prov = new GoogleAuthProvider();
        const { user } = await signInWithPopup(auth, prov);
        resolve(user);
      } catch (e) { reject(e); }
    });
  });
}
