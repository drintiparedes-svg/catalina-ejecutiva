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
//
// Dos idiomas a la vez
// ────────────────────
// El reconocimiento del navegador no detecta el idioma: se le fija uno y todo
// lo que oye lo escribe en ese idioma, aunque se esté hablando en otro. Un
// seminario en inglés escuchado en español no sale mal transcrito: sale como
// ruido. Por eso aquí se abren DOS reconocedores en paralelo, uno por idioma,
// y de cada frase se queda el que la entendió de verdad. Cuesta un poco más de
// máquina y unos cientos de milisegundos de espera; a cambio una reunión
// bilingüe se transcribe entera, cada intervención en la lengua en que se dijo.

const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;

export const escuchaDisponible = () => Boolean(Reconocimiento);

export const IDIOMAS = {
  es: { etiqueta: "Español", codigo: "es-CL" },
  en: { etiqueta: "English", codigo: "en-US" }
};

// Sin acentos y en minúsculas: quien habla dice «catalina» y el navegador
// puede escribir «Catalina», «catalina,» o incluso «Catalín».
const normalizar = texto => String(texto ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase();

// Se aceptan variantes porque el reconocimiento se come sílabas a menudo.
const NOMBRE = /\b(catalina|catalin|catlina|katalina)\b/;

// Palabras de armazón. No sirven para entender la frase pero sí para saber en
// qué idioma está: son las que más se repiten y las que un reconocedor del
// idioma equivocado nunca acierta.
const LISTAS = {
  es: ("que de la el en y a los se no un por con para es una del al como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos esto mi antes algunos unos yo otro otras otra tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros tiene hacer vamos entonces ahora bien claro".split(" ")),
  en: ("the of and to a in is it you that he was for on are with as i his they be at one have this from or had by but some what there we can out other were all your when up use how said an each she which do their if will about would so these her him has more no my than been now just like know think right okay well".split(" "))
};

// Las palabras que están en las dos listas —«no», «a», «me»— no distinguen
// nada: un motor equivocado las acierta por casualidad y con frases cortas eso
// bastaba para dar el idioma por el otro. Se quitan de ambas.
const COMPARTIDAS = new Set(LISTAS.es.filter(p => LISTAS.en.includes(p)));
const ARMAZON = {
  es: new Set(LISTAS.es.filter(p => !COMPARTIDAS.has(p))),
  en: new Set(LISTAS.en.filter(p => !COMPARTIDAS.has(p)))
};

// Cuánto se parece un texto al idioma en que dice estar escrito, entre 0 y 1.
export function encajeDeIdioma(texto, idioma) {
  const palabras = normalizar(texto).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!palabras.length) return 0;
  const armazon = ARMAZON[idioma];
  if (!armazon) return 0;
  let aciertos = 0;
  for (const p of palabras) if (armazon.has(p)) aciertos += 1;
  return aciertos / palabras.length;
}

// Cuánto se espera de un candidato para quedarse con él frente al otro idioma.
// La confianza pesa poco a propósito: Chrome la devuelve en 0 más a menudo de
// lo que uno querría, y el encaje de idioma es lo que de verdad discrimina.
function puntuar(candidato) {
  return encajeDeIdioma(candidato.texto, candidato.idioma) * 3
    + (candidato.confianza || 0)
    + Math.min(candidato.texto.length, 120) / 4000;
}

// Cuánto se espera a que conteste el otro idioma antes de dar la frase por
// buena. Es el retardo que se paga por transcribir bilingüe; por debajo de esto
// el segundo reconocedor todavía no ha llegado y se elegiría a ciegas.
const VENTANA_IDIOMAS = 900;

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
const LATIDO = 8_000;

const MOTIVOS = {
  "not-allowed": "El navegador no dio permiso para el micrófono. Dáselo en el candado de la barra de direcciones",
  "service-not-allowed": "El navegador bloqueó el reconocimiento de voz",
  "audio-capture": "No se pudo acceder al micrófono: puede tenerlo tomado Meet o Zoom",
  network: "El reconocimiento no llegó a los servidores de Google: sin esa conexión Chrome no transcribe"
};

// Un reconocedor, atado a un idioma. Se rearranca solo; lo único que sabe hacer
// es entregar lo que oye a quien lo creó.
class Motor {
  constructor(idioma, { alFinal, alParcial, alFallar }) {
    this.idioma = idioma;
    this.codigo = IDIOMAS[idioma]?.codigo || idioma;
    this.alFinal = alFinal;
    this.alParcial = alParcial;
    this.alFallar = alFallar;
    this.r = null;
    this.activo = false;
    this.viva = false;
    this.frases = 0;
    this.rearranques = 0;
    this.fallo = "";
  }

  empezar() {
    if (!Reconocimiento || this.activo) return true;
    const r = new Reconocimiento();
    r.lang = this.codigo;
    r.continuous = true;
    r.interimResults = true;   // sólo para el renglón en vivo; al registro va lo cerrado
    r.maxAlternatives = 1;

    r.onstart = () => { this.viva = true; };
    r.onaudiostart = () => { this.viva = true; };

    r.onresult = evento => {
      this.viva = true;
      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        const resultado = evento.results[i];
        const alt = resultado[0];
        const texto = String(alt?.transcript ?? "").trim();
        if (!texto) continue;
        if (!resultado.isFinal) { this.alParcial?.(texto, this.idioma); continue; }
        this.frases += 1;
        this.alFinal?.({ texto, idioma: this.idioma, confianza: alt.confidence ?? 0, momento: Date.now() });
      }
    };

    // El reconocimiento se detiene solo cada cierto tiempo, y en silencios
    // largos. Sin volver a arrancarlo, la escucha muere a mitad de reunión sin
    // avisar.
    r.onend = () => {
      if (!this.activo) return;
      this.viva = false;
      try { r.start(); } catch { /* el latido lo reintenta */ }
    };

    r.onerror = evento => {
      // «no-speech» y «aborted» son normales; el resto hay que enseñarlo. Que
      // fallara en silencio fue justo lo que hizo imposible saber por qué el
      // modo reunión no reaccionaba.
      if (["no-speech", "aborted"].includes(evento.error)) return;
      console.warn(`Escucha (${this.codigo}):`, evento.error);
      this.fallo = MOTIVOS[evento.error] || `Fallo de escucha: ${evento.error}`;
      this.alFallar?.(this.fallo, this);
    };

    this.r = r;
    this.activo = true;
    try {
      r.start();
    } catch (error) {
      // `InvalidStateError` significa que ya estaba arrancado: no es un fallo,
      // es una carrera. Se da por bueno en vez de dejar la escucha por muerta.
      if (error?.name === "InvalidStateError") return true;
      this.activo = false;
      this.fallo = `${error?.name || "Error"}: ${error?.message || "el navegador no dejó arrancar el reconocimiento"}`;
      return false;
    }
    return true;
  }

  latir() {
    if (!this.activo) return false;
    if (this.viva) { this.viva = false; return false; }
    try {
      this.r?.start();
      this.rearranques += 1;
      return true;
    } catch { this.viva = true; return false; }
  }

  parar() {
    this.activo = false;
    try { this.r?.stop(); } catch {}
    try { this.r?.abort?.(); } catch {}
    this.r = null;
  }
}

export class EscuchaDeReunion {
  constructor({ alLlamarla, alTranscribir, alParcial, alFallar, alRecuperarse } = {}) {
    this.alLlamarla = alLlamarla;
    this.alTranscribir = alTranscribir;
    this.alParcial = alParcial;
    this.alFallar = alFallar;
    this.alRecuperarse = alRecuperarse;
    this.motores = [];
    this.idiomas = ["es"];
    this.activa = false;
    this.sorda = false;        // mientras Catalina habla, no se apunta nada
    this.transcripcion = [];
    this.pendientes = [];      // frases esperando a que conteste el otro idioma
    this.plazoDeEleccion = null;
    this.plazoDeSordera = null;
    this.latido = null;
    this.arrancoAlgunaVez = false;
    this.ultimoResultado = 0;
    this.rearranques = 0;
    this.descartadasPorSordera = 0;
    // El motivo exacto por el que no arrancó, con las palabras del navegador.
    // «No se pudo iniciar la escucha» no le sirve a nadie para arreglarlo.
    this.ultimoFallo = "";
  }

  // `idiomas` es una lista: ["es"], ["en"] o ["es","en"] para bilingüe.
  empezar(idiomas = this.idiomas) {
    if (!Reconocimiento) {
      this.ultimoFallo = "Este navegador no transcribe. Usa Chrome o Edge de escritorio.";
      return false;
    }
    const pedidos = (Array.isArray(idiomas) ? idiomas : [idiomas]).filter(i => IDIOMAS[i]);
    this.idiomas = pedidos.length ? pedidos : ["es"];

    // Ya escuchando lo mismo: no se toca. Rearrancar aquí era lo que cortaba la
    // transcripción cada vez que se pulsaba «Participar».
    if (this.activa && this.motores.length === this.idiomas.length
        && this.motores.every(m => this.idiomas.includes(m.idioma) && m.activo)) {
      return true;
    }
    this.pararMotores();

    const enlaces = {
      alFinal: c => this.#recibir(c),
      alParcial: (t, idioma) => { if (!this.sorda) this.alParcial?.(t, idioma); },
      alFallar: (motivo, motor) => {
        // Con dos motores, que uno se caiga no deja la reunión muda: el otro
        // sigue. Sólo se avisa cuando no queda ninguno en pie.
        this.ultimoFallo = motivo;
        if (this.motores.some(m => m !== motor && m.activo)) return;
        this.alFallar?.(motivo);
      }
    };

    this.motores = this.idiomas.map(idioma => new Motor(idioma, enlaces));
    const arrancados = this.motores.filter(m => m.empezar());
    if (!arrancados.length) {
      this.ultimoFallo = this.motores[0]?.fallo
        || "El navegador no dejó arrancar el reconocimiento de voz.";
      this.motores = [];
      return false;
    }
    // Si el segundo idioma no arrancó se sigue con el que sí: media reunión
    // transcrita es infinitamente mejor que ninguna.
    this.motores = arrancados;
    this.activa = true;
    this.arrancoAlgunaVez = true;
    this.#latir();
    return true;
  }

  // Una frase cerrada, de uno de los motores. Con un solo idioma sale al
  // instante; con dos se espera un momento al otro y se elige la mejor.
  #recibir(candidato) {
    if (this.sorda) { this.descartadasPorSordera += 1; return; }
    if (this.motores.length < 2) return this.#aceptar(candidato);

    this.pendientes.push(candidato);
    clearTimeout(this.plazoDeEleccion);
    this.plazoDeEleccion = setTimeout(() => this.#elegir(), VENTANA_IDIOMAS);
  }

  // De lo que llegó en la ventana, una frase por idioma como mucho: la mejor de
  // cada motor. Luego, entre esas, la que mejor encaja con su propio idioma.
  #elegir() {
    const lote = this.pendientes;
    this.pendientes = [];
    if (!lote.length) return;

    const mejorPorIdioma = new Map();
    for (const c of lote) {
      const previo = mejorPorIdioma.get(c.idioma);
      // Del mismo motor, en la misma ventana, se concatena: son trozos de la
      // misma intervención, no dos versiones de ella.
      if (previo) previo.texto = `${previo.texto} ${c.texto}`.trim();
      else mejorPorIdioma.set(c.idioma, { ...c });
    }
    const candidatos = [...mejorPorIdioma.values()];
    candidatos.sort((a, b) => puntuar(b) - puntuar(a));
    this.#aceptar(candidatos[0]);
  }

  #aceptar(candidato) {
    const texto = candidato.texto.trim();
    if (!texto) return;
    this.ultimoResultado = Date.now();
    const frase = { momento: candidato.momento || Date.now(), texto, idioma: candidato.idioma };
    this.transcripcion.push(frase);
    this.alTranscribir?.(texto, frase);

    const plano = normalizar(texto);
    if (NOMBRE.test(plano)) this.#atender(texto, plano);
  }

  // Comprueba cada pocos segundos que los reconocedores siguen en pie y, si no,
  // los levanta. Sin esto, un `start()` fallido dejaba la reunión muda para
  // siempre y no había forma de saberlo hasta abrir el documento vacío.
  #latir() {
    clearInterval(this.latido);
    this.latido = setInterval(() => {
      if (!this.activa) return;
      let repuestos = 0;
      for (const motor of this.motores) if (motor.latir()) repuestos += 1;
      if (!repuestos) return;
      this.rearranques += repuestos;
      // A la tercera se avisa: una vez es normal, tres seguidas es que algo
      // pasa y quien está en la reunión tiene que saberlo antes del final.
      if (this.rearranques >= 3 && this.rearranques - repuestos < 3) {
        this.alFallar?.("La escucha se está cortando; puede faltar transcripción");
      }
    }, LATIDO);
  }

  // ¿Está capturando de verdad? Es lo que se comprueba antes de dar la reunión
  // por buena, en vez de dar por hecho que sí porque se pulsó el botón.
  diagnostico() {
    return {
      arrancoAlgunaVez: this.arrancoAlgunaVez,
      activa: this.activa && this.motores.some(m => m.activo),
      sorda: this.sorda,
      idiomas: this.motores.map(m => m.codigo),
      frases: this.transcripcion.length,
      porIdioma: Object.fromEntries(this.motores.map(m => [m.codigo, m.frases])),
      rearranques: this.rearranques,
      descartadasPorSordera: this.descartadasPorSordera,
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
  //
  // Lo que NO hace es parar los reconocedores. La capa de transcripción es una
  // sola y no se corta en ningún momento de la reunión: se deja de apuntar unos
  // segundos, y nada más.
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

  pararMotores() {
    for (const motor of this.motores) motor.parar();
    this.motores = [];
    this.activa = false;
  }

  parar() {
    clearInterval(this.latido);
    clearTimeout(this.plazoDeSordera);
    clearTimeout(this.plazoDeEleccion);
    // Lo que quedaba en la ventana de elección se guarda: es la última frase de
    // la reunión, justo la que se perdía al pulsar «Finalizar».
    this.#elegir();
    this.sorda = false;
    this.pararMotores();
  }

  olvidar() {
    this.transcripcion = [];
    this.pendientes = [];
    this.rearranques = 0;
    this.descartadasPorSordera = 0;
    this.ultimoResultado = 0;
  }
}
