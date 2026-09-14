// Memoria de la reunión y lectura de los documentos que se aportan.
//
// La memoria de la reunión es SEPARADA de la conversación con Catalina, y es
// deliberado: en una reunión ella no es una interlocutora, es la secretaria. Lo
// que se habla en la sala no es lo que se le dice a ella, y mezclarlo hacía que
// respondiera a frases que no le iban dirigidas.
//
// Todo lo que entra queda marcado con su procedencia y esa marca sobrevive hasta
// el documento final:
//
//   CONVERSACION     lo que se dijo en la sala
//   DOCUMENTO        lo que traía un archivo aportado
//   NOTA_EDITORIAL   una indicación del usuario sobre qué destacar
//   ASISTENTE        lo que dijo Catalina al ser invocada
//
// La distinción no es burocrática: una nota editorial puede cambiar el énfasis
// de la minuta, pero jamás puede acabar convertida en algo que alguien dijo.

import { textoDePdf } from "./pdf.js";

// ── Estados ──────────────────────────────────────────────────────────────────
//
// Por defecto escucha y calla. Sólo habla cuando se la habilita y se la invoca,
// y vuelve sola a escuchar en cuanto termina de hablar.

export const ESTADOS = {
  ESCUCHANDO: "escuchando",
  HABILITADA: "habilitada",
  INVOCADA: "invocada",
  HABLANDO: "hablando",
  CERRANDO: "cerrando",
  // Cerrar la reunión no apaga la sesión: apaga la captura de la sala y deja la
  // reunión como algo que se puede seguir consultando de viva voz.
  POSTERIOR: "posterior"
};

export const ROTULOS = {
  [ESTADOS.ESCUCHANDO]: "Escuchando",
  [ESTADOS.HABILITADA]: "Puedes hablarme",
  [ESTADOS.INVOCADA]: "Me lo estoy pensando",
  [ESTADOS.HABLANDO]: "Hablando",
  [ESTADOS.CERRANDO]: "Cerrando la reunión",
  [ESTADOS.POSTERIOR]: "Reunión cerrada"
};

const SIN_NOMBRE = "Sin identificar";
const TOPE_DOCUMENTO = 40_000;   // caracteres que se guardan de cada archivo

export class MemoriaDeReunion {
  constructor() { this.olvidar(); }

  olvidar() {
    this.abierta = false;
    this.id = "";
    this.tipo = "operacional";
    this.idiomas = ["es"];
    this.inicio = 0;
    this.fin = 0;
    this.titulo = "";
    this.objetivo = "";
    this.destinatario = "";
    this.hablante = "";
    this.nombresVistos = [];
    this.turnos = [];
    // Un cuaderno, no una lista de notas sueltas. Quien toma notas en una
    // reunión vuelve sobre lo que ya escribió: releerlo, matizarlo, añadir
    // debajo. Con una lista de entradas cerradas eso era imposible.
    this.cuaderno = "";
    this.documentos = [];
    this.intervenciones = [];
    // Minuta de una reunión anterior, cuando ésta es de seguimiento.
    this.antecedente = null;
    // Lo que quedó al cerrar, para poder seguir conversando sobre ello.
    this.cierre = null;
  }

  abrir({ titulo = "", objetivo = "", antecedente = null, tipo = "operacional", cuaderno = "", idiomas = ["es"] } = {}) {
    this.olvidar();
    this.abierta = true;
    this.inicio = Date.now();
    this.id = `r-${this.inicio}`;
    this.titulo = titulo;
    this.objetivo = objetivo;
    this.antecedente = antecedente;
    this.tipo = tipo;
    this.cuaderno = cuaderno;
    this.idiomas = idiomas;
  }

  // Retoma un borrador guardado durante una reunión anterior que no llegó a
  // cerrarse. Se restauran los turnos tal cual: son el registro.
  retomar(borrador) {
    this.olvidar();
    Object.assign(this, {
      abierta: true,
      id: borrador.id,
      inicio: borrador.inicio,
      titulo: borrador.titulo || "",
      objetivo: borrador.objetivo || "",
      tipo: borrador.tipo || "operacional",
      idiomas: borrador.idiomas ?? ["es"],
      hablante: borrador.hablante || "",
      nombresVistos: borrador.nombresVistos ?? [],
      turnos: borrador.turnos ?? [],
      cuaderno: borrador.cuaderno || "",
      documentos: borrador.documentos ?? [],
      intervenciones: borrador.intervenciones ?? [],
      antecedente: borrador.antecedente || null
    });
    return this;
  }

  // Lo que se escribe en el almacén mientras la reunión ocurre.
  borrador() {
    return {
      id: this.id || `r-${this.inicio}`,
      inicio: this.inicio,
      guardado: Date.now(),
      titulo: this.titulo,
      objetivo: this.objetivo,
      tipo: this.tipo,
      idiomas: this.idiomas,
      hablante: this.hablante,
      nombresVistos: this.nombresVistos,
      turnos: this.turnos,
      cuaderno: this.cuaderno,
      documentos: this.documentos,
      intervenciones: this.intervenciones,
      antecedente: this.antecedente
    };
  }

  cerrar() {
    this.fin = Date.now();
    this.abierta = false;
  }

  // Quién está hablando ahora. El reconocimiento del navegador no separa voces,
  // así que la atribución viene de fuera: la fija la persona o la fija Catalina
  // cuando alguien se presenta. Lo que no se hace es adivinarla.
  fijarHablante(nombre) {
    const limpio = String(nombre ?? "").trim().slice(0, 60);
    this.hablante = limpio;
    if (limpio && !this.nombresVistos.includes(limpio)) this.nombresVistos.push(limpio);
    return limpio;
  }

  // El idioma se guarda con la frase, no se traduce nada: una reunión bilingüe
  // se transcribe en las dos lenguas y cada intervención queda en la suya.
  anotarTurno(texto, idioma = "", id = "") {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    const turno = { t: Date.now(), hablante: this.hablante || SIN_NOMBRE, texto: limpio, origen: "CONVERSACION" };
    if (idioma) turno.idioma = idioma;
    if (id) turno.id = id;
    this.turnos.push(turno);
    return turno;
  }

  // El segundo idioma reescribe una intervención que el principal transcribió
  // mal porque se dijo en la otra lengua. No es un turno nuevo: es el mismo,
  // mejor entendido, así que se corrige en su sitio y no se duplica.
  corregirTurno(id, texto, idioma) {
    const turno = this.turnos.find(t => t.id === id);
    if (!turno) return null;
    turno.texto = String(texto ?? "").trim() || turno.texto;
    if (idioma) turno.idioma = idioma;
    return turno;
  }

  // Qué lenguas se hablaron de verdad, para decirlo en la minuta.
  idiomasHablados() {
    return [...new Set(this.turnos.map(t => t.idioma).filter(Boolean))];
  }

  // Añade una línea al cuaderno sin tocar lo que ya había. Es lo que usa la voz
  // («Catalina, apunta que…»); a mano se edita el cuaderno entero.
  anotarNota(texto) {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    this.cuaderno = this.cuaderno ? `${this.cuaderno}\n${limpio}` : limpio;
    return limpio;
  }

  escribirCuaderno(texto) {
    this.cuaderno = String(texto ?? "");
    return this.cuaderno;
  }

  // Cuántas líneas escritas lleva, para la cuenta de la tira.
  lineasDeCuaderno() {
    return this.cuaderno.split("\n").filter(l => l.trim()).length;
  }

  anotarDocumento(documento) {
    const guardado = { t: Date.now(), origen: "DOCUMENTO", ...documento };
    this.documentos.push(guardado);
    return guardado;
  }

  anotarIntervencion(texto) {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    const dicho = { t: Date.now(), texto: limpio, origen: "ASISTENTE" };
    this.intervenciones.push(dicho);
    return dicho;
  }

  participantes() {
    const vistos = new Set(this.nombresVistos);
    for (const t of this.turnos) if (t.hablante && t.hablante !== SIN_NOMBRE) vistos.add(t.hablante);
    return [...vistos];
  }

  minutosTranscurridos() {
    if (!this.inicio) return 0;
    return Math.max(0, Math.round(((this.fin || Date.now()) - this.inicio) / 60000));
  }

  // Lo que Catalina necesita saber para contestar sin que se le mande la reunión
  // entera. Es un resumen de estado, no un resumen de contenido: los últimos
  // turnos van literales para que no interprete sobre una interpretación.
  resumenVivo(ultimosTurnos = 40) {
    const recientes = this.turnos.slice(-ultimosTurnos)
      .map(t => `${t.hablante}: ${t.texto}`).join("\n");
    const participantes = this.participantes();
    return [
      `Reunión en curso${this.titulo ? `: «${this.titulo}»` : ""}. Lleva ${this.minutosTranscurridos()} minutos.`,
      this.objetivo ? `Objetivo declarado: ${this.objetivo}` : "",
      participantes.length ? `Participantes identificados: ${participantes.join(", ")}` : "Nadie se ha identificado todavía.",
      this.documentos.length
        ? `Documentos aportados (${this.documentos.length}): ${this.documentos.map(d => d.nombre).join(", ")}`
        : "",
      this.cuaderno.trim() ? `Cuaderno de notas del usuario:\n${this.cuaderno.trim()}` : "",
      this.antecedente ? `Esta reunión da seguimiento a «${this.antecedente.titulo}».` : "",
      "",
      recientes ? `Últimas intervenciones transcritas:\n${recientes}` : "Todavía no se ha transcrito nada."
    ].filter(Boolean).join("\n");
  }

  // Lo que viaja al servidor al cerrar. Se manda todo, no un resumen: la
  // corrección y la minuta se hacen allá y necesitan el material entero.
  paraEnviar() {
    return {
      inicio: this.inicio,
      fin: this.fin || Date.now(),
      titulo: this.titulo,
      objetivo: this.objetivo,
      tipo: this.tipo,
      idiomas: this.idiomasHablados(),
      destinatario: this.destinatario,
      participantes: this.participantes(),
      turnos: this.turnos,
      cuaderno: this.cuaderno,
      documentos: this.documentos.map(({ nombre, tipo, texto, descripcion }) => ({ nombre, tipo, texto, descripcion })),
      intervenciones: this.intervenciones,
      antecedente: this.antecedente
    };
  }

  vacia() {
    return !this.turnos.length && !this.cuaderno.trim() && !this.documentos.length;
  }

  // La reunión ya cerrada, tal como se guarda en el historial y como se le da a
  // Catalina para que siga contestando sobre ella. Aquí está la diferencia entre
  // «se generaron dos archivos» y «la reunión sigue siendo consultable».
  registroCompleto(cierre) {
    const m = cierre?.minuta ?? {};
    return {
      id: this.id || `r-${this.inicio}`,
      inicio: this.inicio,
      fin: this.fin || Date.now(),
      tipo: this.tipo,
      titulo: this.titulo || m.titulo || "Reunión sin título",
      objetivo: this.objetivo || m.objetivo || "",
      participantes: this.participantes(),
      minuta: m,
      transcripcion: cierre?.transcripcion || "",
      cuaderno: cierre?.cuadernoCorregido || this.cuaderno,
      documentos: this.documentos.map(({ nombre, tipo, descripcion, texto }) => ({ nombre, tipo, descripcion, texto })),
      intervenciones: this.intervenciones,
      antecedente: this.antecedente,
      archivos: [cierre?.archivos?.transcripcion?.nombre, cierre?.archivos?.minuta?.nombre].filter(Boolean),
      drive: cierre?.drive?.ok ? (cierre.drive.archivos ?? []).map(a => ({ nombre: a.nombre, enlace: a.enlace })) : []
    };
  }

  // Lo que se le entrega para conversar sobre una reunión ya cerrada. Va la
  // minuta entera y la transcripción recortada: contestar «¿qué dijo Juan del
  // presupuesto?» necesita lo que se dijo, no un resumen de lo que se dijo.
  contextoPosterior(registro, topeTranscripcion = 24_000) {
    if (!registro) return "";
    const m = registro.minuta ?? {};
    const lista = (titulo, items) => (items ?? []).length
      ? `${titulo}:\n${items.map(i => `- ${typeof i === "string" ? i : `${i.accion} — ${i.responsable} (${i.fecha}, ${i.estado})`}`).join("\n")}`
      : "";
    const transcripcion = String(registro.transcripcion || "");
    return [
      `Reunión «${registro.titulo}» del ${new Date(registro.inicio).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}.`,
      registro.objetivo ? `Objetivo: ${registro.objetivo}` : "",
      registro.participantes.length ? `Participantes: ${registro.participantes.join(", ")}` : "",
      m.resumen ? `\nResumen ejecutivo:\n${m.resumen}` : "",
      lista("\nDecisiones", m.decisiones),
      lista("\nAcuerdos", m.acuerdos),
      lista("\nDesacuerdos", m.desacuerdos),
      lista("\nAcciones comprometidas", m.acciones),
      lista("\nPendientes", m.pendientes),
      lista("\nPróximos pasos", m.proximos_pasos),
      registro.documentos.length ? `\nDocumentos aportados: ${registro.documentos.map(d => d.nombre).join(", ")}` : "",
      registro.cuaderno.trim() ? `\nNotas personales del usuario:\n${registro.cuaderno.trim()}` : "",
      transcripcion
        ? `\nTRANSCRIPCIÓN DE LO QUE SE DIJO:\n${transcripcion.length > topeTranscripcion ? `…${transcripcion.slice(-topeTranscripcion)}` : transcripcion}`
        : ""
    ].filter(Boolean).join("\n");
  }
}

// ── Lectura de documentos ────────────────────────────────────────────────────
//
// Se leen aquí, en el navegador, y no en el servidor: el archivo ya está aquí,
// subirlo cuesta tiempo y en Vercel hay un tope de tamaño por petición que un
// PowerPoint se salta sin esfuerzo. Al servidor sólo viaja el texto.

const EXTENSIONES_ZIP = { docx: "word", xlsx: "excel", pptx: "powerpoint" };

// Por qué un PDF no soltó texto. Los tres casos se arreglan distinto y por eso
// se dicen distinto.
const AVISOS_PDF = {
  "sin-texto": "Este PDF no trae texto: sus páginas son imágenes, como en un escaneado.",
  "ilegible": "Este PDF trae el texto en tipografías sin tabla de caracteres, y no se puede leer aquí.",
  "cifrado": "Este PDF está protegido con contraseña y su texto va cifrado."
};

// Qué es el archivo DE VERDAD, mirándolo por dentro.
//
// Antes se decidía sólo por la extensión, y por una lista blanca corta: un
// `.sql`, un `.py`, un `.html`, un `.yaml` o un archivo sin extensión se
// rechazaban con «no se reconoce este formato» aunque fueran texto plano que el
// navegador lee sin esfuerzo. Ocho de cada dieciocho archivos reales se caían
// por eso. La extensión es una pista, no un hecho: un `.docx` renombrado sigue
// siendo un ZIP de Word, y un archivo sin extensión puede ser un acta entera.
//
// Se miran los primeros bytes, que es donde los formatos se declaran.
const FIRMAS = [
  { magia: [0x25, 0x50, 0x44, 0x46], clase: "pdf" },              // %PDF
  { magia: [0x50, 0x4b, 0x03, 0x04], clase: "zip" },              // PK.. (OOXML, ODF, zip)
  { magia: [0x50, 0x4b, 0x05, 0x06], clase: "zip" },
  { magia: [0xd0, 0xcf, 0x11, 0xe0], clase: "ole" },              // .doc/.xls/.ppt antiguos
  { magia: [0x89, 0x50, 0x4e, 0x47], clase: "imagen" },           // PNG
  { magia: [0xff, 0xd8, 0xff], clase: "imagen" },                 // JPEG
  { magia: [0x47, 0x49, 0x46, 0x38], clase: "imagen" },           // GIF
  { magia: [0x1f, 0x8b], clase: "comprimido" },                   // gzip
  { magia: [0x52, 0x61, 0x72, 0x21], clase: "comprimido" },       // RAR
  { magia: [0x37, 0x7a, 0xbc, 0xaf], clase: "comprimido" }        // 7z
];

function claseDeBytes(bytes) {
  for (const { magia, clase } of FIRMAS) {
    if (magia.every((b, i) => bytes[i] === b)) return clase;
  }
  return "";
}

// ¿Esto se puede leer como texto? Se decodifica como UTF-8 estricto y se mira
// cuánto sale legible. Un binario trae bytes nulos y caracteres de control que
// el texto no tiene, así que la diferencia es clara sin tener que adivinar.
function pareceTexto(bytes) {
  if (!bytes.length) return false;
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Los de control que sí aparecen en texto son el salto, el retorno y el
    // tabulador. El resto, y sobre todo el byte nulo, delatan un binario.
    const raros = [...texto].filter(c => {
      const n = c.codePointAt(0);
      return n < 32 && n !== 9 && n !== 10 && n !== 13;
    }).length;
    return raros / texto.length < 0.02;
  } catch {
    return false;   // no es UTF-8 válido
  }
}

// Qué familia de OOXML es un ZIP, mirando qué partes trae dentro. Así un
// documento renombrado —o bajado sin extensión— se lee igual.
function familiaDeZip(buffer) {
  try {
    const nombres = entradasZip(buffer).entradas.map(e => e.nombre);
    if (nombres.includes("word/document.xml")) return "word";
    if (nombres.some(n => n.startsWith("xl/"))) return "excel";
    if (nombres.some(n => n.startsWith("ppt/"))) return "powerpoint";
  } catch { /* no era un ZIP legible */ }
  return "";
}

export async function leerDocumento(archivo, { tope = TOPE_DOCUMENTO } = {}) {
  const nombre = archivo.name || "documento";
  const extension = (nombre.split(".").pop() || "").toLowerCase();
  const base = {
    nombre,
    extension: extension && extension !== nombre.toLowerCase() ? extension : "",
    tipo: archivo.type || "",
    tamano: archivo.size ?? 0
  };

  try {
    if (!archivo.size) {
      return { ...base, texto: "", aviso: "El archivo está vacío." };
    }

    // Se mira la cabecera antes que nada: es lo único que no miente.
    const cabecera = new Uint8Array(await archivo.slice(0, 4096).arrayBuffer());
    const clase = claseDeBytes(cabecera);

    if (clase === "imagen" || archivo.type.startsWith("image/")) {
      return { ...base, texto: "", imagen: true, aviso: "Es una imagen: hay que mirarla para saber qué dice." };
    }

    if (clase === "pdf" || extension === "pdf") {
      const leido = await textoDePdf(await archivo.arrayBuffer());
      if (leido.texto) return { ...base, texto: recortar(leido.texto, tope), paginas: leido.paginas };
      // Por qué no salió texto importa, y mucho: de un escaneado se sale
      // mirándolo, de uno protegido hay que quitarle la contraseña, y de uno
      // con tipografías sin traducción no se sale desde el navegador. Decir
      // «es un escaneado» a las tres cosas mandaba a la gente a hacer capturas
      // de pantalla de documentos que tenían su texto perfectamente puesto.
      return {
        ...base,
        texto: "",
        paginas: leido.paginas,
        // Que se pueda mirar con el modelo, que es lo que resuelve los tres casos.
        mirable: true,
        motivo: leido.motivo,
        aviso: AVISOS_PDF[leido.motivo] || AVISOS_PDF.ilegible
      };
    }

    if (clase === "zip") {
      const buffer = await archivo.arrayBuffer();
      const familia = familiaDeZip(buffer) || EXTENSIONES_ZIP[extension] || "";
      if (familia) {
        const texto = await textoDeOoxml(buffer, familia);
        if (texto) return { ...base, texto: recortar(texto, tope) };
        return { ...base, texto: "", aviso: "El documento se abrió pero no traía texto: puede ser todo imágenes." };
      }
      return { ...base, texto: "", aviso: "Es un archivo comprimido. Descomprímelo y sube el documento que hay dentro." };
    }

    if (clase === "ole" || ["doc", "xls", "ppt"].includes(extension)) {
      return { ...base, texto: "", aviso: `Es un ${extension || "documento"} del formato antiguo de Office. Guárdalo como .docx, .xlsx o .pptx y vuelve a subirlo.` };
    }

    if (clase === "comprimido") {
      return { ...base, texto: "", aviso: "Es un archivo comprimido. Descomprímelo y sube el documento que hay dentro." };
    }

    // Y si no es ninguno de los formatos con firma, se prueba a leerlo como
    // texto: da igual la extensión. Aquí entran .sql, .py, .html, .xml, .log,
    // .yaml, los que no tienen extensión y todo lo demás que sea legible.
    if (pareceTexto(cabecera)) {
      const texto = await archivo.text();
      return texto.trim()
        ? { ...base, texto: recortar(texto, tope) }
        : { ...base, texto: "", aviso: "El archivo no tiene contenido legible." };
    }

    return {
      ...base,
      texto: "",
      aviso: `No se puede leer el contenido de este archivo${extension ? ` (.${extension})` : ""}: no es texto ni un formato conocido. Si es una imagen, súbela como imagen.`
    };
  } catch (error) {
    console.warn("Lectura de documento:", error);
    return { ...base, texto: "", aviso: `No se pudo leer el archivo: ${error.message}` };
  }
}

const recortar = (texto, tope = TOPE_DOCUMENTO) => {
  const limpio = String(texto ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return limpio.length <= tope
    ? limpio
    : `${limpio.slice(0, tope)}\n\n[…el documento sigue; se guardaron los primeros ${tope.toLocaleString("es-CL")} caracteres de ${limpio.length.toLocaleString("es-CL")}…]`;
};

// ── ZIP en el navegador ──────────────────────────────────────────────────────
//
// Word, Excel y PowerPoint modernos son ZIP con XML dentro. El navegador sabe
// descomprimir (DecompressionStream), pero no sabe leer un ZIP: hay que
// recorrer su índice a mano. Son cuarenta líneas y evita cargar una librería.

// Dentro de un ZIP el deflate va crudo, sin la cabecera de zlib. Es lo que lo
// distingue del de un PDF, y confundirlos hace que la descompresión falle sin
// decir por qué.
async function inflar(datos, formato = "deflate-raw") {
  if (typeof DecompressionStream !== "function") throw new Error("el navegador no sabe descomprimir");
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream(formato));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

async function inflarZip(datos, metodo) {
  if (metodo === 0) return datos;                    // guardado sin comprimir
  if (metodo !== 8) throw new Error("compresión no soportada");
  return inflar(datos, "deflate-raw");
}

function entradasZip(buffer) {
  const vista = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // El índice está al final, detrás de un comentario de longitud variable: se
  // busca su firma hacia atrás.
  let fin = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i -= 1) {
    if (vista.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("no parece un archivo ZIP");

  const cuantas = vista.getUint16(fin + 10, true);
  let p = vista.getUint32(fin + 16, true);
  const entradas = [];
  for (let i = 0; i < cuantas; i += 1) {
    if (vista.getUint32(p, true) !== 0x02014b50) break;
    const metodo = vista.getUint16(p + 10, true);
    const comprimido = vista.getUint32(p + 20, true);
    const largoNombre = vista.getUint16(p + 28, true);
    const largoExtra = vista.getUint16(p + 30, true);
    const largoComentario = vista.getUint16(p + 32, true);
    const local = vista.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    entradas.push({ nombre, metodo, comprimido, local });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }

  return {
    entradas,
    // El tamaño del «extra» de la cabecera local no tiene por qué coincidir con
    // el del índice, así que se vuelve a leer aquí en vez de darlo por bueno.
    leer: async entrada => {
      const inicio = entrada.local;
      if (vista.getUint32(inicio, true) !== 0x04034b50) throw new Error("cabecera local rota");
      const datos = bytes.subarray(
        inicio + 30 + vista.getUint16(inicio + 26, true) + vista.getUint16(inicio + 28, true),
        inicio + 30 + vista.getUint16(inicio + 26, true) + vista.getUint16(inicio + 28, true) + entrada.comprimido
      );
      return new TextDecoder().decode(await inflarZip(datos, entrada.metodo));
    }
  };
}

// De XML a texto plano. Se conservan los saltos que marcan párrafos, filas y
// celdas: sin ellos una hoja de cálculo sale como un churro de palabras pegadas.
function textoDeXml(xml) {
  return xml
    .replace(/<\/w:p>|<\/a:p>|<\/text:p>/g, "\n")
    .replace(/<\/(row|si|c)>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ");
}

async function textoDeOoxml(buffer, familia) {
  const zip = entradasZip(buffer);
  const quiere = nombre => {
    if (familia === "word") return nombre === "word/document.xml";
    if (familia === "excel") return nombre === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(nombre);
    return /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(nombre);
  };

  const partes = [];
  // Las diapositivas se ordenan por número: el índice del ZIP no garantiza el
  // orden y una minuta con las diapositivas barajadas no sirve de nada.
  const elegidas = zip.entradas.filter(e => quiere(e.nombre))
    .sort((a, x) => (Number(a.nombre.match(/\d+/)?.[0] ?? 0)) - (Number(x.nombre.match(/\d+/)?.[0] ?? 0)));

  for (const entrada of elegidas) {
    try { partes.push(textoDeXml(await zip.leer(entrada))); } catch { /* una parte ilegible no tumba el resto */ }
  }
  return partes.join("\n\n").trim();
}
