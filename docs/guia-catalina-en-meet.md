# Catalina en una videollamada (Google Meet): guía paso a paso

Objetivo: que Catalina **oiga** a todos los participantes, que todos la **vean y
oigan** cuando interviene, y que la reunión quede **grabada y transcrita** para el
acta. No hace falta instalar nada: sólo Chrome.

## Cómo funciona (en una línea)

Catalina oye la reunión porque compartes con ella la **pestaña de Meet**; la reunión
ve y oye a Catalina porque en Meet **presentas la pestaña de Catalina** con su audio.

## Antes de la reunión

1. Usa **Chrome** en el computador (no en el teléfono).
2. Usa **audífonos**. Con el puente, Catalina ya no depende de los parlantes y los
   audífonos evitan ecos.
3. Abre dos pestañas: la reunión de Meet y Catalina.

## Al empezar

1. En Catalina: **Iniciar conversación** (para que pueda hablar) → **Modo Meet**.
2. En el diálogo: elige el **tipo de reunión**, completa título y objetivo, deja
   marcadas **Conectar con la videollamada** y **Alta fidelidad** → **Empezar a
   escuchar**.
3. Chrome pregunta qué compartir: elige **la pestaña de Meet** y activa **«Compartir
   también el audio de la pestaña»** → Compartir.
4. Ve a la pestaña de Meet: **Presentar ahora → Una pestaña** → elige **la pestaña de
   Catalina** y activa **«Compartir también el audio de la pestaña»** → Compartir.
   Ahora todos ven el avatar.
5. Vuelve a la pestaña de Catalina: el indicador debe decir «conectada a la
   videollamada · alta fidelidad con audio de la reunión».

## Durante la reunión

- Catalina **escucha y graba en silencio**.
- Cuando alguien pida su opinión, pulsa **P** (o «Participar Catalina»): recibe lo
  conversado como memoria, se incorpora con una síntesis breve y conversa con todos.
- Vuelve a pulsar **P** para que deje de participar. La grabación continúa.
- Los demás participantes **no pueden despertarla diciendo su nombre**: tú la activas.
- Para darle **documentos** (presentación, informe, planilla, imágenes…): botón
  **«Insumos»** o arrástralos a la pantalla. Catalina los usa como antecedente y
  van al acta. También se pueden elegir al crear la reunión.

## Reuniones presenciales: que no se corte

- **Equipo.** Conectado al cargador, con la tapa abierta y la pestaña de Catalina a
  la vista. Mientras graba, la pantalla no se apaga.
- **Micrófono.** En «Micrófono para grabar», elige el **del Mac** o uno con
  cable. Los audífonos Bluetooth captan sobre todo tu voz y se desconectan
  para ahorrar energía.
- **Pestaña.** Muestra «● Grabando». Si cambia a «⚠ Sin grabar», Catalina está
  reconectando el micrófono o el audio, y la señal en pantalla dice por qué.
- **Si se corta.** Sin internet, sigue grabando y transcribe al volver la red.
  Si se cierra la pestaña, lo grabado se completa al reabrir Catalina.
- **Al terminar.** El aviso muestra la cobertura y, si faltó audio, cuánto y por
  qué.

Ajustes del Mac recomendados en
[`continuidad-de-grabacion.md`](continuidad-de-grabacion.md#4-ajustes-recomendados-para-el-mac-alternativa-c).

## Al terminar

1. **Terminar reunión** (en Catalina) y deja de presentar en Meet.
2. **Generar acta** → revisa → exporta (PDF, HTML, Markdown o correo).

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Los demás no oyen a Catalina | Al presentar no se marcó «Compartir también el audio de la pestaña» | Deja de presentar y vuelve a presentar la pestaña de Catalina con audio |
| Catalina no oye a los demás | Se compartió otra pestaña, o sin audio | Termina y vuelve a empezar la reunión eligiendo la pestaña de Meet con audio |
| El indicador dice «Se dejó de compartir la pestaña de la reunión» | Se pulsó «Dejar de compartir» en la barra de Chrome | Termina y vuelve a empezar (la reunión se puede continuar) |
| Lo que dicen los demás no aparece en el acta | Alta fidelidad desactivada o sin clave de transcripción | Actívala; revisa las claves de OpenAI o Gemini |
| Eco o voz duplicada | Parlantes en vez de audífonos | Usa audífonos |
| La voz de Catalina se oye entrecortada | (1) Llegada irregular del audio (red o equipo cargado); (2) el audio de la reunión la interrumpía mientras hablaba | Corregido en la versión 2026-09-30: colchón de voz adaptativo y compuerta que corta el audio de la reunión mientras ella habla. Si persiste, abre la consola (F12) y ejecuta `catalina.session.diagnostico()`: `cortes` altos = red o equipo; `interrupciones` altas = ruido o eco de la llamada |
| La transcripción quedó incompleta en una reunión presencial | Pantalla apagada o equipo en reposo, audífonos Bluetooth desconectados, red caída | Revisa el informe de cobertura (aviso final o página de Actas): dice la causa de cada hueco. Usa «Completar transcripción» en Actas si quedaron tramos pendientes |
| Los participantes no pueden interrumpirla hablando | Efecto buscado de la compuerta: mientras habla, Catalina no oye la videollamada (sí tu micrófono) | Interrúmpela tú por el micrófono o pulsa P; lo que dicen los demás igual queda grabado en el acta |

## Límites

- Mientras presentas a Catalina, la presentación de Meet está ocupada por ella.
- Catalina figura como tu presentación, no como un participante con nombre propio.
- La transcripción de alta fidelidad no identifica quién habla.
- Privacidad: el audio se envía a los proveedores de voz y transcripción. No usar
  con datos identificables de pacientes sin la autorización institucional.
