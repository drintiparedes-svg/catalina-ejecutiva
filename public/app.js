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
    ultimoFallo = null;
    hayActividad();
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
    ui.stage.classList.contains("meet") ? salirDeModoMeet() : entrarEnModoMeet();
  }
  if (tecla === "s") fijarSubtitulos(!verSubtitulos);
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
// modelo: la transcribe el navegador, gratis, y sólo cuando alguien dice
// «Catalina» se le envía lo hablado como texto y se le pide que conteste.
//
// La sesión de voz sigue abierta pero con el micrófono cortado, así que no se
// envía audio y no se paga por escuchar; a cambio responde al instante y con su
// voz, sin tener que reconectar.
const escucha = new EscuchaDeReunion({
  alTranscribir: texto => {
    hayActividad();                       // la reunión cuenta como vida
    señalar("Escuchando · " + texto, "");  // se ve lo último entendido
  },
  alLlamarla: (peticion, contexto) => atenderLlamado(peticion, contexto),
  alFallar: motivo => señalar(motivo, "problema")
});

// La señal de escucha es lo único visible en modo reunión. Muestra lo último
// que entendió el navegador, que además sirve para ver si transcribe bien.
function señalar(texto, estado = "") {
  ui.oyendoTexto.textContent = texto;
  ui.oyendo.dataset.estado = estado;
}

let enModoMeet = false;
let micCortadoPorMeet = false;

function entrarEnModoMeet() {
  ui.stage.classList.add("meet");
  if (enModoMeet) return;
  enModoMeet = true;

  ui.oyendo.hidden = false;

  if (!escuchaDisponible()) {
    // Sin reconocimiento de voz el modo sigue sirviendo para capturar la
    // pantalla, pero no puede escuchar. Mejor decirlo que fingir que escucha.
    señalar("Este navegador no puede transcribir. Usa Chrome.", "problema");
    return;
  }
  if (!connected) {
    señalar("Inicia la conversación antes de entrar en reunión", "problema");
    return;
  }

  // Se deja de enviar audio al modelo sin apagar la pista: quien escucha ahora
  // es el navegador, y con la pista apagada no oiría nada.
  if (sesion && !sesion.muted) {
    sesion.pausarEnvio(true);
    micCortadoPorMeet = true;
    ui.mute.textContent = "Activar micrófono";
  }
  escucha.olvidar();
  if (escucha.empezar()) {
    señalar("Escuchando · di «Catalina» para hablarme");
    setStatus("En reunión");
  } else {
    señalar("No se pudo iniciar la escucha", "problema");
  }
}

function salirDeModoMeet() {
  ui.stage.classList.remove("meet");
  if (!enModoMeet) return;
  enModoMeet = false;

  escucha.parar();
  ui.oyendo.hidden = true;
  // Sólo se devuelve el micrófono si fue este modo quien lo quitó.
  if (micCortadoPorMeet && sesion?.muted) {
    sesion.pausarEnvio(false);
    ui.mute.textContent = "Silenciar micrófono";
  }
  micCortadoPorMeet = false;
  setStatus(connected ? "Te escucho" : "Lista para comenzar");
}

// La llamaron por su nombre en mitad de la reunión.
async function atenderLlamado(peticion, contexto) {
  if (!connected || !sesion) {
    // Sin sesión abierta no puede contestar; se avisa en vez de perder lo dicho.
    señalar("Me llamaste, pero la sesión está cerrada", "problema");
    return;
  }
  hayActividad();

  // Se le da lo hablado y lo que le piden, separados, para que sepa qué es
  // contexto y qué es la pregunta.
  const mensaje = [
    "Estás escuchando una reunión. Esto es lo que se ha dicho hasta ahora, transcrito automáticamente:",
    "",
    contexto || "(todavía no hay nada transcrito)",
    "",
    `Acaban de dirigirse a ti y te han pedido: «${peticion}»`,
    "",
    "Responde sólo a eso, breve y en voz alta. No resumas la reunión entera salvo que te lo pidan.",
    "La transcripción es automática y puede tener errores: si algo no cuadra, dilo en vez de darlo por cierto."
  ].join("\n");

  const enviado = sesion.enviarTexto(mensaje);
  señalar(enviado ? `Te oí: «${peticion}»` : "No pude enviar tu pregunta", enviado ? "respondiendo" : "problema");
  setStatus("Respondiendo…");
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
  if (nombre === "fuentes_clinicas") return await pedirFuentesClinicas(argumentos);
  if (nombre === "buscar_videos") return await buscarVideos(argumentos);
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
  get session() { return sesion; },
  get disponible() { return disponible; },
  get proveedor() { return proveedor; },
  expresionDeFrase: aplicarExpresionDeFrase,
  get renderer() { return renderer; },
  get viewport() { return viewport; }
};
