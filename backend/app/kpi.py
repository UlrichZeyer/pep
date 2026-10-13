"""KPI-Berechnungen (reine Fachlogik, Session als Parameter). Formen wie TS-Typen in api.ts."""
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlmodel import Session, select

from app import bedarf as bedarf_mod
from app.kalender import werktage
from app.models import (
    Abteilung, Abwesenheit, Einsatz, Mitarbeiter, MitarbeiterSkill, Plan, Skill, Vertrag,
    Warengruppe, Wareneingang,
)
from app.util import aktueller_vertrag, arbeitsminuten

PLAN_FREIGEGEBEN = ("freigegeben", "veroeffentlicht")


def _r(x: float, n: int = 2) -> float:
    return round(x, n)


def _quote(zaehler: float, nenner: float) -> Optional[float]:
    return _r(zaehler / nenner, 3) if nenner > 0 else None


def _std(e: Einsatz) -> float:
    return arbeitsminuten(e.beginn, e.ende, e.pause_min) / 60


def _name(m: Mitarbeiter) -> str:
    return f"{m.vorname} {m.nachname}"


def _vertraege(session: Session) -> dict[int, list[Vertrag]]:
    je: dict[int, list[Vertrag]] = defaultdict(list)
    for v in session.exec(select(Vertrag)).all():
        je[v.mitarbeiter_id].append(v)
    return je


def _beschaeftigt(m: Mitarbeiter, tag: date) -> bool:
    return m.eintritt <= tag and (m.austritt is None or m.austritt >= tag)


# ---------------------------------------------------------------- Anlieferung
def anlieferung(session: Session, von: date, bis: date) -> dict:
    """Tageswerte, Monatssummen und gleitende Wochentagsmittel (4/8/12 Wochen bis `bis`)."""
    frueh = min(von, bis - timedelta(weeks=12) + timedelta(days=1))
    tage: dict[date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for d, wg, pal in session.exec(select(Wareneingang.datum, Wareneingang.warengruppe_id,
                                          Wareneingang.paletten)
                                   .where(Wareneingang.datum >= frueh, Wareneingang.datum <= bis)).all():
        tage[d][str(wg)] += pal

    reihe, monate_acc = [], defaultdict(lambda: defaultdict(float))
    for d in sorted(tage):
        if d < von:
            continue
        je = dict(tage[d])
        reihe.append({"datum": d.isoformat(), "je_warengruppe": je, "gesamt": sum(je.values())})
        for k, v in je.items():
            monate_acc[d.strftime("%Y-%m")][k] += v
    monate = [{"monat": m, "je_warengruppe": dict(je), "gesamt": sum(je.values())}
              for m, je in sorted(monate_acc.items())]

    mittel: dict[str, list[dict]] = {}
    for n in (4, 8, 12):
        start = bis - timedelta(weeks=n) + timedelta(days=1)
        zeilen = []
        for wt in range(6):
            tage_wt = [d for d in tage if start <= d <= bis and d.weekday() == wt]
            je: dict[str, float] = defaultdict(float)
            for d in tage_wt:
                for k, v in tage[d].items():
                    je[k] += v
            anzahl = len(tage_wt)
            je_avg = {k: _r(v / anzahl, 1) for k, v in je.items()} if anzahl else {}
            zeilen.append({"wochentag": wt, "je_warengruppe": je_avg,
                           "gesamt": _r(sum(je.values()) / anzahl, 1) if anzahl else 0.0})
        mittel[str(n)] = zeilen
    return {"von": von.isoformat(), "bis": bis.isoformat(), "reihe": reihe, "monate": monate,
            "wochentagsmittel": mittel}


# ---------------------------------------------------------------- Abdeckung
def abdeckung(session: Session, plan: Plan) -> dict:
    """Geplante Netto-Stunden vs. Bedarfsstunden je Tag und Abteilung."""
    bedarf = bedarf_mod.bedarf_stunden(session, plan.von, plan.bis)
    geplant: dict[tuple[date, int], float] = defaultdict(float)
    for e in session.exec(select(Einsatz).where(Einsatz.plan_id == plan.id)).all():
        geplant[(e.datum, e.abteilung_id)] += _std(e)
    abt_ids = [a.id for a in session.exec(select(Abteilung).order_by(Abteilung.sortierung, Abteilung.id)).all()]

    def wert(b: float, g: float) -> dict:
        return {"bedarf_std": _r(b), "geplant_std": _r(g), "abdeckung": _quote(g, b)}

    tage, sb, sg = [], 0.0, 0.0
    t = plan.von
    while t <= plan.bis:
        abts = []
        tb = tg = 0.0
        for a in abt_ids:
            b, g = bedarf.get((t, a), 0.0), geplant.get((t, a), 0.0)
            tb, tg = tb + b, tg + g
            abts.append({"abteilung_id": a, **wert(b, g)})
        tage.append({"datum": t.isoformat(), **wert(tb, tg), "abteilungen": abts})
        sb, sg = sb + tb, sg + tg
        t += timedelta(days=1)
    return {"plan_id": plan.id, "gesamt": wert(sb, sg), "tage": tage}


# ---------------------------------------------------------------- Leistung
def leistung(session: Session, von: date, bis: date) -> dict:
    """Ist-Paletten ÷ geplante Stunden (freigegebene/veröffentlichte Pläne) je Paletten-Abteilung."""
    abts = [a for a in session.exec(select(Abteilung).order_by(Abteilung.sortierung, Abteilung.id)).all()
            if a.bedarfsart == "paletten"]
    wgs = list(session.exec(select(Warengruppe)).all())
    wg_abt = {wg.id: wg.abteilung_id for wg in wgs}
    einsaetze = session.exec(select(Einsatz).join(Plan, Plan.id == Einsatz.plan_id).where(
        Einsatz.datum >= von, Einsatz.datum <= bis, Plan.status.in_(PLAN_FREIGEGEBEN))).all()  # type: ignore[attr-defined]
    std: dict[tuple[date, int], float] = defaultdict(float)
    ist: dict[tuple[date, int], float] = defaultdict(float)
    hat_ist: set[tuple[date, int]] = set()
    for e in einsaetze:
        k = (e.datum, e.abteilung_id)
        std[k] += _std(e)
        if e.ist_paletten is not None:
            ist[k] += e.ist_paletten
            hat_ist.add(k)
    we: dict[tuple[date, int], float] = defaultdict(float)
    pal_wg: dict[int, float] = defaultdict(float)  # für gewichteten Soll-Wert
    for d, wg, pal in session.exec(select(Wareneingang.datum, Wareneingang.warengruppe_id,
                                          Wareneingang.paletten)
                                   .where(Wareneingang.datum >= von, Wareneingang.datum <= bis)).all():
        if wg in wg_abt:
            we[(d, wg_abt[wg])] += pal
            pal_wg[wg] += pal

    zeilen = []
    for a in abts:
        eigene = [wg for wg in wgs if wg.abteilung_id == a.id and wg.std_leistung_pal_h > 0]
        stunden = paletten = 0.0
        for (d, abt_id), s in std.items():
            if abt_id != a.id:
                continue
            stunden += s
            paletten += ist[(d, abt_id)] if (d, abt_id) in hat_ist else we.get((d, abt_id), 0.0)
        p_sum = sum(pal_wg[wg.id] for wg in eigene)
        if p_sum > 0:
            soll = p_sum / sum(pal_wg[wg.id] / wg.std_leistung_pal_h for wg in eigene)
        elif eigene:
            soll = sum(wg.std_leistung_pal_h for wg in eigene) / len(eigene)
        else:
            soll = None
        zeilen.append({"abteilung_id": a.id, "paletten": _r(paletten, 1), "stunden": _r(stunden),
                       "pal_pro_h": _quote(paletten, stunden),
                       "soll_pal_pro_h": _r(soll) if soll is not None else None})
    return {"von": von.isoformat(), "bis": bis.isoformat(), "abteilungen": zeilen}


# ---------------------------------------------------------------- Stunden
def stunden(session: Session, von: date, bis: date) -> dict:
    """Soll (soll_std_woche × Werktage ÷ 6) vs. geplant (Einsätze aller Pläne im Zeitraum)."""
    vertraege = _vertraege(session)
    geplant: dict[int, float] = defaultdict(float)
    for e in session.exec(select(Einsatz).where(Einsatz.datum >= von, Einsatz.datum <= bis)).all():
        geplant[e.mitarbeiter_id] += _std(e)
    tage = werktage(von, bis)
    zeilen = []
    for m in session.exec(select(Mitarbeiter).order_by(Mitarbeiter.nachname, Mitarbeiter.vorname)).all():
        if m.eintritt > bis or (m.austritt is not None and m.austritt < von):
            continue
        if m.status == "inaktiv" and m.id not in geplant:
            continue
        vv = vertraege.get(m.id, [])
        soll = 0.0
        for t in tage:
            if _beschaeftigt(m, t):
                v = aktueller_vertrag(vv, t)
                if v:
                    soll += v.soll_std_woche / 6
        v_ende = aktueller_vertrag(vv, min(bis, m.austritt or bis)) or aktueller_vertrag(vv, von)
        g = geplant.get(m.id, 0.0)
        zeilen.append({"mitarbeiter_id": m.id, "name": _name(m), "vertragsart": v_ende.art if v_ende else None,
                       "soll_std": _r(soll), "geplant_std": _r(g), "differenz": _r(g - soll),
                       "stundenkonto": m.stundenkonto})
    return {"von": von.isoformat(), "bis": bis.isoformat(), "mitarbeiter": zeilen}


# ---------------------------------------------------------------- Personal
def _werktage_abw(a: Abwesenheit, von: date, bis: date) -> list[date]:
    return werktage(max(a.von, von), min(a.bis, bis)) if a.von <= bis and a.bis >= von else []


def personal(session: Session, heute: date) -> dict:
    """Krankenquote (12 Monate), Urlaub im laufenden Jahr, Skill-Abdeckung."""
    vertraege = _vertraege(session)
    alle = list(session.exec(select(Mitarbeiter).order_by(Mitarbeiter.nachname, Mitarbeiter.vorname)).all())
    aktiv = [m for m in alle if m.status == "aktiv" and _beschaeftigt(m, heute)]
    abw: dict[int, list[Abwesenheit]] = defaultdict(list)
    for a in session.exec(select(Abwesenheit).where(Abwesenheit.status != "abgelehnt")).all():
        abw[a.mitarbeiter_id].append(a)

    # Krankenquote
    k_von, k_bis = heute - timedelta(days=365), heute - timedelta(days=1)
    kalender_tage = werktage(k_von, k_bis)
    soll_tage = krank_tage = 0
    for m in aktiv:
        vv = vertraege.get(m.id, [])
        eigene = {t for t in kalender_tage if _beschaeftigt(m, t) and aktueller_vertrag(vv, t)}
        soll_tage += len(eigene)
        krank: set[date] = set()
        for a in abw[m.id]:
            if a.typ == "krank" and a.status == "genehmigt":
                krank.update(t for t in _werktage_abw(a, k_von, k_bis) if t in eigene)
        krank_tage += len(krank)

    # Urlaub laufendes Jahr
    j_von, j_bis = date(heute.year, 1, 1), date(heute.year, 12, 31)
    urlaub = []
    for m in alle:
        if m.status == "inaktiv" or not _beschaeftigt(m, heute):
            continue
        v = aktueller_vertrag(vertraege.get(m.id, []), heute)
        anspruch = v.urlaubstage if v else 0
        genommen: set[date] = set()
        geplant: set[date] = set()
        for a in abw[m.id]:
            if a.typ != "urlaub":
                continue
            for t in _werktage_abw(a, j_von, j_bis):
                if t < heute and a.status == "genehmigt":
                    genommen.add(t)
                elif t >= heute and a.status in ("genehmigt", "beantragt"):
                    geplant.add(t)
        urlaub.append({"mitarbeiter_id": m.id, "name": _name(m), "anspruch": anspruch,
                       "genommen": len(genommen), "geplant": len(geplant),
                       "rest": anspruch - len(genommen) - len(geplant)})

    # Skill-Abdeckung (aktive Mitarbeiter)
    aktiv_ids = {m.id for m in aktiv}
    anzahl: dict[int, int] = defaultdict(int)
    level3: dict[int, int] = defaultdict(int)
    for ms in session.exec(select(MitarbeiterSkill)).all():
        if ms.mitarbeiter_id in aktiv_ids:
            anzahl[ms.skill_id] += 1
            if ms.level >= 3:
                level3[ms.skill_id] += 1
    skills = [{"skill_id": s.id, "anzahl": anzahl[s.id], "anzahl_level3": level3[s.id],
               "engpass": anzahl[s.id] <= 4 and s.kategorie in ("verraeumen", "kasse")}
              for s in session.exec(select(Skill).order_by(Skill.id)).all()]

    return {"stichtag": heute.isoformat(), "krankenquote": _r(krank_tage / soll_tage, 4) if soll_tage else 0.0,
            "urlaub": urlaub, "skill_abdeckung": skills}

