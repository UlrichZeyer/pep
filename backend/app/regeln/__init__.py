"""Regelwerk (Arbeitszeitrecht & Vertragsregeln) als reine Funktionen. Siehe TECHNISCHES_KONZEPT.md, Kap. 8.

Jede Regel hat die Signatur ``regel(kontext, mitarbeiter_id) -> list[Verstoss]``.
Genutzt von Planungs-API (Live-Validierung, /validieren) und Solver (Gegenprüfung).
"""
from typing import Callable, Optional

from sqlmodel import Session

from app.models import Plan
from app.regeln.arbeitszeit import (
    arbzg_3_schnitt, arbzg_3_tag, arbzg_3_woche, arbzg_4_pause, arbzg_5_ruhezeit, arbzg_9_sonntag,
    jarbschg, muschg, ueberschneidung,
)
from app.regeln.betrieb import (
    abwesenheit, fairness_samstag, skill, soll_woche, vertrag_minijob, vertrag_soll, vertrag_tage,
    vertrag_zeitfenster, zertifikat,
)
from app.regeln.kontext import PlanKontext, Verstoss, lade_kontext, netto_min

__all__ = ["Verstoss", "PlanKontext", "lade_kontext", "pruefe", "plan_pruefen", "REGELKATALOG", "REGELN",
           "soll_woche", "netto_min", "zusammenfassung"]

Regel = Callable[[PlanKontext, int], list[Verstoss]]

# code, name, quelle, schwere (Standard; ABWESENHEIT bei beantragter Abwesenheit und ARBZG_3_SCHNITT
# im Warnbereich melden zusätzlich „weich“), Funktion
_REGELN: list[tuple[str, str, str, str, Regel]] = [
    ("ARBZG_3_TAG", "Höchstarbeitszeit pro Tag (10 h)", "§ 3 ArbZG", "hart", arbzg_3_tag),
    ("ARBZG_3_SCHNITT", "Ø ≤ 8 h je Werktag über 24 Wochen (Warnung ab 7,5 h)", "§ 3 ArbZG", "hart", arbzg_3_schnitt),
    ("ARBZG_3_WOCHE", "Höchstens 48 h pro Woche", "§ 3 ArbZG", "hart", arbzg_3_woche),
    ("ARBZG_4_PAUSE", "Pause: > 6 h 30 min, > 9 h 45 min", "§ 4 ArbZG", "hart", arbzg_4_pause),
    ("ARBZG_5_RUHEZEIT", "Ruhezeit mindestens 11 h", "§ 5 ArbZG", "hart", arbzg_5_ruhezeit),
    ("ARBZG_9_SONNTAG", "Keine Arbeit an Sonn- und Feiertagen (BW)", "§ 9 ArbZG", "hart", arbzg_9_sonntag),
    ("JARBSCHG", "Minderjährige: 8 h/Tag, 40 h/Woche, 5 Tage, 12 h Ruhe, 6–20 Uhr", "§§ 8, 13, 14, 15 JArbSchG", "hart", jarbschg),
    ("MUSCHG", "Keine Einplanung im Mutterschutz", "MuSchG", "hart", muschg),
    ("VERTRAG_TAGE", "Erlaubte Wochentage, max. Tage pro Woche", "Arbeitsvertrag", "hart", vertrag_tage),
    ("VERTRAG_ZEITFENSTER", "Früheste/späteste Arbeitszeit", "Arbeitsvertrag", "hart", vertrag_zeitfenster),
    ("VERTRAG_MINIJOB", "Minijob: max. Stunden pro Monat", "Arbeitsvertrag / SGB IV", "hart", vertrag_minijob),
    ("VERTRAG_SOLL", "Abweichung von den Soll-Wochenstunden", "Arbeitsvertrag", "weich", vertrag_soll),
    ("ABWESENHEIT", "Keine Einplanung bei genehmigter Abwesenheit (beantragt: Hinweis)", "Abwesenheitsplanung", "hart", abwesenheit),
    ("SKILL", "Skill für die Abteilung vorhanden", "Betrieb", "hart", skill),
    ("ZERTIFIKAT", "Relevantes Zertifikat zum Einsatzdatum gültig", "Betrieb / DGUV", "weich", zertifikat),
    ("FAIRNESS_SAMSTAG", "Gleichmäßige Verteilung der Samstage", "Betrieb", "weich", fairness_samstag),
    ("UEBERSCHNEIDUNG", "Höchstens ein Einsatz pro Tag, keine Überschneidung", "Planung", "hart", ueberschneidung),
]

REGELKATALOG: list[dict] = [{"code": c, "name": n, "quelle": q, "schwere": s} for c, n, q, s, _ in _REGELN]
REGELN: dict[str, Regel] = {c: f for c, _, _, _, f in _REGELN}


def pruefe(kontext: PlanKontext, mitarbeiter_ids: Optional[set[int]] = None) -> list[Verstoss]:
    """Alle Regeln für alle (bzw. die angegebenen) Mitarbeiter mit Einsätzen im Prüfzeitraum."""
    ids = kontext.mitarbeiter_ids()
    if mitarbeiter_ids is not None:
        ids &= set(mitarbeiter_ids)
    erg: list[Verstoss] = []
    for mid in sorted(ids):
        for regel in REGELN.values():
            erg.extend(regel(kontext, mid))
    erg.sort(key=lambda v: (v.datum, v.mitarbeiter_id, v.schwere != "hart", v.regel))
    return erg


def plan_pruefen(session: Session, plan_id: int, mitarbeiter_ids: Optional[set[int]] = None) -> list[Verstoss]:
    plan = session.get(Plan, plan_id)
    if plan is None:
        return []
    return pruefe(lade_kontext(session, plan.von, plan.bis, plan_id), mitarbeiter_ids)


def zusammenfassung(verstoesse: list[Verstoss]) -> dict:
    return {"hart": sum(v.schwere == "hart" for v in verstoesse),
            "weich": sum(v.schwere == "weich" for v in verstoesse)}
