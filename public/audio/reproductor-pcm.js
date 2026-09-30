// Reproductor de audio continuo, en el hilo de audio.
//
// El hilo principal sólo deja muestras; este procesador las saca al ritmo
// exacto de la tarjeta de sonido. Así un atasco del hilo principal —que dibuja
// la cara a sesenta cuadros por segundo— no abre huecos en la voz.
//
// Lo que se aprendió rompiéndolo:
//
//   · **Nunca descartar.** La primera versión tenía seis segundos de capacidad
//     y al llenarse pisaba lo más viejo. Gemini manda el turno entero por
//     delante, así que una respuesta larga perdía audio: se oía saltar y
//     acelerar. Ahora el búfer crece en vez de tirar nada.
//   · **Un colchón fijo no sirve para todos los casos.** ElevenLabs genera la
//     voz casi al ritmo en que suena, así que cualquier retraso de la red o del
//     hilo principal por encima del colchón vacía el búfer a media frase. Con
//     120 ms fijos, la medición daba de uno a cinco cortes por cada ocho
//     segundos de voz. Ahora el colchón se adapta: empieza en 180 ms, sube
//     100 ms tras cada turno que tuvo cortes (hasta medio segundo) y baja
//     despacio cuando los turnos salen limpios. Es lo que hace cualquier
//     búfer de jitter de telefonía.
//   · **Si se vacía, que sea una pausa y no un tartamudeo.** Seguir sacando lo
//     poco que va llegando producía ráfagas de sonido y silencio de pocos
//     milisegundos: justo lo que se oye como «entrecortado». Tras un vacío a
//     media frase se espera un colchón corto antes de seguir, y cada borde se
//     funde en 4 ms para que no haya chasquidos.
//   · **Re-precargar el turno entero sólo al empezar.** Exigir el colchón
//     completo después de cada apuro metía demasiado silencio; a media frase
//     basta con uno pequeño, que crece si los vacíos se repiten.
//
// Además lleva la cuenta de las muestras que de verdad han salido, y la avisa
// al hilo principal. Ése es el reloj con el que se mueve la boca: el audio llega
// a ráfagas y por delante, así que un reloj de pared la adelantaría. Y avisa
// cuándo empieza y termina de sonar la voz, para que la sesión deje de enviar
// el audio de la reunión mientras Catalina habla.

const HZ = sampleRate;
const INICIAL = HZ * 10;                 // diez segundos para empezar
const PRECARGA_MIN = HZ * 0.18;          // colchón de inicio de turno
const PRECARGA_MAX = HZ * 0.5;
const PASO = HZ * 0.1;                   // subida tras un turno con cortes
const BAJADA = HZ * 0.02;                // bajada tras un turno limpio
const REPRECARGA = HZ * 0.08;            // colchón tras un vacío a media frase
const DE_SOBRA = HZ * 0.5;               // con esto encolado de más no se espera
const SILENCIO_VOZ = HZ * 0.25;          // vacío tras el que se da la voz por callada
const FIN_DE_TURNO = HZ * 1.2;           // vacío tras el que empieza otro turno
const FUNDIDO = Math.round(HZ * 0.004);  // 4 ms de fundido en cada borde
const AVISO = HZ * 0.02;                 // cada 20 ms se dice por dónde va la reproducción

class ReproductorPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(INICIAL);
    this.escritura = 0;
    this.lectura = 0;
    this.arrancado = false;
    this.reproducidas = 0;      // muestras que ya sonaron, no las encoladas
    this.avisadas = 0;

    this.precarga = PRECARGA_MIN;
    this.enTurno = false;       // hay una respuesta sonando o a medias
    this.sonando = false;       // lo que se avisa fuera
    this.hambre = 0;            // muestras seguidas sin nada que sacar
    this.espera = 0;            // muestras esperando con audio ya encolado
    this.fundido = FUNDIDO;     // posición del fundido de entrada
    this.cortesTurno = 0;
    this.est = { turnos: 0, cortes: 0, msCortados: 0, turnosConCortes: 0 };

    this.port.onmessage = ({ data }) => {
      if (data.tipo === "audio") return this.#guardar(data.muestras);
      // Al interrumpir hay que vaciar de golpe: si no, seguiría diciendo lo que
      // ya no viene a cuento. No cuenta como corte ni ajusta el colchón.
      if (data.tipo === "callar") {
        this.lectura = this.escritura = 0;
        this.arrancado = false;
        this.enTurno = false;
        this.cortesTurno = 0;
        this.hambre = 0;
        this.espera = 0;
        this.#avisarVoz(false);
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

  #avisarVoz(sonando) {
    if (this.sonando === sonando) return;
    this.sonando = sonando;
    this.port.postMessage({ tipo: "voz", sonando, ...this.#estadisticas() });
  }

  #estadisticas() {
    return {
      turnos: this.est.turnos,
      cortes: this.est.cortes,
      msCortados: Math.round(this.est.msCortados),
      turnosConCortes: this.est.turnosConCortes,
      colchonMs: Math.round(this.precarga / HZ * 1000)
    };
  }

  // Un turno termina cuando lleva rato sin nada que sonar. Ahí se ajusta el
  // colchón del siguiente según cómo salió éste.
  #cerrarTurno() {
    if (!this.enTurno) return;
    this.enTurno = false;
    if (this.cortesTurno) {
      this.est.turnosConCortes += 1;
      this.precarga = Math.min(PRECARGA_MAX, this.precarga + PASO);
    } else {
      this.precarga = Math.max(PRECARGA_MIN, this.precarga - BAJADA);
    }
    this.cortesTurno = 0;
    this.port.postMessage({ tipo: "estadisticas", ...this.#estadisticas() });
  }

  // ¿Se puede empezar (o reanudar) a sonar? El colchón se mide en tiempo de
  // espera desde que llegó el primer audio, no en muestras encoladas: los
  // proveedores mandan trozos de un cuarto de segundo, y un solo trozo ya
  // «llenaría» un colchón medido en muestras sin proteger nada contra el
  // retraso del siguiente. Esperar ese tiempo es lo que da margen. Al principio
  // del turno se espera el colchón completo; a media frase, uno corto que
  // crece si los vacíos se repiten. Si ya hay audio de sobra, no se espera.
  #listo(bloque) {
    const hay = this.disponibles;
    if (!hay) { this.espera = 0; return false; }
    this.espera += bloque;
    const necesario = this.enTurno
      ? Math.min(this.precarga, REPRECARGA * Math.max(1, this.cortesTurno))
      : this.precarga;
    return this.espera >= necesario || hay >= necesario + DE_SOBRA;
  }

  process(_entradas, salidas) {
    const canal = salidas[0][0];
    if (!canal) return true;

    if (!this.arrancado) {
      if (!this.#listo(canal.length)) {
        canal.fill(0);
        this.#contarHambre(canal.length);
        return true;
      }
      // Reanuda: si venía de un vacío a media frase, eso fue un corte.
      if (this.enTurno && this.hambre) {
        this.cortesTurno += 1;
        this.est.cortes += 1;
        this.est.msCortados += this.hambre / HZ * 1000;
      }
      if (!this.enTurno) { this.enTurno = true; this.est.turnos += 1; }
      this.arrancado = true;
      this.hambre = 0;
      this.espera = 0;
      this.fundido = 0;
      this.#avisarVoz(true);
    }

    // Si este bloque va a vaciar el búfer, las últimas muestras se funden.
    const vaciara = this.disponibles <= canal.length;
    let i = 0;
    for (; i < canal.length; i += 1) {
      const quedan = this.disponibles;
      if (!quedan) break;
      let muestra = this.buffer[this.lectura];
      // Fundido de entrada tras cada arranque, y de salida en las últimas
      // muestras antes de vaciarse: sin bordes secos no hay chasquido.
      if (this.fundido < FUNDIDO) { muestra *= this.fundido / FUNDIDO; this.fundido += 1; }
      if (vaciara && quedan <= FUNDIDO) muestra *= quedan / FUNDIDO;
      canal[i] = muestra;
      this.lectura = (this.lectura + 1) % this.buffer.length;
      this.reproducidas += 1;
    }
    if (i < canal.length) {
      // Se vació: silencio de relleno, que no cuenta como audio sonado.
      canal.fill(0, i);
      this.arrancado = false;
      this.#contarHambre(canal.length - i);
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

  #contarHambre(muestras) {
    if (!this.enTurno) return;
    this.hambre += muestras;
    if (this.hambre >= SILENCIO_VOZ) this.#avisarVoz(false);
    if (this.hambre >= FIN_DE_TURNO) { this.hambre = 0; this.#cerrarTurno(); }
  }
}

registerProcessor("reproductor-pcm", ReproductorPcm);
