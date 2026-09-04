// Documentos que se suben a la conversación.
//
// Es distinto de los documentos de una reunión: aquéllos son material de una
// reunión concreta y acaban en su minuta; éstos son para hablar con Catalina
// ahora —«mírate esta presentación», «qué te parece este Excel»— y viven
// mientras dure la conversación.
//
// El texto se saca en el propio navegador con el mismo lector del modo reunión
// (PDF, Word, Excel, PowerPoint, texto plano), así que el archivo NO se sube a
// ningún sitio. La única excepción son las imágenes: de una imagen no se puede
// sacar texto aquí, así que se manda al servidor para que el modelo la describa.
// Eso conviene decirlo, y se dice en pantalla.
//
// A Catalina no se le manda el documento entero: se le manda una ficha con el
// principio, y si necesita más lo pide con `consultar_documento`. Un Excel de
// cuarenta mil caracteres metido de golpe en una conversación hablada no la
// ayuda a responder, la ahoga.

import { leerDocumento } from "./reunion.js";

// Cuánto del documento viaja en la primera ficha. Lo que cabe en algo que se va
// a escuchar, no lo que cabe en la petición.
const ADELANTO = 6000;
// Cuánto puede pedir de una vez con `consultar_documento`.
const TROZO = 12_000;

const documentos = [];
let siguienteId = 1;

export const hayDocumentos = () => documentos.length > 0;
export const listarDocumentos = () => documentos.map(({ id, nombre, tipo, tamano, caracteres, imagen, nota }) =>
  ({ id, nombre, tipo, tamano, caracteres, imagen, nota }));

export function olvidarDocumentos() {
  documentos.length = 0;
  siguienteId = 1;
}

export function olvidarDocumento(id) {
  const i = documentos.findIndex(d => d.id === id);
  if (i >= 0) documentos.splice(i, 1);
  return i >= 0;
}

const base64De = archivo => new Promise((resolve, reject) => {
  const lector = new FileReader();
  lector.onload = () => resolve(String(lector.result).split(",")[1] || "");
  lector.onerror = () => reject(lector.error || new Error("No se pudo leer el archivo."));
  lector.readAsDataURL(archivo);
});

// Añade un archivo. Devuelve la ficha, o el motivo por el que no se pudo.
//
// `alAvisar` se llama con los pasos que tardan —leer, describir una imagen—
// para que la pantalla no se quede muda mientras tanto.
export async function anadirDocumento(archivo, { nota = "", alAvisar } = {}) {
  const nombre = archivo.name || "documento";
  alAvisar?.(`Leyendo «${nombre}»…`);

  const leido = await leerDocumento(archivo);
  let texto = leido.texto || "";
  let imagen = false;

  // De una imagen no sale texto en el navegador: la describe el modelo.
  if (!texto && (archivo.type || "").startsWith("image/")) {
    imagen = true;
    alAvisar?.(`Mirando «${nombre}»…`);
    try {
      const respuesta = await fetch("/documento/imagen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: await base64De(archivo), tipo: archivo.type, nombre, nota })
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !datos.ok) {
        return { ok: false, nombre, error: datos.error || `No se pudo mirar la imagen (${respuesta.status}).` };
      }
      texto = datos.descripcion || "";
    } catch (error) {
      return { ok: false, nombre, error: `No se pudo mirar la imagen: ${error.message}` };
    }
  }

  if (!texto) return { ok: false, nombre, error: leido.aviso || "No se pudo sacar nada de este archivo." };

  const documento = {
    id: `d${siguienteId++}`,
    nombre,
    tipo: leido.tipo || archivo.type || "",
    tamano: archivo.size || 0,
    nota: String(nota || "").trim(),
    imagen,
    texto,
    caracteres: texto.length
  };
  documentos.push(documento);
  return { ok: true, documento };
}

// La ficha que se le manda a Catalina al subirlo. Lleva el principio del
// documento y le dice cómo pedir el resto, en vez de mandárselo entero.
export function fichaParaCatalina(documento) {
  const completo = documento.texto.length <= ADELANTO;
  return [
    imagen(documento)
      ? `[Contexto] Te acaban de mostrar una imagen: «${documento.nombre}». Esto es lo que se ve en ella, descrito por el lector de imágenes:`
      : `[Contexto] Te acaban de dar un documento: «${documento.nombre}» (${legible(documento.tamano)}, ${documento.caracteres.toLocaleString("es-CL")} caracteres de texto).`,
    documento.nota ? `Quien lo sube dice: «${documento.nota}».` : "",
    "",
    completo ? documento.texto : documento.texto.slice(0, ADELANTO),
    "",
    completo
      ? "Eso es todo el documento."
      : `[…hasta aquí los primeros ${ADELANTO.toLocaleString("es-CL")} caracteres. Para leer más, usa consultar_documento con nombre «${documento.nombre}».]`,
    "",
    "Coméntalo en dos o tres frases, en voz alta: qué es y lo que más importa de lo que has visto.",
    "No lo resumas entero salvo que te lo pidan, y no des por cierto lo que no esté ahí escrito."
  ].filter(Boolean).join("\n");
}

const imagen = d => d.imagen === true;

// Lo que devuelve `consultar_documento`.
export function leerTrozo({ nombre = "", desde = 0 } = {}) {
  if (!documentos.length) return { ok: false, error: "No hay ningún documento subido a esta conversación." };

  const buscado = String(nombre || "").trim().toLowerCase();
  const documento = buscado
    ? documentos.find(d => d.nombre.toLowerCase().includes(buscado)) || null
    : documentos[documentos.length - 1];

  if (!documento) {
    return {
      ok: false,
      error: `No hay ningún documento que se llame «${nombre}».`,
      disponibles: documentos.map(d => d.nombre)
    };
  }

  const inicio = Math.max(0, Math.min(Number(desde) || 0, documento.texto.length));
  const trozo = documento.texto.slice(inicio, inicio + TROZO);
  const fin = inicio + trozo.length;
  return {
    ok: true,
    nombre: documento.nombre,
    caracteres: documento.caracteres,
    desde: inicio,
    hasta: fin,
    queda: documento.caracteres - fin,
    texto: trozo,
    // Se le dice explícitamente cómo seguir: sin esto pide el mismo trozo otra vez.
    siguiente: fin < documento.caracteres
      ? `Para seguir leyendo, vuelve a llamar a consultar_documento con nombre «${documento.nombre}» y desde ${fin}.`
      : "Ese era el final del documento."
  };
}

export function legible(bytes) {
  if (!bytes) return "tamaño desconocido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
