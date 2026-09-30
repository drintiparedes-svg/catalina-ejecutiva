// Acta de reunión: maquetación de las cuatro plantillas.
//
// El formato base es la «Minuta lean ejecutiva» del Dr. Paredes (plantilla de
// referencia: «Conciliación de medicamentos y planilla de alta del QF»,
// 28-09-2026): portada azul marino, secciones numeradas con banda de color,
// tarjetas blancas con borde izquierdo de color, etiquetas en monoespaciada,
// niveles N1/N2/N3 y trazabilidad al final.
//
// Cada plantilla (plantillas-acta.js) declara qué secciones lleva y en qué
// orden. Cada sección se arma como una lista de bloques —texto, lista, tabla,
// tarjeta, cita, carriles, Ishikawa…— y de los mismos bloques salen el HTML
// (vista previa, PDF por impresión y adjunto de correo) y el Markdown. Así los
// cuatro formatos se ven y se exportan con la misma calidad.
//
// Todo texto que viene del modelo o de la transcripción se escapa.

import { plantillaDe } from "./plantillas-acta.js";

export const esc = t => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const A = v => Array.isArray(v) ? v : [];
const fechaLarga = ms => new Date(ms).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
const minutos = r => Math.max(1, Math.round(((r.meta.fin || Date.now()) - r.meta.inicio) / 60000));
const enlace = t => /^https?:\/\//i.test(t) ? `<a href="${esc(t)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t);

const COLOR = {
  navy: "#0e2c6b", royal: "#123a8c", green: "#1e6b2e", ochre: "#8a5e00",
  magenta: "#b0287a", purple: "#6b4fd8", teal: "#0f8a7a", ink: "#14171c", mute: "#575756"
};
// Rotación de bandas de la plantilla: navy → royal → green → ochre → magenta →
// purple → teal → ink. La trazabilidad va siempre en gris.
const ROTACION = [COLOR.navy, COLOR.royal, COLOR.green, COLOR.ochre, COLOR.magenta, COLOR.purple, COLOR.teal, COLOR.ink];
const CARRILES = [COLOR.teal, COLOR.royal, COLOR.mute, COLOR.green, COLOR.purple, COLOR.ochre];

// ── Bloques ──────────────────────────────────────────────────────────────────
//
// Celdas de tabla: texto plano, o un objeto:
//   {b}         negrita          {tag, texto}  etiqueta de color
//   {nivel}     N1/N2/N3         {estado}      semáforo Verde/Amarillo/Rojo
//   {partes}    varias piezas: texto, {b}, {mute}, {mono}, {ref}

const bl = {
  texto: (texto, serif = false) => texto ? { t: "texto", texto, serif } : null,
  lista: (items, ordenada = false) => A(items).filter(Boolean).length ? { t: "lista", items: A(items).filter(Boolean), ordenada } : null,
  tabla: (cab, filas) => filas.length ? { t: "tabla", cab, filas } : null,
  card: (etiqueta, color, ...hijos) => hijos.filter(Boolean).length ? { t: "card", etiqueta, color, hijos: hijos.filter(Boolean) } : null,
  side: (variante, titulo, ...hijos) => (titulo || hijos.filter(Boolean).length) ? { t: "side", variante, titulo, hijos: hijos.filter(Boolean) } : null,
  h3: texto => ({ t: "h3", texto }),
  citas: (items, color = COLOR.purple) => A(items).length ? { t: "citas", items: A(items), color } : null,
  rejilla: (...hijos) => hijos.filter(Boolean).length ? { t: "rejilla", hijos: hijos.filter(Boolean) } : null
};

// Etiquetas: certeza, nivel y semáforo con los tintes de la plantilla.
function claseDe(valor) {
  const v = String(valor || "").toLowerCase();
  if (/^(alt|verde|cumpl|ok)/.test(v)) return "ok";
  if (/^(med|amar|en curso|parcial)/.test(v)) return "warn";
  if (/^(baj|roj|atras|no cumpl|bloq)/.test(v)) return "bad";
  return "neutro";
}

function celdaHTML(c) {
  if (c == null || c === "") return "—";
  if (typeof c !== "object") return esc(c);
  if (c.b != null) return `<strong>${esc(c.b)}</strong>`;
  if (c.nivel) return `<span class="tag nivel-${esc(c.nivel)}">${esc(c.nivel)}</span>`;
  if (c.estado != null) return `<span class="tag ${claseDe(c.estado)}">${esc(c.texto || c.estado || "Sin estado")}</span>`;
  if (c.tag) return `<span class="tag ${esc(c.tag)}">${esc(c.texto)}</span>`;
  if (c.partes) return c.partes.map(p => typeof p === "string" ? esc(p)
    : p.b != null ? `<strong>${esc(p.b)}</strong>` : p.mute != null ? `<span class="mute">${esc(p.mute)}</span>`
    : p.mono != null ? `<span class="mute mono">${esc(p.mono)}</span>` : p.ref ? ` [${p.ref}]` : p.br ? "<br>" : "").join("");
  return esc(c.texto ?? "");
}

function celdaMD(c) {
  let s;
  if (c == null || c === "") s = "—";
  else if (typeof c !== "object") s = String(c);
  else if (c.b != null) s = `**${c.b}**`;
  else if (c.nivel) s = c.nivel;
  else if (c.estado != null) s = c.texto || c.estado || "Sin estado";
  else if (c.tag) s = c.texto;
  else if (c.partes) s = c.partes.map(p => typeof p === "string" ? p : p.b != null ? `**${p.b}**` : p.mute ?? (p.mono != null ? `\`${p.mono}\`` : p.ref ? ` [${p.ref}]` : p.br ? "; " : "")).join("");
  else s = c.texto ?? "";
  return String(s).replace(/\|/g, "/").replace(/\n/g, " ");
}

function bloqueHTML(b) {
  if (!b) return "";
  switch (b.t) {
    case "texto": return String(b.texto).split(/\n+/).filter(l => l.trim()).map(l => `<p${b.serif ? ' class="serif"' : ""}>${esc(l.trim())}</p>`).join("");
    case "lista": return `<${b.ordenada ? "ol" : "ul"}>${b.items.map(i => `<li>${typeof i === "object" ? celdaHTML(i) : esc(i)}</li>`).join("")}</${b.ordenada ? "ol" : "ul"}>`;
    case "tabla": return `<table><thead><tr>${b.cab.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.filas.map(f => `<tr>${f.map(c => `<td>${celdaHTML(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    case "card": return `<div class="card" style="border-left-color:${b.color || COLOR.royal}">${b.etiqueta ? `<p class="kicker">${esc(b.etiqueta)}</p>` : ""}${b.hijos.map(bloqueHTML).join("")}</div>`;
    case "side": return `<div class="side ${b.variante || ""}">${b.variante === "n3" ? '<span class="tag nivel-N3">N3</span> ' : ""}${b.titulo ? `<p><strong>${esc(b.titulo)}</strong></p>` : ""}${b.hijos.map(bloqueHTML).join("")}</div>`;
    case "h3": return `<h3>${esc(b.texto)}</h3>`;
    case "citas": return b.items.map(s => `<blockquote class="card cita" style="border-left-color:${b.color}">"${esc(s.cita)}"${s.fuente ? `<cite>${esc(s.fuente)}</cite>` : ""}</blockquote>`).join("");
    case "rejilla": return `<div class="rejilla-${Math.min(3, b.hijos.length)}">${b.hijos.map(bloqueHTML).join("")}</div>`;
    case "carriles": {
      const grafico = carriles(b.flujo, { futuro: b.futuro });
      return grafico ? `<figure class="figura">${grafico}<figcaption><strong>${esc(b.figura)}</strong> ${esc(b.pie)}</figcaption></figure>` : "";
    }
    case "dolores": return `<div class="dolores">${b.items.map(p => `<div class="dolor-item"><span class="dolor">${esc(p.numero)}</span><p><strong>${esc(p.titulo)}.</strong> ${p.cita ? `"${esc(p.cita)}"` : ""}</p></div>`).join("")}</div>`;
    case "ishikawa": return `<figure class="figura">${ishikawa(b.causa)}<figcaption><strong>${esc(b.figura)}</strong> Diagrama de causa raíz (Ishikawa). Las familias de causas convergen en el efecto observado.</figcaption></figure>`;
    case "mermaid": return `<figure class="figura"><div class="mermaid-fuente">${esc(b.codigo)}</div><figcaption><strong>${esc(b.titulo)}</strong>${b.proposito ? ` — ${esc(b.proposito)}` : ""}</figcaption></figure>`;
    case "grafico": return `<figure class="figura">${grafico(b.g)}<figcaption><strong>${esc(b.g.titulo)}</strong>${b.g.unidad ? ` (${esc(b.g.unidad)})` : ""}${b.g.fuente ? ` · Fuente: transcripción ${esc(b.g.fuente)}` : ""}</figcaption></figure>`;
    case "refs": return `<ol class="refs">${b.lista.map(ref => `<li>${esc(ref.autores ? ref.autores.replace(/\.+$/, "") + ". " : "")}${esc(ref.titulo)}. ${ref.revista ? `<em>${esc(ref.revista)}</em>. ` : ""}${esc(ref.anio || "")}. ${ref.enlace ? enlace(ref.enlace) : ""}</li>`).join("")}</ol>`;
    case "enlaces": return `<ul>${b.items.map(e => `<li>${enlace(e)}</li>`).join("")}</ul>`;
    case "pie": return `<p class="pie mono">${esc(b.texto)}</p>`;
    default: return "";
  }
}

// Flujo por carriles como Mermaid, para que el Markdown lleve el diagrama.
function flujoMermaid(flujo, prefijo) {
  const pasos = A(flujo.pasos).map((p, i) => ({ ...p, i }));
  if (!pasos.length) return "";
  const lineas = ["flowchart LR"];
  A(flujo.carriles).forEach((carril, k) => {
    const propios = pasos.filter(p => p.carril === carril).sort((a, b) => flujo.fases.indexOf(a.fase) - flujo.fases.indexOf(b.fase));
    if (!propios.length) return;
    lineas.push(`  subgraph ${prefijo}c${k}["${carril.replace(/"/g, "'")}"]`);
    for (const p of propios) lineas.push(`    ${prefijo}${p.i}["${(p.marca ? `(${p.marca}) ` : "") + p.titulo.replace(/"/g, "'")}"]`);
    lineas.push("  end");
    for (let j = 1; j < propios.length; j += 1) lineas.push(`  ${prefijo}${propios[j - 1].i} --> ${prefijo}${propios[j].i}`);
  });
  return "```mermaid\n" + lineas.join("\n") + "\n```";
}

function bloqueMD(b) {
  if (!b) return "";
  switch (b.t) {
    case "texto": return String(b.texto).trim();
    case "lista": return b.items.map((i, k) => `${b.ordenada ? `${k + 1}.` : "-"} ${typeof i === "object" ? celdaMD(i) : i}`).join("\n");
    case "tabla": return `| ${b.cab.join(" | ")} |\n| ${b.cab.map(() => "---").join(" | ")} |\n` + b.filas.map(f => `| ${f.map(celdaMD).join(" | ")} |`).join("\n");
    case "card": return [b.etiqueta ? `**${b.etiqueta.charAt(0) + b.etiqueta.slice(1).toLowerCase()}**` : "", ...b.hijos.map(bloqueMD)].filter(Boolean).join("\n\n");
    case "side": return [`> ${b.variante === "n3" ? "**N3** " : ""}${b.titulo ? `**${b.titulo}** ` : ""}`.trimEnd(), ...b.hijos.map(h => bloqueMD(h).split("\n").map(l => `> ${l}`).join("\n"))].filter(l => l.trim() !== ">").join("\n");
    case "h3": return `### ${b.texto}`;
    case "citas": return b.items.map(s => `> "${s.cita}"${s.fuente ? ` — ${s.fuente}` : ""}`).join("\n>\n");
    case "rejilla": return b.hijos.map(bloqueMD).join("\n\n");
    case "carriles": return [flujoMermaid(b.flujo, b.futuro ? "b" : "a"), `*${b.figura} ${b.pie}*`].join("\n\n");
    case "dolores": return b.items.map(p => `${p.numero}. **${p.titulo}.** ${p.cita ? `"${p.cita}"` : ""}`).join("\n");
    case "ishikawa": return `**Efecto observado:** ${b.causa.efecto}\n\n` + bloqueMD(bl.tabla(["Familia de causas", "Causas"], A(b.causa.familias).map(f => [f.nombre, A(f.causas).join("; ")])));
    case "mermaid": return `**${b.titulo}**${b.proposito ? ` — ${b.proposito}` : ""}\n\n\`\`\`mermaid\n${b.codigo}\n\`\`\``;
    case "grafico": return `**${b.g.titulo}** (${b.g.unidad}; fuente ${b.g.fuente})\n\n` + bloqueMD(bl.tabla(["Serie", "Valor"], b.g.series.map(s => [s.etiqueta, s.valor])));
    case "refs": return b.lista.map((r, i) => `${i + 1}. ${r.autores ? r.autores.replace(/\.+$/, "") + ". " : ""}${r.titulo}. ${r.revista ? `*${r.revista}*. ` : ""}${r.anio || ""}. ${r.enlace || ""}`).join("\n");
    case "enlaces": return b.items.map(e => `- ${e}`).join("\n");
    case "pie": return `_${b.texto}_`;
    default: return "";
  }
}

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

// ── Secciones ────────────────────────────────────────────────────────────────
//
// Cada una recibe el contexto y devuelve {titulo, bloques} o null si no hay
// nada que mostrar: una sección vacía no se imprime. Las que comparten
// «grupo» comparten número, como los tres diagramas de la sección 02 de la
// plantilla de referencia.

const tablaAcciones = (filas, cab = ["Acción", "Responsable", "Plazo"]) => bl.tabla(cab, filas);
const inconsistencias = m => A(m.inconsistencias).length
  ? bl.side("warn", "Inconsistencias detectadas (confirmar por escrito)", bl.lista(A(m.inconsistencias).map(i => ({ partes: [{ b: `${i.tema}: ` }, i.detalle] })), true))
  : null;

const SECCIONES = {
  comoLeer: ({ m, tipo }) => {
    const c = m.comoLeer || {};
    return {
      titulo: "Cómo leer este documento",
      bloques: [
        tipo === "academica" && m.preguntaCentral ? bl.card("PREGUNTA CENTRAL", COLOR.navy, bl.texto(m.preguntaCentral, true)) : null,
        bl.card("PREGUNTA DE TRABAJO", COLOR.navy, bl.texto(c.preguntaTrabajo, true)),
        bl.card("FUENTES", COLOR.navy, bl.lista([
          c.fuentesPrimarias && { partes: [{ b: "Primarias: " }, c.fuentesPrimarias] },
          c.fuentesSecundarias && { partes: [{ b: "Secundarias: " }, c.fuentesSecundarias] }
        ])),
        bl.tabla(["Nivel", "Qué significa en este documento"], [
          [{ nivel: "N1" }, "Registro de lo dicho, ordenamiento de flujos y diagramas. Ejecutado."],
          [{ nivel: "N2" }, "Análisis, hipótesis, indicadores y opciones. Listos para discusión; requieren validación del equipo."],
          [{ nivel: "N3" }, "Decisiones que exceden al equipo (normas, responsabilidades, sistemas, compras). No se deciden aquí; se escalan."]
        ]),
        c.convenciones ? bl.side("", "", bl.texto(c.convenciones)) : null,
        tipo !== "creativa" ? inconsistencias(m) : null
      ]
    };
  },

  // Creativa ─────────────────────────────────────────────────────────────────
  a3: ({ m }) => {
    const a = m.a3;
    if (!a) return null;
    return {
      titulo: "Minuta lean (A3)",
      bloques: [
        bl.card("1 · ANTECEDENTES", COLOR.royal, bl.lista(a.antecedentes)),
        bl.card("2 · SITUACIÓN ACTUAL", COLOR.royal, bl.lista(a.situacionActual)),
        bl.card("3 · OBJETIVO / CONDICIÓN META", COLOR.green, bl.lista(a.condicionMeta)),
        bl.card("4 · ANÁLISIS DE CAUSAS", COLOR.ochre, bl.lista(a.analisisCausas)),
        bl.card("5 · CONTRAMEDIDAS EN DISCUSIÓN (N2)", COLOR.magenta, bl.lista(a.contramedidas)),
        bl.card("6 · PLAN Y SEGUIMIENTO", COLOR.purple, tablaAcciones(A(a.plan).map(p => [p.accion, p.responsable, p.cuando]), ["Acción", "Responsable", "Cuándo"])),
        bl.card("7 · DESPERDICIOS (MUDA) IDENTIFICADOS", COLOR.teal, bl.tabla(["Tipo de muda", "Dónde aparece", "Punto de dolor"], A(a.muda).map(x => [x.tipo, x.donde, x.puntoDolor]))),
        inconsistencias(m)
      ]
    };
  },
  flujoActual: ({ m }) => {
    const f = m.flujoActual;
    if (!f || !A(f.pasos).length) return null;
    return {
      titulo: "Flujo actual (AS-IS) y puntos de dolor", grupo: "flujos", apaisada: true,
      bloques: [
        { t: "carriles", flujo: f, figura: "Figura 1.", pie: "Flujo actual reconstruido desde la transcripción. Los círculos marcan puntos de dolor." },
        A(f.puntosDolor).length ? { t: "dolores", items: f.puntosDolor } : null
      ]
    };
  },
  causaRaiz: ({ m }) => {
    const c = m.causaRaiz;
    if (!c || !A(c.familias).filter(f => f.nombre).length) return null;
    return { titulo: "Causa raíz", grupo: "flujos", apaisada: true, bloques: [{ t: "ishikawa", causa: c, figura: "Figura 2." }] };
  },
  flujoFuturo: ({ m }) => {
    const f = m.flujoFuturo;
    if (!f || (!A(f.pasos).length && !A(f.comparacion).length)) return null;
    return {
      titulo: "Flujo futuro hipotético (TO-BE) · N2", grupo: "flujos", apaisada: true,
      bloques: [
        A(f.pasos).length ? { t: "carriles", flujo: f, futuro: true, figura: "Figura 3.", pie: "Hipótesis de trabajo derivada de la sesión, no validada. Las letras marcan los cambios respecto del flujo actual." } : null,
        bl.rejilla(...A(f.cambios).map(c => bl.card(`${c.marcas} · ${c.titulo}`.toUpperCase(), COLOR.ochre, bl.texto(c.texto)))),
        bl.tabla(["Actividad", "Hoy (AS-IS)", "Hipótesis (TO-BE)"], A(f.comparacion).map(c => [c.actividad, c.hoy, c.propuesta]))
      ]
    };
  },
  insights: ({ m }) => {
    if (!A(m.insights).length && !A(m.comoPodriamos).length && !A(m.restricciones).length) return null;
    return {
      titulo: "Insights y preguntas «¿Cómo podríamos…?»",
      bloques: [
        bl.tabla(["Insight", "Evidencia"], A(m.insights).map(i => [{ b: i.insight }, i.evidencia])),
        bl.card("¿CÓMO PODRÍAMOS…?", COLOR.magenta, bl.lista(m.comoPodriamos)),
        A(m.restricciones).length ? bl.side("", "Restricciones para el diseño.", bl.lista(m.restricciones)) : null
      ]
    };
  },
  beneficiosRiesgos: ({ m }) => {
    if (!A(m.beneficios).length && !A(m.riesgos).length) return null;
    return {
      titulo: "Beneficios, riesgos e indicadores",
      bloques: [
        A(m.beneficios).length ? bl.h3("Beneficios esperados (hipótesis, no compromiso)") : null,
        bl.tabla(["Dimensión", "Beneficio esperado", "Indicador propuesto"], A(m.beneficios).map(b => [b.dimension, b.beneficio, b.indicador])),
        m.notaMagnitud ? bl.side("warn", "", bl.texto(m.notaMagnitud)) : null,
        ...bloquesRiesgo(m)
      ]
    };
  },
  soluciones: ({ m }) => A(m.soluciones).length ? {
    titulo: "Espacio de soluciones",
    bloques: [
      bl.texto("Opciones mencionadas en la sesión, ordenadas por nivel de intervención. Ninguna está evaluada todavía.", true),
      bl.tabla(["Nivel", "Opción", "Origen", "Dependencias"], m.soluciones.map(x => [x.nivel, x.opcion, x.origen, x.dependencias]))
    ]
  } : null,

  // Ejecutiva ────────────────────────────────────────────────────────────────
  sintesisEjecutiva: ({ m }) => ({
    titulo: "Síntesis ejecutiva",
    bloques: [
      bl.card("MENSAJE CLAVE", COLOR.royal, bl.texto(m.onePager?.mensajeClave, true)),
      bl.card("CONTEXTO ESTRATÉGICO", COLOR.royal, bl.lista(m.contextoEstrategico)),
      bl.card("ESTADO", COLOR.green, bl.texto(m.onePager?.estado))
    ]
  }),
  decisiones: ({ m }) => A(m.decisiones).length ? {
    titulo: "Decisiones",
    bloques: [
      bl.tabla(["Decisión", "Fundamento", "Alternativas", "Responsable", "Evidencia"], m.decisiones.map(d => [{ b: d.decision }, d.fundamento, d.alternativas, d.responsable, d.evidencia])),
      bl.side("", "", bl.texto("Sólo se registra como decisión lo efectivamente acordado en la reunión. Lo planteado sin acuerdo figura en acuerdos pendientes o próximos pasos."))
    ]
  } : null,
  acuerdos: ({ m }) => A(m.acuerdos).length ? {
    titulo: "Acuerdos y compromisos",
    bloques: [tablaAcciones(m.acuerdos.map(a => [a.acuerdo, a.responsable, a.plazo]), ["Acuerdo", "Responsable", "Plazo"])]
  } : null,
  cartera: ({ m }) => A(m.cartera).length ? {
    titulo: "Cartera de temas",
    bloques: [bl.tabla(["Tema", "Estado", "Síntesis", "Requiere"], m.cartera.map(c => [{ b: c.tema }, { estado: c.estado }, c.sintesis, c.requiere]))]
  } : null,
  indicadores: ({ m }) => A(m.indicadores).length ? {
    titulo: "Indicadores",
    bloques: [
      bl.tabla(["Indicador", "Valor", "Meta", "Tendencia", "Fuente"], m.indicadores.map(i => [{ b: i.indicador }, i.valor, i.meta, i.tendencia, i.fuente])),
      bl.side("warn", "", bl.texto("Sólo cifras dichas en la reunión o presentes en documentos aportados; las verbales van marcadas «(verbal)»."))
    ]
  } : null,
  riesgosEscalamientos: ({ m }) => (A(m.riesgos).length || A(m.escalamientos).length) ? {
    titulo: "Riesgos y escalamientos",
    bloques: [
      ...bloquesRiesgo(m, false),
      A(m.escalamientos).length ? bl.h3("Escalamientos (N3)") : null,
      bl.tabla(["Tema", "A quién", "Motivo"], A(m.escalamientos).map(e => [{ b: e.tema }, e.aQuien, e.motivo])),
      m.riesgoN3 ? bl.side("n3", "", bl.texto(m.riesgoN3)) : null
    ]
  } : null,

  // Operacional ──────────────────────────────────────────────────────────────
  seguimientoPrevio: ({ m }) => A(m.seguimientoPrevio).length ? {
    titulo: "Seguimiento de acuerdos anteriores",
    bloques: [bl.tabla(["Acuerdo", "Estado", "Comentario"], m.seguimientoPrevio.map(s => [s.acuerdo, { estado: s.estado }, s.comentario]))]
  } : null,
  frentes: ({ m }) => A(m.frentes).length ? {
    titulo: "Estado de frentes",
    bloques: [bl.tabla(["Frente", "Estado", "Avance", "Bloqueos", "Responsable"], m.frentes.map(f => [{ b: f.frente }, { estado: f.estado }, f.avance, f.bloqueos, f.responsable]))]
  } : null,
  incidentes: ({ m }) => A(m.incidentes).length ? {
    titulo: "Incidentes y problemas",
    bloques: m.incidentes.map((i, k) => bl.card(`INCIDENTE ${k + 1} · ${i.incidente}`.toUpperCase(), COLOR.magenta, bl.tabla(["Campo", "Detalle"], [
      ["Impacto", i.impacto], ["Causa", i.causa], ["Acción inmediata", i.accionInmediata],
      ["Acción correctiva", i.accionCorrectiva], ["Responsable", i.responsable], ["Plazo", i.plazo]
    ])))
  } : null,
  acciones: ({ m }) => (A(m.acciones).length || A(m.muda).length) ? {
    titulo: "Plan de acción",
    bloques: [
      tablaAcciones(A(m.acciones).map(a => [a.accion, a.responsable, a.plazo, { estado: a.prioridad === "Alta" ? "Rojo" : a.prioridad === "Media" ? "Amarillo" : "Verde", texto: a.prioridad }]), ["Acción", "Responsable", "Plazo", "Prioridad"]),
      A(m.muda).length ? bl.card("DESPERDICIOS (MUDA) IDENTIFICADOS", COLOR.teal, bl.tabla(["Tipo de muda", "Dónde aparece", "Punto de dolor"], m.muda.map(x => [x.tipo, x.donde, x.puntoDolor]))) : null
    ]
  } : null,
  riesgos: ({ m }) => A(m.riesgos).length ? { titulo: "Riesgos", bloques: bloquesRiesgo(m) } : null,

  // Académica ────────────────────────────────────────────────────────────────
  exposiciones: ({ m }) => A(m.exposiciones).length ? {
    titulo: "Exposiciones",
    bloques: m.exposiciones.map(e => bl.card(`${e.expositor || "Expositor no identificado"} · ${e.tema}`.toUpperCase(), COLOR.royal,
      bl.lista(e.puntosClave),
      A(e.evidenciaCitada).length ? bl.texto("Evidencia citada:") : null,
      bl.lista(A(e.evidenciaCitada).map(x => ({ partes: [{ mute: x }] })))))
  } : null,
  argumentos: ({ m }) => A(m.argumentos).length ? {
    titulo: "Argumentos y evidencia citada",
    bloques: [bl.tabla(["Afirmación", "Sustento", "Contraargumento", "Quién"], m.argumentos.map(a => [{ b: a.afirmacion }, a.sustento, a.contraargumento, a.quien]))]
  } : null,
  metodologia: ({ m }) => A(m.metodologia).length ? {
    titulo: "Metodología discutida", bloques: [bl.card("DISEÑO, MÉTODOS, ANÁLISIS Y SESGOS", COLOR.green, bl.lista(m.metodologia))]
  } : null,
  brechasConclusiones: ({ m }) => (A(m.brechas).length || A(m.conclusiones).length) ? {
    titulo: "Brechas y conclusiones",
    bloques: [
      bl.card("CONCLUSIONES", COLOR.green, bl.lista(m.conclusiones)),
      bl.card("BRECHAS Y PREGUNTAS ABIERTAS", COLOR.ochre, bl.lista(m.brechas))
    ]
  } : null,
  tareas: ({ m }) => A(m.tareas).length ? {
    titulo: "Tareas académicas", bloques: [tablaAcciones(m.tareas.map(x => [x.tarea, x.responsable, x.plazo]), ["Tarea", "Responsable", "Plazo"])]
  } : null,
  glosario: ({ m }) => A(m.glosario).length ? {
    titulo: "Glosario", bloques: [bl.tabla(["Término", "Definición"], m.glosario.map(g => [{ b: g.termino }, g.definicion]))]
  } : null,

  // Comunes ──────────────────────────────────────────────────────────────────
  actores: ({ m, tipo }) => (A(m.actores).length || A(m.senales).length) ? {
    titulo: "Lectura de actores y señales",
    bloques: [
      A(m.actores).length ? bl.h3("Mapa de actores") : null,
      bl.tabla(["Actor", "Rol", "Implicancia"], A(m.actores).map(a => [{ b: a.actor }, a.rol, a.implicancia])),
      A(m.senales).length ? bl.h3("Señales explícitas") : null,
      bl.citas(m.senales),
      tipo !== "creativa" && A(m.restricciones).length ? bl.side("", "Restricciones.", bl.lista(m.restricciones)) : null
    ]
  } : null,

  // El modelo no cita literatura: formula preguntas. Las referencias las trae
  // la búsqueda real de la aplicación y se marcan «por evaluar» porque nadie ha
  // hecho aún su lectura crítica.
  evidencia: ({ m, r, refs }) => {
    const preguntas = A(m.preguntasEvidencia);
    const mencionadas = A(m.referenciasMencionadas);
    if (!preguntas.length && !mencionadas.length) return null;
    const ev = A(r.evidencia);
    const filas = preguntas.map(p => {
      const e = ev.find(x => x.pregunta === p.pregunta);
      const encontradas = !e ? { partes: [{ mute: "Búsqueda pendiente." }] }
        : !A(e.refs).length ? { partes: [{ mute: e.error || "Sin resultados en las bases consultadas." }] }
        : { partes: e.refs.flatMap((ref, i) => [i ? { br: true } : "", ref.titulo, " ", { mute: [ref.revista, ref.anio].filter(Boolean).join(", ") }, { ref: refs.indice(ref) }]) };
      return [{ partes: [{ b: p.pregunta }, { br: true }, { mono: p.busqueda }] }, encontradas, p.aplicabilidad, { tag: "neutro", texto: "Por evaluar" }];
    });
    const consultadas = ev.find(e => A(e.consultadas).length)?.consultadas;
    return {
      titulo: "Evidencia y literatura",
      bloques: [
        bl.tabla(["Pregunta", "Referencias encontradas", "Aplicabilidad", "Certeza"], filas),
        preguntas.length ? bl.side("ok", "Cómo leer esta sección.", bl.texto(`Las preguntas las formuló el acta a partir de la reunión; las referencias provienen de una búsqueda automática en bases bibliográficas${consultadas ? ` (${consultadas.join(", ")})` : ""} y aún no tienen lectura crítica: la certeza queda «por evaluar» hasta revisar cada resumen. Ninguna cifra de literatura se usa en el acta sin esa revisión.`)) : null,
        mencionadas.length ? bl.h3("Referencias mencionadas en la reunión (no verificadas)") : null,
        bl.lista(mencionadas.map(x => ({ partes: [x.tipo ? { b: `[${x.tipo}] ` } : "", x.descripcion, x.url ? ` — ${x.url}` : "", x.marca ? { mono: ` [${x.marca}]` } : ""] })))
      ]
    };
  },

  // Lo que dijo Catalina va aparte: es una asistente de IA, no un participante,
  // y lo suyo no cuenta como decisión del equipo salvo que alguien lo acepte.
  catalina: ({ m, r }) => {
    const aportes = A(m.aportesCatalina);
    const tramos = A(r.participacion);
    if (!aportes.length && !tramos.length) return null;
    const marca = ms => { const s = Math.max(0, Math.round((ms - r.meta.inicio) / 1000)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, "0")).join(":"); };
    return {
      titulo: "Intervenciones de Catalina (IA)",
      bloques: [
        bl.side("", "", bl.texto("Catalina es una asistente de inteligencia artificial. Sus intervenciones se registran separadas de las de los participantes; ninguna cuenta como decisión, acuerdo u opinión del equipo salvo que un participante la haya aceptado expresamente.")),
        tramos.length ? bl.card("TRAMOS DE PARTICIPACIÓN ACTIVA", COLOR.purple, bl.lista(tramos.map(t => `De ${marca(t.desde)} a ${t.hasta ? marca(t.hasta) : "el final de la reunión"}`))) : null,
        bl.tabla(["Marca", "Tipo", "Aporte", "Recepción del grupo"], aportes.map(a => [{ partes: [{ mono: a.marca }] }, { tag: "neutro", texto: a.tipo }, a.aporte, a.recepcion]))
      ]
    };
  },

  proximaReunion: ({ m }) => {
    const p = m.proximaReunion || {};
    if (!A(p.estructura).length && !A(p.datosASolicitar).length && !A(p.preguntas).length && !A(p.erroresAEvitar).length) return null;
    const total = A(p.estructura).reduce((s, e) => s + (Number(e.minutos) || 0), 0);
    return {
      titulo: "Preparación de la próxima reunión",
      bloques: [
        bl.card(`ESTRUCTURA SUGERIDA${total ? ` (${total} MIN)` : ""}`, COLOR.royal, bl.lista(A(p.estructura).map(e => `${e.punto}${e.minutos ? ` (${e.minutos} min)` : ""}`), true)),
        bl.card("DATOS A SOLICITAR", COLOR.green, bl.lista(p.datosASolicitar)),
        bl.card("PREGUNTAS QUE CONVIENE HACER", COLOR.ochre, bl.lista(p.preguntas)),
        bl.card("ERRORES A EVITAR", COLOR.magenta, bl.lista(p.erroresAEvitar))
      ]
    };
  },

  complementarios: ({ m }) => (A(m.diagramas).length || A(m.graficos).length) ? {
    titulo: "Diagramas y gráficos complementarios",
    bloques: [
      ...A(m.diagramas).map(d => ({ t: "mermaid", titulo: d.titulo, proposito: d.proposito, codigo: d.mermaid })),
      ...A(m.graficos).map(g => ({ t: "grafico", g }))
    ]
  } : null,

  trazabilidad: ({ m, r, refs, calidad, plantilla }) => {
    const t = m.trazabilidad || {};
    const tz = r.trazabilidad || {};
    const enlacesOrganizador = String(r.meta.enlaces || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
    return {
      titulo: "Trazabilidad", color: COLOR.mute,
      bloques: [
        bl.card("PROCESO", COLOR.mute, bl.lista([
          `Transcripción ${calidad.fuente}: cobertura estimada ${calidad.cobertura}%, ${calidad.palabras.toLocaleString("es")} ${calidad.palabras === 1 ? "palabra" : "palabras"}${calidad.huecos ? `, ${calidad.huecos} tramo(s) sin audio` : ""}.`,
          A(r.catalina).length ? `Intervenciones de Catalina registradas por separado: ${r.catalina.length}.` : "",
          A(r.insumos).length ? `Documentos aportados como insumo: ${r.insumos.length}; su texto se entregó al modelo delimitado y separado de la transcripción.` : "",
          tz.modelo ? `Acta redactada con ${tz.proveedor}/${tz.modelo} (nivel ${tz.nivel}, formato «${plantilla.nombre}») el ${new Date(tz.generadaEn).toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" })}.`.replace(/\.\.$/, ".") : "",
          A(r.evidencia).length ? `Búsqueda bibliográfica automática por pregunta el ${new Date(r.evidenciaFecha || Date.now()).toLocaleDateString("es-CL")}; referencias sin lectura crítica.` : "",
          "Revisión humana pendiente antes de difundir."
        ], true)),
        bl.card("SUPUESTOS", COLOR.mute, bl.lista(t.supuestos)),
        t.limites ? bl.side("warn", "Límites.", bl.texto(t.limites)) : null,
        (refs.lista.length || enlacesOrganizador.length || A(r.materiales).length || A(r.insumos).length) ? bl.h3("Referencias") : null,
        refs.lista.length ? { t: "refs", lista: refs.lista } : null,
        enlacesOrganizador.length ? bl.texto("Aportadas por el organizador:") : null,
        enlacesOrganizador.length ? { t: "enlaces", items: enlacesOrganizador } : null,
        A(r.insumos).length ? bl.texto("Documentos aportados como insumo (leídos automáticamente; el texto extraído puede contener errores):") : null,
        bl.lista(A(r.insumos).map(f => `${f.nombre} — ${[f.formato, f.detalle, f.metodo ? `lectura: ${f.metodo}` : "", f.estado === "parcial" ? "lectura parcial" : f.estado === "sin-texto" ? "sin texto legible" : f.estado === "error" ? "no se pudo leer" : ""].filter(Boolean).join(" · ")}.`)),
        A(r.materiales).length ? bl.texto("Material mostrado por Catalina durante la reunión:") : null,
        bl.lista([...new Set(A(r.materiales))]),
        t.notaDeUso ? bl.texto(`Nota de uso: ${t.notaDeUso}`) : null,
        { t: "pie", texto: `ACTA · ${plantilla.nombre.toUpperCase()} · ${fechaLarga(r.meta.inicio).toUpperCase()} · DOCUMENTO N2, PENDIENTE DE VALIDACIÓN` }
      ]
    };
  }
};

function bloquesRiesgo(m, conN3 = true) {
  return [
    A(m.riesgos).length ? bl.h3("Matriz de riesgos") : null,
    bl.tabla(["Riesgo", "Prob.", "Impacto", "Mitigación"], A(m.riesgos).map(x => [x.riesgo, { estado: x.probabilidad === "Alta" ? "Rojo" : x.probabilidad === "Media" ? "Amarillo" : "Verde", texto: x.probabilidad }, x.impacto, x.mitigacion])),
    conN3 && m.riesgoN3 ? bl.side("n3", "", bl.texto(m.riesgoN3)) : null
  ];
}

// Numeración única de referencias, compartida entre evidencia y trazabilidad.
function numerador(r) {
  const lista = [];
  for (const e of A(r.evidencia)) for (const ref of A(e.refs)) {
    if (!lista.some(x => x.enlace === ref.enlace && x.titulo === ref.titulo)) lista.push(ref);
  }
  return { lista, indice: ref => lista.findIndex(x => x.enlace === ref.enlace && x.titulo === ref.titulo) + 1 };
}

// Tipo de plantilla del acta. Las actas «lean-1» (primer formato) eran de
// sesión creativa; las anteriores no tienen formato y se piden regenerar.
export const tipoDelActa = r => r?.minuta?.formato === "acta-2" ? (r.minuta.plantilla || "creativa")
  : r?.minuta?.formato === "lean-1" ? "creativa" : null;

// Secciones del acta, ya numeradas y coloreadas.
export function seccionesDelActa(r, calidad) {
  const tipo = tipoDelActa(r);
  const plantilla = plantillaDe(tipo);
  const ctx = { r, m: r.minuta, tipo, plantilla, calidad, refs: numerador(r) };
  const nombres = [...plantilla.secciones];
  // Los diagramas y gráficos adicionales, justo antes de las intervenciones
  // de Catalina (o de la próxima reunión si no las hay).
  nombres.splice(Math.max(0, nombres.indexOf("catalina")), 0, "complementarios");
  const salida = [];
  let numero = -1, grupoAnterior = null, color = 0;
  for (const nombre of nombres) {
    const s = SECCIONES[nombre]?.(ctx);
    if (!s || !s.bloques.filter(Boolean).length) continue;
    if (!s.grupo || s.grupo !== grupoAnterior) numero += 1;
    grupoAnterior = s.grupo || null;
    salida.push({
      ...s,
      numero: String(numero).padStart(2, "0"),
      color: s.color || ROTACION[color++ % ROTACION.length],
      bloques: s.bloques.filter(Boolean)
    });
  }
  return { tipo, plantilla, secciones: salida };
}

// ── Documento ────────────────────────────────────────────────────────────────

function portada(r, plantilla) {
  const m = r.minuta;
  return `
  <section class="portada">
    <div class="portada-caja">
      <p class="kicker claro">ACTA · ${esc(plantilla.nombre.toUpperCase())} · DOCUMENTO DE TRABAJO · NIVEL N2 (PENDIENTE DE VALIDACIÓN)</p>
      <h1>${esc(m.titulo || r.meta.titulo)}</h1>
      ${m.lede ? `<p class="lede">${esc(m.lede)}</p>` : ""}
      <div class="guiones"><span style="background:#4a78d8"></span><span style="background:#2f9a4a"></span><span style="background:#c48a10"></span><span style="background:#d0409a"></span></div>
      <div class="portada-meta">
        <div><p class="kicker claro">REUNIÓN</p><p>${esc(fechaLarga(r.meta.inicio))} · ${minutos(r)} min</p><p>"${esc(r.meta.titulo)}"</p>${r.meta.lugar ? `<p>${esc(r.meta.lugar)}</p>` : ""}</div>
        <div><p class="kicker claro">ÁREA</p><p>${esc(m.area || "—")}</p></div>
        <div><p class="kicker claro">PARTICIPANTES</p><p>${esc(r.meta.participantes || "No declarados")}</p>${A(r.catalina).length ? "<p>Con intervenciones de Catalina (IA)</p>" : ""}</div>
        <div><p class="kicker claro">HITO SIGUIENTE</p><p>${esc(m.hitoSiguiente || "Por definir")}</p></div>
      </div>
    </div>
  </section>`;
}

export function actaHTML(r, calidad) {
  const tipo = tipoDelActa(r);
  if (!tipo) {
    return `<section class="sec"><div class="side warn">Esta acta se generó con un formato anterior. Vuelve a generarla para obtener el formato actual (portada, secciones numeradas, evidencia y trazabilidad).</div></section>`;
  }
  const { plantilla, secciones } = seccionesDelActa(r, calidad);
  return portada(r, plantilla) + secciones.map(s => `
  <section class="sec${s.apaisada ? " apaisada" : ""}">
    <header class="banda" style="background:${s.color}"><span class="num">${s.numero}</span><h2>${esc(s.titulo)}</h2></header>
    ${s.bloques.map(bloqueHTML).join("")}
  </section>`).join("");
}

// Markdown del acta: mismas secciones y bloques que el HTML. Es lo que se pega
// en Google Docs (Pegar desde Markdown), Notion u Obsidian.
export function actaMarkdown(r, calidad) {
  const m = r.minuta;
  if (!m) return "";
  const op = m.onePager || {};
  const tipo = tipoDelActa(r);
  const plantilla = plantillaDe(tipo);
  const fecha = new Date(r.meta.inicio).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" });
  const partes = [
    `# ${m.titulo || r.meta.titulo}`,
    `*Acta · ${tipo ? plantilla.nombre : "formato anterior"} · ${fecha} · ${minutos(r)} min · Nivel N2 (pendiente de validación)*`,
    m.lede ? `*${m.lede}*` : "",
    "## One pager",
    op.estado ? `**Estado:** ${op.estado}` : "",
    op.mensajeClave ? `> ${op.mensajeClave}` : "",
    op.contexto || "",
    A(op.indicadores).length ? "**Indicadores**\n" + op.indicadores.map(i => `- ${i.etiqueta}: **${i.valor}**`).join("\n") : "",
    A(op.decisiones).length ? "**Decisiones**\n" + op.decisiones.map(d => `- ${d}`).join("\n") : "",
    A(op.acciones).length ? "**Acciones**\n\n" + bloqueMD(bl.tabla(["Acción", "Responsable", "Plazo"], op.acciones.map(a => [a.accion, a.responsable, a.plazo]))) : "",
    A(op.riesgos).length ? "**Riesgos**\n" + op.riesgos.map(x => `- ${x}`).join("\n") : "",
    A(op.proximosPasos).length ? "**Próximos pasos**\n" + op.proximosPasos.map(x => `- ${x}`).join("\n") : ""
  ];
  if (!tipo) return [...partes, "_Acta generada con un formato anterior: vuelve a generarla para obtener el formato actual._"].filter(Boolean).join("\n\n");
  const { secciones } = seccionesDelActa(r, calidad);
  partes.push("---", `# Acta · ${plantilla.nombre}`,
    bloqueMD(bl.tabla(["Reunión", "Área", "Participantes", "Hito siguiente"], [[`${fecha} · ${minutos(r)} min · "${r.meta.titulo}"`, m.area, r.meta.participantes || "No declarados", m.hitoSiguiente || "Por definir"]])));
  for (const s of secciones) partes.push(`## ${s.numero} · ${s.titulo}`, ...s.bloques.map(bloqueMD));
  return partes.filter(p => p && String(p).trim()).join("\n\n").replace(/\n{3,}/g, "\n\n");
}

// One pager: la versión resumida, en una hoja.
export function onePagerHTML(r) {
  const op = r.minuta.onePager;
  const tipo = tipoDelActa(r);
  const tiles = A(op.indicadores).length ? op.indicadores.slice(0, 4) : [
    { valor: `${minutos(r)} min`, etiqueta: "Duración" },
    { valor: String(A(op.decisiones).length), etiqueta: "Decisiones" },
    { valor: String(A(op.acciones).length), etiqueta: "Acciones" },
    { valor: String(A(op.riesgos).length), etiqueta: "Riesgos" }
  ];
  const tarjeta = (etiqueta, color, contenido) => bloqueHTML(bl.card(etiqueta, color, contenido));
  return `
  <section class="sec onepager">
    <div class="portada-caja compacta">
      <p class="kicker claro">ONE PAGER · ${esc((tipo ? plantillaDe(tipo).nombre : "ACTA").toUpperCase())} · ${esc(fechaLarga(r.meta.inicio).toUpperCase())} · NIVEL N2</p>
      <h1>${esc(r.minuta.titulo || r.meta.titulo)}</h1>
      ${op.estado ? `<span class="tag claro">${esc(op.estado)}</span>` : ""}
    </div>
    <div class="tiles">${tiles.map(x => `<div class="tile"><b>${esc(x.valor)}</b><span>${esc(x.etiqueta)}</span></div>`).join("")}</div>
    <p class="clave">${esc(op.mensajeClave)}</p>
    ${bloqueHTML(bl.texto(op.contexto))}
    <div class="rejilla-2">
      ${tarjeta("DECISIONES", COLOR.green, bl.lista(op.decisiones))}
      ${tarjeta("RIESGOS", COLOR.magenta, bl.lista(op.riesgos))}
    </div>
    ${tarjeta("ACCIONES", COLOR.purple, bl.tabla(["Acción", "Responsable", "Plazo"], A(op.acciones).map(a => [a.accion, a.responsable, a.plazo])))}
    ${tarjeta("PRÓXIMOS PASOS", COLOR.royal, bl.lista(op.proximosPasos))}
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
.acta .rejilla-1 { display: block; }
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
  /* Las secciones fluyen una tras otra (sin páginas casi vacías); sólo los
     flujos y diagramas anchos van en su propia página apaisada. */
  .acta .sec { break-before: auto; margin: 0 0 7mm; } .acta .portada { break-after: page; }
  .acta .sec.apaisada { page: apaisada; break-before: page; }
  .acta .sec.apaisada + .sec:not(.apaisada) { break-before: page; }
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
