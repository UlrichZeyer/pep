"""CP-SAT-Modell der Auto-Planung (framework-unabhängig, ohne Datenbankzugriff).

Eingabe ist ein `PlanKontext` (Regelwerk), die Bedarfsmatrix und die fix zu übernehmenden Einsätze.
Variablen: x[m, tag, kandidat, abteilung] ∈ {0,1}; Kandidaten werden vorab nach den harten
Einzelregeln gefiltert (Abwesenheit, Vertragstage/-zeitfenster, Feiertage, JArbSchG, MuSchG, Skills).
Abdeckung in Viertelstunden: Σ Personen + unter − ueber = Bedarf (je Abteilung × 15 min).
"""
import os
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable, Optional

from ortools.sat.python import cp_model

from app.regeln.betrieb import _zertifikat_relevant, soll_woche
from app.regeln.kontext import SOLL_MINDERNDE_ABWESENHEIT, PlanKontext, netto_min, wochen
from app.models import Einsatz
from app.util import gesetzliche_pause, min_zu_zeit, zeit_zu_min

SLOT_MIN = 30
TAG_BEGINN = 5 * 60
ANZAHL_SLOTS = 34
VIERTEL = 15
ANZAHL_VIERTEL = ANZAHL_SLOTS * 2
# Netto-Dauern der Kandidaten (min): 3–8 h stündlich, dazu 8,5 / 9 / 10 h
NETTO_DAUERN = [180, 240, 300, 360, 420, 480, 510, 540, 600]
# Beginn-Raster (min) – zusätzlich immer frühester und spätester möglicher Beginn im Zeitfenster.
# 60 statt 30 min halbiert die Kandidatenzahl; CP-SAT liefert damit in 20 s deutlich bessere Pläne.
STARTRASTER = 60
SKALA = 10  # Gewichte × 10 → ganzzahlige Zielfunktion
EINSATZ_KOSTEN = 30  # Grundkosten je Einsatz (Gewicht 1 × 30 min): lieber ein Einsatz als zwei kurze

GEWICHTE_STANDARD: dict[str, float] = {
    "unterdeckung": 100.0,
    "soll_abweichung": 8.0,
    "ueberdeckung": 3.0,
    "fremdabteilung": 2.0,
    "fairness": 5.0,
    "skill_level": 1.0,
}


@dataclass
class Kandidat:
    mitarbeiter_id: int
    datum: date
    abteilung_id: int
    beginn: int  # min ab 0:00
    ende: int
    pause: int
    netto: int
    viertel: list[int]  # belegte Viertelstunden (Index ab 05:00)
    kosten: int = 0


def als_einsatz(c: Kandidat, plan_id: Optional[int]) -> Einsatz:
    return Einsatz(plan_id=plan_id, mitarbeiter_id=c.mitarbeiter_id, abteilung_id=c.abteilung_id, datum=c.datum,
                   beginn=min_zu_zeit(c.beginn), ende=min_zu_zeit(c.ende), pause_min=c.pause, gesperrt=False,
                   quelle="auto")


@dataclass
class Modellergebnis:
    status: str
    zielwert: float
    laufzeit_s: float
    gewaehlt: list[Kandidat] = field(default_factory=list)
    anzahl_variablen: int = 0
    loesungen: int = 0
    schranke: Optional[float] = None  # beste untere Schranke des Zielwerts
    nur_startloesung: bool = False  # CP-SAT ohne Lösung im Zeitlimit → Greedy-Startlösung


def viertel_belegung(beginn: int, ende: int) -> list[int]:
    """Indizes der Viertelstunden (ab 05:00, 68 Stück), die ein Einsatz [beginn, ende) belegt."""
    erg = []
    for i in range(ANZAHL_VIERTEL):
        t = TAG_BEGINN + i * VIERTEL
        if beginn <= t and t + VIERTEL <= ende:
            erg.append(i)
    return erg


def brutto_zu(netto: int) -> tuple[int, int]:
    """(brutto, pause) für eine Netto-Dauer; Pause nach § 4 ArbZG (util.gesetzliche_pause)."""
    brutto = netto + (0 if netto <= 360 else 30 if netto <= 540 else 45)
    pause = gesetzliche_pause(brutto)
    assert brutto - pause == netto, (netto, brutto, pause)
    return brutto, pause


def ist_jung(k: PlanKontext, mid: int, tag: date) -> bool:
    a = k.alter(mid, tag)
    return a is not None and a < 18


class Modell:
    """Baut und löst das Modell. `fix` = Einsätze des Plans, die erhalten bleiben."""

    def __init__(self, k: PlanKontext, bedarf: dict[tuple[date, int], list[int]], fix: list[Any],
                 gewichte: dict[str, float], tage: list[date]):
        self.k, self.bedarf, self.fix, self.tage = k, bedarf, fix, tage
        self.g = {**GEWICHTE_STANDARD, **{a: float(b) for a, b in gewichte.items() if b is not None}}
        self.fix_ids = {id(e) for e in fix}
        # alle festen Einsätze (Plan-fix + andere Pläne) je Mitarbeiter
        self.fest: dict[int, list[Any]] = {}
        for e in [*fix, *k.puffer]:
            self.fest.setdefault(e.mitarbeiter_id, []).append(e)
        self.skill_abt: dict[int, set[int]] = {}
        self.skill_level: dict[tuple[int, int], int] = {}
        for mid, liste in k.skills.items():
            for s in liste:
                info = k.skill_info.get(s.skill_id)
                if info is None or info.abteilung_id is None:
                    continue
                self.skill_abt.setdefault(mid, set()).add(info.abteilung_id)
                key = (mid, info.abteilung_id)
                self.skill_level[key] = max(self.skill_level.get(key, 0), s.level)
        self.engpass = self._engpass_abteilungen()
        self.ausschluss: dict[tuple[int, date], str] = {}  # Grund, warum kein Kandidat (Bericht)
        self.kandidaten: list[Kandidat] = []

    # ---------------------------------------------------------------- Vorbereitung
    def _engpass_abteilungen(self) -> set[int]:
        """Abteilungen mit höchstens 4 aktiven Mitarbeitern ab Skill-Level 2."""
        zaehler: dict[int, int] = {a: 0 for a in self.k.abteilungen}
        for (mid, abt), lvl in self.skill_level.items():
            m = self.k.mitarbeiter.get(mid)
            if m and m.status == "aktiv" and lvl >= 2 and abt in zaehler:
                zaehler[abt] += 1
        return {a for a, n in zaehler.items() if n <= 4}

    def fest_am(self, mid: int, tag: date) -> list[Any]:
        return [e for e in self.fest.get(mid, []) if e.datum == tag]

    def verfuegbar(self, mid: int, tag: date) -> Optional[str]:
        """None = einplanbar, sonst Grund (für den Bericht)."""
        k = self.k
        m = k.mitarbeiter[mid]
        if m.status != "aktiv":
            return {"mutterschutz": "Mutterschutz", "elternzeit": "Elternzeit"}.get(m.status, "inaktiv")
        if tag < m.eintritt or (m.austritt and tag > m.austritt):
            return "nicht beschäftigt"
        v = k.vertrag(mid, tag)
        if v is None:
            return "kein Vertrag"
        if str(tag.weekday()) not in v.erlaubte_tage:
            return "laut Vertrag kein Arbeitstag"
        a = k.abwesenheit_am(mid, tag)
        if a:
            from app.regeln.betrieb import ABWESENHEIT_TEXT
            return ABWESENHEIT_TEXT.get(a.typ, a.typ)
        if self.fest_am(mid, tag):
            return "bereits fest eingeplant"
        return None

    def zeitfenster(self, mid: int, tag: date, abt_id: int) -> tuple[int, int]:
        k = self.k
        v = k.vertrag(mid, tag)
        abt = k.abteilungen[abt_id]
        lo = max(zeit_zu_min(v.frueheste_zeit), zeit_zu_min(abt.arbeitszeit_von), TAG_BEGINN)
        hi = min(zeit_zu_min(v.spaeteste_zeit), zeit_zu_min(abt.arbeitszeit_bis), 22 * 60)
        if ist_jung(k, mid, tag):
            lo = max(lo, int(k.p("jugend_frueheste_std") * 60))
            hi = min(hi, int(k.p("jugend_spaeteste_std") * 60))
        lo = -(-lo // 15) * 15
        hi = hi // 15 * 15
        return lo, hi

    def _kosten(self, mid: int, tag: date, abt_id: int, netto: int, samstage_hist: int) -> int:
        g, k = self.g, self.k
        m = k.mitarbeiter[mid]
        kosten = float(EINSATZ_KOSTEN)
        if m.stammabteilung_id is not None and abt_id != m.stammabteilung_id:
            kosten += g["fremdabteilung"] * netto
        lvl = self.skill_level.get((mid, abt_id), 2)
        zert = any(ms.zertifikat_bis and ms.zertifikat_bis < tag and _zertifikat_relevant(k, ms.skill_id, abt_id)
                   for ms in k.skills.get(mid, []))
        if lvl <= 1 or zert:
            kosten += g["skill_level"] * netto * (2 if abt_id in self.engpass else 1)
        if tag.weekday() == 5:
            kosten += g["fairness"] * 60 * samstage_hist
        if k.abwesenheit_am(mid, tag, status="beantragt"):
            kosten += g["unterdeckung"] * 120  # beantragte Abwesenheit: wie 2 h Unterdeckung
        return int(round(kosten * SKALA))

    def _samstage_historie(self, mid: int) -> int:
        start = self.k.von - timedelta(weeks=4)
        return len({e.datum for e in self.k.puffer
                    if e.mitarbeiter_id == mid and e.datum.weekday() == 5 and start <= e.datum < self.k.von})

    def _ruhe(self, mid: int, folgetag: date) -> int:
        k = self.k
        return int(k.p("jugend_ruhezeit_std" if ist_jung(k, mid, folgetag) else "ruhezeit_std") * 60)

    def kandidaten_erzeugen(self) -> None:
        k = self.k
        self.kandidaten = []
        for mid in sorted(k.mitarbeiter):
            abts = sorted(self.skill_abt.get(mid, set()) & set(k.abteilungen))
            hist = self._samstage_historie(mid)
            for tag in self.tage:
                grund = self.verfuegbar(mid, tag)
                if grund:
                    self.ausschluss[(mid, tag)] = grund
                    continue
                if not abts:
                    self.ausschluss[(mid, tag)] = "kein Skill"
                    continue
                max_netto = int(k.p("max_std_tag") * 60)
                if ist_jung(k, mid, tag):
                    max_netto = min(max_netto, int(k.p("jugend_max_std_tag") * 60))
                # Ruhezeit gegenüber festen Einsätzen am Vor- und Folgetag
                vor = self.fest_am(mid, tag - timedelta(days=1))
                nach = self.fest_am(mid, tag + timedelta(days=1))
                frueh_min = max((zeit_zu_min(e.ende) for e in vor), default=None)
                frueh_min = frueh_min + self._ruhe(mid, tag) - 1440 if frueh_min is not None else 0
                spaet_max = min((zeit_zu_min(e.beginn) for e in nach), default=None)
                spaet_max = spaet_max + 1440 - self._ruhe(mid, tag + timedelta(days=1)) if spaet_max is not None else 1440
                for abt_id in abts:
                    kurve = self.bedarf.get((tag, abt_id))
                    if not kurve or sum(kurve) == 0:
                        continue
                    bedarf_viertel = [kurve[i // 2] for i in range(ANZAHL_VIERTEL)]
                    lo, hi = self.zeitfenster(mid, tag, abt_id)
                    lo = max(lo, -(-frueh_min // 15) * 15)
                    hi = min(hi, spaet_max // 15 * 15)
                    for netto in NETTO_DAUERN:
                        if netto > max_netto:
                            continue
                        brutto, pause = brutto_zu(netto)
                        if lo + brutto > hi:
                            continue
                        starts = set(range(-(-lo // STARTRASTER) * STARTRASTER, hi - brutto + 1, STARTRASTER))
                        starts |= {lo, hi - brutto}
                        for b in sorted(starts):
                            if b < lo or b + brutto > hi:
                                continue
                            belegt = viertel_belegung(b, b + brutto)
                            nutzen = sum(1 for i in belegt if bedarf_viertel[i] > 0)
                            # Kandidaten, die überwiegend bedarfsfreie Zeit belegen, sind nie sinnvoll
                            if nutzen * 2 < len(belegt):
                                continue
                            self.kandidaten.append(Kandidat(
                                mid, tag, abt_id, b, b + brutto, pause, netto, belegt,
                                self._kosten(mid, tag, abt_id, netto, hist)))

    # ---------------------------------------------------------------- Struktur (für Modell und Startlösung)
    def _struktur(self) -> None:
        k, g = self.k, self.g
        self.je_tag: dict[tuple[int, date], list[int]] = {}
        for i, c in enumerate(self.kandidaten):
            self.je_tag.setdefault((c.mitarbeiter_id, c.datum), []).append(i)
        # Obergrenzen: (Kandidaten-Indizes, Attribut "netto" | "tage", Grenze)
        self.grenzen: list[tuple[list[int], str, int]] = []
        self.ruhe_paare: list[tuple[list[int], list[int], int]] = []
        self.soll: list[tuple[int, list[int], int, int]] = []  # (mid, idx, konstante min, soll min)
        self.samstage: list[list[int]] = []
        je = self.je_tag
        for mid in sorted({c.mitarbeiter_id for c in self.kandidaten}):
            fest = self.fest.get(mid, [])
            for tag in self.tage:
                folge = tag + timedelta(days=1)
                if je.get((mid, tag)) and je.get((mid, folge)):
                    self.ruhe_paare.append((je[(mid, tag)], je[(mid, folge)], self._ruhe(mid, folge)))
            for mo in wochen(k.von, k.bis):
                so = mo + timedelta(days=6)
                idx = [i for t in self.tage if mo <= t <= so for i in je.get((mid, t), [])]
                fest_w = [e for e in fest if mo <= e.datum <= so]
                konst_min = sum(netto_min(e) for e in fest_w)
                if idx:
                    jung = any(ist_jung(k, mid, t) for t in self.tage if mo <= t <= so)
                    grenze = int(k.p("jugend_max_std_woche" if jung else "max_std_woche") * 60)
                    self.grenzen.append((idx, "netto", max(0, grenze - konst_min)))
                    vv = [v for t in self.tage if mo <= t <= so and (v := k.vertrag(mid, t))]
                    max_tage = min([v.max_tage_woche for v in vv] or [6])
                    if jung:
                        max_tage = min(max_tage, int(k.p("jugend_max_tage_woche")))
                    self.grenzen.append((idx, "tage", max(0, max_tage - len({e.datum for e in fest_w}))))
                if mo >= k.von and mo + timedelta(days=5) <= k.bis and k.mitarbeiter[mid].status == "aktiv":
                    soll = soll_woche(k, mid, mo)
                    if soll is not None:
                        self.soll.append((mid, idx, konst_min, int(round(soll * 60))))
            # Minijob-Monatsgrenze (inkl. aller Pläne des Monats)
            for jahr, monat in sorted({(t.year, t.month) for t in self.tage}):
                idx = [i for t in self.tage if (t.year, t.month) == (jahr, monat)
                       and (v := k.vertrag(mid, t)) is not None and v.art == "minijob"
                       for i in je.get((mid, t), [])]
                if not idx:
                    continue
                v = k.vertrag(mid, self.kandidaten[idx[-1]].datum)
                grenze = int(round((v.max_std_monat or k.p("minijob_max_std_monat")) * 60))
                konst = sum(netto_min(e) for e in fest if (e.datum.year, e.datum.month) == (jahr, monat)
                            and (vv := k.vertrag(mid, e.datum)) is not None and vv.art == "minijob")
                self.grenzen.append((idx, "netto", max(0, grenze - konst)))
            # § 3 ArbZG: Ø ≤ 8 h je Werktag im Ausgleichszeitraum
            alle = [i for t in self.tage for i in je.get((mid, t), [])]
            if alle:
                ende = k.bis
                beginn = max(ende - timedelta(weeks=int(k.p("schnitt_wochen"))) + timedelta(days=1),
                             k.daten_ab or k.von, k.mitarbeiter[mid].eintritt)
                werktage, t = 0, beginn
                while t <= ende:
                    if k.ist_werktag(t) and not k.abwesenheit_am(mid, t, typen=SOLL_MINDERNDE_ABWESENHEIT):
                        werktage += 1
                    t += timedelta(days=1)
                konst = sum(netto_min(e) for e in fest if beginn <= e.datum <= ende)
                self.grenzen.append((alle, "netto", max(0, int(k.p("regel_std_tag") * 60) * werktage - konst)))
            sa = [i for t in self.tage if t.weekday() == 5 for i in je.get((mid, t), [])]
            if len({self.kandidaten[i].datum for i in sa}) > 2:
                self.samstage.append(sa)
        # Abdeckung: Restbedarf je (Tag, Abteilung, Viertelstunde) nach Abzug der festen Einsätze
        self.beitrag: dict[tuple[date, int, int], list[int]] = {}
        for i, c in enumerate(self.kandidaten):
            for q in c.viertel:
                self.beitrag.setdefault((c.datum, c.abteilung_id, q), []).append(i)
        self.restbedarf: dict[tuple[date, int, int], int] = {}
        for (tag, abt_id), kurve in self.bedarf.items():
            if tag in self.tage:
                for q in range(ANZAHL_VIERTEL):
                    self.restbedarf[(tag, abt_id, q)] = kurve[q // 2]
        for e in self.fix:
            for q in viertel_belegung(zeit_zu_min(e.beginn), zeit_zu_min(e.ende)):
                key = (e.datum, e.abteilung_id, q)
                self.restbedarf[key] = self.restbedarf.get(key, 0) - 1
        self.w_unter = int(round(g["unterdeckung"] * VIERTEL * SKALA))
        self.w_ueber = int(round(g["ueberdeckung"] * VIERTEL * SKALA))
        self.w_soll = int(round(g["soll_abweichung"] * SKALA))

    # ---------------------------------------------------------------- Startlösung (Greedy)
    def startloesung(self, zeitbudget_s: float = 3.0) -> list[int]:
        """Lazy-Greedy: wählt nacheinander den Kandidaten mit dem größten Nutzen (Zielfunktion),
        der alle harten Bedingungen einhält. Dient als Hinweis (Hint) für CP-SAT."""
        import heapq

        kand = self.kandidaten
        rest = dict(self.restbedarf)
        grenze_von: dict[int, list[int]] = {}
        stand = [0] * len(self.grenzen)
        for gi, (idx, _, _) in enumerate(self.grenzen):
            for i in idx:
                grenze_von.setdefault(i, []).append(gi)
        soll_von: dict[int, int] = {}
        soll_ist = [konst for _, _, konst, _ in self.soll]
        for si, (_, idx, _, _) in enumerate(self.soll):
            for i in idx:
                soll_von[i] = si
        ruhe_von: dict[tuple[int, date], int] = {}  # (mid, Folgetag) → Ruhezeit
        for _, morgen, ruhe in self.ruhe_paare:
            c = kand[morgen[0]]
            ruhe_von[(c.mitarbeiter_id, c.datum)] = ruhe
        gewaehlt: dict[tuple[int, date], int] = {}

        def nutzen(i: int) -> int:
            c = kand[i]
            n = -c.kosten
            for q in c.viertel:
                n += self.w_unter if rest.get((c.datum, c.abteilung_id, q), 0) > 0 else -self.w_ueber
            si = soll_von.get(i)
            if si is not None:
                ist, soll = soll_ist[si], self.soll[si][3]
                n -= self.w_soll * (abs(ist + c.netto - soll) - abs(ist - soll))
            return n

        def zulaessig(i: int) -> bool:
            c = kand[i]
            if (c.mitarbeiter_id, c.datum) in gewaehlt:
                return False
            for gi in grenze_von.get(i, []):
                wert = c.netto if self.grenzen[gi][1] == "netto" else 1
                if stand[gi] + wert > self.grenzen[gi][2]:
                    return False
            vor = gewaehlt.get((c.mitarbeiter_id, c.datum - timedelta(days=1)))
            if vor is not None and c.beginn + 1440 - kand[vor].ende < ruhe_von.get((c.mitarbeiter_id, c.datum), 0):
                return False
            folge = c.datum + timedelta(days=1)
            nach = gewaehlt.get((c.mitarbeiter_id, folge))
            if nach is not None and kand[nach].beginn + 1440 - c.ende < ruhe_von.get((c.mitarbeiter_id, folge), 0):
                return False
            return True

        def buchen(i: int, vz: int) -> None:
            """vz = +1 wählen, −1 abwählen."""
            c = kand[i]
            if vz > 0:
                gewaehlt[(c.mitarbeiter_id, c.datum)] = i
            else:
                del gewaehlt[(c.mitarbeiter_id, c.datum)]
            for gi in grenze_von.get(i, []):
                stand[gi] += vz * (c.netto if self.grenzen[gi][1] == "netto" else 1)
            if i in soll_von:
                soll_ist[soll_von[i]] += vz * c.netto
            for q in c.viertel:
                key = (c.datum, c.abteilung_id, q)
                rest[key] = rest.get(key, 0) - vz

        heap = [(-nutzen(i), i) for i in range(len(kand))]
        heapq.heapify(heap)
        while heap:
            _, i = heapq.heappop(heap)
            if not zulaessig(i):
                continue
            n = nutzen(i)
            if n <= 0:
                continue
            if heap and -heap[0][0] > n:
                heapq.heappush(heap, (-n, i))
                continue
            buchen(i, +1)

        # Verbesserung: je gewähltem Einsatz die beste Alternative desselben Mitarbeiters am selben Tag
        # (andere Zeit/Dauer/Abteilung oder gar kein Einsatz) suchen, bis sich nichts mehr verbessert
        ende = time.monotonic() + zeitbudget_s
        verbessert = True
        while verbessert and time.monotonic() < ende:
            verbessert = False
            for key in list(gewaehlt):
                i = gewaehlt[key]
                buchen(i, -1)
                bester, wert = i, nutzen(i)
                for j in self.je_tag[key]:
                    if j != i and zulaessig(j):
                        n = nutzen(j)
                        if n > wert:
                            bester, wert = j, n
                if wert < 0:
                    verbessert = True
                    continue
                if bester != i:
                    verbessert = True
                buchen(bester, +1)
        return sorted(gewaehlt.values())

    # ---------------------------------------------------------------- Modell
    def loesen(self, zeitlimit_s: float = 20.0, num_workers: int = 8,
               bei_loesung: Optional[Callable[[int, float, float], None]] = None) -> Modellergebnis:
        start = time.monotonic()
        g = self.g
        if not self.tage:
            return Modellergebnis(status="OPTIMAL", zielwert=0.0, laufzeit_s=0.0)
        if not self.kandidaten:
            self.kandidaten_erzeugen()
        self._struktur()
        hint = set(self.startloesung())
        kand = self.kandidaten
        mdl = cp_model.CpModel()
        x = [mdl.NewBoolVar(f"x{i}") for i in range(len(kand))]
        ziel: list = [c.kosten * x[i] for i, c in enumerate(kand) if c.kosten]

        def summe(idx, attr: str):
            return sum(getattr(kand[i], attr) * x[i] for i in idx)

        for idx in self.je_tag.values():  # ≤ 1 Einsatz pro Tag
            mdl.AddAtMostOne(x[i] for i in idx)
        for idx, attr, grenze in self.grenzen:
            mdl.Add((summe(idx, "netto") if attr == "netto" else sum(x[i] for i in idx)) <= grenze)
        for heute, morgen, ruhe in self.ruhe_paare:
            w = sum(x[i] for i in heute) + sum(x[i] for i in morgen)
            mdl.Add(summe(morgen, "beginn") + 1440 - summe(heute, "ende") >= ruhe - ruhe * (2 - w))
        if self.w_soll:
            for mid, idx, konst, soll in self.soll:
                dev = mdl.NewIntVar(0, 7 * 1440, f"dev{mid}")
                ist = summe(idx, "netto") + konst
                mdl.Add(dev >= ist - soll)
                mdl.Add(dev >= soll - ist)
                ziel.append(self.w_soll * dev)
        if g["fairness"] > 0:
            for sa in self.samstage:  # mehrere Samstage im Plan: mehr als 2 je Person kosten extra
                ueber = mdl.NewIntVar(0, len(sa), "sa")
                mdl.Add(ueber >= sum(x[i] for i in sa) - 2)
                ziel.append(int(round(g["fairness"] * 60 * 4 * SKALA)) * ueber)
        for key, idx in self.beitrag.items():
            b = self.restbedarf.get(key, 0)
            unter = mdl.NewIntVar(0, max(0, b), "u")
            ueber = mdl.NewIntVar(0, len(idx) + max(0, -b), "o")
            mdl.Add(sum(x[i] for i in idx) + unter - ueber == b)
            ziel.append(self.w_unter * unter)
            if self.w_ueber:
                ziel.append(self.w_ueber * ueber)
        konstant = self.w_unter * sum(max(0, b) for key, b in self.restbedarf.items() if key not in self.beitrag)

        mdl.Minimize(sum(ziel) + konstant)
        for i, v in enumerate(x):
            mdl.AddHint(v, i in hint)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(1.0, zeitlimit_s - (time.monotonic() - start))
        solver.parameters.num_workers = num_workers
        solver.parameters.cp_model_probing_level = 0
        solver.parameters.max_presolve_iterations = 1
        solver.parameters.symmetry_level = 0
        solver.parameters.log_search_progress = bool(os.environ.get("PEP_SOLVER_LOG"))

        class _Rueckruf(cp_model.CpSolverSolutionCallback):
            def __init__(self):
                super().__init__()
                self.anzahl = 0

            def on_solution_callback(self):
                self.anzahl += 1
                if bei_loesung:
                    bei_loesung(self.anzahl, self.ObjectiveValue() / SKALA / 60, self.WallTime())

        rr = _Rueckruf()
        status = solver.Solve(mdl, rr)
        erg = Modellergebnis(status=solver.StatusName(status), zielwert=0.0, laufzeit_s=time.monotonic() - start,
                             anzahl_variablen=len(x), loesungen=rr.anzahl)
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            erg.zielwert = solver.ObjectiveValue() / SKALA / 60
            erg.schranke = solver.BestObjectiveBound() / SKALA / 60
            erg.gewaehlt = [c for i, c in enumerate(kand) if solver.Value(x[i])]
        elif status == cp_model.UNKNOWN and hint:
            # Zeitlimit vor der ersten CP-SAT-Lösung: die (zulässige) Greedy-Startlösung verwenden
            erg.status, erg.nur_startloesung = "FEASIBLE", True
            erg.gewaehlt = [kand[i] for i in sorted(hint)]
        return erg
