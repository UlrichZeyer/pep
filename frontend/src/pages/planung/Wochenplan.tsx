// Wochenplan: Mitarbeiter × Mo–Sa mit Drag & Drop (dnd-kit), Live-Validierung, Abdeckung je Tag.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  ABWESENHEITSKUERZEL, ABWESENHEITSSTATUS, ABWESENHEITSTYPEN, STATUS, VERTRAGSARTEN, WOCHENTAGE,
  type Abteilung, type Abwesenheit, type Einsatz, type Mitarbeiter, type Verstoss,
} from '../../api'
import { AbteilungsPunkt, Badge, Button, Card, Fehler, Hinweis, Icon, Laden, Leer, StatusBadge, cx, eingabe, fmtDatumKurz, fmtStd, fmtZahl } from '../../components/ui'
import { AbdeckungsAnzeige, VerstossMarker, sollAbweichung } from './bausteine'
import type { EinsatzVorgabe } from './EinsatzDialog'
import { istGesperrtStatus, nichtVerfuegbar, sichtbareMitarbeiter, type PlanDaten, type TagInfo } from './usePlanDaten'
import { farbeHell, wochentagIndex } from './zeit'

interface Props {
  daten: PlanDaten
  onOeffnen: (v: EinsatzVorgabe) => void
  markiert: number | null
  onMarkieren: (id: number | null) => void
}

const zellId = (maId: number, datum: string) => `zelle|${maId}|${datum}`
/** Zeitpunkt des letzten Drag-Endes – unterdrückt den Klick, der direkt danach ausgelöst wird. */
const gezogen = { zuletzt: 0 }
const kurzNachZiehen = () => Date.now() - gezogen.zuletzt < 300

// ------------------------------------------------------------------ Einsatzblock
interface BlockProps {
  einsatz: Einsatz
  abteilung: Abteilung | undefined
  verstoesse: Verstoss[]
  ziehbar: boolean
  markiert: boolean
  onOeffnen: (e: Einsatz) => void
  maName: string
}

function EinsatzInhalt({ einsatz: e, abteilung, verstoesse }: Pick<BlockProps, 'einsatz' | 'abteilung' | 'verstoesse'>) {
  return (
    <>
      <div className="flex items-center gap-1">
        <span className="font-bold tabular-nums text-rinde whitespace-nowrap">{e.beginn}–{e.ende}</span>
        <span className="ml-auto flex items-center gap-0.5 text-haselnuss">
          {e.gesperrt && <Icon name="schloss" className="w-3 h-3" titel="Gesperrt" />}
          {e.quelle === 'auto' && <Icon name="zauber" className="w-3 h-3" titel="Vorschlag der Auto-Planung" />}
          {verstoesse.length > 0 && <VerstossMarker verstoesse={verstoesse} klein />}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-stein">
        <span className="font-extrabold" style={{ color: abteilung?.farbe }}>{abteilung?.kuerzel ?? '?'}</span>
        <span>· P {e.pause_min}′</span>
        <span className="ml-auto tabular-nums">{fmtStd(e.stunden)}</span>
      </div>
    </>
  )
}

const EinsatzBlock = memo(function EinsatzBlock({ einsatz: e, abteilung, verstoesse, ziehbar, markiert, onOeffnen, maName }: BlockProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `einsatz|${e.id}`, data: { einsatz: e }, disabled: !ziehbar || e.id < 0 })
  const hart = verstoesse.some((v) => v.schwere === 'hart')
  const farbe = abteilung?.farbe ?? '#7D7268'
  return (
    <div id={`einsatz-${e.id}`} ref={setNodeRef} {...attributes} {...listeners}
      role="button" tabIndex={0}
      aria-label={`${maName}: ${e.beginn} bis ${e.ende}, ${abteilung?.name ?? ''}, Pause ${e.pause_min} Minuten${e.gesperrt ? ', gesperrt' : ''}${verstoesse.length ? `, ${verstoesse.length} Regelverstöße` : ''}. Enter zum Bearbeiten${ziehbar ? ', Leertaste zum Verschieben' : ''}`}
      onClick={(ev) => { ev.stopPropagation(); if (!kurzNachZiehen()) onOeffnen(e) }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); onOeffnen(e); return }
        listeners?.onKeyDown?.(ev)
      }}
      style={{ backgroundColor: farbeHell(farbe), borderLeftColor: farbe }}
      className={cx('relative rounded-md border-l-4 px-1.5 py-1 text-xs select-none',
        ziehbar ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isDragging && 'opacity-40',
        e.id < 0 && 'opacity-70',
        hart && 'outline outline-1 outline-verstoss/60',
        markiert && 'ring-2 ring-fell ring-offset-1')}>
      <EinsatzInhalt einsatz={e} abteilung={abteilung} verstoesse={verstoesse} />
    </div>
  )
})

// ------------------------------------------------------------------ Zelle
function AbwesenheitsFeld({ a }: { a: Abwesenheit }) {
  const text = `${ABWESENHEITSTYPEN[a.typ]} (${ABWESENHEITSSTATUS[a.status]})${a.notiz ? ` – ${a.notiz}` : ''}`
  return (
    <div title={text} aria-label={text}
      className={cx('rounded-md px-1.5 py-1 text-xs font-bold text-stein bg-sand/70 flex items-center gap-1',
        a.status === 'beantragt' && 'border border-dashed border-stein/50 bg-white')}>
      <span>{ABWESENHEITSKUERZEL[a.typ]}</span>
      <span className="font-normal truncate">{ABWESENHEITSTYPEN[a.typ]}{a.status === 'beantragt' ? ' ?' : ''}</span>
    </div>
  )
}

interface ZelleProps {
  ma: Mitarbeiter
  datum: string
  info: TagInfo | undefined
  einsaetze: Einsatz[]
  abwesenheit: Abwesenheit | undefined
  bearbeitbar: boolean
  daten: PlanDaten
  markiert: number | null
  onOeffnen: (v: EinsatzVorgabe) => void
}

function Zelle({ ma, datum, info, einsaetze, abwesenheit, bearbeitbar, daten, markiert, onOeffnen }: ZelleProps) {
  const geschlossen = !!info?.geschlossen
  const { setNodeRef, isOver } = useDroppable({ id: zellId(ma.id, datum), data: { mitarbeiter_id: ma.id, datum }, disabled: geschlossen || !bearbeitbar })
  const oeffnen = (e: Einsatz) => onOeffnen({ einsatz: e, datum: e.datum })
  return (
    <td ref={setNodeRef} data-zelle={`${ma.id}|${datum}`}
      onClick={() => { if (!geschlossen && bearbeitbar && !kurzNachZiehen()) onOeffnen({ mitarbeiter_id: ma.id, datum }) }}
      className={cx('align-top !p-1 border-l border-sand min-w-[112px]', geschlossen && 'bg-sand/40', isOver && 'bg-fell-hell',
        !geschlossen && bearbeitbar && 'cursor-cell')}>
      <div className="flex flex-col gap-1 min-h-[40px]">
        {abwesenheit && <AbwesenheitsFeld a={abwesenheit} />}
        {einsaetze.map((e) => (
          <EinsatzBlock key={e.id} einsatz={e} abteilung={daten.stamm.abteilungNach[e.abteilung_id]}
            verstoesse={daten.verstoesseNachEinsatz.get(e.id) ?? []} ziehbar={bearbeitbar} markiert={markiert === e.id}
            onOeffnen={oeffnen} maName={ma.name} />
        ))}
        {!geschlossen && bearbeitbar && einsaetze.length === 0 && (
          <button type="button" onClick={(ev) => { ev.stopPropagation(); onOeffnen({ mitarbeiter_id: ma.id, datum }) }}
            aria-label={`Einsatz anlegen für ${ma.name} am ${fmtDatumKurz(datum)}`}
            className={cx('flex-1 rounded-md text-stein/0 hover:text-stein hover:bg-creme focus:text-stein text-xs flex items-center justify-center',
              abwesenheit ? 'min-h-[16px]' : 'min-h-[40px]')}>
            <Icon name="plus" className="w-3.5 h-3.5" />
          </button>
        )}
        {geschlossen && einsaetze.length === 0 && <span className="text-[11px] text-stein text-center py-2" aria-label="geschlossen">–</span>}
      </div>
    </td>
  )
}

// ------------------------------------------------------------------ Wochenplan
export default function Wochenplan({ daten, onOeffnen, markiert, onMarkieren }: Props) {
  const { tage, stamm, kalenderTage, einsaetze, einsaetzeNachZelle, abwesenheitNach, bearbeitbar, plan } = daten
  const [abtFilter, setAbtFilter] = useState<number | ''>('')
  const [suche, setSuche] = useState('')
  const [listeOffen, setListeOffen] = useState(true)
  const [aktiv, setAktiv] = useState<Einsatz | null>(null)
  const [alt, setAlt] = useState(false)
  const altRef = useRef(false)

  useEffect(() => {
    const setze = (e: KeyboardEvent) => { altRef.current = e.altKey; setAlt(e.altKey) }
    const blur = () => { altRef.current = false; setAlt(false) }
    window.addEventListener('keydown', setze)
    window.addEventListener('keyup', setze)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', setze); window.removeEventListener('keyup', setze); window.removeEventListener('blur', blur) }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  )

  const mitEinsatz = useMemo(() => new Set(einsaetze.map((e) => e.mitarbeiter_id)), [einsaetze])
  const abtMitEinsatz = useMemo(() => {
    const m = new Map<number, Set<number>>()
    for (const e of einsaetze) { if (!m.has(e.abteilung_id)) m.set(e.abteilung_id, new Set()); m.get(e.abteilung_id)!.add(e.mitarbeiter_id) }
    return m
  }, [einsaetze])

  const gruppen = useMemo(() => {
    const s = suche.trim().toLowerCase()
    const liste = sichtbareMitarbeiter(daten.mitarbeiterAlle, daten.montag, daten.samstag, mitEinsatz)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || m.persnr.toLowerCase().includes(s))
      .filter((m) => abtFilter === '' || m.stammabteilung_id === abtFilter || abtMitEinsatz.get(abtFilter)?.has(m.id))
    const nachAbt = new Map<number | null, Mitarbeiter[]>()
    for (const m of liste) {
      const k = m.stammabteilung_id
      nachAbt.set(k, [...(nachAbt.get(k) ?? []), m])
    }
    const sortiert = [...nachAbt.entries()].sort(([a], [b]) =>
      (a === null ? 999 : stamm.abteilungNach[a]?.sortierung ?? 998) - (b === null ? 999 : stamm.abteilungNach[b]?.sortierung ?? 998))
    return sortiert.map(([id, l]) => ({ abteilung: id === null ? null : stamm.abteilungNach[id] ?? null, mitarbeiter: l.sort((x, y) => x.name.localeCompare(y.name)) }))
  }, [daten.mitarbeiterAlle, daten.montag, daten.samstag, mitEinsatz, suche, abtFilter, abtMitEinsatz, stamm.abteilungNach])

  const stundenJeMa = useMemo(() => {
    const m = new Map<number, number>()
    for (const e of einsaetze) m.set(e.mitarbeiter_id, (m.get(e.mitarbeiter_id) ?? 0) + e.stunden)
    return m
  }, [einsaetze])
  const jeTag = useMemo(() => tage.map((t) => {
    const l = einsaetze.filter((e) => e.datum === t)
    return { stunden: l.reduce((s, e) => s + e.stunden, 0), personen: new Set(l.map((e) => e.mitarbeiter_id)).size }
  }), [einsaetze, tage])

  const onDragStart = (ev: DragStartEvent) => setAktiv((ev.active.data.current?.einsatz as Einsatz) ?? null)
  const onDragEnd = (ev: DragEndEvent) => {
    setAktiv(null)
    gezogen.zuletzt = Date.now()
    const e = ev.active.data.current?.einsatz as Einsatz | undefined
    const ziel = ev.over?.data.current as { mitarbeiter_id: number; datum: string } | undefined
    if (!e || !ziel) return
    const kopieren = altRef.current || !!(ev.activatorEvent as PointerEvent | KeyboardEvent | undefined)?.altKey
    daten.verschieben(e, { mitarbeiter_id: ziel.mitarbeiter_id, datum: ziel.datum }, kopieren)
  }

  if (daten.plaeneQ.isLoading || daten.maQ.isLoading) return <Laden />
  if (daten.plaeneQ.isError)
    return nichtVerfuegbar(daten.plaeneQ.error)
      ? <Hinweis ton="info" titel="Einsatzplanung noch nicht verfügbar">Die Planungs-Schnittstelle (/api/plaene) ist im Backend noch nicht vorhanden. Sobald sie bereitsteht, erscheint hier der Wochenplan.</Hinweis>
      : <Fehler fehler={daten.plaeneQ.error} />
  if (!plan) return <Card><Leer titel="Noch kein Plan für diese Woche">Lege oben einen Plan an, um Einsätze zu planen.</Leer></Card>
  if (daten.maQ.isError) return <Fehler fehler={daten.maQ.error} />

  const verstoesseSortiert = [...daten.verstoesse].sort((a, b) =>
    (a.schwere === b.schwere ? 0 : a.schwere === 'hart' ? -1 : 1) || a.datum.localeCompare(b.datum))
  const aktivAbt = aktiv ? stamm.abteilungNach[aktiv.abteilung_id] : undefined

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-56">
          <span className="block text-xs font-bold text-haselnuss mb-1">Suche</span>
          <span className="relative block">
            <Icon name="suche" className="absolute left-2 top-2.5 w-4 h-4 text-stein" />
            <input className={cx(eingabe, '!pl-8')} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name oder Pers.-Nr." aria-label="Mitarbeiter suchen" />
          </span>
        </label>
        <label className="w-56">
          <span className="block text-xs font-bold text-haselnuss mb-1">Abteilung</span>
          <select className={eingabe} value={abtFilter} onChange={(e) => setAbtFilter(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Alle Abteilungen</option>
            {stamm.abteilungen.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <p className="text-xs text-stein flex-1 min-w-[200px]">
          {bearbeitbar ? <>Einsatz ziehen zum Verschieben, mit gedrückter <kbd className="px-1 rounded border border-sand bg-white">Alt</kbd>-Taste kopieren. Klick auf leere Zelle legt an.</> : 'Nur Ansicht.'}
          {alt && bearbeitbar && <Badge ton="fell" icon="plus">Kopiermodus</Badge>}
        </p>
        <Button variante="leise" icon={listeOffen ? 'rechts' : 'links'} aria-expanded={listeOffen} onClick={() => setListeOffen((o) => !o)}>
          Verstöße ({daten.verstoesse.length})
        </Button>
      </div>

      {daten.einsaetzeQ.isError && (
        <Hinweis ton={nichtVerfuegbar(daten.einsaetzeQ.error) ? 'info' : 'verstoss'} titel="Einsätze konnten nicht geladen werden">
          {nichtVerfuegbar(daten.einsaetzeQ.error) ? 'Endpunkt noch nicht verfügbar.' : String((daten.einsaetzeQ.error as Error).message)}
        </Hinweis>
      )}

      <div className="flex gap-3 items-start">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => { setAktiv(null); gezogen.zuletzt = Date.now() }}>
          <div className="flex-1 min-w-0 overflow-x-auto rounded-[var(--radius-eich)] border border-sand bg-white">
            <table className="tabelle">
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <th className="min-w-[170px]">Mitarbeiter/in</th>
                  {tage.map((t, i) => {
                    const info = kalenderTage[t]
                    return (
                      <th key={t} className={cx('border-l border-sand !normal-case', info?.geschlossen && 'bg-sand/40')}>
                        <div className="flex items-baseline gap-1 text-rinde"><span className="text-sm font-extrabold">{WOCHENTAGE[i]}</span><span className="font-semibold">{fmtDatumKurz(t)}</span></div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {info?.geschlossen && <Badge ton="neutral" icon="schloss" titel={info.grund ?? undefined}>geschlossen</Badge>}
                          {info?.hotday && <Badge ton="info" icon="info" titel={info.hotday.name}>Hotday ×{fmtZahl(info.hotday.lastfaktor, 2)}</Badge>}
                        </div>
                        {info?.geschlossen && info.grund && <div className="mt-0.5 text-[10px] font-semibold text-stein truncate max-w-[120px]" title={info.grund}>{info.grund}</div>}
                      </th>
                    )
                  })}
                  <th className="border-l border-sand text-right min-w-[96px]">Σ / Soll</th>
                </tr>
              </thead>
              <tbody>
                {gruppen.length === 0 && (
                  <tr><td colSpan={8}><Leer titel="Keine Mitarbeiter gefunden">Filter oder Suche anpassen.</Leer></td></tr>
                )}
                {gruppen.map((g) => (
                  <GruppenZeilen key={g.abteilung?.id ?? 'ohne'} abteilung={g.abteilung} mitarbeiter={g.mitarbeiter}
                    daten={daten} tage={tage} kalenderTage={kalenderTage} einsaetzeNachZelle={einsaetzeNachZelle}
                    abwesenheitNach={abwesenheitNach} stundenJeMa={stundenJeMa} bearbeitbar={bearbeitbar}
                    markiert={markiert} onOeffnen={onOeffnen} />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-creme">
                  <td className="font-bold text-rinde">Σ Tag <span className="block text-xs font-normal text-stein">geplant / Bedarf</span></td>
                  {tage.map((t, i) => (
                    <td key={t} className="border-l border-sand !py-2">
                      {kalenderTage[t]?.geschlossen ? <span className="text-xs text-stein">geschlossen</span> : (
                        <div className="flex flex-col items-start gap-0.5">
                          <AbdeckungsAnzeige geplant={jeTag[i].stunden} bedarf={daten.bedarfStd(t)} kompakt />
                          <span className="text-[11px] text-stein">{jeTag[i].personen} Personen</span>
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="border-l border-sand text-right font-bold tabular-nums">{fmtStd(Math.round(jeTag.reduce((s, x) => s + x.stunden, 0) * 10) / 10)}</td>
                </tr>
              </tfoot>
            </table>
            {daten.bedarfQ.isError && (
              <p className="px-3 py-2 text-xs text-stein flex items-center gap-1"><Icon name="info" className="w-3.5 h-3.5" />
                Bedarf {nichtVerfuegbar(daten.bedarfQ.error) ? 'noch nicht verfügbar' : 'konnte nicht geladen werden'} – Abdeckung {daten.abdeckungQ.data ? 'aus KPI-Abdeckung' : 'unbekannt'}.
              </p>
            )}
          </div>
          <DragOverlay dropAnimation={null}>
            {aktiv && (
              <div style={{ backgroundColor: farbeHell(aktivAbt?.farbe ?? '#7D7268', 0.3), borderLeftColor: aktivAbt?.farbe }}
                className="rounded-md border-l-4 px-1.5 py-1 text-xs shadow-lg bg-white w-[124px] cursor-grabbing">
                <EinsatzInhalt einsatz={aktiv} abteilung={aktivAbt} verstoesse={[]} />
                {alt && <div className="mt-0.5"><Badge ton="fell" icon="plus">Kopie</Badge></div>}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {listeOffen && (
          <aside className="w-64 shrink-0 sticky top-4" aria-label="Verstoß-Liste">
            <Card titel="Regelverstöße" polster={false}>
              {daten.validierungQ.isLoading ? <Laden text="Prüfe Regeln …" /> :
                daten.validierungQ.isError ? (
                  <p className="p-3 text-sm text-stein">{nichtVerfuegbar(daten.validierungQ.error) ? 'Validierung noch nicht verfügbar.' : 'Validierung fehlgeschlagen.'}</p>
                ) : verstoesseSortiert.length === 0 ? (
                  <div className="p-3"><StatusBadge status="ok">Keine Verstöße</StatusBadge></div>
                ) : (
                  <ul className="max-h-[65vh] overflow-y-auto divide-y divide-sand">
                    {verstoesseSortiert.map((v, i) => (
                      <li key={i}>
                        <button type="button" className="w-full text-left px-3 py-2 hover:bg-creme flex gap-2"
                          onClick={() => {
                            const id = v.einsatz_ids[0] ?? null
                            onMarkieren(id)
                            const el = document.getElementById(id !== null ? `einsatz-${id}` : `ma-${v.mitarbeiter_id}`)
                            el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
                            if (id === null && el) { el.classList.add('ring-2', 'ring-fell'); setTimeout(() => el.classList.remove('ring-2', 'ring-fell'), 2000) }
                          }}>
                          <Icon name={v.schwere === 'hart' ? 'verstoss' : 'warn'} className={cx('w-4 h-4 mt-0.5', v.schwere === 'hart' ? 'text-verstoss' : 'text-warn')} titel={v.schwere === 'hart' ? 'hart' : 'weich'} />
                          <span className="text-xs">
                            <span className="font-bold text-rinde">{daten.mitarbeiterNach[v.mitarbeiter_id]?.name ?? `#${v.mitarbeiter_id}`}</span>
                            <span className="text-stein"> · {WOCHENTAGE[wochentagIndex(v.datum)]} {fmtDatumKurz(v.datum)}</span>
                            <span className="block text-rinde/90">{v.meldung}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          </aside>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Zeilen einer Abteilungsgruppe
interface GruppenProps {
  abteilung: Abteilung | null
  mitarbeiter: Mitarbeiter[]
  daten: PlanDaten
  tage: string[]
  kalenderTage: Record<string, TagInfo>
  einsaetzeNachZelle: Map<string, Einsatz[]>
  abwesenheitNach: Map<string, Abwesenheit>
  stundenJeMa: Map<number, number>
  bearbeitbar: boolean
  markiert: number | null
  onOeffnen: (v: EinsatzVorgabe) => void
}

const LEER: Einsatz[] = []

function GruppenZeilen({ abteilung, mitarbeiter, daten, tage, kalenderTage, einsaetzeNachZelle, abwesenheitNach, stundenJeMa, bearbeitbar, markiert, onOeffnen }: GruppenProps) {
  return (
    <>
      <tr className="bg-creme">
        <td colSpan={8} className="!py-1.5">
          <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-haselnuss">
            {abteilung ? <AbteilungsPunkt farbe={abteilung.farbe} /> : null}
            {abteilung ? abteilung.name : 'Ohne Stammabteilung'}
            <span className="font-semibold normal-case tracking-normal text-stein">· {mitarbeiter.length}</span>
          </span>
        </td>
      </tr>
      {mitarbeiter.map((m) => {
        const grau = istGesperrtStatus(m)
        const geplant = stundenJeMa.get(m.id) ?? 0
        const soll = m.vertrag?.soll_std_woche ?? null
        const abw = sollAbweichung(geplant, soll)
        const maVerstoesse = daten.verstoesseNachMa.get(m.id) ?? []
        return (
          <tr key={m.id} className={cx(grau && 'opacity-50')}>
            <td id={`ma-${m.id}`} className="align-top">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-rinde">{m.name}</span>
                {m.minderjaehrig && <Badge ton="info" titel="Jugendarbeitsschutz">U18</Badge>}
                <VerstossMarker verstoesse={maVerstoesse} klein />
              </div>
              <div className="text-xs text-stein">
                {m.vertrag ? `${VERTRAGSARTEN[m.vertrag.art]} · ${fmtStd(m.vertrag.soll_std_woche)}` : 'kein Vertrag'}
                {grau && <> · <span className="font-bold">{STATUS[m.status]}</span></>}
              </div>
            </td>
            {tage.map((t) => (
              <Zelle key={t} ma={m} datum={t} info={kalenderTage[t]} einsaetze={einsaetzeNachZelle.get(`${m.id}|${t}`) ?? LEER}
                abwesenheit={abwesenheitNach.get(`${m.id}|${t}`)} bearbeitbar={bearbeitbar && !grau} daten={daten}
                markiert={markiert} onOeffnen={onOeffnen} />
            ))}
            <td className="border-l border-sand text-right align-top">
              <div className="tabular-nums text-sm"><span className="font-bold">{fmtStd(Math.round(geplant * 10) / 10)}</span><span className="text-stein"> / {soll === null ? '–' : fmtStd(soll)}</span></div>
              <div className="mt-0.5"><StatusBadge status={abw.status} titel="Abweichung vom Wochensoll">{abw.text}</StatusBadge></div>
            </td>
          </tr>
        )
      })}
    </>
  )
}
