// public/js/recuperarcontraseña.js

// Recuperación real de contraseña mediante Firebase Authentication

import { auth } from './firebase-config.js';

import {
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

console.log('🔐 recuperarcontraseña.js cargó correctamente');

document.addEventListener('DOMContentLoaded', () => {

  const form = document.getElementById('form-recuperacion');
  const emailInput = document.getElementById('recuperacion-email');
  const mensaje = document.getElementById('recuperacion-mensaje');
  const volverLogin = document.getElementById('volver-login');

  if (!form) {
    console.warn('⚠️ No existe #form-recuperacion');
    return;
  }

  // ============================================================
  // MOSTRAR MENSAJE
  // ============================================================

  function mostrarMensaje(texto, tipo = 'info') {

    if (!mensaje) return;

    mensaje.textContent = texto;
    mensaje.style.display = 'block';

    if (tipo === 'error') {
      mensaje.style.color = '#dc2626';
    } else if (tipo === 'success') {
      mensaje.style.color = '#059669';
    } else {
      mensaje.style.color = '#374151';
    }
  }

  // ============================================================
  // ENVIAR RECUPERACIÓN
  // ============================================================

  form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const email = String(emailInput?.value || '')
      .trim()
      .toLowerCase();

    if (!email) {

      mostrarMensaje(
        'Por favor, escribe tu correo electrónico.',
        'error'
      );

      emailInput?.focus();
      return;
    }

    const emailValido =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!emailValido) {

      mostrarMensaje(
        'Escribe un correo electrónico válido.',
        'error'
      );

      emailInput?.focus();
      return;
    }

    const boton = form.querySelector('button[type="submit"]');

    const textoOriginal = boton
      ? boton.textContent
      : 'Enviar Enlace';

    try {

      if (boton) {
        boton.disabled = true;
        boton.textContent = 'Enviando...';
      }

      mostrarMensaje(
        'Estamos procesando tu solicitud...',
        'info'
      );

      // Firebase envía el correo real de recuperación
      await sendPasswordResetEmail(auth, email);

      /*
       * Mensaje genérico por seguridad.
       * No revelamos si el correo está registrado.
       */

      mostrarMensaje(
        'Si existe una cuenta asociada a este correo, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de spam o correo no deseado.',
        'success'
      );

      if (emailInput) {
        emailInput.value = '';
      }

    } catch (error) {

      console.error(
        '❌ Error enviando recuperación:',
        error
      );

      mostrarMensaje(
        'No fue posible procesar la solicitud en este momento. Verifica el correo e inténtalo nuevamente.',
        'error'
      );

    } finally {

      if (boton) {
        boton.disabled = false;
        boton.textContent = textoOriginal;
      }

    }

  });

  // ============================================================
  // VOLVER AL LOGIN
  // ============================================================

  if (volverLogin) {

    volverLogin.addEventListener('click', (event) => {

      event.preventDefault();

      const recuperacion =
        document.getElementById('recuperacion-form');

      const login =
        document.getElementById('login-form');

      if (recuperacion) {
        recuperacion.classList.add('hidden');
      }

      if (login) {
        login.classList.remove('hidden');
      }

      if (mensaje) {
        mensaje.textContent = '';
        mensaje.style.display = '';
      }

    });

  }

});