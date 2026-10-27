import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Mic, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { ConversationStrip } from '../components/ConversationStrip'
import { BarList, TrendLine } from '../components/charts'
import { Avatar, Dialog, EmptyState, ErrorState, Skel, Spinner, useToast } from '../components/ui'
import { ClientDialog } from './Clients'
import { api } from '../lib/api'
import { relativeDay } from '../lib/format'
import { isRiskFlagged } from '../lib/queries'
import { useWorkspace } from '../lib/useWorkspace'
import type { ClientProfileInsights, Patient, Session } from '../lib/types'

export default function ClientDetail() {
  const ws = useWorkspace()
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'overview' | 'sessions'>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => api<Patient>(`/api/patients/${id}?mode=${ws.api}`) })
  const sessions = useQuery({ queryKey: ['patient-sessions', id], queryFn: () => api<Session[]>(`/api/patients/${id}/sessions?mode=${ws.api}`) })
  const insights = useMutation({
    mutationFn: () => api<ClientProfileInsights>(`/api/patients/${id}/profile?mode=${ws.api}`),
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/patients/${id}?mode=${ws.api}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patients'] }); navigate(`/w/${ws.id}/clients`) },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  if (patient.isLoading) return <div className="p-8"><Skel w={260} h={28} /><Skel w={180} h={14} className="mt-3" /></div>
  if (patient.error || !patient.data) return <div className="p-8"><ErrorState message={`This ${ws.client.toLowerCase()} could not be loaded.`} onRetry={() => patient.refetch()} /></div>
  const p = patient.data
  const list = sessions.data || []

  return (
    <>
      <PageHeader
        back={<Link to={`/w/${ws.id}/clients`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-1"><ArrowLeft size={14} />{ws.clients}</Link>}
        title={<span className="inline-flex items-center gap-3"><Avatar name={p.name} size={34} />{p.name}</span>}
        subtitle={[p.age ? `${p.age} years` : null, p.gender, p.email, `${list.length} sessions`].filter(Boolean).join(' · ')}
        actions={<>
          <Link to={`/w/${ws.id}/record?client=${p.id}`} className="btn btn-primary btn-sm"><Mic size={14} />New session</Link>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}><Pencil size={13} />Edit</button>
          <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Delete ${ws.client.toLowerCase()}`} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
        </>}
      />
      <div className="px-4 sm:px-6 lg:px-8 pb-10">
        <div className="tabs mb-5" role="tablist">
          <button role="tab" aria-selected={tab === 'overview'} className="tab" onClick={() => setTab('overview')}>Overview</button>
          <button role="tab" aria-selected={tab === 'sessions'} className="tab" onClick={() => setTab('sessions')}>Sessions <span className="num text-muted">{list.length}</span></button>
        </div>

        {tab === 'overview' ? (
          list.length === 0 ? <EmptyState action={<Link className="link" to={`/w/${ws.id}/record?client=${p.id}`}>Record the first session</Link>}>No sessions yet, so there is nothing to summarise.</EmptyState> :
          !insights.data ? (
            <div className="panel flex flex-wrap items-center gap-4">
              <p className="m-0 flex-1 min-w-[240px]">Summarise {plural(list.length)} into themes, an emotional trend and recommended focus. This uses one AI request.</p>
              <button className="btn btn-accent" onClick={() => insights.mutate()} disabled={insights.isPending}>{insights.isPending ? <Spinner /> : <Sparkles size={15} />}Generate insights</button>
            </div>
          ) : <Insights data={insights.data} />
        ) : (
          sessions.isLoading ? <Skel h={63} /> :
          list.length === 0 ? <EmptyState>No sessions yet.</EmptyState> :
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {list.map(s => (
              <li key={s.id}>
                <Link to={`/w/${ws.id}/sessions/${s.id}`} className="row-card">
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium">{relativeDay(s.created_at)}</span>
                    <span className="block text-[12px] text-muted truncate">{s.analysis_json?.emotional_tone || '—'} · {(s.analysis_json?.topics || []).slice(0, 3).join(', ') || 'no topics'}</span>
                  </span>
                  <span className="hidden sm:block w-[140px]"><ConversationStrip turns={s.analysis_json?.conversation?.turns || []} professional={ws.professional} client={ws.client} variant="mini" /></span>
                  {isRiskFlagged(s) && <span className="pill pill-negative">Flag</span>}
                  <ChevronRight size={15} className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ClientDialog open={editOpen} patient={p} onClose={() => setEditOpen(false)} />
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${p.name}?`}
        description={`Their profile is removed from ${ws.label}. Sessions already recorded are kept.`}
        footer={<>
          <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending && <Spinner />}Delete {p.name}</button>
        </>} />
    </>
  )
}

function plural(n: number) { return n === 1 ? '1 session' : `${n} sessions` }

function Insights({ data }: { data: ClientProfileInsights }) {
  const trend = (data.emotional_trend_data || []).map((d, i) => ({ x: `S${d.session ?? i + 1}`, y: Number(d.score) || 0 }))
  const topics = (data.topic_frequency || []).slice(0, 6).map(t => ({ label: t.topic, value: t.count }))
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <section className="panel lg:col-span-7">
        <h2 className="m-0 mb-2 text-[14px] font-semibold">Across sessions</h2>
        <p className="m-0 text-[15px] leading-[24px]">{data.journey_summary || '—'}</p>
        {data.recommended_focus?.length ? (
          <>
            <h3 className="m-0 mt-5 mb-2 text-[13px] font-semibold">Recommended focus</h3>
            <ul className="m-0 pl-5 flex flex-col gap-1">{data.recommended_focus.map(r => <li key={r}>{r}</li>)}</ul>
          </>
        ) : null}
        <p className="m-0 mt-5 text-[12px] text-muted">Generated by {data._provider || 'an AI model'} from saved notes. Review before relying on it.</p>
      </section>
      <section className="panel lg:col-span-5">
        <h2 className="m-0 text-[14px] font-semibold">Emotional trend <span className="font-normal text-muted">· {data.emotional_trend || '—'}</span></h2>
        <p className="m-0 mb-2 text-[12px] text-muted">Model-rated, 0–10 per session</p>
        <TrendLine points={trend} label="Emotional score per session" />
      </section>
      <section className="panel lg:col-span-12">
        <h2 className="m-0 mb-3 text-[14px] font-semibold">Recurring topics</h2>
        <BarList items={topics} unit="×" />
      </section>
    </div>
  )
}

