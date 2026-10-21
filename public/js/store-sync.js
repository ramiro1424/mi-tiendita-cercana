// public/js/store-sync.js
// Sincroniza perfil del comercio (nombre/foto/datos) en el panel y expone un snapshot para otras pantallas.

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { doc, onSnapshot }     from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

if (!window.__STORE_SYNC_INITED__) {
  window.__STORE_SYNC_INITED__ = true;

  const KEY = 'store_profile';
  const $ = (id) => document.getElementById(id);

  const normalize = (raw = {}) => ({
    uid: raw.uid || '',
    nombre: raw.nombre || '',
    imgUrl: raw.imgUrl || raw.imageUrl || '',
    descripcion: raw.descripcion || '',
    direccion: raw.direccion || '',
    telefono: raw.telefono || '',
    horario: raw.horario || '',
    lat: Number(raw.lat) || null,
    lon: Number(raw.lon ?? raw.lng) || null,
    activo: !!raw.activo,
    updatedAt: raw.updatedAt || Date.now(),
  });

  const persist = (p) => {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
    try { window.__storeProfile = p; } catch {}
  };

  const applyToHeader = (p) => {
    const nameEl = $('nombre-usuario');
    if (nameEl) nameEl.textContent = p.nombre || 'Comerciante';

    const avatar   = $('store-avatar');
    const fallback = $('user-fallback-icon');
    if (avatar && fallback) {
      if (p.imgUrl) {
        avatar.src = p.imgUrl;
        avatar.style.display = 'inline-block';
        fallback.style.display = 'none';
      } else {
        avatar.style.display = 'none';
        fallback.style.display = 'inline-block';
      }
    }
  };

  const applyToWelcome = (p) => {
    const elWelcome = $('welcome-title');
    if (elWelcome) elWelcome.textContent = p.nombre ? `¡Bienvenido, ${p.nombre}!` : '¡Bienvenido al Panel del Comerciante!';
  };

  const applyToDocumentTitle = (p) => {
    if (p?.nombre) document.title = `${p.nombre} — Panel del Comerciante`;
  };

  const applyToPreviewIfPresent = (p) => {
    // Solo si la tarjeta existe (pestaña Configuración)
    if (!$('preview-card')) return;
    const set = (id, val) => { const el = $(id); if (el) el.textContent = (val ?? '—'); };

    if ($('preview-img') && p.imgUrl) $('preview-img').src = p.imgUrl;
    // ⚠️ En tu HTML el id es "preview-nombre", no "preview-name"
    set('preview-nombre', p.nombre);
    set('preview-desc', p.descripcion);
    set('preview-direccion', p.direccion);
    set('preview-telefono', p.telefono);
    set('preview-horario', p.horario);
    set('preview-estado', p.activo ? 'Activa' : 'Inactiva');
    const fechaEl = $('preview-fecha');
    if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-CO');
  };

  const renderAll = (raw) => {
    const p = normalize(raw);
    applyToHeader(p);
    applyToWelcome(p);
    applyToDocumentTitle(p);
    applyToPreviewIfPresent(p);
    persist(p);
    return p;
  };

  const broadcast = (p) => {
    try {
      window.dispatchEvent(new CustomEvent('store:profile-changed', { detail: { uid: p.uid, profile: p } }));
    } catch {}
  };

  const applyAndBroadcast = (raw) => {
    const p = renderAll(raw);
    broadcast(p);
  };

  // Carga inicial desde cache
  try {
    const cached = localStorage.getItem(KEY);
    if (cached) applyAndBroadcast(JSON.parse(cached));
  } catch {}

  // Eventos emitidos por ./js/tiendas.js
  window.addEventListener('store:loaded', (e) => { if (e?.detail) applyAndBroadcast(e.detail); });
  window.addEventListener('store:saved',  (e) => { if (e?.detail) applyAndBroadcast(e.detail); });

  // Suscripción tiempo real a tiendas/{uid}
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    const ref = doc(db, 'tiendas', user.uid);
    onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const updatedAt =
        (d?.updatedAt?.seconds ? d.updatedAt.seconds * 1000 :
        d?.actualizadoEn?.seconds ? d.actualizadoEn.seconds * 1000 :
        Date.now());
      applyAndBroadcast({ uid: user.uid, ...d, updatedAt });
    });
  });

  // Utilidad para otras pantallas
  window.getStoreProfile = () => {
    try { return window.__storeProfile || JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
  };
}
