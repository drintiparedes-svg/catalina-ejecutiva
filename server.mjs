import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
await loadEnv(fileURLToPath(new URL("./.env", import.meta.url)));
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        ok: true,
        apiKeyConfigured: hasApiKey(),
        // La interfaz consulta esto al arrancar para saber si hay red de
        // respaldo. Las láminas y las referencias no aparecen aquí porque no
        // dependen de ninguna clave: Commons y PubMed son abiertos.
        proveedores: { openai: hasApiKey(), gemini: hasGeminiKey() }
      });
    }

    if (req.method === "POST" && req.url === "/session") {
      return await createRealtimeSession(req, res);
    }

    if (req.method === "POST" && req.url === "/gemini/token") {
      return await createGeminiToken(res);
    }

    if (req.method === "POST" && req.url === "/imagen-medica") {
      return await buscarImagenMedica(req, res);
    }

    if (req.method === "POST" && req.url === "/referencias") {
      return await buscarReferencias(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Método no permitido" });
    }

    const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
    const requested = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    const body = await readFile(join(root, safePath));
    res.writeHead(200, {
      "Content-Type": mime[extname(safePath)] || "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css"].includes(extname(safePath)) ? "no-cache" : "public, max-age=3600"
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "No encontrado" });
    console.error(error);
    json(res, 500, { error: "Error interno" });
  }
});

// La persona vive en un solo sitio porque la usan los dos proveedores: si
// Catalina cambia de carácter al agotarse el crédito de OpenAI, el relevo se
// nota y deja de ser la misma interlocutora.
export const PERSONA = [
  "Tu nombre es Catalina. Eres una asistente conversacional cálida, clara y profesional.",
  "Habla en español latinoamericano salvo que la persona use otro idioma.",
  "Responde siempre mediante voz, con un tono femenino neutro latinoamericano, natural, sereno y expresivo.",
  "Usa pausas humanas breves, ritmo conversacional y pronunciación clara. Evita sonar como locutora o robot.",
  "Tus respuestas orales deben ser naturales y concisas. No digas qué modelo eres; preséntate como Catalina.",
  "Puedes ser interrumpida y debes escuchar con atención.",
  "Eres una asistente de docencia médica: explicas anatomía y temas médicos de forma clara y didáctica.",
  "Cuando expliques una estructura anatómica o un tema médico que se entienda mejor viéndolo, usa la herramienta buscar_imagen_medica.",
  "La herramienta busca láminas de atlas y diagramas didácticos ya publicados; no inventa imágenes.",
  "Si no encuentra nada adecuado, dilo con naturalidad y sigue explicando de palabra. Nunca afirmes que se ve algo que no apareció.",
  "Al mostrar una lámina, ve señalando lo que se ve y explícalo; no leas el pie de imagen.",
  "No des diagnósticos ni indicaciones de tratamiento para casos concretos: tu terreno es explicar y enseñar."
].join(" ");

// Herramienta de imagen.
//
// Busca, no genera. La diferencia importa: una lámina anatómica inventada por
// un modelo parece correcta y no lo está —inventa vasos, desplaza inserciones,
// rotula mal—, y en docencia médica eso se aprende como si fuera cierto. Aquí
// sólo se recuperan ilustraciones ya publicadas, con autor, licencia y enlace
// a la ficha original para poder comprobarlas.
const PARAMETROS_IMAGEN = {
  type: "object",
  properties: {
    estructura: {
      type: "string",
      description: "Estructura anatómica o tema a ilustrar, en inglés y en términos anatómicos "
        + "(así se titulan las láminas): por ejemplo 'brachial plexus', 'heart valves', 'nephron'."
    },
    detalle: {
      type: "string",
      description: "Matiz opcional para afinar: 'cross section', 'posterior view', 'blood supply'."
    }
  },
  required: ["estructura"]
};

const DESCRIPCION_IMAGEN = "Busca una lámina anatómica o un diagrama médico didáctico ya publicado y lo muestra en pantalla. "
  + "No genera imágenes: sólo recupera ilustraciones reales con su autoría y licencia. "
  + "Úsala al explicar anatomía o temas médicos que se entienden mejor viéndolos.";

// Referencias del concepto, no de la lámina. Son cosas distintas: la ilustración
// tiene su autoría, pero lo que se afirma al explicar necesita respaldo propio
// en la literatura. Se buscan en PubMed y se muestran junto a la explicación.
const PARAMETROS_REFERENCIAS = {
  type: "object",
  properties: {
    tema: {
      type: "string",
      description: "Tema médico a respaldar, en inglés y en términos MeSH cuando se pueda: "
        + "por ejemplo 'brachial plexus injury', 'aortic stenosis management'."
    }
  },
  required: ["tema"]
};

const DESCRIPCION_REFERENCIAS = "Busca en PubMed referencias que respalden lo que estás explicando y las muestra en pantalla. "
  + "Úsala cuando expliques un concepto médico, para que quien escucha pueda comprobarlo en la literatura.";

const HERRAMIENTAS = [
  { nombre: "buscar_imagen_medica", descripcion: DESCRIPCION_IMAGEN, parametros: PARAMETROS_IMAGEN },
  { nombre: "buscar_referencias", descripcion: DESCRIPCION_REFERENCIAS, parametros: PARAMETROS_REFERENCIAS }
];

async function createRealtimeSession(req, res) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!hasApiKey()) {
    return json(res, 503, { error: "Falta OPENAI_API_KEY en el archivo .env", code: "API_KEY_MISSING" });
  }

  const sdp = await readBody(req);
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify({
    type: "realtime",
    model: "gpt-realtime-2.1",
    output_modalities: ["audio"],
    instructions: PERSONA,
    tools: HERRAMIENTAS.map(h => ({
      type: "function",
      name: h.nombre,
      description: h.descripcion,
      parameters: h.parametros
    })),
    audio: {
      input: { turn_detection: { type: "server_vad", create_response: true, interrupt_response: true } },
      output: { voice: "marin" }
    }
  }));

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": "catalina-local-owner"
    },
    body: form
  });
  const responseBody = await upstream.text();
  if (!upstream.ok) {
    console.error("OpenAI Realtime:", upstream.status, responseBody);
    let upstreamError = {};
    try { upstreamError = JSON.parse(responseBody).error || {}; } catch {}
    if (upstream.status === 401 || upstream.status === 403) {
      return json(res, upstream.status, {
        error: "OpenAI rechazó la OPENAI_API_KEY. Genera o pega una clave válida de la API, no la contraseña de ChatGPT.",
        code: "API_KEY_INVALID"
      });
    }
    if (upstream.status === 429) {
      return json(res, upstream.status, {
        error: "La API alcanzó un límite de uso o necesita facturación activa.",
        code: "API_RATE_LIMIT"
      });
    }
    return json(res, upstream.status, {
      error: upstreamError.message || "OpenAI rechazó la sesión",
      code: upstreamError.code || "OPENAI_SESSION_ERROR"
    });
  }
  res.writeHead(200, { "Content-Type": "application/sdp" });
  res.end(responseBody);
}

// Respaldo con Gemini.
//
// La Live API de Gemini no habla WebRTC como OpenAI: es un WebSocket con audio
// PCM crudo, y el navegador se conecta directo. Para no publicar la clave, aquí
// se pide un token efímero —vale unos minutos y sólo para una sesión— y se
// devuelve junto con la configuración, de modo que la persona y la herramienta
// de imagen siguen definiéndose en el servidor y no en el cliente.
const MODELO_GEMINI = "models/gemini-3.1-flash-live-preview";

async function createGeminiToken(res) {
  if (!hasGeminiKey()) {
    return json(res, 503, {
      error: "Falta GEMINI_API_KEY: no hay proveedor de respaldo configurado.",
      code: "GEMINI_KEY_MISSING"
    });
  }

  const ahora = Date.now();
  const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY.trim(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(ahora + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(ahora + 2 * 60_000).toISOString()
    })
  });

  const cuerpo = await upstream.text();
  if (!upstream.ok) {
    console.error("Gemini auth_tokens:", upstream.status, cuerpo);
    return json(res, upstream.status, {
      error: "Gemini rechazó la GEMINI_API_KEY.",
      code: "GEMINI_KEY_INVALID"
    });
  }

  let token = "";
  try { token = JSON.parse(cuerpo).name || ""; } catch {}
  if (!token) {
    return json(res, 502, { error: "Gemini no devolvió un token utilizable.", code: "GEMINI_TOKEN_VACIO" });
  }

  json(res, 200, {
    token,
    setup: {
      model: MODELO_GEMINI,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: "es-US",
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
        }
      },
      systemInstruction: { parts: [{ text: PERSONA }] },
      // Sin esto no habría subtítulos ni historial con Gemini.
      outputAudioTranscription: {},
      tools: [{
        functionDeclarations: HERRAMIENTAS.map(h => ({
          name: h.nombre,
          description: h.descripcion,
          parameters: h.parametros
        }))
      }]
    }
  });
}

// Búsqueda de láminas anatómicas en Wikimedia Commons.
//
// Commons aloja las planchas de Gray's Anatomy (dominio público) y una enorme
// colección de diagramas médicos didácticos, todos obra publicada de
// ilustradores humanos y con licencia y ficha comprobables. Es lo contrario de
// generar: aquí no aparece nada que no existiera antes de preguntar.
async function buscarImagenMedica(req, res) {
  let peticion = {};
  try { peticion = JSON.parse(await readBody(req)); } catch {}
  const estructura = String(peticion.estructura || "").trim();
  if (!estructura) {
    return json(res, 400, { error: "Falta la estructura a ilustrar.", code: "SIN_ESTRUCTURA" });
  }
  const detalle = String(peticion.detalle || "").trim();

  // La consulta va deliberadamente escueta. Con grupos de OR («anatomy OR
  // anatomical», «diagram OR illustration OR scheme») el buscador reparte el
  // peso entre esas palabras y diluye el término que de verdad importa: para
  // «nephron» llegó a devolver anatomía de poliqueto, de hormiga y de caracol.
  // Un solo «diagram» basta para inclinarlo hacia material dibujado sin tapar
  // la estructura preguntada; de separar dibujo de fotografía ya se encarga la
  // puntuación posterior.
  const consulta = [estructura, detalle, "diagram"].filter(Boolean).join(" ");

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: consulta,
    gsrnamespace: "6", gsrlimit: "12",
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "900",
    iiextmetadatafilter: "Artist|LicenseShortName|License|ImageDescription",
    format: "json", origin: "*"
  }).toString();

  const upstream = await fetch(url, { headers: { "User-Agent": "Catalina/1.0 (docencia médica)" } });
  if (!upstream.ok) {
    console.error("Commons:", upstream.status);
    return json(res, 502, { error: "No se pudo consultar el atlas.", code: "ATLAS_NO_DISPONIBLE" });
  }

  const paginas = Object.values((await upstream.json())?.query?.pages ?? {});
  // Palabras con peso de la consulta. Sirven para comprobar que la lámina trata
  // de lo que se preguntó, no sólo de que esté dibujada.
  const terminos = estructura.toLowerCase().split(/\W+/).filter(palabra => palabra.length > 3);

  const laminas = paginas
    .map(pagina => {
      const info = pagina.imageinfo?.[0];
      if (!info || !String(info.mime || "").startsWith("image/")) return null;
      const meta = info.extmetadata ?? {};
      const titulo = String(pagina.title || "").replace(/^File:/, "").replace(/\.\w+$/, "");
      return {
        titulo,
        imagen: info.thumburl || info.url,
        mime: info.mime,
        autor: limpiarHtml(meta.Artist?.value) || "Autoría en la ficha de origen",
        licencia: limpiarHtml(meta.LicenseShortName?.value) || limpiarHtml(meta.License?.value) || "Ver ficha",
        fuente: info.descriptionurl,
        // `index` conserva el orden de relevancia que calculó Commons; sin él,
        // el orden del objeto de páginas es arbitrario.
        rango: pagina.index ?? 999,
        coincidencias: contarCoincidencias(titulo, limpiarHtml(meta.ImageDescription?.value), terminos)
      };
    })
    .filter(Boolean)
    // El orden importa y el criterio es jerárquico. Primero que trate del tema:
    // ordenar sólo por «parece dibujo» llegó a devolver anatomía de un caracol
    // para una consulta de plexo braquial, porque era un esquema en SVG.
    // Después, entre las que sí tratan del tema, la que esté dibujada.
    .sort((a, b) =>
      (b.coincidencias - a.coincidencias)
      || (puntuarDibujo(b) - puntuarDibujo(a))
      || (a.rango - b.rango));

  // Una lámina que no menciona lo que se preguntó no vale: es preferible decir
  // que no hay a mostrar algo de otro tema y explicarlo como si fuera correcto.
  const elegida = laminas.find(lamina => lamina.coincidencias > 0);
  if (!elegida) {
    return json(res, 404, { error: "No hay una lámina adecuada para eso.", code: "SIN_LAMINA" });
  }
  json(res, 200, { lamina: elegida });
}

function contarCoincidencias(titulo, descripcion, terminos) {
  if (!terminos.length) return 0;
  const texto = `${titulo} ${descripcion || ""}`.toLowerCase();
  return terminos.filter(palabra => texto.includes(palabra)).length;
}

function puntuarDibujo(lamina) {
  let puntos = 0;
  if (lamina.mime === "image/svg+xml") puntos += 3;
  if (lamina.mime === "image/png") puntos += 2;
  const titulo = lamina.titulo.toLowerCase();
  if (/(diagram|scheme|illustration|plate|gray|anatomography)/.test(titulo)) puntos += 2;
  if (/(photo|micrograph|cadaver|dissection|specimen)/.test(titulo)) puntos -= 3;
  return puntos;
}

// Referencias del concepto, en PubMed. No necesita clave: E-utilities es
// abierto, sólo pide identificar la herramienta que consulta.
async function buscarReferencias(req, res) {
  let peticion = {};
  try { peticion = JSON.parse(await readBody(req)); } catch {}
  const tema = String(peticion.tema || "").trim();
  if (!tema) return json(res, 400, { error: "Falta el tema a respaldar.", code: "SIN_TEMA" });

  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const comunes = { db: "pubmed", retmode: "json", tool: "catalina", email: "catalina@local" };

  const busqueda = await fetch(`${base}/esearch.fcgi?` + new URLSearchParams({
    ...comunes, term: tema, retmax: "4", sort: "relevance"
  }));
  if (!busqueda.ok) {
    return json(res, 502, { error: "No se pudo consultar PubMed.", code: "PUBMED_NO_DISPONIBLE" });
  }
  const ids = (await busqueda.json())?.esearchresult?.idlist ?? [];
  if (!ids.length) return json(res, 404, { error: "Sin referencias para ese tema.", code: "SIN_REFERENCIAS" });

  const resumen = await fetch(`${base}/esummary.fcgi?` + new URLSearchParams({ ...comunes, id: ids.join(",") }));
  if (!resumen.ok) {
    return json(res, 502, { error: "No se pudo consultar PubMed.", code: "PUBMED_NO_DISPONIBLE" });
  }
  const resultado = (await resumen.json())?.result ?? {};

  const referencias = ids.map(id => resultado[id]).filter(Boolean).map(item => ({
    titulo: item.title || "",
    autores: (item.authors ?? []).slice(0, 3).map(a => a.name).join(", ")
      + ((item.authors?.length ?? 0) > 3 ? " et al." : ""),
    revista: item.source || "",
    anio: (item.pubdate || "").slice(0, 4),
    pmid: item.uid,
    enlace: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`
  }));

  json(res, 200, { referencias });
}

function limpiarHtml(valor) {
  if (!valor) return "";
  return String(valor).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function hasApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim() || "";
  return key.length > 24 && !key.includes("reemplaza-esto");
}

function hasGeminiKey() {
  const key = process.env.GEMINI_API_KEY?.trim() || "";
  return key.length > 24 && !key.includes("reemplaza-esto");
}

async function loadEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equals = line.indexOf("=");
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      value = value.replace(/^(['"])(.*)\1$/, "$2");
      if (!(key in process.env) || !process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Catalina está disponible en http://127.0.0.1:${port}`);
});
