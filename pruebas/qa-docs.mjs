// Los dos documentos que salen de una reunión bilingüe: que sean archivos
// válidos de verdad y que no hayan perdido ni traducido nada.
import { inflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const reunion = {
  inicio: Date.now() - 3600000, fin: Date.now(),
  titulo: "Comité bilingüe", objetivo: "Cerrar el alcance del piloto",
  tipo: "operacional", idiomas: ["es", "en"],
  participantes: ["Inti Paredes", "Sarah Klein"],
  turnos: [
    { t: 1, hablante: "Inti Paredes", texto: "Propongo arrancar el piloto en marzo con dos servicios.", idioma: "es", origen: "CONVERSACION" },
    { t: 2, hablante: "Sarah Klein", texto: "We should check the budget before committing to that date.", idioma: "en", origen: "CONVERSACION" },
    { t: 3, hablante: "Inti Paredes", texto: "De acuerdo, lo revisamos el lunes con el área de finanzas.", idioma: "es", origen: "CONVERSACION" }
  ],
  cuaderno: "Destacar el riesgo de plazos\nPedir el presupuesto a finanzas",
  documentos: [{ nombre: "presupuesto.txt", tipo: "text/plain", texto: "Detalle de gastos del piloto: 12 millones.", descripcion: "Presupuesto preliminar" }],
  intervenciones: [], antecedente: null, destinatario: ""
};

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });

const res = await fetch("http://127.0.0.1:8123/reunion/cerrar", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reunion)
});
const datos = await res.json();
anotar("El cierre responde 200", res.status === 200, String(res.status));
anotar("Genera los dos archivos", Boolean(datos.archivos?.transcripcion?.base64 && datos.archivos?.minuta?.base64), "");

const docx = Buffer.from(datos.archivos.transcripcion.base64, "base64");
const pdf = Buffer.from(datos.archivos.minuta.base64, "base64");
writeFileSync("qa-transcripcion.docx", docx);
writeFileSync("qa-minuta.pdf", pdf);

// ── El .docx es un ZIP con las piezas que Word exige ────────────────────────
anotar("El Word empieza por la firma de un ZIP", docx.subarray(0, 2).toString() === "PK", docx.subarray(0, 2).toString());
const piezas = new Map();
for (let i = 0; i < docx.length - 4; i += 1) {
  if (docx.readUInt32LE(i) !== 0x04034b50) continue;
  const nLen = docx.readUInt16LE(i + 26), eLen = docx.readUInt16LE(i + 28);
  const nombre = docx.subarray(i + 30, i + 30 + nLen).toString();
  const comprimido = docx.readUInt32LE(i + 18), metodo = docx.readUInt16LE(i + 8);
  const inicio = i + 30 + nLen + eLen;
  const crudo = docx.subarray(inicio, inicio + comprimido);
  try { piezas.set(nombre, metodo === 8 ? inflateRawSync(crudo).toString("utf8") : crudo.toString("utf8")); } catch { piezas.set(nombre, ""); }
}
const exigidas = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];
anotar("Trae las piezas que Word exige", exigidas.every(p => piezas.has(p)), [...piezas.keys()].join(", "));

const doc = piezas.get("word/document.xml") || "";
anotar("El XML del documento está bien formado",
  doc.startsWith("<?xml") && doc.trimEnd().endsWith("</w:document>") &&
  (doc.match(/<w:p[ >]/g) || []).length === (doc.match(/<\/w:p>/g) || []).length,
  "párrafos abiertos/cerrados: " + (doc.match(/<w:p[ >]/g) || []).length + "/" + (doc.match(/<\/w:p>/g) || []).length);

const texto = doc.replace(/<[^>]+>/g, " ");
anotar("La intervención en español está, en español", texto.includes("piloto en marzo"), "");
anotar("La intervención en inglés está, EN INGLÉS y sin traducir",
  texto.includes("check the budget") && !texto.includes("revisar el presupuesto antes"), "");
anotar("Los dos hablantes aparecen atribuidos",
  texto.includes("Inti Paredes") && texto.includes("Sarah Klein"), "");
anotar("Las notas del cuaderno se conservan al final del Word",
  texto.includes("riesgo de plazos") && texto.includes("presupuesto a finanzas"), "");
anotar("El documento aportado queda registrado", texto.includes("presupuesto.txt"), "");

// ── El PDF ─────────────────────────────────────────────────────────────────
const pdfTexto = pdf.toString("latin1");
anotar("El PDF empieza y termina como un PDF",
  pdfTexto.startsWith("%PDF-") && pdfTexto.trimEnd().endsWith("%%EOF"), pdfTexto.slice(0, 8));
anotar("Declara su tabla de referencias cruzadas", pdfTexto.includes("xref") && pdfTexto.includes("trailer"), "");
const paginas = (pdfTexto.match(/\/Type\s*\/Page[^s]/g) || []).length;
anotar("Tiene al menos una página", paginas >= 1, "páginas: " + paginas);
anotar("La minuta lleva el título de la reunión", pdfTexto.includes("Comit") , "");
// Una nota editorial NO puede aparecer como algo que alguien dijo.
anotar("En la minuta las notas no se atribuyen a nadie como intervención",
  !/Inti Paredes[^)]{0,40}riesgo de plazos/.test(pdfTexto), "");

anotar("Se declara qué se comprobó al cerrar", Array.isArray(datos.integridad?.comprobaciones) && datos.integridad.comprobaciones.length >= 6,
  String(datos.integridad?.comprobaciones?.length));

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de documentos pasan`);
process.exit(mal ? 1 : 0);
