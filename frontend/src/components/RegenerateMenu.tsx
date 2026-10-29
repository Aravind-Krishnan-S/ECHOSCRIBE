import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { Spinner } from './ui'
import { api } from '../lib/api'

export interface ModelChoice { family: string; model: string }
interface SlotModel { family: string; model: string; label: string; available: boolean; cooldownSeconds: number; reason: string | null }

/* Split button: "Regenerate note" writes the note again with the best available model; the chevron opens a list
   to choose the model. The model that wrote the current note is greyed out, and a model that is exhausted
   (rate limited, keys cooling down or rejected) shows ⚠️ and cannot be clicked. */
export function RegenerateMenu({ currentWriter, busy, onRun }: { currentWriter?: string | null; busy: boolean; onRun: (choice?: ModelChoice) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const status = useQuery({
    queryKey: ['slot-status', 'NOTE_SYNTH'],
    queryFn: () => api<{ models: SlotModel[] }>('/api/providers/status?slot=NOTE_SYNTH'),
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // "Google Gemini (gemini-3.5-flash-lite)" -> "gemini-3.5-flash-lite"
  const currentModel = currentWriter?.match(/\(([^()]+)\)\s*$/)?.[1]

  function pick(choice?: ModelChoice) {
    setOpen(false)
    onRun(choice)
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button className="btn btn-secondary btn-sm !rounded-r-none" onClick={() => pick()} disabled={busy} title="Write the note again from the saved transcript, with the best available model">
        {busy ? <Spinner /> : <RefreshCw size={14} />}Regenerate note
      </button>
      <button className="btn btn-secondary btn-sm btn-icon !rounded-l-none -ml-px" aria-label="Choose the model for the new note" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)} disabled={busy}>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div role="menu" aria-label="Models" className="layer fixed inset-x-4 bottom-4 z-50 rounded-[6px] p-1 sm:absolute sm:inset-auto sm:right-0 sm:top-[calc(100%+6px)] sm:bottom-auto sm:z-40 sm:w-[360px] sm:rounded-[4px]">
          <button role="menuitem" className="menu-item !h-auto min-h-[44px] py-1.5" onClick={() => pick()}>
            <RefreshCw size={14} className="flex-none" />
            <span className="flex-1 min-w-0"><span className="block font-semibold">Best available</span><span className="block text-[12px] text-muted">Tries the models in order</span></span>
          </button>
          <div className="my-1 border-t border-rule" role="separator" />
          {status.isLoading && <p className="m-0 px-3 py-2 text-[13px] text-muted">Checking which models are free…</p>}
          {status.error && <p className="m-0 px-3 py-2 text-[13px] text-negative">Couldn't load the models.</p>}
          <ul className="list-none m-0 p-0 max-h-[min(320px,50vh)] overflow-auto">
            {(status.data?.models || []).map(m => {
              const isCurrent = !!currentModel && m.model === currentModel
              const exhausted = !m.available
              const disabled = isCurrent || exhausted
              return (
                <li key={`${m.family}|${m.model}`}>
                  <button
                    role="menuitem"
                    disabled={disabled}
                    aria-disabled={disabled}
                    title={isCurrent ? 'This model wrote the current note' : exhausted ? `${m.label}: ${m.reason}${m.cooldownSeconds ? `, about ${m.cooldownSeconds} s` : ''}` : `Write the note with ${m.model}`}
                    onClick={() => pick({ family: m.family, model: m.model })}
                    className={`menu-item !h-auto min-h-[44px] py-1.5 ${disabled ? 'opacity-55 cursor-not-allowed !bg-transparent' : ''}`}
                  >
                    <span className="w-5 flex-none text-center text-[14px]" aria-hidden>{exhausted && !isCurrent ? '⚠️' : ''}</span>
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate ${disabled ? 'text-faint' : 'font-medium'}`}>{m.model}</span>
                      <span className="block text-[12px] text-faint truncate">{m.label.replace(/\s*\([^()]*\)\s*$/, '')}</span>
                    </span>
                    {isCurrent && <span className="text-[12px] text-faint flex-none">Current</span>}
                    {exhausted && !isCurrent && (
                      <span className="text-[12px] text-faint flex-none num">
                        {m.reason}{m.cooldownSeconds ? ` · ${m.cooldownSeconds < 90 ? `${m.cooldownSeconds} s` : `${Math.ceil(m.cooldownSeconds / 60)} min`}` : ''}
                      </span>
                    )}
                    {exhausted && !isCurrent && <span className="sr-only">Not available right now</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
