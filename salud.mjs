// Búsqueda de recursos de salud cercanos en Chile.
//
// Dos fuentes, ambas abiertas y sin clave:
//
//   · Farmacias — MINSAL publica el listado nacional y el de turnos del día.
//     Es el dato oficial, y el único que sabe qué farmacia está de turno.
//   · Hospitales y clínicas — OpenStreetMap vía Overpass, que permite buscar
//     por radio alrededor de un punto.
//
// Nada de esto se inventa: si una fuente no responde, se dice que no se pudo
// consultar. Mandar a alguien de madrugada a una farmacia que no está de turno
// es peor que decirle que hay que confirmarlo por teléfono.

const MINSAL_TURNOS = "https://midas.minsal.cl/farmacia_v2/WS/getLocalesTurnos.php";
const MINSAL_LOCALES = "https://midas.minsal.cl/farmacia_v2/WS/getLocales.php";

// Overpass se satura a menudo y devuelve 504; con un solo servidor la búsqueda
// de hospitales fallaría de forma intermitente sin motivo aparente.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

// ASCII y sin paréntesis, a propósito. El cortafuegos del MINSAL devuelve 403
// ante un User-Agent con paréntesis o acentos: con «Catalina/1.0 (asistente de
// docencia médica)» rechazaba todas las peticiones, y con «Catalina/1.0»
// responde con normalidad. Costó verlo porque curl sí pasaba.
const AGENTE = "Catalina/1.0";
const VIGENCIA = 30 * 60 * 1000;   // media hora: los turnos cambian a diario

const cache = new Map();

async function conCache(clave, cargar) {
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.momento < VIGENCIA) return guardado.valor;
  const valor = await cargar();
  cache.set(clave, { valor, momento: Date.now() });
  return valor;
}

// El MINSAL bloquea por dirección de origen, no por cómo se vea la petición.
// Desde un equipo particular responde con normalidad; desde el despliegue
// devuelve 403 aunque se manden las cabeceras completas de un navegador. Se
// probó y no cambia nada, así que aquí va un agente honesto: disfrazarse no
// servía y encima ocultaba la causa real.
async function traerJson(url) {
  const respuesta = await fetch(url, {
    headers: { "User-Agent": AGENTE, Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  if (!respuesta.ok) {
    const error = new Error(`${url} respondió ${respuesta.status}`);
    error.estado = respuesta.status;
    throw error;
  }
  return respuesta.json();
}

// La fecha de hoy en Chile, no la del servidor. Vercel corre en UTC y en
// Sudamérica eso adelanta el cambio de día varias horas: de madrugada habría
// mostrado los turnos de mañana, que es justo cuando más importa acertar.
function hoyEnChile() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

// Sin acentos y en mayúsculas: el MINSAL escribe «ÑUÑOA» y la gente dice
// «nunoa», y sin normalizar no se encuentran.
const normalizar = texto => String(texto ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().trim();

// Chile continental, más Isla de Pascua por el oeste. El listado del MINSAL
// trae coordenadas corruptas —ceros, valores invertidos— y sin este filtro se
// colaban farmacias «a 11.755 km» y, peor, esas coordenadas falsas arrastraban
// el centro de la comuna a mitad del océano, dejando el resto de la búsqueda
// sin sentido.
function coordenadaValida(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat < -17 && lat > -57
    && lon < -65 && lon > -110;
}

// Mediana y no promedio: basta una coordenada disparatada para desplazar un
// promedio cientos de kilómetros, y la mediana ni se entera.
function mediana(valores) {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

function distanciaKm(latA, lonA, latB, lonB) {
  const R = 6371;
  const rad = grados => grados * Math.PI / 180;
  const dLat = rad(latB - latA);
  const dLon = rad(lonB - lonA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const farmaciasDeTurno = () => conCache("turnos", () => traerJson(MINSAL_TURNOS));
const todasLasFarmacias = () => conCache("locales", () => traerJson(MINSAL_LOCALES));

// Centro aproximado de cada comuna, deducido de las farmacias que hay en ella.
// Evita depender de un geocodificador aparte: el dato ya viene en la respuesta
// del MINSAL y cubre todo el país.
async function centroDeComuna(comuna) {
  const indice = await conCache("comunas", async () => {
    const locales = await todasLasFarmacias();
    const porComuna = new Map();
    for (const local of locales) {
      const lat = Number(local.local_lat);
      const lon = Number(local.local_lng);
      if (!coordenadaValida(lat, lon)) continue;
      const clave = normalizar(local.comuna_nombre);
      if (!clave) continue;
      const lista = porComuna.get(clave) ?? { lat: [], lon: [] };
      lista.lat.push(lat); lista.lon.push(lon);
      porComuna.set(clave, lista);
    }
    const centros = new Map();
    for (const [clave, l] of porComuna) {
      centros.set(clave, { lat: mediana(l.lat), lon: mediana(l.lon) });
    }
    return centros;
  });
  return indice.get(normalizar(comuna)) ?? null;
}

function describirFarmacia(local, origen) {
  const lat = Number(local.local_lat);
  const lon = Number(local.local_lng);
  return {
    nombre: local.local_nombre?.trim() || "Farmacia",
    direccion: local.local_direccion?.trim() || "",
    comuna: local.comuna_nombre?.trim() || "",
    telefono: local.local_telefono?.trim() || "",
    horario: local.funcionamiento_hora_apertura && local.funcionamiento_hora_cierre
      ? `${local.funcionamiento_hora_apertura.slice(0, 5)} a ${local.funcionamiento_hora_cierre.slice(0, 5)}`
      : "",
    lat, lon,
    distanciaKm: origen && coordenadaValida(lat, lon)
      ? Number(distanciaKm(origen.lat, origen.lon, lat, lon).toFixed(1))
      : null,
    mapa: coordenadaValida(lat, lon)
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : ""
  };
}

// Coherencia entre la coordenada y la comuna declarada. Hay registros con una
// cosa u otra mal: «LA BOTICA PANDA» dice estar en Paine y sus coordenadas caen
// en pleno Santiago, a 40 km. No se puede saber cuál de los dos campos miente,
// así que se descarta el registro: enviar a alguien a una dirección equivocada
// de madrugada es peor que darle una opción menos.
async function coherente(local) {
  const lat = Number(local.local_lat);
  const lon = Number(local.local_lng);
  if (!coordenadaValida(lat, lon)) return false;
  const centro = await centroDeComuna(local.comuna_nombre);
  if (!centro) return true;   // comuna desconocida: no hay con qué contrastar
  return distanciaKm(centro.lat, centro.lon, lat, lon) < 25;
}

export async function buscarFarmacias({ deTurno, comuna, lat, lon, limite = 5 }) {
  const listado = deTurno ? await farmaciasDeTurno() : await todasLasFarmacias();

  // El listado de turnos arrastra registros de días anteriores. Sin filtrar por
  // la fecha de hoy se anunciaría como abierta una farmacia que estuvo de turno
  // el mes pasado.
  const hoy = hoyEnChile();
  const vigentes = deTurno ? listado.filter(x => x.fecha === hoy) : listado;

  let origen = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  if (!origen && comuna) origen = await centroDeComuna(comuna);

  let candidatas = vigentes;
  let fueraDeLaComuna = false;
  if (comuna) {
    const buscada = normalizar(comuna);
    const enLaComuna = vigentes.filter(x => normalizar(x.comuna_nombre) === buscada);
    if (enLaComuna.length) {
      candidatas = enLaComuna;
    } else if (origen) {
      // De noche la farmacia de la comuna vecina sirve, así que se amplía por
      // cercanía en vez de decir que no hay nada. Pero se avisa: dar una de
      // otra comuna sin decirlo hace creer que queda al lado.
      fueraDeLaComuna = true;
    }
  }

  const coherencias = await Promise.all(candidatas.map(coherente));
  const resultados = candidatas
    .filter((_, i) => coherencias[i])
    .map(local => describirFarmacia(local, origen))
    .filter(f => coordenadaValida(f.lat, f.lon));

  if (origen) resultados.sort((a, b) => (a.distanciaKm ?? 1e9) - (b.distanciaKm ?? 1e9));

  return {
    ok: true,
    tipo: deTurno ? "farmacia_turno" : "farmacia",
    fecha: deTurno ? hoy : undefined,
    resultados: resultados.slice(0, limite),
    // Se devuelve para que Catalina pueda advertirlo: el turno lo publica el
    // MINSAL, pero los horarios cambian y conviene llamar antes de ir.
    // Se devuelve para que Catalina pueda advertirlo: el turno lo publica el
    // MINSAL, pero los horarios cambian y conviene llamar antes de ir.
    fueraDeLaComuna: fueraDeLaComuna || undefined,
    advertencia: [
      fueraDeLaComuna ? `No hay farmacia de turno en ${comuna}; estas son las más cercanas de otras comunas.` : "",
      deTurno ? "Turnos publicados por el MINSAL para hoy. Conviene llamar antes de ir." : ""
    ].filter(Boolean).join(" ") || undefined
  };
}

export async function buscarCentros({ tipo, lat, lon, comuna, limite = 5 }) {
  let origen = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  if (!origen && comuna) origen = await centroDeComuna(comuna);
  if (!origen) return { ok: false, error: "Necesito la comuna o la ubicación para buscar cerca." };

  const clases = tipo === "hospital" ? "hospital" : "clinic|doctors";
  const consulta = `[out:json][timeout:20];`
    + `(node["amenity"~"^(${clases})$"](around:6000,${origen.lat},${origen.lon});`
    + `way["amenity"~"^(${clases})$"](around:6000,${origen.lat},${origen.lon}););`
    + `out center 40;`;

  // Overpass devuelve 504 por sobrecarga con bastante frecuencia, y no por
  // falta de cupo: el estado del servidor sigue anunciando turnos libres. Se
  // reintenta en cada espejo con una pausa corta antes de darlo por perdido.
  //
  // Además se guarda la respuesta por zona durante un día: un hospital no se
  // muda, así que sólo la primera consulta de cada barrio paga la espera y una
  // caída puntual deja de notarse.
  const zona = `osm:${tipo}:${origen.lat.toFixed(2)},${origen.lon.toFixed(2)}`;
  const guardado = cache.get(zona);
  let datos = guardado && Date.now() - guardado.momento < 24 * 60 * 60 * 1000 ? guardado.valor : null;

  for (let intento = 0; !datos && intento < 2; intento += 1) {
    for (const servidor of OVERPASS) {
      try {
        const respuesta = await fetch(servidor, {
          method: "POST",
          headers: { "User-Agent": AGENTE, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: consulta }),
          signal: AbortSignal.timeout(20000)
        });
        if (!respuesta.ok) continue;
        datos = await respuesta.json();
        cache.set(zona, { valor: datos, momento: Date.now() });
        break;
      } catch {
        // Se prueba el siguiente espejo.
      }
    }
    if (!datos && intento === 0) await new Promise(r => setTimeout(r, 1500));
  }
  if (!datos) return { ok: false, error: "No se pudo consultar el mapa de centros de salud." };

  const resultados = (datos.elements ?? [])
    .map(elemento => {
      const etiquetas = elemento.tags ?? {};
      const nombre = etiquetas.name;
      if (!nombre) return null;   // sin nombre no sirve para orientar a nadie
      const punto = elemento.center ?? elemento;
      if (!Number.isFinite(punto.lat) || !Number.isFinite(punto.lon)) return null;
      const calle = [etiquetas["addr:street"], etiquetas["addr:housenumber"]].filter(Boolean).join(" ");
      return {
        nombre,
        direccion: calle,
        comuna: etiquetas["addr:city"] || "",
        telefono: etiquetas.phone || etiquetas["contact:phone"] || "",
        lat: punto.lat, lon: punto.lon,
        distanciaKm: Number(distanciaKm(origen.lat, origen.lon, punto.lat, punto.lon).toFixed(1)),
        mapa: `https://www.google.com/maps/search/?api=1&query=${punto.lat},${punto.lon}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanciaKm - b.distanciaKm);

  return {
    ok: true,
    tipo,
    resultados: resultados.slice(0, limite),
    advertencia: "Datos de OpenStreetMap: pueden estar incompletos o desactualizados."
  };
}
