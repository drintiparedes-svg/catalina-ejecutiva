import { escenario, informar } from "./qa-banco.mjs";
const r = [];

r.push(await escenario("Una reunión larga de verdad: 400 intervenciones", `
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Comité largo";
  $("#prepararEmpezar").click(); await dormir(600);
  const es = motor("es-CL"), en = motor("en-US");

  // Los dos motores oyen el mismo audio: cada intervención sale por los dos,
  // uno bien y el otro como ruido, que es lo que hace Chrome de verdad.
  const t0 = performance.now();
  for (let i = 0; i < 400; i += 1) {
    if (i % 5 === 0) {
      es.emitir("gui shud rivíu de data for cuarter number " + i + " bifor gui disaid enithing", 0.4);
      en.emitir("We should review the data for quarter number " + i + " before we decide anything", 0.9);
    } else {
      es.emitir("Intervención número " + i + ": revisamos el punto y quedamos en confirmarlo pronto", 0.9);
      en.emitir("in ter ven see on new me ro " + i + " rebisamos el punto and case the mos", 0.4);
    }
    if (i % 40 === 0) { $("#reunionQuien").value = "Persona " + (i / 40); $("#reunionQuien").dispatchEvent(new Event("input")); }
    await dormir(8);
  }
  await dormir(2000);
  const capturadas = performance.now() - t0;

  const lineas = document.querySelectorAll("#reunionActaLineas .acta-linea").length;
  anotar("Se capturan las 400 sin perder ninguna", lineas === 400, "líneas: " + lineas);
  anotar("Y el ritmo se mantiene: no se atasca", capturadas < 60000, Math.round(capturadas) + " ms para 400");

  // ¿Sigue respondiendo la interfaz con el acta llena?
  const t1 = performance.now();
  $("#reunionNota").click(); await dormir(120);
  $("#reunionNotas").value = "Nota al final de una reunión larga";
  $("#reunionNotas").dispatchEvent(new Event("input")); await dormir(120);
  $("#reunionCerrarNotas").click(); await dormir(120);
  anotar("La interfaz sigue respondiendo con el acta llena", performance.now() - t1 < 3000, Math.round(performance.now() - t1) + " ms");

  const idiomas = [...document.querySelectorAll("#reunionActaLineas .acta-idioma")].map(n => n.textContent);
  anotar("Las 80 intervenciones en inglés se detectaron como inglés",
    idiomas.filter(i => i === "EN").length === 80, "EN: " + idiomas.filter(i => i === "EN").length + " · ES: " + idiomas.filter(i => i === "ES").length);

  // El cierre con una reunión grande: ¿cabe la petición y llegan los documentos?
  const t2 = performance.now();
  $("#reunionFinalizar").click(); await dormir(300);
  $("#reunionAceptar").click(); await dormir(25000);
  anotar("Cierra una reunión de 400 intervenciones", $("#cierre").dataset.estado === "visible", $("#cierreTitulo").textContent);
  const cuerpo = $("#cierreCuerpo").innerText;
  anotar("El chequeo confirma las 400 capturadas", /400 frases o|400 intervenciones/.test(cuerpo),
    (cuerpo.match(/Audio procesado[^✓✕!]*/) || [""])[0].slice(0, 80));
  anotar("Y genera los dos documentos", /\\.docx/.test(cuerpo) && /\\.pdf/.test(cuerpo), "");
  anotar("El cierre tarda algo razonable", performance.now() - t2 < 40000, Math.round((performance.now() - t2) / 1000) + " s");

  const peso = window.__peticiones.filter(p => p.url.includes("/reunion/cerrar")).map(p => (p.cuerpo || "").length)[0] || 0;
  anotar("La petición de cierre cabe de sobra en el límite de Vercel (4,5 MB)",
    peso > 0 && peso < 4_000_000, Math.round(peso / 1024) + " KB");
`, { espera: 180000 }));

process.exit(informar(r) ? 1 : 0);
