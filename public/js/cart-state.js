// /public/js/cart-state.js
// Estado único del carrito (persistente + eventos en tiempo real)

const KEY = 'cart_v2';

const EMPTY = {
  storeUid: null,
  storeName: '',
  items: [],              // [{id, title, price, qty, img}]
  count: 0,
  total: 0,
  updatedAt: 0,
};

const clampQty = (n) => Math.max(0, Math.min(9999, Number(n) || 0));

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const s = JSON.parse(raw);
    return recalc(s);
  } catch {
    return { ...EMPTY };
  }
}

function recalc(s) {
  s.items = Array.isArray(s.items) ? s.items : [];
  s.count = s.items.reduce((a, b) => a + clampQty(b.qty), 0);
  s.total = s.items.reduce((a, b) => a + clampQty(b.qty) * Number(b.price || 0), 0);
  s.updatedAt = Date.now();
  return s;
}

function save(s, emit = true) {
  const state = recalc({ ...s });
  localStorage.setItem(KEY, JSON.stringify(state));
  if (emit) {
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: state }));
  }
  return state;
}

export function get() { return load(); }

export function setStore(uid, name = '') {
  const s = load();
  s.storeUid = uid || null;
  if (name) s.storeName = name;
  return save(s);
}

export function ensureStore(uid, name = '') {
  const s = load();
  if (s.count > 0 && s.storeUid && uid && s.storeUid !== uid) {
    // Cambiar de tienda con carrito con items: vaciamos por seguridad
    // (Si prefieres: muestra confirm() y, si cancela, retorna false)
    Object.assign(s, { ...EMPTY, storeUid: uid, storeName: name || '' });
    return save(s);
  }
  return setStore(uid, name);
}

export function clearAll() {
  return save({ ...EMPTY });
}

export function addItem({ id, title, price, qty = 1, img = '' }) {
  if (!id) return get();
  const s = load();
  const i = s.items.findIndex(x => x.id === id);
  if (i >= 0) {
    s.items[i].qty = clampQty(s.items[i].qty + qty);
  } else {
    s.items.push({ id, title: title || 'Producto', price: Number(price || 0), qty: clampQty(qty), img });
  }
  return save(s);
}

export function removeItem(id) {
  const s = load();
  s.items = s.items.filter(x => x.id !== id);
  return save(s);
}

export function setQty(id, qty) {
  const s = load();
  const i = s.items.findIndex(x => x.id === id);
  if (i >= 0) {
    s.items[i].qty = clampQty(qty);
    if (s.items[i].qty === 0) s.items.splice(i, 1);
  }
  return save(s);
}

export function onChange(fn) {
  const handler = (e) => fn(e.detail || load());
  window.addEventListener('cart:updated', handler);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) handler({ detail: load() });
  });
  // pinta estado actual al suscribirse
  fn(load());
  return () => window.removeEventListener('cart:updated', handler);
}
