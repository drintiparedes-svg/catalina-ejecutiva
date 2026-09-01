#!/bin/sh
# Banco de pruebas del modo reunión.
#
#   1. Arranca el servidor:   PORT=8123 node server.mjs
#   2. Arranca un Chromium con depuración remota en el puerto 9334:
#      chromium --headless=new --remote-debugging-port=9334 --user-data-dir=/tmp/qa
#   3. sh pruebas/correr.sh
#
# Las que no necesitan navegador (qa-dom, qa-rutas, qa-prompts, qa-escucha,
# qa-bilingue) corren solas con `node pruebas/<nombre>.mjs`.
cd "$(dirname "$0")" || exit 1
total=0; malos=0
for t in qa-dom qa-rutas qa-prompts qa-escucha qa-bilingue qa-docs qa1 qa2 qa3 qa4 qa5 qa6; do
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
