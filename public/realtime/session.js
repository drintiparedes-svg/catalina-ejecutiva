// Sesión de voz contra OpenAI Realtime.
//
// Todo el intercambio de SDP pasa por el servidor local, que es quien conserva
// la clave. Aquí sólo viven WebRTC, el canal de eventos y la traducción de los
// errores a mensajes que se puedan leer en pantalla.

export class RealtimeSession {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.peer = null;
    this.channel = null;
    this.micStream = null;
    this.connected = false;
    this.muted = false;
    this.transcript = "";
  }

  #emit(name, ...args) {
    return this.handlers[name]?.(...args);
  }

  async connect() {
    this.#emit("onStatus", "Solicitando acceso al micrófono…");
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
      this.channel.addEventListener("open", () => this.#onChannelOpen());
      this.channel.addEventListener("message", message => this.#onEvent(message));

      this.peer.addEventListener("track", event => this.#emit("onRemoteStream", event.streams[0]));
      this.peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected", "closed"].includes(this.peer?.connectionState)) {
          this.disconnect();
        }
      });

      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      const response = await fetch("/session", {
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
      this.#emit("onStatus", connectionErrorMessage(error));
      this.#emit("onHelp", connectionErrorHelp(error));
    }
  }

  #onChannelOpen() {
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
    this.#emit("onConnected");
    this.#emit("onPhase", "listening");
    this.#emit("onStatus", "Te escucho");
  }

  #onEvent(message) {
    const event = JSON.parse(message.data);
    if (event.type === "input_audio_buffer.speech_started") {
      this.transcript = "";
      this.#emit("onTranscript", "");
      this.#emit("onPhase", "listening");
      this.#emit("onStatus", "Te escucho…");
    } else if (event.type === "response.created") {
      this.#emit("onPhase", "thinking");
      this.#emit("onStatus", "Pensando…");
    } else if (
      event.type === "response.output_audio.delta" ||
      event.type === "response.audio.delta"
    ) {
      this.#emit("onPhase", "speaking");
      this.#emit("onStatus", "Hablando");
      const delta = event.delta || event.transcript || "";
      if (typeof delta === "string" && !looksLikeAudio(delta)) {
        this.transcript += delta;
        this.#emit("onTranscript", this.transcript);
      }
    } else if (
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.audio_transcript.delta"
    ) {
      // Con WebRTC ésta es la única señal de que Catalina está hablando: el
      // audio va por la pista de medios y no se anuncia por el canal.
      this.#emit("onPhase", "speaking");
      this.#emit("onStatus", "Hablando");
      this.transcript += event.delta || "";
      this.#emit("onTranscript", this.transcript);
    } else if (event.type === "response.done") {
      // El modelo genera por delante de la reproducción, así que aquí sólo se
      // anota que no habrá más texto; volver a escuchar lo decide el silencio
      // real del audio, en app.js.
      this.#emit("onResponseDone");
    } else if (event.type === "error") {
      console.error("Realtime event", event);
      this.#emit("onStatus", event.error?.message || "Ocurrió un error");
    }
  }

  disconnect() {
    this.connected = false;
    this.channel?.close();
    this.peer?.close();
    this.micStream?.getTracks().forEach(track => track.stop());
    this.peer = this.channel = this.micStream = null;
    this.muted = false;
    this.#emit("onDisconnected");
    this.#emit("onPhase", "idle");
  }

  toggleMute() {
    this.muted = !this.muted;
    this.micStream?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
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
