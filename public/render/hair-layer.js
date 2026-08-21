// Melena.
//
// Cada mitad de la cabellera se redibuja franja a franja, estirada alrededor de
// su línea de anclaje (rig.js: HAIR). El estiramiento es lo que produce la
// deformación distal sin necesidad de máscaras: junto al ancla el pelo no se
// mueve ni un píxel, y el recorrido crece de forma proporcional hasta llegar al
// borde exterior, donde vale exactamente lo que pide la brisa.
//
// La brisa —ondas que viajan hacia las puntas, desfase entre las dos mitades y
// micro-ráfagas— vive en animation/wind.js. Aquí sólo se convierte el
// desplazamiento del borde en el factor de estiramiento de cada franja.
//
// Se redibuja también un margen de fondo por fuera del pelo: al estirar la
// melena hacia dentro quedaría al descubierto la copia inmóvil que hay debajo,
// y ese margen negro la tapa. Termina antes del destello decorativo de la
// esquina, que no debe moverse.

import { HAIR, IMAGE } from "./rig.js";
import { STRIP, sampleCurve, drawStrip } from "./warp.js";
import { headShift } from "./head-layer.js";

const LADOS = ["left", "right"];

export class HairLayer {
  draw(ctx, image, view, wind, head) {
    for (const lado of LADOS) {
      const guia = HAIR[lado];
      const izquierda = lado === "left";

      for (let y = 0; y < IMAGE.height; y += STRIP) {
        const middle = y + STRIP / 2;
        const anchor = sampleCurve(guia.anchor, middle);
        const edge = sampleCurve(guia.edge, middle);

        // Reparto: distancia con signo del ancla al borde exterior, con un
        // suelo para que el estiramiento no se dispare donde la melena apenas
        // asoma (junto al cuero cabelludo ancla y borde casi se tocan).
        const span = Math.max(Math.abs(edge - anchor), HAIR.minReach);
        const reach = izquierda ? -span : span;
        const bend = wind.bend(lado, middle);
        const shift = headShift(middle, head);

        const outer = izquierda
          ? Math.max(0, edge - HAIR.margin)
          : Math.min(IMAGE.width, edge + HAIR.margin);

        drawStrip(ctx, image, view, {
          y,
          from: izquierda ? outer : anchor,
          to: izquierda ? anchor : outer,
          anchor,
          stretch: 1 + bend / reach,
          shiftX: shift.x,
          shiftY: shift.y
        });
      }
    }
  }
}
