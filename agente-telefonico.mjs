// Llamadas telefónicas por el agente «Catalina AI».
//
// Catalina Ejecutiva no habla por teléfono: quien llama es el agente telefónico
// de preparación pre-procedimiento (repositorio agente-telefonico-falp), que
// tiene guion cerrado, verificación de identidad y guardrails clínicos como
// código. Aquí sólo se le entrega la indicación y se consulta cómo va.
//
// Lo que reemplaza: el puente Twilio+OpenAI y la llamada directa a ElevenLabs
// con un prompt generativo. Las dos se fueron por la misma razón: un modelo que
// improvisa por teléfono con un tercero no es auditable, y en una llamada con
// contenido clínico eso no es admisible.
//
// Cómo se usa sin bloquear la conversación: `programar` devuelve en cuanto el
// servicio acepta la llamada. El seguimiento lo hace el navegador en segundo
// plano (public/app.js), consultando `estado` cada pocos segundos, y avisa a
// Catalina sólo cuando hay un desenlace. Catalina no sondea desde el hilo de
// la conversación. Funciona en Vercel: no hay conexiones sostenidas.

import { randomUUID } from "node:crypto";

const TIEMPO = 15_000;

const config = () => ({
  url: (process.env.AGENTE_TELEFONICO_URL || "").trim().replace(/\/+$/, ""),
  token: (process.env.AGENTE_TELEFONICO_TOKEN || "").trim(),
  // Sólo se marca a números autorizados. Un error de transcripción en un número
  // dictado en voz alta llama a un desconocido, y las rutas de esta aplicación
  // no tienen autenticación. «*» permite cualquier número, a sabiendas.
  permitidos: (process.env.TELEFONO_PERMITIDOS || "").split(",").map(n => n.trim()).filter(Boolean),
  produccion: process.env.NODE_ENV === "production"
});

// En producción la lista blanca es obligatoria, salvo que se abra con «*».
export function listaBlancaFalta() {
  const c = config();
  return c.produccion && c.permitidos.length === 0;
}

export function agenteTelefonicoListo() {
  const c = config();
  return Boolean(c.url && /^https?:\/\//.test(c.url));
}

// E.164: el signo más y de ocho a quince dígitos. Conviene decirlo antes de
// gastar una llamada.
const E164 = /^\+[1-9]\d{7,14}$/;

export function revisarNumero(numero) {
  const limpio = String(numero || "").replace(/[\s()\-.]/g, "");
  if (!E164.test(limpio)) {
    return { ok: false, error: "El número debe ir en formato internacional, por ejemplo +56912345678." };
  }
  const { permitidos } = config();
  if (listaBlancaFalta()) {
    return { ok: false, error: "En producción hace falta TELEFONO_PERMITIDOS con los números autorizados, o «*» para permitir cualquiera." };
  }
  if (permitidos.length && !permitidos.includes("*") && !permitidos.includes(limpio)) {
    return { ok: false, error: "Ese número no está en la lista de números autorizados para llamar." };
  }
  return { ok: true, numero: limpio };
}

async function pedir(ruta, opciones = {}) {
  const c = config();
  const cabeceras = { "Content-Type": "application/json" };
  if (c.token) cabeceras.Authorization = `Bearer ${c.token}`;
  let respuesta;
  try {
    respuesta = await fetch(`${c.url}${ruta}`, { ...opciones, headers: cabeceras, signal: AbortSignal.timeout(TIEMPO) });
  } catch (error) {
    const motivo = error?.name === "TimeoutError" ? "tardó demasiado" : "no responde";
    return { ok: false, status: 0, datos: {}, error: `El agente telefónico ${motivo}.`, code: "AGENTE_INACCESIBLE" };
  }
  const crudo = await respuesta.text();
  let datos = {};
  try { datos = JSON.parse(crudo); } catch {}
  if (!respuesta.ok) {
    const detalle = datos?.error || crudo.slice(0, 200);
    const code = respuesta.status === 401 ? "AGENTE_TOKEN" : respuesta.status === 404 ? "NO_ENCONTRADA" : "AGENTE_RECHAZO";
    return { ok: false, status: respuesta.status, datos, code,
      error: respuesta.status === 401
        ? "El agente telefónico rechazó el token (AGENTE_TELEFONICO_TOKEN)."
        : `El agente telefónico no aceptó la petición (${respuesta.status})${detalle ? ": " + detalle : ""}.` };
  }
  return { ok: true, status: respuesta.status, datos };
}

// La indicación que se entrega, ya normalizada. Se valida aquí lo que el agente
// telefónico va a validar igual, para devolver un error que Catalina pueda
// decir en voz alta en vez de un 422 genérico.
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function armarIndicacion(p, emitidaPor) {
  const faltan = [];
  const nombre = String(p.nombre_paciente || "").trim();
  const rut = String(p.rut_ultimos_cuatro || "").replace(/\D/g, "");
  const fecha = String(p.fecha_procedimiento || "").trim();
  const ayuno = String(p.hora_inicio_ayuno || "").trim();
  const llegada = String(p.hora_llegada || "").trim();

  if (!nombre) faltan.push("el nombre del paciente");
  if (!/^\d{4}$/.test(rut)) faltan.push("los últimos cuatro dígitos del RUT, sin dígito verificador");
  if (!FECHA.test(fecha)) faltan.push("la fecha del procedimiento (año-mes-día)");
  if (!HORA.test(ayuno)) faltan.push("la hora de inicio del ayuno (HH:MM)");
  if (!HORA.test(llegada)) faltan.push("la hora de llegada (HH:MM)");
  if (!String(emitidaPor || "").trim()) faltan.push("el profesional que emite la indicación (config telefono.emitidaPor)");

  // Los fármacos pueden llegar como objetos {nombre, instruccion} o como texto
  // «nombre: instrucción». Se aceptan los dos; el texto exacto es lo que el
  // agente leerá al paciente, sin parafrasear.
  const farmacos = [];
  for (const f of Array.isArray(p.farmacos) ? p.farmacos : []) {
    if (f && typeof f === "object") {
      const n = String(f.nombre || "").trim();
      const i = String(f.instruccion || "").trim();
      if (n && i) farmacos.push({ nombre: n, instruccion: i });
      else faltan.push(`la instrucción del fármaco «${n || "?"}»`);
    } else if (typeof f === "string" && f.trim()) {
      // Se parte por el PRIMER separador (dos puntos, raya, o guion entre
      // espacios). Un guion pegado («3-4 días») es parte de la instrucción.
      const m = f.match(/^\s*([^:—–]+?)\s*(?::|—|–|\s-\s)\s*(.+)$/s);
      if (m) farmacos.push({ nombre: m[1].trim(), instruccion: m[2].trim() });
      else faltan.push(`la instrucción del fármaco «${f.trim()}»`);
    }
  }
  const examenes = (Array.isArray(p.examenes) ? p.examenes : []).map(e => String(e || "").trim()).filter(Boolean);

  if (faltan.length) return { ok: false, faltan };

  const [, mes, dia] = fecha.split("-");
  return {
    ok: true,
    contexto: {
      idLlamada: randomUUID(),
      idPaciente: String(p.id_paciente || "").trim() || `catalina-${rut}-${fecha}`,
      ...(String(p.servicio || "").trim() ? { servicio: String(p.servicio).trim() } : {}),
      verificacion: { nombrePaciente: nombre, rutUltimosCuatro: rut, diaMesProcedimiento: `${dia}-${mes}` },
      indicacion: {
        idIndicacion: String(p.id_indicacion || "").trim() || `catalina-${Date.now()}`,
        emitidaPor: String(emitidaPor).trim(),
        emitidaEn: new Date().toISOString(),
        fechaProcedimiento: fecha,
        horaInicioAyuno: ayuno,
        horaLlegada: llegada,
        farmacosASuspender: farmacos,
        examenesRequeridos: examenes,
        requiereAcompanante: p.requiere_acompanante === true
      }
    }
  };
}

// Programa la llamada. Devuelve en cuanto el agente la acepta: no espera a
// que suene ni a que termine.
export async function programarLlamada({ numero, indicacion, emitidaPor }) {
  if (!agenteTelefonicoListo()) {
    return { ok: false, error: "Falta AGENTE_TELEFONICO_URL: no hay agente telefónico configurado.", code: "TELEFONIA_SIN_CONFIGURAR" };
  }
  const revisado = revisarNumero(numero);
  if (!revisado.ok) return { ok: false, error: revisado.error, code: "NUMERO_INVALIDO" };

  const armada = armarIndicacion(indicacion || {}, emitidaPor);
  if (!armada.ok) {
    return { ok: false, code: "INDICACION_INCOMPLETA",
      error: `Falta ${armada.faltan.join("; ")}.`,
      queHacer: "Pide esos datos a la persona, repítelos en voz alta y vuelve a llamar a la herramienta." };
  }

  const r = await pedir("/llamadas", {
    method: "POST",
    body: JSON.stringify({
      idPaciente: armada.contexto.idPaciente,
      telefono: revisado.numero,
      contexto: armada.contexto,
      inmediata: true
    })
  });
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  if (r.datos?.ok === false) {
    return { ok: false, error: r.datos.error || "El agente telefónico rechazó la indicación.", code: "INDICACION_RECHAZADA" };
  }

  const despacho = r.datos?.despacho || {};
  return {
    ok: true,
    id: r.datos.idTrabajo,
    numero: revisado.numero,
    paciente: armada.contexto.verificacion.nombrePaciente,
    estado: despacho.originada ? "en_curso" : "programada",
    detalle: despacho.motivo || "",
    // Lo que Catalina puede decir y hacer a continuación: seguir con lo suyo.
    queHacer: despacho.originada
      ? "La llamada ya está sonando. Dilo en una frase y sigue con lo que la persona necesite; te avisarán cuando termine."
      : "La llamada quedó en cola. Dilo en una frase y sigue; te avisarán cuando termine."
  };
}

// Traduce el estado del agente telefónico a lo que el navegador muestra y a lo
// que Catalina cuenta.
export async function estadoLlamada(id) {
  if (!id) return { ok: false, error: "Falta el identificador de la llamada." };
  const r = await pedir(`/llamadas/${encodeURIComponent(id)}`);
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  const d = r.datos || {};
  const terminal = ["terminada", "fallida", "sin_resultado"].includes(d.estado);
  return {
    ok: true,
    id: d.id,
    estado: d.estado,
    detalle: d.detalle,
    terminal,
    numero: d.telefono,
    resultado: d.resultado
      ? {
          estadoFinal: d.resultado.estadoFinal,
          resumen: d.resultado.resumen,
          requiereRevisionHumana: d.resultado.requiereRevisionHumana === true,
          motivoRevision: d.resultado.motivoRevision || "",
          // Sólo los ids y veredictos: lo que hace falta para contar qué faltó.
          criterios: (d.resultado.criterios || []).map(c => ({ id: c.id, veredicto: c.veredicto }))
        }
      : null
  };
}

// Comprueba la conexión con el agente telefónico sin gastar una llamada.
export async function diagnostico() {
  const c = config();
  if (!agenteTelefonicoListo()) {
    return { ok: false, configurado: false, faltan: ["AGENTE_TELEFONICO_URL"], listaBlanca: c.permitidos };
  }
  let salud;
  try {
    const r = await fetch(`${c.url}/salud`, { signal: AbortSignal.timeout(TIEMPO) });
    salud = r.ok ? await r.json() : { ok: false, status: r.status };
  } catch (error) {
    return { ok: false, configurado: true, url: c.url, error: error?.name === "TimeoutError" ? "El agente telefónico tardó demasiado." : "No se pudo contactar al agente telefónico." };
  }
  // Una lectura autenticada, para saber si el token sirve.
  const revision = await pedir("/revision");
  return {
    ok: salud?.ok === true && revision.ok,
    configurado: true,
    url: c.url,
    salud,
    token: c.token ? (revision.ok ? "aceptado" : revision.code === "AGENTE_TOKEN" ? "rechazado" : "sin comprobar") : "no definido",
    pendientesDeRevision: revision.ok ? (revision.datos?.pendientes?.length ?? 0) : null,
    error: revision.ok ? undefined : revision.error,
    listaBlanca: c.permitidos,
    listaBlancaFalta: listaBlancaFalta()
  };
}
