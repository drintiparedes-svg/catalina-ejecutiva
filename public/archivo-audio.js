// Respaldo local del audio de las reuniones.
//
// Cada tramo con voz se guarda en este navegador ANTES de enviarlo a
// transcribir. Si el envío falla —red caída, proveedor saturado, pestaña
// cerrada a mitad de la cola—, el audio sigue aquí y se vuelve a transcribir
// después: al terminar la reunión, al volver la red o desde la página de actas.
// Lo único que no se puede recuperar es lo que nunca se grabó (equipo
// suspendido, micrófono desconectado); eso lo registra el informe de
// continuidad de la grabadora.
//
// Formato: IMA ADPCM de 4 bits a 16 kHz (~29 MB por hora). Se eligió frente a
// Opus (~11 MB/h) porque se codifica y decodifica en JavaScript puro, igual en
// cualquier navegador y en las pruebas, sin depender de WebCodecs; para voz
// destinada a transcripción la pérdida es inaudible.
//
// Conservación (decidida por el usuario): el audio se borra al generar el acta
// de la reunión o a los 7 días, lo que ocurra primero. Los tramos que aún no
// se pudieron transcribir se conservan hasta los 7 días para poder
// reintentarlos.

export const DIAS_DE_CONSERVACION = 7;
const BD = "catalina.audio";
const ALMACEN = "tramos";

// ── IMA ADPCM ────────────────────────────────────────────────────────────────

const PASOS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
  143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
  1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const INDICES = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export function codificarAdpcm(muestras) {
  const salida = new Uint8Array(Math.ceil(muestras.length / 2));
  let prediccion = 0, indice = 0;
  for (let i = 0; i < muestras.length; i += 1) {
    const x = Math.max(-32768, Math.min(32767, Math.round(muestras[i] * 32767)));
    const paso = PASOS[indice];
    let diferencia = x - prediccion;
    let nibble = 0;
    if (diferencia < 0) { nibble = 8; diferencia = -diferencia; }
    let delta = paso >> 3;
    if (diferencia >= paso) { nibble |= 4; diferencia -= paso; delta += paso; }
    if (diferencia >= paso >> 1) { nibble |= 2; diferencia -= paso >> 1; delta += paso >> 1; }
    if (diferencia >= paso >> 2) { nibble |= 1; delta += paso >> 2; }
    prediccion = Math.max(-32768, Math.min(32767, prediccion + (nibble & 8 ? -delta : delta)));
    indice = Math.max(0, Math.min(88, indice + INDICES[nibble]));
    if (i & 1) salida[i >> 1] |= nibble << 4; else salida[i >> 1] = nibble;
  }
  return salida;
}

export function decodificarAdpcm(bytes, largo) {
  const salida = new Float32Array(largo);
  let prediccion = 0, indice = 0;
  for (let i = 0; i < largo; i += 1) {
    const nibble = i & 1 ? bytes[i >> 1] >> 4 : bytes[i >> 1] & 15;
    const paso = PASOS[indice];
    let delta = paso >> 3;
    if (nibble & 4) delta += paso;
    if (nibble & 2) delta += paso >> 1;
    if (nibble & 1) delta += paso >> 2;
    prediccion = Math.max(-32768, Math.min(32767, prediccion + (nibble & 8 ? -delta : delta)));
    indice = Math.max(0, Math.min(88, indice + INDICES[nibble]));
    salida[i] = prediccion / 32768;
  }
  return salida;
}

// ── Almacén (IndexedDB) ──────────────────────────────────────────────────────

let bd = null;
function abrir() {
  if (bd) return bd;
  bd = new Promise((ok, mal) => {
    const pedido = indexedDB.open(BD, 1);
    pedido.onupgradeneeded = () => {
      const almacen = pedido.result.createObjectStore(ALMACEN, { keyPath: "id" });
      almacen.createIndex("reunion", "reunionId");
    };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => { bd = null; mal(pedido.error); };
  });
  return bd;
}
async function operar(modo, fn) {
  const base = await abrir();
  return new Promise((ok, mal) => {
    const tx = base.transaction(ALMACEN, modo);
    const pedido = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => ok(pedido?.result);
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error);
  });
}

export const archivoDisponible = () => typeof indexedDB !== "undefined";

// Guarda un tramo y devuelve su id. Si el navegador no deja guardar (sin
// espacio, modo privado), devuelve null y la grabación sigue sin respaldo.
export async function guardarTramo(reunionId, pcm, { desde, hasta, hz = 16000 }) {
  if (!archivoDisponible() || !reunionId) return null;
  const tramo = {
    id: `${reunionId}:${desde}`,
    reunionId, desde, hasta, hz,
    largo: pcm.length,
    adpcm: codificarAdpcm(pcm),
    estado: "pendiente",          // pendiente → transcrito | fallido
    intentos: 0,
    creado: Date.now()
  };
  try { await operar("readwrite", s => s.put(tramo)); return tramo.id; }
  catch (error) { console.warn("Respaldo de audio: no se pudo guardar", error); return null; }
}

export async function actualizarTramo(id, cambios) {
  if (!id || !archivoDisponible()) return;
  try {
    const base = await abrir();
    await new Promise((ok, mal) => {
      const tx = base.transaction(ALMACEN, "readwrite");
      const s = tx.objectStore(ALMACEN);
      const pedido = s.get(id);
      pedido.onsuccess = () => { if (pedido.result) s.put({ ...pedido.result, ...cambios }); };
      tx.oncomplete = ok;
      tx.onerror = () => mal(tx.error);
    });
  } catch (error) { console.warn("Respaldo de audio: no se pudo actualizar", error); }
}

export async function tramosDe(reunionId) {
  if (!archivoDisponible()) return [];
  try { return ((await operar("readonly", s => s.index("reunion").getAll(reunionId))) || []).sort((a, b) => a.desde - b.desde); }
  catch { return []; }
}

export async function resumenDeArchivo(reunionId) {
  const tramos = await tramosDe(reunionId);
  return {
    tramos: tramos.length,
    pendientes: tramos.filter(t => t.estado !== "transcrito").length,
    bytes: tramos.reduce((n, t) => n + (t.adpcm?.byteLength || 0), 0),
    segundos: Math.round(tramos.reduce((n, t) => n + t.largo / t.hz, 0))
  };
}

// Borra el audio de una reunión. `conservarPendientes`: los tramos que aún no
// se transcribieron se dejan para poder reintentarlos (hasta los 7 días).
export async function borrarAudioDe(reunionId, { conservarPendientes = false } = {}) {
  const tramos = await tramosDe(reunionId);
  const aBorrar = tramos.filter(t => !conservarPendientes || t.estado === "transcrito");
  if (!aBorrar.length) return 0;
  try { await operar("readwrite", s => { aBorrar.forEach(t => s.delete(t.id)); }); } catch {}
  return aBorrar.length;
}

export async function purgarAntiguos(dias = DIAS_DE_CONSERVACION) {
  if (!archivoDisponible()) return 0;
  const limite = Date.now() - dias * 86400000;
  try {
    const todos = (await operar("readonly", s => s.getAll())) || [];
    const viejos = todos.filter(t => t.creado < limite);
    if (viejos.length) await operar("readwrite", s => { viejos.forEach(t => s.delete(t.id)); });
    return viejos.length;
  } catch { return 0; }
}

export async function reunionesConPendientes() {
  if (!archivoDisponible()) return [];
  try {
    const todos = (await operar("readonly", s => s.getAll())) || [];
    return [...new Set(todos.filter(t => t.estado !== "transcrito").map(t => t.reunionId))];
  } catch { return []; }
}

// ── Recuperación ─────────────────────────────────────────────────────────────

// Vuelve a transcribir los tramos guardados que no llegaron a transcribirse y
// los incorpora a la reunión como alta fidelidad recuperada. Modifica
// `reunion` en el sitio y devuelve el balance.
//
// `estados`: qué tramos intentar. Durante la reunión sólo los «fallido» (los
// «pendiente» son de la cola en curso); al terminar, o al reabrir tras un
// cierre inesperado, también los «pendiente».
export async function recuperarReunion(reunion, { transcribir, aWav, estados = ["pendiente", "fallido"], alProgreso = () => {}, tramos = null, actualizar = actualizarTramo } = {}) {
  const lista = (tramos || await tramosDe(reunion.id)).filter(t => estados.includes(t.estado));
  const balance = { intentados: lista.length, recuperados: 0, fallidos: 0, vacios: 0 };
  let previo = "";
  for (const [i, t] of lista.entries()) {
    alProgreso(`Completando la transcripción · tramo ${i + 1} de ${lista.length}`);
    const pcm = decodificarAdpcm(t.adpcm, t.largo);
    let r;
    try { r = await transcribir(aWav(pcm, t.hz), { desde: t.desde, hasta: t.hasta, previo: previo.slice(-400) }); }
    catch (error) { r = { ok: false, error: error?.message || "fallo de red" }; }
    if (r?.ok) {
      const texto = String(r.texto || "").trim();
      aplicarRecuperado(reunion, { desde: t.desde, hasta: t.hasta, texto, proveedor: r.proveedor });
      await actualizar(t.id, { estado: "transcrito", intentos: (t.intentos || 0) + 1 });
      if (texto) { balance.recuperados += 1; previo = texto; } else balance.vacios += 1;
    } else {
      await actualizar(t.id, { estado: "fallido", intentos: (t.intentos || 0) + 1, error: r?.error || "sin respuesta" });
      balance.fallidos += 1;
      // Un error de configuración (sin clave) no se arregla insistiendo.
      if (r?.definitivo) break;
    }
  }
  return balance;
}

// Un tramo recuperado reemplaza al registro de fallo del mismo intervalo, y
// no se duplica si ya estaba transcrito.
export function aplicarRecuperado(reunion, { desde, hasta, texto, proveedor }) {
  reunion.hd ||= [];
  reunion.hdFallidos ||= [];
  reunion.hdFallidos = reunion.hdFallidos.filter(f => f.desde !== desde);
  if (reunion.hd.some(s => s.desde === desde)) return false;
  reunion.hd.push({ desde, hasta, texto, proveedor, recuperado: true });
  reunion.hd.sort((a, b) => a.desde - b.desde);
  return true;
}
