import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useAuth } from '../lib/auth'
import { lastWorkspace } from '../lib/useWorkspace'
import { WORKSPACES, workspacesFor } from '../lib/workspace'
import type { WorkspaceId } from '../lib/types'

interface Step {
  id: string
  route?: (ws: WorkspaceId) => string
  target?: string            // data-tour value
  title: string
  body: string
}

function buildSteps(ws: WorkspaceId, canSwitch: boolean): Step[] {
  const w = WORKSPACES[ws]
  const steps: Step[] = [
    {
      id: 'welcome',
      route: id => `/w/${id}`,
      title: 'Welcome to EchoScribe',
      body: `Record a session, and EchoScribe separates the two speakers, transcribes them and drafts a ${w.noteName} for you to review. This tour takes about a minute.`,
    },
  ]
  if (canSwitch) steps.push({
    id: 'workspace',
    target: 'workspace-switcher',
    title: 'Two separate workspaces',
    body: 'Therapy and Mentoring keep their own clients, sessions and notes. Switch here at any time; nothing crosses between them.',
  })
  steps.push(
    {
      id: 'models',
      route: () => '/settings/models',
      target: 'models-keys',
      title: 'Connect an AI model',
      body: 'Paste a Gemini or Groq key and press Test. Keys stay in this browser unless you switch on “Sync to my account”. If your organisation set up server keys, you can skip this.',
    },
    {
      id: 'clients',
      route: id => `/w/${id}/clients`,
      target: 'add-client',
      title: `Add your first ${w.client.toLowerCase()}`,
      body: `Each ${w.client.toLowerCase()} keeps a history of sessions, so EchoScribe can show how things change over time.`,
    },
    {
      id: 'record',
      route: id => `/w/${id}/record`,
      target: 'record-controls',
      title: 'Record or upload a session',
      body: 'Record in the browser, or drop in an audio file. When you stop, EchoScribe shows each step of the analysis as it happens.',
    },
    {
      id: 'checklist',
      route: id => `/w/${id}`,
      target: 'checklist',
      title: 'Your getting-started list',
      body: 'It ticks itself off as you go. When a note is ready, check the risk screen yourself: it is a model judgement, not a clinical instrument.',
    },
    {
      id: 'profile',
      target: 'user-menu',
      title: 'Profile and settings',
      body: 'Edit your details, change your role or password, and replay this tour from here or from Settings.',
    },
  )
  return steps
}

interface TourApi { start: () => void; active: boolean }
const TourContext = createContext<TourApi>({ start: () => {}, active: false })
export const useTour = () => useContext(TourContext)

export function TourProvider({ children }: { children: ReactNode }) {
  const { profile, updateProfile } = useAuth()
  const navigate = useNavigate()
  const [index, setIndex] = useState<number | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const autoStarted = useRef(false)

  const workspaces = workspacesFor(profile?.role)
  const ws = (lastWorkspace() && workspaces.includes(lastWorkspace()!) ? lastWorkspace()! : workspaces[0]) as WorkspaceId
  const steps = useMemo(() => buildSteps(ws, workspaces.length > 1), [ws, workspaces.length])
  const step = index !== null ? steps[index] : null

  const start = useCallback(() => setIndex(0), [])
  const finish = useCallback((completed: boolean) => {
    setIndex(null)
    setRect(null)
    updateProfile({ onboarding: { ...(profile?.onboarding || {}), ...(completed ? { tour_completed: true } : { tour_dismissed: true }) } }).catch(() => {})
  }, [profile?.onboarding, updateProfile])

  // First login: start once a workspace page is showing
  useEffect(() => {
    if (autoStarted.current || !profile) return
    const ob = profile.onboarding || {}
    if (ob.tour_completed || ob.tour_dismissed) return
    if (!/^\/w\//.test(window.location.pathname)) return
    autoStarted.current = true
    const t = setTimeout(() => setIndex(0), 900)
    return () => clearTimeout(t)
  })

  // Navigate to the step's page, then wait for its target to exist
  useEffect(() => {
    if (!step) return
    if (step.route) {
      const path = step.route(ws)
      if (window.location.pathname !== path) navigate(path)
    }
    if (!step.target) { setRect(null); return }
    let cancelled = false
    let tries = 0
    const find = () => {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      if (el && el.getBoundingClientRect().width > 0) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => !cancelled && setRect(el.getBoundingClientRect()), 260)
      } else if (tries++ < 40) {
        setTimeout(find, 100)
      } else {
        setRect(null) // target not on this layout (e.g. phone menu closed): show as a centred card
      }
    }
    find()
    return () => { cancelled = true }
  }, [step, ws, navigate])

  // Keep the spotlight on the target as the page moves
  useLayoutEffect(() => {
    if (!step?.target) return
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update) }
  }, [step])

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false)
      if (e.key === 'ArrowRight') setIndex(i => (i !== null && i < steps.length - 1 ? i + 1 : i))
      if (e.key === 'ArrowLeft') setIndex(i => (i !== null && i > 0 ? i - 1 : i))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, steps.length, finish])

  const api = useMemo(() => ({ start, active: index !== null }), [start, index])

  return (
    <TourContext.Provider value={api}>
      {children}
      <AnimatePresence>
        {step && index !== null && (
          <TourOverlay key="tour" step={step} rect={rect} index={index} total={steps.length}
            onNext={() => (index < steps.length - 1 ? setIndex(index + 1) : finish(true))}
            onBack={() => setIndex(Math.max(0, index - 1))}
            onSkip={() => finish(false)} />
        )}
      </AnimatePresence>
    </TourContext.Provider>
  )
}

function TourOverlay({ step, rect, index, total, onNext, onBack, onSkip }: {
  step: Step; rect: DOMRect | null; index: number; total: number
  onNext: () => void; onBack: () => void; onSkip: () => void
}) {
  const pad = 8
  const vw = window.innerWidth, vh = window.innerHeight
  const hole = rect ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 } : null

  // Bubble below the target if there is room, else above; centred when there is no target
  const bubbleW = Math.min(360, vw - 32)
  let style: CSSProperties
  if (hole) {
    const below = hole.y + hole.h + 12
    const top = below + 200 < vh ? below : Math.max(16, hole.y - 12 - 200)
    const left = Math.min(Math.max(16, hole.x + hole.w / 2 - bubbleW / 2), vw - bubbleW - 16)
    style = { top, left, width: bubbleW }
  } else {
    style = { top: '50%', left: '50%', width: bubbleW, transform: 'translate(-50%, -50%)' }
  }

  return (
    <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <svg className="absolute inset-0 w-full h-full" aria-hidden onClick={onSkip}>
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="white" />
            {hole && <motion.rect animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} rx="14" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(31,32,29,0.38)" mask="url(#tour-hole)" />
        {hole && <motion.rect animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          rx="14" fill="none" stroke="white" strokeOpacity=".9" strokeWidth="2" />}
      </svg>

      <motion.div role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
        className="glass absolute rounded-[6px] p-5" style={style}
        key={step.id}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
        <p className="text-[12px] text-muted m-0 num">Step {index + 1} of {total}</p>
        <h2 id="tour-title" className="text-[17px] leading-6 font-semibold mt-1 mb-1.5">{step.title}</h2>
        <p id="tour-body" className="text-[14px] leading-[21px] m-0">{step.body}</p>
        <div className="flex items-center gap-2 mt-4">
          <button className="btn btn-ghost btn-sm -ml-2" onClick={onSkip}>Skip tour</button>
          <span className="flex-1" />
          {index > 0 && <button className="btn btn-secondary btn-sm" onClick={onBack}>Back</button>}
          <button className="btn btn-primary btn-sm" onClick={onNext} autoFocus>{index === total - 1 ? 'Finish' : 'Next'}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
