// Guardado en Google Drive.
//
// Guardar la reunión en la carpeta de siempre es reversible y de bajo riesgo, así
// que pasa sin preguntar. Mandarla por correo a un tercero no lo es, y eso se
// confirma antes (vive en app.mjs, no aquí).
//
// La autorización es por refresh token del propio usuario, no por cuenta de
// servicio: una cuenta de servicio no tiene espacio propio en Drive y los
// archivos que sube a una carpeta compartida fallan por cuota. Con el refresh
// token los archivos quedan a nombre de la persona, que es lo que se quiere.
//
// El permiso que se pide es `drive.file`: acceso sólo a lo que esta aplicación
// crea. No puede leer el resto del Drive, y eso es deliberado.
//
// El permiso de la cuenta puede venir de dos sitios: de las variables de entorno
// del despliegue, o del propio navegador de quien lo autorizó. Lo segundo es lo
// normal y es lo que hace que conectar el Drive sea pulsar un botón: sin ello
// había que copiar el permiso a mano en Vercel y volver a desplegar, que es
// mucho pedirle a alguien por guardar una minuta.

const CONSENTIMIENTO = "https://accounts.google.com/o/oauth2/v2/auth";
const CANJE = "https://oauth2.googleapis.com/token";
const SUBIDA = "https://www.googleapis.com/upload/drive/v3/files";
const ARCHIVOS = "https://www.googleapis.com/drive/v3/files";
export const PERMISO = "https://www.googleapis.com/auth/drive.file";

const TIEMPO = 30_000;

const cliente = () => process.env.GOOGLE_CLIENT_ID?.trim() || "";
const secreto = () => process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
const refresco = () => process.env.GOOGLE_REFRESH_TOKEN?.trim() || "";
const carpetaFijada = () => process.env.GOOGLE_DRIVE_CARPETA?.trim() || "";

// La aplicación está lista para que alguien conecte su cuenta.
export const clienteConfigurado = () => Boolean(cliente() && secreto());
// Y además hay una cuenta conectada, sea por el navegador o por el despliegue.
export const driveConfigurado = (permiso = "") => Boolean(clienteConfigurado() && (permiso || refresco()));

// El token de acceso dura una hora. Se guarda mientras la instancia siga
// caliente para no pedir uno nuevo en cada reunión; si la función se recicla se
// pide otro, que es barato. Se guarda POR permiso: dos cuentas distintas no
// pueden compartir el mismo token de acceso.
const accesos = new Map();

async function tokenDeAcceso(permiso = "") {
  const elPermiso = String(permiso || "").trim() || refresco();
  if (!clienteConfigurado()) {
    return { ok: false, code: "SIN_CLIENTE", error: "Falta configurar la aplicación de Google en el despliegue." };
  }
  if (!elPermiso) {
    return { ok: false, code: "SIN_CUENTA", error: "No hay ninguna cuenta de Google conectada." };
  }

  const guardado = accesos.get(elPermiso);
  if (guardado && Date.now() < guardado.expira - 60_000) return { ok: true, token: guardado.token };

  let datos;
  try {
    const upstream = await fetch(CANJE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cliente(),
        client_secret: secreto(),
        refresh_token: elPermiso,
        grant_type: "refresh_token"
      }),
      signal: AbortSignal.timeout(TIEMPO)
    });
    datos = JSON.parse(await upstream.text());
    if (!upstream.ok) {
      // `invalid_grant` es el caso que hay que saber leer: el permiso fue
      // revocado o caducó, y no se arregla reintentando sino volviendo a
      // autorizar en /reunion.html.
      const revocado = datos?.error === "invalid_grant";
      return {
        ok: false,
        code: revocado ? "PERMISO_REVOCADO" : "RECHAZADO",
        error: revocado
          // Ocurre solo si la app sigue en «Prueba»: ahí Google caduca el
          // permiso a los siete días. Se dice, porque el arreglo no es volver a
          // conectar cada semana sino publicar la app.
          ? "Google revocó el permiso. Vuelve a conectar la cuenta; si se repite cada semana, publica la aplicación en Google Cloud (Testing caduca los permisos a los 7 días)."
          : `Google rechazó las credenciales (${datos?.error || upstream.status}).`
      };
    }
  } catch (error) {
    return {
      ok: false,
      code: error.name === "TimeoutError" ? "TIEMPO" : "SIN_RED",
      error: "No se pudo hablar con Google para renovar el acceso."
    };
  }

  const nuevo = { token: datos.access_token, expira: Date.now() + (datos.expires_in ?? 3600) * 1000 };
  accesos.set(elPermiso, nuevo);
  return { ok: true, token: nuevo.token };
}

// De quién es la cuenta conectada. Se enseña en la pantalla para que nadie
// tenga que fiarse de que conectó la que creía.
async function cuentaDe(token) {
  try {
    const r = await fetch(`${ARCHIVOS.replace("/files", "/about")}?fields=user(displayName,emailAddress)`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIEMPO)
    });
    if (!r.ok) return null;
    return (await r.json())?.user || null;
  } catch { return null; }
}

// Carpeta creada por la propia aplicación, para cuando la configurada no está o
// no es alcanzable con este permiso. Se recuerda en memoria y se devuelve su
// identificador para que se pueda fijar en las variables de entorno.
let carpetaPropia = "";

async function carpetaDeRespaldo(token) {
  if (carpetaPropia) return carpetaPropia;
  const nombre = "Catalina — Reuniones";

  // Puede existir ya de una ejecución anterior: se busca antes de crear otra.
  try {
    const consulta = new URLSearchParams({
      q: `name='${nombre.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
      pageSize: "1"
    });
    const buscar = await fetch(`${ARCHIVOS}?${consulta}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIEMPO)
    });
    const encontrado = (await buscar.json())?.files?.[0]?.id;
    if (encontrado) { carpetaPropia = encontrado; return carpetaPropia; }
  } catch { /* si la búsqueda falla se crea una y ya */ }

  const crear = await fetch(`${ARCHIVOS}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombre, mimeType: "application/vnd.google-apps.folder" }),
    signal: AbortSignal.timeout(TIEMPO)
  });
  if (!crear.ok) return "";
  carpetaPropia = (await crear.json())?.id || "";
  return carpetaPropia;
}

async function subir({ token, nombre, tipo, contenido, carpeta }) {
  const limite = `catalina${Math.random().toString(36).slice(2)}`;
  const meta = { name: nombre, ...(carpeta ? { parents: [carpeta] } : {}) };
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`, "utf8"),
    Buffer.from(`--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`, "utf8"),
    contenido,
    Buffer.from(`\r\n--${limite}--\r\n`, "utf8")
  ]);

  // Todo el trato con la red va dentro del try. Un fallo aquí NO puede tumbar el
  // cierre: los dos documentos ya están generados y se pueden descargar; que
  // Drive esté caído es una molestia, perder la reunión por ello es un desastre.
  let upstream;
  let texto;
  try {
    upstream = await fetch(`${SUBIDA}?uploadType=multipart&fields=id,name,webViewLink`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${limite}`,
        "Content-Length": String(cuerpo.length)
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIEMPO * 2)
    });
    texto = await upstream.text();
  } catch (error) {
    return {
      ok: false,
      error: error?.name === "TimeoutError"
        ? "La subida a Drive tardó demasiado."
        : "No se pudo llegar a Drive para subir el archivo."
    };
  }

  if (!upstream.ok) {
    let detalle = "";
    try { detalle = JSON.parse(texto)?.error?.message || ""; } catch {}
    return { ok: false, estado: upstream.status, error: detalle || `Drive respondió ${upstream.status}.` };
  }
  try {
    const datos = JSON.parse(texto);
    return { ok: true, id: datos.id, nombre: datos.name, enlace: datos.webViewLink || "" };
  } catch {
    return { ok: false, error: "Drive respondió algo que no se pudo leer." };
  }
}

// Sube varios archivos a la carpeta configurada. Si esa carpeta no es alcanzable
// —no existe, o la creó otra cuenta y este permiso no llega— NO se pierde el
// archivo: se guarda en una carpeta propia y se dice dónde quedó.
export async function guardarEnDrive(archivos, carpetaElegida = "", permiso = "") {
  const credencial = await tokenDeAcceso(permiso);
  if (!credencial.ok) return { ok: false, ...credencial, archivos: [] };

  // La que se eligió en la pantalla manda sobre la de las variables de entorno:
  // cambiar de carpeta no debería exigir volver a desplegar.
  let carpeta = String(carpetaElegida || "").trim() || carpetaFijada();
  let aviso = "";
  const guardados = [];

  for (const archivo of archivos) {
    let resultado = await subir({ token: credencial.token, carpeta, ...archivo });

    if (!resultado.ok && carpeta && [403, 404].includes(resultado.estado)) {
      const respaldo = await carpetaDeRespaldo(credencial.token);
      if (respaldo) {
        aviso = "La carpeta configurada no es accesible con este permiso; los archivos quedaron en "
          + `«Catalina — Reuniones» (identificador ${respaldo}).`;
        carpeta = respaldo;
        resultado = await subir({ token: credencial.token, carpeta, ...archivo });
      }
    }

    guardados.push({ nombre: archivo.nombre, ...resultado });
  }

  const todos = guardados.every(g => g.ok);
  return {
    ok: todos,
    aviso,
    carpeta,
    archivos: guardados,
    error: todos ? "" : guardados.find(g => !g.ok)?.error || "No se pudieron guardar los archivos."
  };
}

// ── Puesta a punto ───────────────────────────────────────────────────────────

// Las carpetas que esta aplicación ha creado. Con el permiso mínimo no puede
// ver el resto del Drive —ni debe—, así que la lista son las suyas: basta para
// elegir dónde van las minutas sin tener que copiar identificadores a mano.
export async function carpetasPropias(permiso = "") {
  const credencial = await tokenDeAcceso(permiso);
  if (!credencial.ok) return { ok: false, ...credencial, carpetas: [] };
  try {
    const consulta = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id,name)",
      orderBy: "name",
      pageSize: "50"
    });
    const r = await fetch(`${ARCHIVOS}?${consulta}`, {
      headers: { Authorization: `Bearer ${credencial.token}` },
      signal: AbortSignal.timeout(TIEMPO)
    });
    if (!r.ok) return { ok: false, error: `Drive respondió ${r.status}.`, carpetas: [] };
    return { ok: true, carpetas: (await r.json())?.files ?? [] };
  } catch {
    return { ok: false, error: "No se pudieron leer las carpetas.", carpetas: [] };
  }
}

// Crea una carpeta nueva en el Drive de quien conectó. Es la vía para «quiero
// una carpeta para esto» sin salir de la pantalla ni pegar identificadores.
export async function crearCarpeta(nombre, permiso = "") {
  const credencial = await tokenDeAcceso(permiso);
  if (!credencial.ok) return { ok: false, ...credencial };
  try {
    const r = await fetch(`${ARCHIVOS}?fields=id,name`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credencial.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(nombre).slice(0, 120), mimeType: "application/vnd.google-apps.folder" }),
      signal: AbortSignal.timeout(TIEMPO)
    });
    if (!r.ok) return { ok: false, error: `Drive respondió ${r.status}.` };
    const datos = await r.json();
    return { ok: true, id: datos.id, nombre: datos.name };
  } catch {
    return { ok: false, error: "No se pudo crear la carpeta." };
  }
}

export function urlDeConsentimiento(redireccion) {
  if (!cliente()) return "";
  const parametros = new URLSearchParams({
    client_id: cliente(),
    redirect_uri: redireccion,
    response_type: "code",
    scope: PERMISO,
    // Sin estas dos Google devuelve el permiso una sola vez y las siguientes
    // autorizaciones llegan sin refresh token, que es justo lo que hace falta.
    access_type: "offline",
    prompt: "consent"
  });
  return `${CONSENTIMIENTO}?${parametros}`;
}

export async function canjearCodigo(codigo, redireccion) {
  if (!cliente() || !secreto()) {
    return { ok: false, error: "Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET." };
  }
  try {
    const upstream = await fetch(CANJE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: codigo,
        client_id: cliente(),
        client_secret: secreto(),
        redirect_uri: redireccion,
        grant_type: "authorization_code"
      }),
      signal: AbortSignal.timeout(TIEMPO)
    });
    const datos = JSON.parse(await upstream.text());
    if (!upstream.ok) return { ok: false, error: `Google rechazó el código (${datos?.error || upstream.status}).` };
    if (!datos.refresh_token) {
      return {
        ok: false,
        error: "Google no devolvió un permiso permanente. Quita el acceso anterior en "
          + "myaccount.google.com/permissions y vuelve a autorizar."
      };
    }
    return { ok: true, refresco: datos.refresh_token };
  } catch {
    return { ok: false, error: "No se pudo canjear el código con Google." };
  }
}

// Diagnóstico para la página de puesta a punto. Nunca devuelve las credenciales:
// sólo si están y si Google las acepta.
export async function estadoDrive(permiso = "") {
  const partes = {
    clienteConfigurado: Boolean(cliente()),
    secretoConfigurado: Boolean(secreto()),
    listaParaConectar: clienteConfigurado(),
    // De dónde sale el permiso: del navegador de quien conectó, o del despliegue.
    permisoGuardado: Boolean(permiso || refresco()),
    permisoDelNavegador: Boolean(permiso),
    carpeta: carpetaFijada() ? `${carpetaFijada().slice(0, 6)}…` : ""
  };
  if (!clienteConfigurado()) {
    return { ok: false, code: "SIN_CLIENTE", ...partes, error: "Falta configurar la aplicación de Google en el despliegue." };
  }
  if (!partes.permisoGuardado) {
    return { ok: false, code: "SIN_CUENTA", ...partes, error: "No hay ninguna cuenta de Google conectada." };
  }

  const credencial = await tokenDeAcceso(permiso);
  if (!credencial.ok) return { ok: false, ...partes, code: credencial.code, error: credencial.error };
  partes.cuenta = await cuentaDe(credencial.token);

  // Se comprueba que la carpeta configurada existe de verdad. Descubrirlo aquí
  // evita que la primera reunión termine con los documentos en otro sitio.
  let carpetaAlcanzable = null;
  if (carpetaFijada()) {
    try {
      const ver = await fetch(`${ARCHIVOS}/${encodeURIComponent(carpetaFijada())}?fields=id,name`, {
        headers: { Authorization: `Bearer ${credencial.token}` },
        signal: AbortSignal.timeout(TIEMPO)
      });
      carpetaAlcanzable = ver.ok ? (await ver.json())?.name || true : false;
    } catch { carpetaAlcanzable = false; }
  }

  return {
    ok: true, ...partes, carpetaAlcanzable,
    aviso: carpetaAlcanzable === false
      ? "La carpeta configurada no es accesible con este permiso. Las reuniones se guardarán en «Catalina — Reuniones»."
      : ""
  };
}
