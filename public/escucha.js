// Escucha de reunión, en el propio navegador.
//
// En modo Meet el micrófono está abierto toda la reunión, pero mandar ese audio
// a un modelo costaría unos tres dólares por hora aunque Catalina no dijera
// nada. Aquí se usa el reconocimiento de voz que ya trae el navegador: es
// gratis, y al modelo sólo se le llama cuando alguien dice su nombre.
//
// A cambio, Catalina comenta sobre la transcripción y no sobre el audio: si el
// navegador entiende mal un término, ella comentará sobre lo mal entendido. Es
// el precio de no pagar por escuchar. Para las reuniones que importan está la
// grabadora de alta fidelidad (grabadora.js), que corre en paralelo a ésta.
//
// Por qué se cortaba la transcripción, y qué hace esta versión con cada causa:
//
//   1. Chrome cierra el reconocimiento solo —cada minuto aprox., en silencios
//      largos y al perder la red— y la frase que estaba a medias se perdía,
//      porque sólo se guardaban las frases cerradas. Ahora se piden también los
//      resultados parciales y, si la sesión se cierra con uno pendiente, se
//      guarda tal cual en vez de tirarlo.
//   2. El rearranque era inmediato, dentro de `onend`. Chrome a veces lo
//      rechaza (InvalidStateError) o lo acepta y no vuelve a emitir nada: la
//      escucha quedaba muerta sin avisar. Ahora rearranca con espera creciente
//      y un vigilante comprueba cada pocos segundos que siga viva.
//   3. Mientras Catalina habla la escucha se «ensordece» para no transcribirse
//      a sí misma. Si el aviso de que terminó de hablar no llegaba —sesión
//      caída, respuesta interrumpida— se quedaba sorda para siempre. Ahora la
//      sordera caduca sola.
//   4. Los huecos no quedaban registrados. Ahora cada corte se anota con su
//      duración, para que la minuta sepa dónde falta información y lo diga.

const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;

export const escuchaDisponible = () => Boolean(Reconocimiento);

// Sin acentos y en minúsculas: quien habla dice «catalina» y el navegador
// puede escribir «Catalina», «catalina,» o incluso «Catalín».
const normalizar = texto => String(texto ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase();

// Se aceptan variantes porque el reconocimiento se come sílabas a menudo.
const NOMBRE = /\b(catalina|catalin|catlina|katalina)\b/;

const VIGILANCIA_MS = 4000;       // cada cuánto se comprueba que siga viva
const SIN_EVENTOS_MS = 25000;     // sin ningún evento en este tiempo, se reinicia
const SORDERA_MAX_MS = 45000;     // ninguna respuesta de Catalina dura más que esto
const HUECO_MINIMO_MS = 4000;     // cortes más cortos no se anotan como hueco

export class EscuchaDeReunion {
  constructor({ alLlamarla, alTranscribir, alFallar, alEstado } = {}) {
    this.alLlamarla = alLlamarla;
    this.alTranscribir = alTranscribir;
    this.alFallar = alFallar;
    this.alEstado = alEstado;
    this.reconocimiento = null;
    this.activa = false;
    this.sorda = false;        // mientras Catalina habla, no se apunta nada
    this.sordaDesde = 0;
    this.transcripcion = [];
    this.parcial = "";         // lo que se está diciendo y aún no se cerró
    this.ultimoEvento = 0;
    this.caidaDesde = 0;       // cuándo se cerró la sesión de reconocimiento
    this.espera = 250;         // espera antes de rearrancar; crece con los fallos
    this.relojRearranque = null;
    this.vigilante = null;
    this.estadisticas = { reinicios: 0, errores: 0, huecos: 0, msSinEscuchar: 0, parcialesRescatados: 0 };
  }

  empezar() {
    if (!Reconocimiento || this.activa) return false;
    this.activa = true;
    this.espera = 250;
    this.ultimoEvento = Date.now();
    if (!this.#arrancar()) { this.activa = false; return false; }

    clearInterval(this.vigilante);
    this.vigilante = setInterval(() => this.#vigilar(), VIGILANCIA_MS);
    return true;
  }

  #arrancar() {
    const r = new Reconocimiento();
    r.lang = "es-CL";
    r.continuous = true;
    // Se piden los parciales, pero sólo se guardan las frases cerradas. El
    // parcial se conserva aparte para rescatarlo si la sesión muere a mitad.
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
      this.ultimoEvento = Date.now();
      if (this.caidaDesde) {
        const hueco = Date.now() - this.caidaDesde;
        this.estadisticas.msSinEscuchar += hueco;
        if (hueco >= HUECO_MINIMO_MS) {
          this.estadisticas.huecos += 1;
          this.transcripcion.push({ momento: this.caidaDesde, texto: "", hueco: hueco });
        }
        this.caidaDesde = 0;
      }
      this.alEstado?.("escuchando");
    };
    r.onaudiostart = r.onsoundstart = r.onspeechstart = () => { this.ultimoEvento = Date.now(); };

    r.onresult = evento => {
      this.ultimoEvento = Date.now();
      // Un resultado bueno demuestra que la escucha funciona: la espera vuelve
      // a su mínimo para que el próximo corte se recupere rápido.
      this.espera = 250;
      let parcial = "";
      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        const resultado = evento.results[i];
        const texto = resultado[0].transcript.trim();
        if (!resultado.isFinal) { parcial += (parcial ? " " : "") + texto; continue; }
        this.#registrar(texto);
      }
      this.parcial = this.sorda ? "" : parcial;
    };

    r.onend = () => {
      // Lo que quedó a medias se guarda: es la frase que antes se perdía en
      // cada corte.
      if (this.parcial) {
        this.estadisticas.parcialesRescatados += 1;
        this.#registrar(this.parcial, { incompleto: true });
        this.parcial = "";
      }
      if (!this.activa) return;
      this.caidaDesde ||= Date.now();
      this.alEstado?.("reconectando");
      this.#programarRearranque();
    };

    r.onerror = evento => {
      this.ultimoEvento = Date.now();
      // «no-speech» y «aborted» son normales; el resto hay que enseñarlo. Que
      // fallara en silencio fue justo lo que hizo imposible saber por qué el
      // modo reunión no reaccionaba.
      if (["no-speech", "aborted"].includes(evento.error)) return;
      this.estadisticas.errores += 1;
      console.warn("Escucha de reunión:", evento.error);
      const motivos = {
        "not-allowed": "El navegador no dio permiso para escuchar",
        "service-not-allowed": "El navegador bloqueó el reconocimiento de voz",
        "audio-capture": "No se pudo acceder al micrófono",
        network: "El reconocimiento de voz se quedó sin red; reintentando…"
      };
      // Sin permiso no tiene sentido insistir: se para y se dice.
      if (["not-allowed", "service-not-allowed"].includes(evento.error)) {
        this.activa = false;
        clearInterval(this.vigilante);
      } else {
        // Con fallos seguidos se espera cada vez más, hasta 8 s, para no
        // martillear un servicio caído.
        this.espera = Math.min(this.espera * 2, 8000);
      }
      this.alFallar?.(motivos[evento.error] || `Fallo de escucha: ${evento.error}`);
    };

    this.reconocimiento = r;
    try {
      r.start();
      return true;
    } catch (error) {
      console.warn("Escucha de reunión: no arrancó", error?.name || error);
      return false;
    }
  }

  #programarRearranque() {
    clearTimeout(this.relojRearranque);
    this.relojRearranque = setTimeout(() => {
      if (!this.activa) return;
      this.estadisticas.reinicios += 1;
      // Una instancia nueva en cada rearranque: reutilizar la anterior es lo
      // que a veces la dejaba aceptando start() sin volver a emitir nada.
      this.#soltar();
      if (!this.#arrancar()) {
        this.espera = Math.min(this.espera * 2, 8000);
        this.#programarRearranque();
      }
    }, this.espera);
  }

  #vigilar() {
    if (!this.activa) return;
    const ahora = Date.now();
    // La sordera caduca: si el aviso de fin de respuesta no llegó, la reunión
    // no puede quedarse sin transcribir el resto de la tarde.
    if (this.sorda && ahora - this.sordaDesde > SORDERA_MAX_MS) {
      console.warn("Escucha de reunión: la sordera caducó sin aviso de fin de turno");
      this.sorda = false;
    }
    // Sin ningún evento en mucho rato —ni resultados, ni errores, ni fin— la
    // sesión está colgada. Se descarta y se abre otra.
    if (ahora - this.ultimoEvento > SIN_EVENTOS_MS) {
      console.warn("Escucha de reunión: sin eventos, se reinicia");
      this.ultimoEvento = ahora;
      this.caidaDesde ||= ahora;
      this.#soltar();
      this.#programarRearranque();
    }
  }

  #soltar() {
    const r = this.reconocimiento;
    if (!r) return;
    r.onend = r.onresult = r.onerror = r.onstart = null;
    r.onaudiostart = r.onsoundstart = r.onspeechstart = null;
    try { r.abort(); } catch {}
    this.reconocimiento = null;
  }

  #registrar(texto, { incompleto = false } = {}) {
    // Mientras ella habla se ignora todo. Su voz sale por los altavoces y
    // vuelve a entrar por el micrófono: sin esto, su propia respuesta acabaría
    // en la transcripción de la reunión, y si en ella dijera su nombre se
    // despertaría a sí misma en bucle.
    if (this.sorda) return;
    texto = String(texto || "").trim();
    if (!texto) return;

    const segmento = { momento: Date.now(), texto };
    if (incompleto) segmento.incompleto = true;
    this.transcripcion.push(segmento);
    this.alTranscribir?.(texto, segmento);

    const plano = normalizar(texto);
    if (!incompleto && NOMBRE.test(plano)) this.#atender(texto, plano);
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

  // Toda la reunión desde que se activó el modo. Una reunión larga no cabe en
  // un mensaje de voz, así que se conserva el arranque —donde suele decirse el
  // objetivo— y lo más reciente, que es lo que suele importar. Lo del medio
  // sigue disponible para Catalina con la herramienta consultar_reunion.
  contexto(maxCaracteres = 16000) {
    const entero = this.transcripcion.filter(t => t.texto).map(t => t.texto).join(" ");
    if (entero.length <= maxCaracteres) return entero;
    const cabeza = Math.floor(maxCaracteres * .25);
    return entero.slice(0, cabeza)
      + " […parte intermedia omitida: consúltala con consultar_reunion…] "
      + entero.slice(-(maxCaracteres - cabeza));
  }

  // Se llama mientras Catalina habla y un momento después, para que la cola de
  // su propia voz no se cuele.
  ensordecer(valor) {
    this.sorda = Boolean(valor);
    if (this.sorda) { this.sordaDesde = Date.now(); this.parcial = ""; }
  }

  parar() {
    this.activa = false;
    clearTimeout(this.relojRearranque);
    clearInterval(this.vigilante);
    if (this.parcial) { this.#registrar(this.parcial, { incompleto: true }); this.parcial = ""; }
    const r = this.reconocimiento;
    this.reconocimiento = null;
    if (r) {
      r.onend = null;
      try { r.stop(); } catch {}
    }
  }

  olvidar() {
    this.transcripcion = [];
    this.parcial = "";
    this.estadisticas = { reinicios: 0, errores: 0, huecos: 0, msSinEscuchar: 0, parcialesRescatados: 0 };
  }
}
