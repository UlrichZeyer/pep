// Tagesansicht (Gantt): Zeitachse 05–22 Uhr, Balken je Einsatz, Bedarfskurve je Abteilung (Köpfe je 30-min-Slot).
import { useMemo } from 'react'
import { WOCHENTAGE, type Abteilung, type Einsatz } from '../../api'
import { AbteilungsPunkt, Button, Card, Fehler, Hinweis, Icon, Laden, Leer, cx, fmtDatumKurz, fmtZahl } from '../../components/ui'
import { AbdeckungsAnzeige, VerstossMarker } from './bausteine'
import type { EinsatzVorgabe } from './EinsatzDialog'
import { nichtVerfuegbar, type PlanDaten } from './usePlanDaten'
import { SLOT, TAG_BEGINN, TAG_ENDE, farbeHell, vonMin, zuMin } from './zeit'

const SPANNE = TAG_ENDE - TAG_BEGINN
const SLOTS = Array.from({ length: SPANNE / SLOT }, (_, i) => TAG_BEGINN + i * SLOT)
const STUNDEN = Array.from({ length: SPANNE / 60 + 1 }, (_, i) => TAG_BEGINN + i * 60)
const pos = (min: number) => `${((Math.min(Math.max(min, TAG_BEGINN), TAG_ENDE) - TAG_BEGINN) / SPANNE) * 100}%`

function Raster() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {STUNDEN.map((h) => <div key={h} className="absolute top-0 bottom-0 border-l border-sand" style={{ left: pos(h) }} />)}
    </div>
  )
}

/** Treppen-Diagramm Bedarf vs. eingeplante Köpfe je Slot. */
function Bedarfskurve({ abteilung, bedarf, geplant }: { abteilung: Abteilung; bedarf: number[] | null; geplant: number[] }) {
  const n = SLOTS.length
  const max = Math.max(1, ...geplant, ...(bedarf ?? []))
  const H = 40
  const y = (k: number) => H - (k / max) * H * 0.95
  const unter = bedarf ? bedarf.reduce((s, b, i) => s + Math.max(0, b - geplant[i]), 0) * (SLOT / 60) : 0
  const ueber = bedarf ? bedarf.reduce((s, b, i) => s + Math.max(0, geplant[i] - b), 0) * (SLOT / 60) : 0
  let pfad = ''
  if (bedarf) bedarf.forEach((b, i) => { pfad += `${i === 0 ? 'M' : 'L'}${i},${y(b)} L${i + 1},${y(b)} ` })
  const label = bedarf
    ? `Bedarf ${abteilung.name}: max. ${fmtZahl(Math.max(...bedarf))} Köpfe; Unterdeckung ${fmtZahl(unter, 1)} Personenstunden, Überdeckung ${fmtZahl(ueber, 1)} Personenstunden`
    : `Kein Bedarf für ${abteilung.name} verfügbar`
  const hoehe = (k: number) => `${(k / max) * 95}%`
  const schraffur = 'repeating-linear-gradient(45deg, var(--color-verstoss) 0 2px, var(--color-verstoss-hell) 2px 6px)'
  return (
    <div className="relative h-10" role="img" aria-label={label}>
      {geplant.map((g, i) => {
        const b = bedarf ? bedarf[i] : g
        const gedeckt = Math.min(g, b)
        return (
          <div key={i} className="absolute bottom-0 top-0 flex flex-col-reverse" style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }} aria-hidden>
            {gedeckt > 0 && <div style={{ height: hoehe(gedeckt), backgroundColor: farbeHell(abteilung.farbe, 0.45) }} />}
            {g > b && <div style={{ height: hoehe(g - b), backgroundColor: farbeHell(abteilung.farbe, 0.15) }} />}
            {b > g && <div style={{ height: hoehe(b - g), backgroundImage: schraffur, opacity: 0.7 }} />}
          </div>
        )
      })}
      {pfad && (
        <svg viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden>
          <path d={pfad} fill="none" stroke="var(--color-rinde)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="absolute right-1 top-0.5 flex gap-1 text-[10px] font-bold">
        {unter > 0 && <span className="rounded bg-verstoss-hell text-verstoss px-1 flex items-center gap-0.5"><Icon name="verstoss" className="w-2.5 h-2.5" />−{fmtZahl(unter, 1)} h</span>}
        {ueber > 0 && <span className="rounded bg-white/80 text-stein px-1">+{fmtZahl(ueber, 1)} h</span>}
      </div>
    </div>
  )
}

function Balken({ e, abteilung, daten, onOeffnen, name }: { e: Einsatz; abteilung: Abteilung | undefined; daten: PlanDaten; onOeffnen: (v: EinsatzVorgabe) => void; name: string }) {
  const b = zuMin(e.beginn)
  const en = zuMin(e.ende)
  const dauer = Math.max(1, en - b)
  const farbe = abteilung?.farbe ?? '#7D7268'
  const pauseAnteil = Math.min(1, e.pause_min / dauer)
  const verstoesse = daten.verstoesseNachEinsatz.get(e.id) ?? []
  return (
    <div className="absolute top-1 bottom-1 flex items-center" style={{ left: pos(b), width: `calc(${pos(en)} - ${pos(b)})` }}>
      <button type="button" id={`einsatz-${e.id}`} onClick={() => onOeffnen({ einsatz: e, datum: e.datum })}
        aria-label={`${name}: ${e.beginn} bis ${e.ende}, ${abteilung?.name ?? ''}, Pause ${e.pause_min} Minuten${verstoesse.length ? `, ${verstoesse.length} Regelverstöße` : ''}`}
        className={cx('relative w-full h-full rounded-md border-l-4 text-left text-[11px] px-1.5 overflow-hidden hover:brightness-95',
          verstoesse.some((v) => v.schwere === 'hart') && 'outline outline-1 outline-verstoss/60')}
        style={{ backgroundColor: farbeHell(farbe, 0.35), borderLeftColor: farbe }}>
        {pauseAnteil > 0 && (
          <span aria-hidden className="absolute top-0 bottom-0"
            style={{
              left: `${50 - (pauseAnteil * 100) / 2}%`, width: `${pauseAnteil * 100}%`,
              backgroundImage: `repeating-linear-gradient(45deg, ${farbe}55 0 3px, transparent 3px 7px)`,
            }} />
        )}
        <span className="relative font-bold tabular-nums text-rinde">{e.beginn}–{e.ende}</span>
        <span className="relative text-stein"> · P {e.pause_min}′</span>
        {e.gesperrt && <Icon name="schloss" className="relative ml-1 w-3 h-3 text-haselnuss" titel="Gesperrt" />}
        {e.quelle === 'auto' && <Icon name="zauber" className="relative ml-1 w-3 h-3 text-haselnuss" titel="Auto-Planung" />}
      </button>
      {verstoesse.length > 0 && <span className="absolute -top-1 -right-1 z-10"><VerstossMarker verstoesse={verstoesse} klein /></span>}
    </div>
  )
}

export default function Tagesansicht({ daten, datum, onDatum, onOeffnen }:
  { daten: PlanDaten; datum: string; onDatum: (d: string) => void; onOeffnen: (v: EinsatzVorgabe) => void }) {
  const { stamm, einsaetze, plan, kalenderTage, mitarbeiterNach, bearbeitbar } = daten
  const info = kalenderTage[datum]
  const bedarfTag = daten.bedarfQ.data?.tage.find((t) => t.datum === datum)

  const gruppen = useMemo(() => {
    const tag = einsaetze.filter((e) => e.datum === datum)
    const ids = new Set<number>(tag.map((e) => e.abteilung_id))
    for (const a of bedarfTag?.abteilungen ?? []) if (a.stunden > 0 || a.slots.some((s) => s.koepfe > 0)) ids.add(a.abteilung_id)
    return [...ids]
      .map((id) => stamm.abteilungNach[id])
      .filter(Boolean)
      .sort((a, b) => a.sortierung - b.sortierung)
      .map((a) => {
        const l = tag.filter((e) => e.abteilung_id === a.id).sort((x, y) => x.beginn.localeCompare(y.beginn) || x.ende.localeCompare(y.ende))
        const geplant = SLOTS.map((s) => l.filter((e) => zuMin(e.beginn) < s + SLOT && zuMin(e.ende) > s).length)
        const ba = bedarfTag?.abteilungen.find((x) => x.abteilung_id === a.id)
        const bedarf = ba ? SLOTS.map((s) => ba.slots.find((x) => x.beginn === vonMin(s))?.koepfe ?? 0) : null
        return { abteilung: a, einsaetze: l, geplant, bedarf, stunden: l.reduce((s, e) => s + e.stunden, 0) }
      })
  }, [einsaetze, datum, bedarfTag, stamm.abteilungNach])

  if (daten.plaeneQ.isLoading) return <Laden />
  if (daten.plaeneQ.isError)
    return nichtVerfuegbar(daten.plaeneQ.error)
      ? <Hinweis ton="info" titel="Einsatzplanung noch nicht verfügbar">Die Planungs-Schnittstelle ist im Backend noch nicht vorhanden.</Hinweis>
      : <Fehler fehler={daten.plaeneQ.error} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tag der Woche">
        {daten.tage.map((t, i) => (
          <button key={t} type="button" onClick={() => onDatum(t)} aria-pressed={t === datum}
            className={cx('rounded-lg px-2.5 py-1 text-sm font-semibold border',
              t === datum ? 'bg-fell text-white border-fell' : 'bg-white border-sand text-haselnuss hover:border-fell',
              kalenderTage[t]?.geschlossen && t !== datum && 'opacity-60')}>
            {WOCHENTAGE[i]} {fmtDatumKurz(t)}
          </button>
        ))}
        {info?.hotday && <span className="ml-2 text-sm text-haselnuss font-bold flex items-center gap-1"><Icon name="info" />Hotday {info.hotday.name} ×{fmtZahl(info.hotday.lastfaktor, 2)}</span>}
      </div>

      {!plan ? <Card><Leer titel="Noch kein Plan für diese Woche">Lege oben einen Plan an.</Leer></Card>
        : info?.geschlossen ? <Card><Leer titel="Filiale geschlossen">{info.grund ?? ''}</Leer></Card>
          : (
            <Card polster={false}>
              <div className="overflow-x-auto">
                <div className="min-w-[900px]">
                  {/* Zeitachse */}
                  <div className="flex border-b border-sand sticky top-0 bg-white z-10">
                    <div className="w-48 shrink-0 px-3 py-2 text-xs font-bold uppercase text-stein">Abteilung / Mitarbeiter</div>
                    <div className="relative flex-1 h-8">
                      {STUNDEN.map((h) => (
                        <span key={h} className={cx('absolute top-2 text-[11px] font-semibold text-stein tabular-nums', h === TAG_ENDE ? '-translate-x-full pr-1' : h === TAG_BEGINN ? 'pl-1' : '-translate-x-1/2')} style={{ left: pos(h) }}>{String(h / 60).padStart(2, '0')}</span>
                      ))}
                    </div>
                  </div>
                  {gruppen.length === 0 && <Leer titel="Keine Einsätze an diesem Tag">{bearbeitbar ? 'Über „Einsatz hinzufügen“ planen.' : ''}</Leer>}
                  {gruppen.map((g) => (
                    <section key={g.abteilung.id} className="border-b border-sand" aria-label={g.abteilung.name}>
                      <div className="flex bg-creme">
                        <div className="w-48 shrink-0 px-3 py-1.5">
                          <div className="flex items-center gap-1.5 font-bold text-rinde text-sm"><AbteilungsPunkt farbe={g.abteilung.farbe} />{g.abteilung.name}</div>
                          <div className="mt-1"><AbdeckungsAnzeige geplant={g.stunden} bedarf={daten.bedarfStd(datum, g.abteilung.id)} kompakt /></div>
                          {bearbeitbar && (
                            <Button klein variante="leise" icon="plus" className="mt-1 !px-1"
                              onClick={() => onOeffnen({ datum, abteilung_id: g.abteilung.id })}>Einsatz hinzufügen</Button>
                          )}
                        </div>
                        <div className="relative flex-1 self-stretch py-1">
                          <Raster />
                          <Bedarfskurve abteilung={g.abteilung} bedarf={g.bedarf} geplant={g.geplant} />
                          <div className="text-[10px] text-stein mt-0.5">Linie = Bedarf (Köpfe) · Fläche = eingeplant · rot schraffiert = Unterdeckung</div>
                        </div>
                      </div>
                      {g.einsaetze.map((e) => {
                        const name = mitarbeiterNach[e.mitarbeiter_id]?.name ?? `#${e.mitarbeiter_id}`
                        return (
                          <div key={e.id} className="flex border-t border-sand/60 hover:bg-creme/50">
                            <div className="w-48 shrink-0 px-3 py-1.5 text-sm truncate" title={name}>{name}</div>
                            <div className="relative flex-1 h-9">
                              <Raster />
                              <Balken e={e} abteilung={g.abteilung} daten={daten} onOeffnen={onOeffnen} name={name} />
                            </div>
                          </div>
                        )
                      })}
                    </section>
                  ))}
                </div>
              </div>
              {daten.bedarfQ.isError && (
                <p className="px-3 py-2 text-xs text-stein flex items-center gap-1"><Icon name="info" className="w-3.5 h-3.5" />
                  Bedarfskurve {nichtVerfuegbar(daten.bedarfQ.error) ? 'noch nicht verfügbar' : 'konnte nicht geladen werden'}.</p>
              )}
            </Card>
          )}
    </div>
  )
}
