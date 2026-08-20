// Medición de la brisa en la cabellera, sin navegador.
//
//   node work/medir_pelo.mjs
//
// Comprueba lo que no se puede juzgar mirando una imagen quieta:
//
//   · que el pelo se mueve, y más cuanto más abajo;
//   · que la cara y el cuerpo no se mueven nada;
//   · que la onda viaja hacia abajo en vez de bascular en bloque, que es la
//     diferencia entre una brisa y un limpiaparabrisas;
//   · que las franjas en que se trocea el mechón no se ven como escalones.

import { createCanvas, loadImage } from "/Users/intiparedes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js";
import { FaceRenderer } from "../public/render/face-renderer.js";
import { HAIR } from "../public/render/rig.js";
import { TUNING } from "../public/animation/tuning.js";

const W = 1408;
const H = 768;

const image = await loadImage(new URL("../public/assets/catalina.png", import.meta.url).pathname);
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const renderer = new FaceRenderer(image, (w, h) => createCanvas(w, h));
const viewport = { width: W, height: H, pixelRatio: 1 };

const pose = (tiempo, intensidad = 1) => ({
  body: { x: 0, y: 0 },
  head: { x: 0, y: 0, tilt: 0 },
  breath: { expand: 0, lift: 0, nasal: 0 },
  hair: { tiempo, intensidad },
  eyes: { left: 0, right: 0, gaze: { x: 0, y: 0 } },
  brows: [{ raise: 0, tilt: 0 }, { raise: 0, tilt: 0 }],
  mouth: { open: 0, spread: .5, round: .12, press: 0, jaw: 0, curl: 0 },
  aura: 0
});

const capturar = (tiempo, intensidad = 1) => {
  ctx.clearRect(0, 0, W, H);
  renderer.draw(ctx, viewport, pose(tiempo, intensidad));
  return ctx.getImageData(0, 0, W, H).data;
};

// El cuadro sin brisa es la referencia: contra él se mide todo.
const quieto = capturar(0, 0);

const problemas = [];

// ── Desplazamiento por correlación ───────────────────────────────────────────
//
// Se desliza el trozo quieto sobre el trozo con brisa y se busca qué corrimiento
// los hace coincidir. La ventana se toma estrecha a propósito: dentro de una
// ancha el campo varía y un solo número no lo representa.
const desplazamiento = (movido, fila, x0, x1) => {
  const lum = (datos, x) => {
    const i = (fila * W + x) * 4;
    return (datos[i] + datos[i + 1] + datos[i + 2]) / 3;
  };
  const error = d => {
    let suma = 0, n = 0;
    for (let x = x0; x < x1; x += 1) {
      const origen = x - d;
      if (origen < 1 || origen >= W - 1) continue;
      const e = lum(movido, x) - lum(quieto, origen);
      suma += e * e; n += 1;
    }
    return n ? suma / n : Infinity;
  };
  // Sin textura la correlación es plana y devuelve cero sin avisar, que se lee
  // igual que «no se mueve».
  let media = 0, n = 0;
  for (let x = x0; x < x1; x += 1) { media += lum(quieto, x); n += 1; }
  media /= n;
  let varianza = 0;
  for (let x = x0; x < x1; x += 1) varianza += (lum(quieto, x) - media) ** 2;
  const contraste = Math.sqrt(varianza / n);

  let mejor = 0, minimo = Infinity;
  const tope = Math.ceil(TUNING.brisaAmplitud) + 4;
  for (let d = -tope; d <= tope; d += 1) {
    const e = error(d);
    if (e < minimo) { minimo = e; mejor = d; }
  }
  const a = error(mejor - 1), b = error(mejor), c = error(mejor + 1);
  const den = a - 2 * b + c;
  const ajuste = den !== 0 ? .5 * (a - c) / den : 0;
  return { px: mejor + (Math.abs(ajuste) <= 1 ? ajuste : 0), contraste };
};

// Ventanas dentro de la masa de pelo, medidas sobre el retrato.
const VENTANAS = {
  izquierdo: [300, 360],
  derecho: [1010, 1070]
};

const INSTANTES = [1.2, 3.4, 6.1, 9.7];

console.log("Desplazamiento del pelo por altura (px de la imagen)\n");
console.log("  instante   altura   izquierdo   derecho     contraste");
let maximo = 0;
const porAltura = new Map();
for (const t of INSTANTES) {
  const movido = capturar(t);
  for (const y of [560, 610, 660, 710, 755]) {
    const i = desplazamiento(movido, y, ...VENTANAS.izquierdo);
    const d = desplazamiento(movido, y, ...VENTANAS.derecho);
    maximo = Math.max(maximo, Math.abs(i.px), Math.abs(d.px));
    const clave = y;
    porAltura.set(clave, (porAltura.get(clave) ?? 0) + Math.abs(i.px) + Math.abs(d.px));
    console.log(`   ${t.toFixed(1).padStart(5)} s    y=${y}   ${i.px.toFixed(2).padStart(7)}   ${d.px.toFixed(2).padStart(7)}     ${i.contraste.toFixed(0)}/${d.contraste.toFixed(0)}`);
  }
  console.log("");
}

console.log(`Recorrido máximo observado: ${maximo.toFixed(2)} px  (amplitud configurada: ${TUNING.brisaAmplitud})`);

// La punta tiene que moverse más que la raíz. Si no, la amplitud no crece con
// la profundidad y el mechón se mueve como una tabla.
const arriba = porAltura.get(560);
const abajo = porAltura.get(755);
console.log(`Punta frente a raíz: ${(abajo / Math.max(arriba, .001)).toFixed(1)}× más recorrido abajo`);
if (abajo <= arriba * 2) {
  problemas.push(`la punta apenas se mueve más que la raíz (${(abajo / Math.max(arriba, .001)).toFixed(1)}×)`);
}

// ── Los dos mechones no van sincronizados ────────────────────────────────────
//
// Con el mismo ruido se moverían en espejo, y el aire no hace eso.
{
  // Con diez muestras y sin restar la media, una correlación sale casi de
  // cualquier cosa: la primera versión de esta comprobación daba -0,85 sobre
  // dos señales que en realidad son independientes.
  const izq = [], der = [];
  for (let t = 0; t < 24; t += .8) {
    const m = capturar(t);
    izq.push(desplazamiento(m, 740, ...VENTANAS.izquierdo).px);
    der.push(desplazamiento(m, 740, ...VENTANAS.derecho).px);
  }
  const media = a => a.reduce((s, v) => s + v, 0) / a.length;
  const mi = media(izq), md = media(der);
  let n = 0, di = 0, dd = 0;
  for (let k = 0; k < izq.length; k += 1) {
    const x = izq[k] - mi, y = der[k] - md;
    n += x * y; di += x * x; dd += y * y;
  }
  const correlacion = n / Math.sqrt(Math.max(di * dd, 1e-9));
  console.log(`\nCorrelación entre los dos mechones: ${correlacion.toFixed(2)} sobre ${izq.length} muestras`);
  console.log(`  (0 = independientes, ±1 = calcados; el aire no mueve los dos igual)`);
  if (Math.abs(correlacion) > .75) problemas.push(`los dos mechones van casi calcados (${correlacion.toFixed(2)})`);
}

// ── Lo que no se puede mover ─────────────────────────────────────────────────
const zona = (movido, nombre, x0, y0, x1, y1) => {
  let suma = 0, peor = 0, n = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const i = (y * W + x) * 4;
    const d = Math.abs(quieto[i] - movido[i]);
    suma += d; if (d > peor) peor = d; n += 1;
  }
  return { nombre, media: Number((suma / n).toFixed(2)), peor };
};

console.log("\nZonas que deben quedarse quietas:");
const movido = capturar(6.1);
const QUIETAS = [
  zona(movido, "cara", 560, 200, 850, 420),
  zona(movido, "boca", 620, 380, 790, 470),
  zona(movido, "cuerpo (centro)", 660, 560, 850, 768),
  zona(movido, "pelo alto (sobre el hombro)", 300, 300, 500, 500),
  zona(movido, "destello decorativo", 1300, 660, 1400, 740)
];
for (const z of QUIETAS) {
  console.log(`  ${z.nombre.padEnd(30)} media ${String(z.media).padStart(6)}   peor ${z.peor}`);
  if (z.media > 0.5) problemas.push(`${z.nombre} se mueve (${z.media})`);
}

// ── Costura en el borde superior del parche ──────────────────────────────────
//
// El parche empieza más abajo que el anclaje, así que en su primera fila el
// campo ya no vale exactamente cero. Aquí se comprueba que ese salto sea
// inferior al píxel, que es lo que lo hace invisible.
{
  const fila = y => {
    let suma = 0, n = 0;
    for (const m of HAIR.mechones) {
      for (let x = m.patch.x; x < m.patch.x + m.patch.width; x += 1) {
        const i = (y * W + x) * 4;
        suma += Math.abs(quieto[i] - movido[i]); n += 1;
      }
    }
    return suma / n;
  };
  const dentro = fila(HAIR.mechones[0].patch.y + 1);
  const fuera = fila(HAIR.mechones[0].patch.y - 2);
  console.log(`\nBorde superior del parche (y=${HAIR.mechones[0].patch.y}):`);
  console.log(`  justo encima ${fuera.toFixed(2)}   justo debajo ${dentro.toFixed(2)}   salto ${(dentro - fuera).toFixed(2)}`);
  if (dentro - fuera > 2) problemas.push(`se ve el borde superior del parche (salto ${(dentro - fuera).toFixed(2)})`);
}

// ── Escalones entre franjas ──────────────────────────────────────────────────
//
// El mechón se trocea en franjas horizontales. Si cada una se desplazara en
// bloque, en sus fronteras quedaría un escalón; por eso van inclinadas, de modo
// que el borde inferior de una case con el superior de la siguiente. Aquí se
// compara la discontinuidad vertical en las fronteras con la de una fila
// cualquiera: si la primera destaca, las franjas se ven.
{
  const discontinuidad = datos => {
    const out = new Map();
    for (let y = 542; y < 766; y += 1) {
      let suma = 0, n = 0;
      for (let x = 240; x < 560; x += 1) {
        const a = (y * W + x) * 4, b = ((y - 1) * W + x) * 4;
        suma += Math.abs(datos[a] - datos[b]); n += 1;
      }
      out.set(y, suma / n);
    }
    return out;
  };
  const base = discontinuidad(quieto);
  const conBrisa = discontinuidad(movido);
  const fronteras = new Set();
  for (let y = HAIR.anclaY; y < 768; y += 18) { fronteras.add(y); fronteras.add(y + 1); }

  let peorFrontera = 0, peorOtra = 0, donde = 0;
  for (const [y, v] of conBrisa) {
    const exceso = v - base.get(y);
    if (fronteras.has(y)) {
      if (exceso > peorFrontera) { peorFrontera = exceso; donde = y; }
    } else if (exceso > peorOtra) peorOtra = exceso;
  }
  console.log(`\nEscalones entre franjas:`);
  console.log(`  en las fronteras ${peorFrontera.toFixed(2)} (peor en y=${donde})   en filas cualesquiera ${peorOtra.toFixed(2)}`);
  if (peorFrontera > peorOtra * 3 + .2) {
    problemas.push(`las franjas se ven (${peorFrontera.toFixed(2)} frente a ${peorOtra.toFixed(2)})`);
  }
}

console.log(problemas.length ? `\nPROBLEMAS:\n  ${problemas.join("\n  ")}` : "\nSin problemas.");
if (problemas.length) process.exitCode = 1;
