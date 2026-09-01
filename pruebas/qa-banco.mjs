// Banco de pruebas del navegador. Cada escenario corre en una pestaña limpia,
// con un reconocimiento de voz falso instalado antes de que cargue nada.
const PUERTO = 9334;

export const PREVIO = `
window.__motores = [];
class ReconocimientoFalso {
  constructor() {
    this.lang = "en-US"; this.continuous = false; this.interimResults = false;
    this.corriendo = false; this.arranques = 0;
    window.__motores.push(this);
  }
  start() {
    if (this.corriendo) { const e = new Error("ya arrancado"); e.name = "InvalidStateError"; throw e; }
    if (window.__negarArranque) { const e = new Error("denegado"); e.name = "NotAllowedError"; throw e; }
    this.corriendo = true; this.arranques += 1;
    setTimeout(() => this.onstart?.({}), 0);
  }
  stop() { this.corriendo = false; setTimeout(() => this.onend?.({}), 0); }
  abort() { this.corriendo = false; }
  // Simula que el navegador lo corta solo, como pasa en los silencios largos.
  morirSolo() { this.corriendo = false; this.onend?.({}); }
  fallar(codigo) { this.onerror?.({ error: codigo }); }
  emitir(texto, confianza = 0.8, final = true) {
    const alt = { transcript: texto, confidence: confianza };
    const res = { 0: alt, length: 1, isFinal: final };
    this.onresult?.({ resultIndex: 0, results: { 0: res, length: 1 } });
  }
}
window.__sinReconocimiento = false;
Object.defineProperty(window, "SpeechRecognition", { get: () => window.__sinReconocimiento ? undefined : ReconocimientoFalso, configurable: true });
Object.defineProperty(window, "webkitSpeechRecognition", { get: () => window.__sinReconocimiento ? undefined : ReconocimientoFalso, configurable: true });
window.__errores = [];
window.addEventListener("error", e => window.__errores.push(String(e.message)));
window.addEventListener("unhandledrejection", e => window.__errores.push("promesa: " + String(e.reason)));
// Contador de peticiones al servidor, para poder afirmar «cero envíos».
window.__peticiones = [];
const fetchOriginal = window.fetch;
window.fetch = function (url, opciones) {
  window.__peticiones.push({ url: String(url), metodo: opciones?.metodo || opciones?.method || "GET", cuerpo: opciones?.body });
  if (window.__servidorCaido && String(url).startsWith("/reunion/")) return Promise.reject(new Error("servidor caído (simulado)"));
  return fetchOriginal.apply(this, arguments);
};
`;

// Utilidades que todo escenario tiene disponibles dentro de la página.
export const AYUDAS = `
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const visible = s => { const n = $(s); return Boolean(n) && !n.hidden && n.offsetParent !== null; };
  const acta = () => [...document.querySelectorAll("#reunionActaLineas .acta-linea")]
    .map(l => ({ quien: l.querySelector(".acta-quien").textContent.trim(), texto: l.querySelector(".acta-texto").textContent, idioma: l.querySelector(".acta-idioma")?.textContent || "" }));
  const motor = c => window.__motores.find(m => m.lang === c && m.corriendo);
  const paso = [];
  const anotar = (nombre, ok, detalle) => paso.push({ nombre, ok: Boolean(ok), detalle: String(detalle ?? "") });
  const soltar = (nodo, archivos) => nodo.dispatchEvent(new CustomEvent("__prueba", { detail: archivos }));
`;

export async function escenario(nombre, cuerpo, { url = "http://127.0.0.1:8123/", espera = 90000, previoExtra = "", movil = false } = {}) {
  const nueva = await fetch(`http://127.0.0.1:${PUERTO}/json/new?about:blank`, { method: "PUT" });
  const info = await nueva.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const cmd = (method, params) => new Promise(res => { const p = ++id; pend.set(p, res); ws.send(JSON.stringify({ id: p, method, params })); });

  await cmd("Page.enable", {});
  await cmd("Emulation.setDeviceMetricsOverride", movil
    ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }
    : { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await cmd("Page.addScriptToEvaluateOnNewDocument", { source: PREVIO + previoExtra });
  await cmd("Page.navigate", { url });
  await new Promise(r => setTimeout(r, 2200));

  const guion = `(async () => {${AYUDAS}
${cuerpo}
  return JSON.stringify({ paso, errores: window.__errores });
})()`;
  const salida = await cmd("Runtime.evaluate", { expression: guion, awaitPromise: true, returnByValue: true, timeout: espera });
  ws.close();
  await fetch(`http://127.0.0.1:${PUERTO}/json/close/${info.id}`).catch(() => {});

  const bruto = salida.result?.result?.value;
  if (typeof bruto !== "string") {
    return { nombre, roto: salida.result?.exceptionDetails?.exception?.description || JSON.stringify(salida).slice(0, 400), paso: [], errores: [] };
  }
  return { nombre, ...JSON.parse(bruto) };
}

export function informar(resultados) {
  let fallos = 0, total = 0;
  for (const r of resultados) {
    console.log(`\n━━ ${r.nombre}`);
    if (r.roto) { fallos += 1; console.log(`  ROTO: ${r.roto}`); continue; }
    for (const p of r.paso) {
      total += 1;
      if (!p.ok) fallos += 1;
      console.log(`  ${p.ok ? "ok   " : "FALLA"} ${p.nombre}${p.ok ? "" : "\n         → " + p.detalle}`);
    }
    const propios = r.errores.filter(e => !/favicon|ERR_|net::/i.test(e));
    if (propios.length) { fallos += 1; console.log(`  ERRORES EN LA PÁGINA:\n    ${propios.join("\n    ")}`); }
  }
  console.log(`\n${fallos ? `✗ ${fallos} fallos de ${total} comprobaciones` : `✓ las ${total} comprobaciones pasan`}`);
  return fallos;
}
