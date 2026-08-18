// Hoja de contactos de la boca, sin navegador.
//
// Ejecuta las mismas clases de public/render sobre @napi-rs/canvas para poder
// revisar cada postura cuadro a cuadro:
//
//   node work/render_contact_sheet.mjs work/viseme-contact-sheet.png
//
// Es la forma rápida de comprobar que la cavidad queda entre los labios, que la
// mandíbula no deja bordes y que ninguna columna se rompe.

import { createCanvas, loadImage } from "/Users/intiparedes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js";
import { writeFileSync } from "node:fs";
import { MouthLayer } from "../public/render/mouth-layer.js";
import { BrowLayer } from "../public/render/brow-layer.js";
import { EyesLayer } from "../public/render/eyes-layer.js";
import { blinkCurve } from "../public/render/eyes-layer.js";

const surface = (width, height) => createCanvas(width, height);

// Posturas representativas: reposo, cierre bilabial, vocales abiertas y
// cerradas, sibilante y sonrisa ancha.
const POSES = {
  "reposo":        { open: 0,   spread: .50, round: .12, press: 0,   jaw: 0 },
  "m / p / b":     { open: .02, spread: .52, round: .06, press: .85, jaw: .04 },
  "a":             { open: .95, spread: .58, round: .03, press: 0,   jaw: .92 },
  "e":             { open: .55, spread: .70, round: .02, press: 0,   jaw: .50 },
  "i":             { open: .26, spread: .86, round: .01, press: 0,   jaw: .22 },
  "o":             { open: .58, spread: .32, round: .62, press: 0,   jaw: .55 },
  "u":             { open: .24, spread: .18, round: .92, press: 0,   jaw: .20 },
  "s":             { open: .13, spread: .76, round: .03, press: 0,   jaw: .10 },
  "ch / sh":       { open: .22, spread: .40, round: .45, press: 0,   jaw: .18 },
  "f / v":         { open: .14, spread: .60, round: .05, press: .25, jaw: .10 },
  "a media":       { open: .55, spread: .56, round: .05, press: 0,   jaw: .48 },
  "parpadeo":      { open: .40, spread: .60, round: .05, press: 0,   jaw: .36, blink: .55 }
};

const CROP = { x: 528, y: 168, width: 354, height: 400 };
const SCALE = 1.25;

async function main() {
  const output = process.argv[2] ?? "work/viseme-contact-sheet.png";
  const image = await loadImage(new URL("../public/assets/catalina.png", import.meta.url).pathname);

  const labels = Object.keys(POSES);
  const columns = 4;
  const rows = Math.ceil(labels.length / columns);
  const panelWidth = Math.round(CROP.width * SCALE);
  const panelHeight = Math.round(CROP.height * SCALE);
  const canvas = createCanvas(panelWidth * columns, panelHeight * rows);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#02070d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const mouth = new MouthLayer(surface);
  const brows = new BrowLayer(surface);
  const eyes = new EyesLayer();

  labels.forEach((label, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const panelX = column * panelWidth;
    const panelY = row * panelHeight;
    const pose = POSES[label];

    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX, panelY, panelWidth, panelHeight);
    ctx.clip();

    // Vista equivalente a la del navegador: la imagen completa desplazada para
    // que el recorte caiga sobre el panel.
    const view = {
      dx: panelX - CROP.x * SCALE,
      dy: panelY - CROP.y * SCALE,
      scale: SCALE,
      pixelRatio: 2
    };
    ctx.drawImage(
      image,
      view.dx, view.dy,
      image.width * SCALE, image.height * SCALE
    );
    mouth.draw(ctx, image, view, pose);
    const close = pose.blink ? blinkCurve(pose.blink) : 0;
    eyes.draw(ctx, image, view, { left: close, right: close, gaze: { x: 1.6, y: -.4 } });
    brows.draw(ctx, image, view, [
      { raise: pose.open * .6, tilt: 0 },
      { raise: pose.open * .5, tilt: 0 }
    ]);

    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(panelX, panelY, panelWidth, 26);
    ctx.fillStyle = "#cfefff";
    ctx.font = "16px sans-serif";
    ctx.fillText(label, panelX + 10, panelY + 18);
    ctx.strokeStyle = "rgba(120,180,220,.25)";
    ctx.strokeRect(panelX + .5, panelY + .5, panelWidth - 1, panelHeight - 1);
    ctx.restore();
  });

  writeFileSync(output, canvas.toBuffer("image/png"));
  console.log(`Hoja de contactos escrita en ${output}`);
}

main();
