// Brisa sobre la cabellera.
//
// El retrato es una fotografía quieta: el busto no respira ni se balancea, y
// esa quietud es deliberada. Lo único que se mueve por el aire es el pelo, y
// para que parezca pelo y no una cortina, el campo de viento cumple tres
// reglas:
//
//   1. Deformación distal. La raíz está sujeta al cráneo y no se mueve; el
//      recorrido crece hacia las puntas. `bend()` devuelve el desplazamiento
//      del borde exterior y la capa lo reparte de forma proporcional a la
//      distancia al anclaje, así que la raíz queda inmóvil por construcción.
//   2. Asimetría y desfase. Las dos mitades comparten el viento pero no la
//      respuesta: distinta ganancia, distinta fase y su propio ruido. Nunca
//      llegan al mismo sitio a la vez.
//   3. Micro-ráfagas. La intensidad no es constante: hay un fondo suave y,
//      cada pocos segundos, una racha de ataque rápido y caída lenta.
//
// Además, la onda *viaja* hacia abajo (la fase depende de la altura), que es
// lo que distingue una melena de un péndulo: el impulso tarda en recorrer el
// mechón. Y la melena va por detrás de la cabeza: cuando el cráneo se mueve,
// el pelo llega tarde.

import { clamp, damp, range, smoothstep, createNoise } from "./math.js";

const TAU = Math.PI * 2;

// Mandos vivos, en píxeles de la imagen original (1408 × 768). Son mutables a
// propósito: el banco de pruebas (/banco.html) los mueve con deslizadores para
// afinar mirando el pelo en vez de recompilar a ciegas.
export const BRISA = {
  // Recorrido lateral de la punta con la ráfaga en su máximo. Ocho píxeles
  // sobre 1408 son medio dedo de melena: se ve el movimiento, no el truco.
  alcance: 10,
  // Multiplicador de la velocidad de las ondas. 1 es el temple natural.
  velocidad: 1
};

// Dos ondas superpuestas: una larga y lenta que da el balanceo, otra corta que
// rompe la regularidad. `length` es la longitud de onda a lo largo del mechón,
// en píxeles: cuanto más corta, más se riza el movimiento.
const ONDAS = [
  { period: 5.9, length: 380, weight: .60 },
  { period: 3.2, length: 215, weight: .26 }
];
const RUIDO_PESO = .32;
const PESO_TOTAL = ONDAS.reduce((suma, onda) => suma + onda.weight, RUIDO_PESO);

// Deformación distal: cuero cabelludo quieto, puntas sueltas. El exponente
// retrasa la subida para que el movimiento no arranque a media cabeza.
const CUERO = 40;
const PUNTAS = 780;
const DISTAL_CURVA = 1.35;

// Ráfagas. `FONDO` es la brisa permanente entre rachas; sin él el pelo se
// quedaría completamente muerto en las pausas.
const FONDO = .34;
const RAFAGA_CADA = [1.4, 5.2];
const RAFAGA_DURA = [.9, 2.8];
const RAFAGA_FUERZA = [.30, 1];
const RAFAGA_ATAQUE = .22;   // parte de la racha que ocupa la subida

// Cuánto se retrasa la melena respecto al cráneo. Es el arrastre: la cabeza
// sale antes y el pelo la sigue, doblándose en sentido contrario al giro.
const ARRASTRE = 1.9;

// Cada mitad responde al mismo viento con su propio carácter.
const LADOS = {
  left: { gain: 1, phase: 0, semilla: 0 },
  right: { gain: .82, phase: 2.35, semilla: 1 }
};

export class HairWind {
  constructor() {
    this.time = 0;
    this.gust = FONDO;
    this.lag = 0;

    this.rafagaAt = -1;
    this.rafagaDura = 1;
    this.rafagaFuerza = 0;
    this.proximaRafagaAt = range(.6, 2.2);

    this.arrastre = 0;
    this.ruido = [createNoise(83), createNoise(97)];
    this.fondoNoise = createNoise(113);
  }

  // `headX` es el desplazamiento horizontal de la cabeza en este cuadro; de él
  // sale el retraso de la melena.
  update(dt, time, headX = 0) {
    this.time = time;

    if (this.rafagaAt < 0 && time >= this.proximaRafagaAt) {
      this.rafagaAt = time;
      this.rafagaDura = range(...RAFAGA_DURA);
      this.rafagaFuerza = range(...RAFAGA_FUERZA);
    }

    let racha = 0;
    if (this.rafagaAt >= 0) {
      const fase = (time - this.rafagaAt) / this.rafagaDura;
      if (fase >= 1) {
        this.rafagaAt = -1;
        this.proximaRafagaAt = time + range(...RAFAGA_CADA);
      } else {
        // Ataque rápido, caída larga: así se lee como una racha de aire y no
        // como una respiración de la imagen.
        const envolvente = fase < RAFAGA_ATAQUE
          ? smoothstep(0, 1, fase / RAFAGA_ATAQUE)
          : (1 - (fase - RAFAGA_ATAQUE) / (1 - RAFAGA_ATAQUE)) ** 2;
        racha = envolvente * this.rafagaFuerza;
      }
    }

    const fondo = FONDO * (1 + this.fondoNoise(time * .07) * .55);
    this.gust = damp(this.gust, clamp(fondo + racha, 0, 1.4), dt, .26);

    // Seguidor retrasado del cráneo. La diferencia con la posición real es lo
    // que dobla el mechón cuando la cabeza arranca o frena.
    this.arrastre = damp(this.arrastre, headX, dt, .17);
    this.lag = this.arrastre - headX;
  }

  // Desplazamiento lateral del borde exterior de la melena a la altura `y`, en
  // píxeles de la imagen original. Positivo es hacia la derecha de la pantalla:
  // las dos mitades se doblan hacia el mismo lado, como con un viento real.
  bend(lado, y) {
    const perfil = LADOS[lado] ?? LADOS.left;
    const distal = smoothstep(CUERO, PUNTAS, y) ** DISTAL_CURVA;
    if (distal <= 0) return 0;

    const t = this.time * BRISA.velocidad;
    let onda = 0;
    for (const { period, length, weight } of ONDAS) {
      onda += Math.sin(TAU * (t / period - y / length) + perfil.phase) * weight;
    }
    onda += this.ruido[perfil.semilla](t * .31 + y * .0033) * RUIDO_PESO;

    const brisa = (onda / PESO_TOTAL) * this.gust * perfil.gain * BRISA.alcance;
    return (brisa + this.lag * ARRASTRE) * distal;
  }
}
