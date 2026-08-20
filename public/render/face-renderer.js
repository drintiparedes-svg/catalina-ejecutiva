// Composición del cuadro completo.
//
// Orden de dibujo: cuerpo (con respiración) → mitad inferior del rostro y boca
// → mirada y parpadeo → cejas → aura. Todo ocurre dentro de la transformación
// de la cabeza, para que el gesto acompañe al giro en lugar de flotar sobre él.

import { IMAGE, HEAD_PIVOT } from "./rig.js";
import { MouthLayer } from "./mouth-layer.js";
import { NoseLayer } from "./nose-layer.js";
import { EyesLayer } from "./eyes-layer.js";
import { BrowLayer } from "./brow-layer.js";
import { createSurface } from "./surface.js";

export class FaceRenderer {
  constructor(image, createSurfaceImpl = createSurface) {
    this.image = image;
    this.mouth = new MouthLayer(createSurfaceImpl);
    this.nose = new NoseLayer(createSurfaceImpl);
    this.eyes = new EyesLayer();
    this.brows = new BrowLayer(createSurfaceImpl);
  }

  layout(width, height, breathScale) {
    const scale = Math.max(width / IMAGE.width, height / IMAGE.height);
    const dw = IMAGE.width * scale;
    const dh = IMAGE.height * scale;
    return {
      scale: scale * breathScale,
      width: dw * breathScale,
      height: dh * breathScale,
      baseWidth: dw,
      baseHeight: dh,
      offsetX: (width - dw) / 2,
      offsetY: (height - dh) / 2
    };
  }

  draw(ctx, viewport, pose) {
    const { width, height, pixelRatio } = viewport;
    ctx.clearRect(0, 0, width, height);

    const breathScale = 1 + pose.breath.expand;
    const box = this.layout(width, height, breathScale);
    // Los desplazamientos llegan en píxeles de la imagen original, así que se
    // escalan con la vista: el gesto se ve igual en cualquier resolución.
    const dx = box.offsetX + pose.body.x * box.scale - (box.width - box.baseWidth) / 2;
    const dy = box.offsetY + (pose.body.y + pose.breath.lift) * box.scale
      - (box.height - box.baseHeight) * .28;
    const view = { dx, dy, scale: box.scale, pixelRatio };

    const pivotX = dx + HEAD_PIVOT.x * box.scale;
    const pivotY = dy + HEAD_PIVOT.y * box.scale;

    ctx.save();
    ctx.translate(pivotX + pose.head.x * box.scale, pivotY + pose.head.y * box.scale);
    ctx.rotate(pose.head.tilt);
    ctx.translate(-pivotX, -pivotY);

    ctx.drawImage(this.image, dx, dy, box.width, box.height);
    this.mouth.draw(ctx, this.image, view, pose.mouth);
    // Después de la boca: el parche de la boca empieza en y=324 y vuelve a
    // estampar la zona de la base de la nariz, así que dibujarla antes la
    // borraría.
    this.nose.draw(ctx, this.image, view, pose.breath.nasal);
    this.eyes.draw(ctx, this.image, view, pose.eyes);
    this.brows.draw(ctx, this.image, view, pose.brows);
    ctx.restore();

    if (pose.aura > 0) this.#drawAura(ctx, width, height, pose.aura);
  }

  #drawAura(ctx, width, height, level) {
    const gradient = ctx.createRadialGradient(
      width / 2, height * .5, height * .18,
      width / 2, height * .5, height * .7
    );
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(.55, `rgba(93,205,255,${level})`);
    gradient.addColorStop(1, "transparent");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}
