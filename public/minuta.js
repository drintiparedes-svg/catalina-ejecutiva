// Página de actas.
//
// Lista las reuniones guardadas en este navegador y, para la elegida, lleva de
// la mano por tres pasos: revisar los datos, generar el acta y exportarla. El
// acta sigue el formato «Minuta lean ejecutiva» (acta.js); la página, la
// gráfica de Catalina.

import {
  leerReuniones, obtenerReunion, guardarReunion, borrarReunion, nuevaReunion,
  transcripcionComoTexto, datosParaMinuta, calidad, duracion, pedirMinuta, enviarMinutaPorCorreo,
  minutaAMarkdown, nombreDeArchivo, leerClavePropia, guardarClavePropia
} from "./reuniones.js";
import { actaHTML, onePagerHTML, dibujarDiagramas, documentoAutonomo, ESTILOS_ACTA, esc, tipoDelActa } from "./acta.js";
import { PLANTILLAS, plantillaDe } from "./plantillas-acta.js";

const $ = selector => document.querySelector(selector);
$("#estilosActa").textContent = ESTILOS_ACTA;

let seleccionada = null;
let estadoServidor = null;
// Un acta con formato vigente (cualquiera de las cuatro plantillas).
const esLean = r => Boolean(tipoDelActa(r));
const A = v => Array.isArray(v) ? v : [];

// Formato del acta: las cuatro plantillas, con su descripción a la vista.
$("#tipo").innerHTML = Object.values(PLANTILLAS).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
const describirTipo = () => { $("#tipoAyuda").textContent = plantillaDe($("#tipo").value).descripcion; };
$("#tipo").addEventListener("change", describirTipo);

// ── Listado ──────────────────────────────────────────────────────────────────

function pintarLista() {
  const reuniones = leerReuniones().slice().reverse();
  $("#lista").innerHTML = reuniones.map(r => `
    <li><button data-id="${esc(r.id)}" aria-current="${r.id === seleccionada?.id}">
      <span class="t">${esc(r.meta.titulo)}</span>
      <span class="d">${esc(new Date(r.meta.inicio).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }))} · ${Math.round(duracion(r) / 60000)} min</span>
      <span><span class="chip">${esc(plantillaDe(tipoDelActa(r) || r.meta.tipo).corto)}</span> ${r.minuta ? '<span class="chip bien">con acta</span>' : '<span class="chip">sin acta</span>'}${!r.meta.fin ? ' <span class="chip aviso">en curso</span>' : ""}</span>
    </button></li>`).join("");
  $("#vacio").hidden = reuniones.length > 0 || !$("#importar").hidden;
  if (!reuniones.length) $("#detalle").hidden = true;
}

$("#lista").addEventListener("click", evento => {
  const boton = evento.target.closest("button[data-id]");
  if (boton) seleccionar(boton.dataset.id);
});

function seleccionar(id) {
  seleccionada = obtenerReunion(id);
  if (!seleccionada) return;
  history.replaceState(null, "", `?id=${encodeURIComponent(id)}`);
  $("#importar").hidden = true;
  $("#estadoGenerar").textContent = "";
  $("#estadoExportar").textContent = "";
  pintarLista();
  pintarDetalle();
  // Un acta generada por voz, o antes de esta versión, puede no tener aún su
  // búsqueda de evidencia: se completa sola al abrirla.
  if (esLean(seleccionada) && A(seleccionada.minuta.preguntasEvidencia).length && !seleccionada.evidencia) buscarEvidencia();
}

// ── Detalle ──────────────────────────────────────────────────────────────────

function pintarDetalle() {
  const r = seleccionada;
  $("#detalle").hidden = !r;
  $("#vacio").hidden = true;
  if (!r) return;
  const q = calidad(r);
  $("#titulo").textContent = r.meta.titulo;
  const claseCobertura = q.cobertura >= 95 ? "bien" : "aviso";
  $("#meta").innerHTML = [
    esc(new Date(r.meta.inicio).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" })),
    `${Math.round(duracion(r) / 60000)} min`,
    `${q.palabras.toLocaleString("es")} palabras`,
    `<span class="chip">transcripción ${esc(q.fuente)}</span>`,
    `<span class="chip ${claseCobertura}" title="Porcentaje del tiempo con audio transcrito">cobertura ${q.cobertura}%</span>`,
    q.huecos ? `<span class="chip aviso">${q.huecos} hueco(s) sin audio</span>` : ""
  ].filter(Boolean).join(" · ");

  $("#fTitulo").value = r.meta.titulo;
  $("#fObjetivo").value = r.meta.objetivo || "";
  $("#fParticipantes").value = r.meta.participantes || "";
  $("#fLugar").value = r.meta.lugar || "";
  $("#fAgenda").value = r.meta.agenda || "";
  $("#fEnlaces").value = r.meta.enlaces || "";
  $("#generar").textContent = r.minuta ? "Regenerar acta" : "Generar acta";
  $("#tipo").value = tipoDelActa(r) || r.meta.tipo || "creativa";
  describirTipo();

  $("#docTranscripcion").textContent = transcripcionComoTexto(r) || "(sin transcripción)";
  pintarActa();
}

function pintarActa() {
  const r = seleccionada;
  const hay = Boolean(r.minuta);
  // Un acta del formato anterior sólo se puede exportar como one pager,
  // Markdown o correo; el resto necesita el formato lean.
  const soloLean = new Set(["pdfActa", "descargarHtml", "buscarEvidencia"]);
  document.querySelectorAll("#exportar button").forEach(b => { b.disabled = !hay || (soloLean.has(b.id) && !esLean(r)); });
  $("#buscarEvidencia").disabled = !esLean(r) || !A(r.minuta.preguntasEvidencia).length;
  if (!hay) {
    const aviso = `<p style="color:#575756;margin:0">Esta reunión todavía no tiene acta. Revisa los datos (paso 1) y pulsa «Generar acta» (paso 2).</p>`;
    $("#docActa").innerHTML = aviso;
    $("#docOnePager").innerHTML = aviso;
    return;
  }
  $("#docActa").innerHTML = actaHTML(r, calidad(r));
  $("#docOnePager").innerHTML = onePagerHTML(r);
  dibujarDiagramas($("#docActa"));
}

// ── Pestañas ─────────────────────────────────────────────────────────────────

document.querySelectorAll(".pestanas button").forEach(boton => boton.addEventListener("click", () => {
  document.querySelectorAll(".pestanas button").forEach(b => b.setAttribute("aria-selected", String(b === boton)));
  document.querySelectorAll("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== boton.dataset.tab; });
}));

// ── Paso 1: datos ────────────────────────────────────────────────────────────

$("#guardarDatos").addEventListener("click", () => {
  const r = seleccionada;
  r.meta.titulo = $("#fTitulo").value.trim() || r.meta.titulo;
  r.meta.objetivo = $("#fObjetivo").value.trim();
  r.meta.participantes = $("#fParticipantes").value.trim();
  r.meta.lugar = $("#fLugar").value.trim();
  r.meta.agenda = $("#fAgenda").value.trim();
  r.meta.enlaces = $("#fEnlaces").value.trim();
  guardarReunion(r);
  pintarLista();
  pintarDetalle();
});

$("#borrar").addEventListener("click", () => {
  if (!confirm(`¿Borrar «${seleccionada.meta.titulo}» con su transcripción y su acta? No se puede deshacer.`)) return;
  borrarReunion(seleccionada.id);
  seleccionada = null;
  history.replaceState(null, "", location.pathname);
  $("#detalle").hidden = true;
  pintarLista();
});

// ── Paso 2: generar ──────────────────────────────────────────────────────────

$("#generar").addEventListener("click", async () => {
  const r = seleccionada;
  if (r.minuta && !confirm("Esta reunión ya tiene acta. ¿Generar una nueva y reemplazarla?")) return;
  const [proveedor, modelo] = ($("#motor").value || "|").split("|");
  const nivel = $("#nivel").value;
  const tipo = $("#tipo").value;
  const estado = $("#estadoGenerar");
  const boton = $("#generar");
  boton.disabled = true;
  estado.className = "estado";
  const inicio = Date.now();
  const reloj = setInterval(() => { estado.textContent = `Redactando el acta (${nivel})… ${Math.round((Date.now() - inicio) / 1000)} s`; }, 1000);
  const resultado = await pedirMinuta(r, { nivel, tipo, motor: proveedor ? { proveedor, modelo } : null });
  clearInterval(reloj);
  boton.disabled = false;
  if (!resultado.ok) {
    estado.className = "estado mal";
    estado.textContent = `No se pudo generar: ${resultado.error}`;
    return;
  }
  // Se relee por si la reunión cambió mientras tanto (p. ej. terminó de
  // transcribirse en la pestaña de Catalina).
  const actual = obtenerReunion(r.id) || r;
  actual.meta.tipo = tipo;
  actual.minuta = resultado.minuta;
  actual.trazabilidad = resultado.trazabilidad;
  delete actual.evidencia;
  guardarReunion(actual);
  seleccionada = actual;
  const t = resultado.trazabilidad;
  estado.className = "estado bien";
  estado.textContent = `Acta lista en ${t.segundos} s con ${t.proveedor}/${t.modelo}.${t.advertencias?.length ? " " + t.advertencias.join(" ") : ""}`;
  pintarLista();
  pintarDetalle();
  if (A(actual.minuta.preguntasEvidencia).length) buscarEvidencia();
});

// Evidencia real: cada pregunta del acta se busca en las nueve bases que ya usa
// Catalina (/referencias). Se guardan las tres primeras de cada una, sin
// lectura crítica: el acta las marca «por evaluar».
async function buscarEvidencia() {
  const r = seleccionada;
  if (!esLean(r)) return;
  const preguntas = A(r.minuta.preguntasEvidencia).slice(0, 5);
  const estado = $("#estadoExportar");
  $("#buscarEvidencia").disabled = true;
  const evidencia = [];
  for (const [i, p] of preguntas.entries()) {
    estado.className = "estado";
    estado.textContent = `Buscando evidencia ${i + 1}/${preguntas.length}: ${p.busqueda || p.pregunta}…`;
    try {
      const respuesta = await fetch("/referencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tema: p.busqueda || p.pregunta })
      });
      const datos = await respuesta.json().catch(() => ({}));
      evidencia.push({
        pregunta: p.pregunta,
        busqueda: p.busqueda,
        refs: (datos.referencias || []).slice(0, 3).map(x => ({ titulo: x.titulo, autores: x.autores, revista: x.revista, anio: x.anio, enlace: x.enlace })),
        consultadas: datos.consultadas || [],
        error: respuesta.ok ? "" : (datos.error || "Sin resultados en las bases consultadas.")
      });
    } catch {
      evidencia.push({ pregunta: p.pregunta, busqueda: p.busqueda, refs: [], error: "No se pudo consultar las bases bibliográficas." });
    }
  }
  const actual = obtenerReunion(r.id) || r;
  actual.evidencia = evidencia;
  actual.evidenciaFecha = Date.now();
  guardarReunion(actual);
  if (seleccionada?.id === actual.id) {
    seleccionada = actual;
    pintarActa();
    const n = evidencia.reduce((s, e) => s + e.refs.length, 0);
    estado.className = n ? "estado bien" : "estado mal";
    estado.textContent = n ? `Evidencia actualizada: ${n} referencias para ${evidencia.length} preguntas (por evaluar).` : "La búsqueda de evidencia no devolvió referencias.";
  }
}
$("#buscarEvidencia").addEventListener("click", buscarEvidencia);

// ── Paso 3: exportar ─────────────────────────────────────────────────────────

// Lo que se imprime o se descarga es exactamente lo que se ve: se clona la
// vista (con los diagramas ya dibujados) en una zona que sólo existe para
// imprimir.
function imprimir(cual) {
  const origen = cual === "onepager" ? $("#docOnePager") : $("#docActa");
  $("#zonaImpresion").innerHTML = `<div class="hoja">${origen.innerHTML}</div>`;
  const tituloPrevio = document.title;
  document.title = `${seleccionada.meta.titulo} — ${cual === "onepager" ? "One pager" : "Acta"}`;
  window.print();
  document.title = tituloPrevio;
}
$("#pdfActa").addEventListener("click", () => imprimir("acta"));
$("#pdfOnePager").addEventListener("click", () => imprimir("onepager"));

const htmlDelActa = () => documentoAutonomo(`${seleccionada.meta.titulo} — Acta`, $("#docActa").innerHTML);

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$("#descargarHtml").addEventListener("click", () => descargar(`${nombreDeArchivo(seleccionada.meta.titulo)}-acta.html`, htmlDelActa(), "text/html"));
$("#descargarMd").addEventListener("click", () => descargar(`${nombreDeArchivo(seleccionada.meta.titulo)}-acta.md`, minutaAMarkdown(seleccionada), "text/markdown"));
$("#copiarMd").addEventListener("click", async () => {
  await copiar(minutaAMarkdown(seleccionada), "Copiado. En Google Docs: Editar → Pegar desde Markdown (actívalo en Herramientas → Preferencias).");
});

$("#enviarCorreo").addEventListener("click", async () => {
  const estado = $("#estadoExportar");
  estado.className = "estado";
  estado.textContent = "Enviando…";
  const adjuntos = esLean(seleccionada) ? [{ nombre: `${nombreDeArchivo(seleccionada.meta.titulo)}-acta.html`, contenido: htmlDelActa() }] : [];
  const r = await enviarMinutaPorCorreo(seleccionada, adjuntos);
  estado.className = r.ok ? "estado bien" : "estado mal";
  estado.textContent = r.ok ? `Enviada a ${r.destinatario}: one pager en el cuerpo; acta completa (HTML) y Markdown adjuntos.` : `No se pudo enviar: ${r.error}`;
});

async function copiar(texto, aviso) {
  const estado = $("#estadoExportar");
  try {
    await navigator.clipboard.writeText(texto);
    estado.className = "estado bien";
    estado.textContent = aviso;
  } catch {
    estado.className = "estado mal";
    estado.textContent = "El navegador no dejó copiar al portapapeles.";
  }
}

// ── Cuenta propia ────────────────────────────────────────────────────────────

$("#copiarPrompt").addEventListener("click", async () => {
  const r = await fetch("/reunion/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...datosParaMinuta(seleccionada), nivel: $("#nivel").value, tipo: $("#tipo").value })
  }).then(x => x.json()).catch(() => null);
  if (!r?.ok) { $("#byokEstado").textContent = "No se pudo preparar el texto."; return; }
  try {
    await navigator.clipboard.writeText(r.prompt);
    $("#byokEstado").textContent = `Copiado (${r.prompt.length.toLocaleString("es")} caracteres). Pégalo en ChatGPT, Claude o Gemini.`;
  } catch {
    $("#byokEstado").textContent = "El navegador no dejó copiar al portapapeles.";
  }
});

function pintarClavePropia() {
  const propia = leerClavePropia();
  $("#byokEstado").textContent = propia
    ? `Usando tu clave de ${propia.proveedor} (termina en …${propia.clave.slice(-4)}). Elige ese proveedor en «Modelo» para que se use.`
    : "Sin clave propia: se usan las claves del servidor.";
  if (propia) $("#byokProveedor").value = propia.proveedor;
}
$("#byokGuardar").addEventListener("click", () => {
  const clave = $("#byokClave").value.trim();
  if (!clave) return;
  guardarClavePropia({ proveedor: $("#byokProveedor").value, clave });
  $("#byokClave").value = "";
  pintarClavePropia();
  pintarProveedores();
});
$("#byokBorrar").addEventListener("click", () => { guardarClavePropia(null); pintarClavePropia(); pintarProveedores(); });

async function pintarProveedores() {
  estadoServidor ??= await fetch("/reunion/estado").then(r => r.json()).catch(() => null);
  const m = estadoServidor?.minuta;
  if (!m) { $("#proveedores").textContent = ""; return; }
  const propia = leerClavePropia();
  const disponible = p => m[p] || propia?.proveedor === p;
  const nombres = { anthropic: "Anthropic", gemini: "Gemini", openai: "OpenAI" };
  $("#proveedores").textContent = "Modelos disponibles: " + ["anthropic", "gemini", "openai"].map(p => `${nombres[p]} ${disponible(p) ? "✓" : "✗"}`).join(" · ")
    + ". Si el elegido no está disponible se usa el siguiente, y el acta lo registra en su trazabilidad.";
  for (const opcion of $("#motor").options) {
    const p = opcion.value.split("|")[0];
    if (p) opcion.disabled = !disponible(p);
  }
}

// ── Importar una transcripción ───────────────────────────────────────────────

$("#importarAbrir").addEventListener("click", () => {
  $("#importar").hidden = false;
  $("#detalle").hidden = true;
  $("#vacio").hidden = true;
  $("#importarTitulo").focus();
});
$("#importarCancelar").addEventListener("click", () => { $("#importar").hidden = true; pintarLista(); if (seleccionada) pintarDetalle(); });
$("#importarCrear").addEventListener("click", () => {
  const texto = $("#importarTexto").value.trim();
  if (texto.length < 40) { alert("Pega una transcripción más larga."); return; }
  const reunion = nuevaReunion({ titulo: $("#importarTitulo").value.trim() || "Reunión importada" });
  const base = reunion.meta.inicio;
  let momento = base;
  const MARCA = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?\]?\s*(?:-->.*)?/;
  for (const linea of texto.split(/\n+/)) {
    const limpia = linea.trim();
    if (!limpia || /^WEBVTT|^\d+$/.test(limpia)) continue;
    const marca = limpia.match(MARCA);
    if (marca) {
      const segundos = marca[1].split(":").map(Number).reduce((n, p) => n * 60 + p, 0);
      momento = base + segundos * 1000;
      const resto = limpia.slice(marca[0].length).trim();
      if (resto) reunion.navegador.push({ momento, texto: resto });
    } else {
      reunion.navegador.push({ momento, texto: limpia });
      momento += Math.max(1500, limpia.split(/\s+/).length * 400);
    }
  }
  reunion.meta.fin = Math.max(momento, base + 60000);
  reunion.estadisticas = { importada: true };
  guardarReunion(reunion);
  $("#importarTexto").value = "";
  $("#importarTitulo").value = "";
  seleccionar(reunion.id);
});

// ── Arranque ─────────────────────────────────────────────────────────────────

// Si la reunión cambia en la pestaña de Catalina (sigue transcribiendo, o se
// generó el acta por voz), esta página se entera sola. Sólo se repinta lo que
// cambió, para no borrar lo que se esté escribiendo en el formulario.
window.addEventListener("storage", evento => {
  if (evento.key !== "catalina.reuniones.v1") return;
  pintarLista();
  if (!seleccionada) return;
  const actual = obtenerReunion(seleccionada.id);
  if (!actual) return;
  const cambio = JSON.stringify([actual.minuta, actual.evidencia]) !== JSON.stringify([seleccionada.minuta, seleccionada.evidencia]);
  seleccionada = actual;
  $("#docTranscripcion").textContent = transcripcionComoTexto(actual) || "(sin transcripción)";
  if (cambio) pintarActa();
});

pintarLista();
pintarClavePropia();
pintarProveedores();
const inicial = new URLSearchParams(location.search).get("id") || leerReuniones().at(-1)?.id;
if (inicial) seleccionar(inicial);
