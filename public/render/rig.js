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

// Nariz. Medida sobre el retrato con perfiles de brillo del borde alar:
//   · Eje: x≈705, el mismo de la boca.
//   · Ala: borde exterior en x≈667 y x≈743 a la altura y≈335–350 → semiancho 38.
//   · Dorso: se estrecha a un semiancho ≈24 hacia y≈310.
//   · Base: y≈356, que es donde arranca la franja del labio superior.
//
// El parche se corta en y=354 a propósito: por debajo empieza el labio, y la
// respiración basal no debe moverlo. Si esa zona se viera afectada, la imagen
// transmitiría esfuerzo respiratorio en vez de ventilación tranquila.
export const NOSE = {
  centerX: 705,
  alarHalfWidth: 38,

  // Peso del desplazamiento por altura. Es el gradiente vertical: dorso casi
  // inmóvil como ancla visual, máximo en el ala, y de vuelta a cero antes del
  // labio. Entre anclas se interpola con suavidad, sin fronteras duras.
  perfilY: [
    { y: 276, peso: 0 },      // dorso alto: inmóvil
    { y: 292, peso: .05 },    // dorso: 0–5 %
    { y: 306, peso: .16 },    // pared lateral superior: 10–20 %
    { y: 320, peso: .42 },    // pared lateral inferior: 30–50 %
    { y: 334, peso: .82 },
    { y: 342, peso: 1 },      // ala: amplitud máxima
    { y: 349, peso: .55 },
    { y: 354, peso: 0 }       // borde inferior: el labio no se toca
  ],

  // Peso por distancia al eje. La columela y la línea media se mueven poco
  // (5–15 %), el máximo está en el borde alar y se apaga en el tejido
  // perinasal.
  columelaPeso: .10,
  columelaAncho: 10,
  alcance: 60,

  // El parche lleva un margen estático por los cuatro lados: el campo ya vale
  // cero antes de llegar al borde (fuera de `alcance` en horizontal, fuera del
  // primer y último ancla de `perfilY` en vertical), así que lo que se vuelve a
  // estampar ahí es idéntico al original y no puede aparecer una costura.
  patch: { x: 634, y: 268, width: 142, height: 96 },
  // La máscara es sólo un seguro contra el error de remuestreo en el margen, no
  // el recorte de la nariz. Ha de ser opaca sobre todo el ala: una elipse
  // centrada en la nariz deja las alas en sus esquinas inferolaterales, que es
  // su punto más lejano, y con un radio corto las borraba justo donde ocurre
  // todo el movimiento.
  mask: { centerX: 705, centerY: 316, radiusX: 72, radiusY: 54, solid: .88 }
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
// Cabellera. Medida sobre el retrato con perfiles de luz por fila:
//   · Mechón izquierdo: del x≈329 en y=460 al x≈222 en y=740; se abre al caer.
//   · Mechón derecho:   del x≈1051 en y=460 al x≈1190 en y=720.
//   · Entre ambos, x 576..928, está el cuerpo, y ahí no se toca nada.
//   · El destello decorativo vive en x≈1350, y≈700: queda fuera de los parches
//     a propósito, porque una brisa no mueve un adorno.
//
// Sólo se mueve de la altura del hombro hacia abajo. Arriba el pelo va pegado
// a la cabeza y ya sigue sus giros; moverlo también ahí lo despegaría del
// cráneo, que es el error que delata este tipo de animación.
//
// Los parches empiezan en y=540 aunque el anclaje esté en 486: a esa altura el
// recorrido es de 0,3 px, invisible, y recomponer las 74 filas de encima para
// eso costaría un tercio del trabajo de cada cuadro.
export const HAIR = {
  // El pelo queda sujeto aquí y se suelta hacia abajo.
  anclaY: 486,
  mechones: [
    {
      nombre: "izquierdo",
      // Con margen de sobra por fuera: al desplazarse, el mechón entra en él.
      // El margen es fondo negro, así que estirarlo no se ve.
      patch: { x: 176, y: 540, width: 452, height: 228 },
      // El campo vale 1 en el pelo suelto y se apaga antes de llegar al cuerpo.
      bordeLibre: 520,
      bordeInterior: 624,
      semilla: 101
    },
    {
      nombre: "derecho",
      patch: { x: 884, y: 540, width: 400, height: 228 },
      bordeLibre: 992,
      bordeInterior: 888,
      // Semilla distinta: con la misma, los dos mechones se moverían iguales y
      // el aire no hace eso.
      semilla: 211
    }
  ]
};

export const HEAD_PIVOT = { x: 705, y: 330 };
