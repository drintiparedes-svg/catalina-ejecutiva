import { escenario, informar } from "./qa-banco.mjs";
const r = [];

r.push(await escenario("El servidor se cae al cerrar: la reunión NO se pierde", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("esto no se puede perder pase lo que pase", 0.9);
  await dormir(1300);

  window.__servidorCaido = true;
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionEntrada").value = "Reunión con el servidor caído";
  $("#reunionAceptar").click(); await dormir(2500);

  anotar("Con el servidor caído se dice que no se cerró, no se finge",
    $("#cierreTitulo").textContent.includes("No se pudo cerrar"), $("#cierreTitulo").textContent);
  anotar("La reunión vuelve a estar viva, y se dice que sigue escuchando",
    $("#reunionEstado").dataset.fase === "problema" && $("#reunionEco").textContent.includes("sigo escuchando"),
    $("#reunionEstadoTexto").textContent + " | " + $("#reunionEco").textContent);
  anotar("La transcripción capturada sigue entera", acta().length === 1, JSON.stringify(acta()));
  anotar("Y se sigue capturando después del fallo",
    (motor("es-CL").emitir("y sigue oyendo después del fallo", 0.9), true), "");
  await dormir(1300);
  anotar("La frase posterior al fallo también entra", acta().length === 2, JSON.stringify(acta()));
  anotar("Y capturar de nuevo retira el aviso: la alerta no se queda pegada",
    $("#reunionEstado").dataset.fase === "escuchando" && $("#reunionEstadoTexto").textContent === "Escuchando",
    $("#reunionEstado").dataset.fase + " / " + $("#reunionEstadoTexto").textContent);

  // Se repone el servidor y se reintenta desde el mismo sitio, sin salir.
  window.__servidorCaido = false;
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionEntrada").value = "Reunión recuperada";
  $("#reunionAceptar").click(); await dormir(8000);
  anotar("Al reintentar cierra bien y con las dos frases",
    $("#cierreTitulo").textContent.includes("lista") || $("#cierreCuerpo").textContent.includes("2 intervenciones"),
    $("#cierreTitulo").textContent + " | " + $("#cierreCuerpo").textContent.slice(0, 120));
`));

r.push(await escenario("Sin reconocimiento de voz: se dice, y lo demás sigue sirviendo", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);
  anotar("Avisa de que este navegador no transcribe, con qué hacer",
    $("#reunionEco").textContent.includes("no transcribe") && $("#reunionEco").textContent.includes("Chrome"),
    $("#reunionEco").textContent);
  anotar("Ofrece reintentar sin salir del modo",
    Boolean([...document.querySelectorAll("#reunionEco button")].find(b => b.textContent === "Reintentar")), "");

  // Y aun así se puede tomar nota y cerrar: la reunión no queda inservible.
  $("#reunionNota").click(); await dormir(150);
  $("#reunionNotas").value = "Nota a mano porque el navegador no transcribe";
  $("#reunionNotas").dispatchEvent(new Event("input")); await dormir(150);
  $("#reunionCerrarNotas").click(); await dormir(200);
  anotar("Se pueden tomar notas igualmente", $("#reunionCuenta").textContent.includes("1 nota"), $("#reunionCuenta").textContent);

  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionEntrada").value = "Reunión sin transcripción";
  $("#reunionAceptar").click(); await dormir(8000);
  anotar("Cierra y genera documentos con lo que hay", $("#cierre").dataset.estado === "visible", "");
  anotar("Y el chequeo señala que el audio no se procesó, sin disimularlo",
    /Audio procesado/.test($("#cierreCuerpo").innerText) && /no transcribe|nunca llegó a arrancar/i.test($("#cierreCuerpo").innerText),
    $("#cierreCuerpo").innerText.slice(0, 220));
`, { previoExtra: "window.__sinReconocimiento = true;" }));

r.push(await escenario("El correo a terceros no sale sin confirmación explícita", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("acuerdo del comité sobre el piloto", 0.9);
  await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionEntrada").value = "Comité con correo";
  $("#reunionAceptar").click(); await dormir(9000);

  const forma = $(".cierre-correo");
  anotar("Aparece el formulario de correo con adjuntos declarados",
    Boolean(forma) && forma.textContent.includes("Se adjuntan"), "");
  forma.querySelector("#correoPara").value = "tercero@ejemplo.cl";
  const boton = forma.querySelector(".cierre-enviar");
  anotar("El botón dice «Revisar y enviar», no «Enviar»", boton.textContent === "Revisar y enviar", boton.textContent);

  const envios = () => window.__peticiones.filter(p => p.url.includes("/reunion/correo")).length;
  boton.click(); await dormir(600);
  anotar("La PRIMERA pulsación no manda nada", envios() === 0, "envíos: " + envios());
  anotar("Y pide confirmar nombrando al destinatario",
    boton.textContent.includes("tercero@ejemplo.cl"), boton.textContent);

  boton.click(); await dormir(1500);
  anotar("La SEGUNDA pulsación sí intenta el envío", envios() === 1, "envíos: " + envios());
  const cuerpo = JSON.parse(window.__peticiones.find(p => p.url.includes("/reunion/correo")).cuerpo);
  anotar("Y viaja marcado como confirmado, con los dos adjuntos",
    cuerpo.confirmado === true && cuerpo.adjuntos.length === 2 && cuerpo.destinatario === "tercero@ejemplo.cl",
    JSON.stringify({ confirmado: cuerpo.confirmado, adjuntos: cuerpo.adjuntos.length }));
`));

process.exit(informar(r) ? 1 : 0);
