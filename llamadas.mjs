// Llamadas salientes por ElevenLabs.
//
// A diferencia del puente Twilio+OpenAI (telefonia.mjs), aquí el puente de audio
// lo hace ElevenLabs en su lado: nosotros sólo lanzamos la llamada con una
// petición y consultamos cómo va. No hace falta servidor persistente ni
// WebSockets nuestros, así que ESTO SÍ FUNCIONA EN VERCEL.
//
// El flujo:
//   1. En ElevenLabs se importa un número de teléfono (de Twilio, o por SIP) y se
//      asigna al agente. Eso da un  agent_phone_number_id.
//   2. Para marcar, se hace POST al endpoint de llamada saliente con el agente,
//      ese número, y el destino. ElevenLabs marca y, al contestar, el agente
//      —la misma Catalina— habla con la persona.
//   3. La llamada es una conversación aparte; se consulta su estado por su id.
//
// Nota: el nombre exacto del endpoint puede cambiar entre versiones de la API de
// ElevenLabs. Si un día devuelve 404, se confirma en el panel y se ajusta aquí.

import { revisarNumero } from "./telefonia.mjs";

const BASE = "https://api.elevenlabs.io/v1/convai";
const TIEMPO = 15_000;
const MAX_GUARDADAS = 50;

// Seguimiento en memoria: id de la llamada → lo último que sabemos. Basta: una
// llamada dura minutos y el navegador la consulta mientras tanto.
const llamadas = new Map();

function recordar(id, datos) {
  llamadas.set(id, { ...(llamadas.get(id) || {}), ...datos, id });
  while (llamadas.size > MAX_GUARDADAS) llamadas.delete(llamadas.keys().next().value);
  return llamadas.get(id);
}

const clave = () => process.env.ELEVENLABS_API_KEY?.trim();
const agente = () => process.env.ELEVENLABS_AGENT_ID?.trim();
const numeroId = () => process.env.ELEVENLABS_PHONE_NUMBER_ID?.trim();

// Lista si están la clave, el agente y el número importado. Sin el número no se
// puede marcar aunque el agente hable perfecto en el navegador.
export function telefoniaElevenLabsLista() {
  return Boolean(clave() && agente() && numeroId());
}

// Traduce el estado crudo de ElevenLabs a algo estable para el navegador.
function normalizarEstado(bruto) {
  const s = String(bruto || "").toLowerCase();
  if (["initiated", "queued", "ringing", "in-progress", "in_progress", "processing", "active"].includes(s)) return "en_curso";
  if (["done", "completed", "ended", "success"].includes(s)) return "terminada";
  if (["failed", "error", "no-answer", "busy", "canceled", "cancelled"].includes(s)) return "fallo";
  return s || "desconocido";
}

// Lanza la llamada. El objetivo viaja como variable dinámica para que el agente
// sepa qué conseguir; requiere que el prompt del agente use {{objetivo}} o que
// ElevenLabs lo inyecte como contexto de la conversación.
export async function originarLlamadaElevenLabs({ numero, objetivo }) {
  if (!telefoniaElevenLabsLista()) {
    return { ok: false, error: "Falta ELEVENLABS_PHONE_NUMBER_ID (o la clave/el agente): no hay número para marcar.", code: "SIN_NUMERO" };
  }
  const revisado = revisarNumero(numero);
  if (!revisado.ok) return { ok: false, error: revisado.error, code: "NUMERO_INVALIDO" };

  const cuerpo = {
    agent_id: agente(),
    agent_phone_number_id: numeroId(),
    to_number: revisado.numero,
    conversation_initiation_client_data: {
      dynamic_variables: { objetivo: String(objetivo || "").trim() }
    }
  };

  let respuesta, crudo;
  try {
    respuesta = await fetch(`${BASE}/twilio/outbound-call`, {
      method: "POST",
      headers: { "xi-api-key": clave(), "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO)
    });
    crudo = await respuesta.text();
  } catch (error) {
    return { ok: false, error: error.name === "TimeoutError" ? "ElevenLabs tardó demasiado en tomar la llamada." : "No se pudo contactar a ElevenLabs para llamar.", code: "SIN_RED" };
  }

  let datos = {};
  try { datos = JSON.parse(crudo); } catch {}

  if (!respuesta.ok) {
    // Se pasa el detalle real de ElevenLabs para poder arreglarlo sin adivinar.
    const detalle = datos?.detail?.message || datos?.detail || datos?.message || crudo.slice(0, 200);
    return {
      ok: false,
      code: "ELEVENLABS_RECHAZO",
      error: respuesta.status === 404
        ? "ElevenLabs no reconoció el endpoint de llamada saliente; confírmalo en el panel."
        : `ElevenLabs no aceptó la llamada (${respuesta.status})${detalle ? ": " + detalle : ""}.`
    };
  }

  // El id de la conversación / llamada, con los nombres que ha usado la API.
  const id = datos.conversation_id || datos.conversationId || datos.callSid || datos.call_sid || datos.sid;
  if (!id) return { ok: false, error: "ElevenLabs aceptó la llamada pero no devolvió un identificador para seguirla.", code: "SIN_ID" };

  recordar(id, { estado: "en_curso", numero: revisado.numero, objetivo, desde: Date.now() });
  return { ok: true, id, estado: "en_curso", numero: revisado.numero };
}

// Consulta cómo va o cómo terminó una llamada, por su id de conversación.
export async function estadoLlamadaElevenLabs(id) {
  if (!id) return { ok: false, error: "Falta el identificador de la llamada." };
  const conocido = llamadas.get(id) || {};

  let respuesta, datos = {};
  try {
    respuesta = await fetch(`${BASE}/conversations/${encodeURIComponent(id)}`, {
      headers: { "xi-api-key": clave() },
      signal: AbortSignal.timeout(TIEMPO)
    });
    const crudo = await respuesta.text();
    try { datos = JSON.parse(crudo); } catch {}
  } catch {
    // Si no se puede consultar en vivo, se devuelve lo último que sabíamos.
    return { ok: true, id, estado: conocido.estado || "desconocido", enVivo: false };
  }

  if (!respuesta.ok) {
    return { ok: true, id, estado: conocido.estado || "desconocido", enVivo: false };
  }

  const estado = normalizarEstado(datos.status || datos.call_status);
  // Resumen o transcripción, si la llamada ya terminó, para que Catalina cuente
  // el desenlace en vez de sólo decir «terminó».
  const resumen = datos.analysis?.transcript_summary || datos.transcript_summary || "";
  recordar(id, { estado });
  return { ok: true, id, estado, resumen: resumen || undefined, enVivo: true };
}
