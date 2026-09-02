#!/bin/sh
# Banco de pruebas del modo reunión.
#
# Antes de correrlo hacen falta dos cosas:
#   1. El servidor principal:  PORT=8123 node server.mjs
#   2. Un Chromium con depuración remota en el 9334 y micrófono falso:
#      chromium --headless=new --remote-debugging-port=9334 --user-data-dir=/tmp/qa \
#        --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
#
# Los otros dos servidores —uno con clave de correo, otro con un doble de
# Google— los levanta este guion solo, porque existen sólo para las pruebas.
cd "$(dirname "$0")" || exit 1
raiz=$(cd .. && pwd)

arrancar() {  # puerto, orden
  if curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$1/health" 2>/dev/null; then return 0; fi
  ( cd "$raiz" && eval "$2" >/dev/null 2>&1 & )
  i=0; while [ $i -lt 20 ]; do
    curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$1/health" 2>/dev/null && return 0
    i=$((i+1)); sleep 1
  done
  echo "aviso: no arrancó el servidor del puerto $1"
}
arrancar 8124 'PORT=8124 RESEND_API_KEY=clave-de-prueba node server.mjs'
arrancar 4181 'node pruebas/google-falso.mjs'

total=0; malos=0
for t in qa-dom qa-rutas qa-prompts qa-escucha qa-bilingue qa-audio qa-captura qa-correo qa-drive qa-docs qa1 qa2 qa3 qa4 qa5 qa6 qa7 qa8 qa9 qa-voz; do
  salida=$(timeout 300 node "$t".mjs 2>&1)
  n=$(printf '%s\n' "$salida" | grep -cE "^(ok +|  ok +)")
  f=$(printf '%s\n' "$salida" | grep -cE "^(FALLA|  FALLA|  ROTO)")
  total=$((total+n)); malos=$((malos+f))
  if [ "$f" -gt 0 ]; then
    printf "%-12s %3d ok   %d FALLAN\n" "$t" "$n" "$f"
    printf '%s\n' "$salida" | grep -A1 -E "^(FALLA|  FALLA|  ROTO)"
  else
    printf "%-12s %3d ok\n" "$t" "$n"
  fi
done
echo "──────────────────────────────────"
echo "TOTAL: $total comprobaciones · $malos fallos"
[ "$malos" -eq 0 ]
