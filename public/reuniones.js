// Reuniones: lo que se dijo, guardado y consultable.
//
// Antes la transcripción vivía sólo en la memoria de la escucha: se borraba al
// volver a entrar en modo Meet, desaparecía al recargar la página y Catalina no
// tenía ninguna vía para consultarla después. Por eso, al preguntarle por el
// contenido de una reunión, contestaba que no tenía la información: era verdad.
//
// Aquí cada reunión es un registro con sus datos (título, objetivo,
// participantes, enlaces), sus dos transcripciones —la del navegador y la de
// alta fidelidad— y su minuta cuando la haya. Se guarda en el navegador y se
// puede buscar por contenido, que es lo que usa la herramienta
// consultar_reunion.
//
// Todo queda en este equipo (localStorage). No se sube a ningún servidor salvo
// cuando se pide explícitamente transcribir en alta fidelidad o generar la
// minuta, y en ese caso sólo el audio o el texto necesarios.

const CLAVE = "catalina.reuniones.v1";
const MAX_REUNIONES = 15;

export const normalizar = texto => String(texto ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase();

const VACIAS = new Set((
  "para como pero porque cuando donde desde hasta entre sobre esto esta este estos estas eso esa ese " +
  "aqui alli algo alguien todo todos toda todas nada muy mas menos tambien entonces pues ahora luego " +
  "tiene tienen tenia hacer hace hizo dijo dice decir fue fueron sido siendo sera seria habia hemos " +
  "estan estaba estamos puede pueden podria quiero quieres queria reunion catalina dime cuentame sabes " +
  "cual cuales quien quienes cuanto cuanta que del los las una uno unos unas con sin por ser hay han"
).split(" "));

const terminos = texto => [...new Set(normalizar(texto).split(/[^a-z0-9ñ]+/).filter(p => p.length > 3 && !VACIAS.has(p)))];

// ── Persistencia ─────────────────────────────────────────────────────────────

export function leerReuniones() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE) || "[]");
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function escribirReuniones(lista) {
  // Si el navegador se queda sin espacio se sueltan las más antiguas: perder
  // la reunión de hace dos semanas es mejor que no poder guardar la de hoy.
  let recortada = lista.slice(-MAX_REUNIONES);
  while (recortada.length) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(recortada));
      return true;
    } catch {
      if (recortada.length === 1) break;
      recortada = recortada.slice(1);
    }
  }
  console.warn("Reuniones: no se pudo guardar en este navegador");
  return false;
}

export function obtenerReunion(id) {
  return leerReuniones().find(r => r.id === id) || null;
}

export function guardarReunion(reunion) {
  const lista = leerReuniones();
  const i = lista.findIndex(r => r.id === reunion.id);
  if (i >= 0) lista[i] = reunion; else lista.push(reunion);
  return escribirReuniones(lista);
}

export function borrarReunion(id) {
  return escribirReuniones(leerReuniones().filter(r => r.id !== id));
}

export function nuevaReunion(meta = {}) {
  const inicio = Date.now();
  return {
    id: `r${inicio.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    version: 1,
    meta: {
      titulo: String(meta.titulo || "").trim() || `Reunión del ${new Date(inicio).toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" })}`,
      objetivo: String(meta.objetivo || "").trim(),
      participantes: String(meta.participantes || "").trim(),
      agenda: String(meta.agenda || "").trim(),
      enlaces: String(meta.enlaces || "").trim(),
      lugar: String(meta.lugar || "").trim(),
      inicio,
      fin: null
    },
    alta: Boolean(meta.alta),
    navegador: [],     // {momento, texto, incompleto?, hueco?}
    hd: [],            // {desde, hasta, texto, proveedor}
    hdFallidos: [],    // {desde, hasta, error}
    intervenciones: [], // lo que se le preguntó a Catalina y qué respondió
    materiales: [],    // láminas y referencias mostradas durante la reunión
    estadisticas: {},
    minuta: null
  };
}

// ── Transcripción ────────────────────────────────────────────────────────────

const reloj = (ms, base) => {
  const s = Math.max(0, Math.round((ms - base) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  return [h, m, seg].map(n => String(n).padStart(2, "0")).join(":");
};

// La transcripción que se usa para la minuta y para las consultas.
//
// Si hubo alta fidelidad, manda ésa. Los tramos en que falló se rellenan con lo
// que entendió el navegador en esos mismos minutos, marcado como tal. Y los
// huecos en que no se escuchó nada quedan anotados: la minuta tiene que saber
// que ahí falta información para no inventarla.
export function transcripcionPreferida(reunion) {
  const base = reunion.meta.inicio;
  const lineas = [];
  const usarHd = reunion.hd.length > 0;

  if (usarHd) {
    for (const s of reunion.hd) {
      if (s.texto) lineas.push({ t: s.desde, texto: s.texto, fuente: "alta" });
    }
    for (const f of reunion.hdFallidos) {
      const tramo = reunion.navegador.filter(s => s.texto && s.momento >= f.desde - 2000 && s.momento <= f.hasta + 2000);
      if (tramo.length) {
        for (const s of tramo) lineas.push({ t: s.momento, texto: s.texto, fuente: "navegador" });
      } else {
        lineas.push({ t: f.desde, texto: "", hueco: f.hasta - f.desde });
      }
    }
  } else {
    for (const s of reunion.navegador) {
      if (s.hueco) lineas.push({ t: s.momento, texto: "", hueco: s.hueco });
      else if (s.texto) lineas.push({ t: s.momento, texto: s.texto, fuente: "navegador", incompleto: s.incompleto });
    }
  }
  lineas.sort((a, b) => a.t - b.t);
  return lineas.map(l => ({ ...l, marca: reloj(l.t, base) }));
}

export function transcripcionComoTexto(reunion, { marcas = true } = {}) {
  return transcripcionPreferida(reunion).map(l => {
    if (l.hueco) return `${marcas ? `[${l.marca}] ` : ""}[SIN AUDIO ~${Math.round(l.hueco / 1000)} s: no se pudo transcribir este tramo]`;
    const marcasExtra = [l.fuente === "navegador" && reunion.hd.length ? "(respaldo navegador)" : "", l.incompleto ? "(frase cortada)" : ""].filter(Boolean).join(" ");
    return `${marcas ? `[${l.marca}] ` : ""}${l.texto}${marcasExtra ? " " + marcasExtra : ""}`;
  }).join("\n");
}

export function duracion(reunion) {
  const fin = reunion.meta.fin || Date.now();
  return Math.max(0, fin - reunion.meta.inicio);
}

export function palabras(reunion) {
  return transcripcionPreferida(reunion).reduce((n, l) => n + (l.texto ? l.texto.split(/\s+/).length : 0), 0);
}

// Indicadores de calidad de la captura. Van a la minuta y a la pantalla: una
// minuta de una reunión mal escuchada tiene que decirlo.
export function calidad(reunion) {
  const total = duracion(reunion);
  const huecos = transcripcionPreferida(reunion).filter(l => l.hueco).reduce((n, l) => n + l.hueco, 0);
  const cobertura = total ? Math.max(0, Math.min(1, 1 - huecos / total)) : 0;
  return {
    fuente: reunion.hd.length ? "alta fidelidad" : "navegador",
    cobertura: Math.round(cobertura * 100),
    huecos: transcripcionPreferida(reunion).filter(l => l.hueco).length,
    tramosFallidos: reunion.hdFallidos.length,
    tramosAlta: reunion.hd.length,
    palabras: palabras(reunion),
    ...reunion.estadisticas
  };
}

// ── Consulta: la memoria de Catalina ─────────────────────────────────────────

// Elige la reunión a la que se refiere la pregunta: la que está en curso, la
// última, o la que mejor coincida por título.
export function elegirReunion(cual, idActual) {
  const lista = leerReuniones();
  if (!lista.length) return null;
  const c = normalizar(cual || "").trim();
  if ((!c || /actual|esta|en curso|ahora/.test(c)) && idActual) {
    return lista.find(r => r.id === idActual) || lista.at(-1);
  }
  if (!c || /ultima|anterior|reciente|pasada/.test(c)) return lista.at(-1);
  const buscados = terminos(c);
  let mejor = null, puntos = 0;
  for (const r of lista) {
    const titulo = normalizar(`${r.meta.titulo} ${r.meta.objetivo} ${r.meta.participantes}`);
    const p = buscados.filter(t => titulo.includes(t)).length;
    if (p > puntos) { mejor = r; puntos = p; }
  }
  return mejor || lista.at(-1);
}

// Busca en la transcripción los pasajes que responden a la pregunta. No es una
// búsqueda semántica: agrupa la reunión en tramos de un minuto, los puntúa por
// coincidencia de términos y devuelve los mejores en orden cronológico, con su
// marca de tiempo para que Catalina pueda citarlos.
export function consultarReunion(reunion, pregunta, { maxCaracteres = 7000 } = {}) {
  const lineas = transcripcionPreferida(reunion).filter(l => l.texto);
  const q = terminos(pregunta);

  const tramos = [];
  for (const l of lineas) {
    const ultimo = tramos.at(-1);
    if (ultimo && l.t - ultimo.t < 60000 && ultimo.texto.length < 900) {
      ultimo.texto += " " + l.texto;
    } else {
      tramos.push({ t: l.t, marca: l.marca, texto: l.texto });
    }
  }

  let elegidos;
  const general = !q.length || /resumen|resume|de que (se )?hablo|de que trato|temas|conclusion|acuerd|decid/.test(normalizar(pregunta));
  if (q.length) {
    const puntuados = tramos.map((tramo, i) => {
      const plano = normalizar(tramo.texto);
      const p = q.reduce((n, t) => n + (plano.includes(t) ? 1 + Math.min(3, plano.split(t).length - 2) * .3 : 0), 0);
      return { ...tramo, i, p };
    }).filter(t => t.p > 0).sort((a, b) => b.p - a.p);
    elegidos = puntuados;
  } else {
    elegidos = [];
  }

  // Sin coincidencias, o si la pregunta es general, se entrega el principio y
  // el final: suele bastar para orientarse, y la minuta completa el resto.
  if (!elegidos.length) {
    const n = tramos.length;
    elegidos = [...tramos.slice(0, 3), ...tramos.slice(Math.max(3, n - 5))].map((t, i) => ({ ...t, i }));
  }

  const salida = [];
  let usados = 0;
  for (const t of elegidos) {
    const linea = `[${t.marca}] ${t.texto}`;
    if (usados + linea.length > maxCaracteres) break;
    salida.push(t);
    usados += linea.length;
  }
  salida.sort((a, b) => a.t - b.t);

  const m = reunion.minuta;
  return {
    ok: true,
    reunion: reunion.meta.titulo,
    fecha: new Date(reunion.meta.inicio).toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" }),
    duracionMinutos: Math.round(duracion(reunion) / 60000),
    enCurso: !reunion.meta.fin,
    objetivo: reunion.meta.objetivo || undefined,
    participantes: reunion.meta.participantes || undefined,
    calidadTranscripcion: calidad(reunion),
    minuta: m ? {
      mensajeClave: m.onePager?.mensajeClave,
      decisiones: (m.onePager?.decisiones || []).slice(0, 8),
      acciones: (m.onePager?.acciones || []).slice(0, 10),
      riesgos: (m.onePager?.riesgos || []).slice(0, 6)
    } : (general ? "Aún no hay minuta: puedes ofrecer generarla con generar_minuta." : undefined),
    pasajes: salida.map(t => `[${t.marca}] ${t.texto}`),
    coincidencias: q.length ? elegidos.length : undefined,
    nota: "Pasajes transcritos automáticamente: pueden contener errores de reconocimiento. Cita la marca de tiempo al usarlos. "
      + "Si no aparece lo que te preguntan, dilo: no lo completes de memoria."
  };
}

// Resumen breve de las reuniones guardadas, para que Catalina sepa que existen
// al empezar una conversación nueva.
export function indiceDeReuniones(max = 5) {
  return leerReuniones().slice(-max).reverse().map(r => {
    const fecha = new Date(r.meta.inicio).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
    const clave = r.minuta?.onePager?.mensajeClave ? ` — ${r.minuta.onePager.mensajeClave}` : "";
    return `«${r.meta.titulo}» (${fecha}, ${Math.round(duracion(r) / 60000)} min${r.minuta ? ", con minuta" : ""})${clave}`;
  });
}

// ── Claves propias (BYOK) ────────────────────────────────────────────────────
//
// Si la persona prefiere usar su propia cuenta de API en vez de la del
// servidor, la clave se guarda sólo en este navegador y viaja en una cabecera
// en cada petición de minuta o transcripción. El servidor la usa para esa
// petición y no la guarda.

const CLAVE_PROPIA = "catalina.clavePropia.v1";

export function leerClavePropia() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE_PROPIA) || "null");
    return d?.clave && d?.proveedor ? d : null;
  } catch {
    return null;
  }
}

export function guardarClavePropia(datos) {
  try {
    if (!datos?.clave) localStorage.removeItem(CLAVE_PROPIA);
    else localStorage.setItem(CLAVE_PROPIA, JSON.stringify({ proveedor: datos.proveedor, clave: datos.clave.trim() }));
    return true;
  } catch {
    return false;
  }
}

export function cabecerasDeClavePropia(proveedoresUtiles) {
  const propia = leerClavePropia();
  if (!propia || (proveedoresUtiles && !proveedoresUtiles.includes(propia.proveedor))) return {};
  return { "X-Clave-Propia": propia.clave, "X-Proveedor-Propio": propia.proveedor };
}

// ── Minuta ───────────────────────────────────────────────────────────────────

export function datosParaMinuta(reunion) {
  const materiales = [...new Set(reunion.materiales || [])];
  return {
    meta: {
      titulo: reunion.meta.titulo,
      fecha: new Date(reunion.meta.inicio).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" }),
      duracionMinutos: Math.round(duracion(reunion) / 60000),
      objetivo: reunion.meta.objetivo,
      participantes: reunion.meta.participantes,
      agenda: reunion.meta.agenda,
      enlaces: reunion.meta.enlaces,
      lugar: reunion.meta.lugar
    },
    calidad: calidad(reunion),
    materiales,
    intervenciones: (reunion.intervenciones || []).map(i => ({ marca: i.marca, pregunta: i.pregunta })),
    transcripcion: transcripcionComoTexto(reunion)
  };
}

export async function pedirMinuta(reunion, { nivel = "estandar", motor = null } = {}) {
  try {
    const r = await fetch("/reunion/minuta", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecerasDeClavePropia() },
      body: JSON.stringify({ ...datosParaMinuta(reunion), nivel, motor })
    });
    const texto = await r.text();
    try { return JSON.parse(texto); } catch { return { ok: false, error: `Respuesta ilegible del servidor (${r.status}).` }; }
  } catch {
    return { ok: false, error: "Se perdió la conexión con el servidor." };
  }
}

export async function enviarMinutaPorCorreo(reunion, adjuntosExtra = []) {
  if (!reunion.minuta) return { ok: false, error: "La reunión no tiene minuta." };
  const md = minutaAMarkdown(reunion);
  const nombre = nombreDeArchivo(reunion.meta.titulo);
  try {
    const r = await fetch("/reunion/correo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        minuta: reunion.minuta,
        trazabilidad: reunion.trazabilidad,
        meta: { titulo: reunion.meta.titulo, fecha: new Date(reunion.meta.inicio).toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" }) },
        adjuntos: [...adjuntosExtra, { nombre: `${nombre}-minuta.md`, contenido: md }]
      })
    });
    return await r.json().catch(() => ({ ok: false, error: `El servidor respondió ${r.status}` }));
  } catch {
    return { ok: false, error: "Se perdió la conexión con el servidor." };
  }
}

export const nombreDeArchivo = titulo => normalizar(titulo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "reunion";

// Markdown del acta: el formato que se pega sin pérdida en Google Docs (Pegar
// desde Markdown), Notion u Obsidian. Sigue las secciones de la minuta lean;
// flujos y diagramas van como bloques mermaid.
export function minutaAMarkdown(reunion) {
  const m = reunion.minuta;
  if (!m) return "";
  const op = m.onePager;
  const li = items => (items || []).filter(Boolean).map(i => `- ${i}`).join("\n");
  const tabla = (cab, filas) => filas.length
    ? `| ${cab.join(" | ")} |\n| ${cab.map(() => "---").join(" | ")} |\n` + filas.map(f => `| ${f.map(c => String(c || "—").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`).join("\n")
    : "";
  const fecha = new Date(reunion.meta.inicio).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" });
  const min = Math.round(duracion(reunion) / 60000);
  const t = reunion.trazabilidad || {};
  const q = calidad(reunion);
  const onePager = [
    `# ${m.titulo || reunion.meta.titulo}`,
    `*Acta · minuta lean · ${fecha} · ${min} min · Nivel N2 (pendiente de validación)*`,
    "",
    "## One pager",
    op.estado ? `**Estado:** ${op.estado}` : "",
    `> ${op.mensajeClave}`,
    op.contexto,
    op.indicadores.length ? "**Indicadores**\n" + li(op.indicadores.map(i => `${i.etiqueta}: **${i.valor}**`)) : "",
    op.decisiones.length ? "**Decisiones**\n" + li(op.decisiones) : "",
    op.acciones.length ? "**Acciones**\n\n" + tabla(["Acción", "Responsable", "Plazo"], op.acciones.map(a => [a.accion, a.responsable, a.plazo])) : "",
    op.riesgos.length ? "**Riesgos**\n" + li(op.riesgos) : "",
    op.proximosPasos.length ? "**Próximos pasos**\n" + li(op.proximosPasos) : ""
  ];
  if (m.formato !== "lean-1") {
    return [...onePager, "", "_Acta generada con el formato anterior: vuelve a generarla para obtener el formato de minuta lean._"]
      .filter(p => p !== "" && p != null).join("\n\n");
  }

  // Flujo por carriles como diagrama Mermaid: cada carril es un subgrafo y
  // los pasos se encadenan en orden de fase. Así el flujo sobrevive al pegar
  // en herramientas que dibujan Mermaid.
  const flujoMermaid = (flujo, prefijo) => {
    if (!flujo.pasos.length) return "";
    const id = (i) => `${prefijo}${i}`;
    const pasos = flujo.pasos.map((p, i) => ({ ...p, i }));
    const lineas = ["flowchart LR"];
    for (const carril of flujo.carriles) {
      const propios = pasos.filter(p => p.carril === carril);
      if (!propios.length) continue;
      lineas.push(`  subgraph ${prefijo}${flujo.carriles.indexOf(carril)}c["${carril.replace(/"/g, "'")}"]`);
      for (const p of propios) lineas.push(`    ${id(p.i)}["${(p.marca ? `(${p.marca}) ` : "") + p.titulo.replace(/"/g, "'")}"]`);
      lineas.push("  end");
      const ordenados = propios.sort((a, b) => flujo.fases.indexOf(a.fase) - flujo.fases.indexOf(b.fase));
      for (let k = 1; k < ordenados.length; k += 1) lineas.push(`  ${id(ordenados[k - 1].i)} --> ${id(ordenados[k].i)}`);
    }
    return "```mermaid\n" + lineas.join("\n") + "\n```";
  };
  const ishikawaMd = m.causaRaiz.familias.length
    ? `**Efecto observado:** ${m.causaRaiz.efecto}\n\n` + tabla(["Familia", "Causas"], m.causaRaiz.familias.map(f => [f.nombre, f.causas.join("; ")]))
    : "";
  const referencias = [];
  for (const e of reunion.evidencia || []) for (const r of e.refs || []) if (!referencias.some(x => x.enlace === r.enlace)) referencias.push(r);
  const num = r => referencias.findIndex(x => x.enlace === r.enlace) + 1;

  const partes = [
    ...onePager,
    "",
    "---",
    "",
    `# Acta · ${m.titulo || reunion.meta.titulo}`,
    m.lede ? `*${m.lede}*` : "",
    tabla(["Reunión", "Área", "Participantes", "Hito siguiente"], [[`${fecha} · ${min} min · "${reunion.meta.titulo}"`, m.area, reunion.meta.participantes || "No declarados", m.hitoSiguiente || "Por definir"]]),
    "## 00 · Cómo leer este documento",
    `**Pregunta de trabajo.** ${m.comoLeer.preguntaTrabajo}`,
    m.comoLeer.fuentesPrimarias ? `**Fuentes primarias:** ${m.comoLeer.fuentesPrimarias}` : "",
    m.comoLeer.fuentesSecundarias ? `**Fuentes secundarias:** ${m.comoLeer.fuentesSecundarias}` : "",
    tabla(["Nivel", "Qué significa"], [
      ["N1", "Registro de lo dicho, ordenamiento de flujos y diagramas. Ejecutado."],
      ["N2", "Causas, flujo futuro, indicadores y opciones. Listos para discusión; requieren validación."],
      ["N3", "Decisiones que exceden al equipo. No se deciden aquí; se escalan."]
    ]),
    m.comoLeer.convenciones ? `> ${m.comoLeer.convenciones}` : "",
    "## 01 · Minuta lean (A3)",
    "### 1 · Antecedentes\n" + li(m.a3.antecedentes),
    "### 2 · Situación actual\n" + li(m.a3.situacionActual),
    "### 3 · Objetivo / condición meta\n" + li(m.a3.condicionMeta),
    "### 4 · Análisis de causas\n" + li(m.a3.analisisCausas),
    "### 5 · Contramedidas en discusión (N2)\n" + li(m.a3.contramedidas),
    m.a3.plan.length ? "### 6 · Plan y seguimiento\n" + tabla(["Acción", "Responsable", "Cuándo"], m.a3.plan.map(p => [p.accion, p.responsable, p.cuando])) : "",
    m.a3.muda.length ? "### 7 · Desperdicios (muda) identificados\n" + tabla(["Tipo de muda", "Dónde aparece", "Punto de dolor"], m.a3.muda.map(x => [x.tipo, x.donde, x.puntoDolor])) : "",
    m.inconsistencias.length ? "**Inconsistencias detectadas (confirmar por escrito)**\n\n" + m.inconsistencias.map((x, i) => `${i + 1}. **${x.tema}:** ${x.detalle}`).join("\n") : "",
    m.flujoActual.pasos.length ? "## 02 · Flujo actual (AS-IS) y puntos de dolor\n\n" + flujoMermaid(m.flujoActual, "a") + "\n\n" + m.flujoActual.puntosDolor.map(p => `${p.numero}. **${p.titulo}.** ${p.cita ? `"${p.cita}"` : ""}`).join("\n") : "",
    ishikawaMd ? "## 02 · Causa raíz\n\n" + ishikawaMd : "",
    (m.flujoFuturo.pasos.length || m.flujoFuturo.comparacion.length) ? "## 02 · Flujo futuro hipotético (TO-BE) · N2\n\n" + flujoMermaid(m.flujoFuturo, "b") + "\n\n"
      + m.flujoFuturo.cambios.map(c => `- **${c.marcas} · ${c.titulo}.** ${c.texto}`).join("\n") + "\n\n"
      + tabla(["Actividad", "Hoy (AS-IS)", "Hipótesis (TO-BE)"], m.flujoFuturo.comparacion.map(c => [c.actividad, c.hoy, c.propuesta])) : "",
    m.diagramas.length ? m.diagramas.map(d => `**${d.titulo}** — ${d.proposito}\n\n\`\`\`mermaid\n${d.mermaid}\n\`\`\``).join("\n\n") : "",
    m.graficos.length ? m.graficos.map(g => `**${g.titulo}** (${g.unidad}; fuente ${g.fuente})\n\n` + tabla(["Serie", "Valor"], g.series.map(s => [s.etiqueta, s.valor]))).join("\n\n") : "",
    (m.actores.length || m.senales.length) ? "## 03 · Lectura de actores y señales" : "",
    m.actores.length ? tabla(["Actor", "Rol en el flujo", "Implicancia"], m.actores.map(a => [a.actor, a.rol, a.implicancia])) : "",
    m.senales.map(s => `> "${s.cita}"${s.fuente ? ` — ${s.fuente}` : ""}`).join("\n>\n"),
    m.restricciones.length ? "**Restricciones para el diseño**\n" + li(m.restricciones) : "",
    (m.preguntasEvidencia.length || m.referenciasMencionadas.length) ? "## 04 · Evidencia y literatura" : "",
    m.preguntasEvidencia.length ? tabla(["Pregunta", "Referencias encontradas", "Aplicabilidad", "Certeza"], m.preguntasEvidencia.map(p => {
      const e = (reunion.evidencia || []).find(x => x.pregunta === p.pregunta);
      const refs = e?.refs?.length ? e.refs.map(r => `${r.titulo} [${num(r)}]`).join("; ") : (e ? e.error || "Sin resultados" : "Búsqueda pendiente");
      return [p.pregunta, refs, p.aplicabilidad, "Por evaluar"];
    })) : "",
    m.preguntasEvidencia.length ? "_Referencias obtenidas por búsqueda automática en bases bibliográficas, sin lectura crítica: certeza por evaluar._" : "",
    m.referenciasMencionadas.length ? "**Referencias mencionadas en la reunión (no verificadas)**\n" + li(m.referenciasMencionadas.map(r => `${r.tipo ? `[${r.tipo}] ` : ""}${r.descripcion}${r.url ? ` — ${r.url}` : ""}${r.marca ? ` [${r.marca}]` : ""}`)) : "",
    (m.beneficios.length || m.riesgos.length) ? "## 05 · Beneficios, riesgos e indicadores" : "",
    m.beneficios.length ? "**Beneficios esperados (hipótesis, no compromiso)**\n\n" + tabla(["Dimensión", "Beneficio esperado", "Indicador propuesto"], m.beneficios.map(b => [b.dimension, b.beneficio, b.indicador])) : "",
    m.notaMagnitud ? `> ${m.notaMagnitud}` : "",
    m.riesgos.length ? "**Matriz de riesgos**\n\n" + tabla(["Riesgo", "Prob.", "Impacto", "Mitigación"], m.riesgos.map(r => [r.riesgo, r.probabilidad, r.impacto, r.mitigacion])) : "",
    m.riesgoN3 ? `> **N3** ${m.riesgoN3}` : "",
    m.soluciones.length ? "## 06 · Espacio de soluciones\n\n" + tabla(["Nivel", "Opción", "Origen", "Dependencias"], m.soluciones.map(s => [s.nivel, s.opcion, s.origen, s.dependencias])) : "",
    (m.proximaReunion.estructura.length || m.proximaReunion.preguntas.length) ? "## 07 · Preparación de la próxima reunión" : "",
    m.proximaReunion.estructura.length ? "**Estructura sugerida**\n" + m.proximaReunion.estructura.map((e, i) => `${i + 1}. ${e.punto}${e.minutos ? ` (${e.minutos} min)` : ""}`).join("\n") : "",
    m.proximaReunion.datosASolicitar.length ? "**Datos a solicitar**\n" + li(m.proximaReunion.datosASolicitar) : "",
    m.proximaReunion.preguntas.length ? "**Preguntas que conviene hacer**\n" + li(m.proximaReunion.preguntas) : "",
    m.proximaReunion.erroresAEvitar.length ? "**Errores a evitar**\n" + li(m.proximaReunion.erroresAEvitar) : "",
    "## 08 · Trazabilidad",
    li([
      `Transcripción ${q.fuente}: cobertura estimada ${q.cobertura}%, ${q.palabras} palabras${q.huecos ? `, ${q.huecos} tramo(s) sin audio` : ""}.`,
      t.modelo && `Acta redactada con ${t.proveedor}/${t.modelo} (nivel ${t.nivel}) el ${new Date(t.generadaEn).toLocaleString("es-CL")}.`,
      "Revisión humana pendiente antes de difundir."
    ]),
    m.trazabilidad.supuestos.length ? "**Supuestos**\n" + li(m.trazabilidad.supuestos) : "",
    m.trazabilidad.limites ? `**Límites.** ${m.trazabilidad.limites}` : "",
    referencias.length ? "**Referencias**\n" + referencias.map((r, i) => `${i + 1}. ${r.autores ? r.autores.replace(/\.+$/, "") + ". " : ""}${r.titulo}. ${r.revista ? `*${r.revista}*. ` : ""}${r.anio || ""}. ${r.enlace || ""}`).join("\n") : "",
    reunion.meta.enlaces ? "**Aportadas por el organizador**\n" + li(reunion.meta.enlaces.split(/\n+/)) : "",
    reunion.materiales?.length ? "**Material mostrado por Catalina**\n" + li([...new Set(reunion.materiales)]) : "",
    m.trazabilidad.notaDeUso ? `_Nota de uso: ${m.trazabilidad.notaDeUso}_` : ""
  ];
  return partes.filter(p => p !== "" && p != null).join("\n\n").replace(/\n{3,}/g, "\n\n");
}
