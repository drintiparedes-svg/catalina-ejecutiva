import { escenario, informar } from "./qa-banco.mjs";
const r = [];

// El lector decide por el CONTENIDO, no por la extensión. Antes una lista
// blanca corta rechazaba ocho de cada dieciocho archivos reales —un .sql, un
// .py, un .yaml, uno sin extensión— con «no se reconoce este formato», aunque
// fueran texto plano que el navegador lee sin esfuerzo.
r.push(await escenario("Se lee cualquier archivo que tenga texto dentro", `
  const { leerDocumento } = await import("/reunion.js");
  const F = (nombre, contenido, tipo) => new File([contenido], nombre, tipo ? { type: tipo } : {});

  // Todos éstos son texto y todos tienen que leerse, diga lo que diga el nombre.
  const texto = [
    ["consulta.sql", "select * from pacientes;"],
    ["analisis.py", "import pandas as pd"],
    ["pagina.html", "<h1>Resultados</h1>"],
    ["datos.xml", "<caso><id>1</id></caso>"],
    ["registro.log", "2026-09-08 error de conexión"],
    ["config.yaml", "servicio: oncología"],
    ["protocolo.tex", "\\\\section{Método}"],
    ["sin-extension", "Acta de la sesión del comité"],
    ["NOTAS", "quedamos en revisar el lunes"],
    ["datos.tsv", "a\\tb\\n1\\t2"],
    ["informe.markdown", "## Conclusiones"]
  ];
  const fallan = [];
  for (const [nombre, contenido] of texto) {
    const l = await leerDocumento(F(nombre, contenido));
    if (!l.texto) fallan.push(nombre + " → " + (l.aviso || "sin texto"));
  }
  anotar("Los once formatos de texto se leen, con o sin extensión conocida", fallan.length === 0, fallan.join(" | "));

  // La extensión y el tamaño se informan bien, que era la otra queja.
  const uno = await leerDocumento(F("consulta.sql", "select 1;"));
  anotar("Se informa la extensión", uno.extension === "sql", JSON.stringify(uno.extension));
  anotar("Y el tamaño real del archivo", uno.tamano === 9, String(uno.tamano));
  const sinExt = await leerDocumento(F("NOTAS", "hola"));
  anotar("Un archivo sin extensión no se inventa una", sinExt.extension === "" && sinExt.texto === "hola", JSON.stringify(sinExt.extension));

  // Se decide por los bytes: un binario disfrazado de .txt no se cuela.
  const binario = new Uint8Array([0, 1, 2, 3, 0, 255, 0, 7, 0, 3, 0, 200]);
  const falso = await leerDocumento(new File([binario], "disfrazado.txt", { type: "text/plain" }));
  anotar("Un binario con nombre de .txt NO se lee como texto",
    !falso.texto && /no es texto/i.test(falso.aviso), falso.aviso);

  // Y un formato conocido se reconoce aunque le cambien el nombre.
  const pdf = await leerDocumento(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "cualquiera.dat"));
  anotar("Un PDF renombrado se reconoce por sus bytes, no por el nombre",
    /PDF|capa de texto/i.test(pdf.aviso || ""), pdf.aviso);
  const png = await leerDocumento(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10])], "captura.bin"));
  anotar("Una imagen renombrada también, y se marca para mirarla",
    png.imagen === true, JSON.stringify({ imagen: png.imagen, aviso: png.aviso }));

  // Los avisos que quedan dicen qué hacer, no sólo que no se pudo.
  const zip = await leerDocumento(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])], "carpeta.zip"));
  anotar("De un comprimido se dice qué hacer con él", /Descomprímelo/.test(zip.aviso), zip.aviso);
  const vacio = await leerDocumento(F("vacio.txt", ""));
  anotar("Un archivo vacío se dice que está vacío", /vacío/.test(vacio.aviso), vacio.aviso);
`));

r.push(await escenario("Un documento grande entra entero, no recortado a 40.000", `
  const { anadirDocumento, listarDocumentos } = await import("/adjuntos.js");
  const grande = "Punto del acta número X. ".repeat(12000);   // ~300.000 caracteres
  const r = await anadirDocumento(new File([grande], "acta-larga.txt", { type: "text/plain" }));
  anotar("Se lee un documento de 300.000 caracteres", r.ok === true, JSON.stringify(r.error || ""));
  anotar("Y se guarda entero, no recortado al tope de una reunión",
    r.documento.caracteres > 250000, r.documento.caracteres + " caracteres");
  // En bytes, no en caracteres: «número» ocupa más de un byte y es correcto que
  // el tamaño lo refleje, porque es lo que pesa el archivo.
  const enBytes = new Blob([grande]).size;
  anotar("La ficha informa el tamaño real en bytes",
    listarDocumentos()[0].tamano === enBytes, listarDocumentos()[0].tamano + " de " + enBytes);

  // Pero un archivo absurdo se para antes de colgar la pestaña.
  const enorme = new File([new Uint8Array(1024)], "enorme.bin");
  Object.defineProperty(enorme, "size", { value: 200 * 1024 * 1024 });
  const no = await anadirDocumento(enorme);
  anotar("Un archivo de 200 MB se rechaza con el motivo y el tope",
    no.ok === false && /200\\.0 MB/.test(no.error) && /80\\.0 MB/.test(no.error), no.error);
`));

process.exit(informar(r) ? 1 : 0);
