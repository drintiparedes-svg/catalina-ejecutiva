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

// Cuánto puede estar sorda como mucho. Es un seguro, no una temporización: la
// sordera se quita cuando ella termina de hablar, pero eso lo decide el análisis
// del audio, y si su voz nunca llega a sonar —el navegador bloqueó la
// reproducción, la respuesta se cortó— ese aviso no llega nunca y la escucha se
// queda sorda para el resto de la reunión sin que nadie se entere. Pasó: la
// reunión seguía, la transcripción no.
const SORDERA_MAXIMA = 45_000;

// Si el reconocimiento lleva demasiado sin dar señales de vida se rearranca. El
// navegador lo corta solo en silencios largos y `onend` casi siempre lo repone,
// pero cuando `start()` falla la escucha muere en silencio.
const LATIDO = 10_000;

export class EscuchaDeReunion {
  constructor({ alLlamarla, alTranscribir, alFallar, alRecuperarse } = {}) {
    this.alLlamarla = alLlamarla;
    this.alTranscribir = alTranscribir;
    this.alFallar = alFallar;
    this.alRecuperarse = alRecuperarse;
    this.reconocimiento = null;
    this.activa = false;
    this.sorda = false;        // mientras Catalina habla, no se apunta nada
    this.transcripcion = [];
    this.plazoDeSordera = null;
    this.latido = null;
    this.viva = false;         // ¿el reconocimiento dio señales desde el último latido?
    this.arrancoAlgunaVez = false;
    this.ultimoResultado = 0;
    this.rearranques = 0;
    // El motivo exacto por el que no arrancó, con las palabras del navegador.
    // «No se pudo iniciar la escucha» no le sirve a nadie para arreglarlo.
    this.ultimoFallo = "";
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
        // Mientras ella habla se ignora todo. Su voz sale por los altavoces y
        // vuelve a entrar por el micrófono: sin esto, su propia respuesta
        // acabaría en la transcripción de la reunión, y si en ella dijera su
        // nombre se despertaría a sí misma en bucle.
        if (this.sorda) continue;
        const texto = resultado[0].transcript.trim();
        if (!texto) continue;

        this.ultimoResultado = Date.now();
        this.transcripcion.push({ momento: Date.now(), texto });
        this.alTranscribir?.(texto);

        const plano = normalizar(texto);
        if (NOMBRE.test(plano)) this.#atender(texto, plano);
      }
    };

    // El reconocimiento se detiene solo cada cierto tiempo, y en silencios
    // largos. Sin volver a arrancarlo, la escucha muere a mitad de reunión sin
    // avisar.
    r.onstart = () => { this.viva = true; };
    r.onaudiostart = () => { this.viva = true; };
    r.onend = () => {
      if (!this.activa) return;
      this.viva = false;
      try { r.start(); } catch { /* el latido lo reintenta */ }
    };
    r.onerror = evento => {
      // «no-speech» y «aborted» son normales; el resto hay que enseñarlo. Que
      // fallara en silencio fue justo lo que hizo imposible saber por qué el
      // modo reunión no reaccionaba.
      if (["no-speech", "aborted"].includes(evento.error)) return;
      console.warn("Escucha de reunión:", evento.error);
      const motivos = {
        "not-allowed": "El navegador no dio permiso para el micrófono. Dáselo en el candado de la barra de direcciones",
        "service-not-allowed": "El navegador bloqueó el reconocimiento de voz",
        "audio-capture": "No se pudo acceder al micrófono: puede tenerlo tomado Meet o Zoom",
        network: "El reconocimiento no llegó a los servidores de Google: sin esa conexión Chrome no transcribe"
      };
      this.ultimoFallo = motivos[evento.error] || `Fallo de escucha: ${evento.error}`;
      this.alFallar?.(this.ultimoFallo);
    };

    this.reconocimiento = r;
    this.activa = true;
    try {
      r.start();
    } catch (error) {
      // `InvalidStateError` significa que ya estaba arrancado: no es un fallo,
      // es una carrera. Se da por bueno en vez de dejar la escucha por muerta.
      if (error?.name === "InvalidStateError") {
        this.arrancoAlgunaVez = true;
        this.#latir();
        return true;
      }
      this.activa = false;
      this.ultimoFallo = `${error?.name || "Error"}: ${error?.message || "el navegador no dejó arrancar el reconocimiento"}`;
      return false;
    }
    this.arrancoAlgunaVez = true;
    this.#latir();
    return true;
  }

  // Comprueba cada pocos segundos que el reconocimiento sigue en pie y, si no,
  // lo levanta. Sin esto, un `start()` fallido dejaba la reunión muda para
  // siempre y no había forma de saberlo hasta abrir el documento vacío.
  #latir() {
    clearInterval(this.latido);
    this.latido = setInterval(() => {
      if (!this.activa) return;
      if (this.viva) { this.viva = false; return; }
      try {
        this.reconocimiento?.start();
        this.rearranques += 1;
        // A la tercera se avisa: una vez es normal, tres seguidas es que algo
        // pasa y quien está en la reunión tiene que saberlo antes del final.
        if (this.rearranques === 3) this.alFallar?.("La escucha se está cortando; puede faltar transcripción");
        if (this.rearranques > 3 && this.rearranques % 10 === 0) this.alRecuperarse?.(this.rearranques);
      } catch { /* ya estaba arrancado */ this.viva = true; }
    }, LATIDO);
  }

  // ¿Está capturando de verdad? Es lo que se comprueba antes de dar la reunión
  // por buena, en vez de dar por hecho que sí porque se pulsó el botón.
  diagnostico() {
    return {
      arrancoAlgunaVez: this.arrancoAlgunaVez,
      activa: this.activa,
      sorda: this.sorda,
      frases: this.transcripcion.length,
      rearranques: this.rearranques,
      ultimoFallo: this.ultimoFallo,
      segundosSinOir: this.ultimoResultado ? Math.round((Date.now() - this.ultimoResultado) / 1000) : null
    };
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

  // Se llama mientras Catalina habla y un momento después, para que la cola de
  // su propia voz no se cuele.
  //
  // Ensordecer SIEMPRE lleva plazo. Que se quite es responsabilidad de quien
  // llama, pero no puede depender sólo de eso: si ese aviso no llega, la reunión
  // se pierde entera y en silencio. Aquí la sordera se cae sola pase lo que pase.
  ensordecer(valor) {
    clearTimeout(this.plazoDeSordera);
    this.sorda = Boolean(valor);
    if (!this.sorda) return;
    this.plazoDeSordera = setTimeout(() => {
      if (!this.sorda) return;
      this.sorda = false;
      this.alRecuperarse?.(0);
    }, SORDERA_MAXIMA);
  }

  parar() {
    this.activa = false;
    clearInterval(this.latido);
    clearTimeout(this.plazoDeSordera);
    this.sorda = false;
    try { this.reconocimiento?.stop(); } catch {}
    this.reconocimiento = null;
  }

  olvidar() {
    this.transcripcion = [];
    this.rearranques = 0;
    this.ultimoResultado = 0;
  }
}
