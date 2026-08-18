// Ojos: mirada y parpadeo.
//
// La mirada se consigue redibujando el contenido de la apertura ocular
// desplazado unos píxeles dentro del propio recorte. El iris tiene unos 20 px
// de esclerótica a cada lado, así que un recorrido de hasta 3 px se sostiene
// sin descubrir nada raro y basta para que la cara deje de parecer una foto.
//
// El párpado se construye con piel del propio rostro —la de justo debajo del
// ojo, que tiene la misma trama de puntos— más la sombra del arco orbital.
// Nunca con un relleno plano ni con una malla dibujada aparte.

import { clamp, easeOutCubic, easeInOutCubic } from "../animation/math.js";
import { EYES } from "./rig.js";

// Cuánto sube el recorte del párpado por encima de la apertura, en píxeles de
// imagen: lo justo para cubrir el borde del ojo abierto.
const GROW_TOP = 5;

export class EyesLayer {
  draw(ctx, image, view, eyes) {
    const { dx, dy, scale } = view;
    for (const [index, eye] of EYES.entries()) {
      const gaze = eyes.gaze;
      this.#drawGaze(ctx, image, dx, dy, scale, eye, gaze);
      const close = index === 0 ? eyes.left : eyes.right;
      this.#drawEyelid(ctx, image, dx, dy, scale, eye, close);
    }
  }

  #drawGaze(ctx, image, dx, dy, scale, eye, gaze) {
    if (!gaze || (Math.abs(gaze.x) < .05 && Math.abs(gaze.y) < .05)) return;
    const left = eye.left.x;
    const width = eye.right.x - left;
    const top = eye.top.y - 6;
    const height = eye.bottom.y - eye.top.y + 12;

    // El recorte se encoge respecto a la apertura: el borde de las pestañas
    // pertenece al párpado y debe quedarse quieto. Sólo se mueve el interior.
    ctx.save();
    this.#aperturePath(ctx, dx, dy, scale, eye, { inset: .82 });
    ctx.clip();
    ctx.drawImage(
      image,
      left, top, width, height,
      dx + (left + gaze.x) * scale, dy + (top + gaze.y) * scale,
      width * scale, height * scale
    );
    ctx.restore();
  }

  // `inset` encoge la apertura hacia su centro y `growTop` la extiende hacia
  // arriba: el párpado que baja tiene que tapar también el borde superior del
  // ojo abierto, o quedan dos líneas de pestañas a la vez.
  #aperturePath(ctx, dx, dy, scale, eye, { inset = 1, growTop = 0 } = {}) {
    const cx = (eye.left.x + eye.right.x) / 2;
    const cy = (eye.top.y + eye.bottom.y) / 2;
    const at = (point, horizontal) => horizontal
      ? cx + (point - cx) * (inset === 1 ? 1 : inset + (1 - inset) * .35)
      : cy + (point - cy) * inset;
    const leftX = dx + at(eye.left.x, true) * scale;
    const leftY = dy + at(eye.left.y) * scale;
    const rightX = dx + at(eye.right.x, true) * scale;
    const rightY = dy + at(eye.right.y) * scale;
    const topX = dx + eye.top.x * scale;
    const topY = dy + (at(eye.top.y) - growTop) * scale;
    const bottomX = dx + eye.bottom.x * scale;
    const bottomY = dy + at(eye.bottom.y) * scale;
    const cornerY = (leftY + rightY) / 2;
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.quadraticCurveTo(topX, topY * 2 - cornerY, rightX, rightY);
    ctx.quadraticCurveTo(bottomX, bottomY * 2 - cornerY, leftX, leftY);
    ctx.closePath();
  }

  #drawEyelid(ctx, image, dx, dy, scale, eye, close) {
    if (close <= .002) return;
    const leftX = dx + eye.left.x * scale;
    const leftY = dy + eye.left.y * scale;
    const rightX = dx + eye.right.x * scale;
    const rightY = dy + eye.right.y * scale;
    const topX = dx + eye.top.x * scale;
    const topY = dy + eye.top.y * scale;
    const bottomX = dx + eye.bottom.x * scale;
    const bottomY = dy + eye.bottom.y * scale;
    const centerX = (leftX + rightX) / 2;
    const cornerY = (leftY + rightY) / 2;
    const eyeWidth = rightX - leftX;
    const eyeHeight = bottomY - topY;
    const topProgress = clamp(close * 1.03);
    const lowerProgress = clamp((close - .08) / .92);

    // Párpado superior: baja desde el arco natural del ojo.
    const upperCenterY = topY + eyeHeight * .86 * topProgress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(leftX, topY - GROW_TOP * scale, eyeWidth, eyeHeight + GROW_TOP * scale);
    ctx.clip();
    this.#aperturePath(ctx, dx, dy, scale, eye, { growTop: GROW_TOP });
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.quadraticCurveTo(topX, upperCenterY * 2 - cornerY, rightX, rightY);
    ctx.lineTo(rightX, topY - (GROW_TOP + 4) * scale);
    ctx.lineTo(leftX, topY - (GROW_TOP + 4) * scale);
    ctx.closePath();
    ctx.clip();
    // Superficie del párpado: piel lisa tomada bajo el ojo, a la misma densidad
    // de trama que el resto del rostro. Se probó a tomarla del propio párpado,
    // que sería lo anatómico, pero ese tramo lleva el fleco de las pestañas y
    // el nacimiento de la ceja: al entornar poco aparecían rayas verticales.
    ctx.drawImage(
      image,
      eye.textureX, 276, eye.right.x - eye.left.x, 40,
      leftX, topY - GROW_TOP * scale + (1 - topProgress) * -5.5 * scale,
      eyeWidth, (eyeHeight + GROW_TOP * scale) * 1.06
    );
    // Sombra del arco orbital arriba y un realce leve sobre la curva del
    // párpado: es una superficie convexa, no un agujero.
    const crease = ctx.createLinearGradient(0, topY, 0, upperCenterY);
    crease.addColorStop(0, `rgba(4,12,20,${.30 * topProgress})`);
    crease.addColorStop(.72, `rgba(4,12,20,${.05 * topProgress})`);
    crease.addColorStop(1, `rgba(188,224,244,${.10 * topProgress})`);
    ctx.fillStyle = crease;
    ctx.fillRect(leftX, topY - 2 * scale, eyeWidth, eyeHeight + 4 * scale);
    ctx.restore();

    // Párpado inferior: acompaña sólo el 14% del recorrido.
    if (lowerProgress > .01) {
      const lowerCenterY = bottomY - eyeHeight * .14 * lowerProgress;
      ctx.save();
      ctx.beginPath();
      ctx.rect(leftX, topY, eyeWidth, eyeHeight);
      ctx.clip();
      this.#aperturePath(ctx, dx, dy, scale, eye);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.quadraticCurveTo(bottomX, lowerCenterY * 2 - cornerY, rightX, rightY);
      ctx.lineTo(rightX, bottomY + 4 * scale);
      ctx.lineTo(leftX, bottomY + 4 * scale);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        image,
        eye.textureX, 276, eye.right.x - eye.left.x, 40,
        leftX, topY + (1 - lowerProgress) * 3.5 * scale, eyeWidth, eyeHeight * 1.05
      );
      ctx.restore();
    }

    // Borde de las pestañas. Es la marca que hace legible el parpadeo: viaja
    // con el párpado desde el principio del cierre, no sólo al final.
    if (close > .10) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(leftX, topY - GROW_TOP * scale, eyeWidth, eyeHeight + GROW_TOP * scale);
      ctx.clip();
      this.#aperturePath(ctx, dx, dy, scale, eye, { growTop: GROW_TOP });
      ctx.clip();
      const lineAlpha = clamp((close - .10) / .55) * .72;
      ctx.strokeStyle = `rgba(10,20,30,${lineAlpha * .5})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.quadraticCurveTo(topX, (upperCenterY + 1.4 * scale) * 2 - cornerY, rightX, rightY);
      ctx.stroke();
      ctx.strokeStyle = `rgba(228,250,255,${lineAlpha})`;
      ctx.lineWidth = .8 * scale;
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.quadraticCurveTo(topX, upperCenterY * 2 - cornerY, rightX, rightY);
      ctx.stroke();
      ctx.restore();
    }
  }

}

// Curva de un parpadeo humano: cierre rápido, retención mínima y apertura
// bastante más lenta. Un ciclo simétrico delata de inmediato la animación.
export function blinkCurve(phase) {
  if (phase <= 0 || phase >= 1) return 0;
  if (phase < .30) return easeOutCubic(phase / .30);
  if (phase < .38) return 1;
  return 1 - easeInOutCubic((phase - .38) / .62);
}
