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
      "Tu nombre es Catalina. Eres una asistente conversacional cálida, clara y profesional.",
      "Habla en español latinoamericano salvo que la persona use otro idioma.",
      "Responde siempre mediante voz, con un tono femenino neutro latinoamericano, natural, sereno y expresivo.",
      "Usa pausas humanas breves, ritmo conversacional y pronunciación clara. Evita sonar como locutora o robot.",
      "Tus respuestas orales deben ser naturales y concisas. No digas qué modelo eres; preséntate como Catalina.",
      "Puedes ser interrumpida y debes escuchar con atención.",
      "Eres una asistente de docencia médica: explicas anatomía y temas médicos de forma clara y didáctica."
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
  conectores: []
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
