// ./js/tiendas-public.js
// v44.0 — TARJETAS RECTANGULARES EN PC Y CELULAR 🎨
// Se eliminó la clase obsoleta .premium-card para evitar conflictos en móviles

import { db } from './firebase-config.js';
import {
  collection,
  getDocs,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const PLACEHOLDER_IMG = '';
const R_MAX_KM_DEFAULT = 20;

/* =========================================================
   🎨 TIPOS DE COMERCIO - PALETA DEFINITIVA
   ========================================================= */

export const TIPOS_COMERCIANTE = {
  licoreria: {
    id: 'licoreria',
    label: 'Licorería',
    emoji: '🍾',
    accentColor: '#B8860B',
    accentLight: '#FDF5E6',
    keywords: ['licorería', 'licoreria', 'licor', 'vino', 'cerveza', 'whisky', 'ron', 'aguardiente', 'bar', 'kiosko', 'kiosco', 'bebidas alcoholicas']
  },
  tienda: {
    id: 'tienda',
    label: 'Tienda',
    emoji: '🏪',
    accentColor: '#0B7A4F',
    accentLight: '#E6F7F0',
    keywords: ['tienda', 'abarrotes', 'supermercado', 'almacen', 'bodega', 'mini mercado', 'minimercado', 'despensa', 'general']
  },
  verdureria: {
    id: 'verdureria',
    label: 'Verdurería',
    emoji: '🥬',
    accentColor: '#4A7C2E',
    accentLight: '#EFF8E8',
    keywords: ['verdulería', 'verdureria', 'verduras', 'frutas', 'hortalizas', 'fruteria', 'frutas y verduras', 'agricola']
  },
  fruteria: {
    id: 'fruteria',
    label: 'Frutería',
    emoji: '🍎',
    accentColor: '#B8323A',
    accentLight: '#FDE8EA',
    keywords: ['fruteria', 'frutas', 'frutería']
  },
  farmacia: {
    id: 'farmacia',
    label: 'Farmacia',
    emoji: '💊',
    accentColor: '#2563EB',
    accentLight: '#EFF6FF',
    keywords: ['farmacia', 'droguería', 'drogueria', 'medicina', 'salud', 'farmaceutica', 'botica']
  },
  carniceria: {
    id: 'carniceria',
    label: 'Carnicería',
    emoji: '🥩',
    accentColor: '#C2491A',
    accentLight: '#FDF0E8',
    keywords: ['carnicería', 'carniceria', 'carnes', 'carnico', 'cortes', 'embutidos', 'carnicero']
  },
  mascotas: {
    id: 'mascotas',
    label: 'Mascotas',
    emoji: '🐾',
    accentColor: '#7B5EA7',
    accentLight: '#F3EEF7',
    keywords: ['mascotas', 'animales', 'perro', 'gato', 'veterinaria', 'accesorios', 'alimento']
  },
  aseo: {
    id: 'aseo',
    label: 'Aseo',
    emoji: '🧹',
    accentColor: '#0D7A9E',
    accentLight: '#E8F3F7',
    keywords: ['aseo', 'limpieza', 'detergente', 'escoba', 'trapo', 'higiene']
  },
  default: {
    id: 'default',
    label: 'Comercio',
    emoji: '🏪',
    accentColor: '#0B7A4F',
    accentLight: '#E6F7F0',
    keywords: []
  }
};

// ============================================================
// 🎨 IDENTIDAD DE MARCA
// ============================================================

const BRAND = {
  primary: '#0B7A4F',
  primaryLight: '#E6F7F0',
  primaryDark: '#06523A',
  gradient: 'linear-gradient(145deg, #0B7A4F 0%, #6FCF97 50%, #0B7A4F 100%)',
  gradientBar: 'linear-gradient(135deg, #0B7A4F 0%, #1A9E6F 40%, #0B7A4F 100%)',
  glow: 'rgba(11, 122, 79, 0.20)',
  shadow: 'rgba(11, 122, 79, 0.10)',
};

// Colores oficiales del logo para detalles
const LOGO_COLORS = {
  green: '#0B7A4F',
  turquoise: '#0D7A9E',
  orange: '#C2491A',
  yellow: '#D97706',
  blue: '#2563EB'
};

/* =========================================================
   🎨 DETECTAR TIPO DE COMERCIO
   ========================================================= */

export function detectarTipoComercio(tienda) {
  const nombre = String(tienda.nombre || tienda.name || '').toLowerCase().trim();
  
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
  } else if (nombre.includes('mascota') || nombre.includes('animal') || nombre.includes('perro') || nombre.includes('gato') || 
             nombre.includes('veterinaria') || nombre.includes('alimento')) {
    return 'mascotas';
  } else if (nombre.includes('aseo') || nombre.includes('limpieza') || nombre.includes('detergente') || 
             nombre.includes('escoba') || nombre.includes('trapo')) {
    return 'aseo';
  } else if (nombre.includes('fruta') || nombre.includes('fruteria') || nombre.includes('frutería')) {
    return 'fruteria';
  }
  
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
    color: BRAND.primary,
    colorLight: BRAND.primaryLight,
    colorDark: BRAND.primaryDark,
    gradient: BRAND.gradient,
    glowColor: BRAND.glow,
    shadowColor: BRAND.shadow,
    accentColor: tipo.accentColor,
    accentLight: tipo.accentLight,
    textColor: BRAND.primaryDark,
    subTextColor: '#64748B'
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
    snap.forEach(d => {
      const data = d.data();
      if (data.activo === false) return;
      out.push(normalizeTienda({ id: d.id, ...data }));
    });
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
      tiempoEntrega: '15-25 min'
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
  
  let tipoComercio = t.tipoComercio || t.tipo || t.categoria || '';
  const nombre = String(t.nombre || t.name || '').toLowerCase();
  
  if (!tipoComercio || tipoComercio === 'general') {
    if (nombre.includes('licor') || nombre.includes('vino') || nombre.includes('cerveza') || nombre.includes('whisky') || nombre.includes('ron') || nombre.includes('aguardiente')) {
      tipoComercio = 'licoreria';
    } else if (nombre.includes('farmacia') || nombre.includes('droguería') || nombre.includes('drogueria')) {
      tipoComercio = 'farmacia';
    } else if (nombre.includes('carnicería') || nombre.includes('carniceria') || nombre.includes('carnes') || nombre.includes('cortes')) {
      tipoComercio = 'carniceria';
    } else if (nombre.includes('verdura') || nombre.includes('fruta') || nombre.includes('hortaliza') || nombre.includes('verdulería') || nombre.includes('verdureria')) {
      tipoComercio = 'verdureria';
    } else if (nombre.includes('mascota') || nombre.includes('animal') || nombre.includes('perro') || nombre.includes('gato') || nombre.includes('veterinaria')) {
      tipoComercio = 'mascotas';
    } else if (nombre.includes('aseo') || nombre.includes('limpieza') || nombre.includes('detergente')) {
      tipoComercio = 'aseo';
    } else {
      tipoComercio = 'tienda';
    }
  }
  
  return {
    id: String(t.id || t.uid || ''),
    nombre: t.nombre || t.name || 'Tienda',
    direccion: t.direccion || t.address || '',
    descripcion: t.descripcion || '', /* 🔥 NUEVO CAMPO AGREGADO */
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
    online: t.online === true
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
   🎨 CREAR SECCIÓN BARRA PREMIUM (HORIZONTAL CLARO)
   ========================================================= */

async function createPremiumSection(tiendas, onFilterChange = null) {
  const section = document.createElement('div');
  section.className = 'premium-footer-section';
  
  const totalTiendas = tiendas.length;
  
  // Agrupar por tipo
  const tiposMap = new Map();
  tiendas.forEach(t => {
    const tipoId = detectarTipoComercio(t);
    const tipo = TIPOS_COMERCIANTE[tipoId] || TIPOS_COMERCIANTE.default;
    if (!tiposMap.has(tipoId)) {
      tiposMap.set(tipoId, {
        id: tipoId,
        label: tipo.label,
        emoji: tipo.emoji,
        accentColor: tipo.accentColor,
        count: 0,
        tiendas: []
      });
    }
    tiposMap.get(tipoId).count++;
    tiposMap.get(tipoId).tiendas.push(t.id);
  });
  
  const categoriasReales = Array.from(tiposMap.values());
  const ratingPromedio = tiendas.reduce((sum, t) => sum + (t.rating || 0), 0) / totalTiendas || 0;
  
  // Calcular tiempo de entrega promedio
  let tiempoPromedio = '15-25 min';
  const tiempos = tiendas.filter(t => t.tiempoEntrega).map(t => {
    const nums = t.tiempoEntrega.match(/\d+/g);
    if (nums && nums.length >= 2) return (parseInt(nums[0]) + parseInt(nums[1])) / 2;
    return null;
  }).filter(n => n !== null);
  if (tiempos.length > 0) {
    const avg = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
    const min = Math.round(avg * 0.7);
    const max = Math.round(avg * 1.3);
    tiempoPromedio = `${min}-${max} min`;
  }

  // Frase dinámica
  const frase = totalTiendas === 1 
    ? '1 comercio disponible cerca de ti 📍'
    : `${totalTiendas} comercios disponibles cerca de ti 📍`;

  // Usar logo real si existe, si no usar emoji por defecto
  const logoHTML = tiendas[0]?.logoUrl 
    ? `<img src="${tiendas[0].logoUrl}" alt="Logo" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">` 
    : `<span style="font-size: 2rem;">🏪</span>`;

  // Asignar colores a los chips de categorías
  const chipColors = [
    { bg: '#0B7A4F15', color: '#0B7A4F', border: '#0B7A4F30' }, // Verde
    { bg: '#C2491A15', color: '#C2491A', border: '#C2491A30' }, // Naranja
    { bg: '#2563EB15', color: '#2563EB', border: '#2563EB30' }, // Azul
    { bg: '#0D7A9E15', color: '#0D7A9E', border: '#0D7A9E30' }, // Turquesa
    { bg: '#D9770615', color: '#D97706', border: '#D9770630' }  // Amarillo
  ];

  section.innerHTML = `
    <div class="premium-footer-content">
      <!-- Marca -->
      <div class="premium-brand">
        <div class="brand-logo-circle">
          ${logoHTML}
        </div>
        <div class="brand-text">
          <span class="brand-name">Mi Tiendita Cercana</span>
          <span class="brand-slogan">${frase}</span>
        </div>
      </div>

      <!-- ESTADÍSTICAS -->
      <div class="premium-stats">
        <div class="stat-item">
          <span class="stat-icon">🛍️</span>
          <span class="stat-number">${totalTiendas}</span>
          <span class="stat-label">Comercios</span>
        </div>
        <div class="stat-item">
          <span class="stat-icon">⭐</span>
          <span class="stat-number">${ratingPromedio.toFixed(1)}</span>
          <span class="stat-label">Promedio</span>
        </div>
        <div class="stat-item">
          <span class="stat-icon">🛵</span>
          <span class="stat-number">${tiempoPromedio}</span>
          <span class="stat-label">Entrega</span>
        </div>
        <div class="stat-item">
          <span class="stat-icon">📍</span>
          <span class="stat-label">Cerca de ti</span>
        </div>
      </div>

      <!-- FILTROS RÁPIDOS -->
      <div class="premium-filters">
        <button class="filter-chip active" data-filter="all" style="background: #0B7A4F; color: white; border-color: #0B7A4F;">
          🏪 Todos <span class="chip-count">${totalTiendas}</span>
        </button>
        ${categoriasReales.map((cat, index) => {
          const chipColor = chipColors[(index + 1) % chipColors.length];
          return `
            <button 
              class="filter-chip" 
              data-filter="${cat.id}"
              data-tiendas="${cat.tiendas.join(',')}"
              style="background: ${chipColor.bg}; color: ${chipColor.color}; border-color: ${chipColor.border};"
            >
              ${cat.emoji} ${cat.label} <span class="chip-count">${cat.count}</span>
            </button>
          `;
        }).join('')}
        <button class="filter-chip" data-filter="all" style="background: transparent; color: ${LOGO_COLORS.blue}; border-color: ${LOGO_COLORS.blue}30;">
          + Ver todos
        </button>
      </div>

      <!-- Botón Subir -->
      <button class="premium-cta-btn" onclick="window.scrollTo({top: 0, behavior: 'smooth'})">
        <span>⬆</span> Subir
      </button>
    </div>
  `;

  // =========================================================
  // 🎯 FILTROS INTERACTIVOS
  // =========================================================
  
  const filterChips = section.querySelectorAll('.filter-chip');
  const grid = document.getElementById('tiendas-grid');
  
  // Función para filtrar tiendas
  function filterTiendas(filter) {
    // Actualizar estado visual de los chips
    filterChips.forEach(chip => {
      if (chip.dataset.filter === 'all' && chip.textContent.includes('Ver todos')) return; // No marcar el botón +Ver todos
      chip.classList.remove('active');
      if (chip.dataset.filter === filter) {
        chip.classList.add('active');
        chip.style.background = LOGO_COLORS.green;
        chip.style.color = 'white';
        chip.style.borderColor = LOGO_COLORS.green;
      } else {
        chip.style.background = chip.dataset.filter === 'all' 
          ? LOGO_COLORS.green 
          : chip.style.background || 'transparent';
        chip.style.color = chip.dataset.filter === 'all' 
          ? 'white' 
          : chip.style.color || 'inherit';
        chip.style.borderColor = chip.dataset.filter === 'all' 
          ? LOGO_COLORS.green 
          : chip.style.borderColor || 'transparent';
      }
    });

    // Filtrar tarjetas
    if (!grid) return;
    const cards = grid.querySelectorAll('.card-premium');
    let visibleCount = 0;
    
    cards.forEach(card => {
      const tipo = card.dataset.tipo || '';
      if (filter === 'all' || tipo === filter) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    // Actualizar contador en el filtro "Todos"
    const allChip = section.querySelector('.filter-chip[data-filter="all"]');
    if (allChip) {
      const countSpan = allChip.querySelector('.chip-count');
      if (countSpan) countSpan.textContent = visibleCount;
    }

    // Actualizar frase
    const slogan = section.querySelector('.brand-slogan');
    if (slogan) {
      if (filter === 'all') {
        slogan.textContent = visibleCount === 1 
          ? '1 comercio disponible cerca de ti 📍'
          : `${visibleCount} comercios disponibles cerca de ti 📍`;
      } else {
        const catLabel = filterChips.find(c => c.dataset.filter === filter)?.textContent?.trim() || filter;
        slogan.textContent = `${visibleCount} ${catLabel}${visibleCount !== 1 ? 's' : ''} disponibles 📍`;
      }
    }
  }

  // Asignar eventos a los filtros
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const filter = chip.dataset.filter;
      filterTiendas(filter);
    });
  });

  // Guardar referencia para usar desde fuera
  section._filterTiendas = filterTiendas;
  
  return section;
}

/* =========================================================
   🎨 RENDER GRID - TARJETAS ACABADO PREMIUM
   ========================================================= */

export function renderTiendasGrid(
  container,
  tiendas,
  onPick,
  distMap = {}
) {
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
    const delay = Math.min(index * 0.04, 0.6);
    
    return `
      <article 
        class="card-premium"
        data-id="${t.id}"
        data-tipo="${theme.id}"
        style="
          --theme-color: ${theme.color};
          --theme-dark: ${theme.colorDark};
          --theme-gradient: ${theme.gradient};
          --accent-color: ${theme.accentColor};
          --accent-light: ${theme.accentLight};
          --card-delay: ${delay}s;
          animation-delay: ${delay}s;
        "
      >
        <!-- HEADER: Emoji + Categoría + Rating -->
        <div class="card-header" style="background: var(--theme-gradient);">
          <div class="card-emoji">${theme.emoji}</div>
          <div class="card-category">${theme.label}</div>
          ${t.rating ? `
            <div class="card-rating" style="background: rgba(255,255,255,0.20); backdrop-filter: blur(4px);">
              <span class="star-icon">★</span> ${t.rating}
            </div>
          ` : ''}
        </div>

        <!-- DIVISOR SUTIL -->
        <div class="card-divider" style="background: var(--accent-color); opacity: 0.15;"></div>

        <!-- BODY: Información -->
        <div class="card-body">

          <h3 class="card-name">${escapeHtml(t.nombre)}</h3>

          <div class="card-info-list">
            ${t.direccion ? `
              <div class="card-info">
                <span class="card-info-icon">📍</span>
                <span>${escapeHtml(t.direccion)}</span>
              </div>
            ` : ''}

            ${/* 🔥 NUEVO BLOQUE PARA MOSTRAR LA DESCRIPCIÓN */ ''}
                                                         ${(t.descripcion && t.descripcion.toLowerCase().trim() !== 'productos') ? `
              <div class="card-info" style="margin: 4px 0;">
                <span style="
                  font-family: inherit;
                  font-style: normal; 
                  font-size: 0.68rem; 
                  color: #334155; 
                  line-height: 1.3;
                  display: -webkit-box;
                  -webkit-line-clamp: 2;
                  -webkit-box-orient: vertical;
                  overflow: hidden;
                ">"${escapeHtml(t.descripcion)}"</span>
              </div>
            ` : ''}

            ${t.horario ? `
              <div class="card-info">
                <span class="card-info-icon">🕒</span>
                <span>${escapeHtml(t.horario)}</span>
              </div>
            ` : ''}
          </div>

          <!-- FOOTER -->
          <div class="card-footer">
            ${t.tiempoEntrega ? `
              <div class="card-delivery" style="background: var(--accent-light); color: var(--accent-color); border-color: var(--accent-color)25;">
                🛵 ${escapeHtml(t.tiempoEntrega)}
              </div>
            ` : ''}

            ${dist ? `
              <span class="card-distance" style="color: var(--accent-color);">
                📍 ${dist}
              </span>
            ` : ''}

            <button
              class="card-btn"
              data-id="${t.id}"
              type="button"
              style="--btn-color: var(--accent-color);"
            >
              <span>Ver tienda</span>
              <span class="btn-arrow">→</span>
            </button>
          </div>

        </div>
      </article>
    `;
  }).join('');

  // Agregar barra rediseñada
  const gridParent = container.parentElement;
  if (gridParent) {
    const existing = gridParent.querySelector('.premium-footer-section');
    if (existing) existing.remove();
    
    createPremiumSection(tiendas).then(section => {
      gridParent.appendChild(section);
      
      // Aplicar filtro inicial "todos"
      if (section._filterTiendas) {
        section._filterTiendas('all');
      }
    });
  }

  // Eventos
  container.querySelectorAll('.card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      onPick?.(id);
    });
  });

  container.querySelectorAll('.card-premium').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      onPick?.(id);
    });
  });
}

/* =========================================================
   🎨 ESTILOS CSS - BARRA HORIZONTAL LIMPIA
   ========================================================= */

let stylesInjected = false;

function injectPremiumStyles() {
  if (stylesInjected) return;
  
  const style = document.createElement('style');
  style.textContent = `
    /* ============================================================
       ANIMACIONES
       ============================================================ */

    @keyframes floatIn {
      0% {
        opacity: 0;
        transform: translateY(20px) scale(0.97);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes floatIcon {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-6px) rotate(-3deg); }
    }

    @keyframes logoGlow {
      0%, 100% { filter: drop-shadow(0 4px 12px rgba(11,122,79,0.2)); }
      50% { filter: drop-shadow(0 4px 24px rgba(11,122,79,0.4)); }
    }

    @keyframes btnArrow {
      0% { transform: translateX(0); }
      100% { transform: translateX(4px); }
    }

    @keyframes pulseDot {
      0%, 100% { transform: scale(1); opacity: 0.7; }
      50% { transform: scale(1.3); opacity: 1; }
    }

    @keyframes chipHover {
      0% { transform: translateY(0); }
      100% { transform: translateY(-2px); }
    }

    /* ============================================================
       🏪 TARJETAS PREMIUM
       ============================================================ */

    #tiendas-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 20px;
      padding: 8px;
    }

    .card-premium {
      width: 100% !important;
      max-width: 255px !important;
      min-height: 270px !important;

      border-radius: 20px !important;
      overflow: hidden !important;

      background: white !important;
      border: 1px solid rgba(255,255,255,0.6) !important;

      box-shadow:
        0 4px 20px rgba(11, 122, 79, 0.06),
        0 1px 6px rgba(11, 122, 79, 0.03),
        inset 0 1px 0 rgba(255,255,255,0.8) !important;

      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      cursor: pointer;

      animation: floatIn 0.5s ease forwards;
      opacity: 0;

      position: relative;
    }

    .card-premium:hover {
      transform: translateY(-8px) !important;
      box-shadow:
        0 16px 48px rgba(11, 122, 79, 0.10),
        0 8px 24px rgba(11, 122, 79, 0.06),
        inset 0 1px 0 rgba(255,255,255,0.8) !important;
    }

    /* ===== HEADER ===== */

    .card-header {
      padding: 22px 14px 12px;
      text-align: center;
      position: relative;
      min-height: 92px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .card-emoji {
      font-size: 2.8rem;
      line-height: 1;
      filter: drop-shadow(0 2px 12px rgba(0,0,0,0.08));
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .card-premium:hover .card-emoji {
      transform: scale(1.08) rotate(-4deg);
    }

    .card-category {
      margin-top: 4px;
      font-size: 0.52rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: rgba(255,255,255,0.85);
      text-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    .card-rating {
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 3px 9px;
      border-radius: 999px;
      color: white;
      font-size: 0.5rem;
      font-weight: 700;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .card-rating .star-icon {
      color: #FFD700;
      font-size: 0.6rem;
    }

    /* ===== DIVISOR ===== */

    .card-divider {
      height: 2px;
      width: 50%;
      margin: 0 auto;
      border-radius: 999px;
      opacity: 0.15;
    }

    /* ===== BODY ===== */

    .card-body {
      padding: 12px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .card-name {
      font-size: 0.9rem;
      font-weight: 800;
      line-height: 1.2;
      margin: 0 0 2px;
      text-align: center;
      color: var(--theme-dark);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }

    .card-info-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 3px 0 2px;
    }

    .card-info {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      font-size: 0.66rem !important;
      color: #475569;
      line-height: 1.3;
    }

    .card-info-icon {
      flex-shrink: 0;
      font-size: 0.7rem;
      margin-top: 1px;
      opacity: 0.7;
    }

    /* ===== FOOTER ===== */

    .card-footer {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
    }

    .card-delivery {
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.5rem;
      font-weight: 600;
      border: 1px solid;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .card-distance {
      font-size: 0.48rem;
      font-weight: 600;
    }

    /* ===== BOTÓN PREMIUM ===== */

    .card-btn {
      width: 100%;
      padding: 6px 12px;
      border-radius: 10px;
      background: var(--btn-color);
      color: white;
      border: none;
      font-size: 0.58rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
      letter-spacing: 0.3px;
    }

    .card-btn:hover {
      transform: translateY(-2px) scale(1.01);
      box-shadow: 0 8px 28px rgba(0,0,0,0.10);
    }

    .card-btn:active {
      transform: scale(0.97);
    }

    .card-btn .btn-arrow {
      transition: transform 0.3s ease;
      font-size: 0.75rem;
    }

    .card-btn:hover .btn-arrow {
      animation: btnArrow 0.6s ease infinite alternate;
    }

    /* ============================================================
       📱 RESPONSIVE - CELULAR
       ============================================================ */

    @media (max-width: 820px) {
      #tiendas-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 14px !important;
        padding: 6px !important;
      }

      .card-premium {
        max-width: 100% !important;
        min-height: 230px !important;
        border-radius: 16px !important;
      }

      .card-header {
        padding: 16px 10px 8px;
        min-height: 74px;
      }

      .card-emoji {
        font-size: 2.2rem;
      }

      .card-category {
        font-size: 0.46rem;
        letter-spacing: 1px;
      }

      .card-rating {
        font-size: 0.44rem;
        padding: 2px 7px;
        top: 8px;
        right: 8px;
      }

      .card-body {
        padding: 8px 10px 10px;
        gap: 3px;
      }

      .card-name {
        font-size: 0.75rem;
      }

      .card-info {
        font-size: 0.58rem !important;
        gap: 4px;
      }

      .card-info-icon {
        font-size: 0.6rem;
      }

      .card-footer {
        margin-top: 5px;
        gap: 4px;
      }

      .card-delivery {
        font-size: 0.44rem;
        padding: 2px 8px;
      }

      .card-distance {
        font-size: 0.42rem;
      }

      .card-btn {
        font-size: 0.5rem;
        padding: 4px 8px;
        border-radius: 8px;
        min-height: 26px;
      }
    }

    @media (max-width: 480px) {
      #tiendas-grid {
        gap: 10px !important;
        padding: 4px !important;
      }

      .card-premium {
        min-height: 200px !important;
        border-radius: 14px !important;
        max-width: 100% !important;
      }

      .card-header {
        padding: 12px 8px 6px;
        min-height: 62px;
      }

      .card-emoji {
        font-size: 1.8rem;
      }

      .card-category {
        font-size: 0.4rem;
        letter-spacing: 0.8px;
        margin-top: 2px;
      }

      .card-rating {
        font-size: 0.38rem;
        padding: 2px 6px;
        top: 6px;
        right: 6px;
      }

      .card-rating .star-icon {
        font-size: 0.45rem;
      }

      .card-divider {
        width: 40%;
      }

      .card-body {
        padding: 6px 8px 8px;
        gap: 2px;
      }

      .card-name {
        font-size: 0.65rem;
        margin-bottom: 1px;
        -webkit-line-clamp: 2;
      }

      .card-info-list {
        gap: 2px;
        margin: 2px 0;
      }

      .card-info {
        font-size: 0.49rem !important;
        gap: 3px;
        line-height: 1.2;
      }

      .card-info-icon {
        font-size: 0.5rem;
      }

      .card-footer {
        margin-top: 4px;
        gap: 3px;
      }

      .card-delivery {
        font-size: 0.4rem;
        padding: 2px 7px;
      }

      .card-distance {
        font-size: 0.38rem;
      }

      .card-btn {
        font-size: 0.44rem;
        padding: 3px 6px;
        border-radius: 6px;
        min-height: 22px;
        gap: 3px;
      }

      .card-btn .btn-arrow {
        font-size: 0.6rem;
      }
    }

    @media (max-width: 380px) {
      #tiendas-grid {
        gap: 8px !important;
        padding: 2px !important;
      }

      .card-premium {
        min-height: 170px !important;
        border-radius: 12px !important;
      }

      .card-header {
        padding: 8px 6px 4px;
        min-height: 50px;
      }

      .card-emoji {
        font-size: 1.4rem;
      }

      .card-category {
        font-size: 0.34rem;
        letter-spacing: 0.6px;
      }

      .card-rating {
        font-size: 0.32rem;
        padding: 1px 4px;
        top: 4px;
        right: 4px;
      }

      .card-rating .star-icon {
        font-size: 0.35rem;
      }

      .card-body {
        padding: 4px 6px 6px;
        gap: 1px;
      }

      .card-name {
        font-size: 0.55rem;
        -webkit-line-clamp: 2;
      }

      .card-info {
        font-size: 0.46rem !important;
        gap: 2px;
      }

      .card-info-icon {
        font-size: 0.4rem;
      }

      .card-delivery {
        font-size: 0.34rem;
        padding: 1px 5px;
      }

      .card-distance {
        font-size: 0.32rem;
      }

      .card-btn {
        font-size: 0.38rem;
        padding: 2px 5px;
        min-height: 18px;
        border-radius: 5px;
        gap: 2px;
      }

      .card-btn .btn-arrow {
        font-size: 0.45rem;
      }
    }

    /* ============================================================
       🎨 BARRA PREMIUM (ESTILO HORIZONTAL CLARO)
       ============================================================ */

    .premium-footer-section {
      margin-top: 24px;
      border-radius: 20px;
      background: white;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 2px solid transparent;
      /* Borde superior e inferior con los colores del logo */
      border-image: linear-gradient(90deg, #0B7A4F, #0D7A9E, #C2491A, #D97706, #2563EB, #0B7A4F) 1;
      box-shadow: 
        0 8px 32px rgba(0, 0, 0, 0.05),
        inset 0 1px 0 rgba(255,255,255,0.15);
      padding: 12px 24px;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .premium-footer-section:hover {
      box-shadow: 
        0 12px 48px rgba(0, 0, 0, 0.08);
    }

    .premium-footer-content {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      position: relative;
      z-index: 1;
    }

    /* ===== MARCA ===== */

    .premium-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .brand-logo-circle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: white;
      border: 2px solid #0B7A4F;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #0B7A4F;
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      overflow: hidden;
    }

    .brand-logo-circle img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
      text-align: left;
    }

    .brand-text .brand-name {
      font-weight: 800;
      font-size: 1.05rem;
      color: #06523A;
      letter-spacing: -0.3px;
    }

    .brand-text .brand-slogan {
      font-size: 0.72rem;
      color: #64748B;
      font-weight: 400;
      letter-spacing: 0.2px;
    }

    /* ===== ESTADÍSTICAS ===== */

    .premium-stats {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .stat-icon {
      font-size: 0.9rem;
    }

    .stat-number {
      font-weight: 800;
      font-size: 0.95rem;
      color: #0B7A4F;
    }

    .stat-label {
      font-size: 0.65rem;
      color: #64748B;
      font-weight: 400;
    }

    /* ===== FILTROS ===== */

    .premium-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
    }

    .filter-chip {
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 0.65rem;
      font-weight: 600;
      border: 1.5px solid;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      background: white;
    }

    .filter-chip:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }

    .filter-chip.active {
      box-shadow: 0 4px 16px rgba(0,0,0,0.10);
    }

    .filter-chip .chip-count {
      background: rgba(0,0,0,0.05);
      padding: 0 6px;
      border-radius: 999px;
      font-size: 0.55rem;
      font-weight: 700;
    }

    .filter-chip.active .chip-count {
      background: rgba(255,255,255,0.20);
    }

    /* ===== BOTÓN SUBIR ===== */

    .premium-cta-btn {
      padding: 6px 16px;
      border: none;
      border-radius: 999px;
      background: #0B7A4F;
      color: white;
      font-weight: 600;
      font-size: 0.7rem;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      box-shadow: 0 4px 16px rgba(11, 122, 79, 0.20);
    }

    .premium-cta-btn:hover {
      background: #06523A;
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(11, 122, 79, 0.25);
    }

    /* ============================================================
       📱 BARRA RESPONSIVE
       ============================================================ */

    @media (max-width: 1024px) {
      .premium-footer-content {
        flex-wrap: wrap;
        justify-content: center;
      }
    }

    @media (max-width: 640px) {
      .premium-footer-section {
        padding: 10px 14px;
        margin-top: 16px;
        border-radius: 16px;
      }

      .premium-footer-content {
        flex-direction: column;
        gap: 8px;
      }

      .premium-brand {
        justify-content: center;
        text-align: center;
      }

      .brand-text {
        text-align: center;
      }

      .premium-stats {
        justify-content: center;
      }

      .premium-cta-btn {
        width: 100%;
        justify-content: center;
      }
    }

    /* ============================================================
       🧩 CHIPS Y EMPTY STATE
       ============================================================ */

    .tienda-chip {
      border: 2px solid #0B7A4F;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      background: white;
      padding: 6px 16px;
      border-radius: 24px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.8rem;
      color: #06523A;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .tienda-chip:hover {
      background: #E6F7F0;
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(11, 122, 79, 0.10);
    }

    .tienda-chip.active {
      background: #0B7A4F !important;
      color: white !important;
      border-color: #0B7A4F !important;
      box-shadow: 0 8px 24px rgba(11, 122, 79, 0.22);
      transform: translateY(-2px);
    }

    .chip-emoji { font-size: 0.9rem; }

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
      font-size: 1.3rem;
      color: #374151;
      margin: 16px 0 8px;
    }

    .premium-empty p {
      color: #94a3b8;
      font-size: 0.95rem;
    }

    @media (max-width: 480px) {
      .empty-state.premium-empty {
        padding: 40px 16px;
      }

      .premium-empty h3 {
        font-size: 1rem;
      }

      .premium-empty p {
        font-size: 0.8rem;
      }
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