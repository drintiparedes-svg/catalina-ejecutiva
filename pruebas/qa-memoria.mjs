// La memoria de la conversación, sin navegador: que el texto completo que
// ElevenLabs manda antes que los trozos no duplique la intervención, que una
// corrección reescriba y no añada, y que las dos voces queden por separado.
import { MemoriaDeConversacion } from "../public/conversacion.js";

let ok = 0, malos = 0;
const comprobar = (n, c, d = "") => { if (c) { ok += 1; console.log("ok    " + n); } else { malos += 1; console.log("FALLA " + n + (d ? "\n      " + d : "")); } };

const m = new MemoriaDeConversacion();
m.abrir();
comprobar("al abrir hay identificador", typeof m.id === "string" && m.id.length >= 8);

// Orden real de ElevenLabs: respuesta completa primero, trozos después.
m.anotar("catalina", "Hola, soy Catalina. ¿En qué te ayudo hoy?");
m.anotar("catalina", "Hola,");
m.anotar("catalina", "Hola, soy Catalina.");
m.anotar("catalina", "Hola, soy Catalina. ¿En qué te ayudo hoy?");
comprobar("el texto completo seguido de sus trozos es UNA intervención", m.turnos.length === 1, JSON.stringify(m.turnos));

// Orden clásico: trozos crecientes.
m.anotar("usuario", "Necesito el protocolo de sepsis");
m.anotar("catalina", "Claro.");
m.anotar("catalina", "Claro. Empecemos por");
m.anotar("catalina", "Claro. Empecemos por la escala qSOFA.");
comprobar("los trozos crecientes también son una sola intervención", m.turnos.length === 3 && m.turnos[2].texto.endsWith("qSOFA."));

// Interrupción: corrección en la misma intervención.
m.corregir("catalina", "Claro. Empecemos por");
comprobar("la corrección reescribe la última intervención, no añade otra", m.turnos.length === 3 && m.turnos[2].texto === "Claro. Empecemos por");
m.corregir("usuario", "no aplica");
comprobar("una corrección de otra voz no toca la última intervención", m.turnos[2].texto === "Claro. Empecemos por");
m.corregir("catalina", "");
comprobar("una corrección vacía retira lo que no llegó a decir", m.turnos.length === 2);

// Dos intervenciones distintas de la misma voz siguen siendo dos.
m.anotar("catalina", "¿Algo más?");
m.anotar("catalina", "Perfecto, entonces seguimos.");
comprobar("dos frases distintas seguidas son dos intervenciones", m.turnos.length === 4);

const cierre = m.paraCerrar();
comprobar("paraCerrar lleva id, inicio y las dos voces", cierre.id === m.id && cierre.inicio > 0 && cierre.turnos.some(t => t.quien === "usuario") && cierre.turnos.some(t => t.quien === "catalina"));

console.log(`\n${ok} comprobaciones · ${malos} fallos`);
process.exit(malos ? 1 : 0);
