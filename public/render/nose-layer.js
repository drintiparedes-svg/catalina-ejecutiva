// Respiración nasal basal.
//
// Durante la ventilación tranquila la nariz no «se infla»: casi todo el cambio
// visible ocurre en la válvula nasal externa, el ala y el borde de la narina.
// El dorso permanece prácticamente inmóvil y hace de ancla visual, que es lo
// que permite percibir el movimiento periférico sin que la cara entera parezca
// moverse.
//
// Al inspirar, la presión intranasal negativa tendería a colapsar las paredes
// laterales; lo que se ve en su lugar es la consecuencia de los dilatadores
// —nasalis y dilatador de la narina— estabilizando y abriendo ligeramente el
// ala. Por eso el vector del ala no es sólo lateral: lleva componente lateral,
// algo inferior y una insinuación anterior, que aquí se representa con un
// realce mínimo de luz en vez de con profundidad real.
//
// Al espirar no hay compresión: hay retorno elástico. La nariz nunca se cierra
// por debajo de su geometría basal, así que el recorrido va de 0 a 1 y vuelve,
// sin valores negativos.

import { clamp, mix, smoothstep } from "../animation/math.js";
import { TUNING } from "../animation/tuning.js";
import { NOSE } from "./rig.js";
import { Surface } from "./surface.js";

// Bandas horizontales. Se agolpan alrededor del ala, que es donde el
// desplazamiento cambia deprisa, y se espacian en el dorso, donde es casi
// constante.
// Las de los extremos caen fuera del perfil y no desplazan nada: existen para
// que la capa cubra el parche entero y el margen quede estampado tal cual.
const BANDAS = [
  268,
  276, 288, 298, 308, 316, 324, 330, 336, 341, 346, 350, 354,
  358, 363
];

export class NoseLayer {
  constructor(createSurfaceImpl) {
    this.surface = new Surface(createSurfaceImpl);
  }

  // Peso vertical: se interpola entre las anclas del rig, de modo que el
  // gradiente es continuo y no hay fronteras entre zonas.
  #pesoVertical(y) {
    const perfil = NOSE.perfilY;
    if (y <= perfil[0].y || y >= perfil[perfil.length - 1].y) return 0;
    for (let i = 0; i < perfil.length - 1; i += 1) {
      const a = perfil[i];
      const b = perfil[i + 1];
      if (y >= a.y && y <= b.y) {
        return mix(a.peso, b.peso, smoothstep(a.y, b.y, y));
      }
    }
    return 0;
  }

  // Peso horizontal: mínimo en la columela, máximo en el borde alar, y de
  // vuelta a cero en el tejido perinasal.
  #pesoHorizontal(distancia) {
    const { columelaPeso, columelaAncho, alarHalfWidth, alcance } = NOSE;
    if (distancia >= alcance) return 0;
    if (distancia <= columelaAncho) return columelaPeso;
    if (distancia <= alarHalfWidth) {
      return mix(columelaPeso, 1, smoothstep(columelaAncho, alarHalfWidth, distancia));
    }
    return 1 - smoothstep(alarHalfWidth, alcance, distancia);
  }

  // Desplazamiento de un punto del retrato, en píxeles de la imagen original.
  #campo(x, y, apertura) {
    const dx = x - NOSE.centerX;
    const lado = dx < 0 ? -1 : 1;
    const peso = this.#pesoVertical(y) * this.#pesoHorizontal(Math.abs(dx));
    if (peso <= 0) return { x: 0, y: 0, peso: 0 };

    // Una diferencia fija entre lados, no una alternancia: simetría perfecta
    // delata que es una animación.
    const asimetria = lado < 0 ? 1 : TUNING.nasalAsimetria;
    const recorrido = apertura * peso * TUNING.nasalApertura * asimetria;

    return {
      x: recorrido * lado,
      y: recorrido * TUNING.nasalDescenso,   // el ala baja un poco al abrirse
      peso
    };
  }

  draw(ctx, image, view, apertura) {
    const abierto = clamp(apertura ?? 0);
    // Con la nariz en reposo no hay nada que recomponer, y evitarlo ahorra un
    // parche entero por cuadro.
    if (abierto < .004) return;

    const { patch, mask } = NOSE;
    const { scale, pixelRatio } = view;
    const cssWidth = patch.width * scale;
    const cssHeight = patch.height * scale;
    const layer = this.surface.acquire(cssWidth, cssHeight, pixelRatio);

    const lx = x => (x - patch.x) * scale;
    const ly = y => (y - patch.y) * scale;

    // Columnas finas: el desplazamiento varía con x dentro de cada banda, y
    // sólo troceando se consigue un estirado continuo en vez de un bloque que
    // se traslada.
    const columnas = [];
    for (let x = patch.x; x < patch.x + patch.width; x += 5) columnas.push(x);
    columnas.push(patch.x + patch.width);

    for (let b = 0; b < BANDAS.length - 1; b += 1) {
      const yArriba = BANDAS[b];
      const yAbajo = BANDAS[b + 1];
      const yMedio = (yArriba + yAbajo) / 2;

      // Las bandas del margen no desplazan nada, y estamparlas no sería
      // inofensivo: el parche de la nariz se solapa con el de la boca, así que
      // volver a poner ahí los píxeles originales borraría la deformación que
      // la boca acaba de dibujar. Se dejan sin tocar.
      if (this.#pesoVertical(yMedio) <= 0) continue;

      for (let c = 0; c < columnas.length - 1; c += 1) {
        const xIzq = columnas[c];
        const xDer = columnas[c + 1];
        const desplazamiento = this.#campo((xIzq + xDer) / 2, yMedio, abierto);

        // Un pelo de solape evita las costuras claras entre trozos vecinos.
        const solape = 1;
        layer.drawImage(
          image,
          xIzq, yArriba, (xDer - xIzq) + solape, (yAbajo - yArriba) + solape,
          lx(xIzq + desplazamiento.x), ly(yArriba + desplazamiento.y),
          ((xDer - xIzq) + solape) * scale, ((yAbajo - yArriba) + solape) * scale
        );
      }
    }

    // Insinuación de que el tejido viene hacia delante. No hay profundidad real
    // en una fotografía, así que se sugiere con un realce de luz mínimo sobre
    // cada ala; subirlo mucho convierte la respiración en un destello.
    const relieve = TUNING.nasalRelieve * abierto;
    if (relieve > .001) {
      layer.save();
      layer.globalCompositeOperation = "lighter";
      for (const lado of [-1, 1]) {
        const cx = lx(NOSE.centerX + lado * (NOSE.alarHalfWidth - 6));
        const cy = ly(342);
        const radio = 16 * scale;
        const brillo = layer.createRadialGradient(cx, cy, 0, cx, cy, radio);
        brillo.addColorStop(0, `rgba(190,225,245,${relieve})`);
        brillo.addColorStop(1, "rgba(190,225,245,0)");
        layer.fillStyle = brillo;
        layer.fillRect(cx - radio, cy - radio, radio * 2, radio * 2);
      }
      layer.restore();
    }

    this.surface.feather(cssWidth, cssHeight, {
      centerX: (mask.centerX - patch.x) * scale,
      centerY: (mask.centerY - patch.y) * scale,
      radiusX: mask.radiusX * scale,
      radiusY: mask.radiusY * scale,
      solid: mask.solid
    });

    this.surface.blit(
      ctx,
      view.dx + patch.x * scale,
      view.dy + patch.y * scale,
      cssWidth, cssHeight
    );
  }
}
