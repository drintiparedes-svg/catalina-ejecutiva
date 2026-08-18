// Forma de la boca a partir del espectro de la voz.
//
// El clasificador de visemas del motor original elige entre quince posturas
// fijas, y ese salto discreto es lo que hace que todas las sílabas se vean
// iguales. Aquí se estima el espectro de forma continua:
//
//   · F1 (250–1050 Hz) sube con la apertura de la mandíbula: /i,u/ ≈ 300 Hz,
//     /a/ ≈ 750 Hz.
//   · F2 (950–2900 Hz) separa las vocales anteriores de las posteriores:
//     /i/ ≈ 2300 Hz (labios estirados), /u/ ≈ 900 Hz (labios redondeados).
//   · La energía por encima de 4 kHz delata las sibilantes /s/ y /ʃ/.
//   · Una caída brusca de energía entre dos tramos sonoros es un cierre
//     bilabial: /p/, /b/, /m/.
//
// El resultado es un triple continuo (apertura, estiramiento, redondeo) que se
// mueve como una boca real en vez de saltar entre posturas.

import { clamp, damp, smoothstep } from "../animation/math.js";
import { TUNING } from "../animation/tuning.js";

// Calibración. Los rangos de búsqueda son los formantes de una voz femenina;
// los valores de mapeo están ajustados sobre la distribución real de la voz de
// la API (F1: p25≈360, mediana≈418, p75≈500, máx≈786; F2: p25≈1304,
// mediana≈1496, p75≈1789, máx≈2610). Con la calibración teórica de libro la
// boca apenas se abría, porque el habla conversacional casi nunca llega a los
// extremos de la tabla de vocales aisladas.
//
// Los dos cortes de F1 y la ganancia de apertura viven en TUNING porque son los
// que se afinan a ojo desde el banco de pruebas; el resto es fijo.
const F1_RANGE = [250, 1050];
const F2_RANGE = [950, 2900];
const F2_BACK = 1050;
const F2_FRONT = 2050;

// Umbrales del cierre bilabial, en sonoridad normalizada. Deben ser estrechos:
// si se abren, cada bache de energía entre sílabas se lee como una /p/ y la
// boca acaba masticando.
const CLOSURE_QUIET = .10;
const CLOSURE_LOUD = .40;

export class VoiceShape {
  constructor(analyser, sampleRate) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.binHz = sampleRate / analyser.fftSize;
    this.spectrum = new Float32Array(analyser.frequencyBinCount);
    this.envelope = new Float32Array(analyser.frequencyBinCount);
    this.time = new Uint8Array(analyser.fftSize);

    this.energy = 0;
    this.peakEnergy = .12;
    this.recentLoudness = 0;
    this.f1 = 500;
    this.f2 = 1500;
    this.sibilance = 0;
    this.press = 0;
    this.lastAt = 0;
  }

  #bin(hz) {
    return clamp(Math.round(hz / this.binHz), 1, this.spectrum.length - 1);
  }

  // Centroide ponderado por potencia dentro de una banda. Se prefiere al pico
  // absoluto porque se desplaza de forma continua entre cuadros.
  #centroid(fromHz, toHz) {
    const from = this.#bin(fromHz);
    const to = this.#bin(toHz);
    let weighted = 0;
    let total = 0;
    for (let index = from; index <= to; index += 1) {
      const value = this.envelope[index] ** 2;
      weighted += value * index * this.binHz;
      total += value;
    }
    return total > 1e-9 ? weighted / total : (fromHz + toHz) / 2;
  }

  #bandEnergy(fromHz, toHz) {
    const from = this.#bin(fromHz);
    const to = this.#bin(toHz);
    let sum = 0;
    for (let index = from; index <= to; index += 1) sum += this.envelope[index] ** 2;
    return Math.sqrt(sum / Math.max(1, to - from + 1));
  }

  read(nowMs) {
    const now = nowMs / 1000;
    const dt = this.lastAt ? clamp(now - this.lastAt, .004, .08) : .0167;
    this.lastAt = now;

    this.analyser.getFloatFrequencyData(this.spectrum);
    this.analyser.getByteTimeDomainData(this.time);

    let squares = 0;
    for (const byte of this.time) {
      const sample = (byte - 128) / 128;
      squares += sample * sample;
    }
    const amplitude = Math.sqrt(squares / this.time.length);
    this.energy = damp(this.energy, amplitude, dt, amplitude > this.energy ? .012 : .055);

    // Normalización lenta: la voz de la API no siempre llega al mismo nivel.
    this.peakEnergy = Math.max(.06, damp(this.peakEnergy, Math.max(this.energy, .06), dt, this.energy > this.peakEnergy ? .25 : 6));
    const loudness = clamp(this.energy / (this.peakEnergy * .82));

    // Envolvente espectral: promedio móvil de ~300 Hz que borra la estructura
    // armónica y deja visible la forma del tracto vocal.
    const window = Math.max(2, Math.round(300 / this.binHz / 2));
    for (let index = 0; index < this.spectrum.length; index += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -window; k <= window; k += 1) {
        const j = index + k;
        if (j < 1 || j >= this.spectrum.length) continue;
        const db = this.spectrum[j];
        sum += db > -110 ? 10 ** (db / 20) : 0;
        count += 1;
      }
      this.envelope[index] = count ? sum / count : 0;
    }

    const low = this.#bandEnergy(90, 350);
    const mid = this.#bandEnergy(350, 2500);
    const high = this.#bandEnergy(3800, 7000);
    const veryHigh = this.#bandEnergy(7000, 12000);
    const total = low + mid + high + veryHigh + 1e-9;

    const active = this.energy > .012;
    const rawSibilance = (high + veryHigh) / total;
    this.sibilance = damp(this.sibilance, active ? rawSibilance : 0, dt, .035);

    if (active) {
      this.f1 = damp(this.f1, this.#centroid(...F1_RANGE), dt, .030);
      this.f2 = damp(this.f2, this.#centroid(...F2_RANGE), dt, .038);
    }

    const openness = clamp((this.f1 - TUNING.f1Closed) / (TUNING.f1Open - TUNING.f1Closed));
    const frontness = clamp((this.f2 - F2_BACK) / (F2_FRONT - F2_BACK));

    // La media móvil larga guarda memoria de si veníamos hablando: es lo que
    // permite leer un silencio breve como cierre de labios y no como pausa. Se
    // mide sobre la sonoridad normalizada, no sobre la amplitud cruda, porque
    // el nivel absoluto que entrega la API varía de una sesión a otra.
    this.recentLoudness = damp(
      this.recentLoudness, loudness, dt, loudness > this.recentLoudness ? .05 : .55
    );
    const closure = smoothstep(CLOSURE_QUIET * 1.9, CLOSURE_QUIET, loudness)
      * smoothstep(CLOSURE_LOUD * .7, CLOSURE_LOUD, this.recentLoudness);

    let open = openness * (.55 + .45 * loudness) * TUNING.openGain
      * smoothstep(.015, .09, this.energy);
    let spread = .5 + (frontness - .5) * .62;
    let round = clamp((.55 - frontness) / .55) * (1 - openness * .75);

    // Sibilantes: dientes casi juntos. /s/ concentra energía por encima de
    // 7 kHz y estira los labios; /ʃ/ («ch», «sh») baja el pico y los redondea.
    const sibilant = smoothstep(.34, .55, this.sibilance);
    if (sibilant > .01) {
      const sharp = clamp(veryHigh / (high + veryHigh + 1e-9));
      open = mix2(open, .12, sibilant);
      spread = mix2(spread, sharp > .5 ? .74 : .44, sibilant);
      round = mix2(round, sharp > .5 ? .04 : .42, sibilant);
    }

    this.press = damp(this.press, closure * .85, dt, closure > this.press ? .022 : .07);

    return {
      active,
      energy: loudness,
      open: clamp(open),
      spread: clamp(spread, .12, .92),
      round: clamp(round),
      press: clamp(this.press),
      f1: this.f1,
      f2: this.f2,
      sibilance: this.sibilance
    };
  }
}

const mix2 = (a, b, t) => a + (b - a) * t;
