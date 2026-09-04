// ¿Todo lo que el guion busca en el DOM existe de verdad en el HTML?
// Un querySelector que devuelve null revienta el módulo entero al cargar y la
// página se queda muerta sin decir nada. Es el fallo más caro de todos.
import { readFileSync, readdirSync } from "node:fs";

const base = new URL("../public", import.meta.url).pathname;
const paginas = readdirSync(base).filter(f => f.endsWith(".html"));

// Qué guiones carga cada página.
const guionesDe = html => [...html.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]);
const idsDe = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

let fallos = 0;
for (const pagina of paginas) {
  const html = readFileSync(`${base}/${pagina}`, "utf8");
  const ids = idsDe(html);
  const propios = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  const externos = guionesDe(html)
    .filter(s => !s.startsWith("http"))
    .map(s => { try { return readFileSync(`${base}/${s.replace(/^\.\//, "")}`, "utf8"); } catch { return ""; } })
    .join("\n");
  const codigo = propios + "\n" + externos;

  // Sólo los selectores literales de id, que son los que se pueden comprobar.
  // Sólo los selectores de id, que son los que se pueden comprobar. Antes el
  // patrón dejaba la almohadilla como opcional y tomaba `querySelector("i")`
  // —un selector de etiqueta— como un id llamado «i».
  const buscados = new Set([
    ...[...codigo.matchAll(/querySelector\(\s*["'`]#([A-Za-z][\w-]*)["'`]\s*\)/g)].map(m => m[1]),
    ...[...codigo.matchAll(/getElementById\(\s*["'`]([A-Za-z][\w-]*)["'`]\s*\)/g)].map(m => m[1])
  ]);
  // Algunos nodos los crea el propio guion (el panel de cierre se compone
  // entero al vuelo). Cuentan como existentes si el código los declara.
  const creados = new Set([
    ...[...codigo.matchAll(/\.id\s*=\s*["'`]([\w-]+)["'`]/g)].map(m => m[1]),
    ...[...codigo.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1])
  ]);
  const faltan = [...buscados].filter(id => !ids.has(id) && !creados.has(id));
  if (faltan.length) { fallos += 1; console.log(`FALLA ${pagina}: el guion busca ids que no existen → ${faltan.join(", ")}`); }
  else console.log(`ok    ${pagina}: ${buscados.size} ids buscados, todos existen (${ids.size} en la página)`);
}

// Y al revés en app.js: ¿se usa algún ui.X que nunca se definió?
const app = readFileSync(`${base}/app.js`, "utf8");
const bloque = app.slice(app.indexOf("const ui = {"), app.indexOf("\n};", app.indexOf("const ui = {")));
const definidos = new Set([...bloque.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]));
const usados = new Set([...app.matchAll(/\bui\.(\w+)/g)].map(m => m[1]));
const huerfanos = [...usados].filter(u => !definidos.has(u));
if (huerfanos.length) { fallos += 1; console.log(`FALLA app.js usa ui.X sin definir → ${huerfanos.join(", ")}`); }
else console.log(`ok    app.js: ${usados.size} referencias ui.X, todas definidas`);

const sinUsar = [...definidos].filter(d => !usados.has(d));
if (sinUsar.length) console.log(`aviso app.js define y no usa → ${sinUsar.join(", ")}`);

process.exit(fallos ? 1 : 0);
