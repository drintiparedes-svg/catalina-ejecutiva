import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  cargarConfig, guardarConfig, componerInstrucciones, herramientasDeConectores
} from "./config.mjs";
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

    if (req.method === "POST" && req.url === "/conector") {
      return await usarConector(req, res);
    }

    if (req.url === "/admin/config" && (req.method === "GET" || req.method === "PUT")) {
      if (!autorizado(req)) return json(res, 401, { error: motivoDeRechazo(), code: "ADMIN_NO_AUTORIZADO" });
      if (req.method === "GET") return json(res, 200, await cargarConfig());
      try {
        return json(res, 200, await guardarConfig(JSON.parse(await readBody(req))));
      } catch (error) {
        // En Vercel el disco es de sólo lectura: conviene decirlo tal cual en
        // vez de dejar creer que se guardó.
        if (error.code === "EROFS" || error.code === "EACCES") {
          return json(res, 501, {
            error: "Este despliegue tiene el disco en sólo lectura y no puede guardar la configuración.",
            code: "ALMACEN_SOLO_LECTURA"
          });
        }
        return json(res, 400, { error: "Configuración inválida.", code: "CONFIG_INVALIDA" });
      }
    }

    if (req.method === "POST" && req.url === "/admin/probar-conector") {
      if (!autorizado(req)) return json(res, 401, { error: motivoDeRechazo(), code: "ADMIN_NO_AUTORIZADO" });
      return await probarConector(req, res);
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

// Cómo usar las herramientas. Esto no se edita desde el panel: no describe el
// carácter de Catalina sino cómo funcionan las herramientas, y si se pudiera
// borrar por descuido el modelo empezaría a narrar láminas que nunca aparecieron.
const USO_DE_HERRAMIENTAS = [
  "Apóyate en imágenes siempre que puedas: en cuanto expliques algo que se entienda mejor viéndolo, usa buscar_imagen_medica.",
  "Pide términos anatómicos sencillos y en inglés; si no aparece nada, prueba otra vez con un término más general antes de rendirte.",
  "La herramienta busca esquemas y diagramas ya publicados; no inventa imágenes.",
  "Explica como si fuera para un paciente: lenguaje llano, lo esencial primero, sin tecnicismos innecesarios.",
  "Al mostrar una lámina, ve señalando lo que se ve y explícalo; no leas el pie de imagen.",
  // La herramienta avisa cuando lo encontrado sólo se aproxima al tema. Sin
  // esta regla el modelo lo narraría como si fuera exacto, que es justo el
  // fallo que hace peligrosa una imagen equivocada en docencia.
  "Si el resultado viene marcado como aproximado, dilo: preséntalo como una imagen parecida y no como la estructura exacta.",
  "Si no aparece ninguna imagen, dilo con naturalidad y sigue explicando de palabra. Nunca afirmes que se ve algo que no apareció.",
  "Usa buscar_referencias para respaldar en la literatura lo que estés explicando."
].join(" ");

// Las instrucciones completas se arman en cada sesión: lo editable viene del
// panel, lo de arriba es fijo. Los dos proveedores reciben exactamente lo mismo,
// para que Catalina no cambie de carácter al pasar de uno a otro.
async function instruccionesDeSesion(config) {
  return [componerInstrucciones(config), USO_DE_HERRAMIENTAS].filter(Boolean).join(" ");
}

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

// Las internas más las que haya añadido el panel como conectores.
function todasLasHerramientas(config) {
  return [...HERRAMIENTAS, ...herramientasDeConectores(config)];
}

async function createRealtimeSession(req, res) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!hasApiKey()) {
    return json(res, 503, { error: "Falta OPENAI_API_KEY en el archivo .env", code: "API_KEY_MISSING" });
  }

  const config = await cargarConfig();
  const sdp = await readBody(req);
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify({
    type: "realtime",
    model: config.modelos?.openai?.modelo || "gpt-realtime-2.1",
    output_modalities: ["audio"],
    instructions: await instruccionesDeSesion(config),
    tools: todasLasHerramientas(config).map(h => ({
      type: "function",
      name: h.nombre,
      description: h.descripcion,
      parameters: h.parametros
    })),
    audio: {
      input: { turn_detection: { type: "server_vad", create_response: true, interrupt_response: true } },
      output: { voice: config.modelos?.openai?.voz || "marin" }
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

  const config = await cargarConfig();
  json(res, 200, {
    token,
    setup: {
      model: config.modelos?.gemini?.modelo || MODELO_GEMINI,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: config.modelos?.gemini?.idioma || "es-US",
          voiceConfig: { prebuiltVoiceConfig: { voiceName: config.modelos?.gemini?.voz || "Kore" } }
        }
      },
      systemInstruction: { parts: [{ text: await instruccionesDeSesion(config) }] },
      // Sin esto no habría subtítulos ni historial con Gemini.
      outputAudioTranscription: {},
      tools: [{
        functionDeclarations: todasLasHerramientas(config).map(h => ({
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

  // Palabras con peso de la consulta, para comprobar que la lámina trata de lo
  // que se preguntó y no sólo de que esté dibujada.
  const terminos = estructura.toLowerCase().split(/\W+/).filter(palabra => palabra.length > 3);

  // Dos tandas en paralelo, no una cascada en fila.
  //
  // Buscar por pasos encontraba imagen casi siempre, pero encadenaba hasta ocho
  // viajes de red y la espera se hacía larga. Lanzadas a la vez, la primera
  // tanda cuesta lo que la más lenta de sus tres consultas —no la suma— y
  // resuelve la mayoría de los casos. La segunda sólo se paga cuando hace falta.
  //
  // Las consultas van escuetas a propósito. Con grupos de OR el buscador
  // reparte el peso entre esas palabras y diluye el término que importa: para
  // «nephron» llegaba a devolver anatomía de poliqueto y de caracol.
  let lamina = await mejorDe([
    buscarEnCommons([estructura, detalle, "diagram"], terminos, true),
    buscarEnCommons([estructura, "anatomy diagram"], terminos, true),
    // La imagen principal de un artículo suele ser el esquema que uno usaría
    // para explicárselo a alguien. En español, que es el idioma de la charla.
    buscarEnWikipedia("es", estructura, terminos)
  ]);

  if (!lamina) {
    lamina = await mejorDe([
      buscarEnCommons([estructura, detalle], terminos, true),
      buscarEnWikipedia("en", estructura, terminos),
      // Último recurso: lo mejor que dé Commons aunque el título no mencione el
      // término. Va marcado como aproximado para que Catalina lo advierta en
      // vez de explicarlo como si fuera exacto.
      buscarEnCommons([estructura, "diagram"], terminos, false)
    ]);
  }

  if (!lamina) {
    return json(res, 404, { error: "No hay una lámina adecuada para eso.", code: "SIN_LAMINA" });
  }
  json(res, 200, { lamina });
}

// La mejor de varias búsquedas lanzadas a la vez. Una que falle o tarde no
// arrastra a las demás: se descarta y se compara lo que sí llegó.
async function mejorDe(promesas) {
  const acabadas = await Promise.allSettled(promesas);
  // Sin este registro, una consulta rota se descartaba igual que una que no
  // encontró nada y el fallo quedaba invisible.
  for (const r of acabadas) {
    if (r.status === "rejected") console.error("búsqueda de lámina:", r.reason?.message || r.reason);
  }
  const resultados = acabadas
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => r.value);

  // Criterio jerárquico. Primero la confianza en que trata del tema: ordenar
  // sólo por «parece dibujo» llegó a devolver un esquema de caracol para una
  // consulta de plexo braquial. Después, la más esquemática.
  return resultados.sort((a, b) =>
    (confianza(b) - confianza(a))
    || (puntuarDibujo(b) - puntuarDibujo(a))
    || (a.rango - b.rango))[0] ?? null;
}

// Una imagen de Wikipedia puede no repetir el término en el nombre del archivo
// y aun así ser la correcta: la eligió el artículo que trata el tema. Ese
// contexto vale tanto como la coincidencia literal, y más que una aproximada.
function confianza(lamina) {
  if (lamina.coincidencias > 0) return 2;
  if (lamina.articulo) return 2;
  return 0;
}

async function buscarEnCommons(partes, terminos, exigirCoincidencia) {
  const consulta = partes.filter(Boolean).join(" ").trim();
  if (!consulta) return null;

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: consulta,
    gsrnamespace: "6", gsrlimit: "20",
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "900",
    iiextmetadatafilter: "Artist|LicenseShortName|License|ImageDescription",
    format: "json", origin: "*"
  }).toString();

  const upstream = await fetch(url, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(7000) });
  if (!upstream.ok) return null;

  const paginas = Object.values((await upstream.json())?.query?.pages ?? {});
  const laminas = paginas
    .map(pagina => {
      const info = pagina.imageinfo?.[0];
      if (!info) return null;
      // `index` conserva el orden de relevancia que calculó Commons; sin él, el
      // orden del objeto de páginas es arbitrario.
      return describirArchivo(pagina.title, info, terminos, pagina.index ?? 999);
    })
    .filter(Boolean)
    // Criterio jerárquico. Primero que trate del tema: ordenar sólo por «parece
    // dibujo» llegó a devolver un esquema de caracol para una consulta de plexo
    // braquial. Después, entre las que sí tratan del tema, la más esquemática.
    .sort((a, b) =>
      (b.coincidencias - a.coincidencias)
      || (puntuarDibujo(b) - puntuarDibujo(a))
      || (a.rango - b.rango));

  const elegida = exigirCoincidencia
    ? laminas.find(lamina => lamina.coincidencias > 0)
    : laminas[0];
  if (!elegida) return null;
  return { ...elegida, aproximada: elegida.coincidencias === 0 };
}

// Imagen principal del artículo de Wikipedia. Se resuelve después contra
// Commons para poder mostrar autoría y licencia igual que el resto.
async function buscarEnWikipedia(idioma, estructura, terminos) {
  const url = new URL(`https://${idioma}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: estructura,
    gsrnamespace: "0", gsrlimit: "3",
    prop: "pageimages", piprop: "name", format: "json", origin: "*"
  }).toString();

  const upstream = await fetch(url, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(7000) });
  if (!upstream.ok) return null;

  const paginas = Object.values((await upstream.json())?.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 999) - (b.index ?? 999));

  for (const pagina of paginas) {
    if (!pagina.pageimage) continue;
    const lamina = await detallarArchivo(`File:${pagina.pageimage}`, terminos);
    // Se acepta aunque el nombre del archivo no repita el término: viene de la
    // cabecera del artículo que Wikipedia considera más relevante, y ese
    // contexto vale más que la coincidencia literal del nombre.
    if (lamina) return { ...lamina, aproximada: false, articulo: pagina.title };
  }
  return null;
}

async function detallarArchivo(titulo, terminos) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", titles: titulo,
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "900",
    iiextmetadatafilter: "Artist|LicenseShortName|License|ImageDescription",
    format: "json", origin: "*"
  }).toString();

  const upstream = await fetch(url, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(7000) });
  if (!upstream.ok) return null;

  const pagina = Object.values((await upstream.json())?.query?.pages ?? {})[0];
  const info = pagina?.imageinfo?.[0];
  return info ? describirArchivo(pagina.title, info, terminos, 0) : null;
}

function describirArchivo(tituloCompleto, info, terminos, rango) {
  if (!String(info.mime || "").startsWith("image/")) return null;
  const meta = info.extmetadata ?? {};
  const titulo = String(tituloCompleto || "").replace(/^File:/, "").replace(/\.\w+$/, "");
  return {
    titulo,
    imagen: info.thumburl || info.url,
    mime: info.mime,
    autor: limpiarHtml(meta.Artist?.value) || "Autoría en la ficha de origen",
    licencia: limpiarHtml(meta.LicenseShortName?.value) || limpiarHtml(meta.License?.value) || "Ver ficha",
    fuente: info.descriptionurl,
    rango,
    coincidencias: contarCoincidencias(titulo, limpiarHtml(meta.ImageDescription?.value), terminos)
  };
}

// Wikimedia pide identificarse con un contacto y estrangula a quien no lo hace.
// Con ráfagas de consultas se nota: las primeras pasan y las siguientes se
// rechazan sin más, que desde fuera parece «no hay imagen».
const AGENTE = "Catalina/1.0 (docencia médica; https://github.com/drintiparedes-svg/catalina-avatar)";

function contarCoincidencias(titulo, descripcion, terminos) {
  if (!terminos.length) return 0;
  const texto = `${titulo} ${descripcion || ""}`.toLowerCase();
  return terminos.filter(palabra => texto.includes(palabra)).length;
}

// Qué tan servible es para explicarle algo a un paciente. Se busca lo
// esquemático y simple: un dibujo limpio y rotulado se entiende de un vistazo,
// mientras que una disección, una microscopía o una radiografía piden formación
// previa y muchas veces impresionan.
function puntuarDibujo(lamina) {
  let puntos = 0;
  if (lamina.mime === "image/svg+xml") puntos += 3;   // vectorial: casi siempre un esquema
  if (lamina.mime === "image/png") puntos += 2;
  const titulo = lamina.titulo.toLowerCase();
  if (/(diagram|scheme|schema|illustration|esquema|diagrama|simple|plate|gray|anatomography)/.test(titulo)) puntos += 2;
  if (/(photo|foto|micrograph|histolog|cadaver|dissection|specimen|autopsy)/.test(titulo)) puntos -= 4;
  if (/(mri|ct scan|radiograph|angiogra|ultrasound|ecograf)/.test(titulo)) puntos -= 2;
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

// Puerta del administrador.
//
// Cerrada por defecto y a propósito: el panel cambia el prompt, los modelos y
// los conectores, así que dejarlo abierto en un sitio público sería entregar el
// control de Catalina a cualquiera. Sin ADMIN_TOKEN sólo responde en el propio
// equipo, donde ya hace falta estar sentado delante.
function autorizado(req) {
  const esperado = process.env.ADMIN_TOKEN?.trim();
  if (esperado) {
    const recibido = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    return recibido.length > 0 && recibido === esperado;
  }
  return esLocal(req);
}

function esLocal(req) {
  // Detrás de un proxy (Vercel) siempre hay cabecera de reenvío: la presencia
  // de x-forwarded-for basta para saber que la petición no nació aquí.
  if (req.headers["x-forwarded-for"]) return false;
  const origen = req.socket.remoteAddress || "";
  return origen === "127.0.0.1" || origen === "::1" || origen === "::ffff:127.0.0.1";
}

function motivoDeRechazo() {
  return process.env.ADMIN_TOKEN?.trim()
    ? "Token de administración incorrecto."
    : "El administrador sólo está abierto en el equipo local. Define ADMIN_TOKEN para usarlo a distancia.";
}

// Uso de un conector durante la conversación. El navegador manda el nombre, no
// la dirección: así una página manipulada no puede convertir esto en un puente
// para llamar a donde quiera desde el servidor.
async function usarConector(req, res) {
  let peticion = {};
  try { peticion = JSON.parse(await readBody(req)); } catch {}

  const config = await cargarConfig();
  const conector = (config.conectores ?? []).find(
    item => item.nombre === peticion.nombre && item.activo !== false
  );
  if (!conector) return json(res, 404, { ok: false, error: "Conector no disponible." });

  const resultado = await llamarConector(conector, String(peticion.consulta || ""));
  json(res, 200, resultado);
}

// Prueba de un conector desde el panel, para no descubrir que está mal escrito
// en mitad de una conversación.
async function probarConector(req, res) {
  let peticion = {};
  try { peticion = JSON.parse(await readBody(req)); } catch {}
  const resultado = await llamarConector(peticion, peticion.consulta || "prueba");
  json(res, resultado.ok ? 200 : 502, resultado);
}

// Llamada a un conector. La URL vive en el servidor y nunca llega al navegador
// ni al modelo: éste sólo conoce el nombre y para qué sirve.
async function llamarConector(conector, consulta) {
  let destino;
  try {
    destino = new URL(conector.url);
  } catch {
    return { ok: false, error: "La dirección del conector no es válida." };
  }
  if (destino.protocol !== "https:") {
    return { ok: false, error: "Un conector debe usar https." };
  }

  const cabeceras = { Accept: "application/json" };
  if (conector.cabecera && conector.valorCabecera) cabeceras[conector.cabecera] = conector.valorCabecera;

  const metodo = conector.metodo === "POST" ? "POST" : "GET";
  if (metodo === "POST") cabeceras["Content-Type"] = "application/json";
  else destino.searchParams.set(conector.parametroConsulta || "q", consulta);

  try {
    const upstream = await fetch(destino, {
      method: metodo,
      headers: cabeceras,
      body: metodo === "POST" ? JSON.stringify({ consulta }) : undefined,
      signal: AbortSignal.timeout(12000)
    });
    const texto = await upstream.text();
    if (!upstream.ok) return { ok: false, error: `El conector respondió ${upstream.status}.` };
    // Se recorta: lo que vuelve entra en el contexto de una sesión de voz y un
    // volcado entero de JSON la ahogaría.
    return { ok: true, respuesta: texto.slice(0, 4000) };
  } catch (error) {
    return { ok: false, error: error.name === "TimeoutError" ? "El conector tardó demasiado." : "No se pudo contactar el conector." };
  }
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
