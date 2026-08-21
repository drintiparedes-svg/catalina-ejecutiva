// Puntos anatómicos del retrato, medidos sobre assets/catalina.png (1408×768).
// Todas las coordenadas están en píxeles de la imagen original; el renderizador
// las convierte a píxeles de pantalla con `view.scale`.
//
// Referencias medidas con perfiles de luminancia (work/):
//   · Bermellón superior: brillo máximo en y≈386, borde alto en y≈379.
//   · Unión de los labios (surco): y≈406 al centro, y≈402 en las comisuras.
//   · Comisuras: x≈639 y x≈771 → centro 705, semiancho 66.
//   · Labio inferior: cuerpo hasta y≈428, surco mentolabial y≈433.
//   · Contorno mandibular: desde (575,415) hasta el mentón (705,512).
//   · Apertura ocular: 584–660 y 748–820, párpados entre y≈229 y y≈267.

export const IMAGE = { width: 1408, height: 768 };

export const MOUTH = {
  centerX: 705,
  seamY: 406,
  halfWidth: 66,

  // Franja del labio superior: arranca en la base de la nariz, donde el
  // desplazamiento vale cero, y termina en la unión labial.
  upperBreaks: [356, 376, 392, 400, 407],

  // Franja inferior: labio, mentón, mandíbula y arranque del cuello. Los cortes
  // se agolpan donde el desplazamiento cambia rápido (el labio) y se espacian
  // en el mentón, donde es casi constante. El último tramo vuelve a cero para
  // que el cuello quede inmóvil.
  lowerBreaks: [394, 407, 417, 429, 443, 470, 540, 584],

  // Alcance horizontal del arrastre mandibular sobre las mejillas.
  jawSpan: 130,

  // Caja de trabajo y máscara de fusión de la capa inferior del rostro.
  patch: { x: 536, y: 324, width: 338, height: 272 },
  mask: { centerX: 705, centerY: 460, radiusX: 168, radiusY: 134, solid: .80 }
};

export const EYES = [
  {
    // Ojo a la izquierda en pantalla.
    left: { x: 584, y: 250 }, right: { x: 660, y: 254 },
    top: { x: 622, y: 229 }, bottom: { x: 622, y: 267 },
    textureX: 584,
    iris: { x: 632, y: 244 }
  },
  {
    left: { x: 748, y: 254 }, right: { x: 820, y: 250 },
    top: { x: 784, y: 229 }, bottom: { x: 784, y: 267 },
    textureX: 748,
    iris: { x: 778, y: 244 }
  }
];

// La ceja viaja rígida entre los dos puntos centrales; los extremos son la
// piel de la frente y el pliegue del párpado, que sí se comprimen.
// `inward` indica hacia qué lado queda la cabeza de la ceja (la que mira a la
// nariz). Es lo que permite inclinarla: la cabeza sube en la preocupación y
// baja en el enfado, mientras la cola hace lo contrario.
export const BROWS = [
  { centerX: 621, left: 566, right: 676, breaks: [176, 194, 214, 234], inward: 1 },
  { centerX: 785, left: 730, right: 840, breaks: [176, 194, 214, 234], inward: -1 }
];

// Pivote del giro de cabeza: base del cráneo, no el centro del lienzo.
export const HEAD_PIVOT = { x: 705, y: 330 };

// Cabellera.
//
// Dos masas de puntos que cuelgan a los lados del rostro. Para animarlas hace
// falta saber dos cosas en cada altura, y las dos están medidas sobre la
// fotografía:
//
//   `anchor`  Línea donde el pelo deja de ser libre: el contorno del rostro
//             arriba, el cuello a la altura del mentón y el borde del busto
//             abajo. Ahí el desplazamiento vale cero, así que ni la cara ni el
//             hombro se mueven nunca. Lo que queda por fuera es melena suelta.
//   `edge`    Borde exterior de la melena, medido con un umbral de luminancia
//             sobre la imagen (el fondo ronda 10; los puntos del pelo pasan de
//             60). Es la distancia sobre la que se reparte el recorrido: ahí
//             llega el desplazamiento completo que pide la brisa.
//
// Los puntos son [y, x] y se interpolan linealmente entre sí.
export const HAIR = {
  // Margen de fondo negro que se redibuja por fuera del pelo. Sin él, la
  // melena estirada dejaría al descubierto la copia inmóvil de debajo; con él
  // se arrastra un trozo de fondo, que es negro sobre negro y no se ve. Se
  // queda corto a propósito para no llegar al destello decorativo de la
  // esquina inferior derecha, que debe permanecer clavado.
  margin: 64,

  // Reparto mínimo. Junto al cuero cabelludo el ancla y el borde casi se
  // tocan; sin este suelo, el estiramiento se dispararía.
  minReach: 45,

  left: {
    anchor: [
      [0, 572], [100, 556], [200, 548], [300, 548], [400, 566], [460, 590],
      [520, 610], [560, 600], [600, 545], [650, 470], [700, 432], [768, 420]
    ],
    edge: [
      [0, 540], [100, 490], [200, 455], [300, 405], [400, 388], [500, 312],
      [560, 300], [620, 292], [700, 236], [768, 255]
    ]
  },

  right: {
    anchor: [
      [0, 838], [100, 852], [200, 864], [300, 860], [400, 846], [460, 822],
      [520, 800], [560, 806], [600, 880], [650, 950], [700, 985], [768, 1000]
    ],
    edge: [
      [0, 880], [100, 912], [200, 960], [300, 1016], [400, 1040], [500, 1068],
      [560, 1118], [620, 1122], [700, 1148], [768, 1150]
    ]
  }
};

// Cuello.
//
// El giro de la cabeza no puede arrastrar el busto: es justo lo que delataba
// al avatar, un torso entero balanceándose como un muñeco. El cuello absorbe
// el movimiento: hasta el mentón la cabeza va entera, entre el mentón y la
// clavícula el recorrido se apaga, y de ahí para abajo la fotografía está
// clavada.
export const NECK = { solid: 520, fade: 630 };
