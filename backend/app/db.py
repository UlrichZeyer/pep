"""Datenbankverbindung (SQLite). Pfad über Umgebungsvariable PEP_DB überschreibbar."""
import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

_STANDARD = Path(__file__).resolve().parent.parent / "data" / "pep.db"
DB_PFAD = Path(os.environ.get("PEP_DB", _STANDARD))
DB_PFAD.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PFAD}", connect_args={"check_same_thread": False})


def init_db() -> None:
    from app import models  # noqa: F401  (registriert die Tabellen)

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
