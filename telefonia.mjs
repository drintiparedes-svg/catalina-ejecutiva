// Llamadas telefónicas salientes.
//
// Catalina pide la llamada desde el navegador; aquí se origina con Twilio y,
// en cuanto contestan, se empalma por SIP contra la Realtime API de OpenAI.
//
// La consecuencia importante de ese empalme es que **el audio no pasa por
// nosotros**: viaja directo entre Twilio y OpenAI. Nos queda sólo el control de
// la llamada. La alternativa —Media Streams— obligaría a recibir μ-law a 8 kHz
// por WebSocket y reenviarlo, con el remuestreo y los cortes que eso arrastra.
//
// El SIP de OpenAI sólo acepta llamadas *entrantes*, no sabe originarlas. Por
// eso quien marca es Twilio, y OpenAI recibe la llamada ya establecida como si
// alguien le hubiera llamado a él.

import { createHmac, timingSafeEqual } from "node:crypto";

const TWILIO = "https://api.twilio.com/2010-04-01/Accounts";
const SIP_OPENAI = "sip.api.openai.com";
const TOLERANCIA_FIRMA = 5 * 60;      // segundos, contra reenvíos
const MAX_LLAMADAS_GUARDADAS = 50;

// Estado en memoria. No hace falta más: una llamada dura minutos y el navegador
// la consulta mientras tanto. Si se reiniciara el servidor a mitad de llamada
// se perdería el seguimiento, no la llamada.
const llamadas = new Map();
let enCurso = null;

const config = () => ({
  cuenta: process.env.TWILIO_ACCOUNT_SID?.trim(),
  token: process.env.TWILIO_AUTH_TOKEN?.trim(),
  desde: process.env.TWILIO_FROM_NUMBER?.trim(),
  proyecto: process.env.OPENAI_PROJECT_ID?.trim(),
  clave: process.env.OPENAI_API_KEY?.trim(),
  secretoWebhook: process.env.OPENAI_WEBHOOK_SECRET?.trim(),
  // Durante las pruebas sólo se marca a números autorizados. Un error de
  // transcripción en un número dictado en voz alta llama a un desconocido.
  permitidos: (process.env.TELEFONO_PERMITIDOS || "")
    .split(",").map(n => n.trim()).filter(Boolean)
});

export function telefoniaLista() {
  const c = config();
  return Boolean(c.cuenta && c.token && c.desde && c.proyecto && c.clave);
}

// E.164: el signo más y de ocho a quince dígitos. Twilio rechaza cualquier otra
// cosa, y conviene decirlo antes de gastar una llamada.
const E164 = /^\+[1-9]\d{7,14}$/;

export function revisarNumero(numero) {
  const limpio = String(numero || "").replace(/[\s()\-.]/g, "");
  if (!E164.test(limpio)) {
    return { ok: false, error: "El número debe ir en formato internacional, por ejemplo +56912345678." };
  }
  // Chequeo específico para Chile: un número nacional tiene 9 dígitos después de
  // +56 (los móviles son +569 y ocho más). Atrapa el dígito perdido —típico al
  // dictar por voz, como +5668343565 en vez de +56968343565— ANTES de marcar y
  // gastar la llamada. Sólo afecta a +56; el resto pasa como antes.
  if (limpio.startsWith("+56")) {
    const nacional = limpio.slice(3);
    if (nacional.length !== 9) {
      return {
        ok: false,
        error: "Ese número chileno parece incompleto: después de +56 deben ir 9 dígitos (los móviles son +569 y ocho más). Confírmalo y vuelve a intentar."
      };
    }
  }
  const { permitidos } = config();
  if (permitidos.length && !permitidos.includes(limpio)) {
    return {
      ok: false,
      error: "Ese número no está en la lista de números autorizados para llamar."
    };
  }
  return { ok: true, numero: limpio };
}

export function estadoLlamada(id) {
  return llamadas.get(id) ?? null;
}

export function llamadaActiva() {
  return enCurso ? llamadas.get(enCurso) ?? null : null;
}

function anotar(id, cambios) {
  const actual = llamadas.get(id) ?? {};
  llamadas.set(id, { ...actual, ...cambios, actualizada: Date.now() });
  // Poda simple para que la memoria no crezca sin límite en una sesión larga.
  if (llamadas.size > MAX_LLAMADAS_GUARDADAS) {
    const masVieja = [...llamadas.entries()].sort((a, b) => a[1].actualizada - b[1].actualizada)[0];
    if (masVieja && masVieja[0] !== enCurso) llamadas.delete(masVieja[0]);
  }
}

// Originar la llamada.
//
// `base` es la URL pública de este servidor: Twilio tiene que poder venir a
// buscar el TwiML, así que en local hace falta un túnel.
export async function originarLlamada({ numero, objetivo, base, maxSegundos = 300 }) {
  if (!telefoniaLista()) {
    return { ok: false, error: "Falta configurar la telefonía.", code: "TELEFONIA_SIN_CONFIGURAR" };
  }
  if (enCurso) {
    return { ok: false, error: "Ya hay una llamada en curso.", code: "LLAMADA_EN_CURSO" };
  }

  const revision = revisarNumero(numero);
  if (!revision.ok) return { ok: false, error: revision.error, code: "NUMERO_INVALIDO" };

  const meta = String(objetivo || "").trim();
  if (!meta) return { ok: false, error: "Falta el objetivo de la llamada.", code: "SIN_OBJETIVO" };

  const c = config();
  const cuerpo = new URLSearchParams({
    To: revision.numero,
    From: c.desde,
    Url: `${base}/telefonia/twiml`,
    Method: "POST",
    StatusCallback: `${base}/telefonia/estado`,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed",
    // Si no contestan en 25 segundos se deja: nadie quiere que insista.
    Timeout: "25",
    TimeLimit: String(maxSegundos)
  });

  let datos;
  try {
    const respuesta = await fetch(`${TWILIO}/${c.cuenta}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${c.cuenta}:${c.token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: cuerpo,
      signal: AbortSignal.timeout(15000)
    });
    datos = await respuesta.json();
    if (!respuesta.ok) {
      console.error("Twilio:", respuesta.status, datos?.message);
      return { ok: false, error: datos?.message || "Twilio rechazó la llamada.", code: "TWILIO_ERROR" };
    }
  } catch (error) {
    console.error("Twilio:", error.message);
    return { ok: false, error: "No se pudo contactar con la telefonía.", code: "TWILIO_INACCESIBLE" };
  }

  const id = datos.sid;
  enCurso = id;
  anotar(id, {
    id, numero: revision.numero, objetivo: meta,
    estado: "marcando", iniciada: Date.now(),
    transcripcion: [], resultado: null
  });
  // El objetivo se guarda aparte porque el webhook de OpenAI llega sin saber
  // nada de esta llamada: sólo trae su propio call_id.
  objetivoPendiente = { objetivo: meta, llamadaTwilio: id, maxSegundos };
  return { ok: true, id, estado: "marcando" };
}

// Lo que espera al webhook. La llamada de OpenAI y la de Twilio son dos cosas
// distintas con identificadores distintos, y sólo el orden temporal las une:
// acabamos de marcar, así que la llamada entrante que llegue es la nuestra.
let objetivoPendiente = null;

export function twimlPuente() {
  const c = config();
  // Sin proyecto configurado saldría «sip:undefined@…» y la llamada moriría de
  // una forma que no dice nada. Mejor colgar con un motivo.
  if (!c.proyecto) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="es-MX">La asistente no está configurada. Disculpe la molestia.</Say><Hangup/></Response>`;
  }
  // `<Dial><Sip>` empalma la llamada ya contestada contra OpenAI, que la ve
  // llegar como entrante —lo único que su SIP admite—.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" timeLimit="${objetivoPendiente?.maxSegundos ?? 300}">
    <Sip>sip:${c.proyecto}@${SIP_OPENAI};transport=tls</Sip>
  </Dial>
</Response>`;
}

// Verificación de firma, según Standard Webhooks.
//
// No es opcional: este webhook configura una sesión de modelo y abre una
// llamada. Sin comprobar la firma, cualquiera que conozca la dirección podría
// disparar una.
export function firmaValida(cabeceras, cuerpoCrudo) {
  const secreto = config().secretoWebhook;
  if (!secreto) return false;

  const id = cabeceras["webhook-id"];
  const momento = cabeceras["webhook-timestamp"];
  const firma = cabeceras["webhook-signature"];
  if (!id || !momento || !firma) return false;

  // Ventana temporal: sin esto, una petición legítima capturada valdría para
  // siempre.
  const desfase = Math.abs(Math.floor(Date.now() / 1000) - Number(momento));
  if (!Number.isFinite(desfase) || desfase > TOLERANCIA_FIRMA) return false;

  const llave = Buffer.from(secreto.replace(/^whsec_/, ""), "base64");
  const esperada = createHmac("sha256", llave)
    .update(`${id}.${momento}.${cuerpoCrudo}`)
    .digest("base64");

  // La cabecera puede traer varias firmas separadas por espacio: se acepta si
  // alguna coincide.
  return firma.split(" ").some(parte => {
    const valor = parte.startsWith("v1,") ? parte.slice(3) : parte;
    const a = Buffer.from(valor);
    const b = Buffer.from(esperada);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// Instrucciones de la llamada.
//
// Son distintas de las de pantalla, y a propósito. Aquí Catalina habla con un
// tercero que no la conoce, en nombre de otra persona: lo primero es decir qué
// es y de parte de quién llama. Eso no se edita desde el panel.
function instruccionesDeLlamada(objetivo, dePartede) {
  return [
    "Estás hablando por teléfono con una persona que no te conoce.",
    `Lo primero que dices, siempre, es que eres una asistente virtual y que llamas de parte de ${dePartede}.`,
    "Dilo en una frase, con naturalidad, y sigue. No lo escondas ni lo adornes.",
    "",
    `Tu objetivo en esta llamada: ${objetivo}`,
    "",
    "Ve al grano con amabilidad: explica para qué llamas, pregunta lo que necesitas y confirma lo que te digan repitiéndolo.",
    "Frases cortas. Estás al teléfono: si hablas largo, te interrumpen o se pierden.",
    "Si no entiendes algo, pide que te lo repitan. No supongas.",
    "Si te pasan con otra persona o te ponen en espera, espera y vuelve a presentarte.",
    "",
    "Si la persona no quiere hablar con una asistente virtual, discúlpate, dale las gracias y despídete. No insistas.",
    "Si te preguntan algo médico, no des consejo ni opinión: di que eso lo verá el profesional y sigue con el motivo de la llamada.",
    "No inventes datos sobre la persona de parte de quien llamas. Si no lo sabes, dilo.",
    "",
    "En cuanto sepas el desenlace —lo conseguiste, no se pudo, hay que llamar en otro momento—, usa registrar_resultado y despídete.",
    "Si la conversación termina sin resolverse, usa registrar_resultado igualmente antes de colgar."
  ].join(" ");
}

const HERRAMIENTA_RESULTADO = {
  type: "function",
  name: "registrar_resultado",
  description: "Anota cómo terminó la llamada. Úsala siempre antes de despedirte, "
    + "tanto si lograste el objetivo como si no.",
  parameters: {
    type: "object",
    properties: {
      logrado: { type: "boolean", description: "Si se consiguió el objetivo de la llamada." },
      detalle: {
        type: "string",
        description: "Qué pasó, en una o dos frases, con los datos concretos: hora acordada, "
          + "nombre de quien atendió, motivo del no, o qué hay que hacer después."
      }
    },
    required: ["logrado", "detalle"]
  }
};

// Aceptar la llamada que OpenAI acaba de recibir y quedarse escuchando.
export async function atenderLlamadaEntrante(evento, dePartede) {
  const callId = evento?.data?.call_id;
  if (!callId) return { ok: false, error: "El webhook llegó sin call_id." };

  const pendiente = objetivoPendiente;
  if (!pendiente) {
    // Nadie pidió esta llamada desde la aplicación: se rechaza en vez de
    // atender a un desconocido con nuestra cuenta.
    await rechazar(callId);
    return { ok: false, error: "Llegó una llamada que nadie pidió; se rechazó." };
  }
  objetivoPendiente = null;

  const c = config();
  const idTwilio = pendiente.llamadaTwilio;

  try {
    const respuesta = await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "realtime",
        model: "gpt-realtime-2.1",
        instructions: instruccionesDeLlamada(pendiente.objetivo, dePartede),
        audio: { output: { voice: "marin" } },
        tools: [HERRAMIENTA_RESULTADO]
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      console.error("OpenAI accept:", respuesta.status, detalle.slice(0, 300));
      anotar(idTwilio, { estado: "fallida", error: "OpenAI no aceptó la llamada." });
      enCurso = null;
      return { ok: false, error: "OpenAI no aceptó la llamada." };
    }
  } catch (error) {
    console.error("OpenAI accept:", error.message);
    anotar(idTwilio, { estado: "fallida", error: "No se pudo preparar la conversación." });
    enCurso = null;
    return { ok: false, error: "No se pudo preparar la conversación." };
  }

  anotar(idTwilio, { estado: "hablando", callId });
  seguirLlamada(callId, idTwilio);
  return { ok: true };
}

async function rechazar(callId) {
  try {
    await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config().clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status_code: 486 })
    });
  } catch { /* la llamada se cae sola */ }
}

// Seguir la sesión por WebSocket. Es lo único que obliga a un servidor
// persistente: hay que quedarse escuchando mientras dura la llamada, y por eso
// esto no puede vivir en Vercel.
function seguirLlamada(callId, idTwilio) {
  const url = `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`;
  let socket;
  try {
    socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${config().clave}` }
    });
  } catch (error) {
    console.error("WebSocket de llamada:", error.message);
    return;
  }

  let dicho = "";

  socket.addEventListener("message", async mensaje => {
    let evento = {};
    try { evento = JSON.parse(mensaje.data); } catch { return; }

    // Transcripción de lo que dice Catalina, para poder revisar después qué
    // ocurrió realmente en la llamada.
    if (evento.type === "response.output_audio_transcript.delta") {
      dicho += evento.delta || "";
    }
    if (evento.type === "response.output_audio_transcript.done" && dicho.trim()) {
      const registro = llamadas.get(idTwilio);
      registro?.transcripcion.push({ quien: "catalina", texto: dicho.trim() });
      dicho = "";
    }
    if (evento.type === "conversation.item.input_audio_transcription.completed" && evento.transcript) {
      const registro = llamadas.get(idTwilio);
      registro?.transcripcion.push({ quien: "otro", texto: evento.transcript.trim() });
    }

    if (evento.type === "response.function_call_arguments.done"
      && evento.name === "registrar_resultado") {
      let argumentos = {};
      try { argumentos = JSON.parse(evento.arguments || "{}"); } catch {}
      anotar(idTwilio, {
        resultado: {
          logrado: argumentos.logrado === true,
          detalle: String(argumentos.detalle || "").trim()
        }
      });
      // Se le confirma para que pueda despedirse en vez de quedarse esperando.
      socket.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: evento.call_id,
          output: JSON.stringify({ ok: true })
        }
      }));
      socket.send(JSON.stringify({ type: "response.create" }));
    }
  });

  socket.addEventListener("close", () => {
    const registro = llamadas.get(idTwilio);
    if (registro && registro.estado === "hablando") {
      anotar(idTwilio, { estado: "terminada" });
    }
    if (enCurso === idTwilio) enCurso = null;
  });

  socket.addEventListener("error", () => {
    anotar(idTwilio, { estado: "terminada" });
    if (enCurso === idTwilio) enCurso = null;
  });
}

// Avisos de Twilio sobre el ciclo de vida: sonando, contestada, terminada. Es
// lo que permite distinguir «no contestaron» de «hablaron y colgaron».
export function anotarEstadoTwilio(parametros) {
  const id = parametros.get("CallSid");
  if (!id || !llamadas.has(id)) return;

  const estado = parametros.get("CallStatus");
  const mapa = {
    initiated: "marcando", ringing: "sonando", "in-progress": "contestada",
    completed: "terminada", busy: "ocupado", "no-answer": "sin respuesta",
    failed: "fallida", canceled: "cancelada"
  };
  const traducido = mapa[estado] ?? estado;

  // No se pisa «hablando» con «contestada»: hablando es más específico y llega
  // después, cuando OpenAI ya tomó la llamada.
  const actual = llamadas.get(id);
  if (!(traducido === "contestada" && actual.estado === "hablando")) {
    anotar(id, { estado: traducido });
  }

  if (["terminada", "ocupado", "sin respuesta", "fallida", "cancelada"].includes(traducido)) {
    if (enCurso === id) enCurso = null;
    objetivoPendiente = null;
  }
}
