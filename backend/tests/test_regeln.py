"""Regelwerk: positive/negative Fälle und Grenzwerte – Kontext ohne Datenbank."""
from datetime import date, timedelta

import pytest

from app.models import Abteilung, Abwesenheit, Einsatz, Mitarbeiter, MitarbeiterSkill, Skill, Vertrag
from app.regeln import REGELKATALOG, REGELN, PlanKontext, pruefe

MO = date(2026, 11, 9)  # Woche ohne Feiertag (Mo 09.11. – Sa 14.11.)
SA = MO + timedelta(days=5)
TRO, TK, GET = 1, 2, 3

ABTEILUNGEN = {TRO: Abteilung(id=TRO, name="Trockensortiment", kuerzel="TRO", farbe="#000"),
               TK: Abteilung(id=TK, name="Tiefkühl", kuerzel="TK", farbe="#000"),
               GET: Abteilung(id=GET, name="Getränke", kuerzel="GET", farbe="#000")}
SKILLS = {1: Skill(id=1, name="Verräumen Trocken", kategorie="verraeumen", abteilung_id=TRO),
          2: Skill(id=2, name="Verräumen Getränke", kategorie="verraeumen", abteilung_id=GET),
          3: Skill(id=3, name="Ameise/Staplerschein", kategorie="zertifikat", hat_ablauf=True)}


def ma(mid: int = 1, geb: date = date(1990, 1, 1), status: str = "aktiv") -> Mitarbeiter:
    return Mitarbeiter(id=mid, persnr=str(mid), vorname="Test", nachname=str(mid), geburtsdatum=geb,
                       eintritt=date(2020, 1, 1), status=status)


def vertrag(mid: int = 1, **kw) -> Vertrag:
    werte = dict(art="vollzeit", gueltig_ab=date(2020, 1, 1), soll_std_woche=40, max_tage_woche=6)
    werte.update(kw)
    return Vertrag(mitarbeiter_id=mid, **werte)


_ZAEHLER = iter(range(1, 100000))


def ein(tag: date, beginn: str, ende: str, pause: int = 0, abt: int = TRO, mid: int = 1) -> Einsatz:
    return Einsatz(id=next(_ZAEHLER), plan_id=1, mitarbeiter_id=mid, abteilung_id=abt, datum=tag,
                   beginn=beginn, ende=ende, pause_min=pause)


def kontext(einsaetze, puffer=(), mitarbeiter=None, vertraege=None, skills=None, abwesenheiten=(),
            von=MO, bis=SA, **kw) -> PlanKontext:
    mitarbeiter = mitarbeiter or [ma()]
    vertraege = vertraege if vertraege is not None else [vertrag(m.id) for m in mitarbeiter]
    if skills is None:
        skills = [MitarbeiterSkill(mitarbeiter_id=m.id, skill_id=1) for m in mitarbeiter]
    vt, sk, ab = {}, {}, {}
    for v in vertraege:
        vt.setdefault(v.mitarbeiter_id, []).append(v)
    for s in skills:
        sk.setdefault(s.mitarbeiter_id, []).append(s)
    for a in abwesenheiten:
        ab.setdefault(a.mitarbeiter_id, []).append(a)
    return PlanKontext(von=von, bis=bis, einsaetze=list(einsaetze), puffer=list(puffer),
                       mitarbeiter={m.id: m for m in mitarbeiter}, vertraege=vt, skills=sk, skill_info=SKILLS,
                       abteilungen=ABTEILUNGEN, abwesenheiten=ab, **kw)


def regel(k: PlanKontext, code: str, mid: int = 1):
    return REGELN[code](k, mid)


def tag(i: int) -> date:
    return MO + timedelta(days=i)


# ---------------------------------------------------------------- ArbZG
@pytest.mark.parametrize("beginn,ende,pause,verstoss", [
    ("08:00", "14:00", 0, False),   # genau 6:00 h ohne Pause
    ("08:00", "14:15", 0, True),    # 6:15 h ohne Pause
    ("08:00", "14:15", 15, False),  # netto genau 6:00 h
    ("08:00", "14:30", 30, False),
    ("08:00", "14:30", 15, True),   # netto 6:15 h, nur 15 min Pause
    ("08:00", "17:30", 30, False),  # netto genau 9:00 h
    ("08:00", "17:45", 30, True),   # netto 9:15 h → 45 min nötig
    ("08:00", "17:45", 45, False),
])
def test_pause(beginn, ende, pause, verstoss):
    k = kontext([ein(tag(0), beginn, ende, pause)])
    assert bool(regel(k, "ARBZG_4_PAUSE")) is verstoss


@pytest.mark.parametrize("ende_vortag,beginn,verstoss", [
    ("21:00", "08:00", False),  # genau 11:00 h
    ("21:15", "08:00", True),   # 10:45 h
    ("21:45", "08:45", False),
    ("21:45", "08:30", True),
])
def test_ruhezeit(ende_vortag, beginn, verstoss):
    k = kontext([ein(tag(0), "13:00", ende_vortag, 30), ein(tag(1), beginn, "14:00", 0)])
    v = regel(k, "ARBZG_5_RUHEZEIT")
    assert bool(v) is verstoss
    if verstoss:
        assert v[0].schwere == "hart" and v[0].datum == tag(1) and len(v[0].einsatz_ids) == 2


def test_ruhezeit_gegen_puffer_der_vorwoche():
    sa_vorher = MO - timedelta(days=2)
    k = kontext([ein(tag(0), "05:00", "10:00")], puffer=[ein(sa_vorher, "14:00", "21:45", 30)])
    assert not regel(k, "ARBZG_5_RUHEZEIT")  # Sonntag dazwischen
    k = kontext([ein(tag(0), "05:00", "10:00")], puffer=[ein(MO - timedelta(days=1), "14:00", "21:00", 30)])
    assert regel(k, "ARBZG_5_RUHEZEIT")


def test_ruhezeit_meldung():
    k = kontext([ein(tag(0), "13:00", "21:45", 30), ein(tag(1), "07:15", "12:00")])
    assert regel(k, "ARBZG_5_RUHEZEIT")[0].meldung.startswith("Ruhezeit nur 9,5 h nach Einsatz am 09.11. bis 21:45")


@pytest.mark.parametrize("ende,pause,verstoss", [("16:45", 45, False), ("17:00", 45, True)])
def test_max_tag(ende, pause, verstoss):
    k = kontext([ein(tag(0), "06:00", ende, pause)])  # netto 10:00 bzw. 10:15
    assert bool(regel(k, "ARBZG_3_TAG")) is verstoss


@pytest.mark.parametrize("letzter_tag_ende,verstoss", [("14:30", False), ("14:45", True)])
def test_max_woche(letzter_tag_ende, verstoss):
    e = [ein(tag(i), "06:00", "14:30", 30) for i in range(5)] + [ein(tag(5), "06:00", letzter_tag_ende, 30)]
    assert bool(regel(kontext(e), "ARBZG_3_WOCHE")) is verstoss  # 48:00 bzw. 48:15 h


def test_schnitt_warnung_und_hart():
    weich = kontext([ein(tag(i), "06:00", "15:30", 30) for i in range(5)])  # 45 h / 6 Werktage = 7,5 h
    v = regel(weich, "ARBZG_3_SCHNITT")
    assert [x.schwere for x in v] == ["weich"]
    hart = kontext([ein(tag(i), "06:00", "14:45", 30) for i in range(6)])  # 8,25 h je Werktag
    assert [x.schwere for x in regel(hart, "ARBZG_3_SCHNITT")] == ["hart"]
    ok = kontext([ein(tag(i), "06:00", "14:30", 30) for i in range(5)])  # 40 h / 6 = 6,67 h
    assert not regel(ok, "ARBZG_3_SCHNITT")


def test_schnitt_beruecksichtigt_puffer():
    # Vorwochen mit wenig Arbeit gleichen eine lange Woche aus
    puffer = [ein(MO - timedelta(weeks=w) + timedelta(days=i), "08:00", "12:00") for w in (1, 2, 3) for i in range(5)]
    k = kontext([ein(tag(i), "06:00", "14:45", 30) for i in range(6)], puffer=puffer)
    assert not [v for v in regel(k, "ARBZG_3_SCHNITT") if v.schwere == "hart"]


@pytest.mark.parametrize("datum,verstoss", [
    (MO, False), (MO + timedelta(days=6), True),  # Sonntag 15.11.
    (date(2026, 12, 25), True), (date(2026, 1, 6), True),  # 1. Weihnachtstag, Hl. Drei Könige (BW)
])
def test_sonntag_feiertag(datum, verstoss):
    k = kontext([ein(datum, "08:00", "12:00")], von=min(MO, datum), bis=max(SA, datum))
    assert bool(regel(k, "ARBZG_9_SONNTAG")) is verstoss


# ---------------------------------------------------------------- JArbSchG
JUNG = ma(geb=date(2009, 6, 1))  # 17 Jahre im November 2026


@pytest.mark.parametrize("beginn,ende,pause,verstoss", [
    ("12:00", "20:00", 30, False),  # Ende genau 20:00
    ("12:15", "20:15", 30, True),   # Ende 20:15
    ("06:00", "14:30", 30, False),  # Beginn genau 06:00, netto 8 h
    ("05:45", "12:00", 0, True),    # Beginn vor 06:00
    ("06:00", "14:45", 30, True),   # netto 8:15 h
])
def test_jugendliche_tag(beginn, ende, pause, verstoss):
    k = kontext([ein(tag(0), beginn, ende, pause)], mitarbeiter=[JUNG])
    assert bool(regel(k, "JARBSCHG")) is verstoss
    erwachsen = kontext([ein(tag(0), beginn, ende, pause)])
    assert not regel(erwachsen, "JARBSCHG")


def test_jugendliche_woche_tage_ruhe():
    sechs = [ein(tag(i), "08:00", "14:00") for i in range(6)]  # 36 h, aber 6 Tage
    meld = [v.meldung for v in regel(kontext(sechs, mitarbeiter=[JUNG]), "JARBSCHG")]
    assert any("6 Arbeitstage" in m for m in meld) and not any("in der KW" in m and "h in" in m for m in meld)
    fuenf = [ein(tag(i), "06:00", "14:45", 45) for i in range(5)]  # 5 × 8 h = 40 h
    assert not regel(kontext(fuenf, mitarbeiter=[JUNG]), "JARBSCHG")
    ruhe = [ein(tag(0), "12:00", "20:00", 30), ein(tag(1), "07:45", "12:00")]  # 11:45 h Ruhe
    assert any("Ruhezeit" in v.meldung for v in regel(kontext(ruhe, mitarbeiter=[JUNG]), "JARBSCHG"))
    ruhe_ok = [ein(tag(0), "12:00", "20:00", 30), ein(tag(1), "08:00", "12:00")]
    assert not regel(kontext(ruhe_ok, mitarbeiter=[JUNG]), "JARBSCHG")


def test_jugendliche_18_geburtstag():
    geburtstag = ma(geb=date(2008, 11, 10))  # wird am 10.11.2026 volljährig
    e = [ein(tag(0), "12:00", "21:00", 30), ein(tag(1), "12:00", "21:00", 30)]
    v = regel(kontext(e, mitarbeiter=[geburtstag]), "JARBSCHG")
    assert v and {x.datum for x in v} == {tag(0)}


# ---------------------------------------------------------------- MuSchG, Überschneidung
def test_mutterschutz():
    assert regel(kontext([ein(tag(0), "08:00", "12:00")], mitarbeiter=[ma(status="mutterschutz")]), "MUSCHG")
    assert not regel(kontext([ein(tag(0), "08:00", "12:00")]), "MUSCHG")


def test_ueberschneidung():
    v = regel(kontext([ein(tag(0), "08:00", "12:00"), ein(tag(0), "11:00", "15:00")]), "UEBERSCHNEIDUNG")
    assert len(v) == 1 and v[0].schwere == "hart" and "überschneiden" in v[0].meldung
    v = regel(kontext([ein(tag(0), "06:00", "10:00"), ein(tag(0), "17:00", "21:00")]), "UEBERSCHNEIDUNG")
    assert len(v) == 1 and "selben Tag" in v[0].meldung
    assert not regel(kontext([ein(tag(0), "06:00", "10:00"), ein(tag(1), "06:00", "10:00")]), "UEBERSCHNEIDUNG")


# ---------------------------------------------------------------- Vertrag
def test_vertrag_tage():
    v = [vertrag(erlaubte_tage="01234", max_tage_woche=3)]
    k = kontext([ein(tag(i), "08:00", "12:00") for i in (0, 1, 2, 5)], vertraege=v)
    meld = [x.meldung for x in regel(k, "VERTRAG_TAGE")]
    assert any("Samstag" in m for m in meld) and any("4 Arbeitstage" in m for m in meld)
    assert not regel(kontext([ein(tag(i), "08:00", "12:00") for i in (0, 1, 2)], vertraege=v), "VERTRAG_TAGE")
    assert regel(kontext([ein(tag(0), "08:00", "12:00")], vertraege=[]), "VERTRAG_TAGE")  # kein Vertrag


@pytest.mark.parametrize("beginn,ende,verstoss", [
    ("14:00", "18:00", False), ("13:45", "18:00", True), ("17:00", "20:00", False), ("17:00", "20:15", True)])
def test_zeitfenster(beginn, ende, verstoss):
    k = kontext([ein(tag(0), beginn, ende)], vertraege=[vertrag(frueheste_zeit="14:00", spaeteste_zeit="20:00")])
    assert bool(regel(k, "VERTRAG_ZEITFENSTER")) is verstoss


@pytest.mark.parametrize("ende,verstoss", [("11:00", False), ("11:15", True)])
def test_minijob_monat(ende, verstoss):
    v = [vertrag(art="minijob", soll_std_woche=10, max_std_monat=43)]
    # Puffer: 8 × 5 h = 40 h im November in anderen Wochen
    puffer = [ein(date(2026, 11, d), "08:00", "13:00") for d in (2, 3, 4, 5, 16, 17, 18, 19)]
    k = kontext([ein(tag(0), "08:00", ende)], puffer=puffer, vertraege=v)  # + 3:00 bzw. 3:15 h
    assert bool(regel(k, "VERTRAG_MINIJOB")) is verstoss


def test_minijob_parameter_fallback():
    v = [vertrag(art="minijob", soll_std_woche=10, max_std_monat=None)]
    puffer = [ein(date(2026, 11, d), "08:00", "13:00") for d in (2, 3, 4, 5, 16, 17, 18, 19)]
    k = kontext([ein(tag(0), "08:00", "11:00")], puffer=puffer, vertraege=v, parameter={"minijob_max_std_monat": 42})
    assert regel(k, "VERTRAG_MINIJOB")


@pytest.mark.parametrize("letzter,weich", [
    (("06:00", "14:30", 30), False),  # 40 h
    (("06:00", "10:00", 0), False),   # 36 h = genau −10 %
    (("06:00", "09:45", 0), True),    # 35,75 h
    (("06:00", "15:00", 30), False),  # 40,5 h
    (("06:00", "19:00", 45), True),   # 44,25 h > +10 %
])
def test_soll(letzter, weich):
    e = [ein(tag(i), "06:00", "14:30", 30) for i in range(4)] + [ein(tag(4), *letzter)]
    v = regel(kontext(e), "VERTRAG_SOLL")
    assert bool(v) is weich and all(x.schwere == "weich" for x in v)


def test_soll_nur_vollstaendige_wochen_und_abwesenheit():
    e = [ein(tag(0), "06:00", "10:00")]
    assert not regel(kontext(e, bis=tag(4)), "VERTRAG_SOLL")  # Woche nicht vollständig im Plan
    urlaub = [Abwesenheit(mitarbeiter_id=1, von=tag(0), bis=tag(3), typ="urlaub", status="genehmigt")]
    # 6 mögliche Tage, max. 6 → Soll 40 × 2/6 = 13,33 h
    v = [vertrag(max_tage_woche=5)]  # 5 Tage → Soll 40 × 1/5 = 8 h
    k = kontext([ein(tag(4), "06:00", "14:30", 30)], vertraege=v, abwesenheiten=urlaub)
    assert not regel(k, "VERTRAG_SOLL")


# ---------------------------------------------------------------- Abwesenheit, Skill, Zertifikat, Fairness
@pytest.mark.parametrize("status,schwere", [("genehmigt", "hart"), ("beantragt", "weich"), ("abgelehnt", None)])
def test_abwesenheit(status, schwere):
    a = [Abwesenheit(mitarbeiter_id=1, von=tag(0), bis=tag(2), typ="urlaub", status=status)]
    v = regel(kontext([ein(tag(1), "08:00", "12:00")], abwesenheiten=a), "ABWESENHEIT")
    assert [x.schwere for x in v] == ([schwere] if schwere else [])
    assert not regel(kontext([ein(tag(3), "08:00", "12:00")], abwesenheiten=a), "ABWESENHEIT")


def test_skill():
    assert not regel(kontext([ein(tag(0), "08:00", "12:00", abt=TRO)]), "SKILL")
    v = regel(kontext([ein(tag(0), "08:00", "12:00", abt=TK)]), "SKILL")
    assert v and "Tiefkühl" in v[0].meldung and v[0].schwere == "hart"


@pytest.mark.parametrize("abt,gueltig_bis,verstoss", [
    (GET, date(2026, 11, 1), True),    # Getränke, Ameise abgelaufen
    (GET, date(2026, 11, 9), False),   # gilt noch am Einsatztag
    (TRO, date(2026, 11, 1), False),   # für Trocken nicht relevant
])
def test_zertifikat(abt, gueltig_bis, verstoss):
    skills = [MitarbeiterSkill(mitarbeiter_id=1, skill_id=1), MitarbeiterSkill(mitarbeiter_id=1, skill_id=2),
              MitarbeiterSkill(mitarbeiter_id=1, skill_id=3, zertifikat_bis=gueltig_bis)]
    v = regel(kontext([ein(tag(0), "08:00", "12:00", abt=abt)], skills=skills), "ZERTIFIKAT")
    assert bool(v) is verstoss and all(x.schwere == "weich" for x in v)


def test_fairness_samstag():
    leute = [ma(i) for i in (1, 2, 3, 4)]
    von, bis = MO, MO + timedelta(weeks=4) - timedelta(days=2)
    e = [ein(MO + timedelta(weeks=w, days=5), "08:00", "12:00", mid=1) for w in range(4)]
    e += [ein(MO + timedelta(weeks=w), "08:00", "12:00", mid=m) for w in range(4) for m in (2, 3, 4)]
    k = kontext(e, mitarbeiter=leute, von=von, bis=bis)
    v = regel(k, "FAIRNESS_SAMSTAG", 1)
    assert v and v[0].schwere == "weich" and "4 Samstage" in v[0].meldung
    assert not regel(k, "FAIRNESS_SAMSTAG", 2)


# ---------------------------------------------------------------- Gesamtprüfung
def test_pruefe_und_katalog():
    codes = {r["code"] for r in REGELKATALOG}
    assert codes == set(REGELN) and len(codes) == 17
    assert all(r["schwere"] in ("hart", "weich") and r["name"] and r["quelle"] for r in REGELKATALOG)
    sauber = kontext([ein(tag(i), "06:00", "14:30", 30) for i in range(5)])
    assert pruefe(sauber) == []
    k = kontext([ein(tag(0), "13:00", "21:45", 30), ein(tag(1), "06:00", "13:00"), ein(tag(6), "08:00", "10:00")])
    v = pruefe(k)
    assert {"ARBZG_5_RUHEZEIT", "ARBZG_4_PAUSE", "ARBZG_9_SONNTAG"} <= {x.regel for x in v}
    assert v == sorted(v, key=lambda x: x.datum)
    d = v[0].als_dict()
    assert set(d) == {"regel", "schwere", "mitarbeiter_id", "datum", "einsatz_ids", "meldung"}
    assert isinstance(d["datum"], str)
    assert pruefe(k, {99}) == []


def test_ungespeicherte_einsaetze_ohne_id():
    e = Einsatz(plan_id=1, mitarbeiter_id=1, abteilung_id=TK, datum=tag(0), beginn="08:00", ende="12:00")
    v = pruefe(kontext([e], bis=tag(4)))
    assert [x.regel for x in v] == ["SKILL"] and v[0].einsatz_ids == []
