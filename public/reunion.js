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

  abrir({ titulo = "", objetivo = "", antecedente = null, tipo = "operacional", cuaderno = "" } = {}) {
    this.olvidar();
    this.abierta = true;
    this.inicio = Date.now();
    this.id = `r-${this.inicio}`;
    this.titulo = titulo;
    this.objetivo = objetivo;
    this.antecedente = antecedente;
    this.tipo = tipo;
    this.cuaderno = cuaderno;
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

  anotarTurno(texto) {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    const turno = { t: Date.now(), hablante: this.hablante || SIN_NOMBRE, texto: limpio, origen: "CONVERSACION" };
    this.turnos.push(turno);
    return turno;
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

export async function leerDocumento(archivo) {
  const nombre = archivo.name || "documento";
  const extension = (nombre.split(".").pop() || "").toLowerCase();
  const base = { nombre, tipo: archivo.type || extension, tamano: archivo.size };

  try {
    if (archivo.type.startsWith("image/")) {
      return { ...base, texto: "", aviso: "Es una imagen: no se puede leer su contenido. Descríbela para que quede en la minuta." };
    }
    if (archivo.type.startsWith("text/") || ["txt", "md", "csv", "json", "rtf"].includes(extension)) {
      return { ...base, texto: recortar(await archivo.text()) };
    }
    if (extension === "pdf") {
      const texto = await textoDePdf(await archivo.arrayBuffer());
      return texto
        ? { ...base, texto: recortar(texto) }
        : { ...base, texto: "", aviso: "No se pudo extraer el texto de este PDF (puede ser un escaneado). Descríbelo para que quede en la minuta." };
    }
    if (EXTENSIONES_ZIP[extension]) {
      const texto = await textoDeOoxml(await archivo.arrayBuffer(), EXTENSIONES_ZIP[extension]);
      return texto
        ? { ...base, texto: recortar(texto) }
        : { ...base, texto: "", aviso: "El archivo se abrió pero no traía texto legible. Descríbelo para que quede en la minuta." };
    }
    if (["doc", "xls", "ppt"].includes(extension)) {
      return { ...base, texto: "", aviso: `Los archivos .${extension} son del formato antiguo y no se pueden leer aquí. Guárdalo como .${extension}x y vuelve a añadirlo, o descríbelo.` };
    }
    return { ...base, texto: "", aviso: "No se reconoce este formato. Descríbelo para que quede en la minuta." };
  } catch (error) {
    console.warn("Lectura de documento:", error);
    return { ...base, texto: "", aviso: "No se pudo leer el archivo. Descríbelo para que quede en la minuta." };
  }
}

const recortar = texto => {
  const limpio = String(texto ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return limpio.length <= TOPE_DOCUMENTO
    ? limpio
    : `${limpio.slice(0, TOPE_DOCUMENTO)}\n\n[…el documento sigue; se guardaron los primeros ${TOPE_DOCUMENTO} caracteres…]`;
};

// ── ZIP en el navegador ──────────────────────────────────────────────────────
//
// Word, Excel y PowerPoint modernos son ZIP con XML dentro. El navegador sabe
// descomprimir (DecompressionStream), pero no sabe leer un ZIP: hay que
// recorrer su índice a mano. Son cuarenta líneas y evita cargar una librería.

// Los dos formatos no son el mismo: dentro de un ZIP el deflate va crudo, y
// dentro de un PDF va envuelto en la cabecera de zlib. Confundirlos es el error
// que hace que la descompresión falle sin decir por qué.
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

// ── PDF en el navegador ──────────────────────────────────────────────────────
//
// Extracción best-effort: se descomprimen los flujos de contenido y se recogen
// los operadores de texto. Con un PDF normal sale bien; con uno escaneado no
// hay texto que sacar, y con tipografías incrustadas de codificación propia
// sale ilegible. Ese último caso se detecta abajo y se dice, en vez de meter
// basura en la minuta.

async function textoDePdf(buffer) {
  const bytes = new Uint8Array(buffer);
  const crudo = new TextDecoder("latin1").decode(bytes);
  const trozos = [];

  const marca = /stream\r?\n/g;
  let encuentro;
  while ((encuentro = marca.exec(crudo)) !== null) {
    const inicio = encuentro.index + encuentro[0].length;
    const fin = crudo.indexOf("endstream", inicio);
    if (fin < 0) continue;
    const cabecera = crudo.slice(Math.max(0, encuentro.index - 300), encuentro.index);
    // Sólo interesan los flujos de contenido; las imágenes se saltan porque
    // descomprimirlas cuesta y no aportan texto.
    if (/\/Subtype\s*\/Image/.test(cabecera)) continue;

    let contenido = bytes.subarray(inicio, fin);
    if (/\/FlateDecode/.test(cabecera)) {
      try {
        contenido = await inflar(contenido, "deflate");
      } catch {
        // Algunos generadores escriben el flujo sin la cabecera de zlib. Se
        // reintenta como deflate crudo antes de darlo por perdido.
        try { contenido = await inflar(contenido, "deflate-raw"); } catch { continue; }
      }
    }
    trozos.push(new TextDecoder("latin1").decode(contenido));
  }

  const texto = trozos.map(operadoresDeTexto).join("\n").trim();
  return legible(texto) ? texto : "";
}

// De los operadores de dibujo a las palabras. `Tj` pinta una cadena y `TJ` una
// lista donde los números son ajustes de espaciado: los grandes son un espacio.
function operadoresDeTexto(flujo) {
  const lineas = [];
  const patron = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\][\\]|\\.)*\]\s*TJ|\bT\*|\bTd\b|\bTD\b/g;
  let encuentro;
  let linea = "";
  while ((encuentro = patron.exec(flujo)) !== null) {
    const pieza = encuentro[0];
    if (["T*", "Td", "TD"].includes(pieza.trim())) { if (linea.trim()) lineas.push(linea.trim()); linea = ""; continue; }
    if (pieza.endsWith("Tj")) {
      linea += cadenaPdf(pieza.slice(pieza.indexOf("(") + 1, pieza.lastIndexOf(")")));
      continue;
    }
    const interior = pieza.slice(pieza.indexOf("[") + 1, pieza.lastIndexOf("]"));
    for (const parte of interior.match(/\((?:\\.|[^\\()])*\)|-?[\d.]+/g) ?? []) {
      if (parte.startsWith("(")) linea += cadenaPdf(parte.slice(1, -1));
      else if (Number(parte) < -120) linea += " ";
    }
  }
  if (linea.trim()) lineas.push(linea.trim());
  return lineas.join("\n");
}

function cadenaPdf(cruda) {
  return cruda.replace(/\\(\d{1,3}|.)/g, (_, escape) => {
    if (/^\d+$/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    return { n: "\n", r: "\n", t: "\t", b: "", f: "" }[escape] ?? escape;
  });
}

// ¿Esto es texto o es ruido? Un PDF con tipografía de codificación propia
// devuelve secuencias sin vocales ni espacios; meterlas en la minuta sería peor
// que decir que no se pudo leer.
function legible(texto) {
  if (texto.length < 20) return false;
  const letras = (texto.match(/[a-záéíóúñüA-ZÁÉÍÓÚÑÜ]/g) ?? []).length;
  const espacios = (texto.match(/\s/g) ?? []).length;
  return letras / texto.length > 0.5 && espacios / texto.length > 0.08;
}
