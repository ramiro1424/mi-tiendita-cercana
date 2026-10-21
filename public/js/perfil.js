// ============================================================
// public/js/perfil.js
// Mi Tiendita Cercana
// Gestión completa del perfil del usuario CON UBICACIÓN
// + Eliminación segura de cuenta (Cloud Function)
// ============================================================

import {
  auth,
  db,
  functions
} from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";


// ============================================================
// HELPERS
// ============================================================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);


// ============================================================
// ELEMENTOS
// ============================================================

const loading = $("#perfil-loading");

const viewMode = $("#viewMode");
const editMode = $("#editMode");

const btnEditar = $("#btnEditar");
const btnCancelar = $("#btnCancelar");
const formPerfil = $("#formPerfil");

const btnGuardar = $("#btnGuardarPerfil");
const textoGuardar = $("#textoGuardar");

// Elementos de ubicación
const btnUsarGps = $("#btn-usar-gps");
const btnMostrarMapa = $("#btn-mostrar-mapa");
const btnOcultarMapa = $("#btn-ocultar-mapa");
const mapWrapper = $("#map-wrapper");
const mapContainer = $("#map-perfil");

const ubicacionEstado = $("#ubicacion-estado");
const coordenadas = $("#coordenadas");
const ubicacionGuardada = $("#ubicacion-guardada");
const editUbicacionTexto = $("#edit-ubicacion-texto");
const direccionInput = $("#direccion");

const mensajeExito = $("#mensaje-exito");
const mensajeError = $("#mensaje-error");

// NUEVO: botón eliminar cuenta
const btnEliminarCuenta = $("#btnEliminarCuenta");


// ============================================================
// ESTADO
// ============================================================

let usuarioActual = null;
let perfilActual = null;
let guardando = false;
let ubicacionNueva = false;
let ubicacionSeleccionada = null;

// Mapa
let map = null;
let marker = null;
let mapInicializado = false;

// Centro por defecto (Barranquilla)
const DEFAULT_CENTER = { lat: 10.96854, lng: -74.78132 };


// ============================================================
// MENSAJES
// ============================================================

function ocultarMensajes() {
  if (mensajeExito) {
    mensajeExito.style.display = "none";
    mensajeExito.textContent = "";
  }
  if (mensajeError) {
    mensajeError.style.display = "none";
    mensajeError.textContent = "";
  }
}

function mostrarExito(texto) {
  if (!mensajeExito) return;
  if (mensajeError) {
    mensajeError.style.display = "none";
    mensajeError.textContent = "";
  }
  mensajeExito.textContent = "✅ " + texto;
  mensajeExito.style.display = "block";
  clearTimeout(mensajeExito._timeout);
  mensajeExito._timeout = setTimeout(() => {
    mensajeExito.style.display = "none";
  }, 4000);
}

function mostrarError(texto) {
  if (!mensajeError) return;
  if (mensajeExito) {
    mensajeExito.style.display = "none";
    mensajeExito.textContent = "";
  }
  mensajeError.textContent = "❌ " + texto;
  mensajeError.style.display = "block";
  clearTimeout(mensajeError._timeout);
  mensajeError._timeout = setTimeout(() => {
    mensajeError.style.display = "none";
  }, 5000);
}


// ============================================================
// LOADING
// ============================================================

function mostrarLoading(texto = "Cargando tu perfil…") {
  if (!loading) return;
  const strong = loading.querySelector("strong");
  if (strong) {
    strong.textContent = texto;
  }
  loading.classList.remove("hidden");
}

function ocultarLoading() {
  if (!loading) return;
  loading.classList.add("hidden");
}


// ============================================================
// UTILIDADES
// ============================================================

function textoSeguro(valor, fallback = "") {
  if (valor === null || valor === undefined) {
    return fallback;
  }
  return String(valor).trim();
}

function formatearCoordenadas(lat, lng) {
  if (lat == null || lng == null) return "No disponible";
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

function normalizarRol(valor) {
  const rol = textoSeguro(valor, "cliente").toLowerCase();
  if (
    rol === "comerciante" ||
    rol === "merchant" ||
    rol === "seller" ||
    rol === "shop"
  ) {
    return "comerciante";
  }
  return "cliente";
}

function etiquetaComerciante(tipo) {
  const tipos = {
    tienda: "Tienda",
    licoreria: "Licorería",
    verdureria: "Verdurería",
    farmacia: "Farmacia",
    carniceria: "Carnicería",
    panaderia: "Panadería",
    restaurante: "Restaurante",
    papeleria: "Papelería"
  };
  const key = textoSeguro(tipo, "tienda").toLowerCase();
  return tipos[key] || tipo || "Comerciante";
}


// ============================================================
// AVATAR Y TIPO
// ============================================================

function actualizarAvatar(perfil) {
  const avatar = $("#perfil-avatar");
  if (!avatar) return;
  const nombres = textoSeguro(perfil?.nombres, "");
  const apellidos = textoSeguro(perfil?.apellidos, "");
  let iniciales = "";
  if (nombres) iniciales += nombres.charAt(0);
  if (apellidos) iniciales += apellidos.charAt(0);
  if (!iniciales) {
    const email = textoSeguro(usuarioActual?.email, "U");
    iniciales = email.charAt(0);
  }
  avatar.textContent = iniciales.substring(0, 2).toUpperCase();
}

function actualizarTipo(perfil) {
  const elemento = $("#perfil-tipo");
  if (!elemento) return;
  const rol = normalizarRol(perfil?.tipo || perfil?.rol);
  if (rol === "comerciante") {
    const tipoComerciante = perfil?.tipoComerciante || "tienda";
    elemento.innerHTML = `
      <i class="fas fa-store"></i>
      <span>
        Comerciante · ${etiquetaComerciante(tipoComerciante)}
      </span>
    `;
  } else {
    elemento.innerHTML = `
      <i class="fas fa-user"></i>
      <span>Cliente</span>
    `;
  }
}


// ============================================================
// OBTENER TEXTO UBICACIÓN
// ============================================================

function obtenerTextoUbicacion(perfil) {
  if (!perfil) {
    return "No has guardado tu ubicación aún.";
  }

  let lat = perfil.latitud ?? perfil.lat ?? perfil.ubicacion?.lat;
  let lon = perfil.longitud ?? perfil.lon ?? perfil.lng ?? perfil.ubicacion?.lon ?? perfil.ubicacion?.lng;

  lat = Number(lat);
  lon = Number(lon);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const direccion = perfil.direccion || "";
    if (direccion) {
      return `${direccion} · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    return `Ubicación registrada · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  return "No has guardado tu ubicación aún.";
}


// ============================================================
// CARGAR VISTA
// ============================================================

function cargarVista(perfil) {
  console.log('📋 Cargando vista del perfil:', perfil);

  const viewNombres = document.getElementById('view-nombres');
  const viewApellidos = document.getElementById('view-apellidos');
  const viewTelefono = document.getElementById('view-telefono');
  const viewEmail = document.getElementById('view-email');
  const viewUbicacion = document.getElementById('view-ubicacion');
  const viewUbicacionDetalle = document.getElementById('view-ubicacion-detalle');

  if (viewNombres) {
    viewNombres.textContent = textoSeguro(perfil?.nombres, "No registrado");
  }

  if (viewApellidos) {
    viewApellidos.textContent = textoSeguro(perfil?.apellidos, "No registrado");
  }

  if (viewTelefono) {
    viewTelefono.textContent = textoSeguro(perfil?.telefono, "No registrado");
  }

  if (viewEmail) {
    viewEmail.innerHTML = `
      ${textoSeguro(usuarioActual?.email || perfil?.email, "No disponible")}
      <i class="fas fa-lock email-lock-icon" title="Correo de acceso"></i>
    `;
  }

  // Mostrar ubicación en vista
  if (viewUbicacion) {
    const lat = perfil?.lat ?? perfil?.latitud ?? null;
    const lng = perfil?.lng ?? perfil?.longitud ?? null;
    const direccion = perfil?.direccion || "";

    if (lat && lng) {
      const coordsStr = formatearCoordenadas(lat, lng);
      if (direccion) {
        viewUbicacion.textContent = direccion;
        if (viewUbicacionDetalle) {
          viewUbicacionDetalle.textContent = `📍 ${direccion} · ${coordsStr}`;
          viewUbicacionDetalle.style.display = "block";
        }
      } else {
        viewUbicacion.textContent = `📍 ${coordsStr}`;
        if (viewUbicacionDetalle) {
          viewUbicacionDetalle.style.display = "none";
        }
      }
    } else {
      viewUbicacion.textContent = "No has guardado tu ubicación aún.";
      if (viewUbicacionDetalle) {
        viewUbicacionDetalle.style.display = "none";
      }
    }
  }

  actualizarAvatar(perfil);
  actualizarTipo(perfil);

  console.log('✅ Vista cargada correctamente');
}


// ============================================================
// CARGAR FORMULARIO
// ============================================================

function cargarFormulario(perfil) {
  const nombres = $("#nombres");
  const apellidos = $("#apellidos");
  const telefono = $("#telefono");
  const email = $("#email");
  const latitud = $("#latitud");
  const longitud = $("#longitud");

  if (nombres) nombres.value = textoSeguro(perfil?.nombres);
  if (apellidos) apellidos.value = textoSeguro(perfil?.apellidos);
  if (telefono) telefono.value = textoSeguro(perfil?.telefono);
  if (email) email.value = textoSeguro(usuarioActual?.email || perfil?.email);
  if (direccionInput) direccionInput.value = textoSeguro(perfil?.direccion);

  const lat = perfil?.lat ?? perfil?.latitud ?? "";
  const lon = perfil?.lng ?? perfil?.longitud ?? "";

  if (latitud) latitud.value = lat;
  if (longitud) longitud.value = lon;

  if (lat && lon) {
    ubicacionSeleccionada = { lat: Number(lat), lng: Number(lon) };
    if (coordenadas) {
      coordenadas.textContent = `📍 ${formatearCoordenadas(lat, lon)}`;
      coordenadas.style.display = "block";
    }
    if (ubicacionGuardada) {
      ubicacionGuardada.textContent = "✅ Ubicación guardada";
      ubicacionGuardada.style.display = "block";
    }
    if (editUbicacionTexto) {
      editUbicacionTexto.textContent = `📍 ${formatearCoordenadas(lat, lon)}`;
    }
  } else {
    if (coordenadas) coordenadas.style.display = "none";
    if (ubicacionGuardada) ubicacionGuardada.style.display = "none";
    if (editUbicacionTexto) {
      editUbicacionTexto.textContent = "Se utiliza para mostrarte comercios cercanos.";
    }
  }
}


// ============================================================
// MOSTRAR MODO VISTA / EDICIÓN
// ============================================================

function mostrarVista() {
  if (editMode) editMode.classList.add("hidden");
  if (viewMode) viewMode.classList.remove("hidden");
  ocultarMensajes();
  if (mapWrapper) mapWrapper.classList.remove("visible");
  if (btnMostrarMapa) btnMostrarMapa.style.display = "flex";
  if (btnOcultarMapa) btnOcultarMapa.style.display = "none";
}

function mostrarEdicion() {
  if (viewMode) viewMode.classList.add("hidden");
  if (editMode) editMode.classList.remove("hidden");
  cargarFormulario(perfilActual);
  ocultarMensajes();

  // Inicializar mapa en modo edición
  const lat = parseFloat($("#latitud")?.value) || DEFAULT_CENTER.lat;
  const lng = parseFloat($("#longitud")?.value) || DEFAULT_CENTER.lng;
  setTimeout(() => initMap(lat, lng), 300);

  if (mapWrapper) mapWrapper.classList.remove("visible");
  if (btnMostrarMapa) btnMostrarMapa.style.display = "flex";
  if (btnOcultarMapa) btnOcultarMapa.style.display = "none";

  setTimeout(() => {
    $("#nombres")?.focus();
  }, 100);
}


// ============================================================
// MAPA
// ============================================================

function initMap(lat = DEFAULT_CENTER.lat, lng = DEFAULT_CENTER.lng) {
  if (!mapContainer) return;

  // Si ya existe el mapa, actualizar vista
  if (map) {
    map.setView([lat, lng], 15);
    if (marker) marker.setLatLng([lat, lng]);
    return;
  }

  try {
    map = L.map(mapContainer, {
      zoomControl: true,
      zoomSnap: 0.1,
      zoomDelta: 0.5
    }).setView([lat, lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const icon = L.divIcon({
      html: '<i class="fas fa-map-pin" style="font-size:28px;color:#10b981;text-shadow:0 2px 4px rgba(0,0,0,0.3);"></i>',
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 28]
    });

    marker = L.marker([lat, lng], {
      draggable: true,
      icon: icon,
      title: 'Arrastra para ajustar'
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      actualizarUbicacionDesdeMapa(pos.lat, pos.lng);
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      actualizarUbicacionDesdeMapa(e.latlng.lat, e.latlng.lng);
    });

    mapInicializado = true;

    // Si hay ubicación guardada, mostrarla
    if (ubicacionSeleccionada) {
      marker.setLatLng([ubicacionSeleccionada.lat, ubicacionSeleccionada.lng]);
      map.setView([ubicacionSeleccionada.lat, ubicacionSeleccionada.lng], 15);
    }

  } catch (error) {
    console.error("Error inicializando mapa:", error);
    mostrarError("Error al cargar el mapa");
  }
}

function actualizarUbicacionDesdeMapa(lat, lng) {
  ubicacionSeleccionada = { lat, lng };

  const latitudInput = $("#latitud");
  const longitudInput = $("#longitud");

  if (latitudInput) latitudInput.value = lat;
  if (longitudInput) longitudInput.value = lng;

  if (coordenadas) {
    coordenadas.textContent = `📍 ${formatearCoordenadas(lat, lng)}`;
    coordenadas.style.display = "block";
  }
  if (ubicacionEstado) {
    ubicacionEstado.textContent = "✅ Ubicación seleccionada en el mapa";
    ubicacionEstado.style.display = "block";
  }
  if (editUbicacionTexto) {
    editUbicacionTexto.textContent = `📍 ${formatearCoordenadas(lat, lng)}`;
  }

  // Obtener dirección desde coordenadas
  obtenerDireccionDesdeCoordenadas(lat, lng);
}


// ============================================================
// REVERSE GEOCODING
// ============================================================

async function obtenerDireccionDesdeCoordenadas(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&lang=es`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.display_name && direccionInput) {
      direccionInput.value = data.display_name;
      if (editUbicacionTexto) {
        editUbicacionTexto.textContent = `📍 ${data.display_name}`;
      }
      if (ubicacionEstado) {
        ubicacionEstado.textContent = "✅ Dirección obtenida automáticamente";
      }
    }
  } catch (error) {
    console.warn("Error obteniendo dirección:", error);
  }
}


// ============================================================
// UBICACIÓN GPS
// ============================================================

function usarUbicacionGPS() {
  if (!navigator.geolocation) {
    mostrarError("Geolocalización no disponible en este dispositivo");
    return;
  }

  if (ubicacionEstado) {
    ubicacionEstado.textContent = "📍 Obteniendo ubicación...";
    ubicacionEstado.style.display = "block";
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;

      const latitudInput = $("#latitud");
      const longitudInput = $("#longitud");

      if (latitudInput) latitudInput.value = latitude;
      if (longitudInput) longitudInput.value = longitude;

      ubicacionSeleccionada = { lat: latitude, lng: longitude };

      if (coordenadas) {
        coordenadas.textContent = `📍 ${formatearCoordenadas(latitude, longitude)}`;
        coordenadas.style.display = "block";
      }
      if (ubicacionEstado) {
        ubicacionEstado.textContent = "✅ Ubicación GPS obtenida correctamente";
      }
      if (editUbicacionTexto) {
        editUbicacionTexto.textContent = `📍 ${formatearCoordenadas(latitude, longitude)}`;
      }

      // Actualizar mapa
      if (map) {
        map.setView([latitude, longitude], 15);
        if (marker) marker.setLatLng([latitude, longitude]);
      }

      obtenerDireccionDesdeCoordenadas(latitude, longitude);
      mostrarExito("📍 Ubicación GPS obtenida correctamente");
    },
    (error) => {
      console.error("Error GPS:", error);
      let mensaje = "No se pudo obtener la ubicación.";
      if (error.code === 1) {
        mensaje = "Permiso de ubicación denegado. Activa la ubicación del navegador.";
      } else if (error.code === 2) {
        mensaje = "No se pudo determinar tu ubicación. Intenta nuevamente.";
      } else if (error.code === 3) {
        mensaje = "La solicitud de ubicación tardó demasiado. Intenta nuevamente.";
      }
      if (ubicacionEstado) {
        ubicacionEstado.textContent = "❌ " + mensaje;
        ubicacionEstado.style.display = "block";
      }
      mostrarError(mensaje);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}


// ============================================================
// VALIDAR FORMULARIO
// ============================================================

function validarFormulario() {
  const nombres = textoSeguro($("#nombres")?.value);
  const apellidos = textoSeguro($("#apellidos")?.value);
  const telefono = textoSeguro($("#telefono")?.value);

  if (!nombres) {
    mostrarError("Escribe tus nombres.");
    $("#nombres")?.focus();
    return false;
  }

  if (nombres.length < 2) {
    mostrarError("Los nombres deben tener al menos 2 caracteres.");
    $("#nombres")?.focus();
    return false;
  }

  if (!apellidos) {
    mostrarError("Escribe tus apellidos.");
    $("#apellidos")?.focus();
    return false;
  }

  if (apellidos.length < 2) {
    mostrarError("Los apellidos deben tener al menos 2 caracteres.");
    $("#apellidos")?.focus();
    return false;
  }

  if (telefono) {
    const telefonoLimpio = telefono.replace(/[\s()-]/g, "");
    if (!/^[0-9+]{7,20}$/.test(telefonoLimpio)) {
      mostrarError("Escribe un número de celular válido.");
      $("#telefono")?.focus();
      return false;
    }
  }

  return true;
}


// ============================================================
// SESSION STORAGE
// ============================================================

function actualizarSessionStorage(usuario, perfil) {
  try {
    const rol = normalizarRol(perfil?.tipo || perfil?.rol);
    const datos = {
      uid: usuario?.uid,
      rol,
      tipoComerciante: perfil?.tipoComerciante || null
    };
    sessionStorage.setItem("currentUser", JSON.stringify(datos));
  } catch (error) {
    console.warn("⚠️ No se pudo actualizar currentUser:", error);
  }
}


// ============================================================
// GUARDAR PERFIL
// ============================================================

async function guardarPerfil(event) {
  event.preventDefault();

  if (guardando) return;

  ocultarMensajes();

  if (!usuarioActual) {
    mostrarError("No hay una sesión activa.");
    return;
  }

  if (!validarFormulario()) {
    return;
  }

  guardando = true;

  if (btnGuardar) btnGuardar.disabled = true;
  if (btnCancelar) btnCancelar.disabled = true;
  if (textoGuardar) textoGuardar.textContent = "Guardando…";

  try {
    const uid = usuarioActual.uid;
    const nombres = textoSeguro($("#nombres")?.value);
    const apellidos = textoSeguro($("#apellidos")?.value);
    const telefono = textoSeguro($("#telefono")?.value);
    const direccion = textoSeguro(direccionInput?.value);

    let lat = null;
    let lng = null;

    if (ubicacionSeleccionada) {
      lat = ubicacionSeleccionada.lat;
      lng = ubicacionSeleccionada.lng;
    } else if ($("#latitud")?.value && $("#longitud")?.value) {
      lat = parseFloat($("#latitud").value);
      lng = parseFloat($("#longitud").value);
      if (!Number.isFinite(lat)) lat = null;
      if (!Number.isFinite(lng)) lng = null;
    }

    const datosBase = perfilActual || {};

    const datosPerfil = {
      uid,
      nombres,
      apellidos,
      telefono,
      direccion: direccion || "",
      email: usuarioActual.email || datosBase.email || "",
      tipo: datosBase.tipo || datosBase.rol || "cliente",
      rol: datosBase.rol || datosBase.tipo || "cliente",
      tipoComerciante: datosBase.tipoComerciante ?? null,
      lat: lat,
      lng: lng,
      latitud: lat,
      longitud: lng,
      actualizadoEn: serverTimestamp()
    };

    if (!datosBase.createdAt) {
      datosPerfil.createdAt = serverTimestamp();
    }

    await setDoc(doc(db, "perfiles", uid), datosPerfil, { merge: true });

    perfilActual = { ...perfilActual, ...datosPerfil };

    actualizarSessionStorage(usuarioActual, perfilActual);

    cargarVista(perfilActual);

    mostrarVista();
    mostrarExito("✅ Perfil guardado correctamente");

    ubicacionNueva = false;

  } catch (error) {
    console.error("❌ Error guardando perfil:", error);
    let mensaje = "No se pudo guardar el perfil.";
    if (error?.code === "permission-denied") {
      mensaje = "Firebase rechazó la operación por permisos de Firestore. Revisa las reglas de /perfiles.";
    } else if (error?.code === "unavailable") {
      mensaje = "Firestore no está disponible en este momento. Intenta nuevamente.";
    } else if (error?.message) {
      mensaje = error.message;
    }
    mostrarError(mensaje);
  } finally {
    guardando = false;
    if (btnGuardar) btnGuardar.disabled = false;
    if (btnCancelar) btnCancelar.disabled = false;
    if (textoGuardar) textoGuardar.textContent = "Guardar cambios";
  }
}


// ============================================================
// CARGAR PERFIL FIRESTORE
// ============================================================

async function cargarPerfil(uid) {
  try {
    const referencia = doc(db, "perfiles", uid);
    const snapshot = await getDoc(referencia);

    if (snapshot.exists()) {
      perfilActual = snapshot.data() || {};
    } else {
      perfilActual = {
        uid,
        tipo: "cliente",
        rol: "cliente",
        tipoComerciante: null,
        nombres: "",
        apellidos: "",
        telefono: "",
        direccion: "",
        email: usuarioActual?.email || "",
        createdAt: serverTimestamp()
      };
      try {
        await setDoc(referencia, perfilActual, { merge: true });
      } catch (errorCrear) {
        console.warn("⚠️ No se pudo crear el perfil automáticamente:", errorCrear);
      }
    }

    if (usuarioActual?.email) {
      perfilActual.email = usuarioActual.email;
    }

    cargarVista(perfilActual);
    cargarFormulario(perfilActual);
    actualizarSessionStorage(usuarioActual, perfilActual);

  } catch (error) {
    console.error("❌ Error cargando perfil:", error);
    if (error?.code === "permission-denied") {
      mostrarError("No tienes permisos para consultar tu perfil. Revisa las reglas de Firestore.");
    } else {
      mostrarError("No se pudo cargar la información de tu perfil.");
    }
  }
}


// ============================================================
// ELIMINAR CUENTA  ← NUEVO
// ============================================================

function mostrarModalEliminarCuenta() {
  // Si ya existe un modal, no duplicar
  if (document.getElementById("modal-eliminar-cuenta")) return;

  const overlay = document.createElement("div");
  overlay.id = "modal-eliminar-cuenta";
  overlay.className = "modal-overlay";

  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="titulo-modal-eliminar">
      <div class="modal-icono">
        <i class="fas fa-triangle-exclamation"></i>
      </div>
      <h3 id="titulo-modal-eliminar">¿Eliminar tu cuenta?</h3>
      <p>
        Esta acción es <strong>permanente</strong>. Se eliminarán tu cuenta
        y los datos personales asociados. No podrás recuperar el acceso
        después de confirmar.
      </p>
      <div class="modal-acciones">
        <button type="button" id="btn-cancelar-eliminar" class="btn-secondary">
          <i class="fas fa-times"></i> Cancelar
        </button>
        <button type="button" id="btn-confirmar-eliminar" class="btn-confirmar-eliminar">
          <i class="fas fa-trash-can"></i> Eliminar definitivamente
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const btnCancelarModal = overlay.querySelector("#btn-cancelar-eliminar");
  const btnConfirmarModal = overlay.querySelector("#btn-confirmar-eliminar");

  const cerrarModal = () => {
    overlay.remove();
  };

  btnCancelarModal?.addEventListener("click", cerrarModal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrarModal();
  });

  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") {
      cerrarModal();
      document.removeEventListener("keydown", onEsc);
    }
  });

  btnConfirmarModal?.addEventListener("click", async () => {
    await ejecutarEliminacionCuenta(btnConfirmarModal, btnCancelarModal, cerrarModal);
  });
}

async function ejecutarEliminacionCuenta(btnConfirmar, btnCancelar, cerrarModal) {
  if (!usuarioActual) {
    mostrarError("No hay una sesión activa.");
    cerrarModal?.();
    return;
  }

  // Bloquear botones mientras se procesa
  if (btnConfirmar) {
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Eliminando…`;
  }
  if (btnCancelar) btnCancelar.disabled = true;

  try {
    // Verificar que functions esté disponible
    if (!functions) {
      throw new Error("El servicio de funciones no está configurado.");
    }

    const eliminarCuentaFn = httpsCallable(functions, "eliminarCuenta");
    const resultado = await eliminarCuentaFn();

    console.log("✅ Cuenta eliminada:", resultado.data);

    // Cerrar modal
    cerrarModal?.();

    // Mensaje de despedida
    mostrarExito("Tu cuenta ha sido eliminada. Cerrando sesión…");

    // Cerrar sesión
    try {
      await signOut(auth);
    } catch (err) {
      console.warn("⚠️ Error al cerrar sesión tras eliminar cuenta:", err);
    }

    // Limpiar sessionStorage
    try {
      sessionStorage.removeItem("currentUser");
    } catch (_) {}

    // Redirigir al inicio
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 1500);

  } catch (error) {
    console.error("❌ Error eliminando cuenta:", error);

    let mensaje = "No se pudo eliminar la cuenta. Intenta nuevamente.";

    if (error?.code === "functions/not-found") {
      mensaje = "La función de eliminación no está disponible todavía. Contacta a soporte.";
    } else if (error?.code === "functions/unauthenticated") {
      mensaje = "Tu sesión expiró. Vuelve a iniciar sesión.";
    } else if (error?.code === "functions/permission-denied") {
      mensaje = "No tienes permiso para eliminar esta cuenta.";
    } else if (error?.code === "functions/internal") {
      mensaje = "Ocurrió un error interno al eliminar tu cuenta. Intenta más tarde.";
    } else if (error?.message) {
      mensaje = error.message;
    }

    mostrarError(mensaje);

    // Restaurar botones del modal
    if (btnConfirmar) {
      btnConfirmar.disabled = false;
      btnConfirmar.innerHTML = `<i class="fas fa-trash-can"></i> Eliminar definitivamente`;
    }
    if (btnCancelar) btnCancelar.disabled = false;
  }
}


// ============================================================
// EVENTOS
// ============================================================

btnEditar?.addEventListener("click", mostrarEdicion);

btnCancelar?.addEventListener("click", () => {
  cargarFormulario(perfilActual);
  mostrarVista();
});

formPerfil?.addEventListener("submit", guardarPerfil);

// Eventos de ubicación
btnUsarGps?.addEventListener("click", usarUbicacionGPS);

btnMostrarMapa?.addEventListener("click", () => {
  if (!map) {
    const lat = parseFloat($("#latitud")?.value) || DEFAULT_CENTER.lat;
    const lng = parseFloat($("#longitud")?.value) || DEFAULT_CENTER.lng;
    initMap(lat, lng);
  } else {
    setTimeout(() => map.invalidateSize(), 300);
  }
  if (mapWrapper) mapWrapper.classList.add("visible");
  if (btnMostrarMapa) btnMostrarMapa.style.display = "none";
  if (btnOcultarMapa) btnOcultarMapa.style.display = "flex";
});

btnOcultarMapa?.addEventListener("click", () => {
  if (mapWrapper) mapWrapper.classList.remove("visible");
  if (btnMostrarMapa) btnMostrarMapa.style.display = "flex";
  if (btnOcultarMapa) btnOcultarMapa.style.display = "none";
});

// NUEVO: eliminar cuenta
btnEliminarCuenta?.addEventListener("click", mostrarModalEliminarCuenta);


// ============================================================
// INICIO DE SESIÓN
// ============================================================

onAuthStateChanged(auth, async (usuario) => {
  mostrarLoading("Verificando tu sesión…");

  if (!usuario) {
    usuarioActual = null;
    perfilActual = null;
    mostrarError("No hay una sesión activa. Redirigiendo al inicio…");
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 1200);
    return;
  }

  usuarioActual = usuario;

  try {
    await cargarPerfil(usuario.uid);
  } catch (error) {
    console.error("Error cargando perfil:", error);
  } finally {
    ocultarLoading();
  }
});


// ============================================================
// INICIO
// ============================================================

console.log("✅ perfil.js cargado correctamente");
console.log("📍 Sistema de ubicación activo (GPS, mapa, manual)");
console.log("🔍 El comerciante podrá ver la ubicación real del cliente");
console.log("🗑️  Eliminación de cuenta conectada (Cloud Function: eliminarCuenta)");