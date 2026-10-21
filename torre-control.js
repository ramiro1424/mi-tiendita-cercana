/* ============================================================
   TORRE DE CONTROL
   MI TIENDITA CERCANA

   PASO 6: GESTIÓN ADMINISTRATIVA DE PEDIDOS
   PASO 7: GESTIÓN ADMINISTRATIVA DE SERVICIOS
   PASO 8: ACTIVIDAD Y ALERTAS
   PASO 9: CLICK EN TARJETAS + BADGES + DESGLOSE + FILTRO FECHA

   IMPORTANTE:
   - SOLO LECTURA
   - NO MODIFICA PEDIDOS NI SERVICIOS
   - NO MODIFICA FIRESTORE RULES
   - NO INTERFIERE CON CLIENTES NI COMERCIANTES
============================================================ */



import { auth, db } from './public/js/firebase-config.js';
import {
    onAuthStateChanged,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

import {
    collection, getDocs, doc, getDoc, setDoc, serverTimestamp,
    updateDoc, query, where, orderBy, onSnapshot, writeBatch, limit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


/* ============================================================
   CONFIGURACIÓN ADMINISTRATIVA
============================================================ */

const EMAIL_ADMINISTRADOR =
    'carranzaramiro686@gmail.com';


const RUTA_LOGIN_ADMIN =
    './acceso-administrador.html';



/* ============================================================
   VARIABLES GLOBALES
============================================================ */

let pedidosGlobales = [];

let serviciosGlobales = [];

let todosLosUsuarios = [];

// 🆕 Exponer al window para que los módulos nuevos puedan acceder
window.pedidosGlobales = pedidosGlobales;
window.serviciosGlobales = serviciosGlobales;
window.todosLosUsuarios = todosLosUsuarios;



/* ============================================================
   UTILIDADES
============================================================ */

const $ = (id) =>
    document.getElementById(id);



function dinero(valor) {

    const numero =
        Number(valor || 0);

    return numero.toLocaleString(
        'es-CO',
        {
            style: 'currency',
            currency: 'COP',
            maximumFractionDigits: 0
        }
    );
}



function timestampToDate(value) {

    if (!value) {
        return null;
    }


    if (
        typeof value?.toDate ===
        'function'
    ) {

        return value.toDate();
    }


    if (
        value instanceof Date
    ) {

        return value;
    }


    if (
        typeof value ===
        'string'
    ) {

        const fecha =
            new Date(value);


        if (
            !Number.isNaN(
                fecha.getTime()
            )
        ) {

            return fecha;
        }

    }


    if (
        typeof value ===
        'number'
    ) {

        const fecha =
            new Date(value);


        if (
            !Number.isNaN(
                fecha.getTime()
            )
        ) {

            return fecha;
        }

    }


    return null;
}



function esEsteMes(value) {

    const fecha =
        timestampToDate(value);


    if (!fecha) {
        return false;
    }


    const ahora =
        new Date();


    return (
        fecha.getMonth() ===
        ahora.getMonth() &&

        fecha.getFullYear() ===
        ahora.getFullYear()
    );
}



function actualizar(
    id,
    valor
) {

    const elemento =
        $(id);


    if (elemento) {

        elemento.textContent =
            valor;
    }
}



function mostrarEstado(
    mensaje,
    tipo = ''
) {

    const panel =
        $('estado-panel');


    if (!panel) {
        return;
    }


    panel.textContent =
        mensaje;


    panel.className =
        'status-panel';


    if (tipo) {

        panel.classList.add(
            tipo
        );
    }

}



function formatearFecha(fecha) {

    if (!fecha) return '--';

    const d = timestampToDate(fecha);

    if (!d) return '--';

    return d.toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}


/* ============================================================
   ESCAPAR HTML
   Protección para mostrar datos de Firestore
============================================================ */

function escapeHtml(valor) {

    if (
        valor === null ||
        valor === undefined
    ) {

        return '';
    }


    return String(valor)

        .replace(
            /&/g,
            '&amp;'
        )

        .replace(
            /</g,
            '&lt;'
        )

        .replace(
            />/g,
            '&gt;'
        )

        .replace(
            /"/g,
            '&quot;'
        )

        .replace(
            /'/g,
            '&#039;'
        );
}



/* ============================================================
   OBTENER TEXTO DE VARIOS CAMPOS POSIBLES
============================================================ */

function primerValor(
    objeto,
    campos,
    valorDefecto = ''
) {

    for (
        const campo of campos
    ) {

        const valor =
            objeto?.[campo];


        if (
            valor !== undefined &&
            valor !== null &&
            String(valor).trim() !== ''
        ) {

            return valor;
        }

    }


    return valorDefecto;
}



/* ============================================================
   NORMALIZAR ESTADO
============================================================ */

function normalizarEstado(
    valor
) {

    return String(
        valor || ''
    )
        .trim()
        .toLowerCase()
        .replace(
            /_/g,
            ' '
        );
}



function obtenerGrupoEstado(
    valor
) {

    const estado =
        normalizarEstado(
            valor
        );


    if (
        estado === 'pendiente' ||
        estado === 'pendientes' ||
        estado === 'nuevo'
    ) {

        return 'pendiente';
    }


    if (
        estado === 'aceptado' ||
        estado === 'aceptada' ||
        estado === 'en proceso' ||
        estado === 'procesando' ||
        estado === 'en preparacion' ||
        estado === 'preparando'
    ) {

        return 'proceso';
    }


    if (
        estado === 'enviado' ||
        estado === 'enviada'
    ) {

        return 'enviado';
    }


    if (
        estado === 'entregado' ||
        estado === 'entregada' ||
        estado === 'completado' ||
        estado === 'completada' ||
        estado === 'recibido' ||
        estado === 'recibida'
    ) {

        return 'completado';
    }


    if (
        estado === 'cancelado' ||
        estado === 'cancelada'
    ) {

        return 'cancelado';
    }


    return 'otro';
}



/* ============================================================
   TEXTO DEL ESTADO
============================================================ */

function textoEstado(
    valor
) {

    const estado =
        normalizarEstado(
            valor
        );


    if (!estado) {
        return 'Sin estado';
    }


    return estado
        .charAt(0)
        .toUpperCase()
        +
        estado.slice(1);
}



/* ============================================================
   FECHA DE PEDIDO
============================================================ */

function obtenerFechaPedido(
    pedido
) {

    return timestampToDate(

        pedido.createdAt ||

        pedido.creadoEn ||

        pedido.fechaCreacion ||

        pedido.fecha ||

        pedido.updatedAt

    );
}



function fechaCorta(
    fecha
) {

    if (!fecha) {
        return '--';
    }


    return fecha.toLocaleString(
        'es-CO',
        {
            dateStyle: 'short',
            timeStyle: 'short'
        }
    );
}


function formatearFechaHora(fecha) {

    if (!fecha) return '--';

    const d = timestampToDate(fecha);

    if (!d) return '--';

    return d.toLocaleString('es-CO', {
        dateStyle: 'short',
        timeStyle: 'short'
    });
}


/* ============================================================
   CERRAR SESIÓN ADMINISTRATIVA
============================================================ */

$('btn-cerrar-sesion')?.addEventListener('click', async () => {

    console.log('🖱️ CLICK EN CERRAR SESIÓN');

    const confirmar = window.confirm(
        '¿Deseas cerrar la sesión administrativa?'
    );

    if (!confirmar) return;

    const boton = $('btn-cerrar-sesion');

    try {

        boton.disabled = true;
        boton.textContent = '⏳ Cerrando sesión...';

        console.log('🔐 Ejecutando signOut...');

        await signOut(auth);

        console.log('✅ Sesión cerrada correctamente');
        console.log('👤 auth.currentUser:', auth.currentUser);

        sessionStorage.clear();

        window.location.replace('./acceso-administrador.html');

    } catch (error) {

        console.error(
            '❌ Error al cerrar sesión:',
            error
        );

        boton.disabled = false;
        boton.textContent = '🔒 Cerrar sesión';

        alert(
            'No fue posible cerrar la sesión.\n\n' +
            (error?.message || error)
        );
    }
});



function initTabs() {

    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => {

        tab.addEventListener('click', () => {

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(
                content => content.classList.remove('active')
            );

            const tabId = tab.dataset.tab;
            const content = document.getElementById(`tab-${tabId}`);

            if (content) {
                content.classList.add('active');
            }

        });

    });

}


/* ============================================================
   CLIENTES
============================================================ */
async function cargarClientes() {
    const snap = await getDocs(collection(db, 'usuarios'));
    let total = 0;
    let nuevosMes = 0;

    snap.forEach(docSnap => {
        const data = docSnap.data();

        if (data.tipo !== 'cliente') return;

        total++;

        if (esEsteMes(data.createdAt || data.fechaRegistro)) {
            nuevosMes++;
        }
    });

    actualizar('total-clientes', total);
    actualizar('nuevos-clientes', nuevosMes);

    return { total, nuevosMes };
}

/* ============================================================
   COMERCIANTES
============================================================ */
async function cargarComerciantes() {
    const snap = await getDocs(collection(db, 'tiendas'));
    let total = 0;
    let nuevosMes = 0;

    snap.forEach(docSnap => {
        const data = docSnap.data();
        total++;

        if (esEsteMes(data.creadoEn || data.createdAt)) {
            nuevosMes++;
        }
    });

    actualizar('total-comerciantes', total);
    actualizar('nuevos-comerciantes', nuevosMes);

    return { total, nuevosMes };
}



/* ============================================================
   USUARIOS
============================================================ */

async function cargarUsuarios() {

    const snap = await getDocs(
        collection(db, 'usuarios')
    );

    const usuarios = [];

    snap.forEach(docSnap => {

        const data = docSnap.data();

        usuarios.push({
            uid: docSnap.id,
            nombre: data.nombres || data.nombre || 'Sin nombre',
            email: data.email || 'Sin correo',
            tipo: data.tipo || 'usuario',
            estado: data.estado || 'inactivo',
            fechaRegistro: data.fechaRegistro || null
        });
    });

    todosLosUsuarios = usuarios;
    window.todosLosUsuarios = usuarios;

    return usuarios;
}


function renderizarUsuarios(usuarios) {

    const tbody = $('tabla-usuarios');

    if (!tbody) return;

    if (!usuarios.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-text">No se encontraron usuarios.</td>
            </tr>
        `;

        return;
    }

    let html = '';

    usuarios.forEach(user => {

        const estadoClass =
            user.estado === 'activo' ? 'estado-activo' :
            user.estado === 'pendiente' ? 'estado-pendiente' :
            'estado-inactivo';

        const tipoClass =
            user.tipo === 'comerciante' ? 'tipo-comerciante' :
            user.tipo === 'cliente' ? 'tipo-cliente' : '';

        const fecha = formatearFecha(user.fechaRegistro);

        html += `
            <tr>
                <td><strong>${escapeHtml(user.nombre)}</strong></td>
                <td>${escapeHtml(user.email)}</td>
                <td><span class="${tipoClass}">${escapeHtml(user.tipo)}</span></td>
                <td style="font-size: 11px; color: #6b7b8c;">${escapeHtml(user.uid.slice(0, 12))}...</td>
                <td><span class="${estadoClass}">${escapeHtml(user.estado)}</span></td>
                <td style="font-size: 12px; color: #6b7b8c;">${escapeHtml(fecha)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}


function filtrarYBuscarUsuarios() {

    const busqueda = ($('buscar-usuario')?.value || '').toLowerCase().trim();
    const filtro = $('filtro-tipo')?.value || 'todos';

    let filtrados = todosLosUsuarios;

    if (filtro !== 'todos') {
        filtrados = filtrados.filter(u => u.tipo === filtro);
    }

    if (busqueda) {
        filtrados = filtrados.filter(
            u =>
                u.nombre.toLowerCase().includes(busqueda) ||
                u.email.toLowerCase().includes(busqueda) ||
                u.uid.toLowerCase().includes(busqueda)
        );
    }

    renderizarUsuarios(filtrados);

    const contador = $('usuarios-mostrados');
    if (contador) {
        contador.textContent = filtrados.length;
    }
}



/* ============================================================
   PEDIDOS
============================================================ */

async function cargarPedidos() {

    const snap =
        await getDocs(
            collection(
                db,
                'pedidos'
            )
        );


    const resultado = {

        total: 0,

        pendientes: 0,

        proceso: 0,

        enviados: 0,

        completados: 0,

        cancelados: 0

    };


    const pedidos = [];


    snap.forEach(
        docSnap => {

            const data =
                docSnap.data();


            const estado =
                normalizarEstado(
                    data.estado
                );


            resultado.total++;


            const grupo =
                obtenerGrupoEstado(
                    estado
                );


            if (grupo === 'pendiente') resultado.pendientes++;
            else if (grupo === 'proceso') resultado.proceso++;
            else if (grupo === 'enviado') resultado.enviados++;
            else if (grupo === 'completado') resultado.completados++;
            else if (grupo === 'cancelado') resultado.cancelados++;


            pedidos.push({

                id:
                    docSnap.id,

                ...data

            });

        }
    );


    pedidos.sort(
        (a, b) => {

            const fechaA = obtenerFechaPedido(a)?.getTime() || 0;
            const fechaB = obtenerFechaPedido(b)?.getTime() || 0;

            return fechaB - fechaA;
        }
    );


    pedidosGlobales = pedidos;
    window.pedidosGlobales = pedidos; // 🆕 expuesto


    actualizar('total-pedidos', resultado.total);
    actualizar('pedidos-pendientes', resultado.pendientes);
    actualizar('pedidos-proceso', resultado.proceso);
    actualizar('pedidos-enviados', resultado.enviados);
    actualizar('pedidos-completados', resultado.completados);
    actualizar('pedidos-cancelados', resultado.cancelados);


    renderizarPedidos();

    // 🆕 actualizar badge de pendientes en pestaña
    if (typeof actualizarBadgePendientes === 'function') {
        actualizarBadgePendientes();
    }


    return {
        ...resultado,
        pedidos
    };
}



/* ============================================================
   RENDERIZAR TABLA DE PEDIDOS
============================================================ */

function renderizarPedidos() {

    const cuerpo = $('tabla-pedidos-body');

    if (!cuerpo) return;


    const buscar =
        String(
            $('buscar-pedido')?.value || ''
        ).trim().toLowerCase();


    const filtro =
        String(
            $('filtro-estado-pedido')?.value || 'todos'
        );


    const filtroFecha =
        String(
            $('filtro-fecha-pedido')?.value || 'todos'
        );


    // Precalcular rangos de fecha
    const ahora = new Date();
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(hoy.getDate() - hoy.getDay());
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);


    const filtrados =
        pedidosGlobales.filter(
            pedido => {

                const grupo =
                    obtenerGrupoEstado(
                        pedido.estado
                    );


                const textoPedido =
                    JSON.stringify(
                        pedido
                    ).toLowerCase();


                const coincideBusqueda =
                    !buscar ||
                    textoPedido.includes(
                        buscar
                    );


                const coincideEstado =
                    filtro === 'todos' ||
                    grupo === filtro;


                // 🆕 Filtro por fecha
                let coincideFecha = true;

                if (filtroFecha !== 'todos') {

                    const fecha = obtenerFechaPedido(pedido);

                    if (!fecha) {
                        coincideFecha = false;
                    } else if (filtroFecha === 'hoy') {
                        coincideFecha = fecha >= hoy;
                    } else if (filtroFecha === 'semana') {
                        coincideFecha = fecha >= inicioSemana;
                    } else if (filtroFecha === 'mes') {
                        coincideFecha = fecha >= inicioMes;
                    }
                }


                return (
                    coincideBusqueda &&
                    coincideEstado &&
                    coincideFecha
                );

            }
        );


    actualizar(
        'pedidos-filtrados',
        `Mostrando ${filtrados.length} de ${pedidosGlobales.length} pedidos`
    );


    if (!filtrados.length) {

        cuerpo.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    class="orders-empty"
                >
                    🔎 No se encontraron pedidos con esos criterios.
                </td>

            </tr>

        `;

        return;
    }


    cuerpo.innerHTML =
        filtrados
            .map(
                pedido =>
                    crearFilaPedido(
                        pedido
                    )
            )
            .join('');


    cuerpo
        .querySelectorAll(
            '[data-ver-pedido]'
        )
        .forEach(
            boton => {

                boton.addEventListener(
                    'click',
                    () => {

                        const id =
                            boton.dataset.verPedido;


                        const pedido =
                            pedidosGlobales.find(
                                item =>
                                    item.id ===
                                    id
                            );


                        if (pedido) {

                            mostrarDetallePedido(
                                pedido
                            );
                        }

                    }
                );

            }
        );

}



/* ============================================================
   CREAR FILA PEDIDO
============================================================ */

function crearFilaPedido(
    pedido
) {

    const id =
        String(
            pedido.id || ''
        );


    const cliente =
        primerValor(
            pedido,
            [
                'clienteNombre',
                'nombreCliente',
                'cliente',
                'nombre'
            ],
            'Cliente'
        );


    const clienteEmail =
        primerValor(
            pedido,
            [
                'clienteEmail',
                'emailCliente',
                'correoCliente',
                'email'
            ],
            ''
        );


    const comerciante =
        primerValor(
            pedido,
            [
                'tiendaNombre',
                'nombreTienda',
                'comercianteNombre',
                'nombreComerciante',
                'tienda'
            ],
            'Comerciante'
        );


    const estado =
        textoEstado(
            pedido.estado
        );


    const grupo =
        obtenerGrupoEstado(
            pedido.estado
        );


    const total =
        obtenerTotalPedido(
            pedido
        );


    const fecha =
        fechaCorta(
            obtenerFechaPedido(
                pedido
            )
        );


    return `

        <tr>

            <td>

                <span class="order-id">
                    #${escapeHtml(
                        id.slice(-10)
                    )}
                </span>

                <span class="order-secondary">
                    ${escapeHtml(id)}
                </span>

            </td>


            <td>

                <strong>
                    ${escapeHtml(
                        cliente
                    )}
                </strong>

                ${
                    clienteEmail
                        ? `
                            <span class="order-secondary">
                                ${escapeHtml(
                                    clienteEmail
                                )}
                            </span>
                          `
                        : ''
                }

            </td>


            <td>

                ${escapeHtml(
                    comerciante
                )}

            </td>


            <td>

                <span
                    class="order-status ${grupo}"
                >

                    ${iconoEstado(
                        grupo
                    )}

                    ${escapeHtml(
                        estado
                    )}

                </span>

            </td>


            <td>

                <span class="order-total">
                    ${dinero(total)}
                </span>

            </td>


            <td>
                ${escapeHtml(
                    fecha
                )}
            </td>


            <td>

                <button
                    type="button"
                    class="btn-order-detail"
                    data-ver-pedido="${escapeHtml(id)}"
                >
                    👁️ Ver
                </button>

            </td>

        </tr>

    `;
}



/* ============================================================
   ICONO ESTADO PEDIDO
============================================================ */

function iconoEstado(
    grupo
) {

    switch (
        grupo
    ) {

        case 'pendiente':
            return '🟡';

        case 'proceso':
            return '🔵';

        case 'enviado':
            return '🚚';

        case 'completado':
            return '📦';

        case 'cancelado':
            return '❌';

        default:
            return '⚪';
    }
}



/* ============================================================
   OBTENER TOTAL DEL PEDIDO
============================================================ */

function obtenerTotalPedido(
    pedido
) {

    const posibles = [

        pedido.total,

        pedido.totalPedido,

        pedido.totalCompra,

        pedido.totalFinal,

        pedido.granTotal,

        pedido.montoTotal,

        pedido.subtotalTotal

    ];


    for (
        const valor of posibles
    ) {

        const numero =
            Number(valor);


        if (
            Number.isFinite(
                numero
            ) &&
            numero !== 0
        ) {

            return numero;
        }

    }


    const productos =
        obtenerProductos(
            pedido
        );


    if (
        productos.length
    ) {

        return productos.reduce(
            (
                suma,
                producto
            ) => {

                const cantidad =
                    Number(
                        primerValor(
                            producto,
                            [
                                'cantidad',
                                'qty',
                                'quantity'
                            ],
                            1
                        )
                    ) || 1;


                const precio =
                    Number(
                        primerValor(
                            producto,
                            [
                                'precio',
                                'price',
                                'valor',
                                'precioUnitario'
                            ],
                            0
                        )
                    ) || 0;


                return (
                    suma +
                    (
                        cantidad *
                        precio
                    )
                );

            },
            0
        );

    }


    return 0;
}



/* ============================================================
   PRODUCTOS DEL PEDIDO
============================================================ */

function obtenerProductos(
    pedido
) {

    const posibles = [

        pedido.productos,

        pedido.items,

        pedido.detalles,

        pedido.carrito,

        pedido.productosPedido

    ];


    for (
        const lista of posibles
    ) {

        if (
            Array.isArray(lista)
        ) {

            return lista;
        }

    }


    return [];
}



/* ============================================================
   DETALLE DEL PEDIDO
============================================================ */

function mostrarDetallePedido(
    pedido
) {

    const modal = $('order-modal');

    const body = $('order-modal-body');

    const title = $('order-modal-title');


    if (!modal || !body || !title) return;


    const id = String(pedido.id || '');


    title.textContent = `Pedido #${id.slice(-10)}`;


    const cliente =
        primerValor(
            pedido,
            ['clienteNombre', 'nombreCliente', 'cliente', 'nombre'],
            'No registrado'
        );


    const clienteEmail =
        primerValor(
            pedido,
            ['clienteEmail', 'emailCliente', 'correoCliente', 'email'],
            'No registrado'
        );


    const clienteUid =
        primerValor(
            pedido,
            ['clienteId', 'clienteUid', 'uidCliente', 'userId'],
            'No registrado'
        );


    const comerciante =
        primerValor(
            pedido,
            ['tiendaNombre', 'nombreTienda', 'comercianteNombre', 'nombreComerciante', 'tienda'],
            'No registrado'
        );


    const comercianteUid =
        primerValor(
            pedido,
            ['tiendaId', 'tiendaUid', 'comercianteId', 'uidComerciante'],
            'No registrado'
        );


    const estado = textoEstado(pedido.estado);

    const grupo = obtenerGrupoEstado(pedido.estado);

    const fecha = fechaCorta(obtenerFechaPedido(pedido));

    const total = obtenerTotalPedido(pedido);


    const servicio =
        Number(
            primerValor(
                pedido,
                ['servicio', 'costoServicio', 'valorServicio', 'serviceFee'],
                0
            )
        ) || 0;


    const subtotal =
        Number(
            primerValor(
                pedido,
                ['subtotal', 'subtotalPedido', 'subtotalCompra'],
                0
            )
        ) || 0;


    const productos = obtenerProductos(pedido);


    body.innerHTML = `

        <div class="order-detail-grid">

            <div class="order-detail-card">
                <h4>👤 Cliente</h4>
                <p><strong>${escapeHtml(cliente)}</strong></p>
                <p>📧 ${escapeHtml(clienteEmail)}</p>
                <p>🆔 ${escapeHtml(clienteUid)}</p>
            </div>

            <div class="order-detail-card">
                <h4>🏪 Comerciante</h4>
                <p><strong>${escapeHtml(comerciante)}</strong></p>
                <p>🆔 ${escapeHtml(comercianteUid)}</p>
            </div>

            <div class="order-detail-card">
                <h4>📦 Estado del pedido</h4>
                <p>
                    <span class="order-status ${grupo}">
                        ${iconoEstado(grupo)}
                        ${escapeHtml(estado)}
                    </span>
                </p>
                <p>📅 ${escapeHtml(fecha)}</p>
            </div>

            <div class="order-detail-card">
                <h4>🆔 Identificación</h4>
                <p>${escapeHtml(id)}</p>
            </div>

        </div>

        <h4 class="order-products-title">🛒 Productos del pedido</h4>

        <div class="order-products">

            ${
                productos.length
                    ? `
                        <table>
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Cantidad</th>
                                    <th>Precio</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${
                                    productos
                                        .map(
                                            producto => {

                                                const nombre =
                                                    primerValor(
                                                        producto,
                                                        ['nombre', 'name', 'producto', 'titulo'],
                                                        'Producto'
                                                    );


                                                const cantidad =
                                                    Number(
                                                        primerValor(
                                                            producto,
                                                            ['cantidad', 'qty', 'quantity'],
                                                            1
                                                        )
                                                    ) || 1;


                                                const precio =
                                                    Number(
                                                        primerValor(
                                                            producto,
                                                            ['precio', 'price', 'valor', 'precioUnitario'],
                                                            0
                                                        )
                                                    ) || 0;


                                                return `
                                                    <tr>
                                                        <td>${escapeHtml(nombre)}</td>
                                                        <td>${cantidad}</td>
                                                        <td>${dinero(precio)}</td>
                                                        <td>${dinero(cantidad * precio)}</td>
                                                    </tr>
                                                `;

                                            }
                                        )
                                        .join('')
                                }
                            </tbody>
                        </table>
                    `
                    : `
                        <div style="padding:20px;text-align:center;color:#71827d;">
                            No hay productos en formato de lista.
                            El pedido sí está registrado en Firebase.
                        </div>
                    `
            }

        </div>

        <div class="order-totals">

            ${
                subtotal
                    ? `
                        <div class="order-total-row">
                            <span>Subtotal</span>
                            <strong>${dinero(subtotal)}</strong>
                        </div>
                      `
                    : ''
            }

            ${
                servicio
                    ? `
                        <div class="order-total-row">
                            <span>Servicio</span>
                            <strong>${dinero(servicio)}</strong>
                        </div>
                      `
                    : ''
            }

            <div class="order-total-row final">
                <span>Total</span>
                <strong>${dinero(total)}</strong>
            </div>

        </div>

        <details class="order-raw">
            <summary>Ver datos técnicos del pedido</summary>
            <pre>${escapeHtml(JSON.stringify(pedido, null, 2))}</pre>
        </details>

    `;


    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

}



/* ============================================================
   CERRAR MODAL PEDIDO
============================================================ */

function cerrarDetallePedido() {

    const modal = $('order-modal');

    if (!modal) return;

    modal.classList.remove('active');

    modal.setAttribute('aria-hidden', 'true');
}



$('btn-cerrar-detalle-pedido')
    ?.addEventListener(
        'click',
        cerrarDetallePedido
    );



$('order-modal')
    ?.addEventListener(
        'click',
        evento => {

            if (evento.target?.id === 'order-modal') {

                cerrarDetallePedido();
            }

        }
    );



document.addEventListener(
    'keydown',
    evento => {

        if (evento.key === 'Escape') {

            cerrarDetallePedido();
        }

    }
);



/* ============================================================
   BUSCADOR PEDIDOS
============================================================ */

$('buscar-pedido')
    ?.addEventListener(
        'input',
        renderizarPedidos
    );



$('filtro-estado-pedido')
    ?.addEventListener(
        'change',
        renderizarPedidos
    );



/* ============================================================
   SERVICIOS
============================================================ */

async function cargarServicios() {

    const snap =
        await getDocs(
            collection(
                db,
                'servicios_comerciante'
            )
        );


    const resultado = {

        cantidadTotal: 0,
        totalGenerado: 0,
        cantidadPendientes: 0,
        totalPendiente: 0,
        cantidadVerificar: 0,
        totalVerificar: 0,
        cantidadPagados: 0,
        totalPagado: 0

    };


    const servicios = [];


    snap.forEach(
        docSnap => {

            const data = docSnap.data();

            const monto = Number(data.monto || 0);

            const estado = normalizarEstado(data.estado);


            resultado.cantidadTotal++;
            resultado.totalGenerado += monto;


            if (estado === 'pendiente') {

                resultado.cantidadPendientes++;
                resultado.totalPendiente += monto;

            }

            else if (
                estado === 'por verificar' ||
                estado === 'reportado' ||
                estado === 'reportado pago'
            ) {

                resultado.cantidadVerificar++;
                resultado.totalVerificar += monto;

            }

            else if (
                estado === 'pagado' ||
                estado === 'pagada'
            ) {

                resultado.cantidadPagados++;
                resultado.totalPagado += monto;

            }


            servicios.push({
                id: docSnap.id,
                ...data
            });

        }
    );


    serviciosGlobales = servicios;
    window.serviciosGlobales = servicios;


    actualizar('servicios-generados', dinero(resultado.totalGenerado));
    actualizar('cantidad-servicios', resultado.cantidadTotal);
    actualizar('servicios-pendientes', dinero(resultado.totalPendiente));
    actualizar('cantidad-pendientes', resultado.cantidadPendientes);
    actualizar('servicios-verificar', dinero(resultado.totalVerificar));
    actualizar('cantidad-verificar', resultado.cantidadVerificar);
    actualizar('servicios-pagados', dinero(resultado.totalPagado));
    actualizar('cantidad-pagados', resultado.cantidadPagados);


    const totalPorCobrar =
        resultado.totalPendiente + resultado.totalVerificar;


    actualizar('total-por-cobrar', dinero(totalPorCobrar));


    renderizarServicios();


    return {
        ...resultado,
        totalPorCobrar,
        servicios
    };
}


/* ============================================================
   RENDERIZAR SERVICIOS
============================================================ */

function renderizarServicios() {

    const cuerpo = $('tabla-servicios-body');

    if (!cuerpo) return;


    const buscar =
        String(
            $('buscar-servicio')?.value || ''
        ).trim().toLowerCase();


    const filtro =
        String(
            $('filtro-estado-servicio')?.value || 'todos'
        );


    const filtrados =
        serviciosGlobales.filter(
            servicio => {

                const estado = normalizarEstado(servicio.estado);


                const coincideBusqueda =
                    !buscar ||
                    JSON.stringify(servicio)
                        .toLowerCase()
                        .includes(buscar);


                let coincideEstado = true;


                if (filtro === 'pendiente') {
                    coincideEstado = estado === 'pendiente';
                }

                else if (filtro === 'por_verificar') {
                    coincideEstado = (
                        estado === 'por verificar' ||
                        estado === 'reportado' ||
                        estado === 'reportado pago' ||
                        estado === 'por_verificar'
                    );
                }

                else if (filtro === 'pagado') {
                    coincideEstado = (
                        estado === 'pagado' ||
                        estado === 'pagada'
                    );
                }


                return (
                    coincideBusqueda &&
                    coincideEstado
                );

            }
        );


    actualizar(
        'servicios-filtrados',
        `Mostrando ${filtrados.length} de ${serviciosGlobales.length} servicios`
    );


    if (!filtrados.length) {

        cuerpo.innerHTML = `
            <tr>
                <td colspan="7" class="orders-empty">
                    🔎 No se encontraron servicios.
                </td>
            </tr>
        `;

        return;
    }


    cuerpo.innerHTML =
        filtrados
            .map(
                servicio =>
                    crearFilaServicio(
                        servicio
                    )
            )
            .join('');


    cuerpo
        .querySelectorAll(
            '[data-ver-servicio]'
        )
        .forEach(
            boton => {

                boton.addEventListener(
                    'click',
                    () => {

                        const id =
                            boton.dataset.verServicio;


                        const servicio =
                            serviciosGlobales.find(
                                item =>
                                    item.id ===
                                    id
                            );


                        if (servicio) {

                            mostrarDetalleServicio(
                                servicio
                            );

                        }

                    }
                );

            }
        );

}



/* ============================================================
   CREAR FILA DE SERVICIO
============================================================ */

function crearFilaServicio(
    servicio
) {

    const id = String(servicio.id || '');


    const comerciante =
        primerValor(
            servicio,
            ['tiendaNombre', 'nombreTienda', 'comercianteNombre', 'nombreComerciante', 'tienda'],
            'Comerciante'
        );


    const pedidoId =
        primerValor(
            servicio,
            ['pedidoId', 'pedidoID', 'idPedido', 'pedido'],
            'No asociado'
        );


    const monto = Number(servicio.monto || 0);

    const estado = normalizarEstado(servicio.estado);


    const fecha =
        timestampToDate(
            servicio.fechaGenerado ||
            servicio.creadoEn ||
            servicio.fecha ||
            servicio.createdAt
        );


    const grupoEstado =
        obtenerGrupoServicio(estado);


    return `

        <tr>

            <td>
                <span class="order-id">
                    #${escapeHtml(id.slice(-10))}
                </span>
                <span class="order-secondary">
                    ${escapeHtml(id)}
                </span>
            </td>

            <td>${escapeHtml(comerciante)}</td>

            <td>
                ${
                    typeof pedidoId === 'object'
                        ? escapeHtml(JSON.stringify(pedidoId))
                        : escapeHtml(pedidoId)
                }
            </td>

            <td>
                <span class="order-status ${grupoEstado}">
                    ${iconoEstadoServicio(grupoEstado)}
                    ${escapeHtml(textoEstadoServicio(estado))}
                </span>
            </td>

            <td>
                <span class="order-total">
                    ${dinero(monto)}
                </span>
            </td>

            <td>
                ${escapeHtml(fechaCorta(fecha))}
            </td>

            <td>
                <button
                    type="button"
                    class="btn-order-detail"
                    data-ver-servicio="${escapeHtml(id)}"
                >
                    👁️ Ver
                </button>
            </td>

        </tr>

    `;
}



/* ============================================================
   ESTADO DEL SERVICIO
============================================================ */

function obtenerGrupoServicio(
    estado
) {

    const normalizado = normalizarEstado(estado);


    if (normalizado === 'pendiente') return 'pending';


    if (
        normalizado === 'por verificar' ||
        normalizado === 'por_verificar' ||
        normalizado === 'reportado' ||
        normalizado === 'reportado pago'
    ) {
        return 'process';
    }


    if (
        normalizado === 'pagado' ||
        normalizado === 'pagada'
    ) {
        return 'completed';
    }


    return 'other';
}



function iconoEstadoServicio(
    grupo
) {

    if (grupo === 'pending') return '🟠';
    if (grupo === 'process') return '🟡';
    if (grupo === 'completed') return '🟢';
    return '⚪';
}



function textoEstadoServicio(
    estado
) {

    if (!estado) return 'Sin estado';

    const texto = String(estado).replace(/_/g, ' ');

    return (
        texto.charAt(0).toUpperCase()
        +
        texto.slice(1)
    );
}



/* ============================================================
   DETALLE DEL SERVICIO
============================================================ */

function mostrarDetalleServicio(
    servicio
) {

    const modal = $('service-modal');
    const body = $('service-modal-body');
    const title = $('service-modal-title');

    if (!modal || !body || !title) return;


    const id = String(servicio.id || '');


    const comerciante =
        primerValor(
            servicio,
            ['tiendaNombre', 'nombreTienda', 'comercianteNombre', 'nombreComerciante', 'tienda'],
            'No registrado'
        );


    const comercianteUid =
        primerValor(
            servicio,
            ['tiendaId', 'tiendaUid', 'comercianteId', 'uidComerciante'],
            'No registrado'
        );


    const pedidoId =
        primerValor(
            servicio,
            ['pedidoId', 'pedidoID', 'idPedido'],
            'No asociado'
        );


    const monto = Number(servicio.monto || 0);

    const estado = normalizarEstado(servicio.estado);


    const fecha =
        timestampToDate(
            servicio.fechaGenerado ||
            servicio.creadoEn ||
            servicio.fecha ||
            servicio.createdAt
        );


    title.textContent = `Servicio #${id.slice(-10)}`;


    body.innerHTML = `

        <div class="order-detail-grid">

            <div class="order-detail-card">
                <h4>🧾 Servicio</h4>
                <p><strong>${escapeHtml(id)}</strong></p>
                <p>📅 ${escapeHtml(fechaCorta(fecha))}</p>
            </div>

            <div class="order-detail-card">
                <h4>🏪 Comerciante</h4>
                <p><strong>${escapeHtml(comerciante)}</strong></p>
                <p>🆔 ${escapeHtml(comercianteUid)}</p>
            </div>

            <div class="order-detail-card">
                <h4>🛒 Pedido relacionado</h4>
                <p>${escapeHtml(typeof pedidoId === 'object' ? JSON.stringify(pedidoId) : pedidoId)}</p>
            </div>

            <div class="order-detail-card">
                <h4>📊 Estado</h4>
                <p>
                    <span class="order-status ${obtenerGrupoServicio(estado)}">
                        ${iconoEstadoServicio(obtenerGrupoServicio(estado))}
                        ${escapeHtml(textoEstadoServicio(estado))}
                    </span>
                </p>
            </div>

        </div>

        <div class="order-totals">
            <div class="order-total-row final">
                <span>Servicio</span>
                <strong>${dinero(monto)}</strong>
            </div>
        </div>

        <details class="order-raw">
            <summary>Ver datos técnicos del servicio</summary>
            <pre>${escapeHtml(JSON.stringify(servicio, null, 2))}</pre>
        </details>

    `;


    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

}



/* ============================================================
   CERRAR DETALLE SERVICIO
============================================================ */

function cerrarDetalleServicio() {

    const modal = $('service-modal');

    if (!modal) return;

    modal.classList.remove('active');

    modal.setAttribute('aria-hidden', 'true');
}



$('btn-cerrar-detalle-servicio')
    ?.addEventListener(
        'click',
        cerrarDetalleServicio
    );



$('service-modal')
    ?.addEventListener(
        'click',
        evento => {

            if (evento.target?.id === 'service-modal') {

                cerrarDetalleServicio();

            }

        }
    );



/* ============================================================
   BUSCADOR DE SERVICIOS
============================================================ */

$('buscar-servicio')
    ?.addEventListener(
        'input',
        renderizarServicios
    );



$('filtro-estado-servicio')
    ?.addEventListener(
        'change',
        renderizarServicios
    );



/* ============================================================
   ACTIVIDAD RECIENTE
============================================================ */

function mostrarActividad(
    pedidos = [],
    servicios = []
) {

    const contenedor = $('actividad-reciente');

    if (!contenedor) return;


    const actividades = [];


    pedidos.forEach(
        pedido => {

            const fecha = obtenerFechaPedido(pedido);

            actividades.push({
                tipo: 'pedido',
                icono: '🛒',
                titulo: 'Pedido registrado',
                descripcion: `Pedido #${String(pedido.id).slice(-8)}`,
                fecha
            });

        }
    );


    servicios.forEach(
        servicio => {

            const fecha = timestampToDate(servicio.fechaGenerado);

            actividades.push({
                tipo: 'servicio',
                icono: '💰',
                titulo: 'Servicio generado',
                descripcion: `${primerValor(servicio, ['tiendaNombre', 'nombreTienda'], 'Comerciante')} · ${dinero(servicio.monto)}`,
                fecha
            });

        }
    );


    actividades.sort(
        (a, b) => {
            const fechaA = a.fecha?.getTime() || 0;
            const fechaB = b.fecha?.getTime() || 0;
            return fechaB - fechaA;
        }
    );


    const ultimas = actividades.slice(0, 15);


    if (!ultimas.length) {

        contenedor.innerHTML = `
            <div class="loading">
                No hay actividad reciente.
            </div>
        `;

        return;
    }


    contenedor.innerHTML =
        ultimas
            .map(
                item => {

                    const fecha =
                        item.fecha
                            ? item.fecha.toLocaleString(
                                'es-CO',
                                {
                                    dateStyle: 'short',
                                    timeStyle: 'short'
                                }
                            )
                            : '--';


                    return `
                        <div class="activity-item">
                            <div class="activity-icon">
                                ${item.icono}
                            </div>
                            <div class="activity-main">
                                <div class="activity-title">
                                    ${escapeHtml(item.titulo)}
                                </div>
                                <div class="activity-description">
                                    ${escapeHtml(item.descripcion)}
                                </div>
                            </div>
                            <div class="activity-date">
                                ${escapeHtml(fecha)}
                            </div>
                        </div>
                    `;

                }
            )
            .join('');
}



/* ============================================================
   CARGAR TODO
============================================================ */

async function cargarTorreControl() {

    mostrarEstado(
        'Cargando información de la plataforma...'
    );


    try {

        const [
            clientes,
            comerciantes,
            usuarios,
            pedidos,
            servicios
        ] = await Promise.all([

            cargarClientes(),

            cargarComerciantes(),

            cargarUsuarios(),

            cargarPedidos(),

            cargarServicios()

        ]);

        filtrarYBuscarUsuarios();

        mostrarActividad(
            pedidos.pedidos,
            servicios.servicios
        );


        actualizar(
            'ultima-actualizacion',
            `Actualizado: ${new Date().toLocaleString('es-CO')}`
        );


        mostrarEstado(
            '✓ Torre de Control conectada correctamente con Firebase.',
            'success'
        );


        console.log(
            '🏢 TORRE DE CONTROL',
            {
                clientes,
                comerciantes,
                pedidos,
                servicios,
                usuarios
            }
        );

    }


    catch (error) {

        console.error(
            '❌ Error cargando Torre de Control:',
            error
        );


        mostrarEstado(
            `Error cargando la Torre de Control: ${error.message}`,
            'error'
        );

    }

}


/* ============================================================
   EVENTOS DE USUARIOS
============================================================ */

$('buscar-usuario')?.addEventListener('input', filtrarYBuscarUsuarios);
$('filtro-tipo')?.addEventListener('change', filtrarYBuscarUsuarios);



/* ============================================================
   VERIFICACIÓN ADMINISTRATIVA
============================================================ */

async function verificarAdministrador(
    user
) {

    if (!user) return false;


    const correoCorrecto =
        String(user.email || '')
            .toLowerCase() ===
        EMAIL_ADMINISTRADOR
            .toLowerCase();


    if (!correoCorrecto) {

        console.error(
            '🚫 Correo no autorizado:',
            user.email
        );

        return false;
    }


    try {

        const tokenResult =
            await user.getIdTokenResult(
                true
            );


        const claims =
            tokenResult.claims ||
            {};


        console.log(
            '🔑 Claims administrativos:',
            claims
        );


        return (
            claims.admin === true
        );

    }

    catch (error) {

        console.error(
            '❌ No se pudo verificar el Custom Claim:',
            error
        );

        return false;
    }

}



/* ============================================================
   AUTENTICACIÓN
============================================================ */

onAuthStateChanged(

    auth,

    async user => {

        if (!user) {

            actualizar(
                'admin-user',
                'Sesión no iniciada'
            );


            mostrarEstado(
                'Debes iniciar sesión para acceder a la Torre de Control.',
                'error'
            );


            return;
        }


        console.log(
            '👤 Usuario autenticado:',
            user.email
        );


        actualizar(
            'admin-user',
            user.email ||
            user.uid
        );


        const autorizado =
            await verificarAdministrador(
                user
            );


        if (!autorizado) {

            console.error(
                '🚫 Acceso administrativo rechazado.'
            );


            mostrarEstado(
                '🚫 Esta cuenta no tiene permisos administrativos.',
                'error'
            );


            setTimeout(
                () => {

                    window.location.replace(
                        RUTA_LOGIN_ADMIN
                    );

                },
                1000
            );


            return;
        }


        console.log(
            '👑 ADMINISTRADOR CONFIRMADO'
        );


        await cargarTorreControl();

    }

);



/* ============================================================
   BOTÓN ACTUALIZAR
============================================================ */

$('btn-recargar')
    ?.addEventListener(
        'click',
        async () => {
            await cargarTorreControl();
        }
    );


/* ============================================================
   TABS
============================================================ */

initTabs();


/* ============================================================
   INICIO
============================================================ */

console.log(
    '🏢 Torre de Control — PASOS 6, 7, 8 y 9 cargados'
);

console.log(
    '👑 Gestión administrativa de pedidos y servicios activa'
);

console.log(
    '🔒 Modo: SOLO LECTURA'
);

/* ============================================================
   📌 CONFIGURACIÓN DE RECAUDO - FIRESTORE
   ============================================================ */

const CONFIG_RECAUDO_PATH = 'configuracion/recaudo';

/**
 * Carga la configuración de recaudo desde Firestore
 */
async function cargarRecaudo() {
    try {
        const docRef = doc(db, CONFIG_RECAUDO_PATH);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            console.log('📌 No hay configuración de recaudo guardada');
            return null;
        }

        const data = docSnap.data();
        console.log('✅ Configuración de recaudo cargada:', data);

        const banco = document.getElementById('recaudo-banco');
        const tipo = document.getElementById('recaudo-tipo-cuenta');
        const numero = document.getElementById('recaudo-numero-cuenta');
        const titular = document.getElementById('recaudo-titular');
        const documento = document.getElementById('recaudo-documento');
        const activo = document.getElementById('recaudo-activo');
        const instrucciones = document.getElementById('recaudo-instrucciones');

        if (banco) banco.value = data.banco || '';
        if (tipo) tipo.value = data.tipoCuenta || '';
        if (numero) numero.value = data.numeroCuenta || '';
        if (titular) titular.value = data.titular || '';
        if (documento) documento.value = data.documento || '';
        if (activo) activo.checked = data.activo || false;
        if (instrucciones) instrucciones.value = data.instrucciones || '';

        return data;

    } catch (error) {
        console.error('❌ Error cargando recaudo:', error);
        return null;
    }
}

/**
 * Guarda la configuración de recaudo en Firestore
 */
async function guardarRecaudo() {
    const banco = document.getElementById('recaudo-banco')?.value || '';
    const tipoCuenta = document.getElementById('recaudo-tipo-cuenta')?.value || '';
    const numeroCuenta = document.getElementById('recaudo-numero-cuenta')?.value || '';
    const titular = document.getElementById('recaudo-titular')?.value || '';
    const documento = document.getElementById('recaudo-documento')?.value || '';
    const activo = document.getElementById('recaudo-activo')?.checked || false;
    const instrucciones = document.getElementById('recaudo-instrucciones')?.value || '';

    const msg = document.getElementById('recaudo-msg');

    if (!banco || !numeroCuenta || !titular) {
        if (msg) {
            msg.textContent = '⚠️ Banco, número de cuenta y titular son obligatorios';
            msg.style.color = '#f87171';
        }
        return false;
    }

    try {
        if (msg) {
            msg.textContent = '💾 Guardando...';
            msg.style.color = '#60a5fa';
        }

        const docRef = doc(db, CONFIG_RECAUDO_PATH);
        await setDoc(docRef, {
            banco,
            tipoCuenta,
            numeroCuenta,
            titular,
            documento,
            activo,
            instrucciones,
            actualizadoEn: serverTimestamp(),
            actualizadoPor: auth.currentUser?.uid || 'admin'
        }, { merge: true });

        if (msg) {
            msg.textContent = '✅ Configuración de recaudo guardada correctamente';
            msg.style.color = '#34d399';
        }

        console.log('✅ Configuración de recaudo guardada:', {
            banco, tipoCuenta, numeroCuenta, titular, documento, activo, instrucciones
        });

        setTimeout(() => {
            if (msg) msg.textContent = '';
        }, 4000);

        return true;

    } catch (error) {
        console.error('❌ Error guardando recaudo:', error);
        if (msg) {
            msg.textContent = '❌ Error al guardar: ' + error.message;
            msg.style.color = '#f87171';
        }
        return false;
    }
}

/**
 * Inicializar el módulo de Recaudo
 */
function initRecaudo() {
    const btnGuardar = document.getElementById('btn-guardar-recaudo');
    if (!btnGuardar) return;

    const tabRecaudo = document.querySelector('[data-tab="recaudo"]');
    if (tabRecaudo) {
        tabRecaudo.addEventListener('click', () => {
            cargarRecaudo();
        });
    }

    btnGuardar.addEventListener('click', async (e) => {
        e.preventDefault();
        await guardarRecaudo();
    });

    console.log('💰 Módulo de Recaudo inicializado');
}

document.addEventListener('DOMContentLoaded', () => {
    initRecaudo();
    setTimeout(() => {
        const tabActiva = document.querySelector('.tab-btn.active');
        if (tabActiva?.dataset?.tab === 'recaudo') {
            cargarRecaudo();
        }
    }, 500);
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        setTimeout(() => {
            initRecaudo();
        }, 1000);
    }
});

console.log('🏦 Módulo de Recaudo cargado');

// ============================================================
// 💳 PAGOS REPORTADOS POR COMERCIANTES
// ============================================================

let pagosReportados = [];

async function cargarPagosReportados() {
    try {
        const q = query(
            collection(db, 'pagos_comerciante'),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
        const snap = await getDocs(q);
        pagosReportados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderizarPagosReportados();
        return pagosReportados;
    } catch (error) {
        console.error('❌ Error cargando pagos reportados:', error);
        return [];
    }
}

function renderizarPagosReportados() {
    const container = document.getElementById('recaudo-pagos-container');
    if (!container) return;

    if (!pagosReportados || pagosReportados.length === 0) {
        container.innerHTML = `
            <div class="orders-empty">
                <i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:12px;opacity:0.3;"></i>
                Aún no hay pagos reportados por comerciantes.
            </div>
        `;
        return;
    }

    let html = `
        <div class="orders-table-wrapper">
            <table class="orders-table">
                <thead>
                    <tr>
                        <th>ID Pago</th>
                        <th>Comerciante</th>
                        <th>Servicios</th>
                        <th>Total</th>
                        <th>Método</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                        <th>Acción</th>
                    </tr>
                </thead>
                <tbody>
    `;

    pagosReportados.forEach(pago => {
        const id = String(pago.id || '').slice(-10);
        const comercianteId = pago.comercianteId || 'No registrado';
        const total = pago.total || 0;
        const metodo = pago.metodo || 'No especificado';
        const estado = pago.estado || 'pendiente';
        const fecha = formatearFechaHora(pago.createdAt);
        const servicios = pago.servicioIds?.length || 0;

        const estadoBadge = estado === 'verificacion' ? '🟡 Por verificar' :
            estado === 'pagado' ? '🟢 Pagado' :
            '🟠 Pendiente';

        const estadoClass = estado === 'verificacion' ? 'process' :
            estado === 'pagado' ? 'completed' :
            'pending';

        html += `
            <tr>
                <td><span class="order-id">#${escapeHtml(id)}</span></td>
                <td>${escapeHtml(comercianteId)}</td>
                <td>${servicios}</td>
                <td><span class="order-total">${dinero(total)}</span></td>
                <td>${escapeHtml(metodo)}</td>
                <td><span class="order-status ${estadoClass}">${estadoBadge}</span></td>
                <td>${escapeHtml(fecha)}</td>
                <td>
                    <button class="btn-order-detail btn-ver-pago" data-id="${pago.id}">👁️ Ver</button>
                    ${estado === 'verificacion' ? `
                        <button class="btn-order-detail btn-aprobar-pago" data-id="${pago.id}" style="background:#10b981;color:white;">✅ Aprobar</button>
                    ` : ''}
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.btn-ver-pago').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const pago = pagosReportados.find(p => p.id === id);
            if (pago) {
                alert(`📋 DETALLE DEL PAGO\n\n` +
                    `ID: ${pago.id}\n` +
                    `Comerciante: ${pago.comercianteId}\n` +
                    `Total: ${dinero(pago.total)}\n` +
                    `Método: ${pago.metodo}\n` +
                    `Estado: ${pago.estado}\n` +
                    `Servicios: ${pago.servicioIds?.join(', ') || 'Ninguno'}\n` +
                    `Fecha: ${formatearFechaHora(pago.createdAt)}`);
            }
        });
    });

    container.querySelectorAll('.btn-aprobar-pago').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const confirmar = confirm(
                '¿Estás seguro de aprobar este pago?\n\n' +
                'Los servicios seleccionados pasarán a estado "pagado" y la deuda del comerciante se actualizará.'
            );
            if (confirmar) {
                await aprobarPago(id);
            }
        });
    });
}

async function aprobarPago(pagoId) {
    try {
        const pagoRef = doc(db, 'pagos_comerciante', pagoId);
        const pagoSnap = await getDoc(pagoRef);

        if (!pagoSnap.exists()) {
            alert('❌ El pago no existe');
            return;
        }

        const pago = pagoSnap.data();

        if (pago.estado === 'pagado') {
            alert('ℹ️ Este pago ya fue aprobado anteriormente');
            return;
        }

        await updateDoc(pagoRef, {
            estado: 'pagado',
            aprobadoEn: serverTimestamp(),
            aprobadoPor: auth.currentUser?.uid || 'admin'
        });

        const servicioIds = pago.servicioIds || [];
        if (servicioIds.length > 0) {
            const batch = writeBatch(db);
            servicioIds.forEach(id => {
                const ref = doc(db, 'servicios_comerciante', id);
                batch.update(ref, {
                    estado: 'pagado',
                    fechaPago: serverTimestamp(),
                    pagoId: pagoId
                });
            });
            await batch.commit();
        }

        alert(`✅ Pago aprobado exitosamente!\n\n` +
            `Total: ${dinero(pago.total)}\n` +
            `Servicios: ${servicioIds.length}\n\n` +
            `La deuda del comerciante se ha actualizado automáticamente.`);

        await cargarPagosReportados();
        await cargarServicios();

    } catch (error) {
        console.error('❌ Error aprobando pago:', error);
        alert('❌ Error al aprobar el pago: ' + error.message);
    }
}

function escucharPagosReportados() {
    const q = query(
        collection(db, 'pagos_comerciante'),
        orderBy('createdAt', 'desc'),
        limit(50)
    );

    onSnapshot(q, (snap) => {
        pagosReportados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const tabRecaudo = document.getElementById('tab-recaudo');
        if (tabRecaudo && tabRecaudo.classList.contains('active')) {
            renderizarPagosReportados();
        }
    }, (error) => {
        console.warn('⚠️ Error escuchando pagos reportados:', error);
    });
}

// ============================================================
// 🎯 EXTENDER initRecaudo PARA CARGAR PAGOS
// ============================================================

const _initRecaudoOriginal = window.initRecaudo || function() {};

window.initRecaudo = function() {
    if (typeof _initRecaudoOriginal === 'function') {
        _initRecaudoOriginal();
    }

    const tabRecaudo = document.querySelector('[data-tab="recaudo"]');
    if (tabRecaudo) {
        tabRecaudo.addEventListener('click', () => {
            cargarPagosReportados();
        });
    }

    setTimeout(() => {
        const tabActiva = document.querySelector('.tab-btn.active');
        if (tabActiva?.dataset?.tab === 'recaudo') {
            cargarPagosReportados();
        }
    }, 500);

    escucharPagosReportados();

    console.log('💳 Módulo de pagos reportados inicializado');
};

// ============================================================
// 🎯 EXTENDER cargarTorreControl PARA CARGAR PAGOS
// ============================================================

const _cargarTorreControlOriginal = window.cargarTorreControl || function() {};

window.cargarTorreControl = async function() {
    if (typeof _cargarTorreControlOriginal === 'function') {
        await _cargarTorreControlOriginal();
    }
    setTimeout(() => {
        cargarPagosReportados();
        escucharPagosReportados();
    }, 1000);
};

console.log('💳 Módulo de pagos reportados cargado');
console.log('📌 Los pagos de comerciantes aparecerán en la pestaña Recaudo');


/* ============================================================
   💬 MÓDULO DE SOPORTE
============================================================ */
async function cargarSoporte() {
    const tbody = document.getElementById('tabla-soporte');
    if (!tbody) return;

    try {
        const snap = await getDocs(collection(db, 'soporte_tickets'));
        const tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (tickets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="loading-text">No hay tickets de soporte.</td></tr>`;
            return;
        }

        tbody.innerHTML = tickets.map(t => `
            <tr>
                <td><strong>${escapeHtml(t.usuarioNombre || 'Cliente')}</strong></td>
                <td>${escapeHtml(t.asunto || 'Sin asunto')}</td>
                <td><span class="order-status ${t.estado === 'abierto' ? 'pending' : 'completed'}">${escapeHtml(t.estado || 'abierto')}</span></td>
                <td>${escapeHtml(formatearFechaHora(t.createdAt))}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('❌ Error cargando soporte:', error);
        tbody.innerHTML = `<tr><td colspan="4" class="loading-text">Error al cargar soporte.</td></tr>`;
    }
}

/* ============================================================
   🕵️ MÓDULO DE AUDITORÍA
============================================================ */
async function cargarAuditoria() {
    const tbody = document.getElementById('tabla-auditoria');
    if (!tbody) return;

    try {
        const snap = await getDocs(collection(db, 'cuentas_eliminadas'));
        const cuentas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (cuentas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="loading-text">No hay cuentas eliminadas.</td></tr>`;
            return;
        }

        tbody.innerHTML = cuentas.map(c => `
            <tr>
                <td><strong>${escapeHtml(c.nombre || 'Desconocido')}</strong></td>
                <td>${escapeHtml(c.email || 'Sin email')}</td>
                <td><span class="tipo-${c.tipo === 'comerciante' ? 'comerciante' : 'cliente'}">${escapeHtml(c.tipo || 'cliente')}</span></td>
                <td>${escapeHtml(c.motivo || 'No especificado')}</td>
                <td>${escapeHtml(formatearFechaHora(c.eliminadoEn))}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('❌ Error cargando auditoría:', error);
        tbody.innerHTML = `<tr><td colspan="5" class="loading-text">Error al cargar historial.</td></tr>`;
    }
}

/* ============================================================
   🎯 CONECTAR TABS CON SOPORTE Y AUDITORÍA
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            if (tabId === 'soporte') cargarSoporte();
            if (tabId === 'auditoria') cargarAuditoria();
        });
    });
});

console.log('💬 Módulo de Soporte cargado');
console.log('🕵️ Módulo de Auditoría cargado');


/* ============================================================
   🖱️ CLICK EN TARJETAS DE SERVICIOS PARA FILTRAR TABLA
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const tarjetasServicios = document.querySelectorAll('.services-grid .stat-card[data-filtro]');
    const selectorServicios = document.getElementById('filtro-estado-servicio');

    tarjetasServicios.forEach(tarjeta => {
        tarjeta.addEventListener('click', () => {
            const filtro = tarjeta.getAttribute('data-filtro');

            if (selectorServicios) {
                selectorServicios.value = filtro;

                if (typeof renderizarServicios === 'function') {
                    renderizarServicios();
                }

                document.querySelector('.services-management')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
});


/* ============================================================
   🆕🆕🆕  BLOQUES NUEVOS AGREGADOS — NO BORRAR NADA DE ARRIBA
   ============================================================ */


/* ============================================================
   🖱️ CLICK EN TARJETAS DE PEDIDOS PARA FILTRAR TABLA
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const tarjetasPedidos = document.querySelectorAll('.orders-grid .stat-card[data-filtro]');
    const selectorPedidos = document.getElementById('filtro-estado-pedido');

    tarjetasPedidos.forEach(tarjeta => {
        tarjeta.style.cursor = 'pointer';
        tarjeta.addEventListener('click', () => {
            const filtro = tarjeta.getAttribute('data-filtro');

            if (selectorPedidos) {
                selectorPedidos.value = filtro;

                if (typeof renderizarPedidos === 'function') {
                    renderizarPedidos();
                }

                document.querySelector('.orders-management')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
});


/* ============================================================
   🏷️ BADGE DE PEDIDOS PENDIENTES EN LA PESTAÑA
============================================================ */
function actualizarBadgePendientes() {

    const tabPedidos = document.querySelector('[data-tab="pedidos"]');
    if (!tabPedidos) return;

    const lista = window.pedidosGlobales || pedidosGlobales || [];

    const pendientes = lista.filter(p => {
        const estado = String(p.estado || '').toLowerCase().trim();
        return (
            estado === 'pendiente' ||
            estado === 'pendientes' ||
            estado === 'nuevo'
        );
    });

    const count = pendientes.length;

    // Buscar o crear el badge
    let badge = tabPedidos.querySelector('.badge-pendientes-tab');

    if (count > 0) {

        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-pendientes-tab';
            badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 20px;
                background: #ef4444;
                color: white;
                border-radius: 999px;
                padding: 0 6px;
                font-size: 11px;
                font-weight: 700;
                margin-left: 6px;
                animation: pulse-badge 2s ease-in-out infinite;
                box-shadow: 0 0 0 2px rgba(239,68,68,0.25);
            `;
            tabPedidos.appendChild(badge);
        }

        badge.textContent = count > 99 ? '99+' : count;

    } else if (badge) {
        badge.remove();
    }
}

// Exponer al window
window.actualizarBadgePendientes = actualizarBadgePendientes;


/* ============================================================
   📊 DESGLOSE DE COMERCIANTES POR TIPO
============================================================ */
async function cargarDesgloseComerciantes() {
    try {
        const snap = await getDocs(collection(db, 'tiendas'));

        const tipos = {
            tienda: 0,
            farmacia: 0,
            carniceria: 0,
            licoreria: 0,
            verdureria: 0,
            panaderia: 0,
            restaurante: 0,
            ferreteria: 0,
            minimercado: 0,
            supermercado: 0,
            cafeteria: 0,
            otro: 0
        };

        snap.forEach(docSnap => {
            const data = docSnap.data();
            const tipo = String(
                data.tipoComercio || data.tipo || 'tienda'
            ).toLowerCase().trim();

            if (tipos[tipo] !== undefined) {
                tipos[tipo]++;
            } else {
                tipos.otro++;
            }
        });

        return tipos;
    } catch (error) {
        console.error('Error cargando desglose:', error);
        return null;
    }
}

function renderizarDesgloseComerciantes(tipos) {
    if (!tipos) return;

    const cardsGrid = document.querySelector('#tab-usuarios .cards-grid');
    if (!cardsGrid) return;

    // Eliminar desglose anterior si existe
    document.getElementById('desglose-comerciantes')?.remove();

    const items = [
        { emoji: '🏪', label: 'Tiendas', value: tipos.tienda || 0 },
        { emoji: '💊', label: 'Farmacias', value: tipos.farmacia || 0 },
        { emoji: '🥩', label: 'Carnicerías', value: tipos.carniceria || 0 },
        { emoji: '🍾', label: 'Licorerías', value: tipos.licoreria || 0 },
        { emoji: '🥬', label: 'Verdulerías', value: tipos.verdureria || 0 },
        { emoji: '🥖', label: 'Panaderías', value: tipos.panaderia || 0 },
        { emoji: '🍽️', label: 'Restaurantes', value: tipos.restaurante || 0 },
        { emoji: '🔧', label: 'Ferreterías', value: tipos.ferreteria || 0 },
        { emoji: '🛒', label: 'Minimercados', value: tipos.minimercado || 0 },
        { emoji: '🏬', label: 'Supermercados', value: tipos.supermercado || 0 },
        { emoji: '☕', label: 'Cafeterías', value: tipos.cafeteria || 0 },
        { emoji: '📦', label: 'Otros', value: tipos.otro || 0 }
    ].filter(i => i.value > 0);

    if (!items.length) return;

    const desglose = document.createElement('article');
    desglose.id = 'desglose-comerciantes';
    desglose.className = 'stat-card';
    desglose.style.cssText = `
        grid-column: 1 / -1;
        background: linear-gradient(135deg, #f0fdf4, #dcfce7);
        border: 1px solid #86efac;
    `;

    desglose.innerHTML = `
        <div class="stat-content" style="width:100%;">
            <span class="stat-label" style="font-size:13px;color:#166534;font-weight:700;display:block;margin-bottom:10px;">
                📊 Desglose por tipo de comercio
            </span>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;">
                ${items.map(i => `
                    <div style="background:white;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #d1fae5;transition:transform .2s ease;">
                        <div style="font-size:22px;">${i.emoji}</div>
                        <div style="font-size:22px;font-weight:800;color:#166534;line-height:1.2;">${i.value}</div>
                        <div style="font-size:11px;color:#65a30d;font-weight:600;">${i.label}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    cardsGrid.appendChild(desglose);
}


/* ============================================================
   📅 FILTRO POR FECHA EN PEDIDOS
============================================================ */
function initFiltroFechaPedidos() {
    // Evitar duplicados
    if (document.getElementById('filtro-fecha-pedido')) return;

    const toolbar = document.querySelector('.orders-management .orders-toolbar');
    if (!toolbar) return;

    const select = document.createElement('select');
    select.id = 'filtro-fecha-pedido';
    select.className = 'orders-filter';
    select.innerHTML = `
        <option value="todos">📅 Todas las fechas</option>
        <option value="hoy">Hoy</option>
        <option value="semana">Esta semana</option>
        <option value="mes">Este mes</option>
    `;

    // Insertar dentro del toolbar
    toolbar.appendChild(select);

    select.addEventListener('change', () => {
        if (typeof renderizarPedidos === 'function') {
            renderizarPedidos();
        }
    });
}


/* ============================================================
   🎨 ESTILOS DINÁMICOS (animación badge + hover tarjetas)
============================================================ */
if (!document.getElementById('torre-control-styles-nuevos')) {
    const style = document.createElement('style');
    style.id = 'torre-control-styles-nuevos';
    style.textContent = `
        @keyframes pulse-badge {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.15); }
        }

        .orders-grid .stat-card[data-filtro],
        .services-grid .stat-card[data-filtro] {
            transition: transform .18s ease, box-shadow .18s ease;
        }

        .orders-grid .stat-card[data-filtro]:hover,
        .services-grid .stat-card[data-filtro]:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 22px rgba(7, 137, 93, 0.15);
        }
    `;
    document.head.appendChild(style);
}


/* ============================================================
   🚀 INICIALIZACIÓN DE LOS MÓDULOS NUEVOS
============================================================ */
function initModulosNuevos() {

    // 1) Filtro de fecha
    initFiltroFechaPedidos();

    // 2) Desglose de comerciantes
    cargarDesgloseComerciantes().then(tipos => {
        if (tipos) {
            setTimeout(() => renderizarDesgloseComerciantes(tipos), 500);
        }
    });

    // 3) Badge inicial
    setTimeout(actualizarBadgePendientes, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initModulosNuevos, 1200);
});

// También inicializar cuando el admin esté autenticado
onAuthStateChanged(auth, (user) => {
    if (user) {
        setTimeout(initModulosNuevos, 2000);
    }
});


console.log('✅ NUEVOS MÓDULOS ACTIVADOS:');
console.log('   🖱️ Clic en tarjetas de Pedidos → filtra tabla');
console.log('   🏷️ Badge rojo pulsante en pestaña Pedidos');
console.log('   📊 Desglose de comerciantes por tipo');
console.log('   📅 Filtro de fecha en pedidos (Hoy/Semana/Mes)');
console.log('🏆 Torre de Control lista para producción');

/* ============================================================
   🆕 BLOQUES FINALES PARA CONECTAR CON EL HTML NUEVO
   (CSV, ordenar pedidos, badges de servicios y soporte)
============================================================ */

/* ============================================================
   🏷️ BADGE DE SERVICIOS EN LA PESTAÑA
============================================================ */
function actualizarBadgeServicios() {
    const tabServicios = document.querySelector('[data-tab="servicios"]');
    if (!tabServicios) return;

    const lista = window.serviciosGlobales || serviciosGlobales || [];

    const porVerificar = lista.filter(s => {
        const estado = normalizarEstado(s.estado);
        return (
            estado === 'por verificar' ||
            estado === 'por_verificar' ||
            estado === 'reportado' ||
            estado === 'reportado pago'
        );
    }).length;

    // Buscar o crear el badge
    let badge = tabServicios.querySelector('.badge-servicios-tab');

    if (porVerificar > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-servicios-tab';
            badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 20px;
                background: #f59e0b;
                color: white;
                border-radius: 999px;
                padding: 0 6px;
                font-size: 11px;
                font-weight: 700;
                margin-left: 6px;
                animation: pulse-badge 2s ease-in-out infinite;
            `;
            tabServicios.appendChild(badge);
        }
        badge.textContent = porVerificar > 99 ? '99+' : porVerificar;
    } else if (badge) {
        badge.remove();
    }
}

window.actualizarBadgeServicios = actualizarBadgeServicios;

/* ============================================================
   🏷️ BADGE DE SOPORTE EN LA PESTAÑA
============================================================ */
async function actualizarBadgeSoporte() {
    const tabSoporte = document.querySelector('[data-tab="soporte"]');
    if (!tabSoporte) return;

    try {
        const snap = await getDocs(collection(db, 'soporte_tickets'));
        let abiertos = 0;

        snap.forEach(d => {
            const data = d.data();
            if ((data.estado || 'abierto') === 'abierto') abiertos++;
        });

        let badge = tabSoporte.querySelector('.badge-soporte-tab');

        if (abiertos > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'badge-soporte-tab';
                badge.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 20px;
                    height: 20px;
                    background: #3b82f6;
                    color: white;
                    border-radius: 999px;
                    padding: 0 6px;
                    font-size: 11px;
                    font-weight: 700;
                    margin-left: 6px;
                `;
                tabSoporte.appendChild(badge);
            }
            badge.textContent = abiertos > 99 ? '99+' : abiertos;
        } else if (badge) {
            badge.remove();
        }
    } catch (error) {
        console.warn('Error contando tickets de soporte:', error);
    }
}

window.actualizarBadgeSoporte = actualizarBadgeSoporte;

/* ============================================================
   🖱️ ORDENAR PEDIDOS POR COLUMNA
============================================================ */
window.ordenarPedidos = function (col, dir = 'asc') {
    const ordenarPor = {
        id: p => String(p.id || ''),
        cliente: p => String(
            primerValor(p, ['clienteNombre', 'nombreCliente', 'cliente', 'nombre'], '')
        ).toLowerCase(),
        comerciante: p => String(
            primerValor(p, ['tiendaNombre', 'nombreTienda', 'comercianteNombre', 'nombreComerciante', 'tienda'], '')
        ).toLowerCase(),
        estado: p => obtenerGrupoEstado(p.estado),
        total: p => obtenerTotalPedido(p),
        fecha: p => obtenerFechaPedido(p)?.getTime() || 0
    };

    const fn = ordenarPor[col];
    if (!fn) return;

    pedidosGlobales.sort((a, b) => {
        const va = fn(a);
        const vb = fn(b);
        if (typeof va === 'number' && typeof vb === 'number') {
            return dir === 'asc' ? va - vb : vb - va;
        }
        const cmp = String(va).localeCompare(String(vb));
        return dir === 'asc' ? cmp : -cmp;
    });

    window.pedidosGlobales = pedidosGlobales;
    renderizarPedidos();
};

/* ============================================================
   📥 EXPORTAR PEDIDOS A CSV
============================================================ */
window.exportarPedidosCSV = function () {
    const lista = window.pedidosGlobales || pedidosGlobales || [];

    if (!lista.length) {
        window.showToast?.('⚠️ No hay pedidos para exportar', 'warning');
        return;
    }

    const headers = ['ID', 'Cliente', 'Email', 'Comerciante', 'Estado', 'Total', 'Fecha'];
    const rows = lista.map(p => [
        p.id || '',
        primerValor(p, ['clienteNombre', 'nombreCliente', 'cliente', 'nombre'], ''),
        primerValor(p, ['clienteEmail', 'emailCliente', 'correoCliente', 'email'], ''),
        primerValor(p, ['tiendaNombre', 'nombreTienda', 'comercianteNombre', 'nombreComerciante', 'tienda'], ''),
        textoEstado(p.estado),
        obtenerTotalPedido(p),
        fechaCorta(obtenerFechaPedido(p))
    ]);

    window.exportCSV?.('pedidos.csv', headers, rows);
};

/* ============================================================
   📥 EXPORTAR SERVICIOS A CSV
============================================================ */
window.exportarServiciosCSV = function () {
    const lista = window.serviciosGlobales || serviciosGlobales || [];

    if (!lista.length) {
        window.showToast?.('⚠️ No hay servicios para exportar', 'warning');
        return;
    }

    const headers = ['ID', 'Comerciante', 'Pedido', 'Estado', 'Monto', 'Fecha'];
    const rows = lista.map(s => [
        s.id || '',
        primerValor(s, ['tiendaNombre', 'nombreTienda', 'comercianteNombre', 'nombreComerciante', 'tienda'], ''),
        primerValor(s, ['pedidoId', 'pedidoID', 'idPedido', 'pedido'], ''),
        textoEstadoServicio(normalizarEstado(s.estado)),
        Number(s.monto || 0),
        fechaCorta(timestampToDate(
            s.fechaGenerado || s.creadoEn || s.fecha || s.createdAt
        ))
    ]);

    window.exportCSV?.('servicios.csv', headers, rows);
};

/* ============================================================
   📥 EXPORTAR USUARIOS A CSV
============================================================ */
window.exportarUsuariosCSV = function () {
    const lista = window.todosLosUsuarios || todosLosUsuarios || [];

    if (!lista.length) {
        window.showToast?.('⚠️ No hay usuarios para exportar', 'warning');
        return;
    }

    const headers = ['Nombre', 'Email', 'Tipo', 'UID', 'Estado', 'Fecha registro'];
    const rows = lista.map(u => [
        u.nombre || '',
        u.email || '',
        u.tipo || '',
        u.uid || '',
        u.estado || '',
        formatearFecha(u.fechaRegistro)
    ]);

    window.exportCSV?.('usuarios.csv', headers, rows);
};

/* ============================================================
   🎬 CONTADORES ANIMADOS EN TARJETAS
============================================================ */
window.animarContador = function (el, valorFinal) {
    if (!el) return;
    const numFinal = Number(valorFinal) || 0;
    if (numFinal === 0) {
        el.textContent = '0';
        return;
    }
    const duracion = 600;
    const inicio = performance.now();

    function animar(now) {
        const p = Math.min((now - inicio) / duracion, 1);
        const val = Math.round(numFinal * p);
        el.textContent = val.toLocaleString('es-CO');
        if (p < 1) requestAnimationFrame(animar);
        else el.textContent = numFinal.toLocaleString('es-CO');
    }
    requestAnimationFrame(animar);
};

/* ============================================================
   🔄 ACTUALIZAR BADGES DESPUÉS DE CARGAR SERVICIOS
============================================================ */
const _cargarServiciosOriginal = cargarServicios;
window.cargarServicios = async function () {
    const result = await _cargarServiciosOriginal.apply(this, arguments);
    setTimeout(() => {
        actualizarBadgeServicios();
        actualizarBadgeSoporte();
    }, 200);
    return result;
};

/* ============================================================
   🚀 ARRANCAR BADGES AL INICIO
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        actualizarBadgeServicios();
        actualizarBadgeSoporte();
    }, 2500);
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        setTimeout(() => {
            actualizarBadgeServicios();
            actualizarBadgeSoporte();
        }, 3000);
    }
});

console.log('✅ Bloques finales cargados:');
console.log('   📥 Exportar CSV (pedidos, servicios, usuarios)');
console.log('   🖱️ Ordenar pedidos por columna');
console.log('   🏷️ Badge de servicios y soporte en pestañas');
console.log('   🎬 Contadores animados');