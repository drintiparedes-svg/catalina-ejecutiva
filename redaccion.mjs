// Cierre de la reunión: transcripción revisada y minuta ejecutiva.
//
// Son dos trabajos distintos y por eso son dos peticiones distintas:
//
//   1. Corregir. Ortografía, gramática y puntuación de lo que el navegador
//      entendió, organizado por quien habló. El sentido no se toca: si alguien
//      dijo algo confuso, queda confuso pero bien escrito.
//   2. Interpretar. La minuta sí es un trabajo de criterio: qué se decidió, qué
//      quedó pendiente, quién se comprometió a qué.
//
// Mezclarlas en una sola petición era la forma segura de que la corrección
// acabara «mejorando» lo que se dijo, que es justo lo que no puede pasar.
//
// El material entra separado por procedencia —lo hablado, los documentos que se
// añadieron y el cuaderno de notas del usuario— y esa separación se mantiene
// hasta el papel, pero cada documento la resuelve de una manera distinta y a
// propósito:
//
//   En la MINUTA las notas se integran en la redacción y desaparecen como
//   notas. Quien lee una minuta ejecutiva no necesita saber que ese énfasis
//   salió de un apunte al margen; necesita el énfasis.
//
//   En la TRANSCRIPCIÓN se conservan aparte, al final, como notas personales
//   corregidas. Ahí sí importa la trazabilidad: el Word es el registro.
//
// Lo que no cambia nunca es que una nota no puede convertirse en algo que
// alguien dijo.

import { tipoDeReunion } from "./public/tipos-de-reunion.js";

const MODELO = "gemini-3.1-flash";
const TIEMPO = 60_000;
const TOPE_MATERIAL = 120_000;   // caracteres que se le entregan al modelo

export const hayRedaccion = () => Boolean(process.env.GEMINI_API_KEY?.trim());

const PROCEDENCIAS = {
  "LO QUE SE DIJO": "lo que se habló en la reunión, transcrito automáticamente",
  "DOCUMENTOS ADJUNTADOS": "el contenido de los archivos que se aportaron",
  "CUADERNO DE NOTAS DEL USUARIO": "lo que la persona apuntó por su cuenta; indica énfasis, no es algo dicho en la sala",
  "INTERVENCIONES DE LA ASISTENTE": "lo que dijo la propia asistente al ser invocada",
  "ANTECEDENTE": "la minuta de una reunión anterior, cuando ésta es de seguimiento"
};

// ── Petición a Gemini ────────────────────────────────────────────────────────

async function pedir(prompt, { esquema = null, temperatura = 0.2 } = {}) {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) return { ok: false, code: "SIN_CLAVE", error: "Falta GEMINI_API_KEY para redactar la minuta." };

  const generationConfig = { temperature: temperatura, maxOutputTokens: 8192 };
  if (esquema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = esquema;
  }

  let datos;
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(TIEMPO)
      }
    );
    const texto = await upstream.text();
    if (!upstream.ok) {
      console.error("Gemini redacción:", upstream.status, texto.slice(0, 300));
      return { ok: false, code: "RECHAZADO", error: `El modelo respondió ${upstream.status}.` };
    }
    datos = JSON.parse(texto);
  } catch (error) {
    return {
      ok: false,
      code: error.name === "TimeoutError" ? "TIEMPO" : "SIN_RED",
      error: error.name === "TimeoutError" ? "La redacción tardó demasiado." : "No se pudo consultar al modelo."
    };
  }

  const partes = datos?.candidates?.[0]?.content?.parts;
  const salida = Array.isArray(partes) ? partes.map(p => p?.text).filter(Boolean).join("") : "";
  if (!salida.trim()) return { ok: false, code: "VACIO", error: "El modelo no devolvió nada." };
  return { ok: true, texto: salida };
}

// ── Material de la reunión ───────────────────────────────────────────────────

// El material se le entrega etiquetado. No es adorno: sin la etiqueta el modelo
// no puede distinguir «esto lo dijo Marcela» de «esto lo leí en un PDF», y la
// minuta acabaría atribuyendo a personas frases que nunca salieron de su boca.
function componerMaterial(reunion) {
  const partes = [];

  const turnos = reunion.turnos ?? [];
  if (turnos.length) {
    partes.push("=== LO QUE SE DIJO (transcripción automática del navegador) ===");
    for (const t of turnos) {
      partes.push(`[${reloj(t.t, reunion.inicio)}] ${t.hablante || "Sin identificar"}: ${t.texto}`);
    }
  }

  const intervenciones = reunion.intervenciones ?? [];
  if (intervenciones.length) {
    partes.push("", "=== INTERVENCIONES DE LA ASISTENTE (dichas en voz alta al ser invocada) ===");
    for (const i of intervenciones) partes.push(`[${reloj(i.t, reunion.inicio)}] Catalina: ${i.texto}`);
  }

  const documentos = reunion.documentos ?? [];
  if (documentos.length) {
    partes.push("", "=== DOCUMENTOS ADJUNTADOS (NO son cosas dichas en la reunión) ===");
    for (const d of documentos) {
      partes.push(`--- Documento: ${d.nombre} (${d.tipo || "sin tipo"}) ---`);
      if (d.descripcion) partes.push(`Descripción dada por el usuario: ${d.descripcion}`);
      if (d.texto) partes.push(d.texto);
      else partes.push("(no se pudo extraer texto de este archivo)");
    }
  }

  const cuaderno = String(reunion.cuaderno ?? "").trim();
  if (cuaderno) {
    partes.push("", "=== CUADERNO DE NOTAS DEL USUARIO ===",
      "Lo que la persona fue apuntando durante la reunión: qué destacar, qué le pareció importante,",
      "recordatorios suyos. NO son cosas dichas en la reunión y NUNCA deben aparecer como",
      "declaraciones de un participante. Sí deben pesar en qué se destaca y cómo se ordena la minuta.",
      cuaderno);
  }

  const antecedente = reunion.antecedente;
  if (antecedente) {
    partes.push("", "=== ANTECEDENTE: MINUTA DE LA REUNIÓN ANTERIOR ===",
      `Esta reunión da seguimiento a «${antecedente.titulo}». Lo de abajo es lo que quedó de aquélla,`,
      "no de ésta. Úsalo para entender de qué se viene hablando y para decir qué avanzó o qué sigue",
      "pendiente, pero no lo repitas como si se hubiera dicho hoy.",
      antecedente.resumen ? `Resumen: ${antecedente.resumen}` : "",
      (antecedente.acuerdos ?? []).length ? `Acuerdos previos: ${antecedente.acuerdos.join(" · ")}` : "",
      (antecedente.pendientes ?? []).length ? `Quedaba pendiente: ${antecedente.pendientes.join(" · ")}` : "",
      (antecedente.acciones ?? []).length
        ? `Acciones comprometidas antes: ${antecedente.acciones.map(a => `${a.accion} (${a.responsable}, ${a.fecha})`).join(" · ")}`
        : "");
  }

  const entero = partes.join("\n");
  return entero.length <= TOPE_MATERIAL
    ? entero
    : entero.slice(0, TOPE_MATERIAL / 3) + "\n\n[…se omite la parte central por longitud…]\n\n"
      + entero.slice(-(TOPE_MATERIAL * 2 / 3));
}

function reloj(momento, inicio) {
  const seg = Math.max(0, Math.round(((momento ?? 0) - (inicio ?? 0)) / 1000));
  return `${String(Math.floor(seg / 60)).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")}`;
}

// ── 1. Transcripción revisada ────────────────────────────────────────────────

export async function revisarTranscripcion(reunion) {
  const turnos = reunion.turnos ?? [];
  if (!turnos.length) return { ok: true, revisada: false, texto: "", motivo: "No se transcribió nada." };

  const bruto = turnos
    .map(t => `${t.hablante || "Sin identificar"}: ${t.texto}`)
    .join("\n");

  if (!hayRedaccion()) return { ok: true, revisada: false, texto: bruto, motivo: "Sin GEMINI_API_KEY: va la transcripción tal cual." };

  const prompt = [
    "Eres una correctora de estilo. Recibes la transcripción automática de una reunión en español de Chile.",
    "",
    "Tu ÚNICA tarea es corregir la forma. Concretamente:",
    "- Corrige ortografía, tildes, gramática y puntuación.",
    "- Añade mayúsculas y signos de interrogación y exclamación donde falten.",
    "- Une las frases partidas por el reconocimiento de voz y separa las que quedaron pegadas.",
    "- Elimina muletillas repetidas y tartamudeos («eh», «este», palabras duplicadas por error de captura).",
    "- Agrupa las intervenciones seguidas de una misma persona en un solo bloque.",
    "",
    "PROHIBIDO, sin excepción:",
    "- Cambiar el sentido de lo dicho, aunque suene mal, sea incoherente o esté equivocado.",
    "- Añadir información, conclusiones, conectores que impliquen una relación que nadie estableció, o frases que nadie dijo.",
    "- Resumir, acortar o quitar contenido.",
    "- Reasignar una frase a otro participante.",
    "- Si un fragmento es ininteligible, escríbelo como [inaudible] en vez de adivinar qué decía.",
    "",
    "Formato de salida: texto plano. Una línea en blanco entre bloques.",
    "Cada bloque empieza con el nombre del participante, dos puntos, y su intervención corregida.",
    "Conserva exactamente los nombres que ya vienen, incluido «Sin identificar».",
    "No escribas ningún encabezado, comentario ni explicación: sólo la transcripción corregida.",
    "",
    "=== TRANSCRIPCIÓN A CORREGIR ===",
    bruto
  ].join("\n");

  const salida = await pedir(prompt, { temperatura: 0.1 });
  // Si la corrección falla, va la transcripción cruda. Es peor de leer, pero es
  // exactamente lo que se dijo: quedarse sin documento sería mucho peor.
  if (!salida.ok) return { ok: true, revisada: false, texto: bruto, motivo: salida.error };
  return { ok: true, revisada: true, texto: salida.texto.trim() };
}

// ── 1b. Cuaderno de notas corregido ──────────────────────────────────────────
//
// Va al Word, al final, como «Notas personales del usuario». Se corrige igual
// que la transcripción y por el mismo motivo: son apuntes tomados deprisa en
// mitad de una reunión, y nadie escribe bien mientras escucha. Lo que no se
// hace es interpretarlas ni completarlas.

export async function corregirCuaderno(reunion) {
  const cuaderno = String(reunion.cuaderno ?? "").trim();
  if (!cuaderno) return { ok: true, corregido: false, texto: "" };
  if (!hayRedaccion()) return { ok: true, corregido: false, texto: cuaderno, motivo: "Sin GEMINI_API_KEY: van tal cual." };

  const prompt = [
    "Eres una correctora de estilo. Recibes las notas que alguien tomó a mano durante una reunión,",
    "deprisa y mientras escuchaba, así que están mal escritas y abreviadas.",
    "",
    "Corrige ortografía, tildes, gramática y puntuación, y desarrolla las abreviaturas evidentes",
    "(«ppto» → «presupuesto», «rrhh» → «recursos humanos»). Ordena cada apunte en una línea propia.",
    "",
    "PROHIBIDO:",
    "- Cambiar el significado de un apunte, aunque esté incompleto o suene raro.",
    "- Añadir información, conclusiones o contexto que la nota no traiga.",
    "- Juntar dos apuntes distintos en uno, ni inventar la relación entre ellos.",
    "- Quitar apuntes: si algo no se entiende, déjalo tal cual y añade [sic] detrás.",
    "",
    "Devuelve sólo las notas corregidas, una por línea, sin encabezado ni comentarios.",
    "",
    "=== NOTAS A CORREGIR ===",
    cuaderno
  ].join("\n");

  const salida = await pedir(prompt, { temperatura: 0.1 });
  if (!salida.ok) return { ok: true, corregido: false, texto: cuaderno, motivo: salida.error };
  return { ok: true, corregido: true, texto: salida.texto.trim() };
}

// ── 2. Minuta ejecutiva ──────────────────────────────────────────────────────

const lista = descripcion => ({ type: "array", items: { type: "string" }, description: descripcion });

const ESQUEMA_MINUTA = {
  type: "object",
  properties: {
    titulo: { type: "string", description: "Título de la reunión, breve y descriptivo." },
    objetivo: { type: "string", description: "El objetivo declarado o deducible. Si no se declaró, «No se declaró un objetivo»." },
    resumen: { type: "string", description: "Resumen ejecutivo de tres a seis frases." },
    temas: {
      type: "array",
      items: {
        type: "object",
        properties: { titulo: { type: "string" }, detalle: { type: "string" } },
        required: ["titulo", "detalle"]
      },
      description: "Temas tratados, cada uno con lo esencial de lo que se discutió."
    },
    antecedentes: lista("Antecedentes o contexto que se mencionaron como previos a la reunión."),
    problemas: lista("Problemas o riesgos identificados."),
    decisiones: lista("Decisiones tomadas, con lo que se decidió exactamente."),
    acuerdos: lista("Acuerdos alcanzados entre los participantes."),
    desacuerdos: lista("Desacuerdos o posturas enfrentadas que quedaron sin resolver."),
    acciones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          accion: { type: "string" },
          responsable: { type: "string", description: "Quién se comprometió. «Sin asignar» si nadie lo hizo." },
          fecha: { type: "string", description: "Fecha comprometida. «Sin fecha» si no se dio ninguna." },
          estado: { type: "string", description: "Comprometido, Pendiente, En curso o Completado." }
        },
        required: ["accion", "responsable", "fecha", "estado"]
      }
    },
    pendientes: lista("Preguntas que quedaron abiertas y asuntos que no se alcanzaron a tratar."),
    proximos_pasos: lista("Qué sigue después de esta reunión."),
    participantes: lista("Nombres de quienes participaron, tal como aparecen en el material."),

    // De aquí abajo, campos propios de cada tipo de reunión. Se piden siempre
    // —un esquema por tipo multiplicaría por cinco lo que hay que mantener— pero
    // sólo se rellenan y sólo se imprimen los que ese tipo usa.
    conceptos: lista("Conferencia: conceptos explicados, con la definición que dio quien expuso."),
    datos: lista("Conferencia: datos y cifras concretas que se mencionaron."),
    referencias: lista("Conferencia: autores, papers, libros o fuentes citadas."),
    conclusiones: lista("Conferencia: a qué conclusiones llegó la exposición."),
    preguntas: lista("Preguntas del público o preguntas abiertas, con su respuesta si la hubo."),
    bloqueos: lista("Operacional: qué impide avanzar y a quién le corresponde destrabarlo."),
    decision_central: { type: "string", description: "Ejecutiva: el problema o la decisión que centró la reunión." },
    posiciones: lista("Ejecutiva: la postura de cada participante, con su nombre. No las suavices."),
    alternativas: lista("Ejecutiva: opciones que se pusieron sobre la mesa, con sus pros y contras si se dieron."),
    riesgos: lista("Ejecutiva: riesgos identificados."),
    problema: { type: "string", description: "Lean: el problema formulado con precisión." },
    estado_actual: { type: "string", description: "Lean: cómo funciona hoy el proceso involucrado." },
    desperdicios: lista("Lean: ineficiencias, esperas, retrabajos o desperdicios detectados."),
    causas: lista("Lean: causas, distinguiendo raíz de síntoma sólo si en la reunión se distinguió."),
    actores: lista("Lean: quiénes intervienen en el proceso y en qué parte."),
    oportunidades: lista("Lean: oportunidades de mejora identificadas."),
    contramedidas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problema: { type: "string" }, causa: { type: "string" }, contramedida: { type: "string" },
          responsable: { type: "string" }, fecha: { type: "string" },
          indicador: { type: "string", description: "Cómo se medirá. «Sin definir» si no se acordó." }
        },
        required: ["problema", "contramedida", "responsable", "fecha", "indicador"]
      },
      description: "Lean: Problema → Causa → Contramedida → Responsable → Fecha → Indicador."
    },
    ideas: lista("Creativa: las ideas que aparecieron, con la formulación de quien las dijo."),
    hipotesis: lista("Creativa: hipótesis y supuestos que se pusieron en juego."),
    oportunidades_creativas: lista("Creativa: oportunidades y asociaciones que surgieron."),
    divergencias: lista("Creativa: puntos donde el grupo se abrió en direcciones distintas."),
    descartadas: lista("Creativa: ideas descartadas y por qué se descartaron."),
    experimentos: lista("Creativa: próximos experimentos o pruebas acordadas.")
  },
  required: ["titulo", "objetivo", "resumen"]
};

export async function redactarMinuta(reunion) {
  const material = componerMaterial(reunion);
  if (!material.trim()) return { ok: false, code: "SIN_MATERIAL", error: "No hay nada que resumir: la reunión quedó vacía." };
  if (!hayRedaccion()) return { ok: false, code: "SIN_CLAVE", error: "Falta GEMINI_API_KEY para redactar la minuta." };

  const tipo = tipoDeReunion(reunion.tipo);
  const prompt = [
    "Eres la secretaria ejecutiva de una reunión. Redactas la minuta que leerán quienes no estuvieron.",
    "Escribes en español de Chile, en tono profesional y directo, sin relleno.",
    "",
    `TIPO DE REUNIÓN: ${tipo.nombre}. ${tipo.resumen}`,
    "Lo que tienes que sacar de aquí, por orden de importancia:",
    ...tipo.prioriza.map((p, i) => `  ${i + 1}. ${p}`),
    tipo.guia,
    "Rellena sólo los campos que este tipo de reunión necesita; los demás, déjalos vacíos.",
    "",
    "El material viene separado por procedencia y esa separación es lo más importante de tu trabajo:",
    ...Object.entries(PROCEDENCIAS).map(([clave, que]) => `- ${clave}: ${que}.`),
    "",
    "Reglas que no puedes romper:",
    "1. Sólo puedes afirmar lo que está en el material. No completes con lo que suele pasar en reuniones así.",
    "2. El cuaderno de notas del usuario indica qué destacar. Puede cambiar el énfasis, el orden y el detalle.",
    "   Su contenido relevante se INTEGRA en la redacción de las secciones que le correspondan, con tus palabras.",
    "   NO hagas una sección de notas ni las cites como tales: quien lee la minuta no debe distinguir de dónde salió el énfasis.",
    "   Y NUNCA puede convertirse en una decisión, un acuerdo o una declaración de un participante:",
    "   si la nota dice «ojo con el presupuesto», eso es un énfasis, no un problema que alguien planteó en la sala.",
    "3. Lo que viene de un documento se atribuye al documento, no a una persona. Menciona el nombre del archivo.",
    "4. Una acción sólo lleva responsable si alguien se comprometió de forma explícita. Si no, «Sin asignar».",
    "   Lo mismo con las fechas: «Sin fecha» antes que inventar un plazo.",
    "5. Un desacuerdo sólo se registra si de verdad hubo posturas enfrentadas. No fabriques tensión.",
    "6. Si una sección no tiene contenido, devuélvela vacía. Una minuta corta y cierta vale más que una larga y adornada.",
    "7. La transcripción es automática y tiene errores. Si algo es dudoso, dilo («según se entendió», «no quedó claro si»).",
    "",
    reunion.antecedente
      ? `Esta es una reunión de seguimiento de «${reunion.antecedente.titulo}». Di explícitamente qué avanzó y qué sigue igual.`
      : "",
    reunion.titulo ? `Título que dio el usuario para esta reunión: ${reunion.titulo}` : "",
    reunion.objetivo ? `Objetivo que dio el usuario: ${reunion.objetivo}` : "",
    (reunion.participantes ?? []).length
      ? `Participantes declarados: ${reunion.participantes.join(", ")}`
      : "No se declararon los participantes: usa los nombres que aparezcan en la transcripción y «Sin identificar» para el resto.",
    "",
    "=== MATERIAL DE LA REUNIÓN ===",
    material
  ].filter(Boolean).join("\n");

  const salida = await pedir(prompt, { esquema: ESQUEMA_MINUTA, temperatura: 0.25 });
  if (!salida.ok) return salida;

  try {
    return { ok: true, minuta: normalizarMinuta(JSON.parse(salida.texto)) };
  } catch {
    return { ok: false, code: "ILEGIBLE", error: "El modelo devolvió una minuta que no se pudo leer." };
  }
}

// El esquema no garantiza que vengan todos los campos ni que las listas sean
// listas: se normaliza aquí para que quien compone el documento no tenga que
// defenderse de cada hueco.
function normalizarMinuta(cruda) {
  const texto = valor => String(valor ?? "").trim();
  const listaDe = valor => (Array.isArray(valor) ? valor : []).map(texto).filter(Boolean);
  return {
    titulo: texto(cruda.titulo) || "Reunión",
    objetivo: texto(cruda.objetivo),
    resumen: texto(cruda.resumen),
    temas: (Array.isArray(cruda.temas) ? cruda.temas : [])
      .map(t => ({ titulo: texto(t?.titulo), detalle: texto(t?.detalle) }))
      .filter(t => t.titulo || t.detalle),
    antecedentes: listaDe(cruda.antecedentes),
    problemas: listaDe(cruda.problemas),
    decisiones: listaDe(cruda.decisiones),
    acuerdos: listaDe(cruda.acuerdos),
    desacuerdos: listaDe(cruda.desacuerdos),
    acciones: (Array.isArray(cruda.acciones) ? cruda.acciones : [])
      .map(a => ({
        accion: texto(a?.accion),
        responsable: texto(a?.responsable) || "Sin asignar",
        fecha: texto(a?.fecha) || "Sin fecha",
        estado: texto(a?.estado) || "Pendiente"
      }))
      .filter(a => a.accion),
    pendientes: listaDe(cruda.pendientes),
    proximos_pasos: listaDe(cruda.proximos_pasos),
    participantes: listaDe(cruda.participantes),

    conceptos: listaDe(cruda.conceptos),
    datos: listaDe(cruda.datos),
    referencias: listaDe(cruda.referencias),
    conclusiones: listaDe(cruda.conclusiones),
    preguntas: listaDe(cruda.preguntas),
    bloqueos: listaDe(cruda.bloqueos),
    decision_central: texto(cruda.decision_central),
    posiciones: listaDe(cruda.posiciones),
    alternativas: listaDe(cruda.alternativas),
    riesgos: listaDe(cruda.riesgos),
    problema: texto(cruda.problema),
    estado_actual: texto(cruda.estado_actual),
    desperdicios: listaDe(cruda.desperdicios),
    causas: listaDe(cruda.causas),
    actores: listaDe(cruda.actores),
    oportunidades: listaDe(cruda.oportunidades),
    contramedidas: (Array.isArray(cruda.contramedidas) ? cruda.contramedidas : [])
      .map(c => ({
        problema: texto(c?.problema), causa: texto(c?.causa) || "Sin determinar",
        contramedida: texto(c?.contramedida), responsable: texto(c?.responsable) || "Sin asignar",
        fecha: texto(c?.fecha) || "Sin fecha", indicador: texto(c?.indicador) || "Sin definir"
      }))
      .filter(c => c.contramedida),
    ideas: listaDe(cruda.ideas),
    hipotesis: listaDe(cruda.hipotesis),
    oportunidades_creativas: listaDe(cruda.oportunidades_creativas),
    divergencias: listaDe(cruda.divergencias),
    descartadas: listaDe(cruda.descartadas),
    experimentos: listaDe(cruda.experimentos)
  };
}

// Minuta de respaldo, sin modelo. No interpreta nada —no puede— pero deja el
// material ordenado y rotulado por procedencia, que es infinitamente mejor que
// devolver un error y perder la reunión.
export function minutaSinModelo(reunion) {
  const turnos = reunion.turnos ?? [];
  return {
    titulo: reunion.titulo || "Reunión",
    objetivo: reunion.objetivo || "",
    resumen: "No se pudo redactar el resumen ejecutivo automáticamente. Abajo queda el material de la reunión "
      + "ordenado por procedencia, sin interpretar.",
    temas: [],
    antecedentes: [],
    problemas: [],
    decisiones: [],
    acuerdos: [],
    desacuerdos: [],
    acciones: [],
    pendientes: [],
    proximos_pasos: [],
    participantes: reunion.participantes ?? [],
    // Marca para que quien compone el documento avise en la portada.
    sinModelo: true,
    crudo: turnos.map(t => `${t.hablante || "Sin identificar"}: ${t.texto}`)
  };
}
