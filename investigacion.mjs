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

// Modelo de imagen de Gemini. Devuelve la imagen incrustada en la respuesta
// (inlineData), no un enlace. Los nombres cambian; se puede ajustar desde config.
const MODELO_IMAGEN = "gemini-2.5-flash-image";

// Genera una imagen a partir de una descripción. Se usa sólo a petición
// explícita: una imagen generada ilustra, no prueba. Quien la muestra debe
// marcarla como generada —lo hace el cliente— y nunca presentarla como evidencia.
export async function generarImagen(descripcion, opciones = {}) {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) return { ok: false, error: "Falta GEMINI_API_KEY: generar imágenes usa Gemini." };
  const texto = String(descripcion || "").trim();
  if (!texto) return { ok: false, error: "Falta la descripción de la imagen." };

  const modelo = (opciones.modelo || MODELO_IMAGEN).replace(/^models\//, "");
  let datos;
  try {
    const upstream = await fetch(
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
    const crudo = await upstream.text();
    if (!upstream.ok) {
      console.error("Gemini imagen:", upstream.status, crudo.slice(0, 400));
      // 404 o 400 suelen ser un nombre de modelo que ya no existe, o el plan
      // sin acceso a imágenes.
      return {
        ok: false,
        error: upstream.status === 404 || upstream.status === 400
          ? "El modelo de imagen no está disponible en tu plan de Gemini."
          : `La generación falló (${upstream.status}).`
      };
    }
    datos = JSON.parse(crudo);
  } catch (error) {
    return {
      ok: false,
      error: error.name === "TimeoutError" ? "La imagen tardó demasiado." : "No se pudo generar la imagen."
    };
  }

  // La imagen viene incrustada en una de las partes.
  const partes = datos?.candidates?.[0]?.content?.parts ?? [];
  const conImagen = partes.find(p => p?.inlineData?.data);
  if (!conImagen) return { ok: false, error: "Gemini no devolvió ninguna imagen." };
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
