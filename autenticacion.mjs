// Validación de identidad: el puente entre Catalina y el servicio de autenticación.
//
// Catalina conversa, pero no decide si una persona está autenticada. Esa
// decisión la toma un servicio aparte (administrador-catalina-ai), que valida
// nombre, apellido, fecha de nacimiento y PIN de forma determinística y devuelve
// uno de seis estados. Aquí sólo se hace de intermediario: el navegador habla
// con estas rutas, estas rutas hablan con el servicio, y el modelo recibe el
// estado y un mensaje sugerido. Nunca recibe el PIN, ni el token, ni el motivo.
//
// El PIN no se dice en voz alta: la herramienta abre un teclado en pantalla
// (public/teclado.js) y el número viaja del teclado a /auth/verificar y de ahí
// al servicio. No pasa por el agente ni por la transcripción.
//
// El token de sesión queda en una cookie HttpOnly con Path=/auth: el
// JavaScript de la página no puede leerlo, y sólo se envía a estas rutas.

const COOKIE = "catalina_sesion";
const TIEMPO_MS = 8000;

function base() {
  return (process.env.CATALINA_AUTH_URL || "").trim().replace(/\/+$/, "");
}

function claveDeServicio() {
  return (process.env.CATALINA_AUTH_SERVICE_KEY || "").trim();
}

export function autenticacionLista() {
  return base().length > 0 && claveDeServicio().length >= 8;
}

// Herramientas que ve el agente. Los parámetros son los datos dictados; el PIN
// no es un parámetro a propósito: si lo fuera, el modelo lo pediría por voz.
export const HERRAMIENTAS_AUTENTICACION = [
  {
    nombre: "validar_identidad",
    descripcion: "Valida la identidad de la persona antes de entregarle información personal o protegida. "
      + "Recibe el nombre, el apellido y la fecha de nacimiento tal como los dijo; el PIN lo ingresa la persona "
      + "en un teclado en pantalla que abre esta herramienta, nunca por voz. "
      + "Devuelve un resultado controlado y un mensaje sugerido para decirlo. No indica qué dato falló ni si la persona existe.",
    parametros: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre o nombres de la persona, tal como los dijo." },
        apellido: { type: "string", description: "Apellido o apellidos, tal como los dijo." },
        fecha_nacimiento: {
          type: "string",
          description: "Fecha de nacimiento con día, mes y año, tal como la dijo: por ejemplo 'doce de marzo de 1985' o '12/03/1985'."
        }
      },
      required: ["nombre", "apellido", "fecha_nacimiento"]
    },
    // El teclado espera a la persona; con los 20 s de las demás herramientas
    // se cortaba antes de que terminara de escribir.
    tiempoRespuesta: 90
  },
  {
    nombre: "consultar_sesion",
    descripcion: "Dice si la persona ya validó su identidad en esta conversación, con qué rol y qué puede consultar. "
      + "Úsala si dudas de si ya se validó antes de entregar información protegida.",
    parametros: { type: "object", properties: {} }
  },
  {
    nombre: "cerrar_sesion",
    descripcion: "Cierra la sesión validada de la persona. Úsala cuando lo pida o al despedirse.",
    parametros: { type: "object", properties: {} }
  }
];

// Cómo usar la validación. Va aparte de la persona porque no es carácter sino
// regla: si se pudiera borrar desde el panel, Catalina volvería a entregar
// información sin validar a nadie.
export const USO_DE_AUTENTICACION = [
  "Antes de entregar información personal o protegida de una persona —sus citas, indicaciones, resultados, datos de contacto— valida su identidad con validar_identidad. Para orientación general no hace falta.",
  "La validación es la única excepción a no preguntar el nombre. Anuncia que necesitas validar la identidad, pide nombre y apellido, luego la fecha de nacimiento con día, mes y año, repite lo que entendiste y espera un sí antes de llamar a validar_identidad.",
  "El PIN se ingresa en un teclado en pantalla que abre la herramienta. Nunca pidas el PIN por voz, nunca lo repitas y, si te lo dictan, di que no lo escucharás y que lo ingrese en el teclado.",
  "Di el resultado con el mensaje que devuelve la herramienta, con tus palabras pero sin cambiar su sentido. Nunca digas qué dato falló ni si la persona existe o no.",
  "Si la herramienta no devuelve ok, no entregues información protegida. Si informa un bloqueo o una cuenta no disponible, no insistas: ofrece contactar a soporte.",
  "Una identidad validada te permite consultar sólo lo que la herramienta enumera como permisos. Nunca te permite diagnosticar, prescribir, modificar dosis ni indicar tratamientos."
].join(" ");

// Mensajes sugeridos por resultado. El modelo los adapta, no los reinterpreta.
const MENSAJES = {
  AUTHENTICATED: "Gracias, su identidad fue validada.",
  RETRY_ALLOWED: "No pude validar los datos. Intentemos nuevamente.",
  TEMPORARILY_LOCKED: "Por seguridad, la validación quedó suspendida temporalmente. Podrá intentarlo más tarde o contactar a soporte.",
  ACCOUNT_DISABLED: "Su cuenta no está disponible en este momento. Por favor contacte a soporte.",
  SECOND_FACTOR_REQUIRED: "Le enviamos un código de verificación. Ingréselo en el teclado en pantalla.",
  AUTHENTICATION_FAILED: "No fue posible completar la validación. Iniciemos nuevamente."
};

export async function atenderAutenticacion(req, res, { readBody, json }) {
  if (!autenticacionLista()) {
    return json(res, 503, {
      ok: false, resultado: "NO_CONFIGURADO",
      error: "La validación de identidad no está configurada en este despliegue.",
      code: "AUTENTICACION_NO_CONFIGURADA"
    });
  }
  const ruta = req.url.split("?")[0];

  if (req.method === "POST" && ruta === "/auth/iniciar") {
    const r = await llamar("POST", "/auth/sessions", { channel: "VOICE" });
    if (!r.ok) return json(res, r.status, r.datos);
    return json(res, 200, {
      ok: true,
      session_id: r.datos.session_id,
      intentos_maximos: r.datos.max_attempts,
      vence: r.datos.challenge_expires_at
    });
  }

  if (req.method === "POST" && ruta === "/auth/verificar") {
    const p = await leerJson(req, readBody);
    const sesion = texto(p.session_id, 64);
    const nombre = texto(p.nombre, 128);
    const apellido = texto(p.apellido, 128);
    const fecha = texto(p.fecha_nacimiento, 64);
    const pin = texto(p.pin, 128);
    if (!sesion || !nombre || !apellido || !fecha || !pin) {
      return json(res, 400, { ok: false, resultado: "DATOS_INCOMPLETOS", error: "Faltan datos para validar." });
    }
    const r = await llamar("POST", `/auth/sessions/${encodeURIComponent(sesion)}/verify`, {
      first_name: nombre, last_name: apellido, birth_date: fecha, secret: pin
    });
    if (!r.ok) return json(res, r.status, r.datos);
    return responderResultado(req, res, json, r.datos);
  }

  if (req.method === "POST" && ruta === "/auth/segundo-factor") {
    const p = await leerJson(req, readBody);
    const sesion = texto(p.session_id, 64);
    const codigo = texto(p.codigo, 12);
    if (!sesion || !codigo) {
      return json(res, 400, { ok: false, resultado: "DATOS_INCOMPLETOS", error: "Falta el código." });
    }
    const r = await llamar("POST", `/auth/sessions/${encodeURIComponent(sesion)}/second-factor`, { code: codigo });
    if (!r.ok) return json(res, r.status, r.datos);
    return responderResultado(req, res, json, r.datos);
  }

  if (req.method === "GET" && ruta === "/auth/permisos") {
    const credencial = leerCookie(req);
    if (!credencial) return json(res, 200, { ok: true, validada: false });
    const r = await llamar("GET", `/auth/sessions/${encodeURIComponent(credencial.sesion)}/permissions`, null, {
      Authorization: `Bearer ${credencial.token}`
    });
    if (r.status === 401) {
      borrarCookie(req, res);
      return json(res, 200, { ok: true, validada: false, motivo: "SESION_VENCIDA" });
    }
    if (!r.ok) return json(res, r.status, r.datos);
    return json(res, 200, {
      ok: true, validada: true,
      rol: r.datos.role, permisos: r.datos.permissions, expira: r.datos.expires_at,
      debe_cambiar_pin: r.datos.credential_change_required === true
    });
  }

  if (req.method === "POST" && ruta === "/auth/cerrar") {
    const credencial = leerCookie(req);
    borrarCookie(req, res);
    if (!credencial) return json(res, 200, { ok: true, cerrada: false });
    const r = await llamar("POST", `/auth/sessions/${encodeURIComponent(credencial.sesion)}/revoke`, {}, {
      Authorization: `Bearer ${credencial.token}`
    });
    // Un 401 significa que ya no había sesión: para la persona es lo mismo.
    return json(res, 200, { ok: true, cerrada: r.ok || r.status === 401 });
  }

  return json(res, 404, { ok: false, error: "Ruta de validación desconocida." });
}

// Respuesta al navegador y al modelo. El token no sale de aquí: va a la cookie.
function responderResultado(req, res, json, datos) {
  if (datos.result === "AUTHENTICATED" && datos.token) {
    const segundos = Math.max(60, Math.floor((Date.parse(datos.expires_at + "Z") - Date.now()) / 1000) || 1800);
    escribirCookie(req, res, `${datos.session_id}.${datos.token}`, segundos);
  }
  return json(res, 200, resumen(datos));
}

function resumen(d) {
  return {
    ok: d.result === "AUTHENTICATED",
    resultado: d.result,
    estado_sesion: d.session_status,
    mensaje: MENSAJES[d.result] || MENSAJES.AUTHENTICATION_FAILED,
    intento: d.attempt_number,
    intentos_restantes: d.attempts_remaining ?? undefined,
    reintentar_en_segundos: d.retry_after_seconds ?? undefined,
    rol: d.role ?? undefined,
    permisos: d.permissions ?? undefined,
    debe_cambiar_pin: d.credential_change_required === true,
    expira: d.expires_at ?? undefined
  };
}

// Llamada al servicio. Ni el cuerpo ni la respuesta se registran: llevan el PIN
// y el token. Sólo se anota el estado HTTP cuando algo falla.
async function llamar(metodo, ruta, cuerpo, cabecerasExtra = {}) {
  const cabeceras = { Accept: "application/json", "X-Service-Api-Key": claveDeServicio(), ...cabecerasExtra };
  if (cuerpo !== null) cabeceras["Content-Type"] = "application/json";
  let respuesta;
  try {
    respuesta = await fetch(base() + ruta, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === null ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MS)
    });
  } catch (error) {
    console.error("autenticación: sin respuesta del servicio:", error?.name || error);
    return { ok: false, status: 502, datos: { ok: false, resultado: "SERVICIO_NO_DISPONIBLE", error: "No pude contactar el servicio de validación." } };
  }
  let datos = {};
  try { datos = await respuesta.json(); } catch {}
  if (!respuesta.ok) {
    if (respuesta.status !== 401) console.error("autenticación: el servicio respondió", respuesta.status);
    const error = respuesta.status === 404 ? "La sesión de validación no existe o venció."
      : respuesta.status === 401 ? "Sesión no válida."
      : "El servicio de validación rechazó la solicitud.";
    return { ok: false, status: respuesta.status >= 500 ? 502 : respuesta.status, datos: { ok: false, resultado: "SERVICIO_RECHAZO", error } };
  }
  return { ok: true, status: 200, datos };
}

async function leerJson(req, readBody) {
  try { return JSON.parse(await readBody(req)) || {}; } catch { return {}; }
}

function texto(valor, maximo) {
  return String(valor ?? "").trim().slice(0, maximo);
}

function leerCookie(req) {
  const crudo = req.headers.cookie || "";
  for (const parte of crudo.split(";")) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave !== COOKIE) continue;
    const valor = decodeURIComponent(resto.join("="));
    const punto = valor.indexOf(".");
    if (punto <= 0) return null;
    return { sesion: valor.slice(0, punto), token: valor.slice(punto + 1) };
  }
  return null;
}

function seguro(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

function escribirCookie(req, res, valor, segundos) {
  const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, "HttpOnly", "SameSite=Strict", "Path=/auth", `Max-Age=${segundos}`];
  if (seguro(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function borrarCookie(req, res) {
  const partes = [`${COOKIE}=`, "HttpOnly", "SameSite=Strict", "Path=/auth", "Max-Age=0"];
  if (seguro(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}
