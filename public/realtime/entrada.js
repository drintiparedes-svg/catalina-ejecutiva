// Entrada de micrófono de las sesiones de voz por WebSocket (ElevenLabs y
// Gemini).
//
// Antes: ScriptProcessor de 2048 muestras en el hilo principal (43 ms de espera
// por bloque y bloques perdidos si la página iba cargada) y bajada a 16 kHz
// por interpolación lineal, que sin filtro previo deja pasar el aliasing: la voz
// que recibía el agente llegaba más sucia de lo necesario.
// Ahora: AudioWorklet con bloques de ~20 ms en el hilo de audio, y bajada con
// un filtro anti-aliasing de verdad (Decimador), continuo entre bloques.

const BLOQUE_MS = 20;

// Bajada de frecuencia con filtro anti-aliasing: FIR paso bajo (sinc con
// ventana de Blackman, 65 coeficientes, corte al 45 % de la frecuencia de
// destino) evaluado en cada muestra de salida. Conserva la historia entre
// bloques, así que el resultado es idéntico al de procesar la señal entera de
// una vez. Retardo añadido: 32 muestras de entrada (0,7 ms a 48 kHz).
export class Decimador {
  constructor(desde, hasta, mitad = 32) {
    this.razon = desde / hasta;
    this.K = mitad;
    const corte = .45 * hasta / desde;   // ciclos por muestra de entrada
    const n = 2 * mitad + 1;
    this.h = new Float32Array(n);
    let suma = 0;
    for (let k = -mitad; k <= mitad; k += 1) {
      const sinc = k === 0 ? 2 * corte : Math.sin(2 * Math.PI * corte * k) / (Math.PI * k);
      const x = (k + mitad) / (n - 1);
      const ventana = .42 - .5 * Math.cos(2 * Math.PI * x) + .08 * Math.cos(4 * Math.PI * x);
      this.h[k + mitad] = sinc * ventana;
      suma += sinc * ventana;
    }
    for (let k = 0; k < n; k += 1) this.h[k] /= suma;
    this.cola = new Float32Array(mitad);   // ceros de arranque
    this.fase = mitad;                     // posición de la próxima salida en `cola + entrada`
  }

  procesar(entrada) {
    if (this.razon === 1) return Float32Array.from(entrada);
    const datos = new Float32Array(this.cola.length + entrada.length);
    datos.set(this.cola);
    datos.set(entrada, this.cola.length);
    const K = this.K, h = this.h;
    const salida = new Float32Array(Math.ceil(entrada.length / this.razon) + 2);
    let i = this.fase, n = 0;
    while (Math.round(i) + K < datos.length) {
      const c = Math.round(i);
      let suma = 0;
      for (let k = -K; k <= K; k += 1) suma += h[k + K] * datos[c + k];
      salida[n++] = suma;
      i += this.razon;
    }
    const desde = Math.max(0, Math.floor(i) - K);
    this.cola = datos.slice(desde);
    this.fase = i - desde;
    return salida.subarray(0, n);
  }
}

// Crea el nodo de captura sobre `ctx` y llama a `alBloque(muestras)` con cada
// bloque a la frecuencia del contexto. Devuelve el nodo, al que se conectan
// las fuentes (micrófono y, si la hay, la reunión).
export async function crearCaptura(ctx, alBloque) {
  const bloque = Math.round(ctx.sampleRate * BLOQUE_MS / 1000);
  let nodo;
  try {
    await ctx.audioWorklet.addModule(new URL("../audio/captura-pcm.js", import.meta.url));
    nodo = new AudioWorkletNode(ctx, "captura-pcm", {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit",
      processorOptions: { bloque }
    });
    nodo.port.onmessage = ({ data }) => alBloque(data.muestras);
    nodo.captura = "hilo de audio";
  } catch (error) {
    console.warn("Entrada de voz: sin AudioWorklet, uso ScriptProcessor", error);
    nodo = ctx.createScriptProcessor(2048, 1, 1);
    nodo.onaudioprocess = evento => alBloque(evento.inputBuffer.getChannelData(0));
    nodo.captura = "hilo principal";
  }
  // El nodo necesita llegar al destino para procesar; con ganancia cero no se
  // oye el propio micrófono.
  const mudo = ctx.createGain();
  mudo.gain.value = 0;
  nodo.connect(mudo).connect(ctx.destination);
  return nodo;
}

export function aPcm16(muestras) {
  const salida = new Int16Array(muestras.length);
  for (let i = 0; i < muestras.length; i += 1) {
    const valor = Math.max(-1, Math.min(1, muestras[i]));
    salida[i] = valor < 0 ? valor * 0x8000 : valor * 0x7fff;
  }
  return salida;
}

// Micrófono para conversar. Desde Chrome 141, `echoCancellation: "all"` quita
// del micrófono todo lo que suena en el equipo, no sólo lo que llega por
// WebRTC: justo lo que falta cuando la voz del agente suena por Web Audio. Los
// navegadores anteriores convierten el texto en `true` y siguen como antes.
// Mono, como recomienda ElevenLabs para cancelar mejor el eco.
export async function abrirMicrofonoDeConversacion() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: "all", noiseSuppression: true, autoGainControl: true, channelCount: 1 }
  });
}
