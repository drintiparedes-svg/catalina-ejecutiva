// Guardar en una carpeta del propio equipo.
//
// Es la vía más simple para archivar las minutas, y la que menos piezas tiene:
// el navegador pide UNA vez qué carpeta usar y a partir de ahí escribe en ella
// como lo haría cualquier programa. Sin cuentas, sin tokens, sin desplegar nada.
//
// Y resuelve de paso lo de Google Drive: si se elige una carpeta que esté dentro
// de «Google Drive» —o de iCloud, o de Dropbox— la aplicación de escritorio la
// sincroniza sola. Los archivos acaban en el Drive personal sin que Catalina
// llegue a hablar con Google, que es justo lo que complicaba la otra vía.
//
// El precio: esto lo tiene Chrome y Edge en el escritorio, no Safari ni Firefox,
// y no existe en el teléfono. Por eso convive con las otras vías en vez de
// sustituirlas.

const BASE = "catalina-carpeta";
const ALMACEN = "ajustes";
const CLAVE = "carpeta";

export const carpetaDisponible = () => typeof window.showDirectoryPicker === "function";

// La carpeta elegida en esta sesión. Si el navegador no deja guardarla —ventana
// privada, almacén bloqueado— al menos sirve mientras la pestaña siga abierta,
// en vez de perderse entre que se elige y se cierra la reunión.
let carpetaDeLaSesion = null;

// El identificador de la carpeta se guarda en IndexedDB porque es lo único que
// admite guardarlo: no es texto, es un objeto vivo del navegador y localStorage
// no puede con él.
function conBase(modo, trabajo) {
  return new Promise((resolver, rechazar) => {
    const p = indexedDB.open(BASE, 1);
    p.onupgradeneeded = () => {
      if (!p.result.objectStoreNames.contains(ALMACEN)) p.result.createObjectStore(ALMACEN);
    };
    p.onerror = () => rechazar(p.error);
    p.onsuccess = () => {
      const t = p.result.transaction(ALMACEN, modo);
      const peticion = trabajo(t.objectStore(ALMACEN));
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error);
    };
    setTimeout(() => rechazar(new Error("El navegador no respondió.")), 5000);
  });
}

export async function elegirCarpeta() {
  if (!carpetaDisponible()) {
    return { ok: false, error: "Este navegador no puede escribir en carpetas. Usa Chrome o Edge en el escritorio." };
  }
  let carpeta;
  try {
    carpeta = await window.showDirectoryPicker({ id: "catalina-reuniones", mode: "readwrite", startIn: "documents" });
  } catch (error) {
    // Cancelar no es un fallo: se sale sin ruido.
    if (error?.name === "AbortError") return { ok: false, cancelado: true };
    return { ok: false, error: String(error?.message || error) };
  }
  carpetaDeLaSesion = carpeta;
  try { await conBase("readwrite", a => a.put(carpeta, CLAVE)); } catch { /* queda la de la sesión */ }
  return { ok: true, carpeta, nombre: carpeta.name };
}

export async function carpetaGuardada() {
  try { return (await conBase("readonly", a => a.get(CLAVE))) || carpetaDeLaSesion; }
  catch { return carpetaDeLaSesion; }
}

export async function olvidarCarpeta() {
  carpetaDeLaSesion = null;
  try { await conBase("readwrite", a => a.delete(CLAVE)); } catch {}
}

// El permiso sobre la carpeta se pierde al cerrar el navegador y hay que
// volver a pedirlo. Pedirlo requiere que la persona acabe de pulsar algo, así
// que se distingue comprobar de pedir: al cerrar una reunión sólo se comprueba,
// y si hace falta permiso se avisa en vez de fallar en silencio.
export async function permisoDeCarpeta(carpeta, pedirlo = false) {
  if (!carpeta) return "no";
  const opciones = { mode: "readwrite" };
  try {
    if (await carpeta.queryPermission(opciones) === "granted") return "si";
    if (!pedirlo) return "hay-que-pedirlo";
    return await carpeta.requestPermission(opciones) === "granted" ? "si" : "no";
  } catch { return "no"; }
}

export async function escribirEnCarpeta(carpeta, nombre, datos) {
  try {
    const archivo = await carpeta.getFileHandle(nombre, { create: true });
    const flujo = await archivo.createWritable();
    await flujo.write(datos);
    await flujo.close();
    return { ok: true, nombre };
  } catch (error) {
    return { ok: false, nombre, error: String(error?.message || error) };
  }
}

// Las reuniones guardadas en la carpeta, para recuperarlas en otro equipo: se
// elige la misma carpeta sincronizada y vuelven todas.
export async function reunionesEnCarpeta(carpeta) {
  const encontradas = [];
  try {
    for await (const [nombre, manejador] of carpeta.entries()) {
      if (!/^Reunion_.*\.json$/i.test(nombre) || manejador.kind !== "file") continue;
      try {
        const texto = await (await manejador.getFile()).text();
        const registro = JSON.parse(texto);
        if (registro?.id) encontradas.push(registro);
      } catch { /* un archivo ilegible no puede llevarse a los demás */ }
    }
  } catch (error) {
    return { ok: false, error: String(error?.message || error), reuniones: [] };
  }
  return { ok: true, reuniones: encontradas };
}
