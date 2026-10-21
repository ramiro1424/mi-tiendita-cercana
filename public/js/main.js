document.addEventListener("DOMContentLoaded", function () {
    const formulario = document.getElementById("registroForm");
    const mensaje = document.getElementById("mensaje");
  
    if (formulario && mensaje) {
      formulario.addEventListener("submit", function (e) {
        e.preventDefault();
  
        const nombre = document.getElementById("nombre").value.trim();
        const cedula = document.getElementById("cedula").value.trim();
        const correo = document.getElementById("correo").value.trim();
        const confirmarCorreo = document.getElementById("confirmarCorreo").value.trim();
        const contraseña = document.getElementById("contraseña").value;
        const confirmarContraseña = document.getElementById("confirmarContraseña").value;
        const tipoUsuario = document.getElementById("tipoUsuario").value;
  
        if (
          correo !== confirmarCorreo ||
          contraseña !== confirmarContraseña ||
          nombre === "" ||
          cedula === "" ||
          tipoUsuario === ""
        ) {
          mensaje.textContent = "Verifica que los campos coincidan y estén completos.";
          mensaje.style.color = "red";
          return;
        }
  
        const usuario = {
          nombre,
          cedula,
          correo,
          contraseña,
          tipoUsuario,
        };
  
        let usuarios = JSON.parse(localStorage.getItem("usuarios")) || [];
        const yaRegistrado = usuarios.some((u) => u.correo === correo);
  
        if (yaRegistrado) {
          mensaje.textContent = "Este correo ya está registrado.";
          mensaje.style.color = "red";
          return;
        }
  
        usuarios.push(usuario);
        localStorage.setItem("usuarios", JSON.stringify(usuarios));
  
        mensaje.textContent = "¡Registro exitoso!";
        mensaje.style.color = "green";
  
        setTimeout(() => {
          window.location.href = "bienvenida.html";
        }, 1500);
      });
    }
  });
  

  document.addEventListener('DOMContentLoaded', function() {
    // Tu código de inicialización aquí
    // Esto asegura que el DOM esté listo
});