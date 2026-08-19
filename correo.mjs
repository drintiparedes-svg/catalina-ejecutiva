// Plantilla MediSmart y envío del resumen por correo.
//
// El diseño mezcla dos referencias a propósito: la calma de Apple Health —fondo
// claro, tarjetas redondeadas, mucho aire, tipografía del sistema— con la
// seriedad de McKinsey: azul profundo, jerarquía marcada y nada decorativo.
// Es un documento clínico, así que la contención vale más que el adorno.
//
// El HTML va con tablas y estilos en línea porque los clientes de correo no
// entienden CSS moderno: sin esto, Gmail y Outlook desarman la maqueta.

const TINTA = "#051C2C";      // azul profundo, para títulos y cabecera
const ACENTO = "#0071E3";     // azul de sistema, para enlaces y detalles
const PAPEL = "#FFFFFF";
const TARJETA = "#F5F5F7";    // gris de Apple, para bloques secundarios
const TEXTO = "#1D1D1F";
const TENUE = "#6E6E73";
const TIPO = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapar = texto => String(texto ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Los saltos de línea del dictado se convierten en párrafos: un muro de texto
// corrido es justo lo que este formato quiere evitar.
function parrafos(texto) {
  return String(texto ?? "")
    .split(/\n{2,}|\n/)
    .map(linea => linea.trim())
    .filter(Boolean)
    .map(linea =>
      `<p style="margin:0 0 14px;font-size:16px;line-height:1.62;color:${TEXTO}">${escapar(linea)}</p>`)
    .join("");
}

export function plantillaMediSmart({ titulo, resumen, lamina, referencias = [] }) {
  const fecha = new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });

  const bloqueLamina = lamina ? `
    <tr><td style="padding:0 32px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:${TARJETA};border-radius:14px">
        <tr><td style="padding:18px">
          <!-- El alto se acota además aquí: la miniatura ya viene limitada,
               pero si algún día llega una lámina sin recortar, el correo no se
               convierte en una columna interminable. -->
          <img src="${escapar(lamina.imagen)}" alt="${escapar(lamina.titulo)}"
               style="display:block;margin:0 auto;max-width:100%;max-height:420px;width:auto;height:auto;border-radius:8px;background:${PAPEL}">
          <p style="margin:14px 0 0;font-size:14px;line-height:1.5;color:${TEXTO};font-weight:600">
            ${escapar(lamina.titulo)}</p>
          <p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:${TENUE}">
            ${escapar(lamina.autor)} · ${escapar(lamina.licencia)}
            ${lamina.fuente ? ` · <a href="${escapar(lamina.fuente)}" style="color:${ACENTO};text-decoration:none">ver ficha</a>` : ""}
          </p>
        </td></tr>
      </table>
    </td></tr>` : "";

  const bloqueReferencias = referencias.length ? `
    <tr><td style="padding:22px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.09em;
                text-transform:uppercase;color:${TENUE}">Referencias</p>
      ${referencias.map((r, i) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin-bottom:12px">
          <tr>
            <td width="26" valign="top"
                style="font-size:14px;line-height:1.5;color:${ACENTO};font-weight:600">${i + 1}.</td>
            <td valign="top">
              <a href="${escapar(r.enlace)}"
                 style="font-size:14px;line-height:1.5;color:${TINTA};text-decoration:none;font-weight:500">
                ${escapar(r.titulo)}</a>
              <div style="margin-top:2px;font-size:12px;line-height:1.5;color:${TENUE}">
                ${escapar([r.autores, r.revista, r.anio].filter(Boolean).join(" · "))}</div>
            </td>
          </tr>
        </table>`).join("")}
    </td></tr>` : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapar(titulo)}</title></head>
<body style="margin:0;padding:0;background:${TARJETA};font-family:${TIPO}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${TARJETA};padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:${PAPEL};border-radius:18px;overflow:hidden">

      <tr><td style="background:${TINTA};padding:22px 32px">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.01em;color:${PAPEL}">MediSmart</div>
        <div style="margin-top:3px;font-size:12px;color:rgba(255,255,255,.62)">Resumen clínico · ${escapar(fecha)}</div>
      </td></tr>

      <tr><td style="padding:30px 32px 6px">
        <h1 style="margin:0 0 16px;font-size:25px;line-height:1.24;font-weight:600;
                   letter-spacing:-.02em;color:${TINTA}">${escapar(titulo)}</h1>
        ${parrafos(resumen)}
      </td></tr>

      ${bloqueLamina}
      ${bloqueReferencias}

      <tr><td style="padding:26px 32px 30px">
        <div style="border-top:1px solid #E5E5EA;padding-top:16px">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${TENUE}">
            Material educativo preparado por <strong style="color:${TEXTO}">Catalina</strong>,
            asistente clínica artificial del equipo del Dr. Inti Paredes.
            No sustituye la evaluación de un profesional ni constituye un diagnóstico.
          </p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// Versión en texto plano. No es un detalle menor: sin ella algunos filtros
// tratan el mensaje como sospechoso, y quien lee en un cliente sin HTML se
// queda sin nada.
export function versionTexto({ titulo, resumen, lamina, referencias = [] }) {
  const partes = [titulo, "", String(resumen ?? "").trim()];
  if (lamina) {
    partes.push("", `Lámina: ${lamina.titulo} (${lamina.autor} · ${lamina.licencia})`);
    if (lamina.fuente) partes.push(lamina.fuente);
  }
  if (referencias.length) {
    partes.push("", "Referencias:");
    referencias.forEach((r, i) => {
      partes.push(`${i + 1}. ${r.titulo} — ${[r.autores, r.revista, r.anio].filter(Boolean).join(", ")}`);
      partes.push(`   ${r.enlace}`);
    });
  }
  partes.push("", "Material educativo preparado por Catalina, asistente clínica artificial",
    "del equipo del Dr. Inti Paredes. No sustituye la evaluación de un profesional.");
  return partes.join("\n");
}

// Envío por Resend: una llamada HTTPS, sin dependencias que instalar.
export async function enviarPorResend({ apiKey, remitente, destinatario, asunto, html, texto }) {
  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: remitente, to: [destinatario], subject: asunto, html, text: texto }),
    signal: AbortSignal.timeout(15000)
  });

  const cuerpo = await upstream.text();
  if (!upstream.ok) {
    let detalle = "";
    try { detalle = JSON.parse(cuerpo).message || ""; } catch {}
    return { ok: false, estado: upstream.status, error: detalle || `Resend respondió ${upstream.status}` };
  }
  let id = "";
  try { id = JSON.parse(cuerpo).id || ""; } catch {}
  return { ok: true, id };
}
