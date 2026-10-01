// Prueba de GPT-Live con razonamiento de Claude, sin red ni micrófono.
//
//   node work/prueba-live.mjs
//
// OpenAI y Claude se simulan interceptando fetch, así que no gasta nada. Lo que
// se comprueba:
//   1. La sesión que el servidor manda a OpenAI tiene la forma del SDK oficial
//      (openai/types/live/*) y la clave nunca llega al navegador.
//   2. /live/razonar arma bien la petición a Claude (modelo, herramientas,
//      instrucciones del servidor) y devuelve las herramientas pedidas.
//   3. La sesión del navegador resuelve una delegación completa: transcripción
//      → Claude pide herramienta → se ejecuta → Claude responde → la voz recibe
//      session.commentary.append con el id de la delegación.

import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.OPENAI_API_KEY = "sk-proj-prueba-0123456789abcdefghijklmnop";
process.env.ANTHROPIC_API_KEY = "sk-ant-prueba-0123456789abcdefghijklmnop";

const { atender } = await import("../app.mjs");
const { sesionDeVoz, herramientasParaClaude, historiaValida, VOCES_LIVE } = await import("../razonamiento.mjs");
const { LiveSession, trocear } = await import("../public/realtime/live-session.js");

let fallos = 0;
async function caso(nombre, fn) {
  try {
    await fn();
    console.log("✓", nombre);
  } catch (error) {
    fallos += 1;
    console.log("✗", nombre);
    console.log("  ", error.message);
  }
}

// --- Intercepción de fetch -------------------------------------------------
const fetchReal = globalThis.fetch;
const llamadas = { openai: [], claude: [] };
let respuestasClaude = [];

globalThis.fetch = async (url, opciones = {}) => {
  const destino = String(url);
  if (destino === "https://api.openai.com/v1/live/sessions") {
    llamadas.openai.push({ headers: opciones.headers, cuerpo: JSON.parse(opciones.body) });
    return new Response(JSON.stringify({
      session: { id: "sess_prueba" },
      transport: { type: "webrtc", sdp: "v=0\r\no=respuesta" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (destino.startsWith("https://api.anthropic.com/v1/messages")) {
    const cuerpo = JSON.parse(opciones.body);
    llamadas.claude.push({ url: destino, headers: opciones.headers, cuerpo });
    const siguiente = respuestasClaude.shift();
    const estado = siguiente?.__estado || 200;
    return new Response(JSON.stringify(siguiente), { status: estado, headers: { "content-type": "application/json" } });
  }
  return fetchReal(url, opciones);
};

const servidor = createServer(atender);
await new Promise(r => servidor.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${servidor.address().port}`;

function mensajeClaude(content, stop_reason) {
  return {
    id: "msg_" + Math.random().toString(36).slice(2), type: "message", role: "assistant",
    model: "claude-sonnet-5-5", content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 }
  };
}

// --- 1. Configuración de la sesión ----------------------------------------
await caso("sesionDeVoz respeta el esquema de GPT-Live", () => {
  const s = sesionDeVoz({ modelo: "gpt-live-1", voz: "cedar", instrucciones: "Eres Catalina." });
  assert.deepEqual(Object.keys(s).sort(), ["audio", "client", "delegation", "instructions", "model"]);
  assert.equal(s.model, "gpt-live-1");
  assert.equal(s.audio.output.voice, "cedar");
  assert.equal(s.audio.format, undefined, "WebRTC negocia el formato: no se envía");
  assert.deepEqual(s.delegation, { type: "client" });
  assert.ok(Array.isArray(s.client.data_channel.allowed_client_events));
  assert.ok(s.client.data_channel.allowed_server_events.every(e => typeof e.type === "string" && Object.keys(e).length === 1));
  assert.ok(s.client.data_channel.allowed_server_events.some(e => e.type === "session.delegation.created"));
  assert.ok(!s.client.data_channel.allowed_client_events.includes("session.instructions.append"),
    "el navegador no puede cambiar las instrucciones");
  assert.match(s.instructions, /^Eres Catalina\. .*delega/i);
});

await caso("voz inválida cae a marin; modelo inválido cae a gpt-live-1", () => {
  const s = sesionDeVoz({ modelo: "x y", voz: "inventada", instrucciones: "" });
  assert.equal(s.audio.output.voice, "marin");
  assert.equal(s.model, "gpt-live-1");
  assert.equal(VOCES_LIVE.length, 22);
});

// --- 2. Servidor ------------------------------------------------------------
await caso("/health informa que GPT-Live está disponible", async () => {
  const r = await fetchReal(base + "/health").then(r => r.json());
  assert.equal(r.proveedores.live, true);
});

await caso("/live/session presenta la oferta a OpenAI y devuelve el SDP", async () => {
  const r = await fetchReal(base + "/live/session?voz=cedar", {
    method: "POST", headers: { "Content-Type": "application/sdp" }, body: "v=0\r\no=oferta"
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/sdp");
  const sdp = await r.text();
  assert.equal(sdp, "v=0\r\no=respuesta");
  assert.ok(!sdp.includes(process.env.OPENAI_API_KEY));

  const { headers, cuerpo } = llamadas.openai.at(-1);
  assert.equal(headers.Authorization, `Bearer ${process.env.OPENAI_API_KEY}`);
  assert.deepEqual(cuerpo.transport, { type: "webrtc", sdp: "v=0\r\no=oferta" });
  assert.equal(cuerpo.session.model, "gpt-live-1");
  assert.equal(cuerpo.session.audio.output.voice, "cedar");
  assert.match(cuerpo.session.instructions, /parte del equipo del Dr\. Inti Paredes/);
  assert.ok(!/buscar_imagen_medica/.test(cuerpo.session.instructions.split("Trabajas con un equipo")[1] || ""),
    "la guía de delegación no nombra herramientas");
});

await caso("/live/session rechaza una oferta vacía", async () => {
  const r = await fetchReal(base + "/live/session", { method: "POST", body: "" });
  assert.equal(r.status, 400);
});

await caso("/live/razonar rechaza una historia mal formada", async () => {
  const r = await fetchReal(base + "/live/razonar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mensajes: [{ role: "assistant", content: "hola" }] })
  });
  assert.equal(r.status, 400);
  assert.equal(historiaValida([{ role: "user", content: "hola" }]), true);
});

await caso("/live/razonar llama a Claude Sonnet 5.5 con herramientas e instrucciones del servidor", async () => {
  respuestasClaude = [mensajeClaude([
    { type: "tool_use", id: "toolu_1", name: "buscar_en_la_web", input: { consulta: "guías de hipertensión" } }
  ], "tool_use")];
  const r = await fetchReal(base + "/live/razonar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mensajes: [{ role: "user", content: "PERSONA: busca guías de hipertensión" }] })
  }).then(r => r.json());

  assert.equal(r.ok, true);
  assert.equal(r.fin, false);
  assert.deepEqual(r.llamadas, [{ id: "toolu_1", nombre: "buscar_en_la_web", argumentos: { consulta: "guías de hipertensión" } }]);

  const { cuerpo, headers } = llamadas.claude.at(-1);
  assert.equal(cuerpo.model, "claude-sonnet-5-5");
  assert.equal(cuerpo.output_config.effort, "low");
  assert.equal(cuerpo.fallbacks, "default");
  assert.match(String(headers["anthropic-beta"] ?? new Headers(headers).get("anthropic-beta")), /server-side-fallback-2026-07-01/);
  assert.equal(cuerpo.thinking, undefined, "Sonnet 5.5: sin thinking explícito (adaptativo por defecto)");
  assert.equal(cuerpo.tool_choice, undefined, "Sonnet 5.5 no admite tool_choice forzado");
  assert.match(cuerpo.system[0].text, /no se lee en pantalla/);
  assert.match(cuerpo.system[0].text, /parte del equipo del Dr\. Inti Paredes/);
  assert.ok(cuerpo.tools.some(t => t.name === "buscar_en_la_web" && t.input_schema?.type === "object"));
  assert.ok(cuerpo.tools.every(t => /^[a-zA-Z0-9_-]{1,128}$/.test(t.name)));
});

await caso("si la cuenta no admite el relevo (400), repite sin él", async () => {
  respuestasClaude = [
    { __estado: 400, type: "error", error: { type: "invalid_request_error", message: "fallbacks no disponible" } },
    mensajeClaude([{ type: "text", text: "Listo." }], "end_turn")
  ];
  const antes = llamadas.claude.length;
  const r = await fetchReal(base + "/live/razonar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mensajes: [{ role: "user", content: "hola" }] })
  }).then(r => r.json());
  assert.equal(r.ok, true);
  assert.equal(r.texto, "Listo.");
  assert.equal(llamadas.claude.length - antes, 2);
  assert.equal(llamadas.claude.at(-1).cuerpo.fallbacks, undefined);
});

await caso("herramientasParaClaude descarta nombres inválidos", () => {
  const h = herramientasParaClaude([
    { nombre: "ok_1", descripcion: "x", parametros: { type: "object", properties: {} } },
    { nombre: "mal nombre", descripcion: "x", parametros: {} }
  ]);
  assert.deepEqual(h.map(t => t.name), ["ok_1"]);
});

// --- 3. Sesión del navegador ------------------------------------------------
await caso("trocear respeta el tope y no pierde texto", () => {
  const texto = "Primera frase. ".repeat(300);
  const trozos = trocear(texto, 1400);
  assert.ok(trozos.every(t => t.length <= 1400));
  assert.equal(trozos.join(" ").replace(/\s+/g, " "), texto.trim().replace(/\s+/g, " "));
});

await caso("una delegación completa: herramienta y respuesta hablada", async () => {
  globalThis.location = { search: "", protocol: "http:" };
  const enviados = [];
  const herramientasEjecutadas = [];
  const sesion = new LiveSession({
    onToolCall: async (nombre, argumentos) => {
      herramientasEjecutadas.push({ nombre, argumentos });
      return { ok: true, resultados: ["Guía ESC 2024"] };
    }
  });
  sesion.channel = { readyState: "open", send: texto => enviados.push(JSON.parse(texto)), close() {} };
  const evento = datos => sesion.alRecibirEvento({ data: JSON.stringify(datos) });

  // El navegador habla con su propio servidor de pruebas.
  const fetchSimulado = globalThis.fetch;
  globalThis.fetch = (url, opciones) => fetchSimulado(String(url).startsWith("/") ? base + url : url, opciones);

  respuestasClaude = [
    mensajeClaude([{ type: "tool_use", id: "toolu_a", name: "buscar_en_la_web", input: { consulta: "hipertensión" } }], "tool_use"),
    mensajeClaude([{ type: "text", text: "La guía más reciente es la ESC de 2024. Recomienda una meta de presión más baja." }], "end_turn")
  ];
  const antes = llamadas.claude.length;

  evento({ type: "session.started", session: { id: "sess" } });
  evento({ type: "session.input_transcript.delta", delta: "¿Qué dicen las guías " });
  evento({ type: "session.input_transcript.delta", delta: "de hipertensión?" });
  evento({ type: "session.output_transcript.delta", delta: "Déjame ver." });
  evento({ type: "session.delegation.created", delegation: { id: "del_1", type: "delegation", target: "client" } });

  await new Promise(r => setTimeout(r, 400));
  await sesion.cola;

  assert.deepEqual(herramientasEjecutadas, [{ nombre: "buscar_en_la_web", argumentos: { consulta: "hipertensión" } }]);

  const respuesta = enviados.filter(e => e.type === "session.commentary.append");
  assert.equal(respuesta.length, 1);
  assert.equal(respuesta[0].delegation_id, "del_1");
  assert.match(respuesta[0].content, /ESC de 2024/);

  // La primera petición a Claude lleva la transcripción con los dos roles.
  const primera = llamadas.claude[antes].cuerpo.messages[0];
  const texto = primera.content.find(b => b.type === "text").text;
  assert.match(texto, /PERSONA: ¿Qué dicen las guías de hipertensión\?/);
  assert.match(texto, /CATALINA: Déjame ver\./);

  // La segunda lleva el resultado de la herramienta, enlazado por su id.
  const segunda = llamadas.claude[antes + 1].cuerpo.messages;
  assert.deepEqual(segunda.map(m => m.role), ["user", "assistant", "user"]);
  assert.equal(segunda[2].content[0].type, "tool_result");
  assert.equal(segunda[2].content[0].tool_use_id, "toolu_a");

  // Historia intacta y alternada para la próxima delegación.
  assert.deepEqual(sesion.historia.map(m => m.role), ["user", "assistant", "user", "assistant"]);

  // Segunda delegación: sólo lo nuevo de la conversación.
  respuestasClaude = [mensajeClaude([{ type: "text", text: "Sí, también para mayores de 65." }], "end_turn")];
  evento({ type: "session.input_transcript.delta", delta: "¿Y en adultos mayores?" });
  evento({ type: "session.delegation.created", delegation: { id: "del_2", type: "delegation", target: "client" } });
  await new Promise(r => setTimeout(r, 400));
  await sesion.cola;
  const tercera = llamadas.claude.at(-1).cuerpo.messages;
  const nuevo = tercera.at(-1).content.find(b => b.type === "text").text;
  assert.match(nuevo, /desde la consulta anterior/);
  assert.match(nuevo, /adultos mayores/);
  assert.doesNotMatch(nuevo, /guías de hipertensión/);
  assert.equal(enviados.filter(e => e.type === "session.commentary.append").at(-1).delegation_id, "del_2");

  globalThis.fetch = fetchSimulado;
  sesion.peer = null;
  sesion.disconnect = () => {};
});

await caso("si Claude falla, la voz recibe un aviso y no queda esperando", async () => {
  const enviados = [];
  const sesion = new LiveSession({});
  sesion.channel = { readyState: "open", send: texto => enviados.push(JSON.parse(texto)), close() {} };
  sesion.alRecibirEvento({ data: JSON.stringify({ type: "session.started" }) });
  const fetchSimulado = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "x", code: "ANTHROPIC_KEY_INVALID" }), { status: 401 });
  sesion.alRecibirEvento({ data: JSON.stringify({ type: "session.delegation.created", delegation: { id: "del_x", target: "client" } }) });
  await new Promise(r => setTimeout(r, 400));
  await sesion.cola;
  globalThis.fetch = fetchSimulado;
  const respuesta = enviados.find(e => e.type === "session.commentary.append");
  assert.equal(respuesta?.delegation_id, "del_x");
  assert.match(respuesta.content, /clave de Claude/);
});

servidor.close();
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodo en orden");
process.exit(fallos ? 1 : 0);
