// Empaqueta Catalina para llevarla a otro equipo.
//
//   npm run package
//
// Produce outputs/catalina-<fecha>.zip con todo lo necesario para ejecutarla y
// con el banco de pruebas dentro. Deja fuera dos cosas a propósito:
//
//   · .env, porque lleva la clave de API. Se incluye .env.example en su lugar.
//   · Los generadores de work/, que dependen de @napi-rs/canvas instalado en
//     una ruta concreta de esta máquina. El banco de pruebas sí va, porque es
//     un único archivo autónomo que no necesita nada.

import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, chmodSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fecha = new Date().toISOString().slice(0, 10);
const nombre = `catalina-${fecha}`;
const salida = join(raiz, "outputs");
const destino = join(salida, nombre);

// Lo que se copia tal cual, desde la raíz del proyecto.
const CONTENIDO = [
  "public",
  "server.mjs",
  "package.json",
  "start.command",
  ".env.example",
  "README.md"
];

// El banco de pruebas viaja en la raíz del paquete, donde se encuentra solo.
const BANCO = "work/banco-de-pruebas.html";

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

for (const ruta of CONTENIDO) {
  const origen = join(raiz, ruta);
  if (!existsSync(origen)) {
    console.error(`Falta ${ruta}: el paquete quedaría incompleto.`);
    process.exit(1);
  }
  cpSync(origen, join(destino, ruta), { recursive: true });
}

if (existsSync(join(raiz, BANCO))) {
  cpSync(join(raiz, BANCO), join(destino, "banco-de-pruebas.html"));
} else {
  console.warn("Aviso: no está work/banco-de-pruebas.html; el paquete irá sin banco de pruebas.");
}

// El paquete no debe arrancar sin que alguien ponga su clave. Se busca algo
// con forma de clave real: el marcador de ejemplo también empieza por «sk-».
const ejemplo = readFileSync(join(destino, ".env.example"), "utf8");
const claveReal = /sk-[A-Za-z0-9_\-]{24,}/.exec(ejemplo);
if (claveReal && !/reemplaza/i.test(claveReal[0])) {
  console.error("El .env.example parece llevar una clave real. Revísalo antes de empaquetar.");
  process.exit(1);
}
if (existsSync(join(destino, ".env"))) {
  console.error("Se coló un .env en el paquete. Abortando para no publicar la clave.");
  process.exit(1);
}

chmodSync(join(destino, "start.command"), 0o755);

// Instrucciones cortas, visibles al abrir la carpeta.
writeFileSync(join(destino, "LEEME.txt"), `Catalina — avatar conversacional local
${"=".repeat(38)}

PARA USARLA
  1. Abre .env.example, pega tu clave de OpenAI y guárdalo como .env
     (en el mismo sitio, sin la palabra "example" en el nombre).
  2. Doble clic en start.command
  3. Pulsa "Iniciar conversación" y permite el micrófono.

  Necesita Node.js instalado: https://nodejs.org (versión LTS).
  La primera vez macOS puede avisar de que el archivo viene de internet:
  clic derecho sobre start.command > Abrir.

BANCO DE PRUEBAS
  banco-de-pruebas.html se abre con doble clic, sin servidor y sin conexión.
  Sirve para ver la boca de cerca, probar las expresiones y ajustar posturas
  sin gastar una sesión de la API.

QUÉ NO VIENE INCLUIDO
  El archivo .env con la clave: cada equipo pone la suya.
  Las herramientas de render de work/, que sólo funcionan en el equipo de
  desarrollo. README.md explica cómo regenerarlas.

Empaquetado el ${fecha}.
`);

mkdirSync(salida, { recursive: true });
const zip = join(salida, `${nombre}.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-q", "-X", `${nombre}.zip`, nombre], { cwd: salida });
rmSync(destino, { recursive: true, force: true });

const tamano = statSync(zip).size;
console.log(`Paquete listo: outputs/${nombre}.zip (${(tamano / 1024 / 1024).toFixed(1)} MB)`);
