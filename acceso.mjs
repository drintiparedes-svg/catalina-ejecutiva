// Acceso con usuarios: quién puede usar a Catalina y qué habló cada uno.
//
// Antes cualquiera con la dirección podía abrir la página, arrancar una sesión
// de voz y gastar el crédito de ElevenLabs. Esto lo cierra: cada persona entra
// con un usuario y una contraseña que crea el administrador, y lo que conversa
// queda guardado a su nombre, para retomarlo desde cualquier equipo.
//
// Los usuarios los crea el administrador de Catalina, una aplicación aparte
// que escribe en esta misma base; aquí sólo se comprueban.
//
// Todo vive en una base de datos PostgreSQL. No es un capricho: en Vercel el
// disco es de sólo lectura y cada petición cae en una instancia distinta, así
// que un archivo de usuarios no sobreviviría al siguiente despliegue. La base
// se crea desde el panel de Vercel (Storage → Create Database → Postgres) y
// deja sola las variables de conexión; aquí no hay que teclear ninguna clave.
//
// Lo que NO se guarda nunca: contraseñas en claro (van con scrypt), ni el
// token de sesión (se guarda su SHA-256, así que un volcado de la base no
// sirve para entrar).
//
// Decisiones de seguridad, dichas en una línea cada una:
//   - Usuario o contraseña incorrectos se responden igual: no se confirma si
//     el usuario existe. Y se calcula un hash aunque no exista, para que el
//     tiempo de respuesta tampoco lo delate.
//   - Cinco fallos seguidos bloquean la cuenta quince minutos.
//   - La sesión dura doce horas y caduca antes tras cuatro sin actividad.
//   - La cookie es HttpOnly y SameSite=Lax: el JavaScript no la lee y un
//     formulario de otro sitio no la manda.

import { randomBytes, randomUUID, createHash, scrypt as scryptConCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptConCallback);

export const COOKIE = "catalina_acceso";
const DURACION_SESION_MS = 12 * 60 * 60 * 1000;
const INACTIVIDAD_MS = 4 * 60 * 60 * 1000;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const CLAVE_MINIMA = 8;
// N=2^15 → 32 MiB de memoria por hash, unos 60 ms. Suficiente para frenar un
// ataque por fuerza bruta y barato para una persona que entra una vez al día.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const LARGO_HASH = 64;
// Tope de intentos fallidos por dirección, para que probar usuarios al azar
// tampoco salga gratis. Vive en memoria: en serverless es una red de seguridad
// por instancia, no una garantía; la garantía es el bloqueo por cuenta.
const INTENTOS_POR_IP = 30;
const intentosPorIp = new Map();

// ── Conexión ─────────────────────────────────────────────────────────────────

// De dónde sale la dirección de la base. Vercel deja `POSTGRES_URL` y
// `DATABASE_URL` al conectar una base del Marketplace; `CATALINA_BD_URL` manda
// sobre las dos por si se quiere apuntar a otra parte.
export function origenDeBaseDeDatos() {
  for (const nombre of ["CATALINA_BD_URL", "POSTGRES_URL", "DATABASE_URL"]) {
    const valor = process.env[nombre]?.trim();
    if (valor) return { url: valor, origen: nombre };
  }
  // El cliente también sabe leer PGHOST/PGUSER/PGPASSWORD/PGDATABASE sueltas.
  if (process.env.PGHOST?.trim()) return { url: "", origen: "PGHOST" };
  return { url: "", origen: "" };
}

export const accesoConfigurado = () => Boolean(origenDeBaseDeDatos().origen);

// Con `CATALINA_ACCESO=abierto` se vuelve al comportamiento anterior: sin
// usuarios, cualquiera entra. Es la salida de emergencia, y queda escrita.
export const accesoForzadoAbierto = () => (process.env.CATALINA_ACCESO?.trim().toLowerCase() === "abierto");

function configurarConexion(url) {
  if (!url) return {};
  let u;
  try { u = new URL(url); } catch { return { connectionString: url }; }

  // `sslmode` lo decide este código y no la cadena: el cliente de Node cambia
  // lo que entiende por «require» entre versiones, y aquí se quiere una regla
  // fija: cifrado y certificado verificado salvo que sea la máquina local.
  const modo = (u.searchParams.get("sslmode") || "").toLowerCase();
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  const forzado = (process.env.CATALINA_BD_SSL?.trim() || "").toLowerCase();

  let ssl;
  if (forzado === "no" || modo === "disable" || (local && !modo)) ssl = false;
  else if (forzado === "inseguro" || modo === "no-verify") ssl = { rejectUnauthorized: false };
  else ssl = { rejectUnauthorized: true };

  return { connectionString: u.toString(), ssl };
}

let pool = null;
let esquemaListo = null;

function obtenerPool() {
  if (pool) return pool;
  const { url } = origenDeBaseDeDatos();
  pool = new pg.Pool({
    ...configurarConexion(url),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000
  });
  pool.on("error", error => console.error("acceso/bd:", error.message));
  return pool;
}

// Para las pruebas: cerrar la conexión y olvidar el esquema.
export async function cerrarBaseDeDatos() {
  const p = pool;
  pool = null;
  esquemaListo = null;
  if (p) await p.end().catch(() => {});
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'usuario',
  clave_hash TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  debe_cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acceso TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sesiones (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira TIMESTAMPTZ NOT NULL,
  revocada BOOLEAN NOT NULL DEFAULT FALSE,
  navegador TEXT
);
CREATE INDEX IF NOT EXISTS sesiones_usuario ON sesiones (usuario_id);
CREATE TABLE IF NOT EXISTS conversaciones (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin TIMESTAMPTZ,
  titulo TEXT,
  resumen JSONB,
  turnos JSONB NOT NULL DEFAULT '[]'::jsonb,
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversaciones_usuario ON conversaciones (usuario_id, inicio DESC);
CREATE TABLE IF NOT EXISTS auditoria (
  id BIGSERIAL PRIMARY KEY,
  momento TIMESTAMPTZ NOT NULL DEFAULT now(),
  evento TEXT NOT NULL,
  usuario TEXT,
  actor TEXT,
  ip TEXT,
  detalle JSONB
);
`;

async function bd() {
  const p = obtenerPool();
  // El esquema se crea una vez por instancia. Es idempotente, así que dos
  // instancias arrancando a la vez no se estorban.
  esquemaListo ??= p.query(ESQUEMA).catch(error => { esquemaListo = null; throw error; });
  await esquemaListo;
  return p;
}

// Qué le pasa a la base, dicho sin la dirección (que lleva la contraseña).
export async function comprobarBaseDeDatos() {
  if (!accesoConfigurado()) return { ok: false, problema: "BASE_DE_DATOS_NO_CONFIGURADA" };
  try {
    const p = await bd();
    const r = await p.query("SELECT count(*)::int AS n FROM usuarios");
    return { ok: true, usuarios: r.rows[0].n, origen: origenDeBaseDeDatos().origen };
  } catch (error) {
    return { ok: false, problema: `BASE_DE_DATOS_NO_DISPONIBLE:${error.code || error.name || "error"}`, detalle: error.message };
  }
}

// ── Contraseñas ──────────────────────────────────────────────────────────────

async function hashDeClave(clave) {
  const sal = randomBytes(16);
  const derivada = await scrypt(clave.normalize("NFKC"), sal, LARGO_HASH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString("base64")}$${derivada.toString("base64")}`;
}

async function claveCoincide(clave, guardado) {
  const partes = String(guardado || "").split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, N, r, p, sal, esperado] = partes;
  const derivada = await scrypt(String(clave).normalize("NFKC"), Buffer.from(sal, "base64"), LARGO_HASH,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  const esperadoBuf = Buffer.from(esperado, "base64");
  return esperadoBuf.length === derivada.length && timingSafeEqual(derivada, esperadoBuf);
}

// Un hash real de una clave que nadie tiene, para que «usuario inexistente»
// tarde lo mismo que «contraseña incorrecta».
let señuelo = null;
async function verificarSeñuelo() {
  señuelo ??= await hashDeClave(randomBytes(24).toString("base64url"));
  await claveCoincide("nada", señuelo);
}

// Contraseña generada: doce caracteres sin los que se confunden al dictarlos
// (0/O, 1/l/I), en tres grupos para poder leerla por teléfono.
export function generarClave() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let salida = "";
  for (let i = 0; i < 12; i += 1) {
    if (i && i % 4 === 0) salida += "-";
    salida += alfabeto[bytes[i] % alfabeto.length];
  }
  return salida;
}

export function normalizarUsuario(valor) {
  return String(valor ?? "").trim().toLowerCase().normalize("NFKC");
}

const USUARIO_VALIDO = /^[a-z0-9][a-z0-9._-]{1,39}$/;

function validarClave(clave) {
  const texto = String(clave ?? "");
  if (texto.length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (texto.length > 200) return "La contraseña es demasiado larga.";
  return "";
}

// ── Auditoría ────────────────────────────────────────────────────────────────

async function auditar(evento, { usuario = null, actor = null, ip = null, detalle = null } = {}) {
  try {
    const p = await bd();
    await p.query("INSERT INTO auditoria (evento, usuario, actor, ip, detalle) VALUES ($1,$2,$3,$4,$5)",
      [evento, usuario, actor, ip, detalle ? JSON.stringify(detalle) : null]);
  } catch (error) {
    console.error("acceso/auditoria:", error.message);
  }
}

export function ipDe(req) {
  const reenviada = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return reenviada || req.socket?.remoteAddress || "";
}

// ── Usuarios (lo que usa el administrador) ───────────────────────────────────

const COLUMNAS_PUBLICAS = "id, usuario, nombre, rol, activo, debe_cambiar_clave, creado, ultimo_acceso, bloqueado_hasta";

export async function listarUsuarios() {
  const p = await bd();
  const r = await p.query(`
    SELECT u.id, u.usuario, u.nombre, u.rol, u.activo, u.debe_cambiar_clave, u.creado, u.ultimo_acceso,
           u.bloqueado_hasta,
           (SELECT count(*)::int FROM conversaciones c WHERE c.usuario_id = u.id) AS conversaciones,
           (SELECT count(*)::int FROM sesiones s WHERE s.usuario_id = u.id AND NOT s.revocada AND s.expira > now()) AS sesiones_abiertas
    FROM usuarios u ORDER BY u.creado`);
  return r.rows.map(publicar);
}

function publicar(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    activo: fila.activo,
    debe_cambiar_clave: fila.debe_cambiar_clave,
    creado: fila.creado,
    ultimo_acceso: fila.ultimo_acceso,
    bloqueado: Boolean(fila.bloqueado_hasta && new Date(fila.bloqueado_hasta) > new Date()),
    conversaciones: fila.conversaciones ?? undefined,
    sesiones_abiertas: fila.sesiones_abiertas ?? undefined
  };
}

export async function crearUsuario({ usuario, nombre, clave, rol = "usuario", debeCambiarClave }, { actor = "administrador", ip = "" } = {}) {
  const id = normalizarUsuario(usuario);
  if (!USUARIO_VALIDO.test(id)) {
    return { ok: false, error: "El usuario debe tener de 2 a 40 caracteres: letras, números, punto, guion o guion bajo.", code: "USUARIO_INVALIDO" };
  }
  const nombreLimpio = String(nombre ?? "").trim().slice(0, 120);
  if (!nombreLimpio) return { ok: false, error: "Falta el nombre de la persona.", code: "NOMBRE_INVALIDO" };
  if (!["usuario", "administrador"].includes(rol)) return { ok: false, error: "Rol no reconocido.", code: "ROL_INVALIDO" };

  const generada = !clave;
  const claveFinal = generada ? generarClave() : String(clave);
  const problema = validarClave(claveFinal);
  if (problema) return { ok: false, error: problema, code: "CLAVE_INVALIDA" };

  const p = await bd();
  try {
    const r = await p.query(
      `INSERT INTO usuarios (usuario, nombre, rol, clave_hash, debe_cambiar_clave)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${COLUMNAS_PUBLICAS}`,
      [id, nombreLimpio, rol, await hashDeClave(claveFinal), debeCambiarClave ?? generada]);
    await auditar("USUARIO_CREADO", { usuario: id, actor, ip, detalle: { rol, clave_generada: generada } });
    // La contraseña generada se devuelve UNA vez, aquí, para dársela a la
    // persona. No se guarda en claro en ningún sitio.
    return { ok: true, usuario: publicar(r.rows[0]), clave: generada ? claveFinal : undefined };
  } catch (error) {
    if (error.code === "23505") return { ok: false, error: "Ese usuario ya existe.", code: "USUARIO_DUPLICADO" };
    throw error;
  }
}

export async function actualizarUsuario({ id, nombre, activo, rol }, { actor = "administrador", ip = "" } = {}) {
  const p = await bd();
  const cambios = [];
  const valores = [];
  if (typeof nombre === "string" && nombre.trim()) { valores.push(nombre.trim().slice(0, 120)); cambios.push(`nombre = $${valores.length}`); }
  if (typeof activo === "boolean") { valores.push(activo); cambios.push(`activo = $${valores.length}`); }
  if (rol === "usuario" || rol === "administrador") { valores.push(rol); cambios.push(`rol = $${valores.length}`); }
  if (!cambios.length) return { ok: false, error: "No hay nada que cambiar.", code: "SIN_CAMBIOS" };
  valores.push(Number(id));
  const r = await p.query(`UPDATE usuarios SET ${cambios.join(", ")} WHERE id = $${valores.length} RETURNING ${COLUMNAS_PUBLICAS}`, valores);
  if (!r.rowCount) return { ok: false, error: "No existe ese usuario.", code: "USUARIO_INEXISTENTE" };
  // Desactivar a alguien lo saca ahora, no cuando le caduque la sesión.
  if (activo === false) await p.query("UPDATE sesiones SET revocada = TRUE WHERE usuario_id = $1", [Number(id)]);
  await auditar("USUARIO_ACTUALIZADO", { usuario: r.rows[0].usuario, actor, ip, detalle: { nombre, activo, rol } });
  return { ok: true, usuario: publicar(r.rows[0]) };
}

export async function restablecerClave({ id, clave }, { actor = "administrador", ip = "" } = {}) {
  const generada = !clave;
  const claveFinal = generada ? generarClave() : String(clave);
  const problema = validarClave(claveFinal);
  if (problema) return { ok: false, error: problema, code: "CLAVE_INVALIDA" };
  const p = await bd();
  const r = await p.query(
    `UPDATE usuarios SET clave_hash = $1, debe_cambiar_clave = $2, intentos_fallidos = 0, bloqueado_hasta = NULL
     WHERE id = $3 RETURNING ${COLUMNAS_PUBLICAS}`,
    [await hashDeClave(claveFinal), generada, Number(id)]);
  if (!r.rowCount) return { ok: false, error: "No existe ese usuario.", code: "USUARIO_INEXISTENTE" };
  await p.query("UPDATE sesiones SET revocada = TRUE WHERE usuario_id = $1", [Number(id)]);
  await auditar("CLAVE_RESTABLECIDA", { usuario: r.rows[0].usuario, actor, ip, detalle: { clave_generada: generada } });
  return { ok: true, usuario: publicar(r.rows[0]), clave: generada ? claveFinal : undefined };
}

export async function ultimaAuditoria(cuantos = 60) {
  const p = await bd();
  const r = await p.query("SELECT momento, evento, usuario, actor, ip, detalle FROM auditoria ORDER BY id DESC LIMIT $1", [cuantos]);
  return r.rows;
}

// ── Entrar y salir ───────────────────────────────────────────────────────────

const MENSAJE_RECHAZO = "Usuario o contraseña incorrectos.";

function ipBloqueada(ip) {
  const registro = intentosPorIp.get(ip);
  if (!registro) return false;
  if (registro.hasta < Date.now()) { intentosPorIp.delete(ip); return false; }
  return registro.n >= INTENTOS_POR_IP;
}

function anotarFalloDeIp(ip) {
  const registro = intentosPorIp.get(ip);
  if (registro && registro.hasta > Date.now()) registro.n += 1;
  else intentosPorIp.set(ip, { n: 1, hasta: Date.now() + BLOQUEO_MS });
}

export async function entrar({ usuario, clave }, { ip = "", navegador = "" } = {}) {
  const id = normalizarUsuario(usuario);
  const texto = String(clave ?? "");
  if (ipBloqueada(ip)) {
    return { ok: false, estado: 429, error: "Demasiados intentos desde esta conexión. Espera unos minutos.", code: "DEMASIADOS_INTENTOS" };
  }
  if (!id || !texto) return { ok: false, estado: 400, error: "Faltan el usuario o la contraseña.", code: "DATOS_INCOMPLETOS" };

  const p = await bd();
  const r = await p.query("SELECT * FROM usuarios WHERE usuario = $1", [id]);
  const fila = r.rows[0];

  if (!fila) {
    await verificarSeñuelo();
    anotarFalloDeIp(ip);
    await auditar("ACCESO_RECHAZADO", { usuario: id, ip, detalle: { motivo: "usuario_inexistente" } });
    return { ok: false, estado: 401, error: MENSAJE_RECHAZO, code: "ACCESO_RECHAZADO" };
  }

  if (fila.bloqueado_hasta && new Date(fila.bloqueado_hasta) > new Date()) {
    await verificarSeñuelo();
    await auditar("ACCESO_RECHAZADO", { usuario: id, ip, detalle: { motivo: "bloqueado" } });
    const minutos = Math.max(1, Math.ceil((new Date(fila.bloqueado_hasta) - Date.now()) / 60000));
    return { ok: false, estado: 423, error: `Cuenta bloqueada por intentos fallidos. Vuelve a probar en ${minutos} min.`, code: "CUENTA_BLOQUEADA" };
  }

  const coincide = await claveCoincide(texto, fila.clave_hash);
  if (!coincide) {
    anotarFalloDeIp(ip);
    const fallos = fila.intentos_fallidos + 1;
    const bloquear = fallos >= MAX_INTENTOS;
    await p.query("UPDATE usuarios SET intentos_fallidos = $1, bloqueado_hasta = $2 WHERE id = $3",
      [bloquear ? 0 : fallos, bloquear ? new Date(Date.now() + BLOQUEO_MS) : null, fila.id]);
    await auditar(bloquear ? "CUENTA_BLOQUEADA" : "ACCESO_RECHAZADO", { usuario: id, ip, detalle: { motivo: "clave_incorrecta", fallos } });
    if (bloquear) {
      return { ok: false, estado: 423, error: "Cuenta bloqueada por intentos fallidos. Vuelve a probar en 15 min.", code: "CUENTA_BLOQUEADA" };
    }
    return { ok: false, estado: 401, error: MENSAJE_RECHAZO, code: "ACCESO_RECHAZADO" };
  }

  // La contraseña es correcta: sólo ahora se dice si la cuenta está apagada.
  // Antes de eso sería confirmar que existe a quien no la sabe.
  if (!fila.activo) {
    await auditar("ACCESO_RECHAZADO", { usuario: id, ip, detalle: { motivo: "cuenta_desactivada" } });
    return { ok: false, estado: 403, error: "Esta cuenta está desactivada. Habla con el administrador.", code: "CUENTA_DESACTIVADA" };
  }

  const token = randomBytes(32).toString("base64url");
  await p.query(
    "INSERT INTO sesiones (token_hash, usuario_id, expira, navegador) VALUES ($1,$2,$3,$4)",
    [hashDeToken(token), fila.id, new Date(Date.now() + DURACION_SESION_MS), String(navegador).slice(0, 200)]);
  await p.query("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id = $1", [fila.id]);
  intentosPorIp.delete(ip);
  await auditar("ACCESO_CONCEDIDO", { usuario: id, ip });

  return { ok: true, estado: 200, token, usuario: publicar(fila) };
}

function hashDeToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenDe(req) {
  const crudo = req.headers.cookie || "";
  for (const parte of crudo.split(";")) {
    const [nombre, ...resto] = parte.trim().split("=");
    if (nombre === COOKIE) return resto.join("=").trim();
  }
  return "";
}

// La persona detrás de la petición, o null. Renueva la actividad de la sesión
// como mucho una vez por minuto, para no escribir en cada petición.
export async function usuarioDeSesion(req) {
  const token = tokenDe(req);
  if (!token || token.length > 200) return null;
  const p = await bd();
  const r = await p.query(`
    SELECT s.id AS sesion_id, s.expira, s.ultima_actividad, s.revocada,
           u.id, u.usuario, u.nombre, u.rol, u.activo, u.debe_cambiar_clave
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = $1`, [hashDeToken(token)]);
  const fila = r.rows[0];
  if (!fila || fila.revocada || !fila.activo) return null;
  const ahora = Date.now();
  if (new Date(fila.expira) < ahora || ahora - new Date(fila.ultima_actividad) > INACTIVIDAD_MS) return null;
  if (ahora - new Date(fila.ultima_actividad) > 60_000) {
    p.query("UPDATE sesiones SET ultima_actividad = now() WHERE id = $1", [fila.sesion_id]).catch(() => {});
  }
  return { id: fila.id, usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol, debe_cambiar_clave: fila.debe_cambiar_clave };
}

export async function salir(req) {
  const token = tokenDe(req);
  if (!token) return false;
  const p = await bd();
  const r = await p.query(
    `UPDATE sesiones s SET revocada = TRUE FROM usuarios u
     WHERE s.token_hash = $1 AND u.id = s.usuario_id RETURNING u.usuario`, [hashDeToken(token)]);
  if (r.rowCount) await auditar("SESION_CERRADA", { usuario: r.rows[0].usuario, ip: ipDe(req) });
  return r.rowCount > 0;
}

export async function cambiarClave(persona, { actual, nueva }, { ip = "" } = {}) {
  const problema = validarClave(nueva);
  if (problema) return { ok: false, estado: 400, error: problema, code: "CLAVE_INVALIDA" };
  const p = await bd();
  const r = await p.query("SELECT clave_hash FROM usuarios WHERE id = $1", [persona.id]);
  if (!r.rows[0] || !(await claveCoincide(String(actual ?? ""), r.rows[0].clave_hash))) {
    await auditar("CAMBIO_DE_CLAVE_RECHAZADO", { usuario: persona.usuario, ip });
    return { ok: false, estado: 401, error: "La contraseña actual no es correcta.", code: "CLAVE_ACTUAL_INCORRECTA" };
  }
  if (String(actual) === String(nueva)) return { ok: false, estado: 400, error: "La nueva contraseña debe ser distinta.", code: "CLAVE_REPETIDA" };
  await p.query("UPDATE usuarios SET clave_hash = $1, debe_cambiar_clave = FALSE WHERE id = $2", [await hashDeClave(String(nueva)), persona.id]);
  await auditar("CLAVE_CAMBIADA", { usuario: persona.usuario, ip });
  return { ok: true, estado: 200 };
}

export function cookieDeSesion(token, req) {
  const segura = req.headers["x-forwarded-proto"] === "https" || Boolean(req.socket?.encrypted);
  return [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(DURACION_SESION_MS / 1000)}`, segura ? "Secure" : ""]
    .filter(Boolean).join("; ");
}

export function cookieDeSalida() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── Historial por persona ────────────────────────────────────────────────────

const TOPE_TURNOS = 600;

function limpiarTurnos(turnos) {
  return (Array.isArray(turnos) ? turnos : [])
    .filter(t => t && typeof t.texto === "string" && t.texto.trim())
    .slice(-TOPE_TURNOS)
    .map(t => ({ t: Number(t.t) || Date.now(), quien: t.quien === "usuario" ? "usuario" : "catalina", texto: String(t.texto).slice(0, 4000) }));
}

function idValido(id) {
  return typeof id === "string" && /^[A-Za-z0-9-]{4,64}$/.test(id);
}

// Guarda (o actualiza) el diálogo de una conversación en curso. Se llama cada
// pocos segundos desde el navegador, con todos los turnos: así una pestaña que
// se cierra de golpe no pierde más que los últimos segundos.
export async function guardarConversacion(persona, { id, inicio, turnos }) {
  if (!idValido(id)) return { ok: false, error: "Identificador de conversación inválido.", code: "CONVERSACION_INVALIDA" };
  const limpios = limpiarTurnos(turnos);
  const p = await bd();
  await p.query(`
    INSERT INTO conversaciones (id, usuario_id, inicio, turnos, actualizada)
    VALUES ($1, $2, $3, $4::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET turnos = EXCLUDED.turnos, actualizada = now()
    WHERE conversaciones.usuario_id = EXCLUDED.usuario_id`,
    [id, persona.id, new Date(Number(inicio) || Date.now()), JSON.stringify(limpios)]);
  return { ok: true, turnos: limpios.length };
}

// Al cerrar, queda además el resumen (minuta, acuerdos, alcance, pendientes).
export async function cerrarConversacion(persona, { id, inicio, fin, turnos, resumen }) {
  if (!idValido(id)) return { ok: false, error: "Identificador de conversación inválido.", code: "CONVERSACION_INVALIDA" };
  const limpios = limpiarTurnos(turnos);
  const p = await bd();
  await p.query(`
    INSERT INTO conversaciones (id, usuario_id, inicio, fin, titulo, resumen, turnos, actualizada)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET fin = EXCLUDED.fin, titulo = EXCLUDED.titulo, resumen = EXCLUDED.resumen,
      turnos = CASE WHEN jsonb_array_length(EXCLUDED.turnos) > 0 THEN EXCLUDED.turnos ELSE conversaciones.turnos END,
      actualizada = now()
    WHERE conversaciones.usuario_id = EXCLUDED.usuario_id`,
    [id, persona.id, new Date(Number(inicio) || Date.now()), new Date(Number(fin) || Date.now()),
      String(resumen?.titulo || "").slice(0, 200) || null, JSON.stringify(resumen ?? null), JSON.stringify(limpios)]);
  return { ok: true };
}

// Lo que ve la persona en «Anteriores»: sus conversaciones, con el resumen si
// se cerró y, si no, con un extracto del diálogo para reconocerla.
export async function listarConversaciones(persona, cuantas = 30) {
  const p = await bd();
  const r = await p.query(`
    SELECT id, inicio, fin, titulo, resumen, jsonb_array_length(turnos) AS intervenciones,
           (SELECT string_agg(t->>'texto', ' ') FROM (SELECT t FROM jsonb_array_elements(turnos) t LIMIT 3) x) AS extracto
    FROM conversaciones WHERE usuario_id = $1 ORDER BY inicio DESC LIMIT $2`, [persona.id, cuantas]);
  return r.rows.map(fila => fichaDe(fila));
}

function fichaDe(fila) {
  const inicio = new Date(fila.inicio).getTime();
  const base = fila.resumen && typeof fila.resumen === "object" ? fila.resumen : {
    titulo: fila.titulo || `Conversación del ${new Date(inicio).toLocaleDateString("es-CL", { day: "numeric", month: "long" })}`,
    resumen: String(fila.extracto || "").slice(0, 280),
    minuta: [], acuerdos: [], alcance: [], pendientes: [], temas: [],
    sinCerrar: true
  };
  return {
    ...base,
    id: fila.id,
    inicio,
    fin: fila.fin ? new Date(fila.fin).getTime() : undefined,
    intervenciones: fila.intervenciones,
    origen: "servidor"
  };
}

export async function leerConversacion(persona, id) {
  if (!idValido(id)) return null;
  const p = await bd();
  const r = await p.query("SELECT * FROM conversaciones WHERE id = $1 AND usuario_id = $2", [id, persona.id]);
  if (!r.rows[0]) return null;
  return { ...fichaDe({ ...r.rows[0], intervenciones: r.rows[0].turnos.length }), turnos: r.rows[0].turnos };
}

export async function borrarConversacion(persona, id) {
  if (!idValido(id)) return false;
  const p = await bd();
  const r = await p.query("DELETE FROM conversaciones WHERE id = $1 AND usuario_id = $2", [id, persona.id]);
  return r.rowCount > 0;
}

// Para el administrador: las conversaciones de cualquier usuario.
export async function conversacionesDeUsuario(usuarioId, cuantas = 50) {
  return listarConversaciones({ id: Number(usuarioId) }, cuantas);
}

export async function conversacionDeUsuario(usuarioId, id) {
  return leerConversacion({ id: Number(usuarioId) }, id);
}

// ── Rutas ────────────────────────────────────────────────────────────────────

// Estado del acceso, para la interfaz: si hace falta entrar y quién está dentro.
export async function estadoDeAcceso(req, { local = false } = {}) {
  if (accesoForzadoAbierto()) return { requerido: false, modo: "abierto-forzado", sesion: null };
  if (!accesoConfigurado()) {
    return local
      ? { requerido: false, modo: "abierto-local", sesion: null }
      : { requerido: true, modo: "sin-base-de-datos", sesion: null, problema: "ACCESO_NO_CONFIGURADO" };
  }
  try {
    const persona = await usuarioDeSesion(req);
    return { requerido: true, modo: "cerrado", sesion: persona ? sinId(persona) : null };
  } catch (error) {
    console.error("acceso/estado:", error.message);
    return { requerido: true, modo: "base-de-datos-caida", sesion: null, problema: `BASE_DE_DATOS_NO_DISPONIBLE:${error.code || error.name || "error"}` };
  }
}

const sinId = persona => ({ usuario: persona.usuario, nombre: persona.nombre, rol: persona.rol, debe_cambiar_clave: persona.debe_cambiar_clave });

// Las rutas /acceso/*. `ayudantes` trae readBody y json de app.mjs, para
// responder igual que el resto del servidor.
export async function atenderAcceso(req, res, { readBody, json, local = false }) {
  const ruta = req.url.split("?")[0];
  const leer = async () => { try { return JSON.parse(await readBody(req) || "{}"); } catch { return {}; } };

  if (req.method === "GET" && ruta === "/acceso/estado") {
    return json(res, 200, await estadoDeAcceso(req, { local }));
  }

  if (!accesoConfigurado() && !accesoForzadoAbierto()) {
    return json(res, 503, {
      ok: false,
      error: "El acceso con usuarios no está configurado: falta la base de datos (POSTGRES_URL).",
      code: "ACCESO_NO_CONFIGURADO"
    });
  }

  if (req.method === "POST" && ruta === "/acceso/entrar") {
    const cuerpo = await leer();
    const r = await entrar({ usuario: cuerpo.usuario, clave: cuerpo.clave }, { ip: ipDe(req), navegador: req.headers["user-agent"] || "" });
    if (!r.ok) return json(res, r.estado, { ok: false, error: r.error, code: r.code });
    res.setHeader("Set-Cookie", cookieDeSesion(r.token, req));
    return json(res, 200, { ok: true, sesion: sinId(r.usuario) });
  }

  if (req.method === "POST" && ruta === "/acceso/salir") {
    await salir(req);
    res.setHeader("Set-Cookie", cookieDeSalida());
    return json(res, 200, { ok: true });
  }

  // De aquí en adelante hace falta estar dentro.
  const persona = await usuarioDeSesion(req);
  if (!persona) return json(res, 401, { ok: false, error: "Tienes que entrar con tu usuario.", code: "ACCESO_REQUERIDO" });

  if (req.method === "GET" && ruta === "/acceso/sesion") {
    return json(res, 200, { ok: true, sesion: sinId(persona) });
  }

  if (req.method === "POST" && ruta === "/acceso/cambiar-clave") {
    const cuerpo = await leer();
    const r = await cambiarClave(persona, { actual: cuerpo.actual, nueva: cuerpo.nueva }, { ip: ipDe(req) });
    return json(res, r.estado, r.ok ? { ok: true } : { ok: false, error: r.error, code: r.code });
  }

  if (req.method === "POST" && ruta === "/acceso/conversacion") {
    const cuerpo = await leer();
    const r = await guardarConversacion(persona, cuerpo);
    return json(res, r.ok ? 200 : 400, r);
  }

  if (req.method === "GET" && ruta === "/acceso/conversaciones") {
    return json(res, 200, { ok: true, conversaciones: await listarConversaciones(persona) });
  }

  if (req.method === "GET" && ruta.startsWith("/acceso/conversaciones/")) {
    const registro = await leerConversacion(persona, decodeURIComponent(ruta.slice("/acceso/conversaciones/".length)));
    if (!registro) return json(res, 404, { ok: false, error: "No existe esa conversación.", code: "CONVERSACION_INEXISTENTE" });
    return json(res, 200, { ok: true, conversacion: registro });
  }

  if (req.method === "DELETE" && ruta.startsWith("/acceso/conversaciones/")) {
    const borrada = await borrarConversacion(persona, decodeURIComponent(ruta.slice("/acceso/conversaciones/".length)));
    return json(res, borrada ? 200 : 404, { ok: borrada });
  }

  return json(res, 404, { ok: false, error: "Ruta de acceso no reconocida.", code: "RUTA_INEXISTENTE" });
}

// La gestión de usuarios (crear, desactivar, contraseñas, rol) NO vive aquí: es
// una aplicación aparte, el administrador de Catalina (repositorio
// administrador-catalina-ai), que escribe en esta misma base. Las funciones
// de arriba se exportan para las pruebas y para un arranque local.

export const _pruebas = { hashDeClave, claveCoincide, configurarConexion, randomUUID };
