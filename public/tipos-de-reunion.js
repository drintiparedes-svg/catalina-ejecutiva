// Los cinco tipos de reunión.
//
// Lo que cambia entre ellos NO es la captura: la transcripción se guarda igual
// y entera en los cinco. Lo que cambia es qué se mira al leerla —una clase deja
// conceptos y referencias, una operacional deja tareas con dueño y fecha— y en
// qué orden se cuenta en la minuta. Una sola arquitectura de captura, cinco
// formas de estructurar lo capturado.
//
// Este archivo vive en `public/` pero lo importan LOS DOS lados: el navegador
// para pintar la pantalla de preparación y el servidor para redactar la minuta.
// Es feo que el servidor importe de `public/`, y aun así es lo correcto: con dos
// copias, el día que alguien añada un tipo en un lado la minuta saldría con el
// formato de otro y nadie lo notaría hasta leerla.

export const TIPOS = {
  conferencia: {
    nombre: "Conferencia o clase",
    resumen: "Escuchar una exposición y quedarse con lo que enseña.",
    // Por defecto ni se plantea intervenir: en una clase la asistente no habla.
    participacion: false,
    prioriza: [
      "los conceptos principales y cómo se definieron",
      "los argumentos con los que se sostuvieron",
      "los datos y cifras que se dieron",
      "las referencias, autores y fuentes mencionadas",
      "las conclusiones",
      "las preguntas del público y sus respuestas"
    ],
    // El orden en que se cuenta. Los nombres son los del esquema de la minuta.
    secciones: ["resumen", "conceptos", "temas", "datos", "referencias", "conclusiones", "preguntas", "pendientes"],
    guia: "Es una exposición, no una reunión de trabajo: puede no haber acuerdos ni responsables, y eso está bien. "
      + "No fuerces tareas ni decisiones donde sólo hubo enseñanza. Recoge las definiciones con las palabras de quien expuso."
  },

  operacional: {
    nombre: "Reunión operacional",
    resumen: "Equipo y seguimiento: quién hace qué y para cuándo.",
    participacion: false,
    prioriza: [
      "los problemas que se plantearon",
      "las decisiones tomadas",
      "los acuerdos",
      "las tareas, con responsable y fecha",
      "los bloqueos que impiden avanzar",
      "lo que queda pendiente y los próximos pasos"
    ],
    secciones: ["resumen", "temas", "problemas", "decisiones", "acuerdos", "acciones", "bloqueos", "pendientes", "proximos_pasos"],
    guia: "El valor de esta minuta está en la tabla de acciones: sé exhaustiva ahí. "
      + "Un compromiso sin dueño o sin fecha se registra igual, con «Sin asignar» o «Sin fecha», porque ese hueco es información."
  },

  ejecutiva: {
    nombre: "Reunión ejecutiva",
    resumen: "Gestión y toma de decisiones. Minuta corta y al grano.",
    participacion: false,
    prioriza: [
      "el problema o la decisión central",
      "los antecedentes que la enmarcan",
      "la posición de cada participante",
      "las alternativas que se pusieron sobre la mesa",
      "los riesgos",
      "la decisión, con su responsable y sus próximos pasos"
    ],
    secciones: ["resumen", "decision_central", "antecedentes", "posiciones", "alternativas", "riesgos", "decisiones", "acciones", "proximos_pasos"],
    guia: "Sé especialmente sintética: quien lee esto tiene cinco minutos. El resumen ejecutivo debe bastar por sí solo. "
      + "Registra las posiciones sin suavizarlas: si dos personas discreparon, eso es lo más informativo de la reunión."
  },

  lean: {
    nombre: "Ejecutiva — Lean",
    resumen: "Análisis de procesos y resolución estructurada de problemas.",
    participacion: false,
    prioriza: [
      "el problema, formulado con precisión",
      "el estado actual y el proceso involucrado",
      "los desperdicios e ineficiencias detectados",
      "las causas, distinguiendo las raíz de los síntomas",
      "los actores implicados",
      "las oportunidades de mejora y las contramedidas, con responsable, fecha e indicador"
    ],
    secciones: ["resumen", "problema", "estado_actual", "desperdicios", "causas", "actores", "oportunidades", "contramedidas", "decisiones", "acciones", "proximos_pasos"],
    guia: "Cuando el material lo permita, ordena las contramedidas como Problema → Causa → Contramedida → Responsable → Fecha → Indicador. "
      + "No inventes indicadores: si no se acordó cómo se va a medir, escribe «Sin definir», que es justo el hueco que hay que ver. "
      + "Distingue causa de síntoma sólo cuando en la reunión se haya hecho esa distinción."
  },

  creativa: {
    nombre: "Sesión creativa",
    resumen: "Brainstorming, diseño e innovación. Preserva las ideas.",
    // La única donde tiene sentido que participe: se la puede usar para
    // proponer alternativas o cuestionar supuestos.
    participacion: true,
    prioriza: [
      "las ideas, todas, incluso las que quedaron a medias",
      "las hipótesis y los supuestos que se pusieron en juego",
      "las preguntas abiertas",
      "las oportunidades y asociaciones que aparecieron",
      "las divergencias, que aquí son material y no un problema",
      "las ideas descartadas y por qué",
      "los próximos experimentos"
    ],
    secciones: ["resumen", "ideas", "hipotesis", "preguntas", "oportunidades_creativas", "divergencias", "descartadas", "decisiones", "experimentos", "proximos_pasos"],
    guia: "Aquí NO conviertas todo en tareas: una sesión creativa cuyo registro son cinco acciones ha perdido lo que valía. "
      + "Conserva las ideas con la formulación de quien las dijo, aunque sean vagas. "
      + "Registra las descartadas con su motivo: volver sobre ellas es la mitad del trabajo creativo."
  }
};

export const TIPO_POR_DEFECTO = "operacional";

export const tipoValido = id => Object.hasOwn(TIPOS, String(id ?? ""));
export const tipoDeReunion = id => TIPOS[tipoValido(id) ? id : TIPO_POR_DEFECTO];
