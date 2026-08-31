// Cierre de una reunión: los dos documentos, el guardado y el correo propuesto.
//
// Este módulo es el que junta las piezas —redacción, composición, Drive— y el
// único que sabe cómo se llama cada archivo y qué lleva dentro. app.mjs sólo
// expone la ruta.
//
// La regla que ordena todo lo de abajo: lo que se dijo, lo que traían los
// documentos y lo que el usuario apuntó en su cuaderno son tres cosas distintas
// y se mantienen distinguibles hasta el papel. La minuta interpreta y funde las
// notas en su redacción; la transcripción no interpreta nada y conserva las
// notas aparte, al final, porque el Word es el registro.

import { construirDocx, construirPdf, bloque as b } from "./documentos.mjs";
import { revisarTranscripcion, corregirCuaderno, redactarMinuta, minutaSinModelo, hayRedaccion } from "./redaccion.mjs";
import { guardarEnDrive, driveConfigurado } from "./drive.mjs";
import { tipoDeReunion } from "./public/tipos-de-reunion.js";

const TIPO_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TIPO_PDF = "application/pdf";

// ── Nombres y fechas ─────────────────────────────────────────────────────────

const fechaCorta = momento => {
  const d = new Date(momento || Date.now());
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};

const fechaLarga = momento => new Date(momento || Date.now())
  .toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function duracion(inicio, fin) {
  const minutos = Math.max(1, Math.round(((fin || Date.now()) - (inicio || Date.now())) / 60000));
  if (minutos < 60) return `${minutos} minuto${minutos === 1 ? "" : "s"}`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} hora${horas === 1 ? "" : "s"}`;
}

// Los nombres de archivo se limpian de todo lo que un sistema de archivos o una
// URL puedan tomarse a mal, tildes incluidas: un archivo llamado «Minuta_Comité»
// se descarga con el nombre roto en más de un navegador.
const parteDeNombre = texto => String(texto || "Reunion")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60) || "Reunion";

export function nombresDeArchivo(reunion, minuta) {
  const fecha = fechaCorta(reunion.inicio);
  const nombre = parteDeNombre(reunion.titulo || minuta?.titulo);
  return {
    transcripcion: `Transcripcion_${fecha}_${nombre}.docx`,
    minuta: `Minuta_${fecha}_${nombre}.pdf`
  };
}

// ── Composición de los documentos ────────────────────────────────────────────

function portada(reunion, minuta, titulo) {
  const participantes = (minuta.participantes?.length ? minuta.participantes : reunion.participantes) ?? [];
  return [
    b.titulo(titulo),
    b.subtitulo([
      fechaLarga(reunion.inicio),
      duracion(reunion.inicio, reunion.fin),
      participantes.length ? `${participantes.length} participante${participantes.length === 1 ? "" : "s"}` : ""
    ].filter(Boolean).join(" · ")),
    b.dato("Participantes", participantes.length ? participantes.join(", ") : "No se identificaron"),
    b.dato("Objetivo", minuta.objetivo || reunion.objetivo || "No se declaró un objetivo")
  ];
}

// La transcripción revisada. Lleva su propia advertencia porque quien la lea
// tiene que saber qué está leyendo: una captura automática corregida en la
// forma, no una grabación.
export function componerTranscripcion(reunion, revision, minuta, cuaderno = { texto: "", corregido: false }) {
  const bloques = [
    ...portada(reunion, minuta, `Transcripción — ${minuta.titulo || reunion.titulo || "Reunión"}`),
    b.separador(),
    b.parrafo(revision.revisada
      ? "Transcripción capturada automáticamente durante la reunión y corregida en ortografía, gramática y "
        + "puntuación. El sentido de lo dicho no se alteró. Los fragmentos que no se entendieron aparecen como [inaudible]."
      : "Transcripción capturada automáticamente durante la reunión, sin corregir"
        + (revision.motivo ? ` (${revision.motivo})` : "") + ". Puede contener errores de reconocimiento de voz."),
    b.seccion("Lo que se dijo")
  ];

  const cuerpo = String(revision.texto || "").trim();
  if (!cuerpo) {
    bloques.push(b.parrafo("No se capturó ninguna intervención."));
  } else {
    for (const parrafo of cuerpo.split(/\n{2,}/)) {
      const limpio = parrafo.trim();
      if (limpio) bloques.push(b.parrafo(limpio));
    }
  }

  // Los documentos y las notas van al final y rotulados: son parte del material
  // de la reunión, pero no son cosas que alguien dijera.
  const documentos = reunion.documentos ?? [];
  if (documentos.length) {
    bloques.push(b.seccion("Documentos aportados"));
    for (const d of documentos) {
      bloques.push(b.vineta(`${d.nombre}${d.descripcion ? ` — ${d.descripcion}` : ""}`
        + (d.texto ? "" : " (no se pudo extraer su texto)")));
    }
  }

  // Las notas personales van aquí y sólo aquí. En la minuta se integran en la
  // redacción y desaparecen como notas; el Word es el registro, así que en él se
  // conservan aparte y con su rótulo, para que se vea qué escribió la persona y
  // qué se dijo en la sala.
  const cuadernoTexto = String(cuaderno.texto || "").trim();
  if (cuadernoTexto) {
    bloques.push(b.seccion("Notas personales del usuario"));
    bloques.push(b.parrafo("Apuntes tomados durante la reunión"
      + (cuaderno.corregido ? ", corregidos en ortografía y redacción sin alterar su significado" : "")
      + ". No son parte de lo que se habló ni fueron dichos por ningún participante."));
    for (const linea of cuadernoTexto.split("\n")) {
      const limpia = linea.trim();
      if (limpia) bloques.push(b.vineta(limpia));
    }
  }

  return bloques;
}

// La minuta ejecutiva. Las secciones vacías no se imprimen: una minuta con seis
// epígrafes que dicen «ninguno» se lee peor y da la impresión de que faltó algo.
// Cómo se pinta cada sección de la minuta. El TIPO de reunión decide cuáles
// aparecen y en qué orden (tipos-de-reunion.js); esto sólo sabe dibujarlas.
// Las vacías no se imprimen: una minuta con ocho epígrafes que dicen «ninguno»
// se lee peor y hace pensar que faltó algo.
const SECCIONES = {
  resumen: (b, m) => m.resumen ? [b.seccion("Resumen ejecutivo"), b.parrafo(m.resumen)] : [],
  temas: (b, m) => m.temas?.length
    ? [b.seccion("Temas tratados"), ...m.temas.flatMap(t => [
      t.titulo ? b.parrafo(t.titulo) : null, t.detalle ? b.vineta(t.detalle) : null].filter(Boolean))]
    : [],
  conceptos: (b, m) => lista(b, "Conceptos", m.conceptos),
  datos: (b, m) => lista(b, "Datos y cifras", m.datos),
  referencias: (b, m) => lista(b, "Referencias mencionadas", m.referencias),
  conclusiones: (b, m) => lista(b, "Conclusiones", m.conclusiones),
  preguntas: (b, m) => lista(b, "Preguntas", m.preguntas),
  antecedentes: (b, m) => lista(b, "Antecedentes", m.antecedentes),
  problemas: (b, m) => lista(b, "Problemas identificados", m.problemas),
  bloqueos: (b, m) => lista(b, "Bloqueos", m.bloqueos),
  decision_central: (b, m) => m.decision_central
    ? [b.seccion("La decisión"), b.parrafo(m.decision_central)] : [],
  posiciones: (b, m) => lista(b, "Posiciones de los participantes", m.posiciones),
  alternativas: (b, m) => lista(b, "Alternativas evaluadas", m.alternativas),
  riesgos: (b, m) => lista(b, "Riesgos", m.riesgos),
  problema: (b, m) => m.problema ? [b.seccion("Problema"), b.parrafo(m.problema)] : [],
  estado_actual: (b, m) => m.estado_actual ? [b.seccion("Estado actual"), b.parrafo(m.estado_actual)] : [],
  desperdicios: (b, m) => lista(b, "Desperdicios e ineficiencias", m.desperdicios),
  causas: (b, m) => lista(b, "Causas", m.causas),
  actores: (b, m) => lista(b, "Actores del proceso", m.actores),
  oportunidades: (b, m) => lista(b, "Oportunidades de mejora", m.oportunidades),
  contramedidas: (b, m) => m.contramedidas?.length
    ? [b.seccion("Contramedidas"),
      b.tabla(["Problema", "Causa", "Contramedida", "Responsable", "Fecha", "Indicador"],
        m.contramedidas.map(c => [c.problema, c.causa, c.contramedida, c.responsable, c.fecha, c.indicador]))]
    : [],
  ideas: (b, m) => lista(b, "Ideas", m.ideas),
  hipotesis: (b, m) => lista(b, "Hipótesis y supuestos", m.hipotesis),
  oportunidades_creativas: (b, m) => lista(b, "Oportunidades y asociaciones", m.oportunidades_creativas),
  divergencias: (b, m) => lista(b, "Divergencias", m.divergencias),
  descartadas: (b, m) => lista(b, "Ideas descartadas", m.descartadas),
  experimentos: (b, m) => lista(b, "Próximos experimentos", m.experimentos),
  decisiones: (b, m) => lista(b, "Decisiones", m.decisiones),
  acuerdos: (b, m) => lista(b, "Acuerdos", m.acuerdos),
  desacuerdos: (b, m) => lista(b, "Desacuerdos", m.desacuerdos),
  acciones: (b, m) => m.acciones?.length
    ? [b.seccion("Acciones comprometidas"),
      b.tabla(["Acción", "Responsable", "Fecha", "Estado"],
        m.acciones.map(a => [a.accion, a.responsable, a.fecha, a.estado]))]
    : [],
  pendientes: (b, m) => lista(b, "Puntos pendientes", m.pendientes),
  proximos_pasos: (b, m) => lista(b, "Próximos pasos", m.proximos_pasos)
};

const lista = (b, titulo, items) => items?.length
  ? [b.seccion(titulo), ...items.map(i => b.vineta(i))]
  : [];

export function componerMinuta(reunion, minuta) {
  const tipo = tipoDeReunion(reunion.tipo);
  const bloques = portada(reunion, minuta, minuta.titulo || reunion.titulo || "Minuta de reunión");
  bloques.push(b.dato("Tipo de reunión", tipo.nombre));
  if (reunion.antecedente?.titulo) {
    bloques.push(b.dato("Da seguimiento a", `${reunion.antecedente.titulo}`
      + (reunion.antecedente.fecha ? ` (${fechaCorta(reunion.antecedente.fecha)})` : "")));
  }
  bloques.push(b.separador());

  if (minuta.sinModelo) {
    bloques.push(b.parrafo("Aviso: no se pudo redactar la minuta automáticamente. Abajo queda el material de la "
      + "reunión ordenado por procedencia, sin interpretar."));
  }

  // Primero las secciones que este tipo pide, en su orden. Después, cualquier
  // otra que traiga contenido: si en una clase alguien acabó comprometiéndose a
  // algo, esa acción no se pierde por no estar en el guion del tipo.
  const puestas = new Set();
  for (const nombre of tipo.secciones) {
    puestas.add(nombre);
    bloques.push(...(SECCIONES[nombre]?.(b, minuta) ?? []));
  }
  for (const [nombre, pintar] of Object.entries(SECCIONES)) {
    if (puestas.has(nombre)) continue;
    bloques.push(...pintar(b, minuta));
  }

  if (minuta.crudo?.length) {
    bloques.push(b.seccion("Material sin interpretar"));
    minuta.crudo.forEach(linea => bloques.push(b.parrafo(linea)));
  }

  const documentos = reunion.documentos ?? [];
  if (documentos.length) {
    bloques.push(b.seccion("Documentos considerados"));
    documentos.forEach(d => bloques.push(b.vineta(`${d.nombre}${d.descripcion ? ` — ${d.descripcion}` : ""}`)));
  }

  bloques.push(b.separador());
  bloques.push(b.dato("Preparada por", "Catalina, asistente ejecutiva del Dr. Inti Paredes"));
  bloques.push(b.dato("Fuente", "Transcripción automática de la reunión"
    + (documentos.length ? `, ${documentos.length} documento${documentos.length === 1 ? "" : "s"} aportado${documentos.length === 1 ? "" : "s"}` : "")
    + (String(reunion.cuaderno ?? "").trim() ? " y las notas tomadas durante la sesión" : "")));

  return bloques;
}

// ── Correo propuesto ─────────────────────────────────────────────────────────

// Se propone, no se manda. Quien decide es la persona, y por eso esto devuelve
// un borrador con todo a la vista: destinatario, asunto, cuerpo y adjuntos.
export function correoPropuesto(reunion, minuta, nombres) {
  const titulo = minuta.titulo || reunion.titulo || "Reunión";
  const acciones = (minuta.acciones ?? []).slice(0, 6);
  const cuerpo = [
    `Adjunto la minuta y la transcripción de la reunión «${titulo}» del ${fechaLarga(reunion.inicio)}.`,
    "",
    minuta.resumen || "",
    acciones.length ? "" : null,
    acciones.length ? "Acciones comprometidas:" : null,
    ...acciones.map(a => `· ${a.accion} — ${a.responsable} (${a.fecha})`),
    "",
    "Preparada por Catalina, asistente ejecutiva del Dr. Inti Paredes."
  ].filter(linea => linea !== null).join("\n");

  return {
    destinatario: reunion.destinatario || "",
    asunto: `Minuta — ${titulo} (${fechaCorta(reunion.inicio)})`,
    cuerpo,
    adjuntos: [nombres.transcripcion, nombres.minuta]
  };
}

// ── Cierre completo ──────────────────────────────────────────────────────────

// ── Integridad ───────────────────────────────────────────────────────────────
//
// Antes de decir que una reunión se procesó bien hay que comprobarlo. El fallo
// que motiva esto no fue de redacción: la transcripción no llegó a los
// documentos y el cierre lo dio por bueno igual. Una minuta bonita sobre una
// transcripción vacía es peor que un error, porque nadie se entera hasta que
// necesita el registro y ya no está.
//
// `critico` marca lo que invalida el cierre. Lo demás se informa y ya.
function revisarIntegridad({ reunion, revision, cuaderno, docx, pdf, minuta }) {
  const turnos = (reunion.turnos ?? []).length;
  const textoRevisado = String(revision.texto || "").trim();
  const documentos = (reunion.documentos ?? []).length;
  const cuadernoTexto = String(cuaderno.texto || "").trim();
  const cuadernoOriginal = String(reunion.cuaderno || "").trim();

  const comprobaciones = [
    {
      nombre: "Transcripción capturada",
      critico: true,
      ok: turnos > 0,
      detalle: turnos ? `${turnos} intervenciones` : "No se capturó ni una sola frase de la reunión"
    },
    {
      nombre: "Transcripción en el documento",
      critico: true,
      // No basta con que hubiera turnos: hay que comprobar que el texto llegó.
      ok: turnos === 0 || textoRevisado.length > 0,
      detalle: textoRevisado
        ? `${textoRevisado.length} caracteres`
        : (turnos === 0 ? "No había nada que escribir" : "La transcripción se perdió al redactarla")
    },
    {
      nombre: "Notas preservadas",
      critico: true,
      // Si había cuaderno tiene que seguir habiéndolo después de corregirlo.
      ok: !cuadernoOriginal || Boolean(cuadernoTexto),
      detalle: cuadernoOriginal ? `${cuadernoTexto.split("\n").filter(Boolean).length} notas` : "No había notas"
    },
    {
      nombre: "Documentos asociados",
      critico: false,
      ok: true,
      detalle: documentos ? `${documentos} documento${documentos === 1 ? "" : "s"}` : "Ninguno"
    },
    {
      nombre: "Word generado",
      critico: true,
      // El Word tiene que contener la transcripción, no sólo existir: es
      // exactamente el fallo que se está vigilando.
      ok: docx.length > 1000 && (turnos === 0 || docx.includes(Buffer.from("Lo que se dijo", "utf8")) || textoRevisado.length > 0),
      detalle: `${Math.round(docx.length / 1024)} KB`
    },
    { nombre: "PDF generado", critico: true, ok: pdf.length > 500, detalle: `${Math.round(pdf.length / 1024)} KB` },
    {
      nombre: "Minuta redactada",
      critico: false,
      ok: !minuta.sinModelo,
      detalle: minuta.sinModelo ? "Sin redacción asistida" : "Con resumen ejecutivo"
    }
  ];

  const fallos = comprobaciones.filter(c => !c.ok);
  return {
    ok: fallos.every(c => !c.critico),
    comprobaciones,
    fallosCriticos: fallos.filter(c => c.critico).map(c => `${c.nombre}: ${c.detalle}`)
  };
}

export async function cerrarReunion(reunion) {
  // Las tres peticiones al modelo son independientes: van a la vez para no
  // sumar sus esperas, que en una reunión larga son decenas de segundos.
  const [revision, cuaderno, redactada] = await Promise.all([
    revisarTranscripcion(reunion),
    corregirCuaderno(reunion),
    redactarMinuta(reunion)
  ]);

  const minuta = redactada.ok ? redactada.minuta : minutaSinModelo(reunion);
  const nombres = nombresDeArchivo(reunion, minuta);

  const docx = construirDocx(componerTranscripcion(reunion, revision, minuta, cuaderno));
  const pdf = construirPdf(componerMinuta(reunion, minuta), { titulo: minuta.titulo || "Minuta" });

  // La carpeta puede venir elegida desde la pantalla de puesta a punto. Se
  // prefiere ésa a la de las variables de entorno: cambiarla no debería exigir
  // volver a desplegar.
  // El permiso de la cuenta lo trae el navegador de quien la conectó; si no,
  // se usa el del despliegue.
  const drive = driveConfigurado(reunion.driveRefresco)
    ? await guardarEnDrive([
      { nombre: nombres.transcripcion, tipo: TIPO_DOCX, contenido: docx },
      { nombre: nombres.minuta, tipo: TIPO_PDF, contenido: pdf }
    ], reunion.carpetaDrive, reunion.driveRefresco)
    : { ok: false, code: "SIN_CUENTA", error: "No hay ninguna cuenta de Google Drive conectada.", archivos: [] };

  const integridad = revisarIntegridad({ reunion, revision, cuaderno, docx, pdf, minuta });

  return {
    // `ok` deja de significar «no reventó» y pasa a significar «la reunión está
    // completa». Si falta la transcripción, esto es false y quien llama no
    // puede anunciar que salió bien.
    ok: integridad.ok,
    integridad,
    minuta,
    // Se dice sin adornos qué no salió como debía: sin esto, una minuta de
    // respaldo pasa por una minuta redactada y nadie se entera.
    avisos: [
      ...integridad.fallosCriticos.map(f => `FALTA: ${f}`),
      redactada.ok ? "" : `La minuta va sin redacción asistida: ${redactada.error}`,
      revision.revisada ? "" : (revision.motivo ? `La transcripción va sin corregir: ${revision.motivo}` : ""),
      cuaderno.motivo ? `Las notas van sin corregir: ${cuaderno.motivo}` : "",
      drive.ok ? "" : (drive.code === "SIN_CONFIGURAR" ? "" : `No se pudo guardar en Drive: ${drive.error}`),
      drive.aviso || ""
    ].filter(Boolean),
    redactadaConModelo: redactada.ok,
    transcripcionRevisada: revision.revisada,
    hayModelo: hayRedaccion(),
    drive,
    correo: correoPropuesto(reunion, minuta, nombres),
    // El texto de los dos, además de los archivos. Los archivos se descargan y
    // se guardan; esto es lo que se queda en el historial y lo que permite
    // seguir preguntando por la reunión después de cerrarla.
    transcripcion: revision.texto || "",
    cuadernoCorregido: cuaderno.texto || "",
    archivos: {
      transcripcion: { nombre: nombres.transcripcion, tipo: TIPO_DOCX, base64: docx.toString("base64") },
      minuta: { nombre: nombres.minuta, tipo: TIPO_PDF, base64: pdf.toString("base64") }
    }
  };
}
