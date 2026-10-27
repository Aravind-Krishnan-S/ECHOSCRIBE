import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, Mic } from 'lucide-react'
import clsx from 'clsx'
import { ConversationStrip } from '../components/ConversationStrip'
import { BarList } from '../components/charts'
import { EmptyState, ErrorState, Skel } from '../components/ui'
import { useAuth } from '../lib/auth'
import { firstName, greeting, plural, relativeDay } from '../lib/format'
import { localKeys } from '../lib/keys'
import { isRiskFlagged, useHistory, usePatients, useProviders, useSyncedKeys } from '../lib/queries'
import { useWorkspace } from '../lib/useWorkspace'
import type { Session } from '../lib/types'

const DAY = 86_400_000

function needsReview(s: Session) {
  const g = s.analysis_json?.grounding?.summary
  return !!g && g.unsupported > 0
}

export default function Home() {
  const ws = useWorkspace()
  const { profile } = useAuth()
  const patients = usePatients(ws.api)
  const history = useHistory(ws.api)
  const sessions = history.data || []
  const names = useMemo(() => Object.fromEntries((patients.data || []).map(p => [p.id, p.name])), [patients.data])

  const now = Date.now()
  const week = sessions.filter(s => now - new Date(s.created_at).getTime() < 7 * DAY)
  const month = sessions.filter(s => now - new Date(s.created_at).getTime() < 30 * DAY)
  const flagged = month.filter(isRiskFlagged)
  const review = month.filter(needsReview)

  // The one finding the greeting leads with, from today's data
  const finding = history.isLoading ? '' :
    flagged.length ? `${plural(flagged.length, 'session')} in the last 30 days ${flagged.length === 1 ? 'carries' : 'carry'} a ${ws.riskLabel.toLowerCase()} flag.` :
    review.length ? `${plural(review.length, 'note')} ${review.length === 1 ? 'has' : 'have'} sentences the verifier could not support.` :
    sessions.length ? `${plural(week.length, 'session')} this week. Nothing needs your attention.` :
    `Record your first session to get a ${ws.noteName}.`

  const topics = useMemo(() => {
    const counts: Record<string, number> = {}
    month.forEach(s => (s.analysis_json?.topics || []).forEach(t => { const k = t.toLowerCase(); counts[k] = (counts[k] || 0) + 1 }))
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label: label[0].toUpperCase() + label.slice(1), value }))
  }, [month])

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-10 max-w-[1148px] mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="serif text-[34px] sm:text-[44px] leading-[1.08] m-0">{greeting()}, {firstName(profile?.full_name, profile?.email)}.</h1>
          <p className="text-[15px] text-muted m-0 mt-2 min-h-[22px]">{finding}</p>
        </div>
        <Link to={`/w/${ws.id}/record`} className="btn btn-primary btn-lg" data-tour="new-session"><Mic size={16} />New session</Link>
      </header>

      {/* counts: one divided strip, label over value */}
      <section aria-label="Overview" className="panel !p-0 mt-8 grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border overflow-hidden">
        {[
          { label: ws.clients, value: patients.data?.length, to: `/w/${ws.id}/clients` },
          { label: 'Sessions this week', value: history.data ? week.length : undefined },
          { label: `${ws.riskLabel} flags, 30 days`, value: history.data ? flagged.length : undefined, warn: flagged.length > 0 },
          { label: 'Notes to review, 30 days', value: history.data ? review.length : undefined, warn: review.length > 0 },
        ].map(k => (
          <div key={k.label} className="p-5">
            <p className="m-0 text-[13px] text-muted">{k.label}</p>
            {k.value === undefined ? <Skel w={48} h={32} className="mt-2" /> :
              <p className={clsx('m-0 mt-1 num text-[32px] leading-10', k.warn ? 'text-negative' : 'text-ink')}>{k.value}</p>}
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
        <section className="panel lg:col-span-8" aria-labelledby="recent">
          <div className="flex items-center justify-between mb-3">
            <h2 id="recent" className="m-0 text-[14px] font-semibold">Recent sessions {history.data && <span className="pill pill-neutral ml-1 num">{sessions.length}</span>}</h2>
            {sessions.length > 5 && <Link to={`/w/${ws.id}/clients`} className="link text-[13px]">View all</Link>}
          </div>
          {history.isLoading ? <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skel key={i} h={63} />)}</div> :
            history.error ? <ErrorState message="Couldn't load sessions." onRetry={() => history.refetch()} /> :
            sessions.length === 0 ? <EmptyState action={<Link to={`/w/${ws.id}/record`} className="link">Record a session</Link>}>No sessions yet.</EmptyState> :
            <ul className="list-none m-0 p-0 flex flex-col gap-2">
              {sessions.slice(0, 5).map(s => (
                <li key={s.id}>
                  <Link to={`/w/${ws.id}/sessions/${s.id}`} className="row-card">
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{(s.patient_id && names[s.patient_id]) || s.analysis_json?.counselingStats?.name || 'Unassigned session'}</span>
                      <span className="block text-[12px] text-muted">{relativeDay(s.created_at)} · {s.analysis_json?.emotional_tone || '—'}</span>
                    </span>
                    <span className="hidden sm:block w-[140px]"><ConversationStrip turns={s.analysis_json?.conversation?.turns || []} professional={ws.professional} client={ws.client} variant="mini" /></span>
                    {isRiskFlagged(s) && <span className="pill pill-negative">Flag</span>}
                    {needsReview(s) && <span className="pill pill-warning">Review</span>}
                    <ChevronRight size={15} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>}
        </section>

        <Checklist className="lg:col-span-4" hasClient={(patients.data?.length || 0) > 0} hasSession={sessions.length > 0} />

        <section className="panel lg:col-span-12" aria-labelledby="topics">
          <h2 id="topics" className="m-0 mb-3 text-[14px] font-semibold">Topics in the last 30 days</h2>
          {history.isLoading ? <Skel h={120} /> : <BarList items={topics} />}
        </section>
      </div>
    </div>
  )
}

function Checklist({ className, hasClient, hasSession }: { className?: string; hasClient: boolean; hasSession: boolean }) {
  const ws = useWorkspace()
  const { profile, updateProfile } = useAuth()
  const providers = useProviders()
  const synced = useSyncedKeys()
  if (profile?.onboarding?.checklist_dismissed) return null

  const serverReady = !!providers.data && (providers.data.slots.NOTE_SYNTH?.entries.length || 0) > 0
  const keyReady = localKeys.list().length > 0 || (synced.data?.keys.length || 0) > 0 || serverReady
  const items = [
    { done: keyReady, label: 'Connect an AI model', to: '/settings/models', hint: serverReady && !localKeys.list().length ? 'Server keys are configured' : undefined },
    { done: hasClient, label: `Add a ${ws.client.toLowerCase()}`, to: `/w/${ws.id}/clients` },
    { done: hasSession, label: 'Record or upload a session', to: `/w/${ws.id}/record` },
    { done: !!profile?.onboarding?.viewed_note, label: `Review a ${ws.noteName}` },
    { done: !!(profile?.full_name && profile?.title), label: 'Complete your profile', to: '/settings/profile' },
  ]
  const done = items.filter(i => i.done).length
  return (
    <section className={clsx('panel', className)} aria-labelledby="getting-started" data-tour="checklist">
      <div className="flex items-baseline justify-between">
        <h2 id="getting-started" className="m-0 text-[14px] font-semibold">Getting started</h2>
        <span className="text-[12px] text-muted num">{done} of {items.length}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 mt-3 overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length}>
        <div className="h-full bg-positive rounded-full transition-[width] duration-500" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="list-none m-0 p-0 mt-4 flex flex-col gap-1">
        {items.map(it => {
          const body = (
            <>
              <span className={clsx('w-5 h-5 rounded-full flex items-center justify-center flex-none border', it.done ? 'bg-positive border-positive text-white' : 'border-control')}>{it.done && <Check size={12} strokeWidth={3} />}</span>
              <span className="flex-1">
                <span className={clsx('block', it.done && 'text-muted line-through decoration-control')}>{it.label}</span>
                {it.hint && <span className="block text-[12px] text-muted">{it.hint}</span>}
              </span>
            </>
          )
          return <li key={it.label}>{it.to && !it.done ? <Link to={it.to} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-surface-2">{body}</Link> : <div className="flex items-center gap-3 px-2 py-2">{body}</div>}</li>
        })}
      </ul>
      {done === items.length && <button className="link text-[13px] mt-3" onClick={() => updateProfile({ onboarding: { ...profile?.onboarding, checklist_dismissed: true } })}>Hide this list</button>}
    </section>
  )
}
