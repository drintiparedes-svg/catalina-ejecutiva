// Deformación por franjas.
//
// Toda la vida del retrato ocurre sobre una sola fotografía: no hay huesos ni
// malla, así que el movimiento se consigue volviendo a dibujar franjas
// horizontales de la imagen, cada una con su propia transformación. Dos reglas
// evitan las costuras:
//
//   · Ninguna franja se traslada en bloque: se estira alrededor de un ancla.
//     El punto anclado cae exactamente donde estaba y el resto se separa de él
//     de forma proporcional a la distancia. Así la frontera entre lo que se
//     mueve y lo que no queda inmóvil por construcción, sin máscaras ni
//     degradados que disimulen el corte.
//   · La copia estirada tapa siempre a la original. La franja se dibuja un
//     píxel más alta de lo que mide para que el redondeo a píxeles de pantalla
//     no deje una línea de fondo entre dos franjas contiguas.
//
// La altura de franja es el único compromiso: cuanto más fina, más suave es la
// onda y más llamadas de dibujo por cuadro. Seis píxeles de imagen dan pasos de
// menos de un píxel con la brisa a tope y unas trescientas llamadas por cuadro,
// que un teléfono asume sin despeinarse.

export const STRIP = 6;

// Curva definida por puntos [y, x] ordenados por altura, interpolada
// linealmente y sostenida más allá de los extremos.
export function sampleCurve(points, y) {
  if (y <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (y >= last[0]) return last[1];
  for (let i = 1; i < points.length; i += 1) {
    const [y1, x1] = points[i];
    if (y > y1) continue;
    const [y0, x0] = points[i - 1];
    return x0 + (x1 - x0) * ((y - y0) / (y1 - y0));
  }
  return last[1];
}

// Dibuja el tramo horizontal [from, to] de la franja que empieza en `y`,
// estirado un factor `stretch` alrededor de `anchor` y desplazado después por
// (shiftX, shiftY). Las coordenadas entran en píxeles de la imagen original y
// salen en píxeles de pantalla a través de `view`.
export function drawStrip(ctx, image, view, opciones) {
  const { y, from, to, anchor, stretch = 1, shiftX = 0, shiftY = 0 } = opciones;
  const width = to - from;
  if (width <= 0) return;

  const height = STRIP + 1;
  const destX = anchor + (from - anchor) * stretch + shiftX;
  ctx.drawImage(
    image,
    from, y, width, height,
    view.dx + destX * view.scale, view.dy + (y + shiftY) * view.scale,
    width * stretch * view.scale, height * view.scale
  );
}
