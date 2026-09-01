import { escenario, informar } from "./qa-banco.mjs";
const r = [];

// Borra el almacén para que el escenario no herede reuniones de pruebas previas.
// Vaciar los almacenes, no borrar la base: `deleteDatabase` se queda bloqueado
// mientras alguien la tenga abierta —y la propia página la abre al cargar—, y
// eso deja el perfil colgado para todas las pruebas siguientes.
const LIMPIAR = `await new Promise(res => {
  const p = indexedDB.open("catalina-reuniones");
  p.onerror = () => res();
  p.onsuccess = () => {
    const bd = p.result;
    const nombres = [...bd.objectStoreNames];
    if (!nombres.length) { bd.close(); return res(); }
    const tx = bd.transaction(nombres, "readwrite");
    for (const n of nombres) tx.objectStore(n).clear();
    tx.oncomplete = tx.onerror = () => { bd.close(); res(); };
  };
});`;

r.push(await escenario("Historial: la reunión cerrada queda consultable", `
  ${LIMPIAR}
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Comité de innovación";
  $("#prepararObjetivo").value = "Definir el alcance del piloto";
  $("#prepararEmpezar").click(); await dormir(700);
  $("#reunionQuien").value = "Inti Paredes"; $("#reunionQuien").dispatchEvent(new Event("input"));
  motor("es-CL").emitir("quedamos en que el piloto arranca en marzo", 0.9); await dormir(1300);
  $("#reunionNota").click(); await dormir(150);
  $("#reunionNotas").value = "Destacar el riesgo de plazos";
  $("#reunionNotas").dispatchEvent(new Event("input")); await dormir(150);
  $("#reunionCerrarNotas").click(); await dormir(200);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(9000);
  anotar("La reunión cierra", $("#cierre").dataset.estado === "visible", $("#cierreTitulo").textContent);

  $("#cierreCerrar").click(); await dormir(300);
  $("#reunionHistorial").click(); await dormir(1200);
  const fichas = [...document.querySelectorAll(".historial-ficha")];
  anotar("Aparece en «Reuniones anteriores»", fichas.length === 1, "fichas: " + fichas.length);
  anotar("La ficha lleva título, tipo y participante",
    fichas[0]?.textContent.includes("Comité de innovación") && fichas[0]?.textContent.includes("Inti Paredes"),
    fichas[0]?.textContent.slice(0, 140));

  fichas[0].querySelector("button").click(); await dormir(1500);
  const exp = fichas[0].querySelector(".expediente");
  anotar("«Abrir» despliega el expediente", exp && !exp.hidden, "");
  const pestanas = [...exp.querySelectorAll(".expediente-pestanas button")].map(b => b.textContent);
  anotar("El expediente trae minuta, transcripción y notas",
    pestanas.some(p => /Minuta/i.test(p)) && pestanas.some(p => /Transcripci/i.test(p)) && pestanas.some(p => /Notas/i.test(p)),
    JSON.stringify(pestanas));

  const trans = [...exp.querySelectorAll(".expediente-pestanas button")].find(b => /Transcripci/i.test(b.textContent));
  trans.click(); await dormir(400);
  anotar("La transcripción completa se puede leer desde el expediente",
    exp.textContent.includes("piloto arranca en marzo"), exp.textContent.slice(-200));

  const notas = [...exp.querySelectorAll(".expediente-pestanas button")].find(b => /Notas/i.test(b.textContent));
  notas.click(); await dormir(400);
  anotar("Y las notas del cuaderno también", exp.textContent.includes("riesgo de plazos"), exp.textContent.slice(-160));
`));

r.push(await escenario("Una reunión anterior sirve de antecedente de la siguiente", `
  $("#meetMode").click(); await dormir(500);
  $("#prepararAntecedente").click(); await dormir(1200);
  const elegir = [...document.querySelectorAll(".historial-ficha button")].find(b => b.textContent.includes("antecedente"));
  if (!elegir) { anotar("Al pedir «Reunión anterior» se ofrece elegirla", false, "no hay ficha con botón de antecedente"); return JSON.stringify({ paso, errores: window.__errores }); }
  anotar("Al pedir «Reunión anterior» se ofrece elegirla", Boolean(elegir), "");
  elegir.click(); await dormir(1200);
  anotar("Elegida, se declara en la preparación",
    $("#prepararAdjuntos").textContent.includes("seguimiento"), $("#prepararAdjuntos").textContent);
  anotar("Y se cierra el listado para seguir preparando", $("#cierre").dataset.estado === "oculto", "");
  anotar("La preparación sigue en pantalla, no se perdió", visible("#preparar"), "");
`));

r.push(await escenario("Una reunión sin cerrar se ofrece retomar, con lo capturado", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Reunión interrumpida";
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("esto se dijo antes de que se cerrara la pestaña", 0.9);
  await dormir(1400);
  anotar("Se capturó", acta().length === 1, JSON.stringify(acta()));

  // Se simula que la pestaña se va: es donde antes se perdía lo último dicho.
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  await dormir(500);
  const bd = await new Promise(res => { const p = indexedDB.open("catalina-reuniones"); p.onsuccess = () => res(p.result); p.onerror = () => res(null); });
  const guardados = bd ? await new Promise(res => { const q = bd.transaction("borradores").objectStore("borradores").getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); }) : [];
  anotar("Al ocultarse la pestaña se vuelca sin esperar los 2 segundos",
    guardados.length === 1 && (guardados[0].turnos || []).length === 1,
    JSON.stringify(guardados.map(g => ({ titulo: g.titulo, turnos: (g.turnos || []).length }))));
`));

r.push(await escenario("…y al volver, la ofrece de verdad", `
  $("#meetMode").click(); await dormir(1500);
  const barra = $("#prepararRetomar");
  anotar("Al entrar se ofrece retomar la que quedó a medias",
    !barra.hidden && barra.textContent.includes("Reunión interrumpida"), barra.textContent.slice(0, 160));
  anotar("Y dice cuántas intervenciones había", barra.textContent.includes("1 intervenciones"), barra.textContent.slice(0, 160));

  const retomar = [...barra.querySelectorAll("button")].find(b => b.textContent === "Retomarla");
  if (!retomar) { anotar("Hay botón Retomarla", false, "botones: " + JSON.stringify([...barra.querySelectorAll("button")].map(b => b.textContent))); return JSON.stringify({ paso, errores: window.__errores }); }
  retomar.click();
  await dormir(1200);
  anotar("Retomarla recupera la transcripción anterior en pantalla",
    acta().length === 1 && acta()[0].texto.includes("antes de que se cerrara"), JSON.stringify(acta()));
  anotar("Y sigue escuchando desde ahí", $("#reunionEstadoTexto").textContent === "Escuchando" && Boolean(motor("es-CL")), "");
  motor("es-CL").emitir("y ahora seguimos donde lo dejamos", 0.9); await dormir(1300);
  anotar("Lo nuevo se suma a lo viejo, no lo reemplaza", acta().length === 2, JSON.stringify(acta().map(a => a.texto)));
`));

process.exit(informar(r) ? 1 : 0);
