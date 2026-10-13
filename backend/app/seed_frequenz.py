"""Mock-Kundenfrequenz (Kunden pro Stunde, 07–21 Uhr) für die letzten 12 Monate."""
import random
from datetime import date, timedelta

from sqlalchemy import delete, insert
from sqlmodel import Session, select

from app.kalender import ist_werktag
from app.models import Kalendereintrag, Kundenfrequenz

# Tagesprofil (Kunden/h, Basis Dienstag–Donnerstag): Mittags- und Feierabendspitze
STUNDENPROFIL = {
    7: 62, 8: 78, 9: 92, 10: 102, 11: 120, 12: 148, 13: 132,
    14: 104, 15: 106, 16: 128, 17: 160, 18: 168, 19: 128, 20: 84,
}
# Wochentagsfaktor Mo … Sa (Montag/Freitag erhöht, Samstag stark)
WOCHENTAG = [1.10, 0.95, 0.95, 1.0, 1.15, 1.25]
# Samstag: Spitze verschiebt sich in den Vormittag/Mittag
SAMSTAG_STUNDE = {7: 0.9, 8: 1.05, 9: 1.15, 10: 1.2, 11: 1.15, 12: 1.05, 13: 1.0,
                  14: 0.95, 15: 0.95, 16: 0.9, 17: 0.85, 18: 0.8, 19: 0.8, 20: 0.8}


def generate(session: Session, rng: random.Random, heute: date) -> None:
    """Erzeugt Kundenfrequenz-Datensätze (Tabelle Kundenfrequenz, quelle='mock') per Bulk-Insert."""
    hot: dict[date, float] = {}
    for d, f in session.exec(select(Kalendereintrag.datum, Kalendereintrag.lastfaktor)
                             .where(Kalendereintrag.typ == "hotday")).all():
        hot[d] = max(hot.get(d, 1.0), f)
    session.exec(delete(Kundenfrequenz).where(Kundenfrequenz.quelle == "mock"))  # type: ignore[call-overload]
    zeilen: list[dict] = []
    t = heute - timedelta(days=365)
    while t <= heute:
        if ist_werktag(t):
            wt = t.weekday()
            tagesfaktor = WOCHENTAG[wt] * hot.get(t, 1.0)
            if t.month == 12:
                tagesfaktor *= 1.1
            for stunde, basis in STUNDENPROFIL.items():
                f = tagesfaktor * (SAMSTAG_STUNDE[stunde] if wt == 5 else 1.0)
                kunden = basis * f * rng.uniform(0.9, 1.1)
                zeilen.append({"datum": t, "stunde": stunde, "kunden": max(0, round(kunden)),
                               "quelle": "mock"})
        t += timedelta(days=1)
    if zeilen:
        session.execute(insert(Kundenfrequenz), zeilen)
