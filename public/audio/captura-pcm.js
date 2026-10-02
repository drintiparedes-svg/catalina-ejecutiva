// Captura de la grabadora de reuniones, en el hilo de audio.
//
// Antes la captura era un ScriptProcessor: corre en el hilo principal, y si la
// pestaña queda en segundo plano o el equipo va justo, el navegador descarta
// bloques de audio sin avisar. Un AudioWorklet corre en el hilo de audio, de
// prioridad alta; los bloques se acumulan aquí y se entregan por mensaje, que
// el hilo principal procesa aunque llegue tarde: no se pierden.
//
// Cada envío lleva `frame`, el reloj de audio. Comparándolo con el reloj de
// pared, la grabadora detecta cuándo el audio se detuvo (equipo suspendido,
// contexto pausado por el sistema) y lo registra como hueco con su causa.

const BLOQUE = 4096;

// El tamaño del bloque se elige al crear el nodo: 4096 para la grabadora (pocos
// mensajes) y ~20 ms para la conversación (menos espera antes de enviar).
class CapturaPcm extends AudioWorkletProcessor {
  constructor(opciones) {
    super();
    this.tamano = Math.max(128, Number(opciones?.processorOptions?.bloque) || BLOQUE);
    this.bloque = new Float32Array(this.tamano);
    this.n = 0;
    this.inicio = 0;
    this.activo = true;
    this.port.onmessage = ({ data }) => { if (data === "parar") this.activo = false; };
  }

  process(entradas) {
    const entrada = entradas[0];
    const largo = entrada?.[0]?.length || 128;
    for (let i = 0; i < largo; i += 1) {
      // Mezcla a mono. Sin fuente conectada (micrófono perdido) llegan ceros:
      // así el reloj sigue y el silencio digital delata la desconexión.
      let valor = 0;
      if (entrada?.length) {
        for (let c = 0; c < entrada.length; c += 1) valor += entrada[c][i] || 0;
        valor /= entrada.length;
      }
      if (this.n === 0) this.inicio = currentFrame + i;
      this.bloque[this.n++] = valor;
      if (this.n === this.tamano) {
        this.port.postMessage({ muestras: this.bloque, frame: this.inicio }, [this.bloque.buffer]);
        this.bloque = new Float32Array(this.tamano);
        this.n = 0;
      }
    }
    return this.activo;
  }
}

registerProcessor("captura-pcm", CapturaPcm);
