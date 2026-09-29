// Pruebas del módulo de reuniones, sin navegador ni claves reales.
//
//   node work/prueba-reuniones.mjs
//
// Cubre lo que se rompió en producción y lo que se añadió para arreglarlo:
//   · escucha.js: rescate de la frase a medias al cortarse el reconocimiento,
//     rearranque con instancia nueva, anotación de huecos y caducidad de la
//     sordera.
//   · reuniones.js: persistencia, fusión de alta fidelidad con el respaldo del
//     navegador, búsqueda de pasajes (la memoria de Catalina) y Markdown.
//   · reunion.mjs: cascada de modelos, filtro de alucinaciones, normalización
//     de la minuta, uso de la clave propia, correo y adjuntos.
// Los proveedores se simulan sustituyendo fetch: ninguna prueba sale a la red.

import assert from "node:assert/strict";

let fallos = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); console.log(`  ✓ ${nombre}`); }
  catch (error) { fallos += 1; console.error(`  ✗ ${nombre}\n    ${error.stack?.split("\n").slice(0, 3).join("\n    ")}`); }
};
const esperar = ms => new Promise(ok => setTimeout(ok, ms));

// ── Entorno de navegador mínimo ─────────────────────────────────────────────
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => almacen.has(k) ? almacen.get(k) : null,
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: k => almacen.delete(k)
};

class ReconocimientoFalso {
  static instancias = [];
  constructor() { ReconocimientoFalso.instancias.push(this); this.iniciado = false; }
  start() { this.iniciado = true; setTimeout(() => this.onstart?.(), 0); }
  stop() { this.iniciado = false; setTimeout(() => this.onend?.(), 0); }
  abort() { this.iniciado = false; }
  emitir(texto, final) {
    const resultado = [{ transcript: texto }];
    resultado.isFinal = final;
    this.onresult?.({ resultIndex: 0, results: [resultado] });
  }
}
globalThis.window = { SpeechRecognition: ReconocimientoFalso };

const { EscuchaDeReunion } = await import("../public/escucha.js");
const R = await import("../public/reuniones.js");
const S = await import("../reunion.mjs");

console.log("escucha.js");

await prueba("guarda la frase a medias cuando Chrome corta la sesión y rearranca con una instancia nueva", async () => {
  const oidos = [];
  const e = new EscuchaDeReunion({ alTranscribir: t => oidos.push(t) });
  assert.ok(e.empezar());
  await esperar(5);
  const primera = ReconocimientoFalso.instancias.at(-1);
  primera.emitir("el presupuesto del piloto es de", false);
  primera.onend();                         // Chrome cierra la sesión solo
  assert.deepEqual(oidos, ["el presupuesto del piloto es de"]);
  assert.equal(e.transcripcion[0].incompleto, true);
  await esperar(320);                      // espera de rearranque (250 ms)
  assert.notEqual(ReconocimientoFalso.instancias.at(-1), primera, "debe crear una instancia nueva");
  assert.equal(e.estadisticas.reinicios, 1);
  e.parar();
});

await prueba("anota como hueco un corte largo de la escucha", async () => {
  const e = new EscuchaDeReunion();
  e.empezar();
  await esperar(5);
  const r = ReconocimientoFalso.instancias.at(-1);
  const real = Date.now;
  r.onend();
  Date.now = () => real() + 9000;         // el rearranque llega 9 s después
  await esperar(320);
  await esperar(5);
  Date.now = real;
  const hueco = e.transcripcion.find(s => s.hueco);
  assert.ok(hueco && hueco.hueco >= 8000, "debe registrar el hueco");
  e.parar();
});

await prueba("no transcribe mientras Catalina habla, y la sordera caduca sola", async () => {
  const e = new EscuchaDeReunion();
  e.empezar();
  await esperar(5);
  e.ensordecer(true);
  ReconocimientoFalso.instancias.at(-1).emitir("esto lo dice Catalina", true);
  assert.equal(e.transcripcion.length, 0);
  const real = Date.now;
  Date.now = () => real() + 60000;        // nadie avisó del fin de su turno
  e.ultimoEvento = Date.now();
  await esperar(4200);                     // una vuelta del vigilante
  Date.now = real;
  assert.equal(e.sorda, false, "la sordera debe caducar");
  e.parar();
});

await prueba("contexto largo conserva el arranque y lo más reciente", () => {
  const e = new EscuchaDeReunion();
  e.transcripcion = Array.from({ length: 400 }, (_, i) => ({ momento: i, texto: `frase ${i} ` + "x".repeat(80) }));
  const c = e.contexto(4000);
  assert.ok(c.startsWith("frase 0"));
  assert.ok(c.includes("frase 399"));
  assert.ok(c.includes("consultar_reunion"));
});

console.log("reuniones.js");

const base = Date.UTC(2026, 8, 29, 13, 0, 0);
const reunion = R.nuevaReunion({ titulo: "Comité de salud digital", objetivo: "Aprobar el piloto de telemedicina", participantes: "Ana (TI), Luis (Finanzas)" });
reunion.meta.inicio = base;
reunion.meta.fin = base + 30 * 60000;
reunion.navegador = [
  { momento: base + 60000, texto: "abrimos con el estado del piloto de telemedicina" },
  { momento: base + 5 * 60000, texto: "el presupuesto aprobado es de cuarenta millones" },
  { momento: base + 12 * 60000, texto: "Luis se compromete a enviar el informe financiero el viernes" }
];
reunion.hd = [
  { desde: base + 50000, hasta: base + 90000, texto: "Abrimos con el estado del piloto de telemedicina en tres hospitales." },
  { desde: base + 11 * 60000, hasta: base + 13 * 60000, texto: "Luis se compromete a enviar el informe financiero el viernes." }
];
reunion.hdFallidos = [{ desde: base + 4 * 60000, hasta: base + 6 * 60000, error: "503" }];

await prueba("guarda y recupera una reunión", () => {
  assert.ok(R.guardarReunion(reunion));
  assert.equal(R.obtenerReunion(reunion.id).meta.titulo, "Comité de salud digital");
});

await prueba("usa alta fidelidad y rellena los tramos fallidos con el navegador", () => {
  const texto = R.transcripcionComoTexto(reunion);
  assert.match(texto, /\[00:00:50\] Abrimos con el estado del piloto de telemedicina en tres hospitales\./);
  assert.match(texto, /\[00:05:00\] el presupuesto aprobado es de cuarenta millones \(respaldo navegador\)/);
  assert.ok(!texto.includes("abrimos con el estado del piloto de telemedicina\n"), "no debe duplicar lo ya transcrito en alta");
});

await prueba("consultar_reunion encuentra el pasaje pertinente con su marca", () => {
  const r = R.consultarReunion(reunion, "¿cuál es el presupuesto del piloto?");
  assert.ok(r.ok);
  assert.ok(r.pasajes.some(p => p.includes("cuarenta millones") && p.startsWith("[00:05:00]")));
  assert.equal(r.reunion, "Comité de salud digital");
});

await prueba("elige la reunión por título y la última por defecto", () => {
  const otra = R.nuevaReunion({ titulo: "Reunión de presupuesto anual" });
  R.guardarReunion(otra);
  assert.equal(R.elegirReunion("salud digital").id, reunion.id);
  assert.equal(R.elegirReunion("").id, otra.id);
  R.borrarReunion(otra.id);
});

await prueba("índice de reuniones para el arranque de sesión", () => {
  const indice = R.indiceDeReuniones();
  assert.ok(indice[0].includes("Comité de salud digital"));
});

console.log("reunion.mjs");

const fetchReal = globalThis.fetch;
const simular = manejador => { globalThis.fetch = async (url, opciones) => manejador(String(url), opciones); };
const respuesta = (estado, cuerpo) => new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status: estado });
const config = (await import("../config.mjs")).CONFIG_POR_DEFECTO;

await prueba("transcripción: cae al modelo siguiente si el primero no existe y filtra alucinaciones", async () => {
  process.env.OPENAI_API_KEY = "sk-prueba";
  delete process.env.GEMINI_API_KEY;
  const modelos = [];
  simular((url, opciones) => {
    modelos.push(opciones.body.get("model"));
    if (modelos.length === 1) return respuesta(404, { error: { message: "model not found" } });
    return respuesta(200, { text: "Subtítulos realizados por la comunidad de Amara.org" });
  });
  const r = await S.transcribirTramo({ audio: "UklGRg==" }, config, null);
  assert.deepEqual(modelos, ["gpt-4o-transcribe", "whisper-1"]);
  assert.equal(r.ok, true);
  assert.equal(r.texto, "", "la alucinación típica del silencio debe descartarse");
});

await prueba("transcripción: rechaza audio vacío o demasiado grande", async () => {
  assert.equal((await S.transcribirTramo({ audio: "" }, config, null)).ok, false);
  assert.equal((await S.transcribirTramo({ audio: "a".repeat(4_000_000) }, config, null)).definitivo, true);
});

await prueba("minuta: usa Gemini en estándar, normaliza la respuesta y deja trazabilidad", async () => {
  process.env.GEMINI_API_KEY = "AIza-prueba";
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let pedido = null;
  simular((url, opciones) => {
    if (url.includes("gemini-3.1-flash")) return respuesta(404, {});
    pedido = JSON.parse(opciones.body);
    const minuta = {
      onePager: { mensajeClave: "Se aprueba el piloto", decisiones: ["Aprobar piloto"], acciones: [{ accion: "Enviar informe", responsable: "Luis" }] },
      extensa: { temas: [{ titulo: "Piloto", desarrollo: "..." }], graficos: [{ titulo: "Uno solo", tipo: "barras", series: [{ etiqueta: "a", valor: "3" }] }], diagramas: [{ titulo: "Vacío", mermaid: " " }] }
    };
    return respuesta(200, { candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(minuta) + "\n```" }] }, finishReason: "STOP" }] });
  });
  const datos = R.datosParaMinuta(reunion);
  const r = await S.generarMinuta({ ...datos, nivel: "estandar" }, config, null);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.trazabilidad.proveedor, "gemini");
  assert.equal(r.trazabilidad.modelo, "gemini-2.5-flash");
  assert.equal(r.minuta.onePager.acciones[0].plazo, "", "los campos ausentes deben quedar vacíos, no indefinidos");
  assert.deepEqual(r.minuta.extensa.riesgos, []);
  assert.equal(r.minuta.extensa.graficos.length, 0, "un gráfico de un solo valor se descarta");
  assert.equal(r.minuta.extensa.diagramas.length, 0, "un diagrama vacío se descarta");
  const entrada = pedido.contents[0].parts[0].text;
  assert.match(entrada, /Objetivo declarado: Aprobar el piloto de telemedicina/);
  assert.match(entrada, /<transcripcion>/);
  assert.match(entrada, /respaldo navegador/);
});

await prueba("minuta: sin ninguna clave, error claro", async () => {
  delete process.env.GEMINI_API_KEY;
  const r = await S.generarMinuta({ transcripcion: "x".repeat(100) }, config, null);
  assert.equal(r.ok, false);
  assert.match(r.error, /clave/);
});

await prueba("minuta: la clave propia habilita al proveedor y se marca en la trazabilidad", async () => {
  let cabecera = "";
  simular((url, opciones) => {
    cabecera = opciones.headers["x-goog-api-key"];
    return respuesta(200, { candidates: [{ content: { parts: [{ text: "{\"onePager\":{\"mensajeClave\":\"ok\"}}" }] } }] });
  });
  const r = await S.generarMinuta({ transcripcion: "x".repeat(100), nivel: "estandar" }, config, { proveedor: "gemini", clave: "clave-de-la-persona" });
  assert.equal(r.ok, true, r.error);
  assert.equal(cabecera, "clave-de-la-persona");
  assert.equal(r.trazabilidad.clavePropia, true);
});

await prueba("minuta: rechaza transcripciones vacías sin llamar a nadie", async () => {
  simular(() => { throw new Error("no debería llamar"); });
  assert.equal((await S.generarMinuta({ transcripcion: "hola" }, config, null)).ok, false);
});

await prueba("clave propia: sólo se acepta de proveedores conocidos", () => {
  assert.equal(S.clavePropiaDe({ headers: { "x-clave-propia": "k", "x-proveedor-propio": "otro" } }), null);
  assert.deepEqual(S.clavePropiaDe({ headers: { "x-clave-propia": "k", "x-proveedor-propio": "anthropic" } }), { clave: "k", proveedor: "anthropic" });
});

await prueba("correo: el one pager va escapado y los adjuntos se filtran", () => {
  const { html, texto } = S.correoDeMinuta({
    minuta: { onePager: { mensajeClave: "<script>alert(1)</script>", decisiones: ["A & B"], acciones: [], riesgos: [], proximosPasos: [], indicadores: [] } },
    meta: { titulo: "Prueba", fecha: "hoy" }
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("A &amp; B"));
  assert.ok(texto.includes("A & B"));
  const adjuntos = S.adjuntosSeguros([
    { nombre: "minuta.html", contenido: "<p>x</p>" },
    { nombre: "virus.exe", contenido: "MZ" },
    { nombre: "../../minuta.md", contenido: "# x" }
  ]);
  assert.deepEqual(adjuntos.map(a => a.filename), ["minuta.html", "minuta.md"]);
});

await prueba("prompt para suscripción de chat: incluye instrucciones y transcripción, pide Markdown", () => {
  const p = S.promptManual({ ...R.datosParaMinuta(reunion), nivel: "detallado" });
  assert.match(p, /One pager/);
  assert.match(p, /cuarenta millones/);
  assert.match(p, /Markdown/);
  assert.ok(!p.includes("Responde SOLO con el JSON"));
});

await prueba("Markdown de la minuta: secciones, tablas y bloques mermaid", async () => {
  simular(() => respuesta(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({
    onePager: { mensajeClave: "Clave", acciones: [{ accion: "Enviar | informe", responsable: "Luis", plazo: "viernes" }] },
    extensa: { resumenEjecutivo: "Resumen", diagramas: [{ titulo: "Flujo", mermaid: "flowchart LR\n  A --> B" }] }
  }) }] } }] }));
  process.env.GEMINI_API_KEY = "AIza-prueba";
  const r = await S.generarMinuta({ transcripcion: "x".repeat(100) }, config, null);
  reunion.minuta = r.minuta;
  reunion.trazabilidad = r.trazabilidad;
  const md = R.minutaAMarkdown(reunion);
  assert.match(md, /## One pager/);
  assert.match(md, /\| Enviar \/ informe \| Luis \| viernes \|/);
  assert.match(md, /```mermaid\nflowchart LR/);
  assert.match(md, /Requiere revisión humana/);
});

await prueba("minuta detallada con Claude: salida estructurada y, si la cuenta la rechaza (400), reintento sin ella", async () => {
  let sdk = true;
  try { await import("@anthropic-ai/sdk"); } catch { sdk = false; }
  if (!sdk) { console.log("    (omitida: @anthropic-ai/sdk no instalado; ejecuta npm install)"); return; }
  process.env.ANTHROPIC_API_KEY = "sk-ant-prueba";
  const cuerpos = [];
  const sse = texto => {
    const ev = (tipo, datos) => `event: ${tipo}\ndata: ${JSON.stringify({ type: tipo, ...datos })}\n\n`;
    return ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
      + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
      + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: texto } })
      + ev("content_block_stop", { index: 0 })
      + ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } })
      + ev("message_stop", {});
  };
  simular((url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    cuerpos.push(cuerpo);
    if (cuerpo.fallbacks) return respuesta(400, { type: "error", error: { type: "invalid_request_error", message: "beta no disponible" } });
    return new Response(sse(JSON.stringify({ onePager: { mensajeClave: "Aprobado" } })), { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  const r = await S.generarMinuta({ transcripcion: "x".repeat(100), nivel: "detallado" }, config, null);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.trazabilidad.proveedor, "anthropic");
  assert.equal(r.trazabilidad.modelo, "claude-opus-5-5");
  assert.equal(r.minuta.onePager.mensajeClave, "Aprobado");
  assert.equal(cuerpos[0].model, "claude-opus-5-5");
  assert.equal(cuerpos[0].output_config.format.type, "json_schema");
  assert.equal(cuerpos[0].output_config.effort, "high");
  assert.equal(cuerpos[1].fallbacks, undefined, "el reintento va sin relevo ni formato");
  assert.ok(r.trazabilidad.advertencias.some(a => /estructurada/.test(a)));
  delete process.env.ANTHROPIC_API_KEY;
});

globalThis.fetch = fetchReal;
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fallos ? 1 : 0);
