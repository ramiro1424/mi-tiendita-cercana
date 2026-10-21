const admin = require("firebase-admin");

admin.initializeApp();

const EMAIL_ADMIN = "carranzaramiro686@gmail.com";

async function configurarAdministrador() {
    try {
        console.log("🔎 Buscando usuario:", EMAIL_ADMIN);

        const user = await admin.auth().getUserByEmail(
            EMAIL_ADMIN
        );

        console.log("✅ Usuario encontrado");
        console.log("🆔 UID:", user.uid);
        console.log("📧 Email:", user.email);
        console.log(
            "✉️ Email verificado:",
            user.emailVerified
        );

        // Conservar cualquier Custom Claim existente
        const claimsActuales = user.customClaims || {};

        // Agregar únicamente el permiso de administrador
        const nuevosClaims = {
            ...claimsActuales,
            admin: true
        };

        await admin.auth().setCustomUserClaims(
            user.uid,
            nuevosClaims
        );

        console.log("");
        console.log("========================================");
        console.log("🎉 ADMINISTRADOR CONFIGURADO");
        console.log("========================================");
        console.log("📧 Cuenta:", user.email);
        console.log("🆔 UID:", user.uid);
        console.log("🔐 admin: true");
        console.log("");
        console.log("✅ La cuenta ya tiene el rol administrativo.");
        console.log("");
        console.log("⚠️ IMPORTANTE:");
        console.log("Cierra sesión en Mi Tiendita Cercana");
        console.log("y vuelve a iniciar sesión.");
        console.log("");
        console.log(
            "El nuevo token de Firebase incluirá el permiso admin."
        );

        process.exit(0);

    } catch (error) {
        console.error("");
        console.error("❌ ERROR AL CONFIGURAR ADMINISTRADOR");
        console.error("----------------------------------------");
        console.error(error.message);
        console.error("");
        process.exit(1);
    }
}

configurarAdministrador();