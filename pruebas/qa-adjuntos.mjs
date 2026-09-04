import { escenario, informar } from "./qa-banco.mjs";
const r = [];

// Sesión de voz doble: guarda lo que se le manda, para poder comprobar QUÉ le
// llega a Catalina cuando se sube un documento.
const PREVIO = `
window.__sesion = {
  muted: false, enviados: [],
  async connect() { window.catalina.manejadores.onConnected(); },
  disconnect() { window.catalina.manejadores.onDisconnected(); },
  toggleMute() { this.muted = !this.muted; return this.muted; },
  pausarEnvio(p) { this.muted = Boolean(p); return this.muted; },
  enviarTexto(t) { this.enviados.push(t); return true; }
};
// El servidor describe las imágenes; aquí se responde en falso para no salir.
const fetchAntes = window.fetch;
window.fetch = function (url, opciones) {
  if (String(url) === "/documento/imagen") {
    const cuerpo = JSON.parse(opciones.body);
    window.__imagenPedida = { nombre: cuerpo.nombre, tipo: cuerpo.tipo, bytes: (cuerpo.base64 || "").length, nota: cuerpo.nota };
    return Promise.resolve(new Response(JSON.stringify({
      ok: true, descripcion: "Una diapositiva titulada «Presupuesto 2026» con una tabla de tres filas: enero 12, febrero 15, marzo 9."
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return fetchAntes.apply(this, arguments);
};
`;

const archivo = `(nombre, texto, tipo) => { const dt = new DataTransfer(); dt.items.add(new File([texto], nombre, { type: tipo || "text/plain" })); return dt.files; }`;

r.push(await escenario("Subir un documento y que llegue a Catalina como contexto", `
  const hacer = ${archivo};
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(500);

  $("#togglePanel").click(); await dormir(200);
  anotar("El panel ofrece subir un documento", Boolean($("#panelSubir")) && !$("#panelSubir").disabled, "");

  const largo = "Acta del comité. " + "Se acordó revisar el presupuesto del piloto en marzo. ".repeat(400);
  $("#panelArchivo").files = hacer("acta-comite.txt", largo);
  $("#panelArchivo").dispatchEvent(new Event("change"));
  await dormir(1500);

  const fichas = [...document.querySelectorAll("#panelAdjuntos .adjunto")];
  anotar("Aparece en la lista de documentos de la conversación", fichas.length === 1, fichas.length + " fichas");
  anotar("Con su nombre y cuántos caracteres se leyeron",
    fichas[0]?.querySelector("b").textContent === "acta-comite.txt" && /car\\./.test(fichas[0]?.querySelector("i").textContent),
    fichas[0]?.textContent);

  const enviado = window.__sesion.enviados.at(-1) || "";
  anotar("Se le manda a Catalina como contexto, no como pregunta suelta",
    enviado.startsWith("[Contexto]") && enviado.includes("acta-comite.txt"), enviado.slice(0, 90));
  anotar("Le llega el principio del documento, no el documento entero",
    enviado.includes("Acta del comité") && enviado.length < largo.length,
    "mandado " + enviado.length + " car. de un documento de " + largo.length);
  anotar("Y se le dice cómo pedir el resto", /consultar_documento/.test(enviado), "");
  anotar("Con la instrucción de comentarlo breve y en voz alta",
    /dos o tres frases/.test(enviado) && /voz alta/.test(enviado), "");

  // La herramienta: pedir más, y seguir desde donde se quedó.
  const t1 = await window.catalina.manejadores.onToolCall("consultar_documento", { nombre: "acta" });
  anotar("«consultar_documento» encuentra el documento por parte del nombre",
    t1?.ok === true && t1.nombre === "acta-comite.txt", JSON.stringify(t1).slice(0, 110));
  anotar("Devuelve un trozo y dice cuánto queda", t1.texto.length > 0 && t1.queda > 0, "trozo " + t1.texto.length + ", queda " + t1.queda);
  anotar("Y dice explícitamente desde dónde seguir", /desde \\d+/.test(t1.siguiente), t1.siguiente);

  const t2 = await window.catalina.manejadores.onToolCall("consultar_documento", { nombre: "acta", desde: t1.hasta });
  anotar("El trozo siguiente continúa donde acabó el anterior", t2.desde === t1.hasta && t2.texto !== t1.texto, t2.desde + " vs " + t1.hasta);

  const t3 = await window.catalina.manejadores.onToolCall("consultar_documento", { nombre: "no-existe" });
  anotar("Si pide uno que no existe, se le dice y se le listan los que hay",
    t3.ok === false && Array.isArray(t3.disponibles) && t3.disponibles.includes("acta-comite.txt"), JSON.stringify(t3));
`, { previoExtra: PREVIO, espera: 60000 }));

r.push(await escenario("Una imagen la mira el modelo, y se dice que fue así", `
  const hacer = ${archivo};
  window.catalina.disponible.elevenlabs = true;
  window.catalina.sesiones.elevenlabs = window.__sesion;
  $("#connect").click(); await dormir(500);
  $("#togglePanel").click(); await dormir(200);

  $("#panelArchivo").files = hacer("diapositiva.png", "\\x89PNG datos binarios de prueba", "image/png");
  $("#panelArchivo").dispatchEvent(new Event("change"));
  await dormir(2000);

  anotar("La imagen se manda al servidor para que la describa",
    window.__imagenPedida?.nombre === "diapositiva.png" && window.__imagenPedida?.tipo === "image/png",
    JSON.stringify(window.__imagenPedida));
  anotar("Y viaja en base64, no vacía", (window.__imagenPedida?.bytes || 0) > 0, String(window.__imagenPedida?.bytes));

  const ficha = document.querySelector("#panelAdjuntos .adjunto");
  anotar("La ficha dice que es una imagen descrita, no un archivo leído",
    /imagen descrita/.test(ficha?.textContent || ""), ficha?.textContent);

  const enviado = window.__sesion.enviados.at(-1) || "";
  anotar("A Catalina le llega lo que se ve, no el archivo",
    /te acaban de mostrar una imagen/i.test(enviado) && /Presupuesto 2026/.test(enviado), enviado.slice(0, 120));
  anotar("Y se le advierte que es una descripción",
    /lector de imágenes/.test(enviado), "");
`, { previoExtra: PREVIO, espera: 60000 }));

r.push(await escenario("Lo que no se puede leer se dice, y no rompe nada", `
  const hacer = ${archivo};
  $("#togglePanel").click(); await dormir(200);

  // Sin conversación abierta: el documento tiene que cargarse igual.
  $("#panelArchivo").files = hacer("notas.txt", "Contenido breve de prueba.");
  $("#panelArchivo").dispatchEvent(new Event("change"));
  await dormir(1200);
  anotar("Sin la conversación abierta, el documento se carga igual",
    document.querySelectorAll("#panelAdjuntos .adjunto").length === 1, "");
  anotar("Y se avisa de que hay que iniciar la conversación para comentarlo",
    /Iniciar conversación/.test($("#caption").textContent), $("#caption").textContent);

  // Un formato que el navegador no sabe leer.
  $("#panelArchivo").files = hacer("presentacion.ppt", "formato antiguo", "application/vnd.ms-powerpoint");
  $("#panelArchivo").dispatchEvent(new Event("change"));
  await dormir(1200);
  const malo = [...document.querySelectorAll('#panelAdjuntos .adjunto[data-estado="problema"]')];
  anotar("Un formato que no se puede leer se marca y se explica por qué",
    malo.length === 1 && /formato antiguo|no se puede|pptx/i.test(malo[0].textContent), malo[0]?.textContent.slice(0, 120));
  anotar("Y el que sí se leyó sigue estando", listarEnPantalla().includes("notas.txt"), listarEnPantalla().join(", "));

  function listarEnPantalla() {
    return [...document.querySelectorAll('#panelAdjuntos .adjunto:not([data-estado="problema"]) b')].map(b => b.textContent);
  }

  // Quitarlo lo quita de verdad.
  document.querySelector('#panelAdjuntos .adjunto:not([data-estado="problema"]) button').click();
  await dormir(300);
  anotar("Quitar un documento lo saca de la lista", listarEnPantalla().length === 0, listarEnPantalla().join(", "));
  const t = await window.catalina.manejadores.onToolCall("consultar_documento", {});
  anotar("Y Catalina ya no lo encuentra", t.ok === false, JSON.stringify(t));
`, { previoExtra: PREVIO, espera: 60000 }));

process.exit(informar(r) ? 1 : 0);
