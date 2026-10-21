// ================================================================
// 🚀 PEDIDO TRACKER - Centro de Seguimiento Único v8.3
// 🔥 OCULTA EL TRACKER CUANDO NO HAY PEDIDOS ACTIVOS
// 🔥 El historial SOLO se ve en "Mis Pedidos"
// 🔥 VERIFICACIÓN AUTOMÁTICA CADA 1 SEGUNDO
// 🔥 OCULTAMIENTO AL INICIO DE LA PÁGINA
// 🔥 OCULTAMIENTO INMEDIATO AL CONFIRMAR RECEPCIÓN
// ================================================================

import {
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    collection,
    query,
    where,
    orderBy,
    updateDoc,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { db, auth } from './firebase-config.js';

// ================================================================
// 📦 ESTADOS Y CONFIGURACIÓN
// ================================================================

const ESTADO_LABELS = {
    'pendiente': { label: '📦 Pedido recibido', color: '#f59e0b', icon: '📦' },
    'proceso': { label: '🔄 En proceso', color: '#3b82f6', icon: '🔄' },
    'aceptado': { label: '✅ Pedido aceptado', color: '#10b981', icon: '✅' },
    'preparando': { label: '👨‍🍳 En preparación', color: '#8b5cf6', icon: '👨‍🍳' },
    'en_preparacion': { label: '👨‍🍳 En preparación', color: '#8b5cf6', icon: '👨‍🍳' },
    'listo': { label: '🍽️ Listo para recoger', color: '#22c55e', icon: '🍽️' },
    'en_camino': { label: '🚚 En camino', color: '#3b82f6', icon: '🚚' },
    'entregado': { label: '✅ Entregado', color: '#16a34a', icon: '✅' },
    'completado': { label: '✅ Completado', color: '#16a34a', icon: '✅' },
    'recibido': { label: '📦 Recibido', color: '#16a34a', icon: '📦' },
    'cancelado': { label: '❌ Cancelado', color: '#ef4444', icon: '❌' },
    'rechazado': { label: '❌ Rechazado', color: '#ef4444', icon: '❌' }
};

const ESTADOS_ORDEN = ['pendiente', 'proceso', 'aceptado', 'preparando', 'en_preparacion', 'listo', 'en_camino', 'entregado', 'completado'];

function getEstadoInfo(estado) {
    return ESTADO_LABELS[estado] || ESTADO_LABELS['pendiente'];
}

function getProgreso(estado) {
    if (estado === 'cancelado' || estado === 'rechazado') return 0;
    const index = ESTADOS_ORDEN.indexOf(estado);
    if (index === -1) return 0;
    return Math.round(((index + 1) / ESTADOS_ORDEN.length) * 100);
}

// ================================================================
// 🚀 CLASE PRINCIPAL
// ================================================================

class PedidoTracker {
    constructor() {
        this.todosLosPedidos = [];
        this.pedidosActivos = [];
        this.pedidosHistorial = [];
        this.pedidoSeleccionado = null;
        this.unsubscribe = null;
        this.isInitialized = false;
        this.elements = {};
        this.trackerVisible = false;
        this.modalChatUnsubscribe = null;
        this.modalActual = null;
        this._pedidoModalActual = null;
        this._ultimoComerciante = null;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    // ============================================================
    // 🚀 INICIALIZACIÓN
    // ============================================================

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.createTrackerDOM();
        this.setupEventListeners();
        this.listenUserOrders();

        console.log('🚀 PedidoTracker v8.3 - Oculto cuando no hay pedidos activos');
    }

    // ============================================================
    // 🏗️ CREAR DOM DEL TRACKER
    // ============================================================

    createTrackerDOM() {
        if (document.getElementById('pedido-tracker-container')) return;

        const container = document.createElement('div');
        container.id = 'pedido-tracker-container';
        container.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 20px;
            z-index: 9999;
            max-width: 400px;
            width: 100%;
            pointer-events: none;
        `;
        document.body.appendChild(container);

        container.innerHTML = `
            <div class="tracker-card" id="tracker-card" style="
                pointer-events: auto;
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.15);
                overflow: hidden;
                display: none;
                border: 1px solid rgba(16,185,129,0.1);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            ">
                <div class="tracker-header" style="
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                ">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:1.2rem;">📦</span>
                        <span style="font-weight:700;font-size:1rem;" id="tracker-title">Seguimiento de pedidos</span>
                        <span id="pedidos-badge" style="
                            background: rgba(255,255,255,0.3);
                            padding: 2px 10px;
                            border-radius: 12px;
                            font-size: 0.75rem;
                            font-weight: 700;
                            display: none;
                        ">0</span>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button id="tracker-toggle" style="
                            background: rgba(255,255,255,0.2);
                            border: none;
                            color: white;
                            width: 32px;
                            height: 32px;
                            border-radius: 50%;
                            cursor: pointer;
                            font-size: 1rem;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            transition: all 0.2s ease;
                        ">−</button>
                        <button id="tracker-close" style="
                            background: rgba(255,255,255,0.2);
                            border: none;
                            color: white;
                            width: 32px;
                            height: 32px;
                            border-radius: 50%;
                            cursor: pointer;
                            font-size: 1rem;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            transition: all 0.2s ease;
                        ">✕</button>
                    </div>
                </div>

                <div id="tracker-body" style="padding: 16px 20px; max-height: 500px; overflow-y: auto; transition: all 0.3s ease;">
                    <div id="tracker-content"></div>
                </div>
            </div>

            <button id="tracker-float-btn" style="
                pointer-events: auto;
                display: none;
                background: linear-gradient(135deg, #10b981, #059669);
                border: none;
                color: white;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 1.4rem;
                box-shadow: 0 8px 32px rgba(16,185,129,0.35);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                position: relative;
            ">
                <span id="tracker-float-badge" style="
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    background: #ef4444;
                    color: white;
                    font-size: 0.7rem;
                    font-weight: 700;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">0</span>
                🛍️
            </button>
        `;

        this.elements = {
            container,
            card: document.getElementById('tracker-card'),
            body: document.getElementById('tracker-body'),
            content: document.getElementById('tracker-content'),
            toggleBtn: document.getElementById('tracker-toggle'),
            closeBtn: document.getElementById('tracker-close'),
            floatBtn: document.getElementById('tracker-float-btn'),
            floatBadge: document.getElementById('tracker-float-badge'),
            headerBadge: document.getElementById('pedidos-badge'),
            title: document.getElementById('tracker-title')
        };
    }

    // ============================================================
    // 🎯 EVENTOS
    // ============================================================

    setupEventListeners() {
        this.elements.toggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMinimize();
        });

        this.elements.closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideTracker();
        });

        const header = this.elements.card?.querySelector('.tracker-header');
        header?.addEventListener('click', () => {
            const body = this.elements.body;
            if (body) {
                const isCollapsed = body.style.maxHeight === '0px';
                body.style.maxHeight = isCollapsed ? '500px' : '0px';
                body.style.overflow = isCollapsed ? 'auto' : 'hidden';
                this.elements.toggleBtn.textContent = isCollapsed ? '−' : '+';
            }
        });

        this.elements.floatBtn?.addEventListener('click', () => {
            this.showTracker();
        });

        document.addEventListener('pedido:creado', (event) => {
            const { pedidoId } = event.detail || {};
            if (pedidoId) {
                console.log('📦 Pedido creado, mostrando tracker');
                setTimeout(() => this.showTracker(), 500);
            }
        });

        document.addEventListener('pedido:estado:cambiado', () => {
            this.refreshPedidos();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cerrarDetalleModal();
            }
        });
    }

    // ============================================================
    // 📡 ESCUCHAR TODOS LOS PEDIDOS DEL USUARIO
    // ============================================================

    listenUserOrders() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        const user = auth.currentUser;
        if (!user) {
            this.todosLosPedidos = [];
            this.pedidosActivos = [];
            this.pedidosHistorial = [];
            this.renderTracker();
            this.updateBadge(0);
            this.hideTracker();
            return;
        }

        console.log(`👤 Escuchando todos los pedidos para: ${user.uid}`);

        const pedidosRef = collection(db, 'pedidos');
        const q = query(
            pedidosRef,
            where('uid', '==', user.uid),
            orderBy('createdAt', 'desc')
        );

        this.unsubscribe = onSnapshot(q, (snapshot) => {
            this.todosLosPedidos = [];
            this.pedidosActivos = [];
            this.pedidosHistorial = [];

            snapshot.forEach((doc) => {
                const data = doc.data();
                const estado = data.estado || 'pendiente';
                const pedido = { id: doc.id, ...data };
                this.todosLosPedidos.push(pedido);

                if (pedido.comercianteNombre || pedido.tiendaNombre) {
                    this._ultimoComerciante = pedido.comercianteNombre || pedido.tiendaNombre;
                }

                const esFinalizado = estado === 'entregado' || estado === 'completado' || estado === 'recibido' || 
                                     estado === 'cancelado' || estado === 'rechazado';
                
                if (esFinalizado) {
                    this.pedidosHistorial.push(pedido);
                } else {
                    this.pedidosActivos.push(pedido);
                }
            });

            this.pedidosActivos.sort((a, b) => {
                const da = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
                const db = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
                return db - da;
            });
            this.pedidosHistorial.sort((a, b) => {
                const da = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
                const db = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
                return db - da;
            });

            console.log(`📦 Pedidos: ${this.pedidosActivos.length} activos, ${this.pedidosHistorial.length} en historial`);
            
            this.renderTracker();
            this.updateBadge(this.pedidosActivos.length);

            // ============================================================
            // 🔥 SOLO mostrar tracker si HAY PEDIDOS ACTIVOS
            // ============================================================
            if (this.pedidosActivos.length > 0) {
                this.showTracker();
            } else {
                // ❌ NO hay pedidos activos → OCULTAR tracker
                this.hideTracker();
                console.log('🧹 No hay pedidos activos, ocultando tracker flotante');
            }

        }, (error) => {
            console.warn('Error escuchando pedidos:', error);
        });
    }

    // ============================================================
    // 🔄 REFRESCAR PEDIDOS
    // ============================================================

    refreshPedidos() {
        console.log('🔄 Refrescando pedidos...');
        this.listenUserOrders();
    }

    // ============================================================
    // 🎨 RENDERIZAR TRACKER
    // ============================================================

    renderTracker() {
        const content = this.elements.content;
        if (!content) return;

        const totalPedidos = (this.pedidosActivos?.length || 0) + (this.pedidosHistorial?.length || 0);

        if (totalPedidos === 0) {
            content.innerHTML = this.renderEmpty();
            this.actualizarColorTarjeta();
            return;
        }

        let html = '';
        html += this.renderActivos();
        html += this.renderHistorial();
        content.innerHTML = html;

        this.attachEventListeners();
        this.actualizarColorTarjeta();
    }

    actualizarColorTarjeta() {
        const card = this.elements.card;
        const title = this.elements.title;
        if (!card) return;

        card.classList.remove('estado-completado', 'estado-recibido', 'estado-entregado', 'todos-completados');

        const todosCompletados = this.todosLosPedidos.every(p => 
            p.estado === 'completado' || p.estado === 'recibido' || p.estado === 'entregado'
        );

        const hayActivos = this.pedidosActivos && this.pedidosActivos.length > 0;

        if (todosCompletados && !hayActivos && this.todosLosPedidos.length > 0) {
            card.classList.add('todos-completados');
            card.classList.add('estado-completado');
            
            const header = card.querySelector('.tracker-header');
            if (header) {
                if (title) {
                    const comerciante = this._ultimoComerciante || 'el comerciante';
                    title.textContent = `✅ Recibido de ${comerciante}`;
                }
                header.style.background = 'linear-gradient(135deg, #059669, #047857)';
            }
        } else {
            const header = card.querySelector('.tracker-header');
            if (header) {
                if (title) {
                    const activosCount = this.pedidosActivos?.length || 0;
                    if (activosCount > 0) {
                        title.textContent = `📦 Seguimiento (${activosCount} activos)`;
                    } else {
                        title.textContent = '📦 Seguimiento de pedidos';
                    }
                }
                header.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            }
        }
    }

    renderEmpty() {
        return `
            <div class="tracker-empty" style="text-align:center;padding:30px 10px;color:#6b7280;">
                <div style="font-size:3rem;margin-bottom:12px;">📭</div>
                <p style="font-weight:600;font-size:1rem;">No tienes pedidos</p>
                <p style="font-size:0.9rem;color:#94a3b8;">Cuando hagas tu primera compra, aparecerá aquí</p>
            </div>
        `;
    }

    renderActivos() {
        if (!this.pedidosActivos || this.pedidosActivos.length === 0) return '';

        let html = `
            <div style="margin-bottom:12px;">
                <div style="font-weight:700;font-size:0.85rem;color:#0f172a;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;animation:pulse 1.5s infinite;"></span>
                    En curso (${this.pedidosActivos.length})
                </div>
            </div>
        `;

        html += this.pedidosActivos.map(pedido => this.renderPedidoCard(pedido, true)).join('');
        return html;
    }

    renderHistorial() {
        if (!this.pedidosHistorial || this.pedidosHistorial.length === 0) return '';

        let html = `
            <div style="margin:16px 0 12px;border-top:2px solid #e5e7eb;padding-top:16px;">
                <div style="font-weight:700;font-size:0.85rem;color:#6b7280;display:flex;align-items:center;gap:8px;">
                    📋 Historial (${this.pedidosHistorial.length})
                </div>
            </div>
        `;

        html += this.pedidosHistorial.map(pedido => this.renderPedidoCard(pedido, false)).join('');
        return html;
    }

    attachEventListeners() {
        const content = this.elements.content;
        if (!content) return;

        content.querySelectorAll('.btn-ver-detalle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const pedido = this.todosLosPedidos?.find(p => p.id === id);
                if (pedido) this.abrirDetalle(pedido);
            });
        });

        content.querySelectorAll('.tracker-pedido').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                const pedido = this.todosLosPedidos?.find(p => p.id === id);
                if (pedido) this.abrirDetalle(pedido);
            });
        });
    }

    // ============================================================
    // 🎴 RENDERIZAR TARJETA DE PEDIDO
    // ============================================================

    renderPedidoCard(pedido, esActivo) {
        const estado = pedido.estado || 'pendiente';
        const info = getEstadoInfo(estado);
        const progreso = getProgreso(estado);
        const total = Number(pedido.total || 0).toLocaleString('es-CO');
        const id = (pedido.id || '').slice(-6).toUpperCase();
        const fecha = pedido.createdAt?.toDate?.() || new Date(pedido.createdAt || Date.now());
        const fechaStr = fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        const esCompletado = estado === 'entregado' || estado === 'completado' || estado === 'recibido';
        const esCancelado = estado === 'cancelado' || estado === 'rechazado';

        const items = pedido.items || [];
        const nombresProductos = items.map(item => {
            const nombre = item.nombre || item.title || item.productoId || 'Producto';
            const qty = Number(item.qty || item.cantidad || 1);
            return `${nombre} × ${qty}`;
        }).join(', ');

        const nombreComercio = pedido.comercianteNombre || pedido.tiendaNombre || pedido.comercioNombre || 'Comercio';

        let estadoBadge = `
            <span style="
                background: ${info.color};
                color: white;
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 0.7rem;
                font-weight: 600;
                white-space: nowrap;
            ">${info.icon} ${info.label}</span>
        `;

        let progresoHTML = '';
        if (esCompletado) {
            progresoHTML = `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <span style="color:#10b981;font-weight:700;">✅ Recibido de ${nombreComercio}</span>
                    <span style="font-size:0.7rem;color:#6b7280;">${fechaStr}</span>
                </div>
            `;
        } else if (esCancelado) {
            progresoHTML = `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <span style="color:#ef4444;font-weight:700;">❌ Cancelado</span>
                    <span style="font-size:0.7rem;color:#6b7280;">${fechaStr}</span>
                </div>
            `;
        } else {
            progresoHTML = `
                <div style="margin:8px 0;">
                    <div style="height:6px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
                        <div style="height:100%;width:${progreso}%;background:${info.color};border-radius:999px;transition:width 0.8s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:#6b7280;margin-top:4px;">
                        <span>${progreso}%</span>
                        <span>${estado === 'entregado' || estado === 'completado' ? '✅ Completado' : 'En curso...'}</span>
                    </div>
                </div>
            `;
        }

        const cardStyle = esActivo ? `
            background: #f8fafc;
            border: 2px solid ${info.color}25;
        ` : `
            background: #f8fafc;
            border: 1px solid #e5e7eb;
            opacity: 0.85;
        `;

        const completadoStyle = esCompletado ? `
            background: #d1fae5 !important;
            border: 2px solid #10b981 !important;
        ` : '';

        return `
            <div class="tracker-pedido" data-id="${pedido.id}" style="
                ${cardStyle}
                ${completadoStyle}
                border-radius: 16px;
                padding: 16px;
                margin-bottom: 12px;
                cursor: pointer;
                transition: all 0.3s ease;
            ">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="font-weight:700;font-size:0.95rem;color:#0f172a;">#${id}</span>
                        <span style="font-size:0.75rem;color:#6b7280;">${fechaStr} ${horaStr}</span>
                    </div>
                    ${estadoBadge}
                </div>

                <div style="display:flex;justify-content:space-between;font-size:0.9rem;">
                    <span style="color:#475569;">🏪 ${nombreComercio}</span>
                    <span style="font-weight:700;color:#10b981;">$${total}</span>
                </div>

                ${nombresProductos ? `
                    <div style="font-size:0.8rem;color:#6b7280;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        🛒 ${nombresProductos}
                    </div>
                ` : ''}

                ${esCompletado ? `
                    <div style="margin-top:6px;font-size:0.8rem;color:#065f46;background:rgba(16,185,129,0.15);padding:4px 12px;border-radius:8px;display:inline-block;">
                        ✅ Recibido de ${nombreComercio}
                    </div>
                ` : ''}

                ${progresoHTML}

                <button class="btn-ver-detalle" data-id="${pedido.id}" style="
                    width: 100%;
                    margin-top: 8px;
                    padding: 8px;
                    border: none;
                    border-radius: 10px;
                    background: ${esCompletado ? '#10b981' : info.color + '25'};
                    color: ${esCompletado ? 'white' : info.color};
                    font-weight: 600;
                    font-size: 0.85rem;
                    cursor: pointer;
                    transition: all 0.2s ease;
                ">${esCompletado ? '✅ Ver detalle' : 'Ver detalle →'}</button>
            </div>
        `;
    }

    // ============================================================
    // 📋 ABRIR DETALLE DEL PEDIDO (MODAL CON CHAT INTEGRADO)
    // ============================================================

    async abrirDetalle(pedido) {
        if (!pedido) return;

        this.cerrarDetalleModal();

        let tiendaData = {};
        let tiendaNombre = pedido.tiendaNombre || 'Tienda';
        let tiendaDireccion = 'No especificada';
        let tiendaTelefono = 'No especificado';
        let tiendaLogo = '';
        let tiendaHorario = '';
        let tiendaCalificacion = 0;
        let tiendaDomicilio = { activo: false };
        let tiendaActivo = true;

        if (pedido.tiendaId) {
            try {
                const tiendaRef = doc(db, 'tiendas', pedido.tiendaId);
                const tiendaSnap = await getDoc(tiendaRef);
                if (tiendaSnap.exists()) {
                    tiendaData = tiendaSnap.data();
                    tiendaNombre = tiendaData.nombre || tiendaNombre;
                    tiendaDireccion = tiendaData.direccion || tiendaDireccion;
                    tiendaTelefono = tiendaData.telefono || tiendaTelefono;
                    tiendaLogo = tiendaData.logoUrl || tiendaData.imgUrl || '';
                    tiendaHorario = tiendaData.horario || '';
                    tiendaCalificacion = tiendaData.rating || 0;
                    tiendaDomicilio = tiendaData.domicilio || { activo: false };
                    tiendaActivo = tiendaData.activo !== false;
                }
            } catch (e) {
                console.warn('Error obteniendo datos de la tienda:', e);
            }
        }

        const nombreComercio = pedido.comercianteNombre || pedido.tiendaNombre || pedido.comercioNombre || tiendaNombre || 'Comercio';

        const modal = document.createElement('div');
        modal.id = 'pedido-detalle-modal-unificado';
        modal.dataset.pedidoId = pedido.id;
        this._pedidoModalActual = pedido.id;
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(8px);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
        `;

        const estado = pedido.estado || 'pendiente';
        const info = getEstadoInfo(estado);
        const progreso = getProgreso(estado);
        const total = Number(pedido.total || 0).toLocaleString('es-CO');
        const id = (pedido.id || '').slice(-6).toUpperCase();
        const fecha = pedido.createdAt?.toDate?.() || new Date(pedido.createdAt || Date.now());
        const fechaStr = fecha.toLocaleString('es-CO', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const items = pedido.items || [];
        let subtotal = 0;
        const itemsConNombres = items.map(item => {
            const precio = Number(item.unitPrice || item.precio || item.price || 0);
            const cantidad = Number(item.qty || item.cantidad || 1);
            const nombre = item.nombre || item.title || item.productoId || 'Producto';
            subtotal += precio * cantidad;
            return { ...item, nombre, precio, cantidad, subtotal: precio * cantidad };
        });

        const envio = Number(pedido.envio || 0);
        const servicio = Number(pedido.servicio || 0);
        const totalNumerico = Number(pedido.total || subtotal + envio + servicio);
        const metodoPago = pedido.metodoPago || pedido.paymentMethod || 'Efectivo';

        const itemsHTML = itemsConNombres.map(item => {
            const nombre = item.nombre || item.title || item.productoId || 'Producto';
            const precio = Number(item.unitPrice || item.precio || item.price || 0);
            const qty = Number(item.qty || item.cantidad || 1);
            const subtotalItem = precio * qty;
            return `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
                    <span>${nombre} × ${qty}</span>
                    <span style="font-weight:600;">$${subtotalItem.toLocaleString('es-CO')}</span>
                </div>
            `;
        }).join('');

        const timelineHTML = ESTADOS_ORDEN.map((est, idx) => {
            const estInfo = getEstadoInfo(est);
            const isActive = ESTADOS_ORDEN.indexOf(estado) >= idx;
            const isCurrent = est === estado;
            return `
                <div style="display:flex;align-items:center;gap:12px;${idx > 0 ? 'margin-top:4px;' : ''}">
                    <div style="
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        background: ${isActive ? estInfo.color : '#e5e7eb'};
                        color: white;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 0.9rem;
                        flex-shrink: 0;
                    ">${isActive ? '✓' : idx + 1}</div>
                    <div style="flex:1;">
                        <div style="font-weight:${isActive ? '600' : '400'};color:${isActive ? '#0f172a' : '#94a3b8'};">
                            ${estInfo.label}
                        </div>
                        ${isCurrent ? '<span style="font-size:0.7rem;color:#10b981;">● Actual</span>' : ''}
                    </div>
                </div>
            `;
        }).join('');

        const user = auth.currentUser;
        const esCliente = user && (pedido.clienteId === user.uid || pedido.uid === user.uid);
        const esComerciante = user && (pedido.comercianteId === user.uid || pedido.tiendaId === user.uid);

        let botonesAccion = '';
        if (esComerciante && estado === 'pendiente') {
            botonesAccion = `
                <button onclick="window.cambiarEstadoPedido('${pedido.id}','aceptado')" style="flex:1;padding:12px;border:none;border-radius:12px;background:#10b981;color:white;font-weight:600;cursor:pointer;">✅ Aceptar</button>
                <button onclick="window.cambiarEstadoPedido('${pedido.id}','rechazado')" style="flex:1;padding:12px;border:none;border-radius:12px;background:#ef4444;color:white;font-weight:600;cursor:pointer;">❌ Rechazar</button>
            `;
        } else if (esComerciante && (estado === 'aceptado' || estado === 'preparando' || estado === 'en_preparacion')) {
            botonesAccion = `
                <button onclick="window.cambiarEstadoPedido('${pedido.id}','en_camino')" style="flex:1;padding:12px;border:none;border-radius:12px;background:#3b82f6;color:white;font-weight:600;cursor:pointer;">🚚 Enviar</button>
                <button onclick="window.cambiarEstadoPedido('${pedido.id}','cancelado')" style="flex:1;padding:12px;border:none;border-radius:12px;background:#ef4444;color:white;font-weight:600;cursor:pointer;">❌ Cancelar</button>
            `;
        } else if (esCliente && (estado === 'en_camino' || estado === 'listo')) {
            botonesAccion = `
                <button onclick="window.cambiarEstadoPedido('${pedido.id}','recibido')" style="flex:1;padding:12px;border:none;border-radius:12px;background:#10b981;color:white;font-weight:600;cursor:pointer;">📦 Confirmar recibido</button>
            `;
        } else if (estado === 'recibido' || estado === 'entregado' || estado === 'completado') {
            botonesAccion = `
                <div style="flex:1;padding:12px;border-radius:12px;background:#d1fae5;color:#065f46;text-align:center;font-weight:600;">✅ Pedido completado con ${nombreComercio}</div>
            `;
        } else if (estado === 'cancelado' || estado === 'rechazado') {
            botonesAccion = `
                <div style="flex:1;padding:12px;border-radius:12px;background:#fee2e2;color:#991b1b;text-align:center;font-weight:600;">❌ Pedido cancelado</div>
            `;
        }

        modal.innerHTML = `
            <div style="
                background: white;
                border-radius: 24px;
                max-width: 520px;
                width: 95%;
                max-height: 95vh;
                overflow-y: auto;
                padding: 24px;
                position: relative;
                animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            ">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #f1f5f9;">
                    <div>
                        <div style="font-size:1.2rem;font-weight:700;color:#0f172a;">
                            📦 Pedido #${id}
                        </div>
                        <div style="font-size:0.85rem;color:#6b7280;">${fechaStr}</div>
                    </div>
                    <button onclick="window.cerrarDetalleModalUnificado()" style="
                        background: #f1f5f9;
                        border: none;
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        font-size: 1.2rem;
                        cursor: pointer;
                        transition: all 0.2s ease;
                    ">✕</button>
                </div>

                <div style="
                    background: ${info.color}15;
                    border: 2px solid ${info.color}30;
                    border-radius: 16px;
                    padding: 16px;
                    margin-bottom: 16px;
                    display:flex;
                    align-items:center;
                    gap:12px;
                ">
                    <span style="font-size:2rem;">${info.icon}</span>
                    <div>
                        <div style="font-weight:700;font-size:1.1rem;color:${info.color};">${info.label}</div>
                        <div style="font-size:0.85rem;color:#6b7280;">${progreso}% completado</div>
                    </div>
                </div>

                <div style="margin-bottom:16px;">
                    <div style="height:6px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
                        <div style="height:100%;width:${progreso}%;background:${info.color};border-radius:999px;transition:width 0.8s ease;"></div>
                    </div>
                </div>

                <div style="background:#f8fafc;border-radius:16px;padding:16px;margin-bottom:16px;">
                    <div style="font-weight:600;margin-bottom:8px;">📊 Progreso</div>
                    ${timelineHTML}
                </div>

                <div style="
                    background: #f8fafc;
                    border-radius: 16px;
                    padding: 16px;
                    margin-bottom: 16px;
                    border: 1px solid #e5e7eb;
                ">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;border-bottom:1px solid #e5e7eb;padding-bottom:10px;">
                        ${tiendaLogo ? `
                            <img src="${tiendaLogo}" alt="Logo" style="
                                width: 48px;
                                height: 48px;
                                border-radius: 12px;
                                object-fit: cover;
                                border: 2px solid #10b981;
                                background: #f1f5f9;
                            ">
                        ` : `
                            <div style="
                                width: 48px;
                                height: 48px;
                                border-radius: 12px;
                                background: #d1fae5;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 1.5rem;
                                color: #10b981;
                            ">🏪</div>
                        `}
                        <div style="flex:1;">
                            <div style="font-weight:700;font-size:1rem;color:#0f172a;">${tiendaNombre}</div>
                            <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#6b7280;">
                                ${tiendaActivo ? '🟢 Abierto' : '🔴 Cerrado'}
                                ${tiendaCalificacion > 0 ? `· ⭐ ${tiendaCalificacion.toFixed(1)}` : ''}
                            </div>
                        </div>
                    </div>

                    ${tiendaDireccion && tiendaDireccion !== 'No especificada' ? `
                        <div style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#334155;margin-bottom:4px;">
                            <span style="font-size:1rem;">📍</span>
                            <span>${tiendaDireccion}</span>
                        </div>
                    ` : ''}

                    ${tiendaTelefono && tiendaTelefono !== 'No especificado' ? `
                        <div style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#334155;margin-bottom:4px;">
                            <span style="font-size:1rem;">📞</span>
                            <span>${tiendaTelefono}</span>
                        </div>
                    ` : ''}

                    ${tiendaHorario ? `
                        <div style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#334155;margin-bottom:4px;">
                            <span style="font-size:1rem;">🕒</span>
                            <span>${tiendaHorario}</span>
                        </div>
                    ` : ''}

                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;">
                        <div style="display:flex;justify-content:space-between;font-size:0.9rem;">
                            <span style="color:#64748b;">📦 Subtotal</span>
                            <span>$${subtotal.toLocaleString('es-CO')}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:0.9rem;">
                            <span style="color:#64748b;">🚚 Envío</span>
                            <span>${envio === 0 ? 'GRATIS' : `$${envio.toLocaleString('es-CO')}`}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:0.9rem;">
                            <span style="color:#64748b;">⚡ Servicio</span>
                            <span>$${servicio.toLocaleString('es-CO')}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;margin-top:4px;border-top:2px solid #e5e7eb;padding-top:8px;">
                            <span>💰 Total</span>
                            <span style="color:#10b981;">$${totalNumerico.toLocaleString('es-CO')}</span>
                        </div>
                        ${metodoPago ? `
                            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#64748b;margin-top:4px;">
                                <span>💳 Pago</span>
                                <span>${metodoPago}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>

                ${itemsHTML ? `
                    <div style="background:#f8fafc;border-radius:16px;padding:16px;margin-bottom:16px;">
                        <div style="font-weight:600;margin-bottom:8px;">🛒 Productos</div>
                        ${itemsHTML}
                        <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:2px solid #e5e7eb;font-weight:700;">
                            <span>Total</span>
                            <span style="color:#10b981;">$${totalNumerico.toLocaleString('es-CO')}</span>
                        </div>
                    </div>
                ` : ''}

                <div style="border-top:2px solid #e5e7eb;padding-top:16px;margin-top:8px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                        <span style="font-size:1.2rem;">💬</span>
                        <span style="font-weight:600;font-size:0.95rem;color:#1f2937;">Conversación</span>
                        <span id="chat-estado-modal" style="font-size:0.65rem;background:#dbeafe;color:#1e40af;padding:2px 12px;border-radius:12px;font-weight:500;">Activo</span>
                    </div>

                    <div id="mensajes-rapidos-modal" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
                        <button onclick="window.enviarMensajeRapidoUnificado('¿Cuánto falta?')" style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:16px;background:#f9fafb;font-size:0.7rem;cursor:pointer;transition:all 0.2s;color:#374151;">⏱️ ¿Cuánto falta?</button>
                        <button onclick="window.enviarMensajeRapidoUnificado('¿Ya salió?')" style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:16px;background:#f9fafb;font-size:0.7rem;cursor:pointer;transition:all 0.2s;color:#374151;">🚗 ¿Ya salió?</button>
                        <button onclick="window.enviarMensajeRapidoUnificado('Estoy en la portería')" style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:16px;background:#f9fafb;font-size:0.7rem;cursor:pointer;transition:all 0.2s;color:#374151;">🏠 Estoy en la portería</button>
                        <button onclick="window.enviarMensajeRapidoUnificado('¿Puedes llamarme?')" style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:16px;background:#f9fafb;font-size:0.7rem;cursor:pointer;transition:all 0.2s;color:#374151;">📞 ¿Puedes llamarme?</button>
                        <button onclick="window.enviarMensajeRapidoUnificado('Gracias')" style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:16px;background:#f9fafb;font-size:0.7rem;cursor:pointer;transition:all 0.2s;color:#374151;">🙏 Gracias</button>
                    </div>

                    <div id="mensajes-detalle-modal" style="max-height:200px;overflow-y:auto;background:#f9fafb;border-radius:12px;padding:12px;margin-bottom:10px;border:1px solid #e5e7eb;">
                        <div style="text-align:center;padding:16px;color:#9ca3af;">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p style="font-size:0.85rem;">Cargando mensajes...</p>
                        </div>
                    </div>

                    <div style="display:flex;gap:10px;align-items:center;">
                        <input id="input-mensaje-modal-unificado" type="text" placeholder="Escribe un mensaje..." 
                               style="flex:1;padding:10px 16px;border:2px solid #e5e7eb;border-radius:24px;font-size:0.9rem;outline:none;transition:border-color 0.2s;background:white;"
                               onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e5e7eb'"/>
                        <button id="btn-enviar-modal-unificado" onclick="window.enviarMensajeUnificado()" 
                                style="background:#3b82f6;color:white;border:none;border-radius:50%;width:44px;height:44px;font-size:1.2rem;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            📤
                        </button>
                    </div>
                </div>

                ${botonesAccion ? `
                    <div style="display:flex;gap:8px;margin-top:16px;">
                        ${botonesAccion}
                    </div>
                ` : ''}

                <button onclick="window.cerrarDetalleModalUnificado()" style="
                    width:100%;
                    margin-top:12px;
                    padding:12px;
                    border:1px solid #e5e7eb;
                    border-radius:12px;
                    background:white;
                    color:#0f172a;
                    font-weight:600;
                    cursor:pointer;
                    transition:all 0.2s ease;
                ">
                    Cerrar
                </button>
            </div>
        `;

        document.body.appendChild(modal);
        this.modalActual = modal;

        this.iniciarChatEnModal(pedido.id);
    }

    // ============================================================
    // 💬 INICIAR CHAT EN MODAL
    // ============================================================

    iniciarChatEnModal(pedidoId) {
        if (this.modalChatUnsubscribe) {
            this.modalChatUnsubscribe();
            this.modalChatUnsubscribe = null;
        }

        const container = document.getElementById('mensajes-detalle-modal');
        const input = document.getElementById('input-mensaje-modal-unificado');
        const btn = document.getElementById('btn-enviar-modal-unificado');
        const estadoBadge = document.getElementById('chat-estado-modal');

        if (!container || !input) return;

        const pedido = this.todosLosPedidos?.find(p => p.id === pedidoId);
        if (!pedido) return;

        const estado = pedido.estado || 'pendiente';

        if (estado === 'cancelado' || estado === 'rechazado') {
            input.disabled = true;
            if (btn) btn.disabled = true;
            input.placeholder = '❌ Pedido cancelado';
            if (estadoBadge) {
                estadoBadge.textContent = 'Cancelado';
                estadoBadge.style.background = '#fee2e2';
                estadoBadge.style.color = '#991b1b';
            }
            container.innerHTML = `
                <div style="text-align:center;padding:20px;color:#991b1b;">
                    <span style="font-size:1.5rem;opacity:0.5;display:block;margin-bottom:8px;">🚫</span>
                    <p style="font-size:0.85rem;">Este pedido fue cancelado</p>
                </div>
            `;
            return;
        }

        if (estado === 'recibido' || estado === 'entregado' || estado === 'completado') {
            input.disabled = true;
            if (btn) btn.disabled = true;
            input.placeholder = '📦 Pedido completado - Solo lectura';
            if (estadoBadge) {
                estadoBadge.textContent = 'Completado';
                estadoBadge.style.background = '#d1fae5';
                estadoBadge.style.color = '#065f46';
            }
        }

        const messagesRef = collection(db, 'pedidos', pedidoId, 'mensajes');
        const q = query(messagesRef, orderBy('creadoEn', 'asc'), limit(200));

        this.modalChatUnsubscribe = onSnapshot(q, (snapshot) => {
            if (!container) return;

            if (snapshot.empty) {
                container.innerHTML = `
                    <div style="text-align:center;padding:20px;color:#9ca3af;">
                        <span style="font-size:1.5rem;opacity:0.5;display:block;margin-bottom:8px;">💬</span>
                        <p style="font-size:0.85rem;">No hay mensajes aún</p>
                        <p style="font-size:0.75rem;color:#d1d5db;">Envía un mensaje para comenzar</p>
                    </div>
                `;
                return;
            }

            const user = auth.currentUser;
            container.innerHTML = '';

            snapshot.forEach((doc) => {
                const data = doc.data();
                const esMio = data.uid === user?.uid;

                const mensajeDiv = document.createElement('div');
                mensajeDiv.className = `mensaje-chat-modal ${esMio ? 'enviado' : 'recibido'}`;

                let nombreRemitente = data.nombre || 'Usuario';
                if (esMio) nombreRemitente = 'Tú';

                mensajeDiv.innerHTML = `
                    <div class="burbuja">
                        <div class="remitente">${nombreRemitente}</div>
                        <div class="texto">${this.escapeHTML(data.texto || data.mensaje || '')}</div>
                        <div class="hora">${this.formatearHora(data.creadoEn)}</div>
                    </div>
                `;

                container.appendChild(mensajeDiv);
            });

            container.scrollTop = container.scrollHeight;

            if (user) {
                this.marcarMensajesLeidos(pedidoId, user.uid);
            }

        }, (error) => {
            console.error('Error escuchando mensajes:', error);
            container.innerHTML = `
                <div style="text-align:center;padding:20px;color:#ef4444;">
                    <span style="font-size:1.5rem;opacity:0.5;display:block;margin-bottom:8px;">⚠️</span>
                    <p style="font-size:0.85rem;">Error al cargar mensajes</p>
                </div>
            `;
        });
    }

    // ============================================================
    // 📤 ENVIAR MENSAJE
    // ============================================================

    async enviarMensaje(pedidoId, texto) {
        if (!texto || !pedidoId) return;

        const user = auth.currentUser;
        if (!user) {
            alert('Debes iniciar sesión para enviar mensajes');
            return;
        }

        const input = document.getElementById('input-mensaje-modal-unificado');
        if (input && input.disabled) {
            alert('No puedes enviar mensajes en este pedido');
            return;
        }

        try {
            const messagesRef = collection(db, 'pedidos', pedidoId, 'mensajes');
            await addDoc(messagesRef, {
                texto: texto,
                uid: user.uid,
                nombre: user.displayName || user.email || 'Usuario',
                creadoEn: serverTimestamp()
            });

            if (input) input.value = '';

            await updateDoc(doc(db, 'pedidos', pedidoId), {
                lastMsg: texto.slice(0, 120),
                lastTs: serverTimestamp()
            });

        } catch (error) {
            console.error('Error enviando mensaje:', error);
            alert('Error al enviar el mensaje');
        }
    }

    // ============================================================
    // ✅ MARCAR MENSAJES COMO LEÍDOS
    // ============================================================

    async marcarMensajesLeidos(pedidoId, uid) {
        try {
            const msgsRef = collection(db, 'pedidos', pedidoId, 'mensajes');
            const q = query(msgsRef, where('uid', '!=', uid), where('leido', '==', false));
            const snapshot = await getDocs(q);

            const promises = [];
            snapshot.forEach((doc) => {
                promises.push(updateDoc(doc.ref, { leido: true }));
            });

            await Promise.all(promises);
        } catch (error) {
            console.warn('Error marcando mensajes como leídos:', error);
        }
    }

    // ============================================================
    // 🚪 CERRAR MODAL
    // ============================================================

    cerrarDetalleModal() {
        if (this.modalChatUnsubscribe) {
            this.modalChatUnsubscribe();
            this.modalChatUnsubscribe = null;
        }

        if (this.modalActual) {
            this.modalActual.remove();
            this.modalActual = null;
        }

        this._pedidoModalActual = null;

        const oldModal = document.getElementById('pedido-detalle-modal-unificado');
        if (oldModal) oldModal.remove();
    }

    // ============================================================
    // 🛠️ UTILIDADES
    // ============================================================

    escapeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatearHora(timestamp) {
        try {
            if (!timestamp) return '';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }

    // ============================================================
    // 🔔 MOSTRAR/OCULTAR TRACKER
    // ============================================================

    showTracker() {
        const card = this.elements.card;
        const floatBtn = this.elements.floatBtn;
        if (card) {
            card.style.display = 'block';
            card.style.animation = 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            this.trackerVisible = true;
            this.renderTracker();
        }
        if (floatBtn) floatBtn.style.display = 'none';
    }

    hideTracker() {
        const card = this.elements.card;
        const floatBtn = this.elements.floatBtn;
        if (card) {
            card.style.display = 'none';
            this.trackerVisible = false;
        }
        if (floatBtn) {
            const badge = this.pedidosActivos.length;
            floatBtn.style.display = badge > 0 ? 'flex' : 'none';
            if (this.elements.floatBadge) {
                this.elements.floatBadge.textContent = badge;
                this.elements.floatBadge.style.display = badge > 0 ? 'flex' : 'none';
            }
        }
    }

    toggleMinimize() {
        const body = this.elements.body;
        if (!body) return;
        const isCollapsed = body.style.maxHeight === '0px';
        body.style.maxHeight = isCollapsed ? '500px' : '0px';
        body.style.overflow = isCollapsed ? 'auto' : 'hidden';
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.textContent = isCollapsed ? '−' : '+';
        }
    }

    updateBadge(count) {
        if (this.elements.floatBadge) {
            this.elements.floatBadge.textContent = count || '0';
            this.elements.floatBadge.style.display = count > 0 ? 'flex' : 'none';
        }

        if (this.elements.headerBadge) {
            this.elements.headerBadge.textContent = count || '0';
            this.elements.headerBadge.style.display = count > 0 ? 'inline-flex' : 'none';
            if (count > 0) {
                this.elements.headerBadge.style.animation = 'badgePulse 1.5s infinite';
            } else {
                this.elements.headerBadge.style.animation = 'none';
            }
        }
    }
}

// ================================================================
// 🚀 INICIALIZACIÓN GLOBAL
// ================================================================

let trackerInstance = null;

function initPedidoTracker() {
    if (!trackerInstance) {
        trackerInstance = new PedidoTracker();
        window.pedidoTracker = trackerInstance;
        console.log('🚀 PedidoTracker v8.3 - Oculto cuando no hay pedidos activos');
    }
    return trackerInstance;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPedidoTracker);
} else {
    initPedidoTracker();
}

// ================================================================
// 🎯 FUNCIONES GLOBALES
// ================================================================

window.abrirTrackerPedidos = function() {
    console.log('📦 Abriendo tracker de pedidos...');
    if (window.pedidoTracker) {
        window.pedidoTracker.showTracker();
        if (typeof window.pedidoTracker.refreshPedidos === 'function') {
            window.pedidoTracker.refreshPedidos();
        }
    } else {
        console.warn('⚠️ PedidoTracker no inicializado');
        initPedidoTracker();
        setTimeout(() => {
            if (window.pedidoTracker) {
                window.pedidoTracker.showTracker();
            }
        }, 300);
    }
};

window.cerrarTrackerPedidos = function() {
    if (window.pedidoTracker) {
        window.pedidoTracker.hideTracker();
    }
};

window.cerrarDetalleModalUnificado = function() {
    if (window.pedidoTracker) {
        window.pedidoTracker.cerrarDetalleModal();
    }
};

window.enviarMensajeUnificado = async function() {
    const input = document.getElementById('input-mensaje-modal-unificado');
    const texto = input?.value?.trim();
    if (!texto) return;

    const modal = document.getElementById('pedido-detalle-modal-unificado');
    if (!modal) return;

    const pedidoId = modal.dataset?.pedidoId || window._pedidoModalActual;
    if (!pedidoId) {
        console.warn('No hay pedido activo');
        return;
    }

    if (window.pedidoTracker) {
        await window.pedidoTracker.enviarMensaje(pedidoId, texto);
    }
};

window.enviarMensajeRapidoUnificado = function(texto) {
    const input = document.getElementById('input-mensaje-modal-unificado');
    if (input) {
        input.value = texto;
        window.enviarMensajeUnificado();
    }
};

window.cambiarEstadoPedido = async function(pedidoId, nuevoEstado) {
    const estadoLabels = {
        'pendiente': 'Pendiente',
        'aceptado': 'Aceptado',
        'preparando': 'En preparación',
        'en_preparacion': 'En preparación',
        'en_camino': 'En camino',
        'listo': 'Listo para recoger',
        'recibido': 'Recibido',
        'entregado': 'Entregado',
        'completado': 'Completado',
        'rechazado': 'Rechazado',
        'cancelado': 'Cancelado'
    };

    const confirmMsg = `¿Estás seguro de cambiar a "${estadoLabels[nuevoEstado] || nuevoEstado}"?`;
    if (!confirm(confirmMsg)) return;

    try {
        const user = auth.currentUser;
        if (!user) {
            alert('Debes iniciar sesión');
            return;
        }

        const pedidoRef = doc(db, 'pedidos', pedidoId);
        const pedidoSnap = await getDoc(pedidoRef);
        
        if (!pedidoSnap.exists()) {
            alert('Pedido no encontrado');
            return;
        }
        
        const pedido = pedidoSnap.data();
        const uid = user.uid;
        
        const esComerciante = pedido.comercianteId === uid || pedido.tiendaId === uid;
        const esCliente = pedido.clienteId === uid || pedido.uid === uid;
        
        const estadosComerciante = ['aceptado', 'rechazado', 'en_camino', 'cancelado'];
        const estadosCliente = ['recibido'];
        
        let permitido = false;
        if (esComerciante && estadosComerciante.includes(nuevoEstado)) {
            permitido = true;
        } else if (esCliente && estadosCliente.includes(nuevoEstado)) {
            permitido = true;
        }
        
        if (!permitido) {
            alert(`❌ No tienes permiso para cambiar a "${estadoLabels[nuevoEstado]}"`);
            return;
        }
        
        const transicionesValidas = {
            'pendiente': ['aceptado', 'rechazado'],
            'aceptado': ['en_camino', 'rechazado', 'preparando', 'en_preparacion'],
            'preparando': ['en_camino', 'rechazado'],
            'en_preparacion': ['en_camino', 'rechazado'],
            'en_camino': ['recibido', 'rechazado'],
            'listo': ['recibido', 'rechazado'],
            'recibido': [],
            'entregado': [],
            'completado': [],
            'rechazado': [],
            'cancelado': []
        };
        
        const estadoActual = pedido.estado || 'pendiente';
        if (!transicionesValidas[estadoActual]?.includes(nuevoEstado)) {
            alert(`❌ No puedes cambiar de "${estadoLabels[estadoActual]}" a "${estadoLabels[nuevoEstado]}"`);
            return;
        }

        await updateDoc(pedidoRef, {
            estado: nuevoEstado,
            [`historial.${nuevoEstado}`]: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        console.log('✅ Estado actualizado a:', nuevoEstado);
        alert(`✅ Pedido actualizado a "${estadoLabels[nuevoEstado] || nuevoEstado}"`);
        window.cerrarDetalleModalUnificado();
        if (window.pedidoTracker) {
            window.pedidoTracker.refreshPedidos();
        }
        if (window.recargarMisPedidos) {
            window.recargarMisPedidos();
        }

    } catch (error) {
        console.error('❌ Error al actualizar:', error);
        alert('❌ Error al actualizar el pedido: ' + error.message);
    }
};

window.recargarPedidos = function() {
    console.log('🔄 Recargando pedidos...');
    if (window.pedidoTracker) {
        window.pedidoTracker.refreshPedidos();
    }
};

window.forzarRecargaPedidos = window.recargarPedidos;

window.iniciarSeguimientoPedido = function(pedidoId) {
    if (!pedidoId) {
        console.warn('⚠️ No se proporcionó ID de pedido');
        return;
    }
    console.log(`🎯 Iniciando seguimiento del pedido: ${pedidoId}`);
    localStorage.setItem('pedido_activo_id', pedidoId);
    localStorage.setItem('last_pedido_id', pedidoId);
    if (!window.pedidoTracker) {
        initPedidoTracker();
    }
    if (window.pedidoTracker) {
        window.pedidoTracker.showTracker();
        window.pedidoTracker.refreshPedidos();
    }
};

// ================================================================
// 🎨 ESTILOS
// ================================================================

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes slideUp {
        from { opacity: 0; transform: translateY(30px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.5); }
    }
    @keyframes badgePulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.2); }
    }
    #pedido-detalle-modal-unificado {
        animation: fadeIn 0.3s ease;
    }
    .tracker-pedido:hover {
        border-color: #10b981 !important;
        transform: translateX(4px);
        box-shadow: 0 4px 16px rgba(16,185,129,0.1);
    }
    .btn-ver-detalle:hover {
        background: #10b98125 !important;
        transform: scale(1.02);
    }
    .pedidos-badge.pulse {
        animation: badgePulse 1.5s infinite;
    }
    .mensaje-chat-modal {
        display: flex;
        flex-direction: column;
        margin: 6px 0;
    }
    .mensaje-chat-modal.enviado {
        align-items: flex-end;
    }
    .mensaje-chat-modal.recibido {
        align-items: flex-start;
    }
    .mensaje-chat-modal .burbuja {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .mensaje-chat-modal.enviado .burbuja {
        background: #dcfce7;
        border: 1px solid #86efac;
        border-radius: 12px 12px 4px 12px;
    }
    .mensaje-chat-modal.recibido .burbuja {
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 12px 12px 12px 4px;
    }
    .mensaje-chat-modal .remitente {
        font-size: 0.7rem;
        font-weight: 600;
        color: #6b7280;
        margin-bottom: 2px;
    }
    .mensaje-chat-modal .texto {
        font-size: 0.9rem;
        word-break: break-word;
    }
    .mensaje-chat-modal .hora {
        font-size: 0.6rem;
        color: #9ca3af;
        margin-top: 4px;
        text-align: right;
    }

    .tracker-card.estado-completado {
        border: 2px solid #10b981 !important;
        box-shadow: 0 8px 30px rgba(16, 185, 129, 0.3) !important;
        animation: trackerVerde 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
    }

    .tracker-card.estado-completado .tracker-header {
        background: linear-gradient(135deg, #059669, #047857) !important;
    }

    .tracker-pedido.pedido-completado {
        background: #d1fae5 !important;
        border: 2px solid #10b981 !important;
    }

    @keyframes trackerVerde {
        0% {
            background: #fef3c7;
            transform: scale(0.98) translateX(-10px);
            opacity: 0.7;
        }
        50% {
            background: #d1fae5;
            transform: scale(1.02) translateX(5px);
        }
        100% {
            background: linear-gradient(135deg, #ecfdf5, #d1fae5);
            transform: scale(1) translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);


// ================================================================
// 🔥 FORZAR OCULTAR TRACKER AL INICIAR
// ================================================================

function ocultarTrackerSiNoHayActivos() {
    if (window.pedidoTracker) {
        const activos = window.pedidoTracker.pedidosActivos || [];
        const historial = window.pedidoTracker.pedidosHistorial || [];
        
        console.log(`📊 Tracker: ${activos.length} activos, ${historial.length} en historial`);
        
        if (activos.length === 0) {
            // Si hay historial pero no activos, ocultar el tracker
            window.pedidoTracker.hideTracker();
            console.log('🧹 Tracker ocultado (no hay pedidos activos)');
            return true;
        } else {
            console.log(`📦 Mostrando tracker (${activos.length} pedidos activos)`);
            // Asegurar que el tracker se muestre si hay activos
            window.pedidoTracker.showTracker();
            return true;
        }
    }
    return false;
}

// ================================================================
// 🔥 VERIFICACIÓN AUTOMÁTICA - OCULTAR TRACKER CADA 1 SEGUNDO
// ================================================================

function verificarYOcultarTracker() {
    if (!window.pedidoTracker) return;
    
    try {
        const activos = window.pedidoTracker.pedidosActivos || [];
        const card = document.getElementById('tracker-card');
        
        // Si NO hay pedidos activos y el tracker está visible, ocultarlo
        if (activos.length === 0) {
            if (card && card.style.display !== 'none') {
                window.pedidoTracker.hideTracker();
                console.log('🧹 Tracker ocultado ✅ (no hay pedidos activos)');
            }
        } else {
            // Si HAY pedidos activos y el tracker está oculto, mostrarlo
            if (card && card.style.display === 'none') {
                window.pedidoTracker.showTracker();
                console.log(`📦 Mostrando tracker (${activos.length} pedidos activos)`);
            }
        }
    } catch (e) {
        // Silencioso
    }
}

// 🔥 EJECUTAR AL INICIO (varias veces para asegurar)
setTimeout(ocultarTrackerSiNoHayActivos, 100);
setTimeout(ocultarTrackerSiNoHayActivos, 500);
setTimeout(ocultarTrackerSiNoHayActivos, 1000);

// También ejecutar cuando cambien los pedidos
document.addEventListener('pedido:estado:cambiado', function() {
    setTimeout(ocultarTrackerSiNoHayActivos, 500);
});

// También cuando se cree un pedido
document.addEventListener('pedido:creado', function() {
    setTimeout(ocultarTrackerSiNoHayActivos, 1000);
});

// 🔥 EJECUTAR CADA 1 SEGUNDO (más rápido)
const trackerInterval = setInterval(verificarYOcultarTracker, 1000);

// 🔥 AL CAMBIAR DE PESTAÑA
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        setTimeout(verificarYOcultarTracker, 200);
    }
});

// 🔥 AL HACER CLIC EN CUALQUIER PARTE (por si el usuario confirma y vuelve)
document.addEventListener('click', function() {
    setTimeout(verificarYOcultarTracker, 500);
});

// ================================================================
// 🔥 FUNCIÓN PARA LIMPIAR EL INTERVALO (si es necesario)
// ================================================================

window.limpiarTrackerInterval = function() {
    clearInterval(trackerInterval);
    console.log('🧹 Intervalo de tracker limpiado');
};

// Exponer función global para llamar manualmente
window.ocultarTrackerSiNoHayActivos = ocultarTrackerSiNoHayActivos;

console.log('✅ Función ocultarTrackerSiNoHayActivos disponible');
console.log('✅ Verificación automática de tracker activada (cada 1s)');
console.log('📌 El tracker se ocultará al inicio si no hay pedidos activos');

console.log('✅ PedidoTracker v8.3 - Oculto cuando no hay pedidos activos');
console.log('📌 Funciones: abrirTrackerPedidos, cerrarTrackerPedidos, recargarPedidos, iniciarSeguimientoPedido, cambiarEstadoPedido');
console.log('📌 Para limpiar el intervalo: window.limpiarTrackerInterval()');