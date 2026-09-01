import { escenario, informar } from "./qa-banco.mjs";
const r = [];

r.push(await escenario("Las herramientas por voz mueven la reunión de verdad", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Comité por voz";
  $("#prepararEmpezar").click(); await dormir(700);
  const mano = window.catalina.manejadores;
  const es = () => motor("es-CL");

  // quien_habla: la atribución de lo que venga después.
  await mano.onToolCall("quien_habla", { nombre: "Marcela Ríos" });
  await dormir(200);
  anotar("«quien_habla» fija el nombre y se ve en la tira", $("#reunionQuien").value === "Marcela Ríos", $("#reunionQuien").value);
  es().emitir("entonces yo propongo aplazar la decisión", 0.9); await dormir(1300);
  anotar("Y lo dicho después se le atribuye", acta()[0]?.quien === "Marcela Ríos", JSON.stringify(acta()[0]));

  // tomar_nota: indicación editorial, NO una intervención.
  await mano.onToolCall("tomar_nota", { texto: "destacar el desacuerdo sobre los plazos" });
  await dormir(300);
  anotar("«tomar_nota» escribe en el cuaderno", $("#reunionCuenta").textContent.includes("1 nota"), $("#reunionCuenta").textContent);
  anotar("Y NO la mete como algo que alguien dijo", acta().length === 1, JSON.stringify(acta().map(a => a.texto)));
  $("#reunionNota").click(); await dormir(200);
  anotar("La nota está en el cuaderno, literal",
    $("#reunionNotas").value.includes("destacar el desacuerdo"), $("#reunionNotas").value);
  $("#reunionCerrarNotas").click(); await dormir(200);

  // estado_de_la_reunion: lo que le cuenta al modelo.
  const estado = await mano.onToolCall("estado_de_la_reunion", {});
  const texto = typeof estado === "string" ? estado : JSON.stringify(estado);
  anotar("«estado_de_la_reunion» cuenta lo que hay, sin inventar",
    texto.includes("Marcela Ríos") && texto.includes("aplazar la decisión"), texto.slice(0, 180));

  // consultar_reunion: el detalle completo.
  const detalle = await mano.onToolCall("consultar_reunion", {});
  const td = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  anotar("«consultar_reunion» devuelve el detalle de la reunión en curso", td.length > 40, td.slice(0, 140));

  // Lo que ella dice queda marcado como suyo, no como de un participante.
  mano.onTranscript("Yo diría que conviene cerrar el punto hoy.");
  await dormir(200);
  mano.onResponseDone();
  await dormir(300);
  anotar("Lo que dice Catalina se guarda como intervención suya",
    window.catalina.memoria.intervenciones.length === 1, JSON.stringify(window.catalina.memoria.intervenciones.map(i => i.origen)));
  anotar("Y no aparece como una intervención de la sala", acta().length === 1, JSON.stringify(acta().map(a => a.texto)));
`));

r.push(await escenario("Mientras Catalina habla no se apunta su voz, y luego vuelve", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);
  const mano = window.catalina.manejadores;
  const es = () => motor("es-CL");

  es().emitir("esto lo dijo alguien de la sala", 0.9); await dormir(1300);
  anotar("Se apunta lo de la sala", acta().length === 1, JSON.stringify(acta().map(a => a.texto)));

  mano.onPhase("speaking"); await dormir(200);
  anotar("Cuando empieza a hablar, la tira lo dice", $("#reunionEstadoTexto").textContent === "Hablando", $("#reunionEstadoTexto").textContent);
  anotar("Y se queda sorda a propósito", window.catalina.escucha.diagnostico().sorda === true, "");

  es().emitir("esto es su propia voz volviendo por el micrófono", 0.9); await dormir(1300);
  anotar("Su propia voz NO entra en la transcripción de la reunión", acta().length === 1, JSON.stringify(acta().map(a => a.texto)));
  anotar("Pero los reconocedores no se paran en ningún momento",
    window.catalina.escucha.diagnostico().activa === true, JSON.stringify(window.catalina.escucha.diagnostico()));

  // La voz nunca llega a sonar: sin el vigía, la reunión quedaba sorda 45 s.
  anotar("La pista de audio está parada: la voz no llegó a salir", $("#remoteAudio").paused, "");
  await dormir(13000);
  anotar("A los doce segundos el vigía lo detecta y vuelve a escuchar",
    window.catalina.escucha.diagnostico().sorda === false && $("#reunionEstadoTexto").textContent === "Escuchando",
    $("#reunionEstadoTexto").textContent + " · sorda=" + window.catalina.escucha.diagnostico().sorda);
  anotar("Y lo dice, en vez de dejarlo pasar", $("#reunionEco").textContent.includes("no me llegó a salir la voz".toLowerCase()) || /voz/i.test($("#reunionEco").textContent), $("#reunionEco").textContent);

  es().emitir("y la reunión sigue transcribiéndose después", 0.9); await dormir(1300);
  anotar("La sala se vuelve a apuntar", acta().length === 2, JSON.stringify(acta().map(a => a.texto)));
`, { espera: 60000 }));

r.push(await escenario("Finalizar por voz cierra la reunión de verdad", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Cierre por voz";
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("acordamos revisar el presupuesto el lunes", 0.9); await dormir(1300);

  await window.catalina.manejadores.onToolCall("finalizar_reunion", {});
  await dormir(10000);
  anotar("«finalizar_reunion» cierra y enseña el resultado", $("#cierre").dataset.estado === "visible", $("#cierreTitulo").textContent);
  anotar("Con la transcripción dentro", /1 intervencion/.test($("#cierreCuerpo").innerText), $("#cierreCuerpo").innerText.slice(0, 120));
  anotar("Y la reunión queda en estado posterior, consultable",
    $("#reunionEstadoTexto").textContent === "Reunión cerrada" || $("#reunionFinalizar").textContent === "Empezar otra reunión",
    $("#reunionEstadoTexto").textContent + " | " + $("#reunionFinalizar").textContent);
`, { espera: 60000 }));

process.exit(informar(r) ? 1 : 0);
