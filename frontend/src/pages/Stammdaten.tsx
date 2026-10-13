// Stammdaten: Abteilungen, Warengruppen (Leistungswerte), Skills, Arbeitszeitvorlagen, Regelparameter.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SKILLKATEGORIEN, api, type Abteilung, type Bedarfsart, type Regelparameter, type SkillKategorie, type Warengruppe,
} from '../api'
import {
  AbteilungsPunkt, Badge, Button, Card, Fehler, Field, Hinweis, Icon, Laden, Leer, Modal, SeitenKopf, Tabs,
  cx, eingabe, fmtStd, fmtZahl,
} from '../components/ui'
import { useStammdaten } from '../hooks'

type Reiter = 'abteilungen' | 'warengruppen' | 'skills' | 'schichten' | 'regeln'
const REITER: { wert: Reiter; label: string }[] = [
  { wert: 'abteilungen', label: 'Abteilungen' },
  { wert: 'warengruppen', label: 'Warengruppen' },
  { wert: 'skills', label: 'Skills' },
  { wert: 'schichten', label: 'Arbeitszeitvorlagen' },
  { wert: 'regeln', label: 'Regelparameter' },
]
const BEDARFSARTEN: Record<Bedarfsart, { label: string; erklaerung: string }> = {
  paletten: { label: 'Paletten', erklaerung: 'Bedarf aus prognostizierten Paletten ÷ Leistungswert' },
  frequenz: { label: 'Kundenfrequenz', erklaerung: 'Bedarf aus Kunden je 30 Minuten (Kassen)' },
  fix: { label: 'Fix', erklaerung: 'feste Mindestbesetzung im Arbeitszeitfenster' },
}

const zeitMin = (z: string) => { const [h, m] = z.split(':').map(Number); return h * 60 + m }

export default function Stammdaten() {
  const [reiter, setReiter] = useState<Reiter>('abteilungen')
  const st = useStammdaten()
  return (
    <div className="space-y-5">
      <SeitenKopf titel="Stammdaten" untertitel="Abteilungen, Leistungswerte, Skills, Schichtvorlagen und Regelparameter der Filiale" />
      <Tabs werte={REITER} aktiv={reiter} onChange={setReiter} />
      {st.isLoading ? <Laden /> : st.error ? <Fehler fehler={st.error} /> : (
        <>
          {reiter === 'abteilungen' && <AbteilungenTab />}
          {reiter === 'warengruppen' && <WarengruppenTab />}
          {reiter === 'skills' && <SkillsTab />}
          {reiter === 'schichten' && <SchichtenTab />}
          {reiter === 'regeln' && <RegelnTab />}
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Abteilungen
function AbteilungenTab() {
  const { abteilungen } = useStammdaten()
  const [bearbeiten, setBearbeiten] = useState<Abteilung | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      {ok && <Hinweis ton="ok" onSchliessen={() => setOk(null)}>{ok}</Hinweis>}
      <Card polster={false}>
        {abteilungen.length === 0 ? <Leer titel="Keine Abteilungen" /> : (
          <div className="overflow-x-auto">
            <table className="tabelle">
              <thead><tr><th>Abteilung</th><th>Kürzel</th><th>Bedarfsart</th><th style={{ textAlign: 'right' }}>Mindestbesetzung</th><th>Arbeitszeitfenster</th><th /></tr></thead>
              <tbody>
                {abteilungen.map((a) => (
                  <tr key={a.id}>
                    <td><span className="inline-flex items-center gap-2 font-semibold"><AbteilungsPunkt farbe={a.farbe} className="w-3 h-3" />{a.name}</span></td>
                    <td><span className="font-mono text-xs rounded px-1.5 py-0.5 border" style={{ borderColor: a.farbe, color: a.farbe }}>{a.kuerzel}</span></td>
                    <td title={BEDARFSARTEN[a.bedarfsart]?.erklaerung}>{BEDARFSARTEN[a.bedarfsart]?.label ?? a.bedarfsart}</td>
                    <td className="text-right tabular-nums">{a.mindestbesetzung} {a.mindestbesetzung === 1 ? 'Person' : 'Personen'}</td>
                    <td className="tabular-nums">{a.arbeitszeit_von}–{a.arbeitszeit_bis} Uhr</td>
                    <td className="text-right"><Button klein variante="leise" icon="stift" onClick={() => setBearbeiten(a)} aria-label={`${a.name} bearbeiten`}>Bearbeiten</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-stein">Kürzel und Bedarfsart sind fest mit der Bedarfsrechnung verknüpft und werden hier nur angezeigt.</p>
      {bearbeiten && <AbteilungModal key={bearbeiten.id} a={bearbeiten} onSchliessen={() => setBearbeiten(null)}
        onFertig={(name) => { setBearbeiten(null); setOk(`Abteilung „${name}“ gespeichert.`) }} />}
    </div>
  )
}

function AbteilungModal({ a, onSchliessen, onFertig }: { a: Abteilung; onSchliessen: () => void; onFertig: (name: string) => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: a.name, farbe: a.farbe, mindestbesetzung: a.mindestbesetzung, arbeitszeit_von: a.arbeitszeit_von, arbeitszeit_bis: a.arbeitszeit_bis })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const speichern = useMutation({
    mutationFn: () => api.abteilungAendern(a.id, { ...form, name: form.name.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['stammdaten'] })
      qc.invalidateQueries({ queryKey: ['bedarf'] })
      onFertig(r.name)
    },
  })
  const fensterFehler = zeitMin(form.arbeitszeit_bis) <= zeitMin(form.arbeitszeit_von) ? 'Ende muss nach dem Beginn liegen' : null
  const gueltig = form.name.trim() !== '' && form.mindestbesetzung >= 0 && !fensterFehler && /^#[0-9a-fA-F]{6}$/.test(form.farbe)
  return (
    <Modal offen titel={`Abteilung bearbeiten: ${a.name}`} onSchliessen={onSchliessen}
      fuss={<>
        <Button variante="leise" onClick={onSchliessen}>Abbrechen</Button>
        <Button variante="primaer" type="submit" form="abteilung-form" disabled={!gueltig || speichern.isPending}>{speichern.isPending ? 'Speichert …' : 'Speichern'}</Button>
      </>}>
      <form id="abteilung-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (gueltig) speichern.mutate() }}>
        <Field label="Name" className="col-span-2" fehler={form.name.trim() === '' ? 'Name fehlt' : null}>
          <input className={eingabe} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Farbe" hinweis="Kategoriefarbe in Plänen und Diagrammen">
          <div className="flex items-center gap-2">
            <input type="color" value={form.farbe} onChange={(e) => set('farbe', e.target.value)} aria-label="Farbe wählen"
              className="h-9 w-12 rounded-lg border border-sand bg-white p-0.5 cursor-pointer" />
            <input className={cx(eingabe, 'font-mono')} value={form.farbe} onChange={(e) => set('farbe', e.target.value)} aria-label="Farbe als Hex-Wert" maxLength={7} />
          </div>
        </Field>
        <Field label="Mindestbesetzung" hinweis="Personen während der Öffnungszeit">
          <input type="number" min={0} max={20} className={eingabe} value={form.mindestbesetzung}
            onChange={(e) => set('mindestbesetzung', Math.max(0, Math.round(Number(e.target.value))))} />
        </Field>
        <Field label="Arbeitszeit von">
          <input type="time" step={900} className={eingabe} value={form.arbeitszeit_von} onChange={(e) => set('arbeitszeit_von', e.target.value)} />
        </Field>
        <Field label="Arbeitszeit bis" fehler={fensterFehler}>
          <input type="time" step={900} className={eingabe} value={form.arbeitszeit_bis} onChange={(e) => set('arbeitszeit_bis', e.target.value)} />
        </Field>
        <div className="col-span-2 flex items-center gap-2 text-sm text-stein">
          Kürzel <span className="font-mono text-xs rounded px-1.5 py-0.5 border" style={{ borderColor: form.farbe, color: form.farbe }}>{a.kuerzel}</span>
          · Bedarfsart {BEDARFSARTEN[a.bedarfsart]?.label ?? a.bedarfsart}
        </div>
        {speichern.error && <div className="col-span-2"><Fehler fehler={speichern.error} /></div>}
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ Warengruppen
function WarengruppenTab() {
  const { warengruppen, abteilungNach, skillNach } = useStammdaten()
  return (
    <div className="space-y-3">
      <Hinweis ton="info">Der Leistungswert (Paletten je Personenstunde) bestimmt, wie viele Stunden für die prognostizierten Paletten geplant werden. Individuelle Leistungsfaktoren der Mitarbeiter wirken zusätzlich.</Hinweis>
      <Card polster={false}>
        {warengruppen.length === 0 ? <Leer titel="Keine Warengruppen" /> : (
          <div className="overflow-x-auto">
            <table className="tabelle">
              <thead><tr><th>Warengruppe</th><th>Abteilung</th><th>Benötigter Skill</th><th style={{ textAlign: 'right' }}>Leistung (Pal/Personenstunde)</th><th style={{ textAlign: 'right' }}>Min je Palette</th></tr></thead>
              <tbody>
                {warengruppen.map((w) => <WarengruppeZeile key={w.id} w={w} abteilung={abteilungNach[w.abteilung_id]} skill={skillNach[w.skill_id]?.name} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function WarengruppeZeile({ w, abteilung, skill }: { w: Warengruppe; abteilung?: Abteilung; skill?: string }) {
  const qc = useQueryClient()
  const [wert, setWert] = useState(String(w.std_leistung_pal_h).replace('.', ','))
  const zahl = Number(wert.replace(',', '.'))
  const gueltig = wert.trim() !== '' && Number.isFinite(zahl) && zahl > 0
  const geaendert = gueltig && zahl !== w.std_leistung_pal_h
  const speichern = useMutation({
    mutationFn: () => api.warengruppeAendern(w.id, zahl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stammdaten'] })
      qc.invalidateQueries({ queryKey: ['bedarf'] })
    },
  })
  return (
    <tr>
      <td className="font-semibold">{w.name}</td>
      <td>{abteilung ? <span className="inline-flex items-center gap-2"><AbteilungsPunkt farbe={abteilung.farbe} />{abteilung.name}</span> : '–'}</td>
      <td>{skill ?? '–'}</td>
      <td>
        <form className="flex items-center justify-end gap-2" onSubmit={(e) => { e.preventDefault(); if (geaendert) speichern.mutate() }}>
          <input inputMode="decimal" className={cx(eingabe, 'text-right tabular-nums')} style={{ width: 96, ...(gueltig ? {} : { borderColor: 'var(--color-verstoss)' }) }} value={wert}
            aria-label={`Leistungswert ${w.name}`} aria-invalid={!gueltig} onChange={(e) => setWert(e.target.value)} />
          <Button klein type="submit" variante={geaendert ? 'primaer' : 'sekundaer'} disabled={!geaendert || speichern.isPending}>Speichern</Button>
          {speichern.isSuccess && !geaendert && <Icon name="ok" className="w-4 h-4 text-ok" titel="Gespeichert" />}
        </form>
        {speichern.error && <div className="text-xs text-verstoss text-right mt-1">{(speichern.error as Error).message}</div>}
      </td>
      <td className="text-right tabular-nums text-stein">{gueltig ? fmtZahl(60 / zahl, 0) : '–'}</td>
    </tr>
  )
}

// ------------------------------------------------------------------ Skills
function SkillsTab() {
  const { skills, abteilungNach } = useStammdaten()
  const kategorien = Object.keys(SKILLKATEGORIEN) as SkillKategorie[]
  if (skills.length === 0) return <Card><Leer titel="Keine Skills" /></Card>
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {kategorien.map((k) => {
        const liste = skills.filter((s) => s.kategorie === k).sort((x, y) => x.name.localeCompare(y.name, 'de'))
        return (
          <Card key={k} titel={<span className="flex items-center gap-2">{SKILLKATEGORIEN[k]} <Badge>{liste.length}</Badge></span>} polster={false}>
            {liste.length === 0 ? <Leer titel="Keine Skills in dieser Kategorie" /> : (
              <table className="tabelle">
                <tbody>
                  {liste.map((s) => {
                    const a = s.abteilung_id ? abteilungNach[s.abteilung_id] : undefined
                    return (
                      <tr key={s.id}>
                        <td className="font-semibold">{s.name}</td>
                        <td>{a ? <span className="inline-flex items-center gap-2 text-sm"><AbteilungsPunkt farbe={a.farbe} />{a.name}</span> : <span className="text-stein">abteilungsübergreifend</span>}</td>
                        <td className="text-right">{s.hat_ablauf && <Badge ton="info" icon="kalender" titel="Zertifikat mit Ablaufdatum">mit Ablauf</Badge>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ Arbeitszeitvorlagen
function SchichtenTab() {
  const { data } = useStammdaten()
  const schichten = [...(data?.schichtmodelle ?? [])].sort((x, y) => x.beginn.localeCompare(y.beginn))
  const tagVon = 5 * 60, tagBis = 22 * 60
  return (
    <Card polster={false}>
      {schichten.length === 0 ? <Leer titel="Keine Arbeitszeitvorlagen" /> : (
        <div className="overflow-x-auto">
          <table className="tabelle">
            <thead><tr><th>Vorlage</th><th>Beginn</th><th>Ende</th><th style={{ textAlign: 'right' }}>Pause</th><th style={{ textAlign: 'right' }}>Netto</th><th className="w-1/3">Lage im Tag (05–22 Uhr)</th></tr></thead>
            <tbody>
              {schichten.map((s) => {
                const b = zeitMin(s.beginn), e = zeitMin(s.ende)
                const netto = (e - b - s.pause_min) / 60
                return (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.name}</td>
                    <td className="tabular-nums">{s.beginn}</td>
                    <td className="tabular-nums">{s.ende}</td>
                    <td className="text-right tabular-nums">{s.pause_min} min</td>
                    <td className="text-right tabular-nums">{fmtStd(Math.round(netto * 100) / 100)}</td>
                    <td>
                      <div className="relative h-3 rounded-full bg-sand" aria-hidden>
                        <div className="absolute inset-y-0 rounded-full bg-haselnuss/70"
                          style={{ left: `${((b - tagVon) / (tagBis - tagVon)) * 100}%`, width: `${((e - b) / (tagBis - tagVon)) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-3 text-xs text-stein">Vorlagen dienen als Schnellauswahl im Wochenplan. Pausen nach § 4 ArbZG: ab 6 h 30 min, ab 9 h 45 min.</p>
    </Card>
  )
}

// ------------------------------------------------------------------ Regelparameter
function RegelnTab() {
  const { data } = useStammdaten()
  const regeln = data?.regelparameter ?? []
  return (
    <div className="space-y-3">
      <Hinweis ton="info" titel="Gesetz, Tarif & Betriebsvereinbarung">
        Die Grenzwerte des Regelwerks sind mit den gesetzlichen Werten vorbelegt (ArbZG, JArbSchG, MuSchG, Minijob). Strengere Regeln aus Tarifvertrag oder Betriebsvereinbarung können hier hinterlegt werden – gesetzliche Mindeststandards sollten nicht unterschritten werden.
      </Hinweis>
      <Card polster={false}>
        {regeln.length === 0 ? <Leer titel="Keine Regelparameter" /> : (
          <div className="overflow-x-auto">
            <table className="tabelle">
              <thead><tr><th>Beschreibung</th><th>Schlüssel</th><th style={{ textAlign: 'right' }}>Wert</th></tr></thead>
              <tbody>{regeln.map((r) => <RegelZeile key={r.schluessel} r={r} />)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function RegelZeile({ r }: { r: Regelparameter }) {
  const qc = useQueryClient()
  const [wert, setWert] = useState(String(r.wert).replace('.', ','))
  const zahl = Number(wert.replace(',', '.'))
  const gueltig = wert.trim() !== '' && Number.isFinite(zahl) && zahl >= 0
  const geaendert = gueltig && zahl !== r.wert
  const speichern = useMutation({
    mutationFn: () => api.regelparameterAendern(r.schluessel, zahl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stammdaten'] })
      qc.invalidateQueries({ queryKey: ['regeln'] })
    },
  })
  return (
    <tr>
      <td>{r.beschreibung}</td>
      <td><code className="text-xs text-stein">{r.schluessel}</code></td>
      <td>
        <form className="flex items-center justify-end gap-2" onSubmit={(e) => { e.preventDefault(); if (geaendert) speichern.mutate() }}>
          <input inputMode="decimal" className={cx(eingabe, 'text-right tabular-nums')} style={{ width: 96, ...(gueltig ? {} : { borderColor: 'var(--color-verstoss)' }) }} value={wert}
            aria-label={r.beschreibung} aria-invalid={!gueltig} onChange={(e) => setWert(e.target.value)} />
          <Button klein type="submit" variante={geaendert ? 'primaer' : 'sekundaer'} disabled={!geaendert || speichern.isPending}>Speichern</Button>
          {geaendert && <Button klein variante="leise" onClick={() => setWert(String(r.wert).replace('.', ','))} aria-label="Änderung verwerfen" icon="x" />}
          {speichern.isSuccess && !geaendert && <Icon name="ok" className="w-4 h-4 text-ok" titel="Gespeichert" />}
        </form>
        {speichern.error && <div className="text-xs text-verstoss text-right mt-1">{(speichern.error as Error).message}</div>}
      </td>
    </tr>
  )
}
