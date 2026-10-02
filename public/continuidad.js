// Continuidad de la reunión: que el equipo no se duerma y que quede registrado
// todo lo que pudo interrumpir la grabación.
//
//   · Bloqueo de reposo de pantalla (Screen Wake Lock). Mientras la pestaña de
//     Catalina esté visible, el sistema no apaga la pantalla por inactividad;
//     en una reunión presencial, que es donde se cortaba, la pestaña está a la
//     vista. El navegador lo suelta al ocultar la pestaña o minimizar la
//     ventana, así que se vuelve a pedir al volver. No impide el reposo por
//     cerrar la tapa: eso sólo lo evita la configuración del equipo.
//   · Registro de eventos: pestaña oculta o visible, congelada o reanudada,
//     red caída o recuperada y bloqueo concedido o perdido. Junto con los de
//     la grabadora (micrófono, audio detenido) forman el informe de cobertura.

export class Vigilia {
  constructor({ alEvento } = {}) {
    this.alEvento = alEvento;
    this.activa = false;
    this.bloqueo = null;
    this.alVisibilidad = () => this.#alCambiarVisibilidad();
    this.alCongelar = () => this.#evento("pestana-congelada", "el navegador congeló la pestaña");
    this.alReanudar = () => this.#evento("pestana-reanudada", "");
    this.alDesconectar = () => this.#evento("red-caida", "sin conexión a internet");
    this.alConectar = () => this.#evento("red-recuperada", "");
  }

  get disponible() { return Boolean(navigator.wakeLock?.request); }
  get bloqueada() { return Boolean(this.bloqueo && !this.bloqueo.released); }

  async activar() {
    if (this.activa) return this.bloqueada;
    this.activa = true;
    document.addEventListener("visibilitychange", this.alVisibilidad);
    document.addEventListener("freeze", this.alCongelar);
    document.addEventListener("resume", this.alReanudar);
    window.addEventListener("offline", this.alDesconectar);
    window.addEventListener("online", this.alConectar);
    if (!this.disponible) this.#evento("sin-bloqueo-pantalla", "este navegador no permite mantener la pantalla encendida");
    return await this.#pedir();
  }

  desactivar() {
    this.activa = false;
    document.removeEventListener("visibilitychange", this.alVisibilidad);
    document.removeEventListener("freeze", this.alCongelar);
    document.removeEventListener("resume", this.alReanudar);
    window.removeEventListener("offline", this.alDesconectar);
    window.removeEventListener("online", this.alConectar);
    const bloqueo = this.bloqueo;
    this.bloqueo = null;
    bloqueo?.release?.().catch(() => {});
  }

  async #pedir() {
    if (!this.activa || !this.disponible || document.visibilityState !== "visible" || this.bloqueada) return this.bloqueada;
    try {
      this.bloqueo = await navigator.wakeLock.request("screen");
      this.bloqueo.addEventListener("release", () => {
        if (this.activa) this.#evento("bloqueo-pantalla-liberado", document.visibilityState === "visible" ? "el sistema lo liberó" : "pestaña oculta");
      });
      this.#evento("bloqueo-pantalla", "la pantalla no se apagará mientras esta pestaña esté visible");
      return true;
    } catch (error) {
      this.#evento("sin-bloqueo-pantalla", error?.message || "rechazado");
      return false;
    }
  }

  async #alCambiarVisibilidad() {
    const visible = document.visibilityState === "visible";
    this.#evento(visible ? "pestana-visible" : "pestana-oculta", "");
    if (visible) await this.#pedir();
  }

  #evento(tipo, detalle) {
    this.alEvento?.({ tipo, momento: Date.now(), detalle });
  }
}

// Causas de hueco en lenguaje llano, para el informe y para el acta.
export function resumenDeContinuidad(continuidad = {}, duracionMs = 0) {
  const huecos = Array.isArray(continuidad.huecos) ? continuidad.huecos : [];
  const perdido = huecos.reduce((n, h) => n + Math.max(0, h.hasta - h.desde), 0);
  const porCausa = {};
  for (const h of huecos) porCausa[h.causa] = (porCausa[h.causa] || 0) + Math.max(0, h.hasta - h.desde);
  return {
    huecos: huecos.length,
    msPerdidos: perdido,
    coberturaAudio: duracionMs ? Math.max(0, Math.min(100, Math.round((1 - perdido / duracionMs) * 100))) : 100,
    porCausa: Object.entries(porCausa).map(([causa, ms]) => ({ causa, ms })).sort((a, b) => b.ms - a.ms),
    reconexiones: (continuidad.eventos || []).filter(e => e.tipo === "mic-recuperado").length,
    bloqueoPantalla: (continuidad.eventos || []).some(e => e.tipo === "bloqueo-pantalla")
  };
}

export const duracionLegible = ms => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return m < 60 ? `${m} min${r ? ` ${r} s` : ""}` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
