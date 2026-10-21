// public/js/registro.js
// ============================================================
// REGISTRO SEGURO Y SEPARADO
// CLIENTE ≠ COMERCIANTE
// CON VERIFICACIÓN DE CORREO Y CELULAR (SMS)
// ============================================================
// FLUJO CORREGIDO:
//   1. Crear cuenta email/password
//   2. Enviar correo de verificación
//   3. Guardar perfil en Firestore  ← ANTES del SMS
//   4. Verificar SMS (mismo UID, sesión activa)
//   5. Cerrar sesión
// ============================================================

import {
  auth,
  db
} from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  signOut,
  RecaptchaVerifier,
  PhoneAuthProvider,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ============================================================
   HELPERS
============================================================ */

const $ = (selector) => document.querySelector(selector);

const form = $("#form-registro");
const msgBox = $("#registro-mensaje");
const loader = $("#loader");

function showMsg(text = "", type = "info") {
  if (!msgBox) return;

  msgBox.textContent = text;
  msgBox.className = "message " + (type || "info");
  msgBox.style.display = text ? "block" : "none";
}

function setLoading(on, text = "Procesando…") {
  if (!loader) return;

  loader.classList.toggle("hidden", !on);

  const loaderText = loader.querySelector(".loader-text");

  if (loaderText) {
    loaderText.textContent = text;
  }
}

/* ============================================================
   ERRORES FIREBASE
============================================================ */

function mapFirebaseAuthError(code) {
  switch (code) {

    case "auth/email-already-in-use":
      return "Ese correo ya está registrado. Si ya tienes una cuenta, inicia sesión.";

    case "auth/invalid-email":
      return "El correo electrónico no es válido.";

    case "auth/weak-password":
      return "La contraseña es demasiado débil. Usa mínimo 6 caracteres.";

    case "auth/network-request-failed":
      return "No hay conexión con Firebase. Revisa tu conexión a Internet.";

    case "auth/too-many-requests":
      return "Se realizaron demasiados intentos. Espera unos minutos e inténtalo nuevamente.";

    case "auth/operation-not-allowed":
      return "El registro con correo y contraseña no está habilitado en Firebase.";

    case "auth/invalid-phone-number":
      return "El número de celular no es válido. Usa formato +57XXXXXXXXXX.";

    case "auth/missing-phone-number":
      return "Falta el número de celular.";

    case "auth/invalid-verification-code":
      return "El código SMS es incorrecto. Inténtalo de nuevo.";

    case "auth/code-expired":
      return "El código SMS expiró. Solicita uno nuevo.";

    case "auth/credential-already-in-use":
      return "Ese número de celular ya está asociado a otra cuenta.";

    case "auth/provider-already-linked":
      return "Ese celular ya está vinculado a tu cuenta.";

    default:
      return null;
  }
}

/* ============================================================
   NORMALIZADORES
============================================================ */

function normalizarTexto(valor) {
  return String(valor || "").trim();
}

function normalizarEmail(valor) {
  return normalizarTexto(valor).toLowerCase();
}

function normalizarCelularE164(valor) {
  let limpio = String(valor || "").replace(/\D/g, "");

  if (limpio.startsWith("57") && limpio.length === 12) {
    limpio = limpio.substring(2);
  }

  if (limpio.length === 10) {
    return "+57" + limpio;
  }

  if (String(valor).startsWith("+")) {
    return "+" + limpio;
  }

  return "+" + limpio;
}

/* ============================================================
   TIPOS PERMITIDOS
============================================================ */

const TIPOS_USUARIO = new Set(["cliente", "comerciante"]);

const TIPOS_COMERCIO = new Set([
  "tienda",
  "carniceria",
  "farmacia",
  "frutas_verduras",
  "licoreria"
]);

const TIPOS_DOCUMENTO = new Set([
  "CC",
  "CE",
  "PA"
]);

/* ============================================================
   🗺️ MAPA DE UBICACIÓN EN EL REGISTRO (COMERCIANTE)
   -----------------------------------------------------------
   - Se inicializa cuando el usuario elige "Comerciante".
   - El comerciante puede:
       * Pulsar "Usar mi ubicación actual" (GPS del navegador)
       * Hacer clic en el mapa
       * Arrastrar el marcador
   - Los datos se guardan en inputs ocultos:
       #ubicacion-lat, #ubicacion-lng, #ubicacion-dir
   - Al hacer submit, esos valores se envían a Firestore.
============================================================ */

let __mtcMapaReg = null;
let __mtcMarkerReg = null;
let __mtcLatReg = null;
let __mtcLngReg = null;

window.initMapaRegistro = function () {
  const contenedor = document.getElementById('mapa-registro');
  if (!contenedor) return;

  if (__mtcMapaReg) {
    setTimeout(() => { try { __mtcMapaReg.invalidateSize(); } catch {} }, 200);
    return;
  }
  if (typeof L === 'undefined') {
    console.warn('⚠️ Leaflet no está cargado todavía.');
    return;
  }

  // Centro por defecto: Barranquilla
  const centroInicial = [10.9685, -74.7813];

  __mtcMapaReg = L.map('mapa-registro', {
    center: centroInicial,
    zoom: 14,
    zoomControl: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(__mtcMapaReg);

  __mtcMapaReg.on('click', (e) => {
    colocarMarcadorRegistro(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => {
    try { __mtcMapaReg.invalidateSize(); } catch {}
  }, 250);
};

function colocarMarcadorRegistro(lat, lng) {
  __mtcLatReg = lat;
  __mtcLngReg = lng;

  if (__mtcMarkerReg) {
    __mtcMarkerReg.setLatLng([lat, lng]);
  } else {
    __mtcMarkerReg = L.marker([lat, lng], { draggable: true }).addTo(__mtcMapaReg);
    __mtcMarkerReg.on('dragend', (ev) => {
      const p = ev.target.getLatLng();
      __mtcLatReg = p.lat;
      __mtcLngReg = p.lng;
      actualizarStatusUbicacionReg();
    });
  }
  actualizarStatusUbicacionReg();
}

function actualizarStatusUbicacionReg() {
  const el = document.getElementById('ubicacion-status-reg');
  const latInput = document.getElementById('ubicacion-lat');
  const lngInput = document.getElementById('ubicacion-lng');
  const dirInput = document.getElementById('ubicacion-dir');

  if (__mtcLatReg == null || __mtcLngReg == null) {
    if (el) {
      el.textContent = 'Aún no has marcado tu ubicación.';
      el.style.color = '#6b7280';
    }
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
    if (dirInput) dirInput.value = '';
    return;
  }

  if (el) {
    el.textContent = `📍 Ubicación marcada: ${__mtcLatReg.toFixed(5)}, ${__mtcLngReg.toFixed(5)}`;
    el.style.color = '#059669';
  }
  if (latInput) latInput.value = __mtcLatReg;
  if (lngInput) lngInput.value = __mtcLngReg;

  // Intentar obtener dirección legible
  obtenerDireccionReg(__mtcLatReg, __mtcLngReg).then((dir) => {
    if (dir && dirInput) dirInput.value = dir;
  });
}

async function obtenerDireccionReg(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;
    const r = await fetch(url);
    const d = await r.json();
    return d?.display_name || null;
  } catch {
    return null;
  }
}

/* Botón: usar mi ubicación actual (registro) */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#btn-usar-mi-ubicacion-reg');
  if (!btn) return;

  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización.');
    return;
  }

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo…';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      if (!__mtcMapaReg) window.initMapaRegistro();

      if (__mtcMapaReg) {
        __mtcMapaReg.setView([lat, lng], 16);
        colocarMarcadorRegistro(lat, lng);
      } else {
        __mtcLatReg = lat;
        __mtcLngReg = lng;
        actualizarStatusUbicacionReg();
      }

      btn.disabled = false;
      btn.innerHTML = original;
    },
    (err) => {
      console.warn('Error geolocalización:', err);
      alert('No se pudo obtener tu ubicación. Marca el punto manualmente en el mapa.');
      btn.disabled = false;
      btn.innerHTML = original;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

/* Botón: limpiar ubicación (registro) */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#btn-limpiar-ubicacion-reg');
  if (!btn) return;

  __mtcLatReg = null;
  __mtcLngReg = null;

  if (__mtcMarkerReg && __mtcMapaReg) {
    __mtcMapaReg.removeLayer(__mtcMarkerReg);
    __mtcMarkerReg = null;
  }
  actualizarStatusUbicacionReg();
});

/* ============================================================
   MOSTRAR / OCULTAR CATEGORÍA DEL COMERCIANTE
============================================================ */

(function attachTipoWatcher() {

  const tipoSel = document.getElementById("tipoUsuario-reg");
  const wrapper = document.getElementById("wrapper-categoria");
  const categoria = document.getElementById("categoriaComercio");

  function toggleCategoria() {
    if (!tipoSel || !wrapper) return;

    const esComerciante = tipoSel.value === "comerciante";
    wrapper.classList.toggle("hidden", !esComerciante);

    if (!esComerciante && categoria) {
      categoria.value = "";
    }

    if (esComerciante && categoria && !categoria.value) {
      categoria.value = "tienda";
    }
  }

  tipoSel?.addEventListener("change", toggleCategoria);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", toggleCategoria);
  } else {
    toggleCategoria();
  }

})();

/* ============================================================
   MODAL DE VERIFICACIÓN POR SMS
============================================================ */

function crearModalSMS() {
  let modal = document.getElementById("mtc-modal-sms");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "mtc-modal-sms";
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.65);
    display: none; align-items: center; justify-content: center;
    z-index: 99999; padding: 16px; box-sizing: border-box;
  `;

  modal.innerHTML = `
    <div style="background:#fff; border-radius:14px; max-width:420px; width:100%;
                padding:24px; box-shadow:0 10px 40px rgba(0,0,0,0.3);
                font-family: system-ui, -apple-system, sans-serif;">
      <h3 style="margin:0 0 8px; font-size:19px; color:#111; text-align:center;">
        Verifica tu celular
      </h3>
      <p id="mtc-sms-info" style="margin:0 0 16px; font-size:13px; color:#666; text-align:center;">
        Te enviaremos un código SMS.
      </p>

      <div id="mtc-sms-paso1">
        <label style="display:block; font-size:13px; color:#333; margin-bottom:6px; font-weight:600;">
          Número de celular
        </label>
        <input id="mtc-sms-telefono" type="tel" placeholder="+57 300 123 4567"
               style="width:100%; padding:12px; border:1px solid #ddd; border-radius:8px;
                      font-size:15px; box-sizing:border-box; margin-bottom:12px;" />

        <button id="mtc-sms-enviar" type="button"
                style="width:100%; padding:12px; background:#10B981; color:#fff;
                       border:none; border-radius:8px; font-size:15px; font-weight:600;
                       cursor:pointer;">
          Enviar código SMS
        </button>
      </div>

      <div id="mtc-sms-paso2" style="display:none;">
        <label style="display:block; font-size:13px; color:#333; margin-bottom:6px; font-weight:600;">
          Código de 6 dígitos
        </label>
        <input id="mtc-sms-codigo" type="text" inputmode="numeric" maxlength="6"
               placeholder="______"
               style="width:100%; padding:12px; border:1px solid #ddd; border-radius:8px;
                      font-size:22px; letter-spacing:8px; text-align:center;
                      box-sizing:border-box; margin-bottom:12px;" />

        <button id="mtc-sms-verificar" type="button"
                style="width:100%; padding:12px; background:#10B981; color:#fff;
                       border:none; border-radius:8px; font-size:15px; font-weight:600;
                       cursor:pointer; margin-bottom:8px;">
          Verificar código
        </button>

        <button id="mtc-sms-reenviar" type="button"
                style="width:100%; padding:8px; background:transparent; color:#10B981;
                       border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
          Reenviar código
        </button>
      </div>

      <div id="mtc-sms-error" style="display:none; margin-top:12px; padding:10px;
           background:#fee; color:#c33; border-radius:8px; font-size:13px; text-align:center;"></div>

      <button id="mtc-sms-cerrar" type="button"
              style="width:100%; margin-top:12px; padding:10px; background:#f3f4f6;
                     color:#555; border:none; border-radius:8px; font-size:13px; cursor:pointer;">
        Cerrar
      </button>

      <div id="mtc-recaptcha-container" style="margin-top:12px;"></div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function mostrarModalSMS() {
  const modal = crearModalSMS();
  modal.style.display = "flex";
  return modal;
}

function ocultarModalSMS() {
  const modal = document.getElementById("mtc-modal-sms");
  if (modal) modal.style.display = "none";
}

/* ============================================================
   VERIFICACIÓN POR SMS
============================================================ */

async function verificarCelularSMS(telefonoInicial) {
  return new Promise((resolve, reject) => {
    const modal = mostrarModalSMS();

    const info = modal.querySelector("#mtc-sms-info");
    const paso1 = modal.querySelector("#mtc-sms-paso1");
    const paso2 = modal.querySelector("#mtc-sms-paso2");
    const inputTel = modal.querySelector("#mtc-sms-telefono");
    const inputCodigo = modal.querySelector("#mtc-sms-codigo");
    const btnEnviar = modal.querySelector("#mtc-sms-enviar");
    const btnVerificar = modal.querySelector("#mtc-sms-verificar");
    const btnReenviar = modal.querySelector("#mtc-sms-reenviar");
    const btnCerrar = modal.querySelector("#mtc-sms-cerrar");
    const errorBox = modal.querySelector("#mtc-sms-error");

    if (telefonoInicial) {
      inputTel.value = telefonoInicial;
    }

    let verificationId = null;

    function mostrarError(texto) {
      errorBox.textContent = texto;
      errorBox.style.display = texto ? "block" : "none";
    }

    function cerrar(reason) {
      ocultarModalSMS();
      if (window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch {}
        window.recaptchaVerifier = null;
      }
      if (reason === "cancelado") {
        reject(new Error("cancelado"));
      }
    }

    btnCerrar.addEventListener("click", () => cerrar("cancelado"));

    btnEnviar.addEventListener("click", async () => {
      mostrarError("");
      const tel = normalizarTexto(inputTel.value);

      if (!tel) {
        mostrarError("Escribe tu número de celular.");
        return;
      }

      const telE164 = normalizarCelularE164(tel);

      btnEnviar.disabled = true;
      btnEnviar.textContent = "Enviando…";

      try {
        if (!window.recaptchaVerifier) {
          window.recaptchaVerifier = new RecaptchaVerifier(
            auth,
            "mtc-recaptcha-container",
            {
              size: "invisible",
              callback: () => {}
            }
          );
        }

        const provider = new PhoneAuthProvider(auth);
        verificationId = await provider.verifyPhoneNumber(
          telE164,
          window.recaptchaVerifier
        );

        info.textContent = `Enviamos un código SMS a ${telE164}.`;
        paso1.style.display = "none";
        paso2.style.display = "block";
        inputCodigo.focus();

      } catch (err) {
        console.error("❌ Error al enviar SMS:", err);
        const firebaseMessage = mapFirebaseAuthError(err?.code);
        mostrarError(
          firebaseMessage ||
          err?.message ||
          "No se pudo enviar el SMS. Intenta de nuevo."
        );
        btnEnviar.disabled = false;
        btnEnviar.textContent = "Enviar código SMS";
      }
    });

    btnVerificar.addEventListener("click", async () => {
      mostrarError("");
      const codigo = normalizarTexto(inputCodigo.value);

      if (codigo.length !== 6) {
        mostrarError("El código debe tener 6 dígitos.");
        return;
      }

      if (!verificationId) {
        mostrarError("Primero debes solicitar el código.");
        return;
      }

      btnVerificar.disabled = true;
      btnVerificar.textContent = "Verificando…";

      try {
        const credential = PhoneAuthProvider.credential(
          verificationId,
          codigo
        );

        const user = auth.currentUser;

        console.log('🔍 auth.currentUser al verificar:', user);

        if (!user) {
          throw new Error(
            "La sesión de registro se perdió. Cierra este modal, recarga la página e intenta registrarte nuevamente."
          );
        }

        await linkWithCredential(user, credential);
        await user.reload();

        console.log("✅ Celular verificado y vinculado:", user.phoneNumber);

        ocultarModalSMS();
        resolve({ phoneNumber: user.phoneNumber });

      } catch (err) {
        console.error("❌ Error al verificar código:", err);
        const firebaseMessage = mapFirebaseAuthError(err?.code);
        mostrarError(
          firebaseMessage ||
          err?.message ||
          "No se pudo verificar el código."
        );
        btnVerificar.disabled = false;
        btnVerificar.textContent = "Verificar código";
      }
    });

    btnReenviar.addEventListener("click", () => {
      paso1.style.display = "block";
      paso2.style.display = "none";
      mostrarError("");
      btnEnviar.disabled = false;
      btnEnviar.textContent = "Enviar código SMS";
    });
  });
}

/* ============================================================
   CREAR DATOS FIRESTORE
============================================================ */

async function crearDatosFirestore({
  uid,
  tipoUsuario,
  categoria,
  nombres,
  apellidos,
  tipoDocumento,
  numeroDocumento,
  email,
  telefono,
  telefonoVerificado,
  lat,
  lng,
  direccion
}) {

  const batch = writeBatch(db);

  const perfilRef = doc(db, "perfiles", uid);

  const perfilData = {

    uid,
    tipo: tipoUsuario,
    nombres,
    apellidos,
    tipoDocumento,
    numeroDocumento,
    email,
    telefono,
    telefonoVerificado: !!telefonoVerificado,

    requiereVerificacionEmail: true,

    verificacion: {
      email: "pendiente",
      telefono: telefonoVerificado ? "verificado" : "pendiente",
      identidad: "pendiente"
    },

    createdAt: serverTimestamp(),
    actualizadoEn: serverTimestamp()
  };

  if (tipoUsuario === "comerciante") {
    perfilData.tipoComerciante = categoria || "tienda";

    // 🔥 Guardar ubicación también en el perfil del comerciante
    if (lat != null && lng != null) {
      perfilData.ubicacion = {
        lat: Number(lat),
        lng: Number(lng),
        direccion: direccion || ''
      };
      perfilData.lat = Number(lat);
      perfilData.lon = Number(lng);
      perfilData.lng = Number(lng);
      perfilData.direccion = direccion || '';
    }
  } else {
    perfilData.tipoComerciante = null;
  }

  batch.set(perfilRef, perfilData, { merge: false });

  if (tipoUsuario === "comerciante") {

    const tiendaRef = doc(db, "tiendas", uid);
    const nombreTienda = `${nombres} ${apellidos}`.trim();

    const tiendaData = {
      uid,
      propietarioId: uid,
      propietarioUid: uid,
      nombres,
      apellidos,
      propietarioNombre: nombreTienda,
      email,
      telefono,
      tipoComerciante: categoria || "tienda",
      categoria: categoria || "tienda",
      activo: true,
      aprobada: false,
      estadoVerificacion: "pendiente",
      nombre: nombreTienda || "Mi Tienda",
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    };

    // ============================================================
    // 🔥 UBICACIÓN DEL COMERCIO
    // Se guarda con las MISMAS claves que usa Configuración
    // (lat, lon, lng, direccion + objeto ubicacion) para que al
    // iniciar sesión el mapa ya la cargue automáticamente.
    // ============================================================
    if (lat != null && lng != null) {
      tiendaData.lat = Number(lat);
      tiendaData.lon = Number(lng);
      tiendaData.lng = Number(lng);
      tiendaData.direccion = direccion || '';

      tiendaData.ubicacion = {
        lat: Number(lat),
        lng: Number(lng),
        direccion: direccion || ''
      };
    }

    batch.set(tiendaRef, tiendaData, { merge: false });
  }

  await batch.commit();
}

/* ============================================================
   REGISTRO PRINCIPAL
   ⚠️ FLUJO CORREGIDO:
      1. Crear cuenta email/password
      2. Enviar correo de verificación
      3. Guardar perfil en Firestore  ← ANTES del SMS
      4. Verificar SMS (auth.currentUser sigue activo)
      5. Cerrar sesión
============================================================ */

form?.addEventListener(
  "submit",

  async (ev) => {

    ev.preventDefault();

    showMsg("");

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn?.setAttribute("disabled", "true");

    let cred = null;
    let uidCreado = null;
    let telefonoVerificado = false;

    // 🔥 Marcar el registro como en curso para que auth.js NO cierre la sesión
    window.__MTC_REGISTRO_EN_CURSO = true;

    try {

      /* ======================================================
         LEER FORMULARIO
      ====================================================== */

      const tipoUsuario = normalizarTexto($("#tipoUsuario-reg")?.value);
      const categoria = normalizarTexto($("#categoriaComercio")?.value);
      const nombres = normalizarTexto($("#nombre")?.value);
      const apellidos = normalizarTexto($("#apellido")?.value);
      const tipoDocumento = normalizarTexto($("#tipoDocumento")?.value);
      const numeroDocumento = normalizarTexto($("#numeroDocumento")?.value);
      const email = normalizarEmail($("#email")?.value);
      const telefono = normalizarTexto($("#telefono")?.value);
      const password = $("#password")?.value || "";
      const confirmarPassword = $("#confirmar-password")?.value || "";

      /* ======================================================
         VALIDACIONES
      ====================================================== */

      if (!TIPOS_USUARIO.has(tipoUsuario)) {
        throw new Error("Selecciona si eres Cliente o Comerciante.");
      }

      if (nombres.length < 2) {
        throw new Error("Escribe tus nombres correctamente.");
      }

      if (apellidos.length < 2) {
        throw new Error("Escribe tus apellidos correctamente.");
      }

      if (!TIPOS_DOCUMENTO.has(tipoDocumento)) {
        throw new Error("Selecciona el tipo de documento.");
      }

      if (numeroDocumento.length < 5) {
        throw new Error("Escribe un número de documento válido.");
      }

      if (!email) {
        throw new Error("Escribe un correo electrónico.");
      }

      const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailValido) {
        throw new Error("Escribe un correo electrónico válido.");
      }

      if (!telefono) {
        throw new Error("Escribe tu número de celular.");
      }

      if (password.length < 6) {
        throw new Error("La contraseña debe tener mínimo 6 caracteres.");
      }

      if (password !== confirmarPassword) {
        throw new Error("Las contraseñas no coinciden.");
      }

      if (tipoUsuario === "comerciante") {
        if (!TIPOS_COMERCIO.has(categoria)) {
          throw new Error("Selecciona el tipo de comercio.");
        }

        // 🔥 Validar que el comerciante marcó ubicación
        const latVal = document.getElementById('ubicacion-lat')?.value?.trim();
        const lngVal = document.getElementById('ubicacion-lng')?.value?.trim();
        if (!latVal || !lngVal) {
          throw new Error("Marca la ubicación de tu comercio en el mapa antes de continuar.");
        }
      }

      /* ======================================================
         COMENZAR
      ====================================================== */

      setLoading(true, "Creando tu cuenta segura…");

      console.log("========================================");
      console.log("📝 INICIANDO REGISTRO");
      console.log("👤 Tipo:", tipoUsuario);
      console.log("📧 Email:", email);
      console.log("🪪 Documento recibido correctamente");
      console.log("========================================");

      /* ======================================================
         1. CREAR CUENTA FIREBASE AUTH
      ====================================================== */

      cred = await createUserWithEmailAndPassword(auth, email, password);
      uidCreado = cred.user.uid;

      console.log("✅ Firebase Auth creado:", uidCreado);

      /* ======================================================
         2. ENVIAR CORREO DE VERIFICACIÓN
      ====================================================== */

      await sendEmailVerification(cred.user);
      console.log("📧 Correo de verificación enviado a:", email);

      /* ======================================================
         3. GUARDAR PERFIL EN FIRESTORE
            ⚠️ ANTES del SMS para que auth.currentUser siga
            teniendo perfil válido si onAuthStateChanged corre.
      ====================================================== */

      setLoading(true, "Guardando tu información…");

      // 🔥 Capturar ubicación (solo aplica a comerciante)
      let latFinal = null;
      let lngFinal = null;
      let dirFinal = '';

      if (tipoUsuario === "comerciante") {
        const latVal = (document.getElementById('ubicacion-lat')?.value || '').trim();
        const lngVal = (document.getElementById('ubicacion-lng')?.value || '').trim();
        const dirVal = (document.getElementById('ubicacion-dir')?.value || '').trim();

        latFinal = Number(latVal);
        lngFinal = Number(lngVal);
        dirFinal = dirVal;

        if (isNaN(latFinal) || isNaN(lngFinal)) {
          throw new Error("La ubicación seleccionada no es válida. Vuelve a marcarla en el mapa.");
        }
      }

      await crearDatosFirestore({
        uid: uidCreado,
        tipoUsuario,
        categoria: tipoUsuario === "comerciante" ? categoria : "",
        nombres,
        apellidos,
        tipoDocumento,
        numeroDocumento,
        email,
        telefono,
        telefonoVerificado: false,
        lat: latFinal,
        lng: lngFinal,
        direccion: dirFinal
      });

      console.log("✅ Firestore sincronizado (perfil base)");

      /* ======================================================
         4. VERIFICACIÓN POR SMS
      ====================================================== */

      try {
        setLoading(true, "Verificando tu celular…");

        await verificarCelularSMS(telefono);
        telefonoVerificado = true;

        console.log("✅ Celular verificado por SMS.");

        // Actualizar perfil con el estado real del celular
        const perfilRef = doc(db, "perfiles", uidCreado);
        await setDoc(perfilRef, {
          telefonoVerificado: true,
          "verificacion.telefono": "verificado",
          actualizadoEn: serverTimestamp()
        }, { merge: true });

        console.log("✅ Firestore actualizado con teléfono verificado.");

      } catch (smsError) {

        if (smsError?.message === "cancelado") {
          console.warn("⚠️ El usuario canceló la verificación por SMS.");
        } else {
          console.warn("⚠️ Verificación SMS falló:", smsError);
        }
        telefonoVerificado = false;
      }

      /* ======================================================
         5. CERRAR SESIÓN AUTOMÁTICA
      ====================================================== */

      await signOut(auth);
      console.log("🔒 Sesión cerrada. Esperando verificación de correo.");

      /* ======================================================
         6. MOSTRAR MENSAJE Y VOLVER AL LOGIN
      ====================================================== */

      showMsg(
        "✅ Cuenta creada correctamente. " +
        "Hemos enviado un enlace de verificación a tu correo electrónico. " +
        "Revisa tu bandeja de entrada (y la carpeta de spam) y haz clic en el enlace antes de iniciar sesión.",
        "success"
      );

      setLoading(false);

      setTimeout(() => {
        document.getElementById("registro-form")?.classList.add("hidden");
        document.getElementById("login-form")?.classList.remove("hidden");
      }, 4500);

    } catch (err) {

      console.error("❌ ERROR EN REGISTRO:", err);

      if (cred?.user && uidCreado) {
        try {
          console.warn("⚠️ Revirtiendo cuenta incompleta:", uidCreado);
          await deleteUser(cred.user);
          console.log("✅ Cuenta incompleta eliminada correctamente");
        } catch (rollbackError) {
          console.error("❌ No se pudo revertir la cuenta:", rollbackError);
        }
      }

      const firebaseMessage = mapFirebaseAuthError(err?.code);

      showMsg(
        firebaseMessage ||
        err?.message ||
        "No se pudo completar el registro.",
        "error"
      );

    } finally {

      // 🔥 Liberar la bandera con un pequeño retraso,
      // para que auth.js no interfiera con la redirección
      setTimeout(() => {
        window.__MTC_REGISTRO_EN_CURSO = false;
      }, 500);

      setLoading(false);
      submitBtn?.removeAttribute("disabled");
    }

  }
);