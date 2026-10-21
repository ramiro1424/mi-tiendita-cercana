// public/js/ui.js
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const VIEWS = ['registro-form', 'login-form', 'recuperacion-form'];

function clearMessages(scope) {
  (scope ? scope.querySelectorAll('.message') : $$('.message'))
    .forEach(m => { m.textContent = ''; m.className = 'message'; m.style.display = 'none'; });
}

function focusFirstInput(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  // Busca el primer input o select realmente visible y habilitado
  const first = section.querySelector('input, select, textarea, button');
  if (first && !first.disabled && first.offsetParent !== null) first.focus();
}

function setSectionVisibility(id, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('hidden', !visible);
  el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  // inert evita que reciba foco/tab si está oculto
  if (!visible) {
    el.setAttribute('inert', '');
  } else {
    el.removeAttribute('inert');
  }
}

function show(id) {
  VIEWS.forEach(x => {
    const isTarget = x === id;
    setSectionVisibility(x, isTarget);
    if (isTarget) {
      clearMessages(document.getElementById(x));
      // da un microtiempo para que el DOM oculte/mostrar antes de enfocar
      requestAnimationFrame(() => focusFirstInput(x));
    }
  });
  try { sessionStorage.setItem('mtc:view', id); } catch {}
}

// ==== Enlaces de cambio de vista (sin navegar) ====
$('#mostrar-login')?.addEventListener('click', (e) => { e.preventDefault(); show('login-form'); });
$('#mostrar-registro')?.addEventListener('click', (e) => { e.preventDefault(); show('registro-form'); });
$('#mostrar-recuperacion')?.addEventListener('click', (e) => { e.preventDefault(); show('recuperacion-form'); });
$('#volver-login')?.addEventListener('click', (e) => { e.preventDefault(); show('login-form'); });

// ==== Toggle ver/ocultar contraseña (delegación global) ====
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-password');
  if (!btn) return;
  const wrap = btn.closest('.password-container');
  const input = wrap?.querySelector('input[type="password"], input[type="text"]');
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  const ico = btn.querySelector('i');
  if (ico) {
    ico.classList.toggle('fa-eye', !isPass);
    ico.classList.toggle('fa-eye-slash', isPass);
  }
});

// ==== Chat flotante (opcional) ====
const toggleChat = $('#toggle-chat');
const chat       = $('#chat-container');
const closeChat  = $('#close-chat');

toggleChat?.addEventListener('click', () => chat?.classList.toggle('hidden'));
closeChat?.addEventListener('click', () => chat?.classList.add('hidden'));

// Teclas rápidas para cerrar el chat (Esc/Enter sobre la X)
chat?.addEventListener('keydown', (e) => {
  if ((e.key === 'Escape') || (e.key === 'Enter' && e.target === closeChat)) {
    e.preventDefault();
    chat.classList.add('hidden');
  }
});

// ==== Vista por defecto (recupera la última si existe) ====
document.addEventListener('DOMContentLoaded', () => {
  const last = (() => {
    try { return sessionStorage.getItem('mtc:view') || 'login-form'; }
    catch { return 'login-form'; }
  })();
  show(last);
});

// ==== Loader global (overlay de carga) ====
window.showLoader = function (on = true, text = 'Cargando…') {
  const el = document.getElementById('loader');
  if (!el) return;
  const t = el.querySelector('.loader-text');
  if (t) t.textContent = text;
  el.classList.toggle('hidden', !on);
  el.setAttribute('aria-busy', on ? 'true' : 'false');

  // bloquear/desbloquear scroll mientras carga
  document.documentElement.style.overflow = on ? 'hidden' : '';
  document.body.style.overflow = on ? 'hidden' : '';
};
