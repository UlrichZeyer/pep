// Mitarbeiterliste mit Suche/Filter und Anlage neuer Mitarbeiter (Stammdaten + Erstvertrag).
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { differenceInYears, parseISO } from 'date-fns'
import {
  api, ApiFehler, STATUS, VERTRAGSARTEN,
  type MitarbeiterNeu, type MitarbeiterStamm, type MitarbeiterStatus, type VertragIn, type Vertragsart,
} from '../api'
import { useMitarbeiter, useStammdaten } from '../hooks'
import {
  AbteilungsPunkt, Badge, Button, Card, Fehler, Field, Hinweis, Icon, Laden, Leer, Modal, SeitenKopf, eingabe, fmtStd,
} from '../components/ui'
import {
  MitarbeiterHinweise, StammFelder, StatusAnzeige, Stundenkonto, VertragFelder,
  neuerVertrag, stammFehler, useStichtag, vertragFehler,
} from '../components/personal/gemeinsam'

export default function MitarbeiterListe() {
  const { liste, isLoading, error } = useMitarbeiter()
  const { abteilungen, abteilungNach, skillNach } = useStammdaten()
  const navigate = useNavigate()
  const [suche, setSuche] = useState('')
  const [abteilung, setAbteilung] = useState<string>('')
  const [art, setArt] = useState<Vertragsart | ''>('')
  const [status, setStatus] = useState<MitarbeiterStatus | ''>('')
  const [anlegen, setAnlegen] = useState(false)

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return liste.filter((m) =>
      (!s || m.name.toLowerCase().includes(s) || m.persnr.toLowerCase().includes(s)) &&
      (!abteilung || String(m.stammabteilung_id ?? 'ohne') === abteilung) &&
      (!art || m.vertrag?.art === art) &&
      (!status || m.status === status))
  }, [liste, suche, abteilung, art, status])

  const filterAktiv = !!(suche || abteilung || art || status)

  return (
    <div className="space-y-4">
      <SeitenKopf titel="Mitarbeiter"
        untertitel={isLoading ? 'Lädt …' : `${gefiltert.length} von ${liste.length} Mitarbeitern`}
        aktionen={<Button variante="primaer" icon="plus" onClick={() => setAnlegen(true)}>Mitarbeiter anlegen</Button>} />

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 items-end">
          <Field label="Suche">
            <span className="relative block">
              <Icon name="suche" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-stein" />
              <input type="search" className={`${eingabe} pl-8!`} placeholder="Name oder Personalnummer"
                value={suche} onChange={(e) => setSuche(e.target.value)} />
            </span>
          </Field>
          <Field label="Abteilung">
            <select className={eingabe} value={abteilung} onChange={(e) => setAbteilung(e.target.value)}>
              <option value="">alle</option>
              {abteilungen.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="ohne">ohne Stammabteilung</option>
            </select>
          </Field>
          <Field label="Vertragsart">
            <select className={eingabe} value={art} onChange={(e) => setArt(e.target.value as Vertragsart | '')}>
              <option value="">alle</option>
              {Object.entries(VERTRAGSARTEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={eingabe} value={status} onChange={(e) => setStatus(e.target.value as MitarbeiterStatus | '')}>
              <option value="">alle</option>
              {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Button variante="leise" icon="x" disabled={!filterAktiv}
            onClick={() => { setSuche(''); setAbteilung(''); setArt(''); setStatus('') }}>Zurücksetzen</Button>
        </div>
      </Card>

      {error ? <Fehler fehler={error} /> : isLoading ? <Laden /> : (
        <Card polster={false}>
          {gefiltert.length === 0 ? (
            <Leer titel={liste.length === 0 ? 'Noch keine Mitarbeiter' : 'Keine Treffer'}>
              {liste.length === 0 ? 'Lege den ersten Mitarbeiter an.' : 'Passe Suche oder Filter an.'}
            </Leer>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabelle">
                <thead>
                  <tr><th>Name</th><th>Stammabteilung</th><th>Vertrag</th><th>Skills</th><th className="text-right!">Stundenkonto</th><th>Status / Hinweise</th></tr>
                </thead>
                <tbody>
                  {gefiltert.map((m) => {
                    const abt = m.stammabteilung_id ? abteilungNach[m.stammabteilung_id] : undefined
                    const skills = [...m.skills].sort((a, b) => b.level - a.level)
                    return (
                      <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/mitarbeiter/${m.id}`)}>
                        <td>
                          <Link to={`/mitarbeiter/${m.id}`} onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-rinde hover:text-fell-dunkel hover:underline">{m.name}</Link>
                          <div className="text-xs text-stein tabular-nums">Nr. {m.persnr}</div>
                        </td>
                        <td>
                          {abt ? <span className="inline-flex items-center gap-2"><AbteilungsPunkt farbe={abt.farbe} />{abt.name}</span>
                            : <span className="text-stein">–</span>}
                        </td>
                        <td className="whitespace-nowrap">
                          {m.vertrag ? <>
                            <div>{VERTRAGSARTEN[m.vertrag.art]}</div>
                            <div className="text-xs text-stein">{fmtStd(m.vertrag.soll_std_woche)}/Woche</div>
                          </> : <Badge ton="warn" icon="warn">kein Vertrag</Badge>}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1 max-w-[18rem]">
                            {skills.slice(0, 4).map((s) => (
                              <Badge key={s.id} titel={`Level ${s.level}`}>{skillNach[s.skill_id]?.name.replace(/^Verräumen /, '') ?? '?'}</Badge>
                            ))}
                            {skills.length > 4 && (
                              <Badge ton="fell" titel={skills.slice(4).map((s) => skillNach[s.skill_id]?.name).join(', ')}>+{skills.length - 4}</Badge>
                            )}
                            {skills.length === 0 && <span className="text-stein text-xs">keine</span>}
                          </div>
                        </td>
                        <td className="text-right"><Stundenkonto wert={m.stundenkonto} /></td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {m.status !== 'mutterschutz' && <StatusAnzeige status={m.status} />}
                            <MitarbeiterHinweise m={m} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {anlegen && <AnlegenModal onSchliessen={() => setAnlegen(false)}
        naechsteNr={String(Math.max(1000, ...liste.map((m) => Number(m.persnr)).filter(Number.isFinite)) + 1)}
        onFertig={(id) => navigate(`/mitarbeiter/${id}`)} />}
    </div>
  )
}

function AnlegenModal({ onSchliessen, onFertig, naechsteNr }: { onSchliessen: () => void; onFertig: (id: number) => void; naechsteNr: string }) {
  const stichtag = useStichtag()
  const { abteilungen } = useStammdaten()
  const qc = useQueryClient()
  const [stamm, setStamm] = useState<MitarbeiterStamm>({
    persnr: naechsteNr, vorname: '', nachname: '', geburtsdatum: '', eintritt: stichtag, austritt: null,
    stammabteilung_id: null, rolle: 'verkaeufer', status: 'aktiv', stundenkonto: 0,
  })
  const [vertrag, setVertrag] = useState<VertragIn>(neuerVertrag('teilzeit', stichtag))
  const [geprueft, setGeprueft] = useState(false)
  const [persnrFehler, setPersnrFehler] = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: (d: MitarbeiterNeu) => api.mitarbeiterAnlegen(d),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['mitarbeiter'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onFertig(m.id)
    },
    onError: (e) => { if (e instanceof ApiFehler && e.status === 409) setPersnrFehler(e.message) },
  })

  const sf = stammFehler(stamm)
  const vf = vertragFehler(vertrag)
  const ok = Object.keys(sf).length === 0 && Object.keys(vf).length === 0
  const minderjaehrig = stamm.geburtsdatum && differenceInYears(parseISO(stichtag), parseISO(stamm.geburtsdatum)) < 18

  const speichern = () => {
    setGeprueft(true)
    if (ok) mut.mutate({ ...stamm, vertrag: { ...vertrag, gueltig_ab: vertrag.gueltig_ab || stamm.eintritt } })
  }

  return (
    <Modal offen breit titel="Mitarbeiter anlegen" onSchliessen={onSchliessen}
      fuss={<>
        <Button variante="leise" onClick={onSchliessen}>Abbrechen</Button>
        <Button variante="primaer" icon="ok" disabled={mut.isPending} onClick={speichern}>{mut.isPending ? 'Speichere …' : 'Anlegen'}</Button>
      </>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); speichern() }}>
        <section>
          <h3 className="text-sm font-extrabold text-rinde mb-2">Stammdaten</h3>
          <StammFelder wert={stamm} abteilungen={abteilungen}
            onChange={(s) => {
              if (s.persnr !== stamm.persnr) setPersnrFehler(null)
              // Vertragsbeginn folgt dem Eintritt, solange er nicht abweichend gesetzt wurde
              if (s.eintritt !== stamm.eintritt && vertrag.gueltig_ab === stamm.eintritt) setVertrag({ ...vertrag, gueltig_ab: s.eintritt })
              setStamm(s)
            }}
            fehler={{ ...(geprueft ? sf : {}), ...(persnrFehler ? { persnr: persnrFehler } : {}) }} />
        </section>
        {minderjaehrig && (
          <Hinweis ton="warn" titel="Minderjährig – Jugendarbeitsschutzgesetz">
            Max. 8 h/Tag und 40 h/Woche, 5-Tage-Woche, Arbeit nur zwischen 06:00 und 20:00 Uhr, Berufsschultage beachten.
          </Hinweis>
        )}
        <section>
          <h3 className="text-sm font-extrabold text-rinde mb-2">Erstvertrag</h3>
          <VertragFelder wert={vertrag} onChange={setVertrag} mitEnde fehler={geprueft ? vf : {}} />
        </section>
        {mut.error && !(mut.error instanceof ApiFehler && mut.error.status === 409) && <Fehler fehler={mut.error} />}
        {geprueft && !ok && <p className="text-sm text-verstoss">Bitte die markierten Felder prüfen.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
