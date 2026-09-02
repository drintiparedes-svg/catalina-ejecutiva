// El diagnóstico del teléfono, contra un doble de ElevenLabs.
//
// Lo que se comprueba es lo que dejó pasar el fallo: que el diagnóstico DIGA
// cuando las llamadas comparten agente con el navegador, y que CUENTE las
// herramientas de cliente que ese agente lleva encima. En una llamada no hay
// navegador que las conteste, así que cada una es una muletilla seguida de
// hasta veinte segundos de silencio: se oye como que la voz se corta.

process.env.ELEVENLABS_API_KEY = "clave-de-prueba";
process.env.ELEVENLABS_PHONE_NUMBER_ID = "num-1";

const AGENTES = {
  "ag-navegador": ["tomar_nota", "quien_habla", "estado_de_la_reunion", "consultar_reunion", "finalizar_reunion", "buscar_referencias"],
  "ag-llamadas": []
};

globalThis.fetch = async (url) => {
  const u = String(url);
  const responder = c => new Response(JSON.stringify(c), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.includes("/phone-numbers")) {
    return responder([{ phone_number_id: "num-1", phone_number: "+56 9 1234 5678", assigned_agent: { agent_id: process.env.ELEVENLABS_CALL_AGENT_ID || process.env.ELEVENLABS_AGENT_ID } }]);
  }
  const m = u.match(/\/agents\/([^/?]+)/);
  if (m) {
    const tools = (AGENTES[decodeURIComponent(m[1])] || []).map(name => ({ type: "client", name }));
    // El agente lleva además una herramienta de servidor, que sí se contesta
    // sola y no debe contarse como riesgo.
    tools.push({ type: "webhook", name: "algo_del_servidor" });
    return responder({ conversation_config: { agent: { prompt: { tools } } } });
  }
  return new Response("{}", { status: 404 });
};

const { diagnosticoElevenLabs } = await import(new URL("../llamadas.mjs", import.meta.url).href);

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });

// ── Compartiendo agente: es el estado que rompía las llamadas ───────────────
process.env.ELEVENLABS_AGENT_ID = "ag-navegador";
delete process.env.ELEVENLABS_CALL_AGENT_ID;
let d = await diagnosticoElevenLabs();
anotar("Compartiendo agente, el diagnóstico NO lo da por bueno", d.agenteDedicado === false, "agenteDedicado=" + d.agenteDedicado);
anotar("Y dice cuál es el agente que habla por teléfono", d.agenteLlamadas === "ag-navegador", String(d.agenteLlamadas));
anotar("Cuenta las herramientas de cliente que lleva encima",
  Array.isArray(d.herramientasDeCliente) && d.herramientasDeCliente.length === 6,
  JSON.stringify(d.herramientasDeCliente));
anotar("Entre ellas, las cinco de reunión que nadie puede contestar en una llamada",
  ["tomar_nota", "quien_habla", "estado_de_la_reunion", "consultar_reunion", "finalizar_reunion"].every(h => d.herramientasDeCliente.includes(h)),
  JSON.stringify(d.herramientasDeCliente));
anotar("Y no cuenta las de servidor, que sí se contestan solas",
  !d.herramientasDeCliente.includes("algo_del_servidor"), JSON.stringify(d.herramientasDeCliente));

// ── Con agente dedicado: el arreglo ────────────────────────────────────────
process.env.ELEVENLABS_CALL_AGENT_ID = "ag-llamadas";
d = await diagnosticoElevenLabs();
anotar("Con un agente aparte, el diagnóstico lo reconoce", d.agenteDedicado === true, "agenteDedicado=" + d.agenteDedicado);
anotar("Y las llamadas van por ese agente, no por el del navegador",
  d.agenteLlamadas === "ag-llamadas" && d.agenteDelNavegador === "ag-navegador",
  d.agenteLlamadas + " vs " + d.agenteDelNavegador);
anotar("Que no lleva NINGUNA herramienta de cliente: nada que se cuelgue",
  Array.isArray(d.herramientasDeCliente) && d.herramientasDeCliente.length === 0,
  JSON.stringify(d.herramientasDeCliente));
anotar("Y el número queda asignado a ese mismo agente", d.agenteCoincide === true, "agenteCoincide=" + d.agenteCoincide);

// ── Si no se puede leer el agente, se dice, no se inventa ──────────────────
const antes = globalThis.fetch;
globalThis.fetch = async (url) => String(url).includes("/agents/") ? new Response("nope", { status: 500 }) : antes(url);
d = await diagnosticoElevenLabs();
anotar("Si no se puede leer el agente, se informa como desconocido y no se inventa",
  d.herramientasDeCliente === null, JSON.stringify(d.herramientasDeCliente));
anotar("Y el resto del diagnóstico sigue funcionando", d.ok === true && d.numeroReconocido === true, JSON.stringify({ ok: d.ok, numero: d.numeroReconocido }));

let mal = 0;
for (const x of paso) { if (!x.ok) mal += 1; console.log(`${x.ok ? "ok   " : "FALLA"} ${x.n}${x.ok ? "" : "\n        → " + x.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones del teléfono pasan`);
process.exit(mal ? 1 : 0);
