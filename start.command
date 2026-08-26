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

# Claves.
#
# Antes esto abría el .env en un editor y te dejaba solo. Es un archivo oculto
# —empieza por punto, y el Finder no lo muestra—, así que la mitad de las veces
# ni se encontraba. Ahora se piden aquí y se escriben solas.
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# Vacía o con el texto de relleno del ejemplo cuentan las dos como «no puesta».
CATALINA_CLAVE_PUESTA="$(grep -m1 '^ELEVENLABS_API_KEY=' .env 2>/dev/null | cut -d= -f2-)"
if [[ -z "$CATALINA_CLAVE_PUESTA" || "$CATALINA_CLAVE_PUESTA" == *reemplaza-esto* ]]; then
  echo ""
  echo "  Primera vez. Necesito dos datos de tu cuenta de ElevenLabs."
  echo "  Los copias de su web y los pegas aquí; yo los guardo en su sitio."
  echo ""
  echo "  1) La clave."
  echo "     elevenlabs.io → tu foto arriba a la derecha → Settings → API Keys"
  echo "     → Create API Key. Te la muestra una sola vez."
  # Sin eco: es una clave, y esta ventana queda abierta a la vista.
  read -rs "?     Pégala aquí y presiona Enter (no se verá): " CATALINA_CLAVE
  echo ""
  echo ""
  echo "  2) El agente."
  echo "     elevenlabs.io → Agents → el que creaste. Su identificador"
  echo "     empieza por agent_ y sigue con letras y números."
  read -r "?     Pégalo aquí y presiona Enter: " CATALINA_AGENTE
  echo ""

  # Al copiar y pegar se arrastran espacios y saltos de línea. Ninguno de los
  # dos valores los lleva nunca, así que se quitan todos sin preguntar.
  CATALINA_CLAVE="${CATALINA_CLAVE//[[:space:]]/}"
  CATALINA_AGENTE="${CATALINA_AGENTE//[[:space:]]/}"

  # Su panel muestra dos cosas parecidas: el identificador de la clave, que sale
  # en la lista, y la clave, que sólo se ve al crearla. Copiar el identificador
  # es el error natural, y sin esta comprobación se descubría al final, con un
  # «ElevenLabs rechazó la sesión» que no dice nada.
  if [[ -n "$CATALINA_CLAVE" && "$CATALINA_CLAVE" != sk_* ]]; then
    echo ""
    echo "  Eso no es la clave: es su identificador."
    echo "  La clave empieza por sk_ y sólo se ve UNA VEZ, en el momento de"
    echo "  crearla. En la lista de API Keys ya no aparece."
    echo ""
    echo "  Crea una nueva en elevenlabs.io → Settings → API Keys →"
    echo "  Create API Key, y copia lo que te muestre ahí mismo."
    echo ""
    read -rs "?  Pega la clave (empieza por sk_): " CATALINA_CLAVE
    CATALINA_CLAVE="${CATALINA_CLAVE//[[:space:]]/}"
    echo ""
  fi

  if [[ -n "$CATALINA_AGENTE" && "$CATALINA_AGENTE" != agent_* ]]; then
    echo ""
    echo "  Eso no parece un agente: el identificador empieza por agent_."
    read -r "?  Pégalo de nuevo: " CATALINA_AGENTE
    CATALINA_AGENTE="${CATALINA_AGENTE//[[:space:]]/}"
    echo ""
  fi

  if [[ -n "$CATALINA_CLAVE" ]]; then
    # Se reescribe el archivo entero en vez de editarlo con sed: una clave
    # puede traer caracteres que sed interpretaría como parte del patrón.
    {
      grep -v '^ELEVENLABS_API_KEY=' .env | grep -v '^ELEVENLABS_AGENT_ID='
      printf 'ELEVENLABS_API_KEY=%s\n' "$CATALINA_CLAVE"
      printf 'ELEVENLABS_AGENT_ID=%s\n' "$CATALINA_AGENTE"
    } > .env.nuevo && mv .env.nuevo .env
    echo "  Guardadas. No hace falta que las vuelvas a escribir."
  else
    echo "  No pegaste nada. Catalina arranca igual, pero sin la voz de"
    echo "  ElevenLabs: usará OpenAI o Gemini si tienes esas claves puestas."
    echo "  Para ponerlas después, borra el archivo .env y vuelve a abrir esto."
  fi
  echo ""
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
