const fs = require('fs');
const csv = require('csv-parser');
const admin = require('firebase-admin');

// 🔥 FIREBASE ADMIN
admin.initializeApp();

const db = admin.firestore();

// 🔥 ARRAY TEMPORAL
const resultados = [];

// 🔥 LEER CSV
fs.createReadStream('./data/lico.csv')

  // ⚠️ TU CSV USA ;
  .pipe(csv({ separator: ';' }))

  // 🔥 LEER FILAS
  .on('data', (data) => {

    // 🔥 LIMPIAR BOM UTF-8 (PROBLEMA DE "﻿nombre")
    const cleanData = {};

    Object.keys(data).forEach((key) => {

      // elimina caracteres invisibles UTF8
      const cleanKey = key.replace(/^\uFEFF/, '');

      cleanData[cleanKey] = data[key];

    });

    console.log('CSV LIMPIO:', cleanData);

    resultados.push(cleanData);
  })

  // 🔥 TERMINÓ DE LEER CSV
  .on('end', async () => {

    try {

      console.log('🚀 Iniciando importación...');

      // 🔥 CREAR DOCUMENTO PADRE
      await db.collection('catalogos')
        .doc('licoreria')
        .set({
          nombre: 'Licorería',
          tipo: 'catalogo',
          estado: 'activo',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      console.log('✔ Documento catalogos/licoreria listo');

      // 🔥 BATCH FIRESTORE
      let batch = db.batch();

      let operaciones = 0;

      for (const producto of resultados) {

        const ref = db
          .collection('catalogos')
          .doc('licoreria')
          .collection('productos')
          .doc();

        // 🔥 DATOS LIMPIOS
        batch.set(ref, {
          nombre: (producto.nombre || '').trim(),
          categoria: (producto.categoria || '').trim(),
          precio: Number(producto.precio) || 0,
          unidadBase: (producto.unidadBase || '').trim(),
          descripcion: (producto.descripcion || '').trim(),
          imagen: (producto.imagen || '').trim(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        operaciones++;

        console.log('✔ Producto preparado:', producto.nombre);

        // 🔥 FIRESTORE MÁXIMO 500 OPERACIONES
        if (operaciones === 450) {

          await batch.commit();

          console.log('✔ Lote subido');

          batch = db.batch();

          operaciones = 0;
        }
      }

      // 🔥 SUBIR RESTANTES
      if (operaciones > 0) {

        await batch.commit();

      }

      console.log('🔥 CATÁLOGO LICORERÍA IMPORTADO COMPLETO');

    } catch (error) {

      console.error('❌ Error en importación:', error);

    }

  });