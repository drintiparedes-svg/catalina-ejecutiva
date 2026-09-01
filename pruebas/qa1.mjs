import { escenario, informar } from "./qa-banco.mjs";
const r = [];

r.push(await escenario("Preparación: tipos, idiomas y participación propuesta", `
  $("#meetMode").click(); await dormir(400);
  const tipos = [...document.querySelectorAll("#prepararTipos .tipo-reunion")];
  anotar("Se ofrecen los cinco tipos", tipos.length === 5, tipos.map(t => t.querySelector("b").textContent).join(" | "));

  // Cada tipo propone su propia participación. La creativa es la única que sí.
  const propuestas = [];
  for (const t of tipos) { t.click(); await dormir(60); propuestas.push($("#prepararParticipa").checked); }
  anotar("Cada tipo propone su participación, y sólo la creativa la activa",
    propuestas.filter(Boolean).length === 1 && propuestas[4] === true, JSON.stringify(propuestas));

  const marcado = [...document.querySelectorAll("#prepararTipos .tipo-reunion")].filter(t => t.getAttribute("aria-checked") === "true");
  anotar("Sólo queda un tipo marcado a la vez", marcado.length === 1, "marcados: " + marcado.length);

  // Idiomas: se puede quedar uno, nunca cero.
  // Los botones se redibujan en cada clic, así que hay que volver a buscarlos.
  const idioma = i => [...document.querySelectorAll("#prepararIdiomas .tipo-idioma")][i];
  idioma(1).click(); await dormir(80);
  anotar("Se puede desmarcar un idioma", idioma(1).getAttribute("aria-pressed") === "false", "inglés: " + idioma(1).getAttribute("aria-pressed"));
  idioma(0).click(); await dormir(80);
  anotar("No se puede quedar sin ningún idioma", idioma(0).getAttribute("aria-pressed") === "true", "español quedó: " + idioma(0).getAttribute("aria-pressed"));

  // Con un solo idioma, un solo motor y sin espera de desempate.
  $("#prepararEmpezar").click(); await dormir(700);
  anotar("Con un idioma arranca un solo motor",
    window.__motores.filter(m => m.corriendo).length === 1 && Boolean(motor("es-CL")),
    window.__motores.map(m => m.lang + (m.corriendo ? "✓" : "✗")).join(" "));

  motor("es-CL").emitir("con un solo idioma la frase sale sin esperar", 0.9);
  await dormir(250);
  anotar("Con un idioma la frase sale al instante, sin los 900 ms de desempate",
    acta().length === 1, JSON.stringify(acta()));
`));

r.push(await escenario("El cuaderno es acumulativo y sobrevive a abrir y cerrar", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);

  $("#reunionNota").click(); await dormir(200);
  anotar("«Tomar nota» abre el cuaderno", visible("#reunionCuaderno"), "");
  $("#reunionNotas").value = "Primera nota importante";
  $("#reunionNotas").dispatchEvent(new Event("input"));
  await dormir(150);
  $("#reunionCerrarNotas").click(); await dormir(200);
  anotar("Se cierra y avisa de cuántas notas hay",
    !visible("#reunionCuaderno") && $("#reunionEco").textContent.includes("1 nota"), $("#reunionEco").textContent);

  motor("es-CL").emitir("mientras tanto se sigue transcribiendo", 0.9);
  await dormir(1200);

  $("#reunionNota").click(); await dormir(200);
  anotar("Al reabrirlo está lo escrito antes",
    $("#reunionNotas").value === "Primera nota importante", JSON.stringify($("#reunionNotas").value));
  $("#reunionNotas").value += "\\nSegunda nota añadida debajo";
  $("#reunionNotas").dispatchEvent(new Event("input"));
  await dormir(150);
  $("#reunionCerrarNotas").click(); await dormir(200);
  anotar("La cuenta refleja las dos notas", $("#reunionCuenta").textContent.includes("2 notas"), $("#reunionCuenta").textContent);
  anotar("Y la transcripción no se perdió por abrir el cuaderno", acta().length === 1, JSON.stringify(acta()));
`));

r.push(await escenario("Atribución de quién habla", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);
  const es = motor("es-CL");

  es.emitir("esto lo dice alguien sin identificar", 0.9); await dormir(1200);
  anotar("Sin nombre, la frase queda como «Sin identificar»", acta()[0].quien === "Sin identificar", acta()[0].quien);

  $("#reunionQuien").value = "Inti Paredes"; $("#reunionQuien").dispatchEvent(new Event("input"));
  await dormir(120);
  es.emitir("y esto lo dice Inti", 0.9); await dormir(1200);
  anotar("Al fijar el nombre, la frase siguiente se le atribuye", acta()[1].quien === "Inti Paredes", acta()[1].quien);
  anotar("Y la anterior NO se reescribe", acta()[0].quien === "Sin identificar", acta()[0].quien);

  $("#reunionQuien").value = "Sarah Klein"; $("#reunionQuien").dispatchEvent(new Event("input"));
  await dormir(120);
  es.emitir("ahora habla otra persona", 0.9); await dormir(1200);
  anotar("Cambiar de hablante cambia la atribución", acta()[2].quien === "Sarah Klein", acta()[2].quien);
`));

r.push(await escenario("Documentos: en la preparación y durante la reunión", `
  const archivo = (nombre, texto) => { const dt = new DataTransfer(); dt.items.add(new File([texto], nombre, { type: "text/plain" })); return dt.files; };

  $("#meetMode").click(); await dormir(400);
  $("#reunionArchivo").files = archivo("antecedente.txt", "Acta previa del comité: se aprobó el presupuesto.");
  $("#reunionArchivo").dispatchEvent(new Event("change")); await dormir(900);
  anotar("Un documento aportado en la preparación se registra",
    $("#prepararAdjuntos").textContent.includes("1 documento"), $("#prepararAdjuntos").textContent);

  $("#prepararEmpezar").click(); await dormir(700);
  anotar("Al iniciar, el documento entra en la reunión", $("#reunionCuenta").textContent.includes("1 doc"), $("#reunionCuenta").textContent);

  $("#reunionArchivo").files = archivo("presupuesto.txt", "Detalle de gastos del piloto.");
  $("#reunionArchivo").dispatchEvent(new Event("change")); await dormir(900);
  anotar("Otro documento durante la reunión suma", $("#reunionCuenta").textContent.includes("2 doc"), $("#reunionCuenta").textContent);
  anotar("Y se dice cuál se añadió", $("#reunionEco").textContent.includes("presupuesto.txt"), $("#reunionEco").textContent);
`));

process.exit(informar(r) ? 1 : 0);
