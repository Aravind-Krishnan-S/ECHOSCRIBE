export function firstName(fullName: string | null | undefined, email?: string) {
  const name = (fullName || '').trim()
  if (name) {
    const parts = name.split(/\s+/)
    // "Dr. Meera Nair" → "Dr. Nair"; otherwise the first name
    if (/^(dr|prof)\.?$/i.test(parts[0]) && parts.length > 1) return `${parts[0].replace(/\.?$/, '.')} ${parts[parts.length - 1]}`
    return parts[0]
  }
  return email ? email.split('@')[0] : 'there'
}

type GraphemeSegmenter = { segment(s: string): Iterable<{ segment: string }> }
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => GraphemeSegmenter }).Segmenter
const segmenter = SegmenterCtor ? new SegmenterCtor(undefined, { granularity: 'grapheme' }) : null
const firstGrapheme = (word: string) => (segmenter ? [...segmenter.segment(word)][0]?.segment : Array.from(word)[0]) || ''

/** Initials from the first and last word (titles, numbers and suffixes like III skipped); scripts without
    letter case (Chinese, Arabic, …) get a single character, which is how their names are abbreviated. */
export function initials(name: string | null | undefined) {
  const parts = (name || '').trim().split(/\s+/).filter(p => !/^(dr|prof|mr|mrs|ms)\.?$/i.test(p) && !/^(\d+|jr\.?|sr\.?)$/i.test(p) && !/^[IVX]{2,}$/.test(p))
  if (!parts.length) return '·'
  const first = firstGrapheme(parts[0])
  if (first.toUpperCase() === first.toLowerCase()) return first   // no letter case: one character
  const last = parts.length > 1 ? firstGrapheme(parts[parts.length - 1]) : ''
  return (first + last).toUpperCase()
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const dateShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export const fmtDate = (iso: string) => dateFmt.format(new Date(iso))
export const fmtDateShort = (iso: string) => dateShort.format(new Date(iso))
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso))

export function relativeDay(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (days <= 0) return `Today, ${fmtTime(iso)}`
  if (days === 1) return `Yesterday, ${fmtTime(iso)}`
  if (days < 7) return `${days} days ago`
  return fmtDate(iso)
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function duration(seconds: number | null | undefined) {
  if (!seconds || seconds < 1) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m ? `${m} min ${s.toString().padStart(2, '0')} s` : `${s} s`
}

export function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function plural(n: number, one: string, many = one + 's') {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export function wordCount(text: string | null | undefined) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length
}
