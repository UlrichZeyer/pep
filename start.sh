#!/usr/bin/env bash
# PEP starten.
#   ./start.sh        Entwicklung: uvicorn --reload (Port 8000) + Vite (Port 5173), Ende mit Ctrl+C
#   ./start.sh prod   Frontend bauen und nur uvicorn auf Port 8000 starten (liefert frontend/dist aus)
# Umgebungsvariablen: PEP_PORT (Backend-Port, Standard 8000), PEP_DB, PEP_HEUTE,
#   PEP_SKIP_BUILD=1 (prod ohne npm run build), PEP_NO_BROWSER=1 (keinen Browser öffnen),
#   PEP_PYTHON (Python-Interpreter für die Ersteinrichtung, Standard python3.13 bzw. python3)
# Kompatibel mit der macOS-Standard-Bash 3.2.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$WURZEL/backend"
FRONTEND="$WURZEL/frontend"
VENV="$BACKEND/.venv"
MODUS="${1:-dev}"
PORT="${PEP_PORT:-8000}"
HOST="127.0.0.1"

info()   { printf '\033[38;5;130m🐿  %s\033[0m\n' "$*"; }
fehler() { printf '\033[31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }

case "$MODUS" in
  dev|prod) ;;
  -h|--help|hilfe) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) fehler "unbekannter Modus „$MODUS“ – erlaubt: ./start.sh oder ./start.sh prod" ;;
esac

# --- Voraussetzungen -------------------------------------------------------
python_ok() { "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)' 2>/dev/null; }

if [ ! -x "$VENV/bin/python" ]; then
  PY=""
  for kandidat in "${PEP_PYTHON:-}" python3.14 python3.13 python3; do
    if [ -n "$kandidat" ] && command -v "$kandidat" >/dev/null 2>&1 && python_ok "$kandidat"; then
      PY="$kandidat"; break
    fi
  done
  [ -n "$PY" ] || fehler "Python ≥ 3.13 nicht gefunden (z. B. „brew install python@3.13“)."
  info "Richte Python-Umgebung ein ($("$PY" --version)) …"
  "$PY" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip >/dev/null
  "$VENV/bin/python" -m pip install -q -r "$BACKEND/requirements.txt"
  touch "$VENV/.pep-installiert"
else
  python_ok "$VENV/bin/python" || fehler "backend/.venv nutzt Python < 3.13 – Ordner löschen und neu starten."
  if [ "$BACKEND/requirements.txt" -nt "$VENV/.pep-installiert" ]; then
    info "requirements.txt geändert – aktualisiere Python-Pakete …"
    "$VENV/bin/python" -m pip install -q -r "$BACKEND/requirements.txt"
    touch "$VENV/.pep-installiert"
  fi
fi

command -v node >/dev/null 2>&1 || fehler "Node.js ≥ 22 nicht gefunden (z. B. „brew install node“)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fehler "Node.js ≥ 22 benötigt, gefunden: $(node --version)."

if [ ! -d "$FRONTEND/node_modules" ] || [ "$FRONTEND/package.json" -nt "$FRONTEND/node_modules" ]; then
  info "Installiere Frontend-Pakete (npm install) …"
  (cd "$FRONTEND" && npm install)
  touch "$FRONTEND/node_modules"
fi

browser_oeffnen() {
  [ -z "${PEP_NO_BROWSER:-}" ] && [ "$(uname)" = "Darwin" ] && command -v open >/dev/null 2>&1 || return 0
  (sleep "${2:-3}"; open "$1") >/dev/null 2>&1 &
}

# --- Produktion ------------------------------------------------------------
if [ "$MODUS" = "prod" ]; then
  if [ -n "${PEP_SKIP_BUILD:-}" ]; then
    info "Build übersprungen (PEP_SKIP_BUILD)."
  else
    info "Baue Frontend (npm run build) …"
    (cd "$FRONTEND" && npm run build)
  fi
  [ -d "$FRONTEND/dist" ] || info "Hinweis: frontend/dist fehlt – es läuft nur die API."
  info "PEP läuft auf http://$HOST:$PORT  (Ende mit Ctrl+C)"
  browser_oeffnen "http://$HOST:$PORT" 2
  cd "$BACKEND"
  exec "$VENV/bin/python" -m uvicorn app.main:app --host "$HOST" --port "$PORT"
fi

# --- Entwicklung -----------------------------------------------------------
PIDS=""
beenden() {
  trap - INT TERM EXIT
  if [ -n "$PIDS" ]; then
    info "Beende PEP …"
    kill $PIDS 2>/dev/null || true
    wait $PIDS 2>/dev/null || true
  fi
}
trap 'beenden; exit 130' INT TERM
trap beenden EXIT

[ "$PORT" = "8000" ] || info "Hinweis: der Vite-Proxy (vite.config.ts) erwartet die API auf Port 8000."

(cd "$BACKEND" && exec "$VENV/bin/python" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --reload) &
PIDS="$!"
(cd "$FRONTEND" && exec ./node_modules/.bin/vite --host "$HOST") &
PIDS="$PIDS $!"

info "Backend:  http://$HOST:$PORT/docs"
info "Frontend: http://localhost:5173   (Ende mit Ctrl+C)"
browser_oeffnen "http://localhost:5173" 4

# Läuft, bis einer der Prozesse endet oder Ctrl+C gedrückt wird
while :; do
  for pid in $PIDS; do
    kill -0 "$pid" 2>/dev/null || { info "Ein Prozess wurde beendet – stoppe PEP."; exit 1; }
  done
  sleep 1
done
