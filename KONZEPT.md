# PEP – Personaleinsatzplanung (Konzept v0.2)

Stand: 13.10.2026 · lokal auf dem MacBook · Web-Oberfläche in React

---

## 1. Ziel

Ein lokal laufendes System, das

1. das **Arbeitsaufkommen** (eingehende Paletten je Warengruppe) erfasst und daraus den **Personalbedarf** je Abteilung und Tag ableitet,
2. die **Mitarbeiter** mit Verträgen, Fähigkeiten und Abwesenheiten verwaltet,
3. einen **automatischen Planvorschlag** erzeugt, der Arbeitszeitgesetz, Verträge und Fähigkeiten einhält,
4. die **manuelle Planung** per Wochen- und Monatsansicht (Drag & Drop) erlaubt – mit Live-Prüfung der Regeln,
5. **KPIs** liefert (Anlieferungen, Leistung, Abdeckung, Überstunden).

### 1.1 Festgelegte Rahmenbedingungen

| Thema | Entscheidung |
|-------|--------------|
| Betriebstyp | Discounter-Filiale (Typ Lidl), ein Standort |
| Bundesland | **Baden-Württemberg** (inkl. Hl. Drei Könige, Fronleichnam, Allerheiligen) |
| Öffnungstage | **Mo–Sa**, keine Sonn- und Feiertagsarbeit |
| Arbeitszeiten | **flexibel** (Beginn/Ende im 15-Minuten-Raster), keine festen Schichten |
| Hotdays | Spitzentage mit erhöhtem Warenaufkommen (z. B. vor Weihnachten, Ostern, Brückentage) |
| Tarif/Betriebsvereinbarung | keine Abweichungen, es gilt das Gesetz |
| Daten | Mitarbeiter und KPIs sind **Mockdaten**, kein Import echter Daten geplant |

---

## 2. Module im Überblick

| # | Modul | Kerninhalt |
|---|-------|-----------|
| M1 | **Personaladministration** | Stammdaten, Verträge, Fähigkeiten, Abteilungszuordnung, Urlaub/Krank/Abwesenheiten |
| M2 | **Stammdaten Betrieb** | Abteilungen, Warengruppen, Schichtmodelle, Öffnungs-/Anlieferzeiten |
| M3 | **Kalender** | Gesetzliche Feiertage (je Bundesland), betriebliche Sondertage, **Hotdays** (Spitzentage) |
| M4 | **Wareneingang & KPIs** | Erfassung/Import der Paletten pro Tag, Durchschnitte, Prognose, Dashboards |
| M5 | **Bedarfsermittlung** | Paletten → benötigte Arbeitsstunden je Abteilung/Tag/Zeitfenster |
| M6 | **Planung manuell** | Wochenplan, Monatsplan, Drag & Drop, Regelverstöße live markiert |
| M7 | **Auto-Planung** | Optimierer erzeugt Vorschlag, Planer übernimmt ganz/teilweise |
| M8 | **Regelwerk / Compliance** | ArbZG, JArbSchG, MuSchG, Vertragsregeln – prüft jeden Plan |
| M9 | **Export** | Plan als PDF/Excel zum Aushang, CSV für Lohnbuchhaltung |

---

## 3. Fachliche Details

### 3.1 Personaladministration (M1)

**Mitarbeiter**
- Name, Personalnummer, Geburtsdatum (→ Jugendschutz-Prüfung), Eintritt/Austritt
- Stammabteilung + weitere einsetzbare Abteilungen
- Status: aktiv / inaktiv / Mutterschutz / Elternzeit

**Vertrag** (historisiert – ein Mitarbeiter kann mehrere Verträge nacheinander haben)
- Vertragsart: Vollzeit · Teilzeit · Minijob · Werkstudent · Aushilfe · Azubi
- Soll-Stunden pro Woche (z. B. 40 / 30 / 20) bzw. Monat
- Max. Tage pro Woche, erlaubte Wochentage, früheste Beginn-/späteste Endzeit
- Minijob: monatliche Verdienstgrenze → max. Stunden/Monat
- Urlaubsanspruch (Tage/Jahr)
- Stundenkonto (Plus-/Minusstunden, Übertrag)

**Fähigkeiten (Skills)**
- Skill = z. B. „Kühlware verräumen", „Getränke", „Non-Food", „Staplerschein", „Kasse"
- Pro Mitarbeiter & Skill: **Level** (1 = in Einarbeitung, 2 = selbstständig, 3 = Experte) und optional **individuelle Leistung** (Paletten/Stunde)
- Zertifikate mit Ablaufdatum (z. B. Staplerschein, Hygieneschulung) → Warnung vor Ablauf

**Abwesenheiten**
- Urlaub (beantragt / genehmigt), Krank, Schule/Berufsschule, Fortbildung, Wunschfrei
- Wiederkehrende Nichtverfügbarkeit (z. B. „dienstags nie")

### 3.2 Stammdaten Betrieb (M2)

- **Abteilungen** mit benötigten Skills, Mindestbesetzung, Arbeitszeitfenster
- **Warengruppen** (Trocken, Kühl, TK, Obst & Gemüse, Getränke, Non-Food …) → Zuordnung zu Abteilung + benötigtem Skill
- **Standard-Leistungswert** je Warengruppe: Paletten pro Personenstunde (z. B. Trocken 1,5 / Getränke 3,0)
- **Arbeitszeitvorlagen** (nur als Schnellauswahl, Zeiten bleiben frei editierbar): z. B. „Früh-Verräumung 05:00–11:00", „Tag 07:00–15:30", „Spät 13:30–21:45"

### 3.3 Kalender (M3)

- **Gesetzliche Feiertage Baden-Württemberg** automatisch berechnet (Osterformel + feste Daten): Neujahr, Hl. Drei Könige, Karfreitag, Ostermontag, 1. Mai, Christi Himmelfahrt, Pfingstmontag, Fronleichnam, Tag der Deutschen Einheit, Allerheiligen, 1./2. Weihnachtstag. An Feiertagen ist die Filiale geschlossen.
- **Betriebliche Sondertage**: Inventur, Schließtage, verkaufsoffene Sonntage
- **Hotdays** – Tage mit erwartetem Spitzenaufkommen:
  - automatisch vorgeschlagen: Tag vor und nach Feiertagen, Brückentage, Wochen vor Ostern/Weihnachten
  - manuell: Aktionswochen, Sonderlieferungen
  - jeder Hotday hat einen **Lastfaktor** (z. B. ×1,4) und optional eine **Urlaubssperre**
- Feiertage beeinflussen: Bedarf (geschlossen / verschobene Anlieferung), Soll-Stunden (Feiertagsgutschrift), Zuschläge

### 3.4 Wareneingang & KPIs (M4)

**Datenerfassung**: Zunächst **Mockdaten** (siehe 4.3) – 12 Monate generierte Anlieferungshistorie. Manuelle Erfassung und CSV/Excel-Import werden trotzdem gebaut, damit später echte Daten die Mockdaten ersetzen können.

**KPIs (Dashboard)**
- Ø Paletten pro Wochentag und Warengruppe (gleitend, letzte 4/8/12 Wochen)
- Trend und Prognose für die Planwoche (Wochentagsmittel × Hotday-Faktor)
- Ist-Leistung: Paletten pro Personenstunde je Abteilung
- **Abdeckungsgrad**: geplante Stunden ÷ benötigte Stunden (je Tag, rot < 90 %, grün 95–110 %)
- Überstunden/Stundenkonten, Krankenquote, Urlaubsplanung vs. Anspruch
- Skill-Matrix: wie viele Leute können welche Ware verräumen → Engpass-Skills

### 3.5 Bedarfsermittlung (M5)

```
Bedarf_h(Tag, Abteilung) = Σ_Warengruppe  Prognose_Paletten × Hotday-Faktor ÷ Leistung_Paletten_pro_h
Bedarf_Köpfe(Zeitfenster) = max( Mindestbesetzung, ⌈Bedarf_h verteilt auf Zeitfenster⌉ )
```
Ergebnis ist eine Bedarfskurve je Abteilung und Tag (z. B. in 30-min-Slots), gegen die der Plan geprüft wird.

### 3.6 Regelwerk (M8) – Arbeitszeitgesetz & Co.

Jede Regel ist eine eigene, testbare Funktion mit Schweregrad **hart** (darf nicht verletzt werden) oder **weich** (Warnung, Kosten im Optimierer).

| Regel | Quelle | Typ |
|-------|--------|-----|
| Max. 8 h/Tag, Verlängerung auf 10 h nur bei Ausgleich auf Ø 8 h in 6 Monaten / 24 Wochen | § 3 ArbZG | hart (10 h) / Ausgleich überwacht |
| Pause ≥ 30 min bei > 6 h, ≥ 45 min bei > 9 h | § 4 ArbZG | hart |
| Ruhezeit ≥ 11 h zwischen zwei Schichten | § 5 ArbZG | hart |
| Sonn- und Feiertagsruhe (Filiale nur Mo–Sa) | §§ 9–10 ArbZG | hart |
| Max. 48 h/Woche (6 Werktage × 8 h im Durchschnitt) | § 3 ArbZG | hart |
| Jugendliche: max. 8 h/Tag, 40 h/Woche, 5-Tage-Woche, 12 h Ruhe, keine Arbeit 20–6 Uhr | JArbSchG | hart |
| Mutterschutz: keine Mehrarbeit (> 8,5 h/Tag), keine Nachtarbeit | MuSchG | hart |
| Vertragliche Wochen-/Monatsstunden, erlaubte Tage/Zeiten | Vertrag | hart (max) / weich (Soll) |
| Minijob-Verdienstgrenze | Vertrag/SGB | hart |
| Skill vorhanden für Abteilung | Betrieb | hart |
| Faire Verteilung von Spätschichten/Samstagen, Wunschfrei | Betrieb | weich |

> Die Regelparameter (Stundengrenzen, Pausen …) liegen in einer Konfigurationstabelle, nicht im Code, damit Betriebsvereinbarungen/Tarifverträge abgebildet werden können.

### 3.7 Manuelle Planung (M6)

- **Wochenplan**: Zeilen = Mitarbeiter, Spalten = Tage; Zellen = Schichtblöcke (Farbe = Abteilung). Drag & Drop zwischen Tagen/Mitarbeitern.
- **Tagesansicht (Gantt)**: Zeitachse 0–24 h, Bedarfskurve als Hintergrund, Unter-/Überdeckung sichtbar.
- **Monatsplan**: kompakte Matrix (Kürzel F/S/U/K/frei), Summenzeilen je Tag, Summenspalte Stunden vs. Soll.
- **Abteilungsansicht**: Spalten = Abteilungen, wer ist wann wo.
- Live-Validierung: Verstoß → rotes Badge an der Schicht mit Erklärung („Ruhezeit nur 9,5 h nach Spätschicht am Vortag").
- Sperren (🔒) einzelner Einträge, damit die Auto-Planung sie nicht überschreibt.
- Planstatus: Entwurf → freigegeben → veröffentlicht (Aushang/Export). Änderungshistorie.

### 3.8 Automatische Planung (M7)

**Ansatz: Constraint-Optimierung mit Google OR-Tools (CP-SAT)**

- Flexible Zeiten werden über generierte Kandidaten abgebildet: Beginn alle 30 min, Länge 3–10 h → `x[Mitarbeiter, Tag, Kandidat, Abteilung] ∈ {0,1}`; der Planer kann das Ergebnis danach im 15-Minuten-Raster feinjustieren
- Harte Nebenbedingungen: alle harten Regeln aus 3.6, Abwesenheiten, gesperrte Einträge, Skills
- Zielfunktion (gewichtete Kosten, Gewichte in der UI einstellbar):
  1. Unterdeckung des Bedarfs (sehr hoch)
  2. Abweichung von Soll-Stunden laut Vertrag
  3. Überdeckung (Leerlauf)
  4. Einsatz außerhalb der Stammabteilung
  5. Unfaire Verteilung (Samstage, Spätschichten), nicht erfüllte Wünsche
  6. Bevorzugung höherer Skill-Level bei Engpass-Ware
- Laufzeitlimit (z. B. 30 s) → bestes gefundenes Ergebnis
- Ausgabe: Planvorschlag + Bericht („Mittwoch Kühlware 6 h unterdeckt – niemand mit Skill verfügbar")
- Modi: ganze Woche/Monat neu · nur Lücken füllen · Umplanen nach Krankmeldung

---

## 4. Technische Architektur

```
┌──────────────────────────── MacBook (lokal) ────────────────────────────┐
│                                                                         │
│  Browser  ──►  React-Frontend (Vite, TypeScript)                        │
│                 │  TanStack Query · React Router · dnd-kit · Recharts   │
│                 ▼  REST/JSON  (http://localhost:8000/api)               │
│  Backend: Python FastAPI                                                │
│     ├─ Domain-Services (Personal, Kalender, KPI, Planung)               │
│     ├─ Regelwerk (pure functions, pytest-getestet)                      │
│     ├─ Solver (OR-Tools CP-SAT)                                         │
│     └─ SQLAlchemy / SQLModel  ──►  SQLite-Datei  (data/pep.db)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Warum Python im Backend?** OR-Tools CP-SAT ist der mit Abstand stärkste frei verfügbare Solver für Schichtplanung und in Python am besten unterstützt. Python 3.13 und Node 22 sind auf dem Mac bereits installiert.

- **Datenbank**: SQLite – eine Datei, keine Installation, leicht zu sichern
- **Start**: ein Skript `./start.sh` startet Backend + Frontend; optional später als macOS-App (Tauri/Electron) verpacken
- **Frontend-UI**: shadcn/ui + Tailwind, deutsche Oberfläche, Datumslogik mit `date-fns` (de-Locale)
- **Feiertage**: Backend-Bibliothek `holidays` (Python, alle Bundesländer)
- **Tests**: pytest für Regelwerk & Solver, Vitest/Playwright fürs Frontend

### 4.1 Datenmodell (Kern)

```
Mitarbeiter(id, persnr, vorname, nachname, geburtsdatum, eintritt, austritt, stammabteilung_id, status)
Vertrag(id, mitarbeiter_id, art, gueltig_ab, gueltig_bis, soll_std_woche, max_std_monat,
        max_tage_woche, erlaubte_tage, frueheste_zeit, spaeteste_zeit, urlaubstage)
Skill(id, name, beschreibung)
MitarbeiterSkill(mitarbeiter_id, skill_id, level, leistung_pal_h, zertifikat_bis)
Abteilung(id, name, farbe, mindestbesetzung, oeffnung_von, oeffnung_bis)
AbteilungSkill(abteilung_id, skill_id)
Warengruppe(id, name, abteilung_id, skill_id, std_leistung_pal_h)
Wareneingang(datum, warengruppe_id, paletten, quelle)          -- Ist-Daten
Schichtmodell(id, name, beginn, ende, pause_min)
Kalendertag(datum, typ[feiertag|sondertag|hotday|schliesstag], name, bundesland, lastfaktor, urlaubssperre)
Abwesenheit(id, mitarbeiter_id, von, bis, typ, status)
Plan(id, zeitraum_von, zeitraum_bis, status, erstellt_von, erstellt_am)
Einsatz(id, plan_id, mitarbeiter_id, datum, beginn, ende, pause_min, abteilung_id, gesperrt, quelle[manuell|auto])
Regelparameter(schluessel, wert)
Aenderungslog(zeit, entitaet, id, alt, neu)
```

### 4.2 API-Auszug

```
GET/POST/PUT  /api/mitarbeiter, /api/vertraege, /api/skills, /api/abwesenheiten
GET           /api/kalender?jahr=2026&bundesland=NW
GET/POST      /api/wareneingang   ·  POST /api/wareneingang/import (CSV)
GET           /api/kpi/anlieferung?von=&bis=   ·  /api/kpi/abdeckung?plan_id=
GET           /api/bedarf?von=&bis=
GET/POST/PUT  /api/plaene/{id}/einsaetze
POST          /api/plaene/{id}/validieren       → Liste von Verstößen
POST          /api/plaene/{id}/auto-planen       → Vorschlag (async, mit Fortschritt)
GET           /api/plaene/{id}/export?format=pdf|xlsx|csv
```

### 4.3 Mockdaten

Alle **Mitarbeiter- und KPI-Daten sind Mockdaten**. Sie entstehen über einen reproduzierbaren Generator (`backend/seed/generate.py`, fester Zufalls-Seed). Mit ihm lässt sich die Datenbank jederzeit über einen Button „Demodaten zurücksetzen“ oder per `./seed.sh` neu befüllen.

**Filiale (Mock, Typ Lidl)**
- Öffnung Mo–Sa 07:00–21:00; Warenanlieferung frühmorgens, Verräumung ab 05:00
- 7 Abteilungen: Trockensortiment, Obst & Gemüse, Kühlung (Molkerei/Fleisch), Tiefkühl, Getränke, Aktionsware/Non-Food, Backstation, dazu **Kasse** (Bedarf nach Kundenfrequenz statt Paletten)
- 7 Warengruppen mit Standard-Leistungswerten (z. B. Trocken 1,5 / Kühl 1,8 / TK 1,6 / Getränke 3,0 / Non-Food 1,2 Pal/h)
- Skills: Verräumen je Bereich, Kasse, Backstation, Flaschenautomat/Leergut, Staplerschein bzw. Ameise (Ablaufdatum), Hygieneschulung (Ablaufdatum), Schlüsselberechtigung/Filialverantwortung
- Rollen: Filialleitung, Stellvertretung, Verkäufer/in, Aushilfen

**Mitarbeiter (Mock), ca. 30 Personen**
| Anteil | Vertrag | Soll-Std./Woche |
|--------|---------|-----------------|
| ~25 % | Vollzeit | 40 |
| ~35 % | Teilzeit | 20–30 |
| ~25 % | Minijob | ≤ 43 h/Monat (Verdienstgrenze) |
| ~5 % | Werkstudent | ≤ 20 |
| ~10 % | Azubi, davon 1 minderjährig (→ JArbSchG greift) | 40 / 5-Tage-Woche |

- Fiktive deutsche Namen (Generator mit Vor- und Nachnamenlisten, keine realen Personen)
- Pro Person 1–4 Skills mit Level 1–3 und individuellen Leistungsabweichungen (±20 %)
- Pro Person Urlaub, Krankheitstage (ca. 5 % Quote), Wunschfrei-Tage und wiederkehrende Nichtverfügbarkeiten
- Bewusst eingebaute Grenzfälle: 1 Person im Mutterschutz, 1 ablaufender Staplerschein, ein Engpass-Skill (TK hat nur wenige Personen), Stundenkonten mit Plus- und Minusstunden

**Wareneingang / KPIs (Mock): 12 Monate Historie bis heute**
- Basiswert je Warengruppe und Wochentag (z. B. Montag und Donnerstag stark, Samstag schwach)
- Saisonalität: Getränke im Sommer +30 %, Weihnachtsgeschäft ab November +25 %
- Hotday-Effekte: Tage vor Feiertagen und Brückentage ×1,3–1,6
- Normalverteiltes Rauschen (±10 %) und vereinzelte Ausreißer (Sonderlieferungen)
- Keine Anlieferung an Sonn- und Feiertagen; der Folgetag wird entsprechend höher
- Kundenfrequenz pro Stunde (für den Kassenbedarf) mit Mittags- und Feierabendspitze, Samstag stark
- Daraus ergeben sich glaubwürdige Ø-Werte, Trends und Prognosen für das Dashboard

**Pläne (Mock)**
- Die letzten 4 Wochen als freigegebene Pläne mit Ist-Leistung, damit die KPIs Leistung und Abdeckung Daten haben
- Die aktuelle Woche als Entwurf mit einigen eingebauten Regelverstößen, um die Validierung vorzuführen

Mockdaten sind in der DB markiert (`quelle = 'mock'`).

---

## 5. Umsetzungsphasen

| Phase | Inhalt | Ergebnis |
|-------|--------|----------|
| **1 – Fundament** | Projektgerüst, DB, **Mockdaten-Generator**, Personaladministration, Abteilungen, Skills, Verträge | ~45 Mock-Mitarbeiter sichtbar und pflegbar |
| **2 – Kalender** | Feiertage je Bundesland, Sondertage, Hotdays, Abwesenheiten | Jahreskalender |
| **3 – Manuelle Planung** | Wochen-/Monatsplan mit Drag & Drop, Regelwerk + Live-Validierung | erster nutzbarer Plan |
| **4 – Wareneingang & KPIs** | KPI-Dashboard auf Mock-Historie, Import, Bedarfsberechnung, Abdeckungsanzeige | datenbasierte Planung |
| **5 – Auto-Planung** | CP-SAT-Solver, Gewichtungen, Vorschlag übernehmen | Planvorschlag per Klick |
| **6 – Feinschliff** | Export PDF/Excel, Stundenkonten, Historie, Backup, App-Verpackung | produktionsreif |

Phase 1–3 ergeben bereits ein brauchbares Werkzeug; ab Phase 4/5 wird es „intelligent".

---

## 6. Offene Fragen

1. **Nutzer**: Nur eine Person am MacBook, oder sollen später andere im Netzwerk zugreifen (dann Login + Rollen)?
2. Sollen **Mitarbeiter ihren Plan sehen** (Export/Ausdruck reicht, oder eigene Ansicht)?
