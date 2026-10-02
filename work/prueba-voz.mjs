// Pruebas del reproductor de voz (public/audio/reproductor-pcm.js), sin
// navegador: se simula el hilo de audio llamando a process() bloque a bloque.
//
//   node work/prueba-voz.mjs
//
// Cubre lo que hacía que la voz sonara entrecortada:
//   · el colchón se mide en tiempo de espera, no en muestras encoladas;
//   · un vacío a media frase se cuenta, se funde sin chasquido y sube el
//     colchón del turno siguiente;
//   · el aviso de voz sonando / callada que cierra la compuerta de la reunión;
//   · callar vacía todo sin contar un corte.

import assert from "node:assert/strict";

let fallos = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); console.log(`  ✓ ${nombre}`); }
  catch (error) { fallos += 1; console.error(`  ✗ ${nombre}\n    ${error.stack?.split("\n").slice(0, 3).join("\n    ")}`); }
};

const HZ = 24000, BLOQUE = 128;
let Clase;
globalThis.sampleRate = HZ;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { mensajes: [], postMessage(m) { this.mensajes.push(m); } }; } };
globalThis.registerProcessor = (_n, c) => { Clase = c; };
await import(`../public/audio/reproductor-pcm.js?${Date.now()}`);

const nuevo = () => new Clase();
const enviar = (r, ms, valor = .3) => r.port.onmessage({ data: { tipo: "audio", muestras: new Float32Array(Math.round(HZ * ms / 1000)).fill(valor) } });
// Avanza `ms` de reloj de audio y devuelve lo que sonó.
const avanzar = (r, ms) => {
  const salida = [];
  for (let i = 0; i < Math.round(HZ * ms / 1000 / BLOQUE); i += 1) {
    const canal = new Float32Array(BLOQUE);
    r.process([], [[canal]]);
    salida.push(...canal);
  }
  return salida;
};
const suena = muestras => muestras.some(x => Math.abs(x) > 1e-4);
const voz = r => r.port.mensajes.filter(m => m.tipo === "voz").map(m => m.sonando);

console.log("Reproductor de voz");

await prueba("un trozo grande no se reproduce al instante: espera el colchón en tiempo", () => {
  const r = nuevo();
  enviar(r, 250);                          // un solo trozo ya supera 180 ms en muestras
  assert.equal(suena(avanzar(r, 150)), false, "a los 150 ms todavía no debe sonar");
  assert.equal(suena(avanzar(r, 60)), true, "pasado el colchón de 180 ms sí suena");
  assert.deepEqual(voz(r), [true]);
});

await prueba("con audio de sobra (Gemini manda el turno entero) no se espera", () => {
  const r = nuevo();
  enviar(r, 2000);
  assert.equal(suena(avanzar(r, 10)), true);
});

await prueba("el retraso de un trozo dentro del colchón no produce ningún corte", () => {
  const r = nuevo();
  enviar(r, 250); avanzar(r, 250);         // 180 ms de espera + 70 ms sonando
  enviar(r, 250); avanzar(r, 250);         // llega 150 ms tarde respecto del ritmo real: cubierto
  enviar(r, 250); avanzar(r, 2000);
  const e = r.port.mensajes.filter(m => m.tipo === "estadisticas").at(-1);
  assert.equal(e.cortes, 0);
  assert.equal(e.turnos, 1);
});

await prueba("un vacío a media frase se cuenta, es una pausa (no un tartamudeo) y sube el colchón", () => {
  const r = nuevo();
  enviar(r, 250); avanzar(r, 450);         // suena y se vacía
  enviar(r, 20);  const tramo = avanzar(r, 60);
  // Con sólo 20 ms encolados no arranca de inmediato: espera el colchón corto (80 ms).
  assert.equal(suena(tramo.slice(0, Math.round(HZ * .05))), false);
  enviar(r, 250); avanzar(r, 400);
  avanzar(r, 1300);                        // fin de turno
  const e = r.port.mensajes.filter(m => m.tipo === "estadisticas").at(-1);
  assert.equal(e.cortes, 1);
  assert.equal(e.turnosConCortes, 1);
  assert.equal(e.colchonMs, 280, "tras un turno con cortes el colchón sube 100 ms");
});

await prueba("los bordes se funden: sin saltos bruscos al arrancar ni al vaciarse", () => {
  const r = nuevo();
  enviar(r, 2000, .8);
  const sonido = avanzar(r, 2100);
  const inicio = sonido.findIndex(x => x !== 0);
  assert.ok(sonido[inicio] < .8 / 10, "la primera muestra entra fundida");
  let salto = 0;
  for (let i = 1; i < sonido.length; i += 1) salto = Math.max(salto, Math.abs(sonido[i] - sonido[i - 1]));
  assert.ok(salto < .8 / 10, `salto máximo ${salto}`);
});

await prueba("avisa voz callada tras 250 ms de silencio (abre la compuerta de la reunión)", () => {
  const r = nuevo();
  enviar(r, 300); avanzar(r, 520);
  assert.deepEqual(voz(r), [true]);
  avanzar(r, 260);
  assert.deepEqual(voz(r), [true, false]);
});

await prueba("callar vacía al instante, avisa, reinicia el reloj y no cuenta corte", () => {
  const r = nuevo();
  enviar(r, 3000); avanzar(r, 400);
  r.port.onmessage({ data: { tipo: "callar" } });
  assert.equal(suena(avanzar(r, 100)), false);
  assert.deepEqual(voz(r), [true, false]);
  assert.ok(r.port.mensajes.some(m => m.tipo === "reloj" && m.reinicio));
  enviar(r, 300); avanzar(r, 2000);
  const e = r.port.mensajes.filter(m => m.tipo === "estadisticas").at(-1);
  assert.equal(e.cortes, 0);
  assert.equal(e.colchonMs, 180);
});

await prueba("turnos limpios bajan el colchón de vuelta hacia el mínimo", () => {
  const r = nuevo();
  enviar(r, 250); avanzar(r, 450); enviar(r, 250); avanzar(r, 1800);   // turno con corte → 280
  for (let i = 0; i < 3; i += 1) { enviar(r, 1000); avanzar(r, 2600); }
  const e = r.port.mensajes.filter(m => m.tipo === "estadisticas").at(-1);
  assert.equal(e.colchonMs, 220);
});

await prueba("el reloj de la boca sólo cuenta audio que sonó", () => {
  const r = nuevo();
  enviar(r, 500); avanzar(r, 1500);
  const reloj = r.port.mensajes.filter(m => m.tipo === "reloj").at(-1);
  assert.ok(Math.abs(reloj.muestras - HZ * .5) <= HZ * .02);
});

console.log("Entrada del micrófono (realtime/entrada.js)");
const { Decimador } = await import("../public/realtime/entrada.js");
const tono = (f, fs, s = 1) => Float32Array.from({ length: fs * s }, (_, i) => Math.sin(2 * Math.PI * f * i / fs));
const nivel = x => 20 * Math.log10(Math.sqrt(x.slice(200, -200).reduce((a, v) => a + v * v, 0) / (x.length - 400)) / Math.SQRT1_2);

await prueba("la voz pasa intacta: 300 Hz a 5 kHz sin pérdida (±0,2 dB)", () => {
  for (const f of [300, 1000, 3000, 5000]) assert.ok(Math.abs(nivel(new Decimador(48000, 16000).procesar(tono(f, 48000)))) < .2, `${f} Hz`);
});

await prueba("lo que se plegaría al bajar a 16 kHz queda bajo −50 dB (antes pasaba entero)", () => {
  for (const f of [9000, 10000, 12000, 15000]) {
    const db = nivel(new Decimador(48000, 16000).procesar(tono(f, 48000)));
    assert.ok(db < -50, `${f} Hz: ${db.toFixed(1)} dB`);
  }
});

await prueba("procesar por bloques de cualquier tamaño da lo mismo que de una vez", () => {
  const x = tono(1000, 48000);
  const entero = new Decimador(48000, 16000).procesar(x);
  const d = new Decimador(48000, 16000);
  const partes = [];
  for (let i = 0, n = 0; i < x.length; i += n) { n = 500 + (i * 7919) % 700; partes.push(...d.procesar(x.subarray(i, i + n))); }
  assert.equal(partes.length, entero.length);
  for (let i = 0; i < entero.length; i += 1) assert.ok(Math.abs(partes[i] - entero[i]) < 1e-6);
});

await prueba("44,1 kHz (frecuencia no entera) baja a 16 kHz sin deriva ni pérdida de nivel", () => {
  const y = new Decimador(44100, 16000).procesar(tono(1000, 44100));
  assert.ok(Math.abs(y.length - 16000) <= 12, `muestras ${y.length}`);
  assert.ok(Math.abs(nivel(y)) < .2);
});

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fallos ? 1 : 0);
