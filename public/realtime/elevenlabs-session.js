// Sesión de voz contra un agente de ElevenLabs.
//
// Expone la misma interfaz que las otras dos sesiones (connect, disconnect,
// toggleMute, enviarTexto y los mismos handlers) para que app.js no tenga que
// saber con quién habla. Por dentro se parece mucho a la de Gemini —WebSocket,
// micrófono a PCM, audio de vuelta al reproductor— con dos diferencias que
// importan:
//
//   · **El agente entero es de ellos.** Oído, cerebro y voz. Aquí no se manda
//     un modelo ni instrucciones sueltas: se abre la conversación con el agente
//     que esté configurado en su panel, y como mucho se le sobrescriben la
//     persona, el idioma y la voz al empezar.
//   · **La boca no se adivina, se sabe.** Con cada trozo de audio llega la
//     alineación: qué carácter suena, cuándo empieza y cuánto dura. Eso se
//     convierte en posturas de boca (audio/visemas-alineados.js) y se lee con
//     el reloj de reproducción del worklet, no con el de pared: el audio viene
//     por delante y a ráfagas, así que un reloj de pared adelantaría los labios.
//
// La intensidad sigue saliendo del analizador de siempre, que escucha el mismo
// stream que suena. La forma la pone la alineación; la fuerza, el audio.

import { VisemasAlineados } from "../audio/visemas-alineados.js";

const SALIDA_HZ = 24000;    // frecuencia del reproductor; lo que llegue se ajusta
const ENTRADA_HZ = 16000;   // lo que el agente espera recibir del micrófono
const MUESTRAS_POR_ENVIO = 2048;

export class ElevenLabsSession {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.socket = null;
    this.micStream = null;
    this.entrada = null;      // AudioContext de captura
    this.salida = null;       // AudioContext de reproducción
    this.destino = null;      // MediaStreamAudioDestinationNode con la voz
    this.reproductor = null;
    this.nodoEntrada = null;
    this.connected = false;
    this.muted = false;
    this.transcript = "";

    // Boca. `encoladas` cuenta las muestras entregadas al reproductor: es lo
    // que sitúa cada trozo de alineación en la línea de tiempo. `sonando` es lo
    // que el worklet dice que ya salió por los altavoces.
    this.visemas = new VisemasAlineados();
    this.encoladas = 0;
    this.sonando = 0;

    this.entradaHz = ENTRADA_HZ;
    this.recibidoHz = SALIDA_HZ;
  }

  #emit(name, ...args) {
    return this.handlers[name]?.(...args);
  }

  async connect() {
    this.#emit("onStatus", "Solicitando acceso al micrófono…");
    try {
      assertVoiceEnvironment();

      // La clave nunca llega al navegador: el servidor firma la sesión y
      // devuelve la dirección ya autorizada.
      const respuesta = await fetch("/elevenlabs/sesion", { method: "POST" });
      if (!respuesta.ok) {
        const detalle = await respuesta.json().catch(() => ({}));
        const error = new Error(detalle.error || `ElevenLabs no está disponible (${respuesta.status})`);
        error.code = detalle.code || "ELEVENLABS_SESSION_ERROR";
        throw error;
      }
      const { url, inicio } = await respuesta.json();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      await this.#prepararSalida();
      await this.#abrirSocket(url, inicio);
      await this.#prepararEntrada();
    } catch (error) {
      console.error(error);
      this.disconnect();
      error.mensaje = mensajeDeError(error);
      error.ayuda = ayudaDeError(error);
      this.#emit("onFailure", error);
    }
  }

  #abrirSocket(url, inicio) {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);

      this.socket.addEventListener("open", () => {
        // Primer mensaje obligatorio: es donde se sobrescriben persona, idioma
        // y voz sin tocar la configuración del agente en su panel.
        this.socket.send(JSON.stringify(inicio));
        this.connected = true;
        this.#emit("onConnected");
        this.#emit("onPhase", "listening");
        this.#emit("onStatus", "Te escucho");
        resolve();
      });
      this.socket.addEventListener("message", evento => this.#onMensaje(evento));
      this.socket.addEventListener("error", () => reject(new Error("No se pudo abrir la sesión con ElevenLabs")));
      this.socket.addEventListener("close", () => { if (this.connected) this.disconnect(); });
    });
  }

  async #prepararSalida() {
    this.salida = new AudioContext({ sampleRate: SALIDA_HZ });
    await this.salida.resume().catch(() => {});
    await this.salida.audioWorklet.addModule("./audio/reproductor-pcm.js");

    this.reproductor = new AudioWorkletNode(this.salida, "reproductor-pcm", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]
    });

    // El reloj de la boca. Llega cada 20 ms con las muestras ya reproducidas.
    this.reproductor.port.onmessage = ({ data }) => {
      if (data?.tipo !== "reloj") return;
      if (data.reinicio) {
        this.encoladas = 0;
        this.visemas.vaciar();
      }
      this.sonando = data.muestras;
    };

    this.destino = this.salida.createMediaStreamDestination();
    this.reproductor.connect(this.destino);
    this.#emit("onRemoteStream", this.destino.stream);
  }

  #reproducir(base64, alineacion) {
    if (!this.reproductor) return;
    const bytes = decodificar(base64);
    const enteros = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    if (!enteros.length) return;

    let muestras = new Float32Array(enteros.length);
    for (let i = 0; i < enteros.length; i += 1) muestras[i] = enteros[i] / 32768;
    // El agente puede mandar a 16 o a 24 kHz según cómo esté configurado; el
    // reproductor siempre va a 24. Ajustar aquí evita rehacer el contexto de
    // audio a media conversación, que corta el sonido.
    if (this.recibidoHz !== SALIDA_HZ) {
      muestras = remuestrear(muestras, this.recibidoHz, SALIDA_HZ);
    }

    // La alineación se ancla justo donde empieza a sonar este trozo.
    if (alineacion) this.visemas.agregar(alineacion, this.encoladas / SALIDA_HZ);
    this.encoladas += muestras.length;

    this.reproductor.port.postMessage({ tipo: "audio", muestras }, [muestras.buffer]);
  }

  #callar() {
    this.reproductor?.port.postMessage({ tipo: "callar" });
    this.visemas.vaciar();
    this.encoladas = 0;
    this.sonando = 0;
  }

  // Postura de boca de este instante, o null si no hay alineación viva. La lee
  // el bucle de dibujo en cada cuadro.
  posturaDeBoca() {
    if (!this.connected || this.visemas.vacio) return null;
    return this.visemas.postura(this.sonando / SALIDA_HZ);
  }

  async #prepararEntrada() {
    this.entrada = new AudioContext();
    await this.entrada.resume().catch(() => {});
    const origen = this.entrada.createMediaStreamSource(this.micStream);
    const nodo = this.entrada.createScriptProcessor(MUESTRAS_POR_ENVIO, 1, 1);

    nodo.onaudioprocess = evento => {
      if (this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      const original = evento.inputBuffer.getChannelData(0);
      const pcm = aPcm16(remuestrear(original, this.entrada.sampleRate, this.entradaHz));
      this.socket.send(JSON.stringify({ user_audio_chunk: codificar(pcm) }));
    };

    origen.connect(nodo);
    const mudo = this.entrada.createGain();
    mudo.gain.value = 0;
    nodo.connect(mudo).connect(this.entrada.destination);
    this.nodoEntrada = nodo;
  }

  #onMensaje(evento) {
    let mensaje = {};
    try { mensaje = JSON.parse(evento.data); } catch { return; }

    switch (mensaje.type) {
      // Formatos reales de la conversación. Vienen antes que el primer audio.
      case "conversation_initiation_metadata": {
        const meta = mensaje.conversation_initiation_metadata_event ?? {};
        this.recibidoHz = frecuenciaDe(meta.agent_output_audio_format, SALIDA_HZ);
        this.entradaHz = frecuenciaDe(meta.user_input_audio_format, ENTRADA_HZ);
        break;
      }

      case "audio": {
        const audio = mensaje.audio_event ?? {};
        if (!audio.audio_base_64) break;
        this.#emit("onPhase", "speaking");
        this.#emit("onStatus", "Hablando");
        this.#reproducir(audio.audio_base_64, audio.alignment);
        break;
      }

      // Subtítulos. Llegan en trozos mientras habla, y el mensaje completo al
      // final; se prefiere el trozo para que el texto acompañe a la voz.
      case "agent_chat_response_part": {
        const parte = mensaje.text_response_part ?? {};
        if (parte.type === "start") this.transcript = "";
        if (parte.text) {
          this.transcript += parte.text;
          this.#emit("onTranscript", this.transcript);
        }
        break;
      }

      // El texto completo del turno. Llega cuando el agente ya no va a decir
      // más, aunque el audio siga sonando un rato: igual que con OpenAI, aquí
      // sólo se anota que no habrá más texto. Volver a escuchar lo decide el
      // silencio real del audio, en app.js.
      case "agent_response": {
        const dicho = mensaje.agent_response_event?.agent_response;
        if (dicho) {
          this.transcript = dicho;
          this.#emit("onTranscript", this.transcript);
        }
        this.#emit("onResponseDone");
        break;
      }

      // Corrección: cuando la interrumpen, el agente dice qué alcanzó a decir
      // de verdad. El historial se queda con eso y no con lo que iba a decir.
      case "agent_response_correction": {
        const correccion = mensaje.agent_response_correction_event ?? {};
        if (correccion.corrected_agent_response) {
          this.transcript = correccion.corrected_agent_response;
          this.#emit("onTranscript", this.transcript);
        }
        break;
      }

      case "interruption": {
        this.#callar();
        this.#emit("onPhase", "listening");
        this.#emit("onStatus", "Te escucho…");
        this.transcript = "";
        this.#emit("onTranscript", "");
        break;
      }

      // Mantener viva la conexión. Si no se contesta, el agente cuelga.
      case "ping": {
        const evento_id = mensaje.ping_event?.event_id;
        this.#responder({ type: "pong", event_id: evento_id });
        break;
      }

      case "client_tool_call": {
        this.#atenderHerramienta(mensaje.client_tool_call ?? {});
        break;
      }
    }
  }

  #responder(objeto) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(objeto));
    }
  }

  // Herramientas. El agente pide, app.js resuelve contra el servidor, y el
  // resultado vuelve como texto: el protocolo espera una cadena.
  async #atenderHerramienta(llamada) {
    const { tool_name: nombre, tool_call_id: id, parameters: parametros } = llamada;
    if (!nombre || !id) return;

    let resultado;
    try {
      resultado = await this.#emit("onToolCall", nombre, parametros || {});
    } catch (error) {
      console.error(error);
      resultado = { ok: false, error: "La herramienta falló" };
    }

    const salida = resultado ?? { ok: false, error: "Sin resultado" };
    this.#responder({
      type: "client_tool_result",
      tool_call_id: id,
      result: typeof salida === "string" ? salida : JSON.stringify(salida),
      is_error: salida?.ok === false
    });
  }

  // Entrada por texto, para el modo reunión.
  enviarTexto(texto) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.#responder({ type: "user_message", text: texto });
    return true;
  }

  disconnect() {
    this.connected = false;
    this.#callar();
    try { this.socket?.close(); } catch {}
    this.nodoEntrada?.disconnect();
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
    this.#emit("onMute", this.muted);
    return this.muted;
  }
}

// `pcm_24000` → 24000. Si llega algo que no se reconoce se usa lo esperado, que
// es mejor que reproducir a una frecuencia inventada.
function frecuenciaDe(formato, porDefecto) {
  const encontrado = String(formato ?? "").match(/(\d{4,6})/);
  const hz = encontrado ? Number(encontrado[1]) : NaN;
  return Number.isFinite(hz) && hz >= 8000 && hz <= 48000 ? hz : porDefecto;
}

function remuestrear(muestras, desde, hasta) {
  if (desde === hasta) return muestras;
  const proporcion = desde / hasta;
  const salida = new Float32Array(Math.round(muestras.length / proporcion));
  for (let i = 0; i < salida.length; i += 1) {
    const posicion = i * proporcion;
    const indice = Math.floor(posicion);
    const resto = posicion - indice;
    const a = muestras[indice] ?? 0;
    const b = muestras[indice + 1] ?? a;
    salida[i] = a + (b - a) * resto;
  }
  return salida;
}

function aPcm16(muestras) {
  const salida = new Int16Array(muestras.length);
  for (let i = 0; i < muestras.length; i += 1) {
    const valor = Math.max(-1, Math.min(1, muestras[i]));
    salida[i] = valor < 0 ? valor * 0x8000 : valor * 0x7fff;
  }
  return salida;
}

function codificar(enteros) {
  const bytes = new Uint8Array(enteros.buffer, enteros.byteOffset, enteros.byteLength);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 1) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

function decodificar(base64) {
  const texto = atob(base64);
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

function assertVoiceEnvironment() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const error = new Error("El micrófono necesita una conexión segura (https) o localhost.");
    error.code = "INSECURE_CONTEXT";
    throw error;
  }
  if (!window.WebSocket) {
    const error = new Error("Este navegador no admite WebSocket.");
    error.code = "NO_WEBSOCKET";
    throw error;
  }
}

function mensajeDeError(error) {
  if (error.code === "ELEVENLABS_KEY_MISSING") return "Falta la clave de ElevenLabs.";
  if (error.code === "ELEVENLABS_AGENT_MISSING") return "Falta decir qué agente de ElevenLabs usar.";
  if (error.name === "NotAllowedError") return "Hace falta permiso del micrófono para conversar.";
  return error.mensaje || error.message || "No se pudo abrir la conversación.";
}

function ayudaDeError(error) {
  if (error.code === "ELEVENLABS_KEY_MISSING") {
    return "Añade ELEVENLABS_API_KEY al archivo .env y vuelve a abrir.";
  }
  if (error.code === "ELEVENLABS_AGENT_MISSING") {
    return "Añade ELEVENLABS_AGENT_ID al .env con el identificador del agente que creaste en su panel.";
  }
  if (error.name === "NotAllowedError") {
    return "Permite el micrófono en el candado de la barra de direcciones y vuelve a intentarlo.";
  }
  return "";
}
