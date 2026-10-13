"""Mock-Pläne: 4 freigegebene Vorwochen (mit Ist-Leistung) + aktuelle Woche als Entwurf mit
bewusst eingebauten Regelverstößen.

Vorgehen je Woche (Greedy, deterministisch):
1. Arbeitstage je Mitarbeiter wählen (Soll-Stunden der Woche ÷ mögliche Tage; Tage mit wenig
   Auslastung bevorzugt, Samstage fair verteilt).
2. Je Tag die Arbeitenden auf Abteilungen/Zeiten verteilen: Backstation durchgehend 1 Person,
   Kasse 06:45–21:15 mit ≥ 2 Personen (Spitzen 3), Verräumen früh ab 05:00/06:00 nach Paletten,
   übrige Personen in ihrer Stammabteilung. Vertragsfenster, Ruhezeit, JArbSchG, Skills,
   Abwesenheiten und Minijob-Monatsgrenze werden eingehalten.
"""
import random
from datetime import date, timedelta
from math import floor

from sqlmodel import Session, select

from app.kalender import montag
from app.models import Abteilung, Einsatz, Plan, Warengruppe, Wareneingang
from app.regeln import lade_kontext, soll_woche
from app.regeln.kontext import SOLL_MINDERNDE_ABWESENHEIT, PlanKontext
from app.util import min_zu_zeit, zeit_zu_min

VORWOCHEN = 4
MIN_SCHICHT = 180  # kürzester Einsatz in Minuten
FRUEH_START = {"TRO": "05:00", "KUE": "05:00", "OUG": "05:00", "TK": "06:00", "GET": "06:00", "NF": "06:00"}


def _pause(netto: int) -> int:
    return 0 if netto <= 360 else 30 if netto <= 540 else 45


def _netto_aus_brutto(brutto: int) -> tuple[int, int]:
    """(netto, pause) für eine Anwesenheitsdauer – Pause so, dass § 4 ArbZG erfüllt ist."""
    if brutto <= 360:
        return brutto, 0
    if brutto <= 390:
        return 360, brutto - 360
    if brutto <= 570:
        return brutto - 30, 30
    if brutto <= 585:
        return 540, brutto - 540
    return brutto - 45, 45


def _raster(minuten: float) -> int:
    return int(floor(minuten / 15 + 1e-9)) * 15


class _Planer:
    def __init__(self, session: Session, rng: random.Random, k: PlanKontext, abt: dict[str, Abteilung],
                 bedarf_h: dict[tuple[date, int], float]):
        self.s, self.rng, self.k, self.abt, self.bedarf_h = session, rng, k, abt, bedarf_h
        self.abt_kuerzel = {a.id: a.kuerzel for a in abt.values()}
        self.letztes_ende: dict[int, tuple[date, int]] = {}
        self.monat_min: dict[tuple[int, int, int], int] = {}
        self.samstage: dict[int, int] = {}
        self.skill_abt: dict[int, set[int]] = {}
        for mid, liste in k.skills.items():
            self.skill_abt[mid] = {k.skill_info[s.skill_id].abteilung_id for s in liste
                                   if k.skill_info[s.skill_id].abteilung_id is not None}
        self.aktive = sorted(m.id for m in k.mitarbeiter.values() if m.status == "aktiv")

    # ------------------------------------------------------------ Phase 1: Arbeitstage
    def _arbeitstage(self, mo: date) -> dict[date, dict[int, int]]:
        k = self.k
        tage = [mo + timedelta(days=i) for i in range(6)]
        last: dict[date, int] = {t: 0 for t in tage}
        plan: dict[date, dict[int, int]] = {t: {} for t in tage}
        kandidaten = []
        for mid in self.aktive:
            m = k.mitarbeiter[mid]
            v = k.vertrag(mid, mo)
            soll = soll_woche(k, mid, mo)
            if v is None or not soll:
                continue
            erlaubt = [t for t in tage if k.ist_werktag(t) and str(t.weekday()) in v.erlaubte_tage]
            frei = [t for t in erlaubt if m.eintritt <= t and (m.austritt is None or t <= m.austritt)
                    and not k.abwesenheit_am(mid, t) and not k.abwesenheit_am(mid, t, status="beantragt")]
            abw = sum(1 for t in erlaubt if k.abwesenheit_am(mid, t, typen=SOLL_MINDERNDE_ABWESENHEIT))
            n = min(len(frei), max(0, min(len(erlaubt), v.max_tage_woche) - abw))
            if n <= 0:
                continue
            kandidaten.append((len(frei), self.rng.random(), mid, frei, n, soll))
        kandidaten.sort()
        knapp = {self.abt["BAC"].id, self.abt["KAS"].id}
        skill_last: dict[tuple[date, int], int] = {}
        for _, _, mid, frei, n, soll in kandidaten:
            eigene_knapp = knapp & self.skill_abt.get(mid, set())
            jung = (k.alter(mid, mo) or 99) < 18
            pro_tag = min(_raster(soll * 60 / n), 480 if jung else 510)
            if pro_tag < MIN_SCHICHT // 2:
                continue
            bewertet = sorted(frei, key=lambda t: last[t] + (self.samstage.get(mid, 0) * 600 if t.weekday() == 5 else 0)
                              + sum(skill_last.get((t, a), 0) for a in eigene_knapp) * 240
                              + self.rng.random() * 120)
            gewaehlt = sorted(bewertet[:n])
            rest = _raster(soll * 60) - pro_tag * n  # Rundungsrest auf den letzten Tag
            for i, t in enumerate(gewaehlt):
                netto = pro_tag + (rest if i == len(gewaehlt) - 1 and 0 < rest < 60 else 0)
                plan[t][mid] = netto
                last[t] += netto
                for a in eigene_knapp:
                    skill_last[(t, a)] = skill_last.get((t, a), 0) + 1
        return plan

    # ------------------------------------------------------------ Phase 2: Zuordnung je Tag
    def _fenster(self, mid: int, tag: date) -> tuple[int, int]:
        v = self.k.vertrag(mid, tag)
        lo, hi = zeit_zu_min(v.frueheste_zeit), zeit_zu_min(v.spaeteste_zeit)
        jung = (self.k.alter(mid, tag) or 99) < 18
        if jung:
            lo, hi = max(lo, 360), min(hi, 1200)
        if mid in self.letztes_ende:
            d, ende = self.letztes_ende[mid]
            ruhe = (12 if jung else 11) * 60
            lo = max(lo, ende + ruhe - (tag - d).days * 1440)
        return _raster(lo + 14), hi

    def _tag(self, plan: Plan, tag: date, arbeit: dict[int, int]) -> list[Einsatz]:
        k = self.k
        offen: dict[int, dict] = {}
        for mid, netto in arbeit.items():
            v = k.vertrag(mid, tag)
            if v.art == "minijob":
                grenze = (v.max_std_monat or k.p("minijob_max_std_monat")) * 60 - 30
                rest = grenze - self.monat_min.get((mid, tag.year, tag.month), 0)
                netto = min(netto, _raster(rest))
                if netto < 120:
                    continue
            lo, hi = self._fenster(mid, tag)
            offen[mid] = {"netto": netto, "lo": lo, "hi": hi}
        neu: list[Einsatz] = []

        def brutto(mid: int) -> int:
            n = offen[mid]["netto"]
            return n + _pause(n)

        def setze(mid: int, abt: Abteilung, start: int, ende: int) -> None:
            netto, pause = _netto_aus_brutto(ende - start)
            neu.append(Einsatz(plan_id=plan.id, mitarbeiter_id=mid, abteilung_id=abt.id, datum=tag,
                               beginn=min_zu_zeit(start), ende=min_zu_zeit(ende), pause_min=pause, quelle="mock"))
            self.letztes_ende[mid] = (tag, ende)
            key = (mid, tag.year, tag.month)
            self.monat_min[key] = self.monat_min.get(key, 0) + netto
            if tag.weekday() == 5:
                self.samstage[mid] = self.samstage.get(mid, 0) + 1
            del offen[mid]

        def kandidaten(abt: Abteilung) -> list[int]:
            return [mid for mid in offen if abt.id in self.skill_abt.get(mid, set())]

        def rang(mid: int, abt: Abteilung) -> tuple:
            m = k.mitarbeiter[mid]
            return (m.stammabteilung_id != abt.id, len(self.skill_abt.get(mid, ())), self.rng.random())

        # Abdeckung (Backstation, Kasse) slotweise auffüllen
        def abdecken(abt: Abteilung, ziel: dict[int, int]) -> None:
            ende_abt = zeit_zu_min(abt.arbeitszeit_bis)
            belegt = {t: 0 for t in ziel}
            ueberspringen: set[int] = set()
            while True:
                luecken = [t for t in sorted(ziel) if belegt[t] < ziel[t] and t not in ueberspringen]
                if not luecken:
                    return
                t = luecken[0]
                def schicht(mid: int) -> tuple[int, int]:
                    o, b = offen[mid], brutto(mid)
                    schluss = min(o["hi"], ende_abt)
                    if t + b >= schluss - 30:  # Spätdienst bis Geschäftsschluss ziehen
                        return min(t, max(o["lo"], schluss - b)), schluss
                    return t, t + b

                passend = [mid for mid in kandidaten(abt) if offen[mid]["lo"] <= t
                           and min(offen[mid]["hi"], ende_abt) > t
                           and schicht(mid)[1] - schicht(mid)[0] >= MIN_SCHICHT]
                if not passend:
                    ueberspringen.add(t)
                    continue
                # spät verfügbare Kräfte zuerst (frühe werden fürs Verräumen gebraucht)
                mid = min(passend, key=lambda x: (-offen[x]["lo"],) + rang(x, abt))
                start, ende = schicht(mid)
                setze(mid, abt, start, ende)
                for s in belegt:
                    if start <= s < ende:
                        belegt[s] += 1

        def profil(von: str, bis: str, n: int, extra: list[tuple[str, str, int]] = ()) -> dict[int, int]:
            ziel = {t: n for t in range(zeit_zu_min(von), zeit_zu_min(bis), 15)}
            for a, b, m in extra:
                for t in range(zeit_zu_min(a), zeit_zu_min(b), 15):
                    ziel[t] = max(ziel.get(t, 0), m)
            return ziel

        abdecken(self.abt["BAC"], profil("06:00", "20:00", 1))
        spitzen = [("09:00", "18:00", 3)] if tag.weekday() == 5 else [("10:00", "13:00", 3), ("16:00", "19:00", 3)]
        abdecken(self.abt["KAS"], profil("06:45", "21:15", 2, spitzen))

        # Verräumen früh nach Palettenbedarf
        verraeum = sorted(FRUEH_START, key=lambda kz: -self.bedarf_h.get((tag, self.abt[kz].id), 0))
        for kz in verraeum:
            abt = self.abt[kz]
            bedarf = self.bedarf_h.get((tag, abt.id), 0) * 60
            start = zeit_zu_min(FRUEH_START[kz])
            geplant = 0
            while geplant < bedarf * 0.85:
                passend = [mid for mid in kandidaten(abt) if offen[mid]["lo"] <= start + 60
                           and offen[mid]["hi"] - max(start, offen[mid]["lo"]) >= MIN_SCHICHT]
                if not passend:
                    break
                mid = min(passend, key=lambda x: rang(x, abt))
                o = offen[mid]
                b = max(start, o["lo"])
                e = min(b + brutto(mid), o["hi"])
                geplant += _netto_aus_brutto(e - b)[0]
                setze(mid, abt, b, e)

        # Übrige: Stammabteilung bzw. erste passende Abteilung
        standard_start = {"KAS": 600, "BAC": 480}
        for mid in sorted(offen):
            m = k.mitarbeiter[mid]
            o = offen[mid]
            ziele = sorted((a for a in self.abt.values() if a.id in self.skill_abt.get(mid, set())),
                           key=lambda a: (a.id != m.stammabteilung_id, a.sortierung))
            for abt in ziele:
                lo = max(o["lo"], zeit_zu_min(abt.arbeitszeit_von))
                hi = min(o["hi"], zeit_zu_min(abt.arbeitszeit_bis))
                start = max(lo, standard_start.get(abt.kuerzel, 360))
                ende = start + brutto(mid)
                if ende > hi:
                    ende = hi
                    start = max(lo, ende - brutto(mid))
                if ende - start >= MIN_SCHICHT:
                    setze(mid, abt, start, ende)
                    break
        return neu

    def woche(self, plan: Plan) -> list[Einsatz]:
        einsaetze = []
        for tag, arbeit in sorted(self._arbeitstage(plan.von).items()):
            if arbeit:
                einsaetze.extend(self._tag(plan, tag, arbeit))
        return einsaetze


def _ist_paletten(einsaetze: list[Einsatz], paletten: dict[tuple[date, int], float], k: PlanKontext) -> None:
    """Paletten des Tages je Abteilung anteilig (Netto-Stunden × Leistungsfaktor) auf die Einsätze verteilen."""
    gruppen: dict[tuple[date, int], list[Einsatz]] = {}
    for e in einsaetze:
        if (e.datum, e.abteilung_id) in paletten:
            gruppen.setdefault((e.datum, e.abteilung_id), []).append(e)
    for key, liste in gruppen.items():
        def gewicht(e: Einsatz) -> float:
            faktor = next((s.leistungsfaktor for s in k.skills.get(e.mitarbeiter_id, [])
                           if k.skill_info[s.skill_id].abteilung_id == e.abteilung_id), 1.0)
            return (zeit_zu_min(e.ende) - zeit_zu_min(e.beginn) - e.pause_min) * faktor
        summe = sum(gewicht(e) for e in liste) or 1
        for e in liste:
            e.ist_paletten = round(paletten[key] * gewicht(e) / summe, 1)


def _verstoesse_einbauen(einsaetze: list[Einsatz], k: PlanKontext, abt: dict[str, Abteilung], plan: Plan) -> None:
    """Bewusste Verstöße im Entwurf: Ruhezeit, fehlende Pause, Jugendliche/r bis 21 Uhr,
    Einsatz im Urlaub, fehlender Skill."""
    def jung(mid: int) -> bool:
        return (k.alter(mid, plan.von) or 99) < 18

    je_ma: dict[int, list[Einsatz]] = {}
    for e in einsaetze:
        je_ma.setdefault(e.mitarbeiter_id, []).append(e)
    benutzt: set[int] = set()

    # 1. Ruhezeit < 11 h: nach Spätdienst am Folgetag früh um 06:00 beginnen
    for mid in sorted(je_ma):
        liste = sorted(je_ma[mid], key=lambda e: e.datum)
        v = k.vertrag(mid, plan.von)
        if jung(mid) or zeit_zu_min(v.frueheste_zeit) > 360:
            continue
        paar = next(((a, b) for a, b in zip(liste, liste[1:]) if (b.datum - a.datum).days == 1
                     and zeit_zu_min(a.ende) >= 1230), None)
        if paar:
            b = paar[1]
            dauer = zeit_zu_min(b.ende) - zeit_zu_min(b.beginn)
            b.beginn, b.ende = "06:00", min_zu_zeit(360 + dauer)
            benutzt.add(mid)
            break

    # 2. > 6 h ohne Pause
    for e in sorted(einsaetze, key=lambda e: (e.datum, e.mitarbeiter_id)):
        if e.mitarbeiter_id not in benutzt and not jung(e.mitarbeiter_id) and e.pause_min == 30 \
                and zeit_zu_min(e.ende) - zeit_zu_min(e.beginn) >= 420:
            e.pause_min = 0
            benutzt.add(e.mitarbeiter_id)
            break

    # 3. Minderjährige/r bis 21:00
    for mid in sorted(je_ma):
        if jung(mid):
            e = sorted(je_ma[mid], key=lambda e: e.datum)[0]
            dauer = zeit_zu_min(e.ende) - zeit_zu_min(e.beginn)
            e.beginn, e.ende = min_zu_zeit(1260 - dauer), "21:00"
            benutzt.add(mid)
            break

    # 4. Einsatz während genehmigtem Urlaub
    gefunden = False
    for mid in sorted(k.mitarbeiter):
        if gefunden or k.mitarbeiter[mid].status != "aktiv" or mid in benutzt:
            continue
        v = k.vertrag(mid, plan.von)
        for i in range(6):
            t = plan.von + timedelta(days=i)
            a = k.abwesenheit_am(mid, t)
            if v and a and a.typ == "urlaub" and k.ist_werktag(t) and str(t.weekday()) in v.erlaubte_tage:
                abt_id = k.mitarbeiter[mid].stammabteilung_id or abt["KAS"].id
                lo = max(zeit_zu_min(v.frueheste_zeit), 480)
                einsaetze.append(Einsatz(plan_id=plan.id, mitarbeiter_id=mid, abteilung_id=abt_id, datum=t,
                                         beginn=min_zu_zeit(lo), ende=min_zu_zeit(lo + 360), pause_min=0, quelle="mock"))
                benutzt.add(mid)
                gefunden = True
                break

    # 5. Fehlender Skill: Einsatz in Tiefkühl ohne TK-Skill
    tk = abt["TK"].id
    for e in sorted(einsaetze, key=lambda e: (e.datum, e.mitarbeiter_id)):
        hat = {k.skill_info[s.skill_id].abteilung_id for s in k.skills.get(e.mitarbeiter_id, [])}
        if e.mitarbeiter_id not in benutzt and tk not in hat and e.abteilung_id not in (abt["KAS"].id, abt["BAC"].id):
            e.abteilung_id = tk
            break


def generate(session: Session, rng: random.Random, heute: date) -> None:
    """Erzeugt 4 freigegebene Vorwochen-Pläne und den Entwurf der aktuellen Woche."""
    aktuell = montag(heute)
    erste = aktuell - timedelta(weeks=VORWOCHEN)
    k = lade_kontext(session, erste, aktuell + timedelta(days=5), einsaetze=[])
    abt = {a.kuerzel: a for a in session.exec(select(Abteilung)).all()}

    # Palettenbedarf (h) je Tag und Abteilung; fehlende Tage (Zukunft) aus der Vorwoche übernehmen
    wgs = {w.id: w for w in session.exec(select(Warengruppe)).all()}
    paletten: dict[tuple[date, int], float] = {}
    bedarf_h: dict[tuple[date, int], float] = {}
    for we in session.exec(select(Wareneingang).where(Wareneingang.datum >= erste - timedelta(days=7),
                                                      Wareneingang.datum <= aktuell + timedelta(days=6))).all():
        wg = wgs[we.warengruppe_id]
        key = (we.datum, wg.abteilung_id)
        paletten[key] = paletten.get(key, 0) + we.paletten
        bedarf_h[key] = bedarf_h.get(key, 0) + we.paletten / wg.std_leistung_pal_h
    for i in range(6):
        t = aktuell + timedelta(days=i)
        for a in abt.values():
            if (t, a.id) not in bedarf_h:
                bedarf_h[(t, a.id)] = bedarf_h.get((t - timedelta(days=7), a.id), 0)

    planer = _Planer(session, rng, k, abt, bedarf_h)
    for w in range(VORWOCHEN + 1):
        mo = erste + timedelta(weeks=w)
        entwurf = mo == aktuell
        kw, jahr = mo.isocalendar()[1], mo.isocalendar()[0]
        plan = Plan(name=f"KW {kw:02d}/{jahr}", von=mo, bis=mo + timedelta(days=5),
                    status="entwurf" if entwurf else "freigegeben", quelle="mock")
        session.add(plan)
        session.flush()
        einsaetze = planer.woche(plan)
        if entwurf:
            _verstoesse_einbauen(einsaetze, k, abt, plan)
        else:
            _ist_paletten(einsaetze, paletten, k)
        session.add_all(einsaetze)
    session.flush()
