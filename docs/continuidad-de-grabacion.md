# Continuidad de la grabación en reuniones

Fecha: 2 de octubre de 2026 · Versión de la aplicación: 2026-10-02.28

## 1. Problema

En reuniones presenciales grabadas con un MacBook, a veces audífonos Bluetooth,
la transcripción quedaba incompleta. La hipótesis del usuario era que el equipo
desconectaba cosas para ahorrar energía. La revisión del código la confirmó como
plausible: el modo reunión no resistía ninguna de esas interrupciones y, además,
no las registraba. Por eso no se podía saber cuál ocurrió.

| # | Debilidad encontrada | Efecto |
|---|---|---|
| 1 | No se pedía mantener la pantalla encendida | Con pantalla apagada, reposo o tapa cerrada, no se graba |
| 2 | No se vigilaba el micrófono | Si el sistema apagaba unos audífonos o un USB, la grabación seguía «grabando» silencio sin avisar |
| 3 | No se reanudaba el audio pausado por el sistema | Grabadora detenida sin error |
| 4 | El rearranque del reconocimiento del navegador dependía de temporizadores, que Chrome frena en pestañas ocultas | La transcripción de respaldo podía tardar minutos en volver |
| 5 | Un tramo que fallaba tres veces se descartaba | Hueco irrecuperable ante un corte de red |
| 6 | La captura corría en el hilo principal (ScriptProcessor, obsoleto) | Bloques de audio perdidos sin aviso con la pestaña en segundo plano o el equipo cargado |
| 7 | La cobertura sólo contaba los fallos de transcripción | Marcaba 100 % aunque faltaran minutos de audio |

## 2. Qué se implementó (alternativas A y B, aprobadas)

**A. Resistencia al ahorro de energía**
- **Bloqueo de reposo de pantalla** (`public/continuidad.js`). Se pide al
  empezar y se vuelve a pedir cada vez que la pestaña vuelve a estar visible,
  porque el navegador lo suelta al ocultarla.
- **Vigilancia del micrófono** (`public/grabadora.js`). Detecta cuatro señales:
  - la pista termina (`ended`);
  - el sistema la silencia más de 3 s (`mute`);
  - cambian los dispositivos (`devicechange`);
  - hay **silencio digital**: ceros exactos durante 8 s, porque un micrófono
    vivo siempre tiene algo de ruido.

  En cualquiera de esos casos reabre el micrófono con espera creciente. Si el
  elegido ya no está, usa el del sistema.
- **Audio pausado por el sistema**: se detecta (`statechange`) y se reanuda,
  también al volver a la pestaña.
- **Captura en el hilo de audio** (`public/audio/captura-pcm.js`, un
  AudioWorklet). Si el navegador no lo admite, se usa el ScriptProcessor
  anterior.
- **Detección de audio perdido**. Se compara el reloj de audio con el de pared:
  si el audio avanzó menos, se detuvo, por ejemplo por equipo suspendido. Se usa
  el mínimo de una ventana de bloques para no confundir un retraso del hilo
  principal con audio perdido.
- **Latido**: el rearranque del reconocimiento del navegador se dispara con
  cada bloque de audio, no con temporizadores.
- **Avisos**:
  - el título de la pestaña muestra «● Grabando» o «⚠ Sin grabar»;
  - la señal en pantalla explica qué pasa y cuándo se recupera.
- **Informe de cobertura**. Cada interrupción queda en `reunion.continuidad`
  con hora, causa y duración. Aparece en:
  - el aviso al terminar;
  - la página de Actas;
  - la transcripción que recibe el modelo, como «[SIN AUDIO ~N s: no se grabó — causa]»;
  - la trazabilidad del acta.
- **Selector de micrófono** en el diálogo de la reunión, que recuerda la
  elección. Si el elegido es Bluetooth, avisa que en una reunión presencial
  capta sobre todo a quien lo lleva.
- **Reuniones interrumpidas**. Si la pestaña se cierra a mitad de reunión, al
  reabrir se cierra en su último momento de actividad y queda anotado. Sin esto
  quedaba «en curso» para siempre.

**B. Respaldo local del audio y recuperación** (`public/archivo-audio.js`)
- **Cuándo se guarda.** Cada tramo con voz se guarda en IndexedDB **antes** de
  enviarlo a transcribir.
- **Formato.** IMA ADPCM de 4 bits a 16 kHz. En la prueba, la relación
  señal/ruido supera los 20 dB.
- **Cuándo se recupera.** Lo que no se transcribió se vuelve a transcribir:
  - al volver la red, durante la reunión;
  - al terminar la reunión;
  - al reabrir la aplicación, si la pestaña se cerró con tramos en vuelo;
  - con «Completar transcripción» en la página de Actas;
  - siempre antes de redactar el acta.
- **Conservación** (decisión del usuario): el audio se borra al generar el acta
  o a los 7 días, lo que ocurra primero. Excepción: los tramos que aún no se
  pudieron transcribir se conservan hasta los 7 días para poder reintentarlos.
  Al borrar una reunión se borra su audio.

**Desviación respecto de lo propuesto.** Se había estimado unos 15 MB por hora
de audio guardado. El formato elegido ocupa unos 29 MB por hora y solo se
guardan los tramos con voz. Elegí ADPCM y no Opus (unos 11 MB por hora) porque:
- se codifica y decodifica en JavaScript puro, igual en cualquier navegador;
- se puede probar sin navegador;
- no depende de la API WebCodecs.

Si el espacio importa, se puede migrar a Opus.

## 3. Límites que no resuelve el software

- **Tapa cerrada o equipo en reposo.** No hay grabación posible. Queda
  registrado como hueco con su causa, pero el audio no existe.
- **Bloqueo de pantalla.**
  - Solo funciona con la pestaña de Catalina **visible**. En una reunión
    presencial suele estarlo; si se cambia de pestaña o se minimiza la ventana,
    el navegador lo suelta.
  - No encontré documentación oficial de que en macOS impida también el reposo
    del sistema por inactividad. Por eso el ajuste de energía del Mac (sección
    4) sigue siendo necesario.
- **Microfonos Bluetooth.** Que el sistema elija otro micrófono al reconectar
  se resuelve; que el micrófono de unos audífonos capte poco la sala, no.
  Para reuniones presenciales: micrófono del notebook o uno con cable.
- **En el navegador sin pruebas reales.** No se probó Safari ni un MacBook real
  entrando en reposo. Las pruebas usan Chromium automatizado, que simula las
  fallas. El bloqueo de pantalla no se pudo verificar, porque el navegador sin
  pantalla de las pruebas lo rechaza; queda verificar en el equipo real que el
  registro muestre «bloqueo-pantalla».

## 4. Ajustes recomendados para el Mac (alternativa C)

1. **Chrome → Configuración → Rendimiento.**
   - Agrega el sitio de Catalina a «Mantener siempre activos estos sitios».
   - Desactiva «Ahorro de energía» durante las reuniones.
2. **Configuración del Sistema → Batería → Opciones.** Activa «Evitar el reposo
   automático con el adaptador de corriente cuando la pantalla está apagada».
   Usa el cargador en reuniones largas.
   - https://support.apple.com/guide/mac-help/mchlfc3b7879/mac
3. **Modo de bajo consumo.** Desactívalo, o déjalo solo para la batería.
   - https://support.apple.com/101613
4. **AirPods.** Configuración → AirPods → Conectar a este Mac → «Cuando se
   conectó por última vez a este Mac», para que no salten al iPhone a mitad de
   reunión. Para la sala, usa el micrófono del Mac.
   - https://support.apple.com/104988
5. **Durante la reunión.** Tapa abierta y la pestaña de Catalina a la vista, en
   una ventana propia.

## 5. Evaluación de la transcripción nativa de Google Meet (alternativa D1)

**Fuentes y advertencias.**
- Las fuentes se obtuvieron el 2 de octubre de 2026 a partir de resultados de
  búsqueda que citan páginas oficiales de Google. No se pudieron abrir
  directamente.
- [NV] significa no verificado y [3P] significa fuente de un tercero.
- Antes de decidir, conviene confirmarlo en la consola de administración de
  Workspace de la institución.

| Aspecto | Hallazgo |
|---|---|
| Ediciones | **Transcripciones:** Business Standard y Plus, Enterprise, Education Plus. **«Tomar notas por mí»** (Gemini): Business Standard y Plus, Enterprise Standard y Plus. **Business Starter no incluye ninguna** [3P para Starter]. Falta confirmar la edición de la institución. Fuentes: https://support.google.com/meet/answer/12849897 · https://support.google.com/a/answer/15071792 |
| Español | Disponible en transcripciones desde marzo de 2025 y en «Tomar notas por mí». No hay una variante específica para Chile [NV]. Fuente: https://support.google.com/meet/answer/14925782 |
| **Reuniones presenciales** | **Según medios especializados, desde agosto de 2026 «Tomar notas por mí» funciona en reuniones presenciales:** se inicia en el teléfono o en meet.google.com y el dispositivo queda sobre la mesa como grabadora [3P; falta la página oficial]. Fuente: https://9to5google.com/2026/08/13/google-meet-take-notes-in-person/ |
| Resultado | Un Google Doc en el Drive del organizador, con resumen, transcripción, hablantes y horas. Disponible en horas [3P para el plazo]. |
| Administración | Se activa en la consola: Meet → Meeting transcripts, y Gemini → AI note-taking. |
| Acceso automático | La API REST de Meet (`conferenceRecords.transcripts.entries`) es GA y conserva las entradas 30 días. Usa un alcance restringido que probablemente exige aprobación del administrador [NV]. El Doc también se exporta por la API de Drive. |
| Privacidad | Con el acuerdo de asociado comercial (BAA) de Google, Meet, Drive y Gemini en Workspace están cubiertos para HIPAA. **HIPAA no rige en Chile.** Falta la evaluación de la Ley 20.584 y la Ley 19.628 (modificada por la Ley 21.719) por parte de la institución. |

**Conclusión.** Para el problema reportado (cortes en reuniones presenciales),
la transcripción clásica de Meet **no aplica**: requiere una videollamada. La
que sí aplica es **«Tomar notas por mí» presencial** desde un teléfono, como
**segunda fuente independiente del notebook**: si el Mac se suspende, el
teléfono sigue grabando.

**Propuesta, pendiente de tu aprobación:**
- **Nivel 2:** una función «Combinar transcripción de Meet» en la página de
  Actas. Leería el Doc exportado o pegado y rellenaría, con su texto, los huecos
  de la grabación de Catalina, marcándolo como segunda fuente en la
  trazabilidad. La lectura de documentos ya existe.
- **Nivel 3:** la decisión de usar Gemini con conversaciones que puedan contener
  datos de pacientes corresponde a la institución, y la opción de leer las
  transcripciones automáticamente por la API necesita al administrador de
  Workspace.

## 6. Verificación

- **Pruebas unitarias** (`npm run test:continuidad`, 8 casos):
  - la relación señal/ruido del formato de audio guardado;
  - la recuperación de tramos sin duplicar y el error definitivo que no insiste;
  - los huecos con causa en la transcripción y en la cobertura;
  - las reuniones antiguas sin registro de continuidad;
  - el cierre de reuniones interrumpidas;
  - el latido con los temporizadores congelados.
- **Prueba de extremo a extremo** en Chromium real (16 verificaciones):
  - micrófono desconectado, con reaperturas que fallan → reconexión y hueco de
    3 s con su causa;
  - audio pausado 5 s → detectado, reanudado y registrado;
  - proveedor caído → tramo guardado localmente y recuperado al volver la red;
  - pestaña cerrada con un tramo en vuelo → completado al reabrir;
  - página de Actas con las causas y la transcripción que declara los huecos.
- **Pruebas de regresión**: reuniones, voz, documentos y puente con Meet.
