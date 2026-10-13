// Datenschicht der Einsatzplanung: Plan der Woche, Einsätze, Validierung, Bedarf, Abwesenheiten, Kalender.
// Mutationen mit optimistischem Update und Rollback; Verstöße aus EinsatzErgebnis werden sofort übernommen.
import { useCallback, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiFehler, api,
  type Abwesenheit, type Einsatz, type EinsatzErgebnis, type EinsatzIn, type Kalender, type Mitarbeiter,
  type Plan, type PlanStatus, type Validierung, type Verstoss,
} from '../../api'
import { useStammdaten } from '../../hooks'
import { kw, kwJahr, montagVon, nettoStd, plusTage, wochentage, wochentagIndex } from './zeit'

/** Endpunkt (noch) nicht vorhanden – z. B. weil das Backend-Modul noch fehlt. */
export function nichtVerfuegbar(f: unknown): boolean {
  return f instanceof ApiFehler && [404, 405, 501].includes(f.status)
}
export const keinRetryBei404 = (anzahl: number, f: unknown) => !nichtVerfuegbar(f) && anzahl < 2

export const fehlerText = (f: unknown) => (f instanceof Error ? f.message : String(f))

// ------------------------------------------------------------------ Kalender je Tag
export interface TagInfo {
  datum: string
  geschlossen: boolean
  /** Grund der Schließung bzw. Name des Feiertags */
  grund: string | null
  hotday: { name: string; lastfaktor: number } | null
}

export function useKalenderTage(tage: string[]): Record<string, TagInfo> {
  const jahre = useMemo(() => [...new Set(tage.map((t) => Number(t.slice(0, 4))))], [tage])
  const qs = useQueries({
    queries: jahre.map((jahr) => ({ queryKey: ['kalender', jahr], queryFn: () => api.kalender(jahr), staleTime: 5 * 60_000 })),
  })
  const daten = qs.map((q) => q.data).filter(Boolean) as Kalender[]
  const schluessel = daten.map((k) => k.jahr).join(',')
  return useMemo(() => {
    const feiertage = new Map<string, string>()
    const eintraege = new Map<string, Kalender['eintraege'][number]>()
    for (const k of daten) {
      for (const f of k.feiertage) feiertage.set(f.datum, f.name)
      for (const e of k.eintraege) eintraege.set(e.datum, e)
    }
    const erg: Record<string, TagInfo> = {}
    for (const t of tage) {
      const e = eintraege.get(t)
      const feiertag = feiertage.get(t)
      const sonntag = wochentagIndex(t) === 6
      const schliess = e?.typ === 'schliesstag'
      erg[t] = {
        datum: t,
        geschlossen: sonntag || !!feiertag || schliess,
        grund: feiertag ?? (schliess ? e!.name : sonntag ? 'Sonntag' : null),
        hotday: e && e.typ === 'hotday' ? { name: e.name, lastfaktor: e.lastfaktor } : null,
      }
    }
    return erg
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tage, schluessel])
}

// ------------------------------------------------------------------ Abwesenheiten je Mitarbeiter/Tag
export function abwesenheitsKarte(liste: Abwesenheit[], von: string, bis: string): Map<string, Abwesenheit> {
  const karte = new Map<string, Abwesenheit>()
  for (const a of liste) {
    if (a.status === 'abgelehnt') continue
    let t = a.von < von ? von : a.von
    const ende = a.bis > bis ? bis : a.bis
    while (t <= ende) {
      const k = `${a.mitarbeiter_id}|${t}`
      // genehmigte Abwesenheit hat Vorrang vor beantragter
      if (!karte.has(k) || a.status === 'genehmigt') karte.set(k, a)
      t = plusTage(t, 1)
    }
  }
  return karte
}

/** Mitarbeiter, die im Zeitraum planbar bzw. sichtbar sind. */
export function sichtbareMitarbeiter(liste: Mitarbeiter[], von: string, bis: string, mitEinsatz: Set<number>): Mitarbeiter[] {
  return liste.filter((m) => mitEinsatz.has(m.id) ||
    (m.status !== 'inaktiv' && m.eintritt <= bis && (!m.austritt || m.austritt >= von)))
}

export const istGesperrtStatus = (m: Mitarbeiter) => m.status === 'mutterschutz' || m.status === 'elternzeit'

// ------------------------------------------------------------------ Hauptdaten der Woche
export interface Meldung {
  ton: 'info' | 'ok' | 'warn' | 'verstoss'
  titel: string
  text?: string
}

/** Negative, eindeutige IDs für optimistisch angelegte Einsätze. */
let naechsteTempId = -1
const temporaereId = () => naechsteTempId--

function findePlan(plaene: Plan[] | undefined, montag: string, samstag: string): Plan | null {
  if (!plaene) return null
  const passend = plaene.filter((p) => p.von <= samstag && p.bis >= montag)
  return passend.find((p) => p.von === montag) ?? passend[0] ?? null
}

function zusammenfassen(verstoesse: Verstoss[]): Validierung {
  return {
    verstoesse,
    zusammenfassung: {
      hart: verstoesse.filter((v) => v.schwere === 'hart').length,
      weich: verstoesse.filter((v) => v.schwere === 'weich').length,
    },
  }
}

export function usePlanDaten(datum: string) {
  const qc = useQueryClient()
  const montag = montagVon(datum)
  const tage = useMemo(() => wochentage(montag), [montag])
  const samstag = tage[5]
  const stamm = useStammdaten()
  const [meldung, setMeldung] = useState<Meldung | null>(null)

  const plaeneQ = useQuery({ queryKey: ['plaene', montag, samstag], queryFn: () => api.plaene(montag, samstag), retry: keinRetryBei404 })
  const plan = findePlan(plaeneQ.data, montag, samstag)
  const planId = plan?.id ?? null

  const einsaetzeQ = useQuery({
    queryKey: ['einsaetze', planId], queryFn: () => api.einsaetze(planId!), enabled: planId !== null, retry: keinRetryBei404,
  })
  const validierungQ = useQuery({
    queryKey: ['validierung', planId], queryFn: () => api.validieren(planId!), enabled: planId !== null, retry: keinRetryBei404,
  })
  const abdeckungQ = useQuery({
    queryKey: ['abdeckung', planId], queryFn: () => api.kpiAbdeckung(planId!), enabled: planId !== null, retry: keinRetryBei404,
  })
  const bedarfQ = useQuery({ queryKey: ['bedarf', montag, samstag], queryFn: () => api.bedarf(montag, samstag), retry: keinRetryBei404, staleTime: 60_000 })
  const abwQ = useQuery({ queryKey: ['abwesenheiten', montag, samstag], queryFn: () => api.abwesenheiten(montag, samstag) })
  const maQ = useQuery({ queryKey: ['mitarbeiter', 'stichtag', montag], queryFn: () => api.mitarbeiter(montag) })
  const kalenderTage = useKalenderTage(tage)

  const einsaetze = useMemo(() => einsaetzeQ.data ?? [], [einsaetzeQ.data])
  const mitarbeiterAlle = useMemo(() => maQ.data ?? [], [maQ.data])
  const mitarbeiterNach = useMemo(() => Object.fromEntries(mitarbeiterAlle.map((m) => [m.id, m])) as Record<number, Mitarbeiter>, [mitarbeiterAlle])

  const einsaetzeNachZelle = useMemo(() => {
    const k = new Map<string, Einsatz[]>()
    for (const e of einsaetze) {
      const s = `${e.mitarbeiter_id}|${e.datum}`
      const l = k.get(s)
      if (l) l.push(e)
      else k.set(s, [e])
    }
    for (const l of k.values()) l.sort((a, b) => a.beginn.localeCompare(b.beginn))
    return k
  }, [einsaetze])

  const abwesenheitNach = useMemo(() => abwesenheitsKarte(abwQ.data ?? [], montag, samstag), [abwQ.data, montag, samstag])

  const verstoesse = useMemo(() => validierungQ.data?.verstoesse ?? [], [validierungQ.data])
  const { verstoesseNachEinsatz, verstoesseNachMa } = useMemo(() => {
    const nachEinsatz = new Map<number, Verstoss[]>()
    const nachMa = new Map<number, Verstoss[]>()
    for (const v of verstoesse) {
      if (v.einsatz_ids.length === 0) {
        nachMa.set(v.mitarbeiter_id, [...(nachMa.get(v.mitarbeiter_id) ?? []), v])
      } else {
        for (const id of v.einsatz_ids) nachEinsatz.set(id, [...(nachEinsatz.get(id) ?? []), v])
      }
    }
    return { verstoesseNachEinsatz: nachEinsatz, verstoesseNachMa: nachMa }
  }, [verstoesse])

  /** Bedarf in Stunden je Tag (optional je Abteilung); Fallback: KPI-Abdeckung. */
  const bedarfStd = useCallback((tag: string, abteilungId?: number): number | null => {
    const bt = bedarfQ.data?.tage.find((t) => t.datum === tag)
    if (bt) {
      const abt = abteilungId === undefined ? bt.abteilungen : bt.abteilungen.filter((a) => a.abteilung_id === abteilungId)
      return abt.reduce((s, a) => s + a.stunden, 0)
    }
    const kt = abdeckungQ.data?.tage.find((t) => t.datum === tag)
    if (kt) {
      if (abteilungId === undefined) return kt.bedarf_std
      return kt.abteilungen.find((a) => a.abteilung_id === abteilungId)?.bedarf_std ?? 0
    }
    return null
  }, [bedarfQ.data, abdeckungQ.data])

  // ---------------------------------------------------------------- Mutationen
  const neuLaden = useCallback(() => {
    if (planId === null) return
    qc.invalidateQueries({ queryKey: ['einsaetze', planId] })
    qc.invalidateQueries({ queryKey: ['validierung', planId] })
    qc.invalidateQueries({ queryKey: ['abdeckung', planId] })
    qc.invalidateQueries({ queryKey: ['plaene'] })
  }, [qc, planId])

  /** Verstöße aus einem EinsatzErgebnis sofort in die Validierung übernehmen. */
  const verstoesseUebernehmen = useCallback((erg: EinsatzErgebnis, zusaetzlichEinsatzId?: number) => {
    const key = ['validierung', planId]
    const alt = qc.getQueryData<Validierung>(key)
    const maId = erg.einsatz.mitarbeiter_id
    const ids = new Set([erg.einsatz.id, ...(zusaetzlichEinsatzId !== undefined ? [zusaetzlichEinsatzId] : [])])
    const rest = (alt?.verstoesse ?? []).filter((v) => v.mitarbeiter_id !== maId && !v.einsatz_ids.some((i) => ids.has(i)))
    qc.setQueryData(key, zusammenfassen([...rest, ...(erg.verstoesse ?? [])]))
  }, [qc, planId])

  const ergebnisMelden = useCallback((erg: EinsatzErgebnis, aktion: string) => {
    const name = mitarbeiterNach[erg.einsatz.mitarbeiter_id]?.name ?? 'Mitarbeiter'
    const hart = (erg.verstoesse ?? []).filter((v) => v.schwere === 'hart')
    const weich = (erg.verstoesse ?? []).filter((v) => v.schwere === 'weich')
    if (hart.length) setMeldung({ ton: 'verstoss', titel: `${aktion} – ${hart.length} harte(r) Verstoß/Verstöße bei ${name}`, text: hart.map((v) => v.meldung).join(' · ') })
    else if (weich.length) setMeldung({ ton: 'warn', titel: `${aktion} – ${weich.length} Hinweis(e) bei ${name}`, text: weich.map((v) => v.meldung).join(' · ') })
    else setMeldung({ ton: 'ok', titel: `${aktion} – keine Regelverstöße bei ${name}` })
  }, [mitarbeiterNach])

  /** Optimistisch ändern, Aufruf ausführen, bei Fehler zurückrollen. */
  const optimistisch = useCallback(async <T,>(aenderung: (alt: Einsatz[]) => Einsatz[], aufruf: () => Promise<T>, nachErfolg?: (r: T, liste: Einsatz[]) => Einsatz[]): Promise<T> => {
    const key = ['einsaetze', planId]
    await qc.cancelQueries({ queryKey: key })
    const alt = qc.getQueryData<Einsatz[]>(key)
    if (alt) qc.setQueryData(key, aenderung(alt))
    try {
      const r = await aufruf()
      if (nachErfolg) {
        const aktuell = qc.getQueryData<Einsatz[]>(key)
        if (aktuell) qc.setQueryData(key, nachErfolg(r, aktuell))
      }
      return r
    } catch (f) {
      if (alt) qc.setQueryData(key, alt)
      throw f
    } finally {
      neuLaden()
    }
  }, [qc, planId, neuLaden])

  const fehlerMelden = useCallback((f: unknown, aktion: string) => {
    setMeldung({
      ton: 'verstoss',
      titel: `${aktion} fehlgeschlagen – Änderung zurückgenommen`,
      text: nichtVerfuegbar(f) ? 'Die Planungs-Schnittstelle ist im Backend noch nicht verfügbar.' : fehlerText(f),
    })
  }, [])

  /** Einsatz verschieben (anderer Tag/Mitarbeiter) oder kopieren (Alt-Taste). */
  const verschieben = useCallback(async (e: Einsatz, ziel: { datum: string; mitarbeiter_id: number }, kopieren: boolean) => {
    if (planId === null) return
    if (!kopieren && e.datum === ziel.datum && e.mitarbeiter_id === ziel.mitarbeiter_id) return
    try {
      if (kopieren) {
        const tid = temporaereId()
        const erg = await optimistisch(
          (l) => [...l, { ...e, ...ziel, id: tid, gesperrt: false, quelle: 'manuell' }],
          () => api.einsatzAnlegen(planId, {
            mitarbeiter_id: ziel.mitarbeiter_id, abteilung_id: e.abteilung_id, datum: ziel.datum,
            beginn: e.beginn, ende: e.ende, pause_min: e.pause_min, gesperrt: false,
          }),
          (r, l) => l.map((x) => (x.id === tid ? r.einsatz : x)),
        )
        verstoesseUebernehmen(erg)
        ergebnisMelden(erg, 'Einsatz kopiert')
      } else {
        const erg = await optimistisch(
          (l) => l.map((x) => (x.id === e.id ? { ...x, ...ziel } : x)),
          () => api.einsatzAendern(e.id, ziel),
          (r, l) => l.map((x) => (x.id === e.id ? r.einsatz : x)),
        )
        verstoesseUebernehmen(erg, e.id)
        ergebnisMelden(erg, 'Einsatz verschoben')
      }
    } catch (f) {
      fehlerMelden(f, kopieren ? 'Kopieren' : 'Verschieben')
    }
  }, [planId, optimistisch, verstoesseUebernehmen, ergebnisMelden, fehlerMelden])

  /** Anlegen (ohne id) oder Ändern. Wirft bei Fehler (Dialog zeigt die Meldung). */
  const speichern = useCallback(async (id: number | null, d: EinsatzIn): Promise<EinsatzErgebnis | undefined> => {
    if (planId === null) return
    const stunden = nettoStd(d.beginn, d.ende, d.pause_min ?? 0)
    if (id === null) {
      const tid = temporaereId()
      const erg = await optimistisch(
        (l) => [...l, { id: tid, plan_id: planId, quelle: 'manuell', ist_paletten: null, pause_min: 0, gesperrt: false, ...d, stunden }],
        () => api.einsatzAnlegen(planId, d),
        (r, l) => l.map((x) => (x.id === tid ? r.einsatz : x)),
      )
      verstoesseUebernehmen(erg)
      ergebnisMelden(erg, 'Einsatz angelegt')
      return erg
    }
    const erg = await optimistisch(
      (l) => l.map((x) => (x.id === id ? { ...x, ...d, stunden } : x)),
      () => api.einsatzAendern(id, d),
      (r, l) => l.map((x) => (x.id === id ? r.einsatz : x)),
    )
    verstoesseUebernehmen(erg, id)
    ergebnisMelden(erg, 'Einsatz gespeichert')
    return erg
  }, [planId, optimistisch, verstoesseUebernehmen, ergebnisMelden])

  const loeschen = useCallback(async (id: number) => {
    await optimistisch((l) => l.filter((x) => x.id !== id), () => api.einsatzLoeschen(id))
    const key = ['validierung', planId]
    const alt = qc.getQueryData<Validierung>(key)
    if (alt) qc.setQueryData(key, zusammenfassen(alt.verstoesse.filter((v) => !v.einsatz_ids.includes(id))))
    setMeldung({ ton: 'ok', titel: 'Einsatz gelöscht' })
  }, [optimistisch, qc, planId])

  const statusAendern = useCallback(async (status: PlanStatus) => {
    if (planId === null) return
    try {
      await api.planAendern(planId, { status })
      setMeldung({ ton: 'ok', titel: `Planstatus geändert` })
    } catch (f) {
      setMeldung({
        ton: 'verstoss',
        titel: f instanceof ApiFehler && f.status === 409 ? 'Statuswechsel nicht möglich' : 'Statuswechsel fehlgeschlagen',
        text: fehlerText(f),
      })
    } finally {
      qc.invalidateQueries({ queryKey: ['plaene'] })
      qc.invalidateQueries({ queryKey: ['plan', planId] })
    }
  }, [planId, qc])

  const planAnlegen = useCallback(async () => {
    try {
      await api.planAnlegen({ name: `KW ${kw(montag)}/${kwJahr(montag)}`, von: montag, bis: samstag })
      setMeldung({ ton: 'ok', titel: `Plan für KW ${kw(montag)} angelegt` })
    } catch (f) {
      setMeldung({ ton: 'verstoss', titel: 'Plan konnte nicht angelegt werden', text: nichtVerfuegbar(f) ? 'Die Planungs-Schnittstelle ist im Backend noch nicht verfügbar.' : fehlerText(f) })
    } finally {
      qc.invalidateQueries({ queryKey: ['plaene'] })
    }
  }, [montag, samstag, qc])

  return {
    montag, samstag, tage, plan, planId,
    bearbeitbar: plan?.status === 'entwurf',
    stamm, kalenderTage,
    plaeneQ, einsaetzeQ, validierungQ, bedarfQ, abdeckungQ, abwQ, maQ,
    einsaetze, einsaetzeNachZelle, mitarbeiterAlle, mitarbeiterNach, abwesenheitNach,
    verstoesse, verstoesseNachEinsatz, verstoesseNachMa,
    zusammenfassung: validierungQ.data?.zusammenfassung ?? null,
    bedarfStd,
    meldung, setMeldung,
    neuLaden, verschieben, speichern, loeschen, statusAendern, planAnlegen,
  }
}

export type PlanDaten = ReturnType<typeof usePlanDaten>
