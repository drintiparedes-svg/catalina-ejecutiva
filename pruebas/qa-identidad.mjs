// Quién es Catalina y para quién trabaja.
//
// Se pidió que, al preguntárselo, deje claro que es una asistente clínica
// virtual y parte del equipo del doctor Inti Paredes. Eso vive en tres frases
// de config.mjs —la persona del navegador y la apertura de la llamada— y aquí
// se comprueba que las tres lo digan, que ningún cargo viejo se haya quedado
// escondido, y que llegue tal cual a las instrucciones que se le mandan.
const { CONFIG_POR_DEFECTO, componerInstrucciones } = await import(new URL("../config.mjs", import.meta.url).href);

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });
const cfg = CONFIG_POR_DEFECTO;
const persona = cfg.persona.instrucciones;
const compuestas = componerInstrucciones(cfg);
const guion = Array.isArray(cfg.telefono.guion) ? cfg.telefono.guion.join(" ") : String(cfg.telefono.guion);

// ── En la conversación ──────────────────────────────────────────────────────
anotar("La persona la declara asistente clínica virtual", /asistente clínica virtual/.test(persona), "");
anotar("Y parte del equipo del doctor Inti Paredes", /equipo del doctor Inti Paredes/.test(persona), "");
anotar("Hay una instrucción explícita para cuando le preguntan quién es o para quién trabaja",
  /pregunten quién eres[^.]*para quién trabajas/.test(persona) && /clara y directa/.test(persona), "");
anotar("Esa respuesta pide las dos cosas juntas, en una frase",
  /asistente clínica virtual y eres parte del equipo del doctor Inti Paredes/.test(persona), "");
anotar("Y llega tal cual a las instrucciones compuestas que se mandan al agente",
  /asistente clínica virtual/.test(compuestas) && /equipo del doctor Inti Paredes/.test(compuestas), compuestas.slice(0, 120));

// ── En la llamada ───────────────────────────────────────────────────────────
const apertura = (guion.match(/«([^»]+)»/) || [])[1] || "";
anotar("La primera frase de la llamada dice quién es y de qué equipo",
  /asistente clínica virtual/.test(apertura) && /equipo del doctor Inti Paredes/.test(apertura), apertura);
anotar("Y dice su nombre", /soy Catalina/.test(apertura), apertura);
anotar("Si le preguntan en la llamada, contesta con transparencia y sin hacerse pasar por el doctor",
  /Nunca digas ser el doctor/.test(guion) && /para quién trabajas/.test(guion) && /parte de su equipo/.test(guion), "");

// ── Que no quede ningún cargo viejo ─────────────────────────────────────────
const todo = JSON.stringify(cfg);
anotar("Ya no se llama «jefa de gabinete» en ningún sitio", !/jefa de gabinete/i.test(todo), "");
anotar("Ni «asistente digital», que era la apertura anterior de la llamada", !/asistente digital/i.test(todo), "");

let mal = 0;
for (const x of paso) { if (!x.ok) mal += 1; console.log(`${x.ok ? "ok   " : "FALLA"} ${x.n}${x.ok ? "" : "\n        → " + x.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de identidad pasan`);
process.exit(mal ? 1 : 0);
