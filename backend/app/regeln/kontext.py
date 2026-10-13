"""Prüfkontext des Regelwerks: Einsätze des Prüfzeitraums + Puffer und alle Stammdaten.

`PlanKontext` lässt sich ohne Datenbank direkt aufbauen (Tests, Solver); `lade_kontext`
füllt ihn aus der Datenbank.
"""
import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Optional

from sqlmodel import Session, select

from app.kalender import feiertage as _feiertage_jahr
from app.models import (
    REGELPARAMETER_STANDARD, Abteilung, Abwesenheit, Einsatz, Mitarbeiter, MitarbeiterSkill, Plan,
    Regelparameter, Skill, Vertrag,
)
from app.util import aktueller_vertrag, alter, arbeitsminuten, zeit_zu_min

# Puffer vor dem Prüfzeitraum (Ruhezeit Vorwoche, Ø-Arbeitszeit über 24 Wochen)
PUFFER_TAGE_VOR = 24 * 7
# Abwesenheitstypen, die die Soll-Arbeitszeit mindern (Wunschfrei mindert nicht)
SOLL_MINDERNDE_ABWESENHEIT = {"urlaub", "krank", "schule", "fortbildung", "sonstiges"}


@dataclass
class Verstoss:
    regel: str
    schwere: str  # hart | weich
    mitarbeiter_id: int
    datum: date
    einsatz_ids: list[int]
    meldung: str

    def als_dict(self) -> dict:
        return {"regel": self.regel, "schwere": self.schwere, "mitarbeiter_id": self.mitarbeiter_id,
                "datum": self.datum.isoformat(), "einsatz_ids": list(self.einsatz_ids),
                "meldung": self.meldung}


@dataclass
class PlanKontext:
    """Alles, was die Regeln brauchen. `einsaetze` = zu prüfende Einsätze,
    `puffer` = weitere Einsätze (andere Pläne) für Ruhezeit, Wochen-/Monatssummen und Ø."""

    von: date
    bis: date
    einsaetze: list[Any] = field(default_factory=list)
    puffer: list[Any] = field(default_factory=list)
    mitarbeiter: dict[int, Mitarbeiter] = field(default_factory=dict)
    vertraege: dict[int, list[Vertrag]] = field(default_factory=dict)
    skills: dict[int, list[MitarbeiterSkill]] = field(default_factory=dict)  # je Mitarbeiter
    skill_info: dict[int, Skill] = field(default_factory=dict)
    abteilungen: dict[int, Abteilung] = field(default_factory=dict)
    abwesenheiten: dict[int, list[Abwesenheit]] = field(default_factory=dict)
    feiertage: Optional[dict[date, str]] = None  # None → aus kalender.py berechnet
    parameter: dict[str, float] = field(default_factory=dict)
    daten_ab: Optional[date] = None  # ab hier liegen Plandaten vor (Ø-Berechnung)

    def __post_init__(self) -> None:
        if self.feiertage is None:
            self.feiertage = {}
            for j in range(self.von.year - 1, self.bis.year + 2):
                self.feiertage.update(_feiertage_jahr(j))
        if self.daten_ab is None:
            alle = [e.datum for e in [*self.einsaetze, *self.puffer]]
            self.daten_ab = min([self.von, *alle])
        self._cache: dict[int, tuple[list, list]] = {}
        self._pruef_ids = {id(e) for e in self.einsaetze}

    # ---------------------------------------------------------------- Zugriffe
    def p(self, schluessel: str) -> float:
        if schluessel in self.parameter:
            return float(self.parameter[schluessel])
        return float(REGELPARAMETER_STANDARD[schluessel][0])

    def _je_mitarbeiter(self, mid: int) -> tuple[list, list]:
        if mid not in self._cache:
            eigene = sorted((e for e in self.einsaetze if e.mitarbeiter_id == mid), key=sortierschluessel)
            alle = sorted((e for e in [*self.einsaetze, *self.puffer] if e.mitarbeiter_id == mid),
                          key=sortierschluessel)
            self._cache[mid] = (eigene, alle)
        return self._cache[mid]

    def einsaetze_von(self, mid: int) -> list:
        """Zu prüfende Einsätze eines Mitarbeiters (sortiert)."""
        return self._je_mitarbeiter(mid)[0]

    def alle_einsaetze_von(self, mid: int) -> list:
        """Einsätze inkl. Puffer (sortiert)."""
        return self._je_mitarbeiter(mid)[1]

    def ist_pruefling(self, e: Any) -> bool:
        return id(e) in self._pruef_ids

    def mitarbeiter_ids(self) -> set[int]:
        return {e.mitarbeiter_id for e in self.einsaetze}

    def vertrag(self, mid: int, tag: date) -> Optional[Vertrag]:
        return aktueller_vertrag(self.vertraege.get(mid, []), tag)

    def alter(self, mid: int, tag: date) -> Optional[int]:
        m = self.mitarbeiter.get(mid)
        return alter(m.geburtsdatum, tag) if m else None

    def ist_feiertag(self, tag: date) -> bool:
        return tag in self.feiertage  # type: ignore[operator]

    def ist_werktag(self, tag: date) -> bool:
        return tag.weekday() < 6 and not self.ist_feiertag(tag)

    def abwesenheit_am(self, mid: int, tag: date, status: str = "genehmigt",
                       typen: Optional[set[str]] = None) -> Optional[Abwesenheit]:
        for a in self.abwesenheiten.get(mid, []):
            if a.status == status and a.von <= tag <= a.bis and (typen is None or a.typ in typen):
                return a
        return None


# ---------------------------------------------------------------- Hilfsfunktionen
def sortierschluessel(e: Any) -> tuple:
    return (e.datum, zeit_zu_min(e.beginn), zeit_zu_min(e.ende))


def netto_min(e: Any) -> int:
    return arbeitsminuten(e.beginn, e.ende, e.pause_min or 0)


def brutto_min(e: Any) -> int:
    return zeit_zu_min(e.ende) - zeit_zu_min(e.beginn)


def eid(e: Any) -> list[int]:
    i = getattr(e, "id", None)
    return [i] if i is not None else []


def fmt_std(minuten: float) -> str:
    """Stunden mit deutschem Komma, z. B. 9,5 h / 10 h / 6,25 h."""
    h = round(minuten / 60, 2)
    text = f"{h:.2f}".rstrip("0").rstrip(".")
    return text.replace(".", ",") + " h"


def fmt_tag(tag: date) -> str:
    return tag.strftime("%d.%m.")


def wochen(von: date, bis: date) -> list[date]:
    """Montage aller Wochen, die den Zeitraum berühren."""
    mo = von - timedelta(days=von.weekday())
    erg = []
    while mo <= bis:
        erg.append(mo)
        mo += timedelta(days=7)
    return erg


def monatsende(tag: date) -> date:
    return date(tag.year, tag.month, calendar.monthrange(tag.year, tag.month)[1])


# ---------------------------------------------------------------- Laden aus der DB
def lade_kontext(session: Session, von: date, bis: date, plan_id: Optional[int] = None,
                 einsaetze: Optional[list] = None) -> PlanKontext:
    """Lädt Einsätze (zu prüfen + Puffer) und Stammdaten.

    - `plan_id` gesetzt: geprüft werden die Einsätze dieses Plans, alle übrigen im Pufferzeitraum sind Puffer.
    - `einsaetze` gesetzt: diese (ggf. ungespeicherten) Objekte werden geprüft und ersetzen die Einsätze
      des Plans `plan_id`.
    - sonst: alle Einsätze mit Datum in [von, bis].
    """
    puffer_von = von - timedelta(days=PUFFER_TAGE_VOR)
    puffer_bis = max(bis + timedelta(days=7), monatsende(bis))
    gespeichert = session.exec(select(Einsatz).where(Einsatz.datum >= puffer_von,
                                                     Einsatz.datum <= puffer_bis)).all()
    if einsaetze is not None:
        pruef = list(einsaetze)
        ids = {e.id for e in pruef if getattr(e, "id", None) is not None}
        puffer = [e for e in gespeichert if e.id not in ids and (plan_id is None or e.plan_id != plan_id)]
    elif plan_id is not None:
        pruef = [e for e in gespeichert if e.plan_id == plan_id]
        # Einsätze des Plans außerhalb des Pufferfensters gibt es nicht (Datum liegt im Planzeitraum)
        puffer = [e for e in gespeichert if e.plan_id != plan_id]
    else:
        pruef = [e for e in gespeichert if von <= e.datum <= bis]
        puffer = [e for e in gespeichert if not (von <= e.datum <= bis)]

    # Beginn der vorhandenen Plandaten (für den 24-Wochen-Schnitt)
    plan_ids = {e.plan_id for e in [*pruef, *puffer] if getattr(e, "plan_id", None) is not None}
    starts = [p.von for p in session.exec(select(Plan).where(Plan.id.in_(plan_ids))).all()] if plan_ids else []  # type: ignore[union-attr]
    daten_ab = min([von, *starts, *[e.datum for e in [*pruef, *puffer]]])

    mitarbeiter = {m.id: m for m in session.exec(select(Mitarbeiter)).all()}
    vertraege: dict[int, list[Vertrag]] = {}
    for v in session.exec(select(Vertrag)).all():
        vertraege.setdefault(v.mitarbeiter_id, []).append(v)
    skills: dict[int, list[MitarbeiterSkill]] = {}
    for s in session.exec(select(MitarbeiterSkill)).all():
        skills.setdefault(s.mitarbeiter_id, []).append(s)
    abwesenheiten: dict[int, list[Abwesenheit]] = {}
    for a in session.exec(select(Abwesenheit).where(Abwesenheit.bis >= puffer_von,
                                                    Abwesenheit.von <= puffer_bis)).all():
        abwesenheiten.setdefault(a.mitarbeiter_id, []).append(a)
    parameter = {r.schluessel: r.wert for r in session.exec(select(Regelparameter)).all()}
    return PlanKontext(
        von=von, bis=bis, einsaetze=pruef, puffer=puffer, mitarbeiter=mitarbeiter, vertraege=vertraege,
        skills=skills, skill_info={s.id: s for s in session.exec(select(Skill)).all()},
        abteilungen={a.id: a for a in session.exec(select(Abteilung)).all()},
        abwesenheiten=abwesenheiten, parameter=parameter, daten_ab=daten_ab,
    )
