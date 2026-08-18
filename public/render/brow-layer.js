// Cejas.
//
// Un micro-levantamiento de dos píxeles en las sílabas acentuadas es lo que
// separa una cara que habla de una cara que mueve la boca. El recorrido es
// deliberadamente pequeño: la ceja se desplaza con la piel de la frente y la
// máscara suave impide que aparezca el contorno del parche.

import { clamp, smoothstep } from "../animation/math.js";
import { BROWS } from "./rig.js";
import { Surface, createSurface } from "./surface.js";

const BROW_TRAVEL = 3.4;   // píxeles de imagen a levantamiento pleno
const PADDING = 14;

export class BrowLayer {
  constructor(createSurfaceImpl = createSurface) {
    this.surfaces = BROWS.map(() => new Surface(createSurfaceImpl));
  }

  draw(ctx, image, view, cejas) {
    for (const [index, brow] of BROWS.entries()) {
      const gesto = cejas[index] ?? { raise: 0, tilt: 0 };
      if (Math.abs(gesto.raise) < .03 && Math.abs(gesto.tilt) < .03) continue;
      this.#drawBrow(ctx, image, view, brow, gesto, this.surfaces[index]);
    }
  }

  #drawBrow(ctx, image, view, brow, gesto, surface) {
    const { scale, pixelRatio } = view;
    const boxX = brow.left - PADDING;
    const boxY = brow.breaks[0] - PADDING;
    const boxW = brow.right - brow.left + PADDING * 2;
    const boxH = brow.breaks[brow.breaks.length - 1] - brow.breaks[0] + PADDING * 2;
    const cssWidth = boxW * scale;
    const cssHeight = boxH * scale;
    const layer = surface.acquire(cssWidth, cssHeight, pixelRatio);
    const lx = x => (x - boxX) * scale;
    const ly = y => (y - boxY) * scale;

    layer.drawImage(image, boxX, boxY, boxW, boxH, 0, 0, cssWidth, cssHeight);

    const halfSpan = (brow.right - brow.left) / 2;
    const travel = (x, y) => {
      const across = clamp(Math.abs(x - brow.centerX) / halfSpan, 0, 1);
      // El desplazamiento debe extinguirse antes del borde del parche: donde la
      // máscara empieza a desvanecerse, el contenido tiene que ser idéntico al
      // rostro de abajo o aparece una ceja fantasma.
      const across01 = Math.cos(Math.PI / 2 * across) ** .8;
      // Posición firmada a lo largo de la ceja: +1 en la cabeza, −1 en la cola.
      const alLargo = clamp((x - brow.centerX) / halfSpan * brow.inward, -1, 1);
      const amount = gesto.raise + gesto.tilt * alLargo;
      // El cuerpo de la ceja viaja rígido entre los dos puntos centrales; sólo
      // la piel de la frente y el pliegue del párpado se comprimen.
      const b = brow.breaks;
      const vertical = smoothstep(b[0], b[1], y) * (1 - smoothstep(b[2], b[3], y));
      return -amount * BROW_TRAVEL * across01 * vertical;
    };

    const columns = 14;
    const step = (brow.right - brow.left) / columns;
    for (let index = 0; index < columns; index += 1) {
      const x0 = brow.left + index * step;
      const x1 = x0 + step;
      const xMid = (x0 + x1) / 2;
      for (let segment = 0; segment < brow.breaks.length - 1; segment += 1) {
        const sourceTop = brow.breaks[segment];
        const sourceBottom = brow.breaks[segment + 1];
        const destTop = sourceTop + travel(xMid, sourceTop);
        const destBottom = sourceBottom + travel(xMid, sourceBottom) + .4;
        layer.drawImage(
          image,
          x0, sourceTop, step, sourceBottom - sourceTop,
          lx(x0) - .3, ly(destTop),
          step * scale + .6, ly(destBottom) - ly(destTop)
        );
      }
    }

    surface.feather(cssWidth, cssHeight, {
      centerX: (brow.centerX - boxX) * scale,
      centerY: (brow.breaks[1] + 6 - boxY) * scale,
      radiusX: (halfSpan + PADDING) * scale,
      radiusY: (boxH / 2) * scale,
      solid: .84
    });
    surface.blit(ctx, view.dx + boxX * scale, view.dy + boxY * scale, cssWidth, cssHeight);
  }
}
