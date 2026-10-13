// Abteilungsansicht: Spalten = Abteilungen, Zeilen = Tage der Woche; wer ist wann wo, Σ Stunden vs. Bedarf.
import { useMemo } from 'react'
import { WOCHENTAGE, type Einsatz } from '../../api'
import { AbteilungsPunkt, Badge, Card, Fehler, Hinweis, Icon, Laden, Leer, cx, fmtDatumKurz, fmtZahl } from '../../components/ui'
import { AbdeckungsAnzeige, VerstossMarker } from './bausteine'
import type { EinsatzVorgabe } from './EinsatzDialog'
import { nichtVerfuegbar, type PlanDaten } from './usePlanDaten'
import { farbeHell } from './zeit'

export default function Abteilungsansicht({ daten, onOeffnen }: { daten: PlanDaten; onOeffnen: (v: EinsatzVorgabe) => void }) {
  const { tage, stamm, einsaetze, kalenderTage, mitarbeiterNach, plan, bearbeitbar } = daten
  const abteilungen = useMemo(() => [...stamm.abteilungen].sort((a, b) => a.sortierung - b.sortierung), [stamm.abteilungen])
  const nach = useMemo(() => {
    const k = new Map<string, Einsatz[]>()
    for (const e of einsaetze) {
      const s = `${e.abteilung_id}|${e.datum}`
      k.set(s, [...(k.get(s) ?? []), e])
    }
    for (const l of k.values()) l.sort((a, b) => a.beginn.localeCompare(b.beginn) || a.ende.localeCompare(b.ende))
    return k
  }, [einsaetze])

  if (daten.plaeneQ.isLoading) return <Laden />
  if (daten.plaeneQ.isError)
    return nichtVerfuegbar(daten.plaeneQ.error)
      ? <Hinweis ton="info" titel="Einsatzplanung noch nicht verfügbar">Die Planungs-Schnittstelle ist im Backend noch nicht vorhanden.</Hinweis>
      : <Fehler fehler={daten.plaeneQ.error} />
  if (!plan) return <Card><Leer titel="Noch kein Plan für diese Woche">Lege oben einen Plan an.</Leer></Card>

  return (
    <div className="overflow-x-auto rounded-[var(--radius-eich)] border border-sand bg-white">
      <table className="tabelle">
        <thead>
          <tr>
            <th className="min-w-[110px]">Tag</th>
            {abteilungen.map((a) => (
              <th key={a.id} className="border-l border-sand !normal-case min-w-[150px]">
                <span className="flex items-center gap-1.5 text-rinde text-sm"><AbteilungsPunkt farbe={a.farbe} />{a.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tage.map((t, i) => {
            const info = kalenderTage[t]
            return (
              <tr key={t} className={cx(info?.geschlossen && 'bg-sand/30')}>
                <td className="align-top">
                  <div className="font-extrabold text-rinde">{WOCHENTAGE[i]} <span className="font-semibold">{fmtDatumKurz(t)}</span></div>
                  {info?.geschlossen && <Badge ton="neutral" icon="schloss">geschlossen</Badge>}
                  {info?.hotday && <Badge ton="info" icon="info" titel={info.hotday.name}>Hotday ×{fmtZahl(info.hotday.lastfaktor, 2)}</Badge>}
                </td>
                {abteilungen.map((a) => {
                  const l = nach.get(`${a.id}|${t}`) ?? []
                  const stunden = l.reduce((s, e) => s + e.stunden, 0)
                  return (
                    <td key={a.id} className="align-top border-l border-sand !p-1.5">
                      {info?.geschlossen ? <span className="text-xs text-stein">–</span> : (
                        <div className="flex flex-col gap-1">
                          {l.map((e) => {
                            const name = mitarbeiterNach[e.mitarbeiter_id]?.name ?? `#${e.mitarbeiter_id}`
                            const v = daten.verstoesseNachEinsatz.get(e.id) ?? []
                            return (
                              <div key={e.id} className="flex items-center gap-1 rounded border-l-4 pl-1.5 pr-1 py-0.5 text-xs"
                                style={{ backgroundColor: farbeHell(a.farbe), borderLeftColor: a.farbe }}>
                                <button type="button" id={`einsatz-${e.id}`} onClick={() => onOeffnen({ einsatz: e, datum: e.datum })}
                                  className="flex-1 text-left truncate hover:underline" aria-label={`${name} ${e.beginn} bis ${e.ende} bearbeiten`}>
                                  <span className="font-semibold text-rinde">{name}</span>{' '}
                                  <span className="tabular-nums text-stein">{e.beginn}–{e.ende}</span>
                                </button>
                                {e.gesperrt && <Icon name="schloss" className="w-3 h-3 text-haselnuss" titel="Gesperrt" />}
                                <VerstossMarker verstoesse={v} klein />
                              </div>
                            )
                          })}
                          {bearbeitbar && (
                            <button type="button" onClick={() => onOeffnen({ datum: t, abteilung_id: a.id })}
                              aria-label={`Einsatz in ${a.name} am ${fmtDatumKurz(t)} anlegen`}
                              className="rounded text-xs text-stein hover:bg-creme hover:text-fell-dunkel flex items-center gap-1 px-1 py-0.5">
                              <Icon name="plus" className="w-3 h-3" /> hinzufügen
                            </button>
                          )}
                          <div className="pt-1 border-t border-sand/70"><AbdeckungsAnzeige geplant={stunden} bedarf={daten.bedarfStd(t, a.id)} kompakt /></div>
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
