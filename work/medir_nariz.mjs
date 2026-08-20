// Medición de la respiración nasal, sin navegador.
//
//   node work/medir_nariz.mjs
//
// Dibuja el mismo rostro dos veces —en reposo y en inspiración máxima— y compara
// píxel a píxel por zonas. Sirve para comprobar lo que no se puede comprobar
// mirando: que el movimiento está donde debe (ala, pared lateral) y que no está
// donde no debe (dorso, labio superior, mejilla), porque si esas zonas se
// desplazan la imagen deja de leerse como respiración tranquila y pasa a
// parecer trabajo respiratorio.

import { createCanvas, loadImage } from "/Users/intiparedes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js";
import { FaceRenderer } from "../public/render/face-renderer.js";

const W = 1408;
const H = 768;

const surface = (width, height) => createCanvas(width, height);
const image = await loadImage(new URL("../public/assets/catalina.png", import.meta.url).pathname);
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const renderer = new FaceRenderer(image, surface);

// Escala 1:1 con la imagen original, para que las coordenadas del rig sean
// directamente las coordenadas del lienzo.
const viewport = { width: W, height: H, pixelRatio: 1 };

const pose = nasal => ({
  body: { x: 0, y: 0 },
  head: { x: 0, y: 0, tilt: 0 },
  breath: { expand: 0, lift: 0, nasal },
  eyes: { left: 0, right: 0, gaze: { x: 0, y: 0 } },
  brows: [{ raise: 0, tilt: 0 }, { raise: 0, tilt: 0 }],
  mouth: { open: 0, spread: .5, round: .12, press: 0, jaw: 0, curl: 0 },
  aura: 0
});

const capturar = nasal => {
  ctx.clearRect(0, 0, W, H);
  renderer.draw(ctx, viewport, pose(nasal));
  return ctx.getImageData(0, 0, W, H).data;
};

const reposo = capturar(0);
const maxima = capturar(1);

// Diferencia media de luminancia dentro de una caja, y el peor píxel de ella.
const zona = (nombre, x0, y0, x1, y1) => {
  let suma = 0, peor = 0, n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4;
      const d = (Math.abs(reposo[i] - maxima[i])
        + Math.abs(reposo[i + 1] - maxima[i + 1])
        + Math.abs(reposo[i + 2] - maxima[i + 2])) / 3;
      suma += d;
      if (d > peor) peor = d;
      n += 1;
    }
  }
  return { nombre, media: Number((suma / n).toFixed(2)), peor: Number(peor.toFixed(1)) };
};

const DEBE_MOVERSE = [
  zona("ala izquierda", 655, 332, 682, 353),
  zona("ala derecha", 728, 332, 755, 353),
  zona("pared lateral", 676, 310, 734, 330)
];

const DEBE_ESTAR_QUIETO = [
  zona("dorso", 690, 276, 720, 302),
  zona("labio superior", 660, 362, 750, 384),
  zona("mejilla izquierda", 592, 328, 638, 374),
  zona("mejilla derecha", 772, 328, 818, 374),
  zona("surco nasolabial", 628, 356, 666, 402),
  zona("ojo izquierdo", 584, 229, 660, 267)
];

const linea = z => `  ${z.nombre.padEnd(20)} media ${String(z.media).padStart(6)}   máx ${String(z.peor).padStart(6)}`;

console.log("Se mueve (esperado):");
DEBE_MOVERSE.forEach(z => console.log(linea(z)));
console.log("\nQuieto (esperado):");
DEBE_ESTAR_QUIETO.forEach(z => console.log(linea(z)));

// Umbrales. El movimiento del ala es de 1,6 px sobre un borde de contraste
// medio, así que una media de 1 basta para confirmar que ocurre algo; lo que
// importa de verdad es el techo de las zonas que no deben moverse.
const problemas = [];
for (const z of DEBE_MOVERSE) {
  if (z.media < 0.8) problemas.push(`${z.nombre} apenas se mueve (${z.media})`);
}
for (const z of DEBE_ESTAR_QUIETO) {
  if (z.media > 0.6) problemas.push(`${z.nombre} se mueve de más (${z.media})`);
}

// El borde del parche no debe verse. Si el difuminado falla, aparece una
// costura recta justo en el límite del rectángulo recompuesto.
const columnaDif = x => {
  let suma = 0;
  for (let y = 268; y < 364; y += 1) {
    const i = (y * W + x) * 4;
    suma += Math.abs(reposo[i] - maxima[i]);
  }
  return suma / 96;
};
const costura = Math.max(columnaDif(634), columnaDif(635), columnaDif(774), columnaDif(775));
console.log(`\nBorde del parche (costura): ${costura.toFixed(2)}`);
if (costura > 0.5) problemas.push(`se ve el borde del parche (${costura.toFixed(2)})`);

// ── Excursión real del ala ───────────────────────────────────────────────────
//
// Lo anterior dice que algo se mueve; esto dice cuánto. Buscar «el borde» como
// el gradiente más fuerte de una ventana no sirve: en varias filas el pico más
// alto es otro detalle del retrato que no se mueve, y la medición sale absurda.
// En su lugar se desliza el trozo en reposo sobre el trozo inspirado y se mira
// qué desplazamiento los hace coincidir mejor, con interpolación parabólica
// sobre el pico de correlación para leer fracciones de píxel.
//
// La escala del retrato: el ala mide unos 76 px de lado a lado para una nariz
// de ~40 mm, o sea ~0,53 mm por píxel.
const MM_POR_PIXEL = 40 / 76;

const desplazamiento = (fila, x0, x1) => {
  const lum = (datos, x) => {
    const i = (fila * W + x) * 4;
    return (datos[i] + datos[i + 1] + datos[i + 2]) / 3;
  };
  // Diferencia cuadrática para cada desplazamiento entero, y su vecindario.
  const error = d => {
    let suma = 0, n = 0;
    for (let x = x0; x < x1; x += 1) {
      const origen = x - d;
      if (origen < 1 || origen >= W - 1) continue;
      const e = lum(maxima, x) - lum(reposo, origen);
      suma += e * e; n += 1;
    }
    return n ? suma / n : Infinity;
  };

  // Sin textura la correlación es plana y devuelve cero sin avisar, que se lee
  // igual que «no se mueve». Se mide el contraste del trozo para poder
  // distinguir un cero real de un cero por falta de información.
  let media = 0, n = 0;
  for (let x = x0; x < x1; x += 1) { media += lum(reposo, x); n += 1; }
  media /= n;
  let varianza = 0;
  for (let x = x0; x < x1; x += 1) varianza += (lum(reposo, x) - media) ** 2;
  const contraste = Math.sqrt(varianza / n);

  let mejor = 0, minimo = Infinity;
  for (let d = -6; d <= 6; d += 1) {
    const e = error(d);
    if (e < minimo) { minimo = e; mejor = d; }
  }
  // Sin textura no hay nada que correlacionar y el resultado sería ruido.
  if (!Number.isFinite(minimo)) return null;
  const a = error(mejor - 1), b = error(mejor), c = error(mejor + 1);
  const den = a - 2 * b + c;
  const ajuste = den !== 0 ? .5 * (a - c) / den : 0;
  return { px: mejor + (Math.abs(ajuste) <= 1 ? ajuste : 0), contraste };
};

console.log("\nExcursión del ala (correlación):");
let excursionMax = 0;
for (const fila of [330, 336, 341, 346, 350]) {
  const izq = desplazamiento(fila, 659, 676);
  const der = desplazamiento(fila, 734, 751);
  if (izq === null || der === null) continue;
  // Por debajo de este contraste el trozo es casi plano y su cero no significa
  // nada; se enseña, pero no cuenta para el máximo.
  const fiable = Math.min(izq.contraste, der.contraste) >= 4;
  if (fiable) excursionMax = Math.max(excursionMax, Math.abs(izq.px), Math.abs(der.px));
  const uno = v => `${v.px >= 0 ? "+" : ""}${v.px.toFixed(2)} px (${(Math.abs(v.px) * MM_POR_PIXEL).toFixed(2)} mm)`;
  console.log(`  y=${fila}   izq ${uno(izq)}   der ${uno(der)}   contraste ${izq.contraste.toFixed(1)}/${der.contraste.toFixed(1)}${fiable ? "" : "  ← sin textura, no concluyente"}`);
}

// El dorso es el ancla: si también se desplaza, se mueve la nariz entera y el
// efecto deja de leerse como ventilación.
const dorso = desplazamiento(290, 686, 724);
console.log(`  dorso y=290: ${dorso.px.toFixed(2)} px   contraste ${dorso.contraste.toFixed(1)}`);

console.log(`\n  máxima excursión alar: ${excursionMax.toFixed(2)} px = ${(excursionMax * MM_POR_PIXEL).toFixed(2)} mm`);
// Por encima de ~1,5 mm de excursión alar deja de ser ventilación tranquila y
// se lee como aleteo nasal, que es un signo clínico de trabajo respiratorio.
if (excursionMax * MM_POR_PIXEL > 1.5) {
  problemas.push(`excursión alar de aleteo, no basal (${(excursionMax * MM_POR_PIXEL).toFixed(2)} mm)`);
}
if (dorso.contraste >= 4 && Math.abs(dorso.px) > 0.3) {
  problemas.push(`el dorso se desplaza (${dorso.px.toFixed(2)} px); debería ser el ancla`);
}

console.log(problemas.length ? `\nPROBLEMAS:\n  ${problemas.join("\n  ")}` : "\nSin problemas.");
if (problemas.length) process.exitCode = 1;
