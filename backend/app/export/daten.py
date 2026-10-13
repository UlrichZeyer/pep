"""Aufbereitung eines Plans für alle Exportformate (liest direkt über die SQLModel-Modelle)."""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from app.kalender import feiertage, montag
from app.models import Abteilung, Abwesenheit, Einsatz, Kalendereintrag, Mitarbeiter, Plan, Vertrag
from app.util import aktueller_vertrag, arbeitsminuten

FILIALE = "Filiale Musterstadt"
AKZENT = "#B5541E"  # Eichhörnchen-Rostrot (fell)

PLANSTATUS = {"entwurf": "Entwurf", "freigegeben": "freigegeben", "veroeffentlicht": "veröffentlicht"}
WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

# Abwesenheiten im Aushang. Krankheit wird aus Datenschutzgründen nur als „abwesend“ gezeigt.
ABWESENHEIT_AUSHANG = {
    "urlaub": "Urlaub", "krank": "abwesend", "schule": "Berufsschule",
    "fortbildung": "Fortbildung", "wunschfrei": "frei", "sonstiges": "abwesend",
}


@dataclass
class Zeile:
    """Ein Mitarbeiter in der Matrix."""

    mitarbeiter: Mitarbeiter
    einsaetze: dict[date, list[Einsatz]] = field(default_factory=lambda: defaultdict(list))
    abwesend: dict[date, str] = field(default_factory=dict)

    @property
    def name(self) -> str:
        return f"{self.mitarbeiter.nachname}, {self.mitarbeiter.vorname}"

    def minuten(self, tage: list[date]) -> int:
        return sum(arbeitsminuten(e.beginn, e.ende, e.pause_min) for t in tage for e in self.einsaetze.get(t, []))


@dataclass
class Gruppe:
    abteilung: Optional[Abteilung]
    zeilen: list[Zeile]

    @property
    def name(self) -> str:
        return self.abteilung.name if self.abteilung else "Ohne Stammabteilung"

    @property
    def farbe(self) -> str:
        return self.abteilung.farbe if self.abteilung else "#7D7268"


@dataclass
class PlanDaten:
    plan: Plan
    tage: list[date]  # Mo–Sa im Planzeitraum
    geschlossen: dict[date, str]  # Feiertage BW / Schließtage → Name
    gruppen: list[Gruppe]
    abteilungen: dict[int, Abteilung]
    einsaetze: list[Einsatz]
    mitarbeiter: dict[int, Mitarbeiter]
    vertraege: dict[int, list[Vertrag]]
    erstellt: datetime

    @property
    def wochen(self) -> list[list[date]]:
        """Tage gruppiert nach Kalenderwoche (je Woche eine PDF-Seite)."""
        w: dict[date, list[date]] = {}
        for t in self.tage:
            w.setdefault(montag(t), []).append(t)
        return list(w.values())

    @property
    def status_text(self) -> str:
        return PLANSTATUS.get(self.plan.status, self.plan.status)

    def zelle(self, zeile: Zeile, tag: date) -> str:
        """Zelltext für Aushang/Excel: Einsätze, sonst Abwesenheit bzw. „geschlossen“."""
        if tag in self.geschlossen:
            return "geschlossen"
        teile = [f"{e.beginn}–{e.ende} {self.abt_kuerzel(e.abteilung_id)}" for e in zeile.einsaetze.get(tag, [])]
        if teile:
            return "\n".join(teile)
        return zeile.abwesend.get(tag, "")

    def abt_kuerzel(self, abteilung_id: int) -> str:
        a = self.abteilungen.get(abteilung_id)
        return a.kuerzel if a else ""

    def abt_name(self, abteilung_id: Optional[int]) -> str:
        a = self.abteilungen.get(abteilung_id) if abteilung_id is not None else None
        return a.name if a else ""

    def vertragsart(self, mitarbeiter_id: int, stichtag: date) -> str:
        v = aktueller_vertrag(self.vertraege.get(mitarbeiter_id, []), stichtag)
        return v.art if v else ""


def kw_text(tage: list[date]) -> str:
    kw = tage[0].isocalendar()
    return f"KW {kw.week}/{kw.year}"


def dateiname(plan: Plan, endung: str) -> str:
    """z. B. PEP_KW42_2026.pdf bzw. PEP_KW42-KW45_2026.xlsx."""
    a, b = plan.von.isocalendar(), plan.bis.isocalendar()
    if (a.year, a.week) == (b.year, b.week):
        kw = f"KW{a.week:02d}"
    else:
        kw = f"KW{a.week:02d}-KW{b.week:02d}"
    return f"PEP_{kw}_{a.year}.{endung}"


def lade_plan_daten(session: Session, plan_id: int) -> Optional[PlanDaten]:
    plan = session.get(Plan, plan_id)
    if plan is None:
        return None
    tage, t = [], plan.von
    while t <= plan.bis:
        if t.weekday() < 6:
            tage.append(t)
        t += timedelta(days=1)

    geschlossen: dict[date, str] = {}
    for jahr in range(plan.von.year, plan.bis.year + 1):
        for tag, name in feiertage(jahr).items():
            if plan.von <= tag <= plan.bis:
                geschlossen[tag] = name
    for k in session.exec(select(Kalendereintrag).where(
            Kalendereintrag.typ == "schliesstag", Kalendereintrag.datum >= plan.von,
            Kalendereintrag.datum <= plan.bis)):
        geschlossen.setdefault(k.datum, k.name)

    abteilungen = {a.id: a for a in session.exec(select(Abteilung).order_by(Abteilung.sortierung))}
    einsaetze = list(session.exec(select(Einsatz).where(Einsatz.plan_id == plan_id)
                                  .order_by(Einsatz.datum, Einsatz.beginn)))
    alle_ma = {m.id: m for m in session.exec(select(Mitarbeiter))}
    mit_einsatz = {e.mitarbeiter_id for e in einsaetze}
    # Aushang: alle aktiven, im Zeitraum beschäftigten Mitarbeiter plus alle mit Einsatz
    relevant = {
        mid: m for mid, m in alle_ma.items()
        if mid in mit_einsatz or (
            m.status == "aktiv" and m.eintritt <= plan.bis and (m.austritt is None or m.austritt >= plan.von))
    }
    zeilen = {mid: Zeile(m) for mid, m in relevant.items()}
    for e in einsaetze:
        zeilen[e.mitarbeiter_id].einsaetze[e.datum].append(e)
    for a in session.exec(select(Abwesenheit).where(
            Abwesenheit.status == "genehmigt", Abwesenheit.von <= plan.bis, Abwesenheit.bis >= plan.von)):
        z = zeilen.get(a.mitarbeiter_id)
        if z is None:
            continue
        for tag in tage:
            if a.von <= tag <= a.bis:
                z.abwesend.setdefault(tag, ABWESENHEIT_AUSHANG.get(a.typ, "abwesend"))

    vertraege: dict[int, list[Vertrag]] = defaultdict(list)
    for v in session.exec(select(Vertrag)):
        vertraege[v.mitarbeiter_id].append(v)

    nach_abt: dict[Optional[int], list[Zeile]] = defaultdict(list)
    for z in zeilen.values():
        sid = z.mitarbeiter.stammabteilung_id
        nach_abt[sid if sid in abteilungen else None].append(z)
    gruppen = []
    for aid in [*abteilungen.keys(), None]:
        if nach_abt.get(aid):
            gruppen.append(Gruppe(abteilungen.get(aid) if aid is not None else None,
                                  sorted(nach_abt[aid], key=lambda z: (z.mitarbeiter.nachname, z.mitarbeiter.vorname))))

    return PlanDaten(plan=plan, tage=tage, geschlossen=geschlossen, gruppen=gruppen, abteilungen=abteilungen,
                     einsaetze=einsaetze, mitarbeiter=alle_ma, vertraege=vertraege, erstellt=datetime.now())
