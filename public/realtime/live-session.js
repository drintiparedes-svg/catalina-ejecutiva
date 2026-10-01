// Sesión de voz con GPT-Live (OpenAI) y razonamiento de Claude.
//
// El transporte es el mismo que el de OpenAI Realtime —WebRTC, oferta SDP
// presentada por el servidor, micrófono y mezcla con la reunión—, así que se
// hereda entero de session.js. Lo que cambia es la conversación:
//
//   · GPT-Live escucha y habla a la vez y decide solo cuándo hablar. No hay
//     eventos de turno: hay fragmentos de transcripción con marca de tiempo.
//   · No llama herramientas. Cuando hace falta pensar o buscar, delega
//     (`session.delegation.created`) y espera un resultado.
//   · Aquí cada delegación se resuelve con Claude (/live/razonar). Si Claude
//     pide herramientas, se ejecutan con los mismos manejadores que usan las
//     demás voces, y el resultado final vuelve a GPT-Live como
//     `session.commentary.append`, que lo dice con sus palabras.
//
// La delegación no trae el texto de la tarea: sólo avisa. Lo que hay que hacer
// se deduce de la transcripción, así que aquí se lleva la cuenta de lo dicho
// desde la delegación anterior.
//
// Eventos y campos verificados contra el SDK oficial de OpenAI (openai 3.22.1,
// openai/types/live/*).

import { RealtimeSession } from "./session.js";

// Silencio de la voz de Catalina que se toma como fin de su turno. GPT-Live no
// avisa cuándo termina de hablar; sus fragmentos llegan cada 200 ms.
const FIN_DE_TURNO_MS = 800;
// Espera antes de tomar la transcripción de una delegación: el último trozo de
// lo que dijo la persona puede llegar justo después del aviso.
const MARGEN_DELEGACION_MS = 250;
// Pasos de Claude por delegación (cada paso puede pedir herramientas).
const MAX_PASOS = 6;
const ESPERA_PASO_MS = 65000;
// Cada aporte a GPT-Live admite hasta 500 tokens; en español, unos 1.400
// caracteres quedan holgadamente por debajo.
const MAX_TROZO = 1400;
const MAX_RESULTADO_HERRAMIENTA = 12000;
const MAX_CONTEXTO_A_VOZ = 6000;
const MAX_CONTEXTO_A_CLAUDE = 30000;
// Pasado este tamaño, la historia de Claude empieza de nuevo. No se recorta por
// delante: editar turnos anteriores invalida el razonamiento ya hecho.
const MAX_HISTORIA = 600000;

export class LiveSession extends RealtimeSession {
  constructor(handlers = {}) {
    super(handlers);
    this.ruta = "/live/session";
    this.#reiniciar();
  }

  #reiniciar() {
    this.iniciada = false;
    this.fragmentos = [];       // lo dicho desde la última delegación: [{ rol, texto }]
    this.contexto = [];         // avisos del sistema para Claude (reuniones, etc.)
    this.historia = [];         // conversación con Claude, intacta
    this.pendientes = [];       // herramientas que Claude pidió y no se ejecutaron
    this.cola = Promise.resolve();
    this.delegaciones = 0;
    this.fallosDeRazonamiento = 0;
    clearTimeout(this.relojTurno);
  }

  async connect() {
    // ?vozLive=cedar prueba otra voz sin tocar la configuración guardada; el
    // servidor sólo acepta voces integradas de GPT-Live.
    const voz = new URLSearchParams(location.search).get("vozLive");
    this.ruta = "/live/session" + (voz ? `?voz=${encodeURIComponent(voz)}` : "");
    this.#reiniciar();
    return super.connect();
  }

  // La configuración ya viajó con la oferta; no hay nada que mandar al abrir.
  // Se espera a `session.started` antes de enviar cualquier cosa.
  alAbrirCanal() {
    this.emitir("onStatus", "Conectando con GPT-Live…");
  }

  alRecibirEvento(message) {
    let evento;
    try { evento = JSON.parse(message.data); } catch { return; }

    switch (evento.type) {
      case "session.started":
        this.iniciada = true;
        this.connected = true;
        this.emitir("onConnected");
        this.emitir("onPhase", "listening");
        this.emitir("onStatus", "Te escucho (GPT-Live + Claude)");
        break;

      case "session.input_transcript.delta":
        this.#anotar("user", evento.delta);
        break;

      case "session.output_transcript.delta":
        this.#anotar("assistant", evento.delta);
        this.#hablando(evento.delta);
        break;

      case "session.delegation.created":
        if (evento.delegation?.target === "client") this.#recibirDelegacion(evento.delegation.id);
        break;

      case "session.closed":
        this.disconnect();
        break;

      case "error":
        // Los errores en curso no cierran la sesión: se registran y se sigue.
        console.error("GPT-Live", evento.error);
        if (!this.iniciada) this.emitir("onStatus", evento.error?.message || "GPT-Live rechazó la sesión");
        break;
    }
  }

  // Mientras llegan fragmentos de su voz, Catalina está hablando. Cuando dejan
  // de llegar, el turno terminó: se cierra el subtítulo y se vuelve a escuchar.
  #hablando(delta) {
    if (!delta) return;
    this.alSonar(true);
    this.emitir("onPhase", "speaking");
    this.emitir("onStatus", "Hablando");
    this.transcript += delta;
    this.emitir("onTranscript", this.transcript);
    clearTimeout(this.relojTurno);
    this.relojTurno = setTimeout(() => {
      this.alSonar(false);
      this.transcript = "";
      this.emitir("onResponseDone");
      if (this.connected) {
        this.emitir("onPhase", "listening");
        this.emitir("onStatus", "Te escucho");
      }
    }, FIN_DE_TURNO_MS);
  }

  #anotar(rol, delta) {
    if (!delta) return;
    const ultimo = this.fragmentos.at(-1);
    if (ultimo?.rol === rol) ultimo.texto += delta;
    else this.fragmentos.push({ rol, texto: delta });
  }

  // Lo dicho desde la última delegación, como transcripción para Claude.
  #tomarTranscripcion() {
    const fragmentos = this.fragmentos;
    this.fragmentos = [];
    const contexto = this.contexto;
    this.contexto = [];
    const lineas = fragmentos
      .map(f => ({ ...f, texto: f.texto.replace(/\s+/g, " ").trim() }))
      .filter(f => f.texto)
      .map(f => `${f.rol === "user" ? "PERSONA" : "CATALINA"}: ${f.texto}`);
    return { lineas, contexto };
  }

  #recibirDelegacion(id) {
    this.delegaciones += 1;
    this.emitir("onPhase", "thinking");
    setTimeout(() => {
      const tomado = this.#tomarTranscripcion();
      this.#encolar(id, tomado, null);
    }, MARGEN_DELEGACION_MS);
  }

  // Las delegaciones se resuelven de una en una: la historia de Claude es una
  // sola conversación y no admite dos pasos a la vez.
  #encolar(id, tomado, peticion) {
    this.cola = this.cola
      .then(() => this.#resolver(id, tomado, peticion))
      .catch(error => console.error("Delegación", error));
  }

  async #resolver(id, { lineas, contexto }, peticion) {
    if (!this.connected) return;

    if (JSON.stringify(this.historia).length > MAX_HISTORIA) {
      this.historia = [];
      this.pendientes = [];
    }
    const primera = !this.historia.length;

    const partes = [];
    if (contexto.length) partes.push("Contexto del sistema (no es de la persona):\n" + contexto.join("\n").slice(-MAX_CONTEXTO_A_CLAUDE));
    if (lineas.length) {
      partes.push((primera ? "Conversación hablada hasta ahora:\n" : "Conversación hablada desde la consulta anterior:\n") + lineas.join("\n"));
    }
    partes.push(peticion || "Actúa sobre la petición más reciente de la persona en la conversación de arriba.");

    // Si la consulta anterior terminó con herramientas sin ejecutar (respuesta
    // cortada), la API exige cerrarlas antes de seguir.
    const cierre = this.pendientes.map(idHerramienta => ({
      type: "tool_result", tool_use_id: idHerramienta, is_error: true, content: "No se ejecutó."
    }));
    this.pendientes = [];
    this.historia.push({ role: "user", content: [...cierre, { type: "text", text: partes.join("\n\n") }] });

    try {
      for (let paso = 0; paso < MAX_PASOS; paso += 1) {
        const r = await this.#pasoDeClaude();
        this.historia.push({ role: "assistant", content: r.contenido });

        if (r.fin) {
          this.pendientes = r.contenido.filter(b => b.type === "tool_use").map(b => b.id);
          this.fallosDeRazonamiento = 0;
          return this.#responder(id, r.texto || "No tengo nada que agregar sobre eso.");
        }

        this.emitir("onStatus", "Buscando…");
        const resultados = [];
        for (const llamada of r.llamadas) {
          resultados.push(await this.#ejecutar(llamada));
          if (!this.connected) return;
        }
        this.historia.push({ role: "user", content: resultados });
      }
      return this.#responder(id, "No alcancé a terminar eso; dime si quieres que lo intente de otra forma.");
    } catch (error) {
      console.error("Razonamiento", error);
      this.fallosDeRazonamiento += 1;
      return this.#responder(id, error.mensajeParaVoz || "No pude completar eso en este momento.");
    }
  }

  async #pasoDeClaude() {
    const respuesta = await fetch("/live/razonar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensajes: this.historia }),
      signal: AbortSignal.timeout(ESPERA_PASO_MS)
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.ok) {
      const error = new Error(datos.error || `Razonamiento no disponible (${respuesta.status})`);
      // Lo que GPT-Live dirá en voz alta: el motivo concreto ayuda a quien
      // prueba, sin leer códigos.
      if (datos.code === "ANTHROPIC_KEY_MISSING" || datos.code === "ANTHROPIC_KEY_INVALID") {
        error.mensajeParaVoz = "No puedo pensar esto ahora: la clave de Claude no está configurada o fue rechazada.";
      }
      throw error;
    }
    return datos;
  }

  async #ejecutar(llamada) {
    let resultado;
    try {
      resultado = await this.emitir("onToolCall", llamada.nombre, llamada.argumentos || {});
    } catch (error) {
      resultado = { ok: false, error: error?.message || "La herramienta falló" };
    }
    let contenido = JSON.stringify(resultado ?? { ok: false, error: "Sin resultado" });
    if (contenido.length > MAX_RESULTADO_HERRAMIENTA) {
      contenido = contenido.slice(0, MAX_RESULTADO_HERRAMIENTA) + " …[recortado]";
    }
    return {
      type: "tool_result",
      tool_use_id: llamada.id,
      content: contenido,
      ...(resultado?.ok === false ? { is_error: true } : {})
    };
  }

  // Devuelve un resultado a GPT-Live para que lo diga. Con id, responde a esa
  // delegación; sin id, es un aporte general (modo reunión).
  #responder(id, texto) {
    for (const trozo of trocear(texto, MAX_TROZO)) {
      this.#enviar({ type: "session.commentary.append", delegation_id: id ?? null, content: trozo });
    }
  }

  #enviar(evento) {
    if (this.channel?.readyState !== "open" || !this.iniciada) return false;
    this.channel.send(JSON.stringify(evento));
    return true;
  }

  // Modo reunión. Con GPT-Live no se le puede «escribir» a la voz como si
  // hablara la persona: el pedido va a Claude, y lo que Claude conteste se le
  // pasa a la voz para que lo diga.
  enviarTexto(texto) {
    if (!this.iniciada || !texto) return false;
    this.emitir("onPhase", "thinking");
    this.#encolar(null, this.#tomarTranscripcion(), texto);
    return true;
  }

  // Contexto silencioso: la voz lo sabe sin decirlo, y Claude lo recibe con la
  // próxima consulta.
  anadirContexto(texto) {
    if (!this.iniciada || !texto) return false;
    this.contexto.push(texto);
    for (const trozo of trocear(texto.slice(-MAX_CONTEXTO_A_VOZ), MAX_TROZO)) {
      this.#enviar({ type: "session.thinking.append", delegation_id: null, content: trozo });
    }
    return true;
  }

  diagnostico() {
    return {
      ...super.diagnostico(),
      proveedor: "gpt-live",
      delegaciones: this.delegaciones,
      fallosDeRazonamiento: this.fallosDeRazonamiento,
      pasosEnHistoria: this.historia.length
    };
  }

  disconnect() {
    // Cierre ordenado: OpenAI termina lo pendiente y cobra sólo hasta aquí.
    if (this.iniciada) this.#enviar({ type: "session.close" });
    this.iniciada = false;
    clearTimeout(this.relojTurno);
    super.disconnect();
  }
}

// Corta el texto en trozos que GPT-Live acepte, por frases cuando se puede.
export function trocear(texto, maximo) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  const trozos = [];
  let actual = "";
  for (const frase of limpio.match(/[^.!?…]+[.!?…]*\s*/g) || [limpio]) {
    if ((actual + frase).length > maximo && actual) {
      trozos.push(actual.trim());
      actual = "";
    }
    if (frase.length > maximo) {
      for (let i = 0; i < frase.length; i += maximo) trozos.push(frase.slice(i, i + maximo).trim());
      continue;
    }
    actual += frase;
  }
  if (actual.trim()) trozos.push(actual.trim());
  return trozos.filter(Boolean);
}
