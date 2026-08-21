// Cabeza y cuello.
//
// El gesto de cabeza —la deriva lenta, el cabeceo del acento, el asentimiento
// de escucha— movía antes la fotografía entera: giraba el retrato alrededor de
// la base del cráneo y con él se balanceaba el busto. Un torso no acompaña a la
// cabeza; el cuello absorbe el movimiento.
//
// Esta capa vuelve a dibujar sólo la banda de la cabeza y el cuello, franja a
// franja, con el recorrido apagándose hacia abajo: entero hasta el mentón, nulo
// en la base del cuello (rig.js: NECK). De la clavícula para abajo la
// fotografía no se toca, así que el pecho ni se mueve ni se recompone.
//
// El giro se aplica como cizalla —cada franja se corre en horizontal según su
// distancia al pivote— en vez de como rotación. A las tres décimas de grado que
// llega a girar la cabeza la diferencia es de una décima de píxel, y a cambio la
// banda encaja exactamente con la melena, que se dibuja con este mismo
// desplazamiento de base. Las franjas se trasladan enteras, nunca se estiran,
// así que el rostro conserva su definición.

import { smoothstep } from "../animation/math.js";
import { HAIR, HEAD_PIVOT, NECK } from "./rig.js";
import { STRIP, sampleCurve, drawStrip } from "./warp.js";

// Cuánto acompaña cada altura al gesto de cabeza: uno hasta el mentón, cero en
// la base del cuello.
export function neckFollow(y) {
  return 1 - smoothstep(NECK.solid, NECK.fade, y);
}

// Desplazamiento del retrato a la altura `y`, en píxeles de la imagen original.
// Lo comparten la banda de la cabeza y las dos melenas: el pelo cuelga de la
// cabeza, así que parte de donde ella lo deje.
export function headShift(y, head) {
  const follow = neckFollow(y);
  if (follow <= 0) return { x: 0, y: 0 };
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
      drawStrip(ctx, image, view, {
        y,
        from: sampleCurve(HAIR.left.anchor, middle),
        to: sampleCurve(HAIR.right.anchor, middle),
        shiftX: shift.x,
        shiftY: shift.y
      });
    }
  }
}
