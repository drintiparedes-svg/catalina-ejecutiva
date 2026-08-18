/*
 * Catalina MediaStream adapter for @beer-digital/lipsync-engine.
 * Based on https://github.com/Amoner/lipsync-engine (MIT).
 * Copyright (c) 2025 Beer Digital LLC.
 *
 * The upstream engine supports PCM streaming, media elements and MediaStream.
 * Catalina only needs the MediaStream path, so this local build keeps the
 * upstream FFT classifier, viseme shapes and transition model without loading
 * its PCM playback AudioWorklet.
 */

const VISEME_SHAPES = {
  sil: { open: 0, width: .50, round: 0 },
  PP: { open: 0, width: .40, round: 0 },
  FF: { open: .10, width: .58, round: 0 },
  TH: { open: .18, width: .54, round: 0 },
  DD: { open: .30, width: .58, round: 0 },
  kk: { open: .56, width: .54, round: .04 },
  CH: { open: .38, width: .46, round: .30 },
  SS: { open: .10, width: .67, round: 0 },
  nn: { open: .24, width: .55, round: 0 },
  RR: { open: .28, width: .44, round: .30 },
  aa: { open: .90, width: .60, round: 0 },
  E: { open: .50, width: .65, round: 0 },
  I: { open: .25, width: .70, round: 0 },
  O: { open: .52, width: .38, round: .84 },
  U: { open: .20, width: .30, round: .90 }
};

const EXTENDED_TO_SIMPLE = {
  sil: "A", PP: "B", nn: "B", E: "C", I: "C", SS: "C",
  aa: "D", DD: "D", kk: "D", O: "E", RR: "E", CH: "E",
  FF: "F", TH: "F", U: "F"
};

const TRANSITION_WEIGHTS = {
  sil: { aa: .3, E: .3, I: .3, O: .3, U: .3, PP: .2, FF: .2 },
  aa: { sil: .4, E: .5, O: .6, I: .5, PP: .3, SS: .3 },
  PP: { aa: .2, sil: .2, E: .3, FF: .4 },
  FF: { aa: .3, PP: .4, sil: .2 },
  SS: { sil: .2, aa: .3, CH: .6 }
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (previous, next, factor) => previous + (next - previous) * factor;
const transitionWeight = (from, to) => TRANSITION_WEIGHTS[from]?.[to] ?? .35;

class EventEmitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    const listeners = this.#listeners.get(event);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#listeners.delete(event);
  }

  emit(event, ...args) {
    this.#listeners.get(event)?.forEach(listener => listener(...args));
  }

  removeAllListeners() {
    this.#listeners.clear();
  }
}

class FrequencyAnalyzer {
  constructor(analyser, sampleRate, options = {}) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.options = {
      silenceThreshold: .010,
      smoothingFactor: .42,
      holdFrames: 2,
      intensitySmoothing: .28,
      ...options
    };
    this.timeData = new Uint8Array(analyser.fftSize);
    this.frequencyData = new Uint8Array(analyser.frequencyBinCount);
    this.currentViseme = "sil";
    this.previousViseme = "sil";
    this.currentIntensity = 0;
    this.smoothedAmplitude = 0;
    this.smoothedBands = { sub: 0, low: 0, mid: 0, high: 0, veryHigh: 0 };
    this.holdCounter = 0;
    this.transitionProgress = 1;
    this.frameCount = 0;
  }

  analyze() {
    this.frameCount += 1;
    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.frequencyData);

    let squares = 0;
    for (const byte of this.timeData) {
      const sample = (byte - 128) / 128;
      squares += sample * sample;
    }
    const amplitude = Math.sqrt(squares / this.timeData.length);
    this.smoothedAmplitude = smooth(
      this.smoothedAmplitude,
      amplitude,
      amplitude > this.smoothedAmplitude ? .58 : this.options.smoothingFactor
    );

    const rawBands = this.extractBands();
    for (const key of Object.keys(rawBands)) {
      this.smoothedBands[key] = smooth(
        this.smoothedBands[key],
        rawBands[key],
        this.options.smoothingFactor
      );
    }

    if (this.smoothedAmplitude < this.options.silenceThreshold) {
      return this.emitViseme("sil", 0, .95);
    }

    const intensity = clamp((this.smoothedAmplitude - this.options.silenceThreshold) * 8.5);
    const candidate = this.classify(this.smoothedBands, intensity);
    if (candidate.viseme !== this.currentViseme) {
      this.holdCounter += 1;
      if (this.holdCounter < this.options.holdFrames) {
        return this.emitViseme(this.currentViseme, intensity, candidate.confidence * .8);
      }
      this.holdCounter = 0;
    } else {
      this.holdCounter = 0;
    }
    return this.emitViseme(candidate.viseme, intensity, candidate.confidence);
  }

  extractBands() {
    const ranges = {
      sub: [40, 160],
      low: [160, 600],
      mid: [600, 2200],
      high: [2200, 6000],
      veryHigh: [6000, 12000]
    };
    const hzPerBin = this.sampleRate / this.analyser.fftSize;
    const result = {};
    for (const [name, [fromHz, toHz]] of Object.entries(ranges)) {
      const from = Math.max(1, Math.floor(fromHz / hzPerBin));
      const to = Math.min(this.frequencyData.length, Math.ceil(toHz / hzPerBin));
      let energy = 0;
      let count = 0;
      for (let index = from; index < to; index += 1) {
        const normalized = this.frequencyData[index] / 255;
        energy += normalized * normalized;
        count += 1;
      }
      result[name] = count ? Math.sqrt(energy / count) : 0;
    }
    return result;
  }

  classify(bands, intensity) {
    const { sub, low, mid, high, veryHigh } = bands;
    const total = sub + low + mid + high + veryHigh;
    if (total < .01) return { viseme: "sil", confidence: .9 };

    const sibilant = (high + veryHigh) / (total + .001);
    if (sibilant > .55 && high > .15) {
      return { viseme: veryHigh > high * .8 ? "SS" : "CH", confidence: sibilant };
    }
    const fricative = (mid + high) / (total + .001);
    if (fricative > .5 && high > .1 && low < .15) {
      return { viseme: "FF", confidence: fricative * .8 };
    }
    const flatness = 1 - Math.abs(high - low) / (total + .001);
    if (intensity > .6 && flatness > .7 && this.smoothedAmplitude > .08) {
      return { viseme: low > mid ? "PP" : "DD", confidence: .6 };
    }
    if (sub > .2 && low > .15 && high < .08 && mid < low * .7) {
      return { viseme: "nn", confidence: .65 };
    }
    if (low > .2 && mid > .15 && intensity > .5) return { viseme: "aa", confidence: .7 };
    if (mid > low && mid > .15 && intensity > .3) return { viseme: "E", confidence: .65 };
    if (sub > mid && low > mid && intensity > .3) return { viseme: "O", confidence: .6 };
    if (mid > .1 && high > low * .5 && intensity > .2) return { viseme: "I", confidence: .55 };
    if (sub > .15 && high < .05) return { viseme: "U", confidence: .5 };
    if (intensity > .5) return { viseme: "aa", confidence: .4 };
    if (intensity > .3) return { viseme: "E", confidence: .35 };
    if (intensity > .15) return { viseme: "I", confidence: .3 };
    return { viseme: "sil", confidence: .5 };
  }

  emitViseme(viseme, intensity, confidence = .5) {
    if (viseme !== this.currentViseme) {
      this.previousViseme = this.currentViseme;
      this.currentViseme = viseme;
      this.transitionProgress = 0;
    } else {
      const weight = transitionWeight(this.previousViseme, this.currentViseme);
      this.transitionProgress = Math.min(1, this.transitionProgress + (1 - weight) * .3);
    }
    this.currentIntensity = smooth(
      this.currentIntensity,
      intensity,
      this.options.intensitySmoothing
    );
    const previous = VISEME_SHAPES[this.previousViseme] || VISEME_SHAPES.sil;
    const current = VISEME_SHAPES[this.currentViseme] || VISEME_SHAPES.sil;
    const t = this.transitionProgress;
    return {
      viseme: this.currentViseme,
      simpleViseme: EXTENDED_TO_SIMPLE[this.currentViseme] || "A",
      intensity: this.currentIntensity,
      confidence,
      amplitude: this.smoothedAmplitude,
      bands: { ...this.smoothedBands },
      shape: {
        open: previous.open + (current.open - previous.open) * t,
        width: previous.width + (current.width - previous.width) * t,
        round: previous.round + (current.round - previous.round) * t
      },
      transition: {
        from: this.previousViseme,
        to: this.currentViseme,
        progress: this.transitionProgress
      },
      frame: this.frameCount,
      timeMs: performance.now()
    };
  }
}

export class LipSyncEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      fftSize: 1024,
      analyserSmoothing: .22,
      ...options
    };
    this.audioContext = null;
    this.analyserNode = null;
    this.sourceNode = null;
    this.analyzer = null;
    this.animationFrame = 0;
    this.initialized = false;
    this.analyzing = false;
  }

  async init(existingContext) {
    if (this.initialized) return;
    this.audioContext = existingContext || new AudioContext();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = this.options.fftSize;
    this.analyserNode.smoothingTimeConstant = this.options.analyserSmoothing;
    this.analyzer = new FrequencyAnalyzer(this.analyserNode, this.audioContext.sampleRate, this.options);
    this.initialized = true;
    this.emit("initialized");
  }

  async resume() {
    if (this.audioContext?.state === "suspended") await this.audioContext.resume();
  }

  attachStream(stream) {
    if (!this.initialized) throw new Error("LipSyncEngine no está inicializado");
    try { this.sourceNode?.disconnect(); } catch {}
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(this.analyserNode);
    this.emit("sourceAttached", { type: "stream" });
  }

  startAnalysis() {
    if (this.analyzing) return;
    this.analyzing = true;
    const tick = () => {
      if (!this.analyzing) return;
      this.emit("viseme", this.analyzer.analyze());
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
    this.emit("analysisStarted");
  }

  destroy() {
    this.analyzing = false;
    cancelAnimationFrame(this.animationFrame);
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.analyserNode?.disconnect(); } catch {}
    if (this.audioContext?.state !== "closed") this.audioContext?.close().catch(() => {});
    this.sourceNode = null;
    this.analyserNode = null;
    this.analyzer = null;
    this.audioContext = null;
    this.initialized = false;
    this.removeAllListeners();
  }
}

export { VISEME_SHAPES };
