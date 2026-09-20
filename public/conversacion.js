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

// `crypto.randomUUID` sólo existe en contextos seguros (https o localhost);
// fuera de ahí se compone uno con la hora y azar, que para esto basta.
function nuevoId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class MemoriaDeConversacion {
  constructor() { this.olvidar(); }

  olvidar() {
    // Identificador de la conversación. Lo pone el navegador al abrirla y viaja
    // con cada guardado al servidor, para que el historial de la persona no
    // duplique la misma conversación cada vez que se sincroniza.
    this.id = "";
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
    this.id = nuevoId();
    return this;
  }

  anotar(quien, texto) {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    if (!this.inicio) this.abrir();

    // Los trozos seguidos de la misma voz son una intervención, no varias: la
    // sesión entrega el texto de Catalina creciendo palabra a palabra.
    const ultimo = this.turnos.at(-1);
    if (ultimo && ultimo.quien === quien) {
      if (limpio.startsWith(ultimo.texto)) {
        ultimo.texto = limpio;
        return ultimo;
      }
      // ElevenLabs manda a veces la respuesta COMPLETA antes que los trozos
      // con los que la va diciendo. Esos trozos son un prefijo de lo que ya
      // está anotado: no son otra intervención, y anotarlos duplicaba cada
      // frase de Catalina en el historial y en la minuta.
      if (ultimo.texto.startsWith(limpio)) return ultimo;
    }

    const turno = { t: Date.now(), quien, texto: limpio };
    this.turnos.push(turno);
    if (this.turnos.length > TOPE_TURNOS) this.turnos.splice(0, this.turnos.length - TOPE_TURNOS);
    return turno;
  }

  // Cuando la interrumpen, el agente dice qué alcanzó a decir de verdad. El
  // historial se queda con eso, en la misma intervención, no con lo que iba
  // a decir ni con una intervención nueva.
  corregir(quien, texto) {
    const limpio = String(texto ?? "").trim();
    const ultimo = this.turnos.at(-1);
    if (!ultimo || ultimo.quien !== quien) return null;
    if (!limpio) { this.turnos.pop(); return null; }
    ultimo.texto = limpio;
    return ultimo;
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
      id: this.id,
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
