// Conecta los botones del overlay con las funciones ya definidas en productos.js
(function(){
    const ov   = document.getElementById('map-overlay');
    const btn  = document.getElementById('open-map-compact');
    const cls1 = document.getElementById('map-overlay-close');
    const cls2 = document.getElementById('map-overlay-x');
    const geo  = document.getElementById('map-use-geo');
  
    const open = ()=>{
      if (!ov) return;
      ov.style.display = 'block';
      // estas funciones existen en productos.js:
      try { window.initCompactMap?.(); } catch {}
      setTimeout(()=>{
        try { window.mapCompact?.invalidateSize?.(); } catch {}
        try { window.renderCompactMarkers?.(); } catch {}
        try { window.fitCompactToTiendas?.(); } catch {}
      }, 60);
    };
    const close = ()=> { if (ov) ov.style.display = 'none'; };
  
    btn?.addEventListener('click', open);
    cls1?.addEventListener('click', close);
    cls2?.addEventListener('click', close);
  
    // Atajo: usar geolocalización y refrescar pins
    geo?.addEventListener('click', ()=>{
      // usarUbicacionYOrdenar ya existe en productos.js
      try { window.usarUbicacionYOrdenar?.(); } catch {}
      setTimeout(()=>{
        try { window.mapCompact?.invalidateSize?.(); } catch {}
        try { window.renderCompactMarkers?.(); } catch {}
        try { window.fitCompactToTiendas?.(); } catch {}
      }, 200);
    });
  
    // Exponer por si lo necesitas en otros módulos
    window.openMapOverlay = open;
    window.closeMapOverlay = close;
  })();
  