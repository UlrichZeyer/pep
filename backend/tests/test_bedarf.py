"""Tests Prognose & Bedarfsermittlung."""
import time
from datetime import date

from sqlmodel import select

from app import bedarf
from app.models import Abteilung, Kalendereintrag, Kundenfrequenz

WOCHE = (date(2026, 10, 19), date(2026, 10, 25))  # Mo–So


def _abt(session, kuerzel):
    return session.exec(select(Abteilung).where(Abteilung.kuerzel == kuerzel)).one()


def _tag(b, iso):
    return next(t for t in b["tage"] if t["datum"] == iso)


def _koepfe(tag, abt_id):
    a = next(a for a in tag["abteilungen"] if a["abteilung_id"] == abt_id)
    return {s["beginn"]: s["koepfe"] for s in a["slots"]}, a


def test_frequenz_mockdaten(session):
    zeilen = session.exec(select(Kundenfrequenz)).all()
    assert len(zeilen) > 3000
    assert {z.stunde for z in zeilen} == set(range(7, 21))
    assert all(z.datum.weekday() < 6 for z in zeilen)
    werte = [z.kunden for z in zeilen]
    assert 40 <= min(werte) and max(werte) <= 450


def test_sonntag_und_feiertag_geschlossen(session):
    b = bedarf.bedarf(session, date(2026, 12, 24), date(2026, 12, 27))
    for iso in ("2026-12-25", "2026-12-26", "2026-12-27"):
        t = _tag(b, iso)
        assert t["geschlossen"]
        assert all(a["stunden"] == 0 and all(s["koepfe"] == 0 for s in a["slots"]) for a in t["abteilungen"])
    assert not _tag(b, "2026-12-24")["geschlossen"]
    p = bedarf.prognose(session, date(2026, 10, 25), date(2026, 10, 25))
    assert p["tage"][0]["geschlossen"] and p["tage"][0]["gesamt"] == 0


def test_schliesstag(session):
    tag = date(2026, 11, 18)  # Mittwoch
    e = Kalendereintrag(datum=tag, typ="schliesstag", name="Umbau", quelle="manuell")
    session.add(e)
    session.commit()
    try:
        t = bedarf.bedarf(session, tag, tag)["tage"][0]
        assert t["geschlossen"] and sum(a["stunden"] for a in t["abteilungen"]) == 0
    finally:
        session.delete(e)
        session.commit()


def test_hotday_erhoeht_bedarf(session):
    # Aktionswoche (Mock-Hotday, Faktor 1,25) ab 02.11.2026 vs. normale Woche davor
    normal = bedarf.bedarf(session, date(2026, 10, 27), date(2026, 10, 27))["tage"][0]
    hot = bedarf.bedarf(session, date(2026, 11, 3), date(2026, 11, 3))["tage"][0]
    assert hot["hotday"] and hot["lastfaktor"] > 1.0 and normal["lastfaktor"] == 1.0
    summe = lambda t, f: sum(a[f] for a in t["abteilungen"])  # noqa: E731
    assert summe(hot, "paletten") > summe(normal, "paletten")
    assert summe(hot, "stunden") > summe(normal, "stunden")
    kasse = _abt(session, "KAS").id
    assert _koepfe(hot, kasse)[1]["stunden"] >= _koepfe(normal, kasse)[1]["stunden"]


def test_mindestbesetzung(session):
    b = bedarf.bedarf(session, *WOCHE)
    t = _tag(b, "2026-10-21")
    for abt in session.exec(select(Abteilung)).all():
        koepfe, _ = _koepfe(t, abt.id)
        if abt.bedarfsart == "paletten" and abt.mindestbesetzung > 0:
            assert all(koepfe[z] >= abt.mindestbesetzung for z in ("07:00", "12:00", "18:00", "20:30"))
        if abt.bedarfsart == "fix":
            assert koepfe["05:30"] == 0 and koepfe["06:00"] == abt.mindestbesetzung
            assert koepfe["19:30"] == abt.mindestbesetzung and koepfe["20:00"] == 0
    kasse = _abt(session, "KAS")
    koepfe, _ = _koepfe(t, kasse.id)
    assert koepfe["06:00"] == 0 and koepfe["06:30"] == 1 and koepfe["21:00"] == 1 and koepfe["21:30"] == 0
    assert all(koepfe[z] >= kasse.mindestbesetzung for z in ("07:00", "13:30", "20:30"))


def test_verraeumen_morgens(session):
    t = _tag(bedarf.bedarf(session, *WOCHE), "2026-10-19")
    koepfe, a = _koepfe(t, _abt(session, "TRO").id)
    morgens = sum(v for k, v in koepfe.items() if k < "11:00")
    nachmittags = sum(v for k, v in koepfe.items() if k >= "14:00")
    assert koepfe["05:00"] >= 1 and morgens > nachmittags / 2
    assert a["paletten"] > 0


def test_kasse_mittags_mehr_als_morgens(session):
    t = _tag(bedarf.bedarf(session, *WOCHE), "2026-10-22")
    koepfe, _ = _koepfe(t, _abt(session, "KAS").id)
    assert koepfe["12:00"] > koepfe["07:00"]
    assert koepfe["17:30"] > koepfe["07:00"]


def test_stunden_gleich_koepfe_mal_halbe_stunde(session):
    b = bedarf.bedarf(session, *WOCHE)
    assert b["slot_min"] == 30
    for t in b["tage"]:
        for a in t["abteilungen"]:
            assert len(a["slots"]) == 34
            assert a["stunden"] == sum(s["koepfe"] for s in a["slots"]) * 0.5


def test_bedarf_matrix(session):
    m = bedarf.bedarf_matrix(session, *WOCHE)
    abts = session.exec(select(Abteilung)).all()
    assert len(m) == 7 * len(abts)
    assert all(len(v) == 34 and all(isinstance(k, int) for k in v) for v in m.values())
    b = bedarf.bedarf(session, *WOCHE)
    for t in b["tage"]:
        for a in t["abteilungen"]:
            assert m[(date.fromisoformat(t["datum"]), a["abteilung_id"])] == [s["koepfe"] for s in a["slots"]]


def test_prognose_plausibel(session):
    p = bedarf.prognose(session, *WOCHE)
    assert len(p["tage"]) == 7
    mo = p["tage"][0]
    assert mo["gesamt"] > 0 and abs(sum(mo["je_warengruppe"].values()) - mo["gesamt"]) < 0.5
    # Samstag: geringste Anlieferung
    assert p["tage"][5]["gesamt"] < mo["gesamt"]


def test_performance_woche(session):
    t0 = time.perf_counter()
    bedarf.bedarf(session, *WOCHE)
    assert time.perf_counter() - t0 < 1.0
