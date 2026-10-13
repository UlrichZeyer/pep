// Gemeinsame Query-Hooks (TanStack Query). Schlüssel-Konvention: ['stammdaten'], ['mitarbeiter'], …
import { useQuery } from '@tanstack/react-query'
import { api, type Abteilung, type Mitarbeiter, type Skill, type Warengruppe } from './api'

export function useStammdaten() {
  const q = useQuery({ queryKey: ['stammdaten'], queryFn: api.stammdaten, staleTime: 5 * 60_000 })
  const abteilungen = q.data?.abteilungen ?? []
  const skills = q.data?.skills ?? []
  const warengruppen = q.data?.warengruppen ?? []
  return {
    ...q,
    abteilungen,
    skills,
    warengruppen,
    abteilungNach: Object.fromEntries(abteilungen.map((a) => [a.id, a])) as Record<number, Abteilung>,
    skillNach: Object.fromEntries(skills.map((s) => [s.id, s])) as Record<number, Skill>,
    warengruppeNach: Object.fromEntries(warengruppen.map((w) => [w.id, w])) as Record<number, Warengruppe>,
  }
}

export function useMitarbeiter() {
  const q = useQuery({ queryKey: ['mitarbeiter'], queryFn: () => api.mitarbeiter() })
  const liste = q.data ?? []
  return { ...q, liste, nach: Object.fromEntries(liste.map((m) => [m.id, m])) as Record<number, Mitarbeiter> }
}
