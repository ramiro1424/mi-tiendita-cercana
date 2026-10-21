const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

// 🔥 UID DEL COMERCIANTE
const UID_COMERCIANTE = "V27CeDGGIuUzW3vx1xuk7Mk8krM2";

async function limpiarProductosTiendaBase() {
  console.log("🧹 LIMPIANDO PRODUCTOS DE TIENDA BASE (RAÍZ Y SUBCOLECCIÓN)...");
  console.log(`👤 Comerciante: ${UID_COMERCIANTE}`);
  
  try {
    // 1. Obtener productos de la subcolección
    const tiendaRef = db.collection("tiendas").doc(UID_COMERCIANTE).collection("productos");
    const snapshotSub = await tiendaRef.get();
    console.log(`📦 Subcolección: ${snapshotSub.size} productos`);
    
    // 2. Obtener productos de la colección raíz
    const rootRef = db.collection("productos");
    const snapshotRoot = await rootRef.get();
    console.log(`📦 Colección raíz: ${snapshotRoot.size} productos`);
    
    const batch = db.batch();
    let eliminadosSub = 0;
    let eliminadosRoot = 0;
    let conservados = 0;
    let errores = 0;
    
    // 3. ELIMINAR DE SUBCOLECCIÓN (los que NO son LICORES)
    snapshotSub.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      
      const esTiendaBase = data.categoria && data.categoria !== "LICORES";
      
      if (esTiendaBase) {
        const ref = db.collection("tiendas").doc(UID_COMERCIANTE).collection("productos").doc(id);
        batch.delete(ref);
        eliminadosSub++;
        console.log(`🗑️ Sub: ${data.nombreBase || data.nombre || id}`);
      } else {
        conservados++;
        console.log(`✅ Conservado (sub): ${data.nombreBase || data.nombre || id}`);
      }
    });
    
    // 4. ELIMINAR DE COLECCIÓN RAÍZ (los que NO son LICORES)
    snapshotRoot.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      
      // Solo eliminar si pertenece a este comerciante Y NO es LICORES
      if (data.tiendaId === UID_COMERCIANTE) {
        const esTiendaBase = data.categoria && data.categoria !== "LICORES";
        
        if (esTiendaBase) {
          const ref = db.collection("productos").doc(id);
          batch.delete(ref);
          eliminadosRoot++;
          console.log(`🗑️ Root: ${data.nombreBase || data.nombre || id}`);
        } else {
          console.log(`✅ Conservado (root): ${data.nombreBase || data.nombre || id}`);
        }
      }
    });
    
    // 5. Ejecutar batch
    console.log("⏳ Ejecutando eliminaciones...");
    await batch.commit();
    
    console.log("\n📊 RESULTADO:");
    console.log(`✅ ${eliminadosSub} eliminados de subcolección`);
    console.log(`✅ ${eliminadosRoot} eliminados de colección raíz`);
    console.log(`✅ ${conservados} productos de licorería conservados`);
    
    // 6. Verificar resultado
    const nuevoSub = await tiendaRef.get();
    const nuevoRoot = await db.collection("productos").get();
    console.log(`\n📦 Subcolección ahora: ${nuevoSub.size} productos`);
    console.log(`📦 Colección raíz ahora: ${nuevoRoot.size} productos`);
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

limpiarProductosTiendaBase();