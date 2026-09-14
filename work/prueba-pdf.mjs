// Prueba del lector de PDF.
//
//   node work/prueba-pdf.mjs
//
// Forja PDF en memoria —uno por cada forma de escribir texto que se ha visto
// romper el lector— y comprueba qué saca de cada uno. No hace falta ningún
// archivo de ejemplo ni ninguna dependencia: los PDF se construyen aquí.
//
// El caso que dio origen a todo esto es `tipografiaSubconjuntada`: un PDF
// exportado desde una herramienta de diseño, con la tipografía incrustada y los
// códigos traducidos en /ToUnicode. El lector anterior devolvía cero caracteres
// y la pantalla decía «probablemente es un escaneado» de un documento que
// llevaba su texto perfectamente puesto.

import { deflateSync } from "node:zlib";
import { textoDePdf } from "../public/pdf.js";

const b = s => Buffer.from(s, "latin1");

// Monta un PDF con su tabla de referencias cruzadas. Los objetos se numeran
// desde 1 en el orden en que se pasan.
function armar(objetos, raiz = 1) {
  let salida = b("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  const posiciones = [];
  objetos.forEach((objeto, n) => {
    posiciones.push(salida.length);
    salida = Buffer.concat([salida, b(`${n + 1} 0 obj\n`), Buffer.isBuffer(objeto) ? objeto : b(objeto), b("\nendobj\n")]);
  });
  const xref = salida.length;
  let tabla = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) tabla += `${String(p).padStart(10, "0")} 00000 n \n`;
  tabla += `trailer\n<< /Size ${objetos.length + 1} /Root ${raiz} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.concat([salida, b(tabla)]);
}

const flujo = (datos, extra = "") => {
  const comprimido = deflateSync(Buffer.isBuffer(datos) ? datos : b(datos));
  return Buffer.concat([
    b(`<< ${extra} /Length ${comprimido.length} /Filter /FlateDecode >>\nstream\n`),
    comprimido,
    b("\nendstream")
  ]);
};

const paginaSimple = (contenido, fuentes = "/F1 5 0 R", recursosExtra = "") => [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << ${fuentes} >> ${recursosExtra} >> /Contents 4 0 R >>`,
  flujo(contenido),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
];

// ── Los casos ────────────────────────────────────────────────────────────────

const casos = [];
const caso = (nombre, pdf, comprobar) => casos.push({ nombre, pdf, comprobar });

caso("textoCorriente", armar(paginaSimple(
  "BT /F1 12 Tf 60 780 Td (La espera media fue de 18,4 dias.) Tj ET"
)), r => r.texto.includes("La espera media fue de 18,4 dias."));

// Un flujo comprimido cuyo /Length cuenta el salto de línea de más: es lo que
// escriben la mitad de los generadores, y al lector anterior le hacía fallar la
// descompresión y dar por vacío el documento.
caso("flujoComprimido", armar(paginaSimple(
  "BT /F1 12 Tf 60 780 Td (Comprimido con la cabecera de zlib.) Tj ET"
)), r => r.texto.includes("Comprimido con la cabecera de zlib."));

// Acentos por /Differences: los PDF de LaTeX y los de Office antiguos.
caso("acentosPorDifferences", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  flujo("BT /F1 12 Tf 60 780 Td (Sesi\\363n del comit\\351: ma\\361ana) Tj ET"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 6 0 R >>",
  "<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [233 /eacute 241 /ntilde 243 /oacute] >>"
]), r => r.texto.includes("Sesión del comité: mañana"));

// El caso que rompía todo: tipografía compuesta, subconjuntada, con los códigos
// traducidos en /ToUnicode. Es lo que exporta Chrome, Figma, InDesign y Word.
const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CMapName /Uno def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfrange
<0024> <002d> <0041>
endbfrange
2 beginbfchar
<0003> <0020>
<0048> <0301>
endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end`;
caso("tipografiaSubconjuntada", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  // <0024 0025 0026 0003 0027 0028 0029> = "ABC DEF"
  flujo("BT /F1 12 Tf 60 780 Td <0024002500260003002700280029> Tj ET"),
  "<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Inter /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
  "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Inter >>",
  flujo(cmap)
]), r => r.texto.includes("ABC DEF"));

// La misma tipografía sin /ToUnicode: no hay forma de saber qué letra es cada
// código, y hay que decirlo en vez de devolver ruido o callar.
caso("sinTraduccion", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  flujo("BT /F1 12 Tf 60 780 Td <002400250026> Tj ET"),
  "<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Inter /Encoding /Identity-H /DescendantFonts [6 0 R] >>",
  "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Inter >>"
]), r => !r.texto && r.motivo === "ilegible");

// Una página que es sólo una imagen: el escaneado de verdad.
caso("escaneado", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /I1 5 0 R >> >> /Contents 4 0 R >>",
  flujo("q 595 0 0 842 0 0 cm /I1 Do Q"),
  Buffer.concat([
    b("<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length 4 >>\nstream\n"),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    b("\nendstream")
  ])
]), r => !r.texto && r.motivo === "sin-texto");

// Texto dentro de un formulario: donde lo guardan los PDF de diseño.
caso("formularioXObject", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /X1 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>",
  flujo("q 1 0 0 1 60 700 cm /X1 Do Q\nBT /F1 12 Tf 60 650 Td (Y esto esta fuera.) Tj ET"),
  flujo("BT /F1 14 Tf 0 0 Td (Esto esta dentro del formulario.) Tj ET",
    "/Type /XObject /Subtype /Form /BBox [0 0 400 40] /Resources << /Font << /F1 6 0 R >> >>"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
]), r => r.texto.includes("Esto esta dentro del formulario.") && r.texto.includes("Y esto esta fuera."));

// Una imagen escrita dentro del propio contenido, con bytes que imitan
// operadores. Hay que saltarla sin intentar interpretarla.
caso("imagenIncrustada", armar(paginaSimple(
  "BT /F1 12 Tf 60 780 Td (Antes.) Tj ET\n" +
  "q 100 0 0 50 60 700 cm BI /W 4 /H 4 /CS /G /BPC 8 ID \x00(Tj) ET BT \xff\xfe\x01 EI Q\n" +
  "BT /F1 12 Tf 60 660 Td (Despues.) Tj ET"
)), r => r.texto.includes("Antes.") && r.texto.includes("Despues."));

// El contenido partido en dos flujos con un operador a caballo: son un flujo
// solo y hay que juntarlos antes de leerlos.
caso("contenidoPartido", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents [4 0 R 5 0 R] >>",
  flujo("BT /F1 12 Tf 60 780 Td (Un flujo par"),
  flujo("tido en dos.) Tj ET"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
]), r => r.texto.includes("Un flujo partido en dos."));

// Varias páginas: tienen que salir en el orden del documento, no del archivo.
caso("variasPaginasEnOrden", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
  flujo("BT /F1 12 Tf 60 780 Td (Pagina primera.) Tj ET"),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
  flujo("BT /F1 12 Tf 60 780 Td (Pagina segunda.) Tj ET"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
]), r => r.paginas === 2 && r.texto.indexOf("Pagina primera.") < r.texto.indexOf("Pagina segunda."));

// Los saltos de línea no están escritos en el PDF: se deducen de dónde cae cada
// trozo. Sin eso, un informe entero sale como una sola línea.
caso("lineasSeparadas", armar(paginaSimple(
  "BT /F1 12 Tf 60 780 Td (Primera linea.) Tj 0 -16 Td (Segunda linea.) Tj T* (Tercera linea.) Tj ET"
)), r => r.texto.split("\n").filter(Boolean).length >= 3);

// Un /Length equivocado no puede dejar el documento sin leer.
caso("longitudEquivocada", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  "<< /Length 999999 >>\nstream\nBT /F1 12 Tf 60 780 Td (El Length no vale nada.) Tj ET\nendstream",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
]), r => r.texto.includes("El Length no vale nada."));

// Protegido con contraseña: el aviso tiene que ser el suyo, no el del escaneado.
caso("protegido", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  flujo("BT /F1 12 Tf 60 780 Td <8f2a1b4c9d> Tj ET"),
  "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] >>",
  "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X >>",
  "<< /Filter /Standard /V 2 /R 3 /Length 128 >>"
].map((o, n) => (n === 0 ? o : o))).toString("latin1")
  .replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 7 0 R"),
  r => !r.texto && r.motivo === "cifrado");

// Un PDF moderno de verdad: el catálogo, el árbol de páginas, la página y la
// tipografía viven todos dentro de un flujo de objetos comprimido, y el índice
// del archivo es un flujo con predictor PNG en vez de la tabla de toda la vida.
// Es como escriben Word, Acrobat, Ghostscript y LibreOffice desde hace diez
// años; sin abrir ese flujo, el documento no tiene ni una página.
{
  const dentro = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let cuerpo = "";
  let cabecera = "";
  for (const [n, objeto] of dentro.entries()) {
    cabecera += `${n + 1} ${cuerpo.length} `;
    cuerpo += `${objeto} `;
  }
  const empaquetado = deflateSync(b(cabecera + cuerpo));
  const objstm = Buffer.concat([
    b(`<< /Type /ObjStm /N ${dentro.length} /First ${cabecera.length} /Length ${empaquetado.length} /Filter /FlateDecode >>\nstream\n`),
    empaquetado,
    b("\nendstream")
  ]);
  // Los objetos 1 a 4 no existen sueltos: el 5 es el flujo que los contiene.
  const pdf = armar([
    "<< /Marcador (hueco 1) >>",
    "<< /Marcador (hueco 2) >>",
    "<< /Marcador (hueco 3) >>",
    "<< /Marcador (hueco 4) >>",
    objstm,
    flujo("BT /F1 12 Tf 60 780 Td (Dentro de un flujo de objetos.) Tj ET")
  ]);
  // Se borran los huecos para que el índice no encuentre los objetos sueltos y
  // tenga que sacarlos del flujo, que es lo que se quiere probar.
  const sinHuecos = Buffer.from(
    pdf.toString("latin1").replace(/[1-4] 0 obj\n<< \/Marcador \([^)]*\) >>\nendobj\n/g, ""),
    "latin1"
  );
  caso("flujoDeObjetos", sinHuecos, r => r.paginas === 1 && r.texto.includes("Dentro de un flujo de objetos."));
}

// Los filtros que no son Flate. Salen poco, pero cuando salen es en documentos
// viejos que nadie va a volver a exportar, y un filtro que no se sabe deshacer
// deja el documento en blanco sin decir por qué.
{
  // ASCII85 encadenado sobre Flate, como lo escribe Distiller.
  const a85 = datos => {
    let salida = "";
    for (let i = 0; i < datos.length; i += 4) {
      const trozo = [datos[i] ?? 0, datos[i + 1] ?? 0, datos[i + 2] ?? 0, datos[i + 3] ?? 0];
      const sueltos = Math.min(4, datos.length - i);
      let n = ((trozo[0] * 256 + trozo[1]) * 256 + trozo[2]) * 256 + trozo[3];
      const cinco = [];
      for (let k = 0; k < 5; k += 1) { cinco.unshift(String.fromCharCode(33 + (n % 85))); n = Math.floor(n / 85); }
      salida += cinco.join("").slice(0, sueltos + 1);
    }
    return `${salida}~>`;
  };
  const comprimido = deflateSync(b("BT /F1 12 Tf 60 780 Td (Filtros encadenados.) Tj ET"));
  const texto = a85(comprimido);
  caso("filtrosEncadenados", armar([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${texto.length} /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n${texto}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ]), r => r.texto.includes("Filtros encadenados."));

  // RunLength, que es el filtro más simple que define la norma.
  const contenido = b("BT /F1 12 Tf 60 780 Td (Comprimido por repeticiones.) Tj ET");
  const rle = [];
  for (let i = 0; i < contenido.length; i += 128) {
    const trozo = contenido.subarray(i, i + 128);
    rle.push(trozo.length - 1, ...trozo);
  }
  rle.push(128);
  const crudo = Buffer.from(rle).toString("latin1");
  caso("runLength", armar([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    Buffer.concat([b(`<< /Length ${rle.length} /Filter /RunLengthDecode >>\nstream\n`), Buffer.from(rle), b("\nendstream")]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ]), r => r.texto.includes("Comprimido por repeticiones."));

  // LZW con el cambio temprano de ancho, que es el que usan los PDF antiguos.
  const lzwCodificar = datos => {
    const diccionario = new Map();
    const reiniciar = () => {
      diccionario.clear();
      for (let i = 0; i < 256; i += 1) diccionario.set(String.fromCharCode(i), i);
      return 258;
    };
    let siguiente = reiniciar();
    let ancho = 9;
    const bits = [];
    const emitir = codigo => { for (let k = ancho - 1; k >= 0; k -= 1) bits.push((codigo >> k) & 1); };
    emitir(256);
    let actual = "";
    for (const byte of datos) {
      const letra = String.fromCharCode(byte);
      if (diccionario.has(actual + letra)) { actual += letra; continue; }
      emitir(diccionario.get(actual));
      diccionario.set(actual + letra, siguiente);
      siguiente += 1;
      // El «cambio temprano»: el ancho sube un código antes de tocar el tope.
      if (siguiente + 1 >= (1 << ancho) && ancho < 12) ancho += 1;
      actual = letra;
    }
    if (actual) emitir(diccionario.get(actual));
    emitir(257);
    while (bits.length % 8) bits.push(0);
    const salida = [];
    for (let i = 0; i < bits.length; i += 8) {
      salida.push(bits.slice(i, i + 8).reduce((n, x) => (n << 1) | x, 0));
    }
    return Buffer.from(salida);
  };
  const fuente = b("BT /F1 12 Tf 60 780 Td (Comprimido con LZW, como Distiller.) Tj ET");
  const comprimidoLzw = lzwCodificar(fuente);
  caso("lzw", armar([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    Buffer.concat([
      b(`<< /Length ${comprimidoLzw.length} /Filter /LZWDecode >>\nstream\n`),
      comprimidoLzw,
      b("\nendstream")
    ]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ]), r => r.texto.includes("Comprimido con LZW, como Distiller."));
}

// Predictor PNG sobre un flujo de objetos: así lo escribe Acrobat.
{
  const dentro = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let cuerpo = "";
  let cabecera = "";
  for (const [n, objeto] of dentro.entries()) {
    cabecera += `${n + 1} ${cuerpo.length} `;
    cuerpo += `${objeto} `;
  }
  const llano = b(cabecera + cuerpo);
  // Se codifica con el filtro PNG «Up» (tipo 2), fila a fila.
  const columnas = 16;
  const filas = Math.ceil(llano.length / columnas);
  const predicho = Buffer.alloc(filas * (columnas + 1));
  const anterior = Buffer.alloc(columnas);
  for (let f = 0; f < filas; f += 1) {
    const fila = Buffer.alloc(columnas);
    llano.copy(fila, 0, f * columnas, Math.min(llano.length, (f + 1) * columnas));
    predicho[f * (columnas + 1)] = 2;
    for (let i = 0; i < columnas; i += 1) {
      predicho[f * (columnas + 1) + 1 + i] = (fila[i] - anterior[i]) & 255;
      anterior[i] = fila[i];
    }
  }
  const empaquetado = deflateSync(predicho);
  const pdf = armar([
    "<< /Marcador (hueco 1) >>",
    "<< /Marcador (hueco 2) >>",
    "<< /Marcador (hueco 3) >>",
    "<< /Marcador (hueco 4) >>",
    Buffer.concat([
      b(`<< /Type /ObjStm /N ${dentro.length} /First ${cabecera.length} /Length ${empaquetado.length} `
        + `/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${columnas} >> >>\nstream\n`),
      empaquetado,
      b("\nendstream")
    ]),
    flujo("BT /F1 12 Tf 60 780 Td (Con predictor PNG, como Acrobat.) Tj ET")
  ]);
  const sinHuecos = Buffer.from(
    pdf.toString("latin1").replace(/[1-4] 0 obj\n<< \/Marcador \([^)]*\) >>\nendobj\n/g, ""),
    "latin1"
  );
  caso("predictorPng", sinHuecos, r => r.paginas === 1 && r.texto.includes("Con predictor PNG, como Acrobat."));
}

// Un documento que habla de PDF, con la sintaxis de un objeto escrita dentro de
// su propio texto. El índice se construye recorriendo el archivo, así que esa
// frase parece la definición del objeto 3 —la página— y podría suplantarla.
caso("textoQueImitaUnObjeto", armar([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  flujo("BT /F1 12 Tf 60 780 Td (Un PDF empieza cada objeto con) Tj "
    + "T* (3 0 obj << /Nada true >> endobj) Tj "
    + "T* (y lo cierra con endobj.) Tj ET"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
]), r => r.paginas === 1 && r.texto.includes("Un PDF empieza cada objeto con") && r.texto.includes("y lo cierra con endobj."));

// Un archivo que no es un PDF no puede hacer estallar nada.
caso("basura", Buffer.from("esto no es un PDF, ni de lejos".repeat(50)),
  r => !r.texto && typeof r.motivo === "string");

caso("vacio", Buffer.alloc(0), r => !r.texto);

// ── A correr ─────────────────────────────────────────────────────────────────

let fallos = 0;
for (const { nombre, pdf, comprobar } of casos) {
  const datos = typeof pdf === "string" ? Buffer.from(pdf, "latin1") : pdf;
  let resultado;
  try {
    resultado = await textoDePdf(datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength));
  } catch (error) {
    console.error(`✗ ${nombre}: estalló — ${error.stack}`);
    fallos += 1;
    continue;
  }
  if (comprobar(resultado)) {
    const resumen = resultado.texto
      ? `${resultado.texto.length} car., ${resultado.paginas} pág.`
      : `sin texto (${resultado.motivo})`;
    console.log(`✓ ${nombre} — ${resumen}`);
  } else {
    console.error(`✗ ${nombre} — motivo="${resultado.motivo}" texto=${JSON.stringify(resultado.texto.slice(0, 200))}`);
    fallos += 1;
  }
}

if (fallos) {
  console.error(`\n${fallos} de ${casos.length} casos fallaron.`);
  process.exit(1);
}
console.log(`\nLos ${casos.length} casos pasan.`);
