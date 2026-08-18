// Sesión de voz contra Gemini Live, usada como respaldo de OpenAI.
//
// Expone la misma interfaz que RealtimeSession (connect, disconnect,
// toggleMute y los mismos handlers) para que app.js no tenga que saber con
// quién está hablando. Por dentro no se parecen en nada:
//
//   OpenAI  → WebRTC. El navegador negocia SDP y el audio viaja por una pista
//             de medios que el sistema operativo gestiona solo.
//   Gemini  → WebSocket. Aquí hay que hacer a mano lo que WebRTC hacía solo:
//             capturar el micrófono, convertirlo a PCM de 16 bits a 16 kHz,
//             trocearlo, y por el otro lado recomponer el audio que llega a
//             24 kHz y reproducirlo en orden.
//
// El audio recibido se vuelca además en un MediaStream propio, porque el
// analizador de labios espera un stream igual que el de WebRTC: así la boca se
// mueve con Gemini exactamente igual que con OpenAI.

const ENTRADA_HZ = 16000;   // lo que Gemini exige recibir
const SALIDA_HZ = 24000;    // lo que Gemini envía
const MUESTRAS_POR_ENVIO = 2048;

export class GeminiSession {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.socket = null;
    this.micStream = null;
    this.entrada = null;      // AudioContext de captura
    this.salida = null;       // AudioContext de reproducción
    this.destino = null;      // MediaStreamAudioDestinationNode con la voz
    this.connected = false;
    this.muted = false;
    this.transcript = "";
    this.reproducirEn = 0;    // cuándo debe sonar el próximo trozo
    this.fuentes = new Set(); // trozos en cola, para poder cortarlos
  }

  #emit(name, ...args) {
    return this.handlers[name]?.(...args);
  }

  async connect() {
    this.#emit("onStatus", "Solicitando acceso al micrófono…");
    try {
      assertVoiceEnvironment();

      const respuesta = await fetch("/gemini/token", { method: "POST" });
      if (!respuesta.ok) {
        const detalle = await respuesta.json().catch(() => ({}));
        const error = new Error(detalle.error || `Gemini no está disponible (${respuesta.status})`);
        error.code = detalle.code || "GEMINI_SESSION_ERROR";
        throw error;
      }
      const { token, setup } = await respuesta.json();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      await this.#abrirSocket(token, setup);
      await this.#prepararSalida();
      await this.#prepararEntrada();
    } catch (error) {
      console.error(error);
      this.disconnect();
      error.mensaje = mensajeDeError(error);
      error.ayuda = ayudaDeError(error);
      this.#emit("onFailure", error);
    }
  }

  #abrirSocket(token, setup) {
    return new Promise((resolve, reject) => {
      const url = "wss://generativelanguage.googleapis.com/ws/"
        + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained"
        + `?access_token=${encodeURIComponent(token)}`;
      this.socket = new WebSocket(url);

      this.socket.addEventListener("open", () => {
        this.socket.send(JSON.stringify({ setup }));
        this.connected = true;
        this.#emit("onConnected");
        this.#emit("onPhase", "listening");
        this.#emit("onStatus", "Te escucho");
        resolve();
      });
      this.socket.addEventListener("message", evento => this.#onMensaje(evento));
      this.socket.addEventListener("error", () => reject(new Error("No se pudo abrir la sesión con Gemini")));
      this.socket.addEventListener("close", () => { if (this.connected) this.disconnect(); });
    });
  }

  // Reproducción. Los trozos llegan sueltos y hay que encadenarlos: cada uno se
  // agenda justo cuando termina el anterior, porque dejarlos sonar «ahora»
  // produce solapes y cortes audibles.
  async #prepararSalida() {
    this.salida = new AudioContext({ sampleRate: SALIDA_HZ });
    await this.salida.resume().catch(() => {});
    this.destino = this.salida.createMediaStreamDestination();
    // Se oye por los altavoces y a la vez alimenta el analizador de labios.
    this.#emit("onRemoteStream", this.destino.stream);
  }

  #reproducir(base64) {
    if (!this.salida) return;
    const bytes = decodificar(base64);
    const muestras = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    if (!muestras.length) return;

    const buffer = this.salida.createBuffer(1, muestras.length, SALIDA_HZ);
    const canal = buffer.getChannelData(0);
    for (let i = 0; i < muestras.length; i += 1) canal[i] = muestras[i] / 32768;

    const fuente = this.salida.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.destino);
    fuente.connect(this.salida.destination);

    const ahora = this.salida.currentTime;
    // Un colchón corto absorbe los saltos de la red sin que se note retraso.
    if (this.reproducirEn < ahora) this.reproducirEn = ahora + .06;
    fuente.start(this.reproducirEn);
    this.reproducirEn += buffer.duration;

    this.fuentes.add(fuente);
    fuente.onended = () => this.fuentes.delete(fuente);
  }

  // Interrupción: si la persona habla encima, Gemini avisa y hay que callar de
  // inmediato lo que ya estaba en cola, o Catalina seguiría hablando sola.
  #callar() {
    for (const fuente of this.fuentes) {
      try { fuente.stop(); } catch {}
    }
    this.fuentes.clear();
    this.reproducirEn = 0;
  }

  // Captura. El micrófono llega a la frecuencia del sistema (normalmente 48 kHz)
  // y Gemini sólo acepta 16 kHz, así que se remuestrea antes de enviar.
  async #prepararEntrada() {
    this.entrada = new AudioContext();
    await this.entrada.resume().catch(() => {});
    const origen = this.entrada.createMediaStreamSource(this.micStream);
    const nodo = this.entrada.createScriptProcessor(MUESTRAS_POR_ENVIO, 1, 1);

    nodo.onaudioprocess = evento => {
      if (this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      const original = evento.inputBuffer.getChannelData(0);
      const pcm = aPcm16(remuestrear(original, this.entrada.sampleRate, ENTRADA_HZ));
      this.socket.send(JSON.stringify({
        realtimeInput: {
          audio: { data: codificar(pcm), mimeType: `audio/pcm;rate=${ENTRADA_HZ}` }
        }
      }));
    };

    origen.connect(nodo);
    // El procesador necesita un destino para correr; con ganancia cero no se
    // oye el propio micrófono por los altavoces.
    const mudo = this.entrada.createGain();
    mudo.gain.value = 0;
    nodo.connect(mudo).connect(this.entrada.destination);
    this.nodoEntrada = nodo;
  }

  #onMensaje(evento) {
    leerMensaje(evento.data).then(texto => {
      if (!texto) return;
      let mensaje = {};
      try { mensaje = JSON.parse(texto); } catch { return; }

      const contenido = mensaje.serverContent;
      if (contenido?.interrupted) {
        this.#callar();
        this.#emit("onPhase", "listening");
        this.#emit("onStatus", "Te escucho…");
        this.transcript = "";
        this.#emit("onTranscript", "");
      }

      for (const parte of contenido?.modelTurn?.parts ?? []) {
        const datos = parte.inlineData?.data ?? parte.inline_data?.data;
        if (datos) {
          this.#emit("onPhase", "speaking");
          this.#emit("onStatus", "Hablando");
          this.#reproducir(datos);
        }
      }

      const dicho = contenido?.outputTranscription?.text ?? contenido?.output_transcription?.text;
      if (dicho) {
        this.transcript += dicho;
        this.#emit("onPhase", "speaking");
        this.#emit("onTranscript", this.transcript);
      }

      if (contenido?.turnComplete || contenido?.turn_complete) {
        this.#emit("onResponseDone");
        this.transcript = "";
      }

      const llamadas = mensaje.toolCall?.functionCalls ?? mensaje.tool_call?.function_calls;
      if (llamadas?.length) this.#atenderHerramientas(llamadas);
    });
  }

  async #atenderHerramientas(llamadas) {
    const respuestas = [];
    for (const llamada of llamadas) {
      const resultado = await this.#emit("onToolCall", llamada.name, llamada.args || {});
      respuestas.push({
        id: llamada.id,
        name: llamada.name,
        response: resultado ?? { ok: false, error: "Sin resultado" }
      });
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ toolResponse: { functionResponses: respuestas } }));
    }
  }

  disconnect() {
    this.connected = false;
    this.#callar();
    try { this.socket?.close(); } catch {}
    this.nodoEntrada?.disconnect();
    this.micStream?.getTracks().forEach(pista => pista.stop());
    this.entrada?.close().catch(() => {});
    this.salida?.close().catch(() => {});
    this.socket = this.micStream = this.entrada = this.salida = this.destino = this.nodoEntrada = null;
    this.muted = false;
    this.#emit("onDisconnected");
    this.#emit("onPhase", "idle");
  }

  toggleMute() {
    this.muted = !this.muted;
    this.micStream?.getAudioTracks().forEach(pista => { pista.enabled = !this.muted; });
    return this.muted;
  }
}

// Interpolación lineal. Basta para voz: el contenido por encima de 8 kHz que se
// pierde al bajar a 16 kHz no aporta nada al reconocimiento.
function remuestrear(muestras, deHz, aHz) {
  if (deHz === aHz) return muestras;
  const razon = deHz / aHz;
  const salida = new Float32Array(Math.floor(muestras.length / razon));
  for (let i = 0; i < salida.length; i += 1) {
    const posicion = i * razon;
    const base = Math.floor(posicion);
    const resto = posicion - base;
    const a = muestras[base] ?? 0;
    const b = muestras[base + 1] ?? a;
    salida[i] = a + (b - a) * resto;
  }
  return salida;
}

function aPcm16(muestras) {
  const salida = new Int16Array(muestras.length);
  for (let i = 0; i < muestras.length; i += 1) {
    const valor = Math.max(-1, Math.min(1, muestras[i]));
    salida[i] = valor < 0 ? valor * 32768 : valor * 32767;
  }
  return salida;
}

function codificar(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let texto = "";
  // Por trozos: pasar el array entero a String.fromCharCode desborda la pila.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(texto);
}

function decodificar(base64) {
  const texto = atob(base64);
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

// Gemini puede mandar el JSON como texto o como Blob según el navegador.
function leerMensaje(datos) {
  if (typeof datos === "string") return Promise.resolve(datos);
  if (datos instanceof Blob) return datos.text();
  if (datos instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(datos));
  return Promise.resolve("");
}

function assertVoiceEnvironment() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error("Este navegador no permite usar el micrófono desde esta dirección.");
    error.code = "MIC_UNAVAILABLE";
    throw error;
  }
}

function mensajeDeError(error) {
  if (error.code === "GEMINI_KEY_MISSING") return "Falta configurar Gemini";
  if (error.code === "GEMINI_KEY_INVALID") return "Gemini rechazó la clave";
  if (error.name === "NotAllowedError") return "Falta permiso del micrófono";
  return error.message || "No se pudo conectar con Gemini";
}

function ayudaDeError(error) {
  if (error.code === "GEMINI_KEY_MISSING") {
    return "Agrega GEMINI_API_KEY para tener respaldo cuando se agote el crédito de OpenAI.";
  }
  if (error.code === "GEMINI_KEY_INVALID") {
    return "Revisa la GEMINI_API_KEY en Google AI Studio.";
  }
  if (error.name === "NotAllowedError") {
    return "Autoriza el micrófono en el navegador y vuelve a intentarlo.";
  }
  return "Ni OpenAI ni Gemini pudieron atender la sesión.";
}
