const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
// 🔥 UID DEL COMERCIANTE
const UID_COMERCIANTE = "V27CeDGGIuUzW3vx1xuk7Mk8krM2";

async function copALicoreria() {
  console.log("🚀 Copiando catálogo a la tienda...");
  console.log(`👤 Comerciante: ${UID_COMERCIANTE}`);
  
  try {
    // 1. Verificar que el catálogo existe
    const catalogoRef = db.collection("catalogos").doc("licoreria").collection("productos");
    const catalogoSnap = await catalogoRef.get();
    
    console.log(`📦 Productos en catálogo: ${catalogoSnap.size}`);
    
    if (catalogoSnap.size === 0) {
      console.log("❌ El catálogo de licorería está vacío");
      console.log("📋 Ejecuta primero: node importar_licoreria.js");
      return;
    }
    
    // 2. Verificar que la tienda existe
    const tiendaDoc = await db.collection("tiendas").doc(UID_COMERCIANTE).get();
    if (!tiendaDoc.exists) {
      console.log("❌ La tienda no existe. El comerciante debe registrarse primero.");
      return;
    }
    
    console.log(`📊 Tienda: ${tiendaDoc.data().nombre || 'Sin nombre'}`);
    console.log(`🏷️ Tipo: ${tiendaDoc.data().tipoComercio || 'No definido'}`);
    
    // 3. Copiar productos
    console.log("📋 Copiando productos...");
    const batch = db.batch();
    let count = 0;
    
    catalogoSnap.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      
      // Solo copiar si tiene nombreBase (evitar vacíos)
      if (data.nombreBase) {
        // Copiar a subcolección de la tienda
        const tiendaRef = db.collection("tiendas").doc(UID_COMERCIANTE).collection("productos").doc(id);
        batch.set(tiendaRef, {
          ...data,
          tiendaId: UID_COMERCIANTE,
          nombre: data.nombreBase,
          imagen: data.imagenUrl || '',
          inventario: 0,
          importado: true,
          origen: "catalogo_licoreria",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Copiar a colección raíz
        const rootRef = db.collection("productos").doc(id);
        batch.set(rootRef, {
          ...data,
          tiendaId: UID_COMERCIANTE,
          nombre: data.nombreBase,
          imagen: data.imagenUrl || '',
          inventario: 0,
          importado: true,
          origen: "catalogo_licoreria",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
        });
        
        count++;
      }
    });
    
    // 4. Ejecutar batch
    await batch.commit();
    console.log(`✅ ${count} productos copiados a la tienda`);
    
    // 5. Marcar como sembrado
    await db.collection("tiendas").doc(UID_COMERCIANTE).set({
      seeded: true,
      tipoComercio: "licorera",
      actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log("✅ Tienda marcada como sembrada y tipo actualizado a licorera");
    console.log("🎉 ¡Catálogo de licorería copiado exitosamente!");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// Ejecutar
copALicoreria();