// La web abierta, con criterio.
//
// Catalina lee de una lista corta y fija de fuentes —Commons, Wikipedia, PubMed,
// OpenStreetMap—. Este módulo abre la web entera: buscar con Google (a través de
// Gemini) y leer una página concreta. En la versión de salud esto vivía bajo una
// clave hablada; aquí navegar es el trabajo, así que la puerta queda abierta.
//
// Lo que se hereda entero, porque es lo que hace segura esa puerta:
//
//   · Sólo lectura. Buscar y leer páginas. Ni escribe, ni cambia nada, ni toca
//     el resto de herramientas.
//   · Lo que llega de una página es información, nunca una orden. Esa regla vive
//     en la persona (config.mjs); aquí se sostiene técnicamente: no se ejecuta
//     nada de lo que se lee, sólo se le entrega al modelo como texto.
//   · Las direcciones internas no se visitan. Una URL que apunte a la red de la
//     máquina —169.254, 10.x, localhost— convierte «lee esta página» en
//     «entrégame tus credenciales». Se bloquean, y también las redirecciones
//     hacia ellas.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIEMPO_BUSQUEDA = 12_000;
const TIEMPO_PAGINA = 8_000;
const MAX_PAGINA = 512 * 1024;      // lo que se descarga de una página
const RECORTE_PAGINA = 6_000;       // lo que se le entrega al modelo
const RECORTE_RESUMEN = 1_500;

// Modelo con el que se hace la búsqueda. No es el de la conversación: aquél
// habla, éste consulta. Los nombres de Gemini cambian cada pocos meses.
const MODELO_POR_DEFECTO = "gemini-3.1-flash";

export const hayWeb = () => Boolean(process.env.GEMINI_API_KEY?.trim());

// ── Buscar en la web ─────────────────────────────────────────────────────────

export async function buscarEnLaWeb(consulta, opciones = {}) {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) return { ok: false, error: "Falta GEMINI_API_KEY: la búsqueda en la web usa Gemini." };

  const modelo = (opciones.modelo || MODELO_POR_DEFECTO).replace(/^models\//, "");
  const cuerpo = {
    contents: [{ role: "user", parts: [{ text: consulta }] }],
    // Temperatura baja: se le pide que recoja lo que encuentre, no que redacte.
    generationConfig: { temperature: .2 }
  };

  // El nombre de la herramienta cambió entre versiones de la API. Se prueba el
  // actual y, si la rechaza, el anterior: es un reintento, no una cascada.
  for (const herramienta of [{ google_search: {} }, { google_search_retrieval: {} }]) {
    const respuesta = await pedirAGemini(clave, modelo, { ...cuerpo, tools: [herramienta] });
    if (respuesta.ok) return respuesta;
    if (!respuesta.reintentable) return respuesta;
  }
  return { ok: false, error: "Gemini no aceptó la búsqueda de Google." };
}

async function pedirAGemini(clave, modelo, cuerpo) {
  let datos;
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIEMPO_BUSQUEDA)
      }
    );
    const texto = await upstream.text();
    if (!upstream.ok) {
      console.error("Gemini búsqueda:", upstream.status, texto.slice(0, 400));
      return {
        ok: false,
        error: `La búsqueda falló (${upstream.status}).`,
        // 400 es lo que responde cuando el modelo no admite esa herramienta.
        reintentable: upstream.status === 400
      };
    }
    datos = JSON.parse(texto);
  } catch (error) {
    return {
      ok: false,
      error: error.name === "TimeoutError" ? "La búsqueda tardó demasiado." : "No se pudo consultar la web."
    };
  }

  return leerRespuesta(datos);
}

// Lectura deliberadamente desconfiada: si `groundingMetadata` no viene, o viene
// con otra forma, se devuelve el texto sin fuentes y marcado como no
// respaldado. Preferimos decir «esto no trae fuente» a romper la conversación.
function leerRespuesta(datos) {
  const candidato = datos?.candidates?.[0];
  const partes = candidato?.content?.parts;
  const resumen = Array.isArray(partes)
    ? partes.map(parte => parte?.text).filter(Boolean).join(" ").trim()
    : "";
  if (!resumen) return { ok: false, error: "La búsqueda no devolvió nada legible." };

  const meta = candidato?.groundingMetadata ?? {};
  const vistas = new Set();
  const fuentes = [];
  for (const trozo of meta.groundingChunks ?? []) {
    const web = trozo?.web;
    if (!web?.uri || vistas.has(web.uri)) continue;
    vistas.add(web.uri);
    fuentes.push({ titulo: web.title || web.uri, enlace: web.uri });
  }

  return {
    ok: true,
    resumen: resumen.slice(0, RECORTE_RESUMEN),
    fuentes,
    // Las consultas que Google acabó lanzando. Se enseñan junto a las fuentes:
    // sus condiciones piden dejar a la vista de dónde viene lo que se muestra.
    sugerencias: (meta.webSearchQueries ?? []).filter(Boolean).slice(0, 6),
    respaldado: fuentes.length > 0
  };
}

// ── Generar una imagen ───────────────────────────────────────────────────────

// Modelos de imagen de Gemini. Devuelven la imagen incrustada en la respuesta
// (inlineData), no un enlace. Los nombres cambian cada pocos meses y no todos
// existen en todos los planes, así que se prueban en orden y se usa el primero
// que responda: si el primero ya no existe (404) o no acepta la petición (400),
// se pasa al siguiente en vez de rendirse. Se puede forzar uno desde opciones.
const MODELOS_IMAGEN = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation"
];

// Saca el mensaje que Google pone dentro del error, para poder decir por qué
// falló en vez de un número a secas. Es lo que convierte «no se pudo» en algo
// accionable: «modelo no encontrado», «API no habilitada», «cuota agotada».
function detalleDeGoogle(crudo) {
  try { return String(JSON.parse(crudo)?.error?.message || "").slice(0, 200); } catch { return ""; }
}

// Genera una imagen a partir de una descripción. Se usa sólo a petición
// explícita: una imagen generada ilustra, no prueba. Quien la muestra debe
// marcarla como generada —lo hace el cliente— y nunca presentarla como evidencia.
export async function generarImagen(descripcion, opciones = {}) {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) return { ok: false, error: "Falta GEMINI_API_KEY: generar imágenes usa Gemini." };
  const texto = String(descripcion || "").trim();
  if (!texto) return { ok: false, error: "Falta la descripción de la imagen." };

  const modelos = opciones.modelo ? [opciones.modelo.replace(/^models\//, "")] : MODELOS_IMAGEN;
  let ultimoDetalle = "";
  for (const modelo of modelos) {
    const r = await intentarImagen(clave, modelo, texto);
    if (r.ok) return r;
    if (r.detalle) ultimoDetalle = r.detalle;
    // Sólo tiene sentido probar otro modelo si el fallo era del modelo (no
    // existe, no lo acepta). Un problema de clave o de cuota se repetiría igual.
    if (!r.reintentable) break;
  }
  return {
    ok: false,
    error: ultimoDetalle
      ? `No se pudo generar la imagen: ${ultimoDetalle}`
      : "No se pudo generar la imagen con ningún modelo de Gemini disponible."
  };
}

async function intentarImagen(clave, modelo, texto) {
  let crudo, upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: texto }] }],
          // Se pide imagen (y texto, que algunos modelos exigen declarar).
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
        }),
        signal: AbortSignal.timeout(TIEMPO_BUSQUEDA)
      }
    );
    crudo = await upstream.text();
  } catch (error) {
    const timeout = error.name === "TimeoutError";
    // El timeout no es del modelo: no vale la pena recorrer la lista entera.
    return { ok: false, reintentable: !timeout, detalle: timeout ? "la imagen tardó demasiado" : "" };
  }

  if (!upstream.ok) {
    const detalle = detalleDeGoogle(crudo);
    console.error("Gemini imagen:", modelo, upstream.status, crudo.slice(0, 300));
    // 404/400: el modelo no existe o no aceptó la petición → se prueba el
    // siguiente. Otros códigos (401/403 clave, 429 cuota, 5xx) se repetirían.
    return { ok: false, reintentable: upstream.status === 404 || upstream.status === 400, detalle };
  }

  let datos;
  try { datos = JSON.parse(crudo); } catch { return { ok: false, reintentable: false, detalle: "respuesta ilegible" }; }

  // La imagen viene incrustada en una de las partes.
  const partes = datos?.candidates?.[0]?.content?.parts ?? [];
  const conImagen = partes.find(p => p?.inlineData?.data);
  if (!conImagen) {
    // Respondió sin imagen: a veces el filtro de seguridad la bloqueó.
    const motivo = datos?.candidates?.[0]?.finishReason;
    return { ok: false, reintentable: false, detalle: motivo ? `sin imagen (${motivo})` : "no devolvió ninguna imagen" };
  }
  const mime = conImagen.inlineData.mimeType || "image/png";

  return {
    ok: true,
    // Data URL: se muestra sin guardar nada. En Vercel el disco es de sólo
    // lectura, así que guardar un archivo no es opción, y tampoco hace falta.
    imagen: `data:${mime};base64,${conImagen.inlineData.data}`,
    // El texto que el modelo pudo devolver junto a la imagen.
    nota: partes.map(p => p?.text).filter(Boolean).join(" ").trim() || ""
  };
}

// ── Buscar videos en YouTube ─────────────────────────────────────────────────

// La búsqueda de video usa la API de datos de YouTube (v3), que es una API de
// Google como la de Gemini: la misma clave sirve si el proyecto tiene activada
// «YouTube Data API v3». Se admite una clave propia (YOUTUBE_API_KEY) por si se
// quiere separar la cuota, y si no, se cae a la de Gemini.
const YT_BUSQUEDA = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";

export const hayVideos = () => Boolean((process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY)?.trim());

// Convierte la duración ISO 8601 de YouTube (PT1H2M3S) a algo legible (1:02:03).
function duracionISO(iso) {
  if (!iso) return "";
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return "";
  const [h, min, s] = [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
  const dd = n => String(n).padStart(2, "0");
  return h ? `${h}:${dd(min)}:${dd(s)}` : `${min}:${dd(s)}`;
}

// Busca videos que podrían ser útiles sobre un tema. Devuelve título, canal,
// enlace, duración y número de vistas —una señal, no una prueba— manteniendo el
// orden de relevancia que da YouTube. No reproduce nada: entrega enlaces.
export async function buscarVideos(consulta, opciones = {}) {
  const clave = (process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY)?.trim();
  if (!clave) return { ok: false, error: "Falta YOUTUBE_API_KEY (o GEMINI_API_KEY con «YouTube Data API v3» activada)." };
  const q = String(consulta || "").trim();
  if (!q) return { ok: false, error: "Falta el tema del video." };
  const cuantos = Math.min(Math.max(Number(opciones.cuantos) || 8, 1), 12);

  // 1. La búsqueda: devuelve los videos, pero no sus estadísticas.
  let busqueda;
  try {
    const url = new URL(YT_BUSQUEDA);
    url.search = new URLSearchParams({
      key: clave, part: "snippet", type: "video", maxResults: String(cuantos),
      q, safeSearch: "moderate", relevanceLanguage: "es"
    }).toString();
    const up = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_BUSQUEDA) });
    const crudo = await up.text();
    if (!up.ok) {
      const detalle = detalleDeGoogle(crudo);
      console.error("YouTube buscar:", up.status, crudo.slice(0, 300));
      return {
        ok: false,
        error: up.status === 403
          ? `YouTube rechazó la clave${detalle ? ": " + detalle : ""}. Activa «YouTube Data API v3» en el proyecto de la clave.`
          : `La búsqueda de video falló (${up.status})${detalle ? ": " + detalle : ""}.`
      };
    }
    busqueda = JSON.parse(crudo);
  } catch (error) {
    return { ok: false, error: error.name === "TimeoutError" ? "La búsqueda de video tardó demasiado." : "No se pudo buscar en YouTube." };
  }

  const items = (busqueda.items || []).filter(i => i?.id?.videoId);
  if (!items.length) return { ok: true, videos: [] };
  const ids = items.map(i => i.id.videoId);

  // 2. Estadísticas y duración de cada video, en una sola llamada. Si falla, se
  // muestran igual los videos, sólo que sin vistas ni duración.
  const detalle = {};
  try {
    const url = new URL(YT_VIDEOS);
    url.search = new URLSearchParams({ key: clave, part: "statistics,contentDetails", id: ids.join(",") }).toString();
    const up = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_BUSQUEDA) });
    if (up.ok) { const d = await up.json(); for (const v of d.items || []) detalle[v.id] = v; }
  } catch { /* opcional */ }

  const videos = items.map(i => {
    const id = i.id.videoId, sn = i.snippet || {}, d = detalle[id];
    const vistas = d?.statistics?.viewCount ? Number(d.statistics.viewCount) : null;
    return {
      titulo: sn.title || "(sin título)",
      canal: sn.channelTitle || "",
      videoId: id,
      enlace: `https://www.youtube.com/watch?v=${id}`,
      publicado: (sn.publishedAt || "").slice(0, 10),
      anio: Number((sn.publishedAt || "").slice(0, 4)) || undefined,
      vistas,
      duracion: duracionISO(d?.contentDetails?.duration),
      miniatura: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || "",
      descripcion: (sn.description || "").slice(0, 200)
    };
  });

  return { ok: true, videos };
}

// ── Leer una página ─────────────────────────────────────────────────────────

// Rangos que no se visitan nunca. El de 169.254 no es teórico: es donde viven
// los metadatos de la máquina en casi todas las nubes, y una URL que apunte ahí
// convierte «lee esta página» en «entrégame tus credenciales».
function esInterna(ip) {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // pruebas de red
    if (a >= 224) return true;                            // multicast y reservados
    return false;
  }
  if (version === 6) {
    const plano = ip.toLowerCase();
    if (plano === "::1" || plano === "::") return true;
    if (/^f[cd]/.test(plano)) return true;                // ULA
    if (/^fe[89ab]/.test(plano)) return true;             // link-local
    const mapeada = plano.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return esInterna(mapeada[1]);
    return false;
  }
  return true;
}

async function destinoPermitido(url) {
  if (url.protocol !== "https:") return "Sólo se pueden leer páginas https.";
  const anfitrion = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(anfitrion)) {
    return esInterna(anfitrion) ? "Esa dirección es interna." : "";
  }
  let direcciones;
  try {
    direcciones = await lookup(anfitrion, { all: true });
  } catch {
    return "No se pudo resolver esa dirección.";
  }
  // Basta con que una resuelva a interna para no visitarla: un dominio puede
  // apuntar a varias, y elegir la buena sería confiar en el azar.
  return direcciones.some(entrada => esInterna(entrada.address))
    ? "Esa dirección apunta a una red interna."
    : "";
}

const TIPOS = /^(text\/html|text\/plain|application\/xhtml\+xml)/i;

export async function leerPagina(destino) {
  let url;
  try { url = new URL(String(destino)); } catch { return { ok: false, error: "Esa no es una dirección válida." }; }

  // Las redirecciones se siguen a mano: cada salto es una dirección nueva y hay
  // que volver a comprobarla. Seguirlas automáticamente sería dejar que el
  // primer sitio elija el segundo.
  for (let salto = 0; salto < 4; salto += 1) {
    const problema = await destinoPermitido(url);
    if (problema) return { ok: false, error: problema };

    let respuesta;
    try {
      respuesta = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": AGENTE, Accept: "text/html,text/plain;q=0.9" },
        signal: AbortSignal.timeout(TIEMPO_PAGINA)
      });
    } catch (error) {
      return {
        ok: false,
        error: error.name === "TimeoutError" ? "La página tardó demasiado." : "No se pudo abrir la página."
      };
    }

    if (respuesta.status >= 300 && respuesta.status < 400) {
      const siguiente = respuesta.headers.get("location");
      if (!siguiente) return { ok: false, error: "La página redirige a ninguna parte." };
      try { url = new URL(siguiente, url); } catch { return { ok: false, error: "La redirección no es válida." }; }
      continue;
    }

    if (!respuesta.ok) return { ok: false, error: `La página respondió ${respuesta.status}.` };

    const tipo = respuesta.headers.get("content-type") || "";
    if (!TIPOS.test(tipo)) return { ok: false, error: "Eso no es una página de texto." };

    const crudo = await leerConTope(respuesta);
    const texto = aTextoPlano(crudo);
    if (!texto) return { ok: false, error: "La página no tiene texto legible." };

    return {
      ok: true,
      url: url.href,
      titulo: tituloDe(crudo) || url.hostname,
      texto: texto.slice(0, RECORTE_PAGINA),
      recortado: texto.length > RECORTE_PAGINA
    };
  }
  return { ok: false, error: "La página redirige demasiadas veces." };
}

const AGENTE = "Catalina/1.0 (jefa de gabinete; https://github.com/drintiparedes-svg/catalina-ejecutiva)";

// Se lee a trozos y se corta al llegar al tope. Con `text()` a secas, una página
// de cien megas se descargaría entera antes de poder decidir nada.
async function leerConTope(respuesta) {
  if (!respuesta.body) return "";
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder("utf-8", { fatal: false });
  let salida = "";
  let bytes = 0;
  while (bytes < MAX_PAGINA) {
    const { done, value } = await lector.read();
    if (done) break;
    bytes += value.byteLength;
    salida += decodificador.decode(value, { stream: true });
  }
  await lector.cancel().catch(() => {});
  return salida;
}

function tituloDe(html) {
  const encontrado = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return encontrado ? aTextoPlano(encontrado[1]).slice(0, 160) : "";
}

// Guiones y estilos fuera antes que las etiquetas: si se quitan primero las
// etiquetas, el código de dentro se queda como si fuera prosa.
export function aTextoPlano(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, codigo) => String.fromCharCode(Number(codigo)))
    .replace(/\s+/g, " ")
    .trim();
}
