#!/bin/zsh
set -e
cd "${0:A:h}"

# Node.js. Al abrir con doble clic el PATH puede venir incompleto, así que
# además de buscarlo en el entorno se prueban las rutas habituales de macOS:
# Homebrew en Apple Silicon, Homebrew en Intel, instalador oficial y nvm.
#
# NULL_GLOB es imprescindible: sin él, zsh aborta con «no matches found» al
# llegar al comodín de nvm en un equipo que no use nvm, y el script muere antes
# de haber probado el resto de candidatos.
setopt NULL_GLOB

CATALINA_NODE=""
if command -v node >/dev/null 2>&1; then
  CATALINA_NODE="$(command -v node)"
else
  for CANDIDATO in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "$HOME/.volta/bin/node"
  do
    if [[ -x "$CANDIDATO" ]]; then
      CATALINA_NODE="$CANDIDATO"
      break
    fi
  done
fi

if [[ -z "$CATALINA_NODE" || ! -x "$CATALINA_NODE" ]]; then
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
