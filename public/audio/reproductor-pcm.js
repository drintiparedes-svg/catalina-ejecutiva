// Reproductor de audio continuo, en el hilo de audio.
//
// Antes cada trozo que llegaba de Gemini se agendaba a mano desde el hilo
// principal con `fuente.start(t)`. Ese hilo es el mismo que dibuja la cara a
// sesenta cuadros por segundo, así que cuando el dibujo se atascaba el trozo se
// agendaba tarde, se abría un hueco y la voz sonaba a tirones —lo que se oye
// como si cambiara de velocidad—.
//
// Aquí no hay agendado. El hilo principal sólo deja muestras en un búfer
// circular, y este procesador las va sacando al ritmo exacto de la tarjeta de
// sonido. Si el hilo principal se atasca, este sigue tirando de lo que ya había
// guardado, que es justo lo que absorbe el tirón.

const CAPACIDAD = 24000 * 6;      // seis segundos de margen, de sobra
const PRECARGA = 24000 * 0.12;    // 120 ms antes de empezar, para absorber la red

class ReproductorPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CAPACIDAD);
    this.escritura = 0;
    this.lectura = 0;
    this.sonando = false;

    this.port.onmessage = ({ data }) => {
      if (data.tipo === "audio") return this.#guardar(data.muestras);
      // Al interrumpir hay que vaciar de golpe: si no, Catalina seguiría
      // diciendo lo que ya no viene a cuento.
      if (data.tipo === "callar") {
        this.lectura = this.escritura = 0;
        this.sonando = false;
      }
    };
  }

  get disponibles() {
    return (this.escritura - this.lectura + CAPACIDAD) % CAPACIDAD;
  }

  #guardar(muestras) {
    for (let i = 0; i < muestras.length; i += 1) {
      this.buffer[this.escritura] = muestras[i];
      this.escritura = (this.escritura + 1) % CAPACIDAD;
      // Si se llenara, se pisa lo más viejo: preferible a crecer sin límite.
      if (this.escritura === this.lectura) {
        this.lectura = (this.lectura + 1) % CAPACIDAD;
      }
    }
  }

  process(_entradas, salidas) {
    const canal = salidas[0][0];
    if (!canal) return true;

    // No se empieza a sonar hasta tener un colchón: arrancar con lo justo
    // garantiza quedarse sin muestras al primer retraso de la red.
    if (!this.sonando) {
      if (this.disponibles < PRECARGA) {
        canal.fill(0);
        return true;
      }
      this.sonando = true;
    }

    const hay = this.disponibles;
    for (let i = 0; i < canal.length; i += 1) {
      if (i < hay) {
        canal[i] = this.buffer[this.lectura];
        this.lectura = (this.lectura + 1) % CAPACIDAD;
      } else {
        canal[i] = 0;
      }
    }

    // Se acabó lo guardado: se vuelve a esperar el colchón antes de seguir, en
    // vez de ir dando tirones muestra a muestra.
    if (hay <= canal.length) this.sonando = false;
    return true;
  }
}

registerProcessor("reproductor-pcm", ReproductorPcm);
