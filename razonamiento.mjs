// GPT-Live con razonamiento de Claude.
//
// GPT-Live es un modelo de voz de OpenAI que escucha y habla a la vez. No
// piensa a fondo ni usa herramientas por su cuenta: cuando hace falta, *delega*
// —emite `session.delegation.created`— y espera a que la aplicación le devuelva
// un resultado, que luego dice con sus palabras. Con la delegación de tipo
// «client» quien piensa es la aplicación, y aquí esa aplicación es Claude.
//
// El reparto queda así:
//   · GPT-Live: la voz, los turnos, las interrupciones, la muletilla de espera.
//   · Claude: el criterio, la evidencia y las herramientas de Catalina.
//
// Este módulo no abre conexiones de audio: arma la sesión de GPT-Live que el
// servidor envía a OpenAI y da un paso de razonamiento con Claude cada vez que
// el navegador lo pide. Las herramientas las ejecuta el navegador, con el mismo
// código que usan las demás voces, porque muchas pintan en pantalla (láminas,
// mapas, referencias).
//
// Protocolo verificado contra el SDK oficial de OpenAI (openai 3.22.1,
// openai/types/live/*): POST /v1/live/sessions con { session, transport }.

// Voces integradas de GPT-Live (openai/types/live/built_in_voice.py). Se valida
// contra esta lista porque la sesión rechaza cualquier campo que no conozca, y
// una voz mal escrita dejaría a Catalina sin conectar.
export const VOCES_LIVE = [
  "alloy", "ash", "ballad", "beacon", "bossa", "cedar", "cinder", "coral",
  "delta", "echo", "gleam", "marin", "meridian", "quartz", "ripple", "sage",
  "shimmer", "stone", "tempo", "verse", "vesper", "willow"
];

const MODELO_VALIDO = /^[a-z0-9][a-z0-9.\-_]{1,79}$/i;
const ESFUERZOS = new Set(["low", "medium", "high"]);
// Nombres de herramienta que acepta la API de Claude.
const NOMBRE_HERRAMIENTA = /^[a-zA-Z0-9_-]{1,128}$/;

// Lo que el navegador puede hacer por el canal de datos. Sólo lo necesario: oír
// las delegaciones y las transcripciones, y devolver resultados. No puede
// cambiar las instrucciones de la sesión.
const EVENTOS_DEL_NAVEGADOR = ["session.commentary.append", "session.thinking.append", "session.close"];
const EVENTOS_AL_NAVEGADOR = [
  "session.started", "session.closed", "error",
  "session.delegation.created",
  "session.input_transcript.delta", "session.output_transcript.delta",
  "session.commentary.appended", "session.thinking.appended"
];

// Cómo y cuándo delegar. Va al final de las instrucciones de la voz: el resto
// —quién es Catalina y cómo habla— es lo mismo que reciben las demás voces.
const GUIA_DE_DELEGACION = [
  "Trabajas con un equipo que piensa y busca por ti: tú conversas, y cuando haga falta algo más que conversar, delegas la tarea.",
  "Delega siempre que te pidan datos, cifras, fuentes, una búsqueda, imágenes, láminas, videos, una ruta, una llamada, un correo, algo de una reunión, o un análisis que requiera pensar con cuidado. No respondas de memoria a esas preguntas.",
  "Al delegar, di una muletilla breve y natural —«déjame ver», «dame un segundo»— y sigue atenta a la persona mientras llega el resultado.",
  "Cuando llegue el resultado, dilo con tus palabras, corto, sin leerlo literal y sin añadir datos que no estén en él. Si el resultado dice que algo no se pudo hacer, dilo tal cual.",
  "Si la persona cambia de tema mientras esperas, sigue su conversación y descarta el resultado que ya no venga al caso."
].join(" ");

// Lo que Claude tiene que saber de su papel. Sin esto respondería como en un
// chat: con listas, encabezados y párrafos largos que nadie va a leer.
const MARCO_DEL_RAZONAMIENTO = [
  "Contexto de esta sesión: lo que escribas no se lee en pantalla. Lo recibe la voz de Catalina, que lo dice con sus palabras a la persona. Tú eres el criterio y las herramientas detrás de esa voz.",
  "Recibirás la transcripción de la conversación hablada. Las transcripciones automáticas tienen errores: interpreta con sentido común y, si algo es ambiguo de verdad, di qué falta saber.",
  "Actúa sobre la petición más reciente de la persona. Usa las herramientas cuando hagan falta y después responde.",
  "Responde en texto plano, en el idioma de la persona, en dos a cuatro frases: sin listas, viñetas, encabezados, tablas, enlaces ni markdown. Si citas una fuente, nómbrala en la frase.",
  "No saludes ni te presentes: la voz ya está conversando."
].join(" ");

export function vozValida(voz) {
  return VOCES_LIVE.includes(voz) ? voz : null;
}

// Configuración de arranque de la sesión de GPT-Live. Todo queda fijo al
// arrancar: la voz, las instrucciones y quién piensa (la aplicación).
export function sesionDeVoz({ modelo, voz, instrucciones }) {
  return {
    model: MODELO_VALIDO.test(modelo || "") ? modelo : "gpt-live-1",
    instructions: [instrucciones, GUIA_DE_DELEGACION].filter(Boolean).join(" "),
    audio: { output: { voice: vozValida(voz) || "marin" } },
    delegation: { type: "client" },
    client: {
      data_channel: {
        allowed_client_events: EVENTOS_DEL_NAVEGADOR,
        allowed_server_events: EVENTOS_AL_NAVEGADOR.map(type => ({ type }))
      }
    }
  };
}

export function instruccionesDeRazonamiento(completas) {
  return [MARCO_DEL_RAZONAMIENTO, completas].filter(Boolean).join("\n\n");
}

// Las herramientas de Catalina, en el formato de Claude. Se descarta la que
// tenga un nombre que la API no acepta (un conector mal nombrado en el panel):
// mejor perder esa herramienta que la sesión entera.
export function herramientasParaClaude(herramientas) {
  return (herramientas ?? [])
    .filter(h => NOMBRE_HERRAMIENTA.test(h?.nombre || ""))
    .map(h => ({
      name: h.nombre,
      description: h.descripcion || h.nombre,
      input_schema: h.parametros?.type === "object" ? h.parametros : { type: "object", properties: {} }
    }));
}

// Lo que el navegador manda como historia de Claude. La historia vive en el
// navegador y se reenvía completa en cada paso (la API de Claude no guarda
// estado). Se comprueba la forma, no el contenido: los bloques que devolvió
// Claude tienen que volver intactos.
export function historiaValida(mensajes) {
  if (!Array.isArray(mensajes) || !mensajes.length || mensajes.length > 400) return false;
  if (mensajes[0]?.role !== "user") return false;
  return mensajes.every(m =>
    m && (m.role === "user" || m.role === "assistant") &&
    (typeof m.content === "string" || Array.isArray(m.content))
  );
}

// Un paso de razonamiento: una llamada a Claude con la historia completa.
// Devuelve el contenido tal cual —para que el navegador lo agregue a la
// historia sin tocarlo— y, ya separados, el texto y las herramientas pedidas.
export async function pasoDeRazonamiento({ clave, modelo, esfuerzo, sistema, herramientas, mensajes, cargarSdk = cargarAnthropic }) {
  const Anthropic = await cargarSdk();
  if (!Anthropic) {
    return { ok: false, error: "Falta el paquete @anthropic-ai/sdk en el servidor (ejecuta «npm install»).", code: "ANTHROPIC_SDK_MISSING" };
  }
  // Tope corto: en una conversación hablada, una respuesta que tarda más de
  // medio minuto ya no sirve. La voz sigue mientras tanto.
  const cliente = new Anthropic({ apiKey: clave, timeout: 30000, maxRetries: 1 });
  const base = {
    model: MODELO_VALIDO.test(modelo || "") ? modelo : "claude-sonnet-5-5",
    max_tokens: 4000,
    // Instrucciones y herramientas no cambian durante la sesión: en caché, cada
    // paso cuesta menos y empieza antes.
    system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
    messages: mensajes,
    output_config: { effort: ESFUERZOS.has(esfuerzo) ? esfuerzo : "low" },
    ...(herramientas.length ? { tools: herramientas } : {})
  };

  // Primero con relevo automático si Claude declina la petición; si la cuenta
  // no lo admite (400), se repite sin él.
  const intentos = [
    () => cliente.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
    () => cliente.messages.create(base)
  ];

  let mensaje;
  for (const [i, intento] of intentos.entries()) {
    try {
      mensaje = await intento();
      break;
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError && i === 0) continue;
      return { ok: false, ...errorDeClaude(error, Anthropic) };
    }
  }

  const contenido = mensaje.content ?? [];
  const llamadas = contenido
    .filter(b => b.type === "tool_use")
    .map(b => ({ id: b.id, nombre: b.name, argumentos: b.input ?? {} }));
  let texto = contenido.filter(b => b.type === "text").map(b => b.text).join("").trim();

  if (mensaje.stop_reason === "refusal") {
    texto = "Esa petición no la puedo atender.";
  }

  return {
    ok: true,
    contenido,
    texto,
    llamadas: mensaje.stop_reason === "tool_use" ? llamadas : [],
    fin: mensaje.stop_reason !== "tool_use",
    motivo: mensaje.stop_reason,
    modelo: mensaje.model
  };
}

async function cargarAnthropic() {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return Anthropic;
  } catch {
    return null;
  }
}

function errorDeClaude(error, Anthropic) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { error: "Anthropic rechazó la ANTHROPIC_API_KEY.", code: "ANTHROPIC_KEY_INVALID", estado: 401 };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { error: "Claude alcanzó un límite de uso. Intenta en un momento.", code: "ANTHROPIC_RATE_LIMIT", estado: 429 };
  }
  if (error instanceof Anthropic.APIError) {
    console.error("Claude:", error.status, error.message);
    return { error: `Claude respondió con un error (${error.status ?? "sin estado"}).`, code: "ANTHROPIC_ERROR", estado: 502 };
  }
  console.error("Claude:", error);
  return { error: "No se pudo contactar a Claude.", code: "ANTHROPIC_UNREACHABLE", estado: 502 };
}
