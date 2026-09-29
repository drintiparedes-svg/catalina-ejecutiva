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
// pestaña de la reunión (compartir pestaña con «Compartir audio»), los mezcla,
// y cada 20–40 s envía un tramo al servidor para transcribirlo con un modelo
// de voz dedicado. Los tramos se cortan en silencios para no partir frases, los
// que son sólo silencio no se envían (no se paga por ellos), y los que fallan
// se reintentan y, si aun así fallan, quedan anotados para que la minuta use
// en ese tramo lo que entendió el navegador.
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

export const grabadoraDisponible = () => Boolean(window.AudioContext && navigator.mediaDevices?.getUserMedia);
export const audioDePestanaDisponible = () => Boolean(navigator.mediaDevices?.getDisplayMedia);

export class GrabadoraDeReunion {
  constructor({ transcribir, alSegmento, alFallo, alEstado } = {}) {
    this.transcribir = transcribir;     // async (wavBase64, meta) => {ok, texto, proveedor}
    this.alSegmento = alSegmento;
    this.alFallo = alFallo;
    this.alEstado = alEstado;
    this.activa = false;
    this.flujos = [];
    this.ctx = null;
    this.nodo = null;
    this.muestras = [];
    this.largo = 0;
    this.inicioTramo = 0;
    this.silencioFinal = 0;
    this.picoTramo = 0;
    this.cola = Promise.resolve();
    this.pendientes = 0;
    this.previo = "";
    this.conPestana = false;
  }

  // Tiene que llamarse dentro del gesto del usuario (un clic): el navegador
  // no deja pedir el audio de la pestaña de otro modo.
  async iniciar({ audioPestana = false } = {}) {
    if (this.activa) return { ok: true };
    const pedirPestana = audioPestana && audioDePestanaDisponible()
      // Chrome exige pedir vídeo para poder compartir el audio de la pestaña.
      // El vídeo se apaga en cuanto llega: aquí sólo interesa el sonido.
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: false, selfBrowserSurface: "exclude" }).catch(error => ({ error }))
      : null;

    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
    } catch (error) {
      return { ok: false, error: "No se pudo abrir el micrófono para grabar." };
    }
    this.flujos.push(mic);

    let avisoPestana = "";
    if (pedirPestana) {
      const pantalla = await pedirPestana;
      if (pantalla?.error || !pantalla?.getAudioTracks?.().length) {
        pantalla?.getTracks?.().forEach(p => p.stop());
        avisoPestana = pantalla?.error
          ? "No se compartió la pestaña: sólo se grabará el micrófono."
          : "La pestaña se compartió sin audio (marca «Compartir audio de la pestaña»): sólo se grabará el micrófono.";
      } else {
        pantalla.getVideoTracks().forEach(p => { p.enabled = false; });
        // Si la persona deja de compartir desde la barra de Chrome, se sigue
        // con el micrófono y se avisa, en vez de morir en silencio.
        pantalla.getAudioTracks()[0].addEventListener("ended", () => {
          this.conPestana = false;
          this.alEstado?.("Se dejó de compartir la pestaña: sigo grabando sólo el micrófono", "problema");
        });
        this.flujos.push(pantalla);
        this.conPestana = true;
      }
    }

    this.ctx = new AudioContext();
    const mezcla = this.ctx.createGain();
    for (const flujo of this.flujos) {
      if (!flujo.getAudioTracks().length) continue;
      this.ctx.createMediaStreamSource(new MediaStream(flujo.getAudioTracks())).connect(mezcla);
    }
    // ScriptProcessor está en desuso pero funciona en todos los navegadores y
    // es lo que ya usa la voz de Gemini en este proyecto; un AudioWorklet
    // exigiría otro archivo sólo para esto.
    this.nodo = this.ctx.createScriptProcessor(4096, 1, 1);
    this.nodo.onaudioprocess = evento => this.#recibir(evento.inputBuffer.getChannelData(0));
    mezcla.connect(this.nodo);
    // El nodo tiene que llegar al destino para que el navegador lo procese; se
    // conecta a través de una ganancia cero para no oír el eco.
    const mudo = this.ctx.createGain();
    mudo.gain.value = 0;
    this.nodo.connect(mudo).connect(this.ctx.destination);

    this.activa = true;
    this.#reiniciarTramo();
    return { ok: true, conPestana: this.conPestana, aviso: avisoPestana };
  }

  #reiniciarTramo() {
    this.muestras = [];
    this.largo = 0;
    this.picoTramo = 0;
    this.silencioFinal = 0;
    this.inicioTramo = Date.now();
  }

  #recibir(entrada) {
    if (!this.activa) return;
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
    this.#encolar(pcm, desde, hasta);
  }

  #encolar(pcm, desde, hasta) {
    this.pendientes += 1;
    this.alEstado?.(`Transcribiendo en alta fidelidad · ${this.pendientes} en cola`, "");
    this.cola = this.cola.then(async () => {
      const wav = aWavBase64(pcm, HZ);
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
        await new Promise(ok => setTimeout(ok, 1500 * intento));
      }
      if (ultimoError) this.alFallo?.({ desde, hasta, error: ultimoError });
      this.pendientes -= 1;
      if (!this.pendientes) this.alEstado?.(this.activa ? "Alta fidelidad al día" : "Transcripción completa", "");
    });
  }

  // Cierra el tramo en curso y espera a que la cola termine: al salir de la
  // reunión, lo último que se dijo también tiene que quedar transcrito.
  async detener() {
    if (!this.activa) return;
    this.#cerrarTramo();
    this.activa = false;
    try { this.nodo?.disconnect(); } catch {}
    this.flujos.forEach(f => f.getTracks().forEach(p => p.stop()));
    this.flujos = [];
    await this.ctx?.close().catch(() => {});
    this.ctx = this.nodo = null;
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
function aWavBase64(muestras, hz) {
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
