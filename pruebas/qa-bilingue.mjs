// Bilingüe con los dos motores oyendo EL MISMO audio, que es lo que pasa de
// verdad: Chrome levanta dos reconocimientos sobre el mismo micrófono y cada
// uno escribe lo que oye en su lengua.
const motores = [];
class Falso {
  constructor() { this.lang = "en-US"; this.corriendo = false; motores.push(this); }
  start() { if (this.corriendo) { const e = new Error("ya"); e.name = "InvalidStateError"; throw e; } this.corriendo = true; this.onstart?.({}); }
  stop() { this.corriendo = false; this.onend?.({}); }
  abort() { this.corriendo = false; }
  emitir(t, conf = 0.8, final = true) {
    this.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: t, confidence: conf }, length: 1, isFinal: final }, length: 1 } });
  }
}
globalThis.window = { SpeechRecognition: Falso };
const { EscuchaDeReunion } = await import("../public/escucha.js");
const dormir = ms => new Promise(r => setTimeout(r, ms));
const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });

// Cada intervención, tal como la escribiría cada motor sobre el mismo audio.
const guion = [
  { en: false, es: "Bueno, entonces lo que tenemos que definir hoy es el alcance del piloto",
               versionEn: "bueno and thanks look at that em others can they for me all cans and pill oto" },
  { en: true,  es: "so el resto of de tim will be looking at de data from de first cuarter",
               versionEn: "So the rest of the team will be looking at the data from the first quarter" },
  { en: false, es: "De acuerdo, lo revisamos el lunes con el área de finanzas",
               versionEn: "the a quarto low rey be sam os el lunes con el are a the finance as" },
  { en: true,  es: "we nid tu ric on sider de pramary end point of de trayal",
               versionEn: "We need to reconsider the primary endpoint of the trial" },
  { en: false, es: "no estoy de acuerdo con esa lectura de los datos",
               versionEn: "no is toy the a quarto con esa lecture the los datos" },
  { en: true,  es: "guat is de tayme layn for de pailot in de hospital",
               versionEn: "What is the timeline for the pilot in the hospital" },
  { en: false, es: "quedamos entonces en que el piloto arranca en marzo",
               versionEn: "que the mos and on says and case el pill oto a ran ca and mar so" },
  { en: true,  es: "ay tink we shud olso cheq de bad yet befor we comit",
               versionEn: "I think we should also check the budget before we commit" }
];

async function correr(nombre, { desorden = 0, sinSegundo = false, soloUno = false } = {}) {
  motores.length = 0;
  const salida = [];
  const e = new EscuchaDeReunion({
    alTranscribir: (t, f) => salida.push({ id: f.id, texto: t, idioma: f.idioma }),
    alCorregir: f => { const i = salida.findIndex(s => s.id === f.id); if (i >= 0) salida[i] = { id: f.id, texto: f.texto, idioma: f.idioma }; }
  });
  e.empezar(soloUno ? ["es"] : ["es", "en"]);
  const es = motores.find(m => m.lang === "es-CL");
  const en = motores.find(m => m.lang === "en-US");
  for (const linea of guion) {
    es.emitir(linea.es, 0.8);
    if (!sinSegundo && en) { if (desorden) await dormir(desorden); en.emitir(linea.versionEn, 0.8); }
    await dormir(120);
  }
  await dormir(1500);
  e.parar();
  return { nombre, salida };
}

// ── Caso normal ────────────────────────────────────────────────────────────
let { salida } = await correr("normal");
anotar("No se pierde ni se duplica ninguna intervención", salida.length === guion.length,
  salida.length + " de " + guion.length + " → " + JSON.stringify(salida.map(s => s.idioma)));
const enBien = guion.map((g, i) => g.en === (salida[i]?.idioma === "en"));
anotar("Cada intervención sale en la lengua en que se dijo", enBien.every(Boolean),
  guion.map((g, i) => (g.en ? "EN" : "ES") + "→" + (salida[i]?.idioma || "-")).join(" "));
anotar("Y con el texto de esa lengua, no con el ruido de la otra",
  guion.every((g, i) => salida[i]?.texto === (g.en ? g.versionEn : g.es)),
  JSON.stringify(salida.filter((s, i) => s.texto !== (guion[i].en ? guion[i].versionEn : guion[i].es)).map(s => s.texto)));

// ── El segundo motor llega tarde ───────────────────────────────────────────
({ salida } = await correr("segundo tarde", { desorden: 350 }));
anotar("Aunque el segundo motor llegue 350 ms tarde, sigue sin perderse nada", salida.length === guion.length,
  salida.length + " de " + guion.length);
anotar("Y sigue acertando el idioma", guion.every((g, i) => g.en === (salida[i]?.idioma === "en")),
  guion.map((g, i) => (g.en ? "EN" : "ES") + "→" + (salida[i]?.idioma || "-")).join(" "));

// ── El segundo motor no arranca nunca ──────────────────────────────────────
({ salida } = await correr("sin segundo motor", { sinSegundo: true }));
anotar("Si el segundo motor nunca contesta, NO se pierde ninguna línea", salida.length === guion.length,
  salida.length + " de " + guion.length);
anotar("El peor caso es una frase mal transcrita, nunca una frase que desaparece",
  salida.every(s => s.texto.length > 0) && salida.every(s => s.idioma === "es"), "");

// ── Un solo idioma elegido ─────────────────────────────────────────────────
({ salida } = await correr("un idioma", { soloUno: true, sinSegundo: true }));
anotar("Con un solo idioma elegido salen todas, sin retraso", salida.length === guion.length, salida.length + " de " + guion.length);

// ── Ráfaga: una conversación viva, frases muy pegadas ──────────────────────
motores.length = 0;
const rafaga = [];
const e2 = new EscuchaDeReunion({ alTranscribir: (t, f) => rafaga.push({ id: f.id, texto: t }), alCorregir: () => {} });
e2.empezar(["es", "en"]);
const es2 = motores.find(m => m.lang === "es-CL"), en2 = motores.find(m => m.lang === "en-US");
for (let i = 0; i < 200; i += 1) {
  es2.emitir("intervención número " + i + " de una reunión que va muy rápida", 0.85);
  en2.emitir("in ter ven see on new me ro " + i + " the una re union", 0.4);
  await dormir(5);
}
await dormir(1500);
e2.parar();
anotar("Doscientas frases pegadas salen las doscientas", rafaga.length === 200, "salieron " + rafaga.length);
anotar("Y en orden, sin fundirse unas con otras",
  rafaga[0]?.texto.includes("número 0") && rafaga[199]?.texto.includes("número 199") &&
  rafaga.every((f, i) => f.texto.includes("número " + i)),
  rafaga.length ? rafaga[0].texto.slice(0, 30) + " … " + rafaga[rafaga.length - 1].texto.slice(0, 30) : "");

// ── Los motores se desincronizan: uno parte frases donde el otro no ────────
motores.length = 0;
const desinc = [];
const e3 = new EscuchaDeReunion({ alTranscribir: (t, f) => desinc.push({ id: f.id, texto: t, idioma: f.idioma }),
                                  alCorregir: f => { const i = desinc.findIndex(s => s.id === f.id); if (i >= 0) desinc[i] = { id: f.id, texto: f.texto, idioma: f.idioma }; } });
e3.empezar(["es", "en"]);
const es3 = motores.find(m => m.lang === "es-CL"), en3 = motores.find(m => m.lang === "en-US");
for (let i = 0; i < 40; i += 1) {
  es3.emitir("intervención en español número " + i + " que quedó dicha en la sala", 0.85);
  // El motor inglés parte cada frase en dos: sus cuentas se van separando.
  en3.emitir("in ter ven see on number " + i, 0.4);
  en3.emitir("that quedo the cha and la sala", 0.4);
  await dormir(8);
}
await dormir(1500);
const diag = e3.diagnostico();
e3.parar();
anotar("Con los motores desincronizados se deja de emparejar en vez de mezclar",
  diag.emparejandoIdiomas === false, "emparejando: " + diag.emparejandoIdiomas);
const corrompidas = desinc.map((d, i) => d.texto.includes("número " + i) ? null : i + ": " + d.texto).filter(Boolean);
anotar("Y aun así no se pierde ni una de las 40 intervenciones", desinc.length === 40, "salieron " + desinc.length + " de 40");
anotar("Ninguna línea se corrompe con la frase de otro antes de detectarlo",
  corrompidas.length === 0, corrompidas.join(" | "));

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones bilingües pasan`);
process.exit(mal ? 1 : 0);
