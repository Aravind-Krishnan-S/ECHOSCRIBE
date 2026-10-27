import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Check, Download, Pencil, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader } from '../components/AppShell'
import { ConversationStrip } from '../components/ConversationStrip'
import { Dialog, ErrorState, Skel, Spinner, useToast } from '../components/ui'
import { api, download } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtTime, duration } from '../lib/format'
import { useSession } from '../lib/queries'
import { numberTranscript, type NumberedTurn } from '../lib/transcript'
import { useWorkspace } from '../lib/useWorkspace'
import type { Analysis, GroundedSentence, Patient, Session } from '../lib/types'

const LABEL_TEXT: Record<string, string> = {
  supported: 'Supported by the cited turns',
  partial: 'Partly supported — adds a detail the cited turns do not contain',
  unsupported: 'Not supported by the cited turns — check before keeping',
  unverified: 'Not verified (no second vendor was available)',
  edited: 'Edited by you',
}

export default function Summary() {
  const ws = useWorkspace()
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { profile, updateProfile } = useAuth()
  const { data: session, isLoading, error, refetch } = useSession(id, ws.api)
  const patient = useQuery({
    queryKey: ['patient', session?.patient_id],
    queryFn: () => api<Patient>(`/api/patients/${session!.patient_id}?mode=${ws.api}`),
    enabled: !!session?.patient_id,
  })
  const [focus, setFocus] = useState<number[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const analysis = session?.analysis_json
  const turns = useMemo(() => numberTranscript(session?.transcript || ''), [session?.transcript])

  // First time a note is opened counts toward the getting-started checklist
  const viewed = profile?.onboarding?.viewed_note
  useEffect(() => {
    if (analysis && profile && !viewed) updateProfile({ onboarding: { ...profile.onboarding, viewed_note: true } }).catch(() => {})
  }, [analysis, profile, viewed, updateProfile])

  const save = useMutation({
    mutationFn: (next: Analysis) => api<Session>(`/api/session/${id}?mode=${ws.api}`, { method: 'PUT', json: { analysisJson: next } }),
    onSuccess: data => { qc.setQueryData(['session', id], data); toast('Note saved', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/session/${id}?mode=${ws.api}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['history'] }); navigate(`/w/${ws.id}`) },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  if (isLoading) return <SummarySkeleton />
  if (error || !session || !analysis) {
    return <div className="p-6 lg:p-8"><ErrorState message={(error as Error)?.message || 'This session could not be loaded.'} onRetry={() => refetch()} /></div>
  }

  const group = (ws.id === 'mentoring' ? analysis.grow : analysis.soap) as Record<string, string> | undefined
  const grounding = analysis.grounding
  const sum = grounding?.summary
  const clientName = patient.data?.name || analysis.counselingStats?.name || ws.client
  const dur = analysis.conversation?.durationSec

  function startEdit(key: string) {
    setEditing(key)
    setDraft(group?.[key] || '')
  }
  function commitEdit(key: string) {
    const groupKey = ws.id === 'mentoring' ? 'grow' : 'soap'
    const next: Analysis = JSON.parse(JSON.stringify(analysis))
    ;(next as unknown as Record<string, Record<string, string>>)[groupKey][key] = draft.trim() || 'Not discussed'
    if (next.grounding) next.grounding.sections[key] = [{ text: draft.trim(), turns: [], label: 'edited' }]
    save.mutate(next)
    setEditing(null)
  }

  return (
    <>
      <PageHeader
        back={<Link to={session.patient_id ? `/w/${ws.id}/clients/${session.patient_id}` : `/w/${ws.id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-1"><ArrowLeft size={14} />{session.patient_id ? clientName : 'Home'}</Link>}
        title={`${ws.noteName} · ${clientName}`}
        subtitle={`${fmtDate(session.created_at)}, ${fmtTime(session.created_at)}${dur ? ` · ${duration(dur)}` : ''} · written by ${analysis._provider || 'unknown model'}`}
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => download(`/api/export/pdf/${session.id}`, `echoscribe-${session.id}.pdf`).catch(e => toast(e.message, 'error'))}><Download size={14} />PDF</button>
          <button className="btn btn-ghost btn-sm btn-icon" aria-label="Delete session" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
        </>}
      />

      <div className="px-4 sm:px-6 lg:px-8 pb-10 grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* the note */}
        <section className="xl:col-span-7 flex flex-col gap-4" aria-label={ws.noteName} data-tour="note">
          {sum && (
            <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 !py-4">
              <span className="flex items-center gap-2 font-medium">
                {sum.unsupported + sum.partial === 0 ? <ShieldCheck size={16} className="text-positive" /> : <AlertTriangle size={16} className="text-warning" />}
                <span className="num">{sum.supported} of {sum.statements}</span> sentences supported by their cited turns
              </span>
              {sum.partial > 0 && <span className="pill pill-warning num">{sum.partial} partly supported</span>}
              {sum.unsupported > 0 && <span className="pill pill-negative num">{sum.unsupported} unsupported</span>}
              <span className="text-[12px] text-muted ml-auto">Checked by {grounding?.verifier || '—'}</span>
            </div>
          )}
          {grounding?.cascade?.escalated && (
            <p className="text-[13px] text-muted m-0 -mt-1">Regenerated on another model after the first draft failed verification ({grounding.cascade.reason}); kept {grounding.cascade.kept}.</p>
          )}

          {ws.sections.map(sec => {
            const sentences = grounding?.sections?.[sec.key]
            const text = group?.[sec.key] || 'Not discussed'
            return (
              <article key={sec.key} className="panel">
                <header className="flex items-center gap-3 mb-3">
                  <span className="w-8 h-8 rounded-[10px] bg-accent-tint text-accent-ink font-semibold flex items-center justify-center" aria-hidden>{sec.letter}</span>
                  <div className="flex-1 min-w-0">
                    <h2 className="m-0 text-[16px] leading-6 font-semibold">{sec.title}</h2>
                    <p className="m-0 text-[12px] text-muted">{sec.hint}</p>
                  </div>
                  {editing !== sec.key && <button className="btn btn-ghost btn-sm" onClick={() => startEdit(sec.key)}><Pencil size={13} />Edit</button>}
                </header>
                {editing === sec.key ? (
                  <div>
                    <textarea className="input min-h-[120px]" value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Edit ${sec.title}`} autoFocus />
                    <div className="flex justify-end gap-2 mt-3">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={() => commitEdit(sec.key)} disabled={save.isPending}>{save.isPending ? <Spinner /> : <Check size={14} />}Save</button>
                    </div>
                  </div>
                ) : sentences && sentences.length ? (
                  <p className="m-0 text-[15px] leading-[26px]">
                    {sentences.map((s, i) => <Sentence key={i} s={s} onFocus={setFocus} active={focus.length > 0 && s.turns.join() === focus.join()} />)}
                  </p>
                ) : (
                  <p className={clsx('m-0 text-[15px] leading-[26px]', /^not discussed/i.test(text) && 'text-muted')}>{text}</p>
                )}
              </article>
            )
          })}

          <TakeHome analysis={analysis} />
        </section>

        {/* evidence, risk, conversation */}
        <aside className="xl:col-span-5 flex flex-col gap-4">
          <RiskPanel analysis={analysis} onFocus={setFocus} workspace={ws.id} />
          {analysis.conversation?.turns?.length ? (
            <div className="panel">
              <h2 className="m-0 mb-3 text-[14px] font-semibold">Who spoke when</h2>
              <ConversationStrip turns={analysis.conversation.turns} professional={ws.professional} client={ws.client} />
            </div>
          ) : null}
          <TranscriptPanel turns={turns} focus={focus} />
        </aside>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this session?"
        description="The note, transcript and audio are removed permanently."
        footer={<>
          <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending && <Spinner />}Delete session</button>
        </>} />
    </>
  )
}

function Sentence({ s, onFocus, active }: { s: GroundedSentence; onFocus: (t: number[]) => void; active: boolean }) {
  const label = s.label || 'unverified'
  const cite = s.turns.length ? ` (turns ${s.turns.join(', ')})` : ' (no turns cited)'
  return (
    <>
      <span
        tabIndex={0}
        role="button"
        aria-label={`${s.text}. ${LABEL_TEXT[label]}${cite}.`}
        title={`${LABEL_TEXT[label]}${cite}${s.reason ? ` — ${s.reason}` : ''}`}
        onMouseEnter={() => onFocus(s.turns)}
        onFocus={() => onFocus(s.turns)}
        onMouseLeave={() => onFocus([])}
        onBlur={() => onFocus([])}
        className={clsx('rounded-[4px] cursor-default transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent',
          active && 'bg-accent-tint',
          label === 'partial' && 'underline decoration-[#d97706] decoration-dotted decoration-2 underline-offset-4',
          label === 'unsupported' && 'underline decoration-negative decoration-wavy underline-offset-4 bg-[#fdecea]/60')}
      >
        {s.text}
      </span>
      {label === 'unsupported' && <AlertTriangle size={13} className="inline -mt-0.5 ml-1 text-negative" aria-hidden />}
      {s.turns.length > 0 && <sup className="text-[10px] text-muted num ml-0.5" aria-hidden>{s.turns.join(',')}</sup>}
      {' '}
    </>
  )
}

function TranscriptPanel({ turns, focus }: { turns: NumberedTurn[]; focus: number[] }) {
  const set = new Set(focus)
  return (
    <div className="panel !p-0 overflow-hidden" data-tour="transcript">
      <h2 className="m-0 px-5 pt-4 pb-3 text-[14px] font-semibold">Transcript <span className="font-normal text-muted num">· {turns.length} turns</span></h2>
      <ol className="list-none m-0 px-3 pb-3 max-h-[560px] overflow-auto flex flex-col gap-1">
        {turns.map(t => (
          <li key={t.id} ref={el => { if (el && set.has(t.id) && focus[0] === t.id) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }}
            className={clsx('grid grid-cols-[34px_1fr] gap-2 rounded-[10px] px-2 py-1.5 transition-colors duration-150', set.has(t.id) ? 'bg-accent-tint' : 'bg-transparent')}>
            <span className="num text-[11px] text-muted pt-0.5">T{t.id}</span>
            <span className="text-[13px] leading-[19px]"><span className="font-medium">{t.role}: </span>{t.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function RiskPanel({ analysis, onFocus, workspace }: { analysis: Analysis; onFocus: (t: number[]) => void; workspace: 'therapy' | 'mentoring' }) {
  const r = analysis.risk_assessment || {}
  const c = r.consensus
  const therapy = workspace === 'therapy'
  const primaryFlag = therapy
    ? !!(r.suicidal_ideation || ['moderate', 'high'].includes(String(r.self_harm_risk || '').toLowerCase()))
    : !!(r.academic_burnout || ['moderate', 'high'].includes(String(r.severe_distress_risk || '').toLowerCase()))
  const flagged = c ? !!c.flagged : primaryFlag
  const evidence = (c?.second_opinion?.evidence_turns || []) as number[]
  return (
    <div className={clsx('panel', flagged && '!bg-[#fdf3f1]')} data-tour="risk">
      <div className="flex items-start gap-3">
        {flagged ? <ShieldAlert size={18} className="text-negative mt-0.5" /> : <ShieldCheck size={18} className="text-positive mt-0.5" />}
        <div className="flex-1">
          <h2 className="m-0 text-[15px] font-semibold">{flagged ? (therapy ? 'Risk language flagged' : 'Wellbeing concern flagged') : (therapy ? 'No risk language flagged' : 'No wellbeing concern flagged')}</h2>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {therapy
              ? <>Suicidal ideation: <b className="text-ink">{r.suicidal_ideation ? 'yes' : 'no'}</b> · self-harm risk: <b className="text-ink">{r.self_harm_risk || '—'}</b></>
              : <>Burnout: <b className="text-ink">{r.academic_burnout ? 'yes' : 'no'}</b> · distress: <b className="text-ink">{r.severe_distress_risk || '—'}</b></>}
          </p>
        </div>
      </div>
      {c && !c.error && (
        <p className={clsx('m-0 mt-3 text-[13px] rounded-[10px] px-3 py-2', c.needs_review ? 'bg-[#fffbeb] text-[#92400e]' : 'bg-raised text-muted')}>
          {c.needs_review ? 'The two screening models disagree — review the transcript.' : 'A second model from another vendor agrees.'}{' '}
          {evidence.length > 0 && (
            <button className="link" onMouseEnter={() => onFocus(evidence)} onFocus={() => onFocus(evidence)} onMouseLeave={() => onFocus([])} onBlur={() => onFocus([])}>
              Show cited turns ({evidence.join(', ')})
            </button>
          )}
        </p>
      )}
      {r.notes && <p className="m-0 mt-3 text-[13px] leading-[19px]">{r.notes}</p>}
      <p className="m-0 mt-3 text-[11px] leading-4 text-muted">
        Automated screen by language models. It is not derived from or validated against the C-SSRS, PHQ-9 or any clinical instrument. No alert does not mean no risk, and an alert is not a diagnosis; you remain responsible for risk assessment.
      </p>
    </div>
  )
}

function TakeHome({ analysis }: { analysis: Analysis }) {
  const comm = analysis.patient_communication
  const booking = analysis.auto_booking
  const referral = analysis.referral_form
  if (!comm && !booking && !referral) return null
  return (
    <div className="panel grid grid-cols-1 md:grid-cols-2 gap-4">
      {comm?.instructions_english && (
        <div className="md:col-span-2">
          <h2 className="m-0 mb-1 text-[14px] font-semibold">Take-home summary</h2>
          <p className="m-0 text-[14px] leading-[21px]">{comm.instructions_english}</p>
        </div>
      )}
      {booking && <div><h3 className="m-0 text-[13px] font-semibold">Follow-up</h3><p className="m-0 text-[13px] text-muted">{booking.needs_follow_up ? `Suggested: ${booking.suggested_timeframe}` : 'None suggested'}</p></div>}
      {referral && <div><h3 className="m-0 text-[13px] font-semibold">Referral</h3><p className="m-0 text-[13px] text-muted">{referral.referral_needed ? referral.specialty_or_service : 'None suggested'}</p></div>}
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 xl:grid-cols-12 gap-4" aria-busy="true">
      <div className="xl:col-span-12"><Skel w={320} h={28} /><Skel w={220} h={14} className="mt-2" /></div>
      <div className="xl:col-span-7 flex flex-col gap-4">{[0, 1, 2, 3].map(i => <div key={i} className="panel"><Skel w={140} h={18} /><Skel h={14} className="mt-4" /><Skel h={14} className="mt-2" /><Skel w="60%" h={14} className="mt-2" /></div>)}</div>
      <div className="xl:col-span-5 flex flex-col gap-4"><div className="panel"><Skel w={180} h={18} /><Skel h={50} className="mt-3" /></div><div className="panel"><Skel h={300} /></div></div>
    </div>
  )
}
