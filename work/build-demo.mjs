// Empaqueta el banco de pruebas en una sola página autónoma, para abrirlo sin
// servidor (doble clic) o mandarlo por correo.
//
// La fuente es public/banco.html, el mismo banco que sirve la aplicación. Aquí
// sólo se sustituyen los import por el código de los módulos y la ruta de la
// imagen por sus bytes: así el autónomo nunca se queda atrás respecto del que
// se usa a diario.
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "/Users/intiparedes/Documents/Codex/2026-08-17/CATALINA";
const FUENTE = `${ROOT}/public/banco.html`;

// El orden importa: cada módulo debe ir después de aquellos de los que depende,
// porque al concatenar se pierde la resolución de import.
const ORDEN = [
  "public/animation/math.js",
  "public/animation/tuning.js",
  "public/render/rig.js",
  "public/render/surface.js",
  "public/render/mouth-layer.js",
  "public/render/eyes-layer.js",
  "public/render/brow-layer.js",
  "public/render/face-renderer.js",
  "public/animation/director.js"
];

const limpiar = texto => texto
  .replace(/^import\s+[\s\S]*?from\s+"[^"]+";[ \t]*$/gm, "")
  .replace(/^export\s+/gm, "");

const bundle = ORDEN
  .map(ruta => `\n/* ===== ${ruta} ===== */\n` + limpiar(readFileSync(`${ROOT}/${ruta}`, "utf8")))
  .join("\n");

const imagen = readFileSync(`${ROOT}/public/assets/catalina.png`).toString("base64");

let salida = readFileSync(FUENTE, "utf8");

// El bloque de módulo de la página pasa a ser un script clásico con todo dentro.
const apertura = /<script type="module">\n(?:import .*\n)+/;
if (!apertura.test(salida)) throw new Error("no se encontró el bloque <script type=\"module\"> con sus import");
salida = salida.replace(apertura, () => "<script>\n" + bundle + "\n");

const ruta = 'imagen.src = "assets/catalina.png";';
if (!salida.includes(ruta)) throw new Error("no se encontró la ruta de la imagen");
salida = salida.replace(ruta, () => `imagen.src = "data:image/png;base64,${imagen}";`);

const destino = process.argv[2] ?? `${ROOT}/work/banco-de-pruebas.html`;
writeFileSync(destino, salida);
console.log("escrito", destino, (salida.length / 1024 / 1024).toFixed(2), "MB");
