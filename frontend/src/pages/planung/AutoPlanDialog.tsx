// Auto-Planung (Cluster G). Vertrag: wird von der Einsatzplanung (Cluster E) eingebunden.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  api, type AutoPlanModus, type SolverBerichtZeile, type SolverErgebnis, type SolverGewichte, type Verstoss,
} from '../../api'
import {
  AbteilungsPunkt, Badge, Button, Fehler, Field, Hinweis, Icon, Laden, Leer, Modal, StatKachel, StatusBadge, Tabs,
  cx, fmtProzent, fmtStd, fmtTag, fmtZahl,
} from '../../components/ui'
import { useMitarbeiter, useStammdaten } from '../../hooks'

export interface AutoPlanDialogProps {
  planId: number
  offen: boolean
  onSchliessen: () => void
  /** Nach erfolgreichem Lauf: Planung lädt Einsätze & Validierung neu. */
  onFertig: () => void
}

const MODI: { wert: AutoPlanModus; label: string; text: string }[] = [
  { wert: 'neu', label: 'Ganze Woche neu',
    text: 'Plant den gesamten Zeitraum neu. Gesperrte Einsätze bleiben erhalten, alle übrigen werden ersetzt.' },
  { wert: 'luecken', label: 'Nur Lücken füllen',
    text: 'Alle bestehenden Einsätze bleiben unverändert. Der Solver ergänzt nur dort, wo der Bedarf noch nicht gedeckt ist.' },
  { wert: 'umplanen', label: 'Umplanen nach Krankmeldung',
    text: 'Entfernt (nicht gesperrte) Einsätze von inzwischen abwesenden Mitarbeitern und Einsätze mit harten Regelverstößen und schließt die entstandenen Lücken.' },
]

const GEWICHTE: { schluessel: keyof SolverGewichte; label: string; hinweis: string; max: number; schritt: number }[] = [
  { schluessel: 'unterdeckung', label: 'Unterdeckung', hinweis: 'je fehlende Personenstunde', max: 300, schritt: 5 },
  { schluessel: 'soll_abweichung', label: 'Abweichung Soll-Stunden', hinweis: 'je Stunde über/unter Vertrag', max: 50, schritt: 1 },
  { schluessel: 'ueberdeckung', label: 'Überdeckung (Leerlauf)', hinweis: 'je überzählige Personenstunde', max: 30, schritt: 0.5 },
  { schluessel: 'fremdabteilung', label: 'Einsatz außerhalb der Stammabteilung', hinweis: 'je Stunde', max: 20, schritt: 0.5 },
  { schluessel: 'fairness', label: 'Fairness Samstage', hinweis: 'je Samstag der letzten 4 Wochen', max: 30, schritt: 1 },
  { schluessel: 'skill_level', label: 'Skill-Level (Einarbeitung vermeiden)', hinweis: 'je Stunde Level 1, doppelt bei Engpass-Ware', max: 10, schritt: 0.5 },
]

const ZEITLIMITS = [10, 20, 30, 60]
const INVALIDIEREN = new Set(['einsaetze', 'validierung', 'plaene', 'kpi'])

export default function AutoPlanDialog({ planId, offen, onSchliessen, onFertig }: AutoPlanDialogProps) {
  const qc = useQueryClient()
  const [modus, setModus] = useState<AutoPlanModus>('luecken')
  const [gewichte, setGewichte] = useState<SolverGewichte | null>(null)
  const [zeitlimit, setZeitlimit] = useState(20)
  const [jobId, setJobId] = useState<string | null>(null)
  const invalidiert = useRef<string | null>(null)

  const standard = useQuery({ queryKey: ['solver-gewichte'], queryFn: api.solverGewichte, staleTime: Infinity, enabled: offen })
  useEffect(() => {
    if (standard.data && !gewichte) setGewichte(standard.data)
  }, [standard.data, gewichte])

  const start = useMutation({
    mutationFn: () => api.autoPlanen(planId, { modus, gewichte: gewichte ?? undefined, zeitlimit_s: zeitlimit }),
    onSuccess: (job) => setJobId(job.job_id),
  })
  const job = useQuery({
    queryKey: ['solver-job', jobId],
    queryFn: () => api.solverJob(jobId!),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'laeuft' ? false : 700),
  })
  const status = job.data?.status

  // Nach Erfolg: Planungsdaten neu laden (einmal je Job)
  useEffect(() => {
    if (status === 'fertig' && jobId && invalidiert.current !== jobId) {
      invalidiert.current = jobId
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && INVALIDIEREN.has(q.queryKey[0]) })
    }
  }, [status, jobId, qc])

  // Beim Schließen zurücksetzen (Einstellungen bleiben erhalten)
  useEffect(() => {
    if (!offen) {
      setJobId(null)
      start.reset()
    }
  }, [offen])

  const laeuft = start.isPending || status === 'laeuft'
  const ergebnis = status === 'fertig' ? job.data?.ergebnis ?? null : null
  const phase: 'einstellungen' | 'laeuft' | 'ergebnis' | 'fehler' =
    ergebnis ? 'ergebnis' : status === 'fehler' ? 'fehler' : laeuft || jobId ? 'laeuft' : 'einstellungen'

  const schliessen = () => {
    if (status === 'fertig') onFertig()
    onSchliessen()
  }

  const fuss = (() => {
    if (phase === 'einstellungen') {
      return (
        <>
          <Button variante="leise" onClick={onSchliessen}>Abbrechen</Button>
          <Button variante="primaer" icon="zauber" disabled={!gewichte || start.isPending} onClick={() => start.mutate()}>
            Vorschlag erzeugen
          </Button>
        </>
      )
    }
    if (phase === 'laeuft') return <Button variante="leise" onClick={onSchliessen}>Im Hintergrund weiterrechnen</Button>
    if (phase === 'fehler') {
      return (
        <>
          <Button variante="leise" onClick={onSchliessen}>Schließen</Button>
          <Button onClick={() => { setJobId(null); start.reset() }}>Zurück zu den Einstellungen</Button>
        </>
      )
    }
    return (
      <>
        <Button variante="leise" onClick={() => { setJobId(null); start.reset() }}>Neuer Lauf</Button>
        <Button variante="primaer" icon="ok" onClick={() => { onFertig(); onSchliessen() }}>Übernehmen &amp; schließen</Button>
      </>
    )
  })()

  return (
    <Modal offen={offen} titel="Automatische Planung" onSchliessen={schliessen} fuss={fuss} breit>
      {phase === 'einstellungen' && (
        <Einstellungen modus={modus} setModus={setModus} gewichte={gewichte} setGewichte={setGewichte}
          standard={standard.data ?? null} ladenFehler={standard.error} zeitlimit={zeitlimit} setZeitlimit={setZeitlimit}
          startFehler={start.error} />
      )}
      {phase === 'laeuft' && (
        <Fortschritt anteil={job.data?.fortschritt ?? 0} meldung={job.data?.meldung ?? 'Auto-Planung wird gestartet …'}
          zeitlimit={zeitlimit} fehler={job.error} />
      )}
      {phase === 'fehler' && <Hinweis ton="verstoss" titel="Auto-Planung fehlgeschlagen">{job.data?.meldung}</Hinweis>}
      {phase === 'ergebnis' && ergebnis && <Ergebnis e={ergebnis} />}
    </Modal>
  )
}

// ------------------------------------------------------------------ Einstellungen
function Einstellungen({ modus, setModus, gewichte, setGewichte, standard, ladenFehler, zeitlimit, setZeitlimit, startFehler }: {
  modus: AutoPlanModus; setModus: (m: AutoPlanModus) => void
  gewichte: SolverGewichte | null; setGewichte: (g: SolverGewichte) => void; standard: SolverGewichte | null
  ladenFehler: unknown; zeitlimit: number; setZeitlimit: (z: number) => void; startFehler: unknown
}) {
  const geaendert = !!gewichte && !!standard && GEWICHTE.some((g) => gewichte[g.schluessel] !== standard[g.schluessel])
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-stein mb-2">Modus</h3>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Modus">
          {MODI.map((m) => (
            <button key={m.wert} type="button" role="radio" aria-checked={modus === m.wert} onClick={() => setModus(m.wert)}
              className={cx('text-left rounded-lg border px-3 py-2.5 transition-colors',
                modus === m.wert ? 'border-fell bg-fell-hell' : 'border-sand bg-white hover:border-fell/60')}>
              <div className="flex items-center gap-1.5 font-bold text-sm text-rinde">
                <span className={cx('w-3.5 h-3.5 rounded-full border-2 shrink-0', modus === m.wert ? 'border-fell bg-fell' : 'border-sand')} />
                {m.label}
              </div>
              <p className="text-xs text-stein mt-1 leading-snug">{m.text}</p>
            </button>
          ))}
        </div>
        {modus === 'neu' && (
          <div className="mt-3">
            <Hinweis ton="warn" titel="Bestehende Einsätze werden ersetzt">
              Alle nicht gesperrten Einsätze dieses Plans werden gelöscht und neu geplant. Einsätze, die erhalten bleiben
              sollen, vorher sperren (<Icon name="schloss" className="w-3.5 h-3.5 -mt-0.5" />).
            </Hinweis>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-stein">Gewichte der Zielfunktion</h3>
          <Button variante="leise" klein disabled={!geaendert} onClick={() => standard && setGewichte(standard)}>zurücksetzen</Button>
        </div>
        {ladenFehler ? <Fehler fehler={ladenFehler} /> : !gewichte ? <Laden /> : (
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {GEWICHTE.map((g) => (
              <Field key={g.schluessel} label={g.label} hinweis={g.hinweis}>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={g.max} step={g.schritt} value={gewichte[g.schluessel]}
                    aria-label={g.label} className="flex-1 accent-[var(--color-fell)]"
                    onChange={(ev) => setGewichte({ ...gewichte, [g.schluessel]: Number(ev.target.value) })} />
                  <span className={cx('w-12 text-right tabular-nums text-sm font-bold',
                    standard && gewichte[g.schluessel] !== standard[g.schluessel] ? 'text-fell-dunkel' : 'text-rinde')}>
                    {fmtZahl(gewichte[g.schluessel], Number.isInteger(gewichte[g.schluessel]) ? 0 : 1)}
                  </span>
                </div>
              </Field>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-wrap items-end gap-4">
        <Field label="Zeitlimit" hinweis="Danach wird das beste gefundene Ergebnis übernommen.">
          <Tabs werte={ZEITLIMITS.map((z) => ({ wert: String(z), label: `${z} s` }))} aktiv={String(zeitlimit)}
            onChange={(w) => setZeitlimit(Number(w))} />
        </Field>
      </section>

      {!!startFehler && <Fehler fehler={startFehler} />}
    </div>
  )
}

// ------------------------------------------------------------------ Fortschritt
function Fortschritt({ anteil, meldung, zeitlimit, fehler }: { anteil: number; meldung: string; zeitlimit: number; fehler: unknown }) {
  return (
    <div className="py-6 space-y-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <Icon name="zauber" className="w-6 h-6 text-fell animate-pulse" />
        <div>
          <div className="font-bold text-rinde">Der Solver rechnet …</div>
          <div className="text-sm text-stein">{meldung}</div>
        </div>
        <div className="ml-auto text-2xl font-extrabold tabular-nums text-rinde">{fmtProzent(anteil)}</div>
      </div>
      <div className="h-3 rounded-full bg-sand overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(anteil * 100)}>
        <div className="h-full bg-fell rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(3, anteil * 100)}%` }} />
      </div>
      <p className="text-xs text-stein">
        Höchstens ca. {zeitlimit} s. Der Dialog kann geschlossen werden – das Ergebnis wird trotzdem gespeichert.
      </p>
      {!!fehler && <Fehler fehler={fehler} />}
    </div>
  )
}

// ------------------------------------------------------------------ Ergebnis
function Ergebnis({ e }: { e: SolverErgebnis }) {
  const { abteilungNach } = useStammdaten()
  const { nach: maNach } = useMitarbeiter()
  const [ansicht, setAnsicht] = useState<'luecken' | 'verstoesse' | 'hinweise'>('luecken')

  const unter = e.bericht.filter((z) => z.art === 'unterdeckung')
  const ueber = e.bericht.filter((z) => z.art === 'ueberdeckung')
  const hinweise = e.bericht.filter((z) => z.art === 'hinweis')
  const hart = e.verstoesse.filter((v) => v.schwere === 'hart')
  const weich = e.verstoesse.filter((v) => v.schwere === 'weich')
  const unterStd = unter.reduce((s, z) => s + z.stunden, 0)
  const ok = e.solver_status === 'OPTIMAL' || e.solver_status === 'FEASIBLE'
  const abdeckungTon = e.abdeckung === null ? 'neutral' : e.abdeckung >= 0.95 ? 'ok' : e.abdeckung >= 0.8 ? 'warn' : 'verstoss'

  const verstoesse = [...hart, ...weich]

  return (
    <div className="space-y-4">
      {!ok ? (
        <Hinweis ton="verstoss" titel={`Kein Ergebnis (Solver-Status ${e.solver_status})`}>Der Plan wurde nicht verändert.</Hinweis>
      ) : hart.length ? (
        <Hinweis ton="verstoss" titel={`${hart.length} harte Regelverstöße im Plan`}>Bitte vor der Freigabe prüfen.</Hinweis>
      ) : (
        <Hinweis ton="ok" titel="Plan erstellt – keine harten Regelverstöße">
          Das Ergebnis wurde gespeichert und durch das Regelwerk gegengeprüft. Feinjustierung im 15-Minuten-Raster per Drag &amp; Drop.
        </Hinweis>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatKachel label="Neue Einsätze" wert={fmtZahl(e.einsaetze_neu)} hinweis={`${fmtZahl(e.einsaetze_entfernt)} entfernt`} />
        <StatKachel label="Abdeckung" wert={fmtProzent(e.abdeckung, 1)} ton={abdeckungTon}
          hinweis={unterStd > 0 ? `${fmtStd(unterStd)} unterdeckt` : 'Bedarf vollständig gedeckt'} />
        <StatKachel label="Regelverstöße" wert={fmtZahl(hart.length)} ton={hart.length ? 'verstoss' : 'ok'} hinweis={`hart · ${fmtZahl(weich.length)} weich`} />
        <StatKachel label="Solver" wert={<span className="text-lg">{e.solver_status}</span>}
          hinweis={`${fmtZahl(e.laufzeit_s, 1)} s · Zielwert ${fmtZahl(e.zielwert)}`} />
      </div>

      <Tabs aktiv={ansicht} onChange={setAnsicht} werte={[
        { wert: 'luecken', label: `Unter-/Überdeckung (${unter.length + ueber.length})` },
        { wert: 'verstoesse', label: `Verstöße (${verstoesse.length})` },
        { wert: 'hinweise', label: `Hinweise (${hinweise.length})` },
      ]} />

      <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-sand">
        {ansicht === 'luecken' && (unter.length + ueber.length === 0
          ? <Leer titel="Bedarf überall gedeckt">Keine Unter- oder Überdeckungen.</Leer>
          : <BerichtTabelle zeilen={[...unter, ...ueber]} abteilungNach={abteilungNach} />)}
        {ansicht === 'verstoesse' && (verstoesse.length === 0
          ? <Leer titel="Keine Regelverstöße" />
          : <VerstossTabelle verstoesse={verstoesse} name={(id) => maNach[id]?.name ?? `#${id}`} />)}
        {ansicht === 'hinweise' && (hinweise.length === 0
          ? <Leer titel="Keine Hinweise" />
          : (
            <ul className="divide-y divide-sand text-sm">
              {hinweise.map((h, i) => (
                <li key={i} className="flex gap-2 px-3 py-2">
                  <Icon name="info" className="w-4 h-4 mt-0.5 text-haselnuss" />
                  <span>{h.meldung}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}

function BerichtTabelle({ zeilen, abteilungNach }: { zeilen: SolverBerichtZeile[]; abteilungNach: Record<number, { name: string; farbe: string }> }) {
  return (
    <table className="tabelle">
      <thead>
        <tr><th>Tag</th><th>Abteilung</th><th>Art</th><th className="text-right">Stunden</th><th>Ursache / Zeitraum</th></tr>
      </thead>
      <tbody>
        {zeilen.map((z, i) => {
          const abt = z.abteilung_id !== null ? abteilungNach[z.abteilung_id] : undefined
          const text = z.meldung.includes(' – ') ? z.meldung.slice(z.meldung.indexOf(' – ') + 3) : z.meldung
          const zeitraum = z.meldung.match(/\(([^()]*\d\d:\d\d[^()]*)\)/)?.[1]
          return (
            <tr key={i} className="align-top">
              <td className="whitespace-nowrap">{fmtTag(z.datum)}</td>
              <td className="whitespace-nowrap">
                {abt ? <span className="inline-flex items-center gap-1.5"><AbteilungsPunkt farbe={abt.farbe} />{abt.name}</span> : '–'}
              </td>
              <td>
                {z.art === 'unterdeckung'
                  ? <StatusBadge status="verstoss">Unterdeckung</StatusBadge>
                  : <Badge ton="info" icon="info">Überdeckung</Badge>}
              </td>
              <td className="text-right tabular-nums font-bold">{fmtStd(z.stunden)}</td>
              <td className="text-xs">
                {zeitraum && <div className="text-stein tabular-nums">{zeitraum}</div>}
                <div className="text-rinde">{text}</div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function VerstossTabelle({ verstoesse, name }: { verstoesse: Verstoss[]; name: (id: number) => string }) {
  return (
    <table className="tabelle">
      <thead><tr><th>Schwere</th><th>Tag</th><th>Mitarbeiter</th><th>Meldung</th></tr></thead>
      <tbody>
        {verstoesse.map((v, i) => (
          <tr key={i} className="align-top">
            <td>
              <StatusBadge status={v.schwere === 'hart' ? 'verstoss' : 'warn'} titel={v.regel}>
                {v.schwere === 'hart' ? 'hart' : 'weich'}
              </StatusBadge>
            </td>
            <td className="whitespace-nowrap">{fmtTag(v.datum)}</td>
            <td className="whitespace-nowrap">{name(v.mitarbeiter_id)}</td>
            <td className="text-xs">{v.meldung}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
