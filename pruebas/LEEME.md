# Banco de pruebas

Lo que hay aquí existe por un motivo concreto: cada ronda de pruebas manuales
del modo reunión costaba una tarde y encontraba fallos que ya se habían
arreglado antes. Esto los encuentra en dos minutos y sin salir del escritorio.

## Correrlo

Sin navegador —comprueban código, rutas, redacción y el motor de escucha—:

    node pruebas/qa-dom.mjs        # ningún querySelector apunta a la nada
    node pruebas/qa-rutas.mjs      # toda ruta del servidor está en vercel.json
    node pruebas/qa-prompts.mjs    # los cinco tipos mandan instrucciones distintas
    node pruebas/qa-escucha.mjs    # sordera, caídas, latido, cierre
    node pruebas/qa-bilingue.mjs   # español e inglés sobre el mismo audio

Con navegador y servidor, todo junto:

    PORT=8123 node server.mjs &
    chromium --headless=new --remote-debugging-port=9334 --user-data-dir=/tmp/qa &
    sh pruebas/correr.sh

## Qué cubre cada uno

| Archivo | Qué prueba |
| --- | --- |
| `qa-identidad` | Que Catalina se declare asistente clínica virtual del equipo del doctor Inti Paredes, en la conversación y en la apertura de la llamada, y que ningún cargo viejo quede escondido. |
| `qa-dom` | Que ningún guion busque un id que no existe: un `querySelector` nulo mata el módulo entero al cargar y la página se queda muerta sin decir nada. |
| `qa-rutas` | Que toda ruta del servidor esté enrutada en `vercel.json`. Las que faltan funcionan en local y dan 404 sólo en producción. |
| `qa-prompts` | Que los cinco tipos de reunión manden instrucciones distintas al modelo, y que una reunión bilingüe le prohíba traducir. |
| `qa-escucha` | El motor de escucha aislado: sordera, caída de uno y de los dos motores, latido, arranque denegado, cierre. |
| `qa-bilingue` | Los dos idiomas sobre el mismo audio: que no se pierda ni se duplique nada, que cada frase salga en su lengua, y que un desfase entre motores se detecte en vez de mezclar frases. |
| `qa-docs` | El `.docx` y el `.pdf` de verdad: que sean archivos válidos y que no hayan perdido ni traducido nada. |
| `qa1` | Preparación: tipos, idiomas, cuaderno acumulativo, atribución, documentos. |
| `qa2` | Rutas de fallo: servidor caído al cerrar, navegador sin reconocimiento, y el correo a terceros que no sale sin confirmar. |
| `qa3` | Historial, expediente, antecedente y recuperación de una reunión sin cerrar. |
| `qa4` | Nombrarla, la reunión posterior, empezar otra, y la página fuera del modo reunión. |
| `qa5` | La página de diagnóstico y el aguante de la interfaz en pantalla de móvil. |
| `qa6` | Una reunión de 400 intervenciones: que no se pierda ninguna y que el cierre siga cabiendo. |
| `qa7` | Las herramientas por voz (`tomar_nota`, `quien_habla`, `estado_de_la_reunion`, `consultar_reunion`, `finalizar_reunion`) y el ciclo de sordera mientras Catalina habla. |
| `qa8` | La carpeta local: que se recuerde, que reciba los tres archivos, que pida permiso cuando caduca y que un fallo suyo no se lleve la reunión. |
| `qa-telefonia` | Que el diagnóstico avise cuando las llamadas comparten agente con el navegador y cuente las herramientas de cliente que ese agente lleva encima. En una llamada nadie las contesta, y cada una es un silencio de hasta veinte segundos. |
| `qa-adjuntos` | Subir una presentación, un Excel o una imagen a la conversación: que se lea en el navegador, que a Catalina le llegue el principio como contexto y no el documento entero, que pueda pedir más con `consultar_documento`, y que lo que no se pueda leer se diga. |
| `qa-formatos` | Que se lea cualquier archivo con texto dentro —.sql, .py, .yaml, sin extensión— decidiendo por los bytes y no por el nombre, que un binario disfrazado de .txt no se cuele, y que la extensión y el tamaño se informen bien. |
| `qa-memoria` | La memoria de la conversación sin navegador: la respuesta completa que ElevenLabs manda antes que sus trozos no duplica la intervención, la corrección reescribe en vez de añadir, y las dos voces quedan por separado. |
| `qa-conversacion` | El ciclo entero: que se registren las dos voces en la memoria y sólo Catalina en el panel, que al cerrar salga el resumen con minuta, acuerdos y alcance, que quede en el historial, que se pueda retomar como contexto sólo si se elige, y que todo se pueda pedir hablando. |
| `qa-correo` | Que el SERVIDOR se niegue a mandar la reunión a un tercero sin confirmación explícita. El navegador no es una garantía: es de quien lo abre. |
| `qa-acceso` | El acceso con usuarios contra un Postgres de verdad (`CATALINA_BD_URL`): sin sesión nada responde, el administrador crea usuarios, cada uno ve sólo su historial, bloqueo por intentos, sesión revocada al desactivar, auditoría sin contraseñas. |
| `qa-drive` | Google Drive entero contra un doble de Google: consentimiento, canje, carpetas, subida a la carpeta elegida, y Drive caído sin llevarse el cierre. |

`qa-correo` y `qa-drive` necesitan servidores propios —uno con clave de correo,
otro con el doble de Google— y los levanta `correr.sh` solo.

## Un detalle que ya costó una vez

Las rutas `/drive/*` leen el permiso del campo `permiso`; `/reunion/cerrar` lo
lee de `driveRefresco`. Es el mismo valor con dos nombres, y equivocarse
devuelve «no hay ninguna cuenta conectada» como si de verdad no la hubiera.
