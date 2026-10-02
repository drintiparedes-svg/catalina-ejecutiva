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

import { crearCaptura, Decimador, aPcm16, abrirMicrofonoDeConversacion } from "./entrada.js";
import { VisemasAlineados } from "../audio/visemas-alineados.js";

const SALIDA_HZ = 24000;    // frecuencia del reproductor; lo que llegue se ajusta
const ENTRADA_HZ = 16000;   // lo que el agente espera recibir del micrófono
// Tras callar, el audio de la reunión sigue cortado un momento más: lo que
// vuelve por la videollamada llega con retraso y sería su propia voz.
const RETENCION_MS = 700;

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

    // Para saber si la sesión llegó a arrancar de verdad. ElevenLabs confirma
    // con `conversation_initiation_metadata`; si cierra antes de eso, es que
    // rechazó algo de lo que le mandamos, no que la conversación terminara.
    this.url = null;
    this.inicio = null;
    this.arranco = false;
    this.reintentoSinAjustes = false;
    this.cierreLimpio = false;   // true cuando el cierre lo pedimos nosotros
    this.ultimaInterrupcion = -1; // event_id de la última interrupción
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

      this.micStream = await abrirMicrofonoDeConversacion();

      this.url = url;
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
    this.inicio = inicio;
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
      this.socket.addEventListener("close", evento => this.#alCerrar(evento));
    });
  }

  // Un cierre puede ser el final normal de una conversación o un rechazo. Se
  // distinguen por si ElevenLabs llegó a confirmar la sesión.
  //
  // El rechazo más habitual: en su panel, cada sobrescritura —persona, idioma,
  // voz— viene desactivada, y hay que permitirla agente por agente. Si no está
  // permitida, ElevenLabs no contesta «no puedes»: cierra el socket. Desde
  // fuera se ve como un micrófono que se conecta y se desconecta solo.
  //
  // Así que se reintenta una vez sin sobrescribir nada. La conversación
  // funciona —con la persona que tenga el agente en su panel, no la de aquí— y
  // se avisa de qué hay que activar para recuperarla.
  #alCerrar(evento) {
    const codigo = evento?.code;
    const motivo = evento?.reason || "";
    // Un cierre limpio es el que pedimos nosotros (colgar) o el 1000 de fin de
    // turno. Cualquier otro lo impone ElevenLabs, y hay que contarlo.
    const limpio = this.cierreLimpio || codigo === 1000;

    // Un único reintento sin sobrescrituras: la causa más común es que el
    // agente no las tiene permitidas en su panel. Si funciona, la conversación
    // sigue con la persona que el agente tenga puesta.
    if (!this.arranco && !this.reintentoSinAjustes && this.inicio?.conversation_config_override) {
      this.reintentoSinAjustes = true;
      console.warn("ElevenLabs cerró antes de empezar:", codigo, motivo);
      this.#emit("onStatus", "Reintentando…");
      this.#abrirSocket(this.url, { type: "conversation_initiation_client_data" })
        .catch(() => this.disconnect());
      return;
    }

    if (!limpio) {
      const parte = explicarCierre(codigo, motivo, this.arranco, this.reintentoSinAjustes);
      console.warn("ElevenLabs cerró la sesión:", codigo, motivo);
      // La nota queda en el historial: es lo que hay que releer para arreglarlo.
      this.#emit("onNota", parte.nota);
      if (!this.arranco) {
        this.#emit("onFailure", Object.assign(new Error(parte.corto), {
          code: "ELEVENLABS_SESSION_ERROR",
          mensaje: parte.corto,
          ayuda: parte.ayuda
        }));
      } else {
        this.#emit("onHelp", parte.ayuda);
      }
    }

    if (this.connected) this.disconnect();
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
      if (data?.tipo === "voz") this.#alSonar(data.sonando);
      if (data?.tipo === "voz" || data?.tipo === "estadisticas") this.estadisticasVoz = { ...data, tipo: undefined };
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

    // La compuerta de la reunión se cierra en cuanto llega su voz, sin esperar
    // a que suene: el colchón del reproductor tarda unos 200 ms, y en ese rato
    // el audio de la llamada ya podría interrumpirla.
    if (!this.hablando) this.#alSonar(true);
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
    // `retrasoBoca`: lo que tarda en sonar la voz si pasa por la ruta de
    // cancelación de eco (app.js); sin él los labios irían adelantados.
    return this.visemas.postura(this.sonando / SALIDA_HZ - (this.retrasoBoca || 0));
  }

  async #prepararEntrada() {
    this.entrada = new AudioContext();
    await this.entrada.resume().catch(() => {});
    const origen = this.entrada.createMediaStreamSource(this.micStream);
    // Captura en el hilo de audio con bloques de ~20 ms (entrada.js). La
    // frecuencia que espera el agente puede llegar después de abrir el
    // micrófono (conversation_initiation_metadata): el decimador se rehace si
    // cambia.
    const nodo = await crearCaptura(this.entrada, muestras => {
      if (this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      if (this.decimador?.hasta !== this.entradaHz) {
        this.decimador = new Decimador(this.entrada.sampleRate, this.entradaHz);
        this.decimador.hasta = this.entradaHz;
      }
      const pcm = aPcm16(this.decimador.procesar(muestras));
      if (pcm.length) this.socket.send(JSON.stringify({ user_audio_chunk: codificar(pcm) }));
    });
    origen.connect(nodo);
    this.nodoEntrada = nodo;
    if (this.flujoExtra) this.mezclarEntrada(this.flujoExtra);
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
        this.arranco = true;
        if (this.reintentoSinAjustes) {
          this.#emit("onNota",
            "Tu agente no permite sobrescribir su configuración, así que Catalina habla con la persona y la voz que tenga puestas en ElevenLabs. " +
            "Para usar las de este proyecto, entra a tu agente → Security → y activa los overrides de prompt, idioma y voz.");
        }
        break;
      }

      case "audio": {
        const audio = mensaje.audio_event ?? {};
        if (!audio.audio_base_64) break;
        // Audio de una respuesta ya interrumpida que llega tarde: se descarta,
        // como hace el SDK oficial. Sonaba como restos de la respuesta anterior.
        if (Number.isFinite(audio.event_id) && audio.event_id <= this.ultimaInterrupcion) break;
        this.interrumpida = false;
        this.#emit("onPhase", "speaking");
        this.#emit("onStatus", "Hablando");
        this.#reproducir(audio.audio_base_64, audio.alignment);
        break;
      }

      // Subtítulos. Llegan en trozos mientras habla, y el mensaje completo al
      // final; se prefiere el trozo para que el texto acompañe a la voz.
      case "agent_chat_response_part": {
        const parte = mensaje.text_response_part ?? {};
        if (parte.type === "start") {
          this.interrumpida = false;
          this.transcript = "";
          // El texto de la respuesta llega un poco antes que su audio.
          if (!this.hablando) this.#alSonar(true);
        }
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
        // El texto completo de una respuesta que ya se interrumpió no se
        // muestra: no llegó a decirse. Lo que sí se dijo llega en la corrección.
        if (this.interrumpida) break;
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
        // Corrige la respuesta ya mostrada; no abre un turno nuevo.
        if (correccion.corrected_agent_response) {
          this.#emit("onTranscript", correccion.corrected_agent_response, { correccion: true });
        }
        break;
      }

      case "interruption": {
        this.interrupciones = (this.interrupciones || 0) + 1;
        this.interrumpida = true;
        const id = mensaje.interruption_event?.event_id;
        if (Number.isFinite(id)) this.ultimaInterrupcion = Math.max(this.ultimaInterrupcion, id);
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

  // Contexto silencioso: ElevenLabs lo añade a la conversación sin que el
  // agente responda ni interrumpa lo que esté diciendo. Es el canal por el que
  // la reunión en curso pasa a su memoria.
  anadirContexto(texto) {
    if (this.socket?.readyState !== WebSocket.OPEN || !texto) return false;
    this.#responder({ type: "contextual_update", text: texto });
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
    this.cierreLimpio = true;
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
    this.arranco = false;
    this.reintentoSinAjustes = false;
    this.cierreLimpio = false;
    this.ultimaInterrupcion = -1;
    this.#emit("onDisconnected");
    this.#emit("onPhase", "idle");
  }

  toggleMute() {
    this.muted = !this.muted;
    this.#emit("onMute", this.muted);
    return this.muted;
  }

  // Corta lo que se envía sin apagar la pista del micrófono, igual que en las
  // otras dos sesiones. Faltaba aquí, y con ElevenLabs —la voz principal— el
  // modo reunión fallaba al entrar: la llamada lanzaba un error antes de que
  // arrancara la escucha. El envío de audio ya mira `muted` en cada bloque.
  pausarEnvio(pausado) {
    this.muted = Boolean(pausado);
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

// Traduce el cierre de un WebSocket a algo accionable. El texto que manda
// ElevenLabs (`motivo`) es casi siempre lo más útil, así que se muestra tal
// cual; el código sólo afina la pista de qué tocar.
function explicarCierre(codigo, motivo, arranco, reintentado) {
  const suyo = motivo ? `ElevenLabs dijo: «${motivo}».` : "";
  const cod = codigo ? `(código ${codigo})` : "";

  // 1008 es «violación de política»: overrides no permitidos o clave sin
  // permiso. Si ya reintentamos sin overrides y volvió a pasar, no eran los
  // overrides: apunta a la clave o a que el agente no está publicado.
  if (codigo === 1008) {
    const ayuda = reintentado
      ? "El agente cortó incluso sin pedirle nada especial. Suele ser la cuenta sin crédito, o el agente sin publicar. Revísalo en su panel."
      : "Activa las sobrescrituras del agente: en ElevenLabs, tu agente → Security → habilita System prompt, Language y Voice. O revisa que la cuenta tenga crédito.";
    return {
      corto: "ElevenLabs cortó la conversación.",
      ayuda: `${suyo} ${ayuda}`.trim(),
      nota: `ElevenLabs cerró la conversación ${cod}. ${suyo} ${ayuda}`.trim()
    };
  }
  if (codigo === 1011 || (codigo >= 1012 && codigo <= 1014)) {
    return {
      corto: "ElevenLabs tuvo un problema en su servicio.",
      ayuda: `${suyo} No es cosa tuya; vuelve a intentar en un momento.`.trim(),
      nota: `ElevenLabs falló de su lado ${cod}. ${suyo}`.trim()
    };
  }
  // Cualquier otro cierre inesperado: se muestra el motivo verbatim, que es lo
  // que de verdad dice qué pasó.
  const base = arranco
    ? "La conversación se cortó."
    : "ElevenLabs cerró la sesión nada más abrirla.";
  return {
    corto: base,
    ayuda: suyo || `Se cerró sin dar motivo ${cod}. Revisa en su panel que el agente esté publicado y que la cuenta tenga crédito.`,
    nota: `${base} ${cod} ${suyo}`.trim()
  };
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
