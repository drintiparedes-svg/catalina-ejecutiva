import { escenario, informar } from "./qa-banco.mjs";
const r = [];

r.push(await escenario("Nombrarla: sin participación, con participación, sin voz", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);       // operacional: participación apagada
  const es = () => motor("es-CL");

  es().emitir("Catalina, resume lo que llevamos", 0.9); await dormir(1300);
  anotar("Con la participación apagada lo dice, no se queda callada",
    $("#reunionEco").textContent.includes("participación apagada"), $("#reunionEco").textContent);
  anotar("Y la frase queda igualmente en la transcripción: se dijo en la sala",
    acta().length === 1 && acta()[0].texto.includes("Catalina"), JSON.stringify(acta()));

  // «Participar» sin sesión de voz: la abre, y si no puede lo dice, pero la
  // transcripción no se entera de nada.
  $("#reunionParticipar").click(); await dormir(2500);
  anotar("Participar sin voz abierta lo intenta y luego lo explica",
    /voz de Catalina/.test($("#reunionEco").textContent), $("#reunionEco").textContent);
  anotar("Y la reunión sigue transcribiendo pese a ello", Boolean(es()), "");
  es().emitir("la reunión sigue su curso", 0.9); await dormir(1300);
  anotar("La frase posterior entra", acta().length === 2, JSON.stringify(acta().map(a => a.texto)));

  es().emitir("Catalina, apunta este acuerdo", 0.9); await dormir(1300);
  anotar("Nombrarla con la participación encendida pero sin voz lo explica",
    /voz está cerrada|no pude/i.test($("#reunionEco").textContent), $("#reunionEco").textContent);
  anotar("Y esa frase también queda transcrita", acta().length === 3, JSON.stringify(acta().map(a => a.texto)));
`));

r.push(await escenario("Después de cerrar: consultar, y empezar otra", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Primera reunión";
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("acuerdo de la primera reunión", 0.9); await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(9000);
  $("#cierreCerrar").click(); await dormir(300);

  anotar("Cerrada, el botón pasa a «Empezar otra reunión»",
    $("#reunionFinalizar").textContent === "Empezar otra reunión", $("#reunionFinalizar").textContent);
  anotar("Y se retiran las acciones que ya no aplican",
    $("#reunionParticipar").hidden && $("#reunionNota").hidden && $("#reunionDocumento").hidden, "");
  anotar("La transcripción de la reunión cerrada sigue a la vista",
    acta().length === 1, JSON.stringify(acta().map(a => a.texto)));

  $("#reunionFinalizar").click(); await dormir(1200);
  anotar("«Empezar otra» arranca en limpio", acta().length === 0, JSON.stringify(acta()));
  anotar("Y vuelve a escuchar de verdad",
    $("#reunionEstadoTexto").textContent === "Escuchando" && Boolean(motor("es-CL")),
    $("#reunionEstadoTexto").textContent);
  anotar("Y recuerda cuál quedó archivada", $("#reunionEco").textContent.includes("Primera reunión"), $("#reunionEco").textContent);
  anotar("Vuelven las acciones de reunión abierta", !$("#reunionParticipar").hidden && !$("#reunionNota").hidden, "");

  motor("es-CL").emitir("y esta es la segunda reunión", 0.9); await dormir(1300);
  anotar("La segunda reunión transcribe desde cero", acta().length === 1 && acta()[0].texto.includes("segunda"), JSON.stringify(acta()));
`));

r.push(await escenario("La página normal, fuera del modo reunión", `
  anotar("Los controles principales existen",
    Boolean($("#connect") && $("#mute") && $("#togglePanel") && $("#meetMode") && $("#abrirMarcador")), "");
  anotar("Arranca sin conversación abierta y lo dice", $("#status").textContent.length > 0, $("#status").textContent);
  anotar("El modo reunión está oculto de entrada", !visible("#reunion") && !visible("#preparar"), "");

  // Pulsar los secundarios no puede reventar nada.
  $("#togglePanel").click(); await dormir(200);
  anotar("El historial de conversación se abre", $("#panel").dataset.open === "true", $("#panel").dataset.open);
  $("#togglePanel").click(); await dormir(200);
  anotar("Y se cierra", $("#panel").dataset.open === "false", $("#panel").dataset.open);

  $("#abrirMarcador").click(); await dormir(200);
  anotar("La botonera de teléfono se abre", $("#marcador").dataset.estado === "visible", $("#marcador").dataset.estado);
  $("#marcadorCerrar").click(); await dormir(200);
  anotar("Y se cierra", $("#marcador").dataset.estado === "oculto", $("#marcador").dataset.estado);

  // Entrar y salir del modo reunión sin llegar a iniciarla.
  $("#meetMode").click(); await dormir(400);
  anotar("Entrar al modo reunión abre la preparación", visible("#preparar"), "");
  $("#prepararCerrar").click(); await dormir(300);
  anotar("Salir desde la preparación devuelve los controles",
    !visible("#preparar") && !document.querySelector("#stage").classList.contains("meet"), "");
  $("#meetMode").click(); await dormir(400);
  anotar("Y se puede volver a entrar sin más", visible("#preparar"), "");
`));

process.exit(informar(r) ? 1 : 0);
