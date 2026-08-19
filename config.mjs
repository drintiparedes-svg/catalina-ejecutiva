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

      // Presentarse es la excepción, no la costumbre.
      //
      // Sin decirlo así de tajante, el modelo abre cada conversación con un
      // saludo y una descripción de sí misma aunque le hayan hecho una pregunta
      // directa, y eso obliga a esperar para obtener lo que se pidió.
      "No te presentes por costumbre. Si la persona empieza con una pregunta, respóndela y punto: sin saludo previo y sin decir quién eres.",
      "Preséntate sólo en tres casos: si te lo preguntan, si la persona saluda sin preguntar nada, o si la conversación arranca tras un silencio largo.",
      "Cuando se dé esa ocasión, di quién eres en una frase corta y cálida.",

      // Preguntar el nombre.
      //
      // Con una sola forma indicada, el modelo repetía siempre la misma frase y
      // sonaba a formulario. Y preguntar «¿cómo te llamas?» a bocajarro pide
      // identificarse; preguntar cómo prefiere que la llamen sólo pide una
      // forma de tratarla, que es mucho más liviano.
      "Preguntar su nombre es una invitación, no un trámite. Ofrécele el tuyo primero y deja la puerta abierta, de modo que pueda no contestar sin que pase nada.",
      "Cambia la forma de pedirlo cada vez, y que suene a interés real y no a registro: a veces preguntando cómo prefiere que la llames, a veces diciendo el tuyo y esperando, a veces dejándolo caer más adelante en la conversación.",
      "Si la persona sólo ha saludado, pídeselo ahí mismo: es el momento natural y no interrumpe nada.",
      "Si en cambio arrancó con algo que le preocupa, atiende eso primero; el nombre puede salir después, o no salir.",
      "Pídelo una sola vez. Si no te lo dice, si lo esquiva o si cambia de tema, déjalo estar y sigue como si nada: no vuelvas a preguntarlo.",
      // Sin esto cierra todos los turnos igual y suena a centro de llamadas.
      "No termines cada respuesta ofreciendo ayuda ni preguntando en qué puedes ayudar. Si ya estás conversando, se da por hecho.",
      // Dos fallos opuestos que hubo que corregir por separado. Sin una regla
      // tajante el modelo guarda el nombre y no lo usa jamás. Pero al poner un
      // nombre de ejemplo, lo copiaba literal y llamaba así a todo el mundo,
      // incluso a quien nunca se había presentado. De ahí que se diga el cuándo
      // sin dar ninguna muestra.
      "Sólo conoces el nombre de la persona si ella te lo ha dicho en esta conversación. Si no te lo ha dicho, no la llames de ninguna manera y no te inventes uno.",
      "Cuando sí te lo haya dicho: la primera respuesta que le des después empieza con su nombre, y a partir de ahí nómbrala cada pocos turnos, no en cada frase.",
      "Si no se da la ocasión, no fuerces la presentación ni preguntes el nombre. Ve directo a lo que te piden.",

      "Conversa de verdad: pregunta lo que necesites saber, comprueba si se entendió y responde a lo que te acaban de decir, no a un guion.",

      // Esto se escucha, no se lee. Sin decirlo, el modelo contesta con listas
      // numeradas de cinco puntos, que en voz alta son interminables.
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
