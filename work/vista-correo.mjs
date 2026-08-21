// Renderiza la plantilla con datos reales para poder mirarla sin enviar nada.
import { writeFile } from "node:fs/promises";
import { plantillaMediSmart, versionTexto } from "../correo.mjs";

const lamina = await (await fetch("http://127.0.0.1:4193/imagen-medica", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ estructura: "urinary tract" })
})).json();

const refs = await (await fetch("http://127.0.0.1:4193/referencias", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tema: "urinary tract anatomy" })
})).json();

const datos = {
  titulo: "Cómo funciona la vía urinaria",
  resumen: "Los riñones filtran la sangre y producen la orina de forma continua, gota a gota.\n\n"
    + "Desde cada riñón, la orina baja por un conducto llamado uréter hasta la vejiga, que actúa "
    + "como un depósito elástico y se va llenando poco a poco.\n\n"
    + "Cuando la vejiga alcanza cierto volumen aparece la sensación de ganas de orinar. Al vaciarla, "
    + "la orina sale por la uretra.",
  lamina: lamina.lamina,
  referencias: refs.referencias ?? []
};

await writeFile(new URL("../work/correo-muestra.html", import.meta.url), plantillaMediSmart(datos));
console.log("escrito work/correo-muestra.html");
console.log("lámina:", datos.lamina?.titulo ?? "(ninguna)");
console.log("referencias:", datos.referencias.length);
console.log("\n--- versión en texto plano ---\n" + versionTexto(datos).slice(0, 400));
