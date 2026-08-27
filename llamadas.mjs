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

// Rutas de ElevenLabs que pueden cambiar de nombre entre versiones. Se prueban
// en orden y se usa la primera que NO devuelva 404. Se puede fijar la correcta
// sin tocar código con la variable de entorno, que va primero.
const RUTAS_LLAMADA = [
  process.env.ELEVENLABS_OUTBOUND_PATH?.trim(),
  "/twilio/outbound-call",
  "/twilio/outbound_call",
  "/sip-trunk/outbound-call"
].filter(Boolean);
const RUTAS_NUMEROS = ["/phone-numbers", "/phone_numbers"];

// Rutas para COLGAR/terminar una conversación en curso. El nombre exacto puede
// variar entre versiones de la API; se prueban en orden (env primero) y se usa
// la primera que no devuelva 404. `{id}` se reemplaza por el id de la llamada.
const RUTAS_COLGAR = [
  process.env.ELEVENLABS_HANGUP_PATH?.trim(),
  "/conversations/{id}/end",
  "/twilio/outbound-call/{id}/end",
  "/conversations/{id}/cancel"
].filter(Boolean);

// Seguimiento en memoria: id de la llamada → lo último que sabemos. Basta: una
// llamada dura minutos y el navegador la consulta mientras tanto.
const llamadas = new Map();

function recordar(id, datos) {
  llamadas.set(id, { ...(llamadas.get(id) || {}), ...datos, id });
  while (llamadas.size > MAX_GUARDADAS) llamadas.delete(llamadas.keys().next().value);
  return llamadas.get(id);
}

const clave = () => process.env.ELEVENLABS_API_KEY?.trim();
// Se puede dedicar un agente sólo para las llamadas (con el guion de gestión) y
// dejar el del navegador para conversar. Si no se define, se usa el mismo.
const agente = () => process.env.ELEVENLABS_CALL_AGENT_ID?.trim() || process.env.ELEVENLABS_AGENT_ID?.trim();
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

// Lanza la llamada. El objetivo y el contexto viajan como VARIABLES DINÁMICAS
// —objetivo, a_quien, de_parte_de, restricciones—: el prompt del agente de
// llamadas las usa como {{objetivo}}, {{a_quien}}, etc. Este mecanismo no
// depende de que el agente permita sobrescribir el prompt, así que es fiable.
// Si además se pasa `guion` con `enviarGuion` en verdadero, se manda como
// override del prompt (sólo funciona si el agente lo permite en su Security).
export async function originarLlamadaElevenLabs({ numero, objetivo, aQuien, restricciones, dePartede, guion, enviarGuion, saludo }) {
  if (!telefoniaElevenLabsLista()) {
    return { ok: false, error: "Falta ELEVENLABS_PHONE_NUMBER_ID (o la clave/el agente): no hay número para marcar.", code: "SIN_NUMERO" };
  }
  const revisado = revisarNumero(numero);
  if (!revisado.ok) return { ok: false, error: revisado.error, code: "NUMERO_INVALIDO" };

  const inicio = {
    dynamic_variables: {
      objetivo: String(objetivo || "").trim(),
      a_quien: String(aQuien || "").trim(),
      de_parte_de: String(dePartede || "").trim(),
      restricciones: String(restricciones || "").trim()
    }
  };
  // Override sólo para esta llamada (no toca la sesión del navegador): el guion
  // como prompt y, si hay, el saludo como primera frase. El agente ya permite
  // override —la sesión del navegador lo usa igual—.
  if ((enviarGuion && guion) || saludo) {
    const agent = {};
    if (enviarGuion && guion) agent.prompt = { prompt: String(guion) };
    if (saludo) agent.first_message = String(saludo);
    inicio.conversation_config_override = { agent };
  }

  const cuerpo = {
    agent_id: agente(),
    agent_phone_number_id: numeroId(),
    to_number: revisado.numero,
    conversation_initiation_client_data: inicio
  };

  // Se prueban las rutas en orden; sólo se pasa a la siguiente ante un 404
  // (endpoint que no existe). Cualquier otro código es una respuesta real.
  let respuesta, crudo, datos = {}, ruta;
  for (ruta of RUTAS_LLAMADA) {
    try {
      respuesta = await fetch(`${BASE}${ruta}`, {
        method: "POST",
        headers: { "xi-api-key": clave(), "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIEMPO)
      });
      crudo = await respuesta.text();
    } catch (error) {
      return { ok: false, error: error.name === "TimeoutError" ? "ElevenLabs tardó demasiado en tomar la llamada." : "No se pudo contactar a ElevenLabs para llamar.", code: "SIN_RED" };
    }
    if (respuesta.status !== 404) break;   // 404 → probar la siguiente ruta
  }

  try { datos = JSON.parse(crudo); } catch {}

  if (!respuesta.ok) {
    // Se pasa el detalle real de ElevenLabs para poder arreglarlo sin adivinar.
    const detalle = datos?.detail?.message || datos?.detail || datos?.message || crudo.slice(0, 200);
    return {
      ok: false,
      code: "ELEVENLABS_RECHAZO",
      error: respuesta.status === 404
        ? `ElevenLabs no reconoció ninguna ruta de llamada saliente (probé: ${RUTAS_LLAMADA.join(", ")}). Confirma el endpoint en el panel y, si hace falta, ponlo en ELEVENLABS_OUTBOUND_PATH.`
        : `ElevenLabs no aceptó la llamada (${respuesta.status})${detalle ? ": " + detalle : ""}.`
    };
  }

  // El id de la conversación / llamada, con los nombres que ha usado la API.
  const id = datos.conversation_id || datos.conversationId || datos.callSid || datos.call_sid || datos.sid;
  if (!id) return { ok: false, error: "ElevenLabs aceptó la llamada pero no devolvió un identificador para seguirla.", code: "SIN_ID" };

  recordar(id, { estado: "en_curso", numero: revisado.numero, objetivo, desde: Date.now() });
  return { ok: true, id, estado: "en_curso", numero: revisado.numero };
}

// Valida la configuración SIN gastar una llamada: confirma que están las
// variables y que ElevenLabs reconoce el número importado y a qué agente está
// asignado. Es la comprobación que se hace antes de marcar de verdad.
export async function diagnosticoElevenLabs() {
  const faltan = [];
  if (!clave()) faltan.push("ELEVENLABS_API_KEY");
  if (!agente()) faltan.push("ELEVENLABS_AGENT_ID");
  if (!numeroId()) faltan.push("ELEVENLABS_PHONE_NUMBER_ID");
  if (faltan.length) return { ok: false, configurado: false, faltan };

  // Se prueban las rutas de listado de números; sólo se avanza ante un 404.
  let r, crudo;
  try {
    for (const ruta of RUTAS_NUMEROS) {
      r = await fetch(`${BASE}${ruta}`, { headers: { "xi-api-key": clave() }, signal: AbortSignal.timeout(TIEMPO) });
      crudo = await r.text();
      if (r.status !== 404) break;
    }
  } catch (e) {
    return { ok: false, configurado: true, error: e.name === "TimeoutError" ? "ElevenLabs tardó demasiado." : "No se pudo consultar ElevenLabs." };
  }
  let datos;
  try { datos = JSON.parse(crudo); } catch {}
  if (!r.ok) {
    const detalle = datos?.detail?.message || datos?.detail || datos?.message || (crudo || "").slice(0, 200);
    return { ok: false, configurado: true, error: `ElevenLabs rechazó la consulta (${r.status})${detalle ? ": " + detalle : ""}.` };
  }

  const lista = Array.isArray(datos) ? datos : (datos.phone_numbers || datos.items || []);
  // El id puede venir con distintos nombres según la versión de la API.
  const idDe = n => n?.phone_number_id ?? n?.phoneNumberId ?? n?.id ?? n?.phone_id ?? null;
  const agenteDe = n => n?.assigned_agent?.agent_id ?? n?.assignedAgent?.agentId ?? n?.agent_id ?? null;

  // Se listan los números REALES con su id, para poder copiar el correcto.
  const numeros = lista.map(n => ({
    id: idDe(n),
    numero: n?.phone_number ?? n?.phoneNumber ?? n?.label ?? null,
    agente: agenteDe(n)
  }));

  const id = numeroId();
  const hallado = lista.find(n => idDe(n) === id);
  const asignado = hallado ? agenteDe(hallado) : null;
  return {
    ok: true,
    configurado: true,
    numeroReconocido: Boolean(hallado),
    numero: hallado ? (hallado.phone_number || hallado.label || null) : null,
    agenteAsignado: asignado,
    // null = el número no tiene agente asignado; conviene asignarlo en el panel.
    agenteCoincide: asignado ? asignado === agente() : null,
    cuantosNumeros: lista.length,
    // La lista real: si el id no coincide, aquí está el que SÍ hay que usar.
    numeros,
    // El id que el servidor tiene puesto ahora, para compararlo de un vistazo.
    idConfigurado: id,
    // Qué agente HABLA por teléfono, y si es uno dedicado y liviano (recomendado
    // para que la voz no se entrecorte) o el mismo del navegador cargado de
    // herramientas. `agenteDedicado` es true sólo si hay un ELEVENLABS_CALL_AGENT_ID
    // propio y distinto del agente del navegador.
    agenteLlamadas: agente(),
    agenteDedicado: Boolean(process.env.ELEVENLABS_CALL_AGENT_ID?.trim()
      && process.env.ELEVENLABS_CALL_AGENT_ID.trim() !== process.env.ELEVENLABS_AGENT_ID?.trim()),
    listaBlanca: (process.env.TELEFONO_PERMITIDOS || "").split(",").map(s => s.trim()).filter(Boolean)
  };
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
  // Motivo del corte, sobre todo si la llamada FALLÓ: aquí aparece el problema
  // de Twilio (permisos geográficos, número no verificado, sin saldo…) con los
  // nombres de campo que ha usado la API en distintas versiones.
  const meta = datos.metadata || datos.conversation_metadata || {};
  const motivo = meta.termination_reason || meta.error || meta.call_error
    || datos.termination_reason || datos.error_reason || datos.error
    || meta.phone_call?.error || meta.twilio?.error || "";
  recordar(id, { estado });
  return { ok: true, id, estado, resumen: resumen || undefined, motivo: motivo || undefined, enVivo: true };
}

// Cuelga una llamada en curso de verdad. Le pide a ElevenLabs que termine la
// conversación; si su API no expone ninguna ruta conocida (todas dan 404), lo
// dice claro para poder fijar la correcta en ELEVENLABS_HANGUP_PATH sin adivinar.
export async function terminarLlamadaElevenLabs(id) {
  if (!id) return { ok: false, error: "Falta el identificador de la llamada." };
  if (!clave()) return { ok: false, error: "Falta ELEVENLABS_API_KEY.", code: "SIN_CLAVE" };
  if (!RUTAS_COLGAR.length) {
    return { ok: false, code: "SIN_RUTA_COLGAR",
      error: "No hay ninguna ruta para colgar configurada. Pon la de tu API en ELEVENLABS_HANGUP_PATH (usa {id} donde va el identificador)." };
  }

  let respuesta, crudo = "", datos = {}, ruta;
  for (ruta of RUTAS_COLGAR) {
    const url = `${BASE}${ruta.replace("{id}", encodeURIComponent(id))}`;
    try {
      respuesta = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": clave(), "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(TIEMPO)
      });
      crudo = await respuesta.text();
    } catch (error) {
      return { ok: false, code: "SIN_RED",
        error: error.name === "TimeoutError" ? "ElevenLabs tardó demasiado en colgar." : "No se pudo contactar a ElevenLabs para colgar." };
    }
    if (respuesta.status !== 404) break;   // 404 → probar la siguiente ruta
  }

  try { datos = JSON.parse(crudo); } catch {}

  if (!respuesta.ok) {
    const detalle = datos?.detail?.message || datos?.detail || datos?.message || crudo.slice(0, 200);
    return {
      ok: false,
      code: respuesta.status === 404 ? "SIN_RUTA_COLGAR" : "ELEVENLABS_RECHAZO",
      error: respuesta.status === 404
        ? `ElevenLabs no reconoció ninguna ruta para colgar (probé: ${RUTAS_COLGAR.join(", ")}). Confirma el endpoint en el panel y ponlo en ELEVENLABS_HANGUP_PATH.`
        : `ElevenLabs no pudo colgar (${respuesta.status})${detalle ? ": " + detalle : ""}.`
    };
  }

  recordar(id, { estado: "terminada" });
  return { ok: true, id, estado: "terminada" };
}
