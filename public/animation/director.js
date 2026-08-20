// Dirección de actuación.
//
// Convierte el estado de la conversación y la energía de la voz en una pose
// completa: cabeza, mirada, párpados, cejas, respiración y boca. La idea es que
// nada dependa de un bucle fijo. Cada gesto tiene su propio reloj, su propia
// irregularidad y una razón para ocurrir (una sílaba acentuada, un cambio de
// turno, una pausa larga), que es lo que distingue a una persona de un títere.
//
// Estados: "idle" (sin conexión), "listening", "thinking" y "speaking".

import {
  clamp, mix, smoothstep, damp, spring, createNoise, range, easeOutQuint
} from "./math.js";
import { blinkCurve } from "../render/eyes-layer.js";

// `gazeHold` es la duración de una fijación. Una persona en conversación
// reajusta la mirada aproximadamente una vez por segundo; en silencio, algo
// menos; pensando, mucho más a menudo y con recorridos más largos.
const STATE_PROFILE = {
  idle: { blink: 4.6, headGain: .70, gazeHold: [.85, 2.4], gazeReach: 1.5, browBase: 0 },
  listening: { blink: 3.4, headGain: .92, gazeHold: [.60, 1.9], gazeReach: 1.3, browBase: .16 },
  thinking: { blink: 5.0, headGain: .82, gazeHold: [.32, 1.0], gazeReach: 3.0, browBase: -.10 },
  speaking: { blink: 3.0, headGain: 1.18, gazeHold: [.42, 1.4], gazeReach: 2.1, browBase: .08 }
};

// Expresiones.
//
// No son máscaras superpuestas: cada una es un ajuste pequeño de los mismos
// mandos que ya mueve el habla —altura e inclinación de ceja, cierre de
// párpado, comisura y presión labial—. Los valores son deliberadamente
// pequeños: en un rostro real la diferencia entre preocupación y enfado son
// dos milímetros de ceja, no una mueca.
//
//   brow      levanta o baja toda la ceja
//   browTilt  inclina: positivo sube la cabeza y baja la cola
//   squint    entorna el párpado superior
//   curl      tira de la comisura hacia arriba o hacia abajo
//   press     junta los labios
const EXPRESSIONS = {
  neutra:        { brow: 0,    browTilt: 0,    squint: 0,   curl: 0,    press: 0 },
  alegria:       { brow: .20,  browTilt: .04,  squint: .17, curl: .32,  press: 0 },
  sorpresa:      { brow: .88,  browTilt: .10,  squint: 0,   curl: .04,  press: 0 },
  preocupacion:  { brow: .24,  browTilt: .56,  squint: .06, curl: -.20, press: .10 },
  enfado:        { brow: -.46, browTilt: -.36, squint: .21, curl: -.25, press: .22 },
  concentracion: { brow: -.25, browTilt: -.15, squint: .25, curl: -.07, press: .15 }
};

// Ganancia global. Bajarla mantiene todo el repertorio pero más contenido.
const EXPRESSION_GAIN = .85;

export class PerformanceDirector {
  constructor() {
    this.state = "idle";
    this.stateSince = 0;
    this.time = 0;
    this.lastFrame = 0;

    this.headNoise = [createNoise(3), createNoise(9), createNoise(21)];
    this.gazeNoise = [createNoise(31), createNoise(43)];
    this.browNoise = createNoise(57);
    this.idleNoise = createNoise(71);

    this.head = { x: 0, y: 0, tilt: 0 };
    this.nod = null;
    this.nextNodAt = 2.5;
    this.lastNodAt = -10;

    this.gaze = { x: 0, y: 0 };
    this.gazeFrom = { x: 0, y: 0 };
    this.gazeTo = { x: 0, y: 0 };
    this.saccadeAt = -1;
    this.saccadeSpan = .045;
    this.nextSaccadeAt = .8;

    this.blinkAt = -1;
    this.blinkSpan = .3;
    this.blinkDepth = 1;
    this.blinkQueued = 0;
    this.nextBlinkAt = 2.2;

    this.brow = { value: 0, velocity: 0, target: 0, holdUntil: 0 };

    this.expression = "neutra";
    this.expressionIntensity = 1;
    this.gesto = { brow: 0, browTilt: 0, squint: 0, curl: 0, press: 0 };

    this.breathPhase = .2;
    this.breathBoost = 0;

    this.energyFast = 0;
    this.energySlow = 0;
    this.lastOnsetAt = -10;
    this.silenceSince = 0;
    this.syllableJitter = { width: 0, round: 0 };

    this.swallowAt = -1;
    this.nextSwallowAt = 14;
    this.partAt = -1;
    this.nextPartAt = 9;

    this.mouth = { open: 0, spread: .5, round: .12, press: 0, jaw: 0 };
    this.velocity = { open: 0, spread: 0, round: 0, press: 0, jaw: 0 };

    this.pose = {
      body: { x: 0, y: 0 },
      head: { x: 0, y: 0, tilt: 0 },
      breath: { expand: 0, lift: 0, nasal: 0 },
      eyes: { left: 0, right: 0, gaze: { x: 0, y: 0 } },
      brows: [{ raise: 0, tilt: 0 }, { raise: 0, tilt: 0 }],
      mouth: this.mouth,
      aura: 0
    };
  }

  setState(state) {
    if (state === this.state) return;
    const previous = this.state;
    this.state = state;
    this.stateSince = this.time;

    // Los cambios de turno son un momento muy marcado: la gente parpadea y
    // reajusta la mirada justo al empezar o terminar de hablar.
    this.nextBlinkAt = Math.min(this.nextBlinkAt, this.time + range(.12, .42));
    this.nextSaccadeAt = Math.min(this.nextSaccadeAt, this.time + range(.05, .3));

    if (state === "speaking") {
      this.breathPhase = 0;          // inspiración antes de la frase
      this.breathBoost = 1;
      this.brow.target = .32;
      this.brow.holdUntil = this.time + .5;
    }
    if (state === "listening" && previous === "speaking") {
      this.nextNodAt = this.time + range(.6, 1.8);
    }
    if (state === "thinking") {
      this.gazeTo = { x: range(-2.6, 2.6), y: range(-1.6, -.4) };
      this.startSaccade();
    }
  }

  // `intensidad` permite matizar la misma expresión: .4 es un apunte, 1 es la
  // lectura plena. Cambiar de expresión nunca salta; se interpola en ~350 ms,
  // que es lo que tarda un rostro en recomponerse.
  setExpression(nombre, intensidad = 1) {
    if (!EXPRESSIONS[nombre]) return;
    this.expression = nombre;
    this.expressionIntensity = clamp(intensidad, 0, 1.4);
    // Una expresión nueva casi siempre llega acompañada de un parpadeo.
    if (nombre !== "neutra") {
      this.nextBlinkAt = Math.min(this.nextBlinkAt, this.time + range(.08, .34));
    }
  }

  #updateExpression(dt) {
    const objetivo = EXPRESSIONS[this.expression] ?? EXPRESSIONS.neutra;
    const escala = EXPRESSION_GAIN * this.expressionIntensity;
    for (const canal of Object.keys(this.gesto)) {
      this.gesto[canal] = damp(this.gesto[canal], objetivo[canal] * escala, dt, .16);
    }
  }

  startSaccade() {
    this.gazeFrom = { ...this.gaze };
    this.saccadeAt = this.time;
    this.saccadeSpan = range(.028, .058);
  }

  update(nowMs, voice) {
    const now = nowMs / 1000;
    const dt = this.lastFrame ? clamp(now - this.lastFrame, .004, .05) : .0167;
    this.lastFrame = now;
    this.time = now;

    const profile = STATE_PROFILE[this.state] ?? STATE_PROFILE.idle;
    const speech = voice ?? { active: false, energy: 0, open: 0, spread: .5, round: .12, press: 0 };

    this.#trackEnergy(speech, dt);
    this.#updateExpression(dt);
    this.#updateMouth(speech, dt);
    this.#updateBreath(dt);
    this.#updateBlink(profile);
    this.#updateGaze(profile);
    this.#updateHead(profile, dt);
    this.#updateBrows(profile, dt);

    this.pose.mouth = this.mouth;
    this.pose.aura = this.state === "idle" ? 0
      : .055 + this.energySlow * .16 + Math.sin(now * .54) * .012;
    return this.pose;
  }

  // Envolvente rápida y lenta de la voz. La diferencia entre ambas marca los
  // ataques: es la señal que dispara acentos, cabeceos y cejas.
  #trackEnergy(speech, dt) {
    const energy = clamp(speech.energy ?? 0);
    this.energyFast = damp(this.energyFast, energy, dt, energy > this.energyFast ? .012 : .09);
    this.energySlow = damp(this.energySlow, energy, dt, .38);
    if (energy < .06) this.silenceSince += dt;
    else this.silenceSince = 0;

    const attack = this.energyFast - this.energySlow;
    this.onset = false;
    if (attack > .085 && this.energyFast > .17 && this.time - this.lastOnsetAt > .18) {
      this.lastOnsetAt = this.time;
      this.onset = true;
      // Cada sílaba recibe una variación mínima propia. Sin esto, todas las
      // aperturas de la misma vocal quedan calcadas.
      this.syllableJitter.width = range(-.045, .045);
      this.syllableJitter.round = range(-.035, .035);
    }
  }

  #updateMouth(speech, dt) {
    // La boca se gobierna por la voz que de verdad está sonando, no por el
    // estado de la conversación. Con transporte WebRTC el audio viaja por la
    // pista de medios y la API no anuncia cada fragmento por el canal de
    // datos, así que atarse al estado dejaba los labios quietos mientras
    // Catalina hablaba.
    const talking = speech.active && speech.energy > .05;
    let targetOpen = talking ? clamp(speech.open) : 0;
    let targetSpread = talking ? clamp(speech.spread + this.syllableJitter.width) : .5;
    let targetRound = talking ? clamp(speech.round + this.syllableJitter.round) : .12;
    let targetPress = talking ? clamp(speech.press) : 0;
    targetPress = Math.max(targetPress, this.gesto.press);

    if (!talking) {
      const idle = this.idleNoise(this.time * .22);
      targetOpen = clamp(.012 + idle * .014);
      targetSpread = .5 + idle * .05 + (this.state === "listening" ? .04 : 0);
      targetRound = .12 + this.idleNoise(this.time * .13 + 5) * .05;

      // Deglución: un gesto corto y muy reconocible que rompe la quietud.
      if (this.time >= this.nextSwallowAt) {
        this.swallowAt = this.time;
        this.nextSwallowAt = this.time + range(11, 24);
        this.nextBlinkAt = Math.min(this.nextBlinkAt, this.time + range(.1, .35));
      }
      if (this.swallowAt >= 0) {
        const phase = (this.time - this.swallowAt) / .62;
        if (phase >= 1) this.swallowAt = -1;
        else {
          const envelope = Math.sin(Math.PI * phase);
          targetPress = envelope * .55;
          targetOpen += envelope * .05;
        }
      }

      // Entreabrir los labios: ocurre al escuchar, antes de tomar el turno.
      if (this.state === "listening" && this.time >= this.nextPartAt) {
        this.partAt = this.time;
        this.nextPartAt = this.time + range(7, 16);
      }
      if (this.partAt >= 0) {
        const phase = (this.time - this.partAt) / .8;
        if (phase >= 1) this.partAt = -1;
        else targetOpen += Math.sin(Math.PI * phase) * .07;
      }
    }

    // La apertura sube más rápido de lo que baja y el cierre bilabial es casi
    // instantáneo: así se distingue una /p/ de una vocal que se apaga.
    const closing = targetPress > .35;
    const openFrequency = closing ? 38 : targetOpen > this.mouth.open ? 27 : 19;
    [this.mouth.open, this.velocity.open] =
      spring(this.mouth.open, this.velocity.open, closing ? 0 : targetOpen, dt, openFrequency, .90);

    // La mandíbula pesa: llega más tarde que el labio y se queda un instante.
    const jawTarget = clamp(targetOpen * .94 + this.energySlow * .10) * (closing ? .35 : 1);
    [this.mouth.jaw, this.velocity.jaw] =
      spring(this.mouth.jaw, this.velocity.jaw, jawTarget, dt, 14, .96);

    [this.mouth.spread, this.velocity.spread] =
      spring(this.mouth.spread, this.velocity.spread, targetSpread, dt, 13, .95);
    [this.mouth.round, this.velocity.round] =
      spring(this.mouth.round, this.velocity.round, targetRound, dt, 11, .95);
    [this.mouth.press, this.velocity.press] =
      spring(this.mouth.press, this.velocity.press, targetPress, dt, 30, .88);

    this.mouth.curl = this.gesto.curl;
    this.mouth.open = clamp(this.mouth.open, 0, 1.05);
    this.mouth.jaw = clamp(this.mouth.jaw);
    this.mouth.spread = clamp(this.mouth.spread, .12, .92);
    this.mouth.round = clamp(this.mouth.round);
    this.mouth.press = clamp(this.mouth.press);
  }

  #updateBreath(dt) {
    const rate = this.state === "speaking" ? 1 / 3.4 : 1 / 4.6;
    this.breathPhase = (this.breathPhase + dt * rate * (1 + this.breathBoost * .8)) % 1;
    this.breathBoost = damp(this.breathBoost, 0, dt, .5);

    // Inspiración corta, espiración larga.
    const p = this.breathPhase;
    const wave = p < .38
      ? 1 - Math.pow(1 - p / .38, 3)
      : 1 - smoothstep(0, 1, (p - .38) / .62);

    this.pose.breath.expand = wave * .0019;
    this.pose.breath.lift = -wave * .55;
    // La nariz sigue el mismo ciclo que el tórax, no uno propio: si el ala se
    // abriera en un tiempo distinto del que se ensancha el pecho, se leería
    // como dos movimientos sueltos en vez de como una respiración.
    this.pose.breath.nasal = wave;
    this.pose.body.x = this.headNoise[2](this.time * .045) * .9;
    this.pose.body.y = this.headNoise[2](this.time * .031 + 4) * .5;
  }

  #updateBlink(profile) {
    if (this.blinkAt < 0 && this.time >= this.nextBlinkAt) {
      this.blinkAt = this.time;
      const partial = Math.random() < .18;
      this.blinkDepth = partial ? range(.42, .68) : 1;
      this.blinkSpan = (partial ? range(.16, .22) : range(.24, .34));
      if (this.blinkQueued > 0) this.blinkQueued -= 1;
      else if (Math.random() < .15) this.blinkQueued = 1;
    }

    let close = 0;
    if (this.blinkAt >= 0) {
      const phase = (this.time - this.blinkAt) / this.blinkSpan;
      if (phase >= 1) {
        this.blinkAt = -1;
        this.nextBlinkAt = this.blinkQueued > 0
          ? this.time + range(.10, .18)
          : this.time + profile.blink * range(.45, 1.75);
      } else {
        close = blinkCurve(phase) * this.blinkDepth;
      }
    }

    // El entornado de la expresión es un cierre de partida; el parpadeo recorre
    // lo que queda de apertura, así que los dos gestos conviven sin pisarse.
    const entornado = clamp(this.gesto.squint, 0, .45);
    const total = entornado + (1 - entornado) * close;
    // Asimetría mínima: los dos párpados nunca llegan exactamente a la vez.
    this.pose.eyes.left = total;
    this.pose.eyes.right = Math.max(0, total * .985 - .012);
  }

  #updateGaze(profile) {
    if (this.saccadeAt < 0 && this.time >= this.nextSaccadeAt) {
      const away = Math.random() < (this.state === "thinking" ? .5 : .16);
      const reach = profile.gazeReach * (away ? 1.7 : .55);
      const bias = this.state === "thinking" ? -.9 : 0;
      this.gazeTo = {
        x: clamp(range(-reach, reach), -3.2, 3.2),
        y: clamp(range(-reach, reach) * .45 + bias, -1.8, 1.5)
      };
      this.startSaccade();
      const [min, max] = profile.gazeHold;
      this.nextSaccadeAt = this.time + range(min, max) * (away ? 1.4 : 1);
      // Una sacada amplia arrastra con frecuencia un parpadeo.
      if (away && Math.random() < .35) this.nextBlinkAt = Math.min(this.nextBlinkAt, this.time + range(.02, .12));
    }

    if (this.saccadeAt >= 0) {
      const phase = (this.time - this.saccadeAt) / this.saccadeSpan;
      if (phase >= 1) {
        this.saccadeAt = -1;
        this.gaze.x = this.gazeTo.x;
        this.gaze.y = this.gazeTo.y;
      } else {
        const t = easeOutQuint(phase);
        this.gaze.x = mix(this.gazeFrom.x, this.gazeTo.x, t);
        this.gaze.y = mix(this.gazeFrom.y, this.gazeTo.y, t);
      }
    }

    // Deriva y micro-temblor entre fijaciones: el ojo humano jamás se detiene.
    const driftX = this.gazeNoise[0](this.time * .55) * .26;
    const driftY = this.gazeNoise[1](this.time * .47) * .16;
    this.pose.eyes.gaze.x = this.gaze.x + driftX;
    this.pose.eyes.gaze.y = this.gaze.y + driftY;
  }

  #updateHead(profile, dt) {
    const gain = profile.headGain;
    const baseX = this.headNoise[0](this.time * .13) * 2.4 + this.headNoise[0](this.time * .41 + 2) * .55;
    const baseY = this.headNoise[1](this.time * .11) * 1.15;
    const tilt = this.headNoise[1](this.time * .085 + 7) * .0055;

    // Acentos: un cabeceo corto sobre la sílaba fuerte.
    if (this.onset && this.state === "speaking" && this.time - this.lastNodAt > 1.4 && Math.random() < .30) {
      this.nod = { at: this.time, span: range(.34, .56), depth: range(.55, 1.15) };
      this.lastNodAt = this.time;
    }
    // Asentimiento de escucha.
    if (this.state === "listening" && this.time >= this.nextNodAt) {
      this.nod = { at: this.time, span: range(.5, .72), depth: range(.45, .8) };
      this.nextNodAt = this.time + range(2.6, 6.5);
      this.lastNodAt = this.time;
    }

    let nodY = 0;
    let nodTilt = 0;
    if (this.nod) {
      const phase = (this.time - this.nod.at) / this.nod.span;
      if (phase >= 1) this.nod = null;
      else {
        const envelope = Math.sin(Math.PI * phase) - Math.sin(Math.PI * 2 * phase) * .18;
        nodY = envelope * this.nod.depth;
        nodTilt = Math.sin(Math.PI * 2 * phase) * .0007;
      }
    }

    // El ojo llega antes que la cabeza; la cabeza lo sigue a media fuerza.
    const follow = this.pose.eyes.gaze;
    const targetX = (baseX + follow.x * .38) * gain;
    const targetY = (baseY + follow.y * .30) * gain + nodY;

    this.head.x = damp(this.head.x, targetX, dt, .22);
    this.head.y = damp(this.head.y, targetY, dt, .16);
    this.head.tilt = damp(this.head.tilt, tilt * gain + nodTilt, dt, .30);

    this.pose.head.x = this.head.x;
    this.pose.head.y = this.head.y;
    this.pose.head.tilt = this.head.tilt;
  }

  #updateBrows(profile, dt) {
    if (this.onset && this.energyFast > .3 && Math.random() < .40) {
      this.brow.target = clamp(profile.browBase + range(.35, .85));
      this.brow.holdUntil = this.time + range(.18, .42);
    }
    if (this.time > this.brow.holdUntil) {
      this.brow.target = damp(this.brow.target, profile.browBase, dt, .55);
    }
    [this.brow.value, this.brow.velocity] =
      spring(this.brow.value, this.brow.velocity, this.brow.target, dt, 15, .9);

    const wobble = this.browNoise(this.time * .21) * .10;
    this.pose.brows[0].raise = this.brow.value + this.gesto.brow + wobble;
    this.pose.brows[1].raise = (this.brow.value + this.gesto.brow) * .93 - wobble * .7;
    this.pose.brows[0].tilt = this.gesto.browTilt;
    this.pose.brows[1].tilt = this.gesto.browTilt * .94;
  }
}
