// Prueba de humo del rostro completo, sin navegador.
//
//   node work/smoke.mjs
//
// Recorre los cuatro estados de la conversación con una voz sintética y dibuja
// varios cientos de cuadros. No comprueba estética: comprueba que el director y
// el renderizador no se rompan con cualquier combinación de valores, incluidos
// los extremos que produce un pico de energía o un cambio de turno brusco.

import { createCanvas, loadImage } from "/Users/intiparedes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js";
import { FaceRenderer } from "../public/render/face-renderer.js";
import { PerformanceDirector } from "../public/animation/director.js";

const surface = (width, height) => createCanvas(width, height);
const FRAMES = 900;
const STATES = ["idle", "listening", "thinking", "speaking"];

const image = await loadImage(new URL("../public/assets/catalina.png", import.meta.url).pathname);
const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext("2d");
const viewport = { width: 1280, height: 720, pixelRatio: 2 };
const renderer = new FaceRenderer(image, surface);
const director = new PerformanceDirector();

let now = 0;
const started = Date.now();
for (let frame = 0; frame < FRAMES; frame += 1) {
  now += 16.67;
  if (frame % 90 === 0) director.setState(STATES[(frame / 90) % STATES.length]);

  const speaking = director.state === "speaking";
  const t = now / 1000;
  const voice = speaking
    ? {
        active: true,
        energy: Math.abs(Math.sin(t * 4.3)) * .9,
        open: Math.abs(Math.sin(t * 5.1)) ** 1.4,
        spread: .5 + Math.sin(t * 2.7) * .35,
        round: Math.max(0, Math.sin(t * 1.9)) * .9,
        press: Math.max(0, Math.sin(t * 7.3) - .8) * 5
      }
    : null;

  const pose = director.update(now, voice);
  assertFinite(pose, frame);
  renderer.draw(ctx, viewport, pose);
}

console.log(`${FRAMES} cuadros dibujados sin errores en ${Date.now() - started} ms`);

function assertFinite(value, frame, path = "pose") {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} no es finito en el cuadro ${frame}`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) assertFinite(entry, frame, `${path}.${key}`);
  }
}
