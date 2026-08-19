// Mapa del trayecto, dibujado en el navegador.
//
// El mapa estático de Google exige clave y facturación activa, así que aquí se
// compone a mano: se descargan las teselas de OpenStreetMap que cubren el
// trayecto y se dibujan en un lienzo con la ruta y las dos marcas encima. El
// resultado es una imagen normal, que entra en la misma tarjeta donde se
// muestran las láminas.
//
// El clic sí abre Google Maps, con el recorrido ya cargado: para eso basta un
// enlace y es lo que la gente ya sabe usar.

const TESELA = 256;
const ANCHO = 640;
const ALTO = 420;
const MAX_TESELAS = 20;   // techo de cortesía con el servidor de teselas

// Proyección de Mercator, la que usan las teselas.
const aX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const aY = (lat, z) => {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z;
};

function cargarTesela(x, y, z) {
  return new Promise(resolver => {
    const imagen = new Image();
    imagen.crossOrigin = "anonymous";
    // Si una tesela no llega, se resuelve igual: mejor un hueco que ningún mapa.
    imagen.onload = () => resolver(imagen);
    imagen.onerror = () => resolver(null);
    imagen.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });
}

// El zoom más cercano en el que el trayecto entero sigue cabiendo. Se prueba de
// mayor a menor detalle y se toma el primero que quepa, para que el mapa se vea
// lo más cerca posible sin recortar la ruta.
function elegirZoom(puntos) {
  const latitudes = puntos.map(p => p.lat);
  const longitudes = puntos.map(p => p.lon);
  const norte = Math.max(...latitudes), sur = Math.min(...latitudes);
  const este = Math.max(...longitudes), oeste = Math.min(...longitudes);

  for (let z = 17; z >= 3; z -= 1) {
    const ancho = (aX(este, z) - aX(oeste, z)) * TESELA;
    const alto = (aY(sur, z) - aY(norte, z)) * TESELA;
    // El margen deja aire alrededor: con la ruta pegada al borde no se entiende
    // por dónde va.
    if (ancho < ANCHO - 90 && alto < ALTO - 90) return z;
  }
  return 3;
}

export async function dibujarRuta({ origen, destino, trazado = [] }) {
  const puntos = [origen, destino, ...trazado].filter(p => p && Number.isFinite(p.lat));
  if (puntos.length < 2) return null;

  const z = elegirZoom(puntos);
  const centro = {
    x: (Math.max(...puntos.map(p => aX(p.lon, z))) + Math.min(...puntos.map(p => aX(p.lon, z)))) / 2,
    y: (Math.max(...puntos.map(p => aY(p.lat, z))) + Math.min(...puntos.map(p => aY(p.lat, z)))) / 2
  };

  const lienzo = document.createElement("canvas");
  lienzo.width = ANCHO;
  lienzo.height = ALTO;
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#e8e4dd";
  ctx.fillRect(0, 0, ANCHO, ALTO);

  // Píxel de la pantalla a partir de una coordenada.
  const aPantalla = punto => ({
    x: (aX(punto.lon, z) - centro.x) * TESELA + ANCHO / 2,
    y: (aY(punto.lat, z) - centro.y) * TESELA + ALTO / 2
  });

  const desdeX = Math.floor(centro.x - ANCHO / 2 / TESELA);
  const hastaX = Math.floor(centro.x + ANCHO / 2 / TESELA);
  const desdeY = Math.floor(centro.y - ALTO / 2 / TESELA);
  const hastaY = Math.floor(centro.y + ALTO / 2 / TESELA);

  const pendientes = [];
  for (let x = desdeX; x <= hastaX; x += 1) {
    for (let y = desdeY; y <= hastaY; y += 1) {
      if (pendientes.length >= MAX_TESELAS) break;
      pendientes.push({ x, y });
    }
  }

  const teselas = await Promise.all(pendientes.map(t => cargarTesela(t.x, t.y, z)));
  pendientes.forEach((t, i) => {
    if (!teselas[i]) return;
    ctx.drawImage(
      teselas[i],
      (t.x - centro.x) * TESELA + ANCHO / 2,
      (t.y - centro.y) * TESELA + ALTO / 2
    );
  });

  // Trazado: primero una línea blanca gruesa y encima la azul, que es lo que lo
  // hace legible sobre un mapa lleno de calles del mismo grosor.
  if (trazado.length > 1) {
    const camino = new Path2D();
    trazado.forEach((punto, i) => {
      const { x, y } = aPantalla(punto);
      if (i === 0) camino.moveTo(x, y); else camino.lineTo(x, y);
    });
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 9; ctx.stroke(camino);
    ctx.strokeStyle = "#0071E3"; ctx.lineWidth = 5; ctx.stroke(camino);
  }

  marca(ctx, aPantalla(origen), "#34C759", "Tú");
  marca(ctx, aPantalla(destino), "#FF3B30", "");

  ctx.fillStyle = "rgba(255,255,255,.82)";
  ctx.fillRect(0, ALTO - 18, ANCHO, 18);
  ctx.fillStyle = "#3a3a3c";
  ctx.font = "11px -apple-system, Helvetica, Arial, sans-serif";
  ctx.fillText("© OpenStreetMap contributors", 8, ALTO - 5);

  return lienzo.toDataURL("image/png");
}

function marca(ctx, punto, color, etiqueta) {
  ctx.beginPath();
  ctx.arc(punto.x, punto.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  if (etiqueta) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px -apple-system, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(etiqueta, punto.x, punto.y + 3);
    ctx.textAlign = "start";
  }
}
