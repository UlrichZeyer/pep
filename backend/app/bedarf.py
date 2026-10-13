"""Prognose und Bedarfsermittlung (reine Fachlogik, Session als Parameter).

Prognose: Ø gleicher Wochentag der letzten 8 Wochen (Hotdays herausgerechnet)
× Saisonfaktor (Vorjahresmonat ÷ Jahresmittel) × Lastfaktor des Zieltags.
Bedarf: Köpfe je 30-min-Slot von 05:00 bis 22:00 (34 Slots) je Abteilung und Tag.
"""
import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlmodel import Session, func, select

from app.kalender import ist_feiertag
from app.models import Abteilung, Kalendereintrag, Kundenfrequenz, Warengruppe, Wareneingang
from app.util import min_zu_zeit, zeit_zu_min

SLOT_MIN = 30
TAG_BEGINN = 5 * 60  # 05:00
TAG_ENDE = 22 * 60  # 22:00
ANZAHL_SLOTS = (TAG_ENDE - TAG_BEGINN) // SLOT_MIN  # 34
OEFFNUNG_VON = 7 * 60
OEFFNUNG_BIS = 21 * 60
KUNDEN_JE_KASSE_H = 45
BASIS_WOCHEN = 8
SAISON_GRENZEN = (0.75, 1.35)

SLOT_BEGINN = [TAG_BEGINN + i * SLOT_MIN for i in range(ANZAHL_SLOTS)]


def _verraeum_gewichte() -> list[float]:
    """Verteilung der Verräumstunden: Schwerpunkt 05–11 Uhr, wenig bis 14 Uhr, kleine
    Nachverräumung 15–17 Uhr."""
    g = []
    for t in SLOT_BEGINN:
        if t < 9 * 60:
            g.append(1.2)
        elif t < 11 * 60:
            g.append(0.9)
        elif t < 14 * 60:
            g.append(0.3)
        elif 15 * 60 <= t < 17 * 60:
            g.append(0.25)
        else:
            g.append(0.0)
    summe = sum(g)
    return [x / summe for x in g]


VERRAEUM_GEWICHTE = _verraeum_gewichte()


# ---------------------------------------------------------------- Kalender
def _kalender(session: Session, von: date, bis: date) -> dict[date, dict]:
    """Je Datum: lastfaktor (max. Hotday/Sondertag), hotday-Name, schliesstag, nur_hotday-Faktor."""
    info: dict[date, dict] = {}
    for e in session.exec(select(Kalendereintrag).where(
            Kalendereintrag.datum >= von, Kalendereintrag.datum <= bis)).all():
        d = info.setdefault(e.datum, {"lastfaktor": 1.0, "name": None, "schliesstag": False,
                                      "hotday_faktor": 1.0})
        if e.typ == "schliesstag":
            d["schliesstag"] = True
        elif e.typ in ("hotday", "sondertag"):
            if e.lastfaktor > d["lastfaktor"] or d["name"] is None:
                d["lastfaktor"] = max(d["lastfaktor"], e.lastfaktor)
                d["name"] = e.name
            if e.typ == "hotday":
                d["hotday_faktor"] = max(d["hotday_faktor"], e.lastfaktor)
    return info


def _geschlossen(tag: date, kal: dict[date, dict]) -> bool:
    return tag.weekday() == 6 or ist_feiertag(tag) or kal.get(tag, {}).get("schliesstag", False)


def _tage(von: date, bis: date) -> list[date]:
    return [von + timedelta(days=i) for i in range((bis - von).days + 1)]


def _referenz(session: Session, modell, von: date) -> date:
    """Stichtag für die Basiswochen: `von`, höchstens aber Tag nach dem letzten Datensatz."""
    letzter = session.exec(select(func.max(modell.datum))).one()
    if letzter is None:
        return von
    return min(von, letzter + timedelta(days=1))


# ---------------------------------------------------------------- Prognose Paletten
def _paletten_prognose(session: Session, von: date, bis: date
                       ) -> tuple[dict[date, dict[int, float]], dict[date, dict], list[Warengruppe]]:
    wgs = list(session.exec(select(Warengruppe)).all())
    ref = _referenz(session, Wareneingang, von)
    hist_von = min(ref - timedelta(days=365), date(von.year - 1, von.month, 1))
    kal = _kalender(session, hist_von, bis)

    # Historie (bereinigt um Hotday-Lastfaktor): (datum, wg) -> paletten
    hist: dict[int, dict[date, float]] = defaultdict(dict)
    for d, wg_id, pal in session.exec(select(Wareneingang.datum, Wareneingang.warengruppe_id,
                                             func.sum(Wareneingang.paletten))
                                      .where(Wareneingang.datum >= hist_von, Wareneingang.datum < ref)
                                      .group_by(Wareneingang.datum, Wareneingang.warengruppe_id)).all():
        hist[wg_id][d] = pal / kal.get(d, {}).get("hotday_faktor", 1.0)

    basis_von = ref - timedelta(weeks=BASIS_WOCHEN)
    jahr_von = ref - timedelta(days=365)
    basis: dict[int, list[float]] = {}  # wg -> Ø je Wochentag 0..5
    jahresmittel: dict[int, Optional[float]] = {}
    for wg in wgs:
        reihe = hist.get(wg.id, {})
        werte: list[list[float]] = [[] for _ in range(6)]
        for d, v in reihe.items():
            if d >= basis_von and d.weekday() < 6:
                werte[d.weekday()].append(v)
        basis[wg.id] = [sum(w) / len(w) if w else 0.0 for w in werte]
        jahr = [v for d, v in reihe.items() if d >= jahr_von]
        jahresmittel[wg.id] = sum(jahr) / len(jahr) if len(jahr) >= 60 else None

    saison_cache: dict[tuple[int, int, int], float] = {}

    def saison(wg_id: int, jahr: int, monat: int) -> float:
        key = (wg_id, jahr, monat)
        if key not in saison_cache:
            jm = jahresmittel.get(wg_id)
            werte = [v for d, v in hist.get(wg_id, {}).items() if d.year == jahr - 1 and d.month == monat]
            f = 1.0
            if jm and len(werte) >= 8:
                f = min(max((sum(werte) / len(werte)) / jm, SAISON_GRENZEN[0]), SAISON_GRENZEN[1])
            saison_cache[key] = f
        return saison_cache[key]

    ergebnis: dict[date, dict[int, float]] = {}
    for tag in _tage(von, bis):
        if _geschlossen(tag, kal):
            ergebnis[tag] = {wg.id: 0.0 for wg in wgs}
            continue
        lf = kal.get(tag, {}).get("lastfaktor", 1.0)
        ergebnis[tag] = {wg.id: basis[wg.id][tag.weekday()] * saison(wg.id, tag.year, tag.month) * lf
                         for wg in wgs}
    return ergebnis, kal, wgs


def prognose(session: Session, von: date, bis: date) -> dict:
    """Paletten-Prognose je Warengruppe und Tag (Form wie TS-Typ Prognose)."""
    werte, kal, _ = _paletten_prognose(session, von, bis)
    tage = []
    for tag, je_wg in werte.items():
        k = kal.get(tag, {})
        tage.append({
            "datum": tag.isoformat(),
            "geschlossen": _geschlossen(tag, kal),
            "lastfaktor": round(k.get("lastfaktor", 1.0), 2),
            "hotday": k.get("name"),
            "je_warengruppe": {str(wg): round(v, 1) for wg, v in je_wg.items()},
            "gesamt": round(sum(je_wg.values()), 1),
        })
    return {"von": von.isoformat(), "bis": bis.isoformat(), "tage": tage}


# ---------------------------------------------------------------- Prognose Kunden
def _kunden_prognose(session: Session, von: date, bis: date, kal: dict[date, dict]
                     ) -> dict[date, dict[int, float]]:
    """Kunden/h je Tag und Stunde: Ø gleicher Wochentag/Stunde der letzten 8 Wochen × Lastfaktor."""
    ref = _referenz(session, Kundenfrequenz, von)
    basis_von = ref - timedelta(weeks=BASIS_WOCHEN)
    hot = _kalender(session, basis_von, ref)
    summe: dict[tuple[int, int], list[float]] = defaultdict(list)
    for d, stunde, kunden in session.exec(select(Kundenfrequenz.datum, Kundenfrequenz.stunde,
                                                 Kundenfrequenz.kunden)
                                          .where(Kundenfrequenz.datum >= basis_von,
                                                 Kundenfrequenz.datum < ref)).all():
        summe[(d.weekday(), stunde)].append(kunden / hot.get(d, {}).get("hotday_faktor", 1.0))
    mittel = {k: sum(v) / len(v) for k, v in summe.items()}
    ergebnis: dict[date, dict[int, float]] = {}
    for tag in _tage(von, bis):
        lf = kal.get(tag, {}).get("lastfaktor", 1.0)
        ergebnis[tag] = {h: mittel.get((tag.weekday(), h), 0.0) * lf for h in range(7, 21)}
    return ergebnis


# ---------------------------------------------------------------- Bedarf
def _verteile(stunden: float) -> list[int]:
    """Verräumstunden auf Slots verteilen (Köpfe ganzzahlig, Summe = ⌈Stunden ÷ 0,5⌉)."""
    gesamt = math.ceil(round(stunden * 60 / SLOT_MIN, 6))
    if gesamt <= 0:
        return [0] * ANZAHL_SLOTS
    roh = [g * gesamt for g in VERRAEUM_GEWICHTE]
    koepfe = [math.floor(x) for x in roh]
    rest = gesamt - sum(koepfe)
    reihenfolge = sorted(range(ANZAHL_SLOTS), key=lambda i: (-(roh[i] - koepfe[i]), i))
    for i in reihenfolge[:rest]:
        koepfe[i] += 1
    return koepfe


def _slots_paletten(abt: Abteilung, stunden: float) -> list[int]:
    koepfe = _verteile(stunden)
    von, bis = zeit_zu_min(abt.arbeitszeit_von), zeit_zu_min(abt.arbeitszeit_bis)
    for i, t in enumerate(SLOT_BEGINN):
        if t < von or t >= bis:
            koepfe[i] = 0
        if abt.mindestbesetzung > 0 and OEFFNUNG_VON <= t < OEFFNUNG_BIS:
            koepfe[i] = max(koepfe[i], abt.mindestbesetzung)
    return koepfe


def _slots_kasse(abt: Abteilung, kunden: dict[int, float]) -> list[int]:
    koepfe = [0] * ANZAHL_SLOTS
    for i, t in enumerate(SLOT_BEGINN):
        if OEFFNUNG_VON <= t < OEFFNUNG_BIS:
            k = kunden.get(t // 60, 0.0)
            koepfe[i] = max(abt.mindestbesetzung, math.ceil(round(k / KUNDEN_JE_KASSE_H, 6)))
        elif t == OEFFNUNG_VON - SLOT_MIN or t == OEFFNUNG_BIS:
            koepfe[i] = 1  # Vor-/Nachlauf (Kasse öffnen/abrechnen)
    return koepfe


def _slots_fix(abt: Abteilung) -> list[int]:
    von, bis = zeit_zu_min(abt.arbeitszeit_von), zeit_zu_min(abt.arbeitszeit_bis)
    return [abt.mindestbesetzung if von <= t < bis else 0 for t in SLOT_BEGINN]


def _berechne(session: Session, von: date, bis: date) -> list[dict]:
    """Interne Bedarfsberechnung: je Tag Kalenderinfo + je Abteilung Köpfe-Liste."""
    abteilungen = list(session.exec(select(Abteilung).order_by(Abteilung.sortierung, Abteilung.id)).all())
    pal, kal, wgs = _paletten_prognose(session, von, bis)
    kunden = (_kunden_prognose(session, von, bis, kal)
              if any(a.bedarfsart == "frequenz" for a in abteilungen) else {})
    wg_je_abt: dict[int, list[Warengruppe]] = defaultdict(list)
    for wg in wgs:
        wg_je_abt[wg.abteilung_id].append(wg)

    tage = []
    for tag in _tage(von, bis):
        geschlossen = _geschlossen(tag, kal)
        k = kal.get(tag, {})
        eintraege = []
        for abt in abteilungen:
            paletten = sum(pal[tag].get(wg.id, 0.0) for wg in wg_je_abt[abt.id])
            if geschlossen:
                koepfe = [0] * ANZAHL_SLOTS
            elif abt.bedarfsart == "frequenz":
                koepfe = _slots_kasse(abt, kunden.get(tag, {}))
            elif abt.bedarfsart == "fix":
                koepfe = _slots_fix(abt)
            else:
                std = sum(pal[tag].get(wg.id, 0.0) / wg.std_leistung_pal_h
                          for wg in wg_je_abt[abt.id] if wg.std_leistung_pal_h > 0)
                koepfe = _slots_paletten(abt, std)
            eintraege.append({"abteilung_id": abt.id, "paletten": paletten, "koepfe": koepfe})
        tage.append({"datum": tag, "geschlossen": geschlossen,
                     "lastfaktor": k.get("lastfaktor", 1.0), "hotday": k.get("name"),
                     "abteilungen": eintraege})
    return tage


def bedarf(session: Session, von: date, bis: date) -> dict:
    """Bedarfskurven (Form wie TS-Typ Bedarf)."""
    tage = []
    for t in _berechne(session, von, bis):
        tage.append({
            "datum": t["datum"].isoformat(),
            "geschlossen": t["geschlossen"],
            "lastfaktor": round(t["lastfaktor"], 2),
            "hotday": t["hotday"],
            "abteilungen": [{
                "abteilung_id": a["abteilung_id"],
                "stunden": sum(a["koepfe"]) * SLOT_MIN / 60,
                "paletten": round(a["paletten"], 1),
                "slots": [{"beginn": min_zu_zeit(b), "koepfe": k}
                          for b, k in zip(SLOT_BEGINN, a["koepfe"])],
            } for a in t["abteilungen"]],
        })
    return {"slot_min": SLOT_MIN, "tage": tage}


def bedarf_matrix(session: Session, von: date, bis: date) -> dict[tuple[date, int], list[int]]:
    """(datum, abteilung_id) -> Köpfe je 30-min-Slot ab 05:00 bis 22:00 (34 Slots)."""
    return {(t["datum"], a["abteilung_id"]): a["koepfe"]
            for t in _berechne(session, von, bis) for a in t["abteilungen"]}


def bedarf_stunden(session: Session, von: date, bis: date) -> dict[tuple[date, int], float]:
    """(datum, abteilung_id) -> Bedarfsstunden (Σ Köpfe × 0,5)."""
    return {k: sum(v) * SLOT_MIN / 60 for k, v in bedarf_matrix(session, von, bis).items()}
