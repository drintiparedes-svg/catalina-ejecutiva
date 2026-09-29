# Módulo Meet: diagnóstico, cambios y evaluación de cuentas propias de IA

Fecha: 29-09-2026 · Alcance: `public/escucha.js`, `public/grabadora.js`,
`public/reuniones.js`, `public/app.js`, `public/minuta.*`, `reunion.mjs`,
`app.mjs`, `config.mjs`.

## 1. Diagnóstico (causas raíz verificadas en el código)

| # | Síntoma reportado | Causa raíz | Evidencia |
|---|---|---|---|
| 1 | La transcripción «se corta» | El reconocimiento de Chrome se cierra solo (≈1 min, silencios, red). Sólo se guardaban frases cerradas: la frase en curso se perdía en cada corte. El rearranque se hacía dentro de `onend` sin espera ni control; si Chrome lo rechazaba, la escucha moría sin aviso. | `escucha.js` anterior: `interimResults = false`; `onend → r.start()` en `try {}` vacío. |
| 1b | Idem | Mientras Catalina habla la escucha se «ensordece». Si no llegaba el aviso de fin de turno (sesión caída, respuesta interrumpida), quedaba sorda el resto de la reunión. | `ensordecer(false)` sólo en `seguirFinDeTurno`. |
| 1c | Idem (con ElevenLabs) | La sesión de ElevenLabs —voz principal— no implementaba `pausarEnvio`: al entrar en modo Meet se lanzaba un `TypeError` antes de arrancar la escucha. | `elevenlabs-session.js` sin el método; `app.js` lo invocaba sin comprobar. |
| 1d | Participantes remotos ausentes | El reconocimiento del navegador sólo oye el micrófono. Con audífonos, las voces del Meet nunca llegan a él. | Límite de la Web Speech API. |
| 2 | Minutas breves | No existía un generador de minutas: el «resumen» lo redactaba el modelo de voz dentro de una llamada a `enviar_resumen`, con instrucciones de hablar en 2–3 frases. | `config.mjs` (persona: «Responde corto»), `PARAMETROS_CORREO`. |
| 3 | Sin diagramas ni modelo alternativo | Ídem: sin generador dedicado ni selección de modelo. | — |
| 4 | Sin referencias ni datos de la reunión | No se pedían ni se guardaban. | — |
| 5 | Catalina «no tiene la información» | La transcripción vivía sólo en memoria de la escucha; se borraba al volver a entrar (`escucha.olvidar()`), al recargar, y sólo se enviaba al modelo cuando alguien decía «Catalina». No había herramienta para consultarla. | `entrarEnModoMeet` → `escucha.olvidar()`; ninguna persistencia. |

## 2. Cambios implementados

- **Captura robusta** (`escucha.js`): rescate de la frase parcial, instancia
  nueva por rearranque con espera creciente (250 ms → 8 s), vigilante cada 4 s
  que reinicia una sesión colgada (25 s sin eventos), sordera con caducidad
  (45 s), registro de huecos y estadísticas de calidad.
- **Alta fidelidad opcional** (`grabadora.js` + `/reunion/transcribir`):
  micrófono + audio de la pestaña del Meet, tramos de 20–40 s cortados en
  silencios, WAV 16 kHz, no se envían tramos de silencio, 3 reintentos, filtro
  de alucinaciones típicas y relleno de tramos fallidos con la transcripción
  del navegador.
- **Registro de reunión** (`reuniones.js`): datos (título, objetivo,
  participantes, agenda, enlaces, lugar), ambas transcripciones, preguntas a
  Catalina, material mostrado, calidad y minuta. Persistencia local.
- **Memoria de Catalina**: contexto silencioso cada 90 s (tope 30 000
  caracteres por sesión), presentación de la reunión al empezar, índice de
  reuniones al abrir cada sesión y herramientas `consultar_reunion`
  (búsqueda con marcas de tiempo) y `generar_minuta` (asíncrona).
- **Minuta de dos formatos** (`reunion.mjs` + `minuta.html`): one pager y
  minuta extensa con esquema JSON estricto (temas con desarrollo, posiciones,
  citas, decisiones con evidencia, plan de acción, riesgos con probabilidad e
  impacto, datos cuantitativos, referencias, diagramas Mermaid, gráficos,
  glosario, limitaciones) y trazabilidad (proveedor, modelo, nivel, tokens,
  tiempo, advertencias).
- **Selección de modelo**: nivel *estándar* (Gemini Flash) y *detallado*
  (Claude Opus 5.5, esfuerzo `high`, salida estructurada y relevo automático
  ante rechazos), con cascada de respaldo configurable y elección manual.
- **Exportación**: PDF (imprimir), HTML autónomo con diagramas dibujados,
  Markdown para Google Docs, y correo con el one pager en el cuerpo y la
  extensa adjunta. El destinatario sigue saliendo sólo de la configuración.

## 3. Evaluación: usar las cuentas de IA propias en vez de una API

| Opción | Factible | Coste | Calidad | Privacidad | Veredicto |
|---|---|---|---|---|---|
| A. Suscripción de chat (ChatGPT Plus/Pro, Claude Pro/Max, Google AI Pro) conectada a la app | **No** de forma legítima: no exponen API; automatizar su interfaz web infringe sus términos y se rompe con cada cambio. | — | — | — | Descartada. |
| B. Copiar instrucciones + transcripción y pegar en el propio chat | Sí (implementado: «Copiar instrucciones + transcripción») | 0 adicional | Alta (mismo prompt que el servidor) | Según el plan: los planes de consumo pueden usar los datos para entrenamiento si no se desactiva | **Recomendada para costo cero**, uso ocasional. Manual, sin diagramas renderizados automáticamente. |
| C. Clave de API propia (BYOK) | Sí (implementado) | Pago por uso en la cuenta de la persona | Alta | Las API comerciales no entrenan con los datos por defecto (verificar términos vigentes de cada proveedor) | **Recomendada** para uso regular. |
| D. Nivel gratuito de la API de Gemini | Sí, con la opción C | 0 con límites de uso | Buena | En el nivel gratuito Google puede usar los datos para mejorar sus productos | Sólo para contenido no sensible. **No usar con datos clínicos ni confidenciales.** |
| E. Transcripción nativa de Google Meet / «Tomar notas por mí» (Gemini en Workspace) | Sí, si el plan de Workspace de la institución lo incluye | Incluido en la licencia | Buena (con separación de hablantes) | Bajo el acuerdo institucional de Workspace | Complementaria: se importa en «Crear desde una transcripción pegada». |
| F. Modelo local (Ollama u otro) | Técnicamente sí, no implementado | 0 por uso; requiere equipo con GPU | Menor que los modelos de frontera para minutas extensas | Máxima (nada sale del equipo) | Evaluar si la privacidad es requisito duro. No funciona en Vercel. |

### Coste estimado por reunión de 1 hora

Supuestos: ≈9 000 palabras habladas → ≈15 000 tokens de entrada más ≈3 000 de
instrucciones; salida de la minuta detallada ≈10 000–15 000 tokens incluido el
razonamiento. Tarifas públicas de lista a septiembre de 2026; verificarlas
antes de presupuestar.

| Componente | Opción | Coste aproximado |
|---|---|---|
| Transcripción alta fidelidad | gpt-4o-transcribe (≈0,006 USD/min) | ≈0,36 USD/h |
| Transcripción alta fidelidad | Gemini Flash con audio | del orden de centavos por hora (verificar tarifa vigente de audio) |
| Minuta detallada | Claude Opus 5.5 (4 / 20 USD por millón de tokens de entrada / salida) | ≈0,07 + 0,20–0,30 ≈ **0,30–0,40 USD** |
| Minuta equilibrada | Claude Sonnet 5.5 (2 / 10 USD por millón) | ≈0,15–0,20 USD |
| Minuta estándar | Gemini Flash | del orden de centavos |

Conclusión: el coste de una minuta detallada con el mejor modelo es inferior a
medio dólar por reunión de una hora; el factor decisivo no es el precio sino la
**gobernanza de los datos**.

## 4. Riesgos y límites que requieren decisión

1. **Datos de salud** (nivel 3). En alta fidelidad el audio y la transcripción
   salen a terceros (OpenAI/Google/Anthropic). Para reuniones con datos
   identificables de pacientes se requiere acuerdo de tratamiento de datos con
   el proveedor y autorización institucional. La minuta instruye al modelo a
   anonimizar identificadores, pero eso no sustituye el control previo.
2. **Tiempo de ejecución en Vercel.** Una minuta detallada puede tardar 1–3
   minutos. La respuesta envía un latido cada 10 s, pero el límite duro de la
   función (300 s con *fluid compute*) aplica. Si el plan tiene un límite
   menor, usar el nivel estándar o subir `maxDuration`.
3. **Nombres de modelo.** Los de Gemini y OpenAI cambian con frecuencia; hay
   cascadas de respaldo, pero conviene revisar `config.mjs → reuniones` y la
   trazabilidad de la primera minuta real.
4. **Almacenamiento local.** Las reuniones viven en el navegador (máx. 15).
   Borrar los datos del sitio las borra. Para archivo institucional, exportar
   o enviar por correo.
5. **Separación de hablantes.** No hay diarización fiable; las atribuciones se
   basan en nombres mencionados. La opción E (transcripción de Meet) sí la trae.
6. **ElevenLabs.** Tras desplegar, volver a registrar las herramientas en el
   agente (abrir `/registrar.html`) y confirmar que el agente
   permite sobrescribir el prompt; si no, las instrucciones nuevas de uso de
   reuniones deben pegarse en su panel.
