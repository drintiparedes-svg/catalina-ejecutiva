// Grabadora de alta fidelidad para reuniones.
//
// El reconocimiento del navegador (escucha.js) es gratis, pero tiene dos
// límites de fondo que ningún ajuste corrige:
//
//   · Sólo oye el micrófono. Con audífonos, las voces de quienes están al otro
//     lado del Meet nunca llegan a él: la mitad de la reunión no existe.
//   · Transcribe con el motor genérico de Chrome, que se corta, pierde
//     términos técnicos y no admite contexto.
//
// Esta grabadora captura el micrófono y, si se autoriza, el audio de la
// pestaña de la reunión, los mezcla y cada 20–40 s envía un tramo al servidor
// para transcribirlo con un modelo de voz dedicado. Los tramos se cortan en
// silencios, los que son sólo silencio no se envían y los que fallan se
// reintentan.
//
// Continuidad: reuniones presenciales en un notebook. Lo que cortaba la
// transcripción no era el modelo sino el equipo ahorrando energía:
//
//   · Audífonos Bluetooth o micrófonos USB que el sistema desconecta: la pista
//     del micrófono terminaba y la grabación seguía «grabando» silencio sin
//     avisar. Ahora se vigila la pista (ended, mute, devicechange, silencio
//     digital) y se reconecta sola, a otro micrófono si el elegido no está.
//   · El contexto de audio pausado por el sistema: se detecta y se reanuda.
//   · Captura en el hilo principal (ScriptProcessor), que pierde bloques si la
//     pestaña va en segundo plano o el equipo va justo: ahora corre en un
//     AudioWorklet (audio/captura-pcm.js), con el anterior como respaldo.
//   · Equipo suspendido: no se puede grabar, pero se detecta comparando el
//     reloj de audio con el de pared y queda registrado como hueco con su
//     causa, en vez de una cobertura del 100 % falsa.
//   · Tramos perdidos por la red: cada tramo con voz se guarda en este
//     navegador antes de enviarlo (archivo-audio.js) y se puede volver a
//     transcribir después.
//
// Coste orientativo: unos pocos centavos de dólar por hora con Gemini Flash, o
// alrededor de 0,36 USD/h con gpt-4o-transcribe (tarifas públicas a sept. 2026,
// a verificar en cada proveedor).

const HZ = 16000;                   // suficiente para voz; la mitad de datos que 32 kHz
const TRAMO_MIN_S = 20;
const TRAMO_MAX_S = 40;
const SILENCIO_RMS = 0.012;         // por debajo, se considera silencio
const VOZ_RMS = 0.02;               // un tramo sin nada por encima de esto no se envía
const REINTENTOS = 3;
const HUECO_MIN_MS = 2500;          // desfase entre relojes que cuenta como audio perdido
const SILENCIO_DIGITAL_MS = 8000;   // ceros exactos durante esto = micrófono sin señal
const MUTE_MS = 3000;               // una pista silenciada por el sistema tanto tiempo se reconecta

export const grabadoraDisponible = () => Boolean(window.AudioContext && navigator.mediaDevices?.getUserMedia);
export const audioDePestanaDisponible = () => Boolean(navigator.mediaDevices?.getDisplayMedia);

// Micrófonos disponibles, para elegir en el diálogo. Las etiquetas sólo
// aparecen con el permiso ya concedido.
export async function microfonos() {
  try {
    const lista = await navigator.mediaDevices.enumerateDevices();
    return lista.filter(d => d.kind === "audioinput" && d.deviceId !== "communications")
      .map(d => ({ id: d.deviceId, nombre: d.label || "Micrófono", bluetooth: esBluetooth(d.label) }));
  } catch { return []; }
}
export const esBluetooth = nombre => /airpods|bluetooth|hands-?free|headset|buds|beats|bose|jabra|sony wh|wf-|manos libres/i.test(String(nombre || ""));

const esperar = ms => new Promise(ok => setTimeout(ok, ms));

export class GrabadoraDeReunion {
  constructor({ transcribir, alSegmento, alFallo, alEstado, alEvento, alHueco, alBloque, archivo = null } = {}) {
    this.transcribir = transcribir;     // async (wavBase64, meta) => {ok, texto, proveedor}
    this.alSegmento = alSegmento;
    this.alFallo = alFallo;
    this.alEstado = alEstado;
    this.alEvento = alEvento;           // ({tipo, momento, detalle}) — registro de continuidad
    this.alHueco = alHueco;             // ({desde, hasta, causa}) — audio que no se pudo grabar
    this.alBloque = alBloque;           // latido: llega con cada bloque de audio
    this.archivo = archivo;             // {guardar(pcm, meta) → id, actualizar(id, cambios)}
    this.activa = false;
    this.flujos = [];
    this.ctx = null;
    this.nodo = null;
    this.mezcla = null;
    this.mic = null;                    // MediaStream del micrófono en uso
    this.fuenteMic = null;
    this.dispositivo = "";              // deviceId preferido ("" = el del sistema)
    this.muestras = [];
    this.largo = 0;
    this.inicioTramo = 0;
    this.silencioFinal = 0;
    this.picoTramo = 0;
    this.cola = Promise.resolve();
    this.pendientes = 0;
    this.previo = "";
    this.conPestana = false;
    this.reconectando = false;
    this.micPerdidoDesde = 0;
    this.sinSenalDesde = 0;
    this.cerosDesde = 0;
    this.ultimaSuspension = 0;
    this.estadisticas = { reconexiones: 0, huecos: 0, msPerdidos: 0, bloques: 0, captura: "" };
  }

  // Tiene que llamarse dentro del gesto del usuario (un clic): el navegador
  // no deja pedir el audio de la pestaña de otro modo.
  // El audio de la reunión llega ya capturado (puente-meet.js): la pestaña se
  // comparte una sola vez y ese mismo audio sirve para grabar y para que
  // Catalina oiga. Esta grabadora no lo detiene al terminar: es del puente.
  async iniciar({ flujoReunion = null, dispositivo = "" } = {}) {
    if (this.activa) return { ok: true };
    this.dispositivo = dispositivo || "";
    let mic;
    try {
      mic = await this.#abrirMicrofono();
    } catch (error) {
      return { ok: false, error: "No se pudo abrir el micrófono para grabar." };
    }

    this.conPestana = Boolean(flujoReunion?.getAudioTracks?.().length);
    if (this.conPestana) {
      flujoReunion.getAudioTracks()[0].addEventListener("ended", () => {
        this.conPestana = false;
        this.#evento("pestana-perdida", "se dejó de compartir la pestaña de la reunión");
        this.alEstado?.("Se dejó de compartir la pestaña de la reunión: sigo grabando sólo el micrófono", "aviso");
      });
    }

    this.ctx = new AudioContext();
    this.ctx.onstatechange = () => this.#alCambiarContexto();
    this.mezcla = this.ctx.createGain();
    this.#conectarMicrofono(mic);
    if (this.conPestana) this.ctx.createMediaStreamSource(new MediaStream(flujoReunion.getAudioTracks())).connect(this.mezcla);

    await this.#prepararCaptura();
    // El nodo tiene que llegar al destino para que el navegador lo procese; se
    // conecta a través de una ganancia cero para no oír el eco.
    const mudo = this.ctx.createGain();
    mudo.gain.value = 0;
    this.nodo.connect(mudo).connect(this.ctx.destination);

    this.activa = true;
    this.inicioPared = 0;
    this.#reiniciarTramo();
    this.alDispositivos = () => this.#revisarDispositivos();
    navigator.mediaDevices.addEventListener?.("devicechange", this.alDispositivos);
    this.#evento("inicio", `micrófono: ${this.nombreMicrofono()}; captura: ${this.estadisticas.captura}`);
    return { ok: true, conPestana: this.conPestana, microfono: this.nombreMicrofono() };
  }

  nombreMicrofono() {
    return this.mic?.getAudioTracks()[0]?.label || "micrófono del sistema";
  }

  // AudioWorklet si se puede; ScriptProcessor si el navegador no lo tiene.
  async #prepararCaptura() {
    try {
      await this.ctx.audioWorklet.addModule(new URL("./audio/captura-pcm.js", import.meta.url));
      this.nodo = new AudioWorkletNode(this.ctx, "captura-pcm", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      this.nodo.port.onmessage = ({ data }) => this.#recibir(data.muestras, data.frame);
      this.estadisticas.captura = "hilo de audio";
    } catch (error) {
      console.warn("Grabadora: sin AudioWorklet, uso ScriptProcessor", error);
      this.nodo = this.ctx.createScriptProcessor(4096, 1, 1);
      this.nodo.onaudioprocess = evento => this.#recibir(evento.inputBuffer.getChannelData(0), Math.round(evento.playbackTime * this.ctx.sampleRate));
      this.estadisticas.captura = "hilo principal (respaldo)";
    }
    this.mezcla.connect(this.nodo);
  }

  // ── Micrófono: apertura, vigilancia y reconexión ────────────────────────────

  async #abrirMicrofono() {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    if (this.dispositivo) {
      const disponibles = await microfonos();
      if (disponibles.some(d => d.id === this.dispositivo)) {
        try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: this.dispositivo } } }); }
        catch {}
      }
    }
    return await navigator.mediaDevices.getUserMedia({ audio: base });
  }

  #conectarMicrofono(mic) {
    try { this.fuenteMic?.disconnect(); } catch {}
    this.mic?.getTracks().forEach(p => p.stop());
    this.flujos = this.flujos.filter(f => f !== this.mic);
    this.mic = mic;
    this.flujos.push(mic);
    this.fuenteMic = this.ctx ? this.ctx.createMediaStreamSource(mic) : null;
    if (this.fuenteMic && this.mezcla) this.fuenteMic.connect(this.mezcla);
    const pista = mic.getAudioTracks()[0];
    if (!pista) return;
    pista.addEventListener("ended", () => { if (pista === this.mic?.getAudioTracks()[0]) this.#reconectarMicrofono("el micrófono se desconectó"); });
    pista.addEventListener("mute", () => {
      if (pista !== this.mic?.getAudioTracks()[0]) return;
      this.#evento("mic-silenciado", "el sistema silenció el micrófono");
      clearTimeout(this.relojMute);
      this.relojMute = setTimeout(() => { if (pista.muted && this.activa) this.#reconectarMicrofono("el sistema dejó el micrófono silenciado"); }, MUTE_MS);
    });
    pista.addEventListener("unmute", () => { clearTimeout(this.relojMute); this.#evento("mic-reactivado", ""); });
  }

  // Se vuelve a abrir el micrófono hasta conseguirlo, con espera creciente. Si
  // el elegido ya no está (audífonos apagados), se usa el del sistema.
  async #reconectarMicrofono(motivo) {
    if (this.reconectando || !this.activa) return;
    this.reconectando = true;
    this.micPerdidoDesde ||= Date.now();
    this.#evento("mic-perdido", motivo);
    this.alEstado?.(`No estoy grabando: ${motivo}. Reconectando…`, "problema");
    let espera = 1000;
    while (this.activa) {
      try {
        const mic = await this.#abrirMicrofono();
        if (mic.getAudioTracks()[0]?.readyState === "live") {
          this.#conectarMicrofono(mic);
          break;
        }
        mic.getTracks().forEach(p => p.stop());
      } catch {}
      await esperar(espera);
      espera = Math.min(espera * 2, 5000);
    }
    this.reconectando = false;
    if (!this.activa) return;
    this.estadisticas.reconexiones += 1;
    this.#cerrarHueco("micPerdidoDesde", `micrófono desconectado (${motivo})`);
    this.#evento("mic-recuperado", this.nombreMicrofono());
    this.alEstado?.(`Grabando de nuevo con ${this.nombreMicrofono()}`, "recuperado");
  }

  async #revisarDispositivos() {
    if (!this.activa) return;
    const pista = this.mic?.getAudioTracks()[0];
    const disponibles = await microfonos();
    this.#evento("dispositivos", disponibles.map(d => d.nombre).join(", "));
    if (!pista || pista.readyState === "ended") this.#reconectarMicrofono("el micrófono ya no está disponible");
  }

  #alCambiarContexto() {
    const estado = this.ctx?.state;
    if (!this.activa || !estado) return;
    this.#evento("audio-" + estado, "");
    if (estado !== "running") {
      this.ultimaSuspension = Date.now();
      this.alEstado?.("El sistema pausó el audio: reanudando…", "problema");
      this.reanimar();
    }
  }

  // Reanuda el contexto si el sistema lo pausó. La app también lo llama al
  // volver a la pestaña o al despertar el equipo.
  reanimar() {
    if (this.activa && this.ctx && this.ctx.state !== "running" && this.ctx.state !== "closed") {
      this.ctx.resume().catch(() => {});
    }
    if (this.activa && this.mic?.getAudioTracks()[0]?.readyState === "ended") this.#reconectarMicrofono("el micrófono se desconectó");
  }

  #evento(tipo, detalle) {
    this.alEvento?.({ tipo, momento: Date.now(), detalle });
  }

  #cerrarHueco(campo, causa, hasta = Date.now()) {
    const desde = this[campo];
    this[campo] = 0;
    if (!desde || hasta - desde < 1000) return;
    this.estadisticas.huecos += 1;
    this.estadisticas.msPerdidos += hasta - desde;
    this.alHueco?.({ desde, hasta, causa });
  }

  // ── Captura y tramos ─────────────────────────────────────────────────────

  #reiniciarTramo() {
    this.muestras = [];
    this.largo = 0;
    this.picoTramo = 0;
    this.silencioFinal = 0;
    this.inicioTramo = Date.now();
  }

  #recibir(entrada, frame) {
    if (!this.activa) return;
    this.estadisticas.bloques += 1;
    this.#vigilarContinuidad(entrada, frame);
    this.alBloque?.();

    const bajada = remuestrear(entrada, this.ctx.sampleRate, HZ);
    this.muestras.push(bajada);
    this.largo += bajada.length;

    let suma = 0;
    for (let i = 0; i < entrada.length; i += 1) suma += entrada[i] * entrada[i];
    const rms = Math.sqrt(suma / entrada.length);
    this.picoTramo = Math.max(this.picoTramo, rms);
    this.silencioFinal = rms < SILENCIO_RMS ? this.silencioFinal + entrada.length / this.ctx.sampleRate : 0;

    const segundos = this.largo / HZ;
    // Se corta en un silencio de al menos 0,4 s una vez pasado el mínimo, o a
    // la fuerza al llegar al máximo. Así casi nunca se parte una frase.
    if ((segundos >= TRAMO_MIN_S && this.silencioFinal >= .4) || segundos >= TRAMO_MAX_S) this.#cerrarTramo();
  }

  // Dos señales de audio perdido:
  //   · Reloj: si el de audio avanza menos que el de pared, el audio se detuvo
  //     (equipo suspendido o contexto pausado). Se usa el mínimo de una
  //     ventana de bloques para no confundir un retraso del hilo principal
  //     —los bloques llegan tarde pero llegan— con audio perdido.
  //   · Silencio digital: ceros exactos durante segundos. Un micrófono vivo
  //     siempre tiene algo de ruido; ceros exactos son un micrófono apagado o
  //     silenciado por el sistema.
  #vigilarContinuidad(entrada, frame) {
    const ahora = Date.now();
    const audioMs = frame / this.ctx.sampleRate * 1000;
    if (!this.inicioPared) {
      this.inicioPared = ahora - audioMs;
      this.desfaseBase = 0;
      this.ventana = [];
      this.ultimoNormal = ahora;
    }
    const desfase = ahora - this.inicioPared - audioMs;
    this.ventana.push(desfase);
    if (this.ventana.length > 12) this.ventana.shift();
    const minimo = Math.min(...this.ventana);
    if (this.ventana.length >= 6 && minimo - this.desfaseBase > HUECO_MIN_MS) {
      const perdido = minimo - this.desfaseBase;
      const causa = this.ultimaSuspension && ahora - this.ultimaSuspension < perdido + 10000
        ? "el sistema pausó el audio"
        : "equipo suspendido o en reposo (pantalla apagada o tapa cerrada)";
      this.estadisticas.huecos += 1;
      this.estadisticas.msPerdidos += perdido;
      this.alHueco?.({ desde: this.ultimoNormal, hasta: this.ultimoNormal + perdido, causa });
      this.#evento("audio-detenido", `${Math.round(perdido / 1000)} s sin audio: ${causa}`);
      this.desfaseBase = minimo;
      this.ventana = [minimo];
    } else if (minimo < this.desfaseBase) {
      this.desfaseBase = minimo;   // deriva normal entre relojes
    }
    if (desfase - this.desfaseBase < 1000) this.ultimoNormal = ahora;

    // Silencio digital (sólo si el micrófono no está ya marcado como perdido).
    if (this.reconectando) return;
    let cero = true;
    for (let i = 0; i < entrada.length; i += 64) if (entrada[i] !== 0) { cero = false; break; }
    if (cero) {
      this.cerosDesde ||= ahora;
      if (!this.sinSenalDesde && ahora - this.cerosDesde > SILENCIO_DIGITAL_MS) {
        this.sinSenalDesde = this.cerosDesde;
        this.#evento("sin-senal", this.nombreMicrofono());
        this.alEstado?.(`El micrófono (${this.nombreMicrofono()}) no entrega sonido. Revisa que no esté silenciado`, "problema");
        // Puede ser un dispositivo dormido: se intenta reabrir.
        this.#reconectarMicrofono("el micrófono no entrega sonido");
      }
    } else {
      this.cerosDesde = 0;
      if (this.sinSenalDesde) {
        this.#cerrarHueco("sinSenalDesde", "micrófono sin señal (silenciado o dormido)");
        this.#evento("senal-recuperada", this.nombreMicrofono());
        this.alEstado?.("Grabando de nuevo", "recuperado");
      }
    }
  }

  #cerrarTramo() {
    if (!this.largo) return;
    const desde = this.inicioTramo;
    const hasta = Date.now();
    const pico = this.picoTramo;
    const pcm = unir(this.muestras, this.largo);
    this.#reiniciarTramo();
    // Sólo silencio: no se paga por transcribirlo ni se arriesga a que el
    // modelo «oiga» frases inventadas, que es lo que hacen con el silencio.
    if (pico < VOZ_RMS) return;
    // Primero al respaldo local, sin esperar a la cola: si la pestaña se
    // cierra o la red cae, el audio ya está a salvo.
    const idArchivo = this.archivo?.guardar(pcm, { desde, hasta, hz: HZ }) ?? null;
    this.#encolar(pcm, desde, hasta, idArchivo);
  }

  #encolar(pcm, desde, hasta, idArchivo) {
    this.pendientes += 1;
    this.alEstado?.(`Transcribiendo en alta fidelidad · ${this.pendientes} en cola`, "");
    this.cola = this.cola.then(async () => {
      const wav = aWavBase64(pcm, HZ);
      const id = await Promise.resolve(idArchivo).catch(() => null);
      let ultimoError = "";
      for (let intento = 1; intento <= REINTENTOS; intento += 1) {
        try {
          const r = await this.transcribir(wav, { desde, hasta, previo: this.previo.slice(-400) });
          if (r?.ok) {
            const texto = String(r.texto || "").trim();
            if (texto) this.previo = texto;
            this.alSegmento?.({ desde, hasta, texto, proveedor: r.proveedor });
            ultimoError = "";
            break;
          }
          ultimoError = r?.error || "sin respuesta";
          // Un error de configuración no se arregla reintentando.
          if (r?.definitivo) break;
        } catch (error) {
          ultimoError = error?.message || "fallo de red";
        }
        await esperar(1500 * intento);
      }
      if (ultimoError) {
        // Primero se anota el fallo y después se marca el tramo como
        // reintentable: si la recuperación corre entre medio, encuentra el
        // fallo y lo reemplaza, en vez de dejar fallo y tramo recuperado a la vez.
        this.alFallo?.({ desde, hasta, error: ultimoError, respaldado: Boolean(id) });
        await this.archivo?.actualizar(id, { estado: "fallido", error: ultimoError, intentos: REINTENTOS });
      } else {
        await this.archivo?.actualizar(id, { estado: "transcrito" });
      }
      this.pendientes -= 1;
      if (!this.pendientes) this.alEstado?.(this.activa ? "Alta fidelidad al día" : "Transcripción completa", "");
    });
  }

  // Cierra el tramo en curso y espera a que la cola termine: al salir de la
  // reunión, lo último que se dijo también tiene que quedar transcrito.
  async detener() {
    if (!this.activa) return;
    this.#cerrarTramo();
    // Un hueco abierto (micrófono perdido o sin señal) se cierra al terminar.
    this.#cerrarHueco("micPerdidoDesde", "micrófono desconectado");
    this.#cerrarHueco("sinSenalDesde", "micrófono sin señal (silenciado o dormido)");
    this.activa = false;
    clearTimeout(this.relojMute);
    navigator.mediaDevices.removeEventListener?.("devicechange", this.alDispositivos);
    try { this.nodo?.port?.postMessage("parar"); } catch {}
    try { this.nodo?.disconnect(); } catch {}
    this.flujos.forEach(f => f.getTracks().forEach(p => p.stop()));
    this.flujos = [];
    this.mic = this.fuenteMic = null;
    if (this.ctx) this.ctx.onstatechange = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = this.nodo = this.mezcla = null;
    this.#evento("fin", "");
    await this.cola;
  }
}

function unir(trozos, largo) {
  const salida = new Float32Array(largo);
  let i = 0;
  for (const t of trozos) { salida.set(t, i); i += t.length; }
  return salida;
}

function remuestrear(muestras, desde, hasta) {
  if (desde === hasta) return Float32Array.from(muestras);
  const proporcion = desde / hasta;
  const salida = new Float32Array(Math.floor(muestras.length / proporcion));
  for (let i = 0; i < salida.length; i += 1) {
    // Promedio de la ventana en vez de tomar una muestra suelta: es un filtro
    // paso bajo barato que evita el ruido metálico del submuestreo directo.
    const a = Math.floor(i * proporcion), b = Math.min(muestras.length, Math.floor((i + 1) * proporcion));
    let suma = 0;
    for (let j = a; j < b; j += 1) suma += muestras[j];
    salida[i] = b > a ? suma / (b - a) : muestras[a] || 0;
  }
  return salida;
}

// WAV PCM de 16 bits: el formato que aceptan todos los proveedores de
// transcripción sin conversión. 30 s pesan ~1 MB, dentro del límite de Vercel.
export function aWavBase64(muestras, hz) {
  const buffer = new ArrayBuffer(44 + muestras.length * 2);
  const v = new DataView(buffer);
  const texto = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
  texto(0, "RIFF"); v.setUint32(4, 36 + muestras.length * 2, true); texto(8, "WAVE");
  texto(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, hz, true); v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  texto(36, "data"); v.setUint32(40, muestras.length * 2, true);
  for (let i = 0; i < muestras.length; i += 1) {
    const s = Math.max(-1, Math.min(1, muestras[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
