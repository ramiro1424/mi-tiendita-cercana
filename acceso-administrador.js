/* ============================================================
   ACCESO ADMINISTRADOR
   MI TIENDITA CERCANA

   CUENTA ADMINISTRATIVA:
   carranzaramiro686@gmail.com

   Requiere:
   Firebase Custom Claim:
   admin: true

   Funciones:
   - Login administrativo
   - Verificación de admin: true
   - Restablecimiento de contraseña
   - Mostrar / ocultar contraseña
   - Acceso a Torre de Control
============================================================ */


/* ============================================================
   FIREBASE
============================================================ */

import {
    auth
} from './public/js/firebase-config.js';


import {
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';


/* ============================================================
   CONFIGURACIÓN
============================================================ */

const EMAIL_ADMINISTRADOR =
    'carranzaramiro686@gmail.com';


const RUTA_TORRE_CONTROL =
    './torre-control.html';


/* ============================================================
   ELEMENTOS
============================================================ */

const formulario =
    document.getElementById(
        'admin-login-form'
    );


const emailInput =
    document.getElementById(
        'admin-email'
    );


const passwordInput =
    document.getElementById(
        'admin-password'
    );


const botonLogin =
    document.getElementById(
        'btn-admin-login'
    );


const botonPassword =
    document.getElementById(
        'btn-mostrar-password'
    );


const botonRecuperarPassword =
    document.getElementById(
        'btn-recuperar-password'
    );


const estado =
    document.getElementById(
        'admin-login-status'
    );


/* ============================================================
   MOSTRAR MENSAJE
============================================================ */

function mostrarEstado(
    mensaje,
    tipo = ''
) {

    if (!estado) {

        console.warn(
            '⚠️ No existe #admin-login-status'
        );

        return;
    }


    estado.textContent =
        mensaje;


    estado.className =
        'login-status';


    if (tipo) {

        estado.classList.add(
            tipo
        );
    }
}


/* ============================================================
   ESTADO DEL BOTÓN LOGIN
============================================================ */

function cambiarEstadoFormulario(
    cargando
) {

    if (!botonLogin) return;


    botonLogin.disabled =
        cargando;


    if (cargando) {

        botonLogin.textContent =
            '⏳ Verificando acceso...';

    } else {

        botonLogin.textContent =
            '🔐 Ingresar a Torre de Control';
    }
}


/* ============================================================
   VERIFICAR ADMINISTRADOR
============================================================ */

async function verificarAdministrador(
    user
) {

    if (!user) {

        return false;
    }


    console.log(
        '🔐 VERIFICANDO PERMISOS ADMINISTRATIVOS'
    );


    console.log(
        '📧 Cuenta:',
        user.email
    );


    console.log(
        '🆔 UID:',
        user.uid
    );


    /*
     * Forzamos renovación del token.
     *
     * Esto es importante porque acabamos de asignar
     * el Custom Claim admin: true.
     */

    const tokenResult =
        await user.getIdTokenResult(
            true
        );


    const claims =
        tokenResult.claims || {};


    console.log(
        '🔑 Claims recibidos:',
        claims
    );


    const tieneAdmin =
        claims.admin === true;


    const correoAutorizado =
        String(
            user.email || ''
        ).toLowerCase() ===
        EMAIL_ADMINISTRADOR.toLowerCase();


    console.log(
        '👑 admin:',
        tieneAdmin
    );


    console.log(
        '📧 correo autorizado:',
        correoAutorizado
    );


    /*
     * Para entrar deben cumplirse AMBAS condiciones.
     */

    return (
        tieneAdmin &&
        correoAutorizado
    );
}


/* ============================================================
   RESTABLECER CONTRASEÑA
============================================================ */

async function restablecerContrasena() {

    console.log(
        '🔑 Solicitud de restablecimiento de contraseña'
    );


    if (!emailInput) {

        console.error(
            '❌ No existe #admin-email'
        );

        return;
    }


    const email =
        emailInput.value
            .trim()
            .toLowerCase();


    /*
     * El correo debe ser el administrador autorizado.
     */

    if (!email) {

        mostrarEstado(
            'Escribe primero tu correo electrónico.',
            'error'
        );

        emailInput.focus();

        return;
    }


    if (
        email !==
        EMAIL_ADMINISTRADOR.toLowerCase()
    ) {

        mostrarEstado(
            '🚫 Este correo no está autorizado para recuperar la cuenta administrativa.',
            'error'
        );

        emailInput.focus();

        return;
    }


    try {

        if (botonRecuperarPassword) {

            botonRecuperarPassword.disabled =
                true;

            botonRecuperarPassword.textContent =
                '📨 Enviando correo...';
        }


        mostrarEstado(
            '📨 Enviando correo de recuperación...',
            'loading'
        );


        console.log(
            '📨 Enviando recuperación a:',
            EMAIL_ADMINISTRADOR
        );


        await sendPasswordResetEmail(
            auth,
            EMAIL_ADMINISTRADOR
        );


        console.log(
            '✅ Correo de recuperación enviado correctamente.'
        );


        mostrarEstado(
            '✅ Correo enviado. Revisa la bandeja de entrada de ' +
            EMAIL_ADMINISTRADOR +
            '.',
            'success'
        );


        if (botonRecuperarPassword) {

            botonRecuperarPassword.textContent =
                '✅ Correo enviado';
        }


    } catch (error) {

        console.error(
            '❌ Error al restablecer contraseña:',
            error
        );


        let mensaje =
            'No fue posible enviar el correo de recuperación.';


        switch (
            error.code
        ) {

            case 'auth/invalid-email':

                mensaje =
                    '❌ El correo electrónico no es válido.';

                break;


            case 'auth/user-not-found':

                mensaje =
                    '❌ No existe una cuenta con ese correo en Firebase Authentication.';

                break;


            case 'auth/too-many-requests':

                mensaje =
                    '⚠️ Se realizaron demasiadas solicitudes. Espera unos minutos e inténtalo nuevamente.';

                break;


            case 'auth/network-request-failed':

                mensaje =
                    '🌐 No hay conexión con Firebase.';

                break;


            case 'auth/operation-not-allowed':

                mensaje =
                    '⚠️ El método de autenticación por correo y contraseña no está habilitado en Firebase.';

                break;


            default:

                mensaje =
                    `❌ ${error.message || 'Error al enviar el correo de recuperación.'}`;
        }


        mostrarEstado(
            mensaje,
            'error'
        );


        if (botonRecuperarPassword) {

            botonRecuperarPassword.disabled =
                false;

            botonRecuperarPassword.textContent =
                '¿Olvidaste tu contraseña?';
        }
    }
}


/* ============================================================
   EVENTO: RECUPERAR CONTRASEÑA
============================================================ */

botonRecuperarPassword?.addEventListener(
    'click',
    restablecerContrasena
);


/* ============================================================
   LOGIN ADMINISTRATIVO
============================================================ */

formulario?.addEventListener(
    'submit',

    async (evento) => {

        evento.preventDefault();


        const email =
            emailInput.value
                .trim()
                .toLowerCase();


        const password =
            passwordInput.value;


        /* ----------------------------------------------------
           VALIDAR CAMPOS
        ---------------------------------------------------- */

        if (!email) {

            mostrarEstado(
                'Ingresa el correo administrativo.',
                'error'
            );

            emailInput.focus();

            return;
        }


        if (!password) {

            mostrarEstado(
                'Ingresa la contraseña.',
                'error'
            );

            passwordInput.focus();

            return;
        }


        /* ----------------------------------------------------
           VALIDAR CORREO ADMINISTRATIVO
        ---------------------------------------------------- */

        if (
            email !==
            EMAIL_ADMINISTRADOR.toLowerCase()
        ) {

            mostrarEstado(
                '🚫 Esta cuenta no está autorizada para la administración.',
                'error'
            );

            return;
        }


        cambiarEstadoFormulario(
            true
        );


        mostrarEstado(
            'Verificando credenciales...',
            'loading'
        );


        try {

            /* ------------------------------------------------
               LOGIN FIREBASE
            ------------------------------------------------ */

            const resultado =
                await signInWithEmailAndPassword(
                    auth,
                    email,
                    password
                );


            const user =
                resultado.user;


            console.log(
                '✅ Credenciales correctas.'
            );


            console.log(
                '📧 Usuario:',
                user.email
            );


            console.log(
                '🆔 UID:',
                user.uid
            );


            /* ------------------------------------------------
               VERIFICAR ADMIN
            ------------------------------------------------ */

            const autorizado =
                await verificarAdministrador(
                    user
                );


            /* ------------------------------------------------
               SI NO ES ADMIN
            ------------------------------------------------ */

            if (!autorizado) {

                console.error(
                    '🚫 Usuario sin permisos administrativos.'
                );


                await signOut(
                    auth
                );


                mostrarEstado(
                    '🚫 Acceso denegado. Esta cuenta no tiene permisos administrativos.',
                    'error'
                );


                cambiarEstadoFormulario(
                    false
                );


                return;
            }


            /* ------------------------------------------------
               ADMINISTRADOR CONFIRMADO
            ------------------------------------------------ */

            console.log(
                '========================================'
            );


            console.log(
                '👑 ADMINISTRADOR CONFIRMADO'
            );


            console.log(
                '📧',
                user.email
            );


            console.log(
                '🆔',
                user.uid
            );


            console.log(
                '🔐 admin: true'
            );


            console.log(
                '========================================'
            );


            mostrarEstado(
                '✓ Acceso autorizado. Abriendo Torre de Control...',
                'success'
            );


            /* ------------------------------------------------
               IR A TORRE DE CONTROL
            ------------------------------------------------ */

            setTimeout(
                () => {

                    window.location.href =
                        RUTA_TORRE_CONTROL;

                },
                700
            );

        }

        catch (error) {

            console.error(
                '❌ Error de acceso administrativo:',
                error
            );


            let mensaje =
                'No fue posible iniciar sesión.';


            switch (
                error.code
            ) {

                case 'auth/invalid-credential':

                    mensaje =
                        '❌ Correo o contraseña incorrectos. Si todavía no tienes contraseña, utiliza "¿Olvidaste tu contraseña?".';

                    break;


                case 'auth/wrong-password':

                    mensaje =
                        '❌ La contraseña es incorrecta.';

                    break;


                case 'auth/user-not-found':

                    mensaje =
                        '❌ No existe una cuenta con ese correo.';

                    break;


                case 'auth/invalid-email':

                    mensaje =
                        '❌ El correo electrónico no es válido.';

                    break;


                case 'auth/user-disabled':

                    mensaje =
                        '🚫 Esta cuenta está deshabilitada.';

                    break;


                case 'auth/too-many-requests':

                    mensaje =
                        '⚠️ Demasiados intentos. Espera unos minutos e inténtalo nuevamente.';

                    break;


                case 'auth/network-request-failed':

                    mensaje =
                        '🌐 No hay conexión con Firebase.';

                    break;


                case 'auth/operation-not-allowed':

                    mensaje =
                        '⚠️ El inicio de sesión por correo y contraseña no está habilitado en Firebase Authentication.';

                    break;


                default:

                    mensaje =
                        `❌ ${error.message || 'Error de autenticación.'}`;
            }


            mostrarEstado(
                mensaje,
                'error'
            );


            cambiarEstadoFormulario(
                false
            );
        }

    }
);


/* ============================================================
   MOSTRAR / OCULTAR CONTRASEÑA
============================================================ */

botonPassword?.addEventListener(
    'click',

    () => {

        if (
            passwordInput.type ===
            'password'
        ) {

            passwordInput.type =
                'text';


            botonPassword.textContent =
                '🙈';


        } else {

            passwordInput.type =
                'password';


            botonPassword.textContent =
                '👁️';
        }

    }
);


/* ============================================================
   INICIO
============================================================ */

console.log(
    '🏢 Acceso administrativo cargado'
);


console.log(
    '📧 Cuenta autorizada:',
    EMAIL_ADMINISTRADOR
);


console.log(
    '🔐 Custom Claim requerido: admin === true'
);