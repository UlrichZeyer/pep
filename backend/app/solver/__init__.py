"""Auto-Planung mit OR-Tools CP-SAT (TECHNISCHES_KONZEPT.md, Kap. 9).

- `modell`: Kandidaten, CP-SAT-Modell, Greedy-Startlösung (ohne Datenbank)
- `bericht`: Unter-/Überdeckungen mit Ursachen
- `lauf`: `auto_planen(session, plan_id, modus, gewichte, zeitlimit_s)` – lösen, speichern, gegenprüfen
"""
from app.solver.lauf import MODI, AutoPlanFehler, Fortschritt, auto_planen, gewichte_pruefen, plan_pruefen_fuer_lauf
from app.solver.modell import GEWICHTE_STANDARD

__all__ = ["auto_planen", "AutoPlanFehler", "Fortschritt", "GEWICHTE_STANDARD", "MODI", "gewichte_pruefen",
           "plan_pruefen_fuer_lauf"]
