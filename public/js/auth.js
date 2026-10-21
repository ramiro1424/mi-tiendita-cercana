// public/js/auth.js
// ============================================================
// Mi Tiendita Cercana
// AUTENTICACIÓN CENTRAL CLIENTE / COMERCIANTE
// ============================================================
//
// IMPORTANTE:
// - Firebase Authentication = fuente REAL de autenticación.
// - Firestore /perfiles/{uid} = fuente REAL del rol.
// - sessionStorage.currentUser = SOLO información auxiliar de UI.
// - Nunca se debe usar sessionStorage para decidir si un usuario
//   está autenticado.
//
// Roles permitidos:
//   cliente
//   comerciante
//
// Comerciante:
//   tipoComerciante = tienda | carniceria | farmacia |
//                     frutas_verduras | licoreria | ...
//
// Cliente:
//   tipoComerciante = null
// ============================================================

import { auth, db } from './firebase-config.js';

import {
  signInWithEmailAndPassword,
  setPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ============================================================
// HELPERS
// ============================================================

const $ = (selector) => document.querySelector(selector);

const VALID_ROLES = ['cliente', 'comerciante'];

const DESTINOS = {
  cliente: 'productos.html',
  comerciante: 'panel-comerciante.html',
};


// ============================================================
// MENSAJES
// ============================================================

function msg(element, text = '', ok = false) {

  if (!element) return;

  element.textContent = text || '';

  element.className =
    'message ' + (ok ? 'ok' : 'err');

  element.style.display =
    text ? 'block' : 'none';
}


// ============================================================
// ERRORES FIREBASE
// ============================================================

function mapError(err) {

  const code =
    (err?.code || '').toString().toLowerCase();

  if (!navigator.onLine) {
    return 'Sin conexión a internet.';
  }

  if (code.includes('network-request-failed')) {

    return (
      'Problema de conexión. ' +
      'Revisa tu internet o intenta nuevamente.'
    );
  }

  if (
    code.includes('invalid-credential') ||
    code.includes('wrong-password')
  ) {

    return (
      'Correo o contraseña incorrectos.'
    );
  }

  if (code.includes('user-not-found')) {

    return (
      'No existe una cuenta con ese correo.'
    );
  }

  if (code.includes('invalid-email')) {

    return 'El correo electrónico no es válido.';
  }

  if (code.includes('too-many-requests')) {

    return (
      'Demasiados intentos. ' +
      'Espera unos minutos e inténtalo nuevamente.'
    );
  }

  if (code.includes('user-disabled')) {

    return (
      'Esta cuenta está deshabilitada.'
    );
  }

  return (
    err?.message ||
    'No se pudo iniciar sesión.'
  );
}


// ============================================================
// NORMALIZACIÓN DEL ROL
// ============================================================

function normalizeRol(value) {

  const val =
    (value || '')
      .toString()
      .trim()
      .toLowerCase();

  if (VALID_ROLES.includes(val)) {
    return val;
  }

  // Compatibilidad con datos antiguos
  if (
    ['seller', 'shop', 'merchant'].includes(val)
  ) {
    return 'comerciante';
  }

  if (
    ['buyer', 'user', 'customer'].includes(val)
  ) {
    return 'cliente';
  }

  return null;
}


// ============================================================
// NORMALIZACIÓN DEL TIPO DE COMERCIANTE
// ============================================================

function normalizeTipoComerciante(value) {

  if (!value) return null;

  const val =
    value
      .toString()
      .trim()
      .toLowerCase();

  const aliases = {

    tienda: 'tienda',

    tienda_general: 'tienda',

    shop: 'tienda',

    merchant: 'tienda',

    licoreria: 'licoreria',

    liquor: 'licoreria',

    liquor_store: 'licoreria',

    carniceria: 'carniceria',

    butcher: 'carniceria',

    farmacia: 'farmacia',

    pharmacy: 'farmacia',

    frutas_verduras: 'frutas_verduras',

    frutas: 'frutas_verduras',

    verduras: 'frutas_verduras',
  };

  return aliases[val] || val;
}


// ============================================================
// PERFIL REAL DEL USUARIO
// ============================================================
//
// Esta función NO confía en sessionStorage.
// Lee directamente:
//
//   /perfiles/{uid}
//
// ============================================================

async function getPerfilReal(uid) {

  if (!uid) {

    throw new Error(
      'No existe UID de usuario autenticado.'
    );
  }

  const perfilRef =
    doc(db, 'perfiles', uid);

  const snap =
    await getDoc(perfilRef);

  if (!snap.exists()) {

    throw new Error(
      'La cuenta existe en Firebase Authentication, ' +
      'pero no tiene un perfil registrado.'
    );
  }

  const data =
    snap.data() || {};

  const rol =
    normalizeRol(
      data.tipo ?? data.rol
    );

  if (!rol) {

    throw new Error(
      'El perfil del usuario no tiene un tipo válido.'
    );
  }

  let tipoComerciante = null;

  if (rol === 'comerciante') {

    tipoComerciante =
      normalizeTipoComerciante(
        data.tipoComerciante
      );

    if (!tipoComerciante) {

      throw new Error(
        'El comerciante no tiene una categoría de comercio configurada.'
      );
    }
  }

  // Cliente SIEMPRE queda sin tipo de comerciante.
  if (rol === 'cliente') {
    tipoComerciante = null;
  }

  return {

    uid,

    rol,

    tipoComerciante,

    nombres:
      data.nombres || '',

    apellidos:
      data.apellidos || '',

    email:
      data.email || '',

    telefono:
      data.telefono || '',

    telefonoVerificado:
      data.telefonoVerificado === true,

    // ✅ Clave: si no existe el campo, se trata como false (usuario antiguo).
    requiereVerificacionEmail:
      data.requiereVerificacionEmail === true,

    verificacion:
      data.verificacion || {
        email: 'pendiente',
        telefono: 'pendiente',
        identidad: 'pendiente',
      },

    createdAt:
      data.createdAt || null,

    // Conservamos datos adicionales sin depender
    // de ellos para seguridad.
    perfilExiste: true,
  };
}


// ============================================================
// ACTUALIZAR verificacion.email EN FIRESTORE
// ============================================================
//
// Se llama cuando el usuario inicia sesión con correo
// ya verificado y el perfil aún tiene email: "pendiente".
//
// ============================================================

async function sincronizarVerificacionEmail(uid, perfilActual) {

  try {

    // Si ya estaba verificado, no hacemos nada.
    if (
      perfilActual?.verificacion?.email === 'verificado'
    ) {
      return;
    }

    const perfilRef =
      doc(db, 'perfiles', uid);

    await updateDoc(perfilRef, {

      'verificacion.email': 'verificado',

      actualizadoEn: serverTimestamp(),
    });

    console.log(
      '✅ verificacion.email actualizado a "verificado" en Firestore.'
    );

  } catch (error) {

    // No rompemos el login si falla esta actualización.
    console.warn(
      '⚠️ No se pudo actualizar verificacion.email:',
      error
    );
  }
}


// ============================================================
// STORAGE AUXILIAR
// ============================================================
//
// IMPORTANTE:
// Esto NO autentica al usuario.
//
// Firebase Auth sigue siendo la fuente real.
// ============================================================

function guardarSesionAuxiliar(perfil) {

  try {

    const userData = {

      uid: perfil.uid,

      rol: perfil.rol,

      tipoComerciante:
        perfil.tipoComerciante,

      nombres:
        perfil.nombres || '',

      apellidos:
        perfil.apellidos || '',

      email:
        perfil.email || '',

      telefono:
        perfil.telefono || '',

      telefonoVerificado:
        perfil.telefonoVerificado === true,

      verificacion:
        perfil.verificacion || null,
    };

    sessionStorage.setItem(
      'currentUser',
      JSON.stringify(userData)
    );

    console.log(
      '💾 currentUser auxiliar actualizado:',
      userData
    );

  } catch (error) {

    console.warn(
      '⚠️ No se pudo guardar currentUser:',
      error
    );
  }
}


// ============================================================
// LIMPIEZA AUXILIAR
// ============================================================

function limpiarSesionAuxiliar() {

  try {

    sessionStorage.removeItem(
      'currentUser'
    );

    console.log(
      '🧹 currentUser auxiliar eliminado.'
    );

  } catch (error) {

    console.warn(
      '⚠️ No se pudo limpiar currentUser:',
      error
    );
  }
}


// ============================================================
// STORAGE TEMPORAL
// ============================================================

function clearExcessStorage() {

  try {

    for (
      let i = sessionStorage.length - 1;
      i >= 0;
      i--
    ) {

      const key =
        sessionStorage.key(i);

      if (
        key &&
        key.startsWith('temp_')
      ) {

        sessionStorage.removeItem(key);
      }
    }

    for (
      let i = localStorage.length - 1;
      i >= 0;
      i--
    ) {

      const key =
        localStorage.key(i);

      if (
        key &&
        key.startsWith('temp_')
      ) {

        localStorage.removeItem(key);
      }
    }

  } catch (error) {

    console.warn(
      '⚠️ No se pudo limpiar storage temporal:',
      error
    );
  }
}

clearExcessStorage();


// ============================================================
// RUTA BASE
// ============================================================

function basePath() {

  return location.pathname
    .replace(/\/index\.html?$/i, '/');
}


// ============================================================
// COMPROBAR EXISTENCIA DE PÁGINA
// ============================================================

async function exists(url) {

  try {

    const response =
      await fetch(
        url,
        {
          method: 'HEAD',
          cache: 'no-store',
        }
      );

    return response.ok;

  } catch {

    return false;
  }
}


// ============================================================
// VALIDAR QUE EL SELECT DEL LOGIN COINCIDA
// CON EL ROL REAL DEL PERFIL
// ============================================================

function validarRolSeleccionado(
  rolReal,
  rolSeleccionado
) {

  const seleccionado =
    normalizeRol(
      rolSeleccionado
    );

  if (!seleccionado) {

    throw new Error(
      'Selecciona si vas a ingresar como Cliente o Comerciante.'
    );
  }

  if (seleccionado !== rolReal) {

    if (rolReal === 'cliente') {

      throw new Error(
        'Esta cuenta es de CLIENTE. ' +
        'Selecciona "Cliente" para iniciar sesión.'
      );
    }

    if (rolReal === 'comerciante') {

      throw new Error(
        'Esta cuenta es de COMERCIANTE. ' +
        'Selecciona "Comerciante" para iniciar sesión.'
      );
    }

    throw new Error(
      'El tipo de usuario seleccionado no coincide con la cuenta.'
    );
  }

  return true;
}


// ============================================================
// LOGIN
// ============================================================

let _submitting = false;

async function handleLogin(event) {

  event.preventDefault();

  if (_submitting) {
    return;
  }

  _submitting = true;

  const box =
    $('#login-mensaje');

  const btn =
    $('#form-login button[type="submit"]');

  msg(box, '');

  const email =
    (
      $('#login-email')?.value || ''
    )
      .trim()
      .toLowerCase();

  const password =
    $('#login-password')?.value || '';

  const tipoSeleccionado =
    (
      $('#login-tipoUsuario')?.value || ''
    )
      .trim()
      .toLowerCase();


  // ----------------------------------------------------------
  // Validaciones iniciales
  // ----------------------------------------------------------

  if (!email) {

    msg(
      box,
      'Escribe tu correo electrónico.'
    );

    _submitting = false;
    return;
  }

  if (!password) {

    msg(
      box,
      'Escribe tu contraseña.'
    );

    _submitting = false;
    return;
  }

  if (!tipoSeleccionado) {

    msg(
      box,
      'Selecciona Cliente o Comerciante.'
    );

    _submitting = false;
    return;
  }


  if (btn) {
    btn.disabled = true;
  }


  try {

    window.showLoader?.(
      true,
      'Verificando tu cuenta…'
    );


    // --------------------------------------------------------
    // Persistencia REAL de Firebase
    // --------------------------------------------------------

    await setPersistence(
      auth,
      browserSessionPersistence
    );

    // Limpiar sesión anterior y caché vieja de Firebase
    try { await signOut(auth); } catch {}
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('firebase:authUser:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch {}


    // --------------------------------------------------------
    // AUTENTICACIÓN REAL
    // --------------------------------------------------------

    const credential =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    const user =
      credential.user;


    if (!user || !user.uid) {

      throw new Error(
        'Firebase no devolvió un usuario autenticado.'
      );
    }


    console.log(
      '🔐 Firebase Authentication:',
      {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
      }
    );


    // --------------------------------------------------------
    // LEER PERFIL REAL
    // --------------------------------------------------------

    window.showLoader?.(
      true,
      'Verificando tu perfil…'
    );

    const perfil =
      await getPerfilReal(
        user.uid
      );


    // ========================================================
    // ✅ BLOQUEAR SOLO SI EL PERFIL REQUIERE VERIFICACIÓN
    // ========================================================
    // Los usuarios antiguos (sin requiereVerificacionEmail) entran normal.
    // Los usuarios nuevos (requiereVerificacionEmail === true) sí verifican.

    if (
      perfil.requiereVerificacionEmail === true &&
      !user.emailVerified
    ) {

      try { await signOut(auth); } catch {}

      throw new Error(
        'Debes verificar tu correo electrónico antes de iniciar sesión. ' +
        'Revisa tu bandeja de entrada y la carpeta de spam, y haz clic en el enlace que te enviamos.'
      );
    }


    // --------------------------------------------------------
    // ✅ SINCRONIZAR verificacion.email EN FIRESTORE
    // --------------------------------------------------------

    if (user.emailVerified) {
      await sincronizarVerificacionEmail(
        user.uid,
        perfil
      );
    }


    // --------------------------------------------------------
    // VALIDAR ROL
    // --------------------------------------------------------

    validarRolSeleccionado(
      perfil.rol,
      tipoSeleccionado
    );


    // --------------------------------------------------------
    // COMPROBACIONES IMPORTANTES
    // --------------------------------------------------------

    if (perfil.rol === 'cliente') {

      if (
        perfil.tipoComerciante !== null
      ) {

        throw new Error(
          'Inconsistencia de seguridad: ' +
          'el perfil de cliente tiene una categoría de comerciante.'
        );
      }
    }


    if (perfil.rol === 'comerciante') {

      if (!perfil.tipoComerciante) {

        throw new Error(
          'El comerciante no tiene categoría de comercio.'
        );
      }

      console.log(
        '🏪 Comerciante:',
        perfil.tipoComerciante
      );
    }


    // --------------------------------------------------------
    // Guardar información AUXILIAR
    // --------------------------------------------------------

    guardarSesionAuxiliar(
      perfil
    );


    // --------------------------------------------------------
    // EXPONER ESTADO DE DIAGNÓSTICO
    // --------------------------------------------------------

    window.__MTC_AUTH = {

      uid: perfil.uid,

      rol: perfil.rol,

      tipoComerciante:
        perfil.tipoComerciante,

      email:
        user.email || perfil.email,

      emailVerified:
        user.emailVerified,

      telefono:
        perfil.telefono || '',

      telefonoVerificado:
        perfil.telefonoVerificado === true,

      verificacion:
        perfil.verificacion || null,

      authenticated: true,

      perfilExiste:
        perfil.perfilExiste,

      timestamp:
        new Date().toISOString(),
    };


    console.log(
      '=========================================='
    );

    console.log(
      '✅ SESIÓN REAL DE MTC CONFIRMADA'
    );

    console.log(
      'UID:',
      perfil.uid
    );

    console.log(
      'ROL:',
      perfil.rol
    );

    console.log(
      'TIPO COMERCIANTE:',
      perfil.tipoComerciante
    );

    console.log(
      'EMAIL:',
      user.email
    );

    console.log(
      'EMAIL VERIFICADO:',
      user.emailVerified
    );

    console.log(
      'TELÉFONO VERIFICADO:',
      perfil.telefonoVerificado === true
    );

    console.log(
      '=========================================='
    );


    msg(
      box,
      perfil.rol === 'cliente'
        ? '¡Cliente autenticado correctamente!'
        : `¡Comerciante autenticado! Categoría: ${perfil.tipoComerciante}`,
      true
    );


    // --------------------------------------------------------
    // DESTINO SEGÚN ROL REAL
    // --------------------------------------------------------

    const destinoArchivo =
      DESTINOS[perfil.rol];

    if (!destinoArchivo) {

      throw new Error(
        'No existe una ruta configurada para este tipo de usuario.'
      );
    }


    const destino =
      basePath() +
      destinoArchivo;


    if (!(await exists(destino))) {

      throw new Error(
        `No encuentro "${destinoArchivo}" dentro de /public/.`
      );
    }


    await new Promise(
      resolve => setTimeout(resolve, 350)
    );


    // --------------------------------------------------------
    // REDIRECCIÓN
    // --------------------------------------------------------

    window.location.href =
      destino;


  } catch (error) {

    console.error(
      '❌ Error de autenticación:',
      error
    );


    // Si algo falló después de autenticar,
    // cerramos la sesión para no dejar una cuenta
    // autenticada pero sin perfil válido.
    try {

      if (auth.currentUser) {

        await signOut(auth);
      }

    } catch (signOutError) {

      console.warn(
        '⚠️ No se pudo cerrar la sesión después del error:',
        signOutError
      );
    }


    limpiarSesionAuxiliar();

    delete window.__MTC_AUTH;


    msg(
      box,
      mapError(error)
    );

  } finally {

    window.showLoader?.(
      false
    );

    if (btn) {
      btn.disabled = false;
    }

    _submitting = false;
  }
}


// ============================================================
// EVENTO LOGIN
// ============================================================

document
  .getElementById('form-login')
  ?.addEventListener(
    'submit',
    handleLogin
  );


// ============================================================
// ESTADO REAL DE FIREBASE
// ============================================================

let authStateInitialized = false;

onAuthStateChanged(
  auth,
  async (user) => {

    // 🔥 1. Si hay un registro en curso, ignorar por completo
    if (window.__MTC_REGISTRO_EN_CURSO) {
      console.log('⏸️ Registro en curso, onAuthStateChanged ignorado.');
      return;
    }

    // 🔥 2. Si el usuario existe pero NO tiene perfil aún, esperar
    if (user) {
      try {
        const perfilCheck = await getDoc(doc(db, 'perfiles', user.uid));
        if (!perfilCheck.exists()) {
          console.log('⏳ Usuario sin perfil. Esperando 3s antes de decidir...');
          await new Promise(r => setTimeout(r, 3000));

          // Reintentar una sola vez
          const reintento = await getDoc(doc(db, 'perfiles', user.uid));
          if (!reintento.exists()) {
            console.warn('❌ Usuario sin perfil tras espera. Cerrando sesión.');
            try { await signOut(auth); } catch {}
            limpiarSesionAuxiliar();
            return;
          }
        }
      } catch (e) {
        console.warn('Error verificando perfil:', e);
      }
    }

    // ... el resto de tu lógica actual sin cambios
    console.log('🔄 Firebase Auth cambió de estado:', user ? { uid: user.uid, email: user.email } : null);
    // ... sigue con el código que ya tienes


    // --------------------------------------------------------
    // NO HAY SESIÓN
    // --------------------------------------------------------

    if (!user) {

      authStateInitialized = true;

      delete window.__MTC_AUTH;

      if (
        location.pathname.endsWith('index.html') ||
        location.pathname === '/' ||
        location.pathname === ''
      ) {

        limpiarSesionAuxiliar();
      }

      return;
    }


    // --------------------------------------------------------
    // HAY SESIÓN REAL
    // --------------------------------------------------------

    try {

      const perfil =
        await getPerfilReal(
          user.uid
        );

      // ✅ Sincronizar verificacion.email si aplica
      if (user.emailVerified) {
        await sincronizarVerificacionEmail(
          user.uid,
          perfil
        );
      }


      window.__MTC_AUTH = {

        uid:
          user.uid,

        rol:
          perfil.rol,

        tipoComerciante:
          perfil.tipoComerciante,

        email:
          user.email || perfil.email,

        emailVerified:
          user.emailVerified,

        telefono:
          perfil.telefono || '',

        telefonoVerificado:
          perfil.telefonoVerificado === true,

        verificacion:
          perfil.verificacion || null,

        authenticated:
          true,

        perfilExiste:
          true,

        timestamp:
          new Date().toISOString(),
      };


      // Mantener storage auxiliar sincronizado
      guardarSesionAuxiliar(
        perfil
      );


      console.log(
        '=========================================='
      );

      console.log(
        '🔐 USUARIO ACTUAL AUTENTICADO'
      );

      console.log(
        'UID:',
        user.uid
      );

      console.log(
        'EMAIL:',
        user.email
      );

      console.log(
        'ROL:',
        perfil.rol
      );

      console.log(
        'TIPO COMERCIANTE:',
        perfil.tipoComerciante
      );

      console.log(
        'EMAIL VERIFICADO:',
        user.emailVerified
      );

      console.log(
        'TELÉFONO VERIFICADO:',
        perfil.telefonoVerificado === true
      );

      console.log(
        '=========================================='
      );


      // ------------------------------------------------------
      // Actualizar elementos de UI si existen
      // ------------------------------------------------------

      const badge =
        document.getElementById(
          'nombre-usuario'
        );

      const avatar =
        document.querySelector(
          '.user-avatar'
        );


      if (badge) {

        const name =
          perfil.nombres ||
          user.displayName ||
          user.email?.split('@')[0] ||
          'Usuario';

        badge.innerText = name;
        badge.textContent = name;
      }


      if (avatar) {

        const name =
          perfil.nombres ||
          user.displayName ||
          user.email?.split('@')[0] ||
          'Usuario';

        avatar.innerText = (name[0] || 'U').toUpperCase();
        avatar.textContent = (name[0] || 'U').toUpperCase();
      }


      authStateInitialized = true;


    } catch (error) {

      console.error(
        '❌ Sesión Firebase sin perfil válido:',
        error
      );


      delete window.__MTC_AUTH;

      limpiarSesionAuxiliar();


      try {

        await signOut(auth);

      } catch (signOutError) {

        console.warn(
          '⚠️ Error cerrando sesión inválida:',
          signOutError
        );
      }
    }
  }
);


// ============================================================
// FUNCIONES DE DIAGNÓSTICO PARA EL CREADOR
// ============================================================

window.mtcAuthStatus = function () {

  const user =
    auth.currentUser;


  console.log(
    '=========================================='
  );

  console.log(
    '🔎 DIAGNÓSTICO MTC AUTH'
  );

  console.log(
    '=========================================='
  );


  if (!user) {

    console.log(
      '❌ NO HAY USUARIO AUTENTICADO EN FIREBASE'
    );

    console.log(
      'Firebase Auth currentUser = null'
    );

    return null;
  }


  console.log(
    '✅ USUARIO AUTENTICADO EN FIREBASE'
  );

  console.log(
    'UID:',
    user.uid
  );

  console.log(
    'EMAIL:',
    user.email
  );

  console.log(
    'EMAIL VERIFICADO:',
    user.emailVerified
  );


  if (window.__MTC_AUTH) {

    console.log(
      'ROL:',
      window.__MTC_AUTH.rol
    );

    console.log(
      'TIPO COMERCIANTE:',
      window.__MTC_AUTH.tipoComerciante
    );

    console.log(
      'TELÉFONO VERIFICADO:',
      window.__MTC_AUTH.telefonoVerificado
    );

    console.log(
      'VERIFICACIÓN:',
      window.__MTC_AUTH.verificacion
    );
  }


  console.log(
    '=========================================='
  );


  return {

    firebaseAuthenticated:
      true,

    uid:
      user.uid,

    email:
      user.email,

    emailVerified:
      user.emailVerified,

    ...(
      window.__MTC_AUTH || {}
    ),
  };
};


// ============================================================
// OBTENER USUARIO ACTUAL DE FORMA SEGURA
// ============================================================

window.mtcGetCurrentUser = function () {

  return auth.currentUser || null;
};


// ============================================================
// OBTENER PERFIL REAL DE FIRESTORE
// ============================================================

window.mtcGetCurrentProfile = async function () {

  const user =
    auth.currentUser;

  if (!user) {

    console.warn(
      '❌ No hay usuario autenticado.'
    );

    return null;
  }

  try {

    const perfil =
      await getPerfilReal(
        user.uid
      );

    console.log(
      '👤 PERFIL REAL:',
      perfil
    );

    return perfil;

  } catch (error) {

    console.error(
      '❌ No se pudo obtener el perfil:',
      error
    );

    return null;
  }
};


// ============================================================
// CERRAR SESIÓN
// ============================================================

window.mtcLogout = async function () {

  try {

    await signOut(auth);

    limpiarSesionAuxiliar();

    delete window.__MTC_AUTH;

    console.log(
      '✅ Sesión cerrada correctamente.'
    );

    return true;

  } catch (error) {

    console.error(
      '❌ Error cerrando sesión:',
      error
    );

    return false;
  }
};


// ============================================================
// COMPATIBILIDAD CON CÓDIGO EXISTENTE
// ============================================================

window.cleanAuthStorage = function () {

  try {

    limpiarSesionAuxiliar();

    localStorage.removeItem(
      'selected_store_uid'
    );

    console.log(
      '🧹 Storage auxiliar limpiado.'
    );

  } catch (error) {

    console.warn(
      '⚠️ Error limpiando storage:',
      error
    );
  }
};


// ============================================================
// INFORMACIÓN DE DEPURACIÓN
// ============================================================

console.log(
  '🔐 Mi Tiendita Cercana - auth.js cargado'
);

console.log(
  'ℹ️ Firebase Authentication es la fuente real de sesión.'
);

console.log(
  'ℹ️ Usa mtcAuthStatus() en la consola para comprobar el usuario.'
);