import { escenario, informar } from "./qa-banco.mjs";
const r = [];

const PREVIO = `
window.__sesion = {
  muted: false, enviados: [],
  async connect() { window.catalina.manejadores.onConnected(); },
  disconnect() { window.catalina.manejadores.onDisconnected(); },
  toggleMute() { this.muted = !this.muted; return this.muted; },
  pausarEnvio(p) { this.muted = Boolean(p); return this.muted; },
  enviarTexto(t) { this.enviados.push(t); return true; }
};
// El servidor redacta el resumen; aquí se responde en falso para no salir a la red.
window.__cerrado = null;
const fa = window.fetch;
window.fetch = function (url, opciones) {
  if (String(url) === "/conversacion/cerrar") {
    window.__cerrado = JSON.parse(opciones.body);
    return Promise.resolve(new Response(JSON.stringify({ ok: true, redactado: true, resumen: {
      titulo: "Alcance del piloto en marzo",
      resumen: "Se revisó el presupuesto del piloto y se decidió arrancar en marzo con dos servicios.",
      minuta: ["Se revisó el presupuesto", "Se discutió el calendario"],
      acuerdos: ["Arrancar el piloto en marzo con dos servicios", "Sarah confirma el presupuesto el lunes"],
      alcance: ["Sólo los dos servicios del piloto; el resto del hospital queda fuera"],
      pendientes: ["Falta la aprobación de finanzas"],
      temas: ["piloto", "presupuesto", "marzo"],
      inicio: Date.now() - 600000, fin: Date.now(), minutos: 10, intervenciones: 4, documentos: []
    } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return fa.apply(this, arguments);
};
`;

const HABLAR = `
  const decir = (quien, texto) => quien === "yo"
    ? window.catalina.manejadores.onUsuario(texto)
    : window.catalina.manejadores.onTranscript(texto);
`;

r.push(await escenario("Se registran las dos voces y el cierre produce el resumen", `
  ${HABLAR}
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(500);
  $("#togglePanel").click(); await dormir(200);

  decir("yo", "Necesito revisar el presupuesto del piloto.");
  await dormir(150);
  decir("ella", "Lo tengo. El presupuesto son doce millones para dos servicios.");
  window.catalina.manejadores.onResponseDone();
  await dormir(150);
  decir("yo", "De acuerdo, arrancamos en marzo entonces.");
  await dormir(150);
  decir("ella", "Anotado. Sarah confirma el presupuesto el lunes.");
  window.catalina.manejadores.onResponseDone();
  await dormir(300);

  const turnos = [...document.querySelectorAll("#panelBody .turno")];
  anotar("En el panel se ve sólo lo que dice Catalina, sin repetir",
    turnos.length === 2 && turnos.every(t => t.dataset.quien !== "usuario"),
    turnos.map(t => t.querySelector(".turno-quien").textContent).join(" / "));
  const memoria = window.catalina.charla.turnos;
  anotar("En la memoria quedan las dos voces, que es lo que necesita la minuta",
    memoria.length === 4 && memoria.filter(t => t.quien === "usuario").length === 2,
    memoria.map(t => t.quien).join(" / "));

  $("#panelCerrarCharla").click(); await dormir(1500);

  const mandado = window.__cerrado;
  anotar("Al cerrar se manda la conversación entera al servidor", (mandado?.turnos || []).length === 4, JSON.stringify(mandado?.turnos?.length));
  anotar("Con quién dijo cada cosa",
    mandado.turnos[0].quien === "usuario" && mandado.turnos[1].quien === "catalina",
    JSON.stringify(mandado.turnos.map(t => t.quien)));
  anotar("Y con lo que se dijo de verdad, no con los subtítulos recortados",
    mandado.turnos[0].texto.includes("presupuesto del piloto"), mandado.turnos[0].texto);

  const resumen = document.querySelector("#panelBody .resumen");
  anotar("El resumen aparece en el panel", Boolean(resumen), "");
  anotar("Con su título", /Alcance del piloto en marzo/.test(resumen?.textContent || ""), "");
  anotar("Con los ACUERDOS separados", /ACUERDOS|Acuerdos/i.test(resumen?.textContent || "") && /Sarah confirma/.test(resumen?.textContent || ""), "");
  anotar("Con el ALCANCE separado de los acuerdos",
    /Alcance/i.test(resumen?.textContent || "") && /resto del hospital queda fuera/.test(resumen?.textContent || ""), "");
  anotar("Y con los pendientes", /aprobación de finanzas/.test(resumen?.textContent || ""), "");
  anotar("Se dice que quedó guardado y cómo retomarlo",
    /Guardado/.test(resumen?.textContent || "") && /«Anteriores»/.test(resumen?.textContent || ""),
    (resumen?.textContent || "").slice(-90));
`, { previoExtra: PREVIO, espera: 60000 }));

r.push(await escenario("Queda en el historial y se puede retomar como contexto", `
  ${HABLAR}
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(500);
  $("#panelConversaciones").click(); await dormir(1200);

  const fichas = [...document.querySelectorAll("#panelBody .conversacion-ficha")];
  anotar("La conversación cerrada antes está en el historial", fichas.length >= 1, fichas.length + " fichas");
  anotar("Con su título y de qué trató",
    /Alcance del piloto/.test(fichas[0]?.textContent || "") && /doce millones|arrancar en marzo|presupuesto/i.test(fichas[0]?.textContent || ""),
    (fichas[0]?.textContent || "").slice(0, 120));
  anotar("Y dice cuántos acuerdos y pendientes trae",
    /2 acuerdos/.test(fichas[0]?.textContent || "") && /1 pendiente/.test(fichas[0]?.textContent || ""),
    (fichas[0]?.textContent || "").slice(0, 160));

  // Lo que se pidió: que el usuario DECIDA si la usa como contexto.
  const antes = window.__sesion.enviados.length;
  [...fichas[0].querySelectorAll("button")].find(b => /contexto/i.test(b.textContent)).click();
  await dormir(600);
  const contexto = window.__sesion.enviados.at(-1) || "";
  anotar("Al elegirla, su contexto se le pasa a Catalina",
    window.__sesion.enviados.length === antes + 1 && contexto.startsWith("[Contexto]"), contexto.slice(0, 70));
  anotar("Con los acuerdos de aquella conversación", /Sarah confirma el presupuesto/.test(contexto), "");
  anotar("Y con su alcance, para no aplicarlos donde no tocaba", /resto del hospital queda fuera/.test(contexto), "");
  anotar("Se le dice que es de antes y que no lo repita de entrada",
    /conversación anterior, no de ahora/.test(contexto) && /no lo repitas de entrada/.test(contexto), "");
  anotar("Y no entra sola: hubo que elegirla", antes === 0, "envíos antes de elegir: " + antes);
`, { previoExtra: PREVIO, espera: 60000 }));

r.push(await escenario("Todo esto también se puede pedir hablando", `
  ${HABLAR}
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(500);

  // Sin haber hablado nada, cerrar no inventa un resumen.
  const vacio = await window.catalina.manejadores.onToolCall("cerrar_conversacion", {});
  anotar("Cerrar una conversación vacía no inventa nada, y lo dice",
    vacio.ok === false && /nada que resumir/i.test(vacio.error), JSON.stringify(vacio));

  decir("yo", "Quiero cerrar el alcance del piloto.");
  await dormir(150);
  decir("ella", "Perfecto, lo dejamos en dos servicios.");
  window.catalina.manejadores.onResponseDone();
  await dormir(300);

  const cerrado = await window.catalina.manejadores.onToolCall("cerrar_conversacion", {});
  anotar("«cerrar_conversacion» cierra y devuelve de qué trató",
    cerrado.ok === true && cerrado.titulo === "Alcance del piloto en marzo", JSON.stringify(cerrado).slice(0, 120));
  anotar("Y cuántos acuerdos salieron, para que lo diga en una frase",
    cerrado.acuerdos === 2 && cerrado.guardado === true, JSON.stringify(cerrado).slice(0, 140));

  // Listar sin título.
  const lista = await window.catalina.manejadores.onToolCall("conversaciones_anteriores", {});
  anotar("«conversaciones_anteriores» sin título lista lo que hay",
    lista.ok === true && lista.hay >= 1 && Array.isArray(lista.conversaciones), JSON.stringify(lista).slice(0, 130));

  // Retomar por título.
  const antes = window.__sesion.enviados.length;
  const cargada = await window.catalina.manejadores.onToolCall("conversaciones_anteriores", { titulo: "piloto" });
  anotar("Con un título, la retoma y le pasa el contexto",
    cargada.ok === true && /piloto/i.test(cargada.cargada) && window.__sesion.enviados.length === antes + 1,
    JSON.stringify(cargada).slice(0, 120));
  anotar("Y le devuelve los acuerdos para que los tenga a mano",
    Array.isArray(cargada.acuerdos) && cargada.acuerdos.length === 2, JSON.stringify(cargada.acuerdos));

  const nada = await window.catalina.manejadores.onToolCall("conversaciones_anteriores", { titulo: "cardiología" });
  anotar("Si pide una que no existe, se le dice y se le listan las que hay",
    nada.ok === false && Array.isArray(nada.disponibles) && nada.disponibles.length > 0, JSON.stringify(nada).slice(0, 130));
`, { previoExtra: PREVIO, espera: 60000 }));

process.exit(informar(r) ? 1 : 0);
