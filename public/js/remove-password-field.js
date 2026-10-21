import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

(async () => {
  try {
    const snap = await db.collection('usuarios').get();
    let updates = 0;

    for (const doc of snap.docs) {
      const data = doc.data();

      if (Object.prototype.hasOwnProperty.call(data, 'password')) {
        console.log(`Eliminando "password" de doc: ${doc.id}`);
        await doc.ref.update({
          password: admin.firestore.FieldValue.delete()
        });
        updates++;
      } else {
        console.log(`Sin "password": ${doc.id}`);
      }
    }

    console.log(`✅ Terminado. Documentos modificados: ${updates}`);
    process.exit(0);

  } catch (err) {
    console.error('❌ Error en limpieza:', err);
    process.exit(1);
  }
})();