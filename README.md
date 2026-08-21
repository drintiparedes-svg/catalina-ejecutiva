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
  rostro: el mentón baja hasta 18 px, la comisura sólo un tercio y la mejilla
  prácticamente nada. Es el giro de la articulación, no un bloque que se
  traslada, y por eso la línea mandibular acompaña sin dejar bordes.

  El peso del arrastre tiene **forma de mandíbula**: decae en todas direcciones
  desde el mentón hasta anularse en la oreja, que es donde está el eje de giro
  de la articulación. Antes era un recorte lateral —dentro de 130 px del centro
  la piel se movía, fuera no— y al hablar se veía justo eso: un rectángulo de
  piel deslizándose sobre una cara quieta, con dos cantos verticales marcados.
  Por arriba el gesto sube ahora hasta el pómulo en vez de cortarse en la base
  de la nariz, y por abajo la garganta acompaña al mentón y lo va soltando hasta
  la base del cuello, donde ya no queda nada. Las columnas con las que se
  redibuja la piel bajaron de 18 a 10 px fuera de la boca: a 18 el salto entre
  dos contiguas llegaba a varios píxeles y la mejilla se leía como una escalera
  de bloques.
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
- **Melena.** Es lo único que mueve el aire. Cada mitad se redibuja en franjas
  horizontales y dentro de cada franja el pelo suelto viaja **en bloque**, unos
  26 px con la ráfaga a tope: es una masa que se mece, no una goma que se
  estira. Toda la diferencia con la parte sujeta se resuelve en una franja de
  transición estrecha pegada al anclaje, que es donde el pelo se apoya.

  El anclaje está medido sobre la fotografía y arriba es el contorno del rostro,
  pero de los hombros para abajo es la **silueta del busto**, no el borde del
  pelo: el mechón que cae sobre el hombro tapa cuerpo, y moverlo movería el
  cuerpo con él. Por eso ese pelo se queda quieto —como se queda en una persona—
  y sólo se mece lo que cuelga por fuera. Ni un píxel del torso se redibuja.

  El viento no es uniforme: dos ondas que **viajan** hacia las puntas, con fase
  y ganancia distintas en cada lado, más micro-ráfagas de ataque rápido y caída
  lenta cada pocos segundos. Y la melena va por detrás de la cabeza: cuando el
  cráneo arranca, el pelo llega tarde.
- **Cuello.** El gesto de cabeza movía antes la fotografía entera y con ella se
  balanceaba el busto, que era justo lo que delataba al avatar: un torso no
  acompaña a la cabeza. El gesto es el mismo de siempre, pero ahora se apaga
  entre el mentón y la base del cuello —lo absorbe el cuello— y de ahí para
  abajo la imagen no se toca. El corte queda por encima de la clavícula a
  propósito: bastaba con rozar el pecho para que se moviera.

  Ni respira: la respiración escalaba el retrato completo y se leía como un
  latido de la imagen, no como un pecho.

  Todo lo que se mueve se **traslada**, nunca se estira. Medido en Chromium, una
  franja redibujada y corrida sale idéntica a la fotografía dibujada de una
  pasada; estirarla, en cambio, recompone la trama de puntos y la deja más
  blanda. Por eso el estiramiento sólo existe en la franja de transición del
  pelo, y por eso el retrato se ve tan nítido como la fotografía original.

En reposo el rostro sigue vivo: parpadea, mira alrededor, traga, entreabre los
labios antes de tomar el turno y la brisa le mueve el pelo.

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
  animation/wind.js      brisa: ráfagas, desfase y deformación distal
  banco.html             banco de pruebas, servido en /banco.html
  render/rig.js          puntos anatómicos medidos sobre la fotografía
  render/warp.js         deformación por franjas, sin costuras ni máscaras
  render/hair-layer.js   las dos melenas
  render/head-layer.js   cabeza y cuello, con el busto clavado
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

El panel **Brisa en el pelo** hace lo mismo con la melena: «Alcance» es lo que
se desplaza el pelo suelto, en píxeles de la fotografía, y «Velocidad» el temple
de las ondas. Ambos escriben sobre `BRISA`, en `public/animation/wind.js`, que es el
objeto que lee el pelo en cada cuadro; para dejarlo fijo basta con copiar los
dos números en ese archivo.

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

## Respaldo con Gemini

Si OpenAI se queda sin crédito, la sesión pasa sola a Gemini Live y Catalina
sigue hablando con la misma persona y las mismas herramientas. El relevo se
dispara con `API_RATE_LIMIT`, `API_KEY_MISSING` o `API_KEY_INVALID`; un fallo de
red no lo activa, porque cambiar de proveedor no lo arreglaría y taparía el
problema real. Cada intento nuevo vuelve a empezar por OpenAI, así que al
reponer el crédito Catalina regresa sola a la voz principal.

Los dos transportes no se parecen: OpenAI negocia **WebRTC** y el audio viaja por
una pista de medios; Gemini es un **WebSocket con PCM crudo**, así que
`gemini-session.js` hace a mano lo que WebRTC hacía solo —capturar el micrófono,
remuestrear a 16 kHz, trocear, y recomponer en orden el audio de 24 kHz que
llega—. Ese audio se vuelca en un `MediaStream` propio para que el analizador de
labios funcione igual con los dos.

En **Modo Meet** los subtítulos siguen visibles si están encendidos —son parte
de lo que se quiere capturar— y el historial se oculta con el resto del mando.

## Administrador

En **`/admin.html`**. Cinco secciones: el banco de pruebas embebido, el
conocimiento propio, la persona y sus límites, los modelos de cada proveedor y
los conectores. Lo que se guarda se aplica en la siguiente conversación, sin
reiniciar.

**Acceso.** Cerrado por defecto: sin `ADMIN_TOKEN` sólo responde desde el propio
equipo. Para usarlo a distancia hay que definir esa variable de entorno; el panel
la pide una vez y la guarda en la pestaña. El panel cambia el prompt, los modelos
y los conectores, así que dejarlo abierto en un sitio público sería entregar el
control de Catalina a cualquiera.

**Conocimiento.** No es recuperación por similitud: todo lo activo se inyecta
entero en las instrucciones de cada sesión. Para protocolos y criterios propios
es lo razonable; para una biblioteca haría falta recuperar por embeddings, que es
otro trabajo.

**Límites.** Son instrucciones al modelo, no un cortafuegos. Reducen mucho la
conducta indeseada pero no la vuelven imposible: lo que deba cumplirse siempre va
en el código.

**Modelos.** Sólo sirven modelos de voz en tiempo real; uno de texto no funciona
aquí, porque la conversación viaja como audio en ambos sentidos. Las claves
siguen en variables de entorno, nunca en el panel.

**Conectores.** Servicios propios que Catalina puede consultar. La dirección vive
en el servidor y nunca llega al navegador ni al modelo —éste sólo ve el nombre y
para qué sirve—, sólo se admite `https` y la respuesta se recorta a 4000
caracteres.

La configuración se guarda en `data/config.json`, que está ignorado por git
porque puede llevar credenciales de conectores. **En Vercel no se puede guardar**:
el disco es de sólo lectura y el panel lo dirá con un error claro en vez de fingir
que guardó. Para editar en producción haría falta un almacén externo.

## Continuar en otro equipo

```bash
git clone https://github.com/drintiparedes-svg/catalina-avatar.git
cd catalina-avatar
cp .env.example .env      # y pega ahí tus claves
./start.command
```

Hace falta Node.js (LTS, desde nodejs.org). No hay dependencias que instalar:
el proyecto no usa `npm install`.

Las **claves no viajan** en el repositorio —`.env` está en `.gitignore`—, así que
hay que volver a pegarlas en el equipo nuevo. Se sacan de
[OpenAI](https://platform.openai.com/api-keys) y de
[Google AI Studio](https://aistudio.google.com/apikey). Sólo la de OpenAI es
imprescindible para hablar; sin la de Gemini se pierde el respaldo, y las láminas
y referencias funcionan igual porque no dependen de ninguna clave.

`.claude/launch.json` tampoco viaja: apunta al Node del equipo donde se escribió.
Si usas el editor con vista previa, créalo con la ruta que dé `which node`.

## Docencia médica

Catalina explica anatomía y temas médicos apoyándose en dos herramientas que
ella misma decide cuándo usar. Ninguna inventa nada:

- **`buscar_imagen_medica`** recupera una lámina ya publicada de Wikimedia
  Commons —planchas de atlas y diagramas didácticos— y la muestra con su autor,
  su licencia y un enlace a la ficha de origen.
- **`buscar_referencias`** busca en PubMed artículos que respalden el concepto
  que está explicando, con autores, revista, año y enlace.

La imagen y las referencias son cosas distintas a propósito: la lámina acredita
a quien la dibujó, y lo que se afirma al explicar necesita su propio respaldo en
la literatura.

**No hay generación de imágenes, y es deliberado.** Una lámina anatómica creada
por un modelo parece correcta sin serlo: inventa vasos, desplaza inserciones y
rotula mal, y en docencia eso se aprende como si fuera cierto. Todo lo que
aparece en pantalla existía antes de preguntar y se puede comprobar en su
fuente.

Dos detalles de la búsqueda que cuestan de adivinar:

- La consulta a Commons va escueta (`estructura + "diagram"`). Con grupos de
  `OR` el buscador reparte el peso entre esas palabras y diluye el término real:
  para «nephron» llegaba a devolver anatomía de poliqueto y de caracol.
- La ordenación es jerárquica: primero que la lámina trate del tema, después que
  esté dibujada. Al revés —premiando sólo el «parece dibujo»— devolvía un
  esquema de caracol en SVG para una consulta de plexo braquial.

Ni Commons ni PubMed necesitan clave.

## En el teléfono

La altura va en `100dvh`: en Safari de iPhone `100vh` mide con la barra de
direcciones plegada, así que el pie de la interfaz quedaba por debajo del borde
visible. El lienzo se rehace además con `visualViewport`, que es quien avisa
cuando esa barra aparece o desaparece.

Los márgenes usan `env(safe-area-inset-*)` con `viewport-fit=cover`: el retrato
llega al borde de la pantalla y sólo los controles se apartan de la muesca y de
la barra inferior.

En vertical los cinco botones se reparten en una rejilla de dos filas —acción y
micrófono arriba, los tres interruptores debajo— y el panel pasa a ocupar el
ancho completo por encima de ellos. En horizontal el panel se estira de arriba
abajo y la identidad se reduce al nombre.

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
