# PEP – Personaleinsatzplanung 🐿

**Eichhörnchen-PEP** ist eine lokale Web-Anwendung zur Personaleinsatzplanung für eine Discounter-Filiale in Baden-Württemberg (Demo: „Filiale Musterstadt“). Sie plant vorausschauend wie ein Eichhörnchen: Wareneingang und Kundenfrequenz werden in Personalbedarf übersetzt, Mitarbeitende werden manuell oder per Optimierer eingeplant, und jeder Plan wird gegen Arbeitszeitgesetz, Jugendarbeitsschutz, Mutterschutz und Vertragsregeln geprüft.

Die Anwendung läuft vollständig auf dem eigenen Rechner (macOS), ohne Server, Cloud oder Anbindung an Drittsysteme. Alle Mitarbeiter- und KPI-Daten sind **deterministische Mockdaten** (Seed 42).

## Funktionsüberblick

| # | Modul | Was es kann | Oberfläche |
|---|---|---|---|
| M1 | Personaladministration | Stammdaten, historisierte Verträge, Fähigkeiten (Skill-Matrix), Abwesenheiten (Urlaub, krank, Schule …) | Mitarbeiter, Skill-Matrix, Abwesenheiten |
| M2 | Stammdaten Betrieb | Abteilungen mit Farben und Mindestbesetzung, Warengruppen, Schichtmodelle, Regelparameter | Stammdaten |
| M3 | Kalender | Gesetzliche Feiertage BW (berechnet), Sondertage, Schließtage, Hotdays inkl. automatischer Vorschläge und Urlaubssperre | Kalender |
| M4 | Wareneingang & KPIs | Paletten je Tag, Kundenfrequenz, Prognose, Abdeckung, Leistung, Stunden | Dashboard, KPIs |
| M5 | Bedarfsermittlung | Paletten/Kunden → benötigte Stunden je Abteilung, Tag und Zeitfenster | Planung |
| M6 | Planung manuell | Wochen- und Monatsplan, Drag & Drop, Sperren, Live-Validierung | Planung |
| M7 | Auto-Planung | CP-SAT-Optimierer (Google OR-Tools): neu planen, Lücken füllen, umplanen; Bericht zu Unterdeckungen | Planung |
| M8 | Regelwerk | ArbZG, JArbSchG, MuSchG, Minijob- und Vertragsregeln, harte/weiche Verstöße | Planung |
| M9 | Export | PDF-Aushang (A4 quer), Excel-Arbeitsmappe, CSV für die Lohnbuchhaltung | Planung → Export |

### Export (M9)

`GET /api/plaene/{id}/export?format=pdf|xlsx|csv` liefert eine Datei zum Herunterladen, z. B. `PEP_KW42_2026.pdf`.

- **PDF „Aushang Wochenplan“**: je Kalenderwoche eine Seite, Mitarbeitende nach Stammabteilung gruppiert (Farbbalken = Abteilungsfarbe), Tage Mo–Sa, Feiertage als „geschlossen“, Einsätze als „06:00–14:30 TRO“, Stundensumme. Genehmigte Abwesenheiten erscheinen als „Urlaub“; Krankheit wird aus Datenschutzgründen nur als „abwesend“ angezeigt.
- **Excel**: Blatt „Wochenplan“ (Matrix wie im Aushang, Kopf fixiert) und Blatt „Einsätze“ (eine Zeile je Einsatz mit Netto-Stunden, Abteilung, Sperre, Quelle).
- **CSV (Lohnbuchhaltung)**: Semikolon-getrennt, UTF-8 mit BOM, Dezimalkomma; Spalten `persnr;nachname;vorname;datum;beginn;ende;pause_min;netto_std;abteilung;vertragsart`.

## Voraussetzungen

- macOS (Linux funktioniert ebenso)
- Python ≥ 3.13 (z. B. `brew install python@3.13`)
- Node.js ≥ 22 (z. B. `brew install node`)

## Schnellstart

```bash
./start.sh          # Entwicklung: Backend mit Auto-Reload + Vite-Dev-Server
```

Beim ersten Start richtet das Skript automatisch `backend/.venv` (pip install) und `frontend/node_modules` (npm install) ein. Danach:

- Oberfläche: <http://localhost:5173>
- API-Dokumentation: <http://127.0.0.1:8000/docs>
- Beenden: `Ctrl+C` (stoppt beide Prozesse)

```bash
./start.sh prod     # Frontend bauen, nur ein Prozess auf http://127.0.0.1:8000
```

Im Produktionsmodus liefert FastAPI das gebaute Frontend (`frontend/dist`) direkt aus; auf macOS öffnet sich der Browser automatisch.

```bash
./seed.sh           # Demodaten neu erzeugen (mit Rückfrage; ./seed.sh -y ohne)
```

Beim allerersten Start mit leerer Datenbank werden die Demodaten automatisch angelegt.

## Entwicklung

| Aufgabe | Befehl |
|---|---|
| Backend-Tests | `cd backend && .venv/bin/python -m pytest -q` |
| Typprüfung Frontend | `cd frontend && npx tsc -b` |
| Frontend-Build | `cd frontend && npm run build` |
| Backend einzeln | `cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload` |
| Frontend einzeln | `cd frontend && npm run dev` |

Die Tests verwenden eine eigene temporäre Datenbank und den festen Stichtag 13.10.2026.

## Konfiguration

| Variable | Bedeutung | Standard |
|---|---|---|
| `PEP_DB` | Pfad zur SQLite-Datenbank | `backend/data/pep.db` |
| `PEP_HEUTE` | „Heute“ für Mockdaten und Auswertungen (ISO-Datum, z. B. `2026-10-13`) | Systemdatum |
| `PEP_PORT` | Port des Backends in `start.sh` (im Dev-Modus erwartet der Vite-Proxy Port 8000) | `8000` |
| `PEP_SKIP_BUILD` | `1` = `./start.sh prod` ohne `npm run build` | – |
| `PEP_NO_BROWSER` | `1` = keinen Browser öffnen | – |
| `PEP_PYTHON` | Python-Interpreter für die Ersteinrichtung der `.venv` | `python3.13` / `python3` |

Beispiel: `PEP_PORT=8010 PEP_DB=~/pep-test.db ./start.sh prod`

## Backup

Die gesamte Datenhaltung steckt in einer Datei: `backend/data/pep.db` (bzw. `PEP_DB`).

- **Sichern**: Anwendung beenden und die Datei kopieren, z. B. `cp backend/data/pep.db ~/Backups/pep-$(date +%F).db`. Time Machine erfasst die Datei automatisch.
- **Wiederherstellen**: Anwendung beenden, Kopie zurück nach `backend/data/pep.db` legen, neu starten.
- Da es nur Mockdaten gibt, ist auch `./seed.sh` eine vollständige Wiederherstellung des Demostands.

## Verzeichnisstruktur

```
pep/
├── start.sh                  Start (Entwicklung / prod)
├── seed.sh                   Demodaten neu erzeugen
├── KONZEPT.md                Fachkonzept
├── docs/
│   ├── TECHNISCHES_KONZEPT.md Technisches Konzept (Architektur, Datenmodell, API, Regelwerk, Solver)
│   └── UMSETZUNGSPLAN.md     Umsetzungscluster & Eichhörnchen-Designsystem
├── backend/
│   ├── requirements.txt
│   ├── data/pep.db           SQLite-Datenbank (nicht versioniert)
│   ├── app/
│   │   ├── main.py           FastAPI-App, liefert frontend/dist aus
│   │   ├── models.py         Datenmodell (SQLModel)
│   │   ├── db.py, util.py    DB-Verbindung, Zeitrechnung
│   │   ├── kalender.py       Feiertage BW & Hotdays
│   │   ├── seed*.py          Mockdaten-Generator
│   │   ├── routers/          REST-Endpunkte (personal, planung, kpi, solver, export)
│   │   ├── regeln/           Regelwerk (ArbZG, JArbSchG, MuSchG …)
│   │   ├── solver/           Auto-Planung (CP-SAT)
│   │   └── export/           PDF, Excel, CSV
│   └── tests/                pytest
└── frontend/
    ├── vite.config.ts        Dev-Server, Proxy /api → :8000
    └── src/
        ├── api.ts            API-Client & Typen
        ├── components/ui.tsx Eichhörnchen-UI-Bausteine
        └── pages/            Seiten je Modul
```

## Weiterführende Dokumente

- [KONZEPT.md](KONZEPT.md) – Fachkonzept (Module, Regeln, Mockdaten)
- [docs/TECHNISCHES_KONZEPT.md](docs/TECHNISCHES_KONZEPT.md) – Architektur, Datenmodell, API, Regelwerk, Solver, Betrieb
