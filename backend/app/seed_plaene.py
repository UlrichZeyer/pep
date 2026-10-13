"""Mock-Pläne (4 freigegebene Vorwochen + aktuelle Entwurfswoche) – Cluster A füllt diese Datei."""
import random
from datetime import date

from sqlmodel import Session


def generate(session: Session, rng: random.Random, heute: date) -> None:
    """Erzeugt Plan- und Einsatz-Datensätze."""
    return None
