import { escenario, informar } from "./qa-banco.mjs";
const r = [];

r.push(await escenario("La página de diagnóstico /reunion.html", `
  anotar("Carga y trae las tres secciones de diagnóstico",
    document.body.textContent.includes("Redacción") &&
    /Dónde se archivan|archivan/.test(document.body.textContent) &&
    /correo/i.test(document.body.textContent),
    document.body.textContent.slice(0, 120).replace(/\\s+/g, " "));
  const botones = [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean);
  anotar("Ofrece la prueba de micrófono aislada",
    botones.some(b => /micr[oó]fono/i.test(b)), JSON.stringify(botones.slice(0, 8)));
  anotar("Ninguna referencia del guion apunta a la nada", window.__errores.length === 0, JSON.stringify(window.__errores));
`, { url: "http://127.0.0.1:8123/reunion.html" }));

r.push(await escenario("En pantalla de móvil, la reunión sigue cabiendo", `
  $("#meetMode").click(); await dormir(400);
  const prep = $("#preparar").getBoundingClientRect();
  anotar("La preparación no se sale de la pantalla",
    prep.right <= window.innerWidth + 1 && prep.left >= -1, "izq " + Math.round(prep.left) + " der " + Math.round(prep.right) + " de " + window.innerWidth);
  anotar("Y el botón de iniciar es alcanzable", $("#prepararEmpezar").getBoundingClientRect().bottom <= window.innerHeight + 1,
    "fondo " + Math.round($("#prepararEmpezar").getBoundingClientRect().bottom) + " de " + window.innerHeight);

  $("#prepararEmpezar").click(); await dormir(700);
  for (let i = 0; i < 12; i += 1) { motor("es-CL").emitir("frase número " + i + " de una reunión bastante larga que llena el acta", 0.9); await dormir(60); }
  await dormir(1300);
  anotar("Con doce frases el acta no desborda la tira",
    $("#reunionActa").scrollHeight > $("#reunionActa").clientHeight && $("#reunionActa").clientHeight <= 320,
    "alto visible " + $("#reunionActa").clientHeight + ", contenido " + $("#reunionActa").scrollHeight);
  const tira = $("#reunion").getBoundingClientRect();
  anotar("La tira entera cabe a lo ancho", tira.right <= window.innerWidth + 1, "der " + Math.round(tira.right) + " de " + window.innerWidth);
  anotar("Y el botón de finalizar sigue a la vista",
    $("#reunionFinalizar").getBoundingClientRect().bottom <= window.innerHeight + 1,
    "fondo " + Math.round($("#reunionFinalizar").getBoundingClientRect().bottom) + " de " + window.innerHeight);
  anotar("La página no scrollea de lado", document.documentElement.scrollWidth <= window.innerWidth + 1,
    document.documentElement.scrollWidth + " vs " + window.innerWidth);
`, { movil: true }));

process.exit(informar(r) ? 1 : 0);
