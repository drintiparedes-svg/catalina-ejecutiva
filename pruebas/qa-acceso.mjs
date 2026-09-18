// El acceso con usuarios, de punta a punta y contra un Postgres de verdad.
//
//   CATALINA_BD_URL=postgres://catalina:catalina@127.0.0.1:5432/catalina_prueba node pruebas/qa-acceso.mjs
//
// Levanta el servidor en un puerto libre y lo trata como si estuviera en Vercel
// (con x-forwarded-for, para que no se abra por ser local). Comprueba lo que
// se pidió: que sin usuario no se pueda usar, que el administrador cree
// usuarios con su contraseña, que cada uno vea sólo su historial, y que las
// defensas —bloqueo por intentos, sesión revocada al desactivar— funcionen.
//
// Todo lo que crea lleva el prefijo `qa-` y se borra al final.

import { createServer } from "node:http";

const URL_BD = process.env.CATALINA_BD_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
if (!URL_BD) {
  console.log("FALLA no hay base de datos: define CATALINA_BD_URL con un Postgres de pruebas");
  process.exit(1);
}
process.env.CATALINA_BD_URL = URL_BD;
process.env.ADMIN_TOKEN = "token-de-prueba-del-administrador";
delete process.env.CATALINA_ACCESO;

const { atender } = await import("../app.mjs");
const acceso = await import("../acceso.mjs");

const servidor = createServer(atender);
await new Promise(r => servidor.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0, malos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) { ok += 1; console.log(`ok    ${nombre}`); }
  else { malos += 1; console.log(`FALLA ${nombre}${detalle ? `\n      ${detalle}` : ""}`); }
}

// Peticiones como las vería Vercel: con x-forwarded-for. `cookie` lleva la
// sesión de una persona; `admin` la llave del administrador.
async function pedir(metodo, ruta, { cuerpo, cookie = "", admin = false, local = false } = {}) {
  const cabeceras = { "Content-Type": "application/json" };
  if (!local) cabeceras["x-forwarded-for"] = "203.0.113.7";
  if (cookie) cabeceras.cookie = cookie;
  if (admin) cabeceras.authorization = `Bearer ${process.env.ADMIN_TOKEN}`;
  const r = await fetch(base + ruta, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const datos = await r.json().catch(() => ({}));
  const puesta = r.headers.get("set-cookie") || "";
  return { estado: r.status, datos, cookie: puesta.split(";")[0] };
}

const ADMIN = { admin: true };
const creados = [];

try {
  // ── Sin base ni sesión ────────────────────────────────────────────────────
  const salud = await pedir("GET", "/health");
  comprobar("/health sigue abierto y dice que el acceso está cerrado", salud.estado === 200 && salud.datos.acceso === "cerrado", JSON.stringify(salud.datos.acceso));

  const sinSesion = await pedir("POST", "/elevenlabs/sesion");
  comprobar("sin sesión, /elevenlabs/sesion responde 401 ACCESO_REQUERIDO", sinSesion.estado === 401 && sinSesion.datos.code === "ACCESO_REQUERIDO", JSON.stringify(sinSesion.datos));

  const cerrarSin = await pedir("POST", "/conversacion/cerrar", { cuerpo: { turnos: [] } });
  comprobar("sin sesión, /conversacion/cerrar también se niega", cerrarSin.estado === 401);

  const estado = await pedir("GET", "/acceso/estado");
  comprobar("/acceso/estado dice que hace falta entrar", estado.estado === 200 && estado.datos.requerido === true && estado.datos.sesion === null);

  const adminNoExiste = await pedir("GET", "/admin/usuarios", { admin: true });
  comprobar("la gestión de usuarios no vive aquí: /admin/usuarios no existe (es el administrador aparte)", adminNoExiste.estado === 404 || adminNoExiste.estado === 405, String(adminNoExiste.estado));

  // ── El administrador crea usuarios ────────────────────────────────────────
  const sufijo = Date.now().toString(36);
  const usuarioA = `qa-ana-${sufijo}`;
  const usuarioB = `qa-bruno-${sufijo}`;

  // Los usuarios los crea el administrador aparte; aquí se crean por el
  // módulo, que es lo mismo que hace aquella aplicación sobre esta base.
  const creacionA = { datos: await acceso.crearUsuario({ usuario: usuarioA.toUpperCase(), nombre: "Ana de Pruebas" }) };
  comprobar("crear usuario sin contraseña devuelve una generada, una sola vez",
    creacionA.datos.ok && typeof creacionA.datos.clave === "string" && creacionA.datos.clave.length >= 12
      && creacionA.datos.usuario.usuario === usuarioA && creacionA.datos.usuario.debe_cambiar_clave === true,
    JSON.stringify(creacionA.datos));
  creados.push(creacionA.datos.usuario?.id);
  const claveA = creacionA.datos.clave;

  const creacionB = { datos: await acceso.crearUsuario({ usuario: usuarioB, nombre: "Bruno de Pruebas", clave: "clave-de-bruno-2026" }) };
  comprobar("crear usuario con contraseña propia no la devuelve", creacionB.datos.ok && creacionB.datos.clave === undefined && creacionB.datos.usuario.debe_cambiar_clave === false);
  creados.push(creacionB.datos.usuario?.id);

  const duplicado = await acceso.crearUsuario({ usuario: usuarioA, nombre: "Otra Ana" });
  comprobar("un usuario repetido se rechaza", !duplicado.ok && duplicado.code === "USUARIO_DUPLICADO");
  const corta = await acceso.crearUsuario({ usuario: `qa-corta-${sufijo}`, nombre: "Corta", clave: "1234" });
  comprobar("una contraseña corta se rechaza", !corta.ok && corta.code === "CLAVE_INVALIDA");
  const invalido = await acceso.crearUsuario({ usuario: "con espacios y ñ", nombre: "X" });
  comprobar("un nombre de usuario inválido se rechaza", !invalido.ok && invalido.code === "USUARIO_INVALIDO");
  const lista = { datos: { usuarios: await acceso.listarUsuarios() } };
  comprobar("la lista de usuarios los muestra sin hash ni contraseña",
    lista.datos.usuarios.some(u => u.usuario === usuarioA) && !JSON.stringify(lista.datos).includes("scrypt$"));

  // ── Entrar ────────────────────────────────────────────────────────────────
  const mal = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioA, clave: "incorrecta-000" } });
  const inexistente = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: `qa-nadie-${sufijo}`, clave: "incorrecta-000" } });
  comprobar("contraseña incorrecta y usuario inexistente responden igual (401, mismo mensaje)",
    mal.estado === 401 && inexistente.estado === 401 && mal.datos.error === inexistente.datos.error && !mal.cookie);

  const bien = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: ` ${usuarioA.toUpperCase()} `, clave: claveA } });
  comprobar("entrar con la contraseña generada da sesión (cookie HttpOnly) y datos de la persona",
    bien.estado === 200 && bien.cookie.startsWith("catalina_acceso=") && bien.datos.sesion.nombre === "Ana de Pruebas" && bien.datos.sesion.debe_cambiar_clave === true,
    JSON.stringify(bien.datos));
  const cookieA = bien.cookie;

  const sesionA = await pedir("GET", "/acceso/sesion", { cookie: cookieA });
  comprobar("/acceso/sesion reconoce la cookie", sesionA.estado === 200 && sesionA.datos.sesion.usuario === usuarioA);

  const cambioMal = await pedir("POST", "/acceso/cambiar-clave", { cookie: cookieA, cuerpo: { actual: "no-es", nueva: "nueva-clave-de-ana" } });
  comprobar("cambiar la contraseña exige la actual", cambioMal.estado === 401);
  const cambio = await pedir("POST", "/acceso/cambiar-clave", { cookie: cookieA, cuerpo: { actual: claveA, nueva: "nueva-clave-de-ana" } });
  const sesionA2 = await pedir("GET", "/acceso/sesion", { cookie: cookieA });
  comprobar("cambiada la contraseña, ya no debe cambiarla", cambio.estado === 200 && sesionA2.datos.sesion.debe_cambiar_clave === false);
  const conVieja = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioA, clave: claveA } });
  comprobar("la contraseña vieja deja de valer", conVieja.estado === 401);

  const conSesion = await pedir("POST", "/conversacion/cerrar", { cookie: cookieA, cuerpo: { id: "qa-conv-a-1", inicio: Date.now() - 60000, fin: Date.now(), turnos: [{ quien: "usuario", texto: "Hola Catalina" }, { quien: "catalina", texto: "Hola Ana" }] } });
  comprobar("con sesión, la ruta protegida atiende y guarda el cierre en el servidor",
    conSesion.estado === 200 && conSesion.datos.ok === true && conSesion.datos.guardadoEnServidor === true && conSesion.datos.resumen.id === "qa-conv-a-1",
    JSON.stringify(conSesion.datos).slice(0, 300));

  // ── Historial por persona ─────────────────────────────────────────────────
  const guardar = await pedir("POST", "/acceso/conversacion", { cookie: cookieA, cuerpo: { id: "qa-conv-a-2", inicio: Date.now(), turnos: [{ t: Date.now(), quien: "usuario", texto: "Segunda conversación" }] } });
  comprobar("el diálogo en curso se guarda a nombre de la persona", guardar.estado === 200 && guardar.datos.turnos === 1);
  const guardar2 = await pedir("POST", "/acceso/conversacion", { cookie: cookieA, cuerpo: { id: "qa-conv-a-2", inicio: Date.now(), turnos: [{ quien: "usuario", texto: "Segunda conversación" }, { quien: "catalina", texto: "Te escucho" }] } });
  comprobar("volver a guardar la misma conversación la actualiza sin duplicarla", guardar2.estado === 200 && guardar2.datos.turnos === 2);

  const entradaB = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioB, clave: "clave-de-bruno-2026" } });
  const cookieB = entradaB.cookie;
  const listaA = await pedir("GET", "/acceso/conversaciones", { cookie: cookieA });
  const listaB = await pedir("GET", "/acceso/conversaciones", { cookie: cookieB });
  comprobar("cada persona ve sólo sus conversaciones",
    listaA.datos.conversaciones.map(c => c.id).sort().join() === "qa-conv-a-1,qa-conv-a-2" && listaB.datos.conversaciones.length === 0,
    JSON.stringify(listaA.datos).slice(0, 300));
  const ficha = listaA.datos.conversaciones.find(c => c.id === "qa-conv-a-2");
  comprobar("una conversación sin cerrar tiene título y extracto para reconocerla", ficha?.sinCerrar === true && /Segunda conversación/.test(ficha.resumen));
  const ajena = await pedir("GET", "/acceso/conversaciones/qa-conv-a-1", { cookie: cookieB });
  comprobar("una conversación ajena no se puede leer", ajena.estado === 404);
  const robo = await pedir("POST", "/acceso/conversacion", { cookie: cookieB, cuerpo: { id: "qa-conv-a-1", inicio: Date.now(), turnos: [{ quien: "usuario", texto: "pisada" }] } });
  const intacta = await pedir("GET", "/acceso/conversaciones/qa-conv-a-1", { cookie: cookieA });
  comprobar("una conversación ajena tampoco se puede pisar", robo.estado === 200 && intacta.datos.conversacion.turnos[0].texto === "Hola Catalina");
  const borrar = await pedir("DELETE", "/acceso/conversaciones/qa-conv-a-2", { cookie: cookieA });
  const listaA2 = await pedir("GET", "/acceso/conversaciones", { cookie: cookieA });
  comprobar("la persona puede borrar una conversación suya", borrar.estado === 200 && listaA2.datos.conversaciones.length === 1);

  const delAdmin = await acceso.conversacionesDeUsuario(creacionA.datos.usuario.id);
  comprobar("el administrador ve las conversaciones de un usuario", delAdmin.length === 1);

  // ── Salir, bloqueo y desactivación ────────────────────────────────────────
  const salida = await pedir("POST", "/acceso/salir", { cookie: cookieA });
  const trasSalir = await pedir("GET", "/acceso/sesion", { cookie: cookieA });
  comprobar("al salir, la cookie deja de valer", salida.estado === 200 && trasSalir.estado === 401);

  let ultimo = null;
  for (let i = 0; i < 5; i += 1) ultimo = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioB, clave: "mal-mal-mal-mal" } });
  const bloqueado = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioB, clave: "clave-de-bruno-2026" } });
  comprobar("cinco fallos seguidos bloquean la cuenta, incluso con la contraseña buena",
    ultimo.estado === 423 && bloqueado.estado === 423 && bloqueado.datos.code === "CUENTA_BLOQUEADA");

  const desbloqueo = { datos: await acceso.restablecerClave({ id: creacionB.datos.usuario.id }) };
  comprobar("restablecer la contraseña desbloquea y devuelve una nueva", desbloqueo.datos.ok && typeof desbloqueo.datos.clave === "string");
  const sesionBVieja = await pedir("GET", "/acceso/sesion", { cookie: cookieB });
  comprobar("restablecer la contraseña cierra las sesiones abiertas", sesionBVieja.estado === 401);
  const entradaB2 = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioB, clave: desbloqueo.datos.clave } });
  comprobar("con la contraseña nueva vuelve a entrar", entradaB2.estado === 200);

  const desactivar = { estado: (await acceso.actualizarUsuario({ id: creacionB.datos.usuario.id, activo: false })).ok ? 200 : 400 };
  const sesionBDesactivada = await pedir("GET", "/acceso/sesion", { cookie: entradaB2.cookie });
  const entradaDesactivada = await pedir("POST", "/acceso/entrar", { cuerpo: { usuario: usuarioB, clave: desbloqueo.datos.clave } });
  comprobar("desactivar a alguien lo saca al instante y le impide volver a entrar",
    desactivar.estado === 200 && sesionBDesactivada.estado === 401 && entradaDesactivada.estado === 403 && entradaDesactivada.datos.code === "CUENTA_DESACTIVADA");

  const auditoria = { datos: { auditoria: await acceso.ultimaAuditoria() } };
  const eventos = auditoria.datos.auditoria.map(e => e.evento);
  comprobar("la auditoría registra creación, accesos, bloqueo y cierre, sin contraseñas",
    ["USUARIO_CREADO", "ACCESO_CONCEDIDO", "ACCESO_RECHAZADO", "CUENTA_BLOQUEADA", "SESION_CERRADA", "CLAVE_CAMBIADA"].every(e => eventos.includes(e))
      && !JSON.stringify(auditoria.datos).includes(claveA) && !JSON.stringify(auditoria.datos).includes("clave-de-bruno-2026"),
    eventos.slice(0, 12).join(","));

  // ── En el propio equipo, sin base, sigue abierto ───────────────────────────
  const bdGuardada = process.env.CATALINA_BD_URL;
  delete process.env.CATALINA_BD_URL;
  const localSinBd = await pedir("GET", "/acceso/estado", { local: true });
  const remotoSinBd = await pedir("POST", "/conversacion/cerrar", { cuerpo: { turnos: [] } });
  comprobar("sin base de datos: abierto en el propio equipo, cerrado (503) desde fuera",
    localSinBd.datos.requerido === false && localSinBd.datos.modo === "abierto-local" && remotoSinBd.estado === 503 && remotoSinBd.datos.code === "ACCESO_NO_CONFIGURADO",
    JSON.stringify([localSinBd.datos, remotoSinBd.datos]));
  process.env.CATALINA_ACCESO = "abierto";
  const forzado = await pedir("GET", "/acceso/estado");
  comprobar("CATALINA_ACCESO=abierto es la salida de emergencia y queda declarada", forzado.datos.modo === "abierto-forzado");
  delete process.env.CATALINA_ACCESO;
  process.env.CATALINA_BD_URL = bdGuardada;
} catch (error) {
  malos += 1;
  console.log(`ROTO  ${error.stack}`);
} finally {
  // Limpieza: los usuarios de prueba y, en cascada, sus sesiones y conversaciones.
  try {
    const pg = (await import("pg")).default;
    const cliente = new pg.Client({ connectionString: URL_BD });
    await cliente.connect();
    await cliente.query("DELETE FROM usuarios WHERE usuario LIKE 'qa-%'");
    await cliente.query("DELETE FROM auditoria WHERE usuario LIKE 'qa-%'");
    await cliente.end();
  } catch (error) { console.log(`aviso: no se pudo limpiar: ${error.message}`); }
  await acceso.cerrarBaseDeDatos();
  servidor.close();
}

console.log(`\n${ok} comprobaciones · ${malos} fallos`);
process.exit(malos ? 1 : 0);
