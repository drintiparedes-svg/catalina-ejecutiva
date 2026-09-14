// Memoria de una conversación con Catalina.
//
// Distinta de la memoria de una reunión: allí Catalina es la secretaria y lo
// que se registra es lo que dice la sala; aquí es una conversación entre dos, y
// lo que importa es a qué se llegó. Por eso el resumen tiene forma de minuta
// —acuerdos, alcance, pendientes— y no de acta.
//
// Se guarda quién dijo qué, y los documentos que se subieron: sin las dos cosas
// el resumen sale cojo. Un «me parece bien» de la persona es un acuerdo; el
// mismo «me parece bien» dicho por ella, no.

const TOPE_TURNOS = 600;   // una conversación muy larga se recorta por el principio

// Cuántos caracteres del principio bastan para reconocer que dos textos son la
// misma intervención de Catalina vista en dos momentos.
const PRINCIPIO = 24;

// ¿Son el mismo turno, o son dos cosas distintas que dijo?
//
// El texto de Catalina llega varias veces y no siempre creciendo:
//
//   · en trozos, mientras habla, cada uno con lo acumulado hasta ahí;
//   · entero, cuando el agente termina de generar;
//   · CORREGIDO y más CORTO, si la interrumpieron: ahí el agente dice qué
//     alcanzó a decir de verdad, y eso es más corto que lo que iba a decir.
//
// Comparar sólo con «empieza por» —que era lo que había— reconoce los dos
// primeros y no el tercero: la corrección parecía una intervención nueva y la
// conversación acababa con lo mismo dicho dos veces, una entera y otra a medias.
// Compartir el principio los reconoce a los tres, y sigue distinguiendo dos
// respuestas seguidas de verdad, que no empiezan igual.
export function esElMismoTurno(a, b) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x || !y) return false;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  const cuantos = Math.min(x.length, y.length, PRINCIPIO);
  return cuantos >= 12 && x.slice(0, cuantos) === y.slice(0, cuantos);
}

export class MemoriaDeConversacion {
  constructor() { this.olvidar(); }

  olvidar() {
    this.inicio = 0;
    this.fin = 0;
    this.turnos = [];
    // Resumen de una conversación anterior que se está usando de contexto.
    this.antecedente = null;
  }

  get vacia() { return this.turnos.length === 0; }
  get abierta() { return this.inicio > 0 && !this.fin; }

  abrir() {
    if (this.inicio && !this.fin) return this;   // ya estaba abierta
    this.olvidar();
    this.inicio = Date.now();
    return this;
  }

  anotar(quien, texto) {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    if (!this.inicio) this.abrir();

    // Los trozos seguidos de la misma voz son una intervención, no varias: la
    // sesión entrega el texto de Catalina varias veces —creciendo, entero, y
    // corregido si la interrumpen— y las tres versiones son el mismo turno.
    const ultimo = this.turnos.at(-1);
    if (ultimo && ultimo.quien === quien && esElMismoTurno(ultimo.texto, limpio)) {
      ultimo.texto = limpio;
      return ultimo;
    }

    const turno = { t: Date.now(), quien, texto: limpio };
    this.turnos.push(turno);
    if (this.turnos.length > TOPE_TURNOS) this.turnos.splice(0, this.turnos.length - TOPE_TURNOS);
    return turno;
  }

  cerrar() {
    this.fin = Date.now();
    return this;
  }

  minutos() {
    if (!this.inicio) return 0;
    return Math.max(0, Math.round(((this.fin || Date.now()) - this.inicio) / 60000));
  }

  // Lo que se manda al servidor para que redacte el resumen.
  paraCerrar(documentos = []) {
    return {
      inicio: this.inicio,
      fin: this.fin || Date.now(),
      minutos: this.minutos(),
      turnos: this.turnos.map(({ quien, texto }) => ({ quien, texto })),
      documentos: documentos.map(d => ({
        nombre: d.nombre,
        imagen: Boolean(d.imagen),
        caracteres: d.caracteres,
        // Del documento va un extracto: el resumen es de la conversación, no
        // del documento, y mandarlo entero desplaza a lo que se habló.
        texto: String(d.texto || "").slice(0, 8000)
      })),
      antecedente: this.antecedente
    };
  }

  // Lo que se le da a Catalina al empezar, cuando se retoma una conversación
  // anterior como contexto.
  static contextoDe(resumen) {
    if (!resumen) return "";
    const lista = (titulo, puntos) => {
      const items = (puntos ?? []).filter(Boolean);
      return items.length ? `${titulo}: ${items.join("; ")}.` : "";
    };
    return [
      `[Contexto] Retomas una conversación anterior: «${resumen.titulo || "sin título"}»`
        + `, del ${new Date(resumen.inicio).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}.`,
      resumen.resumen ? `De qué trató: ${resumen.resumen}` : "",
      lista("Acuerdos a los que se llegó", resumen.acuerdos),
      lista("Alcance de lo que se trató", resumen.alcance),
      lista("Lo que quedó pendiente", resumen.pendientes),
      (resumen.documentos ?? []).length
        ? `Documentos que se usaron: ${resumen.documentos.map(d => d.nombre || d).join(", ")}.`
        : "",
      "",
      "Eso es de una conversación anterior, no de ahora: dalo por sabido, no lo repitas de entrada, "
        + "y úsalo cuando venga a cuento. Si te preguntan por algo que no está ahí, dilo en vez de suponerlo."
    ].filter(Boolean).join("\n");
  }
}
