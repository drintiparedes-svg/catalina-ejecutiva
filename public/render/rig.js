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

  // Franja del labio superior y la mejilla: arranca en el pómulo, donde el
  // desplazamiento vale cero, y termina en la unión labial. Los cortes se
  // agolpan sobre el labio, que es donde el campo cambia deprisa.
  upperBreaks: [306, 332, 356, 376, 392, 400, 407],

  // Franja inferior: labio, mentón, mandíbula y arranque del cuello. Los cortes
  // se agolpan donde el desplazamiento cambia rápido (el labio) y se espacian
  // en el mentón, donde es casi constante. El último tramo vuelve a cero para
  // que el cuello quede inmóvil.
  lowerBreaks: [394, 407, 417, 429, 443, 470, 500, 528, 556, 588],

  // Peso del arrastre mandibular.
  //
  // Antes era un recorte lateral —dentro de 130 px del centro la piel se movía,
  // fuera no—, y el resultado era exactamente eso: un rectángulo de piel
  // deslizándose sobre una cara quieta, con dos bordes verticales que se veían.
  //
  // Ahora el peso decae en todas direcciones desde el mentón siguiendo la forma
  // de la propia mandíbula. `reach` es el radio en el que ya no queda nada de
  // arrastre: hacia los lados llega a la oreja, que es donde está el eje de
  // giro de la mandíbula y por tanto donde el recorrido es cero; hacia arriba,
  // al pómulo. `solid` es el radio interior donde el arrastre es completo: el
  // mentón y el labio inferior van con la mandíbula sin rebajar.
  jaw: {
    chinX: 705, chinY: 498,
    reachX: 178, reachY: 196,
    solid: .42,

    // El cuello acompaña al mentón y lo va soltando: completo bajo la barbilla,
    // nada en la base del cuello. Sin este tramo, la barbilla bajaba sobre una
    // garganta clavada y el corte se leía como una placa.
    throatTop: 508,
    throatEnd: 588
  },

  // Altura del pómulo. La mejilla acompaña a la comisura y el efecto se
  // disuelve aquí, en vez de cortarse en la base de la nariz.
  cheekTop: 306,

  // Caja de trabajo y máscara de fusión de la capa inferior del rostro. Cubren
  // todo el alcance del campo, de modo que la máscara sólo se difumina donde el
  // arrastre ya vale cero.
  patch: { x: 532, y: 298, width: 346, height: 302 },
  mask: { centerX: 705, centerY: 449, radiusX: 173, radiusY: 151, solid: .80 }
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
//   `anchor`  Frontera entre el pelo suelto y el pelo sostenido. Arriba es el
//             contorno del rostro; de los hombros para abajo es la **silueta
//             del busto**, no el borde del pelo: el mechón que cae sobre el
//             hombro tapa cuerpo, y moverlo movería el cuerpo con él. Ahí el
//             desplazamiento vale cero, así que ni la cara ni el torso se
//             mueven jamás; sólo se mece lo que cuelga por fuera.
//   `edge`    Borde exterior de la melena, medido con un umbral de luminancia
//             sobre la imagen (el fondo ronda 10; los puntos del pelo pasan de
//             60).
//
// Los puntos son [y, x] y se interpolan linealmente entre sí.
export const HAIR = {
  // Margen de fondo negro que se redibuja por fuera del pelo. Sin él, la
  // melena desplazada hacia dentro dejaría al descubierto la copia inmóvil de
  // debajo; con él se arrastra un trozo de fondo, que es negro sobre negro y no
  // se ve. Se queda corto a propósito para no llegar al destello decorativo de
  // la esquina inferior derecha, que debe permanecer clavado.
  margin: 64,

  // Franja de transición junto al ancla. La melena se traslada entera —es una
  // masa, no una goma— y toda la diferencia con la parte sujeta se resuelve en
  // esta franja, que es donde el pelo se apoya en la cara o en el hombro. Antes
  // el reparto ocupaba el ancho completo del mechón y el resultado era un
  // estiramiento, no un vaivén.
  blend: 140,

  left: {
    anchor: [
      [0, 572], [100, 556], [200, 548], [300, 548], [400, 566], [460, 590],
      [520, 610], [560, 600], [580, 520], [600, 462], [650, 410], [700, 396],
      [768, 382]
    ],
    edge: [
      [0, 540], [100, 490], [200, 455], [300, 405], [400, 388], [500, 312],
      [560, 300], [620, 292], [700, 236], [768, 255]
    ]
  },

  right: {
    anchor: [
      [0, 838], [100, 852], [200, 864], [300, 860], [400, 846], [460, 822],
      [520, 800], [560, 890], [600, 1012], [650, 1046], [700, 1040],
      [768, 1040]
    ],
    edge: [
      [0, 880], [100, 912], [200, 960], [300, 1016], [400, 1040], [500, 1068],
      [560, 1118], [620, 1122], [700, 1148], [768, 1150]
    ]
  }
};

// Cuello.
//
// El gesto de cabeza no puede arrastrar el busto: un torso no acompaña a la
// cabeza, y verlo balancearse entero era justo lo que delataba al avatar. El
// cuello absorbe el movimiento: hasta el mentón la cabeza va entera, entre el
// mentón y la base del cuello el recorrido se apaga, y de ahí para abajo
// —clavícula, pecho, hombros— la fotografía no se toca. El corte está medido
// por encima de la clavícula a propósito: bastaba con rozarla para que el pecho
// se moviera y se recompusiera, y eso se nota en la trama de puntos.
export const NECK = { solid: 500, fade: 590 };
