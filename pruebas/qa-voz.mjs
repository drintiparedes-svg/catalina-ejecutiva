import { escenario, informar } from "./qa-banco.mjs";
const r = [];

// La sesión de ElevenLabs de verdad, con un micrófono falso del navegador
// (Chromium con --use-fake-device-for-media-stream) y un WebSocket doble que
// guarda lo que se le manda y deja meter mensajes como si vinieran del agente.
// Lo único simulado es el servidor de ElevenLabs; el audio recorre el camino
// entero: micrófono → worklet → PCM → base64 → socket, y de vuelta al
// reproductor.
const SOCKET_FALSO = `
window.__ws = null;
class WebSocketFalso extends EventTarget {
  constructor(url) {
    super();
    this.url = url; this.readyState = 0; this.enviados = [];
    window.__ws = this;
    setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 30);
  }
  send(texto) { this.enviados.push(JSON.parse(texto)); }
  close() { this.readyState = 3; this.dispatchEvent(new CloseEvent("close", { code: 1000 })); }
  // Como si lo mandara el agente.
  recibir(mensaje) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(mensaje) })); }
}
WebSocketFalso.OPEN = 1; WebSocketFalso.CONNECTING = 0; WebSocketFalso.CLOSED = 3;
window.WebSocket = WebSocketFalso;
// El «micrófono» es un tono de 440 Hz generado en el propio navegador. Con una
// señal conocida se puede comprobar que llega al agente entera y a la
// frecuencia correcta, cosa que con el dispositivo falso de Chromium —que en
// headless calla— no se podía.
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const osc = ctx.createOscillator(); osc.frequency.value = 440;
  const destino = ctx.createMediaStreamDestination();
  osc.connect(destino); osc.start();
  window.__tono = { ctx, osc };
  return destino.stream;
};
// El servidor firma la sesión: aquí no hay clave, así que se firma en falso.
const fetchAntes = window.fetch;
window.fetch = function (url, opciones) {
  if (String(url) === "/elevenlabs/sesion") {
    return Promise.resolve(new Response(JSON.stringify({ url: "wss://falso.elevenlabs/convai", inicio: { type: "conversation_initiation_client_data" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return fetchAntes.apply(this, arguments);
};
`;

r.push(await escenario("El micrófono llega al agente por el camino nuevo", `
  window.catalina.disponible.elevenlabs = true;
  const t0 = performance.now();
  $("#connect").click();
  await dormir(1500);
  const sesion = window.catalina.session;
  anotar("Conecta con ElevenLabs", window.catalina.proveedor === "elevenlabs" && sesion?.connected === true,
    "proveedor " + window.catalina.proveedor + " · conectada " + sesion?.connected);
  anotar("Lo primero que manda es el inicio de la conversación",
    window.__ws?.enviados[0]?.type === "conversation_initiation_client_data", JSON.stringify(window.__ws?.enviados[0]).slice(0, 80));

  anotar("La captura va a 16 kHz, la frecuencia del agente, sin remuestrear a mano",
    sesion.entrada?.sampleRate === 16000, "sampleRate=" + sesion.entrada?.sampleRate);
  anotar("Y la hace un worklet en el hilo de audio, no el procesador antiguo",
    sesion.nodoEntrada instanceof AudioWorkletNode, String(sesion.nodoEntrada?.constructor?.name));

  // El agente confirma el formato, como hace de verdad.
  window.__ws.recibir({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { agent_output_audio_format: "pcm_24000", user_input_audio_format: "pcm_16000" } });

  const antes = window.__ws.enviados.filter(m => m.user_audio_chunk).length;
  await dormir(1000);
  const trozos = window.__ws.enviados.filter(m => m.user_audio_chunk).slice(antes);
  anotar("Salen unos diez lotes de audio por segundo", trozos.length >= 8 && trozos.length <= 12, trozos.length + " lotes en 1 s");
  const bytes = Uint8Array.from(atob(trozos[trozos.length - 1].user_audio_chunk), c => c.charCodeAt(0));
  anotar("Cada lote son 100 ms de PCM de 16 bits: 1600 muestras, 3200 bytes", bytes.length === 3200, bytes.length + " bytes");
  const enteros = new Int16Array(bytes.buffer);
  anotar("Y trae la señal del micrófono, no ceros", enteros.some(v => Math.abs(v) > 1000), "pico: " + Math.max(...enteros.map(Math.abs)));
  // Un tono de 440 Hz cruza el cero 880 veces por segundo: 88 en 100 ms. Si el
  // remuestreo a 16 kHz estuviera mal, la cuenta saldría otra.
  let cruces = 0; for (let i = 1; i < enteros.length; i += 1) if ((enteros[i - 1] < 0) !== (enteros[i] < 0)) cruces += 1;
  anotar("Y llega a la frecuencia correcta: 440 Hz siguen siendo 440 Hz tras pasar a 16 kHz",
    cruces >= 84 && cruces <= 92, cruces + " cruces por cero en 100 ms (esperados 88)");

  // Callar al agente corta el envío sin apagar el micrófono.
  sesion.pausarEnvio(true);
  const cortados = window.__ws.enviados.length;
  await dormir(600);
  anotar("Con el envío en pausa no sale ni un lote", window.__ws.enviados.length === cortados, (window.__ws.enviados.length - cortados) + " lotes de más");
  sesion.pausarEnvio(false);
  await dormir(400);
  anotar("Y al reanudar vuelven a salir", window.__ws.enviados.length > cortados, "");

  // Audio de vuelta: un trozo del agente llega al reproductor y la cara habla.
  const muestras = new Int16Array(2400); for (let i = 0; i < 2400; i += 1) muestras[i] = Math.round(Math.sin(i / 10) * 12000);
  const b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(muestras.buffer)));
  window.__ws.recibir({ type: "audio", audio_event: { audio_base_64: b64 } });
  await dormir(200);
  anotar("El audio del agente entra al reproductor", sesion.encoladas === 2400, "encoladas=" + sesion.encoladas);
  anotar("Y la cara pasa a hablar", window.catalina.director.state === "speaking", window.catalina.director.state);

  // Interrupción: se vacía todo.
  window.__ws.recibir({ type: "interruption" });
  await dormir(100);
  anotar("Una interrupción vacía la cola y vuelve a escuchar", sesion.encoladas === 0 && window.catalina.director.state === "listening", sesion.encoladas + " / " + window.catalina.director.state);

  $("#connect").click(); await dormir(300);
  anotar("Finalizar cierra limpio", sesion.connected === false && $("#connect").textContent === "Iniciar conversación", $("#connect").textContent);
`, { previoExtra: SOCKET_FALSO, espera: 60000 }));

process.exit(informar(r) ? 1 : 0);
