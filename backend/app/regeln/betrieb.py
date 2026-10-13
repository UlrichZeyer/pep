"""Vertrags- und Betriebsregeln: Vertragstage, Zeitfenster, Minijob, Soll-Stunden, Abwesenheit,
Skills, Zertifikate, Fairness."""
from datetime import date, timedelta
from typing import Optional

from app.regeln.kontext import (
    SOLL_MINDERNDE_ABWESENHEIT, PlanKontext, Verstoss, eid, fmt_std, fmt_tag, netto_min, wochen,
)
from app.util import zeit_zu_min

WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September",
          "Oktober", "November", "Dezember"]
ABWESENHEIT_TEXT = {"urlaub": "Urlaub", "krank": "Krankheit", "schule": "Berufsschule",
                    "fortbildung": "Fortbildung", "wunschfrei": "Wunschfrei", "sonstiges": "Abwesenheit"}
# Zertifikate (Skills mit Ablaufdatum) → Abteilungskürzel, für die sie relevant sind.
# Zusätzlich gilt ein Zertifikat immer für die Abteilung, der der Skill selbst zugeordnet ist.
ZERTIFIKAT_ABTEILUNGEN = {"ameise": {"GET"}, "stapler": {"GET"}, "hygiene": {"BAC", "OUG", "KUE"}}


def _ids(einsaetze: list) -> list[int]:
    return [i for e in einsaetze for i in eid(e)]


# ---------------------------------------------------------------- Vertrag
def vertrag_tage(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Gültiger Vertrag/Beschäftigungszeitraum, erlaubte Wochentage, max. Arbeitstage pro Woche."""
    erg = []
    m = k.mitarbeiter.get(mid)
    eigene = k.einsaetze_von(mid)
    for e in eigene:
        v = k.vertrag(mid, e.datum)
        if m and (e.datum < m.eintritt or (m.austritt and e.datum > m.austritt)):
            erg.append(Verstoss("VERTRAG_TAGE", "hart", mid, e.datum, eid(e),
                                f"Einsatz am {fmt_tag(e.datum)} außerhalb des Beschäftigungszeitraums"))
        elif v is None:
            erg.append(Verstoss("VERTRAG_TAGE", "hart", mid, e.datum, eid(e),
                                f"Kein gültiger Vertrag am {fmt_tag(e.datum)}"))
        elif e.datum.weekday() < 6 and str(e.datum.weekday()) not in v.erlaubte_tage:
            erg.append(Verstoss("VERTRAG_TAGE", "hart", mid, e.datum, eid(e),
                                f"{WOCHENTAGE[e.datum.weekday()]} ({fmt_tag(e.datum)}) ist laut Vertrag kein Arbeitstag"))
    if not eigene:
        return erg
    for mo in wochen(eigene[0].datum, eigene[-1].datum):
        woche = [e for e in k.alle_einsaetze_von(mid) if mo <= e.datum <= mo + timedelta(days=6)]
        pruef = [e for e in woche if k.ist_pruefling(e)]
        if not pruef:
            continue
        v = k.vertrag(mid, pruef[0].datum)
        anzahl = len({e.datum for e in woche})
        if v and anzahl > v.max_tage_woche:
            erg.append(Verstoss("VERTRAG_TAGE", "hart", mid, woche[-1].datum, _ids(woche),
                                f"{anzahl} Arbeitstage in der KW {mo.isocalendar()[1]} – laut Vertrag höchstens {v.max_tage_woche}"))
    return erg


def vertrag_zeitfenster(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Einsatz innerhalb frühester/spätester Zeit laut Vertrag."""
    erg = []
    for e in k.einsaetze_von(mid):
        v = k.vertrag(mid, e.datum)
        if v is None:
            continue
        if zeit_zu_min(e.beginn) < zeit_zu_min(v.frueheste_zeit) or zeit_zu_min(e.ende) > zeit_zu_min(v.spaeteste_zeit):
            erg.append(Verstoss("VERTRAG_ZEITFENSTER", "hart", mid, e.datum, eid(e),
                                f"Einsatz am {fmt_tag(e.datum)} {e.beginn}–{e.ende} außerhalb des vertraglichen "
                                f"Zeitfensters {v.frueheste_zeit}–{v.spaeteste_zeit}"))
    return erg


def vertrag_minijob(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Minijob: Monatsstunden (alle Pläne des Kalendermonats) ≤ max_std_monat bzw. Regelparameter."""
    erg = []
    monate: dict[tuple[int, int], list] = {}
    for e in k.einsaetze_von(mid):
        v = k.vertrag(mid, e.datum)
        if v and v.art == "minijob":
            monate.setdefault((e.datum.year, e.datum.month), []).append(e)
    for (jahr, monat), pruef in sorted(monate.items()):
        v = k.vertrag(mid, pruef[-1].datum)
        grenze = (v.max_std_monat if v and v.max_std_monat else k.p("minijob_max_std_monat")) * 60
        im_monat = [e for e in k.alle_einsaetze_von(mid) if (e.datum.year, e.datum.month) == (jahr, monat)
                    and (vv := k.vertrag(mid, e.datum)) is not None and vv.art == "minijob"]
        summe = sum(netto_min(e) for e in im_monat)
        if summe > grenze:
            erg.append(Verstoss("VERTRAG_MINIJOB", "hart", mid, pruef[-1].datum, _ids(im_monat),
                                f"Minijob: {fmt_std(summe)} im {MONATE[monat - 1]} {jahr} – Grenze {fmt_std(grenze)}"))
    return erg


def soll_woche(k: PlanKontext, mid: int, montag: date) -> Optional[float]:
    """Soll-Stunden einer Woche: Vertrags-Soll, anteilig gemindert um Tage mit genehmigter Abwesenheit.
    Bezugsgröße sind die möglichen Arbeitstage = min(erlaubte Werktage der Woche, max_tage_woche)."""
    v = k.vertrag(mid, montag) or k.vertrag(mid, montag + timedelta(days=5))
    if v is None:
        return None
    tage = [montag + timedelta(days=i) for i in range(6)]
    erlaubt = [t for t in tage if k.ist_werktag(t) and str(t.weekday()) in v.erlaubte_tage]
    tage_soll = min(len(erlaubt), v.max_tage_woche)
    if tage_soll <= 0:
        return 0.0
    abw = sum(1 for t in erlaubt if k.abwesenheit_am(mid, t, typen=SOLL_MINDERNDE_ABWESENHEIT))
    return v.soll_std_woche * max(0, tage_soll - abw) / tage_soll


def vertrag_soll(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Weich: Abweichung von den Soll-Wochenstunden über ± Toleranz (nur vollständig enthaltene Wochen Mo–Sa)."""
    toleranz = k.p("soll_toleranz_prozent") / 100
    erg = []
    for mo in wochen(k.von, k.bis):
        if mo < k.von or mo + timedelta(days=5) > k.bis:
            continue
        soll = soll_woche(k, mid, mo)
        if soll is None:
            continue
        woche = [e for e in k.alle_einsaetze_von(mid) if mo <= e.datum <= mo + timedelta(days=6)]
        ist = sum(netto_min(e) for e in woche) / 60
        if abs(ist - soll) > soll * toleranz + 1e-9:
            richtung = "über" if ist > soll else "unter"
            erg.append(Verstoss("VERTRAG_SOLL", "weich", mid, mo, _ids(woche),
                                f"KW {mo.isocalendar()[1]}: {fmt_std(ist * 60)} geplant, Soll {fmt_std(round(soll * 4) / 4 * 60)} "
                                f"({richtung} der Toleranz von ±{k.p('soll_toleranz_prozent'):.0f} %)"))
    return erg


# ---------------------------------------------------------------- Abwesenheit
def abwesenheit(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Genehmigte Abwesenheit → hart, beantragte → weich, abgelehnte ignorieren."""
    erg = []
    for e in k.einsaetze_von(mid):
        for status, schwere in (("genehmigt", "hart"), ("beantragt", "weich")):
            a = k.abwesenheit_am(mid, e.datum, status=status)
            if a:
                zeitraum = fmt_tag(a.von) if a.von == a.bis else f"{fmt_tag(a.von)}–{fmt_tag(a.bis)}"
                erg.append(Verstoss("ABWESENHEIT", schwere, mid, e.datum, eid(e),
                                    f"Einsatz am {fmt_tag(e.datum)} während {ABWESENHEIT_TEXT.get(a.typ, a.typ)} "
                                    f"({status}, {zeitraum})"))
                break
    return erg


# ---------------------------------------------------------------- Skills & Zertifikate
def skill(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Mitarbeiter braucht einen Skill, dessen abteilung_id der Einsatz-Abteilung entspricht."""
    vorhanden = {k.skill_info[s.skill_id].abteilung_id for s in k.skills.get(mid, []) if s.skill_id in k.skill_info}
    erg = []
    for e in k.einsaetze_von(mid):
        if e.abteilung_id not in vorhanden:
            abt = k.abteilungen.get(e.abteilung_id)
            name = abt.name if abt else f"#{e.abteilung_id}"
            erg.append(Verstoss("SKILL", "hart", mid, e.datum, eid(e),
                                f"Kein Skill für die Abteilung {name} (Einsatz am {fmt_tag(e.datum)})"))
    return erg


def _zertifikat_relevant(k: PlanKontext, skill_id: int, abteilung_id: int) -> bool:
    s = k.skill_info.get(skill_id)
    if s is None or not s.hat_ablauf:
        return False
    if s.abteilung_id is not None:
        return s.abteilung_id == abteilung_id
    abt = k.abteilungen.get(abteilung_id)
    if abt is None:
        return False
    name = s.name.lower()
    return any(stichwort in name and abt.kuerzel in kuerzel for stichwort, kuerzel in ZERTIFIKAT_ABTEILUNGEN.items())


def zertifikat(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Weich: Der Mitarbeiter besitzt ein für die Einsatz-Abteilung relevantes Zertifikat
    (Ameise/Stapler → Getränke, Hygieneschulung → Backstation/Obst & Gemüse/Kühlung, bzw. Zertifikat-Skill
    der Abteilung), das zum Einsatzdatum abgelaufen ist. Ohne Ablaufdatum gilt es als gültig."""
    erg = []
    for e in k.einsaetze_von(mid):
        for ms in k.skills.get(mid, []):
            if ms.zertifikat_bis and ms.zertifikat_bis < e.datum and _zertifikat_relevant(k, ms.skill_id, e.abteilung_id):
                erg.append(Verstoss("ZERTIFIKAT", "weich", mid, e.datum, eid(e),
                                    f"Zertifikat „{k.skill_info[ms.skill_id].name}“ seit {ms.zertifikat_bis.strftime('%d.%m.%Y')} "
                                    f"abgelaufen (Einsatz am {fmt_tag(e.datum)})"))
    return erg


# ---------------------------------------------------------------- Fairness
def _samstage(k: PlanKontext) -> dict[int, int]:
    cache = getattr(k, "_samstage", None)
    if cache is None:
        cache = {}
        for e in k.einsaetze:
            if e.datum.weekday() == 5:
                cache.setdefault(e.mitarbeiter_id, set()).add(e.datum)
        cache = {m: len(t) for m, t in cache.items()}
        k._samstage = cache  # type: ignore[attr-defined]
    return cache


def fairness_samstag(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Weich: deutlich mehr Samstage als der Schnitt im Plan (≥ 2 und ≥ Schnitt + 1,5). Schnitt über alle
    Mitarbeiter mit Einsätzen im Plan, deren Vertrag Samstagsarbeit erlaubt."""
    eigene = k.einsaetze_von(mid)
    zaehler = _samstage(k)
    anzahl = zaehler.get(mid, 0)
    if anzahl < 2:
        return []
    basis = [m for m in k.mitarbeiter_ids()
             if (v := k.vertrag(m, k.bis) or k.vertrag(m, k.von)) is None or "5" in v.erlaubte_tage]
    schnitt = sum(zaehler.get(m, 0) for m in basis) / max(1, len(basis))
    if anzahl < schnitt + 1.5:
        return []
    sa = [e for e in eigene if e.datum.weekday() == 5]
    return [Verstoss("FAIRNESS_SAMSTAG", "weich", mid, sa[-1].datum, _ids(sa),
                     f"{anzahl} Samstage im Plan – Schnitt im Team {schnitt:.1f}".replace(".", ","))]
