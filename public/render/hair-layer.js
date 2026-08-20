// Brisa en la cabellera.
//
// El pelo largo no bascula en bloque. Una ráfaga entra por arriba y baja por
// la hebra, de modo que en cualquier instante la raíz ya va de vuelta mientras
// la punta todavía va de ida. Eso es lo que hace que se lea como aire y no como
// un objeto rígido que alguien mueve, y es la razón de que aquí el
// desplazamiento dependa de la profundidad y no sólo del tiempo.
//
// Dos cosas más, pequeñas, que sostienen la ilusión:
//
//   · La amplitud crece con el cuadrado de la distancia al anclaje. Una hebra
//     sujeta por un extremo se desvía poco cerca del nudo y mucho en la punta;
//     con crecimiento lineal el mechón parece una cortina.
//   · La punta describe un arco, no una recta: al desplazarse hacia un lado
//     también sube un poco, porque el pelo no se estira.
//
// Los dos mechones llevan ruido distinto. Con el mismo, se moverían en espejo
// y el aire no hace eso.

import { clamp, smoothstep, createNoise } from "../animation/math.js";
import { TUNING } from "../animation/tuning.js";
import { HAIR } from "./rig.js";
import { Surface } from "./surface.js";

// Franjas horizontales. El paso fino de más abajo es donde la amplitud cambia
// deprisa; arriba basta con menos.
const construirBandas = (desde, hasta) => {
  const bandas = [];
  for (let y = desde; y < hasta; y += 18) bandas.push(y);
  bandas.push(hasta);
  return bandas;
};

// Ancho de columna dentro de la zona donde el campo se apaga. Fuera de ella el
// desplazamiento es constante y la franja se dibuja de una sola vez.
const COLUMNA = 8;

// El ruido de valor casi nunca llega a su extremo: medido sobre 120.000
// muestras, el percentil 99 de |onda| es 0,62. Sin corregirlo, poner la
// amplitud en 9 daba 4 px de recorrido y el mando del banco no significaba
// nada. Con esta constante, el número que se ajusta ahí es de verdad los
// píxeles que se mueve la punta en una ráfaga fuerte.
const NORMA = 1.61;

export class HairLayer {
  constructor(createSurfaceImpl) {
    this.mechones = HAIR.mechones.map(mechon => ({
      mechon,
      surface: new Surface(createSurfaceImpl),
      bandas: construirBandas(HAIR.anclaY, mechon.patch.y + mechon.patch.height),
      // Dos octavas de ruido: la lenta es la ráfaga, la rápida el temblor de
      // las puntas. Sumar senos daría un bucle audible a la vista.
      ruido: [createNoise(mechon.semilla), createNoise(mechon.semilla + 37)]
    }));
  }

  // Cuánto se ha soltado el pelo a esta altura: 0 en el anclaje, 1 en la punta.
  #profundidad(mechon, y) {
    const fondo = mechon.patch.y + mechon.patch.height;
    return clamp((y - HAIR.anclaY) / (fondo - HAIR.anclaY));
  }

  // Desplazamiento lateral de una franja, en píxeles de la imagen original.
  #onda(entrada, y, tiempo) {
    const p = this.#profundidad(entrada.mechon, y);
    if (p <= 0) return 0;
    // El retardo es lo que convierte el balanceo en una onda que viaja.
    const fase = tiempo * TUNING.brisaVelocidad - p * TUNING.brisaRetardo;
    const aire = entrada.ruido[0](fase) * .78 + entrada.ruido[1](fase * 2.4) * .22;
    return p * p * aire * NORMA * TUNING.brisaAmplitud;
  }

  // Peso lateral: 1 en el pelo suelto, 0 antes de llegar al cuerpo.
  #peso(mechon, x) {
    const t = (x - mechon.bordeInterior) / (mechon.bordeLibre - mechon.bordeInterior);
    return smoothstep(0, 1, clamp(t));
  }

  draw(ctx, image, view, hair) {
    const tiempo = hair?.tiempo ?? 0;
    const intensidad = clamp(hair?.intensidad ?? 1);
    if (intensidad <= .001) return;

    for (const entrada of this.mechones) {
      this.#dibujarMechon(ctx, image, view, entrada, tiempo, intensidad);
    }
  }

  #dibujarMechon(ctx, image, view, entrada, tiempo, intensidad) {
    const { mechon, bandas } = entrada;
    const { patch } = mechon;
    const { scale, pixelRatio } = view;
    const cssWidth = patch.width * scale;
    const cssHeight = patch.height * scale;
    const capa = entrada.surface.acquire(cssWidth, cssHeight, pixelRatio);

    const lx = x => (x - patch.x) * scale;
    const ly = y => (y - patch.y) * scale;

    // El borde interior mira hacia el cuerpo; hacia allí el campo se apaga y
    // hay que trocear. Del otro lado el desplazamiento es constante y se
    // resuelve con un solo estampado por franja.
    const haciaDerecha = mechon.bordeInterior > mechon.bordeLibre;
    const zonaIni = Math.min(mechon.bordeLibre, mechon.bordeInterior);
    const zonaFin = Math.max(mechon.bordeLibre, mechon.bordeInterior);

    for (let b = 0; b < bandas.length - 1; b += 1) {
      const yArriba = bandas[b];
      const yAbajo = bandas[b + 1];
      const alto = yAbajo - yArriba;

      // El recorrido en el borde de arriba y en el de abajo, no en el centro.
      // Desplazar la franja entera por igual dejaba un escalón en cada
      // frontera: medido, la discontinuidad ahí era trece veces la de una fila
      // cualquiera, y se veía como una línea horizontal cruzando el mechón.
      // Inclinando cada franja para que su borde inferior case con el superior
      // de la siguiente, el desplazamiento pasa a ser continuo y no hay nada
      // que ver.
      const arriba = this.#onda(entrada, yArriba, tiempo) * intensidad;
      const abajo = this.#onda(entrada, yAbajo, tiempo) * intensidad;
      if (Math.abs(arriba) < .02 && Math.abs(abajo) < .02) continue;

      // Al irse a un lado, la punta sube: describe un arco, no una recta.
      const subeArriba = -Math.abs(arriba) * TUNING.brisaElevacion;
      const subeAbajo = -Math.abs(abajo) * TUNING.brisaElevacion;
      const solape = 1;
      const altoCapa = alto * scale;

      const trozo = (x0, x1, peso) => {
        if (x1 <= x0 || peso <= .002) return;
        // Matriz que estira la franja entre sus dos bordes:
        //   x' = x + k·y + m      con k la inclinación por unidad de altura
        //   y' = d·y + f          para que el arco también sea continuo
        const k = (abajo - arriba) * peso / alto;
        const cima = ly(yArriba);
        const m = (arriba * peso) * scale - k * cima;
        const d = 1 + (subeAbajo - subeArriba) * peso * scale / altoCapa;
        const f = cima + subeArriba * peso * scale - d * cima;

        capa.save();
        capa.transform(1, 0, k, d, m, f);
        capa.drawImage(
          image,
          x0, yArriba, (x1 - x0) + solape, alto + solape,
          lx(x0), cima,
          ((x1 - x0) + solape) * scale, (alto + solape) * scale
        );
        capa.restore();
      };

      // Zona de peso pleno, de una sola vez.
      if (haciaDerecha) trozo(patch.x, zonaIni, 1);
      else trozo(zonaFin, patch.x + patch.width, 1);

      // Zona de apagado, troceada para que el estirado sea continuo.
      for (let x = zonaIni; x < zonaFin; x += COLUMNA) {
        const hasta = Math.min(x + COLUMNA, zonaFin);
        trozo(x, hasta, this.#peso(mechon, (x + hasta) / 2));
      }
    }

    entrada.surface.blit(
      ctx,
      view.dx + patch.x * scale,
      view.dy + patch.y * scale,
      cssWidth, cssHeight
    );
  }
}
