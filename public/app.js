// Catalina — avatar conversacional local.
//
// Este archivo sólo orquesta: interfaz, sesión de voz y bucle de dibujo. La
// actuación vive en animation/director.js, la anatomía en render/ y el análisis
// de la voz en audio/.

import { FaceRenderer } from "./render/face-renderer.js";
import { PerformanceDirector } from "./animation/director.js";
import { VoiceTracker } from "./audio/voice-tracker.js";
import { RealtimeSession } from "./realtime/session.js";
import { GeminiSession } from "./realtime/gemini-session.js";
import { ElevenLabsSession } from "./realtime/elevenlabs-session.js";
import { dibujarRuta } from "./mapa.js";
import { EscuchaDeReunion, escuchaDisponible } from "./escucha.js";
import { MemoriaDeReunion, leerDocumento, ESTADOS, ROTULOS } from "./reunion.js";
import { TIPOS, TIPO_POR_DEFECTO, tipoDeReunion } from "./tipos-de-reunion.js";
import { carpetaGuardada, permisoDeCarpeta, escribirEnCarpeta, carpetaDisponible } from "./carpeta.js";
import {
  guardarReunion, listarReuniones, leerReunion, borrarReunion, comoAntecedente, historialDisponible,
  guardarBorrador, borradorPendiente, olvidarBorrador
} from "./historial.js";

const canvas = document.querySelector("#avatar");
const ctx = canvas.getContext("2d");
const image = new Image();

const ui = {
  stage: document.querySelector("#stage"),
  status: document.querySelector("#status"),
  signal: document.querySelector("#signal"),
  caption: document.querySelector("#caption"),
  preparar: document.querySelector("#preparar"),
  prepararTipos: document.querySelector("#prepararTipos"),
  prepararTitulo: document.querySelector("#prepararTitulo"),
  prepararObjetivo: document.querySelector("#prepararObjetivo"),
  prepararNotas: document.querySelector("#prepararNotas"),
  prepararDocumentos: document.querySelector("#prepararDocumentos"),
  prepararAntecedente: document.querySelector("#prepararAntecedente"),
  prepararAdjuntos: document.querySelector("#prepararAdjuntos"),
  prepararParticipa: document.querySelector("#prepararParticipa"),
  prepararEmpezar: document.querySelector("#prepararEmpezar"),
  prepararHistorial: document.querySelector("#prepararHistorial"),
  prepararCerrar: document.querySelector("#prepararCerrar"),
  prepararRetomar: document.querySelector("#prepararRetomar"),
  reunion: document.querySelector("#reunion"),
  reunionEstado: document.querySelector("#reunionEstado"),
  reunionEstadoTexto: document.querySelector("#reunionEstadoTexto"),
  reunionCuenta: document.querySelector("#reunionCuenta"),
  reunionEco: document.querySelector("#reunionEco"),
  reunionQuien: document.querySelector("#reunionQuien"),
  reunionCampo: document.querySelector("#reunionCampo"),
  reunionCampoTitulo: document.querySelector("#reunionCampoTitulo"),
  reunionEntrada: document.querySelector("#reunionEntrada"),
  reunionAceptar: document.querySelector("#reunionAceptar"),
  reunionCancelar: document.querySelector("#reunionCancelar"),
  reunionParticipar: document.querySelector("#reunionParticipar"),
  reunionNota: document.querySelector("#reunionNota"),
  reunionCuaderno: document.querySelector("#reunionCuaderno"),
  reunionNotas: document.querySelector("#reunionNotas"),
  reunionCerrarNotas: document.querySelector("#reunionCerrarNotas"),
  reunionHistorial: document.querySelector("#reunionHistorial"),
  reunionDocumento: document.querySelector("#reunionDocumento"),
  reunionArchivo: document.querySelector("#reunionArchivo"),
  reunionFinalizar: document.querySelector("#reunionFinalizar"),
  cierre: document.querySelector("#cierre"),
  cierreTitulo: document.querySelector("#cierreTitulo"),
  cierreCuerpo: document.querySelector("#cierreCuerpo"),
  cierreCerrar: document.querySelector("#cierreCerrar"),
  imagen: document.querySelector("#imagen"),
  imagenFoto: document.querySelector("#imagenFoto"),
  imagenPie: document.querySelector("#imagenPie"),
  imagenCredito: document.querySelector("#imagenCredito"),
  imagenGaleria: document.querySelector("#imagenGaleria"),
  imagenCerrar: document.querySelector("#imagenCerrar"),
  referencias: document.querySelector("#referencias"),
  referenciasLista: document.querySelector("#referenciasLista"),
  referenciasTitulo: document.querySelector("#referenciasTitulo"),
  referenciasCerrar: document.querySelector("#referenciasCerrar"),
  referenciasAmpliar: document.querySelector("#referenciasAmpliar"),
  panel: document.querySelector("#panel"),
  panelBody: document.querySelector("#panelBody"),
  panelClose: document.querySelector("#panelClose"),
  togglePanel: document.querySelector("#togglePanel"),
  controls: document.querySelector(".controls"),
  connect: document.querySelector("#connect"),
  mute: document.querySelector("#mute"),
  meetMode: document.querySelector("#meetMode"),
  exitMeet: document.querySelector("#exitMeet"),
  audio: document.querySelector("#remoteAudio"),
  marcador: document.querySelector("#marcador"),
  marcadorNumero: document.querySelector("#marcadorNumero"),
  marcadorObjetivo: document.querySelector("#marcadorObjetivo"),
  marcadorAQuien: document.querySelector("#marcadorAQuien"),
  marcadorRestricciones: document.querySelector("#marcadorRestricciones"),
  marcadorEstado: document.querySelector("#marcadorEstado"),
  marcadorEstadoTexto: document.querySelector("#marcadorEstadoTexto"),
  marcadorTeclas: document.querySelector("#marcadorTeclas"),
  marcadorBorrar: document.querySelector("#marcadorBorrar"),
  marcadorLlamar: document.querySelector("#marcadorLlamar"),
  marcadorColgar: document.querySelector("#marcadorColgar"),
  marcadorCerrar: document.querySelector("#marcadorCerrar"),
  abrirMarcador: document.querySelector("#abrirMarcador")
};

const director = new PerformanceDirector();
const voice = new VoiceTracker();
let renderer = null;
let viewport = { width: 0, height: 0, pixelRatio: 1 };
let connected = false;

// Los dos proveedores comparten manejadores: la interfaz no distingue con quién
// se está hablando, sólo cambia el transporte por debajo.
const manejadores = {
  // Se analiza la voz que llega de la API, no el micrófono: la boca debe
  // seguir lo que Catalina dice.
  onRemoteStream: stream => {
    ui.audio.srcObject = stream;
    ui.audio.muted = false;
    ui.audio.volume = 1;
    ui.audio.play().catch(error => {
      console.warn("El navegador bloqueó temporalmente la reproducción de voz", error);
      setStatus("Pulsa la pantalla para activar la voz");
    });
    voice.attach(stream);
  },
  onConnected: () => {
    connected = true;
    ultimoFallo = null;
    hayActividad();
    // Si una llamada terminó mientras la voz estaba caída, su desenlace quedó
    // en cola: ahora que hay conversación, se cuenta.
    entregarAvisos();
    calentarUbicacion();   // deja lista la zona antes de que nadie pregunte
    mostrarAviso("");   // si el intento anterior falló, su aviso ya no aplica
    ui.signal.classList.add("online");
    ui.connect.textContent = "Finalizar";
    ui.connect.disabled = false;
    ui.mute.disabled = false;
  },
  onDisconnected: () => {
    connected = false;
    pararRelojes();
    // El historial se conserva: sirve para releer lo dicho al terminar. Lo que
    // se va es el subtítulo, que sólo tiene sentido mientras Catalina habla.
    cerrarTurno();
    if (!avisoActivo) {
      ui.caption.textContent = "";
      ui.caption.dataset.visible = "false";
    }
    voice.destroy();
    ui.audio.srcObject = null;
    ui.signal.classList.remove("online");
    ui.connect.textContent = "Iniciar conversación";
    ui.connect.disabled = false;
    ui.mute.disabled = true;
    ui.mute.textContent = "Silenciar micrófono";
    // Si la sesión cayó por un fallo, se conserva su mensaje: decir «Lista para
    // comenzar» encima lo borraría justo cuando hace falta leerlo.
    setStatus(ultimoFallo?.mensaje || "Lista para comenzar");
  },
  onPhase: phase => {
    hayActividad();
    // En reunión deja de apuntar en cuanto empieza a hablar: lo que salga por
    // los altavoces es suyo, no de la reunión.
    // Con la reunión cerrada esto es una conversación normal: no hay sala que
    // dejar de apuntar ni estado de reunión que cambiar.
    if (enModoMeet && phase === "speaking" && estadoReunion !== ESTADOS.POSTERIOR) {
      escucha.ensordecer(true);
      fijarEstado(ESTADOS.HABLANDO);
    }
    if (phase !== "speaking") faseDeSesion = phase;
    director.setState(phase);
    // La expresión sigue al turno: se concentra mientras piensa y se recompone
    // al escuchar. Es lo que hace que la cara acompañe a la conversación en vez
    // de limitarse a mover la boca.
    if (phase === "thinking") director.setExpression("concentracion", .55);
    if (phase === "listening") director.setExpression("neutra");
    if (phase === "idle") director.setExpression("neutra");
  },
  onStatus: setStatus,
  // Los avisos del sistema se muestran siempre, aunque los subtítulos estén
  // apagados: son cosas que la persona necesita leer para poder seguir.
  onHelp: mostrarAviso,
  onNota: anotarNota,
  onTranscript: text => {
    hayActividad();
    anotarTurno(text);
    aplicarExpresionDeFrase(text);
  },
  onResponseDone: () => {
    respuestaCerrada = true;
    cerrarTurno();
  },
  onToolCall: atenderHerramienta,
  onFailure: atenderFallo
};

// Relevo de proveedor.
//
// Gemini va primero por precio: su audio cuesta unas diez veces menos que el de
// OpenAI ($3 y $12 por millón de tokens frente a $32 y $64), y para lo que hace
// Catalina la diferencia de calidad no lo justifica. OpenAI queda de respaldo,
// que es justo el reparto contrario al que había.
//
// Cada intento vuelve a empezar por el principal: si falló por un tope de uso,
// al reponerse se vuelve solo sin tener que tocar nada.
const sesiones = {
  elevenlabs: new ElevenLabsSession(manejadores),
  openai: new RealtimeSession(manejadores),
  gemini: new GeminiSession(manejadores)
};

// ElevenLabs va primero: es el agente de esta versión —oído, cerebro y voz
// suyos— y el único que además manda la alineación con la que se mueve la boca.
// Los otros dos quedan de respaldo para no quedarse sin conversación si su
// servicio falla, aunque entonces los labios vuelven a deducirse del espectro.
const ORDEN = ["elevenlabs", "gemini", "openai"];

// Motivos por los que ese proveedor no va a funcionar por mucho que se
// reintente: sin crédito o sin clave válida. Un fallo de red no entra aquí,
// porque cambiar de proveedor no lo arreglaría y ocultaría el problema real.
const MOTIVOS_DE_RELEVO = new Set([
  "API_RATE_LIMIT", "API_KEY_MISSING", "API_KEY_INVALID",
  "GEMINI_KEY_MISSING", "GEMINI_KEY_INVALID", "GEMINI_SESSION_ERROR",
  "ELEVENLABS_KEY_MISSING", "ELEVENLABS_AGENT_MISSING", "ELEVENLABS_SESSION_ERROR"
]);

const disponible = { elevenlabs: false, openai: false, gemini: false };
let proveedor = null;
let sesion = null;
let ultimoFallo = null;   // el motivo del último corte, para no perderlo al desconectar

function proveedoresUtiles() {
  return ORDEN.filter(nombre => disponible[nombre]);
}

async function conectar() {
  const cadena = proveedoresUtiles();
  if (!cadena.length) {
    setStatus("No hay ninguna voz configurada");
    mostrarAviso("Falta la clave de ElevenLabs, de OpenAI o de Gemini para poder conversar.");
    ui.connect.disabled = false;
    return;
  }
  proveedor = cadena[0];
  sesion = sesiones[proveedor];
  ui.connect.disabled = true;
  await sesion.connect();
}

// Corte por inactividad.
//
// Una sesión abierta sigue enviando el micrófono aunque nadie hable, y eso se
// paga: con OpenAI son unos tres dólares por hora de silencio. Antes no había
// nada que la cerrara, así que alejarse del equipo costaba dinero sin dar nada
// a cambio.
// Tope de espera de una herramienta antes de rendirse. Mientras corre, quien
// está al otro lado no oye nada: el silencio es parte del costo, así que se
// paga acotado. El servidor tiene su propio tope, más corto; éste es la red de
// seguridad por si el que no responde es el servidor.
const ESPERA_HERRAMIENTA_MS = 9000;

const INACTIVIDAD_MS = 2 * 60 * 1000;
const AVISO_MS = 15 * 1000;          // se avisa quince segundos antes de colgar
let relojInactividad = null;
let relojAviso = null;

function hayActividad() {
  clearTimeout(relojInactividad);
  clearTimeout(relojAviso);
  if (!connected) return;

  relojAviso = setTimeout(() => {
    if (connected) setStatus("Sin actividad; voy a cerrar la sesión");
  }, INACTIVIDAD_MS - AVISO_MS);

  relojInactividad = setTimeout(() => {
    if (!connected) return;
    sesion?.disconnect();
    // Se dice por qué se cerró: si no, parece que se cayó.
    setStatus("Sesión cerrada por inactividad");
    mostrarAviso("Cerré la sesión porque no hubo actividad. Pulsa «Iniciar conversación» para seguir.");
  }, INACTIVIDAD_MS);
}

function pararRelojes() {
  clearTimeout(relojInactividad);
  clearTimeout(relojAviso);
  relojInactividad = relojAviso = null;
}

async function atenderFallo(error) {
  const cadena = proveedoresUtiles();
  const siguiente = cadena[cadena.indexOf(proveedor) + 1];

  if (!siguiente || !MOTIVOS_DE_RELEVO.has(error.code)) {
    ultimoFallo = { mensaje: error.mensaje || "No se pudo conectar" };
    setStatus(ultimoFallo.mensaje);
    mostrarAviso(error.ayuda || "");
    // El botón vuelve a estar listo para reintentar aunque la sesión no llegue
    // a llamar a onDisconnected (p. ej. si falló antes de conectar del todo).
    connected = false;
    ui.connect.textContent = "Iniciar conversación";
    ui.connect.disabled = false;
    ui.mute.disabled = true;
    return;
  }

  proveedor = siguiente;
  sesion = sesiones[siguiente];
  setStatus(`Paso a ${siguiente === "openai" ? "OpenAI" : "Gemini"}…`);
  mostrarAviso("");
  ui.connect.disabled = true;
  await sesion.connect();
}

image.src = "assets/catalina.png";
image.onload = () => {
  renderer = new FaceRenderer(image);
  requestAnimationFrame(render);
};

// Cambios de vista.
//
// En iPhone la barra de direcciones se pliega al desplazar y la altura útil
// cambia sin que llegue un `resize`: quien avisa es visualViewport. Sin esto el
// lienzo se quedaba con la altura vieja y la cara aparecía estirada o con una
// franja negra al pie. `orientationchange` cubre el giro del teléfono, donde
// Safari a veces mide antes de terminar la rotación.
function alCambiarLaVista() {
  resize();
  medirControles();
}

window.addEventListener("resize", alCambiarLaVista);
window.addEventListener("orientationchange", () => setTimeout(alCambiarLaVista, 120));
window.visualViewport?.addEventListener("resize", alCambiarLaVista);
resize();

ui.connect.addEventListener("click", () => {
  if (connected) return sesion?.disconnect();
  conectar();
});
ui.mute.addEventListener("click", () => {
  const muted = sesion?.toggleMute();
  ui.mute.textContent = muted ? "Activar micrófono" : "Silenciar micrófono";
  setStatus(muted ? "Micrófono silenciado" : "Te escucho");
});
ui.meetMode.addEventListener("click", () => entrarEnModoMeet());
ui.exitMeet.addEventListener("click", () => salirDeModoMeet());
ui.togglePanel.addEventListener("click", () => fijarPanel(!verPanel));
ui.panelClose.addEventListener("click", () => fijarPanel(false));
ui.imagenCerrar.addEventListener("click", () => {
  mostrarLienzoDeImagen("oculto");
  laminaEnPantalla = null;
  ocultarGaleria();
});
ui.referenciasCerrar.addEventListener("click", () => {
  ui.referencias.dataset.estado = "oculto";
  referenciasEnPantalla = [];
});
ui.referenciasAmpliar.addEventListener("click", () => {
  referenciasExpandido = !referenciasExpandido;
  pintarReferencias();
});

// Botonera de teléfono. Envuelto en una guarda: si por un caché viejo del HTML
// faltaran estos elementos, que no rompa el resto de la app (voz incluida).
if (ui.abrirMarcador && ui.marcador) {
  ui.abrirMarcador.addEventListener("click", () => {
    ui.marcador.dataset.estado === "visible" ? cerrarMarcador() : abrirMarcador("");
  });
  ui.marcadorCerrar.addEventListener("click", () => cerrarMarcador());
  ui.marcadorTeclas.addEventListener("click", event => {
    const tecla = event.target.closest(".tecla");
    if (tecla) pulsarTecla(tecla.dataset.d);
  });
  ui.marcadorBorrar.addEventListener("click", () => {
    ui.marcadorNumero.value = ui.marcadorNumero.value.slice(0, -1);
    ui.marcadorNumero.focus();
  });
  ui.marcadorNumero.addEventListener("input", limpiarNumeroMarcador);
  ui.marcadorLlamar.addEventListener("click", () => lanzarLlamadaDesdeBotonera());
  ui.marcadorColgar.addEventListener("click", () => colgarLlamada());
}
// Modo reunión. Con la misma guarda que la botonera: si faltara el marcado por
// un caché viejo, que no se lleve por delante el resto de la aplicación.
if (ui.reunion) {
  ui.reunionParticipar.addEventListener("click", () => participar());
  ui.reunionNota.addEventListener("click", () => alternarCuaderno());
  ui.reunionCerrarNotas.addEventListener("click", () => alternarCuaderno(false));
  // Se guarda mientras se escribe: una recarga a mitad de reunión no puede
  // llevarse por delante lo apuntado.
  ui.reunionNotas.addEventListener("input", () => guardarCuaderno());
  ui.reunionHistorial.addEventListener("click", () => mostrarHistorial());
  ui.reunionDocumento.addEventListener("click", () => ui.reunionArchivo.click());
  ui.reunionFinalizar.addEventListener("click", () => pedirCierre());
  ui.reunionArchivo.addEventListener("change", async evento => {
    const archivos = [...evento.target.files];
    // Se vacía antes de leer: si no, volver a elegir el mismo archivo no
    // dispara el evento y parece que la aplicación lo ignoró.
    evento.target.value = "";
    await recibirArchivos(archivos);
  });
  ui.reunionQuien.addEventListener("input", () => { memoria.fijarHablante(ui.reunionQuien.value); apuntarBorrador(); });
  ui.reunionAceptar.addEventListener("click", () => aceptarCampo());
  ui.reunionCancelar.addEventListener("click", () => descartarCampo());
  ui.reunionEntrada.addEventListener("keydown", evento => {
    if (evento.key === "Enter") { evento.preventDefault(); aceptarCampo(); }
    if (evento.key === "Escape") { evento.preventDefault(); descartarCampo(); }
  });
  ui.cierreCerrar.addEventListener("click", () => { ui.cierre.dataset.estado = "oculto"; });
}

if (ui.preparar) {
  ui.prepararEmpezar.addEventListener("click", () => empezarLaReunion());
  ui.prepararCerrar.addEventListener("click", () => salirDeModoMeet());
  ui.prepararHistorial.addEventListener("click", () => mostrarHistorial());
  ui.prepararDocumentos.addEventListener("click", () => ui.reunionArchivo.click());
  ui.prepararAntecedente.addEventListener("click", () => mostrarHistorial({ paraElegir: true }));
  ui.prepararTitulo.addEventListener("keydown", e => { if (e.key === "Enter") empezarLaReunion(); });
}

document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea")) return;
  const tecla = event.key.toLowerCase();
  if (tecla === "h") {
    ui.stage.classList.contains("meet") ? salirDeModoMeet() : entrarEnModoMeet();
  }
  if (event.key === "Escape") {
    if (ui.cierre?.dataset.estado === "visible") ui.cierre.dataset.estado = "oculto";
    else if (verPanel) fijarPanel(false);
    else salirDeModoMeet();
  }
});
document.addEventListener("pointerdown", () => {
  hayActividad();
  voice.resume();
  if (ui.audio.srcObject && ui.audio.paused) ui.audio.play().catch(() => {});
}, { passive: true });

function setStatus(text) {
  ui.status.textContent = text;
}

// Modo reunión.
//
// Catalina no es una interlocutora en la reunión: es la secretaria. Por defecto
// escucha y calla, y sólo habla cuando alguien la habilita y la invoca. Ese
// «por defecto calla» es el cambio que ordena todo lo demás: una asistente que
// contesta cada vez que oye su nombre interrumpe una reunión de verdad.
//
// Lo que oye lo transcribe el navegador, gratis, y no se le manda al modelo
// mientras nadie la llame: mandarle el audio de una reunión entera costaría unos
// tres dólares por hora sólo por estar ahí. La sesión de voz sigue abierta con
// el micrófono cortado, así que responde al instante y con su voz.
//
// La memoria de la reunión es aparte de la conversación con ella (reunion.js), y
// distingue lo que se dijo, lo que traían los documentos y lo que el usuario
// indicó como nota. Esa distinción llega hasta la minuta.

const memoria = new MemoriaDeReunion();

const escucha = new EscuchaDeReunion({
  alTranscribir: texto => {
    hayActividad();                       // la reunión cuenta como vida
    memoria.anotarTurno(texto);
    // Cada frase capturada se persiste. Esto es lo que convierte la
    // transcripción en un registro: deja de depender de que el navegador siga
    // vivo al final de la reunión.
    apuntarBorrador();
    refrescarCuenta();
    // Con la participación habilitada, lo primero que se diga es la pregunta.
    // Queda igualmente anotado como parte de la reunión: se dijo en la sala.
    if (estadoReunion === ESTADOS.HABILITADA) invocar(texto);
    else eco(texto);
  },
  // Llamarla por su nombre.
  //
  // Con la participación permitida —se marca al preparar la reunión— decir
  // «Catalina, …» basta y contesta. Sin ella no interrumpe, pero lo dice en vez
  // de callar: quien la nombró se quedaba esperando una respuesta que no iba a
  // llegar y no había forma de saber por qué.
  alLlamarla: (peticion) => {
    if (estadoReunion === ESTADOS.HABILITADA) return;   // ya lo tomó alTranscribir
    if (estadoReunion !== ESTADOS.ESCUCHANDO) return;
    if (!participacionPermitida) {
      eco("Me nombraste, pero tengo la participación apagada. Pulsa «Participar».");
      return;
    }
    invocar(peticion);
  },
  alFallar: motivo => fijarEstado(estadoReunion === ESTADOS.POSTERIOR ? ESTADOS.POSTERIOR : ESTADOS.ESCUCHANDO, motivo, "problema"),
  // La escucha se recuperó sola de algo. Se dice, porque el usuario tiene
  // derecho a saber que hubo un hueco antes de leer el documento.
  alRecuperarse: rearranques => {
    if (estadoReunion === ESTADOS.POSTERIOR || estadoReunion === ESTADOS.CERRANDO) return;
    fijarEstado(ESTADOS.ESCUCHANDO, rearranques
      ? `La escucha se cortó ${rearranques} veces y se repuso; puede faltar algo de transcripción.`
      : "Volví a escuchar la sala.");
  }
});

let enModoMeet = false;
let micCortadoPorMeet = false;
let estadoReunion = ESTADOS.ESCUCHANDO;
let esperaParticipacion = null;
// Si puede contestar cuando la nombran. Lo decide el tipo de reunión al
// prepararla —en una clase no, en una sesión creativa sí— y se puede cambiar.
let participacionPermitida = false;
let relojReunion = null;
let campoAbierto = "";          // qué está pidiendo el campo de texto de la tira
let documentoPendiente = null;  // documento leído, a la espera de su descripción
let colaDeArchivos = [];        // los que faltan por leer, si alguno pidió descripción
// La reunión ya cerrada sobre la que se puede seguir preguntando. Es lo que
// convierte «finalizar» en un cambio de estado y no en un final.
let reunionConsultable = null;
let plazoDeBorrador = null;
let ultimoBorrador = { ok: false, momento: 0, frases: 0 };

// Persiste la reunión en curso. Se agrupa en dos segundos porque en una reunión
// animada llegan varias frases seguidas y no hace falta una escritura por cada
// una; lo que sí hace falta es que nunca pasen más de dos segundos entre lo que
// se oyó y lo que está guardado.
function apuntarBorrador() {
  if (!memoria.abierta) return;
  clearTimeout(plazoDeBorrador);
  plazoDeBorrador = setTimeout(async () => {
    const frases = memoria.turnos.length;
    const r = await guardarBorrador(memoria.borrador());
    ultimoBorrador = { ok: r.ok, momento: r.momento || Date.now(), frases, error: r.error };
    // Si el almacén no acepta escrituras hay que decirlo AHORA, no al final:
    // con esto roto la reunión sólo existe en memoria y un cierre de pestaña se
    // la lleva entera.
    if (!r.ok && !avisadoDelBorrador) {
      avisadoDelBorrador = true;
      fijarEstado(estadoReunion, "No puedo guardar la reunión en este navegador; sigo escuchando, pero no cierres la pestaña.", "problema");
    }
  }, 2000);
}
let avisadoDelBorrador = false;

// ── Señales en pantalla ──────────────────────────────────────────────────────

function eco(texto) {
  if (ui.reunionEco) ui.reunionEco.textContent = texto;
}

function fijarEstado(estado, textoEco = "", fase = "") {
  estadoReunion = estado;
  if (!ui.reunionEstado) return;
  ui.reunionEstado.dataset.fase = fase || estado;
  ui.reunionEstadoTexto.textContent = fase === "problema" ? "Atención" : ROTULOS[estado];
  ui.reunionParticipar?.setAttribute("aria-pressed", String(estado === ESTADOS.HABILITADA));
  if (textoEco) eco(textoEco);
}

// Cada veinte segundos, además de la cuenta: ¿se está capturando algo?
//
// Descubrir al FINAL que no se transcribió nada es descubrirlo cuando ya no
// tiene arreglo. Una reunión que lleva tres minutos sin una sola frase está
// rota, y hay que decirlo mientras todavía se puede hacer algo.
const SILENCIO_SOSPECHOSO = 3 * 60_000;

function vigilarLaReunion() {
  refrescarCuenta();
  if (estadoReunion === ESTADOS.CERRANDO || estadoReunion === ESTADOS.POSTERIOR) return;
  if (!memoria.abierta || memoria.minutosTranscurridos() < 3) return;

  const captura = escucha.diagnostico();
  if (captura.frases > 0) return;
  fijarEstado(estadoReunion, captura.ultimoFallo
    ? `No he capturado nada en ${memoria.minutosTranscurridos()} minutos: ${captura.ultimoFallo}`
    : `Llevo ${memoria.minutosTranscurridos()} minutos sin capturar ni una frase. Comprueba el micrófono en /reunion.html; las notas y los documentos sí se están guardando.`,
    "problema");
}

function refrescarCuenta() {
  if (!ui.reunionCuenta) return;
  const piezas = [`${memoria.minutosTranscurridos()} min`];
  if (memoria.turnos.length) piezas.push(`${memoria.turnos.length} interv.`);
  const lineas = memoria.lineasDeCuaderno();
  if (lineas) piezas.push(`${lineas} nota${lineas === 1 ? "" : "s"}`);
  if (memoria.documentos.length) piezas.push(`${memoria.documentos.length} doc.`);
  ui.reunionCuenta.textContent = piezas.join(" · ");
}

// ── Entrar y salir ───────────────────────────────────────────────────────────

// ── Preparación ──────────────────────────────────────────────────────────────
//
// Entrar en modo reunión ya no arranca a escuchar de golpe. Primero se decide
// qué reunión es: el tipo cambia qué se prioriza y cómo queda la minuta, y
// decidirlo después, con la reunión ya empezada, no sirve de nada.
//
//   ENTRAR → PREPARANDO → (Iniciar) → ESCUCHANDO
//
// Y si algo falla al arrancar la escucha, se vuelve a PREPARANDO con el motivo
// a la vista y un botón para reintentar. Nunca hace falta salir del modo.

let preparando = false;
let tipoElegido = TIPO_POR_DEFECTO;
let antecedenteElegido = null;
let documentosPrevios = [];

function entrarEnModoMeet() {
  ui.stage.classList.add("meet");
  if (enModoMeet) return;
  enModoMeet = true;

  // Con una reunión ya en marcha —se salió sin querer y se vuelve— se retoma
  // donde estaba en vez de preguntar otra vez qué tipo de reunión es.
  if (memoria.abierta && !memoria.vacia()) return volverALaReunion();
  if (estadoReunion === ESTADOS.POSTERIOR && reunionConsultable) return volverALaReunion();
  abrirPreparacion();
}

async function abrirPreparacion() {
  preparando = true;
  if (ui.reunion) ui.reunion.hidden = true;
  if (!ui.preparar) return empezarLaReunion();   // marcado viejo en caché
  ui.preparar.hidden = false;

  pintarTipos();
  ui.prepararTitulo.value = "";
  ui.prepararObjetivo.value = "";
  ui.prepararNotas.value = "";
  antecedenteElegido = null;
  documentosPrevios = [];
  refrescarAdjuntosPrevios();

  // ¿Quedó una reunión a medias de otra vez? Se ofrece retomarla antes que
  // nada: tirar una transcripción capturada sería el peor error posible.
  ui.prepararRetomar.hidden = true;
  const pendiente = await borradorPendiente();
  if (pendiente && (pendiente.turnos ?? []).length) {
    ui.prepararRetomar.hidden = false;
    ui.prepararRetomar.innerHTML = "";
    const texto = document.createElement("span");
    const cuando = new Date(pendiente.inicio).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    texto.textContent = `Quedó una reunión sin cerrar («${pendiente.titulo || "sin título"}», ${cuando}) `
      + `con ${pendiente.turnos.length} intervenciones capturadas. `;
    const retomar = document.createElement("button");
    retomar.textContent = "Retomarla";
    retomar.addEventListener("click", () => {
      memoria.retomar(pendiente);
      tipoElegido = memoria.tipo;
      empezarLaReunion({ retomada: true });
    });
    const descartar = document.createElement("button");
    descartar.textContent = "Descartarla";
    descartar.addEventListener("click", async () => {
      await olvidarBorrador(pendiente.id);
      ui.prepararRetomar.hidden = true;
    });
    ui.prepararRetomar.append(texto, retomar, descartar);
  }
}

function pintarTipos() {
  ui.prepararTipos.innerHTML = "";
  for (const [id, tipo] of Object.entries(TIPOS)) {
    const boton = document.createElement("button");
    boton.className = "tipo-reunion";
    boton.type = "button";
    boton.role = "radio";
    boton.setAttribute("aria-checked", String(id === tipoElegido));
    boton.innerHTML = `<b>${escaparHtml(tipo.nombre)}</b><i>${escaparHtml(tipo.resumen)}</i>`;
    boton.addEventListener("click", () => {
      tipoElegido = id;
      // Cada tipo trae su propia idea de si ella debería intervenir: en una
      // clase no, en una sesión creativa sí. Se propone y se puede cambiar.
      ui.prepararParticipa.checked = tipo.participacion;
      pintarTipos();
    });
    ui.prepararTipos.append(boton);
  }
  ui.prepararParticipa.checked = tipoDeReunion(tipoElegido).participacion;
}

function refrescarAdjuntosPrevios() {
  const piezas = [];
  if (documentosPrevios.length) piezas.push(`${documentosPrevios.length} documento${documentosPrevios.length === 1 ? "" : "s"}`);
  if (antecedenteElegido) piezas.push(`da seguimiento a «${antecedenteElegido.titulo}»`);
  ui.prepararAdjuntos.textContent = piezas.join(" · ");
}

// Arranca la reunión de verdad. Devuelve si lo consiguió: si no, se queda en la
// preparación con el motivo escrito, y se puede reintentar sin salir del modo.
function empezarLaReunion({ retomada = false } = {}) {
  if (!retomada) {
    memoria.abrir({
      titulo: ui.prepararTitulo?.value.trim() || "",
      objetivo: ui.prepararObjetivo?.value.trim() || "",
      tipo: tipoElegido,
      antecedente: antecedenteElegido,
      cuaderno: ui.prepararNotas?.value.trim() || ""
    });
    for (const documento of documentosPrevios) memoria.anotarDocumento(documento);
  }
  participacionPermitida = ui.prepararParticipa ? ui.prepararParticipa.checked : false;

  preparando = false;
  if (ui.preparar) ui.preparar.hidden = true;
  if (ui.reunion) ui.reunion.hidden = false;
  if (ui.reunionQuien) ui.reunionQuien.value = memoria.hablante;
  if (ui.reunionNotas) ui.reunionNotas.value = memoria.cuaderno;
  ajustarBotonesDeReunion();
  clearInterval(relojReunion);
  relojReunion = setInterval(vigilarLaReunion, 20_000);
  refrescarCuenta();
  apuntarBorrador();

  const arrancada = arrancarLaEscucha();
  if (arrancada.ok) {
    fijarEstado(ESTADOS.ESCUCHANDO, retomada
      ? `Reunión retomada: ${memoria.turnos.length} intervenciones ya capturadas. Sigo escuchando.`
      : "Escuchando la reunión. No voy a intervenir hasta que me lo pidas.");
    setStatus("En reunión");
  } else {
    fijarEstado(ESTADOS.ESCUCHANDO, arrancada.motivo, "problema");
    ofrecerReintento(arrancada.motivo);
  }
  return arrancada.ok;
}

// Todo lo que puede impedir escuchar, en un solo sitio y con un motivo legible.
function arrancarLaEscucha() {
  if (!escuchaDisponible()) {
    return { ok: false, motivo: "Este navegador no transcribe. Usa Chrome; las notas y los documentos sí funcionan." };
  }
  if (!connected) return { ok: false, motivo: "La conversación está cerrada: pulsa «Iniciar conversación» y reintenta." };

  // Se deja de enviar audio al modelo sin apagar la pista: quien escucha ahora
  // es el navegador, y con la pista apagada no oiría nada.
  //
  // Va dentro de un try y DESPUÉS de nada crítico a propósito: si un proveedor
  // no tuviera este método, la excepción se llevaba por delante el arranque de
  // la escucha y la reunión entera se quedaba muda. Callar al modelo es
  // deseable; que impida escuchar la sala, jamás.
  try {
    if (sesion && !sesion.muted && typeof sesion.pausarEnvio === "function") {
      sesion.pausarEnvio(true);
      micCortadoPorMeet = true;
      ui.mute.textContent = "Activar micrófono";
    }
  } catch (error) {
    console.warn("No se pudo callar el micrófono del modelo:", error);
  }

  escucha.ensordecer(false);
  if (!escucha.empezar()) {
    return { ok: false, motivo: escucha.ultimoFallo || "El navegador no dejó arrancar el reconocimiento de voz." };
  }
  return { ok: true };
}

// Un fallo al arrancar no puede obligar a salir del modo y volver a entrar, que
// es justo lo que había que hacer antes. Se ofrece reintentar donde está.
function ofrecerReintento(motivo) {
  eco(`${motivo} `);
  const reintentar = document.createElement("button");
  reintentar.className = "reunion-si";
  reintentar.style.marginLeft = "6px";
  reintentar.style.minHeight = "24px";
  reintentar.style.padding = "0 10px";
  reintentar.style.fontSize = "11.5px";
  reintentar.textContent = "Reintentar";
  reintentar.addEventListener("click", () => {
    const otra = arrancarLaEscucha();
    if (otra.ok) {
      fijarEstado(ESTADOS.ESCUCHANDO, "Ya te escucho. Sigue la reunión.");
      setStatus("En reunión");
    } else {
      fijarEstado(ESTADOS.ESCUCHANDO, otra.motivo, "problema");
      ofrecerReintento(otra.motivo);
    }
  });
  ui.reunionEco.append(reintentar);
}

// Volver a una reunión que ya estaba en marcha, sin pasar por la preparación.
function volverALaReunion() {
  preparando = false;
  if (ui.preparar) ui.preparar.hidden = true;
  if (ui.reunion) ui.reunion.hidden = false;
  if (ui.reunionQuien) ui.reunionQuien.value = memoria.hablante;
  if (ui.reunionNotas) ui.reunionNotas.value = memoria.cuaderno;
  ajustarBotonesDeReunion();
  refrescarCuenta();
  if (estadoReunion === ESTADOS.POSTERIOR) {
    fijarEstado(ESTADOS.POSTERIOR, "Reunión cerrada. Pregúntame lo que quieras sobre ella.");
    return;
  }
  clearInterval(relojReunion);
  relojReunion = setInterval(refrescarCuenta, 20_000);
  const arrancada = arrancarLaEscucha();
  if (arrancada.ok) {
    fijarEstado(ESTADOS.ESCUCHANDO, "Sigo con la reunión donde la dejamos.");
    setStatus("En reunión");
  } else {
    fijarEstado(ESTADOS.ESCUCHANDO, arrancada.motivo, "problema");
    ofrecerReintento(arrancada.motivo);
  }
}

function salirDeModoMeet() {
  ui.stage.classList.remove("meet");
  if (!enModoMeet) return;
  enModoMeet = false;

  escucha.parar();
  escucha.ensordecer(false);
  clearTimeout(esperaParticipacion);
  clearInterval(relojReunion);
  cerrarCampo();
  if (ui.reunion) ui.reunion.hidden = true;
  // Sólo se devuelve el micrófono si fue este modo quien lo quitó.
  try {
    if (micCortadoPorMeet && sesion?.muted && typeof sesion.pausarEnvio === "function") {
      sesion.pausarEnvio(false);
      ui.mute.textContent = "Silenciar micrófono";
    }
  } catch (error) {
    console.warn("No se pudo devolver el micrófono:", error);
  }
  micCortadoPorMeet = false;
  // La reunión cerrada sigue cargada aunque se salga del modo: se puede seguir
  // preguntando por ella desde la conversación normal.
  setStatus(connected ? (reunionConsultable ? "Te escucho · reunión cargada" : "Te escucho") : "Lista para comenzar");
}

// ── Participar ───────────────────────────────────────────────────────────────

// Habilita una intervención. No abre el micrófono del modelo: lo que se diga a
// continuación se le manda transcrito, junto con el estado de la reunión, para
// que conteste sabiendo de qué se habla sin haber estado escuchando todo.
function participar() {
  if (!enModoMeet) return;
  if (estadoReunion === ESTADOS.HABILITADA) {
    clearTimeout(esperaParticipacion);
    fijarEstado(ESTADOS.ESCUCHANDO, "De acuerdo, sigo escuchando.");
    return;
  }
  if (estadoReunion === ESTADOS.INVOCADA || estadoReunion === ESTADOS.HABLANDO) return;
  if (!connected) {
    fijarEstado(ESTADOS.ESCUCHANDO, "La conversación está cerrada: no puedo intervenir.", "problema");
    return;
  }

  // Pulsarlo también deja la participación encendida para el resto de la
  // reunión: quien la usa una vez normalmente la quiere disponible.
  participacionPermitida = true;
  fijarEstado(ESTADOS.HABILITADA, "Dime qué necesitas. Te escucho a ti, no a la sala.");
  clearTimeout(esperaParticipacion);
  // Si nadie dice nada, vuelve a callarse sola. Quedarse habilitada indefinida-
  // mente haría que respondiera a lo primero que oyera diez minutos después.
  esperaParticipacion = setTimeout(() => {
    if (estadoReunion === ESTADOS.HABILITADA) volverAEscuchar("Nadie me pidió nada.");
  }, 25_000);
}

// Vuelve a escuchar la sala y COMPRUEBA que de verdad se está escuchando. No
// basta con quitar la sordera: si el reconocimiento murió mientras ella hablaba,
// dejarlo así significaba perder el resto de la reunión sin avisar.
function volverAEscuchar(mensaje) {
  escucha.ensordecer(false);
  const estado = escucha.diagnostico();
  if (!estado.activa) {
    const otra = arrancarLaEscucha();
    if (!otra.ok) {
      fijarEstado(ESTADOS.ESCUCHANDO, otra.motivo, "problema");
      ofrecerReintento(otra.motivo);
      return;
    }
    fijarEstado(ESTADOS.ESCUCHANDO, "Volví a escuchar la sala.");
    return;
  }
  fijarEstado(ESTADOS.ESCUCHANDO, participacionPermitida
    ? `${mensaje} Dime «Catalina» cuando me necesites.`
    : `${mensaje} Pulsa «Participar» cuando me necesites.`);
}

function invocar(peticion) {
  clearTimeout(esperaParticipacion);
  if (!connected || !sesion) {
    fijarEstado(ESTADOS.ESCUCHANDO, "Me llamaste, pero la sesión está cerrada.", "problema");
    return;
  }
  fijarEstado(ESTADOS.INVOCADA, `Me pediste: «${peticion}»`);
  escucha.ensordecer(true);

  // Se le da el estado de la reunión y lo que le piden por separado, para que
  // sepa qué es contexto y qué es la pregunta.
  const mensaje = [
    "Estás de secretaria en una reunión y acaban de darte la palabra. Esto es el estado de la reunión:",
    "",
    memoria.resumenVivo(),
    "",
    `Lo que te piden ahora es: «${peticion}»`,
    "",
    "Responde sólo a eso, breve y en voz alta, como quien interviene en una reunión: dos o tres frases.",
    "No resumas la reunión entera salvo que te lo pidan.",
    "La transcripción es automática y puede tener errores: si algo no cuadra, dilo en vez de darlo por cierto."
  ].join("\n");

  if (sesion.enviarTexto(mensaje) === true) {
    setStatus("Respondiendo…");
  } else {
    fijarEstado(ESTADOS.ESCUCHANDO, "No pude enviar tu pregunta.", "problema");
    escucha.ensordecer(false);
  }
}

// Los botones dicen lo que se puede hacer AHORA. Con la reunión cerrada, seguir
// enseñando «Participar» y «Tomar nota» sería ofrecer cosas que ya no aplican, y
// «Finalizar reunión» pasa a ser «Nueva reunión», que es lo que toca.
function ajustarBotonesDeReunion() {
  if (!ui.reunionParticipar) return;
  const cerrada = estadoReunion === ESTADOS.POSTERIOR;
  // Con la reunión cerrada ya no hay a quién atribuir nada.
  ui.reunionQuien.closest(".reunion-hablante").hidden = cerrada;
  ui.reunionParticipar.hidden = cerrada;
  ui.reunionNota.hidden = cerrada;
  ui.reunionDocumento.hidden = cerrada;
  ui.reunionFinalizar.textContent = cerrada ? "Empezar otra reunión" : "Finalizar reunión";
}

// La carpeta de Drive se elige en /reunion.html y se guarda aquí mismo, en el
// navegador. Así se puede cambiar sin volver a desplegar; si no hay ninguna,
// manda la de las variables de entorno.
function carpetaDeDrive() {
  try { return localStorage.getItem("catalina.reunion.carpetaDrive") || ""; }
  catch { return ""; }
}

// El permiso de la cuenta de Google que se conectó en /reunion.html. Vive aquí,
// en este navegador, y sólo viaja al propio servidor al cerrar una reunión.
function permisoDeDrive() {
  try { return localStorage.getItem("catalina.drive.permiso") || ""; }
  catch { return ""; }
}

// ¿Hay alguna otra vía de archivo montada? Sirve para no reclamar Google Drive
// cuando las minutas ya se están guardando por otro lado.
function hayOtroArchivo() {
  return Boolean(miCorreo()) || (carpetaDisponible() && Boolean(carpetaDeLaSesion));
}
// Se recuerda al pintar el cierre: consultarlo es asíncrono y aquí hace falta
// una respuesta inmediata.
let carpetaDeLaSesion = null;
carpetaGuardada().then(c => { carpetaDeLaSesion = c; }).catch(() => {});

// Tu propio correo, si lo configuraste. Mandarte a ti mismo la minuta no es la
// acción externa que exige confirmación —no sale de tu círculo— y convierte tu
// bandeja en el archivo: buscable, en todos tus dispositivos y con copia de
// seguridad, sin instalar ni conectar nada.
function miCorreo() {
  try { return localStorage.getItem("catalina.reunion.miCorreo") || ""; }
  catch { return ""; }
}

// ── Historial ────────────────────────────────────────────────────────────────
//
// Una reunión no termina en dos archivos: termina en algo que se consulta
// después y que puede servir de antecedente para la siguiente. El historial vive
// en este navegador (IndexedDB) porque el disco de Vercel es de sólo lectura y
// montar una base de datos para algo que sólo lee su dueño sería desproporcionado.

async function mostrarHistorial({ paraElegir = false } = {}) {
  if (!historialDisponible()) {
    mostrarCierre("Reuniones anteriores", "<p class=\"cierre-aviso\">Este navegador no guarda el historial.</p>");
    return;
  }
  const reuniones = await listarReuniones();
  mostrarCierre("Reuniones anteriores", "");
  const cuerpo = ui.cierreCuerpo;

  if (!reuniones.length) {
    cuerpo.innerHTML = "<p>Todavía no hay ninguna reunión cerrada. Las que cierres aparecerán aquí, "
      + "con su minuta y su transcripción, y podrás usarlas como antecedente de una reunión de seguimiento.</p>";
    return;
  }

  const nota = document.createElement("p");
  nota.textContent = paraElegir
    ? "Elige la reunión de la que ésta es seguimiento."
    : "Abre una para leer su minuta y su transcripción, preguntarle a Catalina sobre ella o usarla de antecedente.";
  cuerpo.append(nota);

  const lista = document.createElement("div");
  lista.className = "historial";
  for (const r of reuniones) lista.append(fichaDeReunion(r, paraElegir));
  cuerpo.append(lista);
}

// La ficha es el expediente de la reunión, no un enlace a ella: fecha, título,
// participantes, y dentro la minuta, la transcripción, las notas y los
// documentos. Poder preguntar por una reunión sin poder leerla antes obligaba a
// adivinar qué preguntar.
function fichaDeReunion(r, paraElegir = false) {
  const ficha = document.createElement("article");
  ficha.className = "historial-ficha";

  const fecha = new Date(r.inicio).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
  const tipo = tipoDeReunion(r.tipo);

  const cabecera = document.createElement("div");
  cabecera.className = "historial-cabecera";
  cabecera.innerHTML = `<time>${escaparHtml(fecha)}</time><strong>${escaparHtml(r.titulo)}</strong>`
    + `<span class="historial-tipo">${escaparHtml(tipo.nombre)}</span>`;

  const detalle = document.createElement("p");
  detalle.className = "historial-detalle";
  detalle.textContent = [
    r.participantes.length ? r.participantes.join(", ") : "Sin participantes identificados",
    [`${r.acuerdos} acuerdo${r.acuerdos === 1 ? "" : "s"}`,
      `${r.acciones} ${r.acciones === 1 ? "acción" : "acciones"}`,
      r.pendientes ? `${r.pendientes} pendiente${r.pendientes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")
  ].join(" — ");

  const acciones = document.createElement("div");
  acciones.className = "historial-acciones";
  const expediente = document.createElement("div");
  expediente.className = "expediente";
  expediente.hidden = true;

  if (paraElegir) {
    const elegir = document.createElement("button");
    elegir.className = "reunion-si";
    elegir.textContent = "Usar como antecedente";
    elegir.addEventListener("click", async () => {
      const completa = await leerReunion(r.id);
      if (!completa) return;
      antecedenteElegido = comoAntecedente(completa);
      refrescarAdjuntosPrevios();
      ui.cierre.dataset.estado = "oculto";
    });
    acciones.append(elegir);
  } else {
    const abrir = document.createElement("button");
    abrir.className = "reunion-si";
    abrir.textContent = "Abrir";
    abrir.addEventListener("click", async () => {
      if (!expediente.hidden) { expediente.hidden = true; abrir.textContent = "Abrir"; return; }
      abrir.textContent = "Cargando…";
      const completa = await leerReunion(r.id);
      abrir.textContent = "Cerrar";
      if (!completa) { expediente.textContent = "No se pudo leer esta reunión."; expediente.hidden = false; return; }
      pintarExpediente(expediente, completa);
      expediente.hidden = false;
    });
    acciones.append(abrir);

    const preguntar = document.createElement("button");
    preguntar.textContent = "Preguntar sobre ella";
    preguntar.addEventListener("click", async () => {
      const completa = await leerReunion(r.id);
      if (!completa) return;
      reunionConsultable = completa;
      // Se abre el expediente además de cargarla: poder leer la minuta mientras
      // se pregunta por ella es la mitad de la utilidad.
      pintarExpediente(expediente, completa);
      expediente.hidden = false;
      avisarAlAgente([
        `[Aviso del sistema] Se abrió una reunión anterior para consultarla: «${completa.titulo}».`,
        "Es tu contexto ahora. Contesta lo que te pregunten sobre ella; si necesitas más detalle, usa consultar_reunion.",
        "Di en una frase que la tienes cargada y ofrécete a responder.",
        "",
        "=== LA REUNIÓN ===",
        memoria.contextoPosterior(completa)
      ].join("\n"));
    });
    acciones.append(preguntar);

    const antecedente = document.createElement("button");
    antecedente.textContent = "Usar de antecedente";
    antecedente.addEventListener("click", async () => {
      const completa = await leerReunion(r.id);
      if (!completa) return;
      const resumen = comoAntecedente(completa);
      if (preparando) { antecedenteElegido = resumen; refrescarAdjuntosPrevios(); }
      else memoria.antecedente = resumen;
      ui.cierre.dataset.estado = "oculto";
      eco(`Esta reunión da seguimiento a «${completa.titulo}».`);
    });
    acciones.append(antecedente);
  }

  const borrar = document.createElement("button");
  borrar.className = "historial-borrar";
  borrar.textContent = "Borrar";
  borrar.addEventListener("click", async () => {
    // Dos pulsaciones: borrar una reunión no se deshace y los archivos de Drive
    // no la reconstruyen —no traen la transcripción consultable—.
    if (borrar.dataset.seguro !== "si") {
      borrar.dataset.seguro = "si";
      borrar.textContent = "¿Seguro? Pulsa otra vez";
      return;
    }
    await borrarReunion(r.id);
    if (reunionConsultable?.id === r.id) reunionConsultable = null;
    ficha.remove();
  });
  acciones.append(borrar);

  ficha.append(cabecera, detalle, acciones, expediente);
  return ficha;
}

// Todo lo que la reunión dejó, en pestañas. La transcripción va entera: es el
// registro, y consultarlo es justo para lo que se guardó.
function pintarExpediente(caja, reunion) {
  caja.innerHTML = "";
  const m = reunion.minuta ?? {};

  const paginas = [];
  const contenido = document.createElement("div");
  contenido.className = "expediente-contenido";

  const anadir = (nombre, pintar) => paginas.push({ nombre, pintar });

  anadir("Minuta", caja2 => {
    const trozos = [];
    if (m.resumen) trozos.push(["Resumen ejecutivo", [m.resumen]]);
    const listas = {
      "Decisiones": m.decisiones, "Acuerdos": m.acuerdos, "Desacuerdos": m.desacuerdos,
      "Conceptos": m.conceptos, "Ideas": m.ideas, "Problemas": m.problemas,
      "Pendientes": m.pendientes, "Próximos pasos": m.proximos_pasos
    };
    for (const [titulo, items] of Object.entries(listas)) if (items?.length) trozos.push([titulo, items]);
    if (!trozos.length && !m.acciones?.length) {
      caja2.innerHTML = "<p>Esta reunión no tiene minuta redactada.</p>";
      return;
    }
    for (const [titulo, items] of trozos) {
      const h = document.createElement("h4");
      h.textContent = titulo;
      const ul = document.createElement("ul");
      for (const i of items) { const li = document.createElement("li"); li.textContent = i; ul.append(li); }
      caja2.append(h, ul);
    }
    if (m.acciones?.length) {
      const h = document.createElement("h4");
      h.textContent = "Acciones";
      const tabla = document.createElement("table");
      tabla.className = "expediente-tabla";
      tabla.innerHTML = "<thead><tr><th>Acción</th><th>Responsable</th><th>Fecha</th><th>Estado</th></tr></thead>";
      const cuerpo = document.createElement("tbody");
      for (const a of m.acciones) {
        const fila = document.createElement("tr");
        for (const celda of [a.accion, a.responsable, a.fecha, a.estado]) {
          const td = document.createElement("td");
          td.textContent = celda;
          fila.append(td);
        }
        cuerpo.append(fila);
      }
      tabla.append(cuerpo);
      caja2.append(h, tabla);
    }
  });

  anadir("Transcripción", caja2 => {
    const texto = String(reunion.transcripcion || "").trim();
    const pre = document.createElement("pre");
    pre.className = "expediente-texto";
    pre.textContent = texto || "No quedó transcripción de esta reunión.";
    caja2.append(pre);
  });

  if (String(reunion.cuaderno || "").trim()) {
    anadir("Notas", caja2 => {
      const pre = document.createElement("pre");
      pre.className = "expediente-texto";
      pre.textContent = reunion.cuaderno.trim();
      caja2.append(pre);
    });
  }

  if ((reunion.documentos ?? []).length) {
    anadir(`Documentos (${reunion.documentos.length})`, caja2 => {
      for (const d of reunion.documentos) {
        const h = document.createElement("h4");
        h.textContent = d.nombre + (d.descripcion ? ` — ${d.descripcion}` : "");
        const pre = document.createElement("pre");
        pre.className = "expediente-texto";
        pre.textContent = String(d.texto || "").trim() || "No se pudo extraer texto de este archivo.";
        caja2.append(h, pre);
      }
    });
  }

  if ((reunion.drive ?? []).length) {
    anadir("En Drive", caja2 => {
      for (const a of reunion.drive) {
        const enlace = document.createElement("a");
        enlace.className = "cierre-archivo";
        enlace.href = a.enlace;
        enlace.target = "_blank";
        enlace.rel = "noopener noreferrer";
        enlace.textContent = a.nombre;
        caja2.append(enlace);
      }
    });
  }

  const pestanas = document.createElement("div");
  pestanas.className = "expediente-pestanas";
  paginas.forEach((pagina, i) => {
    const boton = document.createElement("button");
    boton.textContent = pagina.nombre;
    boton.setAttribute("aria-pressed", String(i === 0));
    boton.addEventListener("click", () => {
      [...pestanas.children].forEach(b => b.setAttribute("aria-pressed", String(b === boton)));
      contenido.innerHTML = "";
      pagina.pintar(contenido);
    });
    pestanas.append(boton);
  });

  caja.append(pestanas, contenido);
  paginas[0]?.pintar(contenido);
}

// ── Notas y documentos ───────────────────────────────────────────────────────

// Un único campo de texto para las tres cosas que hay que escribir: la nota, la
// descripción de un documento y el título al cerrar. Tres campos permanentes en
// una tira que tiene que caber sobre una videollamada no cabían.
function abrirCampo(cual, titulo, valor = "", marcador = "") {
  campoAbierto = cual;
  ui.reunionCampoTitulo.textContent = titulo;
  ui.reunionEntrada.value = valor;
  ui.reunionEntrada.placeholder = marcador;
  ui.reunionCampo.hidden = false;
  ui.reunionEntrada.focus();
}

function cerrarCampo() {
  campoAbierto = "";
  documentoPendiente = null;
  if (ui.reunionCampo) ui.reunionCampo.hidden = true;
}

// Cancelar descarta ese archivo, no los que vengan detrás: si se han soltado
// cinco y el segundo no se puede leer, los otros tres siguen su camino.
function descartarCampo() {
  const eraDocumento = campoAbierto === "documento";
  const descartado = documentoPendiente?.nombre;
  cerrarCampo();
  if (!eraDocumento) return;
  if (descartado) eco(`Descarté «${descartado}».`);
  seguirConLosArchivos();
}

function aceptarCampo() {
  const valor = ui.reunionEntrada.value.trim();

  if (campoAbierto === "documento") {
    const documento = documentoPendiente;
    cerrarCampo();
    if (documento) {
      memoria.anotarDocumento({ ...documento, descripcion: valor });
      eco(`Añadido «${documento.nombre}»${valor ? ` — ${valor}` : ""}.`);
      apuntarBorrador();
      refrescarCuenta();
    }
    seguirConLosArchivos();
    return;
  }

  if (campoAbierto === "titulo") {
    memoria.titulo = valor;
    cerrarCampo();
    cerrarLaReunion();
  }
}

// El cuaderno se abre y se cierra; no se «guarda una nota». Lo que hay escrito
// sigue ahí al volver, que es como funciona un cuaderno y como QA pidió que
// funcionara esto: abrir, escribir, cerrar, seguir la reunión, volver a abrir y
// encontrarlo todo.
function alternarCuaderno(abrir) {
  if (!enModoMeet || !ui.reunionCuaderno) return;
  const abierto = abrir ?? ui.reunionCuaderno.hidden;
  if (abierto) {
    cerrarCampo();
    ui.reunionNotas.value = memoria.cuaderno;
    ui.reunionCuaderno.hidden = false;
    ui.reunionNota.setAttribute("aria-pressed", "true");
    ui.reunionNotas.focus();
    // El cursor al final: quien reabre el cuaderno viene a añadir debajo, no a
    // reescribir desde el principio.
    ui.reunionNotas.setSelectionRange(ui.reunionNotas.value.length, ui.reunionNotas.value.length);
  } else {
    guardarCuaderno();
    ui.reunionCuaderno.hidden = true;
    ui.reunionNota.setAttribute("aria-pressed", "false");
    const lineas = memoria.lineasDeCuaderno();
    eco(lineas ? `Cuaderno guardado: ${lineas} nota${lineas === 1 ? "" : "s"}.` : "Sigo escuchando.");
  }
}

// Se guarda en cada tecla, no sólo al cerrar: si el navegador se recarga en
// mitad de una reunión, lo escrito no se pierde por no haber pulsado nada.
function guardarCuaderno() {
  if (!ui.reunionNotas) return;
  memoria.escribirCuaderno(ui.reunionNotas.value);
  apuntarBorrador();
  refrescarCuenta();
}

async function recibirArchivos(archivos) {
  colaDeArchivos.push(...archivos);
  await seguirConLosArchivos();
}

// Se procesan de uno en uno y la cola sobrevive a la pausa que abre el campo de
// descripción. Antes se recorrían en un bucle y el primero que no se podía leer
// se llevaba por delante a los demás sin decir nada.
async function seguirConLosArchivos() {
  while (colaDeArchivos.length) {
    const archivo = colaDeArchivos.shift();
    eco(`Leyendo «${archivo.name}»…`);
    const leido = await leerDocumento(archivo);

    // Con texto dentro, la descripción es opcional y no se interrumpe la
    // reunión por ella. Sin texto se pide, porque es lo único que va a quedar
    // de ese archivo en la minuta.
    if (leido.texto) {
      // Antes de empezar se guardan aparte; entran a la reunión al iniciarla.
      if (preparando) {
        documentosPrevios.push({ ...leido, descripcion: "" });
        refrescarAdjuntosPrevios();
        continue;
      }
      memoria.anotarDocumento({ ...leido, descripcion: "" });
      eco(`Añadido «${leido.nombre}» (${leido.texto.length} caracteres de texto).`);
      apuntarBorrador();
      refrescarCuenta();
      continue;
    }

    documentoPendiente = leido;
    if (preparando) {
      // En la preparación no hay tira donde pedir la descripción; se guarda con
      // el aviso como descripción y se puede matizar durante la reunión.
      documentosPrevios.push({ ...leido, descripcion: "" });
      documentoPendiente = null;
      refrescarAdjuntosPrevios();
      continue;
    }
    abrirCampo("documento", `¿De qué trata «${leido.nombre}»?`, "", leido.aviso || "Descríbelo en una frase");
    eco(colaDeArchivos.length
      ? `${leido.aviso || "No se pudo leer el archivo."} Quedan ${colaDeArchivos.length} por añadir.`
      : (leido.aviso || "No se pudo leer el archivo."));
    return;
  }
}

// ── Cerrar la reunión ────────────────────────────────────────────────────────

function pedirCierre() {
  if (!enModoMeet) return;
  // Con la reunión ya cerrada el botón empieza otra: lo anterior queda en el
  // historial y se puede volver a él cuando se quiera.
  if (estadoReunion === ESTADOS.POSTERIOR) return empezarOtraReunion();
  guardarCuaderno();
  if (memoria.vacia()) {
    eco("La reunión está vacía: no hay nada que resumir todavía.");
    return;
  }
  abrirCampo("titulo", "Título de la reunión", memoria.titulo, "Comité de innovación clínica");
}

function empezarOtraReunion() {
  const anterior = reunionConsultable;
  memoria.abrir();
  reunionConsultable = null;
  if (ui.reunionQuien) ui.reunionQuien.value = "";
  if (ui.reunionNotas) ui.reunionNotas.value = "";
  ui.cierre.dataset.estado = "oculto";
  refrescarCuenta();

  try {
    if (sesion && !sesion.muted && typeof sesion.pausarEnvio === "function") {
      sesion.pausarEnvio(true);
      micCortadoPorMeet = true;
      ui.mute.textContent = "Activar micrófono";
    }
  } catch (error) {
    console.warn("No se pudo callar el micrófono del modelo:", error);
  }
  clearInterval(relojReunion);
  relojReunion = setInterval(vigilarLaReunion, 20_000);
  if (escuchaDisponible() && connected && escucha.empezar()) {
    fijarEstado(ESTADOS.ESCUCHANDO, anterior
      ? `Reunión nueva. La anterior («${anterior.titulo}») quedó en el historial.`
      : "Reunión nueva. Escuchando.");
    setStatus("En reunión");
  } else {
    fijarEstado(ESTADOS.ESCUCHANDO, "No se pudo reanudar la escucha.", "problema");
  }
  // Después de fijar el estado, no antes: los botones se dibujan según el
  // estado, y ajustarlos primero los dejaba con el rótulo de la reunión vieja.
  ajustarBotonesDeReunion();
}

async function cerrarLaReunion() {
  guardarCuaderno();
  alternarCuaderno(false);
  fijarEstado(ESTADOS.CERRANDO, "Redactando la transcripción y la minuta…");
  // Se corta la captura de la sala, no la sesión. La diferencia es todo el
  // punto: la reunión deja de grabarse pero sigue estando ahí para hablar de ella.
  escucha.parar();
  escucha.ensordecer(false);
  clearInterval(relojReunion);
  memoria.cerrar();
  mostrarCierre("Cerrando la reunión", "<p>Corrigiendo la transcripción y redactando la minuta. Tarda unos segundos.</p>");

  let datos;
  try {
    const respuesta = await fetch("/reunion/cerrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...memoria.paraEnviar(),
        carpetaDrive: carpetaDeDrive(),
        driveRefresco: permisoDeDrive()
      })
    });
    datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos?.error || `El servidor respondió ${respuesta.status}`);
  } catch (error) {
    console.error(error);
    // Se vuelve a escuchar: la reunión no se cerró, así que sigue en curso.
    memoria.abierta = true;
    fijarEstado(ESTADOS.ESCUCHANDO, "No se pudo cerrar la reunión, sigo escuchando.", "problema");
    if (escuchaDisponible() && connected) escucha.empezar();
    relojReunion = setInterval(refrescarCuenta, 20_000);
    mostrarCierre("No se pudo cerrar", `<p class="cierre-aviso">${escaparHtml(error.message)}</p>`
      + "<p>La reunión sigue en memoria y se sigue transcribiendo: vuelve a pulsar «Finalizar reunión» para intentarlo otra vez.</p>");
    return;
  }

  // La integridad se comprueba con lo que sabe el navegador además de lo que
  // dice el servidor: si la escucha nunca arrancó o se quedó sorda, el servidor
  // no puede saberlo —a él le llega una reunión sin turnos y no distingue «no
  // habló nadie» de «no se capturó nada»—.
  const captura = escucha.diagnostico();
  const integridad = {
    ...datos.integridad,
    comprobaciones: [
      {
        nombre: "Audio procesado",
        critico: true,
        ok: captura.arrancoAlgunaVez && captura.frases > 0,
        detalle: !captura.arrancoAlgunaVez
          ? (captura.ultimoFallo || "El reconocimiento de voz nunca llegó a arrancar")
          : (captura.frases
            ? `${captura.frases} frases oídas${captura.rearranques ? `, ${captura.rearranques} cortes` : ""}`
            : `Arrancó pero no oyó nada${captura.ultimoFallo ? `: ${captura.ultimoFallo}` : ""}`)
      },
      {
        nombre: "Transcripción persistida",
        // Sin nada capturado no hay nada que persistir: decir que falló sería
        // acusar al almacén de un fallo que fue de la escucha.
        critico: memoria.turnos.length > 0,
        ok: ultimoBorrador.ok || memoria.turnos.length === 0,
        detalle: ultimoBorrador.ok
          ? `Guardada durante la reunión (${ultimoBorrador.frases} frases)`
          : (memoria.turnos.length === 0 ? "No había nada que guardar" : "No se pudo guardar durante la reunión")
      },
      ...(datos.integridad?.comprobaciones ?? [])
    ]
  };
  integridad.fallosCriticos = integridad.comprobaciones.filter(c => c.critico && !c.ok)
    .map(c => `${c.nombre}: ${c.detalle}`);
  integridad.ok = integridad.fallosCriticos.length === 0;

  // La reunión pasa a ser un objeto consultable.
  const registro = memoria.registroCompleto(datos);
  registro.integridad = integridad;
  reunionConsultable = registro;

  // Primero se devuelve la voz y se pinta el resultado; el historial se guarda
  // después y sin bloquear. El orden importa: si se esperaba al guardado y el
  // navegador no dejaba escribir —ventana privada, almacenamiento bloqueado—,
  // la promesa no resolvía nunca y el cierre se quedaba colgado en «Cerrando la
  // reunión» con el micrófono todavía cortado. Guardar el historial no puede
  // ser lo que impida volver a hablar.
  pintarCierre(datos, integridad);
  entrarEnPosterior(registro, integridad);

  // Copia en la carpeta del equipo, si hay una elegida. Va después de pintar y
  // de devolver la voz: es un archivado, no puede retrasar el cierre.
  archivarEnLaCarpeta(datos, registro);

  guardarReunion(registro).then(guardado => {
    anotarElHistorial(guardado);
    // El borrador sólo se descarta cuando la reunión está a salvo en el
    // historial. Borrarlo antes sería tirar la única copia que quedaba.
    if (guardado.ok && integridad.ok) olvidarBorrador(memoria.id);
  });
}

// Escribe los dos documentos y la reunión entera en la carpeta elegida.
//
// El JSON no es un extra: es lo que permite recuperar la reunión en otro equipo.
// Si la carpeta está dentro de Google Drive o iCloud, esa copia se sincroniza
// sola y el historial deja de vivir en un solo navegador.
async function archivarEnLaCarpeta(datos, registro) {
  const hueco = ui.cierreCuerpo?.querySelector("#cierreCarpeta");
  const carpeta = await carpetaGuardada();
  if (!carpeta) { if (hueco) hueco.closest(".cierre-bloque")?.remove(); return; }

  const permiso = await permisoDeCarpeta(carpeta);
  if (permiso !== "si") {
    if (!hueco) return;
    hueco.textContent = `El navegador pide permiso otra vez para escribir en «${carpeta.name}».`;
    hueco.className = "cierre-aviso";
    // Pedirlo exige que la persona acabe de pulsar algo: por eso un botón y no
    // un intento a ciegas que el navegador rechazaría.
    const boton = document.createElement("button");
    boton.className = "cierre-enviar";
    boton.textContent = `Guardar en «${carpeta.name}»`;
    boton.addEventListener("click", async () => {
      if (await permisoDeCarpeta(carpeta, true) !== "si") return;
      boton.remove();
      await escribirTodo(carpeta, datos, registro, hueco);
    });
    hueco.after(boton);
    return;
  }
  await escribirTodo(carpeta, datos, registro, hueco);
}

async function escribirTodo(carpeta, datos, registro, hueco) {
  const bytes = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const escritos = await Promise.all([
    escribirEnCarpeta(carpeta, datos.archivos.transcripcion.nombre, bytes(datos.archivos.transcripcion.base64)),
    escribirEnCarpeta(carpeta, datos.archivos.minuta.nombre, bytes(datos.archivos.minuta.base64)),
    escribirEnCarpeta(carpeta, `Reunion_${registro.id}.json`, JSON.stringify(registro, null, 2))
  ]);
  if (!hueco) return;
  const fallaron = escritos.filter(e => !e.ok);
  hueco.textContent = fallaron.length
    ? `No se pudo escribir en «${carpeta.name}»: ${fallaron[0].error}`
    : `Guardado en «${carpeta.name}»: los dos documentos y una copia de la reunión para poder recuperarla.`;
  hueco.className = fallaron.length ? "cierre-aviso" : "cierre-ok";
}

// El aviso del historial se rellena cuando el guardado termina, sea como sea.
function anotarElHistorial(guardado) {
  const hueco = ui.cierreCuerpo?.querySelector("#cierreHistorial");
  if (!hueco) return;
  hueco.textContent = guardado.ok
    ? "La reunión quedó guardada en este navegador: puedes volver a ella desde «Reuniones anteriores», "
      + "preguntarle a Catalina sobre lo que se dijo, o usarla como antecedente de una reunión de seguimiento."
    : "No se pudo guardar en el historial de este navegador, así que esta reunión no quedará para consultarla "
      + "mañana. Los archivos sí están, y puedes seguir preguntando por ella mientras no cierres la pestaña.";
  hueco.className = guardado.ok ? "" : "cierre-aviso";
}

// Después de la reunión.
//
// Esto es lo que faltaba y lo que dejaba la voz muerta: al cerrar se paraba la
// escucha de la sala pero NUNCA se devolvía el micrófono al modelo, que seguía
// cortado desde que se entró en modo reunión. El resultado era una pantalla que
// decía «Escuchando» sin que escuchara nadie, ni el navegador ni ella.
function entrarEnPosterior(registro, integridad = { ok: true, fallosCriticos: [] }) {
  fijarEstado(ESTADOS.POSTERIOR, integridad.ok
    ? "Reunión cerrada. Pregúntame lo que quieras sobre ella."
    : "Reunión cerrada con problemas. Mira la pantalla antes de darla por buena.",
    integridad.ok ? "" : "problema");
  setStatus("Reunión cerrada");
  ajustarBotonesDeReunion();

  // El micrófono vuelve al modelo: a partir de aquí es una conversación normal.
  try {
    if (micCortadoPorMeet && sesion?.muted && typeof sesion.pausarEnvio === "function") {
      sesion.pausarEnvio(false);
      ui.mute.textContent = "Silenciar micrófono";
    }
  } catch (error) {
    console.warn("No se pudo devolver el micrófono:", error);
  }
  micCortadoPorMeet = false;

  // Y se le entrega la reunión entera, para que conteste sobre ella sin tener
  // que ir a buscarla. Lo que no cabe aquí lo puede pedir con consultar_reunion.
  avisarAlAgente([
    integridad.ok
      ? "[Aviso del sistema] La reunión terminó bien. La transcripción y la minuta ya están listas y en pantalla."
      : "[Aviso del sistema] La reunión terminó CON PROBLEMAS y NO debes decir que salió bien. "
        + `Lo que falló: ${integridad.fallosCriticos.join("; ")}. Dilo con esas palabras y di que se puede reintentar el procesamiento desde la pantalla.`,
    registro.drive?.length ? "Quedaron guardadas en Google Drive." : "No se guardaron en Drive.",
    "",
    "A partir de ahora estás en conversación normal y esta reunión es tu contexto. Puedes responder",
    "cualquier pregunta sobre ella: acuerdos, decisiones, pendientes, quién dijo qué, qué documentos se usaron.",
    "Si te preguntan algo que no está aquí, usa consultar_reunion para ver el detalle completo.",
    "",
    "AHORA, en voz alta y en dos frases: di que la minuta está lista, cuántos acuerdos y cuántas acciones",
    "salieron, y ofrécete a responder preguntas sobre la reunión.",
    "",
    "=== LA REUNIÓN ===",
    memoria.contextoPosterior(registro)
  ].join("\n"));
}

// ── La tarjeta de cierre ─────────────────────────────────────────────────────

const escaparHtml = texto => String(texto ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function mostrarCierre(titulo, html) {
  if (!ui.cierre) return;
  ui.cierreTitulo.textContent = titulo;
  ui.cierreCuerpo.innerHTML = html;
  ui.cierre.dataset.estado = "visible";
}

// Los archivos llegan en base64 y se convierten aquí en descargas de verdad. No
// se piden otra vez al servidor: ya están, y volver a generarlos daría dos
// minutas distintas para la misma reunión.
function enlaceDeDescarga(archivo) {
  const bytes = Uint8Array.from(atob(archivo.base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: archivo.tipo }));
  const enlace = document.createElement("a");
  enlace.className = "cierre-archivo";
  enlace.href = url;
  enlace.download = archivo.nombre;
  enlace.textContent = archivo.nombre;
  return enlace;
}

function pintarCierre(datos, integridad = { ok: true, comprobaciones: [], fallosCriticos: [] }) {
  mostrarCierre(integridad.ok ? "Reunión cerrada" : "Reunión cerrada con problemas", "");
  const cuerpo = ui.cierreCuerpo;

  const bloque = (titulo, ...hijos) => {
    const seccion = document.createElement("div");
    seccion.className = "cierre-bloque";
    if (titulo) {
      const h = document.createElement("h3");
      h.textContent = titulo;
      seccion.append(h);
    }
    seccion.append(...hijos);
    cuerpo.append(seccion);
    return seccion;
  };

  const parrafo = (texto, clase = "") => {
    const p = document.createElement("p");
    if (clase) p.className = clase;
    p.textContent = texto;
    return p;
  };

  // 1. La verificación. Va primero a propósito: si falta la transcripción, eso
  // es lo que hay que leer antes que ninguna otra cosa, no un enlace de descarga
  // a un documento incompleto.
  if (integridad.comprobaciones?.length) {
    const lista = document.createElement("ul");
    lista.className = "verificacion";
    for (const c of integridad.comprobaciones) {
      const li = document.createElement("li");
      li.dataset.estado = c.ok ? "bien" : (c.critico ? "mal" : "aviso");
      li.innerHTML = `<span class="verificacion-marca">${c.ok ? "✓" : (c.critico ? "✕" : "!")}</span>`
        + `<span>${escaparHtml(c.nombre)}</span><em>${escaparHtml(c.detalle || "")}</em>`;
      lista.append(li);
    }
    const seccion = bloque("Verificación", lista);

    if (!integridad.ok) {
      seccion.prepend(parrafo("Falta algo esencial, así que esta reunión NO está completa. "
        + "Lo capturado sigue guardado: puedes reintentar el procesamiento sin perderlo.", "cierre-aviso"));
      const reintentar = document.createElement("button");
      reintentar.className = "cierre-enviar";
      reintentar.textContent = "Reintentar el procesamiento";
      reintentar.addEventListener("click", async () => {
        reintentar.disabled = true;
        reintentar.textContent = "Reintentando…";
        // La reunión se reabre para volver a cerrarla: los turnos, las notas y
        // los documentos siguen en memoria y en el borrador.
        memoria.abierta = true;
        await cerrarLaReunion();
      });
      seccion.append(reintentar);
    }
  }

  // 2. Los documentos.
  const archivos = document.createElement("div");
  archivos.className = "cierre-archivos";
  archivos.append(enlaceDeDescarga(datos.archivos.transcripcion), enlaceDeDescarga(datos.archivos.minuta));
  bloque("Documentos", archivos);

  // 3. Dónde quedaron guardados. Se dice siempre, también cuando no se guardó:
  // dar por hecho que está en Drive cuando no lo está es el fallo caro.
  if (datos.drive?.ok) {
    const guardado = bloque("Guardado en Drive", parrafo("Los dos archivos quedaron en la carpeta configurada.", "cierre-ok"));
    for (const archivo of datos.drive.archivos ?? []) {
      if (!archivo.enlace) continue;
      const enlace = document.createElement("a");
      enlace.className = "cierre-archivo";
      enlace.href = archivo.enlace;
      enlace.target = "_blank";
      enlace.rel = "noopener noreferrer";
      enlace.textContent = `Abrir ${archivo.nombre}`;
      guardado.append(enlace);
    }
  } else if (["SIN_CUENTA", "SIN_CLIENTE", "SIN_CONFIGURAR"].includes(datos.drive?.code)) {
    // Drive por internet es una de tres vías, y la más opcional. Si ya se
    // archiva por carpeta o por correo, reclamarlo aquí sería insistir con algo
    // que quien lo montó decidió no usar.
    if (!hayOtroArchivo()) {
      bloque("Guardado en Drive", parrafo("No hay ninguna cuenta de Google conectada: descarga los archivos desde aquí. "
        + "Para que se guarden solos, elige una carpeta o pon tu correo en /reunion.html.", "cierre-aviso"));
    }
  } else {
    bloque("Guardado en Drive", parrafo(datos.drive?.error || "No se pudieron guardar en Drive.", "cierre-aviso"));
  }

  // 4. La carpeta del equipo, si la hay.
  if (carpetaDisponible()) {
    const avisoCarpeta = parrafo("Guardando en tu carpeta…");
    avisoCarpeta.id = "cierreCarpeta";
    bloque("En tu carpeta", avisoCarpeta);
  }

  // 5. El historial. Se dice que quedó guardada porque es lo que permite volver
  // a preguntar por ella mañana, no sólo hoy.
  const avisoHistorial = parrafo("Guardando en el historial…");
  avisoHistorial.id = "cierreHistorial";
  bloque("Historial", avisoHistorial);

  // 6. Lo que no salió como debía.
  for (const aviso of datos.avisos ?? []) bloque("", parrafo(aviso, "cierre-aviso"));

  // 7a. Copia a tu propio correo, si la pediste. Sale sola: no es una acción
  // externa, es archivarte a ti mismo lo que ya tienes delante.
  const mio = miCorreo();
  if (mio) {
    const aviso = parrafo(`Mandándote copia a ${mio}…`);
    bloque("Copia para ti", aviso);
    fetch("/reunion/correo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmado: true,
        destinatario: mio,
        asunto: datos.correo.asunto,
        cuerpo: datos.correo.cuerpo,
        adjuntos: [
          { nombre: datos.archivos.transcripcion.nombre, base64: datos.archivos.transcripcion.base64 },
          { nombre: datos.archivos.minuta.nombre, base64: datos.archivos.minuta.base64 }
        ]
      })
    })
      .then(r => r.json())
      .then(r => {
        aviso.textContent = r.ok ? `Copia enviada a ${mio}.` : `No se pudo mandarte la copia: ${r.error}`;
        aviso.className = r.ok ? "cierre-ok" : "cierre-aviso";
      })
      .catch(error => {
        aviso.textContent = `No se pudo mandarte la copia: ${error.message}`;
        aviso.className = "cierre-aviso";
      });
  }

  // 7b. El correo a otros. Se propone entero y no se manda: archivarte a ti es
  // reversible, mandarle la reunión a un tercero no lo es.
  const correo = document.createElement("form");
  correo.className = "cierre-correo";
  correo.innerHTML = `
    <label for="correoPara">Para</label>
    <input id="correoPara" type="email" required value="${escaparHtml(datos.correo.destinatario)}"
           placeholder="nombre@ejemplo.cl" autocomplete="off">
    <label for="correoAsunto">Asunto</label>
    <input id="correoAsunto" value="${escaparHtml(datos.correo.asunto)}" autocomplete="off">
    <label for="correoCuerpo">Mensaje</label>
    <textarea id="correoCuerpo">${escaparHtml(datos.correo.cuerpo)}</textarea>`;

  const adjuntos = parrafo(`Se adjuntan: ${datos.correo.adjuntos.join(" y ")}.`);
  const boton = document.createElement("button");
  boton.type = "submit";
  boton.className = "cierre-enviar";
  boton.textContent = "Revisar y enviar";
  const resultado = parrafo("");
  correo.append(adjuntos, boton, resultado);

  let confirmado = false;
  correo.addEventListener("submit", async evento => {
    evento.preventDefault();
    const para = correo.querySelector("#correoPara").value.trim();
    if (!para) { resultado.textContent = "Falta el destinatario."; resultado.className = "cierre-aviso"; return; }

    // Dos pasos a propósito. El primero enseña a quién se le va a mandar; el
    // segundo lo manda. Un solo botón convertía un envío a un tercero en un
    // clic distraído.
    if (!confirmado) {
      confirmado = true;
      boton.textContent = `Confirmar envío a ${para}`;
      resultado.textContent = "Revisa el destinatario, el asunto y el mensaje. Pulsa otra vez para enviarlo.";
      resultado.className = "";
      return;
    }

    boton.disabled = true;
    boton.textContent = "Enviando…";
    try {
      const respuesta = await fetch("/reunion/correo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmado: true,
          destinatario: para,
          asunto: correo.querySelector("#correoAsunto").value,
          cuerpo: correo.querySelector("#correoCuerpo").value,
          adjuntos: [
            { nombre: datos.archivos.transcripcion.nombre, base64: datos.archivos.transcripcion.base64 },
            { nombre: datos.archivos.minuta.nombre, base64: datos.archivos.minuta.base64 }
          ]
        })
      });
      const cuerpoRespuesta = await respuesta.json();
      if (!respuesta.ok || !cuerpoRespuesta.ok) throw new Error(cuerpoRespuesta.error || `El servidor respondió ${respuesta.status}`);
      resultado.textContent = `Enviado a ${para}.`;
      resultado.className = "cierre-ok";
      boton.textContent = "Enviado";
    } catch (error) {
      resultado.textContent = error.message;
      resultado.className = "cierre-aviso";
      boton.disabled = false;
      boton.textContent = `Confirmar envío a ${para}`;
    }
  });

  bloque("Enviar por correo", correo);
}


// ── Lo que Catalina puede hacer en la reunión por su cuenta ──────────────────
//
// Las cuatro cosas de la tira, pero pedidas de viva voz: «Catalina, toma nota
// de que…», «habla Marcela», «¿qué llevamos?», «cierra la reunión». Son
// herramientas de cliente: se resuelven aquí, en el navegador, porque la
// memoria de la reunión vive aquí y no en el servidor.

function anotarEnLaReunion({ texto } = {}) {
  if (!enModoMeet || !memoria.abierta) return { ok: false, error: "No hay ninguna reunión en curso." };
  const nota = memoria.anotarNota(texto);
  if (!nota) return { ok: false, error: "La nota venía vacía." };
  // Si el cuaderno está abierto se refleja al momento: ver aparecer la línea es
  // la única prueba de que la anotó.
  if (ui.reunionNotas && !ui.reunionCuaderno.hidden) ui.reunionNotas.value = memoria.cuaderno;
  eco(`Anotado: «${nota}»`);
  apuntarBorrador();
  refrescarCuenta();
  return { ok: true, anotado: nota, total: memoria.lineasDeCuaderno() };
}

function registrarHablante({ nombre } = {}) {
  if (!enModoMeet || !memoria.abierta) return { ok: false, error: "No hay ninguna reunión en curso." };
  const puesto = memoria.fijarHablante(nombre);
  if (!puesto) return { ok: false, error: "No entendí el nombre." };
  if (ui.reunionQuien) ui.reunionQuien.value = puesto;
  eco(`Ahora atribuyo lo que se diga a ${puesto}.`);
  apuntarBorrador();
  return { ok: true, hablante: puesto, participantes: memoria.participantes() };
}

// Para que pueda contestar «¿qué llevamos acordado?» sin que se le mande la
// reunión entera cada vez.
function contarEstadoDeLaReunion() {
  if (enModoMeet && memoria.abierta) {
    return {
      ok: true,
      enCurso: true,
      minutos: memoria.minutosTranscurridos(),
      participantes: memoria.participantes(),
      intervenciones: memoria.turnos.length,
      documentos: memoria.documentos.map(d => d.nombre),
      cuaderno: memoria.cuaderno,
      estado: memoria.resumenVivo(20)
    };
  }
  // Ya cerrada: se contesta con la que está cargada en vez de decir que no hay
  // ninguna. Es justo el caso que dejaba a Catalina muda después del cierre.
  if (reunionConsultable) {
    const m = reunionConsultable.minuta ?? {};
    return {
      ok: true,
      enCurso: false,
      titulo: reunionConsultable.titulo,
      participantes: reunionConsultable.participantes,
      resumen: m.resumen || "",
      acuerdos: m.acuerdos ?? [],
      decisiones: m.decisiones ?? [],
      acciones: m.acciones ?? [],
      pendientes: m.pendientes ?? []
    };
  }
  return { ok: false, error: "No hay ninguna reunión en curso ni cargada." };
}

// El detalle completo de la reunión cargada: la transcripción, los documentos y
// las notas. Es lo que le permite contestar «¿qué dijo Juan del presupuesto?»
// en vez de quedarse en lo que cupo en el resumen.
function consultarLaReunion({ sobre } = {}) {
  if (!reunionConsultable) {
    return {
      ok: false,
      error: enModoMeet && memoria.abierta
        ? "La reunión sigue en curso; usa estado_de_la_reunion."
        : "No hay ninguna reunión cargada. Se puede abrir una desde «Reuniones anteriores»."
    };
  }
  return {
    ok: true,
    sobre: sobre || "",
    titulo: reunionConsultable.titulo,
    fecha: new Date(reunionConsultable.inicio).toLocaleDateString("es-CL"),
    detalle: memoria.contextoPosterior(reunionConsultable),
    documentos: (reunionConsultable.documentos ?? []).map(d => ({
      nombre: d.nombre,
      descripcion: d.descripcion || "",
      // Un trozo de cada uno: el documento entero podría no caber en la respuesta.
      extracto: String(d.texto || "").slice(0, 4000)
    }))
  };
}

async function finalizarPorVoz({ titulo, enviar_a: enviarA } = {}) {
  if (!enModoMeet || !memoria.abierta) return { ok: false, error: "No hay ninguna reunión en curso." };
  guardarCuaderno();
  if (memoria.vacia()) return { ok: false, error: "La reunión está vacía: no hay nada que resumir." };
  if (titulo) memoria.titulo = String(titulo).trim();
  // El destinatario sólo se apunta: el correo sigue necesitando que alguien lo
  // confirme en pantalla. Mandar la reunión a un tercero no es una acción que
  // pueda desencadenar una frase suelta dicha en una sala.
  if (enviarA) memoria.destinatario = String(enviarA).trim();
  cerrarCampo();
  await cerrarLaReunion();
  return {
    ok: true,
    documentos: "listos",
    correo: memoria.destinatario
      ? `Propuesto para ${memoria.destinatario}, a la espera de que lo confirmen en pantalla.`
      : "No se envió: hay que indicar el destinatario y confirmarlo en pantalla."
  };
}

// Herramientas de docencia.
//
// Las pide Catalina, no la interfaz: están declaradas en los dos proveedores y
// el modelo decide cuándo usarlas. Ninguna inventa nada — una recupera láminas
// ya publicadas, la otra referencias de PubMed—, y lo que se devuelve al modelo
// es deliberadamente escueto para que comente lo que se ve sin releerlo.
// Lo último que se mostró en pantalla. El correo lo adjunta sin que el modelo
// tenga que repetirlo: ya lo tenemos aquí, y hacérselo dictar de nuevo sería
// pedirle que reconstruya de memoria algo que puede recordar mal.
let laminaEnPantalla = null;
let referenciasEnPantalla = [];
// El panel llega colapsado: se muestran las más relevantes y se guarda la lista
// entera para poder ampliarla, reordenándola entonces por factor de impacto.
let referenciasTotal = 0;
let referenciasTitulo = "Referencias";
let referenciasAmpliable = false;
let referenciasExpandido = false;
const REFERENCIAS_COLAPSADAS = 8;

async function atenderHerramienta(nombre, argumentos) {
  // Gesto de espera: mientras la herramienta corre —una búsqueda tarda unos
  // segundos— la cara pasa a pensar en vez de quedarse congelada. La voz de la
  // espera la pone el agente (pre_tool_speech en el registro); esto es el gesto.
  director.setState("thinking");
  director.setExpression("concentracion", .6);
  try {
    return await despacharHerramienta(nombre, argumentos);
  } finally {
    // Si tras la herramienta no llegó a hablar, se vuelve a escuchar en vez de
    // quedarse pensando para siempre. Si sí habla, su audio ya puso "speaking".
    setTimeout(() => {
      if (director.state === "thinking") {
        director.setState(connected ? (faseDeSesion || "listening") : "idle");
        director.setExpression("neutra");
      }
    }, 600);
  }
}

async function despacharHerramienta(nombre, argumentos) {
  if (nombre === "buscar_imagen_medica") return await pedirLamina(argumentos);
  if (nombre === "buscar_referencias") return await pedirReferencias(argumentos);
  if (nombre === "enviar_resumen") return await enviarResumen(argumentos);
  if (nombre === "buscar_salud_cerca") return await buscarSaludCerca(argumentos);
  if (nombre === "llamar_por_telefono") return await llamarPorTelefono(argumentos);
  if (nombre === "consultar_llamada") return await consultarLlamada(argumentos);
  if (nombre === "como_llegar") return await comoLlegar(argumentos);
  if (nombre === "buscar_en_la_web") return await buscarWeb(argumentos);
  if (nombre === "leer_pagina_web") return await leerPaginaWeb(argumentos);
  if (nombre === "generar_imagen") return await generarImagen(argumentos);
  if (nombre === "buscar_imagenes") return await buscarImagenes(argumentos);
  if (nombre === "buscar_imagenes_web") return await buscarImagenesWeb(argumentos);
  if (nombre === "fuentes_clinicas") return await pedirFuentesClinicas(argumentos);
  if (nombre === "buscar_videos") return await buscarVideos(argumentos);
  if (nombre === "tomar_nota") return anotarEnLaReunion(argumentos);
  if (nombre === "quien_habla") return registrarHablante(argumentos);
  if (nombre === "estado_de_la_reunion") return contarEstadoDeLaReunion();
  if (nombre === "consultar_reunion") return consultarLaReunion(argumentos);
  if (nombre === "finalizar_reunion") return await finalizarPorVoz(argumentos);
  // Cualquier otro nombre viene de un conector definido en el administrador.
  // Se manda el nombre, no la dirección: el servidor la resuelve.
  return await usarConector(nombre, argumentos);
}

async function enviarResumen(argumentos) {
  const titulo = String(argumentos.titulo || "").trim();
  const resumen = String(argumentos.resumen || "").trim();
  if (!titulo || !resumen) return { ok: false, error: "Falta el título o el resumen" };

  setStatus("Enviando el resumen…");
  try {
    const respuesta = await fetch("/correo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo, resumen,
        lamina: laminaEnPantalla,
        referencias: referenciasEnPantalla
      })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.ok) {
      setStatus("No se pudo enviar el correo");
      return { ok: false, error: datos.error || "No se pudo enviar el correo" };
    }
    setStatus("Resumen enviado");
    return { ok: true, enviado: true, destinatario: datos.destinatario };
  } catch (error) {
    console.error(error);
    setStatus("No se pudo enviar el correo");
    return { ok: false, error: "Falló la conexión al enviar el correo" };
  }
}

// Ubicación del dispositivo. Se pide sólo cuando hace falta —al buscar una
// farmacia de turno—, no al arrancar: un permiso de geolocalización pedido sin
// motivo se deniega, y luego ya no se puede volver a pedir.
function ubicacionActual() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolver => {
    navigator.geolocation.getCurrentPosition(
      posicion => resolver({ lat: posicion.coords.latitude, lon: posicion.coords.longitude }),
      // Si lo deniegan o tarda, se sigue con la comuna que haya dicho la
      // persona: quedarse sin responder sería peor.
      () => resolver(null),
      // Cuatro segundos, no ocho: esta espera va antes de la búsqueda y se suma
      // a ella, así que ocho segundos de GPS lento eran ocho segundos callada
      // antes siquiera de empezar a buscar.
      { timeout: 4000, maximumAge: 300000 }
    );
  });
}

// Se pide la ubicación en cuanto arranca la conversación, no cuando hace falta.
// Con `maximumAge` la respuesta queda disponible durante cinco minutos, así que
// la primera búsqueda ya no paga el permiso ni el arranque del GPS.
//
// Y con ella se dejan pedidas al servidor las consultas de la zona: la caché de
// /salud dura un día, y quien paga la primera espera deja de ser la persona que
// preguntó. Va todo en segundo plano; si falla, no se avisa de nada, porque no
// se ha pedido nada todavía.
function calentarUbicacion() {
  ubicacionActual().then(ubicacion => {
    if (!ubicacion) return;
    ubicacionConocida = ubicacion;
    // De uno en uno, no los tres a la vez: son consultas pesadas contra un
    // servicio comunitario, y aquí no corre prisa ninguna.
    (async () => {
      for (const tipo of ["farmacia", "hospital", "clinica"]) {
        try {
          await fetch("/salud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tipo, lat: ubicacion.lat, lon: ubicacion.lon, fondo: true })
          });
        } catch { /* si no se puede, la consulta en vivo lo intentará */ }
      }
    })();
  });
}

async function buscarSaludCerca(argumentos) {
  const tipo = String(argumentos.tipo || "").trim();
  if (!tipo) return { ok: false, error: "Falta qué buscar" };

  setStatus("Buscando cerca…");
  const ubicacion = await ubicacionActual();
  if (ubicacion) ubicacionConocida = ubicacion;
  try {
    const respuesta = await fetch("/salud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Sin tope, esta espera era indefinida: medido en Santiago, una zona sin
      // consultar antes podía tener a Catalina callada más de cuarenta y cinco
      // segundos. Vale más contestar que no se pudo.
      signal: AbortSignal.timeout(ESPERA_HERRAMIENTA_MS),
      body: JSON.stringify({
        tipo,
        comuna: argumentos.comuna || "",
        lat: ubicacion?.lat,
        lon: ubicacion?.lon
      })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.ok) {
      setStatus("Te escucho");
      return { ok: false, error: datos.error || "No se pudo buscar" };
    }
    if (!datos.resultados?.length) {
      setStatus("Te escucho");
      return { ok: true, resultados: [], nota: "No se encontró nada cerca con esos datos." };
    }
    lugaresEnPantalla = datos.resultados;
    mostrarLugares(datos);
    setStatus("Te escucho");
    return datos;
  } catch (error) {
    console.error(error);
    setStatus("Te escucho");
    // Distinguir el corte por tiempo del fallo de red importa: lo que Catalina
    // diga es distinto. Si se agotó la espera, el mapa puede estar bien y sólo
    // lento, y volver a intentarlo tiene sentido.
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return { ok: false, error: "El mapa está tardando demasiado; se puede reintentar en un momento." };
    }
    return { ok: false, error: "Falló la conexión al buscar" };
  }
}

// Lo último que se listó y desde dónde se buscó. Sin esto, para trazar la ruta
// habría que hacerle repetir al modelo unas coordenadas que no vio nunca.
let lugaresEnPantalla = [];
let ubicacionConocida = null;

async function comoLlegar(argumentos) {
  const buscado = String(argumentos.destino || "").trim().toLowerCase();
  if (!buscado) return { ok: false, error: "Falta el destino" };
  if (!lugaresEnPantalla.length) {
    return { ok: false, error: "Primero hay que buscar lugares cerca." };
  }

  const destino = lugaresEnPantalla.find(l => l.nombre.toLowerCase().includes(buscado))
    ?? lugaresEnPantalla.find(l => buscado.includes(l.nombre.toLowerCase()));
  if (!destino) return { ok: false, error: "Ese lugar no está entre los que se mostraron." };

  // Lo que diga la persona manda sobre el GPS: si aclara que sale de otro
  // sitio, es porque el punto del dispositivo no es el que le interesa.
  const desde = String(argumentos.desde || "").trim();
  const origen = desde ? null : (ubicacionConocida ?? await ubicacionActual());
  if (!origen && !desde) {
    // Se dice qué falta, para que Catalina lo pregunte en vez de inventarse un
    // punto de partida.
    return { ok: false, faltaOrigen: true, error: "No sé desde dónde sale la persona. Pregúntale dónde está." };
  }

  setStatus("Trazando el camino…");
  try {
    const respuesta = await fetch("/ruta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origen, desde, destino: { lat: destino.lat, lon: destino.lon } })
    });
    const ruta = await respuesta.json().catch(() => ({}));
    if (!ruta.ok) {
      setStatus("Te escucho");
      return { ok: false, error: ruta.error || "No se pudo trazar el camino" };
    }

    await mostrarMapa(ruta, destino);
    setStatus("Te escucho");
    return {
      ok: true,
      destino: destino.nombre,
      distanciaKm: ruta.distanciaKm,
      minutosEnAuto: ruta.minutosEnAuto,
      minutosCaminando: ruta.minutosCaminando,
      pasos: ruta.pasos
    };
  } catch (error) {
    console.error(error);
    setStatus("Te escucho");
    return { ok: false, error: "Falló la conexión al trazar el camino" };
  }
}

// El mapa entra en la misma tarjeta que las láminas: es una imagen más, y así
// no aparece otra ventana que tape la cara.
async function mostrarMapa(ruta, destino) {
  mostrarLienzoDeImagen("cargando");
  const imagen = await dibujarRuta(ruta);
  if (!imagen) { mostrarLienzoDeImagen("oculto"); return; }

  ui.imagenFoto.src = imagen;
  ui.imagenFoto.alt = `Mapa del trayecto hasta ${destino.nombre}`;
  ui.imagenPie.textContent = `${destino.nombre} · ${ruta.distanciaKm} km`;
  ui.imagenCredito.textContent = "Abrir el recorrido en Google Maps";
  ui.imagenCredito.href = ruta.enlace;
  // El propio mapa también lleva al recorrido: es lo primero que uno intenta
  // tocar cuando quiere verlo en grande.
  ui.imagenFoto.style.cursor = "pointer";
  ui.imagenFoto.onclick = () => window.open(ruta.enlace, "_blank", "noopener");
  laminaEnPantalla = null;   // un mapa no es una lámina: no debe viajar en el correo
  mostrarLienzoDeImagen("visible");
}

const TITULOS_LUGARES = {
  farmacia: "Farmacias",
  hospital: "Hospitales",
  clinica: "Clínicas"
};

// Se reutiliza el panel de referencias: es la misma forma —una lista corta con
// un enlace por elemento— y así no se añade otra tarjeta que tape la cara.
function mostrarLugares(datos) {
  ui.referenciasTitulo.textContent = TITULOS_LUGARES[datos.tipo] || "Cerca de ti";
  ui.referenciasLista.replaceChildren();

  for (const lugar of datos.resultados) {
    const item = document.createElement("li");

    const enlace = document.createElement("a");
    enlace.href = lugar.mapa || "#";
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    enlace.textContent = lugar.nombre;

    const pie = document.createElement("span");
    pie.className = "referencia-pie";
    pie.textContent = [
      [lugar.direccion, lugar.comuna].filter(Boolean).join(", "),
      lugar.horario,
      lugar.telefono,
      lugar.distanciaKm != null ? `a ${lugar.distanciaKm} km` : ""
    ].filter(Boolean).join(" · ");

    item.append(enlace, pie);
    ui.referenciasLista.append(item);
  }

  if (datos.advertencia) {
    const nota = document.createElement("li");
    nota.className = "referencia-nota";
    nota.textContent = datos.advertencia;
    ui.referenciasLista.append(nota);
  }
  ui.referencias.dataset.estado = "visible";
  referenciasEnPantalla = [];   // esto no son referencias: no debe viajar en el correo
}

// Llamadas telefónicas. El servidor hace el trabajo; aquí sólo se pide y se
// consulta, y se refleja en pantalla en qué va.
async function llamarPorTelefono(argumentos) {
  setStatus("Llamando…");
  // Se abre la botonera con el número pedido a la vista: así se ve a quién se
  // está llamando y, enseguida, si la llamada se conecta.
  abrirMarcador(argumentos.numero || "", { objetivo: argumentos.objetivo, aQuien: argumentos.a_quien, restricciones: argumentos.restricciones });
  fijarFaseMarcador("conectando", "Marcando…");
  try {
    const respuesta = await fetch("/llamada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: argumentos.numero,
        objetivo: argumentos.objetivo,
        a_quien: argumentos.a_quien,
        restricciones: argumentos.restricciones,
        confirmado: argumentos.confirmado === true
      })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok) {
      fijarFaseMarcador("error", datos.error || "No se pudo iniciar la llamada");
      marcadorEnCurso(false);
      setStatus("Te escucho");
      return datos;
    }
    mostrarLlamada({ estado: "marcando", numero: argumentos.numero, objetivo: argumentos.objetivo });
    seguirEstadoLlamada(datos.id, argumentos.objetivo);   // sigue la conexión en vivo
    return datos;
  } catch (error) {
    console.error(error);
    fijarFaseMarcador("error", "No se pudo iniciar la llamada");
    marcadorEnCurso(false);
    setStatus("Te escucho");
    return { ok: false, error: "No se pudo iniciar la llamada" };
  }
}

async function consultarLlamada(argumentos) {
  const id = String(argumentos.id || "").trim();
  if (!id) return { ok: false, error: "Falta el identificador de la llamada" };
  try {
    const respuesta = await fetch(`/llamada/${encodeURIComponent(id)}`);
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok) return datos;
    mostrarLlamada(datos);
    // La transcripción completa no se le devuelve al modelo: son minutos de
    // conversación y lo que necesita para contarlo es el desenlace.
    return {
      ok: true,
      estado: datos.estado,
      resultado: datos.resultado,
      enCurso: ["marcando", "sonando", "contestada", "hablando"].includes(datos.estado)
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "No se pudo consultar la llamada" };
  }
}

const ESTADOS_LLAMADA = {
  marcando: "Marcando…", sonando: "Sonando…", contestada: "Contestaron",
  hablando: "Catalina está hablando", terminada: "Llamada terminada",
  ocupado: "Comunica", "sin respuesta": "No contestaron",
  fallida: "La llamada falló", cancelada: "Llamada cancelada"
};

function mostrarLlamada(datos) {
  ui.referenciasTitulo.textContent = "Llamada";
  ui.referenciasLista.replaceChildren();

  const cabecera = document.createElement("li");
  cabecera.className = "referencia-nota";
  cabecera.textContent = [ESTADOS_LLAMADA[datos.estado] || datos.estado, datos.numero]
    .filter(Boolean).join(" · ");
  ui.referenciasLista.append(cabecera);

  if (datos.objetivo) {
    const objetivo = document.createElement("li");
    objetivo.className = "referencia-nota";
    objetivo.textContent = datos.objetivo;
    ui.referenciasLista.append(objetivo);
  }

  if (datos.resultado) {
    const resultado = document.createElement("li");
    resultado.className = "referencia-nota";
    resultado.textContent = (datos.resultado.logrado ? "✓ " : "· ") + datos.resultado.detalle;
    ui.referenciasLista.append(resultado);
  }

  ui.referencias.dataset.estado = "visible";
  referenciasEnPantalla = [];
  setStatus(ESTADOS_LLAMADA[datos.estado] || "Te escucho");
}

// ─── Botonera de teléfono ──────────────────────────────────────────────────
//
// Cada estado que devuelve el servidor —ya sea el vocabulario de ElevenLabs
// (en_curso / terminada / fallo) o el del puente Twilio (marcando, sonando,
// contestada…)— se traduce a una de cuatro FASES visibles, con su color y su
// texto. Así el punto de arriba cuenta de un vistazo si se está conectando.
const FASES_LLAMADA = {
  marcando:        { fase: "conectando", txt: "Marcando…" },
  conectando:      { fase: "conectando", txt: "Conectando…" },
  sonando:         { fase: "conectando", txt: "Sonando…" },
  en_curso:        { fase: "activa",     txt: "En llamada" },
  contestada:      { fase: "activa",     txt: "Contestaron" },
  hablando:        { fase: "activa",     txt: "En llamada" },
  terminada:       { fase: "fin",        txt: "Llamada terminada" },
  ocupado:         { fase: "error",      txt: "Comunica" },
  "sin respuesta": { fase: "error",      txt: "No contestaron" },
  fallo:           { fase: "error",      txt: "La llamada falló" },
  fallida:         { fase: "error",      txt: "La llamada falló" },
  cancelada:       { fase: "error",      txt: "Llamada cancelada" }
};
const EN_CURSO = new Set(["marcando", "conectando", "sonando", "en_curso", "contestada", "hablando"]);
// Los ÚNICOS estados que dan la llamada por acabada. Antes se daba por final
// cualquier cosa que no estuviera en curso, y eso incluía «desconocido» —lo que
// devuelve el servidor cuando no logra consultar el estado en ese instante—: un
// parpadeo de red cerraba la llamada en falso, con un desenlace inventado. Ahora
// lo desconocido no cierra nada: se sigue sondeando.
const FINALES = new Set(["terminada", "fallo", "fallida", "ocupado", "sin respuesta", "cancelada"]);
let sondeoLlamada = null;   // temporizador del sondeo en curso, para no solapar dos
let llamadaActualId = null; // id de la llamada viva, para poder colgarla

function abrirMarcador(numero = "", { objetivo, aQuien, restricciones } = {}) {
  if (!ui.marcador) return;   // sin botonera (caché viejo), no estorbes la llamada
  clearTimeout(cierreMarcador);
  detenerSondeo();
  if (numero) ui.marcadorNumero.value = numero;
  // Se rellenan a la vista los datos de la gestión: así se ve a qué va la
  // llamada y se puede corregir antes de marcar.
  if (objetivo) ui.marcadorObjetivo.value = objetivo;
  if (aQuien) ui.marcadorAQuien.value = aQuien;
  if (restricciones) ui.marcadorRestricciones.value = restricciones;
  ui.marcador.dataset.estado = "visible";
  marcadorEnCurso(false);
  fijarFaseMarcador("idle", numero ? "Listo para llamar" : "Listo para marcar");
}

function cerrarMarcador() {
  detenerSondeo();
  ui.marcador.dataset.estado = "oculto";
  marcadorEnCurso(false);
}

// Cierra la botonera cuando la llamada ya terminó. Los segundos de espera son
// para que dé tiempo a leer el estado final —«Llamada terminada»— antes de que
// se vaya; sin ellos parecería que la ventana se cerró sin decir nada. Si se
// vuelve a marcar entretanto, el cierre se cancela.
let cierreMarcador = null;
function cerrarMarcadorTrasLlamada(espera = 4000) {
  clearTimeout(cierreMarcador);
  cierreMarcador = setTimeout(() => {
    if (!llamadaActualId) cerrarMarcador();     // sólo si no hay otra llamada viva
  }, espera);
}

// El punto y el texto del indicador. `fase` ∈ idle|conectando|activa|fin|error.
function fijarFaseMarcador(fase, texto) {
  if (!ui.marcadorEstado) return;
  ui.marcadorEstado.dataset.fase = fase;
  ui.marcadorEstadoTexto.textContent = texto;
}

// Traduce un estado del servidor a fase visible.
function reflejarEstadoLlamada(estado) {
  const m = FASES_LLAMADA[estado] || { fase: "activa", txt: estado || "En llamada" };
  fijarFaseMarcador(m.fase, m.txt);
  marcadorEnCurso(EN_CURSO.has(estado));
  return m;
}

// Cambia la botonera entre «puede llamar» y «en llamada» (botón colgar).
function marcadorEnCurso(si) {
  if (!ui.marcador) return;
  ui.marcador.dataset.encurso = si ? "si" : "no";
}

function detenerSondeo() {
  if (sondeoLlamada) { clearTimeout(sondeoLlamada); sondeoLlamada = null; }
}

// Sondea /llamada/:id hasta que la llamada termina o falla, refrescando el
// indicador. No usa el modelo: es la vista la que sigue la conexión en vivo.
// Le cuenta algo al agente para que lo diga en voz alta. Se manda como turno de
// la persona porque es lo único que le hace tomar la palabra; el panel sólo
// registra lo que dice Catalina, así que no ensucia el historial.
// Cola de avisos pendientes. `enviarTexto` devuelve false —sin ruido— cuando el
// socket no está abierto: pasa si la conversación se terminó mientras la llamada
// seguía, si el socket parpadeó o si aún estaba conectando. Ignorar ese false era
// justo lo que hacía que el cierre hablado funcionara unas veces sí y otras no.
// Aquí el aviso se guarda y se reintenta hasta que la voz vuelve a estar lista.
const avisosPendientes = [];
let reintentoAviso = null;
const ESPERA_AVISO = 60_000;   // hasta un minuto esperando a que vuelva la voz

function avisarAlAgente(texto) {
  avisosPendientes.push({ texto, desde: Date.now() });
  entregarAvisos();
}

function entregarAvisos() {
  clearTimeout(reintentoAviso);
  while (avisosPendientes.length) {
    const aviso = avisosPendientes[0];
    let entregado = false;
    try { entregado = sesion?.enviarTexto?.(aviso.texto) === true; }
    catch (error) { console.error(error); }

    if (entregado) { avisosPendientes.shift(); continue; }

    // No se pudo. Si aún hay margen, se reintenta; si no, se deja de insistir
    // pero el desenlace ya quedó escrito en pantalla, así que no se pierde.
    if (Date.now() - aviso.desde > ESPERA_AVISO) {
      console.warn("No se pudo contar el desenlace: la conversación no estaba activa.");
      avisosPendientes.shift();
      continue;
    }
    reintentoAviso = setTimeout(entregarAvisos, 1000);
    return;
  }
}

// Sondea hasta que la llamada termina. Al terminar NO se limita a pintarlo: le
// empuja el desenlace al agente para que Catalina lo cuente hablando. Antes se
// esperaba a que ella preguntara por su cuenta, y como dejaba de preguntar, la
// llamada acababa sin cierre y el marcador se quedaba en «En llamada».
//
// El tope es alto (una gestión por teléfono puede pasar de diez minutos) y al
// agotarse tampoco se calla: avisa de que dejó de seguirla.
const SONDEOS_MAX = 240;   // ~12 minutos a 3 s
function seguirEstadoLlamada(id, objetivo, intento = 0) {
  detenerSondeo();
  if (!id) return;
  llamadaActualId = id;
  if (intento > SONDEOS_MAX) {
    llamadaActualId = null;
    marcadorEnCurso(false);
    fijarFaseMarcador("fin", "Seguimiento agotado");
    avisarAlAgente("[Aviso del sistema] La llamada lleva demasiado tiempo y dejé de seguirla; no tengo su desenlace. Dilo en una frase y ofrece volver a intentarlo.");
    cerrarMarcadorTrasLlamada();
    return;
  }
  sondeoLlamada = setTimeout(async () => {
    let datos = {};
    try { datos = await (await fetch(`/llamada/${encodeURIComponent(id)}`)).json(); } catch {}
    if (datos.ok && datos.estado) {
      // Un estado que no se pudo confirmar en vivo no se pinta ni cierra nada:
      // se deja lo último que se sabía y se vuelve a preguntar.
      if (datos.estado !== "desconocido") reflejarEstadoLlamada(datos.estado);
      if (FINALES.has(datos.estado)) {
        // Estado final: se pinta el desenlace y se le cuenta al agente.
        llamadaActualId = null;
        marcadorEnCurso(false);
        mostrarLlamada({ estado: datos.estado, numero: ui.marcadorNumero.value, objetivo,
          resultado: datos.resumen ? { logrado: datos.estado === "terminada", detalle: datos.resumen } : undefined });
        contarDesenlace(datos, objetivo);
        // La botonera ya no pinta nada: se cierra sola. Se deja un momento para
        // que se alcance a leer el estado final antes de que desaparezca.
        cerrarMarcadorTrasLlamada();
        return;
      }
    }
    seguirEstadoLlamada(id, objetivo, intento + 1);
  }, intento === 0 ? 1500 : 3000);
}

// Arma el aviso con lo que se sabe de la llamada y se lo pasa al agente para que
// cierre hablando, en el formato de informe que ya tiene en su persona.
function contarDesenlace(datos, objetivo) {
  const partes = ["[Aviso del sistema] La llamada terminó."];
  if (objetivo) partes.push(`Objetivo: ${objetivo}.`);
  partes.push(`Estado: ${datos.estado}.`);
  if (datos.resumen) partes.push(`Lo que ocurrió: ${datos.resumen}`);
  if (datos.motivo) partes.push(`Motivo del corte: ${datos.motivo}`);
  if (!datos.resumen && !datos.motivo) {
    partes.push("No hay resumen de la conversación: di sólo si se logró o no y ofrece reintentar.");
  }
  partes.push("Cuéntale AHORA el resultado en voz alta, breve, con tu formato: Estado, Objetivo, Resultado, Datos relevantes y Próximo paso.");
  avisarAlAgente(partes.join(" "));
}

// Llamada iniciada a mano desde la botonera (botón verde).
async function lanzarLlamadaDesdeBotonera() {
  const numero = ui.marcadorNumero.value.trim();
  if (!numero) { fijarFaseMarcador("error", "Escribe un número primero"); return; }
  const objetivo = ui.marcadorObjetivo.value.trim();
  // Sin objetivo la llamada sale sin saber a qué va y la persona que contesta
  // se encuentra con alguien que no sabe qué pedir. Se exige antes de marcar.
  if (!objetivo) { fijarFaseMarcador("error", "Escribe el objetivo de la llamada"); ui.marcadorObjetivo.focus(); return; }
  fijarFaseMarcador("conectando", "Marcando…");
  marcadorEnCurso(true);
  try {
    const r = await fetch("/llamada", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero, objetivo,
        a_quien: ui.marcadorAQuien.value.trim(),
        restricciones: ui.marcadorRestricciones.value.trim(),
        confirmado: true
      })
    });
    const datos = await r.json().catch(() => ({}));
    if (!datos.ok) { fijarFaseMarcador("error", datos.error || "No se pudo llamar"); marcadorEnCurso(false); return; }
    seguirEstadoLlamada(datos.id, objetivo);
  } catch {
    fijarFaseMarcador("error", "No se pudo llamar"); marcadorEnCurso(false);
  }
}

// Cuelga la llamada en curso de verdad, pidiéndole al servidor que la termine.
async function colgarLlamada() {
  const id = llamadaActualId;
  if (!id) { detenerSondeo(); fijarFaseMarcador("fin", "Sin llamada activa"); marcadorEnCurso(false); return; }
  fijarFaseMarcador("conectando", "Colgando…");
  try {
    const r = await fetch("/llamada/colgar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const datos = await r.json().catch(() => ({}));
    if (datos.ok) {
      detenerSondeo();
      llamadaActualId = null;
      fijarFaseMarcador("fin", "Llamada terminada");
      marcadorEnCurso(false);
      avisarAlAgente("[Aviso del sistema] Colgué la llamada desde la pantalla antes de que terminara sola. Dilo en una frase y pregunta si se vuelve a intentar.");
      cerrarMarcadorTrasLlamada();
    } else {
      // No se pudo colgar en el servidor: se dice por qué y se sigue el estado,
      // que es la verdad de si la llamada sigue viva o no.
      fijarFaseMarcador("error", datos.error || "No se pudo colgar");
    }
  } catch {
    fijarFaseMarcador("error", "No se pudo colgar");
  }
}

// Deja el número sólo con lo válido en E.164: un «+» al inicio y dígitos.
function limpiarNumeroMarcador() {
  const v = ui.marcadorNumero.value;
  const limpio = (v[0] === "+" ? "+" : "") + v.replace(/[^\d]/g, "");
  if (limpio !== v) ui.marcadorNumero.value = limpio;
}

function pulsarTecla(d) {
  // El 0 mantenido, o su etiqueta «+», mete el prefijo internacional si el
  // campo está vacío; el resto se anexa tal cual.
  if (d === "0" && ui.marcadorNumero.value === "") ui.marcadorNumero.value = "+";
  else ui.marcadorNumero.value += d;
  ui.marcadorNumero.focus();
}

async function usarConector(nombre, argumentos) {
  try {
    const respuesta = await fetch("/conector", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, consulta: argumentos.consulta ?? "" })
    });
    return await respuesta.json();
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Falló la conexión con el conector" };
  }
}

async function pedirLamina(argumentos) {
  const estructura = String(argumentos.estructura || "").trim();
  if (!estructura) return { ok: false, error: "Falta la estructura" };

  setStatus("Buscando la lámina…");
  mostrarLienzoDeImagen("cargando");
  try {
    const respuesta = await fetch("/imagen-medica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estructura, detalle: argumentos.detalle })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.lamina) {
      mostrarLienzoDeImagen("oculto");
      // El modelo necesita saber que no hay nada a la vista, para no explicar
      // una lámina inexistente.
      return { ok: false, mostrada: false, error: datos.error || "No se encontró una lámina" };
    }

    mostrarLamina(datos.lamina);
    return {
      ok: true,
      mostrada: true,
      titulo: datos.lamina.titulo,
      fuente: datos.lamina.fuente,
      // Va explícito para que Catalina lo advierta al hablar en vez de
      // presentar como exacta una lámina que sólo se aproxima.
      aproximada: datos.lamina.aproximada === true
    };
  } catch (error) {
    console.error(error);
    mostrarLienzoDeImagen("oculto");
    return { ok: false, mostrada: false, error: "Falló la conexión con el atlas" };
  }
}

// Búsqueda en la web abierta. El resumen vuelve como texto para que Catalina lo
// diga; las fuentes van al panel de referencias, siempre a la vista, porque de
// ahí sale lo que cuenta.
async function buscarWeb(argumentos) {
  const consulta = String(argumentos.consulta || "").trim();
  if (!consulta) return { ok: false, error: "Falta la consulta" };
  try {
    const respuesta = await fetch("/web/buscar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok) return { ok: false, error: datos.error || "No se pudo buscar" };

    if (datos.fuentes?.length) mostrarReferencias(datos.fuentes, "Fuentes en la web");
    // El resumen y el aviso de si trae fuente van al modelo: es lo que dirá, y
    // debe poder distinguir un dato respaldado de uno que no lo está.
    return {
      ok: true,
      resumen: datos.resumen,
      respaldado: datos.respaldado,
      fuentes: (datos.fuentes ?? []).map(f => f.titulo),
      aviso: datos.respaldado ? undefined : "Esto no trae fuente; dilo al contarlo."
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Falló la búsqueda en la web" };
  }
}

// Leer una página por su dirección. Devuelve el texto para resumir o citar; la
// página se ofrece como fuente en el panel.
async function leerPaginaWeb(argumentos) {
  const url = String(argumentos.url || "").trim();
  if (!url) return { ok: false, error: "Falta la dirección" };
  try {
    const respuesta = await fetch("/web/leer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok) return { ok: false, error: datos.error || "No se pudo abrir la página" };

    mostrarReferencias([{ titulo: datos.titulo || datos.url, enlace: datos.url }], "Página leída");
    return { ok: true, titulo: datos.titulo, texto: datos.texto, recortado: datos.recortado };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Falló la lectura de la página" };
  }
}

// Generar una imagen. Sólo a petición explícita. Se muestra marcada como
// generada: no es evidencia, y el crédito lo dice en vez de enlazar a una fuente.
async function generarImagen(argumentos) {
  const descripcion = String(argumentos.descripcion || "").trim();
  if (!descripcion) return { ok: false, error: "Falta la descripción" };
  setStatus("Generando la imagen…");
  mostrarLienzoDeImagen("cargando");
  try {
    const respuesta = await fetch("/imagen/generar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descripcion })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok || !datos.imagen) {
      mostrarLienzoDeImagen("oculto");
      return { ok: false, mostrada: false, error: datos.error || "No se pudo generar" };
    }
    mostrarImagenGenerada(datos.imagen, descripcion);
    return {
      ok: true,
      mostrada: true,
      // Explícito para que Catalina lo diga: es una ilustración, no una prueba.
      generada: true,
      aviso: "Es una imagen generada; preséntala como ilustración, nunca como evidencia."
    };
  } catch (error) {
    console.error(error);
    mostrarLienzoDeImagen("oculto");
    return { ok: false, mostrada: false, error: "Falló la generación de la imagen" };
  }
}

// Buscar imágenes reales en la web abierta. Devuelve una rejilla; la mejor va
// grande y las demás como miniaturas. Al modelo le llegan los títulos y fuentes
// para que las nombre y las sitúe. Si no encuentra, lo dice —no inventa.
async function buscarImagenes(argumentos) {
  const consulta = String(argumentos.consulta || argumentos.tema || "").trim();
  if (!consulta) return { ok: false, error: "Falta la consulta" };
  setStatus("Buscando imágenes…");
  mostrarLienzoDeImagen("cargando");
  try {
    const respuesta = await fetch("/imagenes/buscar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok || !datos.imagenes?.length) {
      mostrarLienzoDeImagen("oculto");
      return { ok: false, mostrada: false, error: datos.error || "No encontré imágenes para eso." };
    }
    mostrarGaleria(datos.imagenes);
    return {
      ok: true,
      mostradas: datos.imagenes.length,
      total: datos.total,
      consultadas: datos.consultadas,
      // Títulos y fuentes al modelo, para que describa lo que hay en pantalla y
      // diga de dónde sale; las imágenes reales llevan su origen, no se inventan.
      imagenes: datos.imagenes.slice(0, 6).map(i => ({ titulo: i.titulo, fuente: i.origen, licencia: i.licencia }))
    };
  } catch (error) {
    console.error(error);
    mostrarLienzoDeImagen("oculto");
    return { ok: false, mostrada: false, error: "Falló la búsqueda de imágenes" };
  }
}

// Fuentes clínicas curadas. No son imágenes en pantalla: son enlaces a sitios de
// referencia —Gray's Anatomy, Mayo, Science Source— para abrir y buscar ahí.
// Van al panel de referencias como enlaces con su nota.
async function pedirFuentesClinicas(argumentos) {
  const consulta = String(argumentos.consulta || argumentos.tema || "").trim();
  try {
    const respuesta = await fetch("/fuentes-clinicas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok || !datos.fuentes?.length) return { ok: false, error: "No hay fuentes clínicas disponibles" };

    mostrarReferencias(
      datos.fuentes.map(f => ({ titulo: f.titulo, enlace: f.enlace, autores: f.dominio, revista: f.nota })),
      "Fuentes clínicas"
    );
    return {
      ok: true,
      // Al modelo, para que las nombre y avise de la de pago; los enlaces ya
      // están en pantalla, no hace falta que los dicte.
      fuentes: datos.fuentes.map(f => ({ titulo: f.titulo, nota: f.nota })),
      aviso: "Son enlaces para abrir y buscar ahí, no imágenes en pantalla. Science Source requiere licencia de pago."
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Falló la carga de fuentes clínicas" };
  }
}

// Búsqueda en la web abierta con Google. Segundo paso, tras autorización: para
// lo que no está en los bancos (una persona, un autor, algo no médico). Misma
// rejilla; al modelo se le recuerda avisar que son de la web, con derechos.
async function buscarImagenesWeb(argumentos) {
  const consulta = String(argumentos.consulta || argumentos.tema || "").trim();
  if (!consulta) return { ok: false, error: "Falta la consulta" };
  setStatus("Buscando en la web…");
  mostrarLienzoDeImagen("cargando");
  try {
    const respuesta = await fetch("/imagenes/web", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok || !datos.imagenes?.length) {
      mostrarLienzoDeImagen("oculto");
      return { ok: false, mostrada: false, error: datos.error || "No encontré imágenes en la web para eso." };
    }
    mostrarGaleria(datos.imagenes);
    return {
      ok: true,
      mostradas: datos.imagenes.length,
      imagenes: datos.imagenes.slice(0, 6).map(i => ({ titulo: i.titulo, fuente: i.autor || i.origen })),
      aviso: "Son imágenes de la web abierta, con derechos de sus dueños; preséntalas con su fuente, no como material libre."
    };
  } catch (error) {
    console.error(error);
    mostrarLienzoDeImagen("oculto");
    return { ok: false, mostrada: false, error: "Falló la búsqueda en la web" };
  }
}

// Vistas en forma corta: 1200000 → «1,2 M». Es una señal de popularidad, no de
// rigor, y así se dice al recomendarlo.
function formatoVistas(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")} M vistas`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} mil vistas`;
  return `${n} vistas`;
}

// Buscar videos en YouTube. Los enlaces van al panel de referencias —la misma
// lista, reutilizada— con el canal, la duración y las vistas en el pie. Al modelo
// van los títulos y canales para que los nombre y advierta que vistas ≠ rigor.
async function buscarVideos(argumentos) {
  const consulta = String(argumentos.consulta || argumentos.tema || "").trim();
  if (!consulta) return { ok: false, error: "Falta la consulta" };
  try {
    const respuesta = await fetch("/videos/buscar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!datos.ok) return { ok: false, error: datos.error || "No se pudo buscar en YouTube" };
    if (!datos.videos?.length) return { ok: true, videos: [], aviso: "No encontré videos para eso." };

    // Cada video se pinta como una referencia: título con enlace, y en el pie el
    // canal, la plataforma con la duración, el año y las vistas.
    const comoReferencias = datos.videos.map(v => ({
      titulo: v.titulo, enlace: v.enlace, autores: v.canal, anio: v.anio,
      revista: ["YouTube", v.duracion, formatoVistas(v.vistas)].filter(Boolean).join(" · ")
    }));
    mostrarReferencias(comoReferencias, "Videos de YouTube");

    return {
      ok: true,
      mostrados: datos.videos.length,
      // Va al modelo para que los nombre y los sitúe. Sin filtro de evidencia:
      // son material para orientar, no fuentes validadas, y así se ofrecen.
      videos: datos.videos.map(v => ({ titulo: v.titulo, canal: v.canal, vistas: v.vistas, duracion: v.duracion })),
      aviso: "Son videos de YouTube para orientar, no evidencia validada; ofrécelos como material útil, sin descartarlos por rigor."
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Falló la búsqueda de videos" };
  }
}

async function pedirReferencias(argumentos) {
  const tema = String(argumentos.tema || "").trim();
  if (!tema) return { ok: false, error: "Falta el tema" };

  try {
    const respuesta = await fetch("/referencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tema })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.referencias?.length) {
      return { ok: false, error: datos.error || "Sin referencias" };
    }

    // total = cuántas encontró en total; en pantalla van las mejores, ampliables
    // a las 20 más relevantes reordenadas por factor de impacto de la revista.
    mostrarReferencias(datos.referencias, "Referencias", {
      total: datos.total ?? datos.referencias.length,
      ampliable: true
    });
    // Van los títulos y las señales de evidencia —citas, si es preprint— para
    // que Catalina pueda ordenarlas al hablar; los enlaces ya están en pantalla.
    return {
      ok: true,
      encontradas: datos.total ?? datos.referencias.length,
      mostradas: datos.referencias.length,
      consultadas: datos.consultadas,
      // Las que fallaron o no se consultaron: Catalina debe nombrarlas como
      // límite de la búsqueda.
      noConsultadas: datos.fallaron,
      referencias: datos.referencias.map(r => ({
        titulo: r.titulo, anio: r.anio, revista: r.revista,
        citas: r.citas, impacto: r.impacto, preprint: r.preprint, registro: r.registro
      }))
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Falló la conexión con PubMed" };
  }
}

function mostrarLienzoDeImagen(estado) {
  ui.imagen.dataset.estado = estado;
}

function mostrarLamina(lamina) {
  laminaEnPantalla = lamina;
  ocultarGaleria();
  ui.imagenFoto.onclick = null;
  ui.imagenFoto.onerror = null;
  ui.imagenFoto.style.cursor = "";
  ui.imagenFoto.src = lamina.imagen;
  ui.imagenFoto.alt = lamina.titulo;
  ui.imagenPie.textContent = lamina.titulo;
  // La atribución no es decorativa: las licencias de Commons la exigen, y es lo
  // que permite comprobar que la lámina existe y de dónde sale.
  ui.imagenCredito.textContent = `${lamina.autor} · ${lamina.licencia}`;
  ui.imagenCredito.href = lamina.fuente;
  mostrarLienzoDeImagen("visible");
}

// Imagen generada. Mismo panel que las láminas, pero el crédito avisa —sin
// enlace— de que es generada: una lámina de Commons tiene fuente que comprobar;
// ésta no, y decirlo es parte de mostrarla con criterio.
function mostrarImagenGenerada(dataUrl, descripcion) {
  laminaEnPantalla = null;
  ocultarGaleria();
  ui.imagenFoto.onclick = null;
  ui.imagenFoto.onerror = null;
  ui.imagenFoto.style.cursor = "";
  ui.imagenFoto.src = dataUrl;
  ui.imagenFoto.alt = descripcion;
  ui.imagenPie.textContent = descripcion.slice(0, 120);
  ui.imagenCredito.textContent = "Imagen generada con IA · no es evidencia";
  ui.imagenCredito.removeAttribute("href");
  mostrarLienzoDeImagen("visible");
}

function ocultarGaleria() {
  ui.imagenGaleria.hidden = true;
  ui.imagenGaleria.replaceChildren();
}

// Carga una imagen remota con red de seguridad: si la fuente bloquea la carga
// directa —hotlinking—, se reintenta UNA vez a través del proxy del servidor,
// que sólo sirve hosts abiertos conocidos. Así el contenido se muestra igual,
// y el proxy sólo se paga cuando la carga directa falla.
function cargarImagen(img, url) {
  img.dataset.proxied = "";
  img.onerror = () => {
    if (img.dataset.proxied === "1") { img.onerror = null; return; }
    img.dataset.proxied = "1";
    img.src = `/img?u=${encodeURIComponent(url)}`;
  };
  img.src = url;
}

// Galería de la búsqueda de imágenes. La primera —la mejor puntuada— se pone
// grande; las demás, como miniaturas debajo, y al tocar una pasa a ser la grande.
// Nada de esto descarga bytes en el servidor: cada <img> carga de su fuente.
function mostrarGaleria(imagenes) {
  laminaEnPantalla = null;
  const elegir = imagen => {
    ui.imagenFoto.onclick = null;
    ui.imagenFoto.style.cursor = "";
    cargarImagen(ui.imagenFoto, imagen.imagen || imagen.thumb);
    ui.imagenFoto.alt = imagen.titulo || "";
    ui.imagenPie.textContent = (imagen.titulo || "").slice(0, 120);
    // La fuente y la licencia son la prueba de que la imagen existe y de dónde
    // viene; van con enlace para poder comprobarlas.
    ui.imagenCredito.textContent = [imagen.autor, imagen.licencia, imagen.origen].filter(Boolean).join(" · ") || imagen.origen || "";
    if (imagen.fuente) ui.imagenCredito.href = imagen.fuente; else ui.imagenCredito.removeAttribute("href");
    for (const t of ui.imagenGaleria.children) t.setAttribute("aria-current", t.dataset.url === (imagen.imagen || imagen.thumb) ? "true" : "false");
  };

  ui.imagenGaleria.replaceChildren();
  if (imagenes.length > 1) {
    for (const imagen of imagenes) {
      const t = document.createElement("img");
      t.alt = imagen.titulo || "";
      t.loading = "lazy";
      t.dataset.url = imagen.imagen || imagen.thumb;
      t.addEventListener("click", () => elegir(imagen));
      ui.imagenGaleria.append(t);
      cargarImagen(t, imagen.thumb || imagen.imagen);
    }
    ui.imagenGaleria.hidden = false;
  } else {
    ui.imagenGaleria.hidden = true;
  }

  elegir(imagenes[0]);
  mostrarLienzoDeImagen("visible");
}

function mostrarReferencias(referencias, titulo = "Referencias", meta = {}) {
  referenciasEnPantalla = referencias;
  referenciasTitulo = titulo;
  referenciasTotal = Number.isFinite(meta.total) ? meta.total : referencias.length;
  // Sólo el panel de literatura se amplía y sólo si hay más de lo que cabe.
  referenciasAmpliable = Boolean(meta.ampliable) && referencias.length > REFERENCIAS_COLAPSADAS;
  referenciasExpandido = false;
  pintarReferencias();
  ui.referencias.dataset.estado = "visible";
}

// Pinta la lista según esté colapsada o ampliada. Colapsada muestra las mejores
// en el orden de relevancia que trajo el servidor; ampliada muestra las 20 y las
// reordena por factor de impacto de la revista, que es lo que se pidió al ampliar.
function pintarReferencias() {
  let lista = referenciasEnPantalla;
  if (referenciasExpandido) {
    lista = referenciasEnPantalla.slice().sort((a, b) => {
      const ia = Number.isFinite(a.impacto) ? a.impacto : -1;
      const ib = Number.isFinite(b.impacto) ? b.impacto : -1;
      return ib - ia;   // mayor impacto primero; las sin dato, al final
    });
  } else if (referenciasAmpliable) {
    lista = referenciasEnPantalla.slice(0, REFERENCIAS_COLAPSADAS);
  }

  // El título lleva el número encontrado, que puede ser mayor que lo mostrado.
  ui.referenciasTitulo.textContent =
    referenciasTotal > lista.length ? `${referenciasTitulo} · ${referenciasTotal}` : referenciasTitulo;

  ui.referencias.dataset.expandido = referenciasExpandido ? "si" : "no";
  ui.referenciasAmpliar.hidden = !referenciasAmpliable;
  if (referenciasAmpliable) {
    ui.referenciasAmpliar.setAttribute("aria-expanded", referenciasExpandido ? "true" : "false");
    ui.referenciasAmpliar.textContent = referenciasExpandido
      ? "Ver menos"
      : `Ver las ${referenciasEnPantalla.length} por impacto`;
  }

  ui.referenciasLista.replaceChildren();
  for (const referencia of lista) {
    const item = document.createElement("li");
    const enlace = document.createElement("a");
    enlace.href = referencia.enlace;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    enlace.textContent = referencia.titulo;

    const pie = document.createElement("span");
    pie.className = "referencia-pie";
    const partes = [referencia.autores, referencia.revista, referencia.anio].filter(Boolean);
    if (Number.isFinite(referencia.citas)) partes.push(`${referencia.citas} ${referencia.citas === 1 ? "cita" : "citas"}`);
    if (referencia.registro) partes.push(`registro de ensayo${referencia.estado ? " · " + referencia.estado : ""}`);
    else if (referencia.preprint) partes.push("preprint sin revisar");
    else if (referencia.accesoAbierto) partes.push("acceso abierto");
    pie.textContent = partes.join(" · ");

    item.append(enlace, pie);
    // El factor de impacto va aparte y con color: es la señal por la que se
    // reordena al ampliar, así que se ve de un vistazo.
    if (Number.isFinite(referencia.impacto) && referencia.impacto > 0) {
      const impacto = document.createElement("span");
      impacto.className = "referencia-impacto";
      impacto.textContent = ` · IF≈${referencia.impacto.toFixed(1)}`;
      pie.append(impacto);
    }

    ui.referenciasLista.append(item);
  }
}

// Subtítulos e historial.
//
// Los dos nacen apagados a propósito: leer lo mismo que se está oyendo compite
// con la cara, que es lo que sostiene la conversación. Quien los quiera los
// enciende, y la elección se recuerda para no tener que repetirla cada vez.
//
// El texto vivo y el historial son la misma fuente vista de dos maneras: el
// subtítulo muestra sólo el turno en curso; el panel los guarda todos.
const PREFS = "catalina.vista";
let verSubtitulos = false;
let verPanel = false;
let turnoVivo = null;   // { nodo, texto } del turno que Catalina está diciendo
let avisoActivo = false;

try {
  const guardado = JSON.parse(localStorage.getItem(PREFS) || "{}");
  verSubtitulos = guardado.subtitulos === true;
  verPanel = guardado.panel === true;
} catch {
  // Almacenamiento bloqueado (modo privado): se sigue con todo apagado.
}

// Cuánto espacio ocupan los controles contado desde el borde inferior. El
// subtítulo y el panel se apoyan en esta medida en vez de en un número fijo,
// porque en pantalla estrecha los botones se reparten en varias filas y la
// altura cambia sola (y también al pasar de «Iniciar conversación» a
// «Finalizar», que es más corto y puede recolocar la fila).
function medirControles() {
  const alto = window.innerHeight - ui.controls.getBoundingClientRect().top;
  ui.stage.style.setProperty("--controles", `${Math.max(0, Math.round(alto))}px`);
}

// El observador cubre los cambios de alto propios de la barra (una etiqueta que
// cambia de largo y recoloca la fila); los de la ventana los trae
// alCambiarLaVista.
new ResizeObserver(medirControles).observe(ui.controls);
medirControles();

function guardarPreferencias() {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ subtitulos: verSubtitulos, panel: verPanel }));
  } catch {}
}

function fijarSubtitulos(activo) {
  verSubtitulos = activo;
  // Un aviso del sistema manda sobre la preferencia: si hay algo que leer, se
  // lee, y al apagarse el aviso vuelve a mandar la preferencia.
  if (!activo && !avisoActivo) ui.caption.dataset.visible = "false";
  else if (activo && ui.caption.textContent.trim()) ui.caption.dataset.visible = "true";
  guardarPreferencias();
}

function fijarPanel(activo) {
  verPanel = activo;
  ui.panel.dataset.open = String(activo);
  ui.togglePanel.setAttribute("aria-pressed", String(activo));
  if (activo) ui.panelBody.scrollTop = ui.panelBody.scrollHeight;
  guardarPreferencias();
}

function mostrarAviso(texto) {
  avisoActivo = Boolean(texto);
  ui.caption.textContent = texto;
  ui.caption.dataset.visible = String(avisoActivo);
}

// Cada delta trae el turno entero acumulado, no sólo lo nuevo, así que se
// reescribe el mismo nodo en vez de ir añadiendo trozos.
function anotarTurno(texto) {
  if (!texto) {
    // La sesión manda texto vacío cuando la persona empieza a hablar: se cierra
    // lo que hubiera y se limpia el subtítulo.
    cerrarTurno();
    if (!avisoActivo) {
      ui.caption.textContent = "";
      ui.caption.dataset.visible = "false";
    }
    return;
  }

  if (avisoActivo) avisoActivo = false;
  // Catalina antepone a veces una etiqueta de tono —[Con calidez], [Con
  // confianza]— que es una indicación interna, no algo para leer. Se quita del
  // subtítulo y del historial; lo que se guarda es sólo lo que dijo.
  const limpio = sinEtiquetas(texto);
  ui.caption.textContent = limpio;
  ui.caption.dataset.visible = String(verSubtitulos);

  if (!turnoVivo) turnoVivo = crearTurno();
  turnoVivo.texto.textContent = limpio;

  // Sólo se sigue el fondo si ya estábamos abajo: si la persona subió a releer
  // algo, el texto nuevo no le arrebata la posición.
  const alFondo = ui.panelBody.scrollHeight - ui.panelBody.scrollTop - ui.panelBody.clientHeight < 60;
  if (alFondo) ui.panelBody.scrollTop = ui.panelBody.scrollHeight;
}

// Quita las etiquetas de tono entre corchetes —[Con calidez]— y cualquier
// corchete de indicación, incluido uno a medio llegar al final del stream, para
// que no parpadee mientras se escribe. Deja sólo el texto hablado.
function sinEtiquetas(texto) {
  return String(texto)
    .replace(/\[[^\]\n]{1,40}\]/g, "")   // etiquetas completas: [Con confianza]
    .replace(/\[[^\]\n]{0,40}$/, "")     // una etiqueta aún sin cerrar al final
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+/, "");
}

function crearTurno(deQuien = "Catalina") {
  ui.panelBody.querySelector(".panel-empty")?.remove();

  const nodo = document.createElement("article");
  nodo.className = "turno";
  nodo.dataset.vivo = "true";

  const cabecera = document.createElement("div");
  cabecera.className = "turno-cabecera";

  const quien = document.createElement("span");
  quien.className = "turno-quien";
  quien.textContent = deQuien;

  const hora = document.createElement("time");
  hora.className = "turno-hora";
  const ahora = new Date();
  hora.dateTime = ahora.toISOString();
  hora.textContent = ahora.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

  const texto = document.createElement("p");
  texto.className = "turno-texto";

  cabecera.append(quien, hora);
  nodo.append(cabecera, texto);
  ui.panelBody.append(nodo);
  return { nodo, texto };
}

// Estas notas —por qué se cerró la sesión, qué activar en el panel del agente—
// son de uso interno: sirven para diagnosticar, no para el usuario final, así
// que NO se escriben en el historial de la conversación. Quedan en la consola
// para quien esté depurando; la orientación que sí debe ver el usuario llega por
// otro lado (onHelp/onFailure, que la muestran de forma transitoria).
function anotarNota(texto) {
  if (!texto) return;
  console.info("[nota interna]", texto);
}

function cerrarTurno() {
  if (!turnoVivo) return;
  const dicho = turnoVivo.texto.textContent.trim();
  // Un turno sin texto no deja rastro: pasa cuando la respuesta se interrumpe
  // antes de que llegue el primer delta.
  if (!dicho) turnoVivo.nodo.remove();
  else turnoVivo.nodo.dataset.vivo = "false";
  // Lo que dijo en una reunión queda en la memoria de la reunión, marcado como
  // suyo. Sin esto, la minuta no sabría que la asistente intervino y sus
  // aportes se perderían o —peor— se atribuirían a un participante.
  if (dicho && enModoMeet && memoria.abierta && estadoReunion !== ESTADOS.POSTERIOR) {
    memoria.anotarIntervencion(dicho);
  }
  turnoVivo = null;
}

fijarSubtitulos(verSubtitulos);
fijarPanel(verPanel);

// Se pregunta al arrancar qué proveedores hay: sin esto habría que esperar a
// que OpenAI fallara para descubrir que tampoco hay respaldo.
fetch("/health")
  .then(respuesta => respuesta.json())
  .then(estado => {
    disponible.elevenlabs = Boolean(estado.proveedores?.elevenlabs);
    disponible.openai = Boolean(estado.proveedores?.openai);
    disponible.gemini = Boolean(estado.proveedores?.gemini);
  })
  .catch(() => {});

// Va después de fijar la vista: el aviso necesita que el estado ya exista, y
// además debe poder pasar por encima de unos subtítulos apagados.
if (location.protocol === "file:") {
  setStatus("Ejecuta start.command para activar la voz");
  mostrarAviso("La imagen funciona, pero el micrófono y la API requieren http://127.0.0.1:4173.");
}

// Fin de turno.
//
// `response.done` sólo dice que el modelo terminó de generar; el audio sigue
// sonando unos segundos después, porque va por delante. Quien decide que
// Catalina dejó de hablar es el silencio real de la pista, no el evento.
let faseDeSesion = "idle";
let respuestaCerrada = false;
let silencioDesde = 0;

function seguirFinDeTurno(lectura, now) {
  if (lectura.energy > .10) {
    silencioDesde = 0;
    return;
  }
  if (!silencioDesde) silencioDesde = now;
  else if (respuestaCerrada && now - silencioDesde > 420 && director.state === "speaking") {
    respuestaCerrada = false;
    silencioDesde = 0;
    director.setState(faseDeSesion === "idle" ? "listening" : faseDeSesion);
    setStatus(enModoMeet && estadoReunion !== ESTADOS.POSTERIOR ? "En reunión"
      : (reunionConsultable ? "Te escucho · reunión cargada" : "Te escucho"));
    // Terminó de hablar de verdad —lo decide el silencio real de la pista, no
    // el fin de la generación—, así que vuelve a escuchar la reunión y se
    // vuelve a callar. El margen extra deja pasar la cola de su voz en la sala.
    if (enModoMeet && estadoReunion !== ESTADOS.CERRANDO && estadoReunion !== ESTADOS.POSTERIOR) {
      setTimeout(() => volverAEscuchar("Sigo escuchando."), 700);
    }
  }
}

// Entonación a partir del texto que Catalina va diciendo. La puntuación del
// español marca la intención antes de que termine la frase: la apertura de
// interrogación o de exclamación llega al principio, así que basta con mirar
// el final del transcrito para saber en qué tono está hablando.
let ultimaExpresion = "neutra";
function aplicarExpresionDeFrase(texto) {
  const cola = texto.slice(-90);
  let expresion = "neutra";
  let intensidad = 1;
  if (/[¡!][^¡!¿?]*$/.test(cola)) { expresion = "alegria"; intensidad = .5; }
  else if (/[¿?][^¡!¿?]*$/.test(cola)) { expresion = "sorpresa"; intensidad = .34; }
  if (expresion === ultimaExpresion) return;
  ultimaExpresion = expresion;
  director.setExpression(expresion, intensidad);
}

function resize() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * pixelRatio);
  canvas.height = Math.round(innerHeight * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  viewport = { width: innerWidth, height: innerHeight, pixelRatio };
}

// Boca guiada por la alineación del agente, cuando el proveedor la manda.
//
// El analizador sigue mandando en una cosa —cuánta voz hay ahora mismo— y la
// alineación en la otra —qué sonido es—. Se mezclan así porque cada uno acierta
// en lo suyo: la energía sabe de silencios y de acentos, y la alineación sabe
// que una /u/ redondea aunque suene flojito.
//
// Si no hay alineación (los otros proveedores, o un trozo sin ella) no se toca
// nada y la boca se deduce del espectro, como siempre.
function aplicarBocaAlineada(reading) {
  const postura = sesion?.posturaDeBoca?.();
  if (!postura) return;

  // Con la voz apagada la boca se cierra aunque la alineación diga otra cosa:
  // el final de una palabra no es el final del sonido.
  const fuerza = Math.min(1, reading.energy * 3.2);
  reading.open = postura.open * fuerza;
  reading.spread = postura.spread;
  reading.round = postura.round;
  reading.press = Math.max(reading.press, postura.press * fuerza);
  reading.alineada = true;
}

function render(now) {
  const reading = connected ? voice.read(now) : null;
  if (reading) seguirFinDeTurno(reading, now);
  if (reading) aplicarBocaAlineada(reading);
  const pose = director.update(now, reading);
  renderer.draw(ctx, viewport, pose);
  requestAnimationFrame(render);
}

// Punto de inspección para ajustar la actuación desde la consola del navegador:
// `catalina.director.setState("speaking")` o `catalina.voice.read(performance.now())`.
window.catalina = {
  director,
  voice,
  sesiones,
  manejadores,
  // La reunión, para poder mirarla desde la consola cuando algo no cuadra:
  // `catalina.memoria.turnos.length`, `catalina.escucha.diagnostico()`.
  memoria,
  escucha,
  get session() { return sesion; },
  get disponible() { return disponible; },
  get proveedor() { return proveedor; },
  expresionDeFrase: aplicarExpresionDeFrase,
  get renderer() { return renderer; },
  get viewport() { return viewport; }
};
