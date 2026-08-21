// Cabeza y cuello.
//
// El gesto de cabeza (la deriva lenta, el cabeceo de acento, el asentimiento
// de escucha) movía antes la fotografía entera: giraba el retrato alrededor de
// la base del cráneo y con él se balanceaba el busto, que es lo que delataba al
// avatar. Un torso no acompaña a la cabeza; el cuello absorbe el movimiento.
//
// Esta capa vuelve a dibujar la banda central —de la coronilla a la clavícula—
// franja a franja, con el recorrido apagándose hacia abajo. Arriba la cabeza va
// entera; a la altura de la clavícula el desplazamiento ya vale cero y la
// fotografía de debajo queda intacta, sin costura que disimular.
//
// El giro se aplica como cizalla (cada franja se corre en horizontal según su
// distancia al pivote) en lugar de como rotación. A los tres décimas de grado
// que llega a girar la cabeza, la diferencia con la rotación real es de una
// décima de píxel y a cambio la banda encaja exactamente con la melena, que se
// dibuja con este mismo desplazamiento de base.

import { smoothstep } from "../animation/math.js";
import { HAIR, HEAD_PIVOT, NECK } from "./rig.js";
import { STRIP, sampleCurve, drawStrip } from "./warp.js";

// Cuánto acompaña cada altura al gesto de cabeza: uno hasta el mentón, cero de
// la clavícula para abajo.
export function neckFollow(y) {
  return 1 - smoothstep(NECK.solid, NECK.fade, y);
}

// Desplazamiento del retrato a la altura `y`, en píxeles de la imagen original.
// Lo comparten la banda central y las dos melenas: el pelo cuelga de la cabeza,
// así que parte de donde ella lo deje.
export function headShift(y, head) {
  const follow = neckFollow(y);
  return {
    x: (head.x - head.tilt * (y - HEAD_PIVOT.y)) * follow,
    y: head.y * follow
  };
}

export class HeadLayer {
  draw(ctx, image, view, head) {
    for (let y = 0; y < NECK.fade; y += STRIP) {
      const middle = y + STRIP / 2;
      const shift = headShift(middle, head);
      const from = sampleCurve(HAIR.left.anchor, middle);
      const to = sampleCurve(HAIR.right.anchor, middle);
      // `anchor` da igual con estiramiento uno: la franja se traslada entera.
      drawStrip(ctx, image, view, {
        y, from, to, anchor: from, shiftX: shift.x, shiftY: shift.y
      });
    }
  }
}
