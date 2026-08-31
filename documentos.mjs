// Documentos de la reunión: Word y PDF, sin instalar nada.
//
// El proyecto no tiene dependencias y no las va a tener: se despliega en Vercel
// como funciones sueltas y cada paquete que se añade es una superficie más que
// mantener. Así que los dos formatos se escriben a mano.
//
//   .docx  es un ZIP con XML dentro (OOXML). Se arma el ZIP con zlib, que ya
//          viene en Node, y se escriben las cuatro partes mínimas que Word
//          exige para abrir el archivo sin protestar.
//   .pdf   se escribe directo, con las fuentes base-14 que todo lector trae
//          incorporadas (Helvetica). No hay que incrustar tipografías, pero sí
//          medir el texto a mano para partir las líneas: de ahí las tablas de
//          anchos de más abajo.
//
// Las dos salidas se componen desde la MISMA lista de bloques, para que la
// minuta y la transcripción no se separen con el tiempo.

import { deflateRawSync } from "node:zlib";

// ── Modelo común ─────────────────────────────────────────────────────────────
//
// Un documento es una lista de bloques. Cada bloque sabe qué es, no cómo se ve:
// el aspecto lo pone cada formato. Tipos:
//
//   titulo | subtitulo | seccion | parrafo | vineta | dato | tabla | separador
//
// `dato` es la pareja etiqueta/valor de la portada («Fecha: 12 de marzo»).
// `tabla` lleva `columnas` (cabeceras) y `filas` (arrays de celdas).

export const bloque = {
  titulo: texto => ({ tipo: "titulo", texto }),
  subtitulo: texto => ({ tipo: "subtitulo", texto }),
  seccion: texto => ({ tipo: "seccion", texto }),
  parrafo: texto => ({ tipo: "parrafo", texto }),
  vineta: texto => ({ tipo: "vineta", texto }),
  dato: (etiqueta, texto) => ({ tipo: "dato", etiqueta, texto }),
  tabla: (columnas, filas) => ({ tipo: "tabla", columnas, filas }),
  separador: () => ({ tipo: "separador" })
};

// ── ZIP mínimo ───────────────────────────────────────────────────────────────

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = TABLA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Fecha MS-DOS. Se fija a una constante en vez de usar la de ahora: así el mismo
// contenido produce siempre el mismo archivo, lo que hace comparables dos
// generaciones seguidas al depurar.
const HORA_DOS = 0;
const FECHA_DOS = (2020 - 1980) << 9 | 1 << 5 | 1;

function escribirZip(entradas) {
  const locales = [];
  const central = [];
  let desplazamiento = 0;

  for (const { nombre, datos } of entradas) {
    const nombreBuf = Buffer.from(nombre, "utf8");
    const comprimido = deflateRawSync(datos, { level: 9 });
    const suma = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // versión necesaria
    local.writeUInt16LE(0x0800, 6);    // nombres en UTF-8
    local.writeUInt16LE(8, 8);         // deflate
    local.writeUInt16LE(HORA_DOS, 10);
    local.writeUInt16LE(FECHA_DOS, 12);
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBuf, comprimido);

    const ficha = Buffer.alloc(46);
    ficha.writeUInt32LE(0x02014b50, 0);
    ficha.writeUInt16LE(20, 4);
    ficha.writeUInt16LE(20, 6);
    ficha.writeUInt16LE(0x0800, 8);
    ficha.writeUInt16LE(8, 10);
    ficha.writeUInt16LE(HORA_DOS, 12);
    ficha.writeUInt16LE(FECHA_DOS, 14);
    ficha.writeUInt32LE(suma, 16);
    ficha.writeUInt32LE(comprimido.length, 20);
    ficha.writeUInt32LE(datos.length, 24);
    ficha.writeUInt16LE(nombreBuf.length, 28);
    ficha.writeUInt32LE(0, 30);        // extra + comentario
    ficha.writeUInt16LE(0, 34);        // disco
    ficha.writeUInt16LE(0, 36);        // atributos internos
    ficha.writeUInt32LE(0, 38);        // atributos externos
    ficha.writeUInt32LE(desplazamiento, 42);
    central.push(ficha, nombreBuf);

    desplazamiento += local.length + nombreBuf.length + comprimido.length;
  }

  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([...locales, directorio, fin]);
}

// ── Word ─────────────────────────────────────────────────────────────────────

const xml = texto => String(texto ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  // Los caracteres de control rompen el XML y Word se niega a abrir el archivo
  // sin decir por qué. Vienen de transcripciones y de documentos pegados.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// Medidas de Word: los tamaños de letra van en medios puntos y los espacios en
// vigésimas de punto. Se dejan a la vista para no repartir multiplicaciones
// mágicas por el resto del archivo.
const medioPunto = puntos => Math.round(puntos * 2);
const veinteavo = puntos => Math.round(puntos * 20);

function parrafoWord(texto, { tamano = 11, negrita = false, color = "1D1D1F",
  antes = 0, despues = 8, sangria = 0, vineta = false, mayusculas = false } = {}) {
  const props = [
    `<w:spacing w:before="${veinteavo(antes)}" w:after="${veinteavo(despues)}" w:line="276" w:lineRule="auto"/>`,
    sangria ? `<w:ind w:left="${veinteavo(sangria)}" w:hanging="${vineta ? veinteavo(12) : 0}"/>` : ""
  ].filter(Boolean).join("");
  const runProps = [
    `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>`,
    negrita ? "<w:b/>" : "",
    mayusculas ? "<w:caps/><w:spacing w:val=\"20\"/>" : "",
    `<w:color w:val="${color}"/>`,
    `<w:sz w:val="${medioPunto(tamano)}"/>`
  ].filter(Boolean).join("");
  return `<w:p><w:pPr>${props}</w:pPr>`
    + `<w:r><w:rPr>${runProps}</w:rPr>`
    + `<w:t xml:space="preserve">${xml((vineta ? "•  " : "") + texto)}</w:t></w:r></w:p>`;
}

function tablaWord(columnas, filas) {
  const ancho = Math.floor(9000 / Math.max(columnas.length, 1));
  const celda = (texto, negrita, fondo) =>
    `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>`
    + (fondo ? `<w:shd w:val="clear" w:fill="${fondo}"/>` : "")
    + `</w:tcPr>${parrafoWord(texto, { tamano: 9.5, negrita, despues: 2, antes: 2 })}</w:tc>`;

  const bordes = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map(lado => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="D8D8DE"/>`).join("");

  const cabecera = `<w:tr><w:trPr><w:tblHeader/></w:trPr>`
    + columnas.map(c => celda(c, true, "F0F0F4")).join("") + "</w:tr>";
  const cuerpo = filas.map(fila =>
    `<w:tr>${columnas.map((_, i) => celda(fila[i] ?? "", false, "")).join("")}</w:tr>`).join("");

  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>`
    + `<w:tblBorders>${bordes}</w:tblBorders></w:tblPr>`
    + `<w:tblGrid>${columnas.map(() => `<w:gridCol w:w="${ancho}"/>`).join("")}</w:tblGrid>`
    + cabecera + cuerpo + "</w:tbl>";
}

function cuerpoWord(bloques) {
  return bloques.map(b => {
    if (b.tipo === "titulo") return parrafoWord(b.texto, { tamano: 22, negrita: true, color: "051C2C", despues: 4 });
    if (b.tipo === "subtitulo") return parrafoWord(b.texto, { tamano: 11, color: "6E6E73", despues: 18 });
    if (b.tipo === "seccion") return parrafoWord(b.texto, { tamano: 9, negrita: true, color: "0071E3", antes: 16, despues: 6, mayusculas: true });
    if (b.tipo === "vineta") return parrafoWord(b.texto, { sangria: 16, vineta: true, despues: 4 });
    if (b.tipo === "dato") return parrafoWord(`${b.etiqueta}: ${b.texto}`, { tamano: 10, color: "3A3A3C", despues: 2 });
    if (b.tipo === "tabla") return tablaWord(b.columnas, b.filas);
    if (b.tipo === "separador") return parrafoWord("", { despues: 10 });
    return parrafoWord(b.texto, { despues: 8 });
  }).join("");
}

export function construirDocx(bloques) {
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}"><w:body>${cuerpoWord(bloques)}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>
</w:sectPr></w:body></w:document>`;

  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const raiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const relDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${rel}/styles" Target="styles.xml"/>
</Relationships>`;

  return escribirZip([
    { nombre: "[Content_Types].xml", datos: Buffer.from(tipos, "utf8") },
    { nombre: "_rels/.rels", datos: Buffer.from(raiz, "utf8") },
    { nombre: "word/document.xml", datos: Buffer.from(documento, "utf8") },
    { nombre: "word/_rels/document.xml.rels", datos: Buffer.from(relDoc, "utf8") },
    { nombre: "word/styles.xml", datos: Buffer.from(estilos, "utf8") }
  ]);
}

// ── PDF ──────────────────────────────────────────────────────────────────────
//
// Anchos de las fuentes base-14, en milésimas de punto, para los caracteres
// visibles del ASCII. Sin ellos no se puede partir una línea en el sitio
// correcto y el texto se sale del margen. Los acentuados no están: en Helvetica
// una «á» avanza lo mismo que una «a», así que se miden por su letra base.

const ANCHOS_NORMAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const ANCHOS_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

// Los acentuados y la puntuación española se miden por la letra que llevan
// debajo. No es una aproximación: en las base-14 el avance es el mismo.
const BASE = {
  "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n",
  "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U", "Ñ": "N",
  "¿": "?", "¡": "!", "«": "\"", "»": "\"", "—": "-", "–": "-", "·": ".",
  "'": "'", "'": "'", "“": "\"", "”": "\"", "…": "...", "º": "o", "ª": "a", "€": "$"
};

function anchoDeCaracter(caracter, negrita) {
  const tabla = negrita ? ANCHOS_NEGRITA : ANCHOS_NORMAL;
  const base = BASE[caracter] ?? caracter;
  if (base.length > 1) {
    // «…» se mide como los tres puntos que va a dibujar.
    let suma = 0;
    for (const c of base) suma += anchoDeCaracter(c, negrita);
    return suma;
  }
  const codigo = base.charCodeAt(0);
  return codigo >= 32 && codigo <= 126 ? tabla[codigo - 32] : tabla[0];
}

function medir(texto, tamano, negrita) {
  let total = 0;
  for (const caracter of String(texto)) total += anchoDeCaracter(caracter, negrita);
  return (total / 1000) * tamano;
}

function partirEnLineas(texto, ancho, tamano, negrita) {
  const lineas = [];
  for (const bruto of String(texto ?? "").split("\n")) {
    const palabras = bruto.split(/\s+/).filter(Boolean);
    if (!palabras.length) { lineas.push(""); continue; }
    let linea = "";
    for (const palabra of palabras) {
      const tentativa = linea ? `${linea} ${palabra}` : palabra;
      if (medir(tentativa, tamano, negrita) <= ancho) { linea = tentativa; continue; }
      if (linea) lineas.push(linea);
      // Una palabra sola más ancha que la caja (una dirección web larga) se
      // corta por donde quepa: es feo, pero salirse del papel lo es más.
      linea = palabra;
      while (medir(linea, tamano, negrita) > ancho && linea.length > 1) {
        let corte = linea.length - 1;
        while (corte > 1 && medir(linea.slice(0, corte), tamano, negrita) > ancho) corte -= 1;
        lineas.push(linea.slice(0, corte));
        linea = linea.slice(corte);
      }
    }
    if (linea) lineas.push(linea);
  }
  return lineas;
}

// WinAnsiEncoding: casi todo cae en Latin-1, salvo la comilla tipográfica y la
// raya, que en Windows viven en el hueco 0x80-0x9F.
const WINANSI = { "—": 0x97, "–": 0x96, "'": 0x91, "'": 0x92, "“": 0x93, "”": 0x94, "…": 0x85, "€": 0x80, "•": 0x95 };

function textoPdf(texto) {
  const bytes = [];
  for (const caracter of String(texto)) {
    const especial = WINANSI[caracter];
    const codigo = especial ?? caracter.charCodeAt(0);
    // Fuera de Latin-1 no hay glifo en estas fuentes; se sustituye para no
    // escribir un byte que el lector interpretaría como otra letra.
    const byte = codigo <= 0xff ? codigo : 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c);   // ( ) \
    bytes.push(byte);
  }
  return Buffer.from(bytes).toString("latin1");
}

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 56;
const CAJA = A4.ancho - MARGEN * 2;

// Cómo se ve cada bloque en el PDF: tamaño, si va en negrita, el color y el aire
// de arriba y de abajo. Es la única tabla de estilo del formato.
const ESTILO = {
  titulo: { tamano: 22, negrita: true, color: [0.02, 0.11, 0.17], antes: 0, despues: 6 },
  subtitulo: { tamano: 10.5, negrita: false, color: [0.43, 0.43, 0.45], antes: 0, despues: 18 },
  seccion: { tamano: 8.5, negrita: true, color: [0, 0.44, 0.89], antes: 18, despues: 8 },
  parrafo: { tamano: 10.5, negrita: false, color: [0.11, 0.11, 0.12], antes: 0, despues: 9 },
  vineta: { tamano: 10.5, negrita: false, color: [0.11, 0.11, 0.12], antes: 0, despues: 5 },
  dato: { tamano: 9.5, negrita: false, color: [0.23, 0.23, 0.24], antes: 0, despues: 3 }
};

class LienzoPdf {
  constructor() {
    this.paginas = [];
    this.nuevaPagina();
  }

  nuevaPagina() {
    this.actual = [];
    this.paginas.push(this.actual);
    this.y = A4.alto - MARGEN;
  }

  sitio(alto) {
    if (this.y - alto < MARGEN) this.nuevaPagina();
  }

  escribir(texto, x, tamano, negrita, color) {
    const [r, g, b] = color;
    this.actual.push(
      `BT /${negrita ? "F2" : "F1"} ${tamano} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`
      + ` 1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm (${textoPdf(texto)}) Tj ET`
    );
  }

  linea(x1, x2, grosor, color) {
    const [r, g, b] = color;
    this.actual.push(
      `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${grosor} w`
      + ` ${x1.toFixed(2)} ${this.y.toFixed(2)} m ${x2.toFixed(2)} ${this.y.toFixed(2)} l S`
    );
  }

  rectangulo(x, ancho, alto, color) {
    const [r, g, b] = color;
    this.actual.push(
      `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`
      + ` ${x.toFixed(2)} ${(this.y - alto + 3).toFixed(2)} ${ancho.toFixed(2)} ${alto.toFixed(2)} re f`
    );
  }
}

function pintarTabla(lienzo, columnas, filas) {
  const anchos = repartirColumnas(columnas.length);
  const alto = 13;
  const dibujarFila = (celdas, negrita, fondo) => {
    // Cada celda se parte por su cuenta; la fila mide lo que la celda más alta.
    const partidas = celdas.map((celda, i) =>
      partirEnLineas(celda ?? "", anchos[i] - 10, 9, negrita));
    const lineas = Math.max(1, ...partidas.map(p => p.length));
    lienzo.sitio(lineas * alto + 6);
    if (fondo) lienzo.rectangulo(MARGEN, CAJA, lineas * alto + 3, fondo);
    const arriba = lienzo.y;
    partidas.forEach((trozos, i) => {
      const x = MARGEN + anchos.slice(0, i).reduce((a, b) => a + b, 0) + 5;
      lienzo.y = arriba;
      trozos.forEach(t => { lienzo.escribir(t, x, 9, negrita, [0.11, 0.11, 0.12]); lienzo.y -= alto; });
    });
    lienzo.y = arriba - lineas * alto;
    lienzo.linea(MARGEN, MARGEN + CAJA, 0.5, [0.85, 0.85, 0.87]);
    lienzo.y -= 4;
  };

  dibujarFila(columnas, true, [0.95, 0.95, 0.97]);
  filas.forEach(fila => dibujarFila(columnas.map((_, i) => fila[i] ?? ""), false, null));
}

// La primera columna se lleva el espacio sobrante: en las tablas de acuerdos es
// la que trae el texto largo y las otras son fechas y nombres cortos.
function repartirColumnas(cuantas) {
  if (cuantas <= 1) return [CAJA];
  const estrecha = Math.min(95, (CAJA * 0.8) / (cuantas - 1));
  return [CAJA - estrecha * (cuantas - 1), ...Array(cuantas - 1).fill(estrecha)];
}

export function construirPdf(bloques, { titulo = "Documento" } = {}) {
  const lienzo = new LienzoPdf();

  for (const b of bloques) {
    if (b.tipo === "separador") {
      lienzo.sitio(16);
      lienzo.y -= 6;
      lienzo.linea(MARGEN, MARGEN + CAJA, 0.5, [0.87, 0.87, 0.89]);
      lienzo.y -= 12;
      continue;
    }
    if (b.tipo === "tabla") {
      pintarTabla(lienzo, b.columnas, b.filas);
      continue;
    }

    const estilo = ESTILO[b.tipo] ?? ESTILO.parrafo;
    const texto = b.tipo === "dato" ? `${b.etiqueta}: ${b.texto}` : b.texto;
    const sangria = b.tipo === "vineta" ? 14 : 0;
    const lineas = partirEnLineas(b.tipo === "seccion" ? String(texto).toUpperCase() : texto,
      CAJA - sangria, estilo.tamano, estilo.negrita);

    lienzo.y -= estilo.antes;
    lineas.forEach((linea, i) => {
      lienzo.sitio(estilo.tamano * 1.4);
      if (b.tipo === "vineta" && i === 0) {
        lienzo.escribir("•", MARGEN, estilo.tamano, false, [0, 0.44, 0.89]);
      }
      lienzo.escribir(linea, MARGEN + sangria, estilo.tamano, estilo.negrita, estilo.color);
      lienzo.y -= estilo.tamano * 1.4;
    });
    lienzo.y -= estilo.despues;
  }

  return ensamblarPdf(lienzo.paginas, titulo);
}

function ensamblarPdf(paginas, titulo) {
  const objetos = [];
  const anadir = cuerpo => { objetos.push(cuerpo); return objetos.length; };

  // Reservados: 1 catálogo, 2 índice de páginas, 3-4 las dos fuentes.
  objetos.push("", "", "", "");
  objetos[2] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>";
  objetos[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>";

  const idsPagina = [];
  for (const ordenes of paginas) {
    const flujo = ordenes.join("\n");
    const idFlujo = anadir(`<</Length ${Buffer.byteLength(flujo, "latin1")}>>\nstream\n${flujo}\nendstream`);
    const idPagina = anadir(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${A4.ancho.toFixed(2)} ${A4.alto.toFixed(2)}]`
      + `/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${idFlujo} 0 R>>`);
    idsPagina.push(idPagina);
  }

  objetos[0] = "<</Type/Catalog/Pages 2 0 R>>";
  objetos[1] = `<</Type/Pages/Kids[${idsPagina.map(id => `${id} 0 R`).join(" ")}]/Count ${idsPagina.length}>>`;
  const idInfo = anadir(`<</Title (${textoPdf(titulo)})/Producer (Catalina)>>`);

  let salida = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const posiciones = [];
  objetos.forEach((cuerpo, i) => {
    posiciones.push(Buffer.byteLength(salida, "latin1"));
    salida += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });

  const inicioTabla = Buffer.byteLength(salida, "latin1");
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  posiciones.forEach(p => { salida += `${String(p).padStart(10, "0")} 00000 n \n`; });
  salida += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R/Info ${idInfo} 0 R>>\n`
    + `startxref\n${inicioTabla}\n%%EOF\n`;

  return Buffer.from(salida, "latin1");
}
