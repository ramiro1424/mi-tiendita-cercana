// public/js/img-resolver.js
import { storage } from './firebase-config.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

const MEMO = new Map();
export const imgPlaceholder = (name='Producto', w=300, h=300) =>
  `https://placehold.co/${w}x${h}?text=${encodeURIComponent(name)}`;

function fixPlaceholder(url) {
  if (!url) return url;
  return String(url).replace('placeholder.co/', 'placehold.co/').trim();
}

/** Devuelve la mejor URL para la imagen del producto: http(s) → Storage → placeholder */
export async function resolveImgSrc(p, w=300, h=300) {
  const id = p?.id || p?.__docId;
  if (id && MEMO.has(id)) return MEMO.get(id);

  const name = p?.nombre || p?.nombreBase || 'Producto';
  const http = p?.imagen || p?.imageUrl || p?.imagenUrl || p?.fotoUrl || p?.foto;

  // 1) URL http(s)
  if (http && /^https?:\/\//i.test(http)) {
    const u = fixPlaceholder(http);
    if (id) MEMO.set(id, u);
    return u;
  }

  // 2) Ruta en Storage
  const path = p?.imagenPath || p?.imagePath || p?.imagenStorage || p?.pathImagen || p?.imagenRuta;
  if (path) {
    try {
      const u = await getDownloadURL(ref(storage, path));
      if (id) MEMO.set(id, u);
      return u;
    } catch (e) {
      console.warn('[img] getDownloadURL falló:', path, e);
    }
  }

  // 3) Fallback
  const ph = imgPlaceholder(name, w, h);
  if (id) MEMO.set(id, ph);
  return ph;
}

/** Rellena <img> y background de las tarjetas ya pintadas */
export async function applyResolvedImages(container, products, w=300, h=300) {
  if (!container || !Array.isArray(products)) return;
  await Promise.allSettled(products.map(async (p) => {
    const card  = container.querySelector(`.producto-card[data-pid="${p.id}"]`);
    if (!card) return;
    const img   = card.querySelector('img.producto-img');
    const media = card.querySelector('.producto-media');

    const src = await resolveImgSrc(p, w, h);
    p.__img = src; // guarda la URL final para carrito/pedidos

    if (img)   img.src = src;
    if (media) media.style.backgroundImage = `url("${src}")`;
  }));
}
