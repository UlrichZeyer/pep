"""Bericht der Auto-Planung: Unter-/Überdeckungen je Tag und Abteilung mit Ursache, Abdeckungsgrad."""
from datetime import date, timedelta
from typing import Any, Optional

from app.regeln.kontext import fmt_std, netto_min
from app.solver.modell import ANZAHL_VIERTEL, TAG_BEGINN, VIERTEL, Modell, viertel_belegung
from app.util import min_zu_zeit, zeit_zu_min

WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
UEBERDECKUNG_AB_VIERTEL = 4  # Überdeckungen erst ab 1 h je Tag und Abteilung melden


def zeile(tag: date, abteilung_id: Optional[int], art: str, stunden: float, meldung: str) -> dict:
    return {"datum": tag.isoformat(), "abteilung_id": abteilung_id, "art": art,
            "stunden": round(stunden, 2), "meldung": meldung}


def _spannen(viertel: list[int]) -> str:
    """Viertelstunden-Indizes → „05:00–06:30, 20:00–21:00“."""
    teile, start, vor = [], None, None
    for q in sorted(viertel):
        if start is None:
            start = vor = q
        elif q == vor + 1:
            vor = q
        else:
            teile.append((start, vor))
            start = vor = q
    if start is not None:
        teile.append((start, vor))
    return ", ".join(f"{min_zu_zeit(TAG_BEGINN + a * VIERTEL)}–{min_zu_zeit(TAG_BEGINN + (b + 1) * VIERTEL)}"
                     for a, b in teile)


def _name(m: Any) -> str:
    return f"{m.vorname} {m.nachname}"


def _skill_name(modell: Modell, abt_id: int) -> str:
    skills = [s for s in modell.k.skill_info.values() if s.abteilung_id == abt_id]
    skills.sort(key=lambda s: (s.kategorie not in ("verraeumen", "kasse"), s.id))
    if skills:
        return skills[0].name
    abt = modell.k.abteilungen.get(abt_id)
    return abt.name if abt else f"#{abt_id}"


def _aufzaehlung(eintraege: list[str], max_n: int = 3) -> str:
    if len(eintraege) <= max_n:
        return ", ".join(eintraege)
    return ", ".join(eintraege[:max_n]) + f" u. a. ({len(eintraege)} insgesamt)"


def _ursache(modell: Modell, tag: date, abt_id: int, alle: dict[int, list[Any]]) -> str:
    """Begründung, warum (tag, abt) nicht gedeckt ist. `alle` = alle Einsätze je Mitarbeiter (inkl. andere Pläne)."""
    k = modell.k
    skill = _skill_name(modell, abt_id)
    inhaber = sorted(m for m, abts in modell.skill_abt.items() if abt_id in abts and m in k.mitarbeiter)
    if not inhaber:
        return f"kein Mitarbeiter mit Skill {skill}"
    im_einsatz = [m for m in inhaber if any(e.datum == tag for e in alle.get(m, []))]
    gruende = {m: modell.verfuegbar(m, tag) for m in inhaber if m not in im_einsatz}
    weg = {m: g for m, g in gruende.items() if g}
    frei = [m for m, g in gruende.items() if not g]
    abwesend_text = _aufzaehlung([f"{_name(k.mitarbeiter[m])}: {g}" for m, g in weg.items()])
    if not im_einsatz and not frei:
        return f"kein verfügbarer Mitarbeiter mit Skill {skill} ({abwesend_text})"
    if not frei:
        anderswo = sum(1 for m in im_einsatz
                       if all(e.abteilung_id != abt_id for e in alle.get(m, []) if e.datum == tag))
        text = f"alle verfügbaren Mitarbeiter mit Skill {skill} sind bereits eingeplant ({len(im_einsatz)} im Einsatz"
        text += f", davon {anderswo} in anderen Abteilungen)" if anderswo else ")"
        return text + (f"; nicht verfügbar: {abwesend_text}" if weg else "")
    # freie Skill-Inhaber: warum nicht eingesetzt?
    mo = tag - timedelta(days=tag.weekday())
    ausgelastet = []
    for m in frei:
        woche = [e for e in alle.get(m, []) if mo <= e.datum <= mo + timedelta(days=6)]
        v = k.vertrag(m, tag)
        jung = (k.alter(m, tag) or 99) < 18
        max_tage = min(v.max_tage_woche, int(k.p("jugend_max_tage_woche"))) if jung else v.max_tage_woche
        max_woche = k.p("jugend_max_std_woche" if jung else "max_std_woche") * 60
        if len({e.datum for e in woche}) >= max_tage:
            ausgelastet.append(f"{_name(k.mitarbeiter[m])}: Arbeitstage der Woche ausgeschöpft")
        elif sum(netto_min(e) for e in woche) + 180 > max_woche:
            ausgelastet.append(f"{_name(k.mitarbeiter[m])}: Wochenhöchstarbeitszeit erreicht")
        elif v.art == "minijob":
            monat = sum(netto_min(e) for e in alle.get(m, []) if (e.datum.year, e.datum.month) == (tag.year, tag.month))
            grenze = (v.max_std_monat or k.p("minijob_max_std_monat")) * 60
            if monat + 180 > grenze:
                ausgelastet.append(f"{_name(k.mitarbeiter[m])}: Minijob-Monatsgrenze erreicht")
        elif not any(c.mitarbeiter_id == m and c.datum == tag and c.abteilung_id == abt_id for c in modell.kandidaten):
            ausgelastet.append(f"{_name(k.mitarbeiter[m])}: Zeitfenster/Ruhezeit passt nicht")
    if len(ausgelastet) == len(frei):
        return f"verfügbare Mitarbeiter mit Skill {skill} sind ausgelastet ({_aufzaehlung(ausgelastet)})"
    namen = _aufzaehlung([_name(k.mitarbeiter[m]) for m in frei])
    return (f"Abwägung der Ziele: weitere Stunden für verfügbare Mitarbeiter mit Skill {skill} ({namen}) "
            f"würden deren Soll-Stunden überschreiten bzw. andere Lücken aufreißen")


def bericht(modell: Modell, plan_einsaetze: list[Any], von: date, bis: date) -> tuple[list[dict], Optional[float]]:
    """Unter-/Überdeckungen und Abdeckungsgrad (1 − Unterdeckung ÷ Bedarf) aus den gespeicherten Einsätzen."""
    k = modell.k
    belegung: dict[tuple[date, int, int], int] = {}
    for e in plan_einsaetze:
        for q in viertel_belegung(zeit_zu_min(e.beginn), zeit_zu_min(e.ende)):
            key = (e.datum, e.abteilung_id, q)
            belegung[key] = belegung.get(key, 0) + 1
    alle: dict[int, list[Any]] = {}
    for e in [*plan_einsaetze, *k.puffer]:
        alle.setdefault(e.mitarbeiter_id, []).append(e)

    zeilen: list[dict] = []
    gesamt = unter_gesamt = 0
    reihenfolge = sorted(k.abteilungen.values(), key=lambda a: (a.sortierung, a.id))
    tag = von
    while tag <= bis:
        for abt in reihenfolge:
            kurve = modell.bedarf.get((tag, abt.id))
            if not kurve:
                continue
            unter_q, ueber_q, unter = [], [], 0
            ueber = 0
            for q in range(ANZAHL_VIERTEL):
                b, ist = kurve[q // 2], belegung.get((tag, abt.id, q), 0)
                gesamt += b
                if ist < b:
                    unter += b - ist
                    unter_q.append(q)
                elif ist > b:
                    ueber += ist - b
                    ueber_q.append(q)
            unter_gesamt += unter
            if unter:
                von_abt, bis_abt = zeit_zu_min(abt.arbeitszeit_von), zeit_zu_min(abt.arbeitszeit_bis)
                ausserhalb = [q for q in unter_q if TAG_BEGINN + q * VIERTEL < von_abt
                              or TAG_BEGINN + (q + 1) * VIERTEL > bis_abt]
                if len(ausserhalb) == len(unter_q):
                    ursache = (f"Bedarf außerhalb der Arbeitszeit der Abteilung "
                               f"({abt.arbeitszeit_von}–{abt.arbeitszeit_bis})")
                else:
                    ursache = _ursache(modell, tag, abt.id, alle)
                    if ausserhalb:
                        ursache += f"; {_spannen(ausserhalb)} liegt außerhalb der Arbeitszeit der Abteilung"
                zeilen.append(zeile(tag, abt.id, "unterdeckung", unter * VIERTEL / 60,
                                    f"{abt.name} {WT[tag.weekday()]} {fmt_std(unter * VIERTEL)} unterdeckt "
                                    f"({_spannen(unter_q)}) – {ursache}"))
            if ueber >= UEBERDECKUNG_AB_VIERTEL:
                zeilen.append(zeile(tag, abt.id, "ueberdeckung", ueber * VIERTEL / 60,
                                    f"{abt.name} {WT[tag.weekday()]} {fmt_std(ueber * VIERTEL)} überdeckt "
                                    f"({_spannen(ueber_q)}) – Mindesteinsatzdauer bzw. Soll-Stunden"))
        tag += timedelta(days=1)
    abdeckung = round(1 - unter_gesamt / gesamt, 4) if gesamt else None
    return zeilen, abdeckung
