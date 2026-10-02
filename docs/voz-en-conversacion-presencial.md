# Voz en conversación presencial: eco, cortes, texto repetido y latencia

Fecha: 3 de octubre de 2026 · Versión 2026-10-03.29

## 1. Síntomas reportados

En una conversación presencial (sin audífonos):

- el micrófono no capta bien;
- las respuestas se cortan y se sienten poco fluidas;
- el texto se repite en el historial;
- se pide reducir la latencia.

## 2. Causas encontradas

| # | Causa | Evidencia | Efecto |
|---|---|---|---|
| 1 | **El cancelador de eco de Chrome no conocía la voz de Catalina.** Chrome solo usa como referencia lo que suena por WebRTC. Con ElevenLabs y Gemini, la voz llega por WebSocket y suena por Web Audio | Documentado por Atmoky (https://docs.atmoky.com/known-issues) y Babylon.js (https://github.com/BabylonJS/Babylon.js/issues/13247). El SDK oficial de ElevenLabs en modo WebSocket usa la misma cadena; para resolverlo, ElevenLabs migró a WebRTC (https://elevenlabs.io/blog/conversational-ai-webrtc) | La voz vuelve por el micrófono y el agente la toma como alguien hablándole encima. Se interrumpe, vuelve a empezar y se oye entrecortado |
| 2 | **Audio tardío de una respuesta ya interrumpida.** Se reproducía | El SDK oficial descarta los `audio` con `event_id` ≤ el de la interrupción (`elevenlabs/packages`, `BaseConversation.ts`) | Restos de la respuesta anterior tras cada corte |
| 3 | **Texto repetido.** Tras una interrupción, ElevenLabs envía `agent_response_correction` (lo que alcanzó a decir) y a veces el texto completo. La interfaz abría un turno nuevo con cada uno | Documentación de eventos de cliente de ElevenLabs: la corrección actualiza un mensaje ya mostrado | La misma respuesta aparece dos o tres veces en el historial y en el acta |
| 4 | **Captura del micrófono degradada.** Se bajaba de 48 a 16 kHz por interpolación lineal, sin filtro: el ruido sobre 8 kHz se pliega sobre la voz. Además corría en el hilo principal, con bloques de 43 ms | Medido: con el método anterior, un tono de 10–12 kHz pasaba a 0 dB | Voz más sucia para el reconocimiento del agente, y bloques perdidos si la página iba cargada |

## 3. Cambios

1. **Cancelación de eco en dos niveles.**
   - Se pide `echoCancellation: "all"` (Chrome 141+), que cancela todo lo que suena en el equipo. Si el navegador lo concede, la voz suena directa.
   - Si no lo concede, la voz pasa por una conexión WebRTC local (`public/audio/eco.js`) y se convierte en referencia del cancelador. Va en Opus a 128 kbps, sin DTX y con un búfer mínimo.
   - Los labios se retrasan lo mismo que la ruta, para que boca y voz sigan sincronizadas.
2. **Se descarta el audio tardío** de una respuesta interrumpida, y también su texto completo, que no llegó a decirse.
3. **La corrección reemplaza el turno anterior**, en pantalla y en el acta, en lugar de crear uno nuevo.
4. **Nueva captura del micrófono** (`public/realtime/entrada.js`).
   - Corre en el hilo de audio (AudioWorklet), con bloques de 20 ms.
   - Baja a 16 kHz con un filtro anti-aliasing: FIR sinc con ventana de Blackman, 65 coeficientes y 0,7 ms de retardo.
   - Usa micrófono mono, como recomienda ElevenLabs para la cancelación de eco.
5. **Iconografía.**
   - El rayo es la marca de Catalina y su señal de estado: gris en reposo, cian y con brillo cuando está en línea. Se usa también como favicon y en la página de Actas.
   - Los controles llevan iconos de línea de la misma familia: trazo de 1,6 px, extremos redondeados y retícula de 24.
   - En el teléfono, los interruptores quedan solo con icono, con etiqueta accesible.

## 4. Mediciones (Chromium 141, agente simulado)

| Medida | Antes | Ahora |
|---|---|---|
| Bloque de micrófono enviado | 43 ms | 20 ms |
| Tono de 10 kHz tras bajar a 16 kHz (plegado sobre la voz) | 0 dB | −79 dB |
| Voz de 300 Hz a 5 kHz | — | sin pérdida (±0,2 dB) |
| Audio tardío tras una interrupción | sonaba | descartado |
| Historial tras una respuesta interrumpida | duplicado | un solo turno, con lo que de verdad dijo |
| Retardo de la ruta de eco (solo si Chrome no concede `"all"`) | — | 55 ms |
| Cortes del reproductor, banco de 5 escenarios | 0–1 | 0–1 (sin regresión) |

**Sobre la latencia.**
- Probé bajar el colchón del reproductor de 180 a 140 ms. Bajo estrés de red (jitter de 150 a 250 ms) reaparecieron los cortes y la ganancia era de solo 40 ms, así que se mantuvo en 180 ms. Prioricé la fluidez.
- Lo que más reduce la latencia percibida es dejar de interrumpirse a sí misma. Con el eco, cada respuesta se cortaba y se volvía a generar.

## 5. Límites y lo que falta verificar

- **Cancelación de eco real.** No se puede comprobar en el entorno de pruebas, porque los dispositivos son simulados y no hay parlantes ni micrófono reales. Hay que probarla en el Mac, sin audífonos.
- **Modo `"all"`.** En Chromium 141 de pruebas se informó `echoCancellation: true`, no `"all"`. No sé si el Chrome de macOS lo concede: si lo hace, la consola muestra «Cancelación de eco del sistema activa». Si no, se usa la ruta WebRTC.
- **Latencia del agente.** El grueso de la latencia está en el servidor: detección del fin de turno, modelo de lenguaje y síntesis de voz. Esos ajustes viven en el agente de ElevenLabs y **no se pueden cambiar desde el cliente** (https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides).

## 6. Propuestas pendientes de aprobación (Nivel 2)

1. **Ajustar el agente de ElevenLabs para baja latencia.** Afecta a todas las conversaciones; se puede hacer por API, como ya se registran las herramientas.
   - `turn_eagerness: "eager"` y `turn_timeout` corto.
   - Turno especulativo, si está disponible [NV].
   - Voz con el modelo Flash v2.5 (~75 ms; https://docs.cdntest.elevenlabs.io/models).
   - Un modelo de lenguaje rápido (Gemini 2.5 Flash, recomendado por ElevenLabs: https://elevenlabs.io/blog/gemini-25-flash).
2. **Migrar la conexión con ElevenLabs a WebRTC.**
   - Es la vía que recomienda ElevenLabs desde julio de 2025 y la predeterminada de su SDK desde marzo de 2026.
   - Ofrece cancelación de eco y supresión de ruido nativas, y menos latencia.
   - Exige un token de servidor y la librería LiveKit.
   - Falta verificar que conserve la alineación con la que se mueven los labios [NV].
