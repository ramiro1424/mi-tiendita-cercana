// Etiquetas de unidades
export const UNIT_LABEL = {
    unidad: 'unidad', kg: 'kg', g: 'g', lb: 'lb', l: 'L', ml: 'ml', paquete: 'paquete'
  };
  
  // Formato de dinero
  export function money(v){ const n = Number(v)||0; return '$' + n.toLocaleString(); }
  
  // Debounce simple
  export function debounce(fn, wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
  
  // A número (o null)
  export function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
  
  // Fecha corta (YYYY-MM-DD) para Date o Timestamp
  export function fechaCorta(ts){
    const d = ts?.toDate?.() ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts||Date.now()));
    return d.toISOString().slice(0,10);
  }
  
  // Mensajes toast muy simples
  export function setMsg(texto, ok=true){
    const el = document.getElementById('toast') || document.querySelector('.global-toast');
    if (el){
      el.textContent = texto;
      el.className = 'global-toast ' + (ok?'ok':'err');
      el.style.display='block';
      setTimeout(()=> el.style.display='none', 2500);
    } else {
      console[ok?'log':'warn'](texto);
    }
  }
  
  // Badge por estado de pedido
  export function badgeByStatus(s){
    return { pendiente:'badge-warning', proceso:'badge-info', envio:'badge-primary',
             completado:'badge-success', cancelado:'badge-secondary' }[s] || 'badge-secondary';
  }
  
  // Normaliza unidad
  export function normalizeUnit(u){ return (u||'unidad').toLowerCase(); }
  
  // Helpers de formularios
  export function getForm(id){ return document.getElementById(id)?.value || ''; }
  export function setForm(id, v){ const el=document.getElementById(id); if(el) el.value = v ?? ''; }
  