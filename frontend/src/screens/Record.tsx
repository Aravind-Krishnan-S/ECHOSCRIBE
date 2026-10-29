import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowLeftRight, Check, Circle, FileAudio, Mic, Square, Upload, X } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader } from '../components/AppShell'
import { ConversationStrip } from '../components/ConversationStrip'
import { ErrorState, Field, useToast } from '../components/ui'
import { ApiError, apiFetch, uploadWithProgress } from '../lib/api'
import { useAuth } from '../lib/auth'
import { clock, wordCount } from '../lib/format'
import { usePatients } from '../lib/queries'
import { useWorkspace } from '../lib/useWorkspace'
import { LANGUAGES } from '../lib/workspace'
import type { Turn } from '../lib/types'

const CHUNK_MS = 12_000
const ACCEPT = '.mp3,.wav,.webm,.ogg,.flac,.m4a,.mp4,.mpeg,.mpga,.opus'

interface TranscribeResult {
  text: string
  turns: (Turn & { role: string; text: string })[]
  roleMap: Record<string, string>
  _sttProvider?: string
  _diarizationProvider?: string
  _roleProvider?: string
  _enhancedBySpeechBrain?: boolean
  durationSec?: number | null
}

type StageState = 'pending' | 'active' | 'done' | 'error'
interface Stage { key: string; label: string; state: StageState; detail?: string }

export default function Record() {
  const ws = useWorkspace()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [params] = useSearchParams()
  const patients = usePatients(ws.api)

  const [clientId, setClientId] = useState(params.get('client') || '')
  const [lang, setLang] = useState(profile?.prefs?.default_language || 'en')
  const [phase, setPhase] = useState<'idle' | 'recording' | 'processing' | 'review' | 'writing'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [live, setLive] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<TranscribeResult | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const rec = useRef<{ stream?: MediaStream; full?: MediaRecorder; chunk?: MediaRecorder; chunks: Blob[]; timer?: number; tick?: number; raf?: number; ctx?: AudioContext; start: number }>({ chunks: [], start: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => stopAll(), [])  // eslint-disable-line react-hooks/exhaustive-deps

  function setStage(key: string, state: StageState, detail?: string) {
    setStages(s => s.map(x => (x.key === key ? { ...x, state, detail: detail ?? x.detail } : x)))
  }

  function stopAll() {
    const r = rec.current
    clearInterval(r.timer); clearInterval(r.tick); cancelAnimationFrame(r.raf || 0)
    r.stream?.getTracks().forEach(t => t.stop())
    r.ctx?.close().catch(() => {})
  }

  async function start() {
    setFailure(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setFailure('Microphone access was blocked. Allow it in the browser’s site settings, or upload a recording instead.')
      return
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4'
    const r = rec.current
    r.stream = stream; r.chunks = []; r.start = Date.now()

    // full-length recording for analysis
    r.full = new MediaRecorder(stream, { mimeType: mime })
    r.full.ondataavailable = e => { if (e.data.size) r.chunks.push(e.data) }
    r.full.start(1000)

    // short chunks for the live transcript
    const startChunk = () => {
      const c = new MediaRecorder(stream, { mimeType: mime })
      const parts: Blob[] = []
      c.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
      c.onstop = () => { if (parts.length) sendLive(new Blob(parts, { type: mime })) }
      c.start()
      r.chunk = c
    }
    startChunk()
    r.timer = window.setInterval(() => { r.chunk?.stop(); if (r.stream?.active) startChunk() }, CHUNK_MS)
    r.tick = window.setInterval(() => setElapsed((Date.now() - r.start) / 1000), 250)

    // level meter
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    const loop = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += ((v - 128) / 128) ** 2
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
      r.raf = requestAnimationFrame(loop)
    }
    loop()
    r.ctx = ctx
    setLive([]); setElapsed(0); setPhase('recording')
  }

  async function sendLive(blob: Blob) {
    const form = new FormData()
    form.append('audio', blob, `chunk.${blob.type.includes('webm') ? 'webm' : 'mp4'}`)
    form.append('language', lang)
    form.append('mode', ws.api)
    form.append('live', 'true')
    try {
      const res = await apiFetch('/api/transcribe-audio', { method: 'POST', body: form })
      const data = await res.json()
      if (data.text?.trim()) setLive(l => [...l, data.text.trim()])
    } catch { /* the live view is best-effort; the full recording is analysed at the end */ }
  }

  function stop() {
    const r = rec.current
    r.chunk?.stop()
    const full = r.full
    if (full && full.state !== 'inactive') {
      full.onstop = () => {
        const type = r.chunks[0]?.type || 'audio/webm'
        const f = new File(r.chunks, `recording.${type.includes('webm') ? 'webm' : 'mp4'}`, { type })
        stopAll()
        analyse(f)
      }
      full.stop()
    }
  }

  function pickFile(f: File | undefined | null) {
    if (!f) return
    if (!/audio|video/.test(f.type) && !ACCEPT.split(',').some(ext => f.name.toLowerCase().endsWith(ext))) {
      toast('That file is not a recognised audio format.', 'error')
      return
    }
    analyse(f)
  }

  async function analyse(f: File) {
    setFile(f)
    setFailure(null)
    setPhase('processing')
    setStages([
      { key: 'upload', label: 'Upload the recording', state: 'active', detail: '0%' },
      { key: 'speakers', label: 'Separate the two speakers and transcribe', state: 'pending' },
      { key: 'roles', label: `Identify the ${ws.professional.toLowerCase()} and the ${ws.client.toLowerCase()}`, state: 'pending' },
    ])
    const form = new FormData()
    form.append('audio', f)
    form.append('language', lang)
    form.append('mode', ws.api)
    try {
      const data = await uploadWithProgress<TranscribeResult>('/api/transcribe-audio', form, frac => {
        setStage('upload', frac >= 1 ? 'done' : 'active', `${Math.round(frac * 100)}%`)
        if (frac >= 1) { setStage('speakers', 'active', 'running on the server'); setStage('roles', 'active', 'running on the server') }
      })
      setStage('upload', 'done', `${(f.size / 1e6).toFixed(1)} MB`)
      setStage('speakers', 'done', [data._diarizationProvider, data._sttProvider].filter(Boolean).join(' · '))
      setStage('roles', 'done', data._roleProvider)
      setResult(data)
      setPhase('review')
    } catch (e) {
      setStages(s => s.map(x => (x.state === 'active' ? { ...x, state: 'error' } : x)))
      setFailure(errorText(e))
      setPhase('idle')
    }
  }

  function swapRoles() {
    if (!result) return
    const [a, b] = [ws.professional, ws.client]
    const flip = (r: string) => (r === a ? b : r === b ? a : r)
    const turns = result.turns.map(t => ({ ...t, role: flip(t.role) }))
    setResult({ ...result, turns, text: turns.map(t => `${t.role}:\n    ${t.text}`).join('\n\n') })
  }

  async function writeNote() {
    if (!result || !file) return
    setPhase('writing')
    setStages(s => [...s,
      { key: 'note', label: `Write the ${ws.noteName}, citing transcript turns`, state: 'active', detail: 'running on the server' },
      { key: 'verify', label: 'Check every sentence with a model from another vendor', state: 'active', detail: 'running on the server' },
      { key: 'save', label: 'Save the session', state: 'pending' },
    ])
    const form = new FormData()
    form.append('text', result.text)
    form.append('language', lang)
    form.append('mode', ws.api)
    if (clientId) form.append('patientId', clientId)
    if (profile?.prefs?.auto_save !== false) form.append('audio', file)
    form.append('conversation', JSON.stringify({
      turns: result.turns.map(t => ({ role: t.role, start: t.start, end: t.end, words: wordCount(t.text) })),
      providers: { stt: result._sttProvider, diarization: result._diarizationProvider, roles: result._roleProvider },
      durationSec: result.durationSec ?? null,
    }))
    try {
      const res = await apiFetch('/api/summarize', { method: 'POST', body: form })
      const data = await res.json()
      const g = data.grounding?.summary
      setStage('note', 'done', data._provider)
      setStage('verify', 'done', g ? `${g.supported} of ${g.statements} supported · ${data.grounding.verifier || ''}` : 'not verified')
      if (!data.sessionId) throw new Error('The note was written but could not be saved.')
      setStage('save', 'done')
      qc.invalidateQueries({ queryKey: ['history'] })
      setTimeout(() => navigate(`/w/${ws.id}/sessions/${data.sessionId}`), 600)
    } catch (e) {
      setStages(s => s.map(x => (x.state === 'active' ? { ...x, state: 'error' } : x)))
      setFailure(errorText(e))
      setPhase('review')
    }
  }

  const words = useMemo(() => live.join(' ').split(/\s+/).filter(Boolean).length, [live])

  return (
    <>
      <PageHeader title="New session" subtitle={`${ws.label} · ${ws.noteName}`} />
      <div className="px-4 sm:px-6 lg:px-10 pt-2 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1200px]">
        <section className="panel lg:col-span-4 flex flex-col gap-4">
          <Field label={ws.client}>
            {p => (
              <select {...p} className="input" value={clientId} onChange={e => setClientId(e.target.value)} disabled={phase === 'recording' || phase === 'writing'}>
                <option value="">Not linked to a {ws.client.toLowerCase()}</option>
                {(patients.data || []).map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Session language" hint="Used for transcription and the translated take-home summary.">
            {p => (
              <select {...p} className="input" value={lang} onChange={e => setLang(e.target.value)} disabled={phase !== 'idle'}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            )}
          </Field>
          <p className="m-0 text-[12px] text-muted">Recordings of any length are supported. Record only with the consent of everyone in the room.</p>
        </section>

        <section className="panel lg:col-span-8" data-tour="record-controls" aria-label="Record or upload">
          {phase === 'idle' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button type="button" onClick={start} className="field-accent rounded-[4px] flex flex-col items-start justify-between gap-6 p-5 min-h-[168px] text-left hover:bg-accent-ink transition-colors">
                <Mic size={34} strokeWidth={2.2} />
                <span>
                  <span className="block font-bold text-[22px] tracking-[-0.02em]">Start recording</span>
                  <span className="block text-[13px] text-on-accent-muted mt-1">Uses this device’s microphone</span>
                </span>
              </button>
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]) }}
                className={clsx('rounded-[4px] border flex flex-col items-start justify-between gap-6 p-5 min-h-[168px] cursor-pointer transition-colors', dragOver ? 'border-accent bg-accent-tint' : 'border-control hover:border-ink hover:bg-surface')}
              >
                <Upload size={34} strokeWidth={2.2} />
                <span>
                  <span className="block font-bold text-[22px] tracking-[-0.02em]">Upload a recording</span>
                  <span className="block text-[13px] text-muted mt-1">Drop a file or choose one · MP3, WAV, M4A, WebM</span>
                </span>
                <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={e => pickFile(e.target.files?.[0])} />
              </label>
            </div>
          )}

          {phase === 'recording' && (
            <div className="flex flex-col gap-4">
              {/* in the room: one quiet field, the clock and the stop control, nothing else */}
              <div className="bg-accent-tint border-t-4 border-accent p-5 sm:p-7 min-h-[200px] flex flex-col justify-between">
                <p className="m-0 text-[13px] text-accent-ink flex items-center gap-2"><Circle size={8} className="fill-negative text-negative animate-pulse" />Recording · stop when the session ends</p>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                  <p className="m-0 num font-bold text-[56px] sm:text-[72px] leading-none tracking-[-0.04em] text-ink" aria-live="off">{clock(elapsed)}</p>
                  <div className="flex items-center gap-4">
                    <span className="flex items-end gap-[3px] h-10" aria-hidden>
                      {[0.5, 0.8, 1, 0.7, 0.45].map((k, i) => (
                        <motion.span key={i} className="w-[5px] bg-accent" animate={{ height: `${Math.max(12, Math.min(100, level * 160 * k + 12))}%` }} transition={{ duration: 0.12 }} />
                      ))}
                    </span>
                    <button className="btn btn-lg btn-primary" onClick={stop}><Square size={16} fill="currentColor" />Stop</button>
                  </div>
                </div>
              </div>
              <div className="panel !p-4 min-h-[120px] max-h-[240px] overflow-auto">
                <p className="m-0 mb-2 text-[12px] text-muted num">Live transcript · {words} words · updates every 12 s</p>
                <p className="m-0 leading-[22px]">{live.length ? live.join(' ') : <span className="text-muted">Listening…</span>}</p>
              </div>
            </div>
          )}

          {(phase === 'processing' || phase === 'writing' || (phase === 'review' && stages.length)) && (
            <AnalysisProgress stages={stages} fileName={file?.name} />
          )}

          {failure && <div className="mt-4"><ErrorState message={failure} onRetry={phase === 'review' ? writeNote : file ? () => analyse(file) : undefined} /></div>}
        </section>

        {phase === 'review' && result && (
          <section className="panel lg:col-span-12" aria-label="Transcript review">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h2 className="m-0 text-[18px] font-bold flex-1">Check the transcript</h2>
              <button className="btn btn-secondary btn-sm" onClick={swapRoles}><ArrowLeftRight size={14} />Swap {ws.professional.toLowerCase()} and {ws.client.toLowerCase()}</button>
              <button className="btn btn-primary" onClick={writeNote}><FileAudio size={15} />Write the {ws.noteName}</button>
            </div>
            <div className="mb-4"><ConversationStrip turns={result.turns.map(t => ({ ...t, words: wordCount(t.text) }))} professional={ws.professional} client={ws.client} /></div>
            <ol className="list-none m-0 p-0 flex flex-col gap-2 max-h-[480px] overflow-auto">
              {result.turns.map((t, i) => (
                <li key={i} className="grid grid-cols-[96px_1fr] gap-3 text-[14px] leading-[21px] border-b border-rule pb-2">
                  <span className={clsx('font-semibold', t.role === ws.professional ? 'text-accent-ink' : 'text-muted')}>{t.role}</span>
                  <span>{t.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </>
  )
}

/* Processing drawn as one line with stations: filled = done, ringed = running, hollow = waiting. */
function AnalysisProgress({ stages, fileName }: { stages: Stage[]; fileName?: string }) {
  return (
    <div aria-live="polite">
      <p className="m-0 mb-5 text-[13px] text-muted truncate">Analysing {fileName || 'the recording'}</p>
      <ol className="list-none m-0 p-0 relative">
        {stages.map((s, i) => (
          <li key={s.key} className="relative grid grid-cols-[28px_1fr] gap-3 pb-5 last:pb-0">
            {i < stages.length - 1 && (
              <span aria-hidden className={clsx('absolute left-[13px] top-[18px] bottom-[-2px] w-[2px] transition-colors duration-300', s.state === 'done' ? 'bg-accent' : 'bg-border')} />
            )}
            <span aria-hidden className={clsx('relative z-[1] mt-[3px] w-[16px] h-[16px] ml-[6px] flex items-center justify-center border-2 transition-colors duration-300',
              s.state === 'done' && 'bg-accent border-accent text-on-accent',
              s.state === 'active' && 'bg-ground border-accent',
              s.state === 'pending' && 'bg-ground border-control',
              s.state === 'error' && 'bg-negative border-negative text-white')}>
              {s.state === 'done' ? <Check size={10} strokeWidth={3.5} /> : s.state === 'error' ? <X size={10} strokeWidth={3.5} /> :
                s.state === 'active' ? <motion.span className="block w-[6px] h-[6px] bg-accent" animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.2, repeat: Infinity }} /> : null}
            </span>
            <span className="min-w-0">
              <span className={clsx('block font-semibold', s.state === 'pending' && 'text-muted font-medium')}>{s.label}{s.state === 'active' && <span className="sr-only"> (running)</span>}</span>
              {s.detail && <span className="block text-[12px] text-muted truncate">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function errorText(e: unknown) {
  if (e instanceof ApiError && e.attempts?.length) {
    return `${e.message} Tried: ${e.attempts.map(a => `${a.provider} (${a.outcome})`).join(', ')}. Check Settings → Models & API keys.`
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}
