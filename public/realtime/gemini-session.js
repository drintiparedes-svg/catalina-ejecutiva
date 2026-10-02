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

import { crearCaptura, Decimador, aPcm16, abrirMicrofonoDeConversacion } from "./entrada.js";

const ENTRADA_HZ = 16000;   // lo que Gemini exige recibir
const SALIDA_HZ = 24000;    // lo que Gemini envía
// Tras callar, el audio de la reunión sigue cortado un momento más: lo que
// vuelve por la videollamada llega con retraso y sería su propia voz.
const RETENCION_MS = 700;

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
    this.reproductor = null;  // AudioWorkletNode que va sacando el audio
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

      this.micStream = await abrirMicrofonoDeConversacion();

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

  // Reproducción. El hilo principal sólo entrega muestras; quien las saca al
  // ritmo exacto de la tarjeta de sonido es el worklet, en el hilo de audio.
  async #prepararSalida() {
    this.salida = new AudioContext({ sampleRate: SALIDA_HZ });
    await this.salida.resume().catch(() => {});
    await this.salida.audioWorklet.addModule("./audio/reproductor-pcm.js");

    this.reproductor = new AudioWorkletNode(this.salida, "reproductor-pcm", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]
    });
    this.reproductor.port.onmessage = ({ data }) => {
      if (data?.tipo === "voz") this.#alSonar(data.sonando);
      if (data?.tipo === "voz" || data?.tipo === "estadisticas") this.estadisticasVoz = { ...data, tipo: undefined };
    };
    this.destino = this.salida.createMediaStreamDestination();
    this.reproductor.connect(this.destino);

    // Este stream hace las dos cosas: lo reproduce el elemento <audio> de la
    // página y lo analiza el seguidor de labios. Una sola salida de sonido.
    this.#emit("onRemoteStream", this.destino.stream);
  }

  #reproducir(base64) {
    if (!this.reproductor) return;
    const bytes = decodificar(base64);
    const enteros = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    if (!enteros.length) return;

    const muestras = new Float32Array(enteros.length);
    for (let i = 0; i < enteros.length; i += 1) muestras[i] = enteros[i] / 32768;
    // Se transfiere en vez de copiarse: son bloques de audio y llegan seguidos.
    // La compuerta de la reunión se cierra en cuanto llega su voz, sin esperar
    // a que suene: el colchón del reproductor tarda unos 200 ms, y en ese rato
    // el audio de la llamada ya podría interrumpirla.
    if (!this.hablando) this.#alSonar(true);
    this.reproductor.port.postMessage({ tipo: "audio", muestras }, [muestras.buffer]);
  }

  // Interrupción: si la persona habla encima, Gemini avisa y hay que callar de
  // inmediato lo que ya estaba en cola, o Catalina seguiría hablando sola.
  #callar() {
    this.reproductor?.port.postMessage({ tipo: "callar" });
  }

  // Captura. El micrófono llega a la frecuencia del sistema (normalmente 48 kHz)
  // y Gemini sólo acepta 16 kHz, así que se remuestrea antes de enviar.
  async #prepararEntrada() {
    this.entrada = new AudioContext();
    await this.entrada.resume().catch(() => {});
    const origen = this.entrada.createMediaStreamSource(this.micStream);
    // Captura en el hilo de audio con bloques de ~20 ms y bajada a 16 kHz con
    // filtro (entrada.js).
    const decimador = new Decimador(this.entrada.sampleRate, ENTRADA_HZ);
    const nodo = await crearCaptura(this.entrada, muestras => {
      if (this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      const pcm = aPcm16(decimador.procesar(muestras));
      if (!pcm.length) return;
      this.socket.send(JSON.stringify({
        realtimeInput: {
          audio: { data: codificar(pcm), mimeType: `audio/pcm;rate=${ENTRADA_HZ}` }
        }
      }));
    });
    origen.connect(nodo);
    this.nodoEntrada = nodo;
    if (this.flujoExtra) this.mezclarEntrada(this.flujoExtra);
  }

  #onMensaje(evento) {
    leerMensaje(evento.data).then(texto => {
      if (!texto) return;
      let mensaje = {};
      try { mensaje = JSON.parse(texto); } catch { return; }

      const contenido = mensaje.serverContent;
      if (contenido?.interrupted) {
        this.interrupciones = (this.interrupciones || 0) + 1;
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

  // Entrada por texto, igual que en la sesión de OpenAI. `turnComplete` es lo
  // que le dice a Gemini que ya puede contestar.
  enviarTexto(texto) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: texto }] }],
        turnComplete: true
      }
    }));
    return true;
  }

  // Contexto silencioso: con turnComplete en falso Gemini lo incorpora al
  // historial pero no genera respuesta hasta el siguiente turno completo.
  anadirContexto(texto) {
    if (this.socket?.readyState !== WebSocket.OPEN || !texto) return false;
    this.socket.send(JSON.stringify({
      clientContent: { turns: [{ role: "user", parts: [{ text: texto }] }], turnComplete: false }
    }));
    return true;
  }

  // Segunda fuente de audio: la pestaña de la reunión (Google Meet). Se suma
  // al micrófono en el mismo procesador, así Catalina oye a quienes hablan por
  // la videollamada aunque se usen audífonos. Sólo se envía al modelo cuando no
  // está en pausa, igual que el micrófono.
  mezclarEntrada(flujo) {
    try { this.fuenteExtra?.disconnect(); this.compuertaExtra?.disconnect(); } catch {}
    this.fuenteExtra = this.compuertaExtra = null;
    this.flujoExtra = flujo?.getAudioTracks?.().length ? flujo : null;
    if (!this.flujoExtra || !this.entrada || !this.nodoEntrada) return false;
    this.fuenteExtra = this.entrada.createMediaStreamSource(new MediaStream(this.flujoExtra.getAudioTracks()));
    // La reunión pasa por una compuerta que se cierra mientras Catalina habla.
    // Sin ella, cualquier voz o ruido de la videollamada —incluida su propia voz
    // de vuelta— lo toma el agente como alguien hablándole encima, la
    // interrumpe y la voz sale a trozos. El micrófono no pasa por aquí: quien
    // la usa puede seguir cortándola.
    this.compuertaExtra = this.entrada.createGain();
    this.compuertaExtra.gain.value = this.hablando ? 0 : 1;
    this.fuenteExtra.connect(this.compuertaExtra).connect(this.nodoEntrada);
    return true;
  }

  // El reproductor avisa cuándo empieza y termina de sonar su voz.
  #alSonar(sonando) {
    this.hablando = sonando;
    clearTimeout(this.relojCompuerta);
    if (sonando) return this.#compuerta(false);
    this.relojCompuerta = setTimeout(() => this.#compuerta(true), RETENCION_MS);
  }

  #compuerta(abierta) {
    const ganancia = this.compuertaExtra?.gain;
    if (!ganancia || !this.entrada) return;
    const ahora = this.entrada.currentTime;
    ganancia.cancelScheduledValues(ahora);
    ganancia.setTargetAtTime(abierta ? 1 : 0, ahora, abierta ? .05 : .01);
    this.compuertaAbierta = abierta;
  }

  // Cómo va la voz: cortes del reproductor, interrupciones y estado de la
  // compuerta. Sirve para saber si lo entrecortado viene de la red, del equipo
  // o de la reunión. Desde la consola: `catalina.session.diagnostico()`.
  diagnostico() {
    return {
      ...this.estadisticasVoz,
      interrupciones: this.interrupciones || 0,
      reunionMezclada: Boolean(this.fuenteExtra),
      compuertaAbierta: this.fuenteExtra ? this.compuertaAbierta !== false : null
    };
  }

  disconnect() {
    this.connected = false;
    this.#callar();
    try { this.socket?.close(); } catch {}
    this.nodoEntrada?.disconnect();
    try { this.fuenteExtra?.disconnect(); } catch {}
    clearTimeout(this.relojCompuerta);
    this.fuenteExtra = this.compuertaExtra = null;
    this.hablando = false;
    this.micStream?.getTracks().forEach(pista => pista.stop());
    this.entrada?.close().catch(() => {});
    this.salida?.close().catch(() => {});
    this.reproductor = null;
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

  // Corta lo que se envía sin apagar la pista del micrófono.
  //
  // En modo reunión el navegador tiene que seguir oyendo para transcribir, y
  // apagar la pista se lo pone difícil. Aquí no hace falta tocarla: basta con
  // dejar de mandar, porque el envío ya mira esta bandera en cada bloque.
  pausarEnvio(pausado) {
    this.muted = pausado;
    return this.muted;
  }
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
