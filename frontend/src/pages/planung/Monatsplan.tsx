// Monatsplan: kompakte Matrix Mitarbeiter × Tage (F/M/S, Abwesenheitskürzel, „·“ frei) mit Summen.
import { useMemo, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ABWESENHEITSKUERZEL, ABWESENHEITSTYPEN, WOCHENTAGE, api, type Einsatz } from '../../api'
import { useStammdaten } from '../../hooks'
import { Card, Fehler, Hinweis, Laden, Leer, StatusBadge, cx, fmtStd, fmtZahl } from '../../components/ui'
import { PlanStatusBadge, sollAbweichung } from './bausteine'
import { abwesenheitsKarte, istGesperrtStatus, keinRetryBei404, nichtVerfuegbar, sichtbareMitarbeiter, useKalenderTage } from './usePlanDaten'
import { monatsAnfang, monatsEnde, plusTage, schichtKuerzel, wochentagIndex } from './zeit'

const KUERZEL_STIL = {
  F: 'bg-moos-hell text-moos',
  M: 'bg-sand text-haselnuss',
  S: 'bg-[#E4EEF6] text-[#2A5F8A]',
} as const

export default function Monatsplan({ datum, onTag }: { datum: string; onTag: (d: string) => void }) {
  const anfang = monatsAnfang(datum)
  const ende = monatsEnde(datum)
  const tage = useMemo(() => {
    const l: string[] = []
    for (let t = anfang; t <= ende; t = plusTage(t, 1)) if (wochentagIndex(t) !== 6) l.push(t)
    return l
  }, [anfang, ende])
  const stamm = useStammdaten()
  const kalenderTage = useKalenderTage(tage)

  const plaeneQ = useQuery({ queryKey: ['plaene', anfang, ende], queryFn: () => api.plaene(anfang, ende), retry: keinRetryBei404 })
  const plaene = useMemo(() => plaeneQ.data ?? [], [plaeneQ.data])
  const abwQ = useQuery({ queryKey: ['abwesenheiten', anfang, ende], queryFn: () => api.abwesenheiten(anfang, ende) })
  const maQ = useQuery({ queryKey: ['mitarbeiter', 'stichtag', anfang], queryFn: () => api.mitarbeiter(anfang) })

  const einsaetzeQs = useQueries({
    queries: plaene.map((p) => ({ queryKey: ['einsaetze', p.id], queryFn: () => api.einsaetze(p.id), retry: keinRetryBei404 })),
    combine: (rs) => ({ daten: rs.map((r) => r.data), fehler: rs.some((r) => r.isError) }),
  })
  const einsaetze = useMemo(() => {
    const l: Einsatz[] = []
    for (const d of einsaetzeQs.daten) for (const e of d ?? []) if (e.datum >= anfang && e.datum <= ende) l.push(e)
    return l
  }, [einsaetzeQs.daten, anfang, ende])

  const nachZelle = useMemo(() => {
    const k = new Map<string, Einsatz[]>()
    for (const e of einsaetze) {
      const s = `${e.mitarbeiter_id}|${e.datum}`
      k.set(s, [...(k.get(s) ?? []), e].sort((a, b) => a.beginn.localeCompare(b.beginn)))
    }
    return k
  }, [einsaetze])
  const abwNach = useMemo(() => abwesenheitsKarte(abwQ.data ?? [], anfang, ende), [abwQ.data, anfang, ende])

  const mitarbeiter = useMemo(() => {
    const mitE = new Set(einsaetze.map((e) => e.mitarbeiter_id))
    return sichtbareMitarbeiter(maQ.data ?? [], anfang, ende, mitE).sort((a, b) =>
      (stamm.abteilungNach[a.stammabteilung_id ?? -1]?.sortierung ?? 99) - (stamm.abteilungNach[b.stammabteilung_id ?? -1]?.sortierung ?? 99) || a.name.localeCompare(b.name))
  }, [maQ.data, einsaetze, anfang, ende, stamm.abteilungNach])

  const offeneTage = tage.filter((t) => !kalenderTage[t]?.geschlossen).length
  const jeTag = useMemo(() => tage.map((t) => {
    const l = einsaetze.filter((e) => e.datum === t)
    return { personen: new Set(l.map((e) => e.mitarbeiter_id)).size, stunden: l.reduce((s, e) => s + e.stunden, 0) }
  }), [einsaetze, tage])

  if (plaeneQ.isLoading || maQ.isLoading) return <Laden />
  if (plaeneQ.isError)
    return nichtVerfuegbar(plaeneQ.error)
      ? <Hinweis ton="info" titel="Monatsplan noch nicht verfügbar">Die Planungs-Schnittstelle (/api/plaene) ist im Backend noch nicht vorhanden.</Hinweis>
      : <Fehler fehler={plaeneQ.error} />
  if (maQ.isError) return <Fehler fehler={maQ.error} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stein">Pläne in diesem Monat:</span>
        {plaene.length === 0 && <span className="text-stein">keine</span>}
        {plaene.map((p) => <span key={p.id} className="inline-flex items-center gap-1 rounded-lg border border-sand bg-white px-2 py-0.5"><span className="font-semibold">{p.name}</span><PlanStatusBadge status={p.status} /></span>)}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-stein" aria-label="Legende">
          <span className={cx('rounded px-1 font-bold', KUERZEL_STIL.F)}>F</span> Beginn vor 10 Uhr
          <span className={cx('rounded px-1 font-bold', KUERZEL_STIL.M)}>M</span> 10–13 Uhr
          <span className={cx('rounded px-1 font-bold', KUERZEL_STIL.S)}>S</span> ab 13 Uhr
          <span className="rounded px-1 font-bold bg-sand/60 text-stein">U/K/BS</span> Abwesenheit
          <span className="font-bold">·</span> frei
        </span>
      </div>
      {einsaetzeQs.fehler && <Hinweis ton="warn">Einsätze einzelner Pläne konnten nicht geladen werden.</Hinweis>}

      <Card polster={false}>
        {mitarbeiter.length === 0 ? <Leer titel="Keine Mitarbeiter" /> : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white z-10 text-left px-2 py-1.5 text-stein font-bold uppercase border-b-2 border-sand min-w-[150px]">Mitarbeiter/in</th>
                  {tage.map((t) => {
                    const info = kalenderTage[t]
                    return (
                      <th key={t} className={cx('px-0 py-1 border-b-2 border-sand font-semibold text-center w-8', info?.geschlossen && 'bg-sand/50', wochentagIndex(t) === 0 && 'border-l border-sand')}>
                        <button type="button" onClick={() => onTag(t)} className="w-full hover:text-fell-dunkel"
                          aria-label={`${WOCHENTAGE[wochentagIndex(t)]} ${t.slice(8)}. – Tagesansicht öffnen${info?.geschlossen ? ` (geschlossen${info.grund ? `: ${info.grund}` : ''})` : ''}`}
                          title={info?.grund ?? info?.hotday?.name ?? undefined}>
                          <div className="text-stein text-[10px]">{WOCHENTAGE[wochentagIndex(t)]}</div>
                          <div className="text-rinde">{Number(t.slice(8))}</div>
                          {info?.hotday && <div className="text-fell-dunkel text-[9px] font-extrabold" aria-hidden>HOT</div>}
                        </button>
                      </th>
                    )
                  })}
                  <th className="px-2 py-1.5 text-right text-stein font-bold uppercase border-b-2 border-l border-sand min-w-[120px]">Σ / Soll anteilig</th>
                </tr>
              </thead>
              <tbody>
                {mitarbeiter.map((m) => {
                  let summe = 0
                  const abt = stamm.abteilungNach[m.stammabteilung_id ?? -1]
                  const soll = m.vertrag ? (m.vertrag.soll_std_woche / 6) * offeneTage : null
                  const zellen = tage.map((t) => {
                    const es = nachZelle.get(`${m.id}|${t}`) ?? []
                    const a = abwNach.get(`${m.id}|${t}`)
                    summe += es.reduce((s, e) => s + e.stunden, 0)
                    const geschlossen = kalenderTage[t]?.geschlossen
                    let inhalt: ReactNode = <span className="text-stein/60">·</span>
                    let titel = 'frei'
                    let stil = ''
                    if (es.length) {
                      const k = schichtKuerzel(es[0].beginn)
                      inhalt = <>{k}{es.length > 1 && <sup>+</sup>}</>
                      stil = KUERZEL_STIL[k]
                      titel = es.map((e) => `${e.beginn}–${e.ende} ${stamm.abteilungNach[e.abteilung_id]?.kuerzel ?? ''}`).join(', ')
                    } else if (a) {
                      inhalt = ABWESENHEITSKUERZEL[a.typ]
                      stil = cx('bg-sand/60 text-stein', a.status === 'beantragt' && 'italic')
                      titel = `${ABWESENHEITSTYPEN[a.typ]}${a.status === 'beantragt' ? ' (beantragt)' : ''}`
                    } else if (geschlossen) {
                      inhalt = ''
                      titel = 'geschlossen'
                    }
                    return (
                      <td key={t} title={titel} className={cx('text-center p-0.5 border-b border-sand', geschlossen && 'bg-sand/40', wochentagIndex(t) === 0 && 'border-l border-sand')}>
                        <span className={cx('inline-flex items-center justify-center w-7 h-6 rounded font-bold', stil)} aria-label={titel}>{inhalt}</span>
                      </td>
                    )
                  })
                  const abw = sollAbweichung(summe, soll)
                  return (
                    <tr key={m.id} className={cx('hover:bg-creme', istGesperrtStatus(m) && 'opacity-50')}>
                      <td className="sticky left-0 bg-white z-10 px-2 py-1 border-b border-sand whitespace-nowrap">
                        <span className="inline-block w-1.5 h-4 rounded-sm mr-1.5 align-middle" style={{ backgroundColor: abt?.farbe ?? 'transparent' }} aria-hidden />
                        <span className="font-semibold text-rinde">{m.name}</span>
                        {istGesperrtStatus(m) && <span className="text-stein"> · {m.status}</span>}
                      </td>
                      {zellen}
                      <td className="px-2 py-1 border-b border-l border-sand text-right whitespace-nowrap">
                        <span className="tabular-nums font-bold">{fmtZahl(summe, 1)}</span>
                        <span className="text-stein tabular-nums"> / {soll === null ? '–' : fmtZahl(soll, 0)} h</span>
                        <span className="ml-1"><StatusBadge status={abw.status}>{abw.text}</StatusBadge></span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-creme">
                  <td className="sticky left-0 bg-creme z-10 px-2 py-1 font-bold">Personen</td>
                  {jeTag.map((s, i) => <td key={tage[i]} className="text-center tabular-nums font-bold">{s.personen || ''}</td>)}
                  <td className="border-l border-sand" />
                </tr>
                <tr className="bg-creme">
                  <td className="sticky left-0 bg-creme z-10 px-2 py-1 font-bold">Stunden</td>
                  {jeTag.map((s, i) => <td key={tage[i]} className="text-center tabular-nums text-[10px]">{s.stunden ? fmtZahl(s.stunden, 0) : ''}</td>)}
                  <td className="px-2 border-l border-sand text-right font-bold tabular-nums">{fmtStd(Math.round(jeTag.reduce((a, s) => a + s.stunden, 0)))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
