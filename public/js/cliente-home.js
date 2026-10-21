// public/js/cliente-home.js
import { db, auth } from './firebase-config.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let map;
let markers = [];
let currentLocation = { lat: 4.7110, lng: -74.0721 };

// Generar color único basado en el nombre de la tienda
function getColorFromName(nombre) {
    const colores = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#ff9a9e', '#a18cd1'];
    let hash = 0;
    for (let i = 0; i < nombre.length; i++) {
        hash = ((hash << 5) - hash) + nombre.charCodeAt(i);
        hash |= 0;
    }
    return colores[Math.abs(hash) % colores.length];
}

// Generar emoji basado en el tipo de tienda
function getEmojiByTipo(tipo) {
    const emojisPorTipo = {
        'tienda': '🏪',
        'carniceria': '🥩',
        'farmacia': '💊',
        'frutas_verduras': '🥬',
        'licoreria': '🍾',
        'general': '🏪'
    };
    return emojisPorTipo[tipo] || '🏪';
}

// Inicializar mapa
function initMap() {
    const mapDiv = document.getElementById('map');
    if (!mapDiv) return;
    
    map = L.map('map').setView([currentLocation.lat, currentLocation.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

// Renderizar tiendas como tarjetas modernas
function renderTiendas(tiendas) {
    const grid = document.getElementById('grid');
    const emptyDiv = document.getElementById('empty');
    
    if (!grid) return;
    
    if (tiendas.length === 0) {
        grid.style.display = 'none';
        if (emptyDiv) emptyDiv.style.display = 'block';
        return;
    }
    
    grid.style.display = 'grid';
    if (emptyDiv) emptyDiv.style.display = 'none';
    
    grid.innerHTML = tiendas.map(tienda => {
        const colorFondo = getColorFromName(tienda.nombre || 'Tienda');
        const emoji = getEmojiByTipo(tienda.tipo);
        const tieneImagen = tienda.imageUrl && tienda.imageUrl !== '' && !tienda.imageUrl.includes('base64');
        
        return `
            <div class="store-card-modern" data-id="${tienda.id}">
                <div class="store-media-modern" ${!tieneImagen ? `style="background: linear-gradient(135deg, ${colorFondo} 0%, ${colorFondo}dd 100%);"` : ''}>
                    ${tieneImagen ? 
                        `<img class="store-img-modern" src="${tienda.imageUrl}" alt="${tienda.nombre}">` : 
                        `<div class="store-illus-modern" style="font-size: 4rem; display: flex; align-items: center; justify-content: center; height: 100%;">${emoji}</div>`
                    }
                    <span class="store-category-badge">${tienda.tipo || 'general'}</span>
                </div>
                <div class="store-body-modern">
                    <div class="store-title-modern">${tienda.nombre || 'Tienda sin nombre'}</div>
                    <div class="store-meta-modern">
                        <i class="fas fa-map-marker-alt"></i> ${tienda.direccion || 'Dirección no disponible'}
                    </div>
                    ${tienda.telefono ? `
                        <div class="store-phone" style="display: flex; align-items: center; gap: 8px; color: #666; font-size: 0.85rem; margin-bottom: 12px;">
                            <i class="fas fa-phone"></i> ${tienda.telefono}
                        </div>
                    ` : ''}
                    ${tienda.horario ? `
                        <div class="store-hours" style="display: flex; align-items: center; gap: 8px; color: #666; font-size: 0.8rem; margin-bottom: 12px;">
                            <i class="fas fa-clock"></i> ${tienda.horario}
                        </div>
                    ` : ''}
                    <button class="btn-select-tienda" data-id="${tienda.id}">
                        Ver tienda →
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Eventos de los botones
    document.querySelectorAll('.btn-select-tienda').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const storeId = btn.getAttribute('data-id');
            if (storeId) {
                window.location.href = `productos.html?tienda=${storeId}`;
            }
        });
    });
    
    // Click en toda la tarjeta
    document.querySelectorAll('.store-card-modern').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-select-tienda')) return;
            const storeId = card.getAttribute('data-id');
            if (storeId) {
                window.location.href = `productos.html?tienda=${storeId}`;
            }
        });
    });
}

// Cargar tiendas desde Firebase
function cargarTiendas() {
    const tiendasRef = collection(db, 'tiendas');
    // No filtramos por 'activo' si no existe ese campo
    const q = query(tiendasRef);
    
    onSnapshot(q, (snapshot) => {
        const tiendas = [];
        snapshot.forEach(doc => {
            tiendas.push({
                id: doc.id,
                ...doc.data()
            });
        });
        console.log('✅ Tiendas cargadas:', tiendas.length);
        renderTiendas(tiendas);
        actualizarMapa(tiendas);
    }, (error) => {
        console.error('Error al cargar tiendas:', error);
        const grid = document.getElementById('grid');
        if (grid) {
            grid.innerHTML = '<div class="empty">Error al cargar las tiendas. Intenta de nuevo.</div>';
        }
    });
}

// Actualizar marcadores en el mapa
function actualizarMapa(tiendas) {
    if (!map) return;
    
    if (markers.length) {
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
    }
    
    tiendas.forEach(tienda => {
        const lat = tienda.lat;
        const lng = tienda.lon;
        
        if (lat && lng) {
            const marker = L.marker([lat, lng])
                .addTo(map)
                .bindPopup(`
                    <div style="text-align:center">
                        <b>${tienda.nombre}</b><br>
                        ${tienda.direccion || ''}<br>
                        ${tienda.horario ? `<small>${tienda.horario}</small><br>` : ''}
                        <a href="productos.html?tienda=${tienda.id}" style="display:inline-block;margin-top:8px;padding:6px 12px;background:#667eea;color:white;border-radius:8px;text-decoration:none">
                            Ver tienda
                        </a>
                    </div>
                `);
            markers.push(marker);
        }
    });
    
    if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

// Geolocalización
function obtenerUbicacion() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                if (map) map.setView([currentLocation.lat, currentLocation.lng], 14);
            },
            (error) => {
                console.warn('Error de geolocalización:', error);
                alert('No se pudo obtener tu ubicación. Asegúrate de permitir el acceso.');
            }
        );
    } else {
        alert('Tu navegador no soporta geolocalización.');
    }
}

// Mostrar usuario logueado
function mostrarUsuario() {
    auth.onAuthStateChanged((user) => {
        const welcomeText = document.getElementById('welcomeText');
        const userInitial = document.getElementById('userInitial');
        
        if (user && welcomeText) {
            const email = user.email || 'Usuario';
            const nombre = email.split('@')[0];
            welcomeText.textContent = `Hola, ${nombre}`;
            if (userInitial) {
                userInitial.textContent = nombre.charAt(0).toUpperCase();
            }
        } else if (welcomeText) {
            welcomeText.textContent = 'Elige una tienda para ver su catálogo';
        }
    });
}

// Inicializar cuando carga la página
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    cargarTiendas();
    mostrarUsuario();
    
    const locationBtn = document.getElementById('useLocation');
    if (locationBtn) {
        locationBtn.addEventListener('click', obtenerUbicacion);
    }
});