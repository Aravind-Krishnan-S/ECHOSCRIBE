/* The conversation strip — EchoScribe's own element: who spoke when, drawn from the
   diarized turns. The professional's lane carries the workspace hue; the client's lane
   is a neutral identity tint. When a provider returns no real timings (transcript-based
   diarization), turns are laid out by word count instead and the caption says so. */

import { useMemo } from 'react'
import type { Turn } from '../lib/types'
import { wordCount } from '../lib/format'

interface Props {
  turns: Turn[]
  professional: string   // "Therapist" | "Mentor"
  client: string         // "Patient" | "Mentee"
  variant?: 'full' | 'mini'
}

interface Segment { x: number; w: number; pro: boolean }

function layout(turns: Turn[], professional: string) {
  const words = turns.map(t => t.words ?? wordCount(t.text))
  // Gemini-audio and transcript-based diarization emit placeholder spans of exactly 1 (start=i, end=i+1)
  const timed = turns.every(t => t.end >= t.start) && turns.some(t => t.end - t.start !== 1)
  const spans = turns.map((t, i) => (timed ? Math.max(t.end - t.start, 0.05) : Math.max(words[i], 1)))
  const total = spans.reduce((a, b) => a + b, 0) || 1

  let cursor = 0
  const segs: Segment[] = []
  turns.forEach((t, i) => {
    const start = timed ? t.start : cursor
    const w = spans[i]
    segs.push({ x: start, w, pro: t.role === professional })
    cursor += w
  })
  const end = timed ? Math.max(...turns.map(t => t.end), total) : total
  const totalWords = words.reduce((a, b) => a + b, 0)
  const proWords = words.reduce((a, w, i) => a + (turns[i].role === professional ? w : 0), 0)
  const proSpan = segs.reduce((a, s) => a + (s.pro ? s.w : 0), 0)
  const share = totalWords > 0 ? proWords / totalWords : proSpan / (segs.reduce((a, s) => a + s.w, 0) || 1)
  return { segs, end, timed, share, turns: turns.length }
}

export function ConversationStrip({ turns, professional, client, variant = 'full' }: Props) {
  const data = useMemo(() => (turns?.length ? layout(turns, professional) : null), [turns, professional])
  if (!data) {
    return variant === 'mini'
      ? <span className="text-faint text-[12px]">—</span>
      : <p className="text-muted">No speaker timings were saved for this session.</p>
  }

  const pct = (v: number) => `${(v / data.end) * 100}%`
  const proPct = Math.round(data.share * 100)

  if (variant === 'mini') {
    return (
      <span className="relative block h-[6px] w-full rounded-full bg-surface-2 overflow-hidden" role="img"
        aria-label={`${professional} spoke ${proPct}% of the words, ${client} ${100 - proPct}%`}>
        {data.segs.map((s, i) => (
          <span key={i} className="absolute top-0 bottom-0" style={{ left: pct(s.x), width: pct(s.w), background: s.pro ? 'var(--lane-pro)' : 'var(--lane-client)' }} />
        ))}
      </span>
    )
  }

  const lanes = [
    { label: professional, pro: true, share: proPct },
    { label: client, pro: false, share: 100 - proPct },
  ]
  return (
    <figure className="m-0">
      <div className="grid grid-cols-[88px_1fr_44px] gap-x-3 gap-y-2 items-center">
        {lanes.map(lane => (
          <div key={lane.label} className="contents">
            <span className="text-[13px] text-muted truncate">{lane.label}</span>
            <span className="relative h-[14px] rounded-full bg-surface-2 overflow-hidden" aria-hidden>
              {data.segs.filter(s => s.pro === lane.pro).map((s, i) => (
                <span key={i} className="absolute top-0 bottom-0 rounded-[3px]"
                  style={{ left: pct(s.x), width: `max(2px, ${pct(s.w)})`, background: lane.pro ? 'var(--lane-pro)' : 'var(--lane-client)' }} />
              ))}
            </span>
            <span className="num text-right text-[13px]">{lane.share}%</span>
          </div>
        ))}
      </div>
      <figcaption className="text-[12px] text-muted mt-3">
        {data.turns} turns · share of words spoken{data.timed ? '' : ' · laid out by words (this provider gave no timings)'}
      </figcaption>
    </figure>
  )
}
