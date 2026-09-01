// Toda ruta del servidor tiene que estar en la lista de vercel.json. Las que no
// están dan 404 sólo en producción: en local funcionan, así que el fallo aparece
// después de desplegar y no antes. Ya pasó con /elevenlabs/herramientas.
import { readFileSync } from "node:fs";
const dir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const vercel = JSON.parse(readFileSync(`${dir}/vercel.json`, "utf8"));
const regla = vercel.routes.find(r => r.dest === "/api/index.mjs");
const patron = new RegExp("^" + regla.src + "$");

const app = readFileSync(`${dir}/app.mjs`, "utf8");
// Las rutas se comparan contra `ruta` o se usan con startsWith.
const rutas = new Set([...app.matchAll(/req\.url(?:\.split\("\?"\)\[0\])?\s*(?:===|\.startsWith\()\s*"(\/[^"]*)"/g)].map(m => m[1]));

let fallos = 0;
for (const ruta of [...rutas].sort()) {
  // Las que acaban en / son prefijos: se prueba con algo detrás.
  // Vercel compara el camino, no la consulta: `/img?` se enruta como `/img`.
  const camino = ruta.split("?")[0];
  const muestra = camino.endsWith("/") ? camino + "x" : camino;
  const ok = patron.test(muestra);
  if (!ok) { fallos += 1; console.log(`FALLA ${ruta} → 404 en producción: no está en vercel.json`); }
  else console.log(`ok    ${ruta}`);
}
console.log(fallos ? `\n${fallos} rutas se caerían en Vercel` : `\nLas ${rutas.size} rutas del servidor están enrutadas en Vercel`);
process.exit(fallos ? 1 : 0);
