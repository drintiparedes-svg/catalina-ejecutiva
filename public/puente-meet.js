// Puente con la videollamada (Google Meet, Zoom o Teams en el navegador).
//
// Catalina y la reunión viven en pestañas distintas y, sin este puente, sólo
// se «tocan» a través de los parlantes y el micrófono. Ahí la cancelación de
// eco de cada lado borra al otro: la reunión no oye a Catalina y Catalina no
// oye a la reunión. Con audífonos, directamente no se oyen.
//
// El puente captura el audio de la pestaña de la reunión (la persona elige esa
// pestaña y marca «Compartir audio de la pestaña»). Ese audio —las voces de
// quienes están al otro lado— se usa para dos cosas:
//   · entra al oído de Catalina, mezclado con el micrófono (mezclarEntrada en
//     cada sesión de voz);
//   · se graba y transcribe en alta fidelidad (grabadora.js).
//
// La otra mitad la hace la propia videollamada: al presentar la pestaña de
// Catalina con su audio (en Meet: Presentar ahora → Una pestaña → Catalina →
// «Compartir también el audio de la pestaña»), todos la ven y la oyen.

export const puenteDisponible = () => Boolean(navigator.mediaDevices?.getDisplayMedia);

// Tiene que llamarse dentro del clic que lo pide: el navegador no deja
// compartir una pestaña de otro modo.
export async function conectarConReunion({ alTerminar } = {}) {
  let captura;
  try {
    captura = await navigator.mediaDevices.getDisplayMedia({
      // Chrome exige pedir vídeo para compartir el audio de una pestaña; el
      // vídeo se desactiva en cuanto llega. Se pide mínimo —un cuadro por
      // segundo, tamaño miniatura— porque capturar la reunión a resolución
      // completa roba al equipo el tiempo que necesita la voz.
      video: { frameRate: { max: 1 }, width: { max: 320 }, height: { max: 240 } },
      audio: {
        // Sin procesado: es audio de la reunión, no de un micrófono, y la
        // supresión de ruido lo degrada.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Que la reunión se siga oyendo en este equipo mientras se captura.
        suppressLocalAudioPlayback: false
      },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: "exclude"
    });
  } catch (error) {
    return { ok: false, error: error?.name === "NotAllowedError" ? "No se compartió la pestaña de la reunión." : "El navegador no pudo compartir la pestaña." };
  }

  const audio = captura.getAudioTracks();
  if (!audio.length) {
    captura.getTracks().forEach(p => p.stop());
    return { ok: false, error: "La pestaña se compartió sin audio: vuelve a intentarlo y marca «Compartir audio de la pestaña»." };
  }
  captura.getVideoTracks().forEach(p => { p.enabled = false; });
  // Si se deja de compartir desde la barra de Chrome, se avisa en vez de
  // seguir creyendo que Catalina oye la reunión.
  audio[0].addEventListener("ended", () => alTerminar?.());

  return {
    ok: true,
    flujo: new MediaStream(audio),
    detener: () => captura.getTracks().forEach(p => p.stop())
  };
}
