"""Kalender: gesetzliche Feiertage Baden-Württemberg, Werktage, Hotday-Vorschläge."""
from datetime import date, timedelta
from functools import lru_cache

import holidays
from dateutil.easter import easter

BUNDESLAND = "BW"


@lru_cache(maxsize=32)
def feiertage(jahr: int, bundesland: str = BUNDESLAND) -> dict[date, str]:
    return dict(sorted(holidays.Germany(years=jahr, subdiv=bundesland, language="de").items()))


def ist_feiertag(tag: date) -> bool:
    return tag in feiertage(tag.year)


def ist_werktag(tag: date) -> bool:
    """Öffnungstag der Filiale: Mo–Sa und kein Feiertag."""
    return tag.weekday() < 6 and not ist_feiertag(tag)


def werktage(von: date, bis: date) -> list[date]:
    tage, t = [], von
    while t <= bis:
        if ist_werktag(t):
            tage.append(t)
        t += timedelta(days=1)
    return tage


def montag(tag: date) -> date:
    return tag - timedelta(days=tag.weekday())


def hotday_vorschlaege(jahr: int) -> list[dict]:
    """Automatische Hotdays: Vortag/Folgetag von Feiertagen, Brückentage,
    Woche vor Ostern und die Wochen vor Weihnachten.
    Rückgabe: Liste von {datum, name, lastfaktor, urlaubssperre}."""
    vorschlaege: dict[date, dict] = {}

    def add(tag: date, name: str, faktor: float, sperre: bool = False) -> None:
        if tag.year != jahr or not ist_werktag(tag):
            return
        alt = vorschlaege.get(tag)
        if alt is None or faktor > alt["lastfaktor"]:
            vorschlaege[tag] = {"datum": tag, "name": name, "lastfaktor": faktor,
                                "urlaubssperre": sperre or (alt or {}).get("urlaubssperre", False)}
        elif sperre:
            alt["urlaubssperre"] = True

    ft = {**feiertage(jahr - 1), **feiertage(jahr), **feiertage(jahr + 1)}
    for tag, name in ft.items():
        # letzter Öffnungstag davor
        vor = tag - timedelta(days=1)
        while not ist_werktag(vor) and (tag - vor).days < 4:
            vor -= timedelta(days=1)
        add(vor, f"Vor {name}", 1.5)
        # erster Öffnungstag danach (Nachholeffekt)
        nach = tag + timedelta(days=1)
        while not ist_werktag(nach) and (nach - tag).days < 4:
            nach += timedelta(days=1)
        add(nach, f"Nach {name}", 1.3)
        # Brückentage: Feiertag am Di → Mo, am Do → Fr
        if tag.weekday() == 1:
            add(tag - timedelta(days=1), f"Brückentag ({name})", 1.4)
        if tag.weekday() == 3:
            add(tag + timedelta(days=1), f"Brückentag ({name})", 1.4)

    ostern = easter(jahr)
    for i in range(3, 7):  # Mo–Do der Karwoche (Karfreitag ist Feiertag, Mo vor Ostersonntag -6)
        add(ostern - timedelta(days=i), "Osterwoche", 1.3, sperre=True)

    heiligabend = date(jahr, 12, 24)
    t = heiligabend - timedelta(days=13)
    while t <= heiligabend:
        faktor = 1.6 if (heiligabend - t).days <= 4 else 1.35
        add(t, "Weihnachtsgeschäft", faktor, sperre=True)
        t += timedelta(days=1)
    add(date(jahr, 12, 31), "Silvester", 1.4, sperre=True)
    return sorted(vorschlaege.values(), key=lambda v: v["datum"])
