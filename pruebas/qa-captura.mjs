// El camino del micrófono, aislado: el worklet de captura y el codificador.
//
// Lo que se comprueba es que el agente reciba EXACTAMENTE lo que dijo el
// micrófono —ni una muestra de más ni de menos, en orden— y que el codificador
// rápido produzca el mismo base64 que el lento que sustituye.
import { readFileSync } from "node:fs";

const HZ = 16000, BLOQUE = 128;
let Procesador = null;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
globalThis.registerProcessor = (_n, c) => { Procesador = c; };
globalThis.sampleRate = HZ;
eval(readFileSync(new URL("../public/audio/captura-pcm.js", import.meta.url), "utf8"));

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });

// ── 1. El worklet entrega lotes exactos, transferidos, en orden ─────────────
const p = new Procesador({ processorOptions: { muestrasPorEnvio: 1600 } });
const recibidos = [];
p.port.postMessage = (m, transfer) => { recibidos.push({ m, transfer }); };
let n = 0;
const vueltas = Math.ceil((1600 * 3 + 100) / BLOQUE);   // tres lotes y pico
for (let v = 0; v < vueltas; v += 1) {
  const canal = new Float32Array(BLOQUE);
  for (let i = 0; i < BLOQUE; i += 1) canal[i] = ((n++ % 200) - 100) / 100;   // rampa reconocible
  p.process([[canal]]);
}
anotar("Cada 100 ms sale un lote, ni antes ni después", recibidos.length === 3, `${recibidos.length} lotes de ${vueltas * BLOQUE} muestras`);
anotar("El lote viaja transferido, no copiado", recibidos.every(r => Array.isArray(r.transfer) && r.transfer[0] === r.m.muestras), "");
const todo = recibidos.flatMap(r => [...new Int16Array(r.m.muestras)]);
anotar("Son exactamente 4800 muestras de 16 bits", todo.length === 4800, String(todo.length));
// La rampa se reconstruye: el valor i es ((i % 200) - 100) / 100 en 16 bits.
const esperado = i => { const v = ((i % 200) - 100) / 100; return Math.round(v < 0 ? v * 0x8000 : v * 0x7fff); };
const desvios = todo.filter((v, i) => Math.abs(v - esperado(i)) > 1).length;
anotar("Y en orden, sin perder ni repetir ninguna", desvios === 0, `${desvios} muestras fuera de sitio`);
anotar("El resto de muestras queda esperando al lote siguiente, no se tira", p.llenas + todo.length === vueltas * BLOQUE, `pendientes: ${p.llenas} de ${vueltas * BLOQUE - todo.length}`);

// ── 2. Al parar, deja de procesar ──────────────────────────────────────────
p.port.onmessage({ data: { tipo: "parar" } });
const sigue = p.process([[new Float32Array(BLOQUE)]]);
anotar("«parar» apaga el procesador", sigue === false, String(sigue));

// ── 3. El codificador rápido da el mismo base64 que el lento ────────────────
globalThis.btoa = s => Buffer.from(s, "latin1").toString("base64");
const fuente = readFileSync(new URL("../public/realtime/elevenlabs-session.js", import.meta.url), "utf8");
const cuerpo = fuente.slice(fuente.indexOf("const TROZO"), fuente.indexOf("\n}\n", fuente.indexOf("function codificar")) + 3);
const codificar = new Function(cuerpo + "\nreturn codificar;")();
const lento = enteros => { const b = new Uint8Array(enteros.buffer, enteros.byteOffset, enteros.byteLength); let s = ""; for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]); return btoa(s); };
const muestra = new Int16Array(1600); for (let i = 0; i < 1600; i += 1) muestra[i] = (i * 7919) % 65536 - 32768;
anotar("El base64 rápido es idéntico al lento", codificar(muestra) === lento(muestra), "");
const grande = new Int16Array(24000 * 45); for (let i = 0; i < grande.length; i += 1) grande[i] = (i * 31) % 65536 - 32768;
anotar("Y aguanta un turno de 45 s sin desbordar la pila", codificar(grande) === lento(grande), "");
const t0 = performance.now(); for (let i = 0; i < 200; i += 1) codificar(muestra); const rapido = performance.now() - t0;
const t1 = performance.now(); for (let i = 0; i < 200; i += 1) lento(muestra); const viejo = performance.now() - t1;
// En Node el motor optimiza la concatenación y la diferencia es pequeña; lo
// que se gana en el navegador es no crear miles de cadenas intermedias en el
// hilo principal. Aquí sólo se comprueba que no sea más lento.
anotar("Y no es más lento que el de antes", rapido <= viejo * 1.5, `200 lotes: rápido ${rapido.toFixed(1)} ms · anterior ${viejo.toFixed(1)} ms`);

let mal = 0;
for (const x of paso) { if (!x.ok) mal += 1; console.log(`${x.ok ? "ok   " : "FALLA"} ${x.n}${x.ok ? "" : "\n        → " + x.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de la captura pasan`);
process.exit(mal ? 1 : 0);
