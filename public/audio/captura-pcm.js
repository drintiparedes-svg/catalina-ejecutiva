// Captura del micrófono, en el hilo de audio.
//
// Antes se hacía con un ScriptProcessorNode en el hilo principal: cada 43 ms
// remuestreaba, convertía a enteros y codificaba en base64, compitiendo con el
// dibujo de la cara y con lo que hubiera en marcha. Es un nodo que el navegador
// tiene marcado para desaparecer, y con motivo. Aquí sólo se juntan las
// muestras y se convierten a PCM de 16 bits; el hilo principal recibe un
// ArrayBuffer ya listo y lo único que hace es mandarlo.
//
// El contexto de captura va a la frecuencia que espera el agente, así que no
// hay que remuestrear a mano: lo hace el navegador en código nativo, con filtro,
// que además evita el aliasing que metía la interpolación lineal de antes.

class CapturaPcm extends AudioWorkletProcessor {
  constructor(opciones) {
    super();
    // Cuántas muestras se juntan por envío. Cien milisegundos: diez mensajes
    // por segundo, que es poco tráfico, y un retraso que no se nota al hablar.
    this.tamano = opciones?.processorOptions?.muestrasPorEnvio || 1600;
    this.lote = new Int16Array(this.tamano);
    this.llenas = 0;
    this.activa = true;
    this.port.onmessage = ({ data }) => {
      if (data?.tipo === "parar") this.activa = false;
    };
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal || !this.activa) return this.activa;

    for (let i = 0; i < canal.length; i += 1) {
      const v = Math.max(-1, Math.min(1, canal[i]));
      this.lote[this.llenas] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.llenas += 1;
      if (this.llenas === this.tamano) {
        // Se transfiere el búfer, no se copia: el hilo principal se queda con
        // él y aquí se estrena otro.
        this.port.postMessage({ tipo: "pcm", muestras: this.lote.buffer }, [this.lote.buffer]);
        this.lote = new Int16Array(this.tamano);
        this.llenas = 0;
      }
    }
    return true;
  }
}

registerProcessor("captura-pcm", CapturaPcm);
