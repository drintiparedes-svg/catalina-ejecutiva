// Teclado seguro para el PIN.
//
// El PIN no se dice en voz alta: se escribe aquí. El valor vive en una variable
// de este módulo mientras el teclado está abierto, se muestra sólo como puntos,
// no se guarda en ningún sitio y se borra al cerrar. Devuelve una promesa con
// el texto escrito, o null si la persona cancela.
//
// Acepta el teclado físico además del de pantalla: cifras, Retroceso, Intro y
// Escape. Los botones son grandes a propósito: se usa desde un teléfono.

const MAXIMO = 12;

let raiz = null;
let pendiente = null;   // { resolver, minimo }
let valor = "";

export function pedirPorTeclado({ titulo, ayuda = "", minimo = 4 } = {}) {
  if (pendiente) cerrar(null);
  montar();
  raiz.querySelector("#tecladoTitulo").textContent = titulo || "Ingrese su PIN";
  raiz.querySelector("#tecladoAyuda").textContent = ayuda;
  valor = "";
  pintar();
  raiz.hidden = false;
  raiz.querySelector('[data-tecla="1"]').focus();
  return new Promise(resolver => { pendiente = { resolver, minimo }; });
}

function montar() {
  if (raiz) return;
  raiz = document.querySelector("#teclado");
  if (!raiz) throw new Error("Falta el marcado #teclado en la página");

  const grilla = raiz.querySelector("#tecladoGrilla");
  for (const tecla of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0", "confirmar"]) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.dataset.tecla = tecla;
    if (tecla === "borrar") { boton.textContent = "⌫"; boton.setAttribute("aria-label", "Borrar"); }
    else if (tecla === "confirmar") { boton.textContent = "✓"; boton.setAttribute("aria-label", "Confirmar"); boton.classList.add("teclado-confirmar"); }
    else boton.textContent = tecla;
    grilla.appendChild(boton);
  }

  grilla.addEventListener("click", evento => {
    const tecla = evento.target.closest("button")?.dataset.tecla;
    if (!tecla) return;
    if (tecla === "borrar") valor = valor.slice(0, -1);
    else if (tecla === "confirmar") return confirmar();
    else if (valor.length < MAXIMO) valor += tecla;
    pintar();
  });
  raiz.querySelector("#tecladoCancelar").addEventListener("click", () => cerrar(null));
  raiz.addEventListener("keydown", evento => {
    if (raiz.hidden) return;
    if (/^[0-9]$/.test(evento.key)) { if (valor.length < MAXIMO) valor += evento.key; pintar(); evento.preventDefault(); }
    else if (evento.key === "Backspace") { valor = valor.slice(0, -1); pintar(); evento.preventDefault(); }
    else if (evento.key === "Enter") { confirmar(); evento.preventDefault(); }
    else if (evento.key === "Escape") { cerrar(null); evento.preventDefault(); }
  });
}

function confirmar() {
  if (!pendiente) return;
  if (valor.length < pendiente.minimo) {
    raiz.querySelector("#tecladoPuntos").dataset.corto = "true";
    setTimeout(() => { raiz.querySelector("#tecladoPuntos").dataset.corto = "false"; }, 400);
    return;
  }
  cerrar(valor);
}

function pintar() {
  const puntos = raiz.querySelector("#tecladoPuntos");
  puntos.textContent = "●".repeat(valor.length);
  puntos.setAttribute("aria-label", `${valor.length} dígitos ingresados`);
}

function cerrar(resultado) {
  const actual = pendiente;
  pendiente = null;
  valor = "";
  if (raiz) { pintar(); raiz.hidden = true; }
  actual?.resolver(resultado);
}
