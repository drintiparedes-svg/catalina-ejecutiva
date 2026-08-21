// Melena.
//
// Cada mitad de la cabellera se redibuja franja a franja. Dentro de una franja,
// el pelo suelto se mueve **en bloque**: es una masa que se mece, no una goma
// que se estira. Toda la diferencia con la parte que está sujeta —la cara
// arriba, el hombro abajo— se resuelve en una franja de transición estrecha
// pegada al anclaje (rig.js: HAIR), que es justo donde el pelo se apoya.
//
// Antes el reparto ocupaba el ancho completo del mechón: cada punto se movía en
// proporción a su distancia a la cara, o sea que la melena se estiraba y se
// encogía en vez de mecerse. Además de no parecer pelo, estirar recompone la
// trama de puntos y la deja más blanda; trasladar no.
//
// Lo que queda del anclaje hacia dentro no se toca: ni un píxel del rostro ni
// del busto se redibuja, así que el cuerpo no se mueve ni pierde definición. El
// pelo que descansa sobre el hombro tampoco se mueve, y es lo correcto: sólo se
// mece lo que cuelga suelto.
//
// El vaivén —ondas que viajan hacia las puntas, desfase entre las dos mitades y
// micro-ráfagas— vive en animation/wind.js. A eso se le suma el desplazamiento
// de la cabeza, porque la melena cuelga de ella.

import { HAIR, IMAGE } from "./rig.js";
import { STRIP, sampleCurve, drawStrip } from "./warp.js";
import { headShift } from "./head-layer.js";

const LADOS = ["left", "right"];

export class HairLayer {
  draw(ctx, image, view, wind, head) {
    for (const lado of LADOS) {
      const guia = HAIR[lado];
      const izquierda = lado === "left";
      const hacia = izquierda ? -1 : 1;   // sentido en el que cuelga la melena

      for (let y = 0; y < IMAGE.height; y += STRIP) {
        const middle = y + STRIP / 2;
        // El ancla se toma en su posición más prudente dentro de la franja, no
        // en el centro: donde la curva baja en diagonal —el hombro— tomarla en
        // el centro metía unos píxeles de cuerpo en la zona que se mueve.
        const arriba = sampleCurve(guia.anchor, y);
        const abajo = sampleCurve(guia.anchor, y + STRIP);
        const anchor = izquierda ? Math.min(arriba, abajo) : Math.max(arriba, abajo);
        const edge = sampleCurve(guia.edge, middle);
        // Se arrastra un margen de fondo por fuera del pelo: al desplazar la
        // melena hacia dentro dejaría al descubierto la copia inmóvil de
        // debajo, y ese negro sobre negro la tapa.
        const outer = izquierda
          ? Math.max(0, edge - HAIR.margin)
          : Math.min(IMAGE.width, edge + HAIR.margin);

        // La transición nunca se come más de media melena: donde el mechón es
        // estrecho, el reparto se estrecha con él.
        const blend = Math.min(HAIR.blend, Math.abs(outer - anchor) * .6);
        if (blend < 1) continue;

        const bend = wind.bend(lado, middle);
        const shift = headShift(middle, head);
        const hinge = anchor + hacia * blend;

        // 1. Transición: quieta en el ancla, desplazamiento completo en la
        //    bisagra. Es el único tramo que se estira.
        drawStrip(ctx, image, view, {
          y,
          from: izquierda ? hinge : anchor,
          to: izquierda ? anchor : hinge,
          anchor,
          stretch: 1 + bend / (hacia * blend),
          shiftX: shift.x,
          shiftY: shift.y
        });

        // 2. Melena suelta: bloque rígido. Arranca justo donde la transición
        //    deja el pelo, así que los dos tramos encajan sin costura.
        drawStrip(ctx, image, view, {
          y,
          from: izquierda ? outer : hinge,
          to: izquierda ? hinge : outer,
          shiftX: shift.x + bend,
          shiftY: shift.y
        });
      }
    }
  }
}
