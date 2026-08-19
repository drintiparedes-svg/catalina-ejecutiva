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
  imagen: document.querySelector("#imagen"),
  imagenFoto: document.querySelector("#imagenFoto"),
  imagenPie: document.querySelector("#imagenPie"),
  imagenCredito: document.querySelector("#imagenCredito"),
  imagenCerrar: document.querySelector("#imagenCerrar"),
  referencias: document.querySelector("#referencias"),
  referenciasLista: document.querySelector("#referenciasLista"),
  referenciasTitulo: document.querySelector("#referenciasTitulo"),
  referenciasCerrar: document.querySelector("#referenciasCerrar"),
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
    hayActividad();
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
    setStatus("Lista para comenzar");
  },
  onPhase: phase => {
    hayActividad();
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
  openai: new RealtimeSession(manejadores),
  gemini: new GeminiSession(manejadores)
};

const ORDEN = ["gemini", "openai"];

// Motivos por los que ese proveedor no va a funcionar por mucho que se
// reintente: sin crédito o sin clave válida. Un fallo de red no entra aquí,
// porque cambiar de proveedor no lo arreglaría y ocultaría el problema real.
const MOTIVOS_DE_RELEVO = new Set([
  "API_RATE_LIMIT", "API_KEY_MISSING", "API_KEY_INVALID",
  "GEMINI_KEY_MISSING", "GEMINI_KEY_INVALID", "GEMINI_SESSION_ERROR"
]);

const disponible = { openai: false, gemini: false };
let proveedor = null;
let sesion = null;

function proveedoresUtiles() {
  return ORDEN.filter(nombre => disponible[nombre]);
}

async function conectar() {
  const cadena = proveedoresUtiles();
  if (!cadena.length) {
    setStatus("No hay ninguna voz configurada");
    mostrarAviso("Falta una clave de OpenAI o de Gemini para poder conversar.");
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
    setStatus(error.mensaje || "No se pudo conectar");
    mostrarAviso(error.ayuda || "");
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
});
ui.referenciasCerrar.addEventListener("click", () => {
  ui.referencias.dataset.estado = "oculto";
  referenciasEnPantalla = [];
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
  alTranscribir: () => hayActividad(),   // la reunión cuenta como vida
  alLlamarla: (peticion, contexto) => atenderLlamado(peticion, contexto)
});

let enModoMeet = false;
let micCortadoPorMeet = false;

function entrarEnModoMeet() {
  ui.stage.classList.add("meet");
  if (enModoMeet) return;
  enModoMeet = true;

  if (!escuchaDisponible()) {
    // Sin reconocimiento de voz el modo sigue sirviendo para capturar la
    // pantalla, pero no puede escuchar. Mejor decirlo que fingir que escucha.
    mostrarAviso("Este navegador no puede transcribir la reunión. Prueba con Chrome.");
    return;
  }

  // Se corta el micrófono hacia el modelo: quien escucha ahora es el navegador.
  if (connected && sesion && !sesion.muted) {
    sesion.toggleMute();
    micCortadoPorMeet = true;
    ui.mute.textContent = "Activar micrófono";
  }
  escucha.olvidar();
  escucha.empezar();
  setStatus("En reunión · di «Catalina» para hablarme");
}

function salirDeModoMeet() {
  ui.stage.classList.remove("meet");
  if (!enModoMeet) return;
  enModoMeet = false;

  escucha.parar();
  // Sólo se devuelve el micrófono si fue este modo quien lo quitó.
  if (micCortadoPorMeet && connected && sesion?.muted) {
    sesion.toggleMute();
    ui.mute.textContent = "Silenciar micrófono";
  }
  micCortadoPorMeet = false;
  setStatus(connected ? "Te escucho" : "Lista para comenzar");
}

// La llamaron por su nombre en mitad de la reunión.
async function atenderLlamado(peticion, contexto) {
  if (!connected || !sesion) {
    // Sin sesión abierta no puede contestar; se avisa en vez de perder lo dicho.
    setStatus("Me llamaste, pero la sesión está cerrada");
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

  sesion.enviarTexto(mensaje);
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

async function atenderHerramienta(nombre, argumentos) {
  if (nombre === "buscar_imagen_medica") return await pedirLamina(argumentos);
  if (nombre === "buscar_referencias") return await pedirReferencias(argumentos);
  if (nombre === "enviar_resumen") return await enviarResumen(argumentos);
  if (nombre === "buscar_salud_cerca") return await buscarSaludCerca(argumentos);
  if (nombre === "llamar_por_telefono") return await llamarPorTelefono(argumentos);
  if (nombre === "consultar_llamada") return await consultarLlamada(argumentos);
  if (nombre === "como_llegar") return await comoLlegar(argumentos);
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
      { timeout: 8000, maximumAge: 300000 }
    );
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

    mostrarReferencias(datos.referencias);
    // Van los títulos para que pueda mencionarlas de palabra; los enlaces ya
    // están en pantalla y leerlos en voz alta no aportaría nada.
    return { ok: true, mostradas: datos.referencias.length, titulos: datos.referencias.map(r => r.titulo) };
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
  ui.imagenFoto.onclick = null;
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

function mostrarReferencias(referencias) {
  referenciasEnPantalla = referencias;
  ui.referenciasTitulo.textContent = "Referencias";
  ui.referenciasLista.replaceChildren();
  for (const referencia of referencias) {
    const item = document.createElement("li");
    const enlace = document.createElement("a");
    enlace.href = referencia.enlace;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    enlace.textContent = referencia.titulo;

    const pie = document.createElement("span");
    pie.className = "referencia-pie";
    pie.textContent = [referencia.autores, referencia.revista, referencia.anio]
      .filter(Boolean).join(" · ");

    item.append(enlace, pie);
    ui.referenciasLista.append(item);
  }
  ui.referencias.dataset.estado = "visible";
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
  ui.caption.textContent = texto;
  ui.caption.dataset.visible = String(verSubtitulos);

  if (!turnoVivo) turnoVivo = crearTurno();
  turnoVivo.texto.textContent = texto;

  // Sólo se sigue el fondo si ya estábamos abajo: si la persona subió a releer
  // algo, el texto nuevo no le arrebata la posición.
  const alFondo = ui.panelBody.scrollHeight - ui.panelBody.scrollTop - ui.panelBody.clientHeight < 60;
  if (alFondo) ui.panelBody.scrollTop = ui.panelBody.scrollHeight;
}

function crearTurno() {
  ui.panelBody.querySelector(".panel-empty")?.remove();

  const nodo = document.createElement("article");
  nodo.className = "turno";
  nodo.dataset.vivo = "true";

  const cabecera = document.createElement("div");
  cabecera.className = "turno-cabecera";

  const quien = document.createElement("span");
  quien.className = "turno-quien";
  quien.textContent = "Catalina";

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
    setStatus("Te escucho");
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

function render(now) {
  const reading = connected ? voice.read(now) : null;
  if (reading) seguirFinDeTurno(reading, now);
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
