// Jahreskalender: Feiertage BW, Hotdays (Lastfaktor), Sondertage, Schließtage, Urlaubssperren pflegen.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eachDayOfInterval, endOfMonth, endOfWeek, format, getISOWeek, isSameMonth, isSunday, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { de } from 'date-fns/locale'
import { KALENDERTYPEN, WOCHENTAGE, api, type Kalendereintrag, type KalendereintragIn, type KalenderTyp } from '../api'
import {
  Badge, Button, Card, Fehler, Field, Hinweis, Icon, Laden, Leer, Modal, SeitenKopf, Tabs,
  cx, eingabe, fmtDatum, fmtDatumLang, fmtTag, fmtZahl, toISO,
} from '../components/ui'
import { SCHRAFFUR, hotdayStil, tagInfos, tagTitel, type TagInfo } from '../components/kalender/tage'
import { Flamme } from '../components/kalender/Flamme'

const TYPEN = Object.keys(KALENDERTYPEN) as KalenderTyp[]
const QUELLEN: Record<Kalendereintrag['quelle'], { label: string; ton: 'neutral' | 'info' | 'moos' }> = {
  auto: { label: 'automatisch', ton: 'info' },
  manuell: { label: 'manuell', ton: 'moos' },
  mock: { label: 'Demo', ton: 'neutral' },
}

type Meldung = { ton: 'ok' | 'warn' | 'info'; text: string }

export default function Kalender() {
  const qc = useQueryClient()
  const [jahr, setJahr] = useState(() => new Date().getFullYear())
  const [tag, setTag] = useState<{ datum: string; eintrag?: Kalendereintrag } | null>(null)
  const [vorschlagFrage, setVorschlagFrage] = useState(false)
  const [meldung, setMeldung] = useState<Meldung | null>(null)
  const [filter, setFilter] = useState<KalenderTyp | 'alle'>('alle')

  const kal = useQuery({ queryKey: ['kalender', jahr], queryFn: () => api.kalender(jahr) })
  const infos = useMemo(() => tagInfos(kal.data), [kal.data])

  const vorschlagen = useMutation({
    mutationFn: () => api.hotdaysVorschlagen(jahr),
    onSuccess: (r) => {
      setVorschlagFrage(false)
      setMeldung({ ton: 'ok', text: `${r.erzeugt} Hotdays für ${r.jahr} automatisch vorgeschlagen. Manuell gepflegte Einträge wurden beibehalten.` })
      qc.invalidateQueries({ queryKey: ['kalender', jahr] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const eintraege = (kal.data?.eintraege ?? []).filter((e) => filter === 'alle' || e.typ === filter)
  const anzahl = (t: KalenderTyp) => (kal.data?.eintraege ?? []).filter((e) => e.typ === t).length

  return (
    <div className="space-y-5">
      <SeitenKopf titel="Kalender" untertitel={`Feiertage ${kal.data?.bundesland ?? 'BW'}, Hotdays, Sonder- und Schließtage – Grundlage für Bedarf und Urlaubsplanung`}
        aktionen={
          <>
            <span className="flex items-center gap-1">
              <Button variante="leise" icon="links" aria-label="Vorjahr" onClick={() => setJahr((j) => j - 1)} />
              <span className="font-extrabold text-lg tabular-nums w-14 text-center">{jahr}</span>
              <Button variante="leise" icon="rechts" aria-label="Folgejahr" onClick={() => setJahr((j) => j + 1)} />
            </span>
            <Button onClick={() => setJahr(new Date().getFullYear())} disabled={jahr === new Date().getFullYear()}>Aktuelles Jahr</Button>
            <Button variante="primaer" icon="zauber" onClick={() => setVorschlagFrage(true)}>Hotdays vorschlagen</Button>
          </>
        } />

      {meldung && <Hinweis ton={meldung.ton} onSchliessen={() => setMeldung(null)}>{meldung.text}</Hinweis>}

      {kal.isLoading ? <Laden /> : kal.error ? <Fehler fehler={kal.error} /> : (
        <>
          <Card polster>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, m) => (
                <MiniMonat key={m} monat={new Date(jahr, m, 1)} infos={infos} onTag={(datum) => {
                  const t = infos.get(datum)
                  setTag({ datum, eintrag: t && t.eintraege.length === 1 ? t.eintraege[0] : undefined })
                }} />
              ))}
            </div>
            <KalenderLegende />
          </Card>

          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <Card titel={`Einträge ${jahr}`} polster={false}
              aktionen={
                <Tabs aktiv={filter} onChange={setFilter} werte={[
                  { wert: 'alle', label: `Alle (${kal.data?.eintraege.length ?? 0})` },
                  ...TYPEN.map((t) => ({ wert: t, label: `${KALENDERTYPEN[t]} (${anzahl(t)})` })),
                ]} />
              }>
              {eintraege.length === 0 ? (
                <Leer titel="Keine Einträge">{filter === 'alle' ? 'Tag im Kalender anklicken oder „Hotdays vorschlagen“ nutzen.' : 'Für diesen Typ gibt es keine Einträge.'}</Leer>
              ) : (
                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                  <table className="tabelle">
                    <thead className="sticky top-0 bg-white"><tr><th>Datum</th><th>Typ</th><th>Name</th><th className="text-right">Lastfaktor</th><th>Urlaubssperre</th><th>Quelle</th><th /></tr></thead>
                    <tbody>
                      {eintraege.map((e) => (
                        <tr key={e.id}>
                          <td className="tabular-nums whitespace-nowrap">{fmtTag(e.datum)}{e.datum.slice(0, 4)}</td>
                          <td><TypBadge e={e} /></td>
                          <td>{e.name}</td>
                          <td className="text-right tabular-nums">×{fmtZahl(e.lastfaktor, 2)}</td>
                          <td>{e.urlaubssperre ? <span className="inline-flex items-center gap-1 text-haselnuss font-semibold"><Icon name="schloss" className="w-3.5 h-3.5" />gesperrt</span> : <span className="text-stein">–</span>}</td>
                          <td><Badge ton={QUELLEN[e.quelle].ton}>{QUELLEN[e.quelle].label}</Badge></td>
                          <td className="text-right"><Button klein variante="leise" icon="stift" aria-label={`${e.name} am ${fmtDatum(e.datum)} bearbeiten`} onClick={() => setTag({ datum: e.datum, eintrag: e })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card titel={`Feiertage ${kal.data?.bundesland ?? ''} ${jahr}`} polster={false}>
              {kal.data && kal.data.feiertage.length > 0 ? (
                <table className="tabelle">
                  <tbody>
                    {kal.data.feiertage.map((f) => (
                      <tr key={f.datum}>
                        <td className="tabular-nums whitespace-nowrap">{fmtTag(f.datum)}</td>
                        <td>{f.name}</td>
                        <td className="text-right"><span className="text-xs text-stein">geschlossen</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Leer titel="Keine Feiertage" />}
              <p className="px-4 py-3 text-xs text-stein">Gesetzliche Feiertage werden berechnet und sind nicht editierbar. An Feiertagen und Sonntagen bleibt die Filiale geschlossen.</p>
            </Card>
          </div>
        </>
      )}

      <Modal offen={vorschlagFrage} titel={`Hotdays ${jahr} vorschlagen`} onSchliessen={() => setVorschlagFrage(false)}
        fuss={<>
          <Button variante="leise" onClick={() => setVorschlagFrage(false)}>Abbrechen</Button>
          <Button variante="primaer" icon="zauber" disabled={vorschlagen.isPending} onClick={() => vorschlagen.mutate()} autoFocus>
            {vorschlagen.isPending ? 'Wird berechnet …' : 'Vorschlagen'}
          </Button>
        </>}>
        <div className="space-y-3 text-sm">
          <p>Hotdays werden aus den Feiertagen abgeleitet: Tage vor und nach Feiertagen, Brückentage, Osterwoche und Weihnachtsgeschäft (teils mit Urlaubssperre).</p>
          <Hinweis ton="info">Bisherige <b>automatische</b> Einträge für {jahr} werden ersetzt. <b>Manuell</b> gepflegte Einträge bleiben erhalten.</Hinweis>
          {vorschlagen.error && <Fehler fehler={vorschlagen.error} />}
        </div>
      </Modal>

      {tag && (
        <TagModal key={`${tag.datum}-${tag.eintrag?.id ?? 'neu'}`} datum={tag.datum} eintrag={tag.eintrag} info={infos.get(tag.datum)}
          onWahl={(e) => setTag({ datum: tag.datum, eintrag: e })}
          onSchliessen={() => setTag(null)}
          onFertig={(text) => { setTag(null); setMeldung({ ton: 'ok', text }) }} jahr={jahr} />
      )}
    </div>
  )
}

function TypBadge({ e }: { e: Kalendereintrag }) {
  if (e.typ === 'hotday') return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={hotdayStil(e.lastfaktor)}><Flamme />Hotday</span>
  if (e.typ === 'schliesstag') return <Badge ton="neutral">Schließtag</Badge>
  return <Badge ton="moos" icon="eichel">Sondertag</Badge>
}

function MiniMonat({ monat, infos, onTag }: { monat: Date; infos: Map<string, TagInfo>; onTag: (datum: string) => void }) {
  const tage = eachDayOfInterval({ start: startOfWeek(startOfMonth(monat), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(monat), { weekStartsOn: 1 }) })
  const wochen: Date[][] = []
  for (let i = 0; i < tage.length; i += 7) wochen.push(tage.slice(i, i + 7))
  const heute = toISO(new Date())
  return (
    <div>
      <h3 className="font-bold text-rinde capitalize mb-1.5">{format(monat, 'LLLL', { locale: de })}</h3>
      <table className="w-full text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-[10px] font-semibold text-stein/70 w-6" title="Kalenderwoche">KW</th>
            {WOCHENTAGE.map((w) => <th key={w} className="font-bold text-stein text-[11px]">{w}</th>)}
          </tr>
        </thead>
        <tbody>
          {wochen.map((w) => (
            <tr key={toISO(w[0])}>
              <td className="text-[10px] text-stein/70 text-center tabular-nums">{getISOWeek(w[0])}</td>
              {w.map((d) => {
                const iso = toISO(d)
                if (!isSameMonth(d, monat)) return <td key={iso} />
                const t = infos.get(iso)
                const zu = isSunday(d) || !!t?.feiertag || !!t?.schliesstag
                const stil = t?.hotday && !t.feiertag ? hotdayStil(t.hotday.lastfaktor) : undefined
                const titel = [fmtDatumLang(iso), tagTitel(t) || (isSunday(d) ? 'Sonntag (geschlossen)' : '')].filter(Boolean).join('\n')
                return (
                  <td key={iso} className="p-0">
                    <button type="button" onClick={() => onTag(iso)} title={titel} aria-label={titel.replace(/\n/g, ', ')}
                      className={cx('relative w-full h-7 rounded-md tabular-nums font-semibold transition-colors hover:ring-2 hover:ring-fell/50',
                        t?.feiertag ? 'text-verstoss/80 bg-sand/60' : zu ? 'text-stein bg-sand/40' : !stil && 'hover:bg-fell-hell',
                        t?.sondertag && 'ring-2 ring-moos/70 ring-inset',
                        iso === heute && 'outline outline-2 outline-rinde')}
                      style={{ ...(zu ? { backgroundImage: SCHRAFFUR } : {}), ...(stil ?? {}) }}>
                      {format(d, 'd')}
                      {t?.urlaubssperre && <Icon name="schloss" className="absolute top-0 right-0 w-2.5 h-2.5 text-haselnuss" />}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KalenderLegende() {
  const feld = 'inline-flex items-center justify-center w-6 h-5 rounded text-[10px] font-bold'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 pt-3 border-t border-sand text-xs text-stein">
      <span className="inline-flex items-center gap-1.5"><span className={cx(feld, 'bg-sand/60 text-verstoss/80')} style={{ backgroundImage: SCHRAFFUR }}>1</span>Feiertag BW (geschlossen)</span>
      <span className="inline-flex items-center gap-1.5"><span className={cx(feld, 'bg-sand/40')} style={{ backgroundImage: SCHRAFFUR }}>7</span>Sonntag / Schließtag</span>
      <span className="inline-flex items-center gap-1.5">Hotday nach Lastfaktor:
        {[1.2, 1.3, 1.5, 1.6].map((l) => <span key={l} className={feld} style={hotdayStil(l)} title={`Lastfaktor ab ×${fmtZahl(l, 1)}`}>{fmtZahl(l, 1)}</span>)}
      </span>
      <span className="inline-flex items-center gap-1.5"><span className={cx(feld, 'ring-2 ring-moos/70 ring-inset')}>5</span>Sondertag</span>
      <span className="inline-flex items-center gap-1"><Icon name="schloss" className="w-3 h-3 text-haselnuss" />Urlaubssperre</span>
      <span className="inline-flex items-center gap-1.5"><span className={cx(feld, 'outline outline-2 outline-rinde')}>13</span>Heute</span>
    </div>
  )
}

function TagModal({ datum, eintrag, info, jahr, onWahl, onSchliessen, onFertig }: {
  datum: string; eintrag?: Kalendereintrag; info?: TagInfo; jahr: number
  onWahl: (e?: Kalendereintrag) => void; onSchliessen: () => void; onFertig: (text: string) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<KalendereintragIn>(() => eintrag
    ? { datum: eintrag.datum, typ: eintrag.typ, name: eintrag.name, lastfaktor: eintrag.lastfaktor, urlaubssperre: eintrag.urlaubssperre }
    : { datum, typ: 'hotday', name: '', lastfaktor: 1.3, urlaubssperre: false })
  const [loeschenFrage, setLoeschenFrage] = useState(false)
  const set = <K extends keyof KalendereintragIn>(k: K, v: KalendereintragIn[K]) => setForm((f) => ({ ...f, [k]: v }))

  const nachher = () => {
    qc.invalidateQueries({ queryKey: ['kalender', jahr] })
    if (form.datum.slice(0, 4) !== String(jahr)) qc.invalidateQueries({ queryKey: ['kalender', Number(form.datum.slice(0, 4))] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const speichern = useMutation({
    mutationFn: (d: KalendereintragIn) => (eintrag ? api.kalendereintragAendern(eintrag.id, d) : api.kalendereintragAnlegen(d)),
    onSuccess: (e) => { nachher(); onFertig(`${KALENDERTYPEN[e.typ]} „${e.name}“ am ${fmtDatum(e.datum)} gespeichert.`) },
  })
  const loeschen = useMutation({
    mutationFn: () => api.kalendereintragLoeschen(eintrag!.id),
    onSuccess: () => { nachher(); onFertig(`Eintrag „${eintrag!.name}“ gelöscht.`) },
  })

  const lfGueltig = form.lastfaktor >= 0.5 && form.lastfaktor <= 3
  const gueltig = form.name.trim() !== '' && !!form.datum && lfGueltig
  const andere = (info?.eintraege ?? []).filter((e) => e.id !== eintrag?.id)
  const sonntag = isSunday(parseISO(datum))

  return (
    <Modal offen titel={fmtDatumLang(datum)} onSchliessen={onSchliessen}
      fuss={<>
        {eintrag && !loeschenFrage && <Button variante="gefahr" icon="muell" className="mr-auto" onClick={() => setLoeschenFrage(true)}>Löschen</Button>}
        {eintrag && loeschenFrage && (
          <span className="mr-auto flex items-center gap-2 text-sm">Wirklich löschen?
            <Button klein variante="gefahr" disabled={loeschen.isPending} onClick={() => loeschen.mutate()}>Ja, löschen</Button>
            <Button klein variante="leise" onClick={() => setLoeschenFrage(false)}>Nein</Button>
          </span>
        )}
        <Button variante="leise" onClick={onSchliessen}>Abbrechen</Button>
        <Button variante="primaer" type="submit" form="kalender-form" disabled={!gueltig || speichern.isPending}>{speichern.isPending ? 'Speichert …' : eintrag ? 'Speichern' : 'Anlegen'}</Button>
      </>}>
      <div className="space-y-4">
        {info?.feiertag && <Hinweis ton="info" titel={`Feiertag: ${info.feiertag}`}>Gesetzlicher Feiertag in Baden-Württemberg – die Filiale ist geschlossen. Feiertage werden nur angezeigt.</Hinweis>}
        {sonntag && !info?.feiertag && <Hinweis ton="info">Sonntag – die Filiale ist geschlossen.</Hinweis>}

        {(andere.length > 0 || eintrag) && (
          <div>
            <div className="text-xs font-bold text-haselnuss mb-1">Einträge an diesem Tag</div>
            <ul className="space-y-1">
              {(info?.eintraege ?? []).map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onWahl(e)}
                    className={cx('w-full flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-left hover:border-fell',
                      e.id === eintrag?.id ? 'border-fell bg-fell-hell/50' : 'border-sand')}>
                    <TypBadge e={e} /><span className="flex-1 truncate">{e.name}</span>
                    {e.urlaubssperre && <Icon name="schloss" className="w-3.5 h-3.5 text-haselnuss" titel="Urlaubssperre" />}
                    <Badge ton={QUELLEN[e.quelle].ton}>{QUELLEN[e.quelle].label}</Badge>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => onWahl(undefined)}
                  className={cx('w-full flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm text-haselnuss hover:border-fell',
                    !eintrag ? 'border-fell bg-fell-hell/50' : 'border-sand')}>
                  <Icon name="plus" /> Weiteren Eintrag anlegen
                </button>
              </li>
            </ul>
          </div>
        )}

        <form id="kalender-form" className="grid grid-cols-2 gap-3"
          onSubmit={(e) => { e.preventDefault(); if (gueltig) speichern.mutate({ ...form, name: form.name.trim() }) }}>
          <Field label="Typ">
            <select className={eingabe} value={form.typ} onChange={(e) => {
              const typ = e.target.value as KalenderTyp
              setForm((f) => ({ ...f, typ, lastfaktor: typ === 'schliesstag' ? 1 : f.lastfaktor }))
            }}>
              {TYPEN.map((t) => <option key={t} value={t}>{KALENDERTYPEN[t]}</option>)}
            </select>
          </Field>
          <Field label="Datum">
            <input type="date" className={eingabe} value={form.datum} required onChange={(e) => set('datum', e.target.value)} />
          </Field>
          <Field label="Name" className="col-span-2" fehler={form.name.trim() === '' && eintrag ? 'Name fehlt' : null}>
            <input className={eingabe} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus
              placeholder={form.typ === 'hotday' ? 'z. B. Aktionswoche, Brückentag' : form.typ === 'sondertag' ? 'z. B. Inventur' : 'z. B. Umbau'} />
          </Field>
          {form.typ !== 'schliesstag' && (
            <Field label="Lastfaktor" className="col-span-2" hinweis="Multiplikator auf den üblichen Bedarf (1,0 = normal, 1,5 = 50 % mehr)." fehler={lfGueltig ? null : 'Wert zwischen 0,5 und 3,0'}>
              <div className="flex items-center gap-3">
                <input type="range" min={1} max={2} step={0.05} value={Math.min(2, Math.max(1, form.lastfaktor))} className="flex-1 accent-[var(--color-fell)]"
                  aria-label="Lastfaktor (Schieberegler)" onChange={(e) => set('lastfaktor', Number(e.target.value))} />
                <input type="number" min={0.5} max={3} step={0.05} className={cx(eingabe, 'w-24 text-right tabular-nums')} aria-label="Lastfaktor"
                  value={form.lastfaktor} onChange={(e) => set('lastfaktor', e.target.value === '' ? 0 : Number(e.target.value))} />
                {form.typ === 'hotday' && <span className="inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-bold" style={hotdayStil(form.lastfaktor)}><Flamme /></span>}
              </div>
            </Field>
          )}
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-4 h-4 accent-[var(--color-fell)]" checked={form.urlaubssperre} onChange={(e) => set('urlaubssperre', e.target.checked)} />
            <Icon name="schloss" className="w-4 h-4 text-haselnuss" /> Urlaubssperre (neue Urlaubsanträge erhalten einen Hinweis)
          </label>
          {eintrag?.quelle === 'auto' && <p className="col-span-2 text-xs text-stein">Automatisch vorgeschlagener Eintrag – beim Speichern wird er zu „manuell“ und bleibt bei neuen Vorschlägen erhalten.</p>}
          {(speichern.error || loeschen.error) && <div className="col-span-2"><Fehler fehler={speichern.error ?? loeschen.error} /></div>}
        </form>
      </div>
    </Modal>
  )
}
