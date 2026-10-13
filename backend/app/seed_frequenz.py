"""Mock-Kundenfrequenz (Kunden pro Stunde) – Cluster B füllt diese Datei."""
import random
from datetime import date

from sqlmodel import Session


def generate(session: Session, rng: random.Random, heute: date) -> None:
    """Erzeugt Kundenfrequenz-Datensätze (Tabelle Kundenfrequenz, quelle='mock')."""
    return None
