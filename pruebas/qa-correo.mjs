// La puerta del correo, en el SERVIDOR.
//
// Que el navegador pida confirmación dos veces está bien, pero no es una
// garantía: el navegador es de quien lo abre. Lo que de verdad impide que la
// reunión salga a un tercero por accidente —o porque a alguien se le ocurrió
// llamar a la ruta a mano— es que el servidor se niegue. Eso es lo que se
// prueba aquí.
const BASE = process.env.QA_BASE || "http://127.0.0.1:8124";

const paso = [];
const anotar = (n, ok, d = "") => paso.push({ n, ok: Boolean(ok), d: String(d) });

const pedir = async cuerpo => {
  const r = await fetch(`${BASE}/reunion/correo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo)
  });
  return { estado: r.status, datos: await r.json().catch(() => ({})) };
};

const completo = {
  destinatario: "tercero@ejemplo.cl",
  asunto: "Minuta del comité",
  cuerpo: "Adjunto la minuta y la transcripción.",
  adjuntos: [{ nombre: "Minuta.pdf", base64: "JVBERi0=" }]
};

// ── Sin confirmar, de todas las formas en que alguien podría intentarlo ─────
for (const [como, campo] of [
  ["sin el campo", {}],
  ["con confirmado en false", { confirmado: false }],
  ["con confirmado como texto «true»", { confirmado: "true" }],
  ["con confirmado como 1", { confirmado: 1 }],
  ["con confirmado nulo", { confirmado: null }]
]) {
  const { estado, datos } = await pedir({ ...completo, ...campo });
  anotar(`Se niega a enviar ${como}`, estado === 400 && datos.code === "CORREO_SIN_CONFIRMAR",
    `${estado} ${datos.code || ""} ${datos.error || ""}`);
}

// ── Confirmado pero mal formado: tampoco sale ──────────────────────────────
let r = await pedir({ ...completo, confirmado: true, destinatario: "esto no es un correo" });
anotar("Con un destinatario que no es una dirección, no sale", r.estado === 400 && r.datos.code === "CORREO_SIN_DESTINO", `${r.estado} ${r.datos.code}`);

r = await pedir({ ...completo, confirmado: true, destinatario: "" });
anotar("Sin destinatario, no sale", r.estado === 400 && r.datos.code === "CORREO_SIN_DESTINO", `${r.estado} ${r.datos.code}`);

r = await pedir({ ...completo, confirmado: true, destinatario: "uno@ejemplo.cl, esto-no" });
anotar("Si UNO de varios destinatarios es inválido, no sale para ninguno",
  r.estado === 400 && r.datos.code === "CORREO_SIN_DESTINO", `${r.estado} ${r.datos.code}`);

r = await pedir({ ...completo, confirmado: true, cuerpo: "   " });
anotar("Con el mensaje vacío, no sale", r.estado === 400 && r.datos.code === "CORREO_INCOMPLETO", `${r.estado} ${r.datos.code}`);

// ── Y confirmado y bien formado: sí llega a intentarlo ─────────────────────
r = await pedir({ ...completo, confirmado: true });
anotar("Confirmado y bien formado, sí pasa la puerta y llega a intentar el envío",
  r.datos.code !== "CORREO_SIN_CONFIRMAR" && r.datos.code !== "CORREO_SIN_DESTINO" && r.datos.code !== "CORREO_INCOMPLETO",
  `${r.estado} ${r.datos.code || "ok"} — ${String(r.datos.error || "").slice(0, 60)}`);

let mal = 0;
for (const p of paso) { if (!p.ok) mal += 1; console.log(`${p.ok ? "ok   " : "FALLA"} ${p.n}${p.ok ? "" : "\n        → " + p.d}`); }
console.log(mal ? `\n✗ ${mal} de ${paso.length}` : `\n✓ las ${paso.length} comprobaciones del correo pasan`);
process.exit(mal ? 1 : 0);
