// Composición del cuadro completo.
//
// El retrato se dibuja quieto y encima se mueve sólo lo que en una persona se
// mueve: la melena con la brisa, la cabeza sobre el cuello, y el gesto dentro
// de la cara. El busto no se desplaza ni un píxel —antes respiraba y se
// balanceaba entero, y era justo eso lo que se leía como movimiento falso—.
//
// Orden de dibujo: fotografía inmóvil → banda de cabeza y cuello → las dos
// melenas → mitad inferior del rostro y boca → nariz → mirada y parpadeo →
// cejas → aura. Las capas del gesto van dentro de la transformación de cabeza,
// para que acompañen al giro en lugar de flotar sobre él. La nariz va después
// de la boca porque el parche de la boca vuelve a estampar la base de la nariz,
// y dibujarla antes la borraría.

import { IMAGE, HEAD_PIVOT } from "./rig.js";
import { HeadLayer } from "./head-layer.js";
import { HairLayer } from "./hair-layer.js";
import { MouthLayer } from "./mouth-layer.js";
import { NoseLayer } from "./nose-layer.js";
import { EyesLayer } from "./eyes-layer.js";
import { BrowLayer } from "./brow-layer.js";
import { createSurface } from "./surface.js";

export class FaceRenderer {
  constructor(image, createSurfaceImpl = createSurface) {
    this.image = image;
    this.head = new HeadLayer();
    this.hair = new HairLayer();
    this.mouth = new MouthLayer(createSurfaceImpl);
    this.nose = new NoseLayer(createSurfaceImpl);
    this.eyes = new EyesLayer();
    this.brows = new BrowLayer(createSurfaceImpl);
  }

  layout(width, height) {
    const scale = Math.max(width / IMAGE.width, height / IMAGE.height);
    const dw = IMAGE.width * scale;
    const dh = IMAGE.height * scale;
    return {
      scale,
      width: dw,
      height: dh,
      offsetX: (width - dw) / 2,
      offsetY: (height - dh) / 2
    };
  }

  draw(ctx, viewport, pose) {
    const { width, height, pixelRatio } = viewport;
    ctx.clearRect(0, 0, width, height);

    const box = this.layout(width, height);
    // Los desplazamientos llegan en píxeles de la imagen original, así que se
    // escalan con la vista: el gesto se ve igual en cualquier resolución.
    const view = { dx: box.offsetX, dy: box.offsetY, scale: box.scale, pixelRatio };

    ctx.drawImage(this.image, view.dx, view.dy, box.width, box.height);
    this.head.draw(ctx, this.image, view, pose.head);
    this.hair.draw(ctx, this.image, view, pose.hair, pose.head);

    const pivotX = view.dx + HEAD_PIVOT.x * box.scale;
    const pivotY = view.dy + HEAD_PIVOT.y * box.scale;

    ctx.save();
    ctx.translate(pivotX + pose.head.x * box.scale, pivotY + pose.head.y * box.scale);
    ctx.rotate(pose.head.tilt);
    ctx.translate(-pivotX, -pivotY);

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
