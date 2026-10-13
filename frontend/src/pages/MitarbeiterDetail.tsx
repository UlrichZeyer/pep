// Mitarbeiterdetail: Stammdaten bearbeiten, Vertragshistorie, Skills, Abwesenheiten.
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns'
import {
  api, ApiFehler, ABWESENHEITSSTATUS, ABWESENHEITSTYPEN, ROLLEN, SKILLKATEGORIEN, VERTRAGSARTEN,
  type MitarbeiterDetail as MitarbeiterDetailTyp, type MitarbeiterStamm, type SkillKategorie, type SkillZuordnungIn, type Vertrag, type VertragIn,
} from '../api'
import { useStammdaten } from '../hooks'
import {
  AbteilungsPunkt, Badge, Button, Card, Fehler, Hinweis, Laden, Leer, Modal, SeitenKopf, StatusBadge, Tabs,
  cx, eingabe, fmtDatum, fmtStd, fmtZahl, toISO,
} from '../components/ui'
import {
  LevelAuswahl, MitarbeiterHinweise, StammFelder, StatusAnzeige, Stundenkonto, VertragFelder,
  erlaubteTageText, stammFehler, tageBis, useStichtag, vertragFehler, zertStatus,
} from '../components/personal/gemeinsam'

type Reiter = 'stamm' | 'vertraege' | 'skills' | 'abwesenheiten'

export default function MitarbeiterDetail() {
  const id = Number(useParams().id)
  const q = useQuery({ queryKey: ['mitarbeiter', id], queryFn: () => api.mitarbeiterDetail(id), enabled: Number.isFinite(id) })
  const { abteilungNach } = useStammdaten()
  const [reiter, setReiter] = useState<Reiter>('stamm')

  const zurueck = <Link to="/mitarbeiter" className="text-sm font-semibold text-fell hover:text-fell-dunkel">← Alle Mitarbeiter</Link>
  if (q.isLoading) return <Laden />
  if (q.error || !q.data) {
    return <div className="space-y-4">{zurueck}
      {q.error instanceof ApiFehler && q.error.status === 404
        ? <Leer titel="Mitarbeiter nicht gefunden">Der Datensatz existiert nicht (mehr).</Leer>
        : <Fehler fehler={q.error ?? 'Ungültige Mitarbeiter-ID'} />}
    </div>
  }
  const m = q.data
  const abt = m.stammabteilung_id ? abteilungNach[m.stammabteilung_id] : undefined

  return (
    <div className="space-y-4">
      {zurueck}
      <SeitenKopf titel={m.name}
        untertitel={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">Nr. {m.persnr}</span>
            <span>{ROLLEN[m.rolle]}</span>
            <span>{m.alter} Jahre</span>
            {abt && <span className="inline-flex items-center gap-1.5"><AbteilungsPunkt farbe={abt.farbe} />{abt.name}</span>}
            {m.vertrag && <span>{VERTRAGSARTEN[m.vertrag.art]} · {fmtStd(m.vertrag.soll_std_woche)}/Woche</span>}
            <span>Stundenkonto <Stundenkonto wert={m.stundenkonto} /></span>
          </span>
        }
        aktionen={<div className="flex flex-wrap gap-1">{m.status !== 'mutterschutz' && <StatusAnzeige status={m.status} />}<MitarbeiterHinweise m={m} /></div>} />

      <Tabs<Reiter> aktiv={reiter} onChange={setReiter} werte={[
        { wert: 'stamm', label: 'Stammdaten' },
        { wert: 'vertraege', label: `Verträge (${m.vertraege.length})` },
        { wert: 'skills', label: `Skills (${m.skills.length})` },
        { wert: 'abwesenheiten', label: `Abwesenheiten (${m.abwesenheiten.length})` },
      ]} />

      {reiter === 'stamm' && <StammReiter key={m.id} m={m} />}
      {reiter === 'vertraege' && <VertraegeReiter m={m} />}
      {reiter === 'skills' && <SkillsReiter key={JSON.stringify(m.skills)} m={m} />}
      {reiter === 'abwesenheiten' && <AbwesenheitenReiter m={m} />}
    </div>
  )
}

function useInvalidieren(id: number) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['mitarbeiter', id] })
    qc.invalidateQueries({ queryKey: ['mitarbeiter'], exact: true })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

// ------------------------------------------------------------------ Stammdaten
function stammAus(m: MitarbeiterDetailTyp): MitarbeiterStamm {
  const { persnr, vorname, nachname, geburtsdatum, eintritt, austritt, stammabteilung_id, rolle, status, stundenkonto } = m
  return { persnr, vorname, nachname, geburtsdatum, eintritt, austritt, stammabteilung_id, rolle, status, stundenkonto }
}

function StammReiter({ m }: { m: MitarbeiterDetailTyp }) {
  const { abteilungen } = useStammdaten()
  const invalidieren = useInvalidieren(m.id)
  const [wert, setWert] = useState(() => stammAus(m))
  const [gespeichert, setGespeichert] = useState(false)
  const basis = stammAus(m)
  const geaendert = JSON.stringify(basis) !== JSON.stringify(wert)
  const fehler = stammFehler(wert)
  const mut = useMutation({
    mutationFn: (d: MitarbeiterStamm) => api.mitarbeiterAendern(m.id, d),
    onSuccess: () => { invalidieren(); setGespeichert(true) },
  })
  const persnrFehler = mut.error instanceof ApiFehler && mut.error.status === 409 ? mut.error.message : undefined

  return (
    <Card titel="Stammdaten" aktionen={geaendert && <Badge ton="warn" icon="stift">ungespeichert</Badge>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!Object.keys(fehler).length) mut.mutate(wert) }}>
        <StammFelder wert={wert} abteilungen={abteilungen} fehler={{ ...fehler, ...(persnrFehler ? { persnr: persnrFehler } : {}) }}
          onChange={(s) => { setWert(s); setGespeichert(false); if (mut.error) mut.reset() }} />
        {mut.error && !persnrFehler && <Fehler fehler={mut.error} />}
        {gespeichert && !geaendert && <Hinweis ton="ok" onSchliessen={() => setGespeichert(false)}>Stammdaten gespeichert.</Hinweis>}
        <div className="flex justify-end gap-2">
          <Button variante="leise" disabled={!geaendert} onClick={() => { setWert(basis); mut.reset() }}>Verwerfen</Button>
          <Button type="submit" variante="primaer" icon="ok" disabled={!geaendert || mut.isPending || Object.keys(fehler).length > 0}>
            {mut.isPending ? 'Speichere …' : 'Speichern'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ------------------------------------------------------------------ Verträge
const ohneIds = ({ id: _id, mitarbeiter_id: _m, ...rest }: Vertrag): VertragIn => rest

function VertraegeReiter({ m }: { m: MitarbeiterDetailTyp }) {
  const stichtag = useStichtag()
  const invalidieren = useInvalidieren(m.id)
  const [modal, setModal] = useState<{ art: 'neu' } | { art: 'korrektur'; vertrag: Vertrag } | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const offen = m.vertraege.find((v) => v.gueltig_bis === null)

  const startNeu = (): VertragIn => {
    const basis = m.vertrag ?? offen
    // Beginn frühestens am Stichtag, aber nach Beginn des laufenden Vertrags
    let ab = stichtag
    if (offen && offen.gueltig_ab >= ab) ab = toISO(addDays(parseISO(offen.gueltig_ab), 1))
    return basis ? { ...ohneIds(basis), gueltig_ab: ab, gueltig_bis: null }
      : { art: 'teilzeit', gueltig_ab: ab, gueltig_bis: null, soll_std_woche: 25, max_std_monat: null, max_tage_woche: 4,
          erlaubte_tage: '012345', frueheste_zeit: '05:00', spaeteste_zeit: '21:45', urlaubstage: 22, stundenlohn: 14 }
  }

  return (
    <Card titel="Vertragshistorie" polster={false}
      aktionen={<Button variante="primaer" klein icon="plus" onClick={() => { setMeldung(null); setModal({ art: 'neu' }) }}>Neuer Vertrag</Button>}>
      {meldung && <div className="p-4 pb-0"><Hinweis ton="ok" onSchliessen={() => setMeldung(null)}>{meldung}</Hinweis></div>}
      {m.vertraege.length === 0 ? <Leer titel="Keine Verträge">Lege einen Vertrag an, damit der Mitarbeiter eingeplant werden kann.</Leer> : (
        <div className="overflow-x-auto">
          <table className="tabelle">
            <thead><tr>
              <th>Art</th><th>Gültigkeit</th><th className="text-right!">Soll h/Wo</th><th className="text-right!">Max h/Mon</th>
              <th>Tage</th><th>Zeitfenster</th><th className="text-right!">Urlaub</th><th className="text-right!">Lohn</th><th><span className="sr-only">Aktion</span></th>
            </tr></thead>
            <tbody>
              {m.vertraege.map((v) => {
                const aktuell = v.id === m.vertrag?.id
                return (
                  <tr key={v.id} className={cx(aktuell && 'bg-fell-hell/40')}>
                    <td className="whitespace-nowrap">
                      <span className="font-semibold">{VERTRAGSARTEN[v.art]}</span>{' '}
                      {aktuell ? <Badge ton="ok" icon="ok">aktuell</Badge>
                        : v.gueltig_ab > stichtag ? <Badge ton="info" icon="kalender">künftig</Badge> : null}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDatum(v.gueltig_ab)} – {v.gueltig_bis ? fmtDatum(v.gueltig_bis) : 'unbefristet'}</td>
                    <td className="text-right tabular-nums">{fmtZahl(v.soll_std_woche, Number.isInteger(v.soll_std_woche) ? 0 : 1)}</td>
                    <td className="text-right tabular-nums">{v.max_std_monat ?? '–'}</td>
                    <td className="whitespace-nowrap">max. {v.max_tage_woche} · <span className="text-stein">{erlaubteTageText(v.erlaubte_tage)}</span></td>
                    <td className="whitespace-nowrap tabular-nums">{v.frueheste_zeit}–{v.spaeteste_zeit}</td>
                    <td className="text-right tabular-nums">{v.urlaubstage} T.</td>
                    <td className="text-right tabular-nums">{fmtZahl(v.stundenlohn, 2)} €</td>
                    <td className="text-right">
                      <Button klein variante="leise" icon="stift" onClick={() => { setMeldung(null); setModal({ art: 'korrektur', vertrag: v }) }}
                        aria-label={`Vertrag ab ${fmtDatum(v.gueltig_ab)} korrigieren`}>Korrigieren</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {modal?.art === 'neu' && (
        <VertragModal titel="Neuer Vertrag" start={startNeu()} mitEnde={false}
          hinweis={offen && ((ab: string) => (
            <Hinweis ton="info" titel="Vorgängervertrag wird beendet">
              Der laufende Vertrag ({VERTRAGSARTEN[offen.art]}, seit {fmtDatum(offen.gueltig_ab)}) endet automatisch am{' '}
              <b>{ab ? fmtDatum(toISO(addDays(parseISO(ab), -1))) : '…'}</b>.
            </Hinweis>
          ))}
          speichern={(d) => api.vertragAnlegen(m.id, d)}
          onSchliessen={() => setModal(null)}
          onFertig={() => { invalidieren(); setModal(null); setMeldung('Neuer Vertrag angelegt.') }} />
      )}
      {modal?.art === 'korrektur' && (
        <VertragModal titel={`Vertrag korrigieren (ab ${fmtDatum(modal.vertrag.gueltig_ab)})`} start={ohneIds(modal.vertrag)} mitEnde
          hinweis={() => <Hinweis ton="info">Korrekturen ändern den bestehenden Vertrag rückwirkend – für Vertragsänderungen ab einem Stichtag „Neuer Vertrag“ verwenden.</Hinweis>}
          speichern={(d) => api.vertragAendern(modal.vertrag.id, d)}
          onSchliessen={() => setModal(null)}
          onFertig={() => { invalidieren(); setModal(null); setMeldung('Vertrag korrigiert.') }} />
      )}
    </Card>
  )
}

function VertragModal({ titel, start, mitEnde, hinweis, speichern, onSchliessen, onFertig }: {
  titel: string; start: VertragIn; mitEnde: boolean; hinweis?: ((ab: string) => ReactNode) | false | undefined
  speichern: (d: VertragIn) => Promise<Vertrag>; onSchliessen: () => void; onFertig: () => void
}) {
  const [wert, setWert] = useState(start)
  const fehler = vertragFehler(wert)
  const ok = Object.keys(fehler).length === 0
  const mut = useMutation({ mutationFn: speichern, onSuccess: onFertig })
  const absenden = () => ok && mut.mutate(wert)
  return (
    <Modal offen breit titel={titel} onSchliessen={onSchliessen}
      fuss={<>
        <Button variante="leise" onClick={onSchliessen}>Abbrechen</Button>
        <Button variante="primaer" icon="ok" disabled={!ok || mut.isPending} onClick={absenden}>{mut.isPending ? 'Speichere …' : 'Speichern'}</Button>
      </>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); absenden() }}>
        {hinweis && hinweis(wert.gueltig_ab)}
        <VertragFelder wert={wert} onChange={setWert} mitEnde={mitEnde} fehler={fehler} />
        {mut.error && <Fehler fehler={mut.error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ Skills
type SkillZustand = Record<number, { an: boolean } & SkillZuordnungIn>
const KATEGORIEN: SkillKategorie[] = ['verraeumen', 'kasse', 'zertifikat', 'sonstiges']

function SkillsReiter({ m }: { m: MitarbeiterDetailTyp }) {
  const { skills, isLoading, error } = useStammdaten()
  const stichtag = useStichtag()
  const invalidieren = useInvalidieren(m.id)
  const qc = useQueryClient()
  const anfang = useMemo(() => {
    const z: SkillZustand = {}
    for (const s of skills) z[s.id] = { an: false, skill_id: s.id, level: 2, leistungsfaktor: 1, zertifikat_bis: null }
    for (const ms of m.skills) z[ms.skill_id] = { an: true, skill_id: ms.skill_id, level: ms.level, leistungsfaktor: ms.leistungsfaktor, zertifikat_bis: ms.zertifikat_bis }
    return z
  }, [skills, m.skills])
  const [aenderung, setAenderung] = useState<SkillZustand>({})
  const zustand = { ...anfang, ...aenderung }
  const geaendert = Object.keys(aenderung).length > 0
  const [gespeichert, setGespeichert] = useState(false)

  const mut = useMutation({
    mutationFn: (d: SkillZuordnungIn[]) => api.skillsSetzen(m.id, d),
    onSuccess: () => { invalidieren(); qc.invalidateQueries({ queryKey: ['kpi', 'personal'] }); setGespeichert(true) },
  })

  if (isLoading) return <Laden />
  if (error) return <Fehler fehler={error} />
  if (skills.length === 0) return <Leer titel="Keine Skills definiert" />

  const setze = (id: number, d: Partial<SkillZustand[number]>) => { setGespeichert(false); setAenderung({ ...aenderung, [id]: { ...zustand[id], ...d } }) }
  const speichern = () => mut.mutate(Object.values(zustand).filter((z) => z.an)
    .map(({ skill_id, level, leistungsfaktor, zertifikat_bis }) => ({ skill_id, level, leistungsfaktor, zertifikat_bis })))

  return (
    <Card titel="Skills & Qualifikationen" aktionen={geaendert && <Badge ton="warn" icon="stift">ungespeichert</Badge>}>
      <div className="space-y-5">
        {KATEGORIEN.map((k) => {
          const liste = skills.filter((s) => s.kategorie === k)
          if (!liste.length) return null
          return (
            <fieldset key={k}>
              <legend className="text-xs font-extrabold uppercase tracking-wide text-stein mb-2">{SKILLKATEGORIEN[k]}</legend>
              <div className="divide-y divide-sand border border-sand rounded-lg">
                {liste.map((s) => {
                  const z = zustand[s.id]
                  const zs = z.an && s.hat_ablauf ? zertStatus(z.zertifikat_bis, stichtag) : null
                  return (
                    <div key={s.id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2', !z.an && 'bg-creme/60')}>
                      <label className="flex items-center gap-2 min-w-[14rem] flex-1 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-[var(--color-fell)]" checked={z.an} onChange={(e) => setze(s.id, { an: e.target.checked })} />
                        <span className={cx('font-semibold text-sm', !z.an && 'text-stein')}>{s.name}</span>
                      </label>
                      <LevelAuswahl label={`Level ${s.name}`} wert={z.level} disabled={!z.an} onChange={(level) => setze(s.id, { level })} />
                      <label className="flex items-center gap-1.5 text-xs text-haselnuss font-bold">
                        Faktor
                        <input type="number" min={0.3} max={2} step={0.05} disabled={!z.an} className={cx(eingabe, 'w-20!')}
                          value={z.leistungsfaktor} onChange={(e) => setze(s.id, { leistungsfaktor: e.target.value === '' ? 1 : Number(e.target.value) })} />
                      </label>
                      {s.hat_ablauf && (
                        <label className="flex items-center gap-1.5 text-xs text-haselnuss font-bold">
                          gültig bis
                          <input type="date" disabled={!z.an} className={cx(eingabe, 'w-40!')} value={z.zertifikat_bis ?? ''}
                            onChange={(e) => setze(s.id, { zertifikat_bis: e.target.value || null })} />
                        </label>
                      )}
                      <span className="min-w-[9rem]">
                        {zs === 'verstoss' && <StatusBadge status="verstoss">abgelaufen</StatusBadge>}
                        {zs === 'warn' && <StatusBadge status="warn">läuft in {tageBis(z.zertifikat_bis!, stichtag)} T. ab</StatusBadge>}
                        {z.an && s.hat_ablauf && !z.zertifikat_bis && <StatusBadge status="warn">Ablaufdatum fehlt</StatusBadge>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
        <p className="text-xs text-stein">Level 1 = Einarbeitung, 2 = selbstständig, 3 = Experte · Leistungsfaktor 1,0 = Standardleistung der Warengruppe.</p>
        {mut.error && <Fehler fehler={mut.error} />}
        {gespeichert && !geaendert && <Hinweis ton="ok" onSchliessen={() => setGespeichert(false)}>Skills gespeichert.</Hinweis>}
        <div className="flex justify-end gap-2">
          <Button variante="leise" disabled={!geaendert} onClick={() => setAenderung({})}>Verwerfen</Button>
          <Button variante="primaer" icon="ok" disabled={!geaendert || mut.isPending} onClick={speichern}>{mut.isPending ? 'Speichere …' : 'Skills speichern'}</Button>
        </div>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ Abwesenheiten
const STATUS_TON = { genehmigt: 'ok', beantragt: 'warn', abgelehnt: 'verstoss' } as const

function AbwesenheitenReiter({ m }: { m: MitarbeiterDetailTyp }) {
  const stichtag = useStichtag()
  return (
    <Card titel="Abwesenheiten" polster={false}
      aktionen={<Link to="/abwesenheiten" className="text-sm font-semibold text-fell hover:text-fell-dunkel">Abwesenheiten verwalten →</Link>}>
      {m.abwesenheiten.length === 0 ? <Leer titel="Keine Abwesenheiten erfasst" /> : (
        <div className="overflow-x-auto">
          <table className="tabelle">
            <thead><tr><th>Zeitraum</th><th className="text-right!">Tage</th><th>Typ</th><th>Status</th><th>Notiz</th></tr></thead>
            <tbody>
              {m.abwesenheiten.map((a) => {
                const laufend = a.von <= stichtag && a.bis >= stichtag
                return (
                  <tr key={a.id} className={cx(laufend && 'bg-fell-hell/40')}>
                    <td className="whitespace-nowrap tabular-nums">
                      {fmtDatum(a.von)}{a.bis !== a.von && <> – {fmtDatum(a.bis)}</>}
                      {laufend && <> <Badge ton="info">laufend</Badge></>}
                    </td>
                    <td className="text-right tabular-nums">{differenceInCalendarDays(parseISO(a.bis), parseISO(a.von)) + 1}</td>
                    <td>{ABWESENHEITSTYPEN[a.typ]}</td>
                    <td><StatusBadge status={STATUS_TON[a.status]}>{ABWESENHEITSSTATUS[a.status]}</StatusBadge></td>
                    <td className="text-stein">{a.notiz ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
