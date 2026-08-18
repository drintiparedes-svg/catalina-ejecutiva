// Puente entre el audio de la conversación y la boca.
//
// El motor local `lipsync-engine` (MIT, ver public/vendor) aporta la fontanería
// de audio y su clasificador de visemas; sobre su mismo AnalyserNode corre el
// análisis continuo de VoiceShape. Del visema sólo se aprovechan las pistas
// consonánticas, que el espectro por sí solo distingue peor.

import { LipSyncEngine } from "../vendor/lipsync-engine/lipsync-engine.js";
import { VoiceShape } from "./voice-shape.js";
import { clamp } from "../animation/math.js";

const SILENT = { active: false, energy: 0, open: 0, spread: .5, round: .12, press: 0 };

export class VoiceTracker {
  constructor() {
    this.engine = null;
    this.shape = null;
    this.frame = null;
    this.frameAt = 0;
  }

  async attach(stream) {
    await this.destroy();
    this.engine = new LipSyncEngine({
      fftSize: 2048,
      analyserSmoothing: .16,
      silenceThreshold: .010,
      smoothingFactor: .40,
      holdFrames: 2,
      intensitySmoothing: .25
    });
    await this.engine.init();
    this.engine.on("viseme", frame => {
      this.frame = frame;
      this.frameAt = performance.now();
    });
    this.engine.attachStream(stream);
    this.engine.startAnalysis();
    this.shape = new VoiceShape(this.engine.analyserNode, this.engine.audioContext.sampleRate);
  }

  async resume() {
    await this.engine?.resume().catch(() => {});
  }

  read(now) {
    if (!this.shape) return SILENT;
    const voice = this.shape.read(now);
    const fresh = this.frame && now - this.frameAt < 160 ? this.frame : null;

    if (fresh) {
      // Oclusiva bilabial: el espectro apenas la ve, el clasificador sí.
      if (fresh.viseme === "PP") {
        voice.press = Math.max(voice.press, .82);
        voice.open = Math.min(voice.open, .05);
      }
      // Labiodental /f,v/: el labio inferior toca los incisivos.
      if (fresh.viseme === "FF") {
        voice.open = clamp(Math.min(voice.open, .16));
        voice.spread = Math.max(voice.spread, .58);
        voice.round = Math.min(voice.round, .1);
      }
      // Nasales sostenidas: labios juntos sin llegar a apretar.
      if (fresh.viseme === "nn" && voice.energy < .45) {
        voice.press = Math.max(voice.press, .38);
      }
    }
    return voice;
  }

  async destroy() {
    this.engine?.destroy();
    this.engine = null;
    this.shape = null;
    this.frame = null;
    this.frameAt = 0;
  }
}
