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

// Markdown: el formato que se pega sin pérdida en Google Docs (Pegar desde
// Markdown), Notion u Obsidian. Los diagramas van como bloques mermaid.
export function minutaAMarkdown(reunion) {
  const m = reunion.minuta;
  if (!m) return "";
  const op = m.onePager, ex = m.extensa;
  const li = items => items.filter(Boolean).map(i => `- ${i}`).join("\n");
  const tabla = (cab, filas) => filas.length
    ? `| ${cab.join(" | ")} |\n| ${cab.map(() => "---").join(" | ")} |\n` + filas.map(f => `| ${f.map(c => String(c || "—").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`).join("\n")
    : "";
  const fecha = new Date(reunion.meta.inicio).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" });
  const t = reunion.trazabilidad || {};
  const partes = [
    `# ${reunion.meta.titulo}`,
    `*${fecha} · ${Math.round(duracion(reunion) / 60000)} min · ${m.tipoDeReunion || "Reunión"}*`,
    "",
    "## One pager",
    op.estado ? `**Estado:** ${op.estado}` : "",
    `> ${op.mensajeClave}`,
    "",
    op.contexto,
    op.indicadores.length ? "\n**Indicadores**\n" + li(op.indicadores.map(i => `${i.etiqueta}: **${i.valor}**`)) : "",
    op.decisiones.length ? "\n**Decisiones**\n" + li(op.decisiones) : "",
    op.acciones.length ? "\n**Acciones**\n\n" + tabla(["Acción", "Responsable", "Plazo"], op.acciones.map(a => [a.accion, a.responsable, a.plazo])) : "",
    op.riesgos.length ? "\n**Riesgos**\n" + li(op.riesgos) : "",
    op.proximosPasos.length ? "\n**Próximos pasos**\n" + li(op.proximosPasos) : "",
    "",
    "---",
    "",
    "## Minuta extensa",
    "### Información de la reunión",
    li([
      `Fecha: ${fecha}`,
      reunion.meta.lugar && `Lugar/plataforma: ${reunion.meta.lugar}`,
      reunion.meta.participantes && `Participantes declarados: ${reunion.meta.participantes}`,
      reunion.meta.objetivo && `Objetivo: ${reunion.meta.objetivo}`
    ]),
    reunion.meta.agenda ? `\n**Agenda**\n\n${reunion.meta.agenda}` : "",
    "### Resumen ejecutivo",
    ex.resumenEjecutivo,
    ex.contexto ? `### Contexto\n${ex.contexto}` : "",
    ex.participantes.length ? "### Participantes\n" + tabla(["Nombre", "Rol", "Aportes"], ex.participantes.map(p => [p.nombre, p.rol, p.aportes])) : "",
    "### Desarrollo por tema",
    ...ex.temas.map((tema, i) => [
      `#### ${i + 1}. ${tema.titulo}${tema.marcaInicio ? ` · [${tema.marcaInicio}]` : ""}`,
      tema.desarrollo,
      tema.puntosClave.length ? "\n**Puntos clave**\n" + li(tema.puntosClave) : "",
      tema.posiciones.length ? "\n**Posiciones**\n" + li(tema.posiciones.map(p => `**${p.quien}:** ${p.postura}`)) : "",
      tema.datos.length ? "\n**Datos**\n" + li(tema.datos) : "",
      tema.citas.length ? "\n" + tema.citas.map(c => `> «${c.texto}» — ${c.hablante || "No identificado"}${c.marca ? ` [${c.marca}]` : ""}`).join("\n>\n") : "",
      tema.conclusion ? `\n**Conclusión:** ${tema.conclusion}` : ""
    ].filter(Boolean).join("\n")),
    ex.decisiones.length ? "### Decisiones\n" + tabla(["Decisión", "Fundamento", "Responsable", "Evidencia"], ex.decisiones.map(d => [d.decision, d.fundamento, d.responsable, d.evidencia])) : "",
    ex.acciones.length ? "### Plan de acción\n" + tabla(["Acción", "Responsable", "Plazo", "Prioridad", "Evidencia"], ex.acciones.map(a => [a.accion, a.responsable, a.plazo, a.prioridad, a.evidencia])) : "",
    ex.riesgos.length ? "### Riesgos\n" + tabla(["Riesgo", "Probabilidad", "Impacto", "Mitigación"], ex.riesgos.map(r => [r.riesgo, r.probabilidad, r.impacto, r.mitigacion])) : "",
    ex.preguntasAbiertas.length ? "### Preguntas abiertas\n" + li(ex.preguntasAbiertas) : "",
    ex.desacuerdos.length ? "### Desacuerdos\n" + li(ex.desacuerdos) : "",
    ex.supuestos.length ? "### Supuestos\n" + li(ex.supuestos) : "",
    ex.datosCuantitativos.length ? "### Datos cuantitativos\n" + tabla(["Indicador", "Valor", "Unidad", "Contexto", "Marca"], ex.datosCuantitativos.map(d => [d.indicador, d.valor, d.unidad, d.contexto, d.marca])) : "",
    ex.diagramas.length ? "### Diagramas\n" + ex.diagramas.map(d => `**${d.titulo}** — ${d.proposito}\n\n\`\`\`mermaid\n${d.mermaid}\n\`\`\``).join("\n\n") : "",
    ex.graficos.length ? "### Gráficos (datos)\n" + ex.graficos.map(g => `**${g.titulo}** (${g.unidad}; fuente ${g.fuente})\n\n` + tabla(["Serie", "Valor"], g.series.map(s => [s.etiqueta, s.valor]))).join("\n\n") : "",
    (ex.referenciasMencionadas.length || reunion.meta.enlaces || reunion.materiales?.length) ? "### Referencias" : "",
    reunion.meta.enlaces ? "**Aportadas por el organizador**\n" + li(reunion.meta.enlaces.split(/\n+/)) : "",
    ex.referenciasMencionadas.length ? "\n**Mencionadas en la reunión (no verificadas)**\n" + li(ex.referenciasMencionadas.map(r => `${r.tipo ? `[${r.tipo}] ` : ""}${r.descripcion}${r.url ? ` — ${r.url}` : ""}${r.marca ? ` [${r.marca}]` : ""}`)) : "",
    reunion.materiales?.length ? "\n**Material mostrado por Catalina**\n" + li([...new Set(reunion.materiales)]) : "",
    ex.glosario.length ? "### Glosario\n" + li(ex.glosario.map(g => `**${g.termino}:** ${g.definicion}`)) : "",
    "### Limitaciones y trazabilidad",
    ex.limitaciones,
    li([
      `Transcripción: ${calidad(reunion).fuente}, cobertura estimada ${calidad(reunion).cobertura}%, ${calidad(reunion).palabras} palabras.`,
      t.modelo && `Redactada con ${t.proveedor}/${t.modelo} (nivel ${t.nivel}) el ${new Date(t.generadaEn).toLocaleString("es-CL")}.`,
      "Minuta generada automáticamente a partir de una transcripción automática. Requiere revisión humana antes de difundirse."
    ])
  ];
  return partes.filter(p => p !== "" && p != null).join("\n\n").replace(/\n{3,}/g, "\n\n");
}
