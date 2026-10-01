// Sesión de voz contra OpenAI Realtime.
//
// Todo el intercambio de SDP pasa por el servidor local, que es quien conserva
// la clave. Aquí sólo viven WebRTC, el canal de eventos y la traducción de los
// errores a mensajes que se puedan leer en pantalla.

// Tras callar, la reunión sigue cortada un momento: su voz vuelve con retraso.
const RETENCION_MS = 700;

export class RealtimeSession {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.peer = null;
    this.channel = null;
    this.micStream = null;
    this.connected = false;
    this.muted = false;
    this.transcript = "";
    // Ruta del servidor que presenta la oferta SDP a OpenAI. La sesión de
    // GPT-Live (live-session.js) hereda todo el transporte y cambia esto.
    this.ruta = "/session";
  }

  emitir(name, ...args) {
    return this.handlers[name]?.(...args);
  }

  async connect() {
    this.emitir("onStatus", "Solicitando acceso al micrófono…");
    try {
      assertVoiceEnvironment();
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this.peer = new RTCPeerConnection();
      this.peer.addTransceiver(this.micStream.getAudioTracks()[0], {
        direction: "sendrecv",
        streams: [this.micStream]
      });

      this.channel = this.peer.createDataChannel("oai-events");
      this.channel.addEventListener("open", () => this.alAbrirCanal());
      this.channel.addEventListener("message", message => this.alRecibirEvento(message));

      this.peer.addEventListener("track", event => this.emitir("onRemoteStream", event.streams[0]));
      this.peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected", "closed"].includes(this.peer?.connectionState)) {
          this.disconnect();
        }
      });

      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      const response = await fetch(this.ruta, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(detail.error || `No se pudo conectar (${response.status})`);
        error.code = detail.code || "SESSION_ERROR";
        throw error;
      }
      await this.peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (error) {
      console.error(error);
      this.disconnect();
      // Quien decide si esto se enseña o si toca pasar el turno al proveedor de
      // respaldo es app.js: aquí no se sabe si hay un plan B.
      error.mensaje = connectionErrorMessage(error);
      error.ayuda = connectionErrorHelp(error);
      this.emitir("onFailure", error);
    }
  }

  alAbrirCanal() {
    // Refuerza la modalidad hablada. La transcripción sigue disponible como
    // subtítulo, pero la respuesta principal es audio.
    this.channel.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true
            }
          },
          output: { voice: "marin" }
        }
      }
    }));
    this.connected = true;
    this.emitir("onConnected");
    this.emitir("onPhase", "listening");
    this.emitir("onStatus", "Te escucho");
  }

  alRecibirEvento(message) {
    const event = JSON.parse(message.data);
    if (event.type === "output_audio_buffer.started") this.alSonar(true);
    if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") this.alSonar(false);
    if (event.type === "input_audio_buffer.speech_started") {
      if (this.hablando) this.interrupciones = (this.interrupciones || 0) + 1;
      this.transcript = "";
      this.emitir("onTranscript", "");
      this.emitir("onPhase", "listening");
      this.emitir("onStatus", "Te escucho…");
    } else if (event.type === "response.created") {
      this.emitir("onPhase", "thinking");
      this.emitir("onStatus", "Pensando…");
    } else if (
      event.type === "response.output_audio.delta" ||
      event.type === "response.audio.delta"
    ) {
      this.emitir("onPhase", "speaking");
      this.emitir("onStatus", "Hablando");
      const delta = event.delta || event.transcript || "";
      if (typeof delta === "string" && !looksLikeAudio(delta)) {
        this.transcript += delta;
        this.emitir("onTranscript", this.transcript);
      }
    } else if (
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.audio_transcript.delta"
    ) {
      // Con WebRTC ésta es la única señal de que Catalina está hablando: el
      // audio va por la pista de medios y no se anuncia por el canal.
      this.emitir("onPhase", "speaking");
      this.emitir("onStatus", "Hablando");
      this.transcript += event.delta || "";
      this.emitir("onTranscript", this.transcript);
    } else if (event.type === "response.function_call_arguments.done") {
      this.#atenderHerramienta(event);
    } else if (event.type === "response.done") {
      // El modelo genera por delante de la reproducción, así que aquí sólo se
      // anota que no habrá más texto; volver a escuchar lo decide el silencio
      // real del audio, en app.js.
      this.emitir("onResponseDone");
    } else if (event.type === "error") {
      console.error("Realtime event", event);
      this.emitir("onStatus", event.error?.message || "Ocurrió un error");
    }
  }

  // Herramientas. El modelo pide algo, app.js lo resuelve y el resultado vuelve
  // como un elemento más de la conversación; después hay que pedir la respuesta
  // hablada a mano, porque el turno se detuvo al llamar.
  async #atenderHerramienta(event) {
    let argumentos = {};
    try { argumentos = JSON.parse(event.arguments || "{}"); } catch {}
    const resultado = await this.emitir("onToolCall", event.name, argumentos);

    if (this.channel?.readyState !== "open") return;
    this.channel.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(resultado ?? { ok: false, error: "Sin resultado" })
      }
    }));
    this.channel.send(JSON.stringify({ type: "response.create" }));
  }

  // Entrada por texto, para el modo Meet: allí no se le manda audio, se le
  // manda lo que el navegador transcribió y se le pide que conteste.
  enviarTexto(texto) {
    if (this.channel?.readyState !== "open") return false;
    this.channel.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: texto }] }
    }));
    this.channel.send(JSON.stringify({ type: "response.create" }));
    return true;
  }

  // Contexto silencioso: se añade a la conversación sin pedir respuesta.
  anadirContexto(texto) {
    if (this.channel?.readyState !== "open" || !texto) return false;
    this.channel.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: texto }] }
    }));
    return true;
  }

  // Segunda fuente de audio: la pestaña de la reunión (Google Meet). Con
  // WebRTC la pista que se envía es una sola, así que se mezcla micrófono y
  // reunión en una pista nueva y se sustituye la del emisor. Sin fuente, se
  // vuelve a la pista original del micrófono.
  mezclarEntrada(flujo) {
    const emisor = this.peer?.getSenders().find(s => s.track?.kind === "audio");
    this.mezcla?.close().catch(() => {});
    this.mezcla = null;
    this.pistaMezclada = this.compuertaExtra = null;
    if (!emisor || !this.micStream) return false;
    const pistaMic = this.micStream.getAudioTracks()[0];
    if (!flujo?.getAudioTracks?.().length) {
      emisor.replaceTrack(pistaMic).catch(() => {});
      return true;
    }
    const ctx = new AudioContext();
    const destino = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(this.micStream).connect(destino);
    // Compuerta: la reunión deja de llegarle mientras habla, para que ni su
    // propia voz de vuelta ni el ruido de la llamada la interrumpan.
    this.compuertaExtra = ctx.createGain();
    this.compuertaExtra.gain.value = this.hablando ? 0 : 1;
    ctx.createMediaStreamSource(new MediaStream(flujo.getAudioTracks())).connect(this.compuertaExtra).connect(destino);
    this.mezcla = ctx;
    this.pistaMezclada = destino.stream.getAudioTracks()[0];
    this.pistaMezclada.enabled = !this.muted;
    emisor.replaceTrack(this.pistaMezclada).catch(() => {});
    return true;
  }

  // Con WebRTC el audio no pasa por aquí: el inicio y el fin de su voz los
  // anuncia el canal de datos (output_audio_buffer.*). Si el aviso de fin no
  // llegara, la compuerta se reabre sola a los 30 s.
  alSonar(sonando) {
    this.hablando = sonando;
    clearTimeout(this.relojCompuerta);
    if (sonando) {
      this.#compuerta(false);
      this.relojCompuerta = setTimeout(() => this.alSonar(false), 30000);
      return;
    }
    this.relojCompuerta = setTimeout(() => this.#compuerta(true), RETENCION_MS);
  }

  #compuerta(abierta) {
    const ganancia = this.compuertaExtra?.gain;
    if (!ganancia || !this.mezcla) return;
    const ahora = this.mezcla.currentTime;
    ganancia.cancelScheduledValues(ahora);
    ganancia.setTargetAtTime(abierta ? 1 : 0, ahora, abierta ? .05 : .01);
  }

  diagnostico() {
    return {
      interrupciones: this.interrupciones || 0,
      reunionMezclada: Boolean(this.compuertaExtra),
      compuertaAbierta: this.compuertaExtra ? !this.hablando : null
    };
  }

  disconnect() {
    this.connected = false;
    clearTimeout(this.relojCompuerta);
    this.hablando = false;
    this.mezcla?.close().catch(() => {});
    this.mezcla = this.pistaMezclada = this.compuertaExtra = null;
    this.channel?.close();
    this.peer?.close();
    this.micStream?.getTracks().forEach(track => track.stop());
    this.peer = this.channel = this.micStream = null;
    this.muted = false;
    this.emitir("onDisconnected");
    this.emitir("onPhase", "idle");
  }

  toggleMute() {
    this.muted = !this.muted;
    this.micStream?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
    if (this.pistaMezclada) this.pistaMezclada.enabled = !this.muted;
    return this.muted;
  }

  // Con WebRTC la única forma de dejar de enviar es apagar la pista: el audio
  // lo gestiona el navegador y no pasa por aquí. En modo reunión eso puede
  // estorbar al reconocimiento de voz, así que ahí conviene usar Gemini.
  pausarEnvio(pausado) {
    this.muted = pausado;
    this.micStream?.getAudioTracks().forEach(track => { track.enabled = !pausado; });
    if (this.pistaMezclada) this.pistaMezclada.enabled = !pausado;
    return this.muted;
  }
}

function assertVoiceEnvironment() {
  if (location.protocol === "file:") {
    const error = new Error("Catalina debe abrirse desde el servidor local");
    error.code = "LOCAL_FILE";
    throw error;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const error = new Error("El navegador no habilitó el micrófono en este contexto");
    error.code = "MIC_CONTEXT";
    throw error;
  }
  if (!window.RTCPeerConnection) {
    const error = new Error("Este navegador no admite WebRTC");
    error.code = "WEBRTC_UNSUPPORTED";
    throw error;
  }
}

function looksLikeAudio(text) {
  return text.length > 100 && /^[A-Za-z0-9+/=]+$/.test(text);
}

export function connectionErrorMessage(error) {
  if (error?.code === "LOCAL_FILE") return "Abre Catalina con start.command";
  if (error?.code === "MIC_CONTEXT") return "El micrófono requiere el servidor local";
  if (error?.code === "WEBRTC_UNSUPPORTED") return "Este navegador no admite WebRTC";
  if (error?.code === "API_KEY_INVALID") return "La clave de API fue rechazada";
  if (error?.code === "API_KEY_MISSING") return "Falta la clave de API";
  if (error?.code === "API_RATE_LIMIT") return "Límite de API o facturación";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Permiso de micrófono bloqueado";
  if (error?.name === "NotFoundError") return "No se encontró un micrófono";
  if (error?.name === "NotReadableError") return "El micrófono está ocupado por otra aplicación";
  if (error?.name === "OverconstrainedError") return "El micrófono no admite esta configuración";
  if (error?.name === "TypeError" || error?.message === "Failed to fetch") return "No responde el servidor local";
  return error?.message || "No se pudo iniciar la conversación";
}

export function connectionErrorHelp(error) {
  if (error?.code === "LOCAL_FILE") return "Cierra esta pestaña y ejecuta start.command; luego abre http://127.0.0.1:4173.";
  if (error?.code === "MIC_CONTEXT") return "Usa http://127.0.0.1:4173, permite el micrófono y recarga la página.";
  if (error?.code === "API_KEY_INVALID") return "La clave debe ser una API key de platform.openai.com, no tu sesión ni contraseña de ChatGPT.";
  if (error?.code === "API_KEY_MISSING") return "Agrega OPENAI_API_KEY en .env y reinicia start.command.";
  if (error?.code === "API_RATE_LIMIT") return "Revisa límites, saldo y facturación en tu proyecto de OpenAI.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Autoriza el micrófono para 127.0.0.1 en la configuración del navegador y vuelve a intentar.";
  if (error?.name === "NotFoundError") return "Conecta un micrófono y revisa que macOS lo tenga seleccionado como entrada.";
  if (error?.name === "NotReadableError") return "Cierra Zoom, Meet u otra app que esté usando el micrófono y vuelve a intentar.";
  return "Revisa el mensaje de estado y vuelve a iniciar Catalina desde start.command.";
}
