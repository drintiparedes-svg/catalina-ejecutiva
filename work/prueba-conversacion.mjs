// Prueba de la memoria de una conversación.
//
//   node work/prueba-conversacion.mjs
//
// Lo que se comprueba aquí es que una intervención de Catalina quede como UNA,
// llegue como llegue. Su texto no llega una vez: llega en trozos mientras
// habla, entero cuando el agente termina de generar, y corregido —y más corto—
// si la interrumpen. Las tres versiones son el mismo turno.
//
// Reconocerlas sólo por «el texto nuevo empieza por el viejo» dejaba fuera la
// corrección, que es más corta: se guardaba como una intervención nueva y la
// conversación acababa con lo mismo dicho dos veces, una entera y otra a
// medias. Eso se veía en el panel y llegaba al resumen.

import { MemoriaDeConversacion, esElMismoTurno } from "../public/conversacion.js";

const A = "Sí, lo recibí. Es la propuesta de tesis del doctor Inti Paredes. ¿Qué te gustaría revisar?";
const A_CORREGIDA = "Sí, lo recibí. Es la propuesta de tesis del doctor Inti Paredes. ¿Qué te gustaría…";
const B = "La propuesta está bien planteada, sobre todo al definir el caso como instrumental.";

const casos = [];
const caso = (nombre, comprobar) => casos.push({ nombre, comprobar });

// Cómo llega el texto de un turno, en los dos órdenes que se han visto.
const enTrozos = (memoria, texto) => {
  const trozos = texto.match(/.{1,30}/g) ?? [];
  let acumulado = "";
  for (const trozo of trozos) {
    acumulado += trozo;
    memoria.anotar("catalina", acumulado);
  }
};

caso("los trozos de un turno son un turno", () => {
  const m = new MemoriaDeConversacion().abrir();
  enTrozos(m, A);
  m.anotar("catalina", A);
  return m.turnos.length === 1 && m.turnos[0].texto === A;
});

caso("la corrección reescribe el turno, no añade otro", () => {
  const m = new MemoriaDeConversacion().abrir();
  enTrozos(m, A);
  m.anotar("catalina", A);
  m.anotar("catalina", A_CORREGIDA);
  return m.turnos.length === 1 && m.turnos[0].texto === A_CORREGIDA;
});

caso("el texto entero antes que los trozos tampoco duplica", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", A);
  enTrozos(m, A);
  return m.turnos.length === 1 && m.turnos[0].texto === A;
});

caso("dos respuestas distintas siguen siendo dos", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", A);
  m.anotar("catalina", B);
  return m.turnos.length === 2;
});

caso("una respuesta de la persona separa dos turnos suyos", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", A);
  m.anotar("usuario", "Perfecto, gracias.");
  m.anotar("catalina", A);
  return m.turnos.length === 3 && m.turnos.map(t => t.quien).join(",") === "catalina,usuario,catalina";
});

caso("lo que dice la persona se guarda aunque no se pinte", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("usuario", "¿Recibiste el PDF?");
  m.anotar("catalina", A);
  const { turnos } = m.paraCerrar();
  return turnos.length === 2 && turnos[0].quien === "usuario" && turnos[0].texto === "¿Recibiste el PDF?";
});

caso("dos respuestas cortas y distintas no se confunden", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", "Sí.");
  m.anotar("catalina", "No.");
  return m.turnos.length === 2;
});

// Dos respuestas que empiezan parecido pero se separan antes de los primeros
// veinticuatro caracteres son dos, que es lo que se quiere: «Claro que sí, lo »
// son diecisiete y ahí ya no coinciden.
caso("dos respuestas que empiezan parecido siguen siendo dos", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", "Claro que sí, lo tengo delante ahora mismo.");
  m.anotar("catalina", "Claro que sí, lo miro en cuanto pueda.");
  return m.turnos.length === 2;
});

// Y el límite, escrito para que se sepa cuál es: dos respuestas que comparten
// los primeros veinticuatro caracteres SÍ se toman por una. Es el precio de
// reconocer la corrección, que empieza igual que el texto que corrige por
// definición. Dos respuestas seguidas con veinticuatro caracteres idénticos al
// principio no se han visto; una corrección, en cada interrupción.
caso("el límite conocido: veinticuatro caracteres iguales al principio", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", "Sobre la propuesta de tesis, lo que veo débil es la integración.");
  m.anotar("catalina", "Sobre la propuesta de tesis, el marco metodológico está bien.");
  return m.turnos.length === 1;
});

caso("el texto vacío no crea turnos", () => {
  const m = new MemoriaDeConversacion().abrir();
  m.anotar("catalina", "");
  m.anotar("catalina", "   ");
  return m.turnos.length === 0;
});

caso("esElMismoTurno distingue lo que tiene que distinguir", () =>
  esElMismoTurno(A, A_CORREGIDA)
  && esElMismoTurno(A, "Sí, lo recibí. ")
  && esElMismoTurno("Sí, lo recibí. ", A)
  && !esElMismoTurno(A, B)
  && !esElMismoTurno("", A)
  && !esElMismoTurno(A, "")
  && !esElMismoTurno("Sí.", "No."));

let fallos = 0;
for (const { nombre, comprobar } of casos) {
  let bien = false;
  try { bien = comprobar() === true; } catch (error) { console.error(`✗ ${nombre}: estalló — ${error.message}`); }
  if (bien) console.log(`✓ ${nombre}`);
  else { console.error(`✗ ${nombre}`); fallos += 1; }
}

if (fallos) {
  console.error(`\n${fallos} de ${casos.length} casos fallaron.`);
  process.exit(1);
}
console.log(`\nLos ${casos.length} casos pasan.`);
