#!/bin/zsh
# Lanzador de Node para la vista previa del editor.
#
# .claude/launch.json necesita una ruta a un ejecutable, y escribir ahí la de un
# equipo concreto ata el repositorio a esa máquina. Este envoltorio busca Node
# igual que start.command y le pasa los argumentos tal cual, así que el mismo
# launch.json vale en cualquier equipo.
set -e
cd "${0:A:h}/.."

# Sin esto, zsh aborta con «no matches found» al llegar al comodín de nvm en un
# equipo que no use nvm, en vez de limitarse a saltarse ese candidato.
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
    "$HOME/.volta/bin/node" \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  do
    if [[ -x "$CANDIDATO" ]]; then
      CATALINA_NODE="$CANDIDATO"
      break
    fi
  done
fi

if [[ -z "$CATALINA_NODE" ]]; then
  echo "No encuentro Node.js. Instálalo desde https://nodejs.org (versión LTS)." >&2
  exit 1
fi

exec "$CATALINA_NODE" "$@"
