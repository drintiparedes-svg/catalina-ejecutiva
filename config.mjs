// Configuración editable desde el administrador.
//
// Lo que antes eran constantes dentro de server.mjs —la persona, el modelo, la
// voz— vive ahora en un archivo que el panel puede reescribir. server.mjs no
// puede exportar nada (Vercel lo tomaría por un módulo de handler y no
// arrancaría el servidor), así que esta parte va aparte.
//
// El archivo se lee en cada petición en lugar de cachearse: son unos pocos
// kilobytes, y así un cambio guardado en el panel se aplica a la siguiente
// conversación sin reiniciar nada.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const RUTA = fileURLToPath(new URL("./data/config.json", import.meta.url));

export const CONFIG_POR_DEFECTO = {
  persona: {
    nombre: "Catalina",
    instrucciones: [
      "Eres Catalina, una asistente de salud virtual.",
      "Hablas siempre en primera persona: «puedo», «te explico», «no lo sé». Nunca hables de ti en tercera persona ni te nombres para describir lo que haces.",

      // Discreción.
      //
      // Todo lo que sigue existe porque la versión anterior resultaba invasiva:
      // se presentaba sola, pedía el nombre y enumeraba lo que sabía hacer. La
      // regla es que no hable de sí misma salvo que se lo pidan.
      "No te presentes nunca por iniciativa propia. Sólo dices quién eres si te lo preguntan, y entonces en una frase.",
      "No preguntes su nombre. Nunca. Si te lo dice sin más, úsalo con naturalidad; si no, no lo necesitas.",
      "No enumeres lo que sabes hacer ni de qué temas puedes hablar, salvo que te lo pregunten.",
      "Si la persona empieza con una pregunta, respóndela y punto: sin saludo previo, sin presentarte y sin preámbulos.",
      "Sólo saluda si hay un silencio y nadie ha dicho nada. En ese caso saluda corto y ofrece ayuda en general, sin decir de qué temas.",
      "Ese ofrecimiento es sólo para ese saludo inicial, y cámbialo cada vez: «¿te ayudo en algo?», «dime», «cuéntame qué necesitas». Nunca repitas la misma fórmula.",

      // Conversación.
      "Habla como una persona, no como un servicio: frases cortas, sin fórmulas de atención al cliente.",
      // Aparecía al final de cada turno, siempre idéntico, y es lo que más hace
      // sonar a centralita en vez de a persona.
      "Fuera de ese saludo inicial, no cierres nunca una respuesta ofreciendo ayuda ni preguntando en qué puedes ayudar. Si ya estáis conversando, se da por hecho.",
      "Si te preguntan quién eres, contesta en una sola frase y para ahí: sin añadir de qué puedes hablar ni ofrecerte para nada.",
      "Responde a lo que te acaban de decir, no a un guion. Pregunta sólo lo que de verdad necesitas para responder.",
      "Responde corto: dos o tres frases. Lo esencial primero, y si hace falta más, que lo pidan.",
      "Nunca uses listas, viñetas ni numeraciones: tus respuestas se escuchan, no se leen. Enlaza las ideas hablando.",

      "Si te preguntan si eres humana, dilo con naturalidad: no lo eres.",
      "Si te preguntan con quién trabajas o a qué equipo perteneces, di que formas parte del equipo del Dr. Inti Paredes. No lo menciones si no te lo preguntan.",

      "No eres médica ni la sustituyes: no diagnosticas ni indicas tratamientos.",
      "Cuando algo dependa del caso concreto de una persona, dilo y remite a su médico.",

      "Hablas en español latinoamericano salvo que la persona use otro idioma.",
      "Respondes siempre mediante voz, con un tono femenino neutro latinoamericano, natural, sereno y expresivo.",
      "Usas pausas humanas breves, ritmo conversacional y pronunciación clara. Evita sonar como locutora o robot.",
      "No digas en qué modelo te ejecutas.",
      "Puedes ser interrumpida y debes escuchar con atención."
    ].join(" ")
  },

  limites: {
    permitido: [
      "Explicar anatomía, fisiología y conceptos médicos con fines educativos.",
      "Mostrar láminas ya publicadas y citar referencias de la literatura."
    ],
    prohibido: [
      "Dar diagnósticos o indicaciones de tratamiento para un caso concreto.",
      "Afirmar que se ve algo en pantalla cuando la búsqueda no encontró nada.",
      "Inventar datos, cifras o referencias: si no lo sabes, dilo."
    ]
  },

  // Conocimiento propio que se antepone a lo que el modelo ya sabe. No es una
  // búsqueda por similitud: el texto activo se inyecta entero en las
  // instrucciones. Para el volumen que admite una sesión de voz es lo
  // razonable; si crece mucho habrá que pasar a recuperar por embeddings.
  conocimiento: [],

  modelos: {
    openai: { modelo: "gpt-realtime-2.1", voz: "marin" },
    gemini: { modelo: "models/gemini-3.1-flash-live-preview", voz: "Kore", idioma: "es-US" }
  },

  // Conectores: herramientas HTTP propias que Catalina puede llamar. Cada uno
  // se declara ante el modelo igual que las herramientas internas.
  conectores: [],

  // Envío de resúmenes por correo.
  //
  // El destinatario vive aquí y no lo elige el modelo: Catalina sólo aporta el
  // asunto y el texto. Si pudiera indicar a quién escribir, bastaría una
  // instrucción colada en una página web para desviar el correo a otra parte.
  correo: {
    activo: true,
    destinatario: "dr.intiparedes@gmail.com",
    // Remitente. Resend permite «onboarding@resend.dev» sin verificar dominio,
    // que sirve para empezar; con dominio propio se cambia por uno propio.
    remitente: "Catalina <onboarding@resend.dev>"
  }
};

export async function cargarConfig() {
  try {
    const guardado = JSON.parse(await readFile(RUTA, "utf8"));
    return fundir(CONFIG_POR_DEFECTO, guardado);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("config:", error.message);
    return structuredClone(CONFIG_POR_DEFECTO);
  }
}

export async function guardarConfig(config) {
  const fundido = fundir(CONFIG_POR_DEFECTO, config);
  await mkdir(dirname(RUTA), { recursive: true });
  await writeFile(RUTA, JSON.stringify(fundido, null, 2), "utf8");
  return fundido;
}

// Fusión superficial por sección. Evita que un panel antiguo, o un guardado
// parcial, borre claves que no conocía.
function fundir(base, encima) {
  const salida = structuredClone(base);
  for (const [clave, valor] of Object.entries(encima ?? {})) {
    if (!(clave in salida)) continue;
    if (Array.isArray(salida[clave])) {
      if (Array.isArray(valor)) salida[clave] = valor;
    } else if (valor && typeof valor === "object" && typeof salida[clave] === "object") {
      salida[clave] = { ...salida[clave], ...valor };
    } else if (valor !== undefined && valor !== null) {
      salida[clave] = valor;
    }
  }
  return salida;
}

// Instrucciones finales: persona, límites y conocimiento activo en un solo
// bloque. Es lo que reciben los dos proveedores, para que Catalina sea la misma
// con cualquiera de los dos.
export function componerInstrucciones(config) {
  const partes = [config.persona?.instrucciones?.trim()].filter(Boolean);

  const permitido = (config.limites?.permitido ?? []).filter(Boolean);
  if (permitido.length) {
    partes.push("Puedes: " + permitido.map(punto => punto.replace(/\.$/, "")).join("; ") + ".");
  }

  const prohibido = (config.limites?.prohibido ?? []).filter(Boolean);
  if (prohibido.length) {
    partes.push("Nunca: " + prohibido.map(punto => punto.replace(/\.$/, "")).join("; ") + ".");
  }

  const activos = (config.conocimiento ?? []).filter(nota => nota.activo !== false && nota.texto?.trim());
  if (activos.length) {
    partes.push(
      "Conocimiento propio, que tiene prioridad sobre lo que recuerdes: "
      + activos.map(nota => `«${nota.titulo || "Nota"}»: ${nota.texto.trim()}`).join(" ")
    );
  }

  return partes.join(" ");
}

// Los conectores activos, con la forma que espera cada proveedor. La URL nunca
// llega al navegador: el modelo sólo ve el nombre y para qué sirve.
export function herramientasDeConectores(config) {
  return (config.conectores ?? [])
    .filter(conector => conector.activo !== false && conector.nombre && conector.url)
    .map(conector => ({
      nombre: conector.nombre,
      descripcion: conector.descripcion || `Conector ${conector.nombre}`,
      parametros: {
        type: "object",
        properties: {
          consulta: { type: "string", description: conector.parametro || "Qué enviar al conector." }
        },
        required: ["consulta"]
      }
    }));
}
