// Que el cancelador de eco del navegador conozca la voz de Catalina.
//
// En una conversación presencial sin audífonos, la voz de Catalina sale por
// los parlantes y vuelve a entrar por el micrófono. El cancelador de eco de
// Chrome la quitaría, pero sólo si sabe qué se está reproduciendo, y su
// referencia es lo que suena a través de WebRTC. Con ElevenLabs y Gemini el
// audio llega por WebSocket y suena por Web Audio: el cancelador no lo ve, el
// agente se oye a sí mismo, lo toma por alguien hablándole encima, se
// interrumpe y vuelve a empezar. Eso producía respuestas cortadas, poco fluidas
// y el texto repetido en el historial.
//
// La solución conocida es pasar la voz por una conexión WebRTC local (dos
// RTCPeerConnection en la misma página) y reproducir la pista recibida: así
// suena por el camino de WebRTC y pasa a ser la referencia del cancelador.
// Cuesta unas decenas de milisegundos y una codificación Opus a alta tasa. Si
// el navegador no lo permite, se reproduce directo, como antes.

const TASA_OPUS = 128000;   // alta: la voz no debe perder calidad en el rodeo
const ESPERA_MS = 3000;

export async function conCancelacionDeEco(stream) {
  const directo = { stream, enRuta: false, cerrar() {} };
  if (!window.RTCPeerConnection || !stream?.getAudioTracks?.().length) return directo;

  const emisor = new RTCPeerConnection();
  const receptor = new RTCPeerConnection();
  const cerrar = () => { try { emisor.close(); } catch {} try { receptor.close(); } catch {} };
  try {
    emisor.onicecandidate = e => { if (e.candidate) receptor.addIceCandidate(e.candidate).catch(() => {}); };
    receptor.onicecandidate = e => { if (e.candidate) emisor.addIceCandidate(e.candidate).catch(() => {}); };
    const recibido = new Promise(ok => {
      receptor.ontrack = e => ok(e.streams[0] || new MediaStream([e.track]));
    });
    for (const pista of stream.getAudioTracks()) emisor.addTrack(pista, stream);

    const oferta = await emisor.createOffer();
    await emisor.setLocalDescription(oferta);
    await receptor.setRemoteDescription(oferta);
    const respuesta = await receptor.createAnswer();
    respuesta.sdp = opusDeAltaCalidad(respuesta.sdp);
    await receptor.setLocalDescription(respuesta);
    await emisor.setRemoteDescription(respuesta);

    const remoto = await Promise.race([recibido, new Promise((_, mal) => setTimeout(() => mal(new Error("sin pista")), ESPERA_MS))]);
    // Búfer mínimo: es una conexión dentro del mismo equipo, sin red de por medio.
    for (const r of receptor.getReceivers()) {
      try { if ("jitterBufferTarget" in r) r.jitterBufferTarget = 0; } catch {}
    }
    return { stream: remoto, enRuta: true, cerrar };
  } catch (error) {
    console.warn("Cancelación de eco: se reproduce directo", error);
    cerrar();
    return directo;
  }
}

// Opus mono a tasa alta, sin DTX (que recortaría las pausas) y con FEC.
function opusDeAltaCalidad(sdp) {
  const tipo = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!tipo) return sdp;
  const parametros = `minptime=10;useinbandfec=1;usedtx=0;stereo=0;maxaveragebitrate=${TASA_OPUS}`;
  const linea = new RegExp(`a=fmtp:${tipo} [^\\r\\n]*`);
  return linea.test(sdp)
    ? sdp.replace(linea, `a=fmtp:${tipo} ${parametros}`)
    : sdp.replace(new RegExp(`(a=rtpmap:${tipo} opus\\/48000[^\\r\\n]*)`, "i"), `$1\r\na=fmtp:${tipo} ${parametros}`);
}
