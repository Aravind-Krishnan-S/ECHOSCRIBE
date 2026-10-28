import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Mic } from 'lucide-react'
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

/* The row's pack stripe: the worst verification outcome of the note. */
function sessionCode(s: Session) {
  const g = s.analysis_json?.grounding?.summary
  if (!g) return 'unverified'
  if (g.unsupported > 0) return 'unsupported'
  if (g.partial > 0) return 'partial'
  return 'supported'
}

export default function Home() {
  const ws = useWorkspace()
  const navigate = useNavigate()
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

  const figures = [
    { label: ws.clients, value: patients.data?.length, to: `/w/${ws.id}/clients` },
    { label: 'Sessions this week', value: history.data ? week.length : undefined },
    { label: `${ws.riskLabel} flags · 30 days`, value: history.data ? flagged.length : undefined, code: flagged.length > 0 ? 'unsupported' : undefined },
    { label: 'Notes to review · 30 days', value: history.data ? review.length : undefined, code: review.length > 0 ? 'partial' : undefined },
  ]

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-7 lg:py-10 max-w-[1200px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] sm:text-[44px] leading-[1.05] font-bold tracking-[-0.035em] m-0">{greeting()}, {firstName(profile?.full_name, profile?.email)}.</h1>
          <p className="text-[15px] text-muted m-0 mt-2 min-h-[22px]">{finding}</p>
        </div>
        <Link to={`/w/${ws.id}/record`} className="btn btn-primary btn-lg" data-tour="new-session"><Mic size={16} />New session</Link>
      </header>

      {/* figures: one ruled band, label under a large tabular value */}
      <section aria-label="Overview" className="mt-9 grid grid-cols-2 md:grid-cols-4 border-t-2 border-ink">
        {figures.map((k, i) => {
          const body = (
            <>
              {k.value === undefined ? <Skel w={48} h={40} /> :
                <p className={clsx('m-0 num text-[40px] leading-[44px] font-bold tracking-[-0.03em]', k.code === 'unsupported' && 'text-negative')}>{k.value}</p>}
              <p className="m-0 mt-1 text-[13px] text-muted flex items-center gap-1.5">{k.code && <span className="code-chip" data-code={k.code} />}{k.label}</p>
            </>
          )
          const cls = clsx('block py-4 pr-4 border-b border-border', i % 2 === 1 && 'pl-4 border-l md:border-l', i > 1 && 'md:pl-4 md:border-l', i === 1 && 'md:pl-4')
          return k.to ? <Link key={k.label} to={k.to} className={clsx(cls, 'hover:bg-surface')}>{body}</Link> : <div key={k.label} className={cls}>{body}</div>
        })}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-8 mt-10">
        <section className="lg:col-span-8" aria-labelledby="recent">
          <div className="flex items-baseline justify-between mb-3">
            <h2 id="recent" className="m-0 text-[18px] font-bold">Recent sessions {history.data && <span className="text-muted font-semibold num">{sessions.length}</span>}</h2>
            {sessions.length > 8 && <Link to={`/w/${ws.id}/clients`} className="link text-[13px]">All {ws.clients.toLowerCase()}</Link>}
          </div>
          {history.isLoading ? <div className="flex flex-col gap-2">{[0, 1, 2, 3].map(i => <Skel key={i} h={44} />)}</div> :
            history.error ? <ErrorState message="Couldn't load sessions." onRetry={() => history.refetch()} /> :
            sessions.length === 0 ? <EmptyState action={<Link to={`/w/${ws.id}/record`} className="link">Record a session</Link>}>No sessions yet.</EmptyState> :
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{ws.client}</th>
                    <th scope="col">When</th>
                    <th scope="col" className="hidden md:table-cell">Who spoke</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.slice(0, 8).map(s => {
                    const g = s.analysis_json?.grounding?.summary
                    const href = `/w/${ws.id}/sessions/${s.id}`
                    return (
                      <tr key={s.id} className="cursor-pointer" onClick={() => navigate(href)}>
                        <td className="stripe !pl-[22px] font-semibold" data-code={sessionCode(s)}>
                          <Link to={href} className="hover:underline" onClick={e => e.stopPropagation()}>
                            {(s.patient_id && names[s.patient_id]) || s.analysis_json?.counselingStats?.name || 'Unassigned session'}
                          </Link>
                        </td>
                        <td className="text-muted whitespace-nowrap">{relativeDay(s.created_at)}</td>
                        <td className="hidden md:table-cell w-[150px]"><ConversationStrip turns={s.analysis_json?.conversation?.turns || []} professional={ws.professional} client={ws.client} variant="mini" /></td>
                        <td className="whitespace-nowrap">
                          {g ? <span className="num text-[13px]">{g.supported}/{g.statements} supported</span> : <span className="text-[13px] text-faint">not verified</span>}
                          {isRiskFlagged(s) && <span className="pill pill-negative ml-2">Flag</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>}
        </section>

        <Checklist className="lg:col-span-4" hasClient={(patients.data?.length || 0) > 0} hasSession={sessions.length > 0} />

        <section className="lg:col-span-8" aria-labelledby="topics">
          <h2 id="topics" className="m-0 mb-3 text-[18px] font-bold">Topics in the last 30 days</h2>
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
    <section className={clsx('panel self-start', className)} aria-labelledby="getting-started" data-tour="checklist">
      <div className="flex items-baseline justify-between">
        <h2 id="getting-started" className="m-0 text-[15px] font-bold">Getting started</h2>
        <span className="text-[12px] text-muted num">{done} of {items.length}</span>
      </div>
      <div className="flex gap-[2px] mt-3" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label="Getting started progress">
        {items.map((it, i) => <span key={i} className={clsx('h-1.5 flex-1 transition-colors duration-300', it.done ? 'bg-accent' : 'bg-surface-2')} />)}
      </div>
      <ul className="list-none m-0 p-0 mt-4 flex flex-col">
        {items.map(it => {
          const body = (
            <>
              <span className={clsx('w-5 h-5 flex items-center justify-center flex-none border', it.done ? 'bg-accent border-accent text-on-accent' : 'border-control')}>{it.done && <Check size={12} strokeWidth={3} />}</span>
              <span className="flex-1">
                <span className={clsx('block', it.done && 'text-muted')}>{it.label}</span>
                {it.hint && <span className="block text-[12px] text-muted">{it.hint}</span>}
              </span>
            </>
          )
          return <li key={it.label} className="border-t border-rule first:border-t-0">{it.to && !it.done ? <Link to={it.to} className="flex items-center gap-3 px-1 py-2.5 hover:bg-surface">{body}</Link> : <div className="flex items-center gap-3 px-1 py-2.5">{body}</div>}</li>
        })}
      </ul>
      {done === items.length && <button className="link text-[13px] mt-3" onClick={() => updateProfile({ onboarding: { ...profile?.onboarding, checklist_dismissed: true } })}>Hide this list</button>}
    </section>
  )
}
