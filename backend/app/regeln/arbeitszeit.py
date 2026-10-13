"""Gesetzliche Arbeitszeitregeln: ArbZG, JArbSchG, MuSchG und Überschneidungen."""
from datetime import timedelta

from app.regeln.kontext import (
    SOLL_MINDERNDE_ABWESENHEIT, PlanKontext, Verstoss, brutto_min, eid, fmt_std, fmt_tag, netto_min,
    wochen,
)
from app.util import min_zu_zeit, zeit_zu_min


def _tage(einsaetze: list) -> dict:
    tage: dict = {}
    for e in einsaetze:
        tage.setdefault(e.datum, []).append(e)
    return tage


def _ids(einsaetze: list) -> list[int]:
    return [i for e in einsaetze for i in eid(e)]


def _ruhe_paare(k: PlanKontext, mid: int):
    """(letzter Einsatz Vortag, erster Einsatz Folgetag, Ruhe in Minuten) für aufeinanderfolgende
    Arbeitstage, sofern mindestens einer der beiden Einsätze geprüft wird."""
    tage = _tage(k.alle_einsaetze_von(mid))
    daten = sorted(tage)
    for d1, d2 in zip(daten, daten[1:]):
        vorher = max(tage[d1], key=lambda e: zeit_zu_min(e.ende))
        nachher = min(tage[d2], key=lambda e: zeit_zu_min(e.beginn))
        if not (k.ist_pruefling(vorher) or k.ist_pruefling(nachher)):
            continue
        ruhe = (d2 - d1).days * 1440 - zeit_zu_min(vorher.ende) + zeit_zu_min(nachher.beginn)
        yield vorher, nachher, ruhe


# ---------------------------------------------------------------- ArbZG
def arbzg_3_tag(k: PlanKontext, mid: int) -> list[Verstoss]:
    """§ 3 ArbZG: höchstens 10 h Arbeitszeit pro Tag (Summe aller Einsätze des Tages)."""
    grenze = k.p("max_std_tag") * 60
    tage = _tage(k.alle_einsaetze_von(mid))
    erg = []
    for tag in sorted({e.datum for e in k.einsaetze_von(mid)}):
        summe = sum(netto_min(e) for e in tage[tag])
        if summe > grenze:
            erg.append(Verstoss("ARBZG_3_TAG", "hart", mid, tag, _ids(tage[tag]),
                                f"Arbeitszeit {fmt_std(summe)} am {fmt_tag(tag)} – zulässig sind höchstens {fmt_std(grenze)}"))
    return erg


def arbzg_3_schnitt(k: PlanKontext, mid: int) -> list[Verstoss]:
    """§ 3 ArbZG: Ø höchstens 8 h je Werktag im Ausgleichszeitraum (24 Wochen bis Planende).

    Gezählt werden Werktage (Mo–Sa ohne Feiertage) ab Beginn der vorliegenden Plandaten bzw. Eintritt;
    Tage mit genehmigter Abwesenheit (Urlaub, Krankheit …) bleiben neutral. Ab 7,5 h Warnung (weich)."""
    eigene = k.einsaetze_von(mid)
    if not eigene:
        return []
    ende = k.bis
    start = max(ende - timedelta(weeks=int(k.p("schnitt_wochen"))) + timedelta(days=1), k.daten_ab or k.von)
    m = k.mitarbeiter.get(mid)
    if m and m.eintritt > start:
        start = m.eintritt
    werktage, t = 0, start
    while t <= ende:
        if k.ist_werktag(t) and not k.abwesenheit_am(mid, t, typen=SOLL_MINDERNDE_ABWESENHEIT):
            werktage += 1
        t += timedelta(days=1)
    summe = sum(netto_min(e) for e in k.alle_einsaetze_von(mid) if start <= e.datum <= ende)
    if werktage == 0 or summe == 0:
        return []
    schnitt = summe / werktage
    grenze, warnung = k.p("regel_std_tag") * 60, k.p("schnitt_warnung_std") * 60
    zeitraum = f"{start.strftime('%d.%m.%Y')}–{ende.strftime('%d.%m.%Y')}"
    if schnitt > grenze:
        return [Verstoss("ARBZG_3_SCHNITT", "hart", mid, eigene[-1].datum, [],
                         f"Ø {fmt_std(schnitt)} je Werktag ({zeitraum}) – zulässig sind höchstens {fmt_std(grenze)}")]
    if schnitt >= warnung:
        return [Verstoss("ARBZG_3_SCHNITT", "weich", mid, eigene[-1].datum, [],
                         f"Ø {fmt_std(schnitt)} je Werktag ({zeitraum}) – nahe an der Grenze von {fmt_std(grenze)}")]
    return []


def arbzg_3_woche(k: PlanKontext, mid: int) -> list[Verstoss]:
    """§ 3 ArbZG: höchstens 48 h pro Kalenderwoche (inkl. Einsätze anderer Pläne)."""
    grenze = k.p("max_std_woche") * 60
    eigene = k.einsaetze_von(mid)
    if not eigene:
        return []
    erg = []
    for mo in wochen(eigene[0].datum, eigene[-1].datum):
        so = mo + timedelta(days=6)
        woche = [e for e in k.alle_einsaetze_von(mid) if mo <= e.datum <= so]
        if not any(k.ist_pruefling(e) for e in woche):
            continue
        summe = sum(netto_min(e) for e in woche)
        if summe > grenze:
            erg.append(Verstoss("ARBZG_3_WOCHE", "hart", mid, woche[-1].datum, _ids(woche),
                                f"{fmt_std(summe)} in der KW {mo.isocalendar()[1]} – zulässig sind höchstens {fmt_std(grenze)}"))
    return erg


def arbzg_4_pause(k: PlanKontext, mid: int) -> list[Verstoss]:
    """§ 4 ArbZG: Arbeitszeit (netto) > 6 h → 30 min Pause, > 9 h → 45 min."""
    erg = []
    for e in k.einsaetze_von(mid):
        pause = e.pause_min or 0
        netto = brutto_min(e) - pause
        if netto > 9 * 60:
            soll = k.p("pause_ab_9h_min")
        elif netto > 6 * 60:
            soll = k.p("pause_ab_6h_min")
        else:
            continue
        if pause < soll:
            erg.append(Verstoss("ARBZG_4_PAUSE", "hart", mid, e.datum, eid(e),
                                f"{fmt_std(netto)} Arbeit am {fmt_tag(e.datum)} ({e.beginn}–{e.ende}) mit nur "
                                f"{pause} min Pause – mindestens {int(soll)} min erforderlich"))
    return erg


def arbzg_5_ruhezeit(k: PlanKontext, mid: int) -> list[Verstoss]:
    """§ 5 ArbZG: mindestens 11 h ununterbrochene Ruhezeit zwischen zwei Arbeitstagen."""
    grenze = k.p("ruhezeit_std") * 60
    erg = []
    for vorher, nachher, ruhe in _ruhe_paare(k, mid):
        if ruhe < grenze:
            erg.append(Verstoss("ARBZG_5_RUHEZEIT", "hart", mid, nachher.datum, eid(vorher) + eid(nachher),
                                f"Ruhezeit nur {fmt_std(ruhe)} nach Einsatz am {fmt_tag(vorher.datum)} bis {vorher.ende} "
                                f"(Beginn {fmt_tag(nachher.datum)} {nachher.beginn}) – mindestens {fmt_std(grenze)}"))
    return erg


def arbzg_9_sonntag(k: PlanKontext, mid: int) -> list[Verstoss]:
    """§ 9 ArbZG: keine Beschäftigung an Sonn- und gesetzlichen Feiertagen (BW)."""
    erg = []
    for e in k.einsaetze_von(mid):
        if e.datum.weekday() == 6:
            grund = "Sonntag"
        elif k.ist_feiertag(e.datum):
            grund = f"Feiertag ({k.feiertage[e.datum]})"  # type: ignore[index]
        else:
            continue
        erg.append(Verstoss("ARBZG_9_SONNTAG", "hart", mid, e.datum, eid(e),
                            f"Einsatz am {fmt_tag(e.datum)} ist ein {grund} – Filiale geschlossen, Arbeit unzulässig"))
    return erg


# ---------------------------------------------------------------- JArbSchG
def jarbschg(k: PlanKontext, mid: int) -> list[Verstoss]:
    """JArbSchG für Minderjährige (Alter am Einsatztag < 18): max. 8 h/Tag (§ 8), 40 h/Woche (§ 8),
    5 Tage/Woche (§ 15), 12 h Ruhezeit (§ 13), Arbeit nur zwischen 6 und 20 Uhr (§ 14).
    Ruhezeiten unter 11 h meldet bereits ARBZG_5_RUHEZEIT."""
    def jung(tag) -> bool:
        a = k.alter(mid, tag)
        return a is not None and a < 18

    eigene = [e for e in k.einsaetze_von(mid) if jung(e.datum)]
    if not eigene:
        return []
    erg = []
    max_tag, max_woche = k.p("jugend_max_std_tag") * 60, k.p("jugend_max_std_woche") * 60
    max_tage = int(k.p("jugend_max_tage_woche"))
    frueh, spaet = int(k.p("jugend_frueheste_std") * 60), int(k.p("jugend_spaeteste_std") * 60)
    alle = [e for e in k.alle_einsaetze_von(mid) if jung(e.datum)]
    tage = _tage(alle)
    for tag in sorted({e.datum for e in eigene}):
        summe = sum(netto_min(e) for e in tage[tag])
        if summe > max_tag:
            erg.append(Verstoss("JARBSCHG", "hart", mid, tag, _ids(tage[tag]),
                                f"Jugendliche/r: {fmt_std(summe)} am {fmt_tag(tag)} – höchstens {fmt_std(max_tag)} (§ 8 JArbSchG)"))
    for e in eigene:
        if zeit_zu_min(e.beginn) < frueh or zeit_zu_min(e.ende) > spaet:
            erg.append(Verstoss("JARBSCHG", "hart", mid, e.datum, eid(e),
                                f"Jugendliche/r: Einsatz am {fmt_tag(e.datum)} {e.beginn}–{e.ende} außerhalb "
                                f"{min_zu_zeit(frueh)}–{min_zu_zeit(spaet)} Uhr (§ 14 JArbSchG)"))
    for mo in wochen(eigene[0].datum, eigene[-1].datum):
        woche = [e for e in alle if mo <= e.datum <= mo + timedelta(days=6)]
        if not any(k.ist_pruefling(e) for e in woche):
            continue
        summe = sum(netto_min(e) for e in woche)
        kw = mo.isocalendar()[1]
        if summe > max_woche:
            erg.append(Verstoss("JARBSCHG", "hart", mid, woche[-1].datum, _ids(woche),
                                f"Jugendliche/r: {fmt_std(summe)} in der KW {kw} – höchstens {fmt_std(max_woche)} (§ 8 JArbSchG)"))
        anzahl = len({e.datum for e in woche})
        if anzahl > max_tage:
            erg.append(Verstoss("JARBSCHG", "hart", mid, woche[-1].datum, _ids(woche),
                                f"Jugendliche/r: {anzahl} Arbeitstage in der KW {kw} – höchstens {max_tage} (§ 15 JArbSchG)"))
    ruhe_min, ruhe_jung = k.p("ruhezeit_std") * 60, k.p("jugend_ruhezeit_std") * 60
    for vorher, nachher, ruhe in _ruhe_paare(k, mid):
        if jung(nachher.datum) and ruhe_min <= ruhe < ruhe_jung:
            erg.append(Verstoss("JARBSCHG", "hart", mid, nachher.datum, eid(vorher) + eid(nachher),
                                f"Jugendliche/r: Ruhezeit nur {fmt_std(ruhe)} nach Einsatz am {fmt_tag(vorher.datum)} "
                                f"bis {vorher.ende} – mindestens {fmt_std(ruhe_jung)} (§ 13 JArbSchG)"))
    return erg


# ---------------------------------------------------------------- MuSchG
def muschg(k: PlanKontext, mid: int) -> list[Verstoss]:
    """MuSchG: Mitarbeiterinnen im Status „mutterschutz“ werden nicht eingeplant (sonst nicht relevant)."""
    m = k.mitarbeiter.get(mid)
    if not m or m.status != "mutterschutz":
        return []
    return [Verstoss("MUSCHG", "hart", mid, e.datum, eid(e),
                     f"Einsatz am {fmt_tag(e.datum)} während des Mutterschutzes – keine Einplanung zulässig")
            for e in k.einsaetze_von(mid)]


# ---------------------------------------------------------------- Überschneidung
def ueberschneidung(k: PlanKontext, mid: int) -> list[Verstoss]:
    """Höchstens ein Einsatz pro Mitarbeiter und Tag; überlappende Einsätze sind unzulässig."""
    tage = _tage(k.alle_einsaetze_von(mid))
    erg = []
    for tag in sorted({e.datum for e in k.einsaetze_von(mid)}):
        liste = tage[tag]
        if len(liste) < 2:
            continue
        ueberlapp = any(zeit_zu_min(b.beginn) < zeit_zu_min(a.ende)
                        for i, a in enumerate(liste) for b in liste[i + 1:])
        zeiten = ", ".join(f"{e.beginn}–{e.ende}" for e in liste)
        text = "überschneiden sich" if ueberlapp else "am selben Tag (nur ein Einsatz pro Tag)"
        erg.append(Verstoss("UEBERSCHNEIDUNG", "hart", mid, tag, _ids(liste),
                            f"{len(liste)} Einsätze am {fmt_tag(tag)} {text}: {zeiten}"))
    return erg
