// Lleva la persona por defecto al archivo guardado. Sin esto, un data/config.json
// existente sigue mandando y el cambio de persona no se nota.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CONFIG_POR_DEFECTO } from "../config.mjs";

const RUTA = fileURLToPath(new URL("../data/config.json", import.meta.url));
let guardado;
try {
  guardado = JSON.parse(await readFile(RUTA, "utf8"));
} catch {
  console.log("no hay data/config.json: manda el valor por defecto, nada que hacer");
  process.exit(0);
}

guardado.persona = { ...guardado.persona, ...CONFIG_POR_DEFECTO.persona };

const antes = guardado.conocimiento?.length ?? 0;
guardado.conocimiento = (guardado.conocimiento ?? []).filter(
  nota => !/ayuno preoperatorio/i.test(nota.texto || "")
);

await writeFile(RUTA, JSON.stringify(guardado, null, 2), "utf8");
console.log("persona actualizada en data/config.json");
console.log(`notas de conocimiento: ${antes} -> ${guardado.conocimiento.length}`);
