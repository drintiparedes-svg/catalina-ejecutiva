// Pruebas de continuidad de la grabación de reuniones, sin navegador.
//
//   node work/prueba-continuidad.mjs
//
// Lo que cortaba la transcripción en reuniones presenciales era el equipo
// ahorrando energía. Aquí se cubre la parte que no necesita hardware:
//   · archivo-audio.js: el códec ADPCM conserva la voz, la recuperación
//     vuelve a transcribir lo pendiente y reemplaza los fallos sin duplicar;
//   · reuniones.js: los huecos de audio entran en la transcripción con su
//     causa y bajan la cobertura (antes marcaba 100 % aunque faltara audio);
//   · continuidad.js: el resumen por causa;
//   · escucha.js: el latido de audio rearranca la escucha aunque los
//     temporizadores estén frenados por estar la pestaña en segundo plano.
// Micrófono perdido, audio pausado, red caída y pestaña cerrada se prueban en
// Chromium real (ver el informe de la entrega).

import assert from "node:assert/strict";

let fallos = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); console.log(`  ✓ ${nombre}`); }
  catch (error) { fallos += 1; console.error(`  ✗ ${nombre}\n    ${error.stack?.split("\n").slice(0, 3).join("\n    ")}`); }
};

const almacen = new Map();
globalThis.localStorage = { getItem: k => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, String(v)), removeItem: k => almacen.delete(k) };
class ReconocimientoFalso {
  static instancias = [];
  constructor() { ReconocimientoFalso.instancias.push(this); }
  start() { setTimeout(() => this.onstart?.(), 0); }
  stop() {}
  abort() {}
}
globalThis.window = { SpeechRecognition: ReconocimientoFalso };

const AA = await import("../public/archivo-audio.js");
const R = await import("../public/reuniones.js");
const C = await import("../public/continuidad.js");
const { EscuchaDeReunion } = await import("../public/escucha.js");

console.log("archivo-audio.js");

await prueba("ADPCM: ocupa un cuarto del PCM de 16 bits y conserva la voz (SNR > 20 dB)", () => {
  const hz = 16000, n = hz * 2;
  const voz = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / hz;
    voz[i] = .3 * Math.sin(2 * Math.PI * 180 * t) * (1 + .5 * Math.sin(2 * Math.PI * 3 * t)) + .1 * Math.sin(2 * Math.PI * 1200 * t) + .05 * Math.sin(2 * Math.PI * 2700 * t);
  }
  const codificado = AA.codificarAdpcm(voz);
  assert.equal(codificado.length, n / 2);
  const vuelta = AA.decodificarAdpcm(codificado, n);
  let senal = 0, ruido = 0;
  for (let i = 0; i < n; i += 1) { senal += voz[i] ** 2; ruido += (voz[i] - vuelta[i]) ** 2; }
  const snr = 10 * Math.log10(senal / ruido);
  assert.ok(snr > 20, `SNR ${snr.toFixed(1)} dB`);
});

const reunionDePrueba = () => {
  const r = R.nuevaReunion({ titulo: "Comité presencial" });
  r.meta.inicio = 1_000_000;
  r.meta.fin = 1_000_000 + 10 * 60000;
  r.alta = true;
  return r;
};
const tramo = (desde, estado) => ({ id: `x:${desde}`, reunionId: "x", desde, hasta: desde + 30000, hz: 16000, largo: 1600, adpcm: AA.codificarAdpcm(new Float32Array(1600).fill(.1)), estado });

await prueba("recuperación: transcribe lo pendiente y lo fallido, reemplaza el fallo y marca el tramo", async () => {
  const r = reunionDePrueba();
  r.hd.push({ desde: 1_000_000, hasta: 1_030_000, texto: "Inicio de la reunión.", proveedor: "x" });
  r.hdFallidos.push({ desde: 1_030_000, hasta: 1_060_000, error: "red" });
  const cambios = [];
  const b = await AA.recuperarReunion(r, {
    tramos: [tramo(1_000_000, "transcrito"), tramo(1_030_000, "fallido"), tramo(1_060_000, "pendiente")],
    actualizar: async (id, c) => cambios.push([id, c.estado]),
    aWav: () => "wav",
    transcribir: async (_wav, meta) => ({ ok: true, texto: `Recuperado ${meta.desde}`, proveedor: "simulado" })
  });
  assert.deepEqual(b, { intentados: 2, recuperados: 2, fallidos: 0, vacios: 0 });
  assert.equal(r.hdFallidos.length, 0, "el fallo recuperado deja de contar como fallo");
  assert.deepEqual(r.hd.map(s => s.desde), [1_000_000, 1_030_000, 1_060_000]);
  assert.ok(r.hd[1].recuperado);
  assert.deepEqual(cambios, [["x:1030000", "transcrito"], ["x:1060000", "transcrito"]]);
  assert.match(R.transcripcionComoTexto(r), /Recuperado 1030000/);
  assert.equal(R.calidad(r).tramosRecuperados, 2);
});

await prueba("recuperación: si sigue fallando, queda fallido; un error definitivo no insiste", async () => {
  const r = reunionDePrueba();
  let llamadas = 0;
  const b = await AA.recuperarReunion(r, {
    tramos: [tramo(1_000_000, "fallido"), tramo(1_030_000, "fallido")],
    actualizar: async () => {}, aWav: () => "wav",
    transcribir: async () => { llamadas += 1; return { ok: false, error: "sin clave", definitivo: true }; }
  });
  assert.equal(llamadas, 1);
  assert.equal(b.fallidos, 1);
  assert.equal(r.hd.length, 0);
});

await prueba("recuperación: no duplica un tramo que ya estaba transcrito", () => {
  const r = reunionDePrueba();
  assert.equal(AA.aplicarRecuperado(r, { desde: 5, hasta: 6, texto: "a" }), true);
  assert.equal(AA.aplicarRecuperado(r, { desde: 5, hasta: 6, texto: "a" }), false);
  assert.equal(r.hd.length, 1);
});

console.log("reuniones.js + continuidad.js");

await prueba("los huecos de audio entran en la transcripción con su causa y bajan la cobertura", () => {
  const r = reunionDePrueba();
  r.hd.push({ desde: 1_000_000, hasta: 1_030_000, texto: "Hablamos del presupuesto.", proveedor: "x" });
  assert.equal(R.calidad(r).cobertura, 100);
  r.continuidad.huecos.push({ desde: 1_120_000, hasta: 1_240_000, causa: "equipo suspendido o en reposo (pantalla apagada o tapa cerrada)" });
  r.continuidad.huecos.push({ desde: 1_300_000, hasta: 1_330_000, causa: "micrófono desconectado (el micrófono se desconectó)" });
  const texto = R.transcripcionComoTexto(r);
  assert.match(texto, /\[00:02:00\] \[SIN AUDIO ~120 s: no se grabó — equipo suspendido/);
  assert.match(texto, /\[SIN AUDIO ~30 s: no se grabó — micrófono desconectado/);
  const q = R.calidad(r);
  assert.equal(q.cobertura, 75);   // 150 s de 600 s
  assert.equal(q.huecosPorCausa["micrófono desconectado (el micrófono se desconectó)"], 30000);
  const c = C.resumenDeContinuidad(r.continuidad, 600000);
  assert.equal(c.coberturaAudio, 75);
  assert.equal(c.porCausa[0].ms, 120000, "la causa más larga primero");
  assert.equal(C.duracionLegible(125000), "2 min 5 s");
});

await prueba("una reunión antigua sin registro de continuidad sigue funcionando", () => {
  const r = reunionDePrueba();
  delete r.continuidad;
  r.hd.push({ desde: 1_000_000, hasta: 1_030_000, texto: "Hola.", proveedor: "x" });
  assert.equal(R.calidad(r).cobertura, 100);
  assert.equal(C.resumenDeContinuidad(undefined, 1000).huecos, 0);
});

await prueba("una reunión que quedó en curso por cierre inesperado se cierra en su última actividad", () => {
  almacen.clear();
  const viva = R.nuevaReunion({ titulo: "Activa" });
  const cortada = R.nuevaReunion({ titulo: "Cortada" });
  const ahora = Date.now();
  cortada.meta.inicio = ahora - 20 * 60000;
  cortada.meta.vivo = ahora - 10 * 60000;
  cortada.hd.push({ desde: ahora - 11 * 60000, hasta: ahora - 9 * 60000, texto: "x" });
  const reciente = R.nuevaReunion({ titulo: "Reciente" });
  reciente.meta.vivo = ahora - 60000;
  [viva, cortada, reciente].forEach(R.guardarReunion);
  const cerradas = R.cerrarInterrumpidas(viva.id, ahora);
  assert.deepEqual(cerradas.map(r => r.meta.titulo), ["Cortada"]);
  const guardada = R.obtenerReunion(cortada.id);
  assert.equal(guardada.meta.fin, ahora - 9 * 60000, "se cierra en su último momento de actividad");
  assert.equal(guardada.continuidad.eventos.at(-1).tipo, "cierre-inesperado");
  assert.equal(R.obtenerReunion(viva.id).meta.fin, null, "la activa no se toca");
  assert.equal(R.obtenerReunion(reciente.id).meta.fin, null, "con señal de vida reciente no se toca");
});

console.log("escucha.js");

await prueba("el latido de audio rearranca la escucha aunque el temporizador no llegue a dispararse", async () => {
  const realSetTimeout = globalThis.setTimeout;
  const e = new EscuchaDeReunion({});
  assert.equal(e.empezar(), true);
  await new Promise(ok => realSetTimeout(ok, 5));
  const antes = ReconocimientoFalso.instancias.length;
  // Simula la pestaña en segundo plano: los temporizadores no se ejecutan.
  globalThis.setTimeout = () => 0;
  try {
    ReconocimientoFalso.instancias.at(-1).onend();   // Chrome cierra el reconocimiento
    assert.equal(ReconocimientoFalso.instancias.length, antes, "sin latido, sigue caída");
    e.rearranqueEn = Date.now() - 1;                 // ya venció la espera
    e.latido();
    assert.equal(ReconocimientoFalso.instancias.length, antes + 1, "el latido la rearrancó");
    assert.equal(e.estadisticas.reinicios, 1);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    e.parar();
  }
});

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fallos ? 1 : 0);
