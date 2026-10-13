// Auto-Planung (Cluster G). Vertrag: wird von der Einsatzplanung (Cluster E) eingebunden.
export interface AutoPlanDialogProps {
  planId: number
  offen: boolean
  onSchliessen: () => void
  /** Nach erfolgreichem Lauf: Planung lädt Einsätze & Validierung neu. */
  onFertig: () => void
}

export default function AutoPlanDialog(_props: AutoPlanDialogProps) {
  return null
}
