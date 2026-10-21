// ./js/tiendas-public.js
// v20.1 — CON DOMICILIO: Tipos: Licorerías, Tiendas, Verdurerías, Farmacias, Carnicerías

import { db } from './firebase-config.js';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const PLACEHOLDER_IMG = '';
const R_MAX_KM_DEFAULT = 20;

/* =========================================================
   🎨 TIPOS DE COMERCIANTE (DEFINITIVOS)
   ========================================================= */

export const TIPOS_COMERCIANTE = {
  licoreria: {
    id: 'licoreria',
    label: 'Licorería',
    emoji: '🍾',
    color: '#7C3AED',
    colorLight: '#EDE9FE',
    colorDark: '#5B21B6',
    glowColor: 'rgba(124, 58, 237, 0.3)',
    badgeBg: 'rgba(124, 58, 237, 0.12)',
    keywords: ['licorería', 'licoreria', 'licor', 'vino', 'cerveza', 'whisky', 'ron', 'aguardiente', 'bar', 'kiosko', 'kiosco', 'bebidas alcoholicas']
  },
  tienda: {
    id: 'tienda',
    label: 'Tienda',
    emoji: '🏪',
    color: '#2563EB',
    colorLight: '#DBEAFE',
    colorDark: '#1E40AF',
    glowColor: 'rgba(37, 99, 235, 0.3)',
    badgeBg: 'rgba(37, 99, 235, 0.12)',
    keywords: ['tienda', 'abarrotes', 'supermercado', 'almacen', 'bodega', 'mini mercado', 'minimercado', 'despensa', 'general']
  },
  verdureria: {
    id: 'verdureria',
    label: 'Verdurería',
    emoji: '🥬',
    color: '#059669',
    colorLight: '#D1FAE5',
    colorDark: '#065F46',
    glowColor: 'rgba(5, 150, 105, 0.3)',
    badgeBg: 'rgba(5, 150, 105, 0.12)',
    keywords: ['verdulería', 'verdureria', 'verduras', 'frutas', 'hortalizas', 'fruteria', 'frutas y verduras', 'agricola']
  },
  farmacia: {
    id: 'farmacia',
    label: 'Farmacia',
    emoji: '💊',
    color: '#EF4444',
    colorLight: '#FEE2E2',
    colorDark: '#991B1B',
    glowColor: 'rgba(239, 68, 68, 0.3)',
    badgeBg: 'rgba(239, 68, 68, 0.12)',
    keywords: ['farmacia', 'droguería', 'drogueria', 'medicina', 'salud', 'farmaceutica', 'botica']
  },
  carniceria: {
    id: 'carniceria',
    label: 'Carnicería',
    emoji: '🥩',
    color: '#DC2626',
    colorLight: '#FEF2F2',
    colorDark: '#7F1D1D',
    glowColor: 'rgba(220, 38, 38, 0.3)',
    badgeBg: 'rgba(220, 38, 38, 0.12)',
    keywords: ['carnicería', 'carniceria', 'carnes', 'carnico', 'cortes', 'embutidos', 'carnicero']
  },
  default: {
    id: 'default',
    label: 'Comercio',
    emoji: '🏪',
    color: '#6B7280',
    colorLight: '#F3F4F6',
    colorDark: '#4B5563',
    glowColor: 'rgba(107, 114, 128, 0.2)',
    badgeBg: 'rgba(107, 114, 128, 0.10)',
    keywords: []
  }
};

/* =========================================================
   🎨 DETECTAR TIPO DE COMERCIO
   ========================================================= */

export function detectarTipoComercio(tienda) {
  // 🔥 PRIMERO: Detectar por nombre (más confiable que Firestore)
  const nombre = String(tienda.nombre || tienda.name || '').toLowerCase().trim();
  
  // 🔥 DETECCIÓN POR NOMBRE (IGNORA lo que diga Firestore)
  if (nombre.includes('licor') || nombre.includes('vino') || nombre.includes('cerveza') || 
      nombre.includes('whisky') || nombre.includes('ron') || nombre.includes('aguardiente') || 
      nombre.includes('licorer') || nombre.includes('bar') || nombre.includes('copas') ||
      nombre.includes('whiskey') || nombre.includes('tequila') || nombre.includes('brandy')) {
    return 'licoreria';
  } else if (nombre.includes('farmacia') || nombre.includes('droguería') || nombre.includes('drogueria') || 
             nombre.includes('medicina') || nombre.includes('salud') || nombre.includes('botica')) {
    return 'farmacia';
  } else if (nombre.includes('carnicería') || nombre.includes('carniceria') || nombre.includes('carnes') || 
             nombre.includes('cortes') || nombre.includes('embutidos')) {
    return 'carniceria';
  } else if (nombre.includes('verdura') || nombre.includes('fruta') || nombre.includes('hortaliza') || 
             nombre.includes('verdulería') || nombre.includes('verdureria') || nombre.includes('fruteria') ||
             nombre.includes('agricola')) {
    return 'verdureria';
  }
  
  // 🔥 Si no detecta por nombre, usar los campos de Firestore
  const texto = String(
    tienda.tipoComercio || 
    tienda.tipo || 
    tienda.categoria || 
    tienda.rubro || 
    tienda.giro || 
    tienda.tipoTienda ||
    tienda.tipo_negocio ||
    tienda.tipoComerciante ||
    ''
  ).toLowerCase().trim();

  if (!texto) return 'tienda';

  // Buscar en los tipos definidos
  for (const [tipoId, tipo] of Object.entries(TIPOS_COMERCIANTE)) {
    if (tipoId === 'default') continue;
    const keywords = tipo.keywords || [];
    for (const kw of keywords) {
      if (texto.includes(kw.toLowerCase())) {
        return tipoId;
      }
    }
  }

  return 'tienda';
}

export function getTheme(tienda) {
  const tipoId = detectarTipoComercio(tienda);
  const tipo = TIPOS_COMERCIANTE[tipoId] || TIPOS_COMERCIANTE.default;
  
  return {
    id: tipo.id,
    label: tipo.label,
    emoji: tipo.emoji,
    color: tipo.color,
    colorLight: tipo.colorLight,
    colorDark: tipo.colorDark,
    glowColor: tipo.glowColor,
    borderColor: `${tipo.color}33`,
    shadowColor: `${tipo.color}22`,
    badgeBg: tipo.badgeBg,
    bgGradient: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 40%, #a7f3d0 70%, #6ee7b7 100%)',
    textColor: '#065F46',
    subTextColor: '#374151',
    iconSize: '4.5rem'
  };
}

/* =========================================================
   UTILS DISTANCIA
   ========================================================= */

export function fmtKm(d) {
  if (d == null || Number.isNaN(d)) return '';
  const v = Number(d);
  return v < 1
    ? `${Math.round(v * 1000)} m`
    : `${v.toFixed(v < 10 ? 1 : 0)} km`;
}

export function haversineKm(a, b) {
  if (!a || !b) return null;
  const toRad = (x) => x * Math.PI / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δφ = toRad((b.lat ?? 0) - (a.lat ?? 0));
  const Δλ = toRad((b.lon ?? 0) - (a.lon ?? 0));
  const R = 6371;
  const s = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  return Math.round((2 * R * Math.asin(Math.min(1, Math.sqrt(s)))) * 10) / 10;
}

/* =========================================================
   🔥 OBTENER CONFIGURACIÓN DE DOMICILIO
   ========================================================= */

export async function getDomicilioConfig(tiendaId) {
  try {
    const docRef = doc(db, 'tiendas', tiendaId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { activo: false, costo: 0, coberturaKm: 2 };
    
    const data = snap.data();
    return data.domicilio || { activo: false, costo: 0, coberturaKm: 2 };
  } catch (error) {
    console.warn('Error obteniendo configuración de domicilio:', error);
    return { activo: false, costo: 0, coberturaKm: 2 };
  }
}

export function getDomicilioDisplay(domicilioConfig, distanciaKm) {
  if (!domicilioConfig || !domicilioConfig.activo) {
    return { text: '📍 Solo tienda física', emoji: '🏪', color: '#6b7280' };
  }
  
  // Si el cliente está fuera de cobertura
  if (distanciaKm !== undefined && distanciaKm > domicilioConfig.coberturaKm) {
    return { text: `🚫 Fuera de cobertura (${domicilioConfig.coberturaKm} km)`, emoji: '🚫', color: '#ef4444' };
  }
  
  // Si el costo es 0, es gratis
  if (domicilioConfig.costo === 0) {
    return { text: '🚚 Domicilio GRATIS', emoji: '🎉', color: '#10b981' };
  }
  
  return { 
    text: `🚚 Domicilio $${domicilioConfig.costo.toLocaleString('es-CO')}`, 
    emoji: '🚚', 
    color: '#f59e0b' 
  };
}

/* =========================================================
   CARGAR TIENDAS
   ========================================================= */

export async function cargarTiendas() {
  const out = [];
  try {
    let snap;
    try {
      const qTiendas = query(
        collection(db, 'tiendas'),
        where('activo', '==', true)
      );
      snap = await getDocs(qTiendas);
    } catch (errActivo) {
      console.warn('[tiendas] Query activo falló, usando fallback:', errActivo);
      snap = await getDocs(collection(db, 'tiendas'));
    }
    
    // Cargar configuraciones de domicilio en paralelo
    const tiendasPromises = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.activo === false) return;
      tiendasPromises.push(
        (async () => {
          const tienda = normalizeTienda({ id: d.id, ...data });
          // Cargar configuración de domicilio
          const domicilio = await getDomicilioConfig(d.id);
          tienda.domicilio = domicilio;
          return tienda;
        })()
      );
    });
    
    out.push(...await Promise.all(tiendasPromises));
    
  } catch (e) {
    console.warn('[tiendas] Error leyendo tiendas:', e);
  }
  
  const list = out;
  
  if (list.length === 0) {
    list.push({
      id: 'DEMO_STORE',
      nombre: 'Tienda Demo',
      direccion: 'Av. Siempre Viva 123',
      horario: 'L–S 8:00–18:00',
      lat: 4.65,
      lon: -74.1,
      coberturaKm: 20,
      imgUrl: '',
      activo: true,
      rating: 4.5,
      categoria: 'tienda',
      tipoComercio: 'tienda',
      tiempoEntrega: '15-25 min',
      domicilio: { activo: false, costo: 0, coberturaKm: 2 }
    });
  }
  
  list.sort((a, b) =>
    String(a.nombre || '').localeCompare(String(b.nombre || ''))
  );
  
  return list;
}

/* =========================================================
   NORMALIZAR TIENDA
   ========================================================= */

function normalizeTienda(t) {
  const lat = parseNum(t.lat ?? t.latitude);
  const lon = parseNum(t.lon ?? t.lng ?? t.longitude);
  const coberturaKm = parseNum(t.coberturaKm) || R_MAX_KM_DEFAULT;
  const ratingNum = Number.isFinite(Number(t.rating)) ? Number(t.rating) : 4.5;
  
  // 🔥 DETECTAR TIPO AUTOMÁTICAMENTE
  let tipoComercio = t.tipoComercio || t.tipo || t.categoria || '';
  const nombre = String(t.nombre || t.name || '').toLowerCase();
  
  // Si no tiene tipo, detectar por nombre
  if (!tipoComercio || tipoComercio === 'general') {
    if (nombre.includes('licor') || nombre.includes('vino') || nombre.includes('cerveza') || nombre.includes('whisky') || nombre.includes('ron') || nombre.includes('aguardiente')) {
      tipoComercio = 'licoreria';
    } else if (nombre.includes('farmacia') || nombre.includes('droguería') || nombre.includes('drogueria')) {
      tipoComercio = 'farmacia';
    } else if (nombre.includes('carnicería') || nombre.includes('carniceria') || nombre.includes('carnes') || nombre.includes('cortes')) {
      tipoComercio = 'carniceria';
    } else if (nombre.includes('verdura') || nombre.includes('fruta') || nombre.includes('hortaliza') || nombre.includes('verdulería') || nombre.includes('verdureria')) {
      tipoComercio = 'verdureria';
    } else {
      tipoComercio = 'tienda';
    }
  }
  
  return {
    id: String(t.id || t.uid || ''),
    nombre: t.nombre || t.name || 'Tienda',
    direccion: t.direccion || t.address || '',
    horario: t.horario || t.schedule || '',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    coberturaKm,
    logoUrl: t.logoUrl || t.logo || '',
    imgUrl: t.imgUrl || t.bannerUrl || t.foto || '',
    activo: t.activo !== false,
    categoria: t.categoria || 'general',
    tipoComercio: tipoComercio,
    rating: ratingNum,
    tiempoEntrega: t.tiempoEntrega || '15-25 min',
    updatedAt: t.updatedAt || t.actualizadoEn || t.createdAt || Date.now(),
    online: t.online === true,
    domicilio: t.domicilio || { activo: false, costo: 0, coberturaKm: 2 }
  };
}

const parseNum = (v) =>
  Number.isFinite(Number(v)) ? Number(v) : null;

/* =========================================================
   SELECT TIENDAS
   ========================================================= */

export function renderTiendasSelect(
  selectEl,
  tiendas,
  onPick,
  pre = null
) {
  if (!selectEl) return;
  selectEl.innerHTML = `
    <option value="">— Elige una tienda —</option>
  ` + tiendas.map(t => {
    const theme = getTheme(t);
    return `
      <option value="${t.id}" ${pre === t.id ? 'selected' : ''}>
        ${theme.emoji} ${escapeHtml(t.nombre)}
      </option>
    `;
  }).join('');
  selectEl.addEventListener('change', () => {
    onPick?.(selectEl.value || '');
  });
}

/* =========================================================
   CHIPS TIENDAS
   ========================================================= */

export function renderChips(container, tiendas, onPick) {
  if (!container) return;
  if (!tiendas?.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = tiendas.map(t => {
    const theme = getTheme(t);
    return `
      <button
        class="pill tienda-chip"
        type="button"
        data-id="${t.id}"
        title="${escapeHtml(t.nombre || 'Tienda')}"
      >
        <span class="chip-emoji">${theme.emoji}</span>
        ${escapeHtml(t.nombre || 'Tienda')}
      </button>
    `;
  }).join('');
  container.querySelectorAll('.tienda-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      container.querySelectorAll('.tienda-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick?.(id);
    });
  });
}

/* =========================================================
   🔥 OBTENER USUARIOS REALES DESDE FIRESTORE
   ========================================================= */

async function obtenerUsuariosReales() {
  try {
    // Intentar desde perfiles
    const perfilesSnap = await getDocs(collection(db, 'perfiles'));
    return perfilesSnap.size;
  } catch (error) {
    console.warn('[usuarios] Error desde perfiles:', error);
    try {
      // Fallback desde usuarios
      const usersSnap = await getDocs(collection(db, 'usuarios'));
      return usersSnap.size;
    } catch (e2) {
      console.warn('[usuarios] Error desde usuarios:', e2);
      return null;
    }
  }
}

/* =========================================================
   🎨 CREAR SECCIÓN PREMIUM
   ========================================================= */

async function createPremiumSection(tiendas) {
  const section = document.createElement('div');
  section.className = 'premium-footer-section';
  
  const totalTiendas = tiendas.length;
  
  // Contar categorías por tipo
  const tiposMap = new Map();
  tiendas.forEach(t => {
    const tipoId = detectarTipoComercio(t);
    const tipo = TIPOS_COMERCIANTE[tipoId] || TIPOS_COMERCIANTE.default;
    if (!tiposMap.has(tipoId)) {
      tiposMap.set(tipoId, {
        label: tipo.label,
        emoji: tipo.emoji,
        color: tipo.color,
        count: 0
      });
    }
    tiposMap.get(tipoId).count++;
  });
  
  const categoriasReales = Array.from(tiposMap.values());
  const totalCategorias = categoriasReales.length;
  const ratingPromedio = tiendas.reduce((sum, t) => sum + (t.rating || 0), 0) / totalTiendas || 0;
  const usuariosReales = await obtenerUsuariosReales();

  section.innerHTML = `
    <div class="premium-waves">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <path fill="#10B981" fill-opacity="0.08" d="M0,160L48,176C96,192,192,224,288,213.3C384,203,480,149,576,138.7C672,128,768,160,864,181.3C960,203,1056,213,1152,197.3C1248,181,1344,139,1392,117.3L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        <path fill="#10B981" fill-opacity="0.05" d="M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,218.7C672,235,768,245,864,234.7C960,224,1056,192,1152,176C1248,160,1344,160,1392,160L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        <path fill="#10B981" fill-opacity="0.03" d="M0,256L48,245.3C96,235,192,213,288,213.3C384,213,480,235,576,245.3C672,256,768,256,864,245.3C960,235,1056,213,1152,213.3C1248,213,1344,235,1392,245.3L1440,256L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
      </svg>
    </div>

    <div class="premium-footer-content">
      <div class="premium-stats">
        <div class="stat-item">
          <div class="stat-number" data-count="${totalTiendas}">0</div>
          <div class="stat-label">🏪 Tiendas disponibles</div>
        </div>
        <div class="stat-item">
          <div class="stat-number" data-count="${totalCategorias}">0</div>
          <div class="stat-label">📦 Categorías</div>
        </div>
        <div class="stat-item">
          <div class="stat-number" data-count="${Math.round(ratingPromedio * 10) / 10}">0</div>
          <div class="stat-label">⭐ Calificación promedio</div>
        </div>
        <div class="stat-item">
          <div class="stat-number" data-count="${usuariosReales !== null ? usuariosReales : 0}">${usuariosReales !== null ? '0' : '⏳'}</div>
          <div class="stat-label">👥 Usuarios registrados</div>
        </div>
      </div>

      <div class="premium-categories">
        ${categoriasReales.map(cat => `
          <span class="category-tag" style="--cat-color: ${cat.color};">
            ${cat.emoji} ${cat.label} (${cat.count})
          </span>
        `).join('')}
      </div>

      <div class="premium-footer-bottom">
        <div class="premium-brand">
          <span class="brand-icon">🏪</span>
          <span class="brand-name">Mi Tiendita Cercana</span>
          <span class="brand-slogan">🌟 Tu comercio local, al alcance de un clic</span>
        </div>
        <div class="premium-cta">
          <button class="premium-cta-btn" onclick="window.scrollTo({top: 0, behavior: 'smooth'})">
            <span>⬆</span> Volver arriba
          </button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    const counters = section.querySelectorAll('.stat-number');
    counters.forEach(counter => {
      const target = parseFloat(counter.getAttribute('data-count')) || 0;
      animateCounter(counter, target);
    });
  }, 300);
  
  return section;
}

/* =========================================================
   📊 ANIMAR CONTADOR
   ========================================================= */

function animateCounter(element, target) {
  const duration = 1500;
  const startTime = performance.now();
  const isFloat = target % 1 !== 0;
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = eased * target;
    
    element.textContent = isFloat ? current.toFixed(1) : Math.floor(current);
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = isFloat ? target.toFixed(1) : target;
    }
  }
  requestAnimationFrame(update);
}

/* =========================================================
   🎨 RENDER GRID ULTRA PREMIUM
   ========================================================= */

export function renderTiendasGrid(
  container,
  tiendas,
  onPick,
  distMap = {}
) {
  // 🔥 ELIMINAR SECCIONES PREMIUM DUPLICADAS
  const allSections = document.querySelectorAll('.premium-footer-section');
  allSections.forEach(el => el.remove());
  
  if (!container) return;
  injectPremiumStyles();

  if (!Array.isArray(tiendas) || tiendas.length === 0) {
    container.innerHTML = `
      <div class="empty-state premium-empty">
        <div class="empty-icon float-anim">🏪</div>
        <h3>No hay tiendas disponibles</h3>
        <p>Pronto tendremos más comercios cerca de ti</p>
      </div>
    `;
    return;
  }

  container.innerHTML = tiendas.map((t, index) => {
    const theme = getTheme(t);
    const dist = Number.isFinite(distMap[t.id]) ? fmtKm(distMap[t.id]) : '';
    const delay = (index % 6) * 0.08;
    
    // 🔥 OBTENER INFO DE DOMICILIO
    const domicilioConfig = t.domicilio || { activo: false, costo: 0, coberturaKm: 2 };
    const distanciaNum = Number.isFinite(distMap[t.id]) ? distMap[t.id] : undefined;
    const domicilioDisplay = getDomicilioDisplay(domicilioConfig, distanciaNum);
    
    return `
      <article 
        class="store-card premium-card"
        data-id="${t.id}"
        data-tipo="${t.tipoComercio || 'general'}"
        style="
          --theme-color: ${theme.color};
          --theme-glow: ${theme.glowColor};
          --theme-border: ${theme.borderColor};
          --theme-shadow: ${theme.shadowColor};
          --text-color: ${theme.textColor};
          --sub-text: ${theme.subTextColor};
          --card-delay: ${delay}s;
          animation-delay: ${delay}s;
        "
      >
        <div class="card-shimmer"></div>
        <div class="card-glass"></div>

        <div class="store-icon-container premium-icon-wrap" style="background: ${theme.bgGradient};">
          <div class="icon-3d-wrapper">
            <div class="store-icon-large premium-icon" style="color: ${theme.color};">
              ${theme.emoji}
            </div>
            <div class="icon-glow" style="background: ${theme.glowColor};"></div>
          </div>
          
          <div class="store-type-badge premium-badge" style="background: ${theme.color}; color: white;">
            <span class="badge-sparkle">✨</span>
            ${theme.label}
          </div>
          
          ${t.rating ? `
            <div class="store-rating-chip premium-rating" style="background: ${theme.color}; color: white;">
              <span class="rating-star">⭐</span> ${t.rating}
            </div>
          ` : ''}
          
          ${dist ? `
            <div class="store-dist-chip premium-dist" style="background: white; color: ${theme.color}; border: 2px solid ${theme.color};">
              <span class="dist-icon">📍</span> ${dist}
            </div>
          ` : ''}
        </div>

        <div class="store-content premium-content">
          <h3 class="store-name premium-name" style="color: ${theme.textColor};">
            ${escapeHtml(t.nombre)}
            <span class="name-underline" style="background: ${theme.color};"></span>
          </h3>

          ${t.direccion ? `
            <div class="store-info premium-info" style="color: ${theme.subTextColor};">
              <span class="info-icon">📍</span> ${escapeHtml(t.direccion)}
            </div>
          ` : ''}

          ${t.horario ? `
            <div class="store-info premium-info" style="color: ${theme.subTextColor};">
              <span class="info-icon">🕒</span> ${escapeHtml(t.horario)}
            </div>
          ` : ''}

          ${t.tiempoEntrega ? `
            <div class="store-info premium-delivery" style="color: ${theme.color}; background: ${theme.color}12; border: 1px solid ${theme.color}25;">
              <span class="delivery-icon">⏱️</span> ${escapeHtml(t.tiempoEntrega)}
            </div>
          ` : ''}

          <!-- 🔥 NUEVO: DOMICILIO BADGE -->
          <div class="store-info premium-domicilio" style="
            color: ${domicilioDisplay.color};
            background: ${domicilioDisplay.color}12;
            border: 1px solid ${domicilioDisplay.color}25;
            font-weight: 600;
            padding: 4px 14px;
            border-radius: 14px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 4px;
            font-size: 0.8rem;
          ">
            <span>${domicilioDisplay.emoji}</span>
            ${domicilioDisplay.text}
          </div>

          <button
            class="btn-ver-tienda premium-btn"
            data-id="${t.id}"
            type="button"
            style="--btn-color: ${theme.color};"
          >
            <span class="btn-text">Ver tienda</span>
            <span class="btn-arrow">→</span>
            <span class="btn-shine"></span>
          </button>
        </div>
      </article>
    `;
  }).join('');

  // Agregar sección premium debajo del grid
  const gridParent = container.parentElement;
  if (gridParent) {
    const existing = gridParent.querySelector('.premium-footer-section');
    if (existing) existing.remove();
    
    createPremiumSection(tiendas).then(section => {
      gridParent.appendChild(section);
    });
  }

  // Event listeners
  container.querySelectorAll('.btn-ver-tienda').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      onPick?.(id);
    });
  });

  container.querySelectorAll('.store-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      onPick?.(id);
    });
  });
}

/* =========================================================
   🎨 ESTILOS CSS
   ========================================================= */

let stylesInjected = false;

function injectPremiumStyles() {
  if (stylesInjected) return;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes floatIn {
      0% { opacity: 0; transform: translateY(30px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes shimmerSlide {
      0% { transform: translateX(-100%) rotate(25deg); }
      100% { transform: translateX(200%) rotate(25deg); }
    }
    @keyframes sparklePulse {
      0%, 100% { opacity: 0.4; transform: scale(0.8) rotate(0deg); }
      50% { opacity: 1; transform: scale(1.2) rotate(15deg); }
    }
    @keyframes floatIcon {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-6px) rotate(-3deg); }
    }
    @keyframes glowPulse {
      0%, 100% { opacity: 0.4; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.3); }
    }
    @keyframes waveFloat {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
    }

    #tiendas-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 28px;
      padding: 8px 8px 0 8px;
    }

    .premium-card {
      border-radius: 24px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 8px 32px rgba(16, 185, 129, 0.06);
      transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      border: 2px solid rgba(16, 185, 129, 0.08);
      cursor: pointer;
      position: relative;
      animation: floatIn 0.6s ease forwards;
      opacity: 0;
      transform-origin: center bottom;
    }
    .premium-card:hover {
      transform: translateY(-12px) scale(1.01);
      box-shadow: 0 20px 60px var(--theme-shadow, rgba(16, 185, 129, 0.15));
      border-color: var(--theme-color, #10B981);
    }

    .card-shimmer {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--theme-color, #10B981), transparent);
      opacity: 0;
      transition: opacity 0.4s ease;
      z-index: 2;
    }
    .premium-card:hover .card-shimmer {
      opacity: 1;
      animation: shimmerSlide 1.5s ease-in-out infinite;
    }

    .card-glass {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%);
      pointer-events: none;
      z-index: 0;
      opacity: 0;
      transition: opacity 0.5s ease;
    }
    .premium-card:hover .card-glass { opacity: 1; }

    .premium-icon-wrap {
      padding: 36px 20px 28px;
      text-align: center;
      position: relative;
      min-height: 160px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 40%, #a7f3d0 70%, #6ee7b7 100%);
      z-index: 1;
    }

    .icon-3d-wrapper { position: relative; display: inline-block; }
    .premium-icon {
      font-size: 4.8rem;
      line-height: 1;
      transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: block;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 8px 24px var(--theme-shadow, rgba(16, 185, 129, 0.15)));
    }
    .premium-card:hover .premium-icon {
      transform: scale(1.15) rotate(-5deg) translateY(-4px);
    }

    .icon-glow {
      position: absolute;
      top: 50%; left: 50%;
      width: 120%; height: 120%;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      filter: blur(30px);
      opacity: 0;
      transition: opacity 0.5s ease;
    }
    .premium-card:hover .icon-glow {
      opacity: 0.6;
      animation: glowPulse 2s ease-in-out infinite;
    }

    .premium-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 5px 18px;
      border-radius: 24px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      box-shadow: 0 4px 16px var(--theme-shadow, rgba(16, 185, 129, 0.15));
    }
    .badge-sparkle {
      display: inline-block;
      animation: sparklePulse 2s ease-in-out infinite;
    }

    .premium-rating {
      position: absolute;
      top: 14px; right: 14px;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 5px 14px;
      border-radius: 24px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
      display: flex;
      align-items: center;
      gap: 4px;
      transition: transform 0.3s ease;
    }
    .premium-card:hover .premium-rating { transform: scale(1.05); }
    .rating-star { animation: sparklePulse 2.5s ease-in-out infinite; }

    .premium-dist {
      position: absolute;
      bottom: 14px; right: 14px;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: 24px;
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      gap: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.04);
    }

    .premium-content {
      padding: 18px 22px 22px;
      background: white;
      position: relative;
      z-index: 1;
    }

    .premium-name {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0 0 10px 0;
      line-height: 1.3;
      position: relative;
      display: inline-block;
    }
    .name-underline {
      position: absolute;
      bottom: -3px; left: 0;
      width: 0;
      height: 2px;
      border-radius: 2px;
      transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .premium-card:hover .name-underline { width: 100%; }

    .premium-info {
      font-size: 0.85rem;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
      opacity: 0.75;
      transition: opacity 0.3s ease;
    }
    .premium-card:hover .premium-info { opacity: 1; }
    .info-icon { font-size: 0.9rem; }

    .premium-delivery {
      font-weight: 600;
      padding: 4px 14px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      font-size: 0.8rem;
      transition: all 0.3s ease;
    }
    .premium-card:hover .premium-delivery { transform: scale(1.02); }
    .delivery-icon { font-size: 0.9rem; }

    .premium-domicilio {
      transition: all 0.3s ease;
      margin-top: 4px !important;
    }
    .premium-card:hover .premium-domicilio { transform: scale(1.02); }

    .premium-btn {
      width: 100%;
      border: none;
      padding: 14px;
      border-radius: 14px;
      cursor: pointer;
      font-weight: 700;
      margin-top: 16px;
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      font-size: 0.95rem;
      letter-spacing: 0.5px;
      position: relative;
      overflow: hidden;
      background: #f1f5f9;
      color: #1e293b;
      border: 2px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .premium-btn .btn-text { position: relative; z-index: 1; }
    .premium-btn .btn-arrow {
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      font-size: 1.2rem;
      position: relative;
      z-index: 1;
    }
    .premium-btn .btn-shine {
      position: absolute;
      top: 0; left: -100%;
      width: 60%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      transform: skewX(-15deg);
      transition: left 0.6s ease;
      pointer-events: none;
    }
    .premium-btn:hover {
      background: var(--btn-color, #10B981);
      color: white;
      border-color: var(--btn-color, #10B981);
      transform: translateY(-3px);
      box-shadow: 0 8px 32px var(--theme-shadow, rgba(16, 185, 129, 0.2));
    }
    .premium-btn:hover .btn-arrow { transform: translateX(8px) scale(1.1); }
    .premium-btn:hover .btn-shine { left: 200%; transition: left 0.8s ease; }
    .premium-btn:active { transform: scale(0.95); }

    .premium-card.selected {
      border-color: var(--theme-color, #10B981);
      box-shadow: 0 0 0 4px var(--theme-shadow, rgba(16, 185, 129, 0.12));
    }

    .premium-footer-section {
      margin-top: 40px;
      border-radius: 24px;
      overflow: hidden;
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 30%, #a7f3d0 60%, #6ee7b7 100%);
      position: relative;
      box-shadow: 0 8px 40px rgba(16, 185, 129, 0.08);
    }
    .premium-waves {
      position: relative;
      width: 100%;
      height: 80px;
      margin-top: -2px;
      overflow: hidden;
    }
    .premium-waves svg {
      width: 100%;
      height: 100%;
      display: block;
      animation: waveFloat 4s ease-in-out infinite;
    }
    .premium-waves svg path:nth-child(2) { animation-delay: 0.5s; }
    .premium-waves svg path:nth-child(3) { animation-delay: 1s; }

    .premium-footer-content { padding: 20px 30px 30px; position: relative; z-index: 1; }
    .premium-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 20px;
      margin-bottom: 28px;
    }
    .stat-item {
      text-align: center;
      padding: 16px 12px;
      background: rgba(255, 255, 255, 0.6);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      transition: all 0.3s ease;
    }
    .stat-item:hover {
      transform: translateY(-4px);
      background: rgba(255, 255, 255, 0.8);
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.08);
    }
    .stat-number {
      font-size: 2.2rem;
      font-weight: 800;
      color: #065F46;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }
    .stat-label {
      font-size: 0.85rem;
      color: #374151;
      margin-top: 4px;
      font-weight: 500;
    }

    .premium-categories {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 28px;
      justify-content: center;
    }
    .category-tag {
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: var(--cat-color, #065F46);
      transition: all 0.3s ease;
      cursor: default;
    }
    .category-tag:hover {
      transform: scale(1.05);
      background: rgba(255, 255, 255, 0.8);
      box-shadow: 0 4px 16px rgba(0,0,0,0.04);
    }

    .premium-footer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.3);
    }
    .premium-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .premium-brand .brand-icon { font-size: 1.8rem; }
    .premium-brand .brand-name {
      font-weight: 700;
      font-size: 1.1rem;
      color: #065F46;
    }
    .premium-brand .brand-slogan {
      font-size: 0.85rem;
      color: #374151;
      opacity: 0.7;
    }

    .premium-cta-btn {
      padding: 10px 24px;
      border: none;
      border-radius: 14px;
      background: #065F46;
      color: white;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .premium-cta-btn:hover {
      background: #10B981;
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.2);
    }

    @media (max-width: 640px) {
      #tiendas-grid {
        grid-template-columns: 1fr;
        gap: 18px;
        padding: 4px;
      }
      .premium-icon-wrap { padding: 24px 16px 20px; min-height: 130px; }
      .premium-icon { font-size: 4rem; }
      .premium-content { padding: 14px 16px 18px; }
      .premium-name { font-size: 1.05rem; }
      .premium-btn { padding: 12px; font-size: 0.85rem; }
      .premium-rating { top: 10px; right: 10px; font-size: 0.7rem; padding: 4px 10px; }
      .premium-dist { bottom: 10px; right: 10px; font-size: 0.65rem; padding: 4px 10px; }
      .premium-footer-content { padding: 16px 16px 24px; }
      .premium-stats { grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .stat-number { font-size: 1.6rem; }
      .stat-item { padding: 12px 8px; }
      .premium-footer-bottom { flex-direction: column; align-items: center; text-align: center; }
      .premium-brand { justify-content: center; }
      .premium-waves { height: 50px; }
    }

    .tienda-chip {
      border: 2px solid #10B981;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      background: white;
      padding: 8px 20px;
      border-radius: 24px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.85rem;
      color: #065F46;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tienda-chip:hover {
      background: #D1FAE5;
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.12);
    }
    .tienda-chip.active {
      background: #10B981 !important;
      color: white !important;
      border-color: #10B981 !important;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
      transform: translateY(-2px);
    }
    .chip-emoji { font-size: 1rem; }

    .empty-state.premium-empty {
      padding: 80px 20px;
      text-align: center;
      color: #6b7280;
    }
    .float-anim {
      animation: floatIcon 3s ease-in-out infinite;
      display: inline-block;
    }
    .premium-empty h3 {
      font-size: 1.4rem;
      color: #374151;
      margin: 16px 0 8px;
    }
    .premium-empty p {
      color: #94a3b8;
      font-size: 1rem;
    }
  `;
  
  document.head.appendChild(style);
  stylesInjected = true;
}

/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}