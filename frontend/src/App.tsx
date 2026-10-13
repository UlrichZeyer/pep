import { useState } from 'react'
import { NavLink, Route, Routes } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { Button, Eichhoernchen, Hinweis, cx } from './components/ui'
import Dashboard from './pages/Dashboard'
import MitarbeiterListe from './pages/MitarbeiterListe'
import MitarbeiterDetail from './pages/MitarbeiterDetail'
import SkillMatrix from './pages/SkillMatrix'
import Abwesenheiten from './pages/Abwesenheiten'
import Kalender from './pages/Kalender'
import Stammdaten from './pages/Stammdaten'
import Planung from './pages/planung/Planung'
import Kpis from './pages/Kpis'

const NAVIGATION: { gruppe: string; eintraege: { pfad: string; label: string; ende?: boolean }[] }[] = [
  { gruppe: 'Überblick', eintraege: [{ pfad: '/', label: 'Übersicht', ende: true }, { pfad: '/kpis', label: 'KPIs & Bedarf' }] },
  { gruppe: 'Planung', eintraege: [{ pfad: '/planung', label: 'Einsatzplanung' }, { pfad: '/abwesenheiten', label: 'Abwesenheiten' }, { pfad: '/kalender', label: 'Kalender' }] },
  { gruppe: 'Personal', eintraege: [{ pfad: '/mitarbeiter', label: 'Mitarbeiter' }, { pfad: '/skills', label: 'Skill-Matrix' }] },
  { gruppe: 'Betrieb', eintraege: [{ pfad: '/stammdaten', label: 'Stammdaten & Regeln' }] },
]

export default function App() {
  const qc = useQueryClient()
  const [meldung, setMeldung] = useState<string | null>(null)
  const reset = useMutation({
    mutationFn: api.demodaten,
    onSuccess: (r) => {
      qc.invalidateQueries()
      setMeldung(`Demodaten neu erzeugt: ${r.mitarbeiter} Mitarbeiter, ${r.wareneingaenge} Wareneingänge, ${r.plaene} Pläne.`)
    },
    onError: (e) => setMeldung(`Fehler: ${(e as Error).message}`),
  })

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-white border-b border-sand sticky top-0 z-30">
        <div className="flex items-center gap-3 px-5 h-16">
          <Eichhoernchen className="w-10 h-10" />
          <div className="leading-tight">
            <div className="text-xl font-extrabold tracking-tight text-rinde">PEP<span className="text-fell">.</span></div>
            <div className="text-xs text-stein">Personaleinsatzplanung · vorausschauend wie ein Eichhörnchen</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden md:inline text-xs text-stein">Filiale Musterstadt · Baden-Württemberg</span>
            <Button klein variante="sekundaer" icon="eichel" disabled={reset.isPending}
              onClick={() => confirm('Alle Daten verwerfen und Demodaten neu erzeugen?') && reset.mutate()}>
              {reset.isPending ? 'Erzeuge …' : 'Demodaten zurücksetzen'}
            </Button>
          </div>
        </div>
        <div className="h-1 bg-gradient-to-r from-fell via-eichel to-moos" />
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-56 shrink-0 bg-white border-r border-sand py-4 hidden md:block" aria-label="Hauptnavigation">
          {NAVIGATION.map((g) => (
            <div key={g.gruppe} className="mb-4">
              <div className="px-5 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-stein">{g.gruppe}</div>
              {g.eintraege.map((e) => (
                <NavLink key={e.pfad} to={e.pfad} end={e.ende}
                  className={({ isActive }) => cx('block px-5 py-2 text-sm font-semibold border-l-4 transition-colors',
                    isActive ? 'border-fell bg-fell-hell text-fell-dunkel' : 'border-transparent text-rinde hover:bg-creme hover:text-fell-dunkel')}>
                  {e.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="flex-1 min-w-0 p-6">
          {meldung && <div className="mb-4"><Hinweis ton="ok" onSchliessen={() => setMeldung(null)}>{meldung}</Hinweis></div>}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/mitarbeiter" element={<MitarbeiterListe />} />
            <Route path="/mitarbeiter/:id" element={<MitarbeiterDetail />} />
            <Route path="/skills" element={<SkillMatrix />} />
            <Route path="/abwesenheiten" element={<Abwesenheiten />} />
            <Route path="/kalender" element={<Kalender />} />
            <Route path="/stammdaten" element={<Stammdaten />} />
            <Route path="/planung/*" element={<Planung />} />
            <Route path="/kpis" element={<Kpis />} />
            <Route path="*" element={<div className="text-stein">Seite nicht gefunden.</div>} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
