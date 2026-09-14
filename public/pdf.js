// Texto de un PDF, sacado en el propio navegador.
//
// Por qué a mano y no con una librería: el archivo no sale de aquí, y cargar
// pdf.js —más de un mega— para leer un informe de cuatro páginas es caro en una
// pantalla que además está sosteniendo una conversación por voz.
//
// Lo que hay debajo es un lector de PDF reducido a lo justo para sacar texto:
//
//   1. Índice de objetos        recorriendo «N G obj» por todo el archivo
//   2. Objetos comprimidos      /Type /ObjStm, que es donde los guardan los PDF
//                               de 2015 en adelante
//   3. Filtros                  Flate, LZW, ASCIIHex, ASCII85 y RunLength, con
//                               predictores PNG y TIFF
//   4. Árbol de páginas         para saber qué tipografía usa cada texto
//   5. CMaps /ToUnicode         la traducción de código de glifo a letra
//   6. Operadores de texto      Tj, TJ, ' y ", con Tm/Td/T* para cortar líneas
//
// El punto 5 es el que de verdad importa. Las tipografías incrustadas viajan
// subconjuntadas —«AAAAAA+LiberationSans»— y sus códigos no son Unicode ni se
// le parecen: en un PDF de Chrome, de Figma o de InDesign la letra «D» puede
// ser el código 0x0027. El PDF trae la traducción en /ToUnicode y hay que
// usarla. Sin ella lo que sale es ruido, y un lector que confunda ese ruido con
// «aquí no hay texto» acaba diciéndole a la gente que su PDF es un escaneado
// cuando no lo es.

// ── Piezas del lenguaje de PDF ───────────────────────────────────────────────

const ESPACIOS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITADORES = new Set([...'()<>[]{}/%'].map(c => c.charCodeAt(0)));
const esEspacio = c => ESPACIOS.has(c);
const esRegular = c => !ESPACIOS.has(c) && !DELIMITADORES.has(c);

// Un nombre (/Type) y una referencia (12 0 R) no son cadenas: si lo fueran, un
// documento que se llamara «Page» se confundiría con el tipo de objeto.
class Nombre { constructor(v) { this.v = v; } }
class Ref { constructor(n) { this.n = n; } }

const nombreDe = v => (v instanceof Nombre ? v.v : "");
// Las cadenas de PDF se guardan como texto latin1: cada carácter es un byte, ni
// más ni menos. Eso deja intactos los códigos de dos bytes de las tipografías
// compuestas, que es justo lo que hay que traducir después.
const bytesDeCadena = s => [...s].map(c => c.charCodeAt(0) & 0xff);

// Lector de fichas. Sirve igual para el cuerpo del archivo y para un flujo de
// contenido: la sintaxis es la misma, sólo cambia qué se hace con lo leído.
class Lector {
  constructor(s, i = 0) { this.s = s; this.i = i; this.cola = []; }

  saltar() {
    const { s } = this;
    for (;;) {
      while (this.i < s.length && esEspacio(s.charCodeAt(this.i))) this.i += 1;
      if (s[this.i] !== "%") return;
      while (this.i < s.length && s[this.i] !== "\n" && s[this.i] !== "\r") this.i += 1;
    }
  }

  ficha() {
    if (this.cola.length) return this.cola.pop();
    this.saltar();
    const { s } = this;
    if (this.i >= s.length) return { tipo: "fin" };
    const c = s[this.i];

    if (c === "<") {
      if (s[this.i + 1] === "<") { this.i += 2; return { tipo: "dic-ini" }; }
      return this.hex();
    }
    if (c === ">") { this.i += s[this.i + 1] === ">" ? 2 : 1; return { tipo: "dic-fin" }; }
    if (c === "[") { this.i += 1; return { tipo: "arr-ini" }; }
    if (c === "]") { this.i += 1; return { tipo: "arr-fin" }; }
    if (c === "(") return this.literal();
    if (c === "/") return this.nombre();
    if (c === "{" || c === "}") { this.i += 1; return { tipo: "palabra", valor: c }; }

    const inicio = this.i;
    while (this.i < s.length && esRegular(s.charCodeAt(this.i))) this.i += 1;
    // Un byte que no es ni regular ni conocido: se traga para no dar vueltas.
    if (this.i === inicio) { this.i += 1; return { tipo: "palabra", valor: c }; }
    const palabra = s.slice(inicio, this.i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palabra)) return { tipo: "num", valor: Number(palabra) };
    return { tipo: "palabra", valor: palabra };
  }

  devolver(f) { this.cola.push(f); }

  nombre() {
    const { s } = this;
    this.i += 1;
    const inicio = this.i;
    while (this.i < s.length && esRegular(s.charCodeAt(this.i))) this.i += 1;
    // #41 es una «A»: así se escriben en un nombre los caracteres raros.
    const crudo = s.slice(inicio, this.i).replace(/#([\da-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return { tipo: "nombre", valor: crudo };
  }

  hex() {
    const { s } = this;
    this.i += 1;
    const fin = s.indexOf(">", this.i);
    const cuerpo = (fin < 0 ? s.slice(this.i) : s.slice(this.i, fin)).replace(/[^\da-fA-F]/g, "");
    this.i = fin < 0 ? s.length : fin + 1;
    // Un dígito suelto al final se completa con cero, que es lo que manda la norma.
    const pares = (cuerpo.length % 2 ? `${cuerpo}0` : cuerpo).match(/../g) ?? [];
    return { tipo: "cadena", valor: pares.map(p => String.fromCharCode(parseInt(p, 16))).join("") };
  }

  literal() {
    const { s } = this;
    this.i += 1;
    let nivel = 1;
    let salida = "";
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === "\\") {
        const e = s[this.i + 1];
        this.i += 2;
        if (e === "\n") continue;                       // barra al final de línea: sigue la cadena
        if (e === "\r") { if (s[this.i] === "\n") this.i += 1; continue; }
        if (/[0-7]/.test(e)) {
          let octal = e;
          while (octal.length < 3 && /[0-7]/.test(s[this.i] ?? "")) { octal += s[this.i]; this.i += 1; }
          salida += String.fromCharCode(parseInt(octal, 8) & 0xff);
          continue;
        }
        salida += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[e] ?? e;
        continue;
      }
      if (c === "(") nivel += 1;
      if (c === ")") { nivel -= 1; if (!nivel) { this.i += 1; break; } }
      salida += c;
      this.i += 1;
    }
    return { tipo: "cadena", valor: salida };
  }

  // Un valor completo: número, cadena, nombre, arreglo, diccionario o
  // referencia. La referencia obliga a mirar dos fichas por delante —«12 0 R»
  // empieza igual que un número suelto— y por eso existe la cola de devueltas.
  valor(f = this.ficha()) {
    switch (f.tipo) {
      case "num": {
        const b = this.ficha();
        if (b.tipo === "num" && Number.isInteger(b.valor)) {
          const c = this.ficha();
          if (c.tipo === "palabra" && c.valor === "R") return new Ref(f.valor);
          this.devolver(c);
        }
        this.devolver(b);
        return f.valor;
      }
      case "cadena": return f.valor;
      case "nombre": return new Nombre(f.valor);
      case "arr-ini": {
        const lista = [];
        for (;;) {
          const g = this.ficha();
          if (g.tipo === "arr-fin" || g.tipo === "fin") return lista;
          lista.push(this.valor(g));
        }
      }
      case "dic-ini": {
        const dic = {};
        for (;;) {
          const g = this.ficha();
          if (g.tipo === "dic-fin" || g.tipo === "fin") return dic;
          if (g.tipo !== "nombre") continue;            // clave rota: se salta el par
          dic[g.valor] = this.valor();
        }
      }
      case "palabra":
        if (f.valor === "true") return true;
        if (f.valor === "false") return false;
        if (f.valor === "null") return null;
        return { operador: f.valor };
      default: return null;
    }
  }
}

// ── Filtros ──────────────────────────────────────────────────────────────────

async function inflar(datos, formato) {
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream(formato));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

// Flate es el filtro de casi todos los PDF y el que más veces viene mal escrito:
// con la cabecera de zlib o sin ella, y con bytes de más al final porque el
// /Length del documento cuenta el salto de línea que va antes de «endstream».
// Los tres casos se prueban antes de darlo por ilegible; rendirse al primer
// intento fue lo que dejó sin leer cualquier PDF comprimido, que son todos.
async function desinflar(datos) {
  const intentos = [
    () => inflar(datos, "deflate"),
    () => inflar(datos, "deflate-raw"),
    () => inflar(recortarCola(datos), "deflate"),
    () => inflar(recortarCola(datos), "deflate-raw"),
    () => inflar(datos.subarray(1), "deflate-raw")
  ];
  for (const intento of intentos) {
    try { return await intento(); } catch { /* el siguiente */ }
  }
  throw new Error("flujo comprimido ilegible");
}

function recortarCola(datos) {
  let fin = datos.length;
  while (fin > 0 && esEspacio(datos[fin - 1])) fin -= 1;
  return datos.subarray(0, fin);
}

// LZW: el filtro de los PDF de Distiller antiguos. Son pocas líneas y evita
// perder documentos de los años en que Flate todavía no era lo normal.
function lzw(datos, cambioTemprano = 1) {
  const salida = [];
  let diccionario = [];
  const reiniciar = () => { diccionario = Array.from({ length: 256 }, (_, i) => [i]); diccionario.length = 258; };
  reiniciar();
  let ancho = 9;
  let previo = null;
  let acumulado = 0;
  let bits = 0;

  for (const byte of datos) {
    acumulado = (acumulado << 8) | byte;
    bits += 8;
    while (bits >= ancho) {
      const codigo = (acumulado >> (bits - ancho)) & ((1 << ancho) - 1);
      bits -= ancho;
      if (codigo === 256) { reiniciar(); ancho = 9; previo = null; continue; }
      if (codigo === 257) return Uint8Array.from(salida);
      let entrada;
      if (diccionario[codigo]) entrada = diccionario[codigo];
      else if (previo) entrada = [...previo, previo[0]];
      else continue;
      // Con `push(...entrada)` una entrada larga desborda la pila de llamadas:
      // el número de argumentos de una llamada está acotado y el de un
      // diccionario LZW maduro no.
      for (const byte of entrada) salida.push(byte);
      if (previo) diccionario.push([...previo, entrada[0]]);
      previo = entrada;
      const tope = diccionario.length + cambioTemprano;
      ancho = tope >= 2048 ? 12 : tope >= 1024 ? 11 : tope >= 512 ? 10 : 9;
    }
  }
  return Uint8Array.from(salida);
}

function ascii85(texto) {
  const limpio = texto.replace(/\s/g, "").replace(/^<~/, "").replace(/~>$/, "");
  const salida = [];
  let grupo = [];
  for (const c of limpio) {
    if (c === "z" && !grupo.length) { salida.push(0, 0, 0, 0); continue; }
    grupo.push(c.charCodeAt(0) - 33);
    if (grupo.length === 5) {
      let n = 0;
      for (const d of grupo) n = n * 85 + d;
      salida.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      grupo = [];
    }
  }
  if (grupo.length > 1) {
    const faltan = 5 - grupo.length;
    for (let i = 0; i < faltan; i += 1) grupo.push(84);
    let n = 0;
    for (const d of grupo) n = n * 85 + d;
    const cuatro = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    salida.push(...cuatro.slice(0, 4 - faltan));
  }
  return Uint8Array.from(salida);
}

function runLength(datos) {
  const salida = [];
  let i = 0;
  while (i < datos.length) {
    const largo = datos[i];
    if (largo === 128) break;
    if (largo < 128) {
      for (let j = 0; j <= largo && i + 1 + j < datos.length; j += 1) salida.push(datos[i + 1 + j]);
      i += largo + 2;
    } else {
      const byte = datos[i + 1];
      if (byte === undefined) break;
      for (let j = 0; j < 257 - largo; j += 1) salida.push(byte);
      i += 2;
    }
  }
  return Uint8Array.from(salida);
}

// Predictores. El PDF no guarda los bytes tal cual sino su diferencia con la
// fila anterior: sin deshacerlo, un flujo de objetos sale convertido en ruido.
function deshacerPredictor(datos, parametros, resolver) {
  const predictor = Number(resolver(parametros?.Predictor) ?? 1);
  if (predictor <= 1) return datos;
  const colores = Number(resolver(parametros?.Colors) ?? 1);
  const bitsPorComponente = Number(resolver(parametros?.BitsPerComponent) ?? 8);
  const columnas = Number(resolver(parametros?.Columns) ?? 1);
  const muestra = Math.ceil((colores * bitsPorComponente) / 8);
  const fila = Math.ceil((colores * bitsPorComponente * columnas) / 8);

  if (predictor === 2) {
    if (bitsPorComponente !== 8) return datos;
    for (let f = 0; f < datos.length; f += fila) {
      for (let i = muestra; i < fila && f + i < datos.length; i += 1) {
        datos[f + i] = (datos[f + i] + datos[f + i - muestra]) & 255;
      }
    }
    return datos;
  }

  // Predictores PNG: cada fila viene precedida por el número de filtro.
  const salida = new Uint8Array(Math.floor(datos.length / (fila + 1)) * fila);
  let anterior = new Uint8Array(fila);
  let destino = 0;
  for (let p = 0; p + fila < datos.length + 1; p += fila + 1) {
    const tipo = datos[p];
    const actual = datos.slice(p + 1, p + 1 + fila);
    if (actual.length < fila) break;
    for (let i = 0; i < fila; i += 1) {
      const izquierda = i >= muestra ? actual[i - muestra] : 0;
      const arriba = anterior[i];
      const esquina = i >= muestra ? anterior[i - muestra] : 0;
      let v = actual[i];
      if (tipo === 1) v += izquierda;
      else if (tipo === 2) v += arriba;
      else if (tipo === 3) v += (izquierda + arriba) >> 1;
      else if (tipo === 4) {
        const pr = izquierda + arriba - esquina;
        const da = Math.abs(pr - izquierda);
        const db = Math.abs(pr - arriba);
        const dc = Math.abs(pr - esquina);
        v += da <= db && da <= dc ? izquierda : db <= dc ? arriba : esquina;
      }
      actual[i] = v & 255;
    }
    salida.set(actual, destino);
    destino += fila;
    anterior = actual;
  }
  return salida.subarray(0, destino);
}

// ── El documento ─────────────────────────────────────────────────────────────

const IMAGENES = new Set(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]);

class Documento {
  constructor(bytes) {
    this.bytes = bytes;
    this.s = new TextDecoder("latin1").decode(bytes);
    this.indice = new Map();       // número de objeto → posiciones donde aparece
    this.cache = new Map();
    this.enFlujo = new Map();      // número de objeto → { flujo, texto } si vive dentro de un ObjStm
    this.flujosAbiertos = new Set();
  }

  // El índice se construye recorriendo el archivo, no leyendo la tabla xref.
  // La tabla miente en cuanto alguien edita el PDF con una herramienta
  // descuidada, y recorrer veinte megas de texto cuesta milisegundos.
  indexar() {
    const patron = /(\d+)[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+obj\b/g;
    let encuentro;
    while ((encuentro = patron.exec(this.s)) !== null) {
      const numero = Number(encuentro[1]);
      // «12 0 obj» también aparece dentro de un flujo —por casualidad en uno
      // comprimido, o a propósito en un documento que hable de PDF—. No se
      // descarta ninguna posición, pero se marca cuál empieza una línea: un
      // objeto de verdad empieza una, y una coincidencia dentro de un flujo
      // casi nunca. Al resolver se prueban primero las buenas.
      const antes = encuentro.index ? this.s.charCodeAt(encuentro.index - 1) : 10;
      if (!this.indice.has(numero)) this.indice.set(numero, []);
      this.indice.get(numero).push({
        en: encuentro.index + encuentro[0].length,
        buena: antes === 10 || antes === 13
      });
    }
  }

  resolver(v, profundidad = 0) {
    if (!(v instanceof Ref) || profundidad > 16) return v;
    return this.resolver(this.objeto(v.n), profundidad + 1);
  }

  objeto(numero) {
    if (this.cache.has(numero)) return this.cache.get(numero);
    this.cache.set(numero, null);                 // corta las referencias circulares

    // De la última posición a la primera —cuando un PDF trae revisiones, la
    // buena es la última—, y las que empiezan línea antes que las demás.
    const posiciones = this.indice.get(numero) ?? [];
    const orden = [
      ...posiciones.filter(p => p.buena).reverse(),
      ...posiciones.filter(p => !p.buena).reverse()
    ];

    let valor = null;
    let respaldo;
    for (const { en } of orden) {
      const leido = this.leerEn(en);
      if (leido === undefined) continue;
      // Un diccionario o un flujo es un objeto de verdad; un número suelto
      // puede ser eso o puede ser basura que casó con el patrón, así que se
      // guarda por si no aparece nada mejor.
      if (leido && typeof leido === "object") { valor = leido; break; }
      if (respaldo === undefined) respaldo = leido;
    }
    if (valor === null && respaldo !== undefined) valor = respaldo;
    if (valor === null && this.enFlujo.has(numero)) valor = this.leerDeFlujo(numero);

    this.cache.set(numero, valor);
    return valor;
  }

  leerEn(posicion) {
    const lector = new Lector(this.s, posicion);
    let valor;
    try { valor = lector.valor(); } catch { return undefined; }
    if (valor === null || valor === undefined || valor?.operador) return undefined;

    // ¿Trae flujo detrás? Entonces el objeto es el diccionario más los bytes.
    const resto = lector.ficha();
    if (resto.tipo === "palabra" && resto.valor === "stream" && valor && typeof valor === "object") {
      let i = lector.i;
      if (this.s[i] === "\r") i += 1;
      if (this.s[i] === "\n") i += 1;
      return { dic: valor, flujo: this.recortarFlujo(valor, i) };
    }
    return valor;
  }

  // Dónde acaba un flujo. Manda /Length, pero hay generadores que lo escriben
  // mal; si lo que sigue no es «endstream», se busca a mano. Al revés —buscar
  // siempre «endstream»— era el error del lector anterior: se llevaba por
  // delante el salto de línea previo y la descompresión fallaba entera.
  recortarFlujo(dic, inicio) {
    const largo = Number(this.resolver(dic.Length));
    if (Number.isFinite(largo) && largo >= 0 && inicio + largo <= this.bytes.length) {
      const siguiente = this.s.slice(inicio + largo, inicio + largo + 20);
      if (/^[\s]*endstream/.test(siguiente)) return this.bytes.subarray(inicio, inicio + largo);
    }
    // Buscar «endstream» a ciegas se queda con la primera aparición, y esa
    // puede estar dentro de los propios bytes del flujo. El de verdad es el
    // último que hay antes de que se cierre el objeto.
    const cierre = this.s.indexOf("endobj", inicio);
    let fin = this.s.lastIndexOf("endstream", cierre < 0 ? this.s.length : cierre);
    if (fin < inicio) fin = this.s.indexOf("endstream", inicio);
    if (fin < 0) return this.bytes.subarray(inicio);
    let corte = fin;
    if (this.s[corte - 1] === "\n") corte -= 1;
    if (this.s[corte - 1] === "\r") corte -= 1;
    return this.bytes.subarray(inicio, corte);
  }

  // Los bytes de un flujo, ya pasados por sus filtros.
  async datos(objeto) {
    if (!objeto?.flujo) return null;
    const resolver = v => this.resolver(v);
    let datos = objeto.flujo;
    const filtros = [].concat(this.resolver(objeto.dic.Filter) ?? []).map(nombreDe).filter(Boolean);
    const parametros = [].concat(this.resolver(objeto.dic.DecodeParms) ?? this.resolver(objeto.dic.DP) ?? []);

    for (const [n, filtro] of filtros.entries()) {
      if (IMAGENES.has(filtro)) return null;              // es una imagen: aquí no hay texto
      const parametro = this.resolver(parametros[n]) || null;
      if (filtro === "FlateDecode" || filtro === "Fl") datos = await desinflar(datos);
      else if (filtro === "LZWDecode" || filtro === "LZW") {
        datos = lzw(datos, Number(this.resolver(parametro?.EarlyChange) ?? 1));
      } else if (filtro === "ASCIIHexDecode" || filtro === "AHx") {
        const hex = new TextDecoder("latin1").decode(datos).replace(/[^\da-fA-F]/g, "");
        datos = Uint8Array.from((hex.match(/../g) ?? []).map(p => parseInt(p, 16)));
      } else if (filtro === "ASCII85Decode" || filtro === "A85") {
        datos = ascii85(new TextDecoder("latin1").decode(datos));
      } else if (filtro === "RunLengthDecode" || filtro === "RL") datos = runLength(datos);
      else if (filtro === "Crypt") continue;
      else return null;                                    // filtro desconocido: mejor nada que ruido
      if (parametro) datos = deshacerPredictor(datos, parametro, resolver);
    }
    return datos;
  }

  async texto(objeto) {
    const datos = await this.datos(objeto);
    return datos ? new TextDecoder("latin1").decode(datos) : "";
  }

  // Los PDF modernos guardan la mayoría de los objetos pequeños —páginas,
  // tipografías, catálogos— dentro de flujos /ObjStm comprimidos. Sin abrirlos,
  // el árbol de páginas de un PDF de 2020 sencillamente no existe.
  async abrirFlujosDeObjetos() {
    for (const [numero, posiciones] of this.indice) {
      // Mirar el encabezado antes de analizar el objeto: en un PDF de cien mil
      // objetos, analizarlos todos para encontrar los diez que son flujos de
      // objetos cuesta segundos de pestaña parada.
      if (!posiciones.some(p => this.s.slice(p.en, p.en + 300).includes("/ObjStm"))) continue;
      const objeto = this.objeto(numero);
      if (!objeto?.dic || nombreDe(this.resolver(objeto.dic.Type)) !== "ObjStm") continue;
      if (this.flujosAbiertos.has(numero)) continue;
      this.flujosAbiertos.add(numero);
      try {
        const contenido = await this.texto(objeto);
        const cuantos = Number(this.resolver(objeto.dic.N)) || 0;
        const primero = Number(this.resolver(objeto.dic.First)) || 0;
        const cabecera = new Lector(contenido, 0);
        for (let i = 0; i < cuantos; i += 1) {
          const num = cabecera.ficha();
          const desplazamiento = cabecera.ficha();
          if (num.tipo !== "num" || desplazamiento.tipo !== "num") break;
          // Un objeto suelto en el archivo gana al de dentro del flujo: es lo
          // que deja una revisión posterior del documento.
          if (this.indice.has(num.valor)) continue;
          this.enFlujo.set(num.valor, { texto: contenido, en: primero + desplazamiento.valor });
        }
      } catch { /* un flujo ilegible no tumba el resto del documento */ }
    }
  }

  leerDeFlujo(numero) {
    const donde = this.enFlujo.get(numero);
    if (!donde) return null;
    try { return new Lector(donde.texto, donde.en).valor(); } catch { return null; }
  }

  // Las páginas, en orden. Se baja por /Root → /Pages → /Kids, que es el orden
  // real del documento; si el catálogo no aparece se recogen todos los objetos
  // de tipo /Page, que al menos es todo el texto aunque el orden sea el del
  // archivo.
  // Las páginas, en orden. Se baja por /Root → /Pages → /Kids, que es el orden
  // real del documento; si el catálogo no aparece se recogen todos los objetos
  // de tipo /Page, que al menos es todo el texto aunque el orden sea el del
  // archivo y no el de lectura.
  paginas() {
    const catalogo = this.catalogo();
    const raiz = catalogo ? this.resolver(catalogo.Pages) : null;
    const encontradas = [];
    if (raiz) this.bajarPorPaginas(raiz, {}, encontradas, new Set());
    if (encontradas.length) return encontradas;

    for (const [numero, posiciones] of [...this.indice].sort((a, b) => a[0] - b[0])) {
      if (!posiciones.some(p => this.s.slice(p.en, p.en + 400).includes("/Page"))) continue;
      const dic = this.dicDe(this.objeto(numero));
      if (dic && nombreDe(this.resolver(dic.Type)) === "Page") encontradas.push(dic);
    }
    for (const numero of this.enFlujo.keys()) {
      const dic = this.dicDe(this.objeto(numero));
      if (dic && nombreDe(this.resolver(dic.Type)) === "Page") encontradas.push(dic);
    }
    return encontradas;
  }

  // El catálogo dice dónde empieza el árbol de páginas. Se busca por el /Root
  // del trailer —que es donde lo pone la norma— y sólo si eso falla se rastrea.
  // Rastrear todos los objetos de un PDF grande para encontrar uno cuesta lo
  // mismo que leerlo entero otra vez.
  catalogo() {
    const raices = [...this.s.matchAll(/\/Root[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+\d+[\x00\t\n\f\r ]+R/g)];
    for (const raiz of raices.reverse()) {
      const dic = this.dicDe(this.objeto(Number(raiz[1])));
      if (dic?.Pages) return dic;
    }
    for (const numero of this.enFlujo.keys()) {
      const dic = this.dicDe(this.objeto(numero));
      if (dic && nombreDe(this.resolver(dic.Type)) === "Catalog") return dic;
    }
    // Último recurso: el objeto que se declara /Catalog, esté donde esté.
    const suelto = [...this.s.matchAll(/\/Type[\x00\t\n\f\r ]*\/Catalog/g)].pop();
    if (suelto) {
      const antes = this.s.lastIndexOf(" obj", suelto.index);
      const cabecera = /(\d+)[\x00\t\n\f\r ]+\d+[\x00\t\n\f\r ]+obj[\x00\t\n\f\r ]*$/.exec(this.s.slice(Math.max(0, antes - 24), antes + 4));
      if (cabecera) return this.dicDe(this.objeto(Number(cabecera[1])));
    }
    return null;
  }

  dicDe(objeto) {
    const dic = objeto?.dic ?? objeto;
    return dic && typeof dic === "object" && !Array.isArray(dic) ? dic : null;
  }

  bajarPorPaginas(nodo, heredado, salida, vistos, profundidad = 0) {
    const dic = nodo?.dic ?? nodo;
    if (!dic || typeof dic !== "object" || profundidad > 32) return;
    // Los recursos y el tamaño se heredan del nodo padre: una página puede no
    // declarar tipografías y usar las del árbol.
    const propio = {
      Resources: dic.Resources ?? heredado.Resources,
      MediaBox: dic.MediaBox ?? heredado.MediaBox
    };
    const hijos = this.resolver(dic.Kids);
    if (Array.isArray(hijos)) {
      for (const hijo of hijos) {
        const clave = hijo instanceof Ref ? hijo.n : null;
        if (clave !== null) { if (vistos.has(clave)) continue; vistos.add(clave); }
        this.bajarPorPaginas(this.resolver(hijo), propio, salida, vistos, profundidad + 1);
      }
      return;
    }
    if (nombreDe(this.resolver(dic.Type)) === "Page" || dic.Contents) salida.push({ ...dic, ...propio });
  }
}

// ── Tipografías ──────────────────────────────────────────────────────────────

// Lo que falta de cp1252 respecto de latin1: el tramo 0x80–0x9F, donde Windows
// puso las comillas tipográficas y la rayas. Aparecen en cualquier documento
// hecho en Word, así que sin esto salen como cuadraditos.
const WINANSI = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ",
  0x9e: "ž", 0x9f: "Ÿ"
};

// Nombres de glifo que de verdad aparecen en un documento en español o en
// inglés. La lista completa de Adobe son cuatro mil entradas y no hacen falta:
// lo que no esté aquí se resuelve por el código de carácter.
const GLIFOS = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%",
  ampersand: "&", quotesingle: "'", parenleft: "(", parenright: ")", asterisk: "*",
  plus: "+", comma: ",", hyphen: "-", period: ".", slash: "/", zero: "0", one: "1",
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">",
  question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]",
  asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|",
  braceright: "}", asciitilde: "~", exclamdown: "¡", cent: "¢",
  sterling: "£", yen: "¥", section: "§", copyright: "©",
  ordfeminine: "ª", guillemotleft: "«", registered: "®",
  degree: "°", plusminus: "±", paragraph: "¶", periodcentered: "·",
  ordmasculine: "º", guillemotright: "»", questiondown: "¿",
  Agrave: "À", Aacute: "Á", Acircumflex: "Â", Atilde: "Ã",
  Adieresis: "Ä", Aring: "Å", AE: "Æ", Ccedilla: "Ç",
  Egrave: "È", Eacute: "É", Ecircumflex: "Ê", Edieresis: "Ë",
  Igrave: "Ì", Iacute: "Í", Icircumflex: "Î", Idieresis: "Ï",
  Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocircumflex: "Ô",
  Otilde: "Õ", Odieresis: "Ö", Oslash: "Ø", Ugrave: "Ù",
  Uacute: "Ú", Ucircumflex: "Û", Udieresis: "Ü", germandbls: "ß",
  agrave: "à", aacute: "á", acircumflex: "â", atilde: "ã",
  adieresis: "ä", aring: "å", ae: "æ", ccedilla: "ç",
  egrave: "è", eacute: "é", ecircumflex: "ê", edieresis: "ë",
  igrave: "ì", iacute: "í", icircumflex: "î", idieresis: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocircumflex: "ô",
  otilde: "õ", odieresis: "ö", divide: "÷", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucircumflex: "û", udieresis: "ü",
  yacute: "ý", ydieresis: "ÿ", quoteleft: "‘", quoteright: "’",
  quotedblleft: "“", quotedblright: "”", endash: "–", emdash: "—",
  bullet: "•", ellipsis: "…", trademark: "™", euro: "€",
  fi: "fi", fl: "fl", ffi: "ffi", ffl: "ffl", ff: "ff", minus: "−"
};

function glifoAUnicode(nombre) {
  if (GLIFOS[nombre]) return GLIFOS[nombre];
  const uni = /^uni([\da-fA-F]{4,6})$/.exec(nombre) || /^u([\da-fA-F]{4,6})$/.exec(nombre);
  if (uni) { try { return String.fromCodePoint(parseInt(uni[1], 16)); } catch { return ""; } }
  // «g34», «cid12», «index7»: son números de glifo, no letras. No hay nada que
  // sacar de ellos y devolver algo sería inventarse el documento.
  if (/^(g|cid|index|glyph)\d+$/i.test(nombre)) return "";
  if (nombre.length === 1) return nombre;
  return "";
}

// El CMap de /ToUnicode: la tabla que traduce el código que pinta el PDF a la
// letra que ve una persona.
function leerToUnicode(texto) {
  const mapa = new Map();
  const hexAUnicode = h => {
    const pares = h.match(/..../g) ?? [];
    let salida = "";
    for (let i = 0; i < pares.length; i += 1) {
      const u = parseInt(pares[i], 16);
      // Sustitutos UTF-16: dos unidades forman un solo carácter.
      if (u >= 0xd800 && u <= 0xdbff && pares[i + 1]) {
        const bajo = parseInt(pares[i + 1], 16);
        salida += String.fromCharCode(u, bajo);
        i += 1;
        continue;
      }
      salida += String.fromCharCode(u);
    }
    return salida;
  };
  const limpiar = h => h.replace(/[^\da-fA-F]/g, "");

  for (const bloque of texto.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    const patron = /<([\da-fA-F\s]+)>\s*<([\da-fA-F\s]*)>/g;
    let par;
    while ((par = patron.exec(bloque)) !== null) {
      mapa.set(parseInt(limpiar(par[1]), 16), hexAUnicode(limpiar(par[2])));
    }
  }

  for (const bloque of texto.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const patron = /<([\da-fA-F\s]+)>\s*<([\da-fA-F\s]+)>\s*(?:<([\da-fA-F\s]*)>|\[([\s\S]*?)\])/g;
    let rango;
    while ((rango = patron.exec(bloque)) !== null) {
      const desde = parseInt(limpiar(rango[1]), 16);
      const hasta = parseInt(limpiar(rango[2]), 16);
      if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde || hasta - desde > 65_535) continue;
      if (rango[4] !== undefined) {
        const piezas = rango[4].match(/<([\da-fA-F\s]*)>/g) ?? [];
        piezas.forEach((pieza, n) => mapa.set(desde + n, hexAUnicode(limpiar(pieza))));
        continue;
      }
      const base = limpiar(rango[3]);
      const inicio = parseInt(base, 16);
      if (!Number.isFinite(inicio)) continue;
      // En un rango sólo avanza la última unidad; las de delante se repiten.
      const cabeza = base.length > 4 ? hexAUnicode(base.slice(0, base.length - 4)) : "";
      const cola = parseInt(base.slice(-4), 16);
      for (let c = desde; c <= hasta; c += 1) {
        mapa.set(c, cabeza + String.fromCharCode(cola + (c - desde)));
      }
    }
  }
  return mapa;
}

// Cuántos bytes ocupa un código, según el espacio de códigos declarado.
function anchoDeCodigo(texto) {
  const bloque = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(texto);
  if (!bloque) return 0;
  const primero = /<([\da-fA-F\s]+)>/.exec(bloque[1]);
  if (!primero) return 0;
  return Math.max(1, Math.round(primero[1].replace(/\s/g, "").length / 2));
}

async function leerTipografia(doc, referencia) {
  const fuente = doc.resolver(referencia);
  const dic = fuente?.dic ?? fuente;
  if (!dic || typeof dic !== "object") return { bytes: 1, aUnicode: null, diferencias: null, compuesta: false };

  const subtipo = nombreDe(doc.resolver(dic.Subtype));
  const compuesta = subtipo === "Type0";
  let bytes = compuesta ? 2 : 1;
  let aUnicode = null;

  const toUnicode = doc.resolver(dic.ToUnicode);
  if (toUnicode?.flujo) {
    try {
      const texto = await doc.texto(toUnicode);
      aUnicode = leerToUnicode(texto);
      const ancho = anchoDeCodigo(texto);
      if (ancho) bytes = ancho;
    } catch { /* sin traducción; se intenta por codificación */ }
  }

  // Las diferencias de codificación: lo que usan los PDF de LaTeX y los de
  // Office antiguos para meter acentos en una tipografía de 256 posiciones.
  let diferencias = null;
  const codificacion = doc.resolver(dic.Encoding);
  const lista = doc.resolver(codificacion?.Differences);
  if (Array.isArray(lista)) {
    diferencias = new Map();
    let codigo = 0;
    for (const pieza of lista) {
      const valor = doc.resolver(pieza);
      if (typeof valor === "number") { codigo = valor; continue; }
      const letra = glifoAUnicode(nombreDe(valor));
      if (letra) diferencias.set(codigo, letra);
      codigo += 1;
    }
  }

  return { bytes, aUnicode, diferencias, compuesta };
}

// De los bytes de una cadena a letras, con la tipografía que esté activa.
function descifrar(cadena, tipografia) {
  const codigos = bytesDeCadena(cadena);
  const ancho = tipografia?.bytes === 2 ? 2 : 1;
  let salida = "";
  for (let i = 0; i < codigos.length; i += ancho) {
    const codigo = ancho === 2 ? ((codigos[i] << 8) | (codigos[i + 1] ?? 0)) : codigos[i];
    const traducido = tipografia?.aUnicode?.get(codigo);
    if (traducido !== undefined) { salida += traducido; continue; }
    const diferencia = tipografia?.diferencias?.get(codigo);
    if (diferencia !== undefined) { salida += diferencia; continue; }
    // Sin tabla no se inventa nada. Una tipografía simple es casi siempre
    // cp1252 y ahí el código ES la letra; una compuesta sin /ToUnicode son
    // números de glifo, y traducirlos a ciegas llenaría el documento de
    // caracteres chinos. Se deja vacío y arriba se dirá que no se pudo leer.
    if (ancho === 2) continue;
    salida += WINANSI[codigo] ?? (codigo >= 32 ? String.fromCharCode(codigo) : codigo === 9 ? "\t" : "");
  }
  return salida;
}

// ── El contenido de una página ───────────────────────────────────────────────

const multiplicar = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
];
const IDENTIDAD = [1, 0, 0, 1, 0, 0];

// Recorre los operadores de dibujo y devuelve lo que se pinta como texto.
//
// El salto de línea no está escrito en el PDF: hay que deducirlo de dónde cae
// cada trozo. Por eso se sigue la matriz de texto —Tm, Td, T*— y se corta
// cuando la línea base cambia. Sin esto, un informe entero sale como una sola
// línea de nueve mil caracteres.
async function textoDeContenido(doc, contenido, recursos, tipografias, salida, profundidad = 0) {
  const lector = new Lector(contenido, 0);
  const operandos = [];
  const guardadas = [];          // la pila de q/Q, propia de este flujo
  let matriz = IDENTIDAD;        // la matriz del estado gráfico (CTM)
  let tm = IDENTIDAD;            // dónde va el texto
  let tlm = IDENTIDAD;           // dónde empezó la línea
  let interlineado = 0;
  let tipografia = null;
  let cuerpo = 12;
  let linea = "";
  let ultimaY = null;
  let ultimaX = null;

  const cerrarLinea = () => { if (linea.trim()) salida.push(linea.replace(/\s+$/, "")); linea = ""; };

  // Dónde cae el trozo que viene, y si eso significa línea nueva o un espacio.
  const colocar = () => {
    const puesta = multiplicar(tm, matriz);
    const [x, y] = [puesta[4], puesta[5]];
    const alto = Math.abs(cuerpo * (tm[3] || 1)) || 12;
    if (ultimaY !== null && Math.abs(y - ultimaY) > Math.max(1.2, alto * 0.35)) cerrarLinea();
    else if (ultimaX !== null && x - ultimaX > alto * 0.28 && linea && !/\s$/.test(linea)) linea += " ";
    ultimaY = y;
    ultimaX = x;
  };

  const escribir = texto => {
    if (!texto) return;
    linea += texto;
    // El avance exacto exigiría el ancho de cada glifo, que está en /Widths y
    // en /W y no vale la pena traer: basta estimarlo para saber si el trozo
    // siguiente empieza pegado a éste o separado por un espacio.
    if (ultimaX !== null) ultimaX += texto.length * cuerpo * 0.5 * Math.abs(tm[0] || 1);
  };

  // T*, «'» y «"» son «línea siguiente» por definición del operador: se corta
  // aunque el interlineado sea cero, que es como queda cuando el documento no
  // declara TL y era la causa de que tres líneas salieran pegadas en una.
  const nuevaLinea = () => {
    cerrarLinea();
    tlm = multiplicar([1, 0, 0, 1, 0, -interlineado], tlm);
    tm = tlm;
    colocar();
  };

  for (;;) {
    const f = lector.ficha();
    if (f.tipo === "fin") break;
    if (f.tipo !== "palabra") {
      operandos.push(lector.valor(f));
      // Un flujo roto podría empujar operandos sin fin: se acota.
      if (operandos.length > 64) operandos.shift();
      continue;
    }

    const op = f.valor;
    const n = operandos.length;
    const num = k => Number(operandos[n - k]) || 0;

    switch (op) {
      case "BT": tm = IDENTIDAD; tlm = IDENTIDAD; ultimaY = null; ultimaX = null; break;
      case "ET": cerrarLinea(); break;
      case "q": guardadas.push(matriz); break;
      case "Q": matriz = guardadas.pop() ?? matriz; break;
      case "cm": matriz = multiplicar([num(6), num(5), num(4), num(3), num(2), num(1)], matriz); break;
      case "TL": interlineado = num(1); break;
      case "Tf":
        cuerpo = num(1);
        tipografia = tipografias.get(nombreDe(operandos[n - 2])) ?? null;
        break;
      case "Td": tlm = multiplicar([1, 0, 0, 1, num(2), num(1)], tlm); tm = tlm; colocar(); break;
      case "TD": interlineado = -num(1); tlm = multiplicar([1, 0, 0, 1, num(2), num(1)], tlm); tm = tlm; colocar(); break;
      case "Tm": tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; tm = tlm; colocar(); break;
      case "T*": nuevaLinea(); break;
      case "Tj": escribir(descifrar(String(operandos[n - 1] ?? ""), tipografia)); break;
      // «'» y «"» son un salto de línea y un Tj en el mismo operador.
      case "'":
      case '"':
        nuevaLinea();
        escribir(descifrar(String(operandos[n - 1] ?? ""), tipografia));
        break;
      case "TJ": {
        const lista = operandos[n - 1];
        if (!Array.isArray(lista)) break;
        for (const pieza of lista) {
          if (typeof pieza === "string") escribir(descifrar(pieza, tipografia));
          // Los números son ajustes de espaciado en milésimas de cuerpo. Un
          // retroceso grande es como se escribe el espacio entre dos palabras
          // en los PDF que colocan cada palabra por su cuenta.
          else if (typeof pieza === "number" && pieza < -100 && linea && !/\s$/.test(linea)) linea += " ";
        }
        break;
      }
      case "BI": saltarImagenIncrustada(lector); break;
      case "Do": await dibujarXObjeto(); break;
      default: break;
    }
    operandos.length = 0;
  }
  cerrarLinea();

  // Los formularios son contenido dentro de contenido, con sus propios
  // recursos. Es donde guardan el texto InDesign, Illustrator y buena parte de
  // los PDF de diseño; saltárselos deja la página en blanco.
  async function dibujarXObjeto() {
    if (profundidad > 6) return;
    const clave = nombreDe(operandos[operandos.length - 1]);
    const xobjetos = doc.resolver(recursos?.XObject);
    const objeto = doc.resolver(xobjetos?.[clave]);
    if (!objeto?.flujo || nombreDe(doc.resolver(objeto.dic.Subtype)) !== "Form") return;
    cerrarLinea();
    let dentro = "";
    try { dentro = await doc.texto(objeto); } catch { return; }
    if (!dentro) return;
    const recursosDentro = doc.resolver(objeto.dic.Resources) ?? recursos;
    const tipografiasDentro = recursosDentro === recursos
      ? tipografias
      : await mapaDeTipografias(doc, recursosDentro);
    await textoDeContenido(doc, dentro, recursosDentro, tipografiasDentro, salida, profundidad + 1);
  }
}

// Una imagen escrita dentro del propio contenido. Sus bytes son binarios y
// pueden contener cualquier cosa, incluido algo que parezca un operador: hay
// que saltar hasta «EI» sin intentar interpretarlos.
function saltarImagenIncrustada(lector) {
  const { s } = lector;
  const marca = /\bID[\x00\t\n\f\r ]/g;
  marca.lastIndex = lector.i;
  const inicio = marca.exec(s);
  if (!inicio) { lector.i = s.length; return; }
  let i = inicio.index + inicio[0].length;
  for (;;) {
    const fin = s.indexOf("EI", i);
    if (fin < 0) { lector.i = s.length; return; }
    const antes = s.charCodeAt(fin - 1);
    const despues = s.charCodeAt(fin + 2);
    if (esEspacio(antes) && (Number.isNaN(despues) || esEspacio(despues) || DELIMITADORES.has(despues))) {
      lector.i = fin + 2;
      return;
    }
    i = fin + 2;
  }
}

async function mapaDeTipografias(doc, recursos) {
  const mapa = new Map();
  const tipografias = doc.resolver(recursos?.Font);
  if (!tipografias || typeof tipografias !== "object") return mapa;
  for (const [clave, referencia] of Object.entries(tipografias)) {
    try { mapa.set(clave, await leerTipografia(doc, referencia)); } catch { /* una fuente rota no tumba la página */ }
  }
  return mapa;
}

// ── Lo que se usa desde fuera ────────────────────────────────────────────────

// Devuelve el texto del PDF y, si no lo hay, por qué no.
//
//   motivo ""            salió texto
//   motivo "sin-texto"   no hay ni un operador de texto: es un escaneado
//   motivo "ilegible"    hay texto pero sin traducción a letras
//   motivo "cifrado"     el PDF está protegido con contraseña
export async function textoDePdf(buffer) {
  const doc = new Documento(new Uint8Array(buffer));
  doc.indexar();
  await doc.abrirFlujosDeObjetos();

  const { texto, paginas, operadores } = await recorrer(doc);

  // Que salga algo no basta. Un PDF de diseño puede tener el cuerpo del texto
  // en una tipografía sin traducción y los números de página en otra que sí la
  // tiene: saldrían cuatro cifras sueltas y se daría por leído un documento del
  // que no se leyó nada. Si lo extraído no da ni un carácter por cada operador
  // de texto, lo que hay es un resto, no el documento.
  const apenasNada = operadores > 8 && texto.replace(/\s/g, "").length < operadores;
  if (texto.trim() && legible(texto) && !apenasNada) return { texto, paginas, motivo: "" };

  // Un PDF protegido con contraseña trae sus cadenas cifradas: hay operadores
  // de texto y no sale ni una letra. Merece un aviso propio porque la salida
  // —quitarle la protección— no se parece en nada a la de un escaneado.
  const cifrado = /\/Encrypt[\x00\t\n\f\r ]+\d+[\x00\t\n\f\r ]+\d+[\x00\t\n\f\r ]+R/.test(doc.s);
  if (cifrado) return { texto: "", paginas, motivo: "cifrado" };
  if (!operadores) return { texto: "", paginas, motivo: "sin-texto" };
  return { texto: "", paginas, motivo: "ilegible" };
}

async function recorrer(doc) {
  const paginas = doc.paginas();
  const lineas = [];
  let operadores = 0;

  for (const pagina of paginas) {
    const recursos = doc.resolver(pagina.Resources) || {};
    let tipografias;
    try { tipografias = await mapaDeTipografias(doc, recursos); } catch { tipografias = new Map(); }

    const contenidos = [].concat(doc.resolver(pagina.Contents) ?? []);
    const trozos = [];
    for (const referencia of contenidos) {
      const objeto = doc.resolver(referencia);
      if (!objeto?.flujo) continue;
      try { trozos.push(await doc.texto(objeto)); } catch { /* un flujo roto no se lleva la página */ }
    }
    // Las partes de /Contents son un único flujo partido en trozos: un operador
    // puede quedar a caballo entre dos, así que se juntan antes de leerlos.
    const contenido = trozos.join("\n");
    if (!contenido) continue;
    operadores += (contenido.match(/\b(?:Tj|TJ)\b/g) ?? []).length;

    const antes = lineas.length;
    try { await textoDeContenido(doc, contenido, recursos, tipografias, lineas); } catch { /* seguimos con la siguiente */ }
    if (lineas.length > antes) lineas.push("");
  }

  return { texto: lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim(), paginas: paginas.length, operadores };
}

// ¿Esto son letras o son números de glifo?
//
// Se comprueba, pero con la mano mucho más ligera que antes: el umbral anterior
// —más de la mitad de letras y un 8 % de espacios— tiraba una tabla de
// indicadores, que es casi toda cifras, y la daba por ilegible.
function legible(texto) {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length < 3) return false;
  const letras = (limpio.match(/\p{L}/gu) ?? []).length;
  const utiles = (limpio.match(/[\p{L}\p{N}\p{P}\p{S}\s]/gu) ?? []).length;
  // Basta con que lo que salió sean caracteres que una persona podría leer y
  // que haya alguna letra. Una tabla de indicadores es casi toda cifras y
  // también es un documento: el umbral anterior —más de la mitad de letras—
  // la daba por ilegible.
  return utiles / limpio.length > 0.85 && letras >= 1;
}
