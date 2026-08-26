// Boca guiada por la alineación de ElevenLabs.
//
// Hasta ahora la boca se deducía del espectro: se miraban los formantes del
// audio que ya sonaba y se adivinaba qué vocal era. Funciona, pero es adivinar.
//
// ElevenLabs manda, junto a cada trozo de audio, en qué milisegundo empieza y
// cuánto dura **cada carácter** que está pronunciando. Con eso no hay que
// adivinar nada: se sabe qué letra suena en cada instante. Y en español la letra
// y el fonema casi coinciden, que es justo lo que hace viable el mapa de abajo
// —en inglés no lo sería—.
//
// Lo que sí sigue viniendo del audio es la *intensidad*: cuánta voz hay ahora
// mismo. La forma la pone la alineación; la fuerza, el analizador. Cada uno en
// lo que es bueno.
//
// El reloj es de reproducción, no de reloj de pared: el reproductor va contando
// las muestras que de verdad han salido por la tarjeta de sonido, así que la
// boca no se adelanta cuando la red trae el audio a ráfagas.

import { clamp, mix } from "../animation/math.js";

// Postura de cada sonido, en los mismos cuatro mandos que ya entiende el rostro
// (render/mouth-layer.js): apertura, estirado, redondeo y cierre labial.
//
// Los valores no son teoría: son los mismos rangos con los que se calibró la
// boca en el banco de pruebas. Una /a/ abre; una /i/ estira sin abrir; una /u/
// redondea y cierra; una /m/ junta los labios del todo.
const REPOSO = { open: 0, spread: .5, round: .12, press: 0 };

const SONIDOS = {
  // Vocales. Son las que mandan: sostienen el sonido y son las que se ven.
  a: { open: .95, spread: .58, round: .05, press: 0 },
  e: { open: .55, spread: .72, round: .04, press: 0 },
  i: { open: .22, spread: .88, round: .02, press: 0 },
  o: { open: .58, spread: .30, round: .72, press: 0 },
  u: { open: .30, spread: .18, round: .95, press: 0 },

  // Bilabiales: los labios se cierran. Es el gesto más visible de todos y el
  // que más delata a un avatar cuando falta.
  p: { open: .04, spread: .46, round: .18, press: .95 },
  b: { open: .06, spread: .46, round: .18, press: .90 },
  m: { open: .03, spread: .48, round: .14, press: .95 },

  // Labiodentales: el labio de abajo toca los dientes de arriba.
  f: { open: .16, spread: .60, round: .06, press: .55 },
  v: { open: .16, spread: .60, round: .06, press: .50 },

  // Sibilantes: casi cerrada y estirada, con los dientes juntos.
  s: { open: .16, spread: .84, round: .04, press: .12 },
  z: { open: .18, spread: .80, round: .05, press: .10 },
  x: { open: .22, spread: .78, round: .06, press: .08 },

  // Alveolares y dentales: la lengua trabaja, los labios apenas.
  t: { open: .26, spread: .64, round: .06, press: .10 },
  d: { open: .30, spread: .62, round: .06, press: .08 },
  n: { open: .24, spread: .58, round: .08, press: .16 },
  l: { open: .38, spread: .60, round: .08, press: 0 },
  r: { open: .36, spread: .58, round: .10, press: 0 },

  // Velares: se abren por detrás, y en pantalla se leen como una apertura
  // media sin estirar.
  k: { open: .42, spread: .52, round: .10, press: 0 },
  g: { open: .44, spread: .52, round: .10, press: 0 },
  j: { open: .46, spread: .48, round: .14, press: 0 },

  // Palatales.
  y: { open: .30, spread: .74, round: .06, press: 0 },
  ñ: { open: .28, spread: .66, round: .08, press: .14 },

  // Silencio con la boca en reposo.
  " ": REPOSO
};

// Letras que suenan como otras. Se resuelve aquí y no en el mapa para que el
// mapa siga siendo legible como lo que es: una lista de sonidos.
const EQUIVALENCIAS = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u",
  c: "k",       // «casa»; ante e/i lo corrige `sonidoDe`
  q: "k",
  h: "",        // muda en español: no mueve la boca
  w: "u",
  ll: "y"
};

// Cuánto dura la transición entre dos posturas. La boca no salta: un labio
// tarda unos 60 ms en llegar de un sitio a otro, y con menos de eso el rostro
// parece parpadear de gesto.
const TRANSICION_MS = 60;

// Cuánto se sostiene la última postura cuando se acaba la alineación pero el
// audio sigue sonando. Sin esto, la boca se cierra de golpe al final de cada
// trozo y luego vuelve a abrirse: da un tartamudeo que no está en la voz.
const COLA_MS = 90;

function sonidoDe(letra, siguiente) {
  const bruto = String(letra ?? "").toLowerCase();
  if (!bruto.trim()) return REPOSO;

  // La c es /k/ salvo ante e o i, donde es sibilante. Es la única regla
  // ortográfica del español que cambia bastante la boca.
  if (bruto === "c") {
    const proxima = String(siguiente ?? "").toLowerCase();
    return SONIDOS[proxima === "e" || proxima === "i" ? "s" : "k"];
  }

  const equivalente = EQUIVALENCIAS[bruto];
  if (equivalente === "") return null;              // muda: no cambia nada
  const clave = equivalente ?? bruto;
  return SONIDOS[clave] ?? null;
}

export class VisemasAlineados {
  constructor() {
    this.eventos = [];        // { desde, hasta, postura } en segundos de reproducción
    this.ultimoFin = 0;
  }

  // Añade la alineación de un trozo de audio. `origen` es el segundo de
  // reproducción en el que ese trozo empieza a sonar, que lo sabe quien encola
  // el audio: es la cuenta de muestras ya encoladas dividida por la frecuencia.
  agregar(alineacion, origen) {
    const letras = alineacion?.chars;
    const inicios = alineacion?.char_start_times_ms;
    const duraciones = alineacion?.char_durations_ms;
    if (!Array.isArray(letras) || !Array.isArray(inicios)) return;

    for (let i = 0; i < letras.length; i += 1) {
      const postura = sonidoDe(letras[i], letras[i + 1]);
      if (!postura) continue;                       // letra muda

      const desde = origen + (inicios[i] ?? 0) / 1000;
      const dura = Math.max(.02, (duraciones?.[i] ?? 60) / 1000);
      this.eventos.push({ desde, hasta: desde + dura, postura });
      this.ultimoFin = Math.max(this.ultimoFin, desde + dura);
    }
  }

  // Se tira lo ya reproducido para que la lista no crezca durante una
  // conversación larga. Se deja un segundo de margen por si el reloj retrocede.
  #podar(tiempo) {
    if (this.eventos.length < 64) return;
    const corte = tiempo - 1;
    let primero = 0;
    while (primero < this.eventos.length && this.eventos[primero].hasta < corte) primero += 1;
    if (primero > 0) this.eventos.splice(0, primero);
  }

  vaciar() {
    this.eventos.length = 0;
    this.ultimoFin = 0;
  }

  get vacio() {
    return this.eventos.length === 0;
  }

  // Postura de la boca en ese segundo de reproducción, ya mezclada con la
  // siguiente para que el paso de un sonido a otro sea continuo.
  postura(tiempo) {
    this.#podar(tiempo);
    if (!this.eventos.length || tiempo > this.ultimoFin + COLA_MS / 1000) return null;

    let actual = null;
    let proxima = null;
    for (const evento of this.eventos) {
      if (evento.hasta < tiempo) { actual = evento; continue; }
      if (evento.desde <= tiempo) { actual = evento; continue; }
      proxima = evento;
      break;
    }
    if (!actual && !proxima) return null;
    if (!actual) return { ...proxima.postura };
    if (!proxima) return { ...actual.postura };

    // Coarticulación: la boca ya va camino del sonido siguiente antes de que
    // suene. Por eso la mezcla arranca `TRANSICION_MS` antes de su inicio.
    const arranque = proxima.desde - TRANSICION_MS / 1000;
    if (tiempo <= arranque) return { ...actual.postura };

    const t = clamp((tiempo - arranque) / (TRANSICION_MS / 1000));
    const suave = t * t * (3 - 2 * t);
    return {
      open: mix(actual.postura.open, proxima.postura.open, suave),
      spread: mix(actual.postura.spread, proxima.postura.spread, suave),
      round: mix(actual.postura.round, proxima.postura.round, suave),
      press: mix(actual.postura.press, proxima.postura.press, suave)
    };
  }
}
