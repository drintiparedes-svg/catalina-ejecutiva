// La escucha, aislada. Aquí se prueba lo que en el navegador tarda demasiado o
// necesita una sesión de voz abierta: sordera, caídas, latido, doble idioma.
const motores = [];
class Falso {
  constructor() { this.lang = "en-US"; this.corriendo = false; this.arranques = 0; motores.push(this); }
  start() {
    if (this.corriendo) { const e = new Error("ya"); e.name = "InvalidStateError"; throw e; }
    if (this.negado) { const e = new Error("no"); e.name = "NotAllowedError"; throw e; }
    this.corriendo = true; this.arranques += 1; this.onstart?.({});
  }
  stop() { this.corriendo = false; this.onend?.({}); }
  abort() { this.corriendo = false; }
  morirSolo() { this.corriendo = false; }          // se cae sin avisar: ni onend
  fallar(c) { this.onerror?.({ error: c }); }
  emitir(t, conf = 0.8, final = true) {
    this.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: t, confidence: conf }, length: 1, isFinal: final }, length: 1 } });
  }
}
globalThis.window = { SpeechRecognition: Falso };
const { EscuchaDeReunion } = await import("../public/escucha.js");

const dormir = ms => new Promise(r => setTimeout(r, ms));
const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });
const de = c => motores.find(m => m.lang === c && m.corriendo);
const limpiar = () => { motores.length = 0; };

// ── 1. Sordera: no se apunta, pero NO se detiene nada ───────────────────────
limpiar();
let oidas = [], fallos = [], parciales = [];
let e = new EscuchaDeReunion({
  alTranscribir: t => oidas.push(t),
  alParcial: t => parciales.push(t),
  alFallar: m => fallos.push(m)
});
e.empezar(["es"]);
de("es-CL").emitir("frase antes de que ella hable");
await dormir(50);
anotar("Con un idioma la frase entra sin esperar", oidas.length === 1, JSON.stringify(oidas));

e.ensordecer(true);
de("es-CL").emitir("esto lo dijo ella por el altavoz");
de("es-CL").emitir("otra vez su propia voz", 0.8, false);
await dormir(50);
anotar("Sorda, su propia voz no entra en la transcripción", oidas.length === 1, JSON.stringify(oidas));
anotar("Sorda, tampoco se enseña como frase parcial", parciales.length === 0, JSON.stringify(parciales));
anotar("Sorda, los reconocedores NO se paran", e.motores.every(m => m.activo) && Boolean(de("es-CL")), "");
anotar("Y queda constancia de lo descartado", e.diagnostico().descartadasPorSordera === 1, String(e.diagnostico().descartadasPorSordera));

e.ensordecer(false);
de("es-CL").emitir("y la sala vuelve a hablar");
await dormir(50);
anotar("Al dejar de ser sorda vuelve a apuntar", oidas.length === 2, JSON.stringify(oidas));

// ── 2. Un motor se cae: el otro sigue y no se alarma a nadie ────────────────
limpiar(); oidas = []; fallos = [];
e = new EscuchaDeReunion({ alTranscribir: t => oidas.push(t), alFallar: m => fallos.push(m) });
e.empezar(["es", "en"]);
anotar("Bilingüe arranca dos motores", motores.filter(m => m.corriendo).length === 2, motores.map(m => m.lang).join(" "));

de("en-US").fallar("network");
await dormir(30);
anotar("Si sólo cae un motor NO se avisa: el otro sigue escuchando", fallos.length === 0, JSON.stringify(fallos));

de("es-CL").fallar("network");
await dormir(30);
anotar("Si caen los dos, sí se avisa", fallos.length === 1 && fallos[0].includes("servidores de Google"), JSON.stringify(fallos));

// ── 3. Elección de idioma con los dos motores contestando ───────────────────
limpiar(); oidas = [];
const idiomas = [];
// El segundo idioma corrige la línea que ya estaba: hay que seguir las dos
// señales para ver el resultado final, no sólo la primera escritura.
const lineas = [];
e = new EscuchaDeReunion({
  alTranscribir: (t, f) => { oidas.push(t); idiomas.push(f.idioma); lineas.push(f); },
  alCorregir: f => { const i = lineas.indexOf(f); if (i >= 0) { oidas[i] = f.texto; idiomas[i] = f.idioma; } }
});
e.empezar(["es", "en"]);
de("es-CL").emitir("Bueno, entonces lo que tenemos que definir hoy es el alcance", 0.9);
de("en-US").emitir("bueno and thanks look at that em others can they", 0.4);
await dormir(1300);
anotar("La frase en español se queda en español pese al ruido del otro motor",
  oidas.length === 1 && idiomas[0] === "es" && oidas[0].includes("alcance"), JSON.stringify({ oidas, idiomas }));

de("en-US").emitir("So the rest of the team will be looking at the data", 0.9);
de("es-CL").emitir("so el resto of de tim will be looking at de data", 0.35);
await dormir(1300);
anotar("La frase dicha en inglés se corrige a inglés en su misma línea",
  oidas.length === 2 && idiomas[1] === "en" && oidas[1].includes("the team"), JSON.stringify({ oidas, idiomas }));

// Dos finales seguidos del mismo motor son DOS intervenciones, no una. El
// navegador cierra una frase por intervención; fundirlas era lo que hacía que
// una reunión fluida acabara en una sola línea.
de("es-CL").emitir("primera intervención seguida", 0.9);
de("es-CL").emitir("y otra intervención distinta", 0.9);
await dormir(1100);
anotar("Dos frases seguidas del mismo motor salen como dos, no como una",
  oidas.length === 4 && oidas[2] === "primera intervención seguida" && oidas[3] === "y otra intervención distinta",
  JSON.stringify(oidas.slice(2)));

// Y una conversación seguida, con frases más juntas que la ventana de
// desempate, no se funde ni se pierde. Es el caso de toda reunión de verdad.
const antesDeLaRafaga = oidas.length;
for (let i = 0; i < 30; i += 1) { de("es-CL").emitir("intervención número " + i, 0.9); await dormir(10); }
await dormir(1400);
anotar("Treinta frases seguidas y rápidas salen las treinta, en orden",
  oidas.length - antesDeLaRafaga === 30 && oidas[antesDeLaRafaga] === "intervención número 0" && oidas[oidas.length - 1] === "intervención número 29",
  "salieron " + (oidas.length - antesDeLaRafaga) + " de 30");

// ── 4. La última frase no se pierde al finalizar ────────────────────────────
const antesDelCierre = oidas.length;
de("es-CL").emitir("la última frase justo antes de pulsar finalizar", 0.9);
e.parar();                                   // sin esperar los 900 ms
anotar("Al finalizar se guarda la frase que estaba en la ventana de desempate",
  oidas.length === antesDelCierre + 1 && oidas[oidas.length - 1].includes("justo antes"), JSON.stringify(oidas.slice(-1)));
anotar("Y al parar quedan todos los motores apagados", e.motores.length === 0 && !e.activa, "");

// ── 5. El latido repone un motor que se murió sin avisar ────────────────────
limpiar(); fallos = [];
e = new EscuchaDeReunion({ alTranscribir: () => {}, alFallar: m => fallos.push(m) });
e.empezar(["es"]);
const uno = motores[0];
uno.morirSolo();                             // se cae en silencio: ni onend ni onerror
anotar("El motor está caído y nadie se ha enterado", !uno.corriendo, "");
await dormir(17000);                         // dos latidos: el primero sólo consume la señal de vida
anotar("El latido lo levanta solo", uno.corriendo && uno.arranques === 2, "arranques: " + uno.arranques);
e.parar();

// ── 6. Si el navegador no deja arrancar, se dice por qué ────────────────────
limpiar();
e = new EscuchaDeReunion({});
const original = Falso.prototype.start;
Falso.prototype.start = function () { const err = new Error("permiso denegado"); err.name = "NotAllowedError"; throw err; };
const arrancó = e.empezar(["es"]);
Falso.prototype.start = original;
anotar("Si no puede arrancar, lo dice y no miente", arrancó === false && e.ultimoFallo.includes("NotAllowedError"), e.ultimoFallo);

// ── 7. Volver a arrancar sobre lo mismo no reinicia nada ────────────────────
limpiar();
e = new EscuchaDeReunion({ alTranscribir: () => {} });
e.empezar(["es", "en"]);
const antes = motores.slice();
e.empezar(["es", "en"]);
e.empezar(["es", "en"]);
anotar("Llamar a empezar otra vez con los mismos idiomas no crea motores nuevos",
  motores.length === antes.length && motores.every((m, i) => m === antes[i]),
  "motores: " + motores.length);
e.parar();

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de la escucha pasan`);
process.exit(mal ? 1 : 0);
