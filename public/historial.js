// Historial de reuniones, en el navegador.
//
// Una reunión cerrada no es sólo un par de archivos: es un objeto que se
// consulta después —«¿qué quedó pendiente?», «¿quién se comprometió a eso?»— y
// que puede servir de antecedente para la reunión de seguimiento. Para eso hay
// que guardarla en algún sitio.
//
// Ese sitio es IndexedDB, aquí. No es una elección de comodidad: el despliegue
// va en Vercel, donde el disco es de sólo lectura y cada petición cae en una
// instancia distinta, así que el servidor no tiene dónde guardar nada. Y una
// base de datos externa para esto sería añadir un servicio, unas credenciales y
// una factura a algo que sólo lee su dueño desde su propio equipo.
//
// La consecuencia hay que decirla y no esconderla: el historial vive en ESTE
// navegador. No se sincroniza entre equipos. Lo que sí viaja es lo que se
// guarda en Drive, que son los documentos.

const BASE = "catalina-reuniones";
const ALMACEN = "reuniones";
const VERSION = 1;

let conexion = null;

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    if (typeof indexedDB !== "object" && typeof indexedDB !== "function") {
      rechazar(new Error("Este navegador no guarda el historial."));
      return;
    }
    const peticion = indexedDB.open(BASE, VERSION);
    peticion.onupgradeneeded = () => {
      const db = peticion.result;
      if (!db.objectStoreNames.contains(ALMACEN)) {
        const almacen = db.createObjectStore(ALMACEN, { keyPath: "id" });
        // Por fecha, que es como se busca una reunión: «la del martes pasado».
        almacen.createIndex("inicio", "inicio");
      }
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error || new Error("No se pudo abrir el historial."));
    // `onblocked` se dispara si otra pestaña tiene la base abierta con otra
    // versión, y entonces no llega ni onsuccess ni onerror: sin este plazo la
    // promesa se queda esperando para siempre y arrastra a quien la espere.
    peticion.onblocked = () => rechazar(new Error("Otra pestaña tiene el historial abierto."));
    setTimeout(() => rechazar(new Error("El historial no respondió.")), 5000);
  });
  // Si falla una vez no se deja la promesa rota en caché: en modo incógnito
  // IndexedDB puede negarse la primera vez y funcionar después.
  conexion.catch(() => { conexion = null; });
  return conexion;
}

function transaccion(modo, trabajo) {
  return abrir().then(db => new Promise((resolver, rechazar) => {
    const t = db.transaction(ALMACEN, modo);
    const peticion = trabajo(t.objectStore(ALMACEN));
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  }));
}

export const historialDisponible = () => typeof indexedDB !== "undefined" && indexedDB !== null;

// Lo que se guarda es la reunión entera, no un resumen: la gracia de poder
// preguntar después «¿qué dijo Juan del presupuesto?» es que la transcripción
// siga ahí. Los archivos generados NO se guardan —ocupan y ya están en Drive y
// en Descargas—, sólo su nombre, para poder decir cuáles fueron.
export async function guardarReunion(registro) {
  try {
    await transaccion("readwrite", almacen => almacen.put(registro));
    return { ok: true };
  } catch (error) {
    console.warn("Historial:", error);
    return { ok: false, error: String(error?.message || error) };
  }
}

// Sólo la ficha de cada una: fecha, título y cuatro cifras. Cargar el contenido
// entero de treinta reuniones para pintar una lista sería absurdo.
export async function listarReuniones(cuantas = 40) {
  try {
    const todas = await transaccion("readonly", almacen => almacen.getAll());
    return todas
      .sort((a, b) => (b.inicio ?? 0) - (a.inicio ?? 0))
      .slice(0, cuantas)
      .map(r => ({
        id: r.id,
        inicio: r.inicio,
        fin: r.fin,
        titulo: r.titulo || "Reunión sin título",
        participantes: r.participantes ?? [],
        acuerdos: (r.minuta?.acuerdos ?? []).length,
        acciones: (r.minuta?.acciones ?? []).length,
        pendientes: (r.minuta?.pendientes ?? []).length,
        archivos: r.archivos ?? []
      }));
  } catch (error) {
    console.warn("Historial:", error);
    return [];
  }
}

export async function leerReunion(id) {
  try {
    return (await transaccion("readonly", almacen => almacen.get(id))) || null;
  } catch (error) {
    console.warn("Historial:", error);
    return null;
  }
}

export async function borrarReunion(id) {
  try {
    await transaccion("readwrite", almacen => almacen.delete(id));
    return { ok: true };
  } catch (error) {
    console.warn("Historial:", error);
    return { ok: false };
  }
}

// El antecedente que se le pasa a una reunión de seguimiento. No va la
// transcripción entera —sería enterrar la reunión nueva bajo la vieja— sino lo
// que hace falta para retomar: de qué se habló, qué se decidió, qué quedó
// colgando y quién se hizo cargo de qué.
export function comoAntecedente(registro) {
  if (!registro) return null;
  const m = registro.minuta ?? {};
  return {
    id: registro.id,
    titulo: registro.titulo || m.titulo || "Reunión anterior",
    fecha: registro.inicio,
    resumen: m.resumen || "",
    decisiones: m.decisiones ?? [],
    acuerdos: m.acuerdos ?? [],
    desacuerdos: m.desacuerdos ?? [],
    acciones: m.acciones ?? [],
    pendientes: m.pendientes ?? [],
    proximos_pasos: m.proximos_pasos ?? [],
    participantes: registro.participantes ?? []
  };
}
