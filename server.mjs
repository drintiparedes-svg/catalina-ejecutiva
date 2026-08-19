import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  cargarConfig, guardarConfig, componerInstrucciones, herramientasDeConectores
} from "./config.mjs";
import { plantillaMediSmart, versionTexto, enviarPorResend } from "./correo.mjs";
import { buscarFarmacias, buscarCentros } from "./salud.mjs";
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

    if (req.method === "POST" && req.url === "/salud") {
      return await buscarSalud(req, res);
    }

    if (req.method === "POST" && req.url === "/correo") {
      return await enviarResumen(req, res);
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

// Envío del resumen. El modelo aporta el asunto y el texto; nunca el
// destinatario, que vive en la configuración del servidor.
const PARAMETROS_CORREO = {
  type: "object",
  properties: {
    titulo: {
      type: "string",
      description: "Título del resumen, claro y concreto. Por ejemplo «Cómo funciona la vía urinaria»."
    },
    resumen: {
      type: "string",
      description: "La explicación redactada para que se lea después, en español y en párrafos cortos. "
        + "Escríbela completa: quien la reciba no tendrá delante la conversación."
    }
  },
  required: ["titulo", "resumen"]
};

const DESCRIPCION_CORREO = "Envía por correo un resumen de lo explicado, con la lámina y las referencias "
  + "que estén en pantalla, en la plantilla MediSmart. Úsala sólo cuando te lo pidan expresamente. "
  + "El destinatario ya está configurado: no lo preguntes ni lo elijas.";

const PARAMETROS_SALUD = {
  type: "object",
  properties: {
    tipo: {
      type: "string",
      enum: ["farmacia_turno", "farmacia", "hospital", "clinica"],
      description: "Qué se busca. «farmacia_turno» es la que está de turno hoy, para urgencias fuera de horario."
    },
    comuna: {
      type: "string",
      description: "Comuna de Chile donde buscar, tal como la diga la persona: «Providencia», «Ñuñoa», «Viña del Mar». "
        + "Pregúntala si no la sabes y no hay ubicación disponible."
    }
  },
  required: ["tipo"]
};

const DESCRIPCION_SALUD = "Busca farmacias, farmacias de turno, hospitales y clínicas cerca, en Chile. "
  + "Las farmacias de turno vienen del MINSAL y los centros de salud de OpenStreetMap. "
  + "Usa la ubicación del dispositivo si está disponible; si no, pide la comuna. "
  + "Al responder, di la dirección y a qué distancia queda, y recuerda que conviene confirmar por teléfono.";

const HERRAMIENTAS = [
  { nombre: "buscar_imagen_medica", descripcion: DESCRIPCION_IMAGEN, parametros: PARAMETROS_IMAGEN },
  { nombre: "buscar_salud_cerca", descripcion: DESCRIPCION_SALUD, parametros: PARAMETROS_SALUD },
  { nombre: "buscar_referencias", descripcion: DESCRIPCION_REFERENCIAS, parametros: PARAMETROS_REFERENCIAS },
  { nombre: "enviar_resumen", descripcion: DESCRIPCION_CORREO, parametros: PARAMETROS_CORREO }
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

  const terminos = terminosDeTema(estructura);

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
  // ¿La pregunta era clínica? Si alguien pide la hiperplasia de próstata,
  // quiere verla; si pide la vía urinaria, no. Esa distinción es la que evita
  // devolver un dispositivo o una enfermedad cuando se pidió anatomía normal.
  const pideClinico = CLINICO.test(`${estructura} ${detalle}`);

  let lamina = await mejorDe([
    buscarEnCommons([estructura, detalle, "diagram"], terminos, true, pideClinico),
    // «human» aparta la lámina veterinaria y la de invertebrado, que en Commons
    // abundan y comparten nombre con las humanas: «jaw anatomy» devolvía la
    // mandíbula de una babosa marina. Va en esta consulta y no en una cuarta:
    // con cuatro en paralelo Commons empezaba a cortar por tiempo y el
    // resultado cambiaba de una llamada a otra.
    buscarEnCommons([estructura, "human anatomy diagram"], terminos, true, pideClinico),
    // La imagen principal de un artículo suele ser el esquema que uno usaría
    // para explicárselo a alguien. En español, que es el idioma de la charla.
    buscarEnWikipedia("es", estructura, terminos, pideClinico)
  ], pideClinico);

  // Una lámina clínica cuando no se pidió nada clínico se descarta y se vuelve a
  // buscar. Mostrar un dispositivo o una enfermedad como si fuera la anatomía
  // normal es peor que tardar un poco más: quien lo mira es un paciente.
  if (lamina && !pideClinico && CLINICO.test(`${lamina.titulo} ${lamina.descripcion || ""}`)) {
    lamina = null;
  }

  // Listón mínimo de calidad didáctica. Sin él se aceptaba lo primero que
  // coincidiera de palabra aunque no fuese un esquema: una foto de la planta
  // «Phyllanthus urinaria» para la vía urinaria, o un trazado de ECG para el
  // infarto. Si lo mejor de la primera tanda no parece un esquema, se busca
  // también en la segunda y se elige entre ambas.
  const primera = lamina;
  if (!lamina || puntuarLamina(lamina, pideClinico) < 2) {
    const segunda = await mejorDe([
      buscarEnCommons([estructura, detalle], terminos, true, pideClinico),
      // «system» y «anatomy» empujan hacia la lámina de conjunto que se usa
      // para explicar, y apartan la complicación concreta.
      buscarEnCommons([estructura.replace(/\btract\b/i, "system"), "anatomy"], terminos, true, pideClinico),
      buscarEnWikipedia("en", estructura, terminos, pideClinico),
      // Último recurso: lo mejor que dé Commons aunque el título no mencione el
      // término. Va marcado como aproximado para que Catalina lo advierta en
      // vez de explicarlo como si fuera exacto.
      buscarEnCommons([estructura, "diagram"], terminos, false, pideClinico)
    ], pideClinico);

    // Se queda la mejor de las dos tandas, no simplemente la segunda: a veces
    // la primera ya traía lo correcto y sólo faltaba comprobarlo. El filtro
    // clínico se repite aquí porque la segunda tanda no había pasado por él, y
    // por ese hueco se colaba una lámina de hipertensión al pedir la vía
    // urinaria.
    const candidatas = [primera, segunda]
      .filter(Boolean)
      .filter(c => pideClinico || !CLINICO.test(`${c.titulo} ${c.descripcion || ""}`));

    lamina = candidatas.sort(
      (a, b) => puntuarLamina(b, pideClinico) - puntuarLamina(a, pideClinico)
    )[0] ?? null;
  }

  if (!lamina) {
    return json(res, 404, { error: "No hay una lámina adecuada para eso.", code: "SIN_LAMINA" });
  }
  json(res, 200, { lamina });
}

// La mejor de varias búsquedas lanzadas a la vez. Una que falle o tarde no
// arrastra a las demás: se descarta y se compara lo que sí llegó.
async function mejorDe(promesas, pideClinico = false) {
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
  // consulta de plexo braquial. Después, la más útil para explicar.
  return resultados.sort((a, b) =>
    (confianza(b) - confianza(a))
    || (puntuarLamina(b, pideClinico) - puntuarLamina(a, pideClinico))
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

async function buscarEnCommons(partes, terminos, exigirCoincidencia, pideClinico = false) {
  const consulta = partes.filter(Boolean).join(" ").trim();
  if (!consulta) return null;

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: consulta,
    gsrnamespace: "6", gsrlimit: "20",
    // Acotar también el alto es lo que hace usable la lámina fuera de la
    // pantalla: muchas son verticales y muy largas —la del aparato urinario
    // mide 795×1769— y sin este límite ocupaban el correo entero.
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "900", iiurlheight: "620",
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
    // Criterio jerárquico. Antes mandaba la coincidencia de términos, y por eso
    // «Urinary Tract Infection» ganaba: acertaba las dos palabras. Ahora manda
    // la nota —que descuenta patología y dispositivos y premia lo esquemático—
    // y la coincidencia decide los empates. El orden de Commons queda al final.
    .sort((a, b) =>
      (puntuarLamina(b, pideClinico) - puntuarLamina(a, pideClinico))
      || (b.coincidencias - a.coincidencias)
      || (a.rango - b.rango));

  // La coincidencia tiene que estar en el título, no basta la descripción.
  // «Dried cranberries» menciona la vía urinaria en su texto y llegó a colarse
  // como lámina del aparato urinario; el nombre del archivo es mucho mejor
  // indicio de qué muestra la imagen que su descripción libre.
  const elegida = exigirCoincidencia
    ? laminas.find(lamina => lamina.enTitulo > 0)
    : laminas[0];
  if (!elegida) return null;
  return { ...elegida, aproximada: elegida.enTitulo === 0 };
}

// Imagen principal del artículo de Wikipedia. Se resuelve después contra
// Commons para poder mostrar autoría y licencia igual que el resto.
async function buscarEnWikipedia(idioma, estructura, terminos, pideClinico = false) {
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

    // Antes se tomaba el primer artículo sin mirar de qué trataba, y ahí nacía
    // el error de la vía urinaria: para «urinary tract» el artículo mejor
    // posicionado era la hiperplasia de próstata, y su imagen de cabecera
    // llegaba como si fuese la anatomía pedida.
    if (!pideClinico && CLINICO.test(pagina.title || "")) continue;

    // El artículo tiene que hablar del tema. Sin esta comprobación, buscar «vía
    // urinaria» daba con el artículo del arándano rojo —que la menciona por su
    // uso preventivo— y se mostraba su foto de arándanos secos como si fuera
    // la lámina pedida.
    const tituloArticulo = (pagina.title || "").toLowerCase();
    if (!terminos.some(palabra => tituloArticulo.includes(palabra))) continue;

    const lamina = await detallarArchivo(`File:${pagina.pageimage}`, terminos);
    if (!lamina) continue;
    if (!pideClinico && CLINICO.test(`${lamina.titulo} ${lamina.descripcion || ""}`)) continue;
    if (NO_HUMANO.test(lamina.titulo)) continue;

    // Se acepta aunque el nombre del archivo no repita el término: viene de la
    // cabecera del artículo que Wikipedia considera más relevante, y ese
    // contexto vale más que la coincidencia literal del nombre.
    return { ...lamina, aproximada: false, articulo: pagina.title };
  }
  return null;
}

async function detallarArchivo(titulo, terminos) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", titles: titulo,
    // Acotar también el alto es lo que hace usable la lámina fuera de la
    // pantalla: muchas son verticales y muy largas —la del aparato urinario
    // mide 795×1769— y sin este límite ocupaban el correo entero.
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "900", iiurlheight: "620",
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
  const descripcion = limpiarHtml(meta.ImageDescription?.value);
  return {
    titulo,
    descripcion,
    imagen: info.thumburl || info.url,
    mime: info.mime,
    autor: limpiarHtml(meta.Artist?.value) || "Autoría en la ficha de origen",
    licencia: limpiarHtml(meta.LicenseShortName?.value) || limpiarHtml(meta.License?.value) || "Ver ficha",
    fuente: info.descriptionurl,
    rango,
    ...(({ total, enTitulo }) => ({ coincidencias: total, enTitulo }))(
      contarCoincidencias(titulo, descripcion, terminos)
    )
  };
}

// Wikimedia pide identificarse con un contacto y estrangula a quien no lo hace.
// Con ráfagas de consultas se nota: las primeras pasan y las siguientes se
// rechazan sin más, que desde fuera parece «no hay imagen».
const AGENTE = "Catalina/1.0 (docencia médica; https://github.com/drintiparedes-svg/catalina-avatar)";

// Palabras de andamiaje: dicen qué clase de lámina es, no de qué trata.
// Contarlas como coincidencia hacía pasar «Scheme turtle anatomy» por una
// lámina de hígado, porque compartían la palabra «anatomy».
const GENERICAS = new Set([
  "anatomy", "anatomia", "anatomía", "anatomical", "anatomic",
  "diagram", "diagrama", "scheme", "esquema", "schema", "illustration", "ilustracion",
  "system", "sistema", "human", "humano", "humana", "medical", "medico", "médico",
  "body", "cuerpo", "structure", "estructura", "view", "vista", "chart", "labeled"
]);

// El tema real de la consulta, sin el andamiaje. Si sólo quedaran genéricas se
// devuelven todas: es preferible una comprobación floja a ninguna.
// El umbral es de tres letras, no de cuatro: con cuatro se caían «eye», «ear»,
// «hip», «rib» y «jaw», y al quedarse la consulta sólo con la palabra genérica
// «anatomy» cualquier lámina servía —«eye anatomy» devolvía la anatomía de un
// anfípodo—.
function terminosDeTema(texto) {
  const palabras = texto.toLowerCase().split(/\W+/).filter(p => p.length > 2);
  const concretas = palabras.filter(p => !GENERICAS.has(p));
  return concretas.length ? concretas : palabras;
}

// El título pesa mucho más que la descripción. Una imagen de un dispositivo o
// de una enfermedad suele mencionar el órgano en su descripción —«esfínter
// urinario artificial» habla de la vía urinaria— y contando ambos por igual
// empataba con la lámina de anatomía que sí se pedía.
function contarCoincidencias(titulo, descripcion, terminos) {
  if (!terminos.length) return { total: 0, enTitulo: 0 };
  const enTitulo = terminos.filter(palabra => titulo.toLowerCase().includes(palabra)).length;
  const enDescripcion = terminos.filter(palabra => (descripcion || "").toLowerCase().includes(palabra)).length;
  return { total: enTitulo * 3 + enDescripcion, enTitulo };
}

// Señales de que la lámina muestra enfermedad, dispositivo o cirugía en lugar
// de anatomía normal.
//
// Es la corrección más importante de la búsqueda. Pedir «vía urinaria» devolvía
// un esfínter urinario artificial, y «urinary tract» una hiperplasia de
// próstata: son coincidencias perfectas de término, pero no son lo que se
// quiere para explicarle a un paciente cómo funciona su cuerpo. Sólo penaliza
// cuando la pregunta no era clínica: si alguien pide justamente la hiperplasia,
// la quiere ver.
const CLINICO = new RegExp([
  "infecc|infection|cancer|cáncer|carcinom|tumou?r|neoplas|metasta",
  "hiperplas|hyperplas|hipertrof|hypertroph|enferm|disease|síndrom|syndrome",
  "estenosis|stenosis|obstrucc|obstruct|lesion|lesión|fractur|absces|abscess",
  "inflamac|inflammat|itis\\b|patolog|patholog|cálculo|calculi|stone|litiasis",
  "hipertens|hypertens|diabet|insuficien|failure|isquem|ischem|infarto|infarct",
  "displas|dysplas|malform|deform|atrofia|atroph|hernia|prolaps|aneurism|aneurysm",
  "prótesis|prosthes|implant|artificial|catéter|catheter|stent|sonda|drenaje",
  "cirug|surger|surgical|quirúrg|operac|operation|resecc|resect|injerto|graft",
  "biopsia|biopsy|tratamiento|treatment|terapia|therapy|fármaco|drug"
].join("|"), "i");

// Colecciones modernas hechas para enseñar. `gray` se dejó fuera a propósito:
// las planchas de 1918 son correctas pero densas y sin color, y para explicarle
// algo a un paciente pierden contra un diagrama rotulado de hoy.
const DIDACTICO = /(cruk|blausen|servier|anatomography|esquema|scheme|schema|diagram)/i;

// Anatomía que no es humana. Commons está lleno de láminas veterinarias y de
// animal de laboratorio: «liver anatomy» devolvía el hígado de un ratón.
// El plural opcional importa: «Sheeps liver diagram» se colaba porque el
// filtro exigía «sheep» exacto.
const NO_HUMANO = new RegExp(
  "\\b(mouse|mice|rat|rodent|murine|bovine|canine|feline|dog|cat|horse|equine|porcine"
  + "|pig|sheep|goat|cow|cattle|chicken|avian|bird|fish|frog|toad|turtle|tortoise|reptile"
  + "|amphibian|lizard|snake|zebrafish|drosophila|insect|ant|bee|snail|slug|worm|polychaeta"
  + "|octopus|crab|spider|amphipod|krill|shrimp|crustacean|arthropod|mollusc|nudibranch"
  + "|larva|fiona|plant|phyllanthus|veterinar"
  + "|ratón|rata|perro|gato|caballo|cerdo|vaca|oveja|tortuga|serpiente|insecto|caracol|planta)"
  + "e?s?\\b", "i");

// Nota final de una lámina dentro de su tanda. Se separa del orden de Commons
// a propósito: el buscador ordena por parecido de texto, no por si la imagen
// sirve para explicarle algo a un paciente.
function puntuarLamina(lamina, pideClinico) {
  let puntos = puntuarDibujo(lamina);
  const texto = `${lamina.titulo} ${lamina.descripcion || ""}`;

  // Sin esto, «Urinary Tract Infection» le ganaba a la lámina del aparato
  // urinario por tener las dos palabras exactas en el título.
  if (!pideClinico && CLINICO.test(texto)) puntos -= 8;

  if (NO_HUMANO.test(lamina.titulo)) puntos -= 6;
  // Decirlo en el título es la señal más fiable de que la lámina es humana, y
  // en Commons conviven con las veterinarias y las de invertebrados.
  if (/\b(human|humano|humana)\b/i.test(lamina.titulo)) puntos += 2;

  // Colecciones pensadas para enseñar: CRUK, Blausen, Servier, Anatomography.
  // Suelen ser justo el esquema limpio y rotulado que se busca.
  if (DIDACTICO.test(lamina.titulo)) puntos += 2;

  return puntos;
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
  // Registros y estudios: son reales y útiles, pero no explican la anatomía a
  // un paciente. Un trazado de ECG salía como «esquema» del infarto.
  if (/(mri|ct scan|radiograph|angiogra|ultrasound|ecograf|ecg|ekg|electrocardiogra|scintigra|endoscop)/.test(titulo)) puntos -= 3;
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

  // El filtro de humanos no es un adorno. Sin él, «urinary tract anatomy»
  // devolvía citología renal en una revista veterinaria y anatomía comparada de
  // la cobaya: correctas como ciencia, inútiles para explicarle algo a un
  // paciente. Si no hubiera nada con el filtro, se reintenta sin él.
  const conFiltro = await fetch(`${base}/esearch.fcgi?` + new URLSearchParams({
    ...comunes, term: `${tema} AND humans[MeSH Terms]`, retmax: "4", sort: "relevance"
  }));
  let busqueda = conFiltro;
  if (conFiltro.ok) {
    const previo = (await conFiltro.clone().json())?.esearchresult?.idlist ?? [];
    if (!previo.length) {
      busqueda = await fetch(`${base}/esearch.fcgi?` + new URLSearchParams({
        ...comunes, term: tema, retmax: "4", sort: "relevance"
      }));
    }
  }
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

// Búsqueda de recursos de salud cercanos.
async function buscarSalud(req, res) {
  let peticion = {};
  try { peticion = JSON.parse(await readBody(req)); } catch {}

  const tipo = String(peticion.tipo || "").trim();
  const comuna = String(peticion.comuna || "").trim();
  const lat = Number(peticion.lat);
  const lon = Number(peticion.lon);

  try {
    if (tipo === "farmacia_turno" || tipo === "farmacia") {
      return json(res, 200, await buscarFarmacias({
        deTurno: tipo === "farmacia_turno", comuna, lat, lon
      }));
    }
    if (tipo === "hospital" || tipo === "clinica") {
      return json(res, 200, await buscarCentros({ tipo, comuna, lat, lon }));
    }
    return json(res, 400, { ok: false, error: "Tipo no reconocido." });
  } catch (error) {
    console.error("salud:", error.message);
    // Se dice que no se pudo consultar, no que no hay nada: son cosas
    // distintas y confundirlas deja a alguien sin buscar por otra vía.
    // `detalle` no lo lee Catalina; sirve para diagnosticar desde fuera por qué
    // una fuente falla en el despliegue y no en local.
    return json(res, 502, {
      ok: false,
      error: "No se pudo consultar la fuente oficial en este momento.",
      detalle: `${error.name}: ${error.message}`.slice(0, 200)
    });
  }
}

// Envío del resumen por correo.
//
// El destinatario y el remitente salen de la configuración; del navegador sólo
// llega el contenido. Es la diferencia entre una herramienta que redacta y una
// que además decide a quién escribir: lo segundo convertiría cualquier texto
// leído en voz alta en una vía para sacar información a otra dirección.
async function enviarResumen(req, res) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return json(res, 503, {
      ok: false,
      error: "Falta RESEND_API_KEY: no hay forma de enviar correo.",
      code: "CORREO_SIN_CLAVE"
    });
  }

  const config = await cargarConfig();
  const correo = config.correo ?? {};
  if (correo.activo === false) {
    return json(res, 403, { ok: false, error: "El envío de correo está desactivado.", code: "CORREO_DESACTIVADO" });
  }
  if (!correo.destinatario) {
    return json(res, 503, { ok: false, error: "No hay destinatario configurado.", code: "CORREO_SIN_DESTINO" });
  }

  let peticion = {};
  try { peticion = JSON.parse(await readBody(req)); } catch {}

  const titulo = String(peticion.titulo || "").trim();
  const resumen = String(peticion.resumen || "").trim();
  if (!titulo || !resumen) {
    return json(res, 400, { ok: false, error: "Falta el título o el resumen.", code: "CORREO_INCOMPLETO" });
  }

  const datos = {
    titulo,
    resumen,
    lamina: peticion.lamina || null,
    referencias: Array.isArray(peticion.referencias) ? peticion.referencias.slice(0, 8) : []
  };

  const resultado = await enviarPorResend({
    apiKey,
    remitente: correo.remitente || "Catalina <onboarding@resend.dev>",
    destinatario: correo.destinatario,
    asunto: `MediSmart · ${titulo}`,
    html: plantillaMediSmart(datos),
    texto: versionTexto(datos)
  });

  if (!resultado.ok) {
    console.error("Correo:", resultado.estado, resultado.error);
    return json(res, 502, { ok: false, error: resultado.error, code: "CORREO_RECHAZADO" });
  }
  // El destinatario se devuelve para que Catalina pueda confirmarlo en voz alta.
  json(res, 200, { ok: true, destinatario: correo.destinatario });
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
