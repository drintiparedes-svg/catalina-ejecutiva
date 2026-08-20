// Escucha de reunión, en el propio navegador.
//
// En modo Meet el micrófono está abierto toda la reunión, pero mandar ese audio
// a un modelo costaría unos tres dólares por hora aunque Catalina no dijera
// nada. Aquí se usa el reconocimiento de voz que ya trae el navegador: es
// gratis, y al modelo sólo se le llama cuando alguien dice su nombre.
//
// A cambio, Catalina comenta sobre la transcripción y no sobre el audio: si el
// navegador entiende mal un término, ella comentará sobre lo mal entendido. Es
// el precio de no pagar por escuchar.

const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;

export const escuchaDisponible = () => Boolean(Reconocimiento);

// Sin acentos y en minúsculas: quien habla dice «catalina» y el navegador
// puede escribir «Catalina», «catalina,» o incluso «Catalín».
const normalizar = texto => String(texto ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase();

// Se aceptan variantes porque el reconocimiento se come sílabas a menudo.
const NOMBRE = /\b(catalina|catalin|catlina|katalina)\b/;

export class EscuchaDeReunion {
  constructor({ alLlamarla, alTranscribir, alFallar } = {}) {
    this.alLlamarla = alLlamarla;
    this.alTranscribir = alTranscribir;
    this.alFallar = alFallar;
    this.reconocimiento = null;
    this.activa = false;
    this.transcripcion = [];
  }

  empezar() {
    if (!Reconocimiento || this.activa) return false;

    const r = new Reconocimiento();
    r.lang = "es-CL";
    r.continuous = true;
    r.interimResults = false;   // sólo frases cerradas: las parciales cambian solas
    r.maxAlternatives = 1;

    r.onresult = evento => {
      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        const resultado = evento.results[i];
        if (!resultado.isFinal) continue;
        const texto = resultado[0].transcript.trim();
        if (!texto) continue;

        this.transcripcion.push({ momento: Date.now(), texto });
        this.alTranscribir?.(texto);

        const plano = normalizar(texto);
        if (NOMBRE.test(plano)) this.#atender(texto, plano);
      }
    };

    // El reconocimiento se detiene solo cada cierto tiempo, y en silencios
    // largos. Sin volver a arrancarlo, la escucha muere a mitad de reunión sin
    // avisar.
    r.onend = () => { if (this.activa) { try { r.start(); } catch {} } };
    r.onerror = evento => {
      // «no-speech» y «aborted» son normales; el resto hay que enseñarlo. Que
      // fallara en silencio fue justo lo que hizo imposible saber por qué el
      // modo reunión no reaccionaba.
      if (["no-speech", "aborted"].includes(evento.error)) return;
      console.warn("Escucha de reunión:", evento.error);
      const motivos = {
        "not-allowed": "El navegador no dio permiso para escuchar",
        "service-not-allowed": "El navegador bloqueó el reconocimiento de voz",
        "audio-capture": "No se pudo acceder al micrófono",
        network: "El reconocimiento de voz se quedó sin red"
      };
      this.alFallar?.(motivos[evento.error] || `Fallo de escucha: ${evento.error}`);
    };

    this.reconocimiento = r;
    this.activa = true;
    try { r.start(); } catch { this.activa = false; return false; }
    return true;
  }

  #atender(textoOriginal, plano) {
    // Lo que se le pide es lo que va después del nombre. Si sólo dijeron
    // «Catalina», se pasa la frase entera y que ella pregunte.
    const desde = plano.search(NOMBRE);
    const nombreFin = plano.slice(desde).search(/\s/);
    const peticion = nombreFin > 0
      ? textoOriginal.slice(desde + nombreFin).replace(/^[\s,.:;¿?¡!-]+/, "").trim()
      : "";
    this.alLlamarla?.(peticion || textoOriginal, this.contexto());
  }

  // Toda la reunión desde que se activó el modo, que es lo que se pidió. Se
  // acota por longitud porque una reunión de horas no cabe en una petición y
  // recortar por el final conserva lo más reciente, que es lo que suele
  // importar.
  contexto(maxCaracteres = 12000) {
    const entero = this.transcripcion.map(t => t.texto).join(" ");
    return entero.length <= maxCaracteres
      ? entero
      : "…" + entero.slice(-maxCaracteres);
  }

  parar() {
    this.activa = false;
    try { this.reconocimiento?.stop(); } catch {}
    this.reconocimiento = null;
  }

  olvidar() {
    this.transcripcion = [];
  }
}
