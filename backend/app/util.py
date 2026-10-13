"""Gemeinsame Hilfsfunktionen (Zeitrechnung, gültiger Vertrag, Alter)."""
from datetime import date
from typing import Iterable, Optional

from app.models import Vertrag


def zeit_zu_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def min_zu_zeit(minuten: int) -> str:
    return f"{minuten // 60:02d}:{minuten % 60:02d}"


def arbeitsminuten(beginn: str, ende: str, pause_min: int = 0) -> int:
    """Netto-Arbeitszeit eines Einsatzes in Minuten."""
    return max(0, zeit_zu_min(ende) - zeit_zu_min(beginn) - pause_min)


def gesetzliche_pause(brutto_min: int) -> int:
    """Mindestpause nach § 4 ArbZG für eine Anwesenheitsdauer (brutto)."""
    if brutto_min > 9 * 60 + 45:
        return 45
    if brutto_min > 9 * 60 + 30:
        return brutto_min - 9 * 60  # Netto bleibt genau 9 h
    if brutto_min > 6 * 60 + 30:
        return 30
    if brutto_min > 6 * 60:
        return brutto_min - 6 * 60  # Netto bleibt genau 6 h
    return 0


def aktueller_vertrag(vertraege: Iterable[Vertrag], stichtag: date) -> Optional[Vertrag]:
    """Gültigen Vertrag zum Stichtag ermitteln (historisierte Verträge)."""
    passend = [
        v for v in vertraege
        if v.gueltig_ab <= stichtag and (v.gueltig_bis is None or v.gueltig_bis >= stichtag)
    ]
    return max(passend, key=lambda v: v.gueltig_ab) if passend else None


def alter(geburtsdatum: date, stichtag: date) -> int:
    jahre = stichtag.year - geburtsdatum.year
    if (stichtag.month, stichtag.day) < (geburtsdatum.month, geburtsdatum.day):
        jahre -= 1
    return jahre


def stichtag_heute() -> date:
    """Heutiges Datum. Tests setzen PEP_HEUTE für reproduzierbare Ergebnisse."""
    import os

    wert = os.environ.get("PEP_HEUTE")
    return date.fromisoformat(wert) if wert else date.today()
