# Plan: PEP fertigstellen – Aufgabencluster, Agenten-Workflow, Eichhörnchen-Design

## Context
Das Fach- und das technische Konzept stehen (`KONZEPT.md`, `docs/TECHNISCHES_KONZEPT.md`). Das Backend für Phase 1/2 ist fertig und getestet (`backend/app/{models,db,kalender,seed,main}.py`, 6 Tests grün). Das Frontend ist nur ein Gerüst (`frontend/src/{App,api,main}.tsx`, `components/ui.tsx`); die Seiten fehlen, der Build ist daher aktuell rot.
Ziel: **die komplette Anwendung (Phasen 1–6) möglichst schnell**, indem die Arbeit in unabhängige Cluster geschnitten und über einen **Workflow mit parallelen Agenten** umgesetzt wird. Optik: **Eichhörnchen-Designsystem** (siehe unten).

## Eichhörnchen-Designsystem (ersetzt das DHBW-Design, Vorgabe „/design eichhörnchen“)
| Token (Tailwind `@theme`) | Wert | Verwendung |
|---|---|---|
| `fell` | `#B5541E` | Primärfarbe: aktive Navigation, Primär-Buttons, Akzente |
| `fell-dunkel` | `#8F3F14` | Hover/Pressed |
| `fell-hell` | `#F6E3D3` | aktive Navigation, Hervorhebungsflächen |
| `haselnuss` / `eichel` | `#7A4E2D` / `#A06A3B` | Sekundärakzent, Feldbeschriftungen |
| `rinde` | `#2F2620` | Text, Überschriften |
| `moos` / `moos-hell` | `#55703B` / `#E6EDDC` | Natur-Akzent, zweite Datenreihe |
| `creme` / `sand` / `stein` | `#FBF7F1` / `#EFE6DA` / `#7D7268` | Hintergrund / Linien / Hilfstext |
- **Schrift:** „Nunito“ (Google Fonts, rund und freundlich), fett für Navigation/Überschriften.
- **Formensprache:** freundlich-gerundet (Karten 10 px, Buttons 8 px, Badges als Pillen), weiße Karten auf Creme, dünne Sandlinien, Farbverlauf Fell → Eichel → Moos als Akzentlinie unter der Kopfzeile.
- **Shell:** weiße Kopfzeile mit Eichhörnchen-Logo (`public/eichhoernchen.svg`), Wortmarke „PEP.“ und Untertitel „Personaleinsatzplanung · vorausschauend wie ein Eichhörnchen“; links Navigation mit Fell-Balken am aktiven Eintrag.
- **Statusfarben** (getrennt von der Primärfarbe!): ok `#2E7D32`, Warnung `#B26A00`, Verstoß `#C62828` – immer mit Icon und Text (nie nur Farbe). Abteilungsfarben bleiben Kategoriefarben.
- **Leerzustände** mit Eichel-Icon. Tokens in `frontend/src/index.css`, Komponenten in `frontend/src/components/ui.tsx`.

## Aufgabencluster
| Cluster | Inhalt | Dateien (exklusiv) | Abhängig von |
|---|---|---|---|
| **W0 Fundament** (ich selbst, sequenziell) | Eichhörnchen-Tokens + Schrift, `ui.tsx` restylen, App-Shell; **Verträge festziehen**: `Plan`, `Einsatz`, `Regelparameter`, `Kundenfrequenz` in `models.py`; alle TS-Typen in `api.ts`; `main.py` in Router aufteilen (`routers/personal.py`, bestehende Endpunkte) + leere Router-Stubs `planung.py`, `kpi.py`, `solver.py`, `export.py` mit `include_router`; `seed.py` ruft Stubs `seed_plaene.generate()`/`seed_frequenz.generate()`; `npm i @dnd-kit/core`, `pip install ortools openpyxl reportlab`; Platzhalterseiten, damit der Build grün ist | alle o. g. | – |
| **A Regelwerk & Planungs-API** | `app/regeln/` (alle Regeln aus Kap. 8, reine Funktionen), `routers/planung.py` (Pläne/Einsätze CRUD, `/validieren`), `seed_plaene.py` (4 freigegebene Wochen + aktuelle Entwurfswoche mit eingebauten Verstößen), Tests `tests/test_regeln.py` (Grenzwerte) | `app/regeln/*`, `routers/planung.py`, `seed_plaene.py`, `tests/test_regeln.py`, `tests/test_planung.py` | W0 |
| **B Bedarf & KPI-API** | `app/bedarf.py` (Prognose Ø Wochentag × Saison × Hotday → Stunden je Abteilung/30-min-Slot, Kasse aus Kundenfrequenz), `app/kpi.py`, `routers/kpi.py` (`/bedarf`, `/kpi/anlieferung`, `/kpi/abdeckung`, `/kpi/stunden`), `seed_frequenz.py`, Tests | `bedarf.py`, `kpi.py`, `routers/kpi.py`, `seed_frequenz.py`, `tests/test_bedarf.py` | W0 |
| **C Frontend Personal** | Seiten Übersicht/Dashboard, Mitarbeiterliste (Suche/Filter), Mitarbeiterdetail (Stammdaten, Verträge, Skills, Abwesenheiten), Skill-Matrix | `pages/Dashboard.tsx`, `MitarbeiterListe.tsx`, `MitarbeiterDetail.tsx`, `SkillMatrix.tsx` | W0 |
| **D Frontend Kalender & Stammdaten** | Abwesenheiten (Monats-Zeitstrahl, anlegen/bearbeiten, Warnungen), Jahreskalender (Feiertage BW, Hotdays mit Lastfaktor, Sondertage pflegen, „Hotdays vorschlagen“), Stammdaten (Abteilungen, Warengruppen-Leistung) | `pages/Abwesenheiten.tsx`, `Kalender.tsx`, `Stammdaten.tsx` | W0 |
| **E Frontend Einsatzplanung** | Wochenplan (Mitarbeiter × Tage, dnd-kit Drag & Drop, Einsatz-Dialog im 15-min-Raster, Sperren), Tagesansicht (Gantt mit Bedarfskurve), Monatsplan (Matrix + Summen Ist/Soll), Verstoß-Badges aus `/validieren`, Planstatus | `pages/planung/*` | W0 (Vertrag), integriert gegen A |
| **F Frontend KPIs** | KPI-Seite: Ø Paletten je Wochentag/Warengruppe, Trend 12 Monate, Prognose nächste Woche, Abdeckungsgrad, Stundenkonten (Recharts, dataviz-Regeln) | `pages/Kpis.tsx`, `components/charts/*` | W0, integriert gegen B |
| **G Auto-Planung** | `app/solver/` (Kandidaten, CP-SAT-Modell, Gewichte, Zeitlimit, Bericht), `routers/solver.py` (`/plaene/{id}/auto-planen`, Status-Polling), Gegenprüfung mit Regelwerk, Button + Ergebnisbericht in Planung (eigene Datei `pages/planung/AutoPlanDialog.tsx`), Tests | `solver/*`, `routers/solver.py`, `AutoPlanDialog.tsx`, `tests/test_solver.py` | A + B |
| **H Export & Betrieb** | `routers/export.py` (PDF Aushang Wochenplan, Excel, CSV), `start.sh` (Backend + Frontend), Frontend-Build über FastAPI ausliefern, README | `routers/export.py`, `start.sh`, `README.md` | A |
| **V Integration & QA** | alle Tests, `npm run build`, App starten, im Browser jede Seite durchklicken (Screenshots), Fehler beheben, `TECHNISCHES_KONZEPT.md` Status auf ✅ | übergreifend | alle |

Kollisionsvermeidung: Jeder Agent schreibt **nur seine exklusiven Dateien**; gemeinsame Dateien (`models.py`, `api.ts`, `main.py`, `App.tsx`, `seed.py`, `package.json`) werden in W0 vorbereitet und danach nur von V angefasst. Kein Agent startet Dev-Server auf 5173/8000 (nur Tests/`tsc`); Agenten bewerten Typfehler nur in eigenen Dateien.

## Workflow (Agenten-Einteilung, ≤ 10 Agenten)
1. **W0** – ich, direkt (ca. 15 min), danach Build grün und pytest grün.
2. **Welle 1 – parallel (6 Agenten):** A, B, C, D, E, F.
3. **Welle 2 – parallel (2 Agenten), startet sobald A+B fertig:** G, H (Pipeline: G wartet auf A und B, H nur auf A).
4. **Welle 3 – 1 Agent:** V (Integration, Browser-Check, Doku-Update).
Umsetzung mit dem `Workflow`-Tool (vorher `workflow-authoring`-Skill laden), Agenten-Prompts enthalten: Konzeptkapitel, exklusive Dateiliste, API-Vertrag aus `api.ts`, Eichhörnchen-Designregeln, Definition of Done (eigene Tests grün, keine Typfehler in eigenen Dateien).

## Wiederverwendung
- `kalender.feiertage()`, `ist_werktag()`, `hotday_vorschlaege()` (`backend/app/kalender.py`) – in Bedarf, Regelwerk, Solver nutzen.
- `_aktueller_vertrag()`, `_alter()` (`backend/app/main.py` → wandert nach `routers/personal.py` bzw. `app/util.py`) – im Regelwerk für JArbSchG/Vertragsregeln.
- `api`-Client, Labels (`VERTRAGSARTEN`, `ABWESENHEITSTYPEN` …) aus `frontend/src/api.ts`; `Card`, `Modal`, `Field`, `SeitenKopf` … aus `components/ui.tsx`.
- Test-Setup `backend/tests/conftest.py` (eigene Temp-DB, fester Stichtag 13.10.2026).

## Verifikation
- `cd backend && .venv/bin/python -m pytest -q` – alle Tests grün (Regelgrenzwerte, Bedarf, Solver ohne harte Verstöße).
- `cd frontend && npm run build` – ohne Fehler.
- `./start.sh`, dann im Browser-Pane: Übersicht, Mitarbeiter anlegen, Urlaub in Sperrzeit (Warnung), Kalender BW 2026, Wochenplan per Drag & Drop mit Verstoß-Badge, „Vorschlag erzeugen“ füllt die Woche ohne harte Verstöße, KPI-Seite zeigt Charts, PDF-Export lädt.
- Optischer Abgleich mit dem Eichhörnchen-Designsystem per Screenshot.
