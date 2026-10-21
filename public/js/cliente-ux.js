// public/js/cliente-ux.js
// UX cliente: mapa a pantalla completa, conmutador Mapa/Lista y carrito flotante (FAB).
// No depende de Firebase; solo del DOM de productos.html. Compatible con CART SYNC PACK (CART_{uid}).

const $ = (id) => document.getElementById(id);

// ---- Elementos
const mapEl      = $('map');
const vsMap      = $('vs-map');
const vsList     = $('vs-list');
const backdrop   = $('map-backdrop');
const fabCart    = $('fab-cart');
const fabCount   = $('fab-count');
const cartDrawer = document.querySelector('.cart-section');

// ---- Helpers tienda/carrito (mismo criterio que productos.js)
function getActiveStoreId() {
  const qs = new URLSearchParams(location.search);
  const byQS = qs.get('tienda') || qs.get('uid') || qs.get('store');
  if (byQS) return byQS;
  try {
    const ls = localStorage.getItem('selected_store_uid');
    if (ls) return ls;
  } catch {}
  if (window.MERCHANT_UID) return window.MERCHANT_UID;
  return ''; // sin tienda activa
}
function cartKeyFor(uid) { return `CART_${uid || getActiveStoreId() || 'global'}`; }
function isStoreSelected() { return !!getActiveStoreId(); }

// ---- Mapa: abrir/cerrar fullscreen
function openMapFS() {
  if (!mapEl) return;
  mapEl.classList.add('fullscreen');
  document.body.classList.add('map-open');
  vsMap?.classList.add('active');
  vsList?.classList.remove('active');

  // Notifica a otros módulos (Leaflet, etc.)
  window.dispatchEvent(new CustomEvent('map:fullscreen', { detail: { open: true } }));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
}

function closeMapFS() {
  if (!mapEl) return;
  mapEl.classList.remove('fullscreen');
  document.body.classList.remove('map-open');
  vsList?.classList.add('active');
  vsMap?.classList.remove('active');

  window.dispatchEvent(new CustomEvent('map:fullscreen', { detail: { open: false } }));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
}

// ---- Carrito: abrir/cerrar drawer
function toggleCart(open) {
  const willOpen = (typeof open === 'boolean') ? open : !document.body.classList.contains('cart-open');
  if (willOpen) {
    document.body.classList.add('cart-open');
    fabCart?.setAttribute('aria-expanded', 'true');
  } else {
    document.body.classList.remove('cart-open');
    fabCart?.setAttribute('aria-expanded', 'false');
  }
}

// ---- Utils lectura de carritos
function parseCartSafe(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function listCartKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('CART_')) keys.push(k);
    }
  } catch {}
  return keys;
}
function sumCountFromCartArray(arr) {
  return arr.reduce((s, x) => s + (Number(x.qty || x.cantidad) || 0), 0);
}
function readCartCountForKey(key) {
  try { return sumCountFromCartArray(parseCartSafe(localStorage.getItem(key))); }
  catch { return 0; }
}

// Cuenta “inteligente”:
// - Si hay tienda activa → cuenta de ese carrito.
// - Si NO hay tienda activa → suma todos los `CART_*` (útil en el home).
function readSmartCartCount() {
  const active = getActiveStoreId();
  if (active) return readCartCountForKey(cartKeyFor(active));
  const keys = listCartKeys();
  return keys.reduce((s, k) => s + readCartCountForKey(k), 0);
}

// Encuentra una tienda “con carrito” para navegar cuando no hay tienda activa
function findStoreUidWithCart() {
  // Prioridad: selected_store_uid > cualquier CART_* con items
  try {
    const sel = localStorage.getItem('selected_store_uid') || '';
    if (sel) {
      const n = readCartCountForKey(cartKeyFor(sel));
      if (n > 0) return sel;
    }
  } catch {}
  // Si no, busca un CART_* con items
  const keys = listCartKeys();
  for (const k of keys) {
    if (readCartCountForKey(k) > 0) {
      // k = "CART_{uid}"
      const uid = k.slice('CART_'.length);
      if (uid && uid !== 'global') return uid;
    }
  }
  return ''; // nada encontrado
}

// ---- Badge del FAB (contador)
function updateFabBadge() {
  const n = readSmartCartCount();
  if (fabCount) fabCount.textContent = n ? String(n) : '';
  // También reflejamos en el título pequeño del carrito si existe
  const badgeHdr = document.getElementById('contador-carrito');
  if (badgeHdr) badgeHdr.textContent = `(${n})`;
}

// ---- Listeners básicos
vsMap?.addEventListener('click', openMapFS);
vsList?.addEventListener('click', closeMapFS);
backdrop?.addEventListener('click', () => {
  // Cierra mapa y carrito si se toca el backdrop
  closeMapFS();
  if (document.body.classList.contains('cart-open')) toggleCart(false);
});

// Tecla ESC cierra mapa fullscreen y el carrito si estuvieran abiertos
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('map-open')) closeMapFS();
    if (document.body.classList.contains('cart-open')) toggleCart(false);
  }
});

// FAB carrito — comportamiento inteligente:
// - Con tienda activa → abre/cierra drawer.
// - Sin tienda activa → intenta ir a la tienda con carrito; si existe window.pickTienda la usa (SPA),
//   si no, navega via querystring `?tienda={uid}` y hace scroll al catálogo si es posible.
fabCart?.addEventListener('click', () => {
  if (isStoreSelected()) {
    toggleCart();
    return;
  }
  // Sin tienda seleccionada → salta a tienda con carrito
  const uid = findStoreUidWithCart();
  if (!uid) {
    // No hay nada en carritos → solo abre/cierra (o podrías mostrar un toast)
    toggleCart(true);
    return;
  }
  try {
    if (typeof window.pickTienda === 'function') {
      window.pickTienda(uid);
      // Lleva al catálogo si existe
      document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  } catch {}
  // Fallback: navegación por URL (mantiene otros params)
  try {
    const url = new URL(location.href);
    url.searchParams.set('tienda', uid);
    location.href = url.toString();
  } catch {
    location.search = `?tienda=${encodeURIComponent(uid)}`;
  }
});

// Click fuera del drawer del carrito para cerrarlo
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('cart-open')) return;
  const clickedInsideCart = cartDrawer?.contains(e.target);
  const clickedFab = fabCart?.contains(e.target);
  if (!clickedInsideCart && !clickedFab) toggleCart(false);
});

// ---- Sincronización del contador del carrito

// 1) Evento personalizado emitido por productos.js (incluye detail.key y conteos)
window.addEventListener('cart:changed', (ev) => {
  // Si el evento corresponde al carrito activo, actualiza rápido con su conteo
  // (si no, hacemos el cálculo inteligente para cubrir vista "home")
  try {
    const detail = ev?.detail || {};
    const activeKey = cartKeyFor(getActiveStoreId());
    if (detail.key && detail.key === activeKey && typeof detail.count === 'number') {
      if (fabCount) fabCount.textContent = detail.count ? String(detail.count) : '';
      const badgeHdr = document.getElementById('contador-carrito');
      if (badgeHdr) badgeHdr.textContent = `(${detail.count || 0})`;
      return;
    }
  } catch {}
  updateFabBadge();
});

// 2) Cambios en localStorage (otras pestañas o módulos)
//    Reaccionamos a cualquier clave CART_*
window.addEventListener('storage', (e) => {
  if (!e.key) return;
  if (e.key === 'selected_store_uid' || e.key.startsWith('CART_')) {
    updateFabBadge();
  }
});

// 3) Observer por si el DOM del carrito se repinta sin emitir eventos
const cartCountEl = document.getElementById('cart-count');
if (cartCountEl) {
  const mo = new MutationObserver(updateFabBadge);
  mo.observe(cartCountEl, { characterData: true, subtree: true, childList: true });
}

// 4) Si cambian la tienda a “ninguna”, cierra el carrito (evita comprar sin tienda)
window.addEventListener('tienda:cambiada', (e) => {
  const uid = e?.detail?.uid || '';
  if (!uid && document.body.classList.contains('cart-open')) toggleCart(false);
  // El conteo puede cambiar de key activa → refresca badge
  updateFabBadge();
});

// ---- Inicio
(function init() {
  updateFabBadge();
  // Estado inicial del conmutador: dejamos "Mapa" activo visualmente
  vsMap?.classList.add('active');
  fabCart?.setAttribute('aria-expanded', 'false');
  fabCart?.setAttribute('aria-label', 'Abrir carrito');
})();
