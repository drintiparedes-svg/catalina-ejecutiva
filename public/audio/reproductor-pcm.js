// Reproductor de audio continuo, en el hilo de audio.
//
// El hilo principal sólo deja muestras; este procesador las saca al ritmo
// exacto de la tarjeta de sonido. Así un atasco del hilo principal —que dibuja
// la cara a sesenta cuadros por segundo— no abre huecos en la voz.
//
// Dos cosas que se aprendieron rompiéndolas:
//
//   · **Nunca descartar.** La primera versión tenía seis segundos de capacidad
//     y al llenarse pisaba lo más viejo. Gemini manda el turno entero por
//     delante, así que una respuesta larga perdía audio: se oía saltar y
//     acelerar. Ahora el búfer crece en vez de tirar nada.
//   · **Re-precargar sólo al empezar.** Exigir el colchón otra vez después de
//     cada apuro momentáneo metía 120 ms de silencio cada vez. Sólo se espera
//     al principio de cada turno.
//
// Además lleva la cuenta de las muestras que de verdad han salido, y la avisa
// al hilo principal. Ése es el reloj con el que se mueve la boca: el audio llega
// a ráfagas y por delante, así que un reloj de pared la adelantaría.

const INICIAL = 24000 * 10;       // diez segundos para empezar
const PRECARGA = 24000 * 0.12;    // 120 ms antes del primer sonido de cada turno
const AVISO = 24000 * 0.02;       // cada 20 ms se dice por dónde va la reproducción

class ReproductorPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(INICIAL);
    this.escritura = 0;
    this.lectura = 0;
    this.arrancado = false;
    this.reproducidas = 0;      // muestras que ya sonaron, no las encoladas
    this.avisadas = 0;

    this.port.onmessage = ({ data }) => {
      if (data.tipo === "audio") return this.#guardar(data.muestras);
      // Al interrumpir hay que vaciar de golpe: si no, seguiría diciendo lo que
      // ya no viene a cuento.
      if (data.tipo === "callar") {
        this.lectura = this.escritura = 0;
        this.arrancado = false;
        // El reloj se reinicia con el silencio: lo que venga después es otro
        // turno y su alineación vuelve a empezar en cero.
        this.reproducidas = 0;
        this.avisadas = 0;
        this.port.postMessage({ tipo: "reloj", muestras: 0, reinicio: true });
      }
    };
  }

  get disponibles() {
    return (this.escritura - this.lectura + this.buffer.length) % this.buffer.length;
  }

  // Crece al doble cuando haría falta. Se reordena al copiar para dejar la
  // lectura en cero, que evita tener que pensar en el corte circular.
  #crecer(minimo) {
    const guardado = this.disponibles;
    let tamano = this.buffer.length;
    while (tamano - guardado <= minimo + 1) tamano *= 2;

    const nuevo = new Float32Array(tamano);
    for (let i = 0; i < guardado; i += 1) {
      nuevo[i] = this.buffer[(this.lectura + i) % this.buffer.length];
    }
    this.buffer = nuevo;
    this.lectura = 0;
    this.escritura = guardado;
  }

  #guardar(muestras) {
    // Se deja siempre un hueco libre: con el búfer justo, escritura y lectura
    // coincidirían y no habría forma de distinguir lleno de vacío.
    if (this.buffer.length - this.disponibles <= muestras.length + 1) {
      this.#crecer(muestras.length);
    }
    for (let i = 0; i < muestras.length; i += 1) {
      this.buffer[this.escritura] = muestras[i];
      this.escritura = (this.escritura + 1) % this.buffer.length;
    }
  }

  process(_entradas, salidas) {
    const canal = salidas[0][0];
    if (!canal) return true;

    // Sólo al principio del turno se espera el colchón. Después se sigue
    // sacando lo que haya: un apuro puntual mete un silencio de un cuadro, no
    // una pausa entera.
    if (!this.arrancado) {
      if (this.disponibles < PRECARGA) {
        canal.fill(0);
        return true;
      }
      this.arrancado = true;
    }

    for (let i = 0; i < canal.length; i += 1) {
      if (this.lectura !== this.escritura) {
        canal[i] = this.buffer[this.lectura];
        this.lectura = (this.lectura + 1) % this.buffer.length;
        this.reproducidas += 1;
      } else {
        canal[i] = 0;   // silencio de relleno: no cuenta como audio sonado
      }
    }

    // Se avisa cada 20 ms y no en cada bloque: a 128 muestras por bloque serían
    // casi doscientos mensajes por segundo para mover una boca que se dibuja
    // sesenta veces.
    if (this.reproducidas - this.avisadas >= AVISO) {
      this.avisadas = this.reproducidas;
      this.port.postMessage({ tipo: "reloj", muestras: this.reproducidas });
    }
    return true;
  }
}

registerProcessor("reproductor-pcm", ReproductorPcm);
