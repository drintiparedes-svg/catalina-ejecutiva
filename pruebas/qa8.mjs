import { escenario, informar } from "./qa-banco.mjs";
const r = [];

// Una carpeta falsa del sistema de archivos: la API real exige un diálogo que
// nadie puede pulsar en una prueba, pero todo lo que hay detrás sí se puede
// comprobar —qué se escribe, con qué nombre y qué pasa si el permiso se cae—.
const CARPETA_FALSA = `
window.__escritos = new Map();
window.__permiso = "granted";
window.__fallarEscritura = false;
class ArchivoFalso {
  constructor(nombre) { this.nombre = nombre; }
  async createWritable() {
    const nombre = this.nombre;
    return {
      async write(datos) {
        if (window.__fallarEscritura) throw new Error("disco lleno (simulado)");
        const largo = datos?.byteLength ?? datos?.length ?? String(datos).length;
        window.__escritos.set(nombre, largo);
      },
      async close() {}
    };
  }
  async getFile() { return new File([""], this.nombre); }
}
window.__carpeta = {
  kind: "directory",
  name: "Catalina — Reuniones",
  async getFileHandle(nombre) { return new ArchivoFalso(nombre); },
  async queryPermission() { return window.__permiso; },
  async requestPermission() { window.__permiso = "granted"; return "granted"; },
  async *values() {}
};
window.showDirectoryPicker = async () => window.__carpeta;
`;

r.push(await escenario("La carpeta local: se elige, se recuerda y se escribe en ella", `
  const carpetaMod = await import("/carpeta.js");
  anotar("El navegador puede usar carpetas", carpetaMod.carpetaDisponible(), "");

  const elegida = await carpetaMod.elegirCarpeta();
  anotar("Se elige la carpeta y se confirma con su nombre",
    elegida?.ok === true && elegida?.nombre === "Catalina — Reuniones", JSON.stringify({ ok: elegida?.ok, nombre: elegida?.nombre, error: elegida?.error }));

  const recordada = await carpetaMod.carpetaGuardada();
  anotar("Y se recuerda entre sesiones, sin volver a preguntar", recordada?.name === "Catalina — Reuniones", recordada?.name || "ninguna");

  // Ahora una reunión de verdad, y que sus tres archivos acaben ahí.
  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Comité archivado";
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("esto tiene que quedar guardado en la carpeta", 0.9); await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(11000);

  const nombres = [...window.__escritos.keys()];
  anotar("Se escriben los tres archivos: Word, PDF y la copia recuperable",
    nombres.length === 3 && nombres.some(n => n.endsWith(".docx")) && nombres.some(n => n.endsWith(".pdf")) && nombres.some(n => n.endsWith(".json")),
    JSON.stringify(nombres));
  anotar("Y ninguno sale vacío", [...window.__escritos.values()].every(t => t > 100), JSON.stringify([...window.__escritos.entries()]));
  anotar("El nombre lleva fecha y título, para encontrarlos después",
    nombres.some(n => /Transcripcion_\\d{2}-\\d{2}-\\d{4}_Comite-archivado\\.docx/.test(n)), JSON.stringify(nombres));
  anotar("Y se dice en pantalla dónde quedaron",
    $("#cierreCuerpo").innerText.includes("Catalina — Reuniones"),
    ($("#cierreCuerpo").innerText.match(/Guardado en[^\\n]*/) || [""])[0]);
`, { previoExtra: CARPETA_FALSA }));

r.push(await escenario("Si el permiso de la carpeta caducó, se pide en vez de fallar callando", `
  const carpetaMod = await import("/carpeta.js");
  await carpetaMod.elegirCarpeta();
  window.__permiso = "prompt";              // es lo que pasa al reiniciar el navegador

  $("#meetMode").click(); await dormir(400);
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("una reunión con el permiso caducado", 0.9); await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(11000);

  anotar("No se escribe nada a escondidas", window.__escritos.size === 0, JSON.stringify([...window.__escritos.keys()]));
  anotar("Se explica que el navegador vuelve a pedir permiso",
    /pide permiso/i.test($("#cierreCuerpo").innerText), ($("#cierreCuerpo").innerText.match(/[^\\n]*permiso[^\\n]*/) || [""])[0]);
  const boton = [...document.querySelectorAll("#cierreCuerpo button")].find(b => b.textContent.includes("Guardar en"));
  anotar("Y hay un botón para dárselo ahí mismo", Boolean(boton), "");

  boton.click(); await dormir(1500);
  anotar("Al pulsarlo se escriben los tres archivos", window.__escritos.size === 3, JSON.stringify([...window.__escritos.keys()]));
  anotar("Y se confirma", /Guardado en/.test($("#cierreCuerpo").innerText), "");
`, { previoExtra: CARPETA_FALSA }));

r.push(await escenario("Si la carpeta falla al escribir, se dice y NO se pierde nada", `
  const carpetaMod = await import("/carpeta.js");
  await carpetaMod.elegirCarpeta();
  window.__fallarEscritura = true;

  $("#meetMode").click(); await dormir(400);
  $("#prepararTitulo").value = "Comité con disco lleno";
  $("#prepararEmpezar").click(); await dormir(700);
  motor("es-CL").emitir("esto no se puede perder aunque falle la carpeta", 0.9); await dormir(1300);
  $("#reunionFinalizar").click(); await dormir(250);
  $("#reunionAceptar").click(); await dormir(11000);

  anotar("Se dice que la carpeta falló, con el motivo",
    /No se pudo escribir/i.test($("#cierreCuerpo").innerText) && /disco lleno/i.test($("#cierreCuerpo").innerText),
    ($("#cierreCuerpo").innerText.match(/No se pudo escribir[^\\n]*/) || [""])[0]);
  anotar("Los documentos siguen ahí para descargarlos", /\\.docx/.test($("#cierreCuerpo").innerText) && /\\.pdf/.test($("#cierreCuerpo").innerText), "");
  anotar("Y la reunión queda igualmente en el historial de este navegador",
    /historial/i.test($("#cierreCuerpo").innerText), "");
  $("#cierreCerrar").click(); await dormir(300);
  $("#reunionHistorial").click(); await dormir(1500);
  anotar("Y se puede abrir desde ahí",
    [...document.querySelectorAll(".historial-ficha")].some(f => f.textContent.includes("Comité con disco lleno")),
    [...document.querySelectorAll(".historial-ficha")].map(f => f.textContent.slice(0, 40)).join(" | "));
`, { previoExtra: CARPETA_FALSA }));

process.exit(informar(r) ? 1 : 0);
