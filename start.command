#!/bin/zsh
set -e
cd "${0:A:h}"

# Node.js. La búsqueda vive en work/node.sh y no aquí: teniéndola duplicada se
# desincronizó, y este archivo se quedó sin la ruta del runtime de Codex que sí
# tenía el otro. Resultado: no encontraba Node y no arrancaba, justo al abrirlo
# con doble clic, que es como se usa.
CATALINA_NODE="${0:A:h}/work/node.sh"
if [[ ! -x "$CATALINA_NODE" ]]; then
  echo "Falta work/node.sh. Vuelve a descargar el proyecto completo."
  read "?Presiona Enter para cerrar…"
  exit 1
fi

if ! "$CATALINA_NODE" --version >/dev/null 2>&1; then
  echo "No encuentro Node.js en este equipo."
  echo "Instálalo desde https://nodejs.org (versión LTS) y vuelve a abrir este archivo."
  read "?Presiona Enter para cerrar…"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Se creó .env. Agrega tu OPENAI_API_KEY y vuelve a abrir este archivo."
  open -e .env
  read "?Presiona Enter para cerrar…"
  exit 1
fi

CATALINA_URL="http://127.0.0.1:4173"
"$CATALINA_NODE" server.mjs &
CATALINA_PID=$!
trap 'kill $CATALINA_PID 2>/dev/null || true' EXIT INT TERM

# Espera a que el servidor esté realmente disponible antes de abrir el navegador.
# Esto evita dejar una pestaña con ERR_CONNECTION_REFUSED si Node no arrancó.
for attempt in {1..25}; do
  if ! kill -0 "$CATALINA_PID" 2>/dev/null; then
    echo "Catalina no pudo iniciar el servidor local. Revisa el error anterior."
    wait "$CATALINA_PID" 2>/dev/null || true
    read "?Presiona Enter para cerrar…"
    exit 1
  fi
  if curl -fsS "$CATALINA_URL/health" >/dev/null 2>&1; then
    open "$CATALINA_URL"
    wait "$CATALINA_PID"
    exit $?
  fi
  sleep .2
done

echo "Catalina no responde en $CATALINA_URL."
echo "Deja esta ventana abierta y revisa el error mostrado arriba."
read "?Presiona Enter para cerrar…"
exit 1
