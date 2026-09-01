// Google Drive, con un doble de Google delante: el alta entera —consentimiento,
// canje del código, listado de carpetas, crear una, subir los archivos— sin
// salir a internet. Lo que se comprueba es que la reunión acabe EN LA CARPETA
// QUE SE ELIGIÓ, y que un fallo de Drive no se lleve por delante el cierre.
const BASE = process.env.QA_DRIVE || "http://127.0.0.1:4181";

// Ojo con el nombre del campo: las rutas /drive/* leen `permiso` y
// /reunion/cerrar lee `driveRefresco`. Es el mismo valor con dos nombres, y
// equivocarse devuelve «no hay cuenta conectada» como si no la hubiera.

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });
const post = async (ruta, cuerpo) => {
  const r = await fetch(BASE + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
  return { estado: r.status, datos: await r.json().catch(() => ({})) };
};

// ── Sin cuenta conectada ────────────────────────────────────────────────────
let r = await post("/drive/estado", {});
anotar("Sin cuenta conectada lo dice con un código legible, en vez de fallar", r.estado === 200 && r.datos.code === "SIN_CUENTA",
  `${r.estado} ${JSON.stringify(r.datos).slice(0, 100)}`);

// ── El consentimiento ───────────────────────────────────────────────────────
const auth = await fetch(BASE + "/drive/autorizar", { redirect: "manual" });
const destino = auth.headers.get("location") || "";
anotar("«Conectar» manda al consentimiento de Google", [302, 303, 307].includes(auth.status) && destino.includes("accounts.google.com"),
  `${auth.status} ${destino.slice(0, 70)}`);
anotar("Y pide sólo el permiso de los archivos que la app crea, no todo el Drive",
  destino.includes("drive.file") && !destino.includes("auth%2Fdrive&") && !/scope=[^&]*auth%2Fdrive(?!\.file)/.test(destino),
  (destino.match(/scope=[^&]*/) || [""])[0].slice(0, 90));

// ── El canje del código ─────────────────────────────────────────────────────
const malo = await fetch(`${BASE}/drive/callback?code=codigo-malo`);
const textoMalo = await malo.text();
anotar("Un código inválido no se da por bueno", /no|fall|error|invalid/i.test(textoMalo), textoMalo.slice(0, 90).replace(/\s+/g, " "));

const bueno = await fetch(`${BASE}/drive/callback?code=codigo-bueno`);
const textoBueno = await bueno.text();
const permiso = (textoBueno.match(/permiso-de-inti/) || [])[0];
anotar("Un código bueno devuelve el permiso al navegador", Boolean(permiso), textoBueno.slice(0, 90).replace(/\s+/g, " "));

// ── Con el permiso en la mano ───────────────────────────────────────────────
r = await post("/drive/estado", { permiso: "permiso-de-inti" });
anotar("Con el permiso, dice de quién es la cuenta",
  r.datos.ok === true && /Inti/.test(JSON.stringify(r.datos)), JSON.stringify(r.datos).slice(0, 160));

r = await post("/drive/carpetas", { permiso: "permiso-de-inti" });
const carpetas = r.datos.carpetas || [];
anotar("Lista las carpetas de la cuenta para poder elegir", carpetas.length >= 2, JSON.stringify(carpetas).slice(0, 120));

r = await post("/drive/carpeta", { permiso: "permiso-de-inti", nombre: "Reuniones de dirección" });
anotar("Y deja crear una nueva", r.datos.ok === true && Boolean(r.datos.id), JSON.stringify(r.datos).slice(0, 120));
const nueva = r.datos.id;

// ── El cierre completo, guardando en la carpeta elegida ─────────────────────
const reunion = {
  inicio: Date.now() - 600000, fin: Date.now(), titulo: "Comité en Drive", tipo: "operacional",
  turnos: [{ t: 1, hablante: "Inti", texto: "esto se archiva en la carpeta elegida", origen: "CONVERSACION" }],
  cuaderno: "", documentos: [], intervenciones: [], participantes: ["Inti"]
};
r = await post("/reunion/cerrar", { ...reunion, carpetaDrive: nueva, driveRefresco: "permiso-de-inti" });
anotar("El cierre con Drive responde bien", r.estado === 200 && Boolean(r.datos.archivos), String(r.estado));
// El servidor devuelve un objeto con el resultado de la subida; la lista de
// archivos va dentro. Lo que la app guarda en el historial ya es la lista.
anotar("Drive dice que la subida fue bien", r.datos.drive?.ok === true, JSON.stringify(r.datos.drive).slice(0, 120));
anotar("Y en la carpeta que se eligió, no en la raíz", r.datos.drive?.carpeta === nueva, `${r.datos.drive?.carpeta} vs ${nueva}`);
const subidos = r.datos.drive?.archivos ?? [];
anotar("Sube los dos documentos a Drive", subidos.length === 2, JSON.stringify(subidos.map(a => a.nombre)));
anotar("Y devuelve el enlace de cada uno para poder abrirlos",
  subidos.every(a => String(a.enlace || "").startsWith("https://drive.google.com/")), JSON.stringify(subidos.map(a => a.enlace)));

// ── Drive caído: no puede llevarse por delante el cierre ────────────────────
r = await post("/reunion/cerrar", { ...reunion, carpetaDrive: nueva, driveRefresco: "permiso-que-no-vale" });
anotar("Con un permiso que ya no vale, el cierre NO revienta", r.estado === 200, String(r.estado));
anotar("Los documentos se generan igual", Boolean(r.datos.archivos?.transcripcion?.base64 && r.datos.archivos?.minuta?.base64), "");
anotar("Y se dice que Drive falló, con el motivo",
  (r.datos.avisos || []).some(a => /Drive/i.test(a)) || /./.test(r.datos.drive?.error || ""),
  JSON.stringify({ avisos: r.datos.avisos, error: r.datos.drive?.error }).slice(0, 200));
anotar("La transcripción sobrevive entera dentro del documento",
  Buffer.from(r.datos.archivos.transcripcion.base64, "base64").length > 1000, "");

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones de Drive pasan`);
process.exit(mal ? 1 : 0);
