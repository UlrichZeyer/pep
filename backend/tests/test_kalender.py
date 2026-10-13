from datetime import date

from app.kalender import feiertage, hotday_vorschlaege, ist_werktag


def test_feiertage_bw_2026():
    ft = feiertage(2026)
    assert len(ft) == 12
    for d in [date(2026, 1, 6), date(2026, 6, 4), date(2026, 11, 1), date(2026, 4, 3)]:
        assert d in ft
    assert date(2026, 10, 31) not in ft  # Reformationstag nicht in BW


def test_werktage():
    assert ist_werktag(date(2026, 10, 13))  # Dienstag
    assert ist_werktag(date(2026, 10, 17))  # Samstag
    assert not ist_werktag(date(2026, 10, 18))  # Sonntag
    assert not ist_werktag(date(2026, 10, 3))  # Tag der Deutschen Einheit


def test_hotdays():
    v = {h["datum"]: h for h in hotday_vorschlaege(2026)}
    assert date(2026, 1, 2) in v  # Brückentag nach Neujahr (Do → Fr)
    assert v[date(2026, 12, 23)]["urlaubssperre"]
    assert v[date(2026, 12, 23)]["lastfaktor"] >= 1.5
    assert all(ist_werktag(d) for d in v)
