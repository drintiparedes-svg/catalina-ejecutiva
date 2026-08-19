// Búsqueda de recursos de salud cercanos en Chile.
//
// Todo sale de OpenStreetMap: farmacias, hospitales y clínicas se buscan igual,
// por radio alrededor de un punto, y el punto se resuelve con Nominatim cuando
// la persona dice dónde está en vez de dar su ubicación.
//
// Antes las farmacias venían del MINSAL, que además publicaba los turnos. Se
// retiró: bloquea las peticiones que no vienen de un equipo particular, así que
// en el sitio publicado no funcionaba nunca, y sus coordenadas traían errores
// —registros en una comuna con el punto en otra, a 40 km— que obligaban a
// descartar resultados. Aquí sólo se ubica la farmacia; si está abierta o de
// turno hay que confirmarlo llamando.
//
// Nada se inventa: si la fuente no responde, se dice que no se pudo consultar.

// Overpass se satura a menudo y devuelve 504; con un solo servidor la búsqueda
// de hospitales fallaría de forma intermitente sin motivo aparente.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const AGENTE = "Catalina/1.0";
const VIGENCIA = 30 * 60 * 1000;

const cache = new Map();

async function conCache(clave, cargar) {
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.momento < VIGENCIA) return guardado.valor;
  const valor = await cargar();
  cache.set(clave, { valor, momento: Date.now() });
  return valor;
}

// Chile continental, más Isla de Pascua por el oeste. Descarta coordenadas
// disparatadas antes de que lleguen a una respuesta.
function coordenadaValida(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat < -17 && lat > -57
    && lon < -65 && lon > -110;
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

// Sin acentos y en mayúsculas, para que la clave de caché de «Ñuñoa» y la de
// «nunoa» sean la misma.
const normalizar = texto => String(texto ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toUpperCase().trim();

// Geocodificador. Convierte «Providencia» o «Avenida Matta 300» en un punto.
// Nominatim es abierto, no pide clave y responde desde cualquier sitio. Se
// cachea porque su política pide no repetir consultas.
async function geocodificar(lugar) {
  const consulta = String(lugar || "").trim();
  if (!consulta) return null;

  return conCache(`geo:${normalizar(consulta)}`, async () => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({
      q: /chile/i.test(consulta) ? consulta : `${consulta}, Chile`,
      format: "json", limit: "1", countrycodes: "cl"
    }).toString();

    try {
      const respuesta = await fetch(url, {
        headers: { "User-Agent": AGENTE },
        signal: AbortSignal.timeout(10000)
      });
      if (!respuesta.ok) return null;
      const encontrado = (await respuesta.json())?.[0];
      if (!encontrado) return null;
      const lat = Number(encontrado.lat);
      const lon = Number(encontrado.lon);
      return coordenadaValida(lat, lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  });
}

// Se expone para que el servidor pueda resolver un punto de partida dicho en
// voz alta —«estoy en Providencia»— sin depender de la geolocalización.
export async function ubicarLugar(lugar) {
  return geocodificar(lugar);
}

export async function buscarCentros({ tipo, lat, lon, comuna, limite = 5 }) {
  let origen = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  if (!origen && comuna) origen = await ubicarLugar(comuna);
  if (!origen) return { ok: false, error: "Necesito la comuna o la ubicación para buscar cerca." };

  const clases = tipo === "hospital" ? "hospital"
    : tipo === "farmacia" ? "pharmacy"
    : "clinic|doctors";
  const consulta = `[out:json][timeout:20];`
    + `(node["amenity"~"^(${clases})$"](around:6000,${origen.lat},${origen.lon});`
    + `way["amenity"~"^(${clases})$"](around:6000,${origen.lat},${origen.lon}););`
    + `out center 40;`;

  // Overpass devuelve 504 por sobrecarga con bastante frecuencia, y no por
  // falta de cupo: el estado del servidor sigue anunciando cupo libre. Se
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
  if (!datos) return { ok: false, error: "No se pudo consultar el mapa en este momento." };

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
    advertencia: tipo === "farmacia"
      ? "Datos de OpenStreetMap. Aquí sólo aparece dónde está la farmacia: si está abierta o de turno hay que confirmarlo llamando."
      : "Datos de OpenStreetMap: pueden estar incompletos o desactualizados."
  };
}

// ---------------------------------------------------------------------------
// Cómo llegar.
//
// El trazado y la distancia salen de OSRM, que es abierto y no pide clave. El
// tiempo, en cambio, hay que tratarlo con cuidado: el servidor público sirve el
// perfil de coche pase lo que pase —pedirle «a pie» devuelve los mismos 32 km/h—,
// así que el tiempo caminando se estima aquí a partir de la distancia en vez de
// repetir un dato que sería falso.
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const VELOCIDAD_A_PIE = 4.5;   // km/h, paso normal de un adulto

// Los tipos de maniobra vienen en inglés; se traducen para poder decirlos en voz
// alta sin leer jerga.
const MANIOBRAS = {
  depart: "Sal", arrive: "Llegas a destino", turn: "Gira", "new name": "Sigue",
  continue: "Continúa", merge: "Incorpórate", fork: "Toma el desvío",
  "end of road": "Al final de la calle, gira", roundabout: "En la rotonda, toma",
  rotary: "En la rotonda, toma", "roundabout turn": "En la rotonda, gira",
  ramp: "Toma la salida", "on ramp": "Toma la incorporación", "off ramp": "Toma la salida"
};
const DIRECCIONES = {
  left: "a la izquierda", right: "a la derecha", straight: "recto",
  "slight left": "levemente a la izquierda", "slight right": "levemente a la derecha",
  "sharp left": "cerrado a la izquierda", "sharp right": "cerrado a la derecha",
  uturn: "en sentido contrario"
};

function describirPaso(paso) {
  const maniobra = paso.maniobra ?? {};
  const verbo = MANIOBRAS[maniobra.type] ?? "Continúa";
  const giro = DIRECCIONES[maniobra.modifier] ?? "";
  const calle = paso.nombre ? ` por ${paso.nombre}` : "";
  if (maniobra.type === "arrive") return "Llegas a destino";
  const metros = paso.metros >= 1000
    ? `${(paso.metros / 1000).toFixed(1)} km`
    : `${Math.round(paso.metros)} m`;
  return `${verbo}${giro ? " " + giro : ""}${calle} (${metros})`;
}

export async function calcularRuta({ origen, destino }) {
  if (!coordenadaValida(origen?.lat, origen?.lon) || !coordenadaValida(destino?.lat, destino?.lon)) {
    return { ok: false, error: "Faltan las coordenadas de origen o destino." };
  }

  const url = `${OSRM}/${origen.lon},${origen.lat};${destino.lon},${destino.lat}`
    + "?overview=simplified&geometries=geojson&steps=true";

  let datos;
  try {
    const respuesta = await fetch(url, {
      headers: { "User-Agent": AGENTE },
      signal: AbortSignal.timeout(15000)
    });
    if (!respuesta.ok) throw new Error(`OSRM respondió ${respuesta.status}`);
    datos = await respuesta.json();
  } catch {
    return { ok: false, error: "No se pudo calcular el trayecto." };
  }
  if (datos.code !== "Ok" || !datos.routes?.length) {
    return { ok: false, error: "No hay una ruta entre esos dos puntos." };
  }

  const ruta = datos.routes[0];
  const km = ruta.distance / 1000;
  const pasos = (ruta.legs?.[0]?.steps ?? [])
    .map(p => ({ maniobra: p.maneuver ?? {}, nombre: (p.name || "").trim(), metros: p.distance ?? 0 }))
    // Los tramos de pocos metros son ruido al escucharlos: nadie dice «gira a la
    // derecha durante 8 metros».
    .filter((p, i, todos) => p.metros >= 25 || i === todos.length - 1)
    .map(describirPaso);

  return {
    ok: true,
    distanciaKm: Number(km.toFixed(2)),
    minutosEnAuto: Math.max(1, Math.round(ruta.duration / 60)),
    minutosCaminando: Math.max(1, Math.round((km / VELOCIDAD_A_PIE) * 60)),
    pasos: pasos.slice(0, 12),
    // Puntos del trazado, para dibujarlo sobre el mapa en el navegador.
    trazado: (ruta.geometry?.coordinates ?? []).map(([lon, lat]) => ({ lat, lon })),
    origen, destino,
    // El clic abre Google Maps con el recorrido ya cargado: no hace falta clave
    // para eso, y es lo que la gente ya sabe usar.
    enlace: `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lon}`
      + `&destination=${destino.lat},${destino.lon}&travelmode=driving`
  };
}
