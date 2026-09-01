import { escenario, informar } from "./qa-banco.mjs";
const r = [];

// Un doble de la sesión de voz. No habla, pero responde a todo lo que la app le
// pide y deja ver qué se le pidió: es lo que hace falta para comprobar cuándo
// se le devuelve el micrófono.
const SESION_FALSA = `
window.__sesion = {
  muted: false, conectada: false, enviados: [], pausas: [],
  async connect() { this.conectada = true; window.catalina.manejadores.onConnected(); },
  disconnect() { this.conectada = false; window.catalina.manejadores.onDisconnected(); },
  toggleMute() { this.muted = !this.muted; return this.muted; },
  pausarEnvio(p) { this.muted = Boolean(p); this.pausas.push({ p: Boolean(p), t: Date.now() }); return this.muted; },
  enviarTexto(t) { this.enviados.push(t); return true; }
};
`;

r.push(await escenario("La voz es la de ElevenLabs y no se cambia por otra", `
  // Sólo Gemini disponible: antes la sesión pasaba sola a Gemini sin avisar.
  window.catalina.disponible.elevenlabs = false;
  window.catalina.disponible.gemini = true;
  window.catalina.disponible.openai = true;

  $("#connect").click(); await dormir(800);
  anotar("Sin ElevenLabs NO se conecta a Gemini ni a OpenAI",
    window.catalina.proveedor !== "gemini" && window.catalina.proveedor !== "openai",
    "proveedor: " + window.catalina.proveedor);
  anotar("Y se dice que falta la voz de ElevenLabs, con lo que sí sigue funcionando",
    /ElevenLabs/.test($("#status").textContent), $("#status").textContent);
  anotar("El botón queda listo para reintentar, no bloqueado",
    $("#connect").disabled === false && $("#connect").textContent === "Iniciar conversación", $("#connect").textContent);

  // Con ElevenLabs, sí conecta, y se puede ver de quién es la voz.
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(800);
  anotar("Con ElevenLabs conecta", window.catalina.proveedor === "elevenlabs", String(window.catalina.proveedor));
  anotar("Y se puede leer qué voz suena, sin adivinar",
    /ElevenLabs/.test($("#signal").title || ""), $("#signal").title || "(sin rótulo)");
`, { previoExtra: SESION_FALSA }));

r.push(await escenario("El micrófono no vuelve mientras ella cuenta la minuta", `
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(600);

  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Comité con voz";
  $("#prepararEmpezar").click(); await dormir(800);
  anotar("Al entrar en reunión se le corta el micrófono al agente",
    window.__sesion.muted === true, JSON.stringify(window.__sesion.pausas));

  motor("es-CL").emitir("acordamos revisar el presupuesto el lunes", 0.9); await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(6000);

  // Al cerrar se le manda la reunión entera: primero piensa y después cuenta la
  // minuta. En todo ese tramo el micrófono TIENE que seguir cortado, o la sala
  // entra en la sesión y ella se interrumpe a sí misma.
  window.catalina.manejadores.onPhase("thinking");
  await dormir(4000);
  anotar("Mientras lo está pensando, el micrófono ya sigue cortado",
    window.__sesion.muted === true, "muted=" + window.__sesion.muted);
  window.catalina.manejadores.onPhase("speaking");
  await dormir(2500);
  anotar("Mientras habla de la minuta, el micrófono sigue cortado",
    window.__sesion.muted === true, "muted=" + window.__sesion.muted);

  await dormir(3000);
  anotar("Y sigue cortado unos segundos después, no se devuelve a mitad de frase",
    window.__sesion.muted === true, "muted=" + window.__sesion.muted);

  // Termina de hablar.
  window.catalina.manejadores.onPhase("listening");
  window.catalina.director.setState("listening");
  await dormir(2000);
  anotar("Cuando termina, el micrófono vuelve solo", window.__sesion.muted === false, "muted=" + window.__sesion.muted);
  anotar("Y el botón lo refleja", $("#mute").textContent === "Silenciar micrófono", $("#mute").textContent);
`, { previoExtra: SESION_FALSA, espera: 90000 }));

r.push(await escenario("Si no llega a hablar, el micrófono no se queda cortado para siempre", `
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(600);
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(800);
  motor("es-CL").emitir("una reunión corta", 0.9); await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(6000);

  // No se emite ninguna fase: la voz nunca arrancó.
  anotar("Justo después de cerrar sigue cortado", window.__sesion.muted === true, "muted=" + window.__sesion.muted);
  await dormir(24000);
  anotar("Pero si no llega a hablar, se devuelve solo y no se queda mudo",
    window.__sesion.muted === false, "muted=" + window.__sesion.muted);
`, { previoExtra: SESION_FALSA, espera: 90000 }));

process.exit(informar(r) ? 1 : 0);
