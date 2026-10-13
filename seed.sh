#!/usr/bin/env bash
# Demodaten neu erzeugen (löscht ALLE Daten in der PEP-Datenbank und legt die Mockdaten neu an).
#   ./seed.sh          mit Rückfrage
#   ./seed.sh -y       ohne Rückfrage
# Datenbankpfad über PEP_DB, Stichtag über PEP_HEUTE (Standard: heute).
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$WURZEL/backend/.venv/bin/python"
[ -x "$PY" ] || { echo "Fehler: backend/.venv fehlt – zuerst ./start.sh ausführen." >&2; exit 1; }

if [ "${1:-}" != "-y" ] && [ -t 0 ]; then
  printf 'Alle Daten werden durch Demodaten ersetzt. Fortfahren? [j/N] '
  read -r antwort
  case "$antwort" in j|J|ja|Ja|y|Y) ;; *) echo "Abgebrochen."; exit 0 ;; esac
fi

cd "$WURZEL/backend"
exec "$PY" -m app.seed
