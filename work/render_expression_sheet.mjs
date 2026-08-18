// Hoja de expresiones, sin navegador.
//
//   node work/render_expression_sheet.mjs work/expresiones.png
//
// Dibuja el repertorio completo con el director real: cada panel deja que la
// expresión se asiente durante medio segundo, igual que en pantalla.

import { createCanvas, loadImage } from "/Users/intiparedes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js";
import { writeFileSync } from "node:fs";
import { FaceRenderer } from "../public/render/face-renderer.js";
import { PerformanceDirector } from "../public/animation/director.js";

const EXPRESIONES = [
  ["neutra", "Neutra"],
  ["alegria", "Alegría"],
  ["sorpresa", "Sorpresa"],
  ["preocupacion", "Preocupación"],
  ["enfado", "Enfado"],
  ["concentracion", "Concentración"]
];

const CROP = { x: 552, y: 158, width: 306, height: 286 };
const SCALE = 2.0;
const COLUMNAS = 3;

const surface = (w, h) => createCanvas(w, h);
const image = await loadImage(new URL("../public/assets/catalina.png", import.meta.url).pathname);

const panelW = Math.round(CROP.width * SCALE);
const panelH = Math.round(CROP.height * SCALE);
const filas = Math.ceil(EXPRESIONES.length / COLUMNAS);
const canvas = createCanvas(panelW * COLUMNAS, (panelH + 34) * filas);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#04080d";
ctx.fillRect(0, 0, canvas.width, canvas.height);

const renderer = new FaceRenderer(image, surface);

for (const [indice, [clave, etiqueta]] of EXPRESIONES.entries()) {
  const director = new PerformanceDirector();
  director.setState("listening");
  director.setExpression(clave);

  // Asentamiento sin parpadeos, para que el gesto se vea limpio. El entornado
  // de la expresión lo aplica el propio director; aquí sólo se silencia el
  // parpadeo, que si no taparía la mitad de los paneles.
  let now = 0;
  let pose = null;
  for (let cuadro = 0; cuadro < 60; cuadro += 1) {
    now += 16.7;
    director.blinkAt = -1;
    director.nextBlinkAt = now / 1000 + 999;
    pose = director.update(now, null);
  }
  pose.head.x = 0; pose.head.y = 0; pose.head.tilt = 0;
  pose.eyes.gaze.x = 0; pose.eyes.gaze.y = 0;

  const panelX = (indice % COLUMNAS) * panelW;
  const panelY = Math.floor(indice / COLUMNAS) * (panelH + 34);
  ctx.save();
  ctx.beginPath();
  ctx.rect(panelX, panelY + 30, panelW, panelH);
  ctx.clip();
  const off = { dx: panelX - CROP.x * SCALE, dy: panelY + 30 - CROP.y * SCALE };
  dibujarPanel(ctx, renderer, pose, off, SCALE);
  ctx.restore();

  ctx.fillStyle = "#8fdcff";
  ctx.font = "600 19px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(etiqueta, panelX + panelW / 2, panelY + 22);
  ctx.strokeStyle = "rgba(120,190,230,.22)";
  ctx.strokeRect(panelX + .5, panelY + 30.5, panelW - 1, panelH - 1);
}

writeFileSync(process.argv[2] ?? "work/expresiones.png", canvas.toBuffer("image/png"));
console.log("Hoja de expresiones escrita");

function dibujarPanel(ctx, renderer, pose, off, escala) {
  const vista = { width: 1408 * escala, height: 768 * escala, pixelRatio: 1 };
  ctx.save();
  ctx.translate(off.dx, off.dy);
  renderer.draw(ctx, vista, pose);
  ctx.restore();
}
