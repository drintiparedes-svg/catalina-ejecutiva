// Empaqueta los módulos reales del avatar en una sola página autónoma.
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "/Users/intiparedes/Documents/Codex/2026-08-17/CATALINA";
const ORDEN = [
  "public/animation/math.js",
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

const plantilla = readFileSync(process.argv[2], "utf8");
const salida = plantilla
  .replace("/*__BUNDLE__*/", () => bundle)
  .replace("__IMAGE__", () => `data:image/png;base64,${imagen}`);

writeFileSync(process.argv[3], salida);
console.log("escrito", process.argv[3], (salida.length / 1024 / 1024).toFixed(2), "MB");
