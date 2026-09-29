// Página de minutas.
//
// Lista las reuniones guardadas en este navegador, genera la minuta con el
// nivel y el modelo elegidos, y la muestra en sus dos formatos: el one pager
// para decidir en dos minutos y la minuta extensa, con desarrollo por tema,
// diagramas (Mermaid) y gráficos (SVG propio, sin librerías). Desde aquí se
// exporta a PDF, HTML autónomo y Markdown, y se envía por correo.
//
// Todo el contenido que viene del modelo o de la transcripción se escapa antes
// de pintarse: una transcripción puede contener cualquier cosa.

import {
  leerReuniones, obtenerReunion, guardarReunion, borrarReunion, nuevaReunion,
  transcripcionComoTexto, datosParaMinuta, calidad, duracion, pedirMinuta, enviarMinutaPorCorreo,
  minutaAMarkdown, nombreDeArchivo, leerClavePropia, guardarClavePropia
} from "./reuniones.js";

const $ = selector => document.querySelector(selector);
const esc = t => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const parrafos = t => String(t ?? "").split(/\n{2,}|\n/).map(l => l.trim()).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");
const lista = items => items?.filter(Boolean).length ? `<ul>${items.filter(Boolean).map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
const fechaLarga = ms => new Date(ms).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" });
const tabla = (cabeceras, filas) => filas.length
  ? `<table><thead><tr>${cabeceras.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${esc(c || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : "";

let seleccionada = null;
let estadoServidor = null;

// ── Listado ──────────────────────────────────────────────────────────────────

function pintarLista() {
  const reuniones = leerReuniones().slice().reverse();
  $("#lista").innerHTML = reuniones.map(r => `
    <li><button data-id="${esc(r.id)}" aria-current="${r.id === seleccionada?.id}">
      <span class="t">${esc(r.meta.titulo)}</span>
      <span class="d">${esc(new Date(r.meta.inicio).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }))} · ${Math.round(duracion(r) / 60000)} min
        ${r.minuta ? ' · <span class="insignia ok">minuta</span>' : ""}${!r.meta.fin ? ' · <span class="insignia aviso">en curso</span>' : ""}</span>
    </button></li>`).join("");
  $("#vacio").hidden = reuniones.length > 0 || !$("#importar").hidden;
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
  pintarLista();
  pintarDetalle();
}

// ── Detalle ──────────────────────────────────────────────────────────────────

function pintarDetalle() {
  const r = seleccionada;
  $("#detalle").hidden = !r;
  $("#vacio").hidden = true;
  if (!r) return;
  const q = calidad(r);
  $("#titulo").textContent = r.meta.titulo;
  const claseCobertura = q.cobertura >= 95 ? "ok" : q.cobertura >= 80 ? "aviso" : "mal";
  $("#meta").innerHTML = [
    esc(fechaLarga(r.meta.inicio)),
    `${Math.round(duracion(r) / 60000)} min`,
    `${q.palabras.toLocaleString("es")} palabras`,
    `<span class="insignia">${esc(q.fuente)}</span>`,
    `<span class="insignia ${claseCobertura}" title="Porcentaje del tiempo con audio transcrito">cobertura ${q.cobertura}%</span>`,
    q.huecos ? `<span class="insignia aviso">${q.huecos} hueco(s) sin audio</span>` : "",
    q.tramosFallidos ? `<span class="insignia aviso">${q.tramosFallidos} tramo(s) de alta fidelidad fallidos</span>` : ""
  ].filter(Boolean).join(" · ");

  $("#fTitulo").value = r.meta.titulo;
  $("#fObjetivo").value = r.meta.objetivo || "";
  $("#fParticipantes").value = r.meta.participantes || "";
  $("#fLugar").value = r.meta.lugar || "";
  $("#fAgenda").value = r.meta.agenda || "";
  $("#fEnlaces").value = r.meta.enlaces || "";

  $("#docTranscripcion").textContent = transcripcionComoTexto(r) || "(sin transcripción)";
  pintarMinuta();
}

function pintarMinuta() {
  const r = seleccionada;
  const m = r.minuta;
  $("#exportar").hidden = !m;
  if (!m) {
    const aviso = `<p class="ayuda">Todavía no hay minuta. Revisa los datos de la reunión y pulsa «Generar minuta».</p>`;
    $("#docOnePager").innerHTML = aviso;
    $("#docExtensa").innerHTML = aviso;
    $("#docTrazabilidad").innerHTML = trazabilidad(r);
    return;
  }
  $("#docOnePager").innerHTML = onePager(r);
  $("#docExtensa").innerHTML = extensa(r);
  $("#docTrazabilidad").innerHTML = trazabilidad(r);
  dibujarDiagramas($("#docExtensa"));
}

function onePager(r) {
  const op = r.minuta.onePager;
  return `
    <div class="antetitulo">ONE PAGER · ${esc(fechaLarga(r.meta.inicio))} · ${Math.round(duracion(r) / 60000)} min${op.estado ? ` · <span class="insignia">${esc(op.estado)}</span>` : ""}</div>
    <h1>${esc(r.meta.titulo)}</h1>
    <p class="clave">${esc(op.mensajeClave)}</p>
    ${parrafos(op.contexto)}
    ${op.indicadores.length ? `<div class="kpis">${op.indicadores.map(i => `<div class="kpi"><b>${esc(i.valor)}</b><span>${esc(i.etiqueta)}</span></div>`).join("")}</div>` : ""}
    <div class="dos">
      <div>${op.decisiones.length ? `<h2>Decisiones</h2>${lista(op.decisiones)}` : ""}</div>
      <div>${op.riesgos.length ? `<h2>Riesgos</h2>${lista(op.riesgos)}` : ""}</div>
    </div>
    ${op.acciones.length ? `<h2>Acciones</h2>${tabla(["Acción", "Responsable", "Plazo"], op.acciones.map(a => [a.accion, a.responsable, a.plazo]))}` : ""}
    ${op.proximosPasos.length ? `<h2>Próximos pasos</h2>${lista(op.proximosPasos)}` : ""}
    <p class="pie">Síntesis generada por Catalina a partir de una transcripción automática. El detalle, la evidencia y las limitaciones están en la minuta extensa.</p>`;
}

function extensa(r) {
  const ex = r.minuta.extensa;
  const m = r.meta;
  const enlaces = String(m.enlaces || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const enlace = texto => /^https?:\/\//i.test(texto) ? `<a href="${esc(texto)}" target="_blank" rel="noopener noreferrer">${esc(texto)}</a>` : esc(texto);
  return `
    <div class="antetitulo">MINUTA EXTENSA · ${esc(r.minuta.tipoDeReunion || "Reunión")}</div>
    <h1>${esc(m.titulo)}</h1>

    <h2>Información de la reunión</h2>
    ${tabla(["Campo", "Detalle"], [
      ["Fecha y hora", fechaLarga(m.inicio)],
      ["Duración", `${Math.round(duracion(r) / 60000)} minutos`],
      m.lugar && ["Lugar / plataforma", m.lugar],
      m.participantes && ["Participantes declarados", m.participantes],
      m.objetivo && ["Objetivo", m.objetivo],
      ["Fuente de la transcripción", `${calidad(r).fuente} · cobertura ${calidad(r).cobertura}%`]
    ].filter(Boolean))}
    ${m.agenda ? `<h3>Agenda</h3>${parrafos(m.agenda)}` : ""}

    <h2>Resumen ejecutivo</h2>
    ${parrafos(ex.resumenEjecutivo)}
    ${ex.contexto ? `<h2>Contexto</h2>${parrafos(ex.contexto)}` : ""}
    ${ex.participantes.length ? `<h2>Participantes</h2>${tabla(["Nombre", "Rol", "Aportes"], ex.participantes.map(p => [p.nombre, p.rol, p.aportes]))}` : ""}

    <h2>Desarrollo por tema</h2>
    ${ex.temas.map((t, i) => `
      <h3>${i + 1}. ${esc(t.titulo)} ${t.marcaInicio ? `<span class="marca">[${esc(t.marcaInicio)}]</span>` : ""}</h3>
      ${parrafos(t.desarrollo)}
      ${t.puntosClave.length ? `<p><strong>Puntos clave</strong></p>${lista(t.puntosClave)}` : ""}
      ${t.posiciones.length ? `<p><strong>Posiciones</strong></p><ul>${t.posiciones.map(p => `<li><strong>${esc(p.quien)}:</strong> ${esc(p.postura)}</li>`).join("")}</ul>` : ""}
      ${t.datos.length ? `<p><strong>Datos mencionados</strong></p>${lista(t.datos)}` : ""}
      ${t.citas.map(c => `<blockquote>«${esc(c.texto)}»<cite>${esc(c.hablante || "No identificado")}${c.marca ? ` · ${esc(c.marca)}` : ""}</cite></blockquote>`).join("")}
      ${t.conclusion ? `<p><strong>Conclusión:</strong> ${esc(t.conclusion)}</p>` : ""}`).join("")}

    ${ex.diagramas.length || ex.graficos.length ? "<h2>Diagramas y gráficos</h2>" : ""}
    ${ex.diagramas.map((d, i) => `
      <figure class="figura">
        <div class="mermaid-fuente" data-i="${i}">${esc(d.mermaid)}</div>
        <figcaption><strong>${esc(d.titulo)}</strong>${d.proposito ? ` — ${esc(d.proposito)}` : ""}</figcaption>
      </figure>`).join("")}
    ${ex.graficos.map(g => `
      <figure class="figura">${grafico(g)}
        <figcaption><strong>${esc(g.titulo)}</strong>${g.unidad ? ` (${esc(g.unidad)})` : ""}${g.fuente ? ` · Fuente: transcripción ${esc(g.fuente)}` : ""}</figcaption>
      </figure>`).join("")}

    ${ex.decisiones.length ? `<h2>Decisiones</h2>${tabla(["Decisión", "Fundamento", "Responsable", "Evidencia"], ex.decisiones.map(d => [d.decision, d.fundamento, d.responsable, d.evidencia]))}` : ""}
    ${ex.acciones.length ? `<h2>Plan de acción</h2>${tabla(["Acción", "Responsable", "Plazo", "Prioridad", "Evidencia"], ex.acciones.map(a => [a.accion, a.responsable, a.plazo, a.prioridad, a.evidencia]))}` : ""}
    ${ex.riesgos.length ? `<h2>Riesgos</h2>${tabla(["Riesgo", "Probabilidad", "Impacto", "Mitigación"], ex.riesgos.map(x => [x.riesgo, x.probabilidad, x.impacto, x.mitigacion]))}` : ""}
    ${ex.preguntasAbiertas.length ? `<h2>Preguntas abiertas</h2>${lista(ex.preguntasAbiertas)}` : ""}
    ${ex.desacuerdos.length ? `<h2>Desacuerdos</h2>${lista(ex.desacuerdos)}` : ""}
    ${ex.supuestos.length ? `<h2>Supuestos</h2>${lista(ex.supuestos)}` : ""}
    ${ex.datosCuantitativos.length ? `<h2>Datos cuantitativos</h2>${tabla(["Indicador", "Valor", "Unidad", "Contexto", "Marca"], ex.datosCuantitativos.map(d => [d.indicador, d.valor.toLocaleString("es"), d.unidad, d.contexto, d.marca]))}` : ""}

    ${(enlaces.length || ex.referenciasMencionadas.length || r.materiales?.length) ? "<h2>Referencias</h2>" : ""}
    ${enlaces.length ? `<p><strong>Aportadas por el organizador</strong></p><ul>${enlaces.map(e => `<li>${enlace(e)}</li>`).join("")}</ul>` : ""}
    ${ex.referenciasMencionadas.length ? `<p><strong>Mencionadas en la reunión</strong> <span class="marca">(no verificadas)</span></p><ul>${ex.referenciasMencionadas.map(x => `<li>${x.tipo ? `<span class="insignia">${esc(x.tipo)}</span> ` : ""}${esc(x.descripcion)}${x.url ? ` — ${enlace(x.url)}` : ""}${x.marca ? ` <span class="marca">[${esc(x.marca)}]</span>` : ""}</li>`).join("")}</ul>` : ""}
    ${r.materiales?.length ? `<p><strong>Material mostrado por Catalina</strong></p><ul>${[...new Set(r.materiales)].map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${ex.glosario.length ? `<h2>Glosario</h2><ul>${ex.glosario.map(g => `<li><strong>${esc(g.termino)}:</strong> ${esc(g.definicion)}</li>`).join("")}</ul>` : ""}

    <h2>Limitaciones</h2>
    ${parrafos(ex.limitaciones || "Sin limitaciones declaradas por el modelo.")}
    <p class="pie">Minuta generada automáticamente a partir de una transcripción automática${r.trazabilidad?.modelo ? ` con ${esc(r.trazabilidad.proveedor)}/${esc(r.trazabilidad.modelo)} (nivel ${esc(r.trazabilidad.nivel)})` : ""}. Requiere revisión humana antes de difundirse. Las marcas [hh:mm:ss] remiten a la transcripción.</p>`;
}

function trazabilidad(r) {
  const t = r.trazabilidad || {};
  const q = calidad(r);
  return `
    <h1>Trazabilidad</h1>
    <h2>Captura</h2>
    ${tabla(["Indicador", "Valor"], [
      ["Fuente principal", q.fuente],
      ["Cobertura estimada", `${q.cobertura}%`],
      ["Huecos sin audio", q.huecos],
      ["Tramos de alta fidelidad transcritos / fallidos", `${q.tramosAlta} / ${q.tramosFallidos}`],
      ["Reinicios del reconocimiento del navegador", q.reinicios ?? "—"],
      ["Frases cortadas rescatadas", q.parcialesRescatados ?? "—"],
      ["Errores de reconocimiento", q.errores ?? "—"],
      ["Preguntas a Catalina durante la reunión", r.intervenciones?.length || 0]
    ])}
    <h2>Minuta</h2>
    ${r.minuta ? tabla(["Campo", "Valor"], [
      ["Proveedor / modelo", `${t.proveedor || "—"} / ${t.modelo || "—"}`],
      ["Nivel", t.nivel || "—"],
      ["Clave usada", t.clavePropia ? "Propia (BYOK)" : "Del servidor"],
      ["Generada", t.generadaEn ? new Date(t.generadaEn).toLocaleString("es-CL") : "—"],
      ["Tiempo de generación", t.segundos ? `${t.segundos} s` : "—"],
      ["Caracteres de entrada", t.caracteresEntrada?.toLocaleString("es") || "—"],
      ["Tokens (entrada / salida)", t.uso ? `${t.uso.input_tokens ?? t.uso.prompt_tokens ?? t.uso.promptTokenCount ?? "?"} / ${t.uso.output_tokens ?? t.uso.completion_tokens ?? t.uso.candidatesTokenCount ?? "?"}` : "—"]
    ]) + (t.advertencias?.length ? `<p><strong>Advertencias</strong></p>${lista(t.advertencias)}` : "") : "<p>Sin minuta generada.</p>"}
    <h2>Supuestos y límites del sistema</h2>
    <ul>
      <li>La transcripción es automática: puede contener errores de reconocimiento, sobre todo en nombres propios, siglas y cifras.</li>
      <li>El reconocimiento del navegador sólo oye el micrófono local; la alta fidelidad con audio de pestaña capta además a los participantes remotos.</li>
      <li>No hay separación de hablantes fiable: las atribuciones de la minuta se basan en nombres mencionados y en el contexto.</li>
      <li>Los datos se guardan sólo en este navegador. Borrar los datos del sitio borra las reuniones.</li>
    </ul>`;
}

// ── Gráficos: SVG propio ─────────────────────────────────────────────────────
//
// Tres formas bastan para lo que se dice en una reunión: comparar (barras),
// evolución (líneas) y reparto (torta). Sin librerías: el SVG se exporta tal
// cual dentro del HTML y del correo adjunto.

const PALETA = ["#0071E3", "#051C2C", "#34A853", "#F29900", "#A142F4", "#E8453C", "#12A4AF", "#6E6E73"];

function grafico(g) {
  const series = g.series.slice(0, 12);
  const max = Math.max(...series.map(s => s.valor), 0) || 1;
  const fmt = n => Number(n).toLocaleString("es", { maximumFractionDigits: 2 });
  if (g.tipo === "torta") {
    const total = series.reduce((n, s) => n + Math.max(0, s.valor), 0) || 1;
    let angulo = -Math.PI / 2;
    const arcos = series.map((s, i) => {
      const a = (Math.max(0, s.valor) / total) * Math.PI * 2;
      const x1 = 110 + 90 * Math.cos(angulo), y1 = 110 + 90 * Math.sin(angulo);
      angulo += a;
      const x2 = 110 + 90 * Math.cos(angulo), y2 = 110 + 90 * Math.sin(angulo);
      return `<path d="M110 110 L${x1.toFixed(1)} ${y1.toFixed(1)} A90 90 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z" fill="${PALETA[i % PALETA.length]}" stroke="#fff" stroke-width="1.5"/>`;
    }).join("");
    const leyenda = series.map((s, i) => `<g transform="translate(240 ${24 + i * 22})"><rect width="12" height="12" rx="2" fill="${PALETA[i % PALETA.length]}"/><text x="18" y="10.5" font-size="12" fill="currentColor">${esc(s.etiqueta)} — ${fmt(s.valor)} (${Math.round(s.valor / total * 100)}%)</text></g>`).join("");
    return `<svg viewBox="0 0 560 ${Math.max(230, 30 + series.length * 22)}" role="img" aria-label="${esc(g.titulo)}">${arcos}${leyenda}</svg>`;
  }
  const ancho = 640, alto = 280, izq = 56, abajo = 64, arriba = 16, der = 16;
  const w = ancho - izq - der, h = alto - arriba - abajo;
  const paso = w / series.length;
  const y = v => arriba + h - (v / max) * h;
  const guias = [0, .25, .5, .75, 1].map(f => `<line x1="${izq}" x2="${ancho - der}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#E5E5EA"/><text x="${izq - 6}" y="${y(max * f) + 4}" font-size="10" text-anchor="end" fill="#6E6E73">${fmt(max * f)}</text>`).join("");
  const etiquetas = series.map((s, i) => `<text x="${izq + paso * i + paso / 2}" y="${alto - abajo + 16}" font-size="11" text-anchor="middle" fill="currentColor">${esc(s.etiqueta.slice(0, 18))}</text>`).join("");
  let marcas;
  if (g.tipo === "lineas") {
    const puntos = series.map((s, i) => `${(izq + paso * i + paso / 2).toFixed(1)},${y(s.valor).toFixed(1)}`);
    marcas = `<polyline points="${puntos.join(" ")}" fill="none" stroke="${PALETA[0]}" stroke-width="2.5"/>`
      + series.map((s, i) => `<circle cx="${izq + paso * i + paso / 2}" cy="${y(s.valor)}" r="4" fill="${PALETA[0]}"/><text x="${izq + paso * i + paso / 2}" y="${y(s.valor) - 8}" font-size="11" text-anchor="middle" fill="currentColor">${fmt(s.valor)}</text>`).join("");
  } else {
    const barra = Math.min(56, paso * .62);
    marcas = series.map((s, i) => `<rect x="${izq + paso * i + (paso - barra) / 2}" y="${y(Math.max(0, s.valor))}" width="${barra}" height="${Math.max(0, h - (y(Math.max(0, s.valor)) - arriba))}" rx="3" fill="${PALETA[0]}"/><text x="${izq + paso * i + paso / 2}" y="${y(Math.max(0, s.valor)) - 6}" font-size="11" text-anchor="middle" fill="currentColor">${fmt(s.valor)}</text>`).join("");
  }
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="${esc(g.titulo)}">${guias}${marcas}${etiquetas}</svg>`;
}

// ── Diagramas: Mermaid ───────────────────────────────────────────────────────
//
// Se carga sólo si la minuta trae diagramas. `securityLevel: "strict"` impide
// que un diagrama lleve HTML o enlaces con script. Si el modelo escribió un
// diagrama con errores de sintaxis, se muestra su código en vez de romper.

let mermaid = null;
async function dibujarDiagramas(contenedor) {
  const fuentes = [...contenedor.querySelectorAll(".mermaid-fuente")];
  if (!fuentes.length) return;
  try {
    mermaid ??= (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", fontFamily: "inherit" });
  } catch {
    fuentes.forEach(f => { f.outerHTML = `<pre>${esc(f.textContent)}</pre><p class="ayuda">No se pudo cargar el dibujante de diagramas (sin conexión a jsdelivr). El código Mermaid se puede pegar en mermaid.live.</p>`; });
    return;
  }
  for (const [i, fuente] of fuentes.entries()) {
    const codigo = fuente.textContent;
    const id = `diagrama-${Date.now()}-${i}`;
    try {
      // Se valida antes de dibujar: con un diagrama inválido, render() deja su
      // aviso de error pegado al final de la página.
      if (!(await mermaid.parse(codigo, { suppressErrors: true }))) throw new Error("sintaxis");
      const { svg } = await mermaid.render(id, codigo);
      fuente.innerHTML = svg;
      fuente.classList.remove("mermaid-fuente");
    } catch {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      fuente.outerHTML = `<pre>${esc(codigo)}</pre><p class="ayuda">El diagrama propuesto tiene un error de sintaxis; se muestra su código.</p>`;
    }
  }
}

// ── Acciones ─────────────────────────────────────────────────────────────────

document.querySelectorAll(".pestanas button").forEach(boton => boton.addEventListener("click", () => {
  document.querySelectorAll(".pestanas button").forEach(b => b.setAttribute("aria-selected", String(b === boton)));
  document.querySelectorAll("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== boton.dataset.tab; });
}));

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
  if (!confirm(`¿Borrar «${seleccionada.meta.titulo}» con su transcripción y su minuta? No se puede deshacer.`)) return;
  borrarReunion(seleccionada.id);
  seleccionada = null;
  history.replaceState(null, "", location.pathname);
  $("#detalle").hidden = true;
  pintarLista();
});

$("#generar").addEventListener("click", async () => {
  const r = seleccionada;
  if (r.minuta && !confirm("Esta reunión ya tiene minuta. ¿Generar una nueva y reemplazarla?")) return;
  const [proveedor, modelo] = ($("#motor").value || "|").split("|");
  const nivel = $("#nivel").value;
  const estado = $("#estadoGenerar");
  const boton = $("#generar");
  boton.disabled = true;
  estado.className = "estado";
  const inicio = Date.now();
  const reloj = setInterval(() => { estado.textContent = `Redactando la minuta (${nivel})… ${Math.round((Date.now() - inicio) / 1000)} s. Un modelo de razonamiento alto puede tardar 1–3 minutos.`; }, 1000);
  const resultado = await pedirMinuta(r, { nivel, motor: proveedor ? { proveedor, modelo } : null });
  clearInterval(reloj);
  boton.disabled = false;
  if (!resultado.ok) {
    estado.className = "estado mal";
    estado.textContent = `No se pudo generar: ${resultado.error}`;
    return;
  }
  // Se relee por si la reunión cambió mientras tanto (p. ej. terminó de
  // transcribirse en la otra pestaña).
  const actual = obtenerReunion(r.id) || r;
  actual.minuta = resultado.minuta;
  actual.trazabilidad = resultado.trazabilidad;
  guardarReunion(actual);
  seleccionada = actual;
  const t = resultado.trazabilidad;
  estado.className = "estado ok";
  estado.textContent = `Minuta lista en ${t.segundos} s con ${t.proveedor}/${t.modelo}.${t.advertencias?.length ? " " + t.advertencias.join(" ") : ""}`;
  pintarLista();
  pintarDetalle();
});

$("#imprimir").addEventListener("click", () => {
  // Se imprimen juntas: primero el one pager, después la extensa.
  const paneles = [...document.querySelectorAll("[data-panel]")];
  const antes = paneles.map(p => p.hidden);
  paneles.forEach(p => { p.hidden = !["onepager", "extensa"].includes(p.dataset.panel); });
  $("#docExtensa").style.breakBefore = "page";
  window.print();
  paneles.forEach((p, i) => { p.hidden = antes[i]; });
});

function htmlAutonomo() {
  const estilos = [...document.querySelectorAll("style")].map(s => s.textContent).join("\n");
  return `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(seleccionada.meta.titulo)} — Minuta</title><style>${estilos}
body{background:#F5F5F7} main{margin:0 auto}</style></head>
<body><main><article class="doc">${$("#docOnePager").innerHTML}</article>
<article class="doc" style="break-before:page">${$("#docExtensa").innerHTML}</article></main></body></html>`;
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$("#descargarHtml").addEventListener("click", () => descargar(`${nombreDeArchivo(seleccionada.meta.titulo)}-minuta.html`, htmlAutonomo(), "text/html"));
$("#descargarMd").addEventListener("click", () => descargar(`${nombreDeArchivo(seleccionada.meta.titulo)}-minuta.md`, minutaAMarkdown(seleccionada), "text/markdown"));
$("#copiarMd").addEventListener("click", async () => {
  await copiar(minutaAMarkdown(seleccionada), "Markdown copiado. En Google Docs: Editar → Pegar desde Markdown (actívalo en Herramientas → Preferencias).");
});

$("#enviarCorreo").addEventListener("click", async () => {
  const estado = $("#estadoExportar");
  estado.className = "estado";
  estado.textContent = "Enviando…";
  const r = await enviarMinutaPorCorreo(seleccionada, [{ nombre: `${nombreDeArchivo(seleccionada.meta.titulo)}-minuta.html`, contenido: htmlAutonomo() }]);
  estado.className = r.ok ? "estado ok" : "estado mal";
  estado.textContent = r.ok ? `Enviada a ${r.destinatario}: one pager en el cuerpo; minuta extensa (HTML con diagramas) y Markdown adjuntos.` : `No se pudo enviar: ${r.error}`;
});

async function copiar(texto, aviso) {
  const estado = $("#estadoExportar");
  try {
    await navigator.clipboard.writeText(texto);
    estado.className = "estado ok";
    estado.textContent = aviso;
  } catch {
    estado.className = "estado mal";
    estado.textContent = "El navegador no dejó copiar al portapapeles.";
  }
}

$("#copiarPrompt").addEventListener("click", async () => {
  const r = await fetch("/reunion/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...datosParaMinuta(seleccionada), nivel: $("#nivel").value })
  }).then(x => x.json()).catch(() => null);
  if (!r?.ok) { $("#byokEstado").textContent = "No se pudo preparar el texto."; return; }
  try {
    await navigator.clipboard.writeText(r.prompt);
    $("#byokEstado").textContent = `Copiado (${r.prompt.length.toLocaleString("es")} caracteres). Pégalo en ChatGPT, Claude o Gemini. Si tu plan tiene límite de mensaje, usa un modelo con contexto largo.`;
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
  $("#proveedores").textContent = "Disponibles: " + ["anthropic", "gemini", "openai"]
    .map(p => `${{ anthropic: "Anthropic", gemini: "Gemini", openai: "OpenAI" }[p]} ${disponible(p) ? "✓" : "✗"}`).join(" · ")
    + ". Si el elegido no está disponible, se usa el siguiente de la configuración y se indica en la trazabilidad.";
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
      const partes = marca[1].split(":").map(Number);
      const segundos = partes.reduce((n, p) => n * 60 + p, 0);
      momento = base + segundos * 1000;
      const resto = limpia.slice(marca[0].length).trim();
      if (!resto) continue;
      reunion.navegador.push({ momento, texto: resto });
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
// generó la minuta por voz), esta página se entera sola.
window.addEventListener("storage", evento => {
  if (evento.key !== "catalina.reuniones.v1") return;
  pintarLista();
  if (!seleccionada) return;
  const actual = obtenerReunion(seleccionada.id);
  if (!actual) return;
  // Sólo se repinta lo que cambió: repintar todo cada pocos segundos durante
  // una reunión en curso borraría lo que se esté escribiendo en el formulario.
  const minutaCambio = JSON.stringify(actual.minuta) !== JSON.stringify(seleccionada.minuta);
  seleccionada = actual;
  $("#docTranscripcion").textContent = transcripcionComoTexto(actual) || "(sin transcripción)";
  if (minutaCambio) pintarMinuta();
});

pintarLista();
pintarClavePropia();
pintarProveedores();
const inicial = new URLSearchParams(location.search).get("id") || leerReuniones().at(-1)?.id;
if (inicial) seleccionar(inicial);
