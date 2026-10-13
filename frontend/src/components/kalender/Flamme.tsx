import { cx } from '../ui'
import { FLAMME_PFAD } from './tage'

/** Flammen-Symbol für Hotdays (gleiche Optik wie Icon aus ui.tsx). */
export function Flamme({ className = 'w-3 h-3', titel }: { className?: string; titel?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={cx('inline-block shrink-0', className)} aria-hidden={titel ? undefined : true} role={titel ? 'img' : undefined}>
      {titel && <title>{titel}</title>}
      <path d={FLAMME_PFAD} />
    </svg>
  )
}
