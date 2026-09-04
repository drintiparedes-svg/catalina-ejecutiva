# Catalina Ejecutiva — asistente clínica virtual con avatar

Rama aparte de [catalina-avatar](https://github.com/drintiparedes-svg/catalina-avatar):
la misma cara y el mismo motor de animación, con la voz y el cerebro de un
**agente de ElevenLabs** en vez de la asistente de salud.

La cara no cambió ni una línea: el avatar analiza el audio que suene, venga del
proveedor que venga. Lo que sí cambió es la boca — con ElevenLabs ya no se
adivina del espectro, porque el agente manda qué carácter suena y cuándo.

Quedan tres voces en cadena: ElevenLabs primero, OpenAI y Gemini de respaldo.
Ninguna clave llega al navegador; el servidor firma cada sesión.

## Iniciar en macOS

1. Haz doble clic en `start.command`.
2. La primera vez te pide dos datos de tu cuenta de ElevenLabs y los guarda él
   solo: la clave (Settings → API Keys) y el identificador del agente que
   crees en Agents, el que empieza por `agent_`.
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

  El tórax tampoco respira: escalaba el retrato completo y se leía como un
  latido de la imagen, no como un pecho. El **ciclo** respiratorio sigue vivo,
  eso sí, porque de él cuelga el ala de la nariz, que es un movimiento pequeño
  y que aguanta que lo miren de cerca.

  Todo lo que se mueve se **traslada**, nunca se estira. Medido en Chromium, una
  franja redibujada y corrida sale idéntica a la fotografía dibujada de una
  pasada; estirarla, en cambio, recompone la trama de puntos y la deja más
  blanda. Por eso el estiramiento sólo existe en la franja de transición del
  pelo, y por eso el retrato se ve tan nítido como la fotografía original.

En reposo el rostro sigue vivo: respira por la nariz, parpadea, mira alrededor,
traga, entreabre los labios antes de tomar el turno y la brisa le mueve el pelo.

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
  render/nose-layer.js   respiración nasal basal
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

## Cuando algo no funciona

Abre **`/diagnostico.html`**, en local o en el despliegue. Recorre el camino
entero hasta ElevenLabs —servidor, claves, firma de la sesión y apertura de la
conversación— y se para en el primer punto que falla, diciendo qué arreglar.

El paso que más cuesta ver sin esta página es el cuarto: cuando ElevenLabs
acepta firmar la sesión pero cierra la conversación al abrirla. Ahí aparece su
código y su motivo textual, que es lo que distingue una cuenta sin crédito de un
agente que no permite sobrescribir su configuración.

## Desplegar en Vercel

En Vercel no hace falta descargar nada ni pegar claves en ningún archivo: se
conecta el repositorio una vez y cada cambio queda publicado solo.

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa
   `catalina-ejecutiva`.
2. En **Settings → Git**, pon la rama de producción en `elevenlabs-ejecutiva`.
3. En **Settings → Environment Variables**, añade `ELEVENLABS_API_KEY` (la que
   empieza por `sk_`) y `ELEVENLABS_AGENT_ID`.
4. **Deploy**.

Cómo está montado: `app.mjs` tiene el manejador de peticiones y no escucha en
ningún puerto. Lo usan dos envolturas —`server.mjs` en local, `api/index.mjs`
en Vercel— para que las rutas y las herramientas sean literalmente el mismo
código en los dos sitios. `vercel.json` sirve `public/` como estático y manda
sólo las rutas de la API a la función.

El micrófono funciona porque Vercel sirve por HTTPS, que es lo que exige el
navegador. La conversación no pasa por el servidor: el navegador abre el
WebSocket contra ElevenLabs con una dirección que el servidor firmó, así que la
clave no viaja al navegador y no hace falta que Vercel sostenga la conexión.

Lo que **no** funciona en un despliegue: guardar la configuración desde el panel
—el disco es de sólo lectura— y las llamadas telefónicas, que necesitan una
conexión sostenida.

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

La búsqueda insiste antes de rendirse: dos tandas de tres consultas **en
paralelo**, no una cascada en fila. Encadenadas encontraban imagen casi siempre
pero sumaban hasta ocho viajes de red y la espera se hacía larga; lanzadas a la
vez, la primera tanda cuesta lo que la más lenta de sus tres y resuelve la
mayoría de los casos. Si Commons no da nada, se usa la imagen principal del
artículo de Wikipedia —primero en español—, que suele ser el esquema que uno
usaría para explicárselo a alguien.

Cuando lo único encontrado no menciona el término, se devuelve marcado como
**aproximado** y Catalina lo advierte al hablar, en vez de presentarlo como la
estructura exacta.

El material se prefiere esquemático y simple, para explicárselo a un paciente:
puntúan alto el vectorial y los títulos con «diagram» o «esquema», y bajan la
disección, la microscopía y las imágenes radiológicas.

Tres detalles de la búsqueda que cuestan de adivinar:

- La consulta a Commons va escueta (`estructura + "diagram"`). Con grupos de
  `OR` el buscador reparte el peso entre esas palabras y diluye el término real:
  para «nephron» llegaba a devolver anatomía de poliqueto y de caracol.
- La ordenación es jerárquica: primero que la lámina trate del tema, después que
  esté dibujada. Al revés —premiando sólo el «parece dibujo»— devolvía un
  esquema de caracol en SVG para una consulta de plexo braquial.
- Wikimedia estrangula a quien no se identifica con un contacto en el
  `User-Agent`. En ráfagas se nota mucho: las primeras consultas pasan y las
  siguientes se rechazan sin más, que desde fuera parece «no hay imagen».

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

## Modo reunión

En reunión Catalina no es una interlocutora: es la secretaria. **Escucha y calla
por defecto**, y sólo habla cuando alguien le da la palabra desde la pantalla.
Oír su nombre ya no basta —una asistente que contesta cada vez que la nombran
interrumpe una reunión de verdad—, así que el nombre sólo sirve para recordarle
a quien la llamó que hay que pulsar **Participar**.

Los estados se ven en la tira de arriba a la izquierda:
`Escuchando → Puedes hablarme → Me lo estoy pensando → Hablando → Escuchando`,
y al terminar `Reunión cerrada`.

La memoria de la reunión (`public/reunion.js`) es **aparte** de la conversación
con ella, y todo lo que entra queda marcado con su procedencia:

| Marca | Qué es |
| --- | --- |
| `CONVERSACION` | lo que se dijo en la sala, transcrito por el navegador |
| `DOCUMENTO` | lo que traía un archivo aportado |
| `NOTA_EDITORIAL` | lo que el usuario apuntó en su cuaderno |
| `ASISTENTE` | lo que dijo Catalina al ser invocada |

La marca sobrevive hasta el papel, y cada documento la resuelve distinto a
propósito: **en la minuta las notas se funden en la redacción** y desaparecen
como notas —quien lee una minuta ejecutiva necesita el énfasis, no saber de qué
apunte salió—, mientras que **en el Word se conservan al final**, corregidas,
bajo «Notas personales del usuario», porque el Word es el registro. Lo que no
cambia nunca es que una nota **no** puede acabar convertida en algo que alguien
dijo, y que lo que venía en un PDF se atribuye al PDF, no a una persona.

El cuaderno es acumulativo: se abre, se escribe, se cierra y al reabrirlo está
todo lo anterior para releerlo y seguir debajo. Se guarda en cada tecla, así que
una recarga a mitad de reunión no se lleva lo apuntado.

Las acciones son **Participar**, **Tomar nota**, **Agregar documento**,
**Reuniones anteriores** y **Finalizar reunión**; también se piden de viva voz
(`tomar_nota`, `quien_habla`, `estado_de_la_reunion`, `consultar_reunion`,
`finalizar_reunion`).

### Antes de escuchar: qué reunión es

Entrar en modo reunión abre primero una preparación —título, objetivo, idiomas,
documentos previos, reunión anterior de la que ésta es seguimiento, y si Catalina
puede participar—. De ahí sale con una sola acción, **Iniciar reunión**, que
confirma en el acto: «Reunión iniciada — Catalina está escuchando». Lo que más
pesa en la preparación es el **tipo**:

| Tipo | Qué prioriza | ¿Participa? |
| --- | --- | --- |
| Conferencia o clase | conceptos, datos, referencias, conclusiones, preguntas | no |
| Operacional | problemas, decisiones, acuerdos, tareas con dueño y fecha, bloqueos | no |
| Ejecutiva | la decisión central, posiciones, alternativas, riesgos | no |
| Ejecutiva — Lean | problema, estado actual, desperdicios, causas, contramedidas con indicador | no |
| Creativa | ideas, hipótesis, divergencias, descartadas, experimentos | sí |

Lo que **no** cambia entre tipos es la captura: la transcripción se guarda igual
y entera en los cinco. Lo que cambia es qué se mira al leerla y en qué orden se
cuenta. Las secciones que un tipo no pide se imprimen igual si traen contenido:
si en una clase alguien acabó comprometiéndose a algo, esa acción no se pierde.
Los cinco tipos viven en `public/tipos-de-reunion.js`, que importan **los dos
lados** —el navegador para la pantalla, el servidor para la minuta— porque con
dos copias un día dejarían de coincidir sin que nadie lo notara.

### Español e inglés, en la misma reunión

El reconocimiento del navegador no detecta el idioma: se le fija uno y todo lo
que oye lo escribe en ese idioma. Un seminario en inglés escuchado en español no
sale mal transcrito, sale como ruido. Por eso se abren **dos reconocedores en
paralelo**, uno por lengua, sobre el mismo micrófono.

Lo que no hacen es competir por el hueco. **El idioma principal manda**: lo que
oye sale a la transcripción en el acto, sin esperar a nadie, y nada puede
descartarlo. El segundo idioma **corrige**: cuando una intervención se dijo en la
otra lengua, el principal la escribe como ruido y el segundo la escribe bien,
y entonces se sustituye esa línea en su sitio. Así el peor caso posible es «una
frase en inglés salió mal transcrita», nunca «una frase desapareció» ni «la
frase salió dos veces». Se llegó aquí por descarte: la primera versión elegía
entre las dos con una ventana de tiempo, y en una reunión fluida —que es toda
reunión de verdad— las frases llegan más juntas que la ventana, se fundían unas
con otras y **cuatrocientas intervenciones se quedaron en una**.

Emparejar la versión de un motor con la del otro se hace **por orden, no por
reloj**: los dos oyen el mismo audio, así que la frase número N de uno es la
número N del otro; por tiempo, dos intervenciones seguidas se confunden entre sí.
Antes de sustituir se comprueba además que puedan ser la misma frase —dos
transcripciones del mismo audio salen de longitud parecida aunque estén en
lenguas distintas— y que la versión nueva encaje claramente mejor con su lengua
que la vieja con la suya. Si las cuentas de los dos motores se separan —uno partió
una intervención donde el otro no— se **deja de emparejar** y se sigue sólo con el
principal: perder una corrección es barato, poner en boca de alguien algo dicho en
otro momento no lo es.

Cada intervención queda **en la lengua en que se dijo**, marcada `ES` o `EN`, y
la corrección de estilo tiene prohibido traducir: una intervención traducida deja
de ser una cita. Se pueden marcar los dos idiomas o sólo uno; con uno solo no hay
segundo motor ni corrección.

### Verlo mientras ocurre

La transcripción aparece **en la tira, frase a frase, mientras la reunión pasa**,
con la hora, quién hablaba y el idioma; debajo, en gris y en cursiva, lo que el
navegador está entendiendo ahora mismo y todavía no ha cerrado. No es un adorno:
es la única prueba a la vista de que hay captura. Antes, saber si el micrófono
estaba funcionando exigía cerrar la reunión y abrir el documento, y descubrir el
fallo cuando ya no tenía arreglo.

Esa capa de transcripción es **una sola y no se corta nunca**: no se detiene ni
se reinicia al pulsar «Participar», al invocarla por su nombre, al salir del modo
y volver a entrar, ni mientras ella contesta —ahí deja de apuntar unos segundos
para no transcribir su propia voz, y nada más—.

Y **no depende de la sesión de voz**: quien escucha la sala es el navegador, por
su cuenta y gratis. Exigir la conversación abierta para transcribir era el motivo
de que entrar en modo reunión no funcionara a la primera y hubiera que salir,
iniciar la conversación y volver a entrar. La sesión sólo hace falta para que
Catalina conteste, y si no está abierta, «Participar» la abre.

### La transcripción es un registro, no un recuerdo

Cada frase capturada se escribe en IndexedDB en cuanto se oye, agrupando las
escrituras en dos segundos —y esos dos segundos se vuelcan sin esperar en cuanto
la pestaña se oculta, que es lo normal en mitad de una reunión—. Si el navegador se recarga, se cierra la pestaña o
falla el cierre, lo capturado sigue ahí y al volver a entrar se ofrece retomar la
reunión. Antes vivía sólo en memoria, y bastaba un cierre a medias para perderla.

Tres seguros más, porque la captura falla en silencio y eso es lo peor que puede
hacer: **la sordera lleva plazo** —mientras Catalina habla no se apunta nada, y
si el aviso de que terminó no llega, a los 45 segundos se quita sola—; un
**latido** cada ocho segundos comprueba que el reconocimiento sigue en pie y lo
levanta si se cayó, avisando cuando se corta demasiado; y un **vigía de la voz
muda**, porque la sordera se levanta al detectar silencio en la pista y una voz
que nunca llegó a sonar —reproducción bloqueada, respuesta cortada, proveedor
caído— no produce ningún silencio que detectar: a los doce segundos se mira si
la pista está de verdad parada y, si lo está, se vuelve a escuchar la sala.

El vigía va más allá: cada veinte segundos comprueba que se esté capturando algo,
y si la reunión lleva tres minutos sin una sola frase lo dice **en pantalla y en
ese momento**, con el motivo del navegador —permiso denegado, micrófono tomado
por Meet, sin conexión con los servidores de voz de Google—. Enterarse al final
de que no se transcribió nada es enterarse cuando ya no tiene arreglo.

En `/reunion.html` hay una **prueba del micrófono** aislada: arranca sólo el
reconocimiento y dice exactamente qué pasa. Es lo que distingue «el navegador no
puede», «no diste permiso» y «Chrome no llega a los servidores de voz».

### El banco de pruebas

En `pruebas/` hay 320 comprobaciones automáticas que recorren el modo entero:
el flujo completo en un Chromium de verdad, las herramientas por voz, el ciclo
de sordera mientras ella habla, la carpeta local con sus fallos, Google Drive
contra un doble de Google, las rutas de fallo (servidor caído, navegador sin
reconocimiento, motor de escucha que se muere), el `.docx` y el `.pdf` abiertos
y leídos byte a byte, una reunión de cuatrocientas intervenciones, y
comprobaciones estáticas de que ningún `querySelector` apunta a la nada y
ninguna ruta se quede fuera de `vercel.json`. `pruebas/LEEME.md` dice cómo
correrlo. Existe porque cada ronda de pruebas a mano costaba una tarde y
encontraba fallos que ya se habían arreglado antes.

Una de ellas no comprueba el navegador sino al servidor: que se **niegue** a
mandar la reunión a un tercero sin confirmación explícita, aunque se lo pidan
directamente a la ruta. Que el navegador pida confirmación dos veces está bien,
pero el navegador es de quien lo abre y no es una garantía de nada.

### Darle un documento para conversar sobre él

En el panel de conversación hay un botón **Subir**, y también se puede soltar un
archivo encima del panel. Sirve para lo que uno haría con una persona: enseñarle
una presentación, un Excel o un informe y comentarlo.

El texto se saca **en el propio navegador**, con el mismo lector que usa el modo
reunión —PDF, Word, Excel, PowerPoint y texto plano, con `DecompressionStream`—,
así que el archivo no se sube a ningún sitio. La única excepción son las
imágenes: de una imagen no se puede sacar texto aquí, así que se manda al
servidor para que el modelo describa lo que se ve. Eso conviene saberlo, y la
ficha del documento lo dice: «imagen descrita» frente al recuento de caracteres
de un archivo leído.

A Catalina **no se le manda el documento entero**. Se le manda una ficha con el
nombre y los primeros seis mil caracteres, y se le dice cómo pedir el resto: un
Excel de cuarenta mil caracteres metido de golpe en una conversación hablada no
la ayuda a responder, la ahoga. Cuando necesita más, usa `consultar_documento`,
que le devuelve un trozo y le dice desde qué carácter seguir —sin eso vuelve a
pedir el mismo—. Es el mismo patrón que `consultar_reunion`.

De la descripción de una imagen se le pide lo que se ve y el texto transcrito
literalmente, y se le prohíbe interpretar: lo ilegible se marca como
`[ilegible]` en vez de completarlo, y una imagen clínica se describe sin
diagnosticar. Un diagnóstico no sale de una descripción.

**Ojo con el teléfono:** `consultar_documento` es una herramienta de cliente
más, y hasta que las llamadas tengan su propio agente (ver abajo) cada
herramienta de cliente es un silencio posible en una llamada. Con
`ELEVENLABS_CALL_AGENT_ID` puesto, esto no las afecta.

## Un agente para hablar, otro para llamar

Las llamadas usan `ELEVENLABS_CALL_AGENT_ID` si existe, y si no, el mismo agente
del navegador. Compartirlo parecía inofensivo y no lo es.

Todas las herramientas se registran en el agente como **herramientas de
cliente**, con `pre_tool_speech: "force"` y `response_timeout_secs: 20`: la
agente dice una muletilla —«déjeme ver un segundo»— y espera a que el navegador
le conteste. En una llamada **no hay navegador**. Así que cada herramienta que
invoque son hasta veinte segundos de silencio esperando algo que no va a llegar,
y quien está al teléfono lo oye como que la voz se corta.

No se notó hasta que el modo reunión añadió cinco herramientas más
(`tomar_nota`, `quien_habla`, `estado_de_la_reunion`, `consultar_reunion`,
`finalizar_reunion`) y `asegurarHerramientas` empezó a reescribirlas en el agente
cada vez que se abre el navegador. Antes de eso el agente iba casi vacío y el
problema estaba latente.

El arreglo es un **segundo agente en el panel de ElevenLabs, sin herramientas de
cliente**, con su id en `ELEVENLABS_CALL_AGENT_ID`. Todo lo que escribe
herramientas en el código usa sólo `ELEVENLABS_AGENT_ID`, así que ese agente se
queda limpio para siempre sin tener que acordarse de nada.

`/telefonia.html` ahora lo dice y lo **cuenta**: enseña cuántas herramientas de
cliente lleva el agente que habla por teléfono, con sus nombres. Antes decía que
compartir agente era «correcto» y que separarlo era «opcional» —era falso, y es
lo que dejó pasar el fallo—.

## Verificación antes de dar la reunión por buena

Al cerrar se comprueba, y se enseña: audio procesado, transcripción capturada,
transcripción persistida, transcripción dentro del documento, notas preservadas,
documentos asociados, Word, PDF e historial. Si falla algo crítico, la reunión
**no** se declara correcta: se dice qué falló y se ofrece reintentar el
procesamiento sin perder lo capturado.

Los documentos se leen en el propio navegador —PDF, Word, Excel, PowerPoint y
texto— con `DecompressionStream`, sin subirlos: el archivo ya está ahí y Vercel
tiene un tope de tamaño por petición que un PowerPoint se salta sin esfuerzo. De
una imagen o de un PDF escaneado no se puede sacar texto: en vez de inventarlo,
pide una descripción y la usa como tal.

Al finalizar se generan dos documentos, **sin instalar ninguna dependencia**
(`documentos.mjs` escribe el ZIP de OOXML con `zlib` y el PDF con las fuentes
base-14 que todo lector trae incorporadas):

- `Transcripcion_[fecha]_[nombre].docx` — lo dicho, corregido en ortografía,
  gramática y puntuación, organizado por participante. El sentido no se toca.
- `Minuta_[fecha]_[nombre].pdf` — resumen ejecutivo, temas, antecedentes,
  problemas, decisiones, acuerdos, desacuerdos, la tabla de acciones
  (Acción · Responsable · Fecha · Estado), pendientes y próximos pasos.

Los dos se guardan solos en la carpeta de Google Drive configurada. El correo se
**propone** con todo a la vista y no sale hasta que alguien lo confirma en dos
pulsaciones: guardar en la carpeta de siempre es reversible, mandarle la reunión
a un tercero no lo es. Sin `GEMINI_API_KEY` la reunión se cierra igual, pero la
transcripción va sin corregir y la minuta sale con el material ordenado y sin
resumen; se dice en pantalla en vez de disimularlo.

Los nombres de los modelos de Gemini cambian cada pocos meses y no todos existen
en todas las cuentas, así que se prueban varios en orden y se recuerda el que
contesta. Con un nombre fijo, una cuenta sin ese modelo recibía un 404 y la
minuta salía sin redactar sin que el motivo apareciera por ningún lado.
`/reunion.html` dice qué modelo está usando, y `GEMINI_MODELO` fuerza uno.

La cascada distingue dos fallos que se parecen y se arreglan al revés. Un **404**
o un **400** significan que ese modelo no sirve: se pasa al siguiente sin perder
tiempo. Un **503** o un **429** significan que Gemini está saturado: el mismo
modelo probablemente conteste dentro de un segundo, así que se reintenta antes
de descartarlo. Tratarlos igual hacía que una saturación pasajera —el fallo más
común de todos— se reportara como si el modelo no existiera, y mandaba a cambiar
un nombre que estaba bien.

Y antes de adivinar, se **pregunta**: Google tiene un listado de los modelos que
cada clave puede usar, y de ahí salen los candidatos. La lista escrita a mano
quedó de respaldo por si el listado falla. Adivinar nombres fue el error de
fondo: cuando los cinco candidatos daban 404, la pantalla mandaba a cambiar el
nombre del modelo sin saber cuál poner.

Ese listado además separa tres fallos que se parecen y se arreglan distinto:
Google no deja ni listar (la **Generative Language API** no está activada en el
proyecto de la clave, o la clave tiene restricciones), lista pero está vacío (la
clave no sirve), o lista modelos que existen pero ninguno contesta. El
diagnóstico enseña lo que se probó **de verdad**, con lo que dijo cada modelo y
cuántas veces se intentó. Listaba los cinco candidatos aunque se hubiera parado
en el primero, que es mandar a buscar el fallo donde no está.

### Cerrar no es terminar

Finalizar la reunión **no destruye la sesión**: apaga la captura de la sala,
devuelve el micrófono y convierte la reunión en un objeto consultable. A partir
de ahí la conversación sigue con normalidad y Catalina responde sobre ella
—«¿qué quedó pendiente?», «¿qué dijo Marcela del presupuesto?», «¿quién quedó a
cargo?»— con la minuta, la transcripción completa, los documentos y las notas a
mano (`consultar_reunion`).

Cada reunión cerrada queda en el **historial**, en IndexedDB de este navegador.
Ese sitio no es una comodidad: el disco de Vercel es de sólo lectura y cada
petición cae en una instancia distinta, así que el servidor no tiene dónde
guardar nada, y montar una base de datos para algo que sólo lee su dueño sería
desproporcionado. La consecuencia hay que decirla: **el historial vive en ese
navegador y no se sincroniza**; lo que sí viaja son los documentos, en Drive.

Cada reunión del historial es un **expediente**: fecha, título, tipo,
participantes, y dentro —en pestañas— la minuta, la transcripción completa, las
notas y el texto de los documentos que se aportaron. Se puede leer antes de
preguntar por ella, o mientras se pregunta. También se usa como **antecedente**
de una reunión de seguimiento: entonces la minuta nueva sabe de dónde viene y
dice qué avanzó y qué sigue igual.

### Dónde se archivan las minutas

Tres vías, de menos a más piezas. Conviven: se pueden usar todas a la vez.

**1. Una carpeta del equipo** (Chrome o Edge de escritorio). Se elige una vez y
Catalina escribe ahí, en cada cierre, el Word, el PDF y una copia de la reunión
en JSON. Sin cuentas, sin permisos, sin desplegar nada. Y resuelve lo de Drive
por la puerta de al lado: **si la carpeta está dentro de «Google Drive»** —o de
iCloud, o de Dropbox—, la aplicación de escritorio la sincroniza sola y las
minutas acaban en el Drive personal sin que Catalina hable con Google.

La copia en JSON no es un extra: es la reunión entera. En otro equipo se elige
la misma carpeta sincronizada, se pulsa **Recuperar reuniones de la carpeta** y
el historial vuelve. Es lo que saca la memoria de un solo navegador.

El navegador pide permiso sobre la carpeta cada vez que se reinicia; cuando pasa,
la pantalla de cierre lo dice y ofrece un botón en vez de fallar en silencio.

**2. Copia a tu propio correo** (cualquier navegador, teléfono incluido). Cada
reunión cerrada llega con los dos archivos adjuntos y la bandeja pasa a ser el
archivo: buscable, en todos los dispositivos y con copia de seguridad. A uno
mismo se manda sin preguntar —no es una acción externa—; a terceros sigue
haciendo falta confirmarlo en dos pulsaciones.

**3. Google Drive por internet**, plegado al final de la pantalla. Hace falta
sólo para subir a Drive sin la aplicación de escritorio: desde el teléfono, o
desde un navegador que no sea Chrome. Con la carpeta montada no aporta nada, y
por eso ni la pantalla de puesta a punto ni la de cierre lo reclaman cuando ya
se archiva por otra vía: insistir con algo que se decidió no usar es ruido.

### Conectar Google Drive

Google no deja que ninguna aplicación entre en un Drive sabiendo el correo —si
bastara con eso, cualquiera entraría en el de cualquiera—, así que siempre hace
falta pasar por su pantalla de consentimiento. Lo que no hacía falta era el resto:
antes había que copiar el permiso a mano en Vercel y volver a desplegar.

Ahora el reparto es:

- **Una vez, quien despliega**: registrar la aplicación en Google Cloud y poner
  `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Es inevitable: el consentimiento
  lo sirve una aplicación registrada, no un correo.
- **Cada vez, quien la usa**: pulsar **Conectar mi cuenta de Google**, elegir la
  cuenta y aceptar. El permiso se guarda en **ese navegador** y no en el
  servidor; sale de ahí sólo para pedirle a Google que suba los dos archivos al
  cerrar una reunión. `/reunion.html` enseña con qué cuenta está conectado, sus
  carpetas para elegir dónde van las minutas, un botón para crear una nueva y
  otro para desconectar.

Un detalle que cuesta caro descubrir tarde: la pantalla de consentimiento debe
quedar **«En producción»**. En «Prueba», Google caduca el permiso cada siete días
y habría que reconectar todas las semanas. Publicar no exige verificación porque
el permiso que se pide (`drive.file`) sólo alcanza a los archivos que Catalina
crea, no al resto del Drive. Ese mismo permiso es el que hace que en la lista
sólo aparezcan sus carpetas.

Si Drive no responde, la reunión se cierra igual: los documentos ya están hechos
y se descargan desde la pantalla de cierre. Que Drive esté caído es una molestia;
perder la reunión por ello sería un desastre.

Puesta a punto y diagnóstico en **`/reunion.html`**.

### Capturarlo en Google Meet

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
