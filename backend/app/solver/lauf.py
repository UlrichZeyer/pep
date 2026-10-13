"""Ablauf der Auto-Planung (Kap. 9.2): Kontext laden → Modell lösen → Einsätze speichern →
Gegenprüfung durch das Regelwerk → Bericht."""
import threading
import time
from datetime import timedelta
from typing import Optional

from sqlmodel import Session

from app.bedarf import bedarf_matrix
from app.models import Aenderungslog, Einsatz, Plan
from app.regeln import lade_kontext, plan_pruefen, pruefe
from app.regeln.betrieb import ABWESENHEIT_TEXT
from app.solver.bericht import WT, bericht, zeile
from app.solver.modell import GEWICHTE_STANDARD, Modell, als_einsatz

MODI = ("neu", "luecken", "umplanen")
MODUS_TEXT = {"neu": "Ganze Woche neu", "luecken": "Nur Lücken füllen", "umplanen": "Umplanen nach Krankmeldung"}
ZEITLIMIT_STANDARD = 20.0
ZEITLIMIT_MAX = 120.0


class AutoPlanFehler(Exception):
    """Fachlicher Fehler mit HTTP-Statuscode (404 Plan unbekannt, 409 Status, 422 Eingabe)."""

    def __init__(self, status_code: int, meldung: str):
        super().__init__(meldung)
        self.status_code = status_code
        self.meldung = meldung


class Fortschritt:
    """Fortschrittsanzeige (thread-sicher genug für Polling): Phasenanteil bzw. Zeitanteil beim Lösen."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.anteil = 0.0
        self.meldung = "Wird vorbereitet …"
        self._loesen_ab: Optional[float] = None
        self._zeitlimit = ZEITLIMIT_STANDARD

    def setze(self, anteil: float, meldung: str) -> None:
        with self._lock:
            self.anteil, self.meldung, self._loesen_ab = anteil, meldung, None

    def loesen(self, zeitlimit: float, meldung: str) -> None:
        with self._lock:
            self.anteil, self.meldung = 0.15, meldung
            self._loesen_ab, self._zeitlimit = time.monotonic(), zeitlimit

    def meldung_setzen(self, meldung: str) -> None:
        with self._lock:
            self.meldung = meldung

    def wert(self) -> float:
        with self._lock:
            if self._loesen_ab is None:
                return self.anteil
            anteil = min(1.0, (time.monotonic() - self._loesen_ab) / max(1.0, self._zeitlimit))
            return round(0.15 + 0.75 * anteil, 3)


def gewichte_pruefen(gewichte: Optional[dict]) -> dict[str, float]:
    erg = dict(GEWICHTE_STANDARD)
    for schluessel, wert in (gewichte or {}).items():
        if wert is None:
            continue
        if schluessel not in GEWICHTE_STANDARD:
            raise AutoPlanFehler(422, f"Unbekanntes Gewicht „{schluessel}“")
        if not (0 <= float(wert) <= 1000):
            raise AutoPlanFehler(422, f"Gewicht „{schluessel}“ muss zwischen 0 und 1000 liegen")
        erg[schluessel] = float(wert)
    return erg


def plan_pruefen_fuer_lauf(session: Session, plan_id: int, modus: str) -> Plan:
    plan = session.get(Plan, plan_id)
    if plan is None:
        raise AutoPlanFehler(404, "Plan nicht gefunden")
    if plan.status != "entwurf":
        raise AutoPlanFehler(409, f"Plan „{plan.name}“ ist nicht im Status Entwurf – Auto-Planung nur für Entwürfe")
    if modus not in MODI:
        raise AutoPlanFehler(422, f"Unbekannter Modus „{modus}“ (erlaubt: {', '.join(MODI)})")
    return plan


def _name(m) -> str:
    return f"{m.vorname} {m.nachname}"


def auto_planen(session: Session, plan_id: int, modus: str = "neu", gewichte: Optional[dict] = None,
                zeitlimit_s: Optional[float] = None, fortschritt: Optional[Fortschritt] = None,
                num_workers: int = 8) -> dict:
    """Plant den Plan automatisch und speichert das Ergebnis. Rückgabe in der Form von TS-Typ SolverErgebnis."""
    t0 = time.monotonic()
    fs = fortschritt or Fortschritt()
    plan = plan_pruefen_fuer_lauf(session, plan_id, modus)
    g = gewichte_pruefen(gewichte)
    zeitlimit = min(ZEITLIMIT_MAX, max(1.0, float(zeitlimit_s or ZEITLIMIT_STANDARD)))

    fs.setze(0.03, "Daten und Bedarf werden geladen …")
    k = lade_kontext(session, plan.von, plan.bis, plan_id)
    bestehend = list(k.einsaetze)
    hinweise: list[dict] = []
    if modus == "neu":
        entfernen = [e for e in bestehend if not e.gesperrt]
    elif modus == "luecken":
        entfernen = []
    else:
        hart_ids = {i for v in pruefe(k) if v.schwere == "hart" for i in v.einsatz_ids}
        entfernen = [e for e in bestehend if not e.gesperrt
                     and (e.id in hart_ids or k.abwesenheit_am(e.mitarbeiter_id, e.datum))]
        for e in entfernen:
            a = k.abwesenheit_am(e.mitarbeiter_id, e.datum)
            grund = ABWESENHEIT_TEXT.get(a.typ, a.typ) if a else "harter Regelverstoß"
            hinweise.append(zeile(e.datum, e.abteilung_id, "hinweis", 0,
                                  f"Einsatz {_name(k.mitarbeiter[e.mitarbeiter_id])} {WT[e.datum.weekday()]} "
                                  f"{e.beginn}–{e.ende} entfernt ({grund})"))
    entfernt_ids = {id(e) for e in entfernen}
    fix = [e for e in bestehend if id(e) not in entfernt_ids]

    bedarf = bedarf_matrix(session, plan.von, plan.bis)
    tage = []
    t = plan.von
    while t <= plan.bis:
        if t.weekday() < 6 and not k.ist_feiertag(t) and any(sum(v) for (d, _), v in bedarf.items() if d == t):
            tage.append(t)
        t += timedelta(days=1)

    modell = Modell(k, bedarf, fix, g, tage)
    modell.kandidaten_erzeugen()
    fs.loesen(zeitlimit, f"Modell mit {len(modell.kandidaten):,} Kandidaten wird gelöst …".replace(",", "."))

    def bei_loesung(anzahl: int, ziel: float, _zeit: float) -> None:
        fs.meldung_setzen(f"{anzahl}. Lösung gefunden – Zielwert {ziel:,.0f}".replace(",", "."))

    erg = modell.loesen(zeitlimit, num_workers=num_workers, bei_loesung=bei_loesung)
    fs.setze(0.92, "Ergebnis wird gespeichert und geprüft …")

    ok = erg.status in ("OPTIMAL", "FEASIBLE")
    neu: list[Einsatz] = []
    if ok:
        for e in entfernen:
            session.delete(e)
        for c in erg.gewaehlt:
            neu.append(als_einsatz(c, plan.id))
        session.add_all(neu)
        session.add(Aenderungslog(entitaet="plan", entitaet_id=plan.id, aktion="geaendert",
                                  neu=f'{{"auto_planung": "{modus}", "neu": {len(neu)}, "entfernt": {len(entfernen)}}}'))
        session.commit()
    else:
        hinweise.append(zeile(plan.von, None, "hinweis", 0,
                              f"Solver ohne Ergebnis (Status {erg.status}) – der Plan wurde nicht verändert"))

    # Gegenprüfung durch das Regelwerk
    verstoesse = plan_pruefen(session, plan.id)
    neu_ids = {e.id for e in neu}
    hart_neu = [v for v in verstoesse if v.schwere == "hart" and set(v.einsatz_ids) & neu_ids]
    hart = [v for v in verstoesse if v.schwere == "hart"]
    if ok:
        if hart_neu:
            hinweise.append(zeile(plan.von, None, "hinweis", 0,
                                  f"Gegenprüfung: {len(hart_neu)} harte Verstöße betreffen neue Einsätze – bitte prüfen"))
        elif hart:
            hinweise.append(zeile(plan.von, None, "hinweis", 0,
                                  f"Gegenprüfung: neue Einsätze regelkonform; {len(hart)} harte Verstöße stammen aus "
                                  f"übernommenen Einsätzen"))
        else:
            hinweise.append(zeile(plan.von, None, "hinweis", 0,
                                  "Gegenprüfung durch das Regelwerk: keine harten Verstöße"))

    plan_einsaetze = [*fix, *neu] if ok else bestehend
    zeilen, abdeckung = bericht(modell, plan_einsaetze, plan.von, plan.bis)

    # weitere Hinweise
    if fix:
        gesperrt = sum(1 for e in fix if e.gesperrt)
        hinweise.insert(0, zeile(plan.von, None, "hinweis", 0,
                                 f"{MODUS_TEXT[modus]}: {len(fix)} bestehende Einsätze übernommen"
                                 + (f" (davon {gesperrt} gesperrt)" if gesperrt else "")))
    if ok and erg.nur_startloesung:
        hinweise.append(zeile(plan.von, None, "hinweis", 0,
                              f"Zeitlimit {zeitlimit:.0f} s zu kurz für CP-SAT – Ergebnis der Greedy-Startlösung "
                              f"(längeres Zeitlimit verbessert den Plan)"))
    elif ok and erg.status == "FEASIBLE":
        luecke = ""
        if erg.schranke is not None and erg.zielwert > 0:
            luecke = f", Optimalitätslücke {max(0.0, (erg.zielwert - erg.schranke) / erg.zielwert) * 100:.0f} %"
        hinweise.append(zeile(plan.von, None, "hinweis", 0,
                              f"Zeitlimit {zeitlimit:.0f} s erreicht – bestes gefundenes Ergebnis{luecke}"))
    for e in neu:
        if k.abwesenheit_am(e.mitarbeiter_id, e.datum, status="beantragt"):
            hinweise.append(zeile(e.datum, e.abteilung_id, "hinweis", 0,
                                  f"{_name(k.mitarbeiter[e.mitarbeiter_id])} ist {WT[e.datum.weekday()]} trotz "
                                  f"beantragter Abwesenheit eingeplant"))

    return {
        "einsaetze_neu": len(neu),
        "einsaetze_entfernt": len(entfernen) if ok else 0,
        "solver_status": erg.status,
        "zielwert": round(erg.zielwert, 1),
        "laufzeit_s": round(time.monotonic() - t0, 2),
        "abdeckung": abdeckung,
        "bericht": hinweise + zeilen,
        "verstoesse": [v.als_dict() for v in verstoesse],
    }

