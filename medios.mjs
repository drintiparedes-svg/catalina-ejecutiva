// Búsqueda de imágenes en la web abierta, con foco en salud.
//
// El problema que resuelve: hasta ahora las imágenes salían sólo de Wikimedia
// Commons, afinado para láminas de anatomía. Para casi todo lo demás —un
// dispositivo, una escena clínica, una infografía, una foto real— no encontraba
// nada. Esto abre la búsqueda a tres fuentes abiertas y complementarias.
//
// Arquitectura (precisa y barata a propósito):
//
//   · Abanico en PARALELO, no cascada. Las tres fuentes se consultan a la vez
//     con Promise.allSettled y un corte de tiempo por fuente, así la latencia es
//     la de la más lenta —no la suma— y una fuente caída no tumba la búsqueda.
//   · El servidor NUNCA descarga la imagen. Sólo mueve metadatos y URLs; el
//     navegador carga las miniaturas directo desde la fuente. Es el mayor ahorro
//     de red y memoria: el servidor mueve kilobytes de JSON, no megabytes de foto.
//   · Miniaturas para la rejilla, imagen grande sólo al abrir una. Menos bytes.
//   · Enrutado por intención: si la consulta huele a clínico se añade Open-i
//     (figuras biomédicas) y se prioriza el diagrama; si no, manda la amplitud.
//   · Caché en memoria acotada: repetir la misma búsqueda en una sesión no
//     vuelve a salir a la red. En Vercel sólo dura lo que la instancia siga
//     caliente, y aun así ahorra las repeticiones más comunes.
//
// Las tres fuentes son abiertas y no piden clave, así que esto funciona aunque
// no haya ninguna API key configurada.
//
//   · Openverse (openverse.org) — agregador de ~800 millones de imágenes con
//     licencia abierta (Commons, Flickr, museos…). Es la que da amplitud.
//   · Wikimedia Commons — diagramas y esquemas, lo que ya se usaba.
//   · Open-i (NLM) — figuras de artículos biomédicos de acceso abierto, con su
//     cita. Sólo se consulta cuando la pregunta es clínica.

const TIEMPO = 4500;        // corte por fuente
const POR_FUENTE = 8;       // cuántas pide a cada una
const DEVUELVE = 12;        // cuántas entrega, ya ordenadas

// Caché en memoria, acotada: mapa consulta → resultado, con caducidad y tope.
const CACHE = new Map();
const CACHE_MAX = 50;
const CACHE_TTL = 10 * 60_000;

function deCache(clave) {
  const e = CACHE.get(clave);
  if (!e) return null;
  if (Date.now() - e.cuando > CACHE_TTL) { CACHE.delete(clave); return null; }
  // Se reinserta para que el más usado no sea el primero en caer (LRU simple).
  CACHE.delete(clave); CACHE.set(clave, e);
  return e.datos;
}
function aCache(clave, datos) {
  CACHE.set(clave, { cuando: Date.now(), datos });
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const limpiarHtml = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ¿La consulta pide algo clínico/biomédico? Decide si vale la pena Open-i y si
// se premia el diagrama frente a la foto.
const CLINICO = /(anatom|clinic|clínic|radiograf|resonanc|tomograf|ecograf|histolog|patolog|celul|célul|organo|órgano|tejido|muscul|múscul|hueso|arteri|vena|nerv|cerebro|coraz|riñ|\brin|pulm|higad|hígad|sintoma|síntoma|enfermedad|lesion|lesión|tumor|cancer|cáncer|quirurg|cirug|fractura|dermat|celular)/i;

// ── Las tres fuentes ─────────────────────────────────────────────────────────

async function deOpenverse(q) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${POR_FUENTE}&mature=false`;
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error("openverse " + r.status);
  const d = await r.json();
  return (d.results || []).filter(x => x.thumbnail).map(x => ({
    titulo: x.title || x.creator || "Imagen",
    thumb: x.thumbnail,
    imagen: x.url || x.thumbnail,
    fuente: x.foreign_landing_url || x.url || "",
    autor: x.creator || x.source || "",
    licencia: [x.license, x.license_version].filter(Boolean).join(" ").toUpperCase() || "CC",
    ancho: x.width || 0, alto: x.height || 0,
    origen: "Openverse", diagrama: false
  }));
}

async function deCommons(q) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: q, gsrnamespace: "6",
    gsrlimit: String(POR_FUENTE), prop: "imageinfo", iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "420", format: "json", origin: "*"
  }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error("commons " + r.status);
  const d = await r.json();
  const paginas = d?.query?.pages ? Object.values(d.query.pages) : [];
  return paginas.map(p => {
    const ii = p.imageinfo?.[0];
    if (!ii?.thumburl) return null;
    const mime = ii.mime || "";
    if (mime && !mime.startsWith("image/")) return null;   // aparta PDF, TIFF, vídeo
    const meta = ii.extmetadata || {};
    return {
      titulo: (p.title || "").replace(/^File:/, "").replace(/\.\w+$/, ""),
      thumb: ii.thumburl,
      imagen: ii.url,
      fuente: ii.descriptionurl || ii.url || "",
      autor: limpiarHtml(meta.Artist?.value),
      licencia: meta.LicenseShortName?.value || "Commons",
      ancho: ii.width || 0, alto: ii.height || 0,
      origen: "Commons",
      diagrama: /svg|diagram|scheme|schema/i.test(mime + " " + (p.title || ""))
    };
  }).filter(Boolean);
}

async function deOpeni(q) {
  // it: tipos de imagen (x-ray, ultrasound, CT, gráfico, foto, MRI…). m/n: rango.
  const url = `https://openi.nlm.nih.gov/api/search?query=${encodeURIComponent(q)}&m=1&n=${POR_FUENTE}&it=x,u,c,g,ph,m`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error("openi " + r.status);
  const d = await r.json();
  const base = "https://openi.nlm.nih.gov";
  return (d.list || []).filter(x => x.imgThumb).map(x => ({
    titulo: limpiarHtml(x.title) || limpiarHtml(x.image?.caption) || "Figura biomédica",
    thumb: base + x.imgThumb,
    imagen: base + (x.imgLarge || x.imgGrid || x.imgThumb),
    fuente: x.pmcid ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${x.pmcid}/` : base,
    autor: limpiarHtml(x.authors),
    licencia: "PMC · acceso abierto",
    ancho: 0, alto: 0,
    origen: "Open-i (NLM)", diagrama: true
  }));
}

async function deWikipedia(q) {
  // Imagen principal de los artículos que coinciden: el esquema o la foto que
  // ilustra el tema, en español. Las imágenes viven en Commons, con su licencia.
  const url = new URL("https://es.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: q, gsrnamespace: "0",
    gsrlimit: String(POR_FUENTE), prop: "pageimages", piprop: "thumbnail|original",
    pithumbsize: "480", format: "json", origin: "*"
  }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error("wikipedia " + r.status);
  const d = await r.json();
  const paginas = d?.query?.pages ? Object.values(d.query.pages) : [];
  return paginas.filter(p => p.thumbnail?.source).map(p => ({
    titulo: p.title,
    thumb: p.thumbnail.source,
    imagen: p.original?.source || p.thumbnail.source,
    fuente: `https://es.wikipedia.org/wiki/${encodeURIComponent((p.title || "").replace(/ /g, "_"))}`,
    autor: "",
    licencia: "Wikipedia · Commons",
    ancho: p.original?.width || p.thumbnail.width || 0,
    alto: p.original?.height || p.thumbnail.height || 0,
    origen: "Wikipedia", diagrama: false
  }));
}

async function deWellcome(q) {
  // Wellcome Collection: banco de imágenes médicas e históricas, abierto y con
  // licencia (mayormente CC). API pública, sin clave.
  const url = `https://api.wellcomecollection.org/catalogue/v2/images?query=${encodeURIComponent(q)}&pageSize=${POR_FUENTE}`;
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error("wellcome " + r.status);
  const d = await r.json();
  return (d.results || []).filter(x => x.thumbnail?.url).map(x => ({
    titulo: x.source?.title || "Wellcome Collection",
    thumb: x.thumbnail.url,
    imagen: x.thumbnail.url,
    fuente: x.source?.id ? `https://wellcomecollection.org/works/${x.source.id}` : "https://wellcomecollection.org",
    autor: "Wellcome Collection",
    licencia: "CC · Wellcome",
    ancho: x.thumbnail.width || 0, alto: x.thumbnail.height || 0,
    origen: "Wellcome", diagrama: false
  }));
}

// ── Fundir y ordenar ─────────────────────────────────────────────────────────

// La misma imagen puede llegar por dos fuentes (Openverse reindexa Commons). Se
// funden por URL de imagen y, si no, por título normalizado.
function fundir(listas) {
  const por = new Map();
  for (const lista of listas) for (const it of lista) {
    const clave = norm(it.imagen).slice(0, 140) || norm(it.titulo);
    if (!clave) continue;
    const previo = por.get(clave);
    if (!previo) { por.set(clave, it); continue; }
    // Se conserva la de mayor resolución conocida.
    if (Math.min(it.ancho, it.alto) > Math.min(previo.ancho, previo.alto)) por.set(clave, it);
  }
  return [...por.values()];
}

// Puntúa relevancia y calidad: coincidencia de términos en el título, que traiga
// miniatura, resolución, y prioridad de fuente según la intención de la consulta.
function puntuar(it, terminos, clinico) {
  let p = 0;
  const t = norm(it.titulo);
  for (const w of terminos) if (w.length > 2 && t.includes(w)) p += 40;
  if (it.thumb) p += 20;
  const menorLado = Math.min(it.ancho || 0, it.alto || 0);
  if (menorLado >= 600) p += 25; else if (menorLado >= 300) p += 12;
  const prioridad = clinico
    ? { "Open-i (NLM)": 30, "Wellcome": 24, "Commons": 20, "Wikipedia": 22, "Openverse": 10 }
    : { "Openverse": 30, "Wikipedia": 26, "Commons": 20, "Wellcome": 18, "Open-i (NLM)": 15 };
  p += prioridad[it.origen] || 0;
  if (clinico && it.diagrama) p += 15;
  return p;
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────

// ── Fuentes clínicas curadas (enlaces, no incrustación) ──────────────────────
//
// Estas cuatro no tienen API y varias son de pago o con derechos (Mayo, Science
// Source), así que NO se extraen ni se incrustan sus imágenes —copiarlas sería
// infringir su licencia, y bloquean el hotlinking—: se entregan como enlaces
// directos para que la persona los abra y busque ahí. Enlazar es legal; copiar,
// no. Las láminas de Gray's Anatomy (dominio público) además ya salen por
// Commons en la búsqueda normal de imágenes.
const FUENTES_CLINICAS = [
  {
    nombre: "Gray's Anatomy (Bartleby)",
    dominio: "bartleby.com",
    nota: "Láminas clásicas de anatomía, de dominio público.",
    enlace: () => "https://www.bartleby.com/lit-hub/anatomy-of-the-human-body/"
  },
  {
    nombre: "Mayo Clinic — Pruebas y procedimientos",
    dominio: "mayoclinic.org",
    nota: "Descripciones e imágenes de pruebas y procedimientos, en español.",
    // La búsqueda de Mayo acepta un término; si lo ignorara, cae en el índice.
    enlace: q => q
      ? `https://www.mayoclinic.org/es/search/search-results?q=${encodeURIComponent(q)}`
      : "https://www.mayoclinic.org/es/tests-procedures"
  },
  {
    nombre: "Mayo — Guía de bancos de imágenes médicas",
    dominio: "libraryguides.mayo.edu",
    nota: "Guía de la biblioteca Mayo con bancos de imágenes clínicas.",
    enlace: () => "https://libraryguides.mayo.edu/c.php?g=280097&p=1867838"
  },
  {
    nombre: "Science Source",
    dominio: "sciencesource.com",
    nota: "Banco profesional de imágenes médicas (licencia de pago).",
    enlace: () => "https://www.sciencesource.com/"
  }
];

// Siempre disponibles: son enlaces, no dependen de ninguna clave ni red.
export const hayFuentesClinicas = () => true;

// Devuelve las fuentes clínicas curadas como enlaces, con el término incrustado
// donde el sitio lo admite. No sale a la red: sólo arma las direcciones.
export function fuentesClinicas(consulta = "") {
  const q = String(consulta || "").trim();
  return {
    ok: true,
    consulta: q,
    fuentes: FUENTES_CLINICAS.map(f => ({
      titulo: f.nombre,
      enlace: f.enlace(q),
      dominio: f.dominio,
      nota: f.nota
    }))
  };
}

// Siempre disponible: las tres fuentes son abiertas y no piden clave.
export const hayImagenesWeb = () => true;

// ── Búsqueda de imágenes en la WEB ABIERTA (motor de Google) ─────────────────
//
// Segundo paso, sólo tras autorización del usuario: cuando lo pedido no está en
// los bancos abiertos (una persona, un autor, algo no médico), se busca en toda
// la web con la API de búsqueda de imágenes de Google (Custom Search). Es la vía
// legítima y estable —scrapear Google Images va contra sus términos y se
// bloquea—. Devuelve imágenes reales con su página de origen.
//
// Necesita un buscador programable (GOOGLE_CSE_ID) y una clave de Google
// (GOOGLE_CSE_KEY, o la de Gemini si su proyecto tiene «Custom Search API»
// activada). OJO: son fotos de la web abierta, con derechos de sus dueños; se
// muestran para ver y referenciar, con su fuente, no como material libre.
const CSE_ID = () => process.env.GOOGLE_CSE_ID?.trim();
const CSE_KEY = () => (process.env.GOOGLE_CSE_KEY || process.env.GEMINI_API_KEY)?.trim();
const SERPAPI = () => process.env.SERPAPI_KEY?.trim();

function detalleGoogle(crudo) {
  try { return String(JSON.parse(crudo)?.error?.message || "").slice(0, 200); } catch { return ""; }
}

// Siempre disponible: aunque no haya clave, el respaldo de Wikipedia (sin clave)
// da resultados para muchas personas y entidades conocidas.
export const hayImagenesWebAbierta = () => true;
// ¿Hay un buscador web "completo" configurado (Google/SerpAPI), o sólo Wikipedia?
export const hayBuscadorWebCompleto = () => Boolean(SERPAPI() || (CSE_ID() && CSE_KEY()));

// SerpAPI: resultados reales de Google Images con una sola clave, sin montar un
// buscador programable. Tiene tier gratis; luego es de pago.
async function deSerpApi(q) {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({ engine: "google_images", q, api_key: SERPAPI(), num: "10", safe: "active" }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO) });
  const crudo = await r.text();
  if (!r.ok) throw new Error(`SerpAPI ${r.status}: ${detalleGoogle(crudo) || crudo.slice(0, 120)}`);
  let d = {}; try { d = JSON.parse(crudo); } catch {}
  return (d.images_results || []).filter(it => it.original || it.thumbnail).map(it => ({
    titulo: it.title || it.source || "Imagen",
    thumb: it.thumbnail || it.original,
    imagen: it.original || it.thumbnail,
    fuente: it.link || it.source || "",
    autor: it.source || "",
    licencia: "Web abierta · verifica derechos",
    ancho: it.original_width || 0, alto: it.original_height || 0,
    origen: "Web (SerpAPI)", diagrama: false
  }));
}

// Google Programmable Search (Custom Search JSON API).
async function deCSE(q) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.search = new URLSearchParams({ key: CSE_KEY(), cx: CSE_ID(), q, searchType: "image", num: "10", safe: "active" }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO) });
  const crudo = await r.text();
  if (!r.ok) {
    const detalle = detalleGoogle(crudo);
    throw new Error(r.status === 403
      ? `Google rechazó la búsqueda${detalle ? ": " + detalle : ""} (activa «Custom Search API» y usa un motor "para toda la web")`
      : `Google ${r.status}${detalle ? ": " + detalle : ""}`);
  }
  let d = {}; try { d = JSON.parse(crudo); } catch {}
  return (d.items || []).filter(it => it.link).map(it => ({
    titulo: it.title || it.displayLink || "Imagen",
    thumb: it.image?.thumbnailLink || it.link,
    imagen: it.link,
    fuente: it.image?.contextLink || it.link,
    autor: it.displayLink || "",
    licencia: "Web abierta · verifica derechos",
    ancho: it.image?.width || 0, alto: it.image?.height || 0,
    origen: "Web (Google)", diagrama: false
  }));
}

// Respaldo sin clave: la imagen principal de los artículos de Wikipedia que
// coinciden con la búsqueda. Cubre muchas personas y entidades públicas.
async function deWikiWeb(lang, q) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: q, gsrnamespace: "0", gsrlimit: "6",
    prop: "pageimages", piprop: "thumbnail|original", pithumbsize: "480", format: "json", origin: "*"
  }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) return [];
  const d = await r.json();
  const paginas = d?.query?.pages ? Object.values(d.query.pages) : [];
  return paginas.filter(p => p.thumbnail?.source).map(p => ({
    titulo: p.title,
    thumb: p.thumbnail.source,
    imagen: p.original?.source || p.thumbnail.source,
    fuente: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((p.title || "").replace(/ /g, "_"))}`,
    autor: "", licencia: "Wikipedia · Commons",
    ancho: p.original?.width || 0, alto: p.original?.height || 0,
    origen: "Wikipedia", diagrama: false
  }));
}
async function deWikipediaWeb(q) {
  const en = await deWikiWeb("en", q).catch(() => []);
  if (en.length) return en;
  return deWikiWeb("es", q).catch(() => []);
}

// Cascada: SerpAPI → Google CSE → Wikipedia. Usa la primera que dé resultados;
// Wikipedia va siempre al final como respaldo sin clave.
export async function buscarImagenesWebAbierta(consulta, opciones = {}) {
  const q = String(consulta || "").trim();
  if (!q) return { ok: false, error: "Falta la consulta de imagen." };

  const proveedores = [];
  if (SERPAPI()) proveedores.push(["Web (SerpAPI)", () => deSerpApi(q)]);
  if (CSE_ID() && CSE_KEY()) proveedores.push(["Web (Google)", () => deCSE(q)]);
  proveedores.push(["Wikipedia", () => deWikipediaWeb(q)]);

  let ultimoError = "";
  for (const [nombre, fn] of proveedores) {
    try {
      const imagenes = await fn();
      if (imagenes.length) return { ok: true, total: imagenes.length, imagenes, consultadas: [nombre], vacio: false };
    } catch (e) {
      ultimoError = e.message || String(e);
    }
  }
  return {
    ok: false,
    vacio: true,
    error: ultimoError
      ? `No encontré imágenes. Último intento: ${ultimoError}.`
      : "No encontré imágenes en la web para eso. Para más alcance, configura SERPAPI_KEY o un GOOGLE_CSE_ID «para toda la web»."
  };
}

export async function buscarImagenes(consulta, opciones = {}) {
  const q = String(consulta || "").trim();
  if (!q) return { ok: false, error: "Falta la consulta de imagen." };

  const claveCache = norm(q);
  const cacheado = deCache(claveCache);
  if (cacheado) return { ...cacheado, cache: true };

  const clinico = opciones.clinico ?? CLINICO.test(q);
  const terminos = norm(q).split(/\s+/).filter(Boolean);

  // Openverse, Commons, Wikipedia y Wellcome siempre; Open-i sólo si la consulta
  // es clínica (es biomédico y no aporta en lo general).
  const nombres = ["Openverse", "Commons", "Wikipedia", "Wellcome"];
  const lanes = [deOpenverse(q), deCommons(q), deWikipedia(q), deWellcome(q)];
  if (clinico) { nombres.push("Open-i (NLM)"); lanes.push(deOpeni(q)); }

  const acuerdos = await Promise.allSettled(lanes);
  const listas = [], consultadas = [], fallaron = [];
  acuerdos.forEach((a, i) => {
    if (a.status === "fulfilled" && a.value.length) { listas.push(a.value); consultadas.push(nombres[i]); }
    else if (a.status === "fulfilled") consultadas.push(nombres[i]);
    else fallaron.push(nombres[i]);
  });

  const fundidas = fundir(listas).sort((a, b) => puntuar(b, terminos, clinico) - puntuar(a, terminos, clinico));
  const imagenes = fundidas.slice(0, DEVUELVE);

  const datos = {
    ok: true,
    total: fundidas.length,
    imagenes,
    consultadas,
    fallaron,
    // Si ninguna fuente devolvió nada, se dice —no se finge un resultado.
    vacio: imagenes.length === 0
  };
  aCache(claveCache, datos);
  return datos;
}

// ── Proxy de imagen ──────────────────────────────────────────────────────────
//
// Casi todas estas fuentes permiten cargar la imagen directamente en el
// navegador, que es lo eficiente: el servidor no toca esos bytes. Pero alguna
// puede bloquear el hotlinking, y entonces la imagen no se ve. Este proxy es la
// red de seguridad: el cliente sólo lo usa cuando la carga directa falla, y así
// el contenido SIEMPRE se muestra.
//
// Para no ser un proxy abierto —un agujero de SSRF— sólo sirve imágenes de una
// lista blanca de hosts conocidos, sólo por https, y sólo si lo que vuelve es de
// verdad una imagen. Con la lista blanca no hay forma de apuntarlo a la red
// interna: el host tiene que ser uno de estos dominios públicos.
const HOSTS_IMAGEN = [
  "upload.wikimedia.org", "commons.wikimedia.org",
  "es.wikipedia.org", "en.wikipedia.org",
  "api.openverse.org", "openi.nlm.nih.gov",
  "iiif.wellcomecollection.org"
];
const MAX_IMAGEN = 6 * 1024 * 1024;

function hostPermitido(host) {
  return HOSTS_IMAGEN.some(h => host === h || host.endsWith("." + h));
}

export async function proxearImagen(urlStr) {
  let url;
  try { url = new URL(String(urlStr)); } catch { return { ok: false, estado: 400, error: "URL inválida" }; }
  if (url.protocol !== "https:") return { ok: false, estado: 400, error: "sólo https" };
  if (!hostPermitido(url.hostname)) return { ok: false, estado: 403, error: "host no permitido" };

  let r;
  try {
    r = await fetch(url, {
      signal: AbortSignal.timeout(TIEMPO),
      headers: { "User-Agent": "CatalinaEjecutiva/1.0 (imágenes clínicas)", Accept: "image/*" }
    });
  } catch { return { ok: false, estado: 502, error: "no se pudo obtener la imagen" }; }

  const tipo = r.headers.get("content-type") || "";
  if (!r.ok || !tipo.startsWith("image/")) return { ok: false, estado: 502, error: "no es una imagen" };
  const largo = Number(r.headers.get("content-length") || 0);
  if (largo && largo > MAX_IMAGEN) return { ok: false, estado: 413, error: "imagen demasiado grande" };

  const buffer = Buffer.from(await r.arrayBuffer());
  if (buffer.length > MAX_IMAGEN) return { ok: false, estado: 413, error: "imagen demasiado grande" };
  return { ok: true, tipo, buffer };
}
