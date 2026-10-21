// public/js/panel-router.js
// Router estable por hash para tabs del panel
// Soporta: #dashboard, #inbox, #orders?estado=...&mes=YYYY-MM, #products, #settings, #analytics

/* -------------------------------------------------------------------------- */
/*                           TAB HANDLING (FIXED)                             */
/* -------------------------------------------------------------------------- */

function getTabs() {
  return Array.from(document.querySelectorAll('.tabs .tab'));
}

const contents = Array.from(
  document.querySelectorAll('.tab-content[id$="-content"]')
);

const contentByKey = new Map(
  contents.map(el => [el.id.replace(/-content$/, ''), el])
);

/* -------------------------------------------------------------------------- */
/*                           UI STATE HANDLER                                 */
/* -------------------------------------------------------------------------- */

function setActive(key) {
  // Tabs
  getTabs().forEach(t => {
    t.classList.toggle('active', t.dataset.tab === key);
  });

  // Contents
  for (const [k, el] of contentByKey.entries()) {
    el.classList.toggle('active', k === key);
  }
}

/* -------------------------------------------------------------------------- */
/*                           HASH PARSER                                      */
/* -------------------------------------------------------------------------- */

function parseHash() {
  const raw = (location.hash || '#dashboard').replace(/^#/, '');
  const [pathRaw, qs] = raw.split('?');

  const path = pathRaw || 'dashboard';
  const params = new URLSearchParams(qs || '');

  return { path, params };
}

/* -------------------------------------------------------------------------- */
/*                        ORDERS FILTER INTEGRATION                           */
/* -------------------------------------------------------------------------- */

function applyOrdersParams(params) {
  const estado = params.get('estado');
  const mes = params.get('mes');
  const texto = params.get('q') || params.get('texto') || '';

  const elEstado = document.getElementById('filtro-estado');
  const elMes = document.getElementById('filtro-mes');
  const elTexto = document.getElementById('filtro-texto');

  if (elEstado && estado) elEstado.value = estado;
  if (elMes && mes) elMes.value = mes;
  if (elTexto && texto) elTexto.value = texto;

  // Dispara filtro si existe botón
  document.getElementById('btn-filtrar-orders')?.click();

  // Hook opcional externo
  if (typeof window.onOrdersRoute === 'function') {
    window.onOrdersRoute({ estado, mes, texto, params });
  }
}

/* -------------------------------------------------------------------------- */
/*                              ROUTER CORE                                   */
/* -------------------------------------------------------------------------- */

function route() {
  const { path, params } = parseHash();

  const key = contentByKey.has(path) ? path : 'dashboard';

  setActive(key);

  if (key === 'orders') {
    applyOrdersParams(params);
  }

  if (typeof window.onRouteChange === 'function') {
    window.onRouteChange({ path: key, params });
  }
}

/* -------------------------------------------------------------------------- */
/*                              NAVIGATION                                    */
/* -------------------------------------------------------------------------- */

function goto(key, paramsObj) {
  const qs = paramsObj
    ? `?${new URLSearchParams(paramsObj).toString()}`
    : '';

  location.hash = `#${key}${qs}`;
}

/* -------------------------------------------------------------------------- */
/*                          EVENT BINDING FIX                                 */
/* -------------------------------------------------------------------------- */

function bindTabs() {
  getTabs().forEach(t => {
    t.addEventListener('click', () => {
      const target = t.dataset.tab;

      if (!target) return;

      goto(target);
    });

    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        t.click();
      }
    });
  });
}

/* -------------------------------------------------------------------------- */
/*                             INIT + EVENTS                                  */
/* -------------------------------------------------------------------------- */

window.addEventListener('hashchange', route);

document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  route();
});

/* -------------------------------------------------------------------------- */
/*                             GLOBAL ACCESS                                  */
/* -------------------------------------------------------------------------- */

window.gotoPanel = goto;