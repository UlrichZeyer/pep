// Abwesenheiten: Monats-Zeitstrahl (Zeilen = Mitarbeiter, Spalten = Tage), Anlegen/Bearbeiten, offene Anträge.
import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addMonths, addYears, eachDayOfInterval, endOfMonth, format, isSameMonth, isSunday, parseISO, startOfMonth } from 'date-fns'
import { de } from 'date-fns/locale'
import {
  ABWESENHEITSKUERZEL, ABWESENHEITSSTATUS, ABWESENHEITSTYPEN, VERTRAGSARTEN, api,
  type Abwesenheit, type AbwesenheitIn, type AbwesenheitStatus, type AbwesenheitTyp, type Mitarbeiter,
} from '../api'
import {
  AbteilungsPunkt, Badge, Button, Card, Fehler, Field, Hinweis, Icon, Laden, Leer, Modal, SeitenKopf,
  cx, eingabe, fmtDatum, fmtDatumKurz, toISO,
} from '../components/ui'
import { useMitarbeiter, useStammdaten } from '../hooks'
import { ABWESENHEITSFARBEN, SCHRAFFUR, tagInfos, tagTitel } from '../components/kalender/tage'
import { Flamme } from '../components/kalender/Flamme'

const TYPEN = Object.keys(ABWESENHEITSTYPEN) as AbwesenheitTyp[]
const STATI = Object.keys(ABWESENHEITSSTATUS) as AbwesenheitStatus[]
const NAMENSSPALTE = 210
const SPUR_HOEHE = 24

type ModalZustand = { abwesenheit?: Abwesenheit; mitarbeiter_id?: number; datum?: string }
type Meldung = { ton: 'ok' | 'warn'; titel: string; zeilen: string[] }

/** Stil eines Abwesenheitsbalkens je Typ und Status. */
function balkenStil(typ: AbwesenheitTyp, status: AbwesenheitStatus): CSSProperties {
  const f = ABWESENHEITSFARBEN[typ]
  if (status === 'genehmigt') return { backgroundColor: f.voll, color: '#fff', borderColor: f.voll }
  if (status === 'beantragt') return { backgroundColor: f.hell, color: f.voll, borderColor: f.voll, borderStyle: 'dashed' }
  return { backgroundColor: '#F4F1EC', color: '#7D7268', borderColor: '#D9D0C4', textDecoration: 'line-through' }
}

function zeitraum(a: Pick<Abwesenheit, 'von' | 'bis'>) {
  return a.von === a.bis ? fmtDatum(a.von) : `${fmtDatumKurz(a.von)}–${fmtDatum(a.bis)}`
}

/** Überlappende Abwesenheiten auf Spuren verteilen (gierig nach Beginn). */
function spurenVerteilen(liste: Abwesenheit[]): { a: Abwesenheit; spur: number }[] {
  const enden: string[] = []
  return [...liste].sort((x, y) => x.von.localeCompare(y.von) || x.bis.localeCompare(y.bis)).map((a) => {
    let spur = enden.findIndex((e) => e < a.von)
    if (spur < 0) { spur = enden.length; enden.push(a.bis) } else enden[spur] = a.bis
    return { a, spur }
  })
}

export default function Abwesenheiten() {
  const qc = useQueryClient()
  const [monat, setMonat] = useState(() => startOfMonth(new Date()))
  const [abteilung, setAbteilung] = useState<number | ''>('')
  const [suche, setSuche] = useState('')
  const [modal, setModal] = useState<ModalZustand | null>(null)
  const [meldung, setMeldung] = useState<Meldung | null>(null)

  const von = toISO(monat)
  const bis = toISO(endOfMonth(monat))
  const tage = useMemo(() => eachDayOfInterval({ start: monat, end: endOfMonth(monat) }), [monat])
  const heute = toISO(new Date())

  const stamm = useStammdaten()
  const ma = useMitarbeiter()
  const abw = useQuery({ queryKey: ['abwesenheiten', von, bis], queryFn: () => api.abwesenheiten(von, bis) })
  const kal = useQuery({ queryKey: ['kalender', monat.getFullYear()], queryFn: () => api.kalender(monat.getFullYear()) })
  const infos = useMemo(() => tagInfos(kal.data), [kal.data])

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return ma.liste
      .filter((m) => m.status !== 'inaktiv' && m.eintritt <= bis && (!m.austritt || m.austritt >= von))
      .filter((m) => abteilung === '' || m.stammabteilung_id === abteilung)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || m.persnr.toLowerCase().includes(s))
      .sort((x, y) => {
        const sx = x.stammabteilung_id ? stamm.abteilungNach[x.stammabteilung_id]?.sortierung ?? 99 : 99
        const sy = y.stammabteilung_id ? stamm.abteilungNach[y.stammabteilung_id]?.sortierung ?? 99 : 99
        return sx - sy || x.nachname.localeCompare(y.nachname, 'de')
      })
  }, [ma.liste, suche, abteilung, von, bis, stamm.abteilungNach])

  const jeMitarbeiter = useMemo(() => {
    const m = new Map<number, Abwesenheit[]>()
    for (const a of abw.data ?? []) m.set(a.mitarbeiter_id, [...(m.get(a.mitarbeiter_id) ?? []), a])
    return m
  }, [abw.data])

  function fertig(warnungen: string[], text: string) {
    setModal(null)
    setMeldung(warnungen.length
      ? { ton: 'warn', titel: `${text} – bitte Hinweise prüfen`, zeilen: warnungen }
      : { ton: 'ok', titel: text, zeilen: [] })
  }

  const spalten = `${NAMENSSPALTE}px repeat(${tage.length}, minmax(28px, 1fr))`
  const geschlossen = (d: Date) => isSunday(d) || !!infos.get(toISO(d))?.feiertag || !!infos.get(toISO(d))?.schliesstag

  return (
    <div className="space-y-5">
      <SeitenKopf titel="Abwesenheiten" untertitel="Urlaub, Krankheit, Berufsschule & Co. im Monatsüberblick"
        aktionen={<Button variante="primaer" icon="plus" onClick={() => setModal({ datum: heute >= von && heute <= bis ? heute : von })}>Abwesenheit erfassen</Button>} />

      {meldung && (
        <Hinweis ton={meldung.ton} titel={meldung.titel} onSchliessen={() => setMeldung(null)}>
          {meldung.zeilen.length > 0 && <ul className="list-disc pl-4">{meldung.zeilen.map((z) => <li key={z}>{z}</li>)}</ul>}
        </Hinweis>
      )}

      <Card polster={false}
        titel={
          <span className="flex items-center gap-2">
            <Button variante="leise" klein icon="links" aria-label="Vormonat" onClick={() => setMonat((m) => addMonths(m, -1))} />
            <span className="min-w-36 text-center capitalize">{format(monat, 'LLLL yyyy', { locale: de })}</span>
            <Button variante="leise" klein icon="rechts" aria-label="Folgemonat" onClick={() => setMonat((m) => addMonths(m, 1))} />
            <Button klein onClick={() => setMonat(startOfMonth(new Date()))} disabled={isSameMonth(monat, new Date())}>Heute</Button>
          </span>
        }
        aktionen={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Icon name="suche" className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-stein" />
              <input className={cx(eingabe, 'pl-8 w-48')} placeholder="Name oder Pers.-Nr." aria-label="Mitarbeiter suchen"
                value={suche} onChange={(e) => setSuche(e.target.value)} />
            </div>
            <select className={cx(eingabe, 'w-48')} aria-label="Abteilung filtern" value={abteilung}
              onChange={(e) => setAbteilung(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Alle Abteilungen</option>
              {stamm.abteilungen.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        }>
        {ma.isLoading || abw.isLoading ? <Laden /> : ma.error ? <div className="p-4"><Fehler fehler={ma.error} /></div>
          : abw.error ? <div className="p-4"><Fehler fehler={abw.error} /></div>
          : sichtbar.length === 0 ? <Leer titel="Keine Mitarbeiter gefunden">Filter oder Suche anpassen.</Leer>
          : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: NAMENSSPALTE + tage.length * 28 }}>
                {/* Kopfzeile mit Tagen */}
                <div className="grid border-b-2 border-sand sticky top-0 bg-white z-20" style={{ gridTemplateColumns: spalten }}>
                  <div className="sticky left-0 bg-white z-10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-stein flex items-end">
                    Mitarbeiter ({sichtbar.length})
                  </div>
                  {tage.map((d) => {
                    const iso = toISO(d)
                    const t = infos.get(iso)
                    const zu = geschlossen(d)
                    return (
                      <div key={iso} title={[fmtDatum(iso), tagTitel(t) || (isSunday(d) ? 'Sonntag (geschlossen)' : '')].filter(Boolean).join('\n')}
                        className={cx('text-center py-1 text-[11px] leading-tight border-l border-sand/60', zu ? 'text-stein' : 'text-rinde',
                          iso === heute && 'border-b-2 border-b-fell font-extrabold')}
                        style={zu ? { backgroundImage: SCHRAFFUR } : undefined}>
                        <div className="uppercase text-stein">{format(d, 'EEEEEE', { locale: de })}</div>
                        <div className="font-bold tabular-nums">{format(d, 'd')}</div>
                        <div className="h-3.5 flex items-center justify-center gap-px">
                          {t?.hotday && <span className="text-fell"><Flamme className="w-3 h-3" /></span>}
                          {t?.urlaubssperre && <span className="text-haselnuss"><Icon name="schloss" className="w-3 h-3" /></span>}
                          {t?.sondertag && !t.hotday && <span className="text-moos"><Icon name="eichel" className="w-3 h-3" /></span>}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Zeilen je Mitarbeiter */}
                {sichtbar.map((m) => (
                  <MitarbeiterZeile key={m.id} m={m} tage={tage} spalten={spalten} heute={heute}
                    farbe={m.stammabteilung_id ? stamm.abteilungNach[m.stammabteilung_id]?.farbe : undefined}
                    abwesenheiten={jeMitarbeiter.get(m.id) ?? []} geschlossen={geschlossen}
                    monatVon={von} monatBis={bis}
                    onNeu={(datum) => setModal({ mitarbeiter_id: m.id, datum })}
                    onBearbeiten={(a) => setModal({ abwesenheit: a })} />
                ))}
              </div>
            </div>
          )}
        <Legende />
      </Card>

      <OffeneAntraege nach={ma.nach} onFertig={fertig} onBearbeiten={(a) => setModal({ abwesenheit: a })} />

      {modal && (
        <AbwesenheitModal zustand={modal} mitarbeiter={ma.liste} onSchliessen={() => setModal(null)} onFertig={fertig}
          onGeloescht={() => { setModal(null); setMeldung({ ton: 'ok', titel: 'Abwesenheit gelöscht', zeilen: [] }); qc.invalidateQueries({ queryKey: ['abwesenheiten'] }) }} />
      )}
    </div>
  )
}

function MitarbeiterZeile({ m, tage, spalten, heute, farbe, abwesenheiten, geschlossen, monatVon, monatBis, onNeu, onBearbeiten }: {
  m: Mitarbeiter; tage: Date[]; spalten: string; heute: string; farbe?: string; abwesenheiten: Abwesenheit[]
  geschlossen: (d: Date) => boolean; monatVon: string; monatBis: string
  onNeu: (datum: string) => void; onBearbeiten: (a: Abwesenheit) => void
}) {
  const verteilt = spurenVerteilen(abwesenheiten)
  const spuren = Math.max(1, ...verteilt.map((v) => v.spur + 1))
  const ersterTag = parseISO(monatVon).getDate()
  return (
    <div className="grid border-b border-sand hover:bg-[#FDFAF5] group"
      style={{ gridTemplateColumns: spalten, gridTemplateRows: `repeat(${spuren}, ${SPUR_HOEHE}px)`, paddingBlock: 3 }}>
      <div className="sticky left-0 z-10 bg-white group-hover:bg-[#FDFAF5] px-3 flex items-center gap-2 min-w-0" style={{ gridColumn: 1, gridRow: '1 / -1' }}>
        {farbe && <AbteilungsPunkt farbe={farbe} />}
        <Link to={`/mitarbeiter/${m.id}`} className="truncate text-sm font-semibold hover:text-fell-dunkel hover:underline" title={m.name}>{m.name}</Link>
        {m.vertrag && <span className="text-[11px] text-stein shrink-0">{VERTRAGSARTEN[m.vertrag.art]}</span>}
        <button type="button" onClick={() => onNeu(heute >= monatVon && heute <= monatBis ? heute : monatVon)}
          className="ml-auto shrink-0 text-stein opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-fell-dunkel"
          aria-label={`Abwesenheit für ${m.name} erfassen`} title="Abwesenheit erfassen">
          <Icon name="plus" className="w-3.5 h-3.5" />
        </button>
      </div>
      {tage.map((d, i) => {
        const iso = toISO(d)
        return (
          <button key={iso} type="button" tabIndex={-1} onClick={() => onNeu(iso)}
            aria-label={`Abwesenheit für ${m.name} am ${fmtDatum(iso)} erfassen`}
            className={cx('border-l border-sand/60 hover:bg-fell-hell/60', iso === heute && 'bg-fell-hell/30')}
            style={{ gridColumn: i + 2, gridRow: '1 / -1', ...(geschlossen(d) ? { backgroundImage: SCHRAFFUR } : {}) }} />
        )
      })}
      {verteilt.map(({ a, spur }) => {
        const start = a.von < monatVon ? 1 : parseISO(a.von).getDate() - ersterTag + 1
        const ende = a.bis > monatBis ? tage.length : parseISO(a.bis).getDate() - ersterTag + 1
        const breite = ende - start + 1
        return (
          <button key={a.id} type="button" onClick={() => onBearbeiten(a)}
            title={`${ABWESENHEITSTYPEN[a.typ]} ${zeitraum(a)} (${ABWESENHEITSSTATUS[a.status]})${a.notiz ? ` – ${a.notiz}` : ''}`}
            aria-label={`${m.name}: ${ABWESENHEITSTYPEN[a.typ]} ${zeitraum(a)}, ${ABWESENHEITSSTATUS[a.status]} – bearbeiten`}
            className={cx('relative z-[5] my-[2px] mx-px border text-[11px] font-bold leading-none flex items-center gap-1 px-1.5 overflow-hidden whitespace-nowrap hover:brightness-95',
              a.von < monatVon ? 'rounded-l-none' : 'rounded-l-md', a.bis > monatBis ? 'rounded-r-none' : 'rounded-r-md')}
            style={{ gridColumn: `${start + 1} / ${ende + 2}`, gridRow: spur + 1, ...balkenStil(a.typ, a.status) }}>
            {ABWESENHEITSKUERZEL[a.typ]}
            {a.status === 'beantragt' && <span aria-hidden>?</span>}
            {breite >= 4 && <span className="font-semibold opacity-90 truncate">{ABWESENHEITSTYPEN[a.typ]}{a.status !== 'genehmigt' ? ` · ${ABWESENHEITSSTATUS[a.status]}` : ''}</span>}
          </button>
        )
      })}
    </div>
  )
}

function Legende() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-sand text-xs text-stein">
      {TYPEN.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center rounded px-1 min-w-6 h-4 text-[10px] font-bold" style={balkenStil(t, 'genehmigt')}>{ABWESENHEITSKUERZEL[t]}</span>
          {ABWESENHEITSTYPEN[t]}
        </span>
      ))}
      <span className="w-px h-4 bg-sand" aria-hidden />
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-6 h-4 rounded border" style={balkenStil('urlaub', 'beantragt')} />beantragt</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center justify-center w-6 h-4 rounded border text-[10px] font-bold" style={balkenStil('urlaub', 'abgelehnt')}>U</span>abgelehnt</span>
      <span className="w-px h-4 bg-sand" aria-hidden />
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded border border-sand" style={{ backgroundImage: SCHRAFFUR }} />Sonntag/Feiertag (geschlossen)</span>
      <span className="inline-flex items-center gap-1"><span className="text-fell"><Flamme /></span>Hotday</span>
      <span className="inline-flex items-center gap-1"><span className="text-haselnuss"><Icon name="schloss" className="w-3 h-3" /></span>Urlaubssperre</span>
      <span className="inline-flex items-center gap-1"><span className="text-moos"><Icon name="eichel" className="w-3 h-3" /></span>Sondertag</span>
    </div>
  )
}

function OffeneAntraege({ nach, onFertig, onBearbeiten }: {
  nach: Record<number, Mitarbeiter>; onFertig: (w: string[], text: string) => void; onBearbeiten: (a: Abwesenheit) => void
}) {
  const qc = useQueryClient()
  const heute = new Date()
  const von = toISO(addYears(heute, -1))
  const bis = toISO(addYears(heute, 2))
  const q = useQuery({ queryKey: ['abwesenheiten', 'offen', von, bis], queryFn: () => api.abwesenheiten(von, bis) })
  const offen = (q.data ?? []).filter((a) => a.status === 'beantragt').sort((x, y) => x.von.localeCompare(y.von))
  const entscheiden = useMutation({
    mutationFn: ({ a, status }: { a: Abwesenheit; status: AbwesenheitStatus }) =>
      api.abwesenheitAendern(a.id, { mitarbeiter_id: a.mitarbeiter_id, von: a.von, bis: a.bis, typ: a.typ, status, notiz: a.notiz }),
    onSuccess: (r, { status }) => {
      qc.invalidateQueries({ queryKey: ['abwesenheiten'] })
      qc.invalidateQueries({ queryKey: ['mitarbeiter'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onFertig(r.warnungen, `Antrag ${status === 'genehmigt' ? 'genehmigt' : 'abgelehnt'}`)
    },
  })
  return (
    <Card titel={<span className="flex items-center gap-2">Offene Anträge {offen.length > 0 && <Badge ton="warn" icon="warn">{offen.length} offen</Badge>}</span>} polster={false}>
      {q.isLoading ? <Laden /> : q.error ? <div className="p-4"><Fehler fehler={q.error} /></div>
        : offen.length === 0 ? <Leer titel="Keine offenen Anträge">Alle Urlaubsanträge sind entschieden.</Leer>
        : (
          <div className="overflow-x-auto">
            {entscheiden.error && <div className="p-3"><Fehler fehler={entscheiden.error} /></div>}
            <table className="tabelle">
              <thead><tr><th>Mitarbeiter</th><th>Art</th><th>Zeitraum</th><th>Notiz</th><th className="text-right">Entscheidung</th></tr></thead>
              <tbody>
                {offen.map((a) => (
                  <tr key={a.id}>
                    <td className="font-semibold">{nach[a.mitarbeiter_id]?.name ?? `#${a.mitarbeiter_id}`}</td>
                    <td><span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center justify-center rounded px-1 min-w-6 h-4 text-[10px] font-bold border" style={balkenStil(a.typ, 'beantragt')}>{ABWESENHEITSKUERZEL[a.typ]}</span>
                      {ABWESENHEITSTYPEN[a.typ]}</span></td>
                    <td className="tabular-nums">{zeitraum(a)}</td>
                    <td className="text-stein">{a.notiz || '–'}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Button klein variante="leise" icon="stift" onClick={() => onBearbeiten(a)} aria-label="Antrag bearbeiten" />
                        <Button klein icon="ok" disabled={entscheiden.isPending} onClick={() => entscheiden.mutate({ a, status: 'genehmigt' })}>Genehmigen</Button>
                        <Button klein variante="gefahr" icon="x" disabled={entscheiden.isPending} onClick={() => entscheiden.mutate({ a, status: 'abgelehnt' })}>Ablehnen</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  )
}

function AbwesenheitModal({ zustand, mitarbeiter, onSchliessen, onFertig, onGeloescht }: {
  zustand: ModalZustand; mitarbeiter: Mitarbeiter[]; onSchliessen: () => void
  onFertig: (w: string[], text: string) => void; onGeloescht: () => void
}) {
  const qc = useQueryClient()
  const a = zustand.abwesenheit
  const [form, setForm] = useState<AbwesenheitIn>(() => a
    ? { mitarbeiter_id: a.mitarbeiter_id, von: a.von, bis: a.bis, typ: a.typ, status: a.status, notiz: a.notiz }
    : { mitarbeiter_id: zustand.mitarbeiter_id ?? 0, von: zustand.datum ?? toISO(new Date()), bis: zustand.datum ?? toISO(new Date()), typ: 'urlaub', status: 'genehmigt', notiz: null })
  const [loeschenFrage, setLoeschenFrage] = useState(false)
  const set = <K extends keyof AbwesenheitIn>(k: K, v: AbwesenheitIn[K]) => setForm((f) => ({ ...f, [k]: v }))

  const nachher = () => {
    qc.invalidateQueries({ queryKey: ['abwesenheiten'] })
    qc.invalidateQueries({ queryKey: ['mitarbeiter'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const speichern = useMutation({
    mutationFn: (d: AbwesenheitIn) => (a ? api.abwesenheitAendern(a.id, d) : api.abwesenheitAnlegen(d)),
    onSuccess: (r) => { nachher(); onFertig(r.warnungen, a ? 'Abwesenheit gespeichert' : 'Abwesenheit angelegt') },
  })
  const loeschen = useMutation({
    mutationFn: () => api.abwesenheitLoeschen(a!.id),
    onSuccess: () => { nachher(); onGeloescht() },
  })

  const fehlerBis = form.bis < form.von ? 'Bis-Datum liegt vor dem Von-Datum' : null
  const fehlerMa = !form.mitarbeiter_id ? 'Bitte Mitarbeiter wählen' : null
  const gueltig = !fehlerBis && !fehlerMa && form.von && form.bis
  const sortiert = [...mitarbeiter].filter((m) => m.status !== 'inaktiv' || m.id === form.mitarbeiter_id)
    .sort((x, y) => x.nachname.localeCompare(y.nachname, 'de'))

  return (
    <Modal offen titel={a ? 'Abwesenheit bearbeiten' : 'Abwesenheit erfassen'} onSchliessen={onSchliessen}
      fuss={
        <>
          {a && !loeschenFrage && <Button variante="gefahr" icon="muell" className="mr-auto" onClick={() => setLoeschenFrage(true)}>Löschen</Button>}
          {a && loeschenFrage && (
            <span className="mr-auto flex items-center gap-2 text-sm">
              Wirklich löschen?
              <Button klein variante="gefahr" disabled={loeschen.isPending} onClick={() => loeschen.mutate()}>Ja, löschen</Button>
              <Button klein variante="leise" onClick={() => setLoeschenFrage(false)}>Nein</Button>
            </span>
          )}
          <Button variante="leise" onClick={onSchliessen}>Abbrechen</Button>
          <Button variante="primaer" type="submit" form="abwesenheit-form" disabled={!gueltig || speichern.isPending}>
            {speichern.isPending ? 'Speichert …' : 'Speichern'}
          </Button>
        </>
      }>
      <form id="abwesenheit-form" className="grid grid-cols-2 gap-3"
        onSubmit={(e) => { e.preventDefault(); if (gueltig) speichern.mutate({ ...form, notiz: form.notiz?.trim() || null }) }}>
        <Field label="Mitarbeiter" className="col-span-2" fehler={form.mitarbeiter_id ? null : fehlerMa}>
          <select className={eingabe} value={form.mitarbeiter_id || ''} onChange={(e) => set('mitarbeiter_id', Number(e.target.value))} autoFocus={!a}>
            <option value="">– bitte wählen –</option>
            {sortiert.map((m) => <option key={m.id} value={m.id}>{m.nachname}, {m.vorname} ({m.persnr})</option>)}
          </select>
        </Field>
        <Field label="Art">
          <select className={eingabe} value={form.typ} onChange={(e) => set('typ', e.target.value as AbwesenheitTyp)}>
            {TYPEN.map((t) => <option key={t} value={t}>{ABWESENHEITSTYPEN[t]}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={eingabe} value={form.status} onChange={(e) => set('status', e.target.value as AbwesenheitStatus)}>
            {STATI.map((s) => <option key={s} value={s}>{ABWESENHEITSSTATUS[s]}</option>)}
          </select>
        </Field>
        <Field label="Von">
          <input type="date" className={eingabe} value={form.von} required
            onChange={(e) => setForm((f) => ({ ...f, von: e.target.value, bis: f.bis < e.target.value ? e.target.value : f.bis }))} />
        </Field>
        <Field label="Bis" fehler={fehlerBis}>
          <input type="date" className={eingabe} value={form.bis} min={form.von} required onChange={(e) => set('bis', e.target.value)} />
        </Field>
        <Field label="Notiz" className="col-span-2">
          <textarea className={eingabe} rows={2} value={form.notiz ?? ''} onChange={(e) => set('notiz', e.target.value)} placeholder="optional" />
        </Field>
        {form.typ === 'urlaub' && (
          <p className="col-span-2 text-xs text-stein">Urlaub in Sperrzeiten (z. B. Weihnachtsgeschäft) wird gespeichert, aber mit Hinweis gemeldet.</p>
        )}
        {(speichern.error || loeschen.error) && <div className="col-span-2"><Fehler fehler={speichern.error ?? loeschen.error} /></div>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
