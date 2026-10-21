// public/js/checkout-client.js
// ============================================================
// MI TIENDITA CERCANA
// CLIENTE: CHECKOUT + PEDIDOS + SEGUIMIENTO
// ============================================================
//
// FUNCIONES CONSERVADAS:
//
// ✅ Carrito por tienda
// ✅ Checkout
// ✅ Servicio fijo $800
// ✅ Domicilio desde Firebase
// ✅ Contraentrega
// ✅ Pago online
// ✅ Pago demo
// ✅ Creación de pedidos
// ✅ Seguimiento en tiempo real
// ✅ Confirmar recibido
// ✅ Notificación al comerciante
// ✅ Calificación
// ✅ Nombres de productos
// ✅ Datos del cliente
//
// 🔥 MEJORAS IMPORTANTES:
//
// 1. El tracker NO se queda apareciendo después de confirmar.
// 2. Se limpia lastPedidoId cuando el pedido termina.
// 3. Si el pedido ya tiene clienteConfirmado=true,
//    el tracker se cierra automáticamente.
// 4. No se reanuda un pedido terminado.
// 5. Se evita mantener listeners innecesarios.
// 6. La confirmación del cliente utiliza el endpoint protegido.
// 7. Las notificaciones de cambio de estado no se repiten
//    continuamente.
// 8. Si existe un pedido activo, el cliente puede recibir aviso.
// 9. Si no existe pedido pendiente, NO aparece el cuadrito.
// 10. Se conserva el flujo existente del proyecto.
//
// ============================================================

import { auth, db } from './firebase-config.js';

import {
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  getDoc,
  collection,
  addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ============================================================
// API
// ============================================================

const API_BASE = (() => {
  return (
    window.API_BASE ||
    'https://southamerica-east1-mi-tiendita-cercana.cloudfunctions.net/api'
  );
})();


// ============================================================
// OBTENER TOKEN
// ============================================================

async function getIdToken() {
  const u = auth.currentUser;
  if (!u) {
    throw new Error('Debes iniciar sesión');
  }
  // 🔥 FORZAR ACTUALIZACIÓN DEL TOKEN
  try {
    return await u.getIdToken(true);
  } catch (error) {
    console.warn('Error renovando token, intentando con el actual:', error);
    return await u.getIdToken(false);
  }
}

// ============================================================
// FETCH API
// ============================================================

async function apiFetch(
  path,
  {
    method = 'GET',
    body = null
  } = {}
) {

  const token = await getIdToken();

  const res = await fetch(
    `${API_BASE}${path}`,
    {
      method,

      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },

      body:
        body !== null
          ? JSON.stringify(body)
          : null
    }
  );

  if (!res.ok) {

    const err =
      await res
        .json()
        .catch(() => ({}));

    throw new Error(
      err.error ||
      `Error HTTP ${res.status}`
    );
  }

  return res.json();
}


// ============================================================
// UTILIDADES DOM
// ============================================================

const $ = (
  selector,
  root = document
) => root.querySelector(selector);


const $$ = (
  selector,
  root = document
) =>
  Array.from(
    root.querySelectorAll(selector)
  );


function ensureEl(id, html) {

  let el =
    document.getElementById(id);

  if (!el) {

    const wrap =
      document.createElement('div');

    wrap.innerHTML =
      html.trim();

    el =
      wrap.firstElementChild;

    document.body.appendChild(el);
  }

  return el;
}


// ============================================================
// OBTENER TIENDA ACTIVA
// ============================================================

function getActiveStoreId() {

  try {

    const qs =
      new URLSearchParams(
        location.search
      );

    const fromQS =
      qs.get('tienda') ||
      qs.get('tiendaId') ||
      qs.get('store') ||
      '';

    if (fromQS) {
      return fromQS;
    }

  } catch {}

  return (
    localStorage.getItem(
      'selected_store_uid'
    ) ||

    localStorage.getItem(
      'activeStoreId'
    ) ||

    localStorage.getItem(
      'tiendaActiva'
    ) ||

    localStorage.getItem(
      'mc:last_store'
    ) ||

    ''
  );
}


// ============================================================
// JSON
// ============================================================

function tryJson(str) {

  try {
    return JSON.parse(str);
  } catch {
    return null;
  }

}


// ============================================================
// FORMATO COP
// ============================================================

function formatCOP(v) {

  try {

    return (
      Number(v) || 0
    ).toLocaleString(
      'es-CO',
      {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
      }
    );

  } catch {

    return `$${Number(v) || 0}`;

  }

}


// ============================================================
// 🔥 SERVICIO FIJO
// ============================================================

const SERVICIO_FIJO = 800;


// ============================================================
// CARRITO
// ============================================================

function readCart(tiendaId) {

  const candidates = [

    `mc:cart:${tiendaId}`,

    `cart:${tiendaId}`,

    `carrito:${tiendaId}`,

    `cart_${tiendaId}`,

    `carrito_${tiendaId}`,

    'carrito',

    'cart',

    'cartItems',

    'carritoItems'
  ];


  let raw = null;


  for (const k of candidates) {

    const value =
      localStorage.getItem(k);

    if (!value) {
      continue;
    }

    const parsed =
      tryJson(value);

    if (Array.isArray(parsed)) {

      raw = parsed;

      break;
    }
  }


  if (!Array.isArray(raw)) {
    raw = [];
  }


  const norm =
    raw
      .map(it => {

        const productoId =
          it.productoId ||
          it.id ||
          it.pid ||
          it.productId ||
          it.sku;


        const cantidad =
          Number(
            it.cantidad ??
            it.qty ??
            it.q ??
            1
          ) || 1;


        const precio =
          Number(
            it.precio ??
            it.price ??
            it.p ??
            0
          ) || 0;


        const nombre =
          it.nombre ||
          it.nombreProducto ||
          it.title ||
          it.name ||
          it.descripcion ||
          '';


        const imagen =
          it.imagen ||
          it.image ||
          it.foto ||
          '';


        const unidad =
          it.unit ||
          it.unidad ||
          'und.';


        const unitLabel =
          it.unitLabel ||
          it.unidadLabel ||
          'und.';


        return {

          productoId,

          nombre,

          imagen,

          unidad,

          unitLabel,

          cantidad,

          precio
        };

      })

      .filter(
        it =>
          it.productoId &&
          it.cantidad > 0
      );


  return norm;
}


// ============================================================
// BRIDGE DEL CARRITO
// ============================================================

window.syncCheckoutCart =
  function (
    tiendaId,
    items
  ) {

    const normalized =
      (items || [])

        .map(it => ({

          productoId:
            it.productoId ||
            it.id ||
            it.pid ||
            it.productId ||
            it.sku,

          cantidad:
            Number(
              it.cantidad ??
              it.qty ??
              1
            ) || 1,

          precio:
            Number(
              it.precio ??
              it.price ??
              0
            ) || 0,

          nombre:
            it.nombre ||
            it.title ||
            it.name ||
            it.productoNombre ||
            '',

          imagen:
            it.imagen ||
            it.image ||
            it.foto ||
            '',

          unidad:
            it.unit ||
            it.unidad ||
            'und.',

          unitLabel:
            it.unitLabel ||
            it.unidadLabel ||
            'und.'

        }))

        .filter(
          x =>
            x.productoId &&
            x.cantidad > 0
        );


    try {

      if (tiendaId) {

        localStorage.setItem(
          'mc:last_store',
          tiendaId
        );

      }

      localStorage.setItem(
        `mc:cart:${tiendaId}`,
        JSON.stringify(
          normalized
        )
      );

    } catch {}

  };


// ============================================================
// LECTURA DIRECTA DEL CARRITO
// ============================================================

window.__getCartForCheckout =
  function () {

    const tiendaId =
      getActiveStoreId();

    const raw =
      localStorage.getItem(
        `mc:cart:${tiendaId}`
      );

    try {

      return JSON.parse(
        raw || '[]'
      );

    } catch {

      return [];

    }
  };


// ============================================================
// DOMICILIO
// ============================================================

async function getDomicilioConfig(
  tiendaId
) {

  try {

    const docRef =
      doc(
        db,
        'tiendas',
        tiendaId
      );

    const snap =
      await getDoc(docRef);


    if (!snap.exists()) {

      return {
        activo: false,
        costo: 0,
        coberturaKm: 2
      };

    }


    const data =
      snap.data();


    return (
      data.domicilio || {
        activo: false,
        costo: 0,
        coberturaKm: 2
      }
    );

  } catch (error) {

    console.warn(
      'Error obteniendo configuración de domicilio:',
      error
    );

    return {
      activo: false,
      costo: 0,
      coberturaKm: 2
    };
  }
}


// ============================================================
// ESTILOS
// ============================================================

const BASE_CSS = `

#checkout-modal,
#order-tracker {
  font-family:
    system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    'Helvetica Neue',
    Arial,
    'Noto Sans',
    sans-serif;

  z-index: 9999;
}


#checkout-modal {

  position: fixed;

  inset: 0;

  display: none;

  align-items: center;

  justify-content: center;

  background:
    rgba(17,24,39,.45);
}


#checkout-card {

  width:
    min(560px, 92vw);

  background: #fff;

  border-radius: 16px;

  box-shadow:
    0 10px 30px
    rgba(0,0,0,.18);

  overflow: hidden;
}


#checkout-card header {

  padding:
    14px 16px;

  border-bottom:
    1px solid #e5e7eb;

  display: flex;

  align-items: center;

  justify-content:
    space-between;
}


#checkout-card header h3 {

  margin: 0;

  font-weight: 700;

  font-size: 18px;
}


#checkout-card .body {

  padding: 16px;

  max-height: 60vh;

  overflow: auto;
}


#checkout-card .row {

  display: flex;

  justify-content:
    space-between;

  margin: 8px 0;
}


#checkout-card .total {

  font-weight: 800;

  font-size: 18px;
}


#checkout-card footer {

  padding:
    14px 16px;

  border-top:
    1px solid #e5e7eb;

  display: flex;

  gap: 10px;

  justify-content:
    flex-end;

  flex-wrap: wrap;
}


#checkout-close {

  background: none;

  border: none;

  font-size: 20px;

  cursor: pointer;
}


#btn-pagar-ahora {

  position: fixed;

  right: 16px;

  bottom: 16px;

  padding:
    14px 18px;

  border-radius: 999px;

  border: none;

  cursor: pointer;

  background: #10b981;

  color: white;

  font-weight: 800;

  box-shadow:
    0 8px 20px
    rgba(16,185,129,.35);
}


#btn-pagar-ahora:disabled {

  opacity: .55;

  cursor: not-allowed;
}


/*
============================================================
TRACKER
============================================================
*/

#order-tracker {

  position: fixed;

  left: 16px;

  bottom: 16px;

  width:
    min(380px, 92vw);

  background: #fff;

  border:
    1px solid #e5e7eb;

  border-radius: 14px;

  box-shadow:
    0 8px 26px
    rgba(0,0,0,.14);

  display: none;

  overflow: hidden;
}


#order-tracker .hd {

  padding:
    12px 14px;

  border-bottom:
    1px solid #e5e7eb;

  display: flex;

  justify-content:
    space-between;

  align-items: center;
}


#order-tracker .hd strong {

  font-weight: 800;
}


#order-tracker .bd {

  padding:
    12px 14px;
}


#order-tracker .status {

  font-weight: 600;

  margin-bottom: 8px;
}


.progress {

  width: 100%;

  height: 8px;

  background: #f3f4f6;

  border-radius: 999px;

  overflow: hidden;
}


.progress > div {

  height: 100%;

  width: 0%;

  background: #10b981;

  transition:
    width .4s ease;
}


.small {

  color: #6b7280;

  font-size: 12px;
}


.badge {

  display: inline-flex;

  align-items: center;

  gap: 6px;

  padding:
    6px 10px;

  background: #ecfeff;

  color: #0ea5e9;

  border-radius: 999px;

  font-size: 12px;

  font-weight: 700;
}


#ot-confirm {

  margin-top: 10px;

  width: 100%;

  padding:
    10px 12px;

  border-radius: 10px;

  border: none;

  cursor: pointer;

  background: #10b981;

  color: #fff;

  font-weight: 800;
}


#ot-confirm:disabled {

  opacity: .55;

  cursor: not-allowed;
}


/*
============================================================
AVISO DE PEDIDO
============================================================
*/

#mc-order-notice {

  position: fixed;

  right: 20px;

  top: 20px;

  z-index: 100000;

  width:
    min(360px, 90vw);

  background: #fff;

  border:
    1px solid #e5e7eb;

  border-radius: 14px;

  box-shadow:
    0 12px 35px
    rgba(0,0,0,.16);

  padding: 14px 16px;

  display: none;
}


#mc-order-notice strong {

  display: block;

  margin-bottom: 4px;
}


#mc-order-notice span {

  color: #6b7280;

  font-size: 13px;
}

`;


// ============================================================
// INYECTAR CSS
// ============================================================

(function injectCSS() {

  if (
    !document.getElementById(
      'checkout-client-styles'
    )
  ) {

    const tag =
      document.createElement(
        'style'
      );

    tag.id =
      'checkout-client-styles';

    tag.textContent =
      BASE_CSS;

    document.head.appendChild(
      tag
    );
  }

})();


// ============================================================
// MODAL CHECKOUT
// ============================================================

ensureEl(
  'checkout-modal',
  `
  <div id="checkout-modal"
       aria-modal="true"
       role="dialog">

    <div id="checkout-card"
         role="document">

      <header>

        <h3>
          Confirmar pedido
        </h3>

        <button
          id="checkout-close"
          title="Cerrar">
          ×
        </button>

      </header>


      <div class="body">

        <div class="row">
          <span>Artículos</span>
          <span id="ck-items-count">
            0
          </span>
        </div>


        <div
          id="ck-items-list"
          class="small"
          style="
            max-height:160px;
            overflow:auto;
            border:1px dashed #e5e7eb;
            border-radius:10px;
            padding:8px;
            margin:8px 0;
          ">
        </div>


        <div class="row">
          <span>Subtotal</span>
          <span id="ck-subtotal">
            $0
          </span>
        </div>


        <div class="row">
          <span>Envío</span>
          <span id="ck-envio">
            $0
          </span>
        </div>


        <div class="row">
          <span>Servicio</span>
          <span id="ck-appfee">
            $0
          </span>
        </div>


        <div class="row total">
          <span>Total</span>
          <span id="ck-total">
            $0
          </span>
        </div>


        <div style="margin-top:12px">

          <div
            class="small"
            style="
              font-weight:700;
              margin-bottom:6px;
            ">
            Método de pago
          </div>


          
          <label
            style="margin-right:10px">

            <input
              type="radio"
              name="paymethod"
              value="contraentrega"
              checked>

            Contra entrega

          </label>


          <label>

            <input
              type="radio"
              name="paymethod"
              value="transferencia">

            Transferencia

          </label>

        </div>

      </div>


      <footer>

        <button
          id="btn-cancelar"
          class="btn btn-secondary">

          Cancelar

        </button>


        <button
          id="btn-confirmar"
          class="btn btn-primary"
          style="
            background:#10b981;
            color:#fff;
            border:none;
            border-radius:10px;
            padding:10px 14px;
            font-weight:800;
          ">

          Confirmar pedido

        </button>

      </footer>

    </div>

  </div>
  `
);


// ============================================================
// TRACKER
// ============================================================

ensureEl(
  'order-tracker',
  `
  <div
    id="order-tracker"
    aria-live="polite">

    <div class="hd">

      <div>

        <strong>
          Seguimiento
        </strong>

        <div
          id="ot-id"
          class="small">
        </div>

      </div>


      <button
        id="ot-close"
        title="Ocultar"
        style="
          background:none;
          border:none;
          font-size:18px;
          cursor:pointer;
        ">

        ×

      </button>

    </div>


    <div class="bd">

      <div
        id="ot-status"
        class="status">

        Esperando estado...

      </div>


      <div
        id="ot-eta"
        class="small">
      </div>


      <div
        class="progress"
        style="margin-top:8px">

        <div
          id="ot-bar">
        </div>

      </div>


      <div
        id="ot-note"
        class="small"
        style="margin-top:8px">
      </div>


      <button
        id="ot-confirm"
        style="display:none">

        📦 Confirmar recibido

      </button>

    </div>

  </div>
  `
);


// ============================================================
// AVISO DE PEDIDO
// ============================================================

ensureEl(
  'mc-order-notice',
  `
  <div
    id="mc-order-notice"
    role="status"
    aria-live="polite">

    <strong id="mc-order-notice-title">
      Pedido
    </strong>

    <span id="mc-order-notice-text">
    </span>

  </div>
  `
);


// ============================================================
// BOTÓN PAGAR
// ============================================================

if (
  !document.getElementById(
    'btn-pagar-ahora'
  )
) {

  const btn =
    document.createElement(
      'button'
    );

  btn.id =
    'btn-pagar-ahora';

  btn.textContent =
    'Pagar ahora';

  document.body.appendChild(
    btn
  );
}


// ============================================================
// CERRAR ELEMENTOS
// ============================================================

$('#checkout-close')
  ?.addEventListener(
    'click',
    () => {

      $('#checkout-modal')
        .style.display =
        'none';

    }
  );


$('#btn-cancelar')
  ?.addEventListener(
    'click',
    () => {

      $('#checkout-modal')
        .style.display =
        'none';

    }
  );


$('#ot-close')
  ?.addEventListener(
    'click',
    () => {

      const tracker =
        $('#order-tracker');

      if (tracker) {
        tracker.style.display =
          'none';
      }

    }
  );


// ============================================================
// RENDER ITEMS
// ============================================================

function renderItemsList(
  items
) {

  const list =
    items
      .map(it => {

        const qty =
          Number(
            it.cantidad || 1
          );

        const price =
          Number(
            it.precio || 0
          );


        let nombre =
          it.nombre ||
          it.nombreProducto ||
          it.title ||
          it.name ||
          '';


        if (
          !nombre &&
          it.productoId &&
          window.cacheProductos
        ) {

          const encontrado =
            window.cacheProductos
              .find(
                p =>
                  p.id ===
                  it.productoId
              );


          if (encontrado) {

            nombre =
              encontrado.nombre ||
              encontrado.nombreBase ||
              'Producto';

          }

        }


        if (!nombre) {

          nombre =
            it.productoId ||
            'Producto sin nombre';

        }


        return `

          <div
            style="
              display:flex;
              justify-content:space-between;
            ">

            <span>
              ${qty}× ${nombre}
            </span>

            <span>
              ${formatCOP(
                qty * price
              )}
            </span>

          </div>

        `;

      })
      .join('');


  $('#ck-items-list')
    .innerHTML =
      list ||
      '<em class="small">No hay artículos</em>';


  $('#ck-items-count')
    .textContent =
      String(items.length);
}


// ============================================================
// ABRIR CHECKOUT
// ============================================================

async function openCheckout(
  opts = {}
) {

  const skipModal =
    !!opts.skipModal ||
    window.PAGAR_DIRECTO === true;


  const tiendaId =
    getActiveStoreId();


  if (!tiendaId) {

    alert(
      'Primero elige una tienda.'
    );

    return;
  }


  const items =
    readCart(tiendaId);


  if (!items.length) {

    alert(
      'Tu carrito está vacío.'
    );

    return;
  }


  // ==========================================================
  // DOMICILIO
  // ==========================================================

  const domicilioConfig =
    await getDomicilioConfig(
      tiendaId
    );


  let costoDomicilio = 0;

  let textoDomicilio =
    'No disponible';


  if (
    domicilioConfig.activo
  ) {

    costoDomicilio =
      Number(
        domicilioConfig.costo || 0
      );


    textoDomicilio =
      costoDomicilio === 0
        ? 'GRATIS'
        : formatCOP(
            costoDomicilio
          );

  } else {

    textoDomicilio =
      'No ofrece domicilio';

  }


  // ==========================================================
  // CÁLCULOS
  // ==========================================================

  let subtotal =
    items.reduce(
      (s, it) =>
        s +
        (
          Number(
            it.precio || 0
          ) *
          Number(
            it.cantidad || 0
          )
        ),
      0
    );


  let appFee =
    SERVICIO_FIJO;


  let envioPreview =
    costoDomicilio;


  let total =
    subtotal +
    appFee +
    envioPreview;


  // ==========================================================
  // COTIZACIÓN BACKEND SI EXISTE
  // ==========================================================

  try {

    const quote =
      await apiFetch(
        '/fees/quote',
        {
          method: 'POST',

          body: {
            items,
            tiendaId
          }
        }
      );


    subtotal =
      quote.breakdown?.subtotal ??
      subtotal;


    appFee =
      SERVICIO_FIJO;


    envioPreview =
      costoDomicilio;


    total =
      subtotal +
      appFee +
      envioPreview;

  } catch {

    // Endpoint opcional.
    // Continuamos con cálculo local.

  }


  // ==========================================================
  // PAGO DIRECTO
  // ==========================================================

  if (skipModal) {

    await crearPedidoYSeguir({

      tiendaId,

      items,

      metodo:
        'contraentrega',

      envio:
        envioPreview,

      servicio:
        appFee

    });

    return;
  }


  // ==========================================================
  // MOSTRAR MODAL
  // ==========================================================

  renderItemsList(items);


  $('#ck-subtotal')
    .textContent =
    formatCOP(subtotal);


  const envioDisplay =
    domicilioConfig.activo

      ? (
          costoDomicilio === 0
            ? 'GRATIS'
            : formatCOP(
                envioPreview
              )
        )

      : 'Gratis';


  $('#ck-envio')
    .textContent =
    envioDisplay;


  $('#ck-envio')
    .style.color =
    domicilioConfig.activo
      ? '#10b981'
      : '#ef4444';


  $('#ck-appfee')
    .textContent =
    formatCOP(appFee);


  $('#ck-total')
    .textContent =
    formatCOP(total);


  $('#checkout-modal')
    .style.display =
    'flex';


  // ==========================================================
  // CONFIRMAR PEDIDO
  // ==========================================================

  $('#btn-confirmar').onclick =
    async () => {

      const metodo =
        (
          document.querySelector(
            'input[name="paymethod"]:checked'
          )?.value
        ) ||
        'contraentrega';


      const itemsConNombre =
        items.map(it => {

          let nombre =
            it.nombre ||
            it.nombreProducto ||
            it.title ||
            it.name ||
            '';


          if (
            !nombre &&
            it.productoId &&
            window.cacheProductos
          ) {

            const encontrado =
              window.cacheProductos
                .find(
                  p =>
                    p.id ===
                    it.productoId
                );


            if (encontrado) {

              nombre =
                encontrado.nombre ||
                encontrado.nombreBase ||
                'Producto';

            }

          }


          if (!nombre) {

            nombre =
              it.productoId ||
              'Producto sin nombre';

          }


          return {

            ...it,

            nombre

          };

        });


      await crearPedidoYSeguir({

        tiendaId,

        items:
          itemsConNombre,

        metodo,

        envio:
          envioPreview,

        servicio:
          appFee

      });

    };
}


// ============================================================
// CREAR PEDIDO
// ============================================================

async function crearPedidoYSeguir({

  tiendaId,

  items,

  metodo,

  envio,

  servicio

}) {

  try {

    if ($('#btn-confirmar')) {

      $('#btn-confirmar')
        .disabled = true;

    }


    // ========================================================
    // ASEGURAR NOMBRES
    // ========================================================

    const itemsConNombre =
      items.map(it => {

        let nombre =
          it.nombre ||
          it.nombreProducto ||
          it.title ||
          it.name ||
          '';


        if (
          !nombre &&
          window.cacheProductos
        ) {

          const encontrado =
            window.cacheProductos
              .find(
                p =>
                  p.id ===
                  it.productoId
              );


          if (encontrado) {

            nombre =
              encontrado.nombre ||
              encontrado.nombreBase ||
              'Producto';

          }

        }


        if (!nombre) {

          nombre =
            it.productoId ||
            'Producto sin nombre';

        }


        return {

          productoId:
            it.productoId,

          cantidad:
            Number(
              it.cantidad || 1
            ),

          precio:
            Number(
              it.precio || 0
            ),

          nombre,

          imagen:
            it.imagen || '',

          unidad:
            it.unidad ||
            'und.',

          unitLabel:
            it.unitLabel ||
            'und.'

        };

      });


    // ========================================================
    // SUBTOTAL / TOTAL
    // ========================================================

    const subtotal =
      itemsConNombre.reduce(
        (s, it) =>
          s +
          (
            Number(
              it.precio || 0
            ) *
            Number(
              it.cantidad || 0
            )
          ),
        0
      );


    const total =
      subtotal +
      Number(servicio || 0) +
      Number(envio || 0);


    // ========================================================
    // USUARIO
    // ========================================================

    const user =
      auth.currentUser;


    if (!user) {

      throw new Error(
        'Debes iniciar sesión para crear el pedido'
      );

    }


    const uid =
      user.uid;


    // ========================================================
    // DATOS CLIENTE
    // ========================================================

    const clienteNombre =
      user.displayName ||
      'Cliente';


    const clienteEmail =
      user.email ||
      '';


    const clienteTelefono =
      user.phoneNumber ||
      'No especificado';


    const clienteDireccion =
      'No especificada';


    // ========================================================
    // CREAR PEDIDO EN BACKEND
    // ========================================================

    const resp =
      await apiFetch(
        '/pedidos',
        {
          method: 'POST',

          body: {

            tiendaId,

            items:
              itemsConNombre,

            subtotal,
            envio,
            servicio,
            total,
            metodoPago: metodo, 
              uid,

            clienteId:
              uid,

            clienteNombre,

            clienteEmail,

            clienteTelefono,

            clienteDireccion

          }

        }
      );


    const pedidoId =
      resp.id;


    if (!pedidoId) {

      throw new Error(
        'El servidor no devolvió el ID del pedido'
      );

    }
        // 🔥 GUARDAR EL MÉTODO DE PAGO DIRECTAMENTE EN FIRESTORE
    try {
      await updateDoc(doc(db, 'pedidos', pedidoId), {
        metodoPago: metodo
      });
      console.log('✅ Método de pago guardado directamente en Firestore:', metodo);
    } catch (err) {
      console.warn('⚠️ No se pudo guardar el método de pago en Firestore:', err);
    }

    // ========================================================
    // CERRAR CHECKOUT
    // ========================================================

    if ($('#checkout-modal')) {

      $('#checkout-modal')
        .style.display =
        'none';

    }


    // ========================================================
    // GUARDAR PEDIDO ACTIVO
    // ========================================================

    sessionStorage.setItem(
      'lastPedidoId',
      pedidoId
    );


    sessionStorage.setItem(
      'lastTiendaId',
      tiendaId
    );


    // ========================================================
    // LIMPIAR CARRITO
    // ========================================================

    try {

      localStorage.setItem(
        `mc:cart:${tiendaId}`,
        '[]'
      );

      localStorage.setItem(
        `cart:${tiendaId}`,
        '[]'
      );

      localStorage.setItem(
        `carrito:${tiendaId}`,
        '[]'
      );

      localStorage.setItem(
        'cart',
        '[]'
      );

      localStorage.setItem(
        'carrito',
        '[]'
      );

    } catch {}


    // ========================================================
    // INICIAR SEGUIMIENTO
    // ========================================================

    startOrderTracker(
      pedidoId,
      {
        forceShow: true
      }
    );


    toast(
      '✅ Pedido enviado. La tienda lo estará revisando.'
    );


    // ========================================================
    // PAGO ONLINE
    // ========================================================

    if (
      metodo === 'online'
    ) {

      try {

        await pagarOnline(
          pedidoId
        );

        return;

      } catch (e) {

        alert(
          'No se pudo iniciar el pago online: ' +
          (
            e?.message ||
            e
          )
        );

      }

    }


    // ========================================================
    // PAGO DEMO
    // ========================================================

    else if (
      metodo === 'demo'
    ) {

      try {

        await apiFetch(
          `/pedidos/${pedidoId}/pay-demo`,
          {
            method: 'POST'
          }
        );


        toast(
          '💳 Pago (demo) confirmado'
        );

      } catch (e) {

        console.warn(
          'pay-demo error',
          e
        );

      }

    }

  } catch (e) {

    console.error(
      'Error creando pedido:',
      e
    );


    alert(
      'No se pudo crear el pedido: ' +
      e.message
    );

  } finally {

    if ($('#btn-confirmar')) {

      $('#btn-confirmar')
        .disabled = false;

    }

  }
}


// ============================================================
// PAGO ONLINE
// ============================================================

async function pagarOnline(
  pedidoId
) {

  const resp =
    await apiFetch(
      `/pedidos/${pedidoId}/pay`,
      {
        method: 'POST',

        body: {
          metodo: 'online'
        }
      }
    );


  const url =
    resp?.redirectUrl ||
    resp?.checkoutUrl ||
    resp?.paymentUrl ||
    resp?.url;


  if (!url) {

    throw new Error(
      'Backend no devolvió URL de pasarela'
    );

  }


  window.location.href =
    url;
}


// ============================================================
// ESTADO GLOBAL DEL TRACKER
// ============================================================

let currentPedidoId = null;

let unsubPedido = null;

let trackerState = null;

let trackerInitialized = false;

let noticeTimer = null;


// ============================================================
// LIMPIAR SEGUIMIENTO
// ============================================================

function limpiarSeguimiento(
  pedidoId = null
) {

  try {

    const saved =
      sessionStorage.getItem(
        'lastPedidoId'
      );


    if (
      !pedidoId ||
      saved === pedidoId
    ) {

      sessionStorage.removeItem(
        'lastPedidoId'
      );

      sessionStorage.removeItem(
        'lastTiendaId'
      );

    }

  } catch {}


  currentPedidoId = null;

  trackerState = null;

  trackerInitialized = false;


  const tracker =
    document.getElementById(
      'order-tracker'
    );


  if (tracker) {

    tracker.style.display =
      'none';

  }


  if (unsubPedido) {

    try {
      unsubPedido();
    } catch {}

    unsubPedido = null;

  }
}


// ============================================================
// MOSTRAR AVISO
// ============================================================

function showOrderNotice(
  title,
  text
) {

  const notice =
    document.getElementById(
      'mc-order-notice'
    );


  const titleEl =
    document.getElementById(
      'mc-order-notice-title'
    );


  const textEl =
    document.getElementById(
      'mc-order-notice-text'
    );


  if (
    !notice ||
    !titleEl ||
    !textEl
  ) {
    return;
  }


  titleEl.textContent =
    title || 'Pedido';


  textEl.textContent =
    text || '';


  notice.style.display =
    'block';


  clearTimeout(
    noticeTimer
  );


  noticeTimer =
    setTimeout(
      () => {

        notice.style.display =
          'none';

      },
      4500
    );
}


// ============================================================
// AVISO DE ESTADO SIN REPETICIONES
// ============================================================

function notifyStateOnce(
  pedidoId,
  estado
) {

  if (!pedidoId || !estado) {
    return;
  }


  const key =
    `mc:last-notified-state:${pedidoId}`;


  const previous =
    sessionStorage.getItem(
      key
    );


  // Primera lectura:
  // no hacemos ruido.
  if (!previous) {

    sessionStorage.setItem(
      key,
      estado
    );

    return;
  }


  if (previous === estado) {

    return;
  }


  sessionStorage.setItem(
    key,
    estado
  );


  const messages = {

    pendiente:
      [
        'Pedido recibido',
        'La tienda está revisando tu pedido.'
      ],

    aceptado:
      [
        'Pedido aceptado',
        'La tienda está preparando tu pedido.'
      ],

    en_preparacion:
      [
        'Pedido en preparación',
        'Tu pedido está siendo preparado.'
      ],

    listo:
      [
        'Pedido listo',
        'Tu pedido está listo para continuar.'
      ],

    enviado:
      [
        '📦 Pedido enviado',
        'Cuando lo recibas, confirma la recepción.'
      ],

    entregado:
      [
        '📦 Pedido entregado',
        'Confirma cuando tengas el pedido.'
      ],

    recibido:
      [
        '✅ Pedido recibido',
        'El pedido fue confirmado.'
      ],

    cancelado:
      [
        'Pedido cancelado',
        'Este pedido ya no requiere seguimiento.'
      ],

    expirado:
      [
        'Pedido expirado',
        'Este pedido ya no requiere seguimiento.'
      ]

  };


  const msg =
    messages[estado];


  if (msg) {

    showOrderNotice(
      msg[0],
      msg[1]
    );

  }
}


// ============================================================
// STEPS
// ============================================================

const STEPS = [

  'pendiente',

  'aceptado',

  'en_preparacion',

  'listo',

  'enviado',

  'entregado',

  'recibido'

];


// ============================================================
// LABELS
// ============================================================

const LABELS = {

  pendiente:
    'Pedido recibido. La tienda está revisando.',

  aceptado:
    '¡Aceptado! Estamos preparando tu pedido.',

  en_preparacion:
    'En preparación...',

  listo:
    '¡Tu pedido está listo!',

  enviado:
    '📦 Pedido enviado. ¡Confirma cuando llegue!',

  entregado:
    '📦 Pedido entregado. Confirma la recepción.',

  recibido:
    '✅ Recibido por el cliente',

  cancelado:
    'Pedido cancelado.',

  expirado:
    'El pedido no fue atendido a tiempo.'

};


// ============================================================
// 🔥 CONFIRMAR RECIBIDO
// ============================================================

// ============================================================
// 🔥 CONFIRMAR RECIBIDO
// ============================================================

// ============================================================
// 🔥 CONFIRMAR RECIBIDO
// ============================================================

async function confirmarRecibido(
  pedidoId
) {

  if (!pedidoId) {
    return;
  }

  // ==========================================================
  // 🔥 VERIFICAR AUTENTICACIÓN ANTES DE CONTINUAR
  // ==========================================================
  const user = auth.currentUser;
  if (!user) {
    alert('⚠️ Tu sesión ha expirado. Por favor, inicia sesión nuevamente.');
    // Redirigir al login si es necesario
    if (window.location.pathname.includes('panel-cliente') || window.location.pathname.includes('checkout')) {
      window.location.href = '/index.html';
    }
    return;
  }

  // Verificar que el token sigue siendo válido
  try {
    await user.getIdToken(true); // Forzar actualización del token
  } catch (error) {
    alert('⚠️ Error de autenticación. Por favor, inicia sesión nuevamente.');
    if (window.location.pathname.includes('panel-cliente') || window.location.pathname.includes('checkout')) {
      window.location.href = '/index.html';
    }
    return;
  }

  // ==========================================================
  // EVITAR DOBLE CONFIRMACIÓN
  // ==========================================================

  if (
    currentPedidoId !== pedidoId &&
    !sessionStorage.getItem(
      'lastPedidoId'
    )
  ) {

    return;

  }


  if (
    !confirm(
      '✅ ¿Confirmas que recibiste tu pedido?\n\n' +
      'Al confirmar, el comerciante sabrá que recibiste el pedido.'
    )
  ) {

    return;

  }


  const btnOk =
    document.getElementById(
      'ot-confirm'
    );


  if (btnOk) {

    btnOk.disabled =
      true;

    btnOk.textContent =
      'Confirmando...';

  }


  try {

    // ========================================================
    // 🔥 CONFIRMACIÓN SEGURA EN BACKEND
    // ========================================================

    const response =
      await apiFetch(
        `/pedidos/${pedidoId}/confirmar-recibido`,
        {
          method: 'POST'
        }
      );


    if (
      !response ||
      response.ok !== true
    ) {

      throw new Error(
        'El servidor no confirmó el pedido'
      );

    }


    // ========================================================
    // OBTENER PEDIDO PARA TIENDA
    // ========================================================

    let tiendaId = null;


    try {

      const ref =
        doc(
          db,
          'pedidos',
          pedidoId
        );


      const snap =
        await getDoc(ref);


      if (snap.exists()) {

        const pedido =
          snap.data() || {};


        tiendaId =
          pedido.tiendaId ||
          null;

      }

    } catch (readError) {

      console.warn(
        'No se pudo leer tiendaId después de confirmar:',
        readError
      );

    }


    // ========================================================
    // 🔥 NOTIFICAR AL COMERCIANTE
    // ========================================================

    if (tiendaId) {

      try {

        const notifRef =
          collection(
            db,
            'notificaciones',
            tiendaId,
            'items'
          );


        await addDoc(
          notifRef,
          {

            tipo:
              'cliente_confirmo',

            pedidoId,

            titulo:
              '🎉 Cliente confirmó recepción',

            mensaje:
              `El cliente confirmó que recibió el pedido #${pedidoId
                .slice(-6)
                .toUpperCase()}`,

            visto:
              false,

            createdAt:
              serverTimestamp()

          }
        );


        console.log(
          '📨 Notificación guardada para el comerciante'
        );

      } catch (notifError) {

        console.warn(
          'No se pudo guardar la notificación del comerciante:',
          notifError
        );

      }

    }


    // ========================================================
    // 🔥 LIMPIAR TRACKER INMEDIATAMENTE
    // ========================================================

    limpiarSeguimiento(
      pedidoId
    );


    // Limpiar también claves de estado
    try {

      sessionStorage.removeItem(
        `mc:last-notified-state:${pedidoId}`
      );

    } catch {}


    toast(
      '✅ ¡Pedido confirmado como recibido!'
    );


    // ========================================================
    // ACTUALIZAR MIS PEDIDOS
    // ========================================================

    if (
      typeof window.recargarMisPedidos ===
      'function'
    ) {

      setTimeout(
        () => {

          try {

            window.recargarMisPedidos();

          } catch (e) {

            console.warn(
              'Error recargando pedidos:',
              e
            );

          }

        },
        300
      );

    }


    // ========================================================
    // CALIFICACIÓN
    // ========================================================

    if (tiendaId) {

      setTimeout(
        () => {

          abrirCalificacion(
            pedidoId,
            tiendaId
          );

        },
        800
      );

    }

  } catch (error) {

    console.error(
      'Error confirmando recepción:',
      error
    );


    toast(
      '❌ No se pudo confirmar: ' +
      (
        error?.message ||
        'Error desconocido'
      )
    );


    if (btnOk) {

      btnOk.disabled =
        false;

      btnOk.textContent =
        '📦 Confirmar recibido';

    }

  }

}
// ============================================================
// EXPONER CONFIRMACIÓN
// ============================================================

window.confirmarRecibido =
  confirmarRecibido;


// ============================================================
// BOTÓN CONFIRMAR
// ============================================================

document
  .getElementById(
    'ot-confirm'
  )
  ?.addEventListener(
    'click',
    () => {

      if (
        currentPedidoId
      ) {

        confirmarRecibido(
          currentPedidoId
        );

      }

    }
  );


// ============================================================
// 🔥 START ORDER TRACKER
// ============================================================

function startOrderTracker(
  pedidoId,
  options = {}
) {

  if (!pedidoId) {
    return;
  }


  const forceShow =
    options.forceShow === true;


  // ==========================================================
  // EVITAR DUPLICAR LISTENER
  // ==========================================================

  if (
    currentPedidoId === pedidoId &&
    unsubPedido
  ) {

    return;

  }


  // ==========================================================
  // DETENER TRACKER ANTERIOR
  // ==========================================================

  if (unsubPedido) {

    try {
      unsubPedido();
    } catch {}

    unsubPedido = null;
  }


  currentPedidoId =
    pedidoId;


  trackerState =
    null;


  trackerInitialized =
    false;


  const tracker =
    document.getElementById(
      'order-tracker'
    );


  if (!tracker) {
    return;
  }


  // ==========================================================
  // IMPORTANTE:
  // NO MOSTRAMOS EL CUADRO TODAVÍA.
  //
  // Primero consultamos Firestore.
  // Esto evita mostrar un pedido ya confirmado.
  // ==========================================================

  tracker.style.display =
    'none';


  // ==========================================================
  // LISTENER EN TIEMPO REAL
  // ==========================================================

  unsubPedido =
    onSnapshot(

      doc(
        db,
        'pedidos',
        pedidoId
      ),

      (snap) => {

        // ====================================================
        // PEDIDO YA NO EXISTE
        // ====================================================

        if (!snap.exists()) {

          console.log(
            '📦 Pedido ya no existe:',
            pedidoId
          );


          limpiarSeguimiento(
            pedidoId
          );


          return;
        }


        const p =
          snap.data() || {};


        const estado =
          String(
            p.estado ||
            'pendiente'
          )
            .toLowerCase()
            .trim();


        // ====================================================
        // 🔥 REGLA PRINCIPAL
        //
        // SI EL CLIENTE YA CONFIRMÓ:
        //
        // NO MOSTRAR
        // NO AVISAR
        // NO REANUDAR
        // NO DEJAR LISTENER
        // ====================================================

        if (
          p.clienteConfirmado === true
        ) {

          console.log(
            '✅ Pedido ya confirmado por cliente:',
            pedidoId
          );


          limpiarSeguimiento(
            pedidoId
          );


          return;
        }


        // ====================================================
        // PEDIDOS TERMINADOS SIN ACCIÓN
        // ====================================================

        if (
          estado === 'cancelado' ||
          estado === 'expirado'
        ) {

          console.log(
            '📦 Pedido terminado:',
            estado
          );


          limpiarSeguimiento(
            pedidoId
          );


          return;
        }


        // ====================================================
        // PEDIDO ACTIVO
        // ====================================================

        tracker.style.display =
          'block';


        $('#ot-id').textContent =
          `ID: ${pedidoId
            .slice(-6)
            .toUpperCase()}`;


        // ====================================================
        // PROGRESO
        // ====================================================

        const eta =
          Number(
            p.etaMin ||
            p.tiempoEsperaMin ||
            0
          );


        const stepIdx =
          Math.max(
            0,
            STEPS.indexOf(
              estado
            )
          );


        const progress =
          Math.round(
            (
              stepIdx /
              (
                STEPS.length - 1
              )
            ) *
            100
          );


        $('#ot-status')
          .textContent =
          LABELS[estado] ||
          `Estado: ${estado}`;


        $('#ot-bar')
          .style.width =
          `${progress}%`;


        // ====================================================
        // ETA
        // ====================================================

        if (
          estado === 'aceptado' &&
          eta
        ) {

          $('#ot-eta')
            .textContent =
            `Tiempo estimado: ${eta} min`;

        } else {

          $('#ot-eta')
            .textContent =
            '';

        }


        // ====================================================
        // NOTAS
        // ====================================================

        const nota = [];


        if (p.total) {

          nota.push(
            `Total: ${formatCOP(
              p.total
            )}`
          );

        }


        if (
          p.pago?.estado ===
          'pagado'
        ) {

          nota.push(
            'Pago confirmado'
          );

        }

        else if (
          p.pago?.estado ===
          'pendiente'
        ) {

          nota.push(
            'Pago pendiente (contraentrega/demo)'
          );

        }


        // ====================================================
        // BOTÓN CONFIRMAR RECIBIDO
        // ====================================================

        const btnOk =
          document.getElementById(
            'ot-confirm'
          );


        const puedeConfirmar =
          p.clienteConfirmado !== true &&
          (
            estado === 'enviado' ||
            estado === 'entregado' ||
            estado === 'listo'
          );


        if (btnOk) {

          btnOk.style.display =
            puedeConfirmar
              ? 'block'
              : 'none';


          btnOk.disabled =
            !puedeConfirmar;


          btnOk.textContent =
            '📦 Confirmar recibido';

        }


        // ====================================================
        // NOTA CUANDO DEBE CONFIRMAR
        // ====================================================

        if (
          puedeConfirmar
        ) {

          nota.push(
            '⚠️ Confirma cuando recibas tu pedido'
          );

        }


        $('#ot-note')
          .textContent =
          nota.join(' · ');


        // ====================================================
        // 🔥 AVISO ÚNICO POR CAMBIO DE ESTADO
        // ====================================================

        if (
          trackerInitialized
        ) {

          notifyStateOnce(
            pedidoId,
            estado
          );

        }


        trackerState =
          estado;


        trackerInitialized =
          true;


        // ====================================================
        // SI ES UN PEDIDO NUEVO
        // ====================================================

        if (
          forceShow &&
          estado !== 'cancelado' &&
          estado !== 'expirado'
        ) {

          tracker.style.display =
            'block';

        }

      },

      (err) => {

        console.warn(
          'onSnapshot pedido error:',
          err
        );

      }

    );

}


// ============================================================
// TOAST
// ============================================================

function toast(text) {

  const t =
    document.createElement(
      'div'
    );


  t.textContent =
    text;


  t.style.cssText = `

    position:fixed;

    left:50%;

    transform:
      translateX(-50%);

    bottom:14px;

    background:#111827;

    color:#fff;

    padding:
      10px 14px;

    border-radius:10px;

    z-index:99999;

    opacity:0;

    transition:
      opacity .2s ease;

  `;


  document.body.appendChild(
    t
  );


  requestAnimationFrame(
    () => {

      t.style.opacity =
        '1';

    }
  );


  setTimeout(
    () => {

      t.style.opacity =
        '0';


      setTimeout(
        () => {

          t.remove();

        },
        200
      );

    },
    2500
  );

}


// ============================================================
// ⭐ CALIFICACIÓN
// ============================================================

function abrirCalificacion(
  pedidoId,
  tiendaId
) {

  if (
    document.getElementById(
      'calificacion-modal'
    )
  ) {

    return;

  }


  const modal =
    document.createElement(
      'div'
    );


  modal.id =
    'calificacion-modal';


  modal.style.cssText = `

    position: fixed;

    inset: 0;

    background:
      rgba(0,0,0,0.5);

    backdrop-filter:
      blur(8px);

    z-index: 99999;

    display: flex;

    align-items: center;

    justify-content: center;

    animation:
      fadeIn 0.3s ease;

  `;


  modal.innerHTML = `

    <div
      style="
        background:white;
        border-radius:24px;
        max-width:420px;
        width:90%;
        padding:32px;
        text-align:center;
        animation:
          slideUp .4s
          cubic-bezier(
            .34,
            1.56,
            .64,
            1
          );
        box-shadow:
          0 20px 60px
          rgba(0,0,0,.3);
      ">


      <div
        style="
          font-size:3rem;
          margin-bottom:12px;
        ">
        🌟
      </div>


      <h2
        style="
          margin:0 0 8px 0;
          font-size:1.4rem;
          color:#0f172a;
        ">

        ¿Cómo fue tu experiencia?

      </h2>


      <p
        style="
          color:#6b7280;
          font-size:.9rem;
          margin-bottom:20px;
        ">

        Califica el servicio del comerciante

      </p>


      <div
        style="
          display:flex;
          gap:8px;
          justify-content:center;
          font-size:2.5rem;
          margin-bottom:16px;
        ">


        <span
          class="star"
          data-value="1"
          style="
            cursor:pointer;
            transition:all .2s ease;
            color:#d1d5db;
          ">
          ★
        </span>


        <span
          class="star"
          data-value="2"
          style="
            cursor:pointer;
            transition:all .2s ease;
            color:#d1d5db;
          ">
          ★
        </span>


        <span
          class="star"
          data-value="3"
          style="
            cursor:pointer;
            transition:all .2s ease;
            color:#d1d5db;
          ">
          ★
        </span>


        <span
          class="star"
          data-value="4"
          style="
            cursor:pointer;
            transition:all .2s ease;
            color:#d1d5db;
          ">
          ★
        </span>


        <span
          class="star"
          data-value="5"
          style="
            cursor:pointer;
            transition:all .2s ease;
            color:#d1d5db;
          ">
          ★
        </span>

      </div>


      <textarea
        id="calificacion-comentario"
        placeholder="Escribe un comentario (opcional)"
        style="
          width:100%;
          padding:10px 14px;
          border:2px solid #e5e7eb;
          border-radius:12px;
          font-size:.9rem;
          resize:vertical;
          min-height:60px;
          font-family:inherit;
          box-sizing:border-box;
        ">
      </textarea>


      <button
        id="btn-enviar-calificacion"
        style="
          width:100%;
          margin-top:12px;
          padding:12px;
          border:none;
          border-radius:12px;
          background:
            linear-gradient(
              135deg,
              #10b981,
              #0ea5e9
            );
          color:white;
          font-weight:700;
          font-size:1rem;
          cursor:pointer;
        ">

        Enviar calificación

      </button>


      <button
        onclick="
          this
            .closest(
              '#calificacion-modal'
            )
            .remove()
        "
        style="
          margin-top:8px;
          padding:8px;
          border:none;
          background:transparent;
          color:#9ca3af;
          font-size:.8rem;
          cursor:pointer;
          width:100%;
        ">

        Omitir

      </button>

    </div>

  `;


  document.body.appendChild(
    modal
  );


  // ==========================================================
  // ESTRELLAS
  // ==========================================================

  let ratingSeleccionado =
    0;


  const stars =
    modal.querySelectorAll(
      '.star'
    );


  const comentario =
    modal.querySelector(
      '#calificacion-comentario'
    );


  const btnEnviar =
    modal.querySelector(
      '#btn-enviar-calificacion'
    );


  stars.forEach(
    star => {

      star.addEventListener(
        'click',
        function () {

          ratingSeleccionado =
            parseInt(
              this.dataset.value
            );


          stars.forEach(
            (s, index) => {

              s.style.color =
                index <
                ratingSeleccionado
                  ? '#f59e0b'
                  : '#d1d5db';


              s.style.transform =
                index <
                ratingSeleccionado
                  ? 'scale(1.2)'
                  : 'scale(1)';

            }
          );

        }
      );


      star.addEventListener(
        'mouseenter',
        function () {

          const val =
            parseInt(
              this.dataset.value
            );


          stars.forEach(
            (s, index) => {

              s.style.color =
                index < val
                  ? '#fbbf24'
                  : '#d1d5db';

            }
          );

        }
      );


      star.addEventListener(
        'mouseleave',
        function () {

          stars.forEach(
            (s, index) => {

              s.style.color =
                index <
                ratingSeleccionado
                  ? '#f59e0b'
                  : '#d1d5db';

            }
          );

        }
      );

    }
  );


  // ==========================================================
  // ENVIAR CALIFICACIÓN
  // ==========================================================

  btnEnviar.addEventListener(
    'click',
    async function () {

      if (
        ratingSeleccionado === 0
      ) {

        toast(
          '⭐ Selecciona una calificación'
        );

        return;
      }


      this.disabled =
        true;


      this.textContent =
        'Enviando...';


      try {

        const comentarioTexto =
          comentario.value
            .trim();


        // ====================================================
        // GUARDAR CALIFICACIÓN
        // ====================================================

        await addDoc(
          collection(
            db,
            'calificaciones'
          ),
          {

            pedidoId,

            tiendaId,

            rating:
              ratingSeleccionado,

            comentario:
              comentarioTexto,

            createdAt:
              serverTimestamp()

          }
        );


        // ====================================================
        // ACTUALIZAR PEDIDO
        // ====================================================

        await updateDoc(
          doc(
            db,
            'pedidos',
            pedidoId
          ),
          {

            calificacion:
              ratingSeleccionado,

            calificacionComentario:
              comentarioTexto,

            calificadoEn:
              serverTimestamp()

          }
        );


        toast(
          '⭐ ¡Gracias por tu calificación!'
        );


        modal.remove();

      } catch (error) {

        console.error(
          'Error guardando calificación:',
          error
        );


        toast(
          '❌ Error al guardar la calificación'
        );


        this.disabled =
          false;


        this.textContent =
          'Enviar calificación';

      }

    }
  );

}


// ============================================================
// BOTONES DE PAGO
// ============================================================

function bindPayButtons() {

  document.addEventListener(
    'click',
    (e) => {

      const target =
        e.target.closest(
          '#btn-pagar-ahora, ' +
          '#pagar, ' +
          '.btn-pagar-ahora, ' +
          '[data-action="pagar"], ' +
          'button[data-pagar]'
        );


      if (!target) {
        return;
      }


      e.preventDefault();


      openCheckout();

    },
    {
      capture: true
    }
  );

}


bindPayButtons();


// ============================================================
// 🔥 REANUDAR SEGUIMIENTO
// ============================================================
//
// MUY IMPORTANTE:
//
// Ya NO hacemos:
//
// startOrderTracker(savedId)
//
// sin revisar el pedido.
//
// startOrderTracker() consulta Firestore primero.
//
// Si:
// clienteConfirmado === true
//
// entonces:
//
// ❌ no muestra tracker
// ❌ no genera aviso
// ❌ no deja listener
// ❌ limpia sessionStorage
//
// ============================================================

(function resumeTracking() {

  const savedId =
    sessionStorage.getItem(
      'lastPedidoId'
    );


  if (!savedId) {

    console.log(
      '📦 No hay pedido pendiente de seguimiento.'
    );

    return;
  }


  console.log(
    '🔎 Revisando pedido guardado:',
    savedId
  );


  startOrderTracker(
    savedId
  );

})();


// ============================================================
// LIMPIEZA DE SEGURIDAD AL SALIR
// ============================================================

window.addEventListener(
  'beforeunload',
  () => {

    if (unsubPedido) {

      try {
        unsubPedido();
      } catch {}

      unsubPedido = null;

    }

  }
);


// ============================================================
// LOG
// ============================================================

console.log(
  '[checkout-client] listo ✓'
);

console.log(
  '🔥 API_BASE:',
  API_BASE
);

console.log(
  '🔥 SERVICIO FIJO: $800 por pedido'
);

console.log(
  '🔥 DOMICILIO: configuración desde Firebase'
);

console.log(
  '🔥 NOMBRES: productos conservados'
);

console.log(
  '🔥 CHECKOUT: activo'
);

console.log(
  '🔥 CONFIRMACIÓN: cliente → comerciante'
);

console.log(
  '🔥 TRACKER: solo pedidos activos'
);

console.log(
  '🔥 TRACKER: se elimina al confirmar'
);

console.log(
  '🔥 NOTIFICACIONES: solo ante cambios'
);

console.log(
  '🔥 CALIFICACIÓN: disponible después de recibir'
);