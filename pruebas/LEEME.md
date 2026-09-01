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
