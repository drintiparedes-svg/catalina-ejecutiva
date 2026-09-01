// El reproductor de voz, aislado.
//
// Se entrecortaba cuando el audio llegaba más lento de lo que se reproduce —una
// respuesta larga que el modelo genera despacio, como el resumen de una minuta—:
// el búfer se quedaba vacío y se rellenaba con silencio muestra a muestra, así
// que sonaba un microcorte cada pocos milisegundos durante toda la respuesta.
import { readFileSync } from "node:fs";

const HZ = 24000;
const BLOQUE = 128;                       // lo que pide la tarjeta en cada vuelta
let Procesador = null;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
globalThis.registerProcessor = (_n, clase) => { Procesador = clase; };
globalThis.sampleRate = HZ;
eval(readFileSync(new URL("../public/audio/reproductor-pcm.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, ""));

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });
// Señal que NUNCA vale cero: así el silencio de relleno del reproductor se
// distingue del audio. Una senoide cruza el cero y se contaría como corte.
const tono = n => { const m = new Float32Array(n); for (let i = 0; i < n; i += 1) m[i] = 0.5 + Math.sin(i / 8) * 0.2; return m; };

// Reproduce `bloques` vueltas, entregando audio según `alimentar(i)`.
function correr({ bloques, alimentar }) {
  const p = new Procesador();
  const salida = [];
  for (let i = 0; i < bloques; i += 1) {
    const trozo = alimentar(i);
    if (trozo) p.port.onmessage({ data: { tipo: "audio", muestras: trozo } });
    const canal = new Float32Array(BLOQUE);
    p.process([], [[canal]]);
    salida.push(...canal);
  }
  // Cuenta los HUECOS: tramos de silencio entre sonido. Uno largo se oye como
  // una pausa; treinta cortos se oyen como una voz rota.
  let huecos = 0, dentro = false, sonoTodavia = false, largoActual = 0;
  const largos = [];
  for (const v of salida) {
    if (v !== 0) { sonoTodavia = true; if (dentro) { largos.push(largoActual); largoActual = 0; } dentro = false; }
    else if (sonoTodavia) { if (!dentro) { dentro = true; huecos += 1; } largoActual += 1; }
  }
  const sonoras = salida.filter(v => v !== 0).length;
  return { huecos, largos, sonoras, total: salida.length };
}

// ── 1. Audio de sobra: ni un hueco ─────────────────────────────────────────
let r = correr({ bloques: 400, alimentar: i => (i % 4 === 0 ? tono(BLOQUE * 6) : null) });
anotar("Con audio de sobra no se abre ni un hueco", r.huecos === 0, `${r.huecos} huecos, ${r.sonoras} muestras sonoras`);

// ── 2. Audio más lento que la reproducción: el caso de la minuta ───────────
// Llega el 70 % de lo que se gasta: el búfer se seca una y otra vez.
r = correr({ bloques: 1500, alimentar: i => (i % 10 === 0 ? tono(Math.round(BLOQUE * 7)) : null) });
const medio = r.largos.length ? Math.round(r.largos.reduce((a, b) => a + b, 0) / r.largos.length) : 0;
// Con el audio llegando al 70 % del ritmo, algo de silencio es inevitable: lo
// que se puede elegir es si son cien cortes de 15 ms —voz rota— o unas pocas
// pausas largas —voz con pausas, que es como habla la gente—.
anotar("Con audio lento, los cortes son POCOS y largos, no muchos y cortos",
  r.huecos <= 20 && medio >= HZ * 0.10,
  `${r.huecos} cortes, de ${Math.round(medio / HZ * 1000)} ms de media`);
anotar("Y no se pierde audio: todo lo que llegó, suena",
  r.sonoras >= 1500 * 0.65, `${r.sonoras} muestras sonoras de ${Math.round(1500 * BLOQUE * 0.7)} entregadas`);

// ── 3. Un apuro de un solo cuadro no obliga a re-precargar ─────────────────
r = correr({ bloques: 300, alimentar: i => (i === 0 ? tono(BLOQUE * 40) : (i === 45 ? tono(BLOQUE * 260) : null)) });
anotar("Un tropiezo corto no mete una pausa entera", r.huecos <= 2, `${r.huecos} cortes`);

// ── 4. Interrumpirla vacía todo y vuelve a empezar limpio ──────────────────
const p = new Procesador();
p.port.onmessage({ data: { tipo: "audio", muestras: tono(HZ) } });
p.process([], [[new Float32Array(BLOQUE)]]);
p.port.onmessage({ data: { tipo: "callar" } });
anotar("Al interrumpirla se vacía el búfer entero", p.disponibles === 0, String(p.disponibles));
anotar("Y el reloj de la boca vuelve a cero", p.reproducidas === 0 && p.arrancado === false, `${p.reproducidas} / ${p.arrancado}`);
p.port.onmessage({ data: { tipo: "audio", muestras: tono(HZ) } });
const canal = new Float32Array(BLOQUE);
p.process([], [[canal]]);
anotar("Después de interrumpirla vuelve a hablar", canal.some(v => v !== 0), "");

// ── 5. Nunca se descarta audio, aunque llegue un turno entero de golpe ─────
const p2 = new Procesador();
const largo = tono(HZ * 45);              // 45 segundos de una vez
p2.port.onmessage({ data: { tipo: "audio", muestras: largo } });
anotar("Un turno de 45 s entra entero, el búfer crece en vez de tirar nada",
  p2.disponibles === HZ * 45, `${p2.disponibles} de ${HZ * 45}`);

let mal = 0;
for (const x of paso) { if (!x.ok) mal += 1; console.log(`${x.ok ? "ok   " : "FALLA"} ${x.n}${x.ok ? "" : "\n        → " + x.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones del reproductor pasan`);
process.exit(mal ? 1 : 0);
