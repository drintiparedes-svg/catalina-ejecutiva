// Acta de reunión en formato «Minuta lean ejecutiva».
//
// Es el formato estándar de actas del Dr. Paredes (plantilla de referencia:
// «Conciliación de medicamentos y planilla de alta del QF», 28-09-2026):
// portada azul marino, secciones 00 a 08 con banda de color, tarjetas blancas
// con borde izquierdo de color, etiquetas en monoespaciada, niveles N1/N2/N3 y
// trazabilidad al final.
//
// Este módulo sólo pinta: recibe la reunión con su acta y devuelve HTML. Lo usan
// la página de actas (vista previa) y la exportación (HTML autónomo, PDF por
// impresión y adjunto de correo), así que lo que se ve es lo que se exporta.
// Todo texto que viene del modelo o de la transcripción se escapa.

export const esc = t => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lista = items => {
  const utiles = (items || []).filter(Boolean);
  return utiles.length ? `<ul>${utiles.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
};
const parrafos = t => String(t ?? "").split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");
const tabla = (cabeceras, filas, clase = "") => filas.length
  ? `<table class="${clase}"><thead><tr>${cabeceras.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c && c.__html ? c.__html : esc(c || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : "";
const html = s => ({ __html: s });
const fechaLarga = ms => new Date(ms).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
const minutos = r => Math.max(1, Math.round(((r.meta.fin || Date.now()) - r.meta.inicio) / 60000));
const enlace = t => /^https?:\/\//i.test(t) ? `<a href="${esc(t)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t);

// Tags de certeza y de nivel, con los colores de la plantilla.
const certeza = valor => {
  const v = String(valor || "").toLowerCase();
  const clase = v.startsWith("alt") ? "ok" : v.startsWith("med") ? "warn" : v.startsWith("baj") ? "bad" : "neutro";
  return `<span class="tag ${clase}">${esc(valor || "Por evaluar")}</span>`;
};
const nivel = n => `<span class="tag nivel-${esc(n)}">${esc(n)}</span>`;

// Colores de sección, en el orden de la plantilla.
const COLOR = {
  navy: "#0e2c6b", royal: "#123a8c", green: "#1e6b2e", ochre: "#8a5e00",
  magenta: "#b0287a", purple: "#6b4fd8", teal: "#0f8a7a", ink: "#14171c", mute: "#575756"
};
const CARRILES = [COLOR.teal, COLOR.royal, COLOR.mute, COLOR.green, COLOR.purple, COLOR.ochre];

const seccion = (numero, titulo, color, cuerpo, clase = "") => cuerpo ? `
  <section class="sec ${clase}">
    <header class="banda" style="background:${color}"><span class="num">${esc(numero)}</span><h2>${esc(titulo)}</h2></header>
    ${cuerpo}
  </section>` : "";

const tarjeta = (etiqueta, contenido, color = COLOR.royal) => contenido ? `
  <div class="card" style="border-left-color:${color}">
    ${etiqueta ? `<p class="kicker">${esc(etiqueta)}</p>` : ""}
    ${contenido}
  </div>` : "";

// ── Portada ──────────────────────────────────────────────────────────────────

function portada(r) {
  const m = r.minuta;
  return `
  <section class="portada">
    <div class="portada-caja">
      <p class="kicker claro">ACTA · MINUTA LEAN · DOCUMENTO DE TRABAJO · NIVEL N2 (PENDIENTE DE VALIDACIÓN)</p>
      <h1>${esc(m.titulo || r.meta.titulo)}</h1>
      ${m.lede ? `<p class="lede">${esc(m.lede)}</p>` : ""}
      <div class="guiones"><span style="background:#4a78d8"></span><span style="background:#2f9a4a"></span><span style="background:#c48a10"></span><span style="background:#d0409a"></span></div>
      <div class="portada-meta">
        <div><p class="kicker claro">REUNIÓN</p><p>${esc(fechaLarga(r.meta.inicio))} · ${minutos(r)} min</p><p>"${esc(r.meta.titulo)}"</p>${r.meta.lugar ? `<p>${esc(r.meta.lugar)}</p>` : ""}</div>
        <div><p class="kicker claro">ÁREA</p><p>${esc(m.area || "—")}</p></div>
        <div><p class="kicker claro">PARTICIPANTES</p><p>${esc(r.meta.participantes || "No declarados")}</p></div>
        <div><p class="kicker claro">HITO SIGUIENTE</p><p>${esc(m.hitoSiguiente || "Por definir")}</p></div>
      </div>
    </div>
  </section>`;
}

// ── 00 Cómo leer ─────────────────────────────────────────────────────────────

function comoLeer(r) {
  const c = r.minuta.comoLeer;
  return seccion("00", "Cómo leer este documento", COLOR.navy, `
    ${tarjeta("PREGUNTA DE TRABAJO", `<p class="serif">${esc(c.preguntaTrabajo)}</p>`, COLOR.navy)}
    ${tarjeta("FUENTES", `${c.fuentesPrimarias ? `<p><strong>Primarias:</strong> ${esc(c.fuentesPrimarias)}</p>` : ""}${c.fuentesSecundarias ? `<p><strong>Secundarias:</strong> ${esc(c.fuentesSecundarias)}</p>` : ""}`, COLOR.navy)}
    ${tabla(["Nivel", "Qué significa en este documento"], [
      [html(nivel("N1")), "Registro de lo dicho, ordenamiento de flujos y diagramas. Ejecutado."],
      [html(nivel("N2")), "Causas raíz, flujo futuro hipotético, indicadores y opciones. Listos para discusión; requieren validación del equipo."],
      [html(nivel("N3")), "Decisiones que exceden al equipo (normas, responsabilidades, sistemas, compras). No se deciden aquí; se escalan."]
    ])}
    ${c.convenciones ? `<div class="side">${esc(c.convenciones)}</div>` : ""}`);
}

// ── 01 A3 ────────────────────────────────────────────────────────────────────

function a3(r) {
  const a = r.minuta.a3;
  const inc = r.minuta.inconsistencias;
  return seccion("01", "Minuta lean (A3)", COLOR.royal, `
    ${tarjeta("1 · ANTECEDENTES", lista(a.antecedentes), COLOR.royal)}
    ${tarjeta("2 · SITUACIÓN ACTUAL", lista(a.situacionActual), COLOR.royal)}
    ${tarjeta("3 · OBJETIVO / CONDICIÓN META", lista(a.condicionMeta), COLOR.green)}
    ${tarjeta("4 · ANÁLISIS DE CAUSAS", lista(a.analisisCausas), COLOR.ochre)}
    ${tarjeta("5 · CONTRAMEDIDAS EN DISCUSIÓN (N2)", lista(a.contramedidas), COLOR.magenta)}
    ${tarjeta("6 · PLAN Y SEGUIMIENTO", tabla(["Acción", "Responsable", "Cuándo"], a.plan.map(p => [p.accion, p.responsable, p.cuando])), COLOR.purple)}
    ${tarjeta("7 · DESPERDICIOS (MUDA) IDENTIFICADOS", tabla(["Tipo de muda", "Dónde aparece", "Punto de dolor"], a.muda.map(m => [m.tipo, m.donde, m.puntoDolor])), COLOR.teal)}
    ${inc.length ? `<div class="side warn"><p><strong>Inconsistencias detectadas entre fuentes (confirmar por escrito)</strong></p><ol>${inc.map(i => `<li><strong>${esc(i.tema)}:</strong> ${esc(i.detalle)}</li>`).join("")}</ol></div>` : ""}`);
}

// ── 02 Flujos por carriles ───────────────────────────────────────────────────
//
// Carriles (actores) por fases (columnas). Sin flechas: la lectura es de
// izquierda a derecha dentro de cada carril, que es lo que importa para ver
// dónde nace cada falla. Se imprime en una página apaisada.

function carriles(flujo, { futuro = false } = {}) {
  if (!flujo.fases.length || !flujo.carriles.length || !flujo.pasos.length) return "";
  const columnas = `grid-template-columns: 150px repeat(${flujo.fases.length}, minmax(0, 1fr))`;
  const cabecera = `<div></div>${flujo.fases.map(f => `<div class="fase ${futuro ? "futuro" : ""}">${esc(f)}</div>`).join("")}`;
  const filas = flujo.carriles.map((carril, i) => {
    const color = CARRILES[i % CARRILES.length];
    const celdas = flujo.fases.map(fase => {
      const pasos = flujo.pasos.filter(p => p.carril === carril && p.fase === fase);
      return `<div class="celda">${pasos.map(p => `
        <div class="paso" style="border-left-color:${color}">
          ${p.marca ? `<span class="${futuro ? "letra" : "dolor"}">${esc(p.marca)}</span>` : ""}
          <strong>${esc(p.titulo)}</strong>${p.detalle ? `<span>${esc(p.detalle)}</span>` : ""}
        </div>`).join("")}</div>`;
    }).join("");
    return `<div class="carril" style="border-left-color:${color}">${esc(carril)}</div>${celdas}`;
  }).join("");
  return `<div class="carriles" style="${columnas}">${cabecera}${filas}</div>`;
}

function flujoActual(r) {
  const f = r.minuta.flujoActual;
  const grafico = carriles(f);
  if (!grafico) return "";
  return seccion("02", "Flujo actual (AS-IS) y puntos de dolor", COLOR.green, `
    <figure class="figura">${grafico}
      <figcaption><strong>Figura 1.</strong> Flujo actual reconstruido desde la transcripción. Los círculos marcan puntos de dolor.</figcaption>
    </figure>
    <div class="dolores">${f.puntosDolor.map(p => `
      <div class="dolor-item"><span class="dolor">${esc(p.numero)}</span><p><strong>${esc(p.titulo)}.</strong> ${p.cita ? `"${esc(p.cita)}"` : ""}</p></div>`).join("")}
    </div>`, "apaisada");
}

// Ishikawa en SVG propio: familias arriba y abajo de la espina, efecto a la
// derecha. Determinista, imprimible y sin depender de ninguna librería.
export function ishikawa(causa) {
  const familias = (causa.familias || []).filter(f => f.nombre).slice(0, 6);
  if (!familias.length) return "";
  const colores = [COLOR.royal, COLOR.purple, COLOR.ochre, COLOR.magenta, COLOR.teal, COLOR.green];
  const arriba = familias.slice(0, Math.ceil(familias.length / 2));
  const abajo = familias.slice(arriba.length);
  const W = 1000, H = 440, Y = 220, finEspina = 770;
  const partir = (t, n = 30, maximo = 2) => {
    const palabras = String(t).split(/\s+/), lineas = [];
    let actual = "";
    for (const p of palabras) {
      if ((actual + " " + p).trim().length > n && actual) { lineas.push(actual); actual = p; }
      else actual = (actual + " " + p).trim();
    }
    if (actual) lineas.push(actual);
    return lineas.slice(0, maximo);
  };
  const hueso = (familia, i, total, lado, color) => {
    const paso = (finEspina - 140) / total;
    const xBase = 140 + paso * (i + 1) - 10;
    const xPunta = xBase - 110;
    const yPunta = lado === "arriba" ? 58 : H - 58;
    const causas = familia.causas.filter(Boolean).slice(0, 4);
    const marcas = causas.map((c, j) => {
      const t = (j + 1) / (causas.length + 1);
      const x = xPunta + (xBase - xPunta) * t, y = yPunta + (Y - yPunta) * t;
      const lineas = partir(c);
      return `<line x1="${x - 8}" y1="${y}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="1.2"/>
        <text x="${x - 12}" y="${y + 3 - (lineas.length - 1) * 6}" font-size="10.5" text-anchor="end" fill="#14171c">${lineas.map((l, k) => `<tspan x="${x - 12}" dy="${k ? 12 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
    }).join("");
    const etiqueta = String(familia.nombre).toUpperCase().slice(0, 32);
    const ancho = Math.max(96, etiqueta.length * 6.6 + 18);
    const yEtiqueta = lado === "arriba" ? yPunta - 30 : yPunta + 8;
    return `<line x1="${xPunta}" y1="${yPunta}" x2="${xBase}" y2="${Y}" stroke="${color}" stroke-width="1.6"/>${marcas}
      <rect x="${xPunta - ancho / 2}" y="${yEtiqueta}" width="${ancho}" height="22" rx="3" fill="${color}"/>
      <text x="${xPunta}" y="${yEtiqueta + 15}" font-size="9.5" text-anchor="middle" fill="#fff" font-family="JetBrains Mono, ui-monospace, monospace" letter-spacing=".06em">${esc(etiqueta)}</text>`;
  };
  const efecto = partir(causa.efecto || "Efecto observado", 24, 5);
  return `<svg class="ishikawa" viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagrama de causa raíz" font-family="Inter, system-ui, sans-serif">
    <line x1="30" y1="${Y}" x2="${finEspina + 12}" y2="${Y}" stroke="#14171c" stroke-width="2"/>
    <polygon points="${finEspina + 12},${Y - 6} ${finEspina + 24},${Y} ${finEspina + 12},${Y + 6}" fill="#14171c"/>
    ${arriba.map((f, i) => hueso(f, i, arriba.length, "arriba", colores[i % colores.length])).join("")}
    ${abajo.map((f, i) => hueso(f, i, abajo.length, "abajo", colores[(i + arriba.length) % colores.length])).join("")}
    <rect x="${finEspina + 30}" y="${Y - 30 - efecto.length * 8}" width="${W - finEspina - 34}" height="${52 + efecto.length * 16}" rx="6" fill="${COLOR.navy}"/>
    <text x="${finEspina + 30 + (W - finEspina - 34) / 2}" y="${Y - 12 - efecto.length * 8}" font-size="9" text-anchor="middle" fill="#b9c6e6" font-family="JetBrains Mono, ui-monospace, monospace" letter-spacing=".1em">EFECTO OBSERVADO</text>
    ${efecto.map((l, k) => `<text x="${finEspina + 30 + (W - finEspina - 34) / 2}" y="${Y + 10 - efecto.length * 8 + k * 16}" font-size="12.5" font-weight="${k < 2 ? 700 : 400}" text-anchor="middle" fill="#fff">${esc(l)}</text>`).join("")}
  </svg>`;
}

function causaRaiz(r) {
  const svg = ishikawa(r.minuta.causaRaiz);
  const extras = diagramasYGraficos(r);
  if (!svg && !extras) return "";
  return seccion("02", svg ? "Causa raíz" : "Diagramas complementarios", COLOR.ochre, `
    ${svg ? `<figure class="figura">${svg}<figcaption><strong>Figura 2.</strong> Diagrama de causa raíz (Ishikawa). Las familias de causas convergen en el efecto observado.</figcaption></figure>` : ""}
    ${extras}`, "apaisada");
}

function flujoFuturo(r) {
  const f = r.minuta.flujoFuturo;
  const grafico = carriles(f, { futuro: true });
  if (!grafico && !f.comparacion.length) return "";
  return seccion("02", "Flujo futuro hipotético (TO-BE) · N2", COLOR.magenta, `
    ${grafico ? `<figure class="figura">${grafico}<figcaption><strong>Figura 3.</strong> Hipótesis de trabajo derivada de la sesión, no validada. Las letras marcan los cambios respecto del flujo actual.</figcaption></figure>` : ""}
    ${f.cambios.length ? `<div class="rejilla-3">${f.cambios.map(c => tarjeta(`${c.marcas} · ${c.titulo}`.toUpperCase(), `<p>${esc(c.texto)}</p>`, COLOR.ochre)).join("")}</div>` : ""}
    ${tabla(["Actividad", "Hoy (AS-IS)", "Hipótesis (TO-BE)"], f.comparacion.map(c => [c.actividad, c.hoy, c.propuesta]))}`, "apaisada");
}

// Diagramas Mermaid y gráficos adicionales. Los Mermaid se dejan como fuente;
// la página los dibuja (dibujarDiagramas) antes de mostrar o exportar.
function diagramasYGraficos(r) {
  const m = r.minuta;
  return [
    ...m.diagramas.map(d => `<figure class="figura"><div class="mermaid-fuente">${esc(d.mermaid)}</div>
      <figcaption><strong>${esc(d.titulo)}</strong>${d.proposito ? ` — ${esc(d.proposito)}` : ""}</figcaption></figure>`),
    ...m.graficos.map(g => `<figure class="figura">${grafico(g)}
      <figcaption><strong>${esc(g.titulo)}</strong>${g.unidad ? ` (${esc(g.unidad)})` : ""}${g.fuente ? ` · Fuente: transcripción ${esc(g.fuente)}` : ""}</figcaption></figure>`)
  ].join("");
}

// ── 03 Actores y señales ─────────────────────────────────────────────────────

function actores(r) {
  const m = r.minuta;
  if (!m.actores.length && !m.senales.length && !m.restricciones.length) return "";
  return seccion("03", "Lectura de actores y señales", COLOR.purple, `
    ${m.actores.length ? `<h3>Mapa de actores</h3>${tabla(["Actor", "Rol en el flujo", "Implicancia"], m.actores.map(a => [html(`<strong>${esc(a.actor)}</strong>`), a.rol, a.implicancia]))}` : ""}
    ${m.senales.length ? `<h3>Señales explícitas</h3>${m.senales.map(s => `<blockquote class="card cita" style="border-left-color:${COLOR.purple}">"${esc(s.cita)}"${s.fuente ? `<cite>${esc(s.fuente)}</cite>` : ""}</blockquote>`).join("")}` : ""}
    ${m.restricciones.length ? `<div class="side"><p><strong>Restricciones para el diseño.</strong></p>${lista(m.restricciones)}</div>` : ""}`);
}

// ── 04 Evidencia ─────────────────────────────────────────────────────────────
//
// El modelo no cita literatura: formula preguntas. Las referencias las trae la
// búsqueda real de la aplicación (nueve bases) y se marcan «por evaluar»
// porque nadie ha hecho aún la lectura crítica.

function evidencia(r, referencias) {
  const m = r.minuta;
  const ev = r.evidencia || [];
  if (!m.preguntasEvidencia.length && !m.referenciasMencionadas.length) return "";
  const filas = m.preguntasEvidencia.map(p => {
    const encontrada = ev.find(e => e.pregunta === p.pregunta);
    let celda;
    if (!encontrada) celda = `<span class="mute">Búsqueda pendiente.</span>`;
    else if (!encontrada.refs?.length) celda = `<span class="mute">${esc(encontrada.error || "Sin resultados en las bases consultadas.")}</span>`;
    else celda = encontrada.refs.map(ref => `${esc(ref.titulo)} <span class="mute">${esc([ref.revista, ref.anio].filter(Boolean).join(", "))}</span> [${referencias.indice(ref)}]`).join("<br>");
    return [html(`<strong>${esc(p.pregunta)}</strong><br><span class="mute mono">${esc(p.busqueda)}</span>`), html(celda), p.aplicabilidad, html(certeza("Por evaluar"))];
  });
  return seccion("04", "Evidencia y literatura", COLOR.teal, `
    ${filas.length ? tabla(["Pregunta", "Referencias encontradas", "Aplicabilidad", "Certeza"], filas) : ""}
    <div class="side ok"><p><strong>Cómo leer esta sección.</strong> Las preguntas las formuló el acta a partir de la reunión; las referencias provienen de una búsqueda automática en bases bibliográficas${ev[0]?.consultadas?.length ? ` (${esc(ev[0].consultadas.join(", "))})` : ""} y aún no tienen lectura crítica: la certeza queda «por evaluar» hasta revisar cada resumen. Ninguna cifra de literatura se usa en el acta sin esa revisión.</p></div>
    ${m.referenciasMencionadas.length ? `<h3>Referencias mencionadas en la reunión <span class="mute">(no verificadas)</span></h3><ul>${m.referenciasMencionadas.map(x => `<li>${x.tipo ? `<span class="tag neutro">${esc(x.tipo)}</span> ` : ""}${esc(x.descripcion)}${x.url ? ` — ${enlace(x.url)}` : ""}${x.marca ? ` <span class="mute mono">[${esc(x.marca)}]</span>` : ""}</li>`).join("")}</ul>` : ""}`);
}

// ── 05 Beneficios y riesgos ──────────────────────────────────────────────────

function beneficiosRiesgos(r) {
  const m = r.minuta;
  if (!m.beneficios.length && !m.riesgos.length) return "";
  return seccion("05", "Beneficios, riesgos e indicadores", COLOR.ink, `
    ${m.beneficios.length ? `<h3>Beneficios esperados (hipótesis, no compromiso)</h3>${tabla(["Dimensión", "Beneficio esperado", "Indicador propuesto"], m.beneficios.map(b => [b.dimension, b.beneficio, b.indicador]))}` : ""}
    ${m.notaMagnitud ? `<div class="side warn">${esc(m.notaMagnitud)}</div>` : ""}
    ${m.riesgos.length ? `<h3>Matriz de riesgos</h3>${tabla(["Riesgo", "Prob.", "Impacto", "Mitigación"], m.riesgos.map(x => [x.riesgo, x.probabilidad, x.impacto, x.mitigacion]))}` : ""}
    ${m.riesgoN3 ? `<div class="side n3">${nivel("N3")} ${esc(m.riesgoN3)}</div>` : ""}`);
}

// ── 06 Soluciones · 07 Próxima reunión ───────────────────────────────────────

function soluciones(r) {
  const s = r.minuta.soluciones;
  if (!s.length) return "";
  return seccion("06", "Espacio de soluciones", COLOR.navy, `
    <p class="serif">Opciones mencionadas en la sesión, ordenadas por nivel de intervención. Ninguna está evaluada todavía.</p>
    ${tabla(["Nivel", "Opción", "Origen", "Dependencias"], s.map(x => [x.nivel, x.opcion, x.origen, x.dependencias]))}`);
}

function proximaReunion(r) {
  const p = r.minuta.proximaReunion;
  if (!p.estructura.length && !p.datosASolicitar.length && !p.preguntas.length) return "";
  const total = p.estructura.reduce((n, e) => n + (Number(e.minutos) || 0), 0);
  return seccion("07", "Preparación de la próxima reunión", COLOR.royal, `
    ${p.estructura.length ? tarjeta(`ESTRUCTURA SUGERIDA${total ? ` (${total} MIN)` : ""}`, `<ol>${p.estructura.map(e => `<li>${esc(e.punto)}${e.minutos ? ` (${esc(e.minutos)} min)` : ""}</li>`).join("")}</ol>`, COLOR.royal) : ""}
    ${tarjeta("DATOS A SOLICITAR", lista(p.datosASolicitar), COLOR.green)}
    ${tarjeta("PREGUNTAS QUE CONVIENE HACER", lista(p.preguntas), COLOR.ochre)}
    ${tarjeta("ERRORES A EVITAR", lista(p.erroresAEvitar), COLOR.magenta)}`);
}

// ── 08 Trazabilidad ──────────────────────────────────────────────────────────

function trazabilidad(r, referencias, calidad) {
  const t = r.minuta.trazabilidad;
  const tz = r.trazabilidad || {};
  const enlacesOrganizador = String(r.meta.enlaces || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const proceso = [
    `Transcripción ${calidad.fuente}: cobertura estimada ${calidad.cobertura}%, ${calidad.palabras.toLocaleString("es")} palabras${calidad.huecos ? `, ${calidad.huecos} tramo(s) sin audio` : ""}.`,
    tz.modelo ? `Acta redactada con ${tz.proveedor}/${tz.modelo} (nivel ${tz.nivel}) el ${new Date(tz.generadaEn).toLocaleString("es-CL")}, a partir de la transcripción y de los datos declarados de la reunión.` : "",
    (r.evidencia || []).length ? `Búsqueda bibliográfica automática por pregunta el ${new Date(r.evidenciaFecha || Date.now()).toLocaleDateString("es-CL")}; referencias sin lectura crítica.` : "",
    "Revisión humana pendiente antes de difundir."
  ].filter(Boolean);
  return seccion("08", "Trazabilidad", COLOR.mute, `
    ${tarjeta("PROCESO", `<ol>${proceso.map(p => `<li>${esc(p)}</li>`).join("")}</ol>`, COLOR.mute)}
    ${tarjeta("SUPUESTOS", lista(t.supuestos), COLOR.mute)}
    ${t.limites ? `<div class="side warn"><strong>Límites.</strong> ${esc(t.limites)}</div>` : ""}
    ${(referencias.lista.length || enlacesOrganizador.length || r.materiales?.length) ? `<h3>Referencias</h3>` : ""}
    ${referencias.lista.length ? `<ol class="refs">${referencias.lista.map(ref => `<li>${esc(ref.autores ? ref.autores.replace(/\.+$/, "") + ". " : "")}${esc(ref.titulo)}. ${ref.revista ? `<em>${esc(ref.revista)}</em>. ` : ""}${esc(ref.anio || "")}. ${ref.enlace ? enlace(ref.enlace) : ""}</li>`).join("")}</ol>` : ""}
    ${enlacesOrganizador.length ? `<p><strong>Aportadas por el organizador</strong></p><ul>${enlacesOrganizador.map(e => `<li>${enlace(e)}</li>`).join("")}</ul>` : ""}
    ${r.materiales?.length ? `<p><strong>Material mostrado por Catalina durante la reunión</strong></p>${lista([...new Set(r.materiales)])}` : ""}
    ${t.notaDeUso ? `<p class="mute">Nota de uso: ${esc(t.notaDeUso)}</p>` : ""}
    <p class="pie mono">ACTA · MINUTA LEAN · ${esc(fechaLarga(r.meta.inicio).toUpperCase())} · DOCUMENTO N2, PENDIENTE DE VALIDACIÓN</p>`);
}

// Numeración única de referencias, compartida entre la sección 04 y la 08.
function numerador(r) {
  const lista = [];
  for (const e of r.evidencia || []) for (const ref of e.refs || []) {
    if (!lista.some(x => x.enlace === ref.enlace && x.titulo === ref.titulo)) lista.push(ref);
  }
  return { lista, indice: ref => lista.findIndex(x => x.enlace === ref.enlace && x.titulo === ref.titulo) + 1 };
}

// ── Documento completo ───────────────────────────────────────────────────────

export function actaHTML(r, calidad) {
  if (r.minuta?.formato !== "lean-1") {
    return `<section class="sec"><div class="side warn">Esta acta se generó con el formato anterior. Vuelve a generarla para obtener el formato de minuta lean (portada, A3, flujos, causa raíz, evidencia y trazabilidad).</div></section>`;
  }
  const referencias = numerador(r);
  return [
    portada(r), comoLeer(r), a3(r), flujoActual(r), causaRaiz(r), flujoFuturo(r),
    actores(r), evidencia(r, referencias), beneficiosRiesgos(r), soluciones(r), proximaReunion(r),
    trazabilidad(r, referencias, calidad)
  ].join("");
}

// One pager: la versión resumida de la plantilla, en una hoja.
export function onePagerHTML(r) {
  const op = r.minuta.onePager;
  const tiles = op.indicadores.length ? op.indicadores.slice(0, 4) : [
    { valor: `${minutos(r)} min`, etiqueta: "Duración" },
    { valor: String(op.decisiones.length), etiqueta: "Decisiones" },
    { valor: String(op.acciones.length), etiqueta: "Acciones" },
    { valor: String(op.riesgos.length), etiqueta: "Riesgos" }
  ];
  return `
  <section class="sec onepager">
    <div class="portada-caja compacta">
      <p class="kicker claro">ONE PAGER · ${esc(fechaLarga(r.meta.inicio).toUpperCase())} · NIVEL N2</p>
      <h1>${esc(r.minuta.titulo || r.meta.titulo)}</h1>
      ${op.estado ? `<span class="tag claro">${esc(op.estado)}</span>` : ""}
    </div>
    <div class="tiles">${tiles.map(t => `<div class="tile"><b>${esc(t.valor)}</b><span>${esc(t.etiqueta)}</span></div>`).join("")}</div>
    <p class="clave">${esc(op.mensajeClave)}</p>
    ${parrafos(op.contexto)}
    <div class="rejilla-2">
      ${tarjeta("DECISIONES", lista(op.decisiones), COLOR.green)}
      ${tarjeta("RIESGOS", lista(op.riesgos), COLOR.magenta)}
    </div>
    ${op.acciones.length ? tarjeta("ACCIONES", tabla(["Acción", "Responsable", "Plazo"], op.acciones.map(a => [a.accion, a.responsable, a.plazo])), COLOR.purple) : ""}
    ${tarjeta("PRÓXIMOS PASOS", lista(op.proximosPasos), COLOR.royal)}
    <p class="pie mono">SÍNTESIS DEL ACTA · EL DETALLE, LA EVIDENCIA Y LOS LÍMITES ESTÁN EN EL ACTA COMPLETA</p>
  </section>`;
}

// ── Gráficos ─────────────────────────────────────────────────────────────────

const PALETA = [COLOR.royal, COLOR.teal, COLOR.ochre, COLOR.magenta, COLOR.purple, COLOR.green, COLOR.navy, COLOR.mute];

export function grafico(g) {
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
    const leyenda = series.map((s, i) => `<g transform="translate(240 ${24 + i * 22})"><rect width="12" height="12" rx="2" fill="${PALETA[i % PALETA.length]}"/><text x="18" y="10.5" font-size="12" fill="#14171c">${esc(s.etiqueta)} — ${fmt(s.valor)} (${Math.round(s.valor / total * 100)}%)</text></g>`).join("");
    return `<svg viewBox="0 0 560 ${Math.max(230, 30 + series.length * 22)}" role="img" aria-label="${esc(g.titulo)}">${arcos}${leyenda}</svg>`;
  }
  const ancho = 640, alto = 280, izq = 56, abajo = 64, arriba = 16, der = 16;
  const w = ancho - izq - der, h = alto - arriba - abajo;
  const paso = w / series.length;
  const y = v => arriba + h - (v / max) * h;
  const guias = [0, .25, .5, .75, 1].map(f => `<line x1="${izq}" x2="${ancho - der}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#e2e5ea"/><text x="${izq - 6}" y="${y(max * f) + 4}" font-size="10" text-anchor="end" fill="#575756">${fmt(max * f)}</text>`).join("");
  const etiquetas = series.map((s, i) => `<text x="${izq + paso * i + paso / 2}" y="${alto - abajo + 16}" font-size="11" text-anchor="middle" fill="#14171c">${esc(s.etiqueta.slice(0, 18))}</text>`).join("");
  let marcas;
  if (g.tipo === "lineas") {
    const puntos = series.map((s, i) => `${(izq + paso * i + paso / 2).toFixed(1)},${y(s.valor).toFixed(1)}`);
    marcas = `<polyline points="${puntos.join(" ")}" fill="none" stroke="${PALETA[0]}" stroke-width="2.5"/>`
      + series.map((s, i) => `<circle cx="${izq + paso * i + paso / 2}" cy="${y(s.valor)}" r="4" fill="${PALETA[0]}"/><text x="${izq + paso * i + paso / 2}" y="${y(s.valor) - 8}" font-size="11" text-anchor="middle" fill="#14171c">${fmt(s.valor)}</text>`).join("");
  } else {
    const barra = Math.min(56, paso * .62);
    marcas = series.map((s, i) => `<rect x="${izq + paso * i + (paso - barra) / 2}" y="${y(Math.max(0, s.valor))}" width="${barra}" height="${Math.max(0, h - (y(Math.max(0, s.valor)) - arriba))}" rx="2" fill="${PALETA[0]}"/><text x="${izq + paso * i + paso / 2}" y="${y(Math.max(0, s.valor)) - 6}" font-size="11" text-anchor="middle" fill="#14171c">${fmt(s.valor)}</text>`).join("");
  }
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="${esc(g.titulo)}">${guias}${marcas}${etiquetas}</svg>`;
}

// ── Mermaid ──────────────────────────────────────────────────────────────────

let mermaid = null;
export async function dibujarDiagramas(contenedor) {
  const fuentes = [...contenedor.querySelectorAll(".mermaid-fuente")];
  if (!fuentes.length) return;
  try {
    mermaid ??= (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
    mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: "Inter, system-ui, sans-serif",
      themeVariables: { primaryColor: "#ffffff", primaryBorderColor: COLOR.royal, primaryTextColor: COLOR.ink, lineColor: COLOR.mute, fontSize: "13px" }
    });
  } catch {
    fuentes.forEach(f => { f.outerHTML = `<pre>${esc(f.textContent)}</pre><p class="mute">No se pudo cargar el dibujante de diagramas (sin conexión). El código Mermaid se puede pegar en mermaid.live.</p>`; });
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
      fuente.outerHTML = `<pre>${esc(codigo)}</pre><p class="mute">El diagrama propuesto tiene un error de sintaxis; se muestra su código.</p>`;
    }
  }
}

// ── Estilos del documento ────────────────────────────────────────────────────
//
// Tokens de la plantilla. Se aplican bajo .acta para que convivan con el tema
// oscuro de la aplicación en la vista previa, y son los mismos del HTML
// exportado y del PDF.

export const FUENTES = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;500&display=swap";

export const ESTILOS_ACTA = `
.acta { --paper:#fbfaf8; --ink:#14171c; --mute:#575756; --line:#e2e5ea; --navy:#0e2c6b; --royal:#123a8c;
  --green:#1e6b2e; --ochre:#8a5e00; --magenta:#b0287a; --purple:#6b4fd8; --teal:#0f8a7a;
  color: var(--ink); font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13.5px; line-height: 1.55; }
.acta .hoja { background: var(--paper); border-radius: 8px; padding: 26px; }
.acta .sec { margin: 0 0 28px; }
.acta .banda { display: flex; align-items: center; gap: 14px; padding: 13px 18px; border-radius: 8px 8px 0 0; color: #fff; margin-bottom: 14px; }
.acta .banda h2 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -.02em; }
.acta .banda .num { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; opacity: .75; }
.acta h1 { font-weight: 800; letter-spacing: -.03em; line-height: 1.05; margin: 0; }
.acta h3 { font-size: 16px; font-weight: 800; letter-spacing: -.01em; margin: 18px 0 8px; }
.acta p { margin: 0 0 8px; }
.acta ul, .acta ol { margin: 0 0 6px; padding-left: 20px; } .acta li { margin-bottom: 4px; }
.acta .kicker, .acta th, .acta .fase, .acta .mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
.acta .kicker { margin: 0 0 8px; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--mute); font-weight: 500; }
.acta .kicker.claro { color: #b9c6e6; }
.acta .serif, .acta .lede, .acta .cita { font-family: Georgia, "Times New Roman", serif; }
.acta .mute { color: var(--mute); } .acta .mono.mute { font-size: 11px; }
.acta .card { background: #fff; border: 1px solid var(--line); border-left: 4px solid var(--royal); border-radius: 8px; padding: 14px 18px; margin: 0 0 12px; }
.acta .card:empty { display: none; }
.acta .side { background: #e9edf7; border-left: 4px solid var(--royal); border-radius: 8px; padding: 12px 16px; margin: 0 0 12px; }
.acta .side.warn { background: #f5ecdc; border-left-color: var(--ochre); }
.acta .side.ok { background: #e3efe6; border-left-color: var(--green); }
.acta .side.n3 { background: #f6e3ee; border-left-color: var(--magenta); }
.acta table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); margin: 0 0 12px; font-size: 12.5px; }
.acta th { text-align: left; background: #eef0f4; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); font-weight: 500; }
.acta th, .acta td { padding: 9px 11px; border-bottom: 1px solid var(--line); vertical-align: top; }
.acta .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; }
.acta .tag.ok { background: #e3efe6; color: var(--green); } .acta .tag.warn { background: #f5ecdc; color: var(--ochre); }
.acta .tag.bad { background: #f6e3ee; color: var(--magenta); } .acta .tag.neutro { background: #eef0f4; color: var(--mute); }
.acta .tag.nivel-N1 { background: #e6ebf6; color: var(--royal); } .acta .tag.nivel-N2 { background: #f5ecdc; color: var(--ochre); }
.acta .tag.nivel-N3 { background: #f6e3ee; color: var(--magenta); } .acta .tag.claro { background: rgba(255,255,255,.14); color: #fff; }
.acta .portada-caja { background: var(--navy); color: #fff; border-radius: 8px; padding: 44px 44px 36px; }
.acta .portada .portada-caja { min-height: 640px; display: flex; flex-direction: column; justify-content: flex-end; }
.acta .portada h1 { font-size: 46px; margin: 10px 0 16px; }
.acta .portada-caja.compacta { padding: 24px 28px; margin-bottom: 14px; }
.acta .portada-caja.compacta h1 { font-size: 28px; margin: 4px 0 10px; }
.acta .lede { font-size: 19px; line-height: 1.5; color: #e7ecf7; max-width: 720px; }
.acta .guiones { display: flex; gap: 10px; margin: 22px 0 18px; } .acta .guiones span { width: 48px; height: 4px; border-radius: 2px; }
.acta .portada-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; border-top: 1px solid rgba(255,255,255,.2); padding-top: 18px; font-size: 13px; }
.acta .portada-meta p { margin: 0 0 3px; color: #e7ecf7; }
.acta .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 14px; }
.acta .tile { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.acta .tile b { display: block; font-size: 22px; font-weight: 800; color: var(--navy); letter-spacing: -.02em; }
.acta .tile span { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--mute); }
.acta .clave { font-size: 18px; font-weight: 800; color: var(--navy); letter-spacing: -.01em; border-left: 4px solid var(--royal); padding-left: 14px; margin: 6px 0 12px; line-height: 1.35; }
.acta .rejilla-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.acta .rejilla-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.acta .figura { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin: 0 0 14px; overflow-x: auto; }
.acta .figura figcaption { font-size: 12px; color: var(--mute); margin-top: 8px; }
.acta .figura svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
.acta .carriles { display: grid; gap: 6px; min-width: 760px; }
.acta .fase { background: var(--navy); color: #fff; text-align: center; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; padding: 6px 4px; border-radius: 3px; }
.acta .fase.futuro { background: var(--green); }
.acta .carril { border-left: 4px solid var(--royal); padding: 8px 10px; font-weight: 600; font-size: 12px; background: #f4f5f8; display: flex; align-items: center; }
.acta .celda { display: flex; flex-direction: column; gap: 6px; background: #f9fafb; border-radius: 3px; padding: 4px; min-height: 40px; }
.acta .paso { position: relative; background: #fff; border: 1px solid var(--line); border-left: 3px solid var(--royal); border-radius: 4px; padding: 7px 9px 7px 10px; font-size: 11.5px; line-height: 1.35; }
.acta .paso strong { display: block; font-size: 11.5px; } .acta .paso span:not(.dolor):not(.letra) { color: var(--mute); }
.acta .dolor, .acta .letra { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; font-size: 11px; font-weight: 700; color: #fff; flex: none; }
.acta .dolor { background: var(--magenta); border-radius: 999px; } .acta .letra { background: var(--ochre); border-radius: 3px; }
.acta .paso .dolor, .acta .paso .letra { position: absolute; top: -8px; right: -6px; }
.acta .dolores { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.acta .dolor-item { display: flex; gap: 10px; align-items: flex-start; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; }
.acta .dolor-item p { margin: 0; }
.acta blockquote.cita { font-size: 16px; font-style: italic; margin: 0 0 10px; }
.acta blockquote cite { display: block; font-style: normal; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; color: var(--mute); margin-top: 6px; }
.acta .refs li { font-size: 12px; } .acta a { color: var(--royal); }
.acta .pie { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 10.5px; letter-spacing: .08em; color: var(--mute); }
.acta pre { white-space: pre-wrap; font-size: 11.5px; background: #eef0f4; padding: 10px; border-radius: 6px; }
@media (max-width: 760px) {
  .acta .portada h1 { font-size: 32px; } .acta .portada .portada-caja { min-height: 0; padding: 28px 22px; }
  .acta .portada-meta, .acta .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .acta .rejilla-2, .acta .rejilla-3, .acta .dolores { grid-template-columns: 1fr; }
  .acta .hoja { padding: 14px; }
}
@page { size: A4; margin: 12mm; }
@page apaisada { size: A4 landscape; margin: 10mm; }
@media print {
  .acta { font-size: 10.5pt; } .acta table { font-size: 9.5pt; }
  .acta .hoja { padding: 0; border-radius: 0; background: #fff; }
  .acta .sec { break-before: page; margin: 0; } .acta .portada { break-before: auto; }
  .acta .sec.apaisada { page: apaisada; }
  .acta .portada .portada-caja { min-height: 265mm; }
  .acta .card, .acta .side, .acta tr, .acta .figura, .acta .dolor-item, .acta blockquote { break-inside: avoid; }
  .acta .banda { break-after: avoid; }
  .acta .carriles { min-width: 0; gap: 4px; }
  .acta .paso { padding: 5px 7px; font-size: 8.5pt; } .acta .paso strong { font-size: 8.5pt; }
  .acta .carril { font-size: 9pt; padding: 6px 8px; }
  .acta .dolores { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .acta .dolor-item { font-size: 8.5pt; padding: 6px 8px; }
  .acta .rejilla-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .acta * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

// HTML autónomo: el acta tal cual se ve, con sus estilos. Es lo que se
// descarga y lo que va adjunto al correo; se abre en cualquier navegador y se
// imprime a PDF con el mismo aspecto.
export function documentoAutonomo(titulo, cuerpoHtml) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FUENTES}" rel="stylesheet">
<style>body{margin:0;background:#fbfaf8} .acta{max-width:1060px;margin:0 auto;padding:24px 16px} @media print{.acta{padding:0;max-width:none}}${ESTILOS_ACTA}</style></head>
<body><main class="acta"><div class="hoja">${cuerpoHtml}</div></main></body></html>`;
}
