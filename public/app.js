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
import { LiveSession } from "./realtime/live-session.js";
import { dibujarRuta } from "./mapa.js";
import { EscuchaDeReunion, escuchaDisponible } from "./escucha.js";
import { GrabadoraDeReunion, grabadoraDisponible } from "./grabadora.js";
import { conectarConReunion, puenteDisponible } from "./puente-meet.js";
import {
  nuevaReunion, guardarReunion, leerReuniones, elegirReunion, consultarReunion, indiceDeReuniones,
  calidad, duracion, palabras, pedirMinuta, enviarMinutaPorCorreo, cabecerasDeClavePropia, transcripcionComoTexto
} from "./reuniones.js";
import { PLANTILLAS, plantillaDe } from "./plantillas-acta.js";

const canvas = document.querySelector("#avatar");
const ctx = canvas.getContext("2d");
const image = new Image();

const ui = {
  stage: document.querySelector("#stage"),
  status: document.querySelector("#status"),
  signal: document.querySelector("#signal"),
  caption: document.querySelector("#caption"),
  oyendo: document.querySelector("#oyendo"),
  oyendoTexto: document.querySelector("#oyendoTexto"),
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
  toggleCaption: document.querySelector("#toggleCaption"),
  togglePanel: document.querySelector("#togglePanel"),
  controls: document.querySelector(".controls"),
  connect: document.querySelector("#connect"),
  mute: document.querySelector("#mute"),
  meetMode: document.querySelector("#meetMode"),
  exitMeet: document.querySelector("#exitMeet"),
  participar: document.querySelector("#participar"),
  reunionTipo: document.querySelector("#reunionTipo"),
  reunionTipoAyuda: document.querySelector("#reunionTipoAyuda"),
  reunionPuenteAviso: document.querySelector("#reunionPuenteAviso"),
  guiaMeet: document.querySelector("#guiaMeet"),
  guiaMeetCerrar: document.querySelector("#guiaMeetCerrar"),
  reunionDialogo: document.querySelector("#reunionDialogo"),
  reunionForm: document.querySelector("#reunionForm"),
  reunionCancelar: document.querySelector("#reunionCancelar"),
  reunionAlta: document.querySelector("#reunionAlta"),
  reunionPestana: document.querySelector("#reunionPestana"),
  reunionContinuar: document.querySelector("#reunionContinuar"),
  reunionContinuarCasilla: document.querySelector("#reunionContinuarCasilla"),
  reunionContinuarTexto: document.querySelector("#reunionContinuarTexto"),
  reunionAviso: document.querySelector("#reunionAviso"),
  reunionAvisoTitulo: document.querySelector("#reunionAvisoTitulo"),
  reunionAvisoDetalle: document.querySelector("#reunionAvisoDetalle"),
  reunionAvisoAbrir: document.querySelector("#reunionAvisoAbrir"),
  reunionAvisoCerrar: document.querySelector("#reunionAvisoCerrar"),
  audio: document.querySelector("#remoteAudio")
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
    conexion = { proveedor, inicio: Date.now(), fin: null };
    ultimoFallo = null;
    hayActividad();
    calentarUbicacion();   // deja lista la zona antes de que nadie pregunte
    // Que sepa qué reuniones hay guardadas y, si la sesión se abre con una en
    // curso, que la está escuchando. Un momento después: el primer mensaje del
    // protocolo tiene que llegar antes.
    setTimeout(() => {
      presentarReunionesGuardadas();
      if (puenteReunion) sesion.mezclarEntrada?.(puenteReunion.flujo);
      if (enModoMeet && reunionActual) {
        presentarReunionACatalina();
        memoriaEnviadaHasta = Math.max(0, reunionActual.navegador.length - 40);
        memoriaCaracteres = 0;
        pasarReunionAMemoria();
        // Si se pidió su participación antes de que hubiera sesión, empieza
        // ahora; si no, se queda escuchando en silencio como siempre.
        if (participacionPendiente) prepararParticipacion();
        else if (!participando && !sesion.muted) { sesion.pausarEnvio(true); micCortadoPorMeet = true; }
      }
    }, 1500);
    mostrarAviso("");   // si el intento anterior falló, su aviso ya no aplica
    ui.signal.classList.add("online");
    ui.connect.textContent = "Finalizar";
    ui.connect.disabled = false;
    ui.mute.disabled = false;
  },
  onDisconnected: () => {
    connected = false;
    cerrarConsumoDeConexion();
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
    if (enModoMeet && phase === "speaking") {
      escucha.ensordecer(true);
      señalar("Respondiendo…", "respondiendo");
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
    // Texto vacío = la respuesta anterior se cortó (alguien habló encima): lo
    // que alcanzó a decir también forma parte de la reunión.
    if (!text) registrarTurnoDeCatalina({ interrumpida: true });
    else { turnoCatalina.inicio ||= Date.now(); turnoCatalina.texto = text; }
    anotarTurno(text);
    aplicarExpresionDeFrase(text);
  },
  onResponseDone: () => {
    respuestaCerrada = true;
    registrarTurnoDeCatalina();
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
  gemini: new GeminiSession(manejadores),
  live: new LiveSession(manejadores)
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

const disponible = { elevenlabs: false, openai: false, gemini: false, live: false };

// Prueba de una voz concreta desde la dirección: ?voz=live (GPT-Live con
// razonamiento de Claude), ?voz=openai, etc. Va sola, sin relevo, para que un
// fallo se vea en vez de quedar tapado por otra voz.
const VOZ_PEDIDA = new URLSearchParams(location.search).get("voz");
const vozDePrueba = VOZ_PEDIDA && Object.hasOwn(sesiones, VOZ_PEDIDA) ? VOZ_PEDIDA : null;
let proveedor = null;
let sesion = null;
let ultimoFallo = null;   // el motivo del último corte, para no perderlo al desconectar

function proveedoresUtiles() {
  if (vozDePrueba) return disponible[vozDePrueba] ? [vozDePrueba] : [];
  return ORDEN.filter(nombre => disponible[nombre]);
}

async function conectar() {
  const cadena = proveedoresUtiles();
  if (!cadena.length) {
    setStatus("No hay ninguna voz configurada");
    mostrarAviso(vozDePrueba === "live"
      ? "GPT-Live necesita OPENAI_API_KEY (con acceso a gpt-live-1) y ANTHROPIC_API_KEY en el servidor."
      : "Falta la clave de ElevenLabs, de OpenAI o de Gemini para poder conversar.");
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
ui.meetMode.addEventListener("click", () => abrirDialogoDeReunion());
ui.exitMeet.addEventListener("click", () => salirDeModoMeet());
ui.toggleCaption.addEventListener("click", () => fijarSubtitulos(!verSubtitulos));
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
document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea")) return;
  const tecla = event.key.toLowerCase();
  if (tecla === "h") {
    ui.stage.classList.contains("meet") ? salirDeModoMeet() : abrirDialogoDeReunion();
  }
  if (tecla === "s") fijarSubtitulos(!verSubtitulos);
  if (tecla === "p" && enModoMeet) alternarParticipacion();
  if (event.key === "Escape") {
    if (verPanel) fijarPanel(false);
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
// El micrófono queda abierto pero Catalina no habla salvo que la llamen por su
// nombre. Para que eso no cueste una fortuna, la reunión no se le manda al
// modelo de voz: la transcribe el navegador, gratis, y sólo cuando alguien
// dice «Catalina» se le envía lo hablado como texto y se le pide que conteste.
//
// La sesión de voz sigue abierta pero con el micrófono cortado, así que no se
// envía audio y no se paga por escuchar; a cambio responde al instante y con su
// voz, sin tener que reconectar.
//
// Además de eso, ahora:
//   · Cada reunión es un registro guardado (reuniones.js) con sus datos, su
//     transcripción y su minuta. Ya no se borra al volver a entrar.
//   · Opcionalmente se graba en alta fidelidad (grabadora.js), incluido el
//     audio de la pestaña del Meet, que el navegador por sí solo no oye.
//   · Lo que se va diciendo pasa a la memoria de Catalina cada pocos minutos,
//     y para lo que no quepa tiene la herramienta consultar_reunion.
//   · Se puede transcribir sin sesión de voz abierta: si nadie necesita que
//     Catalina conteste, no hay por qué pagar la sesión.
const escucha = new EscuchaDeReunion({
  alTranscribir: (texto, segmento) => {
    hayActividad();                       // la reunión cuenta como vida
    señalar("Escuchando · " + texto, "");  // se ve lo último entendido
    if (reunionActual) {
      reunionActual.navegador.push(segmento);
      guardarPronto();
    }
  },
  alLlamarla: (peticion, contexto) => atenderLlamado(peticion, contexto),
  alFallar: motivo => señalar(motivo, "problema"),
  alEstado: estado => {
    if (estado === "reconectando") señalar("Reconectando la escucha…", "problema");
  }
});

const grabadora = new GrabadoraDeReunion({
  transcribir: (audio, meta) => pedirTranscripcion(audio, meta),
  alSegmento: segmento => {
    if (!reunionEnGrabacion) return;
    reunionEnGrabacion.hd.push(segmento);
    guardarPronto(reunionEnGrabacion);
  },
  alFallo: fallo => {
    console.warn("Alta fidelidad: tramo sin transcribir", fallo.error);
    if (!reunionEnGrabacion) return;
    reunionEnGrabacion.hdFallidos.push(fallo);
    guardarPronto(reunionEnGrabacion);
    if (enModoMeet) señalar(`Un tramo no se transcribió en alta fidelidad (${fallo.error}); queda el del navegador`, "problema");
  },
  alEstado: (texto, estado) => { if (estado === "problema") señalar(texto, estado); }
});

async function pedirTranscripcion(audio, { previo }) {
  const r = await fetch("/reunion/transcribir", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecerasDeClavePropia(["openai", "gemini"]) },
    body: JSON.stringify({ audio, previo, idioma: "es" })
  });
  return await r.json().catch(() => ({ ok: false, error: `El servidor respondió ${r.status}` }));
}

// La señal de escucha es lo único visible en modo reunión. Muestra lo último
// que entendió el navegador, que además sirve para ver si transcribe bien.
function señalar(texto, estado = "") {
  ui.oyendoTexto.textContent = texto;
  ui.oyendo.dataset.estado = estado;
}

let enModoMeet = false;
let micCortadoPorMeet = false;
let reunionActual = null;       // la que se está escuchando ahora
let reunionEnGrabacion = null;  // la que recibe los tramos de alta fidelidad (puede terminar después)
let relojGuardado = null;
let relojMemoria = null;
let memoriaEnviadaHasta = 0;    // índice del último segmento pasado a Catalina
let memoriaCaracteres = 0;

// Se guarda como mucho cada 4 s: localStorage es síncrono y una reunión larga
// pesa. Al cerrar la pestaña se guarda de inmediato.
function guardarPronto(reunion = reunionActual) {
  if (!reunion) return;
  clearTimeout(relojGuardado);
  relojGuardado = setTimeout(() => guardarReunion(reunion), 4000);
}
window.addEventListener("pagehide", () => {
  if (reunionActual) {
    reunionActual.estadisticas = { ...escucha.estadisticas };
    guardarReunion(reunionActual);
  }
});

// El diálogo recoge los datos de la reunión antes de empezar. Van a la minuta:
// sin objetivo ni participantes, el modelo tiene que adivinarlos.
function abrirDialogoDeReunion() {
  if (enModoMeet) return;
  const ultima = leerReuniones().at(-1);
  const reciente = ultima && ultima.meta.fin && Date.now() - ultima.meta.fin < 45 * 60000;
  ui.reunionContinuar.hidden = !reciente;
  ui.reunionContinuarTexto.textContent = reciente ? `Continuar «${ultima.meta.titulo}»` : "";
  ui.reunionContinuarCasilla.checked = false;
  ui.reunionAlta.disabled = !grabadoraDisponible();
  // Sin clave de transcripción (del servidor o propia) la alta fidelidad sólo
  // acumularía tramos fallidos: se desactiva y se dice por qué.
  fetch("/reunion/estado").then(r => r.json()).then(estado => {
    const propia = cabecerasDeClavePropia(["openai", "gemini"])["X-Proveedor-Propio"];
    const hay = estado?.transcripcion?.openai || estado?.transcripcion?.gemini || propia;
    if (!hay) {
      ui.reunionAlta.checked = false;
      ui.reunionAlta.disabled = true;
      ui.reunionAlta.title = "Falta una clave de OpenAI o Gemini en el servidor (o una clave propia en la página de Actas).";
    }
  }).catch(() => {});
  ui.reunionPestana.disabled = !puenteDisponible();
  avisarSinAltaFidelidad();
  ui.reunionDialogo.showModal();
}

ui.reunionForm.addEventListener("submit", evento => {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(ui.reunionForm));
  ui.reunionDialogo.close();
  // Todo lo que pide permisos va antes de cualquier espera: el navegador sólo
  // deja compartir una pestaña dentro del clic que lo pidió.
  entrarEnModoMeet({
    titulo: datos.titulo,
    objetivo: datos.objetivo,
    participantes: datos.participantes,
    agenda: datos.agenda,
    enlaces: datos.enlaces,
    lugar: datos.lugar,
    tipo: datos.tipo,
    alta: ui.reunionAlta.checked,
    pestana: ui.reunionPestana.checked,
    continuar: ui.reunionContinuarCasilla.checked
  });
});
ui.reunionCancelar.addEventListener("click", () => ui.reunionDialogo.close());
// Conectar con la reunión y la alta fidelidad son independientes: el puente
// hace que Catalina oiga la videollamada; la alta fidelidad, que lo que dicen
// los demás quede transcrito en el acta. Sin ella se avisa, porque el
// reconocimiento del navegador sólo oye el micrófono.
function avisarSinAltaFidelidad() {
  const falta = ui.reunionPestana.checked && !ui.reunionAlta.checked;
  ui.reunionPuenteAviso.hidden = !falta;
}
ui.reunionAlta.addEventListener("change", avisarSinAltaFidelidad);
ui.reunionPestana.addEventListener("change", avisarSinAltaFidelidad);

async function entrarEnModoMeet(opciones = {}) {
  ui.stage.classList.add("meet");
  if (enModoMeet) return;
  enModoMeet = true;
  ui.oyendo.hidden = false;
  ocultarAvisoDeReunion();

  // La reunión: nueva, o la anterior si se pidió continuarla.
  const ultima = leerReuniones().at(-1);
  if (opciones.continuar && ultima) {
    reunionActual = ultima;
    reunionActual.meta.fin = null;
  } else {
    reunionActual = nuevaReunion(opciones);
  }
  guardarReunion(reunionActual);
  memoriaEnviadaHasta = reunionActual.navegador.length;
  memoriaCaracteres = 0;

  // El puente con la videollamada primero: compartir una pestaña sólo se
  // permite dentro del clic que lo pidió, antes de cualquier espera.
  const pedidoPuente = opciones.pestana && puenteDisponible()
    ? conectarConReunion({ alTerminar: () => cerrarPuente("Se dejó de compartir la pestaña de la reunión: Catalina ya no la oye (sigo grabando el micrófono)") })
    : null;
  let avisoAlta = "";
  if (pedidoPuente) {
    const r = await pedidoPuente;
    if (r.ok) {
      puenteReunion = r;
      reunionActual.conectadaAMeet = true;
      if (connected) sesion?.mezclarEntrada?.(r.flujo);
      mostrarGuiaDePresentacion();
    } else {
      avisoAlta = r.error;
    }
  }

  const alta = opciones.alta && grabadoraDisponible()
    ? grabadora.iniciar({ flujoReunion: puenteReunion?.flujo })
    : null;

  if (alta) {
    reunionEnGrabacion = reunionActual;
    reunionActual.alta = true;
    const r = await alta;
    if (!r.ok) {
      avisoAlta = r.error;
      reunionEnGrabacion = null;
    }
  }

  if (!escuchaDisponible()) {
    // Sin reconocimiento de voz el modo sigue sirviendo para capturar la
    // pantalla y, si está activa, para grabar en alta fidelidad.
    señalar(alta && !avisoAlta ? "Grabando en alta fidelidad · este navegador no transcribe en vivo (usa Chrome para llamarme por mi nombre)" : "Este navegador no puede transcribir. Usa Chrome.", "problema");
    return;
  }

  // Se deja de enviar audio al modelo sin apagar la pista: quien escucha ahora
  // es el navegador, y con la pista apagada no oiría nada.
  if (connected && sesion && !sesion.muted) {
    sesion.pausarEnvio(true);
    micCortadoPorMeet = true;
    ui.mute.textContent = "Activar micrófono";
  }
  escucha.olvidar();
  if (escucha.empezar()) {
    const partes = ["Escuchando"];
    if (puenteReunion) partes.push("conectada a la videollamada");
    if (reunionEnGrabacion) partes.push(grabadora.conPestana ? "alta fidelidad con audio de la reunión" : "alta fidelidad (micrófono)");
    partes.push(connected ? (puenteReunion ? "P para que participe" : "di «Catalina» para hablarme") : "sólo transcribo: inicia la conversación si quieres que responda");
    señalar(avisoAlta || partes.join(" · "), avisoAlta ? "problema" : "");
    setStatus("En reunión");
    if (connected) presentarReunionACatalina();
    clearInterval(relojMemoria);
    relojMemoria = setInterval(pasarReunionAMemoria, (configMemoria.cadaSegundos || 90) * 1000);
  } else {
    señalar("No se pudo iniciar la escucha", "problema");
  }
}

async function salirDeModoMeet() {
  ui.stage.classList.remove("meet");
  if (!enModoMeet) return;
  if (participando || participacionPendiente) desactivarParticipacion({ alSalir: true });
  enModoMeet = false;
  cerrarPuente();

  escucha.parar();
  clearInterval(relojMemoria);
  ui.oyendo.hidden = true;
  // Sólo se devuelve el micrófono si fue este modo quien lo quitó.
  if (micCortadoPorMeet && sesion?.muted) {
    sesion.pausarEnvio(false);
    ui.mute.textContent = "Silenciar micrófono";
  }
  micCortadoPorMeet = false;
  setStatus(connected ? "Te escucho" : "Lista para comenzar");

  const reunion = reunionActual;
  reunionActual = null;
  if (!reunion) return;
  reunion.meta.fin = Date.now();
  reunion.estadisticas = { ...escucha.estadisticas };
  pasarReunionAMemoria(reunion);
  guardarReunion(reunion);
  mostrarAvisoDeReunion(reunion, reunionEnGrabacion === reunion ? "Terminando la transcripción de alta fidelidad…" : "");

  // La grabadora termina su cola después: lo último que se dijo también tiene
  // que quedar transcrito antes de dar la reunión por cerrada.
  if (reunionEnGrabacion === reunion) {
    await grabadora.detener();
    reunionEnGrabacion = null;
    guardarReunion(reunion);
    mostrarAvisoDeReunion(reunion);
  }
  if (connected) {
    sesion?.anadirContexto?.(`[Sistema] La reunión «${reunion.meta.titulo}» terminó: ${Math.round(duracion(reunion) / 60000)} minutos, `
      + `${palabras(reunion)} palabras transcritas. Para responder sobre su contenido usa consultar_reunion; para el acta, generar_minuta.`);
  }
}

// Se le cuenta a Catalina que empezó una reunión y de qué va, para que sepa
// qué son los fragmentos que le irán llegando.
function presentarReunionACatalina() {
  const m = reunionActual?.meta;
  if (!m || !sesion?.anadirContexto) return;
  sesion.anadirContexto([
    `[Sistema] Empezó la reunión «${m.titulo}» y la estás escuchando en silencio.`,
    m.objetivo ? `Objetivo: ${m.objetivo}.` : "",
    m.participantes ? `Participantes: ${m.participantes}.` : "",
    m.agenda ? `Agenda: ${m.agenda}.` : "",
    "Te llegarán fragmentos de la transcripción: no respondas a ellos; contesta sólo cuando te llamen por tu nombre."
  ].filter(Boolean).join(" "));
}

// Lo nuevo de la reunión pasa a la memoria de la conversación como contexto
// silencioso. Hay un tope por sesión: una reunión de horas no cabe en el
// contexto de un modelo de voz, y para eso está consultar_reunion.
function pasarReunionAMemoria(reunion = reunionActual) {
  if (!reunion || !connected || !sesion?.anadirContexto) return;
  // Mientras participa, Catalina oye la sala en directo: repetírsela como
  // texto sería duplicarla. Se avanza el puntero para que, al volver a
  // activarla, sólo reciba lo que se dijo mientras no participaba.
  if (participando) { memoriaEnviadaHasta = reunion.navegador.length; return; }
  const nuevos = reunion.navegador.slice(memoriaEnviadaHasta).filter(s => s.texto);
  memoriaEnviadaHasta = reunion.navegador.length;
  if (!nuevos.length) return;
  const maximo = configMemoria.maxCaracteresPorSesion || 30000;
  if (memoriaCaracteres >= maximo) return;
  const hora = t => new Date(t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  let texto = nuevos.map(s => s.texto).join(" ");
  texto = texto.slice(0, maximo - memoriaCaracteres);
  memoriaCaracteres += texto.length;
  const aviso = memoriaCaracteres >= maximo ? " (Límite de memoria alcanzado: lo que siga, consúltalo con consultar_reunion.)" : "";
  sesion.anadirContexto(`[Transcripción de «${reunion.meta.titulo}», ${hora(nuevos[0].momento)}–${hora(nuevos.at(-1).momento)}. Contexto, no respondas a esto.] ${texto}${aviso}`);
}

// La llamaron por su nombre en mitad de la reunión.
async function atenderLlamado(peticion, contexto) {
  if (reunionActual) {
    const s = Math.round((Date.now() - reunionActual.meta.inicio) / 1000);
    const marca = [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, "0")).join(":");
    reunionActual.intervenciones.push({ momento: Date.now(), marca, pregunta: peticion });
    guardarPronto();
  }
  // Participando, ya oyó la pregunta por su propio micrófono y contestará
  // sola: mandársela además por texto la haría responder dos veces.
  if (participando) return;
  if (!connected || !sesion) {
    // Sin sesión abierta no puede contestar; se avisa en vez de perder lo dicho.
    señalar("Me llamaste, pero la sesión de voz está cerrada (sigo transcribiendo)", "problema");
    return;
  }
  hayActividad();
  // Lo pendiente de pasar a memoria se pasa ahora: la pregunta puede ser sobre
  // lo que se acaba de decir.
  pasarReunionAMemoria();

  // Se le da lo hablado y lo que le piden, separados, para que sepa qué es
  // contexto y qué es la pregunta.
  const mensaje = [
    `Estás escuchando la reunión «${reunionActual?.meta.titulo || "en curso"}». Esto es lo que se ha dicho, transcrito automáticamente:`,
    "",
    contexto || "(todavía no hay nada transcrito)",
    "",
    `Acaban de dirigirse a ti y te han pedido: «${peticion}»`,
    "",
    "Responde sólo a eso, breve y en voz alta. No resumas la reunión entera salvo que te lo pidan.",
    "Si necesitas una parte de la reunión que no está arriba, usa consultar_reunion.",
    "La transcripción es automática y puede tener errores: si algo no cuadra, dilo en vez de darlo por cierto."
  ].join("\n");

  const enviado = sesion.enviarTexto(mensaje);
  señalar(enviado ? `Te oí: «${peticion}»` : "No pude enviar tu pregunta", enviado ? "respondiendo" : "problema");
  setStatus("Respondiendo…");
}

// Aviso al terminar: la reunión quedó guardada y desde aquí se abre la minuta.
function mostrarAvisoDeReunion(reunion, estado = "") {
  const q = calidad(reunion);
  ui.reunionAvisoTitulo.textContent = reunion.meta.titulo;
  ui.reunionAvisoDetalle.textContent = estado || [
    `${Math.round(duracion(reunion) / 60000)} min`,
    `${q.palabras} palabras`,
    `transcripción ${q.fuente}`,
    q.huecos ? `${q.huecos} hueco(s) sin audio` : "sin huecos detectados"
  ].join(" · ");
  ui.reunionAvisoAbrir.href = `minuta.html?id=${encodeURIComponent(reunion.id)}`;
  ui.reunionAvisoAbrir.textContent = reunion.minuta ? "Ver acta" : "Generar acta";
  ui.reunionAviso.hidden = false;
}
function ocultarAvisoDeReunion() { ui.reunionAviso.hidden = true; }
ui.reunionAvisoCerrar.addEventListener("click", ocultarAvisoDeReunion);

// Herramientas de reuniones.
function consultarReunionHerramienta(argumentos) {
  const reunion = elegirReunion(argumentos.reunion, reunionActual?.id);
  if (!reunion) return { ok: false, error: "No hay ninguna reunión guardada en este navegador." };
  // La que está en curso se consulta con lo último, aunque aún no se guardara.
  const fuente = reunion.id === reunionActual?.id ? reunionActual : reunion;
  return consultarReunion(fuente, String(argumentos.pregunta || ""));
}

let minutaEnCurso = null;
function generarMinutaHerramienta(argumentos) {
  const reunion = elegirReunion(argumentos.reunion || "ultima", reunionActual?.id);
  if (!reunion) return { ok: false, error: "No hay ninguna reunión guardada en este navegador." };
  const fuente = reunion.id === reunionActual?.id ? reunionActual : reunion;
  if (palabras(fuente) < 15) return { ok: false, error: "La reunión casi no tiene transcripción: no hay material para un acta." };
  if (minutaEnCurso) return { ok: false, error: "Ya estoy redactando una minuta; espera a que termine." };
  const nivel = argumentos.nivel === "estandar" ? "estandar" : "detallado";

  // Se devuelve enseguida: la minuta tarda más de lo que la herramienta puede
  // esperar, y Catalina tiene que poder seguir conversando mientras tanto.
  const tipo = PLANTILLAS[argumentos.tipo] ? argumentos.tipo : null;
  if (tipo) fuente.meta.tipo = tipo;
  minutaEnCurso = pedirMinuta(fuente, { nivel, tipo }).then(async r => {
    minutaEnCurso = null;
    if (!r.ok) {
      sesion?.anadirContexto?.(`[Sistema] No se pudo generar el acta de «${fuente.meta.titulo}»: ${r.error}. Díselo a la persona.`);
      mostrarAviso(`No se pudo generar el acta: ${r.error}`);
      return;
    }
    fuente.minuta = r.minuta;
    fuente.trazabilidad = r.trazabilidad;
    guardarReunion(fuente);
    mostrarAvisoDeReunion(fuente, "Acta lista · ábrela para revisarla y exportarla a PDF, HTML o correo");
    let enviado = "";
    if (argumentos.enviar_por_correo) {
      const e = await enviarMinutaPorCorreo(fuente);
      enviado = e.ok ? ` Se envió por correo a ${e.destinatario} (one pager y Markdown; para adjuntar el acta completa con su formato, envíala desde la página de actas).` : ` El correo falló: ${e.error}.`;
    }
    sesion?.anadirContexto?.(`[Sistema] El acta de «${fuente.meta.titulo}» está lista; se abre con el botón «Ver acta» en pantalla. `
      + `Mensaje clave: ${r.minuta.onePager.mensajeClave} Decisiones: ${r.minuta.onePager.decisiones.join("; ") || "ninguna registrada"}.${enviado} `
      + "Avísale a la persona de forma breve.");
    if (connected && !enModoMeet) sesion?.enviarTexto?.("[Sistema] El acta terminó. Avísalo en una frase.");
  });
  mostrarAvisoDeReunion(fuente, `Redactando el acta (${nivel})… tarda uno o dos minutos`);
  return { ok: true, estado: "generando", reunion: fuente.meta.titulo, nivel, mensaje: "Tardará uno o dos minutos; te avisaré cuando esté lista." };
}

// Al abrir una conversación nueva, Catalina sabe qué reuniones hay guardadas.
// Sin esto, en la sesión siguiente a una reunión no tenía ni noticia de ella.
function presentarReunionesGuardadas() {
  const indice = indiceDeReuniones(5);
  if (!indice.length || !sesion?.anadirContexto) return;
  sesion.anadirContexto(`[Sistema] Reuniones transcritas disponibles en este equipo, de la más reciente a la más antigua: ${indice.join("; ")}. `
    + "Si te preguntan por ellas, consulta con consultar_reunion antes de responder.");
}

let configMemoria = { cadaSegundos: 90, maxCaracteresPorSesion: 30000 };

// Tipo de reunión: decide el formato del acta (plantillas-acta.js). Se elige
// al empezar y se puede cambiar después, en la página de actas.
ui.reunionTipo.innerHTML = Object.values(PLANTILLAS).map(p => `<option value="${p.id}">${p.nombre}</option>`).join("");
const describirTipo = () => { ui.reunionTipoAyuda.textContent = plantillaDe(ui.reunionTipo.value).descripcion; };
ui.reunionTipo.addEventListener("change", describirTipo);
describirTipo();

// Lo que dice Catalina durante una reunión.
//
// Se guarda aparte de la transcripción de los participantes: es una asistente
// de IA y el acta tiene que poder distinguir lo que aportó ella de lo que dijo
// el equipo. Se registra cada respuesta completa (o lo que alcanzó a decir si
// la interrumpieron), con la hora en que empezó a hablar.
const turnoCatalina = { texto: "", inicio: 0 };
function registrarTurnoDeCatalina({ interrumpida = false } = {}) {
  const texto = turnoCatalina.texto.trim();
  const inicio = turnoCatalina.inicio;
  turnoCatalina.texto = "";
  turnoCatalina.inicio = 0;
  if (!texto || !enModoMeet || !reunionActual) return;
  reunionActual.catalina ||= [];
  reunionActual.catalina.push({ momento: inicio || Date.now(), texto: interrumpida ? `${texto} (interrumpida)` : texto });
  guardarPronto();
}

// Participación de Catalina.
//
// Por defecto escucha en silencio y sólo contesta si la llaman por su nombre.
// Con «Participar Catalina» pasa a ser una interlocutora más:
//   1. se guarda la reunión tal como está;
//   2. se le entrega lo dicho hasta ahora (o desde su última participación)
//      como memoria, junto con el objetivo y el foco de su participación;
//   3. se abre su micrófono: oye la sala y conversa en directo.
// Al desactivarlo se cierra su micrófono y la reunión sigue grabándose. Cada
// activación abre un tramo de participación que queda en el acta.
//
// Límite físico: Catalina oye lo que llega a este micrófono. Si la reunión se
// escucha con audífonos, no oirá a quienes hablan por el Meet.
let participando = false;
let participacionPendiente = false;

// Puente con la videollamada (puente-meet.js). Mientras existe, el audio de la
// reunión entra al oído de Catalina junto con el micrófono y se graba en alta
// fidelidad. Sólo llega al modelo cuando participa: el resto del tiempo su
// entrada está en pausa, igual que el micrófono.
let puenteReunion = null;

function cerrarPuente(motivo = "") {
  if (!puenteReunion) return;
  const puente = puenteReunion;
  puenteReunion = null;
  sesion?.mezclarEntrada?.(null);
  puente.detener();
  if (motivo && enModoMeet) señalar(motivo, "problema");
}

// La otra mitad del puente la hace la videollamada: presentar la pestaña de
// Catalina con su audio. El aviso se muestra sólo unos segundos, porque todo
// lo que aparece en esta pantalla lo verán los demás al presentarla.
function mostrarGuiaDePresentacion() {
  ui.guiaMeet.hidden = false;
  clearTimeout(mostrarGuiaDePresentacion.reloj);
  mostrarGuiaDePresentacion.reloj = setTimeout(() => { ui.guiaMeet.hidden = true; }, 20000);
}

function alternarParticipacion() {
  if (!enModoMeet || !reunionActual) return;
  if (participando || participacionPendiente) desactivarParticipacion();
  else activarParticipacion();
}

function activarParticipacion() {
  participacionPendiente = true;
  ui.participar.setAttribute("aria-pressed", "true");
  ui.participar.textContent = "Catalina participa · detener";
  // 1. Lo transcrito hasta ahora queda guardado antes de abrir la conversación.
  reunionActual.estadisticas = { ...escucha.estadisticas };
  reunionActual.participacion ||= [];
  reunionActual.participacion.push({ desde: Date.now(), hasta: null });
  guardarReunion(reunionActual);
  if (!connected || !sesion) {
    señalar("Conectando con Catalina para que participe…", "respondiendo");
    if (!ui.connect.disabled) conectar();
    // Si la voz no llega a conectarse, el tramo no puede quedar abierto: se
    // cierra y se dice, y la reunión sigue grabándose.
    setTimeout(() => {
      if (!participacionPendiente) return;
      desactivarParticipacion();
      señalar("No se pudo conectar la voz de Catalina: sigue grabando sin su participación", "problema");
    }, 15000);
    return;
  }
  prepararParticipacion();
}

function prepararParticipacion() {
  if (!participacionPendiente || !sesion?.anadirContexto) return;
  participacionPendiente = false;
  participando = true;
  // 2. Memoria: lo dicho hasta ahora y el encargo.
  sesion.anadirContexto(mensajeDeParticipacion());
  memoriaEnviadaHasta = reunionActual.navegador.length;
  // La entrada: el contexto por sí solo no la hace hablar, y quien pulsó el
  // botón espera que se incorpore.
  sesion.enviarTexto("[Sistema] Incorpórate ahora a la reunión con una intervención de una o dos frases: dónde está la conversación respecto de su objetivo y, si corresponde, la pregunta o el vacío más importante.");
  // 3. Micrófono abierto: oye la sala y habla cuando aporta.
  sesion.pausarEnvio(false);
  micCortadoPorMeet = false;
  ui.mute.textContent = "Silenciar micrófono";
  señalar("Catalina participa · conversa con la sala (P para detener)", "respondiendo");
}

function desactivarParticipacion({ alSalir = false } = {}) {
  participando = false;
  participacionPendiente = false;
  ui.participar.setAttribute("aria-pressed", "false");
  ui.participar.textContent = "Participar Catalina";
  const tramo = reunionActual?.participacion?.at(-1);
  if (tramo && !tramo.hasta) tramo.hasta = Date.now();
  registrarTurnoDeCatalina({ interrumpida: true });
  if (reunionActual) guardarReunion(reunionActual);
  if (alSalir) return;
  // La reunión sigue grabándose; Catalina vuelve a escuchar en silencio.
  if (connected && sesion && !sesion.muted) {
    sesion.pausarEnvio(true);
    micCortadoPorMeet = true;
    ui.mute.textContent = "Activar micrófono";
  }
  señalar("Escuchando · Catalina ya no participa (sigue grabando)");
}

// El encargo de participación. Lo que se le pide está en el foco que definió
// el Dr. Paredes: entender lo tratado, aportar literatura, empujar los
// objetivos, llenar vacíos, proponer acuerdos y hacer las preguntas que nadie
// hizo. Y hacerlo como una participante, no como una conferenciante.
function mensajeDeParticipacion() {
  const r = reunionActual;
  const m = r.meta;
  const primera = (r.participacion || []).length <= 1;
  let transcrito = transcripcionComoTexto(r);
  const MAX = 14000;
  if (transcrito.length > MAX) {
    transcrito = transcrito.slice(0, 3000) + "\n[…parte intermedia omitida: consúltala con consultar_reunion…]\n" + transcrito.slice(-(MAX - 3000));
  }
  return [
    `[Sistema] ${primera ? "Desde ahora participas" : "Vuelves a participar"} en directo en la reunión «${m.titulo}» (${plantillaDe(m.tipo).nombre}). ${puenteReunion ? "Oyes a la persona que te conectó por su micrófono y a los demás participantes por la videollamada; todos te oyen a ti." : "Oyes la sala por el micrófono."}`,
    m.objetivo ? `Objetivo de la reunión: ${m.objetivo}.` : "Objetivo no declarado: dedúcelo de lo conversado y, si no está claro, pregúntalo.",
    m.participantes ? `Participantes: ${m.participantes}.` : "",
    m.agenda ? `Agenda: ${m.agenda}.` : "",
    `Transcripción automática de la reunión hasta este momento${primera ? "" : " (incluye tus intervenciones anteriores, marcadas CATALINA (IA))"}; puede tener errores de reconocimiento:`,
    transcrito || "(todavía no hay nada transcrito)",
    "Tu papel como participante:",
    "1) entender lo tratado y, si te lo piden, sintetizarlo con precisión;",
    "2) aportar literatura cuando ayude, buscándola con buscar_referencias y citando su fuente; nunca cites de memoria;",
    "3) ayudar a cumplir los objetivos de la reunión y señalar si la conversación se aleja de ellos;",
    "4) detectar vacíos o supuestos que nadie ha considerado;",
    "5) proponer acuerdos concretos (qué, quién, cuándo) para que el grupo los valide; no decides por el grupo;",
    "6) hacer las preguntas importantes que nadie ha hecho;",
    "y dar tu opinión fundamentada cuando te la pidan, distinguiendo lo que sabes de lo que supones.",
    "Forma: intervenciones breves (dos a cuatro frases), una idea por vez, sin monopolizar la conversación. Si dos participantes están hablando entre ellos, no los interrumpas. Si lo último que se dijo no requiere tu aporte, responde con una confirmación muy breve o no añadas nada."
  ].filter(Boolean).join("\n");
}

ui.participar.addEventListener("click", alternarParticipacion);
ui.guiaMeetCerrar.addEventListener("click", () => { ui.guiaMeet.hidden = true; });

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
    const resultado = await despacharHerramienta(nombre, argumentos);
    anotarMaterialDeReunion(nombre);
    return resultado;
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

// Lo que Catalina muestra durante una reunión forma parte de ella: la minuta lo
// recoge como material de referencia.
function anotarMaterialDeReunion(nombre) {
  if (!reunionActual) return;
  const materiales = reunionActual.materiales;
  if (nombre === "buscar_imagen_medica" && laminaEnPantalla) {
    materiales.push(`Lámina: ${laminaEnPantalla.titulo}${laminaEnPantalla.fuente ? ` — ${laminaEnPantalla.fuente}` : ""}`);
  }
  if (nombre === "buscar_referencias") {
    for (const r of referenciasEnPantalla.slice(0, 8)) {
      materiales.push(`${r.titulo}${r.revista ? `, ${r.revista}` : ""}${r.anio ? ` (${r.anio})` : ""}${r.enlace ? ` — ${r.enlace}` : ""}`);
    }
  }
  reunionActual.materiales = [...new Set(materiales)];
  guardarPronto();
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
  if (nombre === "consultar_reunion") return consultarReunionHerramienta(argumentos);
  if (nombre === "generar_minuta") return generarMinutaHerramienta(argumentos);
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
      setStatus("Te escucho");
      return datos;
    }
    mostrarLlamada({ estado: "marcando", numero: argumentos.numero, objetivo: argumentos.objetivo });
    return datos;
  } catch (error) {
    console.error(error);
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
  ui.toggleCaption.setAttribute("aria-pressed", String(activo));
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
  // Un turno sin texto no deja rastro: pasa cuando la respuesta se interrumpe
  // antes de que llegue el primer delta.
  if (!turnoVivo.texto.textContent.trim()) turnoVivo.nodo.remove();
  else turnoVivo.nodo.dataset.vivo = "false";
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
    disponible.live = Boolean(estado.proveedores?.live);
  })
  .catch(() => {});

// Ajustes.
//
// Un panel para saber con qué se está hablando —proveedor, modelos, voz— y
// cuánto lleva la sesión. Elegir otra voz no guarda nada: se recarga con la
// voz en la dirección (?voz=…&vozLive=…), igual que al probar a mano.
const NOMBRES_DE_VOZ = {
  live: "GPT-Live + Claude",
  elevenlabs: "ElevenLabs (agente)",
  gemini: "Gemini Live",
  openai: "OpenAI Realtime"
};
const aj = {
  dialogo: document.querySelector("#ajustes"),
  abrir: document.querySelector("#abrirAjustes"),
  cerrar: document.querySelector("#ajustesCerrar"),
  enUso: document.querySelector("#ajustesEnUso"),
  proveedor: document.querySelector("#ajustesProveedor"),
  vozLive: document.querySelector("#ajustesVozLive"),
  vozLiveFila: document.querySelector("#ajustesVozLiveFila"),
  direccion: document.querySelector("#ajustesDireccion"),
  aplicar: document.querySelector("#ajustesAplicar"),
  consumo: document.querySelector("#ajustesConsumo"),
  consumoNota: document.querySelector("#ajustesConsumoNota"),
  modelos: document.querySelector("#ajustesModelos"),
  precios: document.querySelector("#ajustesPrecios")
};
let conexion = null;            // la conversación en curso o la última
let ajustesServidor = null;     // lo que devuelve /ajustes
let relojAjustes = null;
// Lo gastado en conversaciones anteriores de esta pestaña (sólo lo medible).
const acumulado = { usd: 0, sesiones: 0 };

function cerrarConsumoDeConexion() {
  if (!conexion || conexion.fin) return;
  conexion.fin = Date.now();
  const c = costoDeConexion();
  if (c?.total != null) {
    acumulado.usd += c.total;
    acumulado.sesiones += 1;
  }
}

function vozLiveEnUso() {
  const pedida = new URLSearchParams(location.search).get("vozLive");
  const voces = ajustesServidor?.vocesLive || [];
  return voces.includes(pedida) ? pedida : ajustesServidor?.modelos?.live?.voz || "marin";
}

// Costo de la conversación en curso (o la última). Sólo GPT-Live + Claude se
// mide; para las demás voces se devuelve null en vez de un número inventado.
function costoDeConexion() {
  if (!conexion || conexion.proveedor !== "live") return null;
  const datos = sesiones.live.consumo?.();
  if (!datos) return null;
  const porMinuto = ajustesServidor?.precios?.gptLive?.usdPorMinuto;
  const voz = Number.isFinite(porMinuto) ? datos.segundosVoz / 60 * porMinuto : null;
  const claude = datos.claude.sinPrecio ? null : datos.claude.usd;
  return { datos, voz, claude, total: voz != null && claude != null ? voz + claude : null };
}

function usd(valor) {
  if (valor == null) return "sin precio configurado";
  return "USD " + (valor < 0.01 ? valor.toFixed(4) : valor.toFixed(3));
}

function duracionTexto(segundos) {
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

function miles(n) {
  return Number(n || 0).toLocaleString("es-CL");
}

function pintarDatos(dl, pares) {
  dl.replaceChildren(...pares.flatMap(([etiqueta, valor, clase]) => {
    const dt = document.createElement("dt");
    dt.textContent = etiqueta;
    const dd = document.createElement("dd");
    dd.textContent = valor;
    if (clase) dd.className = clase;
    return [dt, dd];
  }));
}

function describirVoz(nombre) {
  const m = ajustesServidor?.modelos || {};
  if (nombre === "live") return {
    modelo: m.live?.modelo || "gpt-live-1",
    voz: vozLiveEnUso(),
    razonamiento: `${m.live?.razonamiento || "claude-sonnet-5-5"} (esfuerzo ${m.live?.esfuerzo || "low"})`
  };
  if (nombre === "openai") return { modelo: m.openai?.modelo || "—", voz: m.openai?.voz || "—", razonamiento: "el mismo modelo de voz" };
  if (nombre === "gemini") return { modelo: m.gemini?.modelo || "—", voz: m.gemini?.voz || "—", razonamiento: "el mismo modelo de voz" };
  if (nombre === "elevenlabs") return { modelo: "agente de ElevenLabs (se define en su panel)", voz: m.elevenlabs?.voz || "la del agente", razonamiento: "el LLM configurado en el agente" };
  return null;
}

function pintarEnUso() {
  const activa = connected ? proveedor : null;
  const prevista = activa || proveedoresUtiles()[0] || null;
  const d = describirVoz(prevista);
  pintarDatos(aj.enUso, [
    ["Estado", connected ? "Conversación activa" : "Sin conversación"],
    [connected ? "Proveedor" : "Proveedor al iniciar", prevista ? NOMBRES_DE_VOZ[prevista] : "ninguno disponible"],
    ...(d ? [["Modelo de voz", d.modelo], ["Voz", d.voz], ["Razonamiento", d.razonamiento]] : []),
    ["Modo", vozDePrueba ? `prueba (?voz=${vozDePrueba}), sin relevo` : "automático, con relevo"],
    ["Versión", ajustesServidor?.version || "—"]
  ]);
}

function pintarConsumo() {
  if (!conexion) {
    pintarDatos(aj.consumo, [["Duración", "—"]]);
    aj.consumoNota.textContent = "Inicia una conversación para medir su consumo.";
    return;
  }
  const segundos = ((conexion.fin || Date.now()) - conexion.inicio) / 1000;
  const c = costoDeConexion();
  if (!c) {
    pintarDatos(aj.consumo, [
      ["Proveedor", NOMBRES_DE_VOZ[conexion.proveedor] || conexion.proveedor],
      ["Duración", duracionTexto(segundos)]
    ]);
    aj.consumoNota.textContent = "El costo en tokens se mide por ahora sólo con GPT-Live + Claude. Para esta voz, revisa el panel de facturación del proveedor.";
    return;
  }
  const { datos, voz, claude, total } = c;
  const k = datos.claude;
  pintarDatos(aj.consumo, [
    ["Duración", duracionTexto(segundos)],
    ["Voz GPT-Live", `${(datos.segundosVoz / 60).toFixed(1)} min · ${usd(voz)}`],
    ["Consultas a Claude", `${miles(datos.delegaciones)} delegaciones · ${miles(k.pasos)} pasos`],
    ["Tokens Claude", `entrada ${miles(k.entrada)} · salida ${miles(k.salida)} · caché ${miles(k.lecturaCache)} leídos, ${miles(k.escrituraCache)} escritos`],
    ["Costo Claude", usd(claude)],
    ["Total estimado", usd(total), "total"],
    ...(acumulado.sesiones ? [["Antes en esta pestaña", `${usd(acumulado.usd)} (${acumulado.sesiones} conversación${acumulado.sesiones === 1 ? "" : "es"})`]] : [])
  ]);
  aj.consumoNota.textContent = (datos.segundosMedidosPorOpenAI
    ? "Minutos de voz informados por OpenAI. "
    : "Minutos de voz según el reloj (OpenAI aún no informa los suyos). ")
    + "Estimación referencial con la tabla de precios del servidor; la factura real es la de cada proveedor.";
}

function pintarModelos() {
  const m = ajustesServidor?.modelos || {};
  const filas = [["Proveedor", "Modelo", "Voz", "Estado"]];
  for (const nombre of ["live", "elevenlabs", "gemini", "openai"]) {
    const d = describirVoz(nombre) || {};
    const modelo = nombre === "live" ? `${d.modelo} + ${m.live?.razonamiento || "claude-sonnet-5-5"}` : d.modelo;
    filas.push([NOMBRES_DE_VOZ[nombre], modelo || "—", d.voz || "—", disponible[nombre] ? "disponible" : "sin clave", nombre]);
  }
  aj.modelos.replaceChildren(...filas.map((fila, i) => {
    const tr = document.createElement("tr");
    if (i && connected && fila[4] === proveedor) tr.className = "activo";
    for (const celda of fila.slice(0, 4)) {
      const td = document.createElement(i ? "td" : "th");
      td.textContent = celda;
      tr.append(td);
    }
    return tr;
  }));
  const p = ajustesServidor?.precios || {};
  const claude = Object.entries(p.claude || {}).filter(([, v]) => typeof v === "object")
    .map(([modelo, v]) => `${modelo}: USD ${v.entrada} entrada / ${v.salida} salida por millón`).join("; ");
  aj.precios.textContent = [
    p.gptLive ? `GPT-Live: USD ${p.gptLive.usdPorMinuto} por minuto (${p.gptLive.fuente}).` : "",
    claude ? `Claude — ${claude}. ${p.claude.fuente || ""}` : ""
  ].filter(Boolean).join(" ");
}

function pintarSelectores() {
  const actual = vozDePrueba || "auto";
  const opciones = [["auto", "Automático (ElevenLabs → Gemini → OpenAI)"], ...Object.entries(NOMBRES_DE_VOZ)];
  aj.proveedor.replaceChildren(...opciones.map(([valor, texto]) => {
    const op = new Option(valor === "auto" || disponible[valor] ? texto : `${texto} — sin clave en el servidor`, valor);
    op.disabled = valor !== "auto" && !disponible[valor];
    op.selected = valor === actual;
    return op;
  }));
  const voces = ajustesServidor?.vocesLive || [vozLiveEnUso()];
  aj.vozLive.replaceChildren(...voces.map(v => {
    const op = new Option(v, v);
    op.selected = v === vozLiveEnUso();
    return op;
  }));
  actualizarDireccion();
}

function direccionElegida() {
  const url = new URL(location.href);
  const elegido = aj.proveedor.value;
  if (elegido === "auto") url.searchParams.delete("voz");
  else url.searchParams.set("voz", elegido);
  if (elegido === "live" && aj.vozLive.value !== (ajustesServidor?.modelos?.live?.voz || "marin")) {
    url.searchParams.set("vozLive", aj.vozLive.value);
  } else {
    url.searchParams.delete("vozLive");
  }
  return url;
}

function actualizarDireccion() {
  aj.vozLiveFila.hidden = aj.proveedor.value !== "live";
  const url = direccionElegida();
  aj.direccion.textContent = url.pathname + url.search;
  aj.aplicar.disabled = url.href === location.href;
}

async function abrirAjustes() {
  try {
    ajustesServidor = await fetch("/ajustes").then(r => r.json());
  } catch {
    ajustesServidor ??= null;
  }
  pintarSelectores();
  pintarModelos();
  pintarEnUso();
  pintarConsumo();
  if (!aj.dialogo.open) aj.dialogo.showModal();
  clearInterval(relojAjustes);
  relojAjustes = setInterval(() => {
    if (!aj.dialogo.open) return clearInterval(relojAjustes);
    pintarEnUso();
    pintarConsumo();
  }, 1000);
}

aj.abrir.addEventListener("click", abrirAjustes);
aj.cerrar.addEventListener("click", () => aj.dialogo.close());
aj.dialogo.addEventListener("close", () => clearInterval(relojAjustes));
aj.proveedor.addEventListener("change", actualizarDireccion);
aj.vozLive.addEventListener("change", actualizarDireccion);
aj.aplicar.addEventListener("click", () => {
  if (connected && !confirm("Cambiar de voz termina la conversación en curso. ¿Continuar?")) return;
  location.assign(direccionElegida().href);
});

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
    setStatus(enModoMeet ? "En reunión" : "Te escucho");
    // Terminó de hablar de verdad —lo decide el silencio real de la pista, no
    // el fin de la generación—, así que vuelve a escuchar la reunión. El
    // margen extra deja pasar la cola de su voz en la sala.
    if (enModoMeet) {
      setTimeout(() => {
        escucha.ensordecer(false);
        señalar("Escuchando · di «Catalina» para hablarme");
      }, 700);
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

// En reunión la cara se dibuja a 30 cuadros y no a 60: la pestaña se presenta
// en Meet, que la envía a 30 como mucho, y cada cuadro dibujado de más es
// tiempo que el hilo principal le quita a la recepción de la voz.
let ultimoCuadro = 0;
function render(now) {
  const reading = connected ? voice.read(now) : null;
  if (reading) seguirFinDeTurno(reading, now);
  if (!enModoMeet || now - ultimoCuadro >= 32) {
    ultimoCuadro = now;
    if (reading) aplicarBocaAlineada(reading);
    const pose = director.update(now, reading);
    renderer.draw(ctx, viewport, pose);
  }
  requestAnimationFrame(render);
}

// Punto de inspección para ajustar la actuación desde la consola del navegador:
// `catalina.director.setState("speaking")` o `catalina.voice.read(performance.now())`.
window.catalina = {
  director,
  voice,
  sesiones,
  manejadores,
  get session() { return sesion; },
  get disponible() { return disponible; },
  get proveedor() { return proveedor; },
  expresionDeFrase: aplicarExpresionDeFrase,
  get renderer() { return renderer; },
  get viewport() { return viewport; }
};
