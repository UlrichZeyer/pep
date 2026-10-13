// Einsatz anlegen/bearbeiten: Abteilung (Skill-passende zuerst), Zeiten im 15-min-Raster, Vorlagen, Pause, Sperre.
import { useMemo, useState } from 'react'
import { ABWESENHEITSSTATUS, ABWESENHEITSTYPEN, type Einsatz, type Verstoss } from '../../api'
import { Button, Field, Hinweis, Icon, Modal, cx, eingabe, fmtDatumLang, fmtStd } from '../../components/ui'
import { VerstossMarker } from './bausteine'
import { fehlerText, nichtVerfuegbar, type PlanDaten } from './usePlanDaten'
import { RASTER_ZEITEN, aufRaster, gesetzlichePause, nettoStd, zuMin } from './zeit'

export interface EinsatzVorgabe {
  einsatz?: Einsatz
  mitarbeiter_id?: number
  datum: string
  abteilung_id?: number
}

const PAUSEN = [0, 15, 30, 45, 60, 75, 90]

export default function EinsatzDialog({ vorgabe, daten, onSchliessen }:
  { vorgabe: EinsatzVorgabe; daten: PlanDaten; onSchliessen: () => void }) {
  const e = vorgabe.einsatz
  const { stamm, mitarbeiterAlle, mitarbeiterNach, tage, bearbeitbar } = daten
  const [maId, setMaId] = useState<number | ''>(e?.mitarbeiter_id ?? vorgabe.mitarbeiter_id ?? '')
  const ma = maId === '' ? undefined : mitarbeiterNach[maId]
  const [datum, setDatum] = useState(e?.datum ?? vorgabe.datum)
  const [abtId, setAbtId] = useState<number | ''>(e?.abteilung_id ?? vorgabe.abteilung_id ?? ma?.stammabteilung_id ?? '')
  const [beginn, setBeginn] = useState(aufRaster(e?.beginn ?? '06:00'))
  const [ende, setEnde] = useState(aufRaster(e?.ende ?? '14:30'))
  const [pause, setPause] = useState<number>(e?.pause_min ?? 30)
  const [pauseManuell, setPauseManuell] = useState(!!e)
  const [gesperrt, setGesperrt] = useState(e?.gesperrt ?? false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false)

  const brutto = zuMin(ende) - zuMin(beginn)
  const gesetzlich = gesetzlichePause(Math.max(0, brutto))
  const netto = nettoStd(beginn, ende, pause)
  const zeitFehler = brutto <= 0 ? 'Ende muss nach dem Beginn liegen.' : null

  // Pause automatisch nachführen, solange nicht manuell gewählt
  const zeitenSetzen = (b: string, en: string, p?: number) => {
    setBeginn(b)
    setEnde(en)
    if (p !== undefined) { setPause(p); setPauseManuell(true) }
    else if (!pauseManuell) setPause(gesetzlichePause(Math.max(0, zuMin(en) - zuMin(b))))
  }

  const skillAbteilungen = useMemo(() => {
    const ids = new Set<number>()
    for (const s of ma?.skills ?? []) {
      const a = stamm.skillNach[s.skill_id]?.abteilung_id
      if (a) ids.add(a)
    }
    if (ma?.stammabteilung_id) ids.add(ma.stammabteilung_id)
    return ids
  }, [ma, stamm.skillNach])
  const abtMit = stamm.abteilungen.filter((a) => skillAbteilungen.has(a.id))
  const abtOhne = stamm.abteilungen.filter((a) => !skillAbteilungen.has(a.id))
  const ohneSkill = abtId !== '' && ma && !skillAbteilungen.has(abtId)

  const maListe = useMemo(() => [...mitarbeiterAlle].filter((m) => m.status !== 'inaktiv').sort((a, b) => a.name.localeCompare(b.name)), [mitarbeiterAlle])
  const abwesend = maId !== '' ? daten.abwesenheitNach.get(`${maId}|${datum}`) : undefined
  const verstoesse: Verstoss[] = e ? daten.verstoesseNachEinsatz.get(e.id) ?? [] : []

  const speichern = async () => {
    if (maId === '' || abtId === '' || zeitFehler) return
    setLaeuft(true)
    setFehler(null)
    try {
      await daten.speichern(e?.id ?? null, { mitarbeiter_id: maId, abteilung_id: abtId, datum, beginn, ende, pause_min: pause, gesperrt })
      onSchliessen()
    } catch (f) {
      setFehler(nichtVerfuegbar(f) ? 'Die Planungs-Schnittstelle ist im Backend noch nicht verfügbar.' : fehlerText(f))
    } finally {
      setLaeuft(false)
    }
  }

  const loeschen = async () => {
    if (!e) return
    setLaeuft(true)
    try {
      await daten.loeschen(e.id)
      onSchliessen()
    } catch (f) {
      setFehler(fehlerText(f))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Modal offen titel={e ? 'Einsatz bearbeiten' : 'Einsatz anlegen'} onSchliessen={onSchliessen}
      fuss={
        <>
          {e && bearbeitbar && (
            loeschenBestaetigen
              ? <Button variante="gefahr" icon="muell" onClick={loeschen} disabled={laeuft} className="mr-auto">Wirklich löschen</Button>
              : <Button variante="gefahr" icon="muell" onClick={() => setLoeschenBestaetigen(true)} disabled={laeuft} className="mr-auto">Löschen</Button>
          )}
          <Button onClick={onSchliessen}>Abbrechen</Button>
          <Button variante="primaer" icon="ok" onClick={speichern}
            disabled={!bearbeitbar || laeuft || maId === '' || abtId === '' || !!zeitFehler}>Speichern</Button>
        </>
      }>
      <div className="space-y-4">
        {!bearbeitbar && <Hinweis ton="info" titel="Nur Ansicht">Der Plan ist nicht im Entwurf. Zum Bearbeiten zuerst auf „Entwurf“ zurücksetzen.</Hinweis>}
        {verstoesse.length > 0 && (
          <div className="flex items-center gap-2 text-sm"><VerstossMarker verstoesse={verstoesse} /> <span className="text-stein">Regelverstöße dieses Einsatzes (anklicken für Details)</span></div>
        )}
        {fehler && <Hinweis ton="verstoss" titel="Speichern nicht möglich">{fehler}</Hinweis>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Mitarbeiter/in">
            <select className={eingabe} value={maId} onChange={(ev) => {
              const id = ev.target.value === '' ? '' : Number(ev.target.value)
              setMaId(id)
              if (!e && id !== '' && abtId === '') setAbtId(mitarbeiterNach[id]?.stammabteilung_id ?? '')
            }}>
              <option value="">– bitte wählen –</option>
              {maListe.map((m) => <option key={m.id} value={m.id}>{m.name}{m.status !== 'aktiv' ? ` (${m.status})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Datum" hinweis={fmtDatumLang(datum)}>
            <select className={eingabe} value={datum} onChange={(ev) => setDatum(ev.target.value)}>
              {(tage.includes(datum) ? tage : [datum, ...tage]).map((t) => (
                <option key={t} value={t} disabled={daten.kalenderTage[t]?.geschlossen}>
                  {fmtDatumLang(t)}{daten.kalenderTage[t]?.geschlossen ? ' – geschlossen' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {abwesend && <Hinweis ton="warn" titel="Abwesenheit an diesem Tag">{ma?.name}: {ABWESENHEITSTYPEN[abwesend.typ]} ({ABWESENHEITSSTATUS[abwesend.status]}).</Hinweis>}

        <Field label="Abteilung" fehler={ohneSkill ? 'Kein passender Skill für diese Abteilung hinterlegt.' : null}>
          <select className={eingabe} value={abtId} onChange={(ev) => setAbtId(ev.target.value === '' ? '' : Number(ev.target.value))}>
            <option value="">– bitte wählen –</option>
            {abtMit.length > 0 && (
              <optgroup label="Mit Skill">
                {abtMit.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kuerzel})</option>)}
              </optgroup>
            )}
            <optgroup label={ma ? 'Ohne Skill (nicht empfohlen)' : 'Abteilungen'}>
              {abtOhne.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kuerzel}){ma ? ' – kein Skill' : ''}</option>)}
            </optgroup>
          </select>
        </Field>

        {stamm.data?.schichtmodelle.length ? (
          <div>
            <div className="text-xs font-bold text-haselnuss mb-1">Arbeitszeitvorlagen</div>
            <div className="flex flex-wrap gap-1.5">
              {stamm.data.schichtmodelle.map((s) => {
                const aktiv = aufRaster(s.beginn) === beginn && aufRaster(s.ende) === ende
                return (
                  <button key={s.id} type="button" aria-pressed={aktiv}
                    onClick={() => zeitenSetzen(aufRaster(s.beginn), aufRaster(s.ende), Math.max(s.pause_min, gesetzlichePause(zuMin(s.ende) - zuMin(s.beginn))))}
                    className={cx('rounded-lg border px-2 py-1 text-xs font-semibold',
                      aktiv ? 'border-fell bg-fell-hell text-fell-dunkel' : 'border-sand bg-white text-rinde hover:border-fell')}>
                    {s.name} <span className="text-stein font-normal tabular-nums">{s.beginn}–{s.ende}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Beginn" fehler={zeitFehler}>
            <select className={eingabe} value={beginn} onChange={(ev) => zeitenSetzen(ev.target.value, ende)}>
              {RASTER_ZEITEN.slice(0, -1).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Ende">
            <select className={eingabe} value={ende} onChange={(ev) => zeitenSetzen(beginn, ev.target.value)}>
              {RASTER_ZEITEN.slice(1).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Pause" hinweis={pause < gesetzlich ? undefined : `gesetzlich mind. ${gesetzlich} min`}
            fehler={pause < gesetzlich ? `Gesetzlich mind. ${gesetzlich} min (§ 4 ArbZG)` : null}>
            <select className={eingabe} value={pause} onChange={(ev) => { setPause(Number(ev.target.value)); setPauseManuell(true) }}>
              {[...new Set([...PAUSEN, pause, gesetzlich])].sort((a, b) => a - b).map((p) => (
                <option key={p} value={p}>{p} min{p === gesetzlich ? ' (gesetzlich)' : ''}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-creme border border-sand px-3 py-2">
          <div className="text-sm">
            Netto-Arbeitszeit: <span className="font-extrabold tabular-nums">{fmtStd(Math.round(netto * 100) / 100)}</span>
            <span className="text-stein"> · Anwesenheit {fmtStd(Math.max(0, brutto) / 60)}</span>
          </div>
          {pause !== gesetzlich && (
            <Button klein variante="leise" onClick={() => { setPause(gesetzlich); setPauseManuell(false) }}>Gesetzliche Pause übernehmen</Button>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={gesperrt} onChange={(ev) => setGesperrt(ev.target.checked)} className="w-4 h-4 accent-fell" />
          <Icon name="schloss" className="w-4 h-4 text-haselnuss" />
          Gesperrt – die Auto-Planung darf diesen Einsatz nicht verändern
        </label>
        {e?.quelle === 'auto' && <p className="text-xs text-stein flex items-center gap-1"><Icon name="zauber" className="w-3.5 h-3.5" /> Von der Auto-Planung vorgeschlagen</p>}
      </div>
    </Modal>
  )
}
