// public/js/inbox.js
import {
  db, auth,
  collection, query, orderBy, limit, startAfter, getDocs, updateDoc, doc, where,
  onAuthStateChanged
} from './firebase-config.js';

/* ------------------------------- Auth helper ------------------------------- */
function getCurrentUserOrRedirect() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop?.();
      if (user) resolve(user);
      else { try { location.href = './index.html'; } catch {} }
    });
  });
}

/* ---------------------------------- State ---------------------------------- */
const STATE = { lastDoc: null, tiendaId: null };
const PAGE = 30;

const ICON = {
  pedido_nuevo: 'fa-cart-plus',
  pedido_estado: 'fa-clipboard-check',
  pago_recibido: 'fa-receipt',
  mensaje_nuevo: 'fa-message',
  sistema: 'fa-bell'
};

/* ------------------------------ Render helpers ----------------------------- */
function fmtFecha(anyDate) {
  const dt =
    anyDate?.toDate?.() ? anyDate.toDate() :
    (anyDate instanceof Date ? anyDate : new Date(anyDate || Date.now()));
  return isNaN(dt) ? '' : dt.toLocaleString();
}

function liTemplate(item) {
  const icon = ICON[item.tipo] || ICON.sistema;

  // Compatibilidad campos
  const fecha = fmtFecha(item.createdAt || item.creadoEn);
  const visto = (item.visto === true) || (item.leida === true);
  const vistoCls = visto ? '' : 'badge-warning';

  const actions = [];
  if (item.pedidoId)
    actions.push(`<button class="btn btn-sm btn-outline" data-act="ver-pedido" data-id="${item.pedidoId}">Ver pedido</button>`);
  if (item.tipo === 'mensaje_nuevo' && item.uid)
    actions.push(`<button class="btn btn-sm btn-outline" data-act="abrir-chat" data-uid="${item.uid}">Abrir chat</button>`);
  if (item.tipo === 'pago_recibido')
    actions.push(`<button class="btn btn-sm btn-outline" data-act="ver-pagos">Ver pagos</button>`);
  actions.push(`<button class="btn btn-sm" data-act="marcar-visto" data-path="${item._path}">Marcar visto</button>`);

  return `
<li class="list-item" data-tipo="${item.tipo}" data-visto="${visto ? 1 : 0}">
  <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <i class="fas ${icon}" style="margin-top:2px"></i>
      <div>
        <div style="font-weight:600">${item.titulo || 'Notificación'}</div>
        <div style="color:#555">${item.mensaje || ''}</div>
        <small class="${vistoCls}" style="display:inline-block;margin-top:4px">${fecha}</small>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${actions.join('')}</div>
  </div>
</li>`;
}

/* -------------------------------- Firestore -------------------------------- */
function inboxColRef(uid) {
  // Estructura según tus reglas: /inbox/{uid}/items
  return collection(db, 'inbox', uid, 'items');
}

async function fetchPage({ reset = false, filter = '' } = {}) {
  const ul = document.getElementById('inbox-list');
  if (!ul) return;

  if (reset) {
    ul.innerHTML = '';
    STATE.lastDoc = null;
  }

  let qRef = query(inboxColRef(STATE.tiendaId), orderBy('createdAt', 'desc'), limit(PAGE));

  // Compatibilidad: si tu colección usa "creadoEn" para fecha, intenta orderBy por ese campo
  try {
    await getDocs(qRef.limit ? qRef : query(inboxColRef(STATE.tiendaId), limit(1)));
  } catch {
    // Si el índice/field no existe, usa "creadoEn"
    qRef = query(inboxColRef(STATE.tiendaId), orderBy('creadoEn', 'desc'), limit(PAGE));
  }

  if (filter === 'no_vistos') {
    qRef = query(inboxColRef(STATE.tiendaId), where('visto', '==', false), orderBy('createdAt', 'desc'), limit(PAGE));
    try {} catch {}
  }

  const tipos = ['pedido_nuevo', 'pedido_estado', 'pago_recibido', 'mensaje_nuevo', 'sistema'];
  if (tipos.includes(filter)) {
    qRef = query(inboxColRef(STATE.tiendaId), where('tipo', '==', filter), orderBy('createdAt', 'desc'), limit(PAGE));
    try {} catch {}
  }

  if (STATE.lastDoc) qRef = query(qRef, startAfter(STATE.lastDoc));

  const snap = await getDocs(qRef);
  if (snap.empty) return;

  snap.docs.forEach(d => {
    const data = d.data();
    const item = { ...data, _path: d.ref.path };
    ul.insertAdjacentHTML('beforeend', liTemplate(item));
  });

  STATE.lastDoc = snap.docs[snap.docs.length - 1];
}

async function markAll() {
  const qRef = query(inboxColRef(STATE.tiendaId), where('visto', '==', false), limit(200));
  const snap = await getDocs(qRef);
  await Promise.all(
    snap.docs.map(d =>
      updateDoc(d.ref, { visto: true, leida: true }).catch(() => {})
    )
  );

  // Además marca los que quizá sólo tengan leida=false
  const qRef2 = query(inboxColRef(STATE.tiendaId), where('leida', '==', false), limit(200));
  const snap2 = await getDocs(qRef2);
  await Promise.all(
    snap2.docs.map(d =>
      updateDoc(d.ref, { visto: true, leida: true }).catch(() => {})
    )
  );
}

/* --------------------------------- Wiring ---------------------------------- */
function wireActions() {
  const ul = document.getElementById('inbox-list');
  if (!ul) return;

  ul.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'ver-pedido') {
      const id = btn.dataset.id;
      try { location.hash = `#orders?id=${id}`; } catch {}
    }
    if (act === 'abrir-chat') {
      window.openChatWith?.(btn.dataset.uid);
    }
    if (act === 'ver-pagos') {
      try { location.hash = '#analytics'; } catch {}
    }
    if (act === 'marcar-visto') {
      const segs = (btn.dataset.path || '').split('/').filter(Boolean);
      if (segs.length >= 3) {
        updateDoc(doc(db, ...segs), { visto: true, leida: true }).catch(console.warn);
      }
      btn.closest('li')?.setAttribute('data-visto', '1');
    }
  });

  document.getElementById('inbox-mark-all')?.addEventListener('click', async () => {
    await markAll();
    document.querySelectorAll('#inbox-list li').forEach(li => li.setAttribute('data-visto', '1'));
  });

  document.getElementById('inbox-load-more')?.addEventListener('click', () => {
    const filter = document.getElementById('inbox-filter')?.value || '';
    fetchPage({ filter });
  });

  document.getElementById('inbox-filter')?.addEventListener('change', (e) => {
    fetchPage({ reset: true, filter: e.target.value });
  });
}

/* -------------------------------- Bootstrap -------------------------------- */
async function bootstrapInbox() {
  const user = await getCurrentUserOrRedirect();
  STATE.tiendaId = user.uid;
  wireActions();
  fetchPage({ reset: true });
}

if (document.getElementById('inbox-content')) {
  bootstrapInbox().catch(console.error);
}
