// Utilidades numéricas compartidas por la animación facial.
// Todo aquí es puro: no toca el DOM y se puede ejecutar en Node para las
// pruebas de render de work/render_contact_sheet.mjs.

export const clamp = (value, min = 0, max = 1) =>
  value < min ? min : value > max ? max : value;

export const mix = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// Interpolación exponencial independiente de la tasa de cuadros. `tau` es el
// tiempo (en segundos) en el que se recorre ~63% de la distancia al objetivo.
export function damp(value, target, dt, tau) {
  if (tau <= 0) return target;
  return target + (value - target) * Math.exp(-dt / tau);
}

// Resorte críticamente amortiguado con solución analítica: estable aunque el
// navegador pierda cuadros y sin rebote mecánico.
export function spring(value, velocity, target, dt, frequency, damping = .92) {
  const omega = frequency * Math.max(.6, damping);
  const displacement = value - target;
  const decay = Math.exp(-omega * dt);
  const movement = (velocity + omega * displacement) * dt;
  return [
    target + (displacement + movement) * decay,
    (velocity - omega * movement) * decay
  ];
}

export const easeOutCubic = value => 1 - Math.pow(1 - value, 3);
export const easeInOutCubic = value =>
  value < .5 ? 4 * value ** 3 : 1 - Math.pow(-2 * value + 2, 3) / 2;
export const easeOutQuint = value => 1 - Math.pow(1 - value, 5);

const fract = value => value - Math.floor(value);
const hash = value => fract(Math.sin(value * 12.9898) * 43758.5453123);

// Ruido de valor con varias octavas. Produce una deriva orgánica que nunca se
// repite en bucle corto, a diferencia de sumar senos con periodos fijos.
export function createNoise(seed = 1) {
  const offset = seed * 17.317 + 3.1;
  return function noise(t) {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let octave = 0; octave < 3; octave += 1) {
      const x = t * frequency + offset * (octave + 1);
      const cell = Math.floor(x);
      const f = x - cell;
      const u = f * f * (3 - 2 * f);
      const a = hash(cell + offset) * 2 - 1;
      const b = hash(cell + 1 + offset) * 2 - 1;
      sum += mix(a, b, u) * amplitude;
      norm += amplitude;
      amplitude *= .5;
      frequency *= 2.17;
    }
    return sum / norm;
  };
}

// Rango aleatorio con distribución uniforme; centraliza el uso de Math.random
// para poder sembrarlo si algún día se quiere una toma reproducible.
export const range = (min, max) => min + Math.random() * (max - min);
