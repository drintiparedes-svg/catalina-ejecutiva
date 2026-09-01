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

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de redacción pasan`);
process.exit(mal ? 1 : 0);
