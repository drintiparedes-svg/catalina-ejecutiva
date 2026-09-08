// ¿Los cinco tipos mandan de verdad instrucciones distintas al modelo, o es el
// mismo prompt con otro nombre? Es lo que se reportó tras la última prueba.
process.env.GEMINI_API_KEY = "clave-de-prueba";
const enviados = [];
globalThis.fetch = async (url, opciones) => {
  const u = String(url);
  if (u.includes("/models?") || u.endsWith("/models")) {
    return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
  }
  const cuerpo = JSON.parse(opciones.body);
  const prompt = cuerpo.contents[0].parts[0].text;
  enviados.push(prompt);
  // Una minuta mínima pero válida, para que el flujo siga.
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ titulo: "T", resumen: "R", participantes: [] }) }] } }]
  }), { status: 200 });
};

const { redactarMinuta, revisarTranscripcion } = await import("../redaccion.mjs");
const { TIPOS } = await import("../public/tipos-de-reunion.js");

const reunionBase = {
  titulo: "Comité", objetivo: "Decidir el piloto",
  turnos: [{ hablante: "Inti", texto: "Propongo arrancar el piloto en marzo con dos servicios." },
           { hablante: "Sarah", texto: "We should check the budget before committing to that date." }],
  cuaderno: "", documentos: [], intervenciones: [], participantes: ["Inti", "Sarah"]
};

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });

const porTipo = {};
for (const id of Object.keys(TIPOS)) {
  enviados.length = 0;
  await redactarMinuta({ ...reunionBase, tipo: id });
  porTipo[id] = enviados[0] || "";
}

const ids = Object.keys(porTipo);
anotar("Los cinco tipos generan prompt", ids.every(i => porTipo[i].length > 200), ids.map(i => i + ":" + porTipo[i].length).join(" "));

const distintos = new Set(ids.map(i => porTipo[i]));
anotar("Los cinco prompts son distintos entre sí", distintos.size === 5, "prompts únicos: " + distintos.size + " de 5");

// Y no distintos por el nombre: distintos en las instrucciones de fondo.
const sinNombre = ids.map(i => porTipo[i].replace(new RegExp(TIPOS[i].nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "«TIPO»"));
anotar("Y siguen siendo distintos aunque se tape el nombre del tipo",
  new Set(sinNombre).size === 5, "únicos sin el nombre: " + new Set(sinNombre).size);

// Cada uno debe pedir lo suyo.
const pide = (id, aguja) => porTipo[id].toLowerCase().includes(aguja.toLowerCase());
anotar("La conferencia pide conceptos y referencias", pide("conferencia", "concepto"), "");
anotar("La operacional pide tareas con dueño y fecha", pide("operacional", "tarea") || pide("operacional", "dueño"), "");
anotar("La ejecutiva pide la decisión y sus alternativas", pide("ejecutiva", "decisión") && pide("ejecutiva", "alternativa"), "");
anotar("La lean pide causas y contramedidas", pide("lean", "contramedida"), "");
anotar("La creativa pide ideas e hipótesis", pide("creativa", "hipótesis") || pide("creativa", "idea"), "");

// Y la transcripción bilingüe: prohibido traducir.
enviados.length = 0;
await revisarTranscripcion({ ...reunionBase, idiomas: ["es", "en"] });
const bil = enviados[0] || "";
anotar("Con reunión bilingüe se le prohíbe traducir explícitamente",
  /NO traduzcas/i.test(bil) && /BILINGÜE/i.test(bil), bil.split("\n").slice(0, 3).join(" / "));

enviados.length = 0;
await revisarTranscripcion({ ...reunionBase, idiomas: ["es"] });
const mono = enviados[0] || "";
anotar("Con reunión en un idioma no se le mete esa regla de más",
  !/NO traduzcas/i.test(mono) && /español de Chile/i.test(mono), mono.split("\n")[0]);

// ── Describir una imagen ────────────────────────────────────────────────────
const { describirImagen } = await import("../redaccion.mjs");
enviados.length = 0;
let cuerpoEnviado = null;
const fetchTexto = globalThis.fetch;
globalThis.fetch = async (url, opciones) => {
  if (opciones?.body && String(url).includes("generateContent")) cuerpoEnviado = JSON.parse(opciones.body);
  return fetchTexto(url, opciones);
};
const r = await describirImagen({ base64: "QUJD", tipo: "image/png", nombre: "diapositiva.png", nota: "es del comité" });
anotar("Describir una imagen devuelve la descripción", r.ok === true && typeof r.descripcion === "string", JSON.stringify(r).slice(0, 90));
anotar("La imagen viaja al modelo como dato incrustado, con su tipo",
  cuerpoEnviado?.contents?.[0]?.parts?.some(p => p.inlineData?.data === "QUJD" && p.inlineData?.mimeType === "image/png"),
  JSON.stringify(cuerpoEnviado?.contents?.[0]?.parts?.map(p => Object.keys(p))));
const promptImagen = cuerpoEnviado?.contents?.[0]?.parts?.[0]?.text || "";
anotar("Se le pide transcribir el texto que aparece, no interpretarlo",
  /transcrito literalmente/.test(promptImagen) && /PROHIBIDO: interpretar/.test(promptImagen), "");
anotar("Y que marque lo ilegible en vez de completarlo", /\[ilegible\]/.test(promptImagen), "");
anotar("Si es clínica, describe sin diagnosticar", /sin diagnosticar/.test(promptImagen), "");
anotar("Se le pasa el nombre del archivo y lo que dijo quien la sube",
  /diapositiva\.png/.test(promptImagen) && /es del comité/.test(promptImagen), "");

// ── Resumen de una conversación ─────────────────────────────────────────────
const { redactarConversacion, conversacionSinModelo } = await import("../redaccion.mjs");
enviados.length = 0;
const charla = {
  inicio: Date.now() - 600000, fin: Date.now(), minutos: 10,
  turnos: [
    { quien: "usuario", texto: "Necesito cerrar el alcance del piloto." },
    { quien: "catalina", texto: "Son dos servicios, y el presupuesto son doce millones." }
  ],
  documentos: [{ nombre: "presupuesto.xlsx", imagen: false, caracteres: 400, texto: "Detalle de gastos" }]
};
await redactarConversacion(charla);
const pc = enviados[0] || "";
anotar("El resumen separa acuerdos de alcance, que son cosas distintas",
  /· acuerdos:/.test(pc) && /· alcance:/.test(pc), "");
anotar("Y se le dice para qué sirve cada uno",
  /decidió HACER/.test(pc) && /qué quedó explícitamente fuera/.test(pc), "");
anotar("Se le prohíbe convertir en acuerdo lo que no se cerró",
  /no se cerró NO es un acuerdo/.test(pc), "");
anotar("Y lo que sólo propuso ella y no se aceptó",
  /sólo propuso Catalina y la persona no aceptó/.test(pc), "");
anotar("Un dato de un documento se marca como tal, no como algo hablado",
  /según el archivo X/.test(pc), "");
anotar("Una lista vacía es una respuesta válida, no algo que rellenar",
  /Vacía es una respuesta correcta/.test(pc), "");
anotar("El diálogo va con quién dijo cada cosa", /INTI: Necesito cerrar/.test(pc) && /CATALINA: Son dos servicios/.test(pc), "");
anotar("Y los documentos van aparte de lo hablado", /DOCUMENTOS QUE SE USARON/.test(pc) && /presupuesto\.xlsx/.test(pc), "");

// Sin conversación no se inventa un resumen.
const nada = await redactarConversacion({ turnos: [] });
anotar("Sin conversación no se redacta nada", nada.ok === false && nada.code === "SIN_MATERIAL", JSON.stringify(nada));

// Sin modelo, el diálogo se conserva tal cual en vez de perderse.
const respaldo = conversacionSinModelo(charla);
anotar("Sin modelo, la conversación se conserva literal en vez de perderse",
  respaldo.sinModelo === true && respaldo.minuta.length === 2 && /Inti: Necesito cerrar/.test(respaldo.minuta[0]),
  JSON.stringify(respaldo.minuta));
anotar("Y no se inventan acuerdos que nadie sacó",
  respaldo.acuerdos.length === 0 && respaldo.alcance.length === 0, "");

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de redacción pasan`);
process.exit(mal ? 1 : 0);
