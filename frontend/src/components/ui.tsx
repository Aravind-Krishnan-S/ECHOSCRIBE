import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, Check, X } from 'lucide-react'
import clsx from 'clsx'
import { initials } from '../lib/format'

/* ─── Logo: a voice and its two echoes ─── */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <circle cx="9" cy="16" r="3.2" fill="var(--accent)" />
      <path d="M15 9.5a9 9 0 0 1 0 13" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M21 5.5a14.5 14.5 0 0 1 0 21" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 font-semibold text-[15px] tracking-[-0.01em]', className)}>
      <LogoMark />
      EchoScribe
    </span>
  )
}

/* ─── Avatar: photo, or initials on a pale tint ─── */
export function Avatar({ name, src, size = 32, tone = 'accent' }: { name?: string | null; src?: string | null; size?: number; tone?: 'accent' | 'neutral' }) {
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }
  if (src) return <img src={src} alt="" className="rounded-full object-cover flex-none" style={style} />
  return (
    <span
      aria-hidden
      className={clsx('rounded-full inline-flex items-center justify-center font-semibold flex-none',
        tone === 'accent' ? 'bg-accent-tint text-accent-ink' : 'bg-surface-2 text-muted')}
      style={style}
    >
      {initials(name)}
    </span>
  )
}

/* ─── Field: label above, hint or error below, tied with aria-describedby ─── */
export function Field({ label, hint, error, children, className }: {
  label: string
  hint?: ReactNode
  error?: string
  className?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}) {
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? <p id={`${id}-err`} className="field-error">{error}</p> : hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
    </div>
  )
}

/* ─── Switch ─── */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className="switch" onClick={() => onChange(!checked)} />
  )
}

/* ─── Spinner (only for in-button pending states) ─── */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/* ─── Dialog: glass, focus-trapped, Escape to close ─── */
export function Dialog({ open, onClose, title, description, children, footer, width = 520 }: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const focusables = () => node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || []
    setTimeout(() => (node?.querySelector<HTMLElement>('[data-autofocus]') || focusables()[0])?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const list = Array.from(focusables()).filter(el => !el.hasAttribute('disabled'))
        if (!list.length) return
        const first = list[0], last = list[list.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-[rgba(31,32,29,0.22)]" onClick={onClose} aria-hidden />
          <motion.div
            ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
            className="glass relative w-full rounded-t-[22px] sm:rounded-[22px] max-h-[92vh] overflow-auto"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div>
                <h2 id={titleId} className="text-[18px] leading-6 font-semibold">{title}</h2>
                {description && <p className="text-muted mt-1">{description}</p>}
              </div>
              <button className="btn btn-ghost btn-icon btn-sm -mr-2 -mt-1" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>
            {children && <div className="px-6 pt-5 pb-2">{children}</div>}
            {footer && <div className="flex flex-wrap justify-end gap-2 px-6 py-5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ─── Toasts ─── */
interface Toast { id: number; message: string; tone: 'default' | 'success' | 'error' }
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Toast['tone'] = 'default') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t.slice(-2), { id, message, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed z-[60] bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,440px)]" aria-live="polite">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="glass pointer-events-auto rounded-full px-4 py-2.5 flex items-center gap-2 text-[14px]">
              {t.tone === 'success' && <Check size={15} className="text-positive flex-none" />}
              {t.tone === 'error' && <AlertCircle size={15} className="text-negative flex-none" />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)

/* ─── Empty and error states ─── */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-dashed border-control px-4 py-3 text-muted">
      <span>{children}</span>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-raised border border-border px-4 py-3">
      <AlertCircle size={15} className="text-negative flex-none" />
      <span className="flex-1 min-w-0">{message}</span>
      {onRetry && <button className="link text-[13px]" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function Skel({ w, h = 14, className }: { w?: number | string; h?: number; className?: string }) {
  return <span className={clsx('skel block', className)} style={{ width: w ?? '100%', height: h }} aria-hidden />
}
