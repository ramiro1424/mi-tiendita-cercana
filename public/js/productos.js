// public/js/productos.js
// Overlay compacto con marcadores, preserva flujo, con fallback + caché
// ✅ Ajustes pedidos:
// 1) Ocultar barra de FILTROS DE PRODUCTOS en inicio (solo mostrarla luego de elegir tienda)
// 2) Filtro de TIPO DE MERCADO (tiendas, farmacias, carnicerias, licorerias, verdurerias) para filtrar TIENDAS en la portada
// 3) Al elegir tienda: mostrar productos y un mensaje "Bienvenido a la tienda … (comerciante) …"
// 4) Todo en tiempo real con el panel comerciante (onSnapshot ya está activo).
// 5) 🔥 NOMBRES DE PRODUCTOS: Ahora se guardan y envían correctamente al checkout
// 6) 🔥 CARRITO: Sincronización completa con nombres, imágenes y unidades
//
// ➜ No requiere cambios de HTML: si existen #productos-filters, #bienvenida-tienda o #market-filter se usan.
//    Si #market-filter no existe, se inyecta automáticamente arriba del grid de tiendas.
//
// -----------------------------------------------------------------------------

// Importes base
import { auth, db } from './firebase-config.js';
// 🔽 NUEVO: Importar signOut para cerrar sesión desde el menú
// 🔽 NUEVO: Importar signOut y onAuthStateChanged para cerrar sesión y actualizar el menú
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, query, where, onSnapshot, getDocs,
  doc, getDoc, setDoc, serverTimestamp, addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import {
  cargarTiendas,
  renderTiendasSelect,
  renderChips,
  renderTiendasGrid,
  haversineKm,
  fmtKm,
  detectarTipoComercio
} from './tiendas-public.js?v=44';


console.log('🚀 productos.js cargó');

// === DEBUG tiendas ===
const __DBG = true;
const __log = (...a)=> { if (__DBG) console.log('🧪[tiendas]', ...a); };

/* === STORES SAFE FALLBACK (cache + fetch directo) =================== */
const STORES_CACHE_KEY = 'storesCache_v1';

function paintFromCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORES_CACHE_KEY) || 'null');
    if (Array.isArray(cached) && cached.length) {
      hideTiendasSkeleton();
      safeRenderStores(cached, {});
    }
  } catch {}
}
          
async function fetchStoresWithFallback() {
  __log('fetchStoresWithFallback: start');

  // 1) intenta cargarTiendas()
  try {
    const viaModule = await cargarTiendas();
    __log('cargarTiendas() =>', Array.isArray(viaModule) ? viaModule.length : viaModule);
    if (Array.isArray(viaModule) && viaModule.length) {
      try { localStorage.setItem(STORES_CACHE_KEY, JSON.stringify(viaModule.slice(0, 50))); } catch {}
      return viaModule;
    }
  } catch (e) {
    console.warn('[fallback] cargarTiendas() falló:', e);
  }

  // 2) fallback: traer TODO directo desde Firestore
  try {
    const snap = await getDocs(collection(db, 'tiendas'));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    __log('getDocs(/tiendas) =>', all.length);
    try { localStorage.setItem(STORES_CACHE_KEY, JSON.stringify(all.slice(0, 50))); } catch {}
    return all;
  } catch (e) {
    console.error('[fallback] getDocs tiendas falló:', e);
    return [];
  }
}

/* ============================================================
   DOM Elements (extra para los nuevos requisitos)
============================================================ */
const prodsFilterBar = document.getElementById('filtros-productos');
const bienvenidaEl   = document.getElementById('bienvenida-tienda');
let marketFilterWrap = document.getElementById('market-filter');

/* ============================================================
   Estado Global
============================================================ */
let allTiendas = [];
let tiendas = [];
let tiendasFiltradas = [];
let tiendaSel = null;
let distancias = {};
let userLoc = null;

let cacheProductos = [];
const catalogoCachePorTipo = new Map();
let filtrados = [];
let page = 1;
const pageSize = 12;

// ✅ MOVEMOS ESTA VARIABLE AQUÍ ARRIBA PARA EVITAR EL ERROR DE REFERENCIA
let _cartUnsubscribe = null;

const PLACEHOLDER_IMG = 'https://placehold.co/100x100?text=Shop';

/* ============================================================
   Utilidades comunes
============================================================ */
const $id = (s) => document.getElementById(s);
const moneyFmt = new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits: 0 });
const money = (v)=> moneyFmt.format(Number(v)||0);
function debounce(fn, ms=300){ let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; }
function parseQS(key){ const u = new URLSearchParams(window.location.search); return u.get(key)||''; }
function setQS(key, value){
  const url = new URL(window.location.href);
  if (value && value.length) url.searchParams.set(key, value); else url.searchParams.delete(key);
  history.replaceState({}, '', url);
}
const normalize = (s='')=> String(s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();

/* === Resolver de imagen integrado (http(s) → placeholder) ============ */
function resolveImgUrl(p, w=300, h=300){
  const raw =
   p?.imagenUrl ?? p?.imagenURL ?? p?.imagen_url ?? p?.imageUrl ??
   p?.imagen ?? p?.fotoUrl ?? p?.foto ?? '';

  let fixed = String(raw || '')
    .replace(/placeholder\.co\//g, 'placehold.co/')
    .replace(/\n/g, '')
    .replace(/\s/g, '')
    .trim();

  if (fixed && !/^https?:\/\//i.test(fixed)) {
    fixed = `https://res.cloudinary.com/dc2pnkcvc/image/upload/v1783536663/${fixed}`;
    console.log('🔄 URL construida desde nombre:', fixed);
  }

  if (/^https?:\/\//i.test(fixed)) {
    console.log('✅ IMAGEN CLOUDINARY:', fixed);
    return fixed;
  }

  const name = p?.nombre || 'Producto';
  console.warn('⚠️ Sin imagen para:', name);
  return `https://placehold.co/${w}x${h}?text=${encodeURIComponent(name)}`;
}

// Helper de debugging
window.__dumpImgs = () => {
  return [...document.querySelectorAll('.producto-card')].map((card) => {
    const media = card.querySelector('.producto-media');
    const img   = card.querySelector('img.producto-img');
    return {
      id: card.dataset.pid,
      titulo: card.querySelector('.producto-titulo')?.textContent?.trim(),
      dataBg: media?.getAttribute('data-bg') || null,
      imgSrc: img?.getAttribute('src') || img?.getAttribute('data-src') || null
    };
  });
};

/* ============================================================
   Mercado (filtro de tiendas en portada)
============================================================ */
const MARKET_OPTIONS = [
  { val:'todos',       label:'Todos los mercados' },
  { val:'tiendas',     label:'Tiendas' },
  { val:'farmacias',   label:'Farmacias' },
  { val:'carnicerias', label:'Carnicerías' },
  { val:'licorerias',  label:'Licorerías' },
  { val:'verdurerias', label:'Verdurerías' },
];

function tiendaMarketType(t) {
  const tipo = detectarTipoComercio(t);
  const map = {
    'licoreria': 'licorerias',
    'carniceria': 'carnicerias',
    'farmacia': 'farmacias',
    'verdureria': 'verdurerias',
    'tienda': 'tiendas'
  };
  return map[tipo] || 'tiendas';
}

function ensureMarketFilter(){
  const grid = document.getElementById('tiendas-grid');
  if (!marketFilterWrap){
    if (grid && grid.parentElement){
      marketFilterWrap = document.createElement('div');
      marketFilterWrap.id = 'market-filter';
      marketFilterWrap.style.margin = '0 0 12px';
      marketFilterWrap.style.display = 'flex';
      marketFilterWrap.style.justifyContent = 'flex-start';
      grid.parentElement.insertBefore(marketFilterWrap, grid);
    }
  }
  if (!marketFilterWrap) return;

  marketFilterWrap.innerHTML = `
    <label style="font-weight:600;margin-right:8px;">Tipo de mercado:</label>
    <select id="market-select" style="padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;">
      ${MARKET_OPTIONS.map(o=>`<option value="${o.val}">${o.label}</option>`).join('')}
    </select>
  `;

  const sel = document.getElementById('market-select');
  const qs = parseQS('mercado'); if (qs) sel.value = qs;
  sel.addEventListener('change', ()=>{
    setQS('mercado', sel.value==='todos' ? '' : sel.value);
    applyMarketFilterAndRender();
  });
}

function applyMarketFilterAndRender(dmap={}){
  const sel = document.getElementById('market-select');
  const want = sel ? sel.value : 'todos';
  const base = [...allTiendas];

  if (want==='todos') {
    tiendasFiltradas = base;
  } else {
    tiendasFiltradas = base.filter(t=> tiendaMarketType(t) === want);
  }
  tiendas = [...tiendasFiltradas];
  updateGlobals();
  const chips = document.getElementById('tiendas-chips');
  const grid  = document.getElementById('tiendas-grid');
  renderChips(chips, tiendas, (id)=> pickTienda(id));
  renderTiendasGrid(grid, tiendas, (id)=> pickTienda(id), dmap);
  attachStoreGridHandlers();
  renderMapMarkers();
  drawCoverage();

  if (document.getElementById('map-compact')) {
    if (!mapCompact) initCompactMap();
    try { mapCompact.invalidateSize(); } catch {}
    renderCompactMarkers();
    fitCompactToTiendas();
  }
}

/* ============================================================
   Renders (lo existente + market filter)
============================================================ */
function safeRenderStores(list, dmap = {}) {
  allTiendas = Array.isArray(list) ? [...list] : [];
  tiendas    = [...allTiendas];
  updateGlobals();

  renderTiendasSelect(document.getElementById('selector-tienda'), tiendas, (id)=> pickTienda(id), parseQS('tienda') || null);
  renderChips(document.getElementById('tiendas-chips'), tiendas, (id)=> pickTienda(id));

  ensureMarketFilter();
  applyMarketFilterAndRender(dmap);
}

/* ============================================================
   Carrito (pack existente)
============================================================ */
function getActiveStoreId() {
  const qs = new URLSearchParams(location.search);
  const byQS = qs.get('tienda') || qs.get('uid') || qs.get('store');
  if (byQS) return byQS;
  try {
    const ls = localStorage.getItem('selected_store_uid');
    if (ls) return ls;
  } catch {}
  if (window.MERCHANT_UID) return window.MERCHANT_UID;
  return 'global';
}
function cartKey() { return `CART_${getActiveStoreId()}`; }
let CART = [];
function loadCart() {
  try { CART = JSON.parse(localStorage.getItem(cartKey()) || '[]'); if (!Array.isArray(CART)) CART = []; }
  catch { CART = []; }
}
function saveCart() { 
  try { 
    localStorage.setItem(cartKey(), JSON.stringify(CART)); 
  } catch {} 
  emitCartChanged(); 
}

function emptyCart(){
  if (!confirm('¿Vaciar carrito?')) return;

  CART = [];

  try {
    localStorage.setItem(cartKey(), JSON.stringify([]));
  } catch {}

  renderCartList();
  renderCartTotals();
  updateFab();
  emitCartChanged();
}

function calcCart() {
  let count = 0, subtotal = 0;

  for (const it of CART) {
    const q = Number(it.qty || it.cantidad || 1);
    const p = Number(it.unitPrice || it.price || it.precio || 0);

    count += q;
    subtotal += q * p;
  }

  return {
    count,
    subtotal,
    total: subtotal,
    discount: 0
  };
}

function renderCartTotals() {
  const { count, subtotal, total, discount } = calcCart();

  const c1 = document.getElementById('contador-carrito');
  const c2 = document.getElementById('cart-count');
  const c3 = document.getElementById('cart-subtotal');
  const c4 = document.getElementById('cart-discount');
  const c5 = document.getElementById('cart-total');
  const c6 = document.getElementById('total');

  if (c1) c1.textContent = `(${count})`;
  if (c2) c2.textContent = String(count);
  if (c3) c3.textContent = money(subtotal);
  if (c4) c4.textContent = money(discount);
  if (c5) c5.textContent = money(total);
  if (c6) c6.textContent = money(total);
}

function renderCartList() {
  if (typeof window.pintarCarrito === 'function') {
    window.pintarCarrito(CART);
    return;
  }

  const list = document.getElementById('carrito');
  if (!list) return;

  const cart = getCart();

  if (!cart || cart.length === 0) {
    list.innerHTML = `
      <div class="empty-cart" style="text-align:center;padding:40px 20px;color:#6b7280;">
        <i class="fas fa-shopping-cart" style="font-size:3rem;margin-bottom:16px;opacity:0.5;"></i>
        <p>Tu carrito está vacío</p>
        <p style="font-size:0.9rem;margin-top:8px;">Agrega algunos productos para continuar</p>
      </div>
    `;
    return;
  }

  list.innerHTML = cart.map((item, index) => {
    const subtotal = (Number(item.unitPrice) || 0) * (Number(item.qty) || 1);
    const nombre = item.nombre || item.title || item.productoId || 'Producto';
    const unitLabel = item.unitLabel || 'und.';
    const unitPrice = Number(item.unitPrice) || 0;
    const qty = Number(item.qty) || 1;
    const imagen = item.imagen || 'https://placehold.co/50x50?text=🛒';

    return `
      <li class="carrito-item" style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        background: #f8fafc;
        border-radius: 12px;
        margin-bottom: 10px;
        border: 1px solid #e5e7eb;
        transition: all 0.2s ease;
      ">
        <img 
          src="${imagen}" 
          alt="${nombre}"
          style="
            width: 50px;
            height: 50px;
            border-radius: 10px;
            object-fit: cover;
            border: 2px solid #fff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            flex-shrink: 0;
          "
        >
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:#111827;font-size:1rem;">
            ${nombre}
          </div>
          <div style="color:#6b7280;font-size:0.85rem;margin-top:2px;">
            ${qty} × ${unitLabel} · <strong style="color:#10b981;">${money(unitPrice)}</strong> / ${unitLabel}
          </div>
          <div style="color:#6b7280;font-size:0.8rem;margin-top:2px;">
            Subtotal: <strong style="color:#10b981;">${money(subtotal)}</strong>
          </div>
        </div>
        <div style="text-align:right;min-width:80px;">
          <div style="font-weight:700;color:#10b981;font-size:1.1rem;">
            ${money(subtotal)}
          </div>
          <button 
            class="carrito-item-eliminar" 
            data-index="${index}"
            style="
              background:#ef4444;
              color:#fff;
              border:none;
              width:32px;
              height:32px;
              border-radius:8px;
              cursor:pointer;
              display:flex;
              align-items:center;
              justify-content:center;
              transition:all 0.2s ease;
              margin-left:auto;
              margin-top:4px;
            "
            title="Quitar producto"
          >
            ✕
          </button>
        </div>
      </li>
    `;
  }).join('');

  list.querySelectorAll('.carrito-item-eliminar').forEach(btn => {
    btn.addEventListener('click', function() {
      const index = parseInt(this.getAttribute('data-index'));
      if (!isNaN(index)) {
        const cart = getCart();
        const removed = cart[index];
        cart.splice(index, 1);
        setCart(cart);
        renderCartList();
        renderCartTotals();
        updateFab();
        emitCartChanged();
        console.log(`🗑️ Eliminado: ${removed?.nombre || 'Producto'}`);
      }
    });
  });
}

function updateFab() {
  const { count } = calcCart();
  const badge = document.getElementById('fab-count') || document.getElementById('fab-badge');
  if (badge) badge.textContent = count ? String(count) : '';
}

// ============================================================
// 🔥 FUNCIÓN CORREGIDA: EMITIR CARRITO CON TODOS LOS DATOS
// ============================================================

function emitCartChanged() {
  const detail = { key: cartKey(), ...calcCart(), items: CART };
  window.dispatchEvent(new CustomEvent('cart:changed', { detail }));

  try {
    if (typeof window.syncCheckoutCart === 'function') {
      const tiendaId = tiendaSel?.id || getActiveStoreId();

      // 🔥 ENVIAR TODOS LOS DATOS DEL PRODUCTO AL CHECKOUT
      const items = CART.map(it => ({
        productoId: it.id || it.productoId,
        cantidad: Number(it.qty || it.cantidad || 1),
        precio: Number(it.unitPrice || it.price || it.precio || 0),
        nombre: it.nombre || it.title || 'Producto',      // ✅ NOMBRE
        imagen: it.imagen || it.image || '',              // ✅ IMAGEN
        unidad: it.unit || 'und.',                        // ✅ UNIDAD
        unitLabel: it.unitLabel || 'und.'                 // ✅ LABEL DE UNIDAD
      }));

      console.log('📦 Emitiendo carrito con nombres:', items);
      window.syncCheckoutCart(tiendaId, items);
    }
  } catch (e) {
    console.warn('Error en syncCheckoutCart:', e);
  }

  updateFab();
  renderCartTotals();
}

// ✅ FUNCIÓN CORREGIDA (SIN CÓDIGO DUPLICADO, SIN FUNCIONES ANIDADAS)
function initCartSync(){
  loadCart();
  listenCartChanges();
  renderCartTotals();
  renderCartList();
  updateFab();

  try {
    if (typeof window.syncCheckoutCart === 'function') {
      const tiendaId = tiendaSel?.id || getActiveStoreId();

      const items = (Array.isArray(CART) ? CART : []).map(it => ({
        productoId: it.id || it.productoId,
        cantidad: Number(it.qty || it.cantidad || 1),
        precio: Number(it.unitPrice || it.price || it.precio || 0),
        nombre: it.nombre || it.title || 'Producto',      // ✅ NOMBRE
        imagen: it.imagen || it.image || '',              // ✅ IMAGEN
        unidad: it.unit || 'und.',                        // ✅ UNIDAD
        unitLabel: it.unitLabel || 'und.'                 // ✅ LABEL DE UNIDAD
      }));

      console.log('📦 initCartSync: Emitiendo carrito con nombres:', items);
      window.syncCheckoutCart(tiendaId, items);
    }
  } catch {}

  document.getElementById('vaciar-carrito')
    ?.addEventListener('click', (e) => {
      e.preventDefault();
      emptyCart();
    });

  document.getElementById('fab-cart')
    ?.addEventListener('click', () => {
      document.querySelector('.cart-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

  window.addEventListener('cart:changed', (ev) => {
    const evKey = ev?.detail?.key;
    if (evKey && evKey !== cartKey()) return;

    renderCartTotals();
    renderCartList();
    updateFab();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === cartKey()) {
      loadCart();
      renderCartTotals();
      renderCartList();
      updateFab();
    }
  });

  window.addEventListener('tienda:cambiada', () => {
    loadCart();
    renderCartTotals();
    renderCartList();
    updateFab();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCartSync);
} else {
  initCartSync();
}


/* ============================================================
   Tema, Skeletons y referencias DOM que ya existían
   (CORREGIDO: Sin modo oscuro forzado, siempre claro)
============================================================ */
(function themeInit(){
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const apply = (mode)=>{
    // 🔥 FORZADO A MODO CLARO SIEMPRE
    root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', 'light'); } catch {}
    if (btn){
      const i = btn.querySelector('i');
      if (i){ i.classList.remove('fa-sun'); i.classList.add('fa-moon'); }
    }
  };
  apply('light');
  btn?.addEventListener('click', ()=>{ apply('light'); });
})();

const skelTiendas = document.getElementById('tiendas-grid-skel');
const skelProds   = document.getElementById('productos-skel');
function buildTiendasSkeleton(n=8){ if(!skelTiendas) return; skelTiendas.classList.remove('skel-prod'); skelTiendas.innerHTML = Array.from({length:n}).map(()=>`
  <div class="skel-card"><div class="skel-img"></div><div class="skel-body">
  <div class="skel-line w-80"></div><div class="skel-line w-60"></div><div class="skel-line w-40"></div></div></div>
`).join('');}
function showTiendasSkeleton(n=8){ if (skelTiendas){ buildTiendasSkeleton(n); skelTiendas.hidden=false; } }
function hideTiendasSkeleton(){ if (skelTiendas) skelTiendas.hidden=true; }
function buildProdsSkeleton(n=8){ if(!skelProds) return; skelProds.classList.add('skel-prod'); skelProds.innerHTML = Array.from({length:n}).map(()=>`
  <div class="skel-card"><div class="skel-img"></div><div class="skel-body">
  <div class="skel-line w-80"></div><div class="skel-line w-60"></div><div class="skel-line w-40"></div></div></div>
`).join('');}
function showProdsSkeleton(n=8){ if (skelProds){ buildProdsSkeleton(n); skelProds.hidden=false; } }
function hideProdsSkeleton(){ if (skelProds) skelProds.hidden=true; }

/* ============================================================
   Referencias DOM existentes
============================================================ */
const selTienda     = document.getElementById('selector-tienda');
const chipsWrap     = document.getElementById('tiendas-chips');
const gridTiendas   = document.getElementById('tiendas-grid');
const pickerSec     = document.getElementById('tienda-picker');

const perfilSec     = document.getElementById('perfil-tienda');
const perfilNombre  = document.getElementById('perfil-tienda-nombre');
const perfilDet     = document.getElementById('perfil-tienda-detalles');
const perfilLogo    = document.getElementById('perfil-tienda-logo');
const perfilDist    = document.getElementById('perfil-tienda-dist');
const perfilCard    = document.getElementById('perfil-tienda-card');

const badgeDist     = document.getElementById('badge-distancia');

const inputSearch   = document.getElementById('search-input');
const filtroCat     = document.getElementById('filtro-categoria');
const filtroPrecio  = document.getElementById('filtro-precio');
const filtroOrden   = document.getElementById('filtro-orden');
const precioMax     = document.getElementById('precio-maximo');

const contProductos = document.getElementById('productos');
const paginacion    = document.getElementById('pagination');

const btnUbicar     = document.getElementById('btn-ubicar');
const chipsGeoBtn   = document.getElementById('chips-mi-ubicacion');
const chipsAllBtn   = document.getElementById('chips-ver-todas');
const pickerGeo     = document.getElementById('picker-geo');
const pickerSkip    = document.getElementById('picker-omitir');

const mapSection    = document.querySelector('.map-section');
const mapEl         = document.getElementById('map');
const cartSection   = document.querySelector('.cart-section');

const viewMapBtn  = document.getElementById('vs-map');
const viewListBtn = document.getElementById('vs-list');

/* ============================================================
   Exponer helpers al window
============================================================ */
function updateGlobals(){ window.tiendas = tiendas; window.userLoc = userLoc; }
Object.assign(window, {
  pickTienda: (id)=>pickTienda(id),
  usarUbicacionYOrdenar: ()=>usarUbicacionYOrdenar(),
  goBackToStorePicker: ()=>goBackToStorePicker()
});

/* ============================================================
   Mostrar/ocultar picker/cambiar tienda
============================================================ */
const changeStoreBtns = [
  document.getElementById('perfil-cambiar-tienda'),
  document.getElementById('btn-cambiar-tienda'),
  document.getElementById('btn-change-store')
].filter(Boolean);
changeStoreBtns.forEach(b => b.addEventListener('click', (e)=>{ e.preventDefault(); goBackToStorePicker(); }));

function updateChangeStoreUI() {
  changeStoreBtns.forEach(b => { b.style.display = tiendaSel ? 'inline-flex' : 'none'; });
  if (pickerSec) pickerSec.style.display = tiendaSel ? 'none' : 'block';
  if (prodsFilterBar) prodsFilterBar.style.display = tiendaSel ? 'block' : 'none';
}

/* ============================================================
   Unidades / conversiones
============================================================ */
const UNIT_LABEL = { kg:'kg', lb:'lb', l:'L', ml:'mL', unidad:'und.' };
const LB_PER_KG = 2.2046226218;
const normalizeUnit = (u='unidad') => String(u||'unidad').toLowerCase();
function convertUnitPrice(precioBase, unidadBase, unidadDestino){
  const base = normalizeUnit(unidadBase);
  const to   = normalizeUnit(unidadDestino);
  const basePrice = Number(precioBase)||0;
  if (base === to) return basePrice;
  if (base==='kg' && to==='lb') return basePrice / LB_PER_KG;
  if (base==='lb' && to==='kg') return basePrice * LB_PER_KG;
  if (base==='l'  && to==='ml') return basePrice / 1000;
  if (base==='ml' && to==='l')  return basePrice * 1000;
  return basePrice;
}
function unitChoicesFor(base='unidad'){
  base = normalizeUnit(base);
  if (base==='kg') return ['kg','lb'];
  if (base==='lb') return ['lb','kg'];
  if (base==='l')  return ['l','ml'];
  if (base==='ml') return ['ml','l'];
  return ['unidad'];
}

/* ============================================================
   Emoji por categoría
============================================================ */
const EMOJI_BY_CAT = { frutas:'🍓', verduras:'🥬', carnes:'🥩', 'lácteos':'🥛', lacteos:'🥛', panadería:'🥐', panaderia:'🥐', bebidas:'🥤', congelados:'🧊', hogar:'🏠', electronica:'🔌', electrónica:'🔌', ropa:'👕', otros:'🛒' };
function emojiFor(p){
  const cat = normalize(p.categoria || '');
  return EMOJI_BY_CAT[cat] || '🛒';
}

/* ============================================================
   Chat helpers
============================================================ */
function getCurrentUser() { return auth.currentUser || null; }
function convId(merchantId, clientId) { return [merchantId, clientId].sort().join('_'); }
async function ensureConversation(tienda) {
  const user = getCurrentUser();
  if (!user || !tienda?.id) return null;
  const merchantId = tienda.id;
  const clientId   = user.uid;
  const cid        = convId(merchantId, clientId);
  const ref  = doc(db, 'conversaciones', cid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      id: cid, merchantId, clientId,
      merchantName: tienda.nombre || '',
      clientEmail: user.email || '',
      lastMessage: '', updatedAt: serverTimestamp(), abierto: true
    }, { merge: true });
  }
  return cid;
}

/* ============================================================
   Geolocalización / Distancias
============================================================ */
async function pedirUbicacion(){
  return new Promise((resolve,reject)=>{
    if (!navigator.geolocation) return reject(new Error('No soportado'));
    navigator.geolocation.getCurrentPosition(
      (pos)=> resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err)=> reject(err),
      { enableHighAccuracy:true, timeout:8000, maximumAge:0 }
    );
  });
}
function recalcularDistancias(baseList){
  if (!userLoc || !baseList?.length) return {};
  const m = {};
  baseList.forEach(t=>{
    if (t?.lat!=null && t?.lon!=null) {
      const d = haversineKm(userLoc, { lat: t.lat, lon: t.lon });
      if (d!=null) m[t.id] = d;
    }
  });
  distancias = m;
}


function filtrarPorCercania(tiendasArr, distMap) {
  return tiendasArr.filter(t => {
    const d = distMap[t.id];

    // Una tienda sin coordenadas válidas no puede considerarse cercana.
    if (d == null) return false;

    // Solo mostrar comercios dentro del radio permitido (1.7 km).
    return d <= RADIO_DESCUBRIMIENTO_KM;
  });
}

/* ============================================================
   Volver a elegir tienda
============================================================ */
let _unsubs = [];
function clearUnsubs() { try { _unsubs.forEach(fn => fn && fn()); } catch {} _unsubs = []; }
function goBackToStorePicker(){
  clearUnsubs();
  tiendaSel = null;
  const sel = document.getElementById('selector-tienda');
  sel && (sel.value = '');
  setQS('tienda', '');
  try { localStorage.removeItem('selected_store_uid'); } catch {}
  perfilSec && (perfilSec.hidden = true);
  cartSection && (cartSection.style.display = 'none');
  if (prodsFilterBar) prodsFilterBar.style.display = 'none';
  if (bienvenidaEl) bienvenidaEl.textContent = '';

  tiendas = [...allTiendas];
  updateGlobals();
  renderChips(document.getElementById('tiendas-chips'), tiendas, (id)=> pickTienda(id));
  renderTiendasGrid(document.getElementById('tiendas-grid'), tiendas, (id)=> pickTienda(id), distancias || {});
  attachStoreGridHandlers();
  renderMapMarkers();
  drawCoverage();

  const chipsEl = document.getElementById('tiendas-chips');
  chipsEl?.querySelectorAll('.tienda-chip').forEach(b => b.classList.remove('active'));
  const grid = document.getElementById('tiendas-grid');
  grid?.querySelectorAll('.card.tienda').forEach(c => c.classList.remove('selected'));

  cacheProductos = [];
  filtrados = [];
  hideProdsSkeleton();
  applyFiltersAndRender();

  if (pickerSec) pickerSec.style.display = 'block';
  document.title = 'Productos - Mi Tiendita Cercana';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  updateChangeStoreUI();
}

/* ============================================================
   Lazy images + variantes
============================================================ */
const SUPPORTS_LAZY = 'loading' in HTMLImageElement.prototype;
const PIXEL_1x1 = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
function enhanceLazyImages(container = contProductos){
  if (SUPPORTS_LAZY || !container) return;
  const imgs = container.querySelectorAll('img[data-src]');
  if (!imgs.length) return;
  const io = new IntersectionObserver((entries, ob)=>{
    for (const e of entries){
      if (!e.isIntersecting) continue;
      const img = e.target;
      const real = img.getAttribute('data-src');
      if (real){ img.src = real; img.removeAttribute('data-src'); }
      ob.unobserve(img);
    }
  }, { rootMargin:'300px' });
  imgs.forEach(img => io.observe(img));
}
function patchCardImage(id, url) {
  if (!contProductos || !id || !url) return;
  const sel = `.producto-card[data-pid="${CSS?.escape ? CSS.escape(id) : id}"]`;
  const card = contProductos.querySelector(sel);
  if (!card) return;
  const img = card.querySelector('img.producto-img');
  const media = card.querySelector('.producto-media');
  if (img) img.src = url;
  if (media) media.style.backgroundImage = `url("${url}")`;
}

/* ============================================================
   Render de Productos + Paginación
============================================================ */
function renderProductos(items) {
  if (!contProductos) return;
  if (!items?.length) {
    contProductos.innerHTML = `<div class="empty">No hay productos disponibles.</div>`;
    paginacion.innerHTML = '';
    return;
  }

  const IMG_W = 300, IMG_H = 300;

  contProductos.innerHTML = items.map(p => {
    const base = normalizeUnit(p.unidadBase || 'unidad');
    const choices = unitChoicesFor(base);
    const optHtml = choices.map(u => `<option value="${u}">${UNIT_LABEL[u]}</option>`).join('');
  
    const precioUnit = convertUnitPrice(Number(p.precio)||0, base, choices[0]);
    const badgeHtml = p.stickerUrl
      ? `<img class="prod-badge-img" src="${p.stickerUrl}" alt="" loading="lazy" width="48" height="48">`
      : `<span class="prod-badge">${emojiFor(p)}</span>`;
  
    const imgUrl = resolveImgUrl(p, IMG_W, IMG_H);

    const lazyAttrs = SUPPORTS_LAZY
      ? `loading="lazy" decoding="async" src="${imgUrl}"`
      : `decoding="async" data-src="${imgUrl}" src="${PIXEL_1x1}"`;
  
    return `
      <div class="producto-card" data-pid="${p.id}">
        <div class="producto-media"
             style="background-image:url('${imgUrl}')"
             data-bg="${imgUrl}">
          <img class="producto-img" ${lazyAttrs} width="${IMG_W}" height="${IMG_H}"
               alt="${(p.nombre||'Producto').replace(/"/g,'&quot;')}"
               onerror="this.onerror=null;this.src='https://placehold.co/${IMG_W}x${IMG_H}?text=Producto';">
          ${badgeHtml}
        </div>
  
        <div class="producto-info">
          <div class="producto-header">
            <h3 class="producto-titulo">${p.nombre || p.nombreBase || p.titulo || 'Producto'}</h3>
            <span class="producto-precio" data-price-base="${p.precio}" data-unit-base="${base}">
              ${money(precioUnit)} / ${UNIT_LABEL[choices[0]]}
            </span>
          </div>
  
          <p class="producto-desc">${p.descripcion||''}</p>
  
          <div class="producto-unidad">
            <label for="u-${p.id}" style="font-size:14px;color:#667;">Unidad:</label>
            <select id="u-${p.id}" class="unidad-selector" data-id="${p.id}">
              ${optHtml}
            </select>
          </div>
  
          <div class="cantidad-container">
            <button class="cantidad-btn" data-dec="${p.id}">−</button>
            <input class="cantidad-input" id="q-${p.id}" type="number" min="1" step="1" value="1" />
            <button class="cantidad-btn" data-inc="${p.id}">+</button>
          </div>
  
          <div class="producto-acciones">
            <button class="btn-agregar add-cart" data-id="${p.id}">
              <i class="fas fa-cart-plus"></i> Añadir
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  

  contProductos.querySelectorAll('.producto-media').forEach(div => {
    const bg = div.getAttribute('data-bg');

    if (bg) {
        div.style.backgroundImage = `url("${bg}")`;
    }
});

  enhanceLazyImages(contProductos);

  contProductos.querySelectorAll('.unidad-selector').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const pid = sel.dataset.id;
      const card = sel.closest('.producto-card');
      const priceEl = card.querySelector('.producto-precio');
      const base = priceEl.getAttribute('data-unit-base');
      const basePrice = Number(priceEl.getAttribute('data-price-base'))||0;
      const toUnit = sel.value;
      const newPrice = convertUnitPrice(basePrice, base, toUnit);
      priceEl.textContent = `${money(newPrice)} / ${UNIT_LABEL[toUnit]}`;
      const q = card.querySelector(`#q-${pid}`);
      if (q){
        if (['kg','lb','l'].includes(toUnit)) q.step = '0.5';
        else if (toUnit==='ml') q.step = '100';
        else q.step = '1';
      }
    });
  });

  contProductos.querySelectorAll('[data-inc]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.getAttribute('data-inc');
      const q = contProductos.querySelector(`#q-${id}`);
      const step = parseFloat(q.step||'1') || 1;
      const v = Math.max(step, (parseFloat(q.value||'1') + step));
      q.value = String(v);
    });
  });
  contProductos.querySelectorAll('[data-dec]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.getAttribute('data-dec');
      const q = contProductos.querySelector(`#q-${id}`);
      const step = parseFloat(q.step||'1') || 1;
      const v = Math.max(step, (parseFloat(q.value||'1') - step));
      q.value = String(v);
    });
  });

  contProductos.querySelectorAll('.add-cart').forEach(b=>{
    b.addEventListener('click', ()=> addToCart(b.dataset.id));
  });
}

function renderPagination(totalItems) {
  if (!paginacion) return;
  
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  
  if (totalPages <= 1) {
    paginacion.innerHTML = '';
    return;
  }
  
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  
  let html = '<div style="display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap;margin-top:20px;">';
  
  html += `<button data-page="prev" style="padding:6px 12px;border:1px solid #e5e7eb;border-radius:6px;background:${page > 1 ? '#fff' : '#f3f4f6'};color:${page > 1 ? '#374151' : '#9ca3af'};cursor:${page > 1 ? 'pointer' : 'not-allowed'};" ${page <= 1 ? 'disabled' : ''}>◀</button>`;
  
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, page + 2);
  
  if (start === 1) end = Math.min(totalPages, 5);
  if (end === totalPages) start = Math.max(1, totalPages - 4);
  
  if (start > 1) {
    html += `<button data-page="1" style="padding:6px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">1</button>`;
    if (start > 2) html += `<span style="color:#9ca3af;">…</span>`;
  }
  
  for (let i = start; i <= end; i++) {
    const active = i === page;
    html += `<button data-page="${i}" style="padding:6px 12px;border:1px solid ${active ? '#2563eb' : '#e5e7eb'};border-radius:6px;background:${active ? '#2563eb' : '#fff'};color:${active ? '#fff' : '#374151'};font-weight:${active ? '600' : '400'};cursor:pointer;min-width:36px;" ${active ? 'disabled' : ''}>${i}</button>`;
  }
  
  if (end < totalPages) {
    if (end < totalPages - 1) html += `<span style="color:#9ca3af;">…</span>`;
    html += `<button data-page="${totalPages}" style="padding:6px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">${totalPages}</button>`;
  }
  
  html += `<button data-page="next" style="padding:6px 12px;border:1px solid #e5e7eb;border-radius:6px;background:${page < totalPages ? '#fff' : '#f3f4f6'};color:${page < totalPages ? '#374151' : '#9ca3af'};cursor:${page < totalPages ? 'pointer' : 'not-allowed'};" ${page >= totalPages ? 'disabled' : ''}>▶</button>`;
  
  html += `<span style="font-size:13px;color:#6b7280;margin-left:8px;">${page} / ${totalPages}</span>`;
  html += '</div>';
  
  paginacion.innerHTML = html;
  
  paginacion.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.page;
      let newPage = page;
      if (target === 'prev') newPage = Math.max(1, page - 1);
      else if (target === 'next') newPage = Math.min(totalPages, page + 1);
      else newPage = parseInt(target, 10);
      
      if (newPage !== page && newPage >= 1 && newPage <= totalPages) {
        page = newPage;
        applyFiltersAndRender();
        contProductos?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

/* ============================================================
   Filtros (de productos)
============================================================ */
function normalizeCat(s=''){ return normalize(s); }
function applyFiltersAndRender(){
  if (!tiendaSel) {
    contProductos && (contProductos.innerHTML = '');
    paginacion && (paginacion.innerHTML = '');
    return;
  }

  const q = (inputSearch?.value || '').trim().toLowerCase();
  const cat = normalizeCat(filtroCat?.value || 'todos');
  const maxP = Number(filtroPrecio?.value || 100000);
  let arr = [...cacheProductos];

  if (q) arr = arr.filter(p =>
    (p.nombre||'').toLowerCase().includes(q) ||
    (p.descripcion||'').toLowerCase().includes(q)
  );
  if (cat !== 'todos') arr = arr.filter(p => normalizeCat(p.categoria||'') === cat);
  const aplicaPrecio = maxP < 100000 - 0.0001;
  if (aplicaPrecio) arr = arr.filter(p => (Number(p.precio) || 0) <= maxP);

  switch (filtroOrden?.value || 'defecto') {
    case 'precio-asc': arr.sort((a,b)=> (a.precio||0)-(b.precio||0)); break;
    case 'precio-desc': arr.sort((a,b)=> (b.precio||0)-(a.precio||0)); break;
    case 'nombre-asc': arr.sort((a,b)=> (a.nombre||'').localeCompare(b.nombre||'')); break;
    case 'nombre-desc': arr.sort((a,b)=> (b.nombre||'').localeCompare(a.nombre||'')); break;
    default: break;
  }

  filtrados = arr;

const totalPages = Math.max(1, Math.ceil(arr.length / pageSize));

if (page > totalPages) {
  page = 1;
}

const start = (page - 1) * pageSize;
const end = start + pageSize;

renderProductos(arr.slice(start, end));
renderPagination(arr.length);
}

/* ============================================================
   Firestore Listener de Productos
============================================================ */

function listenProductosByTienda(tiendaId){

  clearUnsubs();
  showProdsSkeleton(8);

  if (!tiendaId) {
    cacheProductos = [];
    hideProdsSkeleton();
    applyFiltersAndRender();
    return;
  }

  // ============================================================
  // 🔥 YA TENEMOS LA TIENDA SELECCIONADA
  // No volvemos a consultar tiendas/{tiendaId}
  // ============================================================

  const tiendaActual = tiendaSel;

  let tipoComerciante = 'tienda';

  try {
    if (tiendaActual) {
      tipoComerciante = detectarTipoComercio(tiendaActual);
    }
  } catch (error) {
    console.warn('⚠️ No se pudo detectar tipo de comercio:', error);
  }

  const tipoLower = String(tipoComerciante || 'tienda')
    .toLowerCase()
    .trim();

  console.log('⚡ CARGA RÁPIDA');
  console.log('🏪 Tienda:', tiendaId);
  console.log('📊 Tipo:', tipoLower);

  // ============================================================
  // 🔥 MOSTRAR CACHÉ INMEDIATAMENTE
  // ============================================================

  const cacheKey = `${tipoLower}::${tiendaId}`;
  const catalogoCacheado = catalogoCachePorTipo.get(cacheKey);

  if (Array.isArray(catalogoCacheado) && catalogoCacheado.length) {

    console.log(
      `⚡ Catálogo en caché: ${catalogoCacheado.length} productos`
    );

    cacheProductos = [...catalogoCacheado];

    page = 1;
    hideProdsSkeleton();
    applyFiltersAndRender();
  }

  // ============================================================
  // 🔥 DETERMINAR CATÁLOGO
  // ============================================================

  let qRoot;

  if (tipoLower === 'licoreria') {

    console.log(
      '🍾 Catálogo licorería → catalogos/licoreria/productos'
    );

    qRoot = query(
      collection(db, 'catalogos', 'licoreria', 'productos'),
      where('estado', '==', 'activo')
    );

  } else if (tipoLower === 'farmacia') {

    console.log(
      '💊 Catálogo farmacia → catalogos/farmacia/productos'
    );

    qRoot = query(
      collection(db, 'catalogos', 'farmacia', 'productos'),
      where('estado', '==', 'activo')
    );

  } else if (tipoLower === 'carniceria') {

    console.log(
      '🥩 Catálogo carnicería → catalogos/carniceria/productos'
    );

    qRoot = query(
      collection(db, 'catalogos', 'carniceria', 'productos'),
      where('estado', '==', 'activo')
    );

  } else if (tipoLower === 'verdureria') {

    console.log(
      '🥬 Catálogo verdurería → catalogos/verdureria/productos'
    );

    qRoot = query(
      collection(db, 'catalogos', 'verdureria', 'productos'),
      where('estado', '==', 'activo')
    );

  } else {

    // ==========================================================
    // 🏪 TIENDA
    // ==========================================================

    console.log(
      '🏪 Catálogo tienda → productos'
    );

    qRoot = query(
      collection(db, 'productos'),
      where('tiendaId', '==', tiendaId)
    );
  }

  // ============================================================
  // 🔥 LISTENER EN TIEMPO REAL
  // ============================================================

  const unsubRoot = onSnapshot(
    qRoot,

    (snap) => {

      const arr = [];

      snap.forEach(d => {
        arr.push({
          id: d.id,
          ...d.data()
        });
      });

      // Filtrar productos activos
      const productosValidos = arr.filter(p => {

        const estadoValido =
          p.estado === 'activo' ||
          p.estado === true ||
          p.activo === true;

        return estadoValido;
      });

      // ========================================================
      // 🔥 GUARDAR CATÁLOGO EN CACHÉ POR TIENDA
      // ========================================================

      catalogoCachePorTipo.set(
        cacheKey,
        [...productosValidos]
      );

      // ========================================================
      // 🔥 ACTUALIZAR CATÁLOGO ACTUAL
      // ========================================================

      cacheProductos = [...productosValidos];

      console.log(
        `✅ CATÁLOGO ${tipoLower}: ${cacheProductos.length} productos`
      );

      page = 1;

      hideProdsSkeleton();

      applyFiltersAndRender();
    },

    (err) => {

      console.warn(
        '⚠️ Error escuchando catálogo:',
        err
      );

      // Si ya teníamos caché, NO dejamos la pantalla vacía
      if (
        Array.isArray(catalogoCacheado) &&
        catalogoCacheado.length
      ) {

        cacheProductos = [...catalogoCacheado];

        hideProdsSkeleton();
        applyFiltersAndRender();

      } else {

        hideProdsSkeleton();
        applyFiltersAndRender();
      }
    }
  );

  _unsubs.push(unsubRoot);
}/* ============================================================
   Perfil de Tienda + Bienvenida
============================================================ */
function showPerfilTienda(t){
  if (!t) {
    if (perfilSec) perfilSec.hidden = true;
    if (perfilDist){ perfilDist.hidden = true; perfilDist.textContent=''; }
    if (prodsFilterBar) prodsFilterBar.style.display = 'none';
    if (bienvenidaEl) bienvenidaEl.textContent = '';
    return;
  }
  if (perfilSec) perfilSec.hidden = false;
  if (perfilNombre) perfilNombre.textContent = t.nombre || 'Tienda';
  if (perfilDet) perfilDet.textContent = [t.direccion, t.horario].filter(Boolean).join(' • ');
  if (perfilLogo) perfilLogo.src = t.logoUrl || t.imgUrl || PLACEHOLDER_IMG;

  const d = distancias[t.id];
  if (badgeDist) badgeDist.textContent = d!=null ? fmtKm(d) : '';
  if (perfilDist) {
    if (d!=null) { perfilDist.textContent = fmtKm(d); perfilDist.hidden = false; }
    else { perfilDist.textContent = ''; perfilDist.hidden = true; }
  }

  const comerciante = 
    t.comerciante || t.propietario || t.dueno || t.duenio || t.ownerName || t.merchantName || '';
  
  let saludo = '';
  if (comerciante) {
    saludo = `¡Bienvenido al comercio de ${comerciante}!`;
  } else {
    saludo = `¡Bienvenido a ${t.nombre || 'nuestra tienda'}!`;
  }
  
  if (bienvenidaEl) {
    bienvenidaEl.textContent = saludo;
    bienvenidaEl.style.display = 'block';
    bienvenidaEl.style.fontSize = '1.1rem';
    bienvenidaEl.style.fontWeight = '600';
    bienvenidaEl.style.color = '#2563eb';
    bienvenidaEl.style.margin = '10px 0';
    bienvenidaEl.style.padding = '8px 12px';
    bienvenidaEl.style.backgroundColor = '#dbeafe';
    bienvenidaEl.style.borderRadius = '8px';
    bienvenidaEl.style.textAlign = 'center';
  }

  if (prodsFilterBar) prodsFilterBar.style.display = 'block';

  if (perfilCard){
    perfilCard.classList.remove('selected'); 
    void perfilCard.offsetWidth; 
    perfilCard.classList.add('selected');
  }

  document.title = `${t.nombre || 'Tienda'} — Productos - Mi Tiendita Cercana`;
}

/* ============================================================
   Mapa Leaflet (grande + compacto)
============================================================ */
let map, markers = [];
let userDot;
let coverageLayers = [];
let mapCompact; let markersCompact = []; let userDotCompact; let coverageLayersCompact = [];

const MAP_UI = { minZoom:10, maxZoom:18, defaultCenter:{ lat:4.65, lon:-74.1, zoom:12 } };

function initMap(){
  if (!mapEl || map) return;
  // eslint-disable-next-line no-undef
  map = L.map('map').setView([MAP_UI.defaultCenter.lat, MAP_UI.defaultCenter.lon], MAP_UI.defaultCenter.zoom);
  // eslint-disable-next-line no-undef
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'&copy; OpenStreetMap' }).addTo(map);
  const ov = document.getElementById('map-compact');
  if (ov && !mapCompact) initCompactMap();
}
function clearCoverage(){ coverageLayers.forEach(l=>{ try{ map.removeLayer(l); }catch{} }); coverageLayers = []; }
function drawCoverage(){
  if (!map) return;
  clearCoverage();
  tiendas.forEach(t=>{
    const km = Number(t.coberturaKm) || RADIO_MAX_KM;
    if (t.lat!=null && t.lon!=null && km>0){
      // eslint-disable-next-line no-undef
      const c = L.circle([t.lat, t.lon], { radius: km*1000, fillOpacity: 0.05, weight: 1 });
      c.addTo(map); coverageLayers.push(c);
    }
  });
}
function setUserMarker(){
  if (!map || !userLoc) return;
  try { if (userDot) map.removeLayer(userDot); } catch {}
  // eslint-disable-next-line no-undef
  userDot = L.circleMarker([userLoc.lat, userLoc.lon], { radius: 6 }).addTo(map).bindPopup('Tu ubicación');
}
function renderMapMarkers() {
  if (!map) return;
  markers.forEach(m => { try{ map.removeLayer(m); }catch{} }); markers = [];
  tiendas.forEach(t=>{
    if (t.lat==null || t.lon==null) return;
    // eslint-disable-next-line no-undef
    const m = L.marker([t.lat, t.lon]).addTo(map).bindPopup(`<b>${t.nombre}</b><br>${t.direccion||''}`);
    m.on('click', ()=> pickTienda(t.id));
    markers.push(m);
  });
  const pts = tiendas.filter(t=>t.lat!=null && t.lon!=null).map(t=>[t.lat, t.lon]);
  if (userLoc) pts.push([userLoc.lat, userLoc.lon]);
  if (pts.length) {
    try {
      // eslint-disable-next-line no-undef
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds, { padding:[30,30] });
    } catch {}
  }
}

function initCompactMap(){
  if (mapCompact) return;
  // eslint-disable-next-line no-undef
  mapCompact = L.map('map-compact', { zoomControl:true, worldCopyJump:false, maxBoundsViscosity:0.8 })
    .setView([MAP_UI.defaultCenter.lat, MAP_UI.defaultCenter.lon], MAP_UI.defaultCenter.zoom);
  // eslint-disable-next-line no-undef
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'&copy; OpenStreetMap', minZoom: MAP_UI.minZoom, maxZoom: MAP_UI.maxZoom
  }).addTo(mapCompact);
}
function clearCompactCoverage(){
  if (!mapCompact) return;
  coverageLayersCompact.forEach(l=>{ try{ mapCompact.removeLayer(l); }catch{} });
  coverageLayersCompact = [];
}
function renderCompactMarkers(){
  if (!mapCompact) return;
  markersCompact.forEach(m=>{ try{ mapCompact.removeLayer(m); }catch{} });
  markersCompact = [];
  tiendas.forEach(t=>{
    if (t.lat==null || t.lon==null) return;
    // eslint-disable-next-line no-undef
    const m = L.marker([t.lat, t.lon]).addTo(mapCompact).bindPopup(`<b>${t.nombre || 'Tienda'}</b><br>${t.direccion || ''}`);
    m.on('click', ()=> pickTienda(t.id));
    markersCompact.push(m);
  });
  clearCompactCoverage();
  tiendas.forEach(t=>{
    const km = Number(t.coberturaKm) || RADIO_MAX_KM;
    if (t.lat!=null && t.lon!=null && km>0){
      // eslint-disable-next-line no-undef
      const c = L.circle([t.lat, t.lon], { radius: km*1000, fillOpacity: 0.05, weight: 1 });
      c.addTo(mapCompact); coverageLayersCompact.push(c);
    }
  });
  if (userLoc){
    try { if (userDotCompact) mapCompact.removeLayer(userDotCompact); } catch {}
    // eslint-disable-next-line no-undef
    userDotCompact = L.circleMarker([userLoc.lat, userLoc.lon], { radius: 6 }).addTo(mapCompact).bindPopup('Tu ubicación');
  }
}
function fitCompactToTiendas(){
  if (!mapCompact) return;
  const pts = tiendas.filter(t=> t.lat!=null && t.lon!=null).map(t=> [t.lat, t.lon]);
  if (userLoc) pts.push([userLoc.lat, userLoc.lon]);
  if (pts.length){
    try{
      // eslint-disable-next-line no-undef
      const b = L.latLngBounds(pts);
      mapCompact.fitBounds(b, { padding:[30,30], maxZoom: MAP_UI.minZoom + 2 });
    }catch{}
  } else {
    mapCompact.setView([MAP_UI.defaultCenter.lat, MAP_UI.defaultCenter.lon], MAP_UI.defaultCenter.zoom);
  }
}

/* ============================================================
   Vista Mapa/Lista
============================================================ */
function setView(mode){
  if (!mapSection) return;
  const isMap = mode === 'map';
  mapSection.style.display = isMap ? 'block' : 'none';
  viewMapBtn?.classList.toggle('active', isMap);
  viewListBtn?.classList.toggle('active', !isMap);
  try { map?.invalidateSize?.(); } catch {}
}

/* ============================================================
   Delegación de clics en el GRID de tiendas
============================================================ */
function attachStoreGridHandlers(){
  const grid = document.getElementById('tiendas-grid');
  if (!grid) return;
  if (grid._hasClickDelegation && grid._clickFn) {
    grid.removeEventListener('click', grid._clickFn);
  }
  const handler = (e)=>{
    const btn = e.target.closest('.btn-ver-tienda');
    if (btn && grid.contains(btn)) {
      e.stopPropagation();
      const id = btn.getAttribute('data-id') || btn.dataset.id;
      if (id) pickTienda(id);
      return;
    }
    const card = e.target.closest('.store-card');
    if (card && grid.contains(card)) {
      if (e.target.closest('button, a, select, input, label')) return;
      const id = card.getAttribute('data-id');
      if (id) pickTienda(id);
    }
  };
  grid.addEventListener('click', handler);
  grid._hasClickDelegation = true;
  grid._clickFn = handler;
}

/* ============================================================
   Selección de Tienda
============================================================ */
function pickTienda(id){
  const t = tiendas.find(x=>x.id===id);
  tiendaSel = t || null;
  const sel = document.getElementById('selector-tienda');
  sel && (sel.value = id || '');

  showPerfilTienda(tiendaSel);
    // 🔥 CARGAR INMEDIATAMENTE EL PERFIL REAL DE LA TIENDA
  if (typeof window.cargarPerfilTienda === 'function' && id) {
    window.cargarPerfilTienda(id);
  }

  const chips = document.getElementById('tiendas-chips');
  chips?.querySelectorAll('.tienda-chip').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-id')===id);
  });
  const grid = document.getElementById('tiendas-grid');
  grid?.querySelectorAll('.card.tienda, .tienda-card').forEach(card=>{
    card.classList.toggle('selected', card.getAttribute('data-id')===id);
  });

  pickerSec && (pickerSec.style.display = 'none');
  showProdsSkeleton(8);

  listenProductosByTienda(id);
  setQS('tienda', id || '');

  cartSection && (cartSection.style.display = id ? 'block' : 'none');

  contProductos?.scrollIntoView({ behavior:'smooth', block:'start' });

  // ============================================================
// 💜 BOTÓN CHAT DE LA TIENDA
// ============================================================
// Segunda opción cuando el cliente no encuentra un producto.
// NO crea otro sistema de chat.
// Lleva al flujo existente de pedidos.
// ============================================================

const chatBtn = document.getElementById('perfil-chat');

if (chatBtn) {

  const newBtn = chatBtn.cloneNode(true);

  chatBtn.parentNode.replaceChild(newBtn, chatBtn);

  newBtn.addEventListener('click', async () => {

    const user = auth.currentUser;

    // --------------------------------------------------------
    // 🔐 VERIFICAR SESIÓN
    // --------------------------------------------------------

    if (!user) {
      alert('Inicia sesión para solicitar un pedido.');
      return;
    }

    // --------------------------------------------------------
    // 🏪 VERIFICAR TIENDA
    // --------------------------------------------------------

    if (!tiendaSel?.id) {
      alert('No se pudo identificar la tienda.');
      return;
    }

    try {

      console.log(
        '💜 Botón chat de tienda:',
      );

      // ------------------------------------------------------
      // 📦 IR A MIS PEDIDOS
      // ------------------------------------------------------
      // El flujo continuará desde el sistema existente
      // de pedidos/seguimiento.
      // ------------------------------------------------------

      window.location.href =
        `./pedidos.html?tienda=${encodeURIComponent(tiendaSel.id)}&origen=chat`;

    } catch (error) {

      console.error(
        '❌ Error iniciando solicitud desde chat:',
        error
      );

      alert(
        'No se pudo iniciar la solicitud. Inténtalo nuevamente.'
      );
    }

  });

}
  const mapBtn = document.getElementById('perfil-ver-mapa');
  if (mapBtn) {
    const newMap = mapBtn.cloneNode(true);
    mapBtn.parentNode.replaceChild(newMap, mapBtn);
    newMap.addEventListener('click', ()=>{
      if (tiendaSel && Number.isFinite(tiendaSel.lat) && Number.isFinite(tiendaSel.lon)) {
        window.open(`https://www.google.com/maps?q=${tiendaSel.lat},${tiendaSel.lon}`, '_blank', 'noopener');
      } else { alert('Esta tienda aún no tiene ubicación registrada.'); }
    });
  }

  try {
    localStorage.setItem('store_profile_view', JSON.stringify({
      uid: t?.id || '', nombre: t?.nombre || '',
      imgUrl: t?.logoUrl || t?.imgUrl || '', direccion: t?.direccion || '', horario: t?.horario || '',
      lat: t?.lat ?? null, lon: t?.lon ?? null, _distKm: distancias[t?.id] ?? null
    }));
    localStorage.setItem('selected_store_uid', id || '');
  } catch {}

  window.dispatchEvent(new CustomEvent('tienda:cambiada', {
    detail: { uid: t?.id || '', _distKm: distancias[t?.id] ?? null }
  }));

  scheduleCartSync();

  updateChangeStoreUI();
}

/* ============================================================
   Carrito -> Firestore sync
============================================================ */
function getCart(){ return Array.isArray(CART) ? [...CART] : []; }
function setCart(arr){ CART = Array.isArray(arr) ? arr : []; saveCart(); renderCartList(); scheduleCartSync(); }
let _syncTimer = null;
function getCartDocRef(){
  const user = auth.currentUser;
  if (!user || !tiendaSel?.id) return null;
  return doc(db, 'tiendas', tiendaSel.id, 'carritos', user.uid);
}
async function syncCartToFirestore(){
  const ref = getCartDocRef();
  const user = auth.currentUser;
  if (!ref || !user) return;
  const raw = getCart();
  const subtotal = raw.reduce((s,x)=> s + ((Number(x.unitPrice||x.price||0)) * (Number(x.qty||x.cantidad||1))), 0);
  const payload = {
    tiendaId: tiendaSel?.id || null,
    tiendaNombre: tiendaSel?.nombre || '',
    clienteId: user.uid,
    clienteEmail: user.email || '',
    updatedAt: serverTimestamp(),
    estado: 'armando',
    subtotal: Number(subtotal.toFixed(2)),
    items: raw.map(x => ({
      productoId: x.id,
      nombre: x.nombre || x.title || 'Producto',
      imagen: x.imagen || x.img || '',
      unit: x.unit || x.unidadBase || 'unidad',
      unitLabel: x.unitLabel || 'und.',
      unitPrice: Number(x.unitPrice||x.price||0),
      qty: Number(x.qty||x.cantidad||1)
    }))
  };
  try{ await setDoc(ref, payload, { merge:true }); }catch(e){ console.warn('[cart sync]', e); }
}
function scheduleCartSync(){ if (!auth.currentUser || !tiendaSel?.id) return; clearTimeout(_syncTimer); _syncTimer = setTimeout(syncCartToFirestore, 400); }
function logTiendaEvent(type, extra={}){
  const user = auth.currentUser;
  if (!user || !tiendaSel?.id) return;
  const ev = { type, clienteId: user.uid, clienteEmail: user.email || '', tiendaId: tiendaSel.id, at: serverTimestamp(), ...extra };
  addDoc(collection(db, 'tiendas', tiendaSel.id, 'eventos'), ev).catch(()=>{});
}

function addToCart(productId){
  const p = cacheProductos.find(x=>x.id===productId);
  if (!p) return;

  // 🔥 DIAGNÓSTICO: Ver qué campos tiene el producto
  console.log('🔍 addToCart - Producto completo:', p);
  console.log('🔍 addToCart - p.nombre:', p.nombre);
  console.log('🔍 addToCart - p.nombreBase:', p.nombreBase);
  console.log('🔍 addToCart - p.titulo:', p.titulo);

  const card = contProductos.querySelector(`.producto-card[data-pid="${productId}"]`);
  const sel = card?.querySelector('.unidad-selector');
  const qtyEl = card?.querySelector(`#q-${productId}`);
  const unidadElegida = sel ? sel.value : normalizeUnit(p.unidadBase||'unidad');
  const base = normalizeUnit(p.unidadBase||'unidad');
  const unitPrice = convertUnitPrice(Number(p.precio)||0, base, unidadElegida);
  const qty = Math.max(parseFloat(qtyEl?.step||'1')||1, parseFloat(qtyEl?.value||'1')||1);
  const key = `${productId}__${unidadElegida}`;
  const c   = getCart();
  const i   = c.findIndex(x => x.key === key);

  const img = resolveImgUrl(p, 300, 300);

  // 🔥 NOMBRE CON FALLBACK MEJORADO
  const nombreProducto = p.nombre || p.nombreBase || p.titulo || 'Producto';

  if (i >= 0) {
    c[i].qty = Number((Number(c[i].qty) || 0) + qty);
  } else {
    c.push({
      key,
      id: p.id,
      nombre: nombreProducto,   // ✅ Usa el fallback
      imagen: img,
      unit: unidadElegida,
      unitLabel: UNIT_LABEL[unidadElegida],
      unitPrice: Number(unitPrice) || 0,
      qty
    });
  }

  setCart(c);
  logTiendaEvent('carrito_actualizado', { productoId: p.id, nombre: nombreProducto });
  const badge = document.createElement('div'); badge.className = 'added-to-cart'; badge.textContent = '✓'; card.appendChild(badge); setTimeout(()=> badge.remove(), 900);
}

function removeFromCartKey(key){ const c = getCart().filter(x=> x.key !== key); setCart(c); }

function renderCart(){
  const ul = document.getElementById('carrito');
  const count = document.getElementById('cart-count');
  const subtotalEl = document.getElementById('cart-subtotal');
  const totalEl = document.getElementById('cart-total');
  const preview = document.getElementById('cart-preview');
  const badge = document.getElementById('contador-carrito');
  const fabCount = document.getElementById('fab-count');
  const raw = getCart();

  if (ul) {
    ul.innerHTML = raw.map(it=>`
      <li class="carrito-item">
        <div class="carrito-item-info">
          <img src="${it.imagen || 'https://placehold.co/40x40'}" class="carrito-item-img" alt="">
          <div class="carrito-item-detalles">
            <div class="carrito-item-nombre">${it.nombre}</div>
            <div class="carrito-item-info-detalle">
              ${Number(it.qty)} × ${UNIT_LABEL[it.unit] || it.unit}
              · ${money(it.unitPrice)} / ${UNIT_LABEL[it.unit] || it.unit}
            </div>
          </div>
        </div>
        <div class="carrito-item-precio">${money((it.unitPrice||0) * (Number(it.qty)||1))}</div>
        <button class="carrito-item-eliminar" data-rm="${it.key}" title="Quitar">✕</button>
      </li>
    `).join('');
    ul.querySelectorAll('[data-rm]').forEach(b=> b.addEventListener('click', ()=> removeFromCartKey(b.dataset.rm)));
  }
  const items = raw.reduce((s,x)=>s+(Number(x.qty)||0),0);
  const subtotal = raw.reduce((s,x)=>s+((Number(x.unitPrice)||0)*(Number(x.qty)||1)),0);
  if (count) count.textContent = String(items);
  if (subtotalEl) subtotalEl.textContent = money(subtotal);
  if (totalEl) totalEl.textContent = money(subtotal);
  if (badge) badge.textContent = `(${items})`;
  if (fabCount) fabCount.textContent = String(items);
  if (preview) {
    preview.innerHTML = raw.slice(0,4).map(it=>`
      <div style="display:flex;gap:8px;align-items:center;">
        <img src="${it.imagen||'https://placehold.co/38x38'}" style="width:38px;height:38px;border-radius:8px;object-fit:cover;">
        <div style="font-size:.92rem;">${it.nombre}<br><span style="color:#64748b;">x${Number(it.qty)}</span></div>
        <div style="margin-left:auto;font-weight:700;">${money((Number(it.unitPrice)||0)* (Number(it.qty)||1))}</div>
      </div>
    `).join('');
  }
}
// ============================================================
// 🚚 CONFIGURACIÓN DE DOMICILIO DE LA TIENDA
// Lee la configuración real desde:
// tiendas/{tiendaId}.domicilio
// ============================================================

async function getDomicilioConfig(tiendaId) {

  if (!tiendaId) {
    console.warn('⚠️ No se recibió tiendaId para domicilio');

    return {
      activo: false,
      costo: 0,
      coberturaKm: 2
    };
  }

  try {

    const tiendaRef = doc(
      db,
      'tiendas',
      tiendaId
    );

    const snap = await getDoc(tiendaRef);

    if (!snap.exists()) {

      console.warn(
        '⚠️ No existe la tienda:',
        tiendaId
      );

      return {
        activo: false,
        costo: 0,
        coberturaKm: 2
      };
    }

    const data = snap.data();

    // 🔥 LA CONFIGURACIÓN REAL ESTÁ DENTRO DE "domicilio"
    const domicilio = data.domicilio || {};

    const config = {
      activo: domicilio.activo === true,
      costo: Number(domicilio.costo) || 0,
      coberturaKm: Number(domicilio.coberturaKm) || 2
    };

    console.log(
      '🚚 CONFIGURACIÓN DOMICILIO:',
      {
        tiendaId,
        config
      }
    );

    return config;

  } catch (error) {

    console.error(
      '❌ Error obteniendo configuración de domicilio:',
      error
    );

    // 🔒 Fallback seguro
    return {
      activo: false,
      costo: 0,
      coberturaKm: 2
    };
  }
}



//* ==== Crear pedido desde carrito CON SERVICIO Y DOMICILIO ==== */
async function crearPedidoDesdeCarrito() {
  console.log("🔥🔥🔥 ENTRÓ A crearPedidoDesdeCarrito");
  if (!tiendaSel?.id) return alert('Primero selecciona una tienda.');
  const user = auth.currentUser;
  if (!user) return alert('Inicia sesión para completar la compra.');
  const cart = getCart();
  if (!cart.length) return alert('Tu carrito está vacío.');

  // 🔥 OBTENER CONFIGURACIÓN DE DOMICILIO
  const domicilioConfig = await getDomicilioConfig(tiendaSel.id);
  
  // Calcular subtotal
  const subtotal = cart.reduce((s, x) => s + ((Number(x.unitPrice)||0) * (Number(x.qty)||1)), 0);
  
  // 🔥 SERVICIO FIJO
  const SERVICIO_FIJO = 800;
  
  // 🔥 CALCULAR ENVÍO SEGÚN CONFIGURACIÓN
  let costoEnvio = 0;
  let textoEnvio = 'No disponible';
  
  if (domicilioConfig.activo) {
    costoEnvio = domicilioConfig.costo || 0;
    textoEnvio = costoEnvio === 0 ? 'GRATIS' : `$${costoEnvio.toLocaleString('es-CO')}`;
  } else {
    textoEnvio = 'No ofrece domicilio';
  }
  
  // 🔥 TOTAL = SUBTOTAL + SERVICIO + ENVÍO
  const total = subtotal + SERVICIO_FIJO + costoEnvio;

  // ✅ El resumen ya no usa la ventana nativa de confirmación.
// El flujo continúa directamente hacia el checkout existente.

  
  const data = {
    tiendaId: tiendaSel.id,
    tiendaNombre: tiendaSel.nombre || '',
    uid: user.uid,
    clienteId: user.uid,
    clienteEmail: user.email || '',
    estado: 'pendiente',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    subtotal: Number(subtotal.toFixed(2)),
    envio: costoEnvio,
    servicio: SERVICIO_FIJO,
    total: Number(total.toFixed(2)),
    breakdown: {
      subtotal: Number(subtotal.toFixed(2)),
      envio: costoEnvio,
      servicio: SERVICIO_FIJO,
      total: Number(total.toFixed(2))
    },
        items: cart.map(x => ({
      productoId: x.id,
      nombre: x.nombre,
      imagen: x.imagen || '',
      qty: Number(x.qty) || 1,
      unit: x.unit || 'unidad',
      unitLabel: x.unitLabel || 'und.',
      unitPrice: Number(x.unitPrice)||0
    }))
  };
  
  try {
    console.log("🚀 Guardando pedido con domicilio y servicio...");
    const pedidoRef = await addDoc(collection(db, 'pedidos'), data);
    console.log("✅ Pedido guardado:", pedidoRef.id);

    const verificacion = await getDoc(pedidoRef);
    console.log("📄 ¿Existe el documento?", verificacion.exists());
    if (verificacion.exists()) {
      console.log("📦 Datos guardados:", verificacion.data());
    } else {
      console.error("❌ Firestore dice que el documento NO existe");
    }

    if (typeof window.iniciarSeguimientoPedido === 'function') {
      window.iniciarSeguimientoPedido(pedidoRef.id);
    }
    
    localStorage.setItem('pedido_activo_id', pedidoRef.id);
    localStorage.setItem('last_pedido_id', pedidoRef.id);
    
    window.dispatchEvent(new CustomEvent('pedido:creado', {
      detail: { pedidoId: pedidoRef.id, tiendaId: data.tiendaId, total: data.total }
    }));
    
    try {
      const cref = getCartDocRef();
      if (cref) await setDoc(cref, { estado: 'cerrado', closedAt: serverTimestamp() }, { merge: true });
    } catch {}
    
    logTiendaEvent('pedido_creado', { pedidoId: pedidoRef.id, total: data.total });
    setCart([]);
    
    alert(`✅ ¡Pedido creado!\n\n💰 Total: $${total.toLocaleString('es-CO')}\n🚚 Envío: ${textoEnvio}\n\nEl comerciante fue notificado. Recibirás una notificación cuando sea aceptado.`);
    
  } catch (e) {
    console.error('Error creando pedido:', e);
    alert('No se pudo crear el pedido. Intenta nuevamente.');
  }
}

/* ============================================================
   Eventos UI
============================================================ */
const buscarProductos = debounce(()=> { page=1; applyFiltersAndRender(); }, 300);
window.buscarProductos = buscarProductos;
inputSearch?.addEventListener('input', buscarProductos);
filtroCat?.addEventListener('change', ()=>{ page=1; applyFiltersAndRender(); });
if (filtroPrecio){
  if (precioMax) precioMax.textContent = money(Number(filtroPrecio.value||0));
  filtroPrecio.addEventListener('input', ()=>{ if (precioMax) precioMax.textContent = money(Number(filtroPrecio.value||0)); });
  filtroPrecio.addEventListener('change', ()=>{ page=1; applyFiltersAndRender(); });
}
filtroOrden?.addEventListener('change', ()=>{ page=1; applyFiltersAndRender(); });

viewMapBtn?.addEventListener('click', ()=> setView('map'));
viewListBtn?.addEventListener('click', ()=> setView('list'));

console.log('✅ INICIO DIRECTO');

/* ============================================================
   Inicio seguro
============================================================ */

async function initProductosPage(){

  console.log('✅ INIT EJECUTADO');
  console.log('🚀 DOM listo');

  await new Promise(r => setTimeout(r, 300));

  if (prodsFilterBar) {
    prodsFilterBar.style.display = 'none';
  }

  if (bienvenidaEl) {
    bienvenidaEl.textContent = '';
  }

  initMap();
  renderCart();

  console.log('🚀 INICIANDO CARGA TIENDAS');

  document
    .getElementById('perfil-cambiar-tienda')
    ?.addEventListener('click', goBackToStorePicker);

  if (cartSection) {
    cartSection.style.display = 'none';
  }

  showTiendasSkeleton(8);
  paintFromCache();

  let loaded = [];

  try {
    loaded = await fetchStoresWithFallback();
    console.log('🟢 STORES CARGADAS:', loaded);
    console.log('🟢 TOTAL:', loaded?.length);
  } catch(err){
    console.error('❌ ERROR FETCH STORES:', err);
    loaded = [];
  }

  tiendas = Array.isArray(loaded) ? [...loaded] : [];
  allTiendas = [...tiendas];

  console.log('🟢 tiendas global:', tiendas);
  console.log('🟢 allTiendas global:', allTiendas);

  const grid = document.getElementById('tiendas-grid');
  console.log('🔥 GRID:', grid);

  hideTiendasSkeleton();

  if (!grid) {
    console.error('❌ NO EXISTE #tiendas-grid');
    return;
  }

  grid.innerHTML = '';

  if (!Array.isArray(tiendas) || !tiendas.length) {
    console.warn('⚠️ tiendas VACÍAS');
    grid.innerHTML = `
      <div class="empty">
        No hay tiendas disponibles por ahora.
      </div>
    `;
    return;
  }

  console.log('🟡 RENDERIZANDO TIENDAS');

  renderTiendasGrid(
    grid,
    tiendas,
    (id)=> {
      console.log('🛒 click tienda', id);
      pickTienda(id);
    },
    {}
  );

  attachStoreGridHandlers();

  console.log('🔥 despues render innerHTML:', grid.innerHTML);

    // 🔥 FIX: NUNCA abrir tienda automáticamente al entrar.
  // El cliente SIEMPRE debe elegir la tienda manualmente.
  // Solo respetamos ?tienda=UID en la URL (recarga dentro de una tienda).
  const preUid = parseQS('tienda');

  const validPre =
    preUid &&
    tiendas.some(t => t.id === preUid)
      ? preUid
      : '';

  if (validPre) {
    // Recarga con ?tienda=UID → mantener la tienda abierta
    pickTienda(validPre);
  } else {
    // Caso normal: SIEMPRE mostrar el selector de tiendas
    if (pickerSec) {
      pickerSec.style.display = 'block';
    }

    if (prodsFilterBar) {
      prodsFilterBar.style.display = 'none';
    }
  }

  const runGeo = ()=> usarUbicacionGPS();

  btnUbicar?.addEventListener('click', runGeo);
  chipsGeoBtn?.addEventListener('click', runGeo);
  pickerGeo?.addEventListener('click', runGeo);

  chipsAllBtn?.addEventListener('click', ()=>{
    tiendas = [...allTiendas];
    updateGlobals();

    renderChips(
      document.getElementById('tiendas-chips'),
      tiendas,
      (id)=> pickTienda(id)
    );

    renderTiendasGrid(
      document.getElementById('tiendas-grid'),
      tiendas,
      (id)=> pickTienda(id),
      distancias || {}
    );

    attachStoreGridHandlers();
    renderMapMarkers();
    drawCoverage();

    if (mapCompact) {
      try {
        mapCompact.invalidateSize();
      } catch {}
      renderCompactMarkers();
      fitCompactToTiendas();
    }

    document
      .getElementById('tiendas-grid')
      ?.scrollIntoView({
        behavior:'smooth'
      });

    const ms = document.getElementById('market-select');
    if (ms) {
      ms.value = 'todos';
      setQS('mercado','');
    }
  });

  pickerSkip?.addEventListener('click', ()=>{
    if (pickerSec) {
      pickerSec.style.display='none';
    }
  });

  const pagarBtn = document.getElementById('pagar');
  if (pagarBtn) {
    pagarBtn.setAttribute('data-action', 'pagar');
  }

  setView('map');
  updateChangeStoreUI();

  // 🔽 NUEVO: Inicializar menú desplegable del usuario
  setupUserDropdown();

  console.log('✅ INIT COMPLETO');
}

// 🔽 NUEVO: MENÚ DESPLEGABLE DEL USUARIO (VERSIÓN CORREGIDA)
function setupUserDropdown() {
  console.log('🍔 Configurando menú desplegable del usuario...');

  // Buscar el contenedor del usuario
  const userContainer = document.querySelector('.user-info');
  if (!userContainer) {
    console.warn('⚠️ No se encontró .user-info para el menú desplegable');
    return;
  }

  // Evitar duplicados
  if (userContainer.querySelector('.user-dropdown-menu')) {
    console.log('ℹ️ Menú ya existe, omitiendo creación');
    return;
  }

  // Crear el menú
  const dropdownMenu = document.createElement('div');
  dropdownMenu.className = 'user-dropdown-menu';
  dropdownMenu.innerHTML = `
    <a href="./perfil.html" class="dropdown-item">
      <i class="fas fa-user"></i> Mi perfil
    </a>
    <a href="./perfil.html" class="dropdown-item">
      <i class="fas fa-cog"></i> Configuración
    </a>
    <div class="dropdown-divider"></div>
    <button class="dropdown-item logout-btn" id="dropdown-logout">
      <i class="fas fa-sign-out-alt"></i> Cerrar sesión
    </button>
  `;

  // Insertar el menú dentro del contenedor (absoluto respecto a él)
  userContainer.style.position = 'relative';
  userContainer.style.cursor = 'pointer';
  userContainer.appendChild(dropdownMenu);

  // Toggle al hacer clic en el contenedor
  userContainer.addEventListener('click', function(e) {
    e.stopPropagation();
    dropdownMenu.classList.toggle('show');
  });

  // Cerrar menú al hacer clic fuera
  document.addEventListener('click', function() {
    dropdownMenu.classList.remove('show');
  });

  // Manejar cierre de sesión
  const logoutBtn = document.getElementById('dropdown-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      try {
        // 🔥 CORRECCIÓN 1: Cerrar la sesión real de Firebase PRIMERO
        await signOut(auth);
        
        // Limpiar almacenamiento local
        localStorage.removeItem('perfilUsuario');
        localStorage.removeItem('selected_store_uid');
        sessionStorage.removeItem('currentUser');
        
        // Redirigir al login
        window.location.href = 'index.html';
      } catch (error) {
        console.error('Error al cerrar sesión:', error);
        alert('❌ Error al cerrar sesión. Intenta de nuevo.');
      }
    });
  }

  // 🔥 CORRECCIÓN 2: Escuchar cambios de usuario en Firebase
  // Esto actualiza el nombre y avatar automáticamente si cambia el usuario (ej: de Jaime a Camilo)
  onAuthStateChanged(auth, async (user) => {
    const badge = document.getElementById('nombre-usuario');
    const avatar = document.querySelector('.user-avatar');

    if (user) {
      try {
        
        // Obtener el perfil REAL desde Firestore
        const perfilRef = doc(db, 'perfiles', user.uid);
        const snap = await getDoc(perfilRef);
        
        let nombre = '';
        if (snap.exists()) {
          const data = snap.data();
          nombre = data.nombres || data.nombre || user.email?.split('@')[0] || 'Usuario';
        } else {
          // Fallback si no tiene documento en 'perfiles'
          nombre = user.email?.split('@')[0] || 'Usuario';
        }

        // Actualizar el DOM
        if (badge) badge.textContent = nombre;
        if (avatar) avatar.textContent = (nombre[0] || 'U').toUpperCase();
        
      } catch (error) {
        console.warn('Error obteniendo perfil del usuario:', error);
        // Fallback simple
        const nombre = user.email?.split('@')[0] || 'Usuario';
        if (badge) badge.textContent = nombre;
        if (avatar) avatar.textContent = (nombre[0] || 'U').toUpperCase();
      }

// ============================================================
  // 📍 PREGUNTAR AUTOMÁTICAMENTE POR LA UBICACIÓN
  // ============================================================
  setTimeout(() => {
    mostrarModalUbicacion();
  }, 700);

    } else {
      // Si no hay usuario autenticado, limpiar la UI
      if (badge) badge.textContent = '';
      if (avatar) avatar.textContent = '';
    }
  });

  console.log('✅ Menú desplegable configurado correctamente');
}

/* ============================================================
   EJECUCIÓN SEGURA
============================================================ */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProductosPage);
} else {
  initProductosPage();
}

// 🔥 CARRITO EN TIEMPO REAL
function listenCartChanges() {
  if (_cartUnsubscribe) {
    _cartUnsubscribe();
    _cartUnsubscribe = null;
  }
  const ref = getCartDocRef();
  if (!ref) return;
  _cartUnsubscribe = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const items = data.items || [];
      if (JSON.stringify(items) !== JSON.stringify(CART)) {
        CART = items;
        renderCartList();
        renderCartTotals();
        updateFab();
        console.log('🔄 Carrito sincronizado desde Firestore');
      }
    }
  }, (error) => {
    console.warn('[cart] Error escuchando cambios:', error);
  });
}

/* ============================================================
   LIMPIAR LISTENERS
============================================================ */

window.addEventListener('beforeunload', ()=>{
  clearUnsubs();
});

// ============================================================
// 🔥 INTEGRACIÓN CON EL SISTEMA DE HISTORIAL
// ============================================================

// ✅ SOLUCIÓN: Getter para que siempre devuelva el array actual de productos
Object.defineProperty(window, 'cacheProductos', {
  get: function() { return cacheProductos; },
  configurable: true
});

window.addToCart = addToCart;

window.addEventListener('pedido:creado', (event) => {
    console.log('🔄 productos.js: Pedido creado, actualizando historial...', event.detail);
});

console.log('✅ productos.js: Integración con historial completada');
console.log('📦 Funciones expuestas: cacheProductos, addToCart');
console.log('📡 Escuchando eventos: pedido:creado');


// ============================================================
// 🎯 CONEXIÓN DEFINITIVA DEL BOTÓN SEGUIMIENTO
// ============================================================

window.abrirTrackerPedidos = function() {
    console.log('📦 Abriendo centro de seguimiento de pedidos...');
    
    if (window.pedidoTracker) {
        if (typeof window.pedidoTracker.showTracker === 'function') {
            window.pedidoTracker.showTracker();
        }
        if (typeof window.pedidoTracker.refreshPedidos === 'function') {
            window.pedidoTracker.refreshPedidos();
        }
        if (window.actualizarBadgeTracker) {
            window.actualizarBadgeTracker();
        }
    } else {
        console.warn('⚠️ PedidoTracker no inicializado');
        if (typeof initPedidoTracker === 'function') {
            initPedidoTracker();
            setTimeout(() => {
                if (window.pedidoTracker) {
                    window.pedidoTracker.showTracker();
                }
            }, 500);
        }
    }
};

(function conectarBoton() {
    console.log('🔍 Conectando botón de seguimiento...');
    
    let btn = document.getElementById('btn-tracker');
    
    if (!btn) {
        btn = document.querySelector('.btn-tracker');
    }
    
    if (btn) {
        const nuevoBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(nuevoBtn, btn);
        
        nuevoBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Botón Seguimiento clickeado');
            window.abrirTrackerPedidos();
        });
        
        console.log('✅ Botón Seguimiento conectado correctamente');
    } else {
        console.warn('⚠️ No se encontró el botón #btn-tracker');
    }
})();

setTimeout(() => {
    if (window.actualizarBadgeTracker) {
        window.actualizarBadgeTracker();
    }
}, 1500);

console.log('✅ Sistema de seguimiento completamente listo');




// ============================================================

const RADIO_DESCUBRIMIENTO_KM = 1.7; // 📍 Radio máximo de cercanía
let ubicacionPreguntada = false;

async function obtenerUbicacionDesdePerfil(uid) {
  try {
    if (!uid) return null;

    console.log('📍 Buscando ubicación del cliente con uid:', uid);

    // =========================================================
    // 🔥 1) PRIMERO: buscar en usuarios/{uid}
    // Aquí es donde Cloud Functions guarda lat/lng/ubicacion
    // =========================================================

    const usuarioRef = doc(db, 'usuarios', uid);
    const usuarioSnap = await getDoc(usuarioRef);

    if (usuarioSnap.exists()) {
      const data = usuarioSnap.data();
      const ubicacion = data.ubicacion || {};

      console.log('🔍 Datos de usuarios/' + uid + ':', {
        campos: Object.keys(data),
        lat: data.lat,
        lng: data.lng,
        longitud: data.longitud,
        longitude: data.longitude,
        ubicacion
      });

      const lat =
        data.lat ??
        data.latitud ??
        data.latitude ??
        ubicacion.lat ??
        ubicacion.latitud ??
        ubicacion.latitude ??
        null;

      const lng =
        data.lng ??
        data.lon ??
        data.longitud ??
        data.longitude ??
        ubicacion.lng ??
        ubicacion.lon ??
        ubicacion.longitud ??
        ubicacion.longitude ??
        null;

      if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
        console.log('✅ Ubicación obtenida de usuarios/' + uid + ':', { lat, lng });
        return { lat: Number(lat), lon: Number(lng) };
      }
    }

    // =========================================================
    // 🔥 2) FALLBACK: buscar en perfiles/{uid}
    // =========================================================

    console.log('⚠️ No se encontró en usuarios/' + uid + '. Probando perfiles/' + uid + '...');

    const perfilRef = doc(db, 'perfiles', uid);
    const perfilSnap = await getDoc(perfilRef);

    if (!perfilSnap.exists()) {
      console.warn('⚠️ No existe perfil ni usuario para uid:', uid);
      return null;
    }

    const data = perfilSnap.data();
    const ubicacion = data.ubicacion || {};

    console.log('🔍 Datos de perfiles/' + uid + ':', {
      campos: Object.keys(data),
      lat: data.lat,
      lng: data.lng,
      ubicacion
    });

    const lat =
      data.lat ??
      data.latitud ??
      data.latitude ??
      ubicacion.lat ??
      ubicacion.latitud ??
      null;

    const lng =
      data.lng ??
      data.lon ??
      data.longitud ??
      data.longitude ??
      ubicacion.lng ??
      ubicacion.lon ??
      ubicacion.longitud ??
      null;

    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
      console.log('✅ Ubicación obtenida de perfiles/' + uid + ':', { lat, lng });
      return { lat: Number(lat), lon: Number(lng) };
    }

    console.warn('⚠️ El perfil existe pero no tiene coordenadas válidas');
    return null;

  } catch (error) {
    console.warn('⚠️ Error obteniendo ubicación del perfil:', error);
    return null;
  }
}
/* ============================================================
   📍 FUNCIÓN: Obtener dirección desde el perfil (para mostrar)
============================================================ */
async function obtenerDireccionDesdePerfil(uid) {
  try {
    const perfilRef = doc(db, 'perfiles', uid);
    const snap = await getDoc(perfilRef);
    if (snap.exists()) {
      const data = snap.data();
      return data.direccion || data.address || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/* ============================================================
   🎯 MODAL DE PREGUNTA DE UBICACIÓN
============================================================ */
function mostrarModalUbicacion() {
  if (document.getElementById('modal-ubicacion-overlay')) return;
  if (ubicacionPreguntada) return;
  
  console.log('📍 Mostrando modal de pregunta de ubicación');
  
  const overlay = document.createElement('div');
  overlay.id = 'modal-ubicacion-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    animation: fadeInModal 0.4s ease;
  `;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    border-radius: 24px;
    padding: 32px 28px;
    max-width: 440px;
    width: 92%;
    box-shadow: 0 24px 60px rgba(0,0,0,0.3);
    animation: slideUpModal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    text-align: center;
  `;
  
  modal.innerHTML = `
    <div style="font-size: 3.2rem; margin-bottom: 12px;">📍</div>
    <h2 style="font-size: 1.3rem; font-weight: 700; color: #0F172A; margin: 0 0 6px 0;">
      Buscar comercios cerca de ti
    </h2>
    <p style="font-size: 0.95rem; color: #64748B; margin: 0 0 8px 0; line-height: 1.5;">
      Para mostrarte los comercios en un radio de ${RADIO_DESCUBRIMIENTO_KM} km, necesitamos saber tu ubicación.
    </p>
    <p style="font-size: 0.8rem; color: #94A3B8; margin: 0 0 20px 0;">
      <i class="fas fa-info-circle"></i> Si no usas GPS, buscaremos desde tu dirección guardada en el perfil
    </p>
    
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <button id="modal-ubicacion-si" style="
        padding: 14px 24px;
        border: none;
        border-radius: 14px;
        background: linear-gradient(135deg, #10B981, #0EA5E9);
        color: white;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 4px 16px rgba(16,185,129,0.3);
      ">
        <i class="fas fa-location-dot"></i> Sí, usar mi ubicación actual
      </button>
      
      <button id="modal-ubicacion-no" style="
        padding: 12px 24px;
        border: none;
        border-radius: 14px;
        background: #F1F5F9;
        color: #475569;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      ">
        <i class="fas fa-map-pin"></i> Usar mi dirección guardada
      </button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Evento: Usar GPS
  document.getElementById('modal-ubicacion-si').addEventListener('click', async () => {
    cerrarModalUbicacion();
    ubicacionPreguntada = true;
    console.log('📍 Usuario aceptó usar GPS');
    await usarUbicacionGPS();
  });
  
    // Evento: Usar dirección guardada del perfil
  document.getElementById('modal-ubicacion-no')?.addEventListener('click', async () => {
    cerrarModalUbicacion();
    ubicacionPreguntada = true;
    console.log('📍 Usuario eligió usar su dirección guardada');
    await usarUbicacionPerfil();
  });



  // Cerrar al hacer clic fuera
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) {
    cerrarModalUbicacion();

    // El usuario decidió cerrar la pregunta.
    // NO buscamos ubicación y NO eliminamos las tiendas.
    ubicacionPreguntada = true;

    tiendas = [...allTiendas];
    updateGlobals();

    const grid = document.getElementById('tiendas-grid');

    if (grid) {
      renderTiendasGrid(
        grid,
        tiendas,
        (id) => pickTienda(id),
        distancias || {}
      );
    }

    const chips = document.getElementById('tiendas-chips');

    if (chips) {
      renderChips(
        chips,
        tiendas,
        (id) => pickTienda(id)
      );
    }

    attachStoreGridHandlers();
  }
});
  
  
  // Agregar estilos de animación
  if (!document.getElementById('modal-ubicacion-styles')) {
    const style = document.createElement('style');
    style.id = 'modal-ubicacion-styles';
    style.textContent = `
      @keyframes fadeInModal {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUpModal {
        from { opacity: 0; transform: translateY(30px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    document.head.appendChild(style);
  }
}

function cerrarModalUbicacion() {
  const overlay = document.getElementById('modal-ubicacion-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => overlay.remove(), 300);
  }
}

/* ============================================================
   📍 USAR UBICACIÓN GPS (SIEMPRE 5 KM)
============================================================ */
async function usarUbicacionGPS() {
  try {
    console.log('📍 Solicitando GPS...');
    const ubicacion = await pedirUbicacion();
    userLoc = ubicacion;
    updateGlobals();
    console.log('📍 GPS obtenido:', userLoc);
    await buscarComerciosCerca(userLoc, 'GPS');
  } catch (error) {
    console.warn('⚠️ Error obteniendo GPS:', error);
    mostrarNotificacion('⚠️ No pudimos obtener tu GPS. Usando dirección del perfil.');
    await usarUbicacionPerfil();
  }
}

/* ============================================================
   📍 USAR UBICACIÓN DEL PERFIL (SIEMPRE 5 KM)
============================================================ */
async function usarUbicacionPerfil() {
  const user = auth.currentUser;
  if (!user) {
    mostrarNotificacion('⚠️ Inicia sesión para buscar comercios cerca de ti');
    mostrarTodasLasTiendasConAdvertencia();
    return;
  }
  
  try {
    console.log('📍 Buscando ubicación en el perfil...');
    const ubicacion = await obtenerUbicacionDesdePerfil(user.uid);
    if (ubicacion) {
      userLoc = ubicacion;
      updateGlobals();
      console.log('📍 Ubicación del perfil:', userLoc);
      await buscarComerciosCerca(userLoc, 'Perfil');
    } else {
      console.warn('⚠️ No hay ubicación guardada en el perfil');
      mostrarNotificacion('⚠️ No tienes dirección guardada. Ve a tu perfil y agrega una dirección.');
      mostrarTodasLasTiendasConAdvertencia();
    }
  } catch (error) {
    console.error('❌ Error obteniendo ubicación del perfil:', error);
    mostrarNotificacion('⚠️ Error al obtener tu dirección. Por favor, actualiza tu perfil.');
    mostrarTodasLasTiendasConAdvertencia();
  }
}

/* ============================================================
   🔥 BUSCAR COMERCIOS CERCA (SIEMPRE 5 KM)
============================================================ */
async function buscarComerciosCerca(ubicacion, fuente) {
  const base = allTiendas?.length ? allTiendas : tiendas;
  if (!base.length) {
    mostrarNotificacion('⚠️ No hay tiendas disponibles');
    return;
  }
  
  // Calcular distancias
  const dmap = {};
  base.forEach(t => {
    if (t?.lat != null && t?.lon != null) {
      const d = haversineKm(ubicacion, { lat: t.lat, lon: t.lon });
      if (d != null) dmap[t.id] = d;
    }
  });
  
  distancias = dmap;
  
    // 🔥 FILTRAR POR RADIO DE 1.7 KM
let cercanas = base.filter(t => {
  const d = dmap[t.id];

  // Una tienda sin coordenadas válidas no puede considerarse cercana.
  if (d == null) return false;

  // Solo mostrar comercios dentro del radio permitido (1.7 km).
  return d <= RADIO_DESCUBRIMIENTO_KM;
});
  
  // Ordenar por distancia
  cercanas.sort((a, b) => (dmap[a.id] || 1e9) - (dmap[b.id] || 1e9));
  
  console.log(`📍 Encontradas ${cercanas.length} tiendas dentro de ${RADIO_DESCUBRIMIENTO_KM} km (fuente: ${fuente})`);
  
  tiendas = cercanas;
  updateGlobals();
  
  // Renderizar
  const grid = document.getElementById('tiendas-grid');
  if (grid) {
    renderTiendasGrid(grid, tiendas, (id) => pickTienda(id), dmap);
  }
  
  const chips = document.getElementById('tiendas-chips');
  if (chips) {
    renderChips(chips, tiendas, (id) => pickTienda(id));
  }
  
  attachStoreGridHandlers();
  renderMapMarkers();
  drawCoverage();
  setUserMarker();
  
  if (tiendaSel && badgeDist) {
    badgeDist.textContent = fmtKm(dmap[tiendaSel.id]);
  }
  
    // ============================================================
  // 🎯 SEÑALAR LA TIENDA MÁS CERCANA (SIN SELECCIONARLA)
  // ============================================================
  // El sistema NO abre ninguna tienda automáticamente.
  // Solo muestra un aviso indicando cuál es la más cercana
  // y deja que el cliente decida cuál prefiere abrir.

  if (!parseQS('tienda') && cercanas.length) {

    const masCercana = cercanas[0];
    const distanciaMasCercana = dmap[masCercana.id];

    // Resaltar visualmente la tienda más cercana en el grid
    setTimeout(() => {
      const grid = document.getElementById('tiendas-grid');
      if (grid) {
        grid.querySelectorAll('.store-card, .card.tienda, .tienda-card')
          .forEach(card => card.classList.remove('tienda-mas-cercana'));

        const cardCercana = grid.querySelector(
          `[data-id="${masCercana.id}"]`
        );

        if (cardCercana) {
          cardCercana.classList.add('tienda-mas-cercana');
          cardCercana.style.position = 'relative';

          // Añadir etiqueta "Más cercana"
          if (!cardCercana.querySelector('.badge-mas-cercana')) {
            const badge = document.createElement('span');
            badge.className = 'badge-mas-cercana';
            badge.textContent = '⭐ Más cercana';
            badge.style.cssText = `
              position: absolute;
              top: 8px;
              left: 8px;
              background: linear-gradient(135deg, #F59E0B, #EF4444);
              color: #fff;
              font-size: 0.7rem;
              font-weight: 700;
              padding: 4px 10px;
              border-radius: 999px;
              box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
              z-index: 10;
              pointer-events: none;
            `;
            cardCercana.appendChild(badge);
          }
        }
      }
    }, 100);

    // Notificación al cliente
    if (typeof mostrarNotificacion === 'function') {
      mostrarNotificacion(
        `⭐ La tienda más cercana es "${masCercana.nombre}" a ${fmtKm(distanciaMasCercana)}. Tú eliges cuál abrir.`
      );
    }

    // Log en consola para diagnóstico
    console.log(
      `⭐ TIENDA MÁS CERCANA: ${masCercana.nombre} (${fmtKm(distanciaMasCercana)})`
    );
    console.log(
      `📍 ${cercanas.length} tiendas disponibles en 1.7 km. El cliente decide.`
    );
  }
  
  // Mostrar mensaje según resultado
  if (cercanas.length === 0) {
    if (grid) {
      grid.innerHTML = `
        <div class="empty" style="padding:40px;text-align:center;color:#64748B;">
          <div style="font-size:3rem;margin-bottom:12px;">🔍</div>
          <h3 style="font-weight:600;color:#0F172A;">No hay comercios cerca</h3>
          <p style="font-size:0.95rem;">No encontramos comercios en un radio de ${RADIO_DESCUBRIMIENTO_KM} km</p>
          <p style="font-size:0.8rem;color:#94A3B8;margin-top:4px;">
            <i class="fas fa-info-circle"></i> 
            ${fuente === 'GPS' ? 'Usando tu ubicación actual' : 'Usando tu dirección guardada'}
          </p>
          <button onclick="window.recargarBusqueda()" style="
            margin-top:16px;
            padding:10px 24px;
            border:none;
            border-radius:12px;
            background:#10B981;
            color:white;
            font-weight:600;
            cursor:pointer;
          ">
            <i class="fas fa-redo"></i> Intentar de nuevo
          </button>
        </div>
      `;
    }
    mostrarNotificacion(`🔍 No hay comercios en ${RADIO_DESCUBRIMIENTO_KM} km`);
  } else {
    mostrarNotificacion(`📍 ${cercanas.length} comercios encontrados en ${RADIO_DESCUBRIMIENTO_KM} km`);
  }
  
  if (mapCompact) {
    try { mapCompact.invalidateSize(); } catch {}
    renderCompactMarkers();
    fitCompactToTiendas();
  }
}

/* ============================================================
   ⚠️ FALLBACK: Mostrar mensaje de que no hay ubicación
============================================================ */
function mostrarTodasLasTiendasConAdvertencia() {
  const grid = document.getElementById('tiendas-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty" style="padding:40px;text-align:center;color:#64748B;">
        <div style="font-size:3rem;margin-bottom:12px;">⚠️</div>
        <h3 style="font-weight:600;color:#0F172A;">No tenemos tu ubicación</h3>
        <p style="font-size:0.95rem;">Ve a tu perfil y guarda una dirección para encontrar comercios cerca de ti.</p>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap;">
          <a href="./perfil.html" style="
            padding:10px 24px;
            border:none;
            border-radius:12px;
            background:#10B981;
            color:white;
            font-weight:600;
            text-decoration:none;
          ">
            <i class="fas fa-user-edit"></i> Ir a mi perfil
          </a>
          <button onclick="window.usarUbicacionGPS()" style="
            padding:10px 24px;
            border:2px solid #10B981;
            border-radius:12px;
            background:white;
            color:#10B981;
            font-weight:600;
            cursor:pointer;
          ">
            <i class="fas fa-location-dot"></i> Usar GPS
          </button>
        </div>
      </div>
    `;
  }
  mostrarNotificacion('⚠️ Agrega una dirección en tu perfil para encontrar comercios cercanos');
}

/* ============================================================
   🔔 NOTIFICACIÓN (Toast)
============================================================ */
function mostrarNotificacion(mensaje) {
  const existing = document.getElementById('toast-notificacion');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.id = 'toast-notificacion';
  toast.style.cssText = `
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: #0F172A;
    color: white;
    padding: 12px 24px;
    border-radius: 14px;
    font-size: 0.9rem;
    font-weight: 500;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    z-index: 99999;
    animation: toastSlideUp 0.5s ease;
    max-width: 90%;
    text-align: center;
  `;
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
  
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      @keyframes toastSlideUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
}

/* ============================================================
   🔄 RECARGAR BÚSQUEDA
============================================================ */
window.recargarBusqueda = function() {
  ubicacionPreguntada = false;
  mostrarModalUbicacion();
};

/* ============================================================
   📍 EXPONER FUNCIONES AL WINDOW
============================================================ */
window.usarUbicacionGPS = usarUbicacionGPS;
window.usarUbicacionPerfil = usarUbicacionPerfil;
window.mostrarTodasLasTiendasConAdvertencia = mostrarTodasLasTiendasConAdvertencia;
window.mostrarNotificacion = mostrarNotificacion;
window.mostrarModalUbicacion = mostrarModalUbicacion;

console.log('✅ Sistema de ubicación 5 km agregado correctamente');
console.log('📍 Funciones disponibles: usarUbicacionGPS(), usarUbicacionPerfil(), recargarBusqueda()');



// ============================================================
// 🆕 FUNCIONES PARA EL PANEL DE FILTROS PREMIUM
// ============================================================

/**
 * Actualiza el contador de productos visibles
 * Busca todos los productos y cuenta los que NO están ocultos
 */
function actualizarContadorProductos() {
    const productosContainer = document.getElementById('productos');
    const numeroElement = document.getElementById('numeroProductos');
    
    if (!productosContainer || !numeroElement) {
        console.log('⚠️ Contenedor o elemento de contador no encontrado');
        return;
    }
    
    // Busca TODOS los productos dentro del contenedor
    const todosLosProductos = productosContainer.querySelectorAll('.producto-card');
    
    if (todosLosProductos.length === 0) {
        numeroElement.textContent = '0';
        return;
    }
    
    // Filtra los que NO están ocultos
    let visibles = 0;
    todosLosProductos.forEach(card => {
        // Verifica si el elemento está visible
        const style = window.getComputedStyle(card);
        const isHidden = card.classList.contains('hidden') || 
                         style.display === 'none' || 
                         style.visibility === 'hidden' ||
                         card.style.display === 'none';
        
        if (!isHidden) {
            visibles++;
        }
    });
    
    numeroElement.textContent = visibles;
    console.log(`📊 Contador actualizado: ${visibles} productos visibles de ${todosLosProductos.length}`);
}

/**
 * Inicializa los chips de filtros adicionales
 */
function initChipsPremium() {
    const chips = document.querySelectorAll('.chip-filtro[data-filtro]');
    const limpiarBtn = document.getElementById('limpiar-filtros');
    
    console.log(`🔘 Inicializando ${chips.length} chips de filtro`);
    
    // Eventos para cada chip
    chips.forEach(chip => {
        chip.addEventListener('click', function() {
            this.classList.toggle('chip-activo');
            console.log(`🔄 Chip ${this.dataset.filtro}: ${this.classList.contains('chip-activo') ? 'activado' : 'desactivado'}`);
            
            // Disparar actualización de productos
            if (typeof window.applyFiltersAndRender === 'function') {
                window.applyFiltersAndRender();
            } else if (typeof window.filtrarProductos === 'function') {
                window.filtrarProductos();
            } else {
                console.warn('⚠️ No se encontró función de filtrado');
            }
            
            // Actualizar contador después de un momento
            setTimeout(actualizarContadorProductos, 200);
        });
    });
    
    // Botón limpiar filtros
    if (limpiarBtn) {
        limpiarBtn.addEventListener('click', function() {
            console.log('🧹 Limpiando todos los filtros');
            
            // Resetear selects
            const catSelect = document.getElementById('filtro-categoria');
            const orderSelect = document.getElementById('filtro-orden');
            const searchInput = document.getElementById('search-input');
            const priceSlider = document.getElementById('filtro-precio');
            const priceDisplay = document.getElementById('precio-maximo');
            
            if (catSelect) catSelect.value = 'todas';
            if (orderSelect) orderSelect.value = 'defecto';
            if (searchInput) searchInput.value = '';
            if (priceSlider) {
                priceSlider.value = '100000';
                if (priceDisplay) priceDisplay.textContent = '$100.000';
            }
            
            // Resetear chips (mantener "Disponibles" activo)
            document.querySelectorAll('.chip-filtro[data-filtro]').forEach(chip => {
                chip.classList.remove('chip-activo');
            });
            const disponiblesChip = document.querySelector('.chip-filtro[data-filtro="disponibles"]');
            if (disponiblesChip) disponiblesChip.classList.add('chip-activo');
            
            // Disparar eventos para actualizar
            if (catSelect) catSelect.dispatchEvent(new Event('change'));
            if (orderSelect) orderSelect.dispatchEvent(new Event('change'));
            if (priceSlider) priceSlider.dispatchEvent(new Event('input'));
            if (searchInput) searchInput.dispatchEvent(new Event('input'));
            
            // Actualizar contador
            setTimeout(actualizarContadorProductos, 300);
        });
    }
}

/**
 * Extiende la función de renderizado para actualizar el contador automáticamente
 */
function extenderRenderizadoConContador() {
    // Lista de posibles funciones de renderizado
    const funciones = ['applyFiltersAndRender', 'filtrarProductos', 'renderizarProductos', 'renderProductos'];
    
    funciones.forEach(nombre => {
        if (typeof window[nombre] === 'function') {
            const original = window[nombre];
            window[nombre] = function() {
                const result = original.apply(this, arguments);
                setTimeout(actualizarContadorProductos, 150);
                return result;
            };
            console.log(`✅ Función "${nombre}" extendida con contador`);
        }
    });
    
    // También observar cambios en el contenedor de productos
    const container = document.getElementById('productos');
    if (container) {
        // Crear un MutationObserver para detectar cambios en el DOM
        const observer = new MutationObserver(() => {
            actualizarContadorProductos();
        });
        
        observer.observe(container, { 
            childList: true, 
            subtree: true, 
            attributes: true,
            attributeFilter: ['class', 'style']
        });
        
        console.log('👀 Observer de productos activado');
    }
}

// ============================================================
// 🚀 INICIALIZACIÓN DE FILTROS PREMIUM
// ============================================================

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎯 Inicializando filtros premium...');
    
    // Inicializar chips
    initChipsPremium();
    
    // Extender renderizado
    extenderRenderizadoConContador();
    
    // Actualizar contador inicial
    setTimeout(actualizarContadorProductos, 800);
    
    console.log('✅ Filtros premium inicializados correctamente');
});

// También ejecutar cuando los productos ya estén cargados (por si el DOM ya está listo)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(actualizarContadorProductos, 500);
}