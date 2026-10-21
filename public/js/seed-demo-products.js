// ============================================================
// public/js/seed-demo-products.js
// ============================================================
// ⚠️ SIEMBRA DEMO DESACTIVADA
//
// Este archivo YA NO crea productos.
//
// El catálogo oficial se administra desde la ruta central:
//
//   productos_base → tiendas/{uid}/productos
//
// TIENDA:
//   catálogo oficial = 465 productos de productos_base
//
// LICORERÍA:
//   catálogo correspondiente de licorería
//
// Este archivo se conserva únicamente para evitar errores si
// alguna pantalla antigua todavía intenta cargarlo.
// ============================================================

console.info(
  '[CATÁLOGO] seed-demo-products.js cargado — SIEMBRA DEMO DESACTIVADA.'
);


// ============================================================
// Función antigua conservada para compatibilidad
// ============================================================

export async function seedDemoProductsForMerchant() {

  console.warn(
    '[CATÁLOGO] seedDemoProductsForMerchant() está DESACTIVADA. ' +
    'No se crearán productos demo.'
  );

  return {
    created: 0,
    current: 0,
    disabled: true
  };
}


// ============================================================
// Compatibilidad con código antiguo
// ============================================================

window.seedDemoFor = seedDemoProductsForMerchant;


// ============================================================
// Desactivar botón antiguo de productos demo
// ============================================================

function desactivarBotonDemo() {

  const btn = document.getElementById('btn-seed-200');

  if (!btn) return;

  btn.disabled = true;
  btn.style.display = 'none';

  console.info(
    '[CATÁLOGO] Botón "Sembrar 200 demo" desactivado.'
  );
}


// ============================================================
// Ejecutar al cargar
// ============================================================

if (document.readyState === 'loading') {

  document.addEventListener(
    'DOMContentLoaded',
    desactivarBotonDemo,
    { once: true }
  );

} else {

  desactivarBotonDemo();

}