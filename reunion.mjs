// Cierre de una reunión: los dos documentos, el guardado y el correo propuesto.
//
// Este módulo es el que junta las piezas —redacción, composición, Drive— y el
// único que sabe cómo se llama cada archivo y qué lleva dentro. app.mjs sólo
// expone la ruta.
//
// La regla que ordena todo lo de abajo: lo que se dijo, lo que traían los
// documentos y lo que indicó el usuario como nota editorial son tres cosas
// distintas y se mantienen distinguibles hasta el papel. La minuta interpreta;
// la transcripción, no.

import { construirDocx, construirPdf, bloque as b } from "./documentos.mjs";
import { revisarTranscripcion, redactarMinuta, minutaSinModelo, hayRedaccion } from "./redaccion.mjs";
import { guardarEnDrive, driveConfigurado } from "./drive.mjs";

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
export function componerTranscripcion(reunion, revision, minuta) {
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

  const notas = reunion.notas ?? [];
  if (notas.length) {
    bloques.push(b.seccion("Notas del usuario"));
    bloques.push(b.parrafo("Indicaciones dadas a la asistente durante la reunión. No son parte de lo hablado."));
    for (const n of notas) bloques.push(b.vineta(n.texto));
  }

  return bloques;
}

// La minuta ejecutiva. Las secciones vacías no se imprimen: una minuta con seis
// epígrafes que dicen «ninguno» se lee peor y da la impresión de que faltó algo.
export function componerMinuta(reunion, minuta) {
  const bloques = portada(reunion, minuta, minuta.titulo || reunion.titulo || "Minuta de reunión");
  bloques.push(b.separador());

  if (minuta.sinModelo) {
    bloques.push(b.parrafo("Aviso: no se pudo redactar la minuta automáticamente. Abajo queda el material de la "
      + "reunión ordenado por procedencia, sin interpretar."));
  }

  const seccionDeLista = (titulo, items) => {
    if (!items?.length) return;
    bloques.push(b.seccion(titulo));
    items.forEach(item => bloques.push(b.vineta(item)));
  };

  if (minuta.resumen) {
    bloques.push(b.seccion("Resumen ejecutivo"), b.parrafo(minuta.resumen));
  }

  if (minuta.temas?.length) {
    bloques.push(b.seccion("Temas tratados"));
    minuta.temas.forEach(t => {
      if (t.titulo) bloques.push(b.parrafo(t.titulo));
      if (t.detalle) bloques.push(b.vineta(t.detalle));
    });
  }

  seccionDeLista("Antecedentes", minuta.antecedentes);
  seccionDeLista("Problemas identificados", minuta.problemas);
  seccionDeLista("Decisiones", minuta.decisiones);
  seccionDeLista("Acuerdos", minuta.acuerdos);
  seccionDeLista("Desacuerdos", minuta.desacuerdos);

  if (minuta.acciones?.length) {
    bloques.push(b.seccion("Acciones comprometidas"));
    bloques.push(b.tabla(["Acción", "Responsable", "Fecha", "Estado"],
      minuta.acciones.map(a => [a.accion, a.responsable, a.fecha, a.estado])));
  }

  seccionDeLista("Puntos pendientes", minuta.pendientes);
  seccionDeLista("Próximos pasos", minuta.proximos_pasos);

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
    + ((reunion.notas ?? []).length ? " y las notas dadas durante la sesión" : "")));

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

export async function cerrarReunion(reunion) {
  // Las dos peticiones al modelo son independientes: van a la vez para no
  // sumar sus esperas, que en una reunión larga son decenas de segundos.
  const [revision, redactada] = await Promise.all([
    revisarTranscripcion(reunion),
    redactarMinuta(reunion)
  ]);

  const minuta = redactada.ok ? redactada.minuta : minutaSinModelo(reunion);
  const nombres = nombresDeArchivo(reunion, minuta);

  const docx = construirDocx(componerTranscripcion(reunion, revision, minuta));
  const pdf = construirPdf(componerMinuta(reunion, minuta), { titulo: minuta.titulo || "Minuta" });

  const drive = driveConfigurado()
    ? await guardarEnDrive([
      { nombre: nombres.transcripcion, tipo: TIPO_DOCX, contenido: docx },
      { nombre: nombres.minuta, tipo: TIPO_PDF, contenido: pdf }
    ])
    : { ok: false, code: "SIN_CONFIGURAR", error: "Google Drive no está configurado en este despliegue.", archivos: [] };

  return {
    ok: true,
    minuta,
    // Se dice sin adornos qué no salió como debía: sin esto, una minuta de
    // respaldo pasa por una minuta redactada y nadie se entera.
    avisos: [
      redactada.ok ? "" : `La minuta va sin redacción asistida: ${redactada.error}`,
      revision.revisada ? "" : (revision.motivo ? `La transcripción va sin corregir: ${revision.motivo}` : ""),
      drive.ok ? "" : (drive.code === "SIN_CONFIGURAR" ? "" : `No se pudo guardar en Drive: ${drive.error}`),
      drive.aviso || ""
    ].filter(Boolean),
    redactadaConModelo: redactada.ok,
    transcripcionRevisada: revision.revisada,
    hayModelo: hayRedaccion(),
    drive,
    correo: correoPropuesto(reunion, minuta, nombres),
    archivos: {
      transcripcion: { nombre: nombres.transcripcion, tipo: TIPO_DOCX, base64: docx.toString("base64") },
      minuta: { nombre: nombres.minuta, tipo: TIPO_PDF, base64: pdf.toString("base64") }
    }
  };
}
