# Catalina — avatar conversacional local

Prototipo local de voz a voz basado en OpenAI Realtime API. La clave permanece en el servidor local y nunca se entrega al navegador.

## Iniciar en macOS

1. Duplica `.env.example` como `.env` y pega tu `OPENAI_API_KEY`.
2. Haz doble clic en `start.command`.
3. En el navegador, pulsa **Iniciar conversación** y permite el micrófono.

También puedes ejecutar `npm start` si ya tienes Node.js instalado.

## Cómo se mueve el rostro

El retrato es una sola fotografía. Toda la gesticulación se consigue deformando
la piel real medida sobre la imagen, nunca superponiendo dibujos.

- **Mandíbula.** Un campo de arrastre continuo recorre la mitad inferior del
  rostro: el mentón baja hasta 16 px, la comisura sólo un tercio y la mejilla
  prácticamente nada. Es el giro de la articulación, no un bloque que se
  traslada, y por eso la línea mandibular acompaña sin dejar bordes.
- **Labios.** El labio superior pertenece al maxilar y tiene su propio campo:
  sube menos de un tercio de lo que baja el inferior y se ancla en la base de la
  nariz. La abertura se apoya en la curva real del surco labial —que baja hasta
  y≈407 en el centro y sube a y≈402 en las comisuras—, así que nunca aparece la
  barra negra recta que delata a un avatar.
- **Dientes.** La arcada superior cuelga del maxilar, así que su altura es
  **constante**: al abrir más la boca no crecen los dientes, crece la cavidad
  que queda debajo. Se dibuja pieza a pieza —dos centrales, dos laterales, dos
  caninos en punta y cuatro premolares— con los anchos *aparentes*, no los
  reales: la arcada es una curva que se aleja del observador, así que cada
  pieza se ve escorzada y su ancho en pantalla es el real por el coseno de su
  ángulo. Del central al segundo premolar el ancho aparente cae a la cuarta
  parte, y eso es lo que da la sensación de profundidad; con anchos parecidos la
  dentadura parece una valla.

  Las diez piezas forman **un solo trazado**. Difuminar cada diente por separado
  parecía lo natural, pero dos bordes contiguos desenfocados se componen al 75 %
  y dejan una costura oscura entre ellos: la dentadura se lee como una fila de
  azulejos. Con un trazado único el desenfoque suaviza contorno y separaciones
  por igual.

  El esmalte arranca pegado al borde del labio, sin franja de cavidad entre
  medias, y la sombra del labio se proyecta *encima* del diente, que es donde
  cae en un rostro real. Desaparece al redondear los labios (/o/, /u/) y en los
  cierres bilabiales.
- **Cavidad.** Se dibuja exactamente entre los dos bordes deformados, por
  detrás de los dientes, con volumen de lengua al fondo.
- **Comisuras.** El cigomático tira de ellas hacia arriba al articular vocales
  anteriores y las deja caer al redondear. Sin ese término la boca se abre y
  cierra como una ranura por muy bien que se muevan los labios.
- **Ojos.** Sacadas de 30–55 ms con fijaciones irregulares, deriva y micro-
  temblor entre ellas. El parpadeo cierra rápido y abre despacio, incluye
  parpadeos parciales y dobles, y se dispara en los cambios de turno, que es
  cuando parpadea una persona.
- **Cejas y cabeza.** Micro-levantamiento de ceja en las sílabas acentuadas y
  cabeceos ligados a la energía de la voz; asentimientos cortos mientras
  escucha. El movimiento base es ruido de valor en varias octavas, no un bucle
  de senos, para que no se repita.
- **Respiración.** Inspiración corta y espiración larga, más rápida al hablar,
  con una inspiración al empezar cada turno.

En reposo el rostro sigue vivo: respira, parpadea, mira alrededor, traga y
entreabre los labios antes de tomar el turno.

## Expresiones

`director.setExpression(nombre, intensidad)` admite `neutra`, `alegria`,
`sorpresa`, `preocupacion`, `enfado` y `concentracion`. No son máscaras
superpuestas: cada una mueve los mismos cinco mandos que ya usa el habla —altura
de ceja, inclinación de ceja, entornado de párpado, comisura y presión labial—,
con recorridos deliberadamente cortos. En un rostro real la diferencia entre
preocupación y enfado son dos milímetros de ceja, no una mueca.

La inclinación es lo que separa unas de otras: la preocupación levanta la cabeza
de la ceja y deja caer la cola; el enfado hace justo lo contrario. El entornado
convive con el parpadeo —el párpado recorre la apertura que le queda—, y cada
cambio de expresión se interpola en unos 350 ms y arrastra un parpadeo, como
ocurre al recomponer la cara.

`EXPRESSION_GAIN` al principio de `animation/director.js` sube o baja todo el
repertorio a la vez sin tocar el equilibrio entre expresiones.

```bash
node work/render_expression_sheet.mjs work/expresiones.png
```

## Cómo se lee la voz

El movimiento labial analiza el audio WebRTC recibido, no el micrófono. Usa una
adaptación local de la ruta `MediaStream` de
[`Amoner/lipsync-engine`](https://github.com/Amoner/lipsync-engine) (MIT, en
`public/vendor/lipsync-engine`) para la fontanería de audio y las pistas
consonánticas, y sobre su mismo analizador corre una estimación continua del
espectro:

- **F1** (250–1050 Hz) da la apertura de la mandíbula.
- **F2** (950–2900 Hz) separa vocales anteriores de posteriores, es decir
  labios estirados de labios redondeados.
- La energía sobre 4 kHz delata las sibilantes /s/ y /ʃ/.
- Una caída brusca de sonoridad entre dos tramos sonoros es un cierre bilabial
  /p, b, m/.

De ahí sale un triple continuo (apertura, estiramiento, redondeo) en lugar de
saltar entre quince posturas fijas, que es lo que hacía que todas las sílabas se
vieran iguales. No requiere MuseTalk, Wav2Lip, GPU ni una API externa de avatar.

Las constantes de mapeo al principio de `audio/voice-shape.js` están calibradas
sobre la distribución real de la voz de la API, no sobre la tabla de vocales
aisladas: medida sobre `gpt-realtime-2.1` con voz `marin`, F1 va de 300 a 786 Hz
(mediana 418) y F2 de 1098 a 2610 Hz (mediana 1496). El habla conversacional casi
nunca llega a los extremos del libro, así que con la calibración teórica la boca
apenas se abría. Si cambias de voz o de modelo, vuelve a medirla desde la consola
con `catalina.voice.read(performance.now())`.

## Estructura

```
public/
  app.js                 interfaz, sesión y bucle de dibujo
  realtime/session.js    WebRTC, canal de eventos y errores legibles
  audio/voice-tracker.js unión del motor de visemas con el análisis continuo
  audio/voice-shape.js   formantes y sibilantes → forma de boca
  animation/director.js  actuación: estados, gestos y sus relojes
  animation/math.js      resortes, amortiguación y ruido
  animation/tuning.js    calibración de la apertura de boca
  banco.html             banco de pruebas, servido en /banco.html
  render/rig.js          puntos anatómicos medidos sobre la fotografía
  render/mouth-layer.js  mandíbula, labios y cavidad
  render/eyes-layer.js   mirada y parpadeo
  render/brow-layer.js   cejas
  render/face-renderer.js composición del cuadro
work/
  render_contact_sheet.mjs  hoja de contactos de posturas, sin navegador
  render_expression_sheet.mjs  hoja de las seis expresiones
  smoke.mjs                 900 cuadros por los cuatro estados
  build-demo.mjs            empaqueta el banco en una página autónoma
  banco-de-pruebas.html     resultado: se abre con doble clic, sin servidor
  comparacion-referencia.png  boca de Catalina junto a la referencia buscada
```

## Banco de pruebas

El banco vive en `public/banco.html` y se abre en **`/banco.html`**, tanto en
local como en el despliegue. Importa los módulos reales del avatar, así que
siempre muestra el mismo código que corre en la aplicación.

Sirve para ver la boca de cerca y fijar cualquier postura sin gastar una sesión
de la API. El panel **Calibración de apertura** mueve en vivo los cinco valores
de `public/animation/tuning.js`; cuando la boca se vea bien, «Copiar valores»
deja el bloque listo para pegar en ese archivo y que el cambio sea permanente.

Para llevárselo sin servidor ni conexión (doble clic, o por correo):

```bash
node work/build-demo.mjs work/banco-de-pruebas.html
```

Para revisar un cambio de anatomía sin abrir el navegador:

```bash
node work/render_contact_sheet.mjs work/viseme-contact-sheet.png
```

Y para comprobar que nada se rompe en ningún estado:

```bash
npm run check
```

Desde la consola del navegador, `catalina.director.setState("speaking")` fuerza
un estado para inspeccionar la actuación.

## Subtítulos e historial

Los dos nacen **apagados**: leer lo mismo que se está oyendo compite con la
cara, que es lo que sostiene la conversación.

- **Subtítulos** (tecla `S`) muestra sobre la imagen sólo el turno en curso.
- **Historial** guarda todos los turnos con su hora, en un panel lateral que se
  cierra con `Esc`.

La elección se recuerda entre sesiones. El historial se registra siempre, aunque
esté cerrado, así que al abrirlo aparece lo dicho hasta ese momento. Los avisos
de error de conexión pasan por encima de la preferencia: si hay algo que leer,
se lee.

Sólo se transcribe la voz de Catalina. Transcribir además la de la persona
requiere activar `input_audio_transcription` en la sesión, con su costo aparte.

En **Modo Meet** los subtítulos siguen visibles si están encendidos —son parte
de lo que se quiere capturar— y el historial se oculta con el resto del mando.

## Usarlo en Google Meet

1. Abre Catalina y activa **Modo Meet** (o presiona `H`).
2. En OBS, agrega una fuente **Captura de ventana** y selecciona la ventana de Catalina.
3. En OBS, pulsa **Iniciar cámara virtual**.
4. En Google Meet, selecciona **OBS Virtual Camera** como cámara.

Para que los demás participantes reciban la voz de Catalina, se necesita enrutar el audio del navegador a Meet con un dispositivo virtual (por ejemplo BlackHole en macOS). Esa configuración se realiza después de validar este prototipo.

## Privacidad

- La interfaz y la animación se ejecutan en el equipo.
- El análisis de labios se ejecuta completamente en el navegador local.
- El audio conversacional se envía a OpenAI Realtime API.
- `.env` está ignorado por Git para evitar publicar la clave.
