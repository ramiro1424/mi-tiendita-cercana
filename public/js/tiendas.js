// ./js/tiendas.js
// Configuración del comercio (Panel Comerciante):
// mapa, guardar/editar, foto en Storage, preview y configuración de domicilio.
//
// IMPORTANTE:
// Este archivo NO realiza la siembra del catálogo.
// La siembra del catálogo debe estar centralizada en el sistema oficial
// de bootstrap / Cloud Functions para evitar catálogos duplicados,
// parciales o diferentes entre comerciantes del mismo tipo.

import { auth, db, storage } from './firebase-config.js';

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';


/* ============================================================
   CONFIGURACIÓN GENERAL
   ============================================================ */

const PLACEHOLDER_IMG =
  'https://placehold.co/160x110?text=Vista+previa';

const DEBOUNCE_DELAY = 350;

// Centro por defecto: Barranquilla aprox.
const DEFAULT_CENTER = {
  lat: 10.96854,
  lon: -74.78132
};


/* ============================================================
   CACHE SIMPLE
   ============================================================ */

let storeCache = {
  data: null,
  timestamp: 0
};

const CACHE_TIMEOUT = 30000;


/* ============================================================
   MAPA
   ============================================================ */

let map = null;
let marker = null;


/* ============================================================
   STORAGE
   ============================================================ */

let currentImageRef = null;


/* ============================================================
   HELPERS
   ============================================================ */

const $ = (id) => document.getElementById(id);

const debounce = (fn, ms) => {
  let t;

  return (...args) => {
    clearTimeout(t);

    t = setTimeout(() => {
      fn(...args);
    }, ms);
  };
};


const showMsg = (
  text,
  ok = true,
  duration = 3000
) => {
  const toast =
    $('global-msg') ||
    $('pc-msg');

  if (!toast) return;

  toast.style.display = 'block';

  toast.className = ok
    ? 'toast toast-success'
    : 'toast toast-error';

  toast.textContent = text;

  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
};


const emit = (type, payload) => {
  try {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: payload
      })
    );
  } catch {}
};


/* ============================================================
   PERFIL BÁSICO
   ============================================================ */

const toBasicProfile = (
  uid,
  d = {}
) => ({
  uid,

  nombre:
    d.nombre || '',

  imgUrl:
    d.imgUrl ||
    d.imageUrl ||
    '',

  imageUrl:
    d.imageUrl ||
    d.imgUrl ||
    '',

  descripcion:
    d.descripcion || '',

  direccion:
    d.direccion || '',

  telefono:
    d.telefono || '',

  horario:
    d.horario || '',

  lat:
    Number.isFinite(Number(d.lat))
      ? Number(d.lat)
      : null,

  lon:
    Number.isFinite(Number(d.lon))
      ? Number(d.lon)
      : null,

  activo:
    !!d.activo,

  tipoComercio:
    d.tipoComercio ||
    d.tipo ||
    'tienda',

  updatedAt:
    d.updatedAt?.seconds
      ? d.updatedAt.seconds * 1000
      : Date.now()
});


/* ============================================================
   VALIDACIONES
   ============================================================ */

const validateForm = () => {

  const nombre =
    $('tienda-nombre')?.value.trim();

  const direccion =
    $('tienda-direccion')?.value.trim();

  const lat =
    parseFloat(
      $('tienda-lat')?.value
    );

  const lon =
    parseFloat(
      $('tienda-lon')?.value
    );

  const errors = [];

  if (
    !nombre ||
    nombre.length < 2
  ) {
    errors.push(
      'El nombre debe tener al menos 2 caracteres'
    );
  }

  if (
    !direccion ||
    direccion.length < 5
  ) {
    errors.push(
      'La dirección debe tener al menos 5 caracteres'
    );
  }

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    errors.push(
      'La latitud debe ser válida (-90 a 90)'
    );
  }

  if (
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    errors.push(
      'La longitud debe ser válida (-180 a 180)'
    );
  }

  return errors;
};


/* ============================================================
   MAPA SEGURO
   ============================================================ */

function ensureMap(
  lat = DEFAULT_CENTER.lat,
  lon = DEFAULT_CENTER.lon
) {

  const mapEl =
    $('map-tienda');

  if (!mapEl) return;


  /*
   * Si el mapa ya existe,
   * solamente actualizamos su posición.
   */

  if (map) {

    map.setView(
      [lat, lon],
      map.getZoom() || 15
    );

    if (marker) {
      marker.setLatLng([
        lat,
        lon
      ]);
    }

    return;
  }


  /*
   * Evitar conflicto si Leaflet
   * dejó la instancia marcada.
   */

  if (mapEl._leaflet_id) {

    try {
      mapEl._leaflet_id = null;
    } catch {}
  }


  try {

    map = L
      .map(mapEl, {
        zoomControl: true,
        zoomSnap: 0.1,
        zoomDelta: 0.5
      })
      .setView(
        [lat, lon],
        15
      );


    L
      .tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 19,
          attribution:
            '&copy; OpenStreetMap'
        }
      )
      .addTo(map);


    marker = L.marker(
      [lat, lon],
      {
        draggable: true,
        title:
          'Arrastra para ajustar'
      }
    ).addTo(map);


    marker.on(
      'dragend',
      () => {

        const {
          lat: la,
          lng: lo
        } = marker.getLatLng();

        if ($('tienda-lat')) {
          $('tienda-lat').value =
            la.toFixed(6);
        }

        if ($('tienda-lon')) {
          $('tienda-lon').value =
            lo.toFixed(6);
        }

        updatePreviewOnMapChange(
          la,
          lo
        );
      }
    );

  } catch (e) {

    console.error(
      'Mapa:',
      e
    );

    showMsg(
      'Error al cargar el mapa',
      false,
      5000
    );
  }
}


/* ============================================================
   PREVIEW DEL MAPA
   ============================================================ */

function updatePreviewOnMapChange(
  lat,
  lon
) {

  const preview =
    $('preview-card');

  if (
    !preview ||
    preview.style.display === 'none'
  ) {
    return;
  }


  let coords =
    $('preview-coords');


  if (!coords) {

    coords =
      document.createElement('div');

    coords.id =
      'preview-coords';

    coords.className =
      'preview-coords';

    coords.style.cssText =
      'margin-top:10px;font-weight:600;color:#334155;';

    preview.appendChild(
      coords
    );
  }


  coords.textContent =
    `📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}


/* ============================================================
   CENTRAR MAPA
   ============================================================ */

function centerMapFromInputs() {

  const lat =
    parseFloat(
      $('tienda-lat')?.value
    );

  const lon =
    parseFloat(
      $('tienda-lon')?.value
    );


  if (
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {

    ensureMap(
      lat,
      lon
    );

  } else {

    showMsg(
      'Lat/Lon inválidas',
      false
    );
  }
}


/* ============================================================
   USAR MI UBICACIÓN
   ============================================================ */

async function useMyLocation() {

  if (!navigator.geolocation) {

    return showMsg(
      'Geolocalización no disponible',
      false
    );
  }


  const btn =
    $('btn-geolocalizar');

  const txt =
    btn?.textContent;


  if (btn) {

    btn.disabled = true;

    btn.textContent =
      'Buscando...';
  }


  navigator.geolocation.getCurrentPosition(

    (pos) => {

      const {
        latitude,
        longitude
      } = pos.coords;


      if ($('tienda-lat')) {

        $('tienda-lat').value =
          latitude.toFixed(6);
      }


      if ($('tienda-lon')) {

        $('tienda-lon').value =
          longitude.toFixed(6);
      }


      ensureMap(
        latitude,
        longitude
      );


      if (btn) {

        btn.disabled = false;

        btn.textContent =
          txt;
      }
    },


    () => {

      showMsg(
        'No se pudo obtener la ubicación',
        false
      );


      if (btn) {

        btn.disabled = false;

        btn.textContent =
          txt;
      }
    },


    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}


/* ============================================================
   PREVIEW
   ============================================================ */

function updatePreview(
  d = {}
) {

  const card =
    $('preview-card');

  if (!card) return;


  card.style.display =
    'block';


  const mapText = {

    'preview-nombre':
      d.nombre || '—',

    'preview-desc':
      d.descripcion || '—',

    'preview-direccion':
      d.direccion || '—',

    'preview-telefono':
      d.telefono || '—',

    'preview-horario':
      d.horario || '—',

    'preview-estado':
      d.activo
        ? 'Activa'
        : 'Inactiva'
  };


  Object.entries(
    mapText
  ).forEach(
    ([id, val]) => {

      if ($(id)) {
        $(id).textContent =
          val;
      }
    }
  );


  if (
    d.lat != null &&
    d.lon != null
  ) {

    updatePreviewOnMapChange(
      Number(d.lat),
      Number(d.lon)
    );
  }


  const updatedMs =
    d.updatedAt?.seconds
      ? d.updatedAt.seconds * 1000
      : (
          typeof d.updatedAt === 'number'
            ? d.updatedAt
            : Date.now()
        );


  if ($('preview-fecha')) {

    $('preview-fecha').textContent =
      new Date(updatedMs)
        .toLocaleString();
  }


  const img =
    d.imgUrl ||
    d.imageUrl ||
    $('tienda-image-preview')?.src ||
    PLACEHOLDER_IMG;


  if ($('preview-img')) {

    $('preview-img').src =
      img;
  }


  if ($('tienda-image-preview')) {

    $('tienda-image-preview').src =
      img;
  }
}


/* ============================================================
   CATÁLOGO
   ============================================================

   IMPORTANTE:

   La siembra NO se hace aquí.

   Antes este archivo ejecutaba:

       generarCatalogoBase(... { max: 300 })

   Eso podía generar catálogos diferentes entre comerciantes.

   Ahora la responsabilidad de sembrar queda centralizada
   en el sistema oficial de catálogo.

   Este helper únicamente informa el estado actual.
   ============================================================ */

async function maybeSeedCatalogForStore(
  uid
) {

  try {

    if (!uid) return;


    const refDoc =
      doc(db, 'tiendas', uid);

    const snap =
      await getDoc(refDoc);


    if (!snap.exists()) {
      return;
    }


    const d =
      snap.data() || {};


    const tipoComercio =
      String(
        d.tipoComercio ||
        d.tipo ||
        'tienda'
      )
      .trim()
      .toLowerCase();


    /*
     * NO SEMBRAMOS NADA AQUÍ.
     *
     * Solo dejamos información para
     * diagnóstico.
     */

    console.log(
      '[CATÁLOGO] Siembra frontend desactivada.',
      {
        uid,
        tipoComercio,
        catalogSeeded:
          d.catalogSeeded === true
      }
    );


    return {
      uid,
      tipoComercio,
      catalogSeeded:
        d.catalogSeeded === true
    };

  } catch (e) {

    console.warn(
      '[CATÁLOGO] No se pudo consultar estado:',
      e
    );

    return null;
  }
}


/* ============================================================
   FIRESTORE: CARGAR TIENDA
   ============================================================ */

async function loadStore(
  uid,
  force = false
) {

  const now =
    Date.now();


  /*
   * Usar cache cuando corresponde.
   */

  if (
    !force &&
    storeCache.data &&
    storeCache.timestamp >
      now - CACHE_TIMEOUT
  ) {

    updateUIWithStoreData(
      uid,
      storeCache.data
    );


    await cargarConfigDomicilio(
      uid
    );


    /*
     * NO sembrar catálogo desde aquí.
     */

    return;
  }


  try {

    const refDoc =
      doc(db, 'tiendas', uid);

    const snap =
      await getDoc(refDoc);


    if (snap.exists()) {

      const d =
        snap.data() || {};


      storeCache = {
        data: d,
        timestamp: now
      };


      updateUIWithStoreData(
        uid,
        d
      );


      /*
       * Solo consultar estado.
       * No sembrar.
       */

      await maybeSeedCatalogForStore(
        uid
      );


      await cargarConfigDomicilio(
        uid
      );


      emit(
        'store:loaded',
        toBasicProfile(
          uid,
          d
        )
      );

    } else {

      updateUIForNewStore(
        uid
      );


      emit(
        'store:loaded',
        toBasicProfile(
          uid,
          {}
        )
      );
    }

  } catch (e) {

    console.error(
      'Cargar tienda:',
      e
    );


    showMsg(
      'No se pudo cargar la información de la tienda',
      false,
      5000
    );
  }
}


/* ============================================================
   ACTUALIZAR UI CON DATOS
   ============================================================ */

function updateUIWithStoreData(
  uid,
  data
) {

  if ($('tienda-id')) {

    $('tienda-id').value =
      uid;
  }


  if ($('tienda-nombre')) {

    $('tienda-nombre').value =
      data.nombre || '';
  }


  if ($('tienda-descripcion')) {

    $('tienda-descripcion').value =
      data.descripcion || '';
  }


  if ($('tienda-direccion')) {

    $('tienda-direccion').value =
      data.direccion || '';
  }


  if ($('tienda-telefono')) {

    $('tienda-telefono').value =
      data.telefono || '';
  }


  if ($('tienda-horario')) {

    $('tienda-horario').value =
      data.horario || '';
  }


  if ($('tienda-activo')) {

    $('tienda-activo').checked =
      data.activo !== false;
  }


  /*
   * CARGAR TIPO DE COMERCIO
   */

  if ($('tienda-tipo')) {

    $('tienda-tipo').value =
      data.tipoComercio ||
      data.tipo ||
      'tienda';
  }


  const lat =
    Number(data.lat);

  const lon =
    Number(data.lon);


  const safeLat =
    Number.isFinite(lat)
      ? lat
      : DEFAULT_CENTER.lat;

  const safeLon =
    Number.isFinite(lon)
      ? lon
      : DEFAULT_CENTER.lon;


  if ($('tienda-lat')) {

    $('tienda-lat').value =
      safeLat.toFixed(6);
  }


  if ($('tienda-lon')) {

    $('tienda-lon').value =
      safeLon.toFixed(6);
  }


  /*
   * IMAGEN
   */

  const img =
    data.imgUrl ||
    data.imageUrl ||
    PLACEHOLDER_IMG;


  if ($('tienda-image-preview')) {

    $('tienda-image-preview').src =
      img;
  }


  ensureMap(
    safeLat,
    safeLon
  );


  updatePreview({
    ...data,
    lat: safeLat,
    lon: safeLon,
    imgUrl: img
  });
}


/* ============================================================
   UI NUEVA TIENDA
   ============================================================ */

function updateUIForNewStore(
  uid
) {

  storeCache = {
    data: {},
    timestamp: Date.now()
  };


  if ($('tienda-id')) {

    $('tienda-id').value =
      uid;
  }


  if ($('tienda-image-preview')) {

    $('tienda-image-preview').src =
      PLACEHOLDER_IMG;
  }


  if ($('preview-card')) {

    $('preview-card').style.display =
      'none';
  }


  if ($('tienda-lat')) {

    $('tienda-lat').value =
      DEFAULT_CENTER.lat.toFixed(6);
  }


  if ($('tienda-lon')) {

    $('tienda-lon').value =
      DEFAULT_CENTER.lon.toFixed(6);
  }


  ensureMap(
    DEFAULT_CENTER.lat,
    DEFAULT_CENTER.lon
  );
}


/* ============================================================
   SUBIR IMAGEN
   ============================================================ */

async function uploadImageIfAny(
  uid
) {

  const fileInput =
    $('tienda-image-file');


  if (
    !fileInput?.files ||
    !fileInput.files[0]
  ) {

    return null;
  }


  const file =
    fileInput.files[0];


  if (
    !file.type.startsWith('image/')
  ) {

    throw new Error(
      'Solo archivos de imagen'
    );
  }


  if (
    file.size >
    5 * 1024 * 1024
  ) {

    throw new Error(
      'La imagen no debe exceder 5MB'
    );
  }


  /*
   * Eliminar referencia anterior
   * cuando corresponda.
   */

  if (currentImageRef) {

    try {

      await deleteObject(
        currentImageRef
      );

    } catch {}
  }


  const path =
    `tiendas/${uid}/portada_${Date.now()}_${file.name}`;


  const storageRef =
    ref(
      storage,
      path
    );


  await uploadBytes(
    storageRef,
    file
  );


  currentImageRef =
    storageRef;


  return await getDownloadURL(
    storageRef
  );
}


/* ============================================================
   GUARDAR TIENDA
   ============================================================ */

async function saveStore(
  e,
  opts = {}
) {

  const {
    silent = false,
    skipValidation = false
  } = opts;


  if (e) {
    e.preventDefault();
  }


  const btn =
    $('btn-guardar');

  const txt =
    btn?.textContent;


  if (
    btn &&
    !silent
  ) {

    btn.disabled = true;

    btn.textContent =
      'Guardando...';
  }


  try {

    /*
     * VALIDAR
     */

    if (!skipValidation) {

      const errors =
        validateForm();


      if (errors.length) {

        throw new Error(
          errors.join('\n')
        );
      }
    }


    /*
     * UID
     */

    const uid =
      $('tienda-id')?.value ||
      auth.currentUser?.uid;


    if (!uid) {

      throw new Error(
        'No hay usuario autenticado'
      );
    }


    /*
     * IMAGEN
     */

    const imgUrl =
      await uploadImageIfAny(
        uid
      );


    /*
     * TIPO DE COMERCIO
     */

    const tipoComercio =
      String(
        $('tienda-tipo')?.value ||
        'tienda'
      )
      .trim()
      .toLowerCase();


    /*
     * DATOS
     */

    const data = {

      nombre:
        $('tienda-nombre')?.value.trim() ||
        '',

      descripcion:
        $('tienda-descripcion')?.value.trim() ||
        '',

      direccion:
        $('tienda-direccion')?.value.trim() ||
        '',

      telefono:
        $('tienda-telefono')?.value.trim() ||
        '',

      horario:
        $('tienda-horario')?.value.trim() ||
        '',

      lat:
        parseFloat(
          $('tienda-lat')?.value
        ),

      lon:
        parseFloat(
          $('tienda-lon')?.value
        ),

      activo:
        $('tienda-activo')?.checked ??
        true,

      /*
       * GUARDAR SIEMPRE EL TIPO
       * EN UN CAMPO ÚNICO Y CONSISTENTE.
       */

      tipoComercio,

      updatedAt:
        serverTimestamp()
    };


    /*
     * IMAGEN EN AMBOS CAMPOS
     * PARA COMPATIBILIDAD.
     */

    if (imgUrl) {

      data.imgUrl =
        imgUrl;

      data.imageUrl =
        imgUrl;
    }


    /*
     * GUARDAR TIENDA
     */

    await setDoc(
      doc(
        db,
        'tiendas',
        uid
      ),
      data,
      {
        merge: true
      }
    );


    /*
     * ACTUALIZAR CACHE
     */

    storeCache = {

      data: {
        ...(storeCache.data || {}),
        ...data
      },

      timestamp:
        Date.now()
    };


    /*
     * DATOS PARA PREVIEW
     */

    const shown = {

      ...data,

      imgUrl:
        imgUrl ||
        $('tienda-image-preview')?.src ||
        '',

      imageUrl:
        imgUrl ||
        $('tienda-image-preview')?.src ||
        '',

      updatedAt: {
        seconds:
          Math.floor(
            Date.now() / 1000
          )
      }
    };


    updatePreview(
      shown
    );


    window.showSavedBanner?.();


    if (!silent) {

      showMsg(
        'Comercio guardado correctamente'
      );
    }


    /*
     * IMPORTANTE:
     *
     * Ya NO llamamos aquí a la siembra
     * del catálogo.
     *
     * Antes:
     *
     * await maybeSeedCatalogForStore(uid);
     *
     * Eso podía generar el catálogo de
     * 300 productos desde el frontend.
     */


    emit(
      'store:saved',
      toBasicProfile(
        uid,
        shown
      )
    );

  } catch (err) {

    console.error(
      'Guardar tienda:',
      err
    );


    if (!silent) {

      showMsg(
        err.message ||
        'Error al guardar',
        false,
        5000
      );
    }

  } finally {

    if (
      btn &&
      !silent
    ) {

      btn.disabled =
        false;

      btn.textContent =
        txt;
    }
  }
}


/* ============================================================
   CONFIGURACIÓN DE DOMICILIO
   ============================================================ */

/**
 * Carga la configuración de domicilio
 * desde Firestore.
 */

async function cargarConfigDomicilio(
  uid
) {

  try {

    const docRef =
      doc(
        db,
        'tiendas',
        uid
      );


    const snap =
      await getDoc(
        docRef
      );


    if (!snap.exists()) {
      return;
    }


    const data =
      snap.data();


    const domicilio =
      data.domicilio || {
        activo: false,
        costo: 0,
        coberturaKm: 2
      };


    /*
     * RADIO SI
     */

    const radioSi =
      document.getElementById(
        'domicilio-si'
      );


    /*
     * RADIO NO
     */

    const radioNo =
      document.getElementById(
        'domicilio-no'
      );


    /*
     * DETALLE
     */

    const detalle =
      document.getElementById(
        'domicilio-detalle'
      );


    if (domicilio.activo) {

      if (radioSi) {
        radioSi.checked = true;
      }

      if (radioNo) {
        radioNo.checked = false;
      }

      if (detalle) {
        detalle.style.display =
          'block';
      }

    } else {

      if (radioSi) {
        radioSi.checked = false;
      }

      if (radioNo) {
        radioNo.checked = true;
      }

      if (detalle) {
        detalle.style.display =
          'none';
      }
    }


    /*
     * COSTO
     */

    const costoInput =
      document.getElementById(
        'costo-domicilio'
      );


    if (costoInput) {

      costoInput.value =
        domicilio.costo || 0;
    }


    /*
     * COBERTURA
     */

    const coberturaSelect =
      document.getElementById(
        'cobertura-domicilio'
      );


    if (coberturaSelect) {

      coberturaSelect.value =
        domicilio.coberturaKm || 2;
    }


    console.log(
      '📦 Configuración de domicilio cargada:',
      domicilio
    );


    return domicilio;

  } catch (error) {

    console.error(
      'Error cargando configuración:',
      error
    );

    return null;
  }
}


/**
 * Guarda configuración de domicilio.
 */

async function guardarConfigDomicilio() {

  const user =
    auth.currentUser;


  if (!user) {

    showMsg(
      'Debes iniciar sesión',
      false
    );

    return;
  }


  const tiendaId =
    user.uid;


  /*
   * Leer valores.
   */

  const ofreceDomicilio =
    document.querySelector(
      'input[name="domicilio-activo"]:checked'
    )?.value === 'si';


  const costo =
    Number(
      document.getElementById(
        'costo-domicilio'
      )?.value || 0
    );


  const coberturaKm =
    Number(
      document.getElementById(
        'cobertura-domicilio'
      )?.value || 2
    );


  /*
   * Validar.
   */

  if (
    ofreceDomicilio &&
    coberturaKm < 1
  ) {

    showMsg(
      'La cobertura debe ser al menos 1 km',
      false
    );

    return;
  }


  /*
   * Datos.
   */

  const data = {

    domicilio: {

      activo:
        ofreceDomicilio,

      costo:
        costo,

      coberturaKm:
        coberturaKm,

      actualizadoEn:
        serverTimestamp()
    }
  };


  try {

    await setDoc(
      doc(
        db,
        'tiendas',
        tiendaId
      ),
      data,
      {
        merge: true
      }
    );


    showMsg(
      '✅ Configuración de domicilio guardada correctamente'
    );


    console.log(
      '📦 Domicilio configurado:',
      data.domicilio
    );


    /*
     * Actualizar cache.
     */

    if (storeCache.data) {

      storeCache.data.domicilio =
        data.domicilio;
    }

  } catch (error) {

    console.error(
      'Error guardando configuración:',
      error
    );


    showMsg(
      '❌ Error al guardar: ' +
      error.message,
      false
    );
  }
}


/**
 * Obtiene configuración de domicilio.
 */

async function getDomicilioConfig(
  tiendaId
) {

  try {

    const docRef =
      doc(
        db,
        'tiendas',
        tiendaId
      );


    const snap =
      await getDoc(
        docRef
      );


    if (!snap.exists()) {

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

    console.error(
      'Error obteniendo configuración:',
      error
    );


    return {
      activo: false,
      costo: 0,
      coberturaKm: 2
    };
  }
}


/**
 * Calcula costo de envío.
 */

function calcularCostoEnvio(
  domicilioConfig,
  distanciaKm
) {

  if (
    !domicilioConfig ||
    !domicilioConfig.activo
  ) {

    return {
      costo: 0,
      disponible: false,
      mensaje:
        'No ofrece domicilio'
    };
  }


  /*
   * Fuera de cobertura.
   */

  if (
    distanciaKm >
    domicilioConfig.coberturaKm
  ) {

    return {

      costo: 0,

      disponible: false,

      mensaje:
        `Fuera de cobertura (máx ${domicilioConfig.coberturaKm} km)`
    };
  }


  /*
   * Domicilio gratis.
   */

  if (
    domicilioConfig.costo === 0
  ) {

    return {

      costo: 0,

      disponible: true,

      mensaje:
        'GRATIS'
    };
  }


  /*
   * Domicilio con costo.
   */

  return {

    costo:
      domicilioConfig.costo,

    disponible:
      true,

    mensaje:
      `$${domicilioConfig.costo.toLocaleString('es-CO')}`
  };
}


/* ============================================================
   EXPONER FUNCIONES GLOBALES
   ============================================================ */

window.domicilioApp = {

  cargarConfigDomicilio,

  guardarConfigDomicilio,

  getDomicilioConfig,

  calcularCostoEnvio
};


/* ============================================================
   INICIALIZACIÓN / LISTENERS
   ============================================================ */

function hookUI() {

  /*
   * Formulario tienda.
   */

  $('form-tienda')
    ?.addEventListener(
      'submit',
      (e) => saveStore(e)
    );


  /*
   * Geolocalización.
   */

  $('btn-geolocalizar')
    ?.addEventListener(
      'click',
      useMyLocation
    );


  /*
   * Centrar mapa.
   */

  $('btn-centrar-mapa')
    ?.addEventListener(
      'click',
      centerMapFromInputs
    );


  /*
   * Imagen.
   */

  $('tienda-image-file')
    ?.addEventListener(
      'change',
      (ev) => {

        const f =
          ev.target.files?.[0];


        if (!f) return;


        if (
          !f.type.startsWith('image/')
        ) {

          showMsg(
            'Solo imágenes',
            false
          );


          ev.target.value =
            '';


          return;
        }


        const r =
          new FileReader();


        r.onload = () => {

          if (
            $('tienda-image-preview')
          ) {

            $('tienda-image-preview').src =
              r.result;
          }
        };


        r.readAsDataURL(
          f
        );
      }
    );


  /* ==========================================================
     EVENTOS DE DOMICILIO
     ========================================================== */

  document
    .querySelectorAll(
      'input[name="domicilio-activo"]'
    )
    .forEach(
      (radio) => {

        radio.addEventListener(
          'change',
          (e) => {

            const detalle =
              document.getElementById(
                'domicilio-detalle'
              );


            if (!detalle) return;


            if (
              e.target.value === 'si'
            ) {

              detalle.style.display =
                'block';

            } else {

              detalle.style.display =
                'none';
            }
          }
        );
      }
    );


  /*
   * Guardar domicilio.
   */

  const btnGuardarDomicilio =
    document.getElementById(
      'guardar-config-domicilio'
    );


  if (btnGuardarDomicilio) {

    btnGuardarDomicilio.addEventListener(
      'click',
      guardarConfigDomicilio
    );
  }


  /* ==========================================================
     AUTOGUARDADO
     ========================================================== */

  const autoSave =
    debounce(
      () => {

        if (!auth.currentUser) {
          return;
        }


        if (!storeCache.data) {
          return;
        }


        const errors =
          validateForm();


        if (errors.length) {
          return;
        }


        saveStore(
          null,
          {
            silent: true,
            skipValidation: true
          }
        );
      },
      DEBOUNCE_DELAY
    );


  /*
   * Campos que se autoguardan.
   */

  [
    'tienda-nombre',
    'tienda-descripcion',
    'tienda-direccion',
    'tienda-telefono',
    'tienda-horario',
    'tienda-activo',
    'tienda-lat',
    'tienda-lon',
    'tienda-tipo'
  ]
    .forEach(
      (id) => {

        const el =
          $(id);


        if (!el) return;


        const ev =
          el.type === 'checkbox'
            ? 'change'
            : 'input';


        el.addEventListener(
          ev,
          autoSave
        );
      }
    );


  /*
   * Validación de coordenadas.
   */

  [
    'tienda-lat',
    'tienda-lon'
  ]
    .forEach(
      (id) => {

        const el =
          $(id);


        if (!el) return;


        el.addEventListener(
          'blur',
          () => {

            const v =
              parseFloat(
                el.value
              );


            if (
              !Number.isFinite(v)
            ) {

              showMsg(
                'Coordenadas inválidas',
                false
              );


              el.value =
                '';
            }
          }
        );
      }
    );
}


/* ============================================================
   INIT
   ============================================================ */

(function init() {

  /*
   * Leaflet.
   */

  if (
    typeof L === 'undefined'
  ) {

    showMsg(
      'Leaflet no cargó. El mapa no estará disponible.',
      false,
      8000
    );
  }


  hookUI();


  /*
   * Estado de autenticación.
   */

  onAuthStateChanged(
    auth,
    (user) => {

      if (user) {

        if ($('tienda-id')) {

          $('tienda-id').value =
            user.uid;
        }


        [
          'btn-guardar',
          'tienda-image-file'
        ]
          .forEach(
            (id) => {

              const el =
                $(id);


              if (el) {

                el.disabled =
                  false;
              }
            }
          );


        /*
         * Cargar tienda.
         */

        loadStore(
          user.uid
        );

      } else {

        if (
          $('tienda-image-preview')
        ) {

          $('tienda-image-preview').src =
            PLACEHOLDER_IMG;
        }


        ensureMap(
          DEFAULT_CENTER.lat,
          DEFAULT_CENTER.lon
        );


        [
          'btn-guardar',
          'tienda-image-file'
        ]
          .forEach(
            (id) => {

              const el =
                $(id);


              if (el) {

                el.disabled =
                  true;
              }
            }
          );
      }
    }
  );


  /*
   * Recargar tienda manualmente.
   */

  window.reloadStoreData = () => {

    if (
      auth.currentUser
    ) {

      loadStore(
        auth.currentUser.uid,
        true
      );
    }
  };

})();


/* ============================================================
   API PÚBLICA
   ============================================================ */

window.tiendaApp = {

  saveStore:
    (e) => saveStore(e),

  loadStore:
    (uid) => loadStore(
      uid,
      true
    ),

  useMyLocation,

  centerMapFromInputs

};