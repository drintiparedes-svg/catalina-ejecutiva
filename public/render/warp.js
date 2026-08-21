// Deformación por franjas.
//
// El retrato es una sola fotografía y no hay malla que deformar, así que el
// movimiento se consigue volviendo a dibujar franjas horizontales de la imagen,
// cada una en un sitio ligeramente distinto. Tres reglas evitan que se note:
//
//   · Traslación, no estiramiento. Una franja movida en bloque conserva la
//     trama de puntos exactamente como está; una estirada la recompone y se ve
//     más blanda. Sólo se estira la franja de transición junto al anclaje, que
//     es estrecha y cae donde el pelo se apoya en la cara o en el hombro.
//   · Cada franja se dibuja un píxel más alta de lo que mide, para que el
//     redondeo no deje una línea de fondo entre dos franjas contiguas.
//
// Trasladar sí es gratis en definición: medido en Chromium, una franja
// redibujada —quieta o corrida un número cualquiera de píxeles— sale idéntica a
// la fotografía dibujada de una pasada. Lo que la ablanda es estirarla, porque
// entonces cada punto de la trama se recompone entre dos vecinos.

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
  const { y, from, to, anchor = 0, stretch = 1, shiftX = 0, shiftY = 0 } = opciones;
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
