/* Numbered transcript turns, parsed exactly as src/services/grounding.js numberTranscript() does,
   so the [T#] citations stored with a note point at the same turns in the interface. */

export interface NumberedTurn { id: number; role: string; text: string }

const TURN_HEADER = /^\s*([A-Z][A-Za-z ]{1,30}|speaker_\d+|Speaker \d+|Person \d+):\s*$/
const INLINE_TURN = /^\s*([A-Z][A-Za-z ]{1,30}|speaker_\d+|Speaker \d+|Person \d+):\s+(.+)$/

export function numberTranscript(text: string): NumberedTurn[] {
  const turns: { role: string; text: string }[] = []
  let current: { role: string; text: string } | null = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    const header = line.match(TURN_HEADER)
    const inline = !header && line.match(INLINE_TURN)
    if (header || inline) {
      if (current && current.text.trim()) turns.push(current)
      const m = (header || inline) as RegExpMatchArray
      current = { role: m[1].trim(), text: inline ? m[2].trim() : '' }
    } else if (current) {
      if (line.trim()) current.text += (current.text ? ' ' : '') + line.trim()
    } else if (line.trim()) {
      current = { role: 'Speaker', text: line.trim() }
    }
  }
  if (current && current.text.trim()) turns.push(current)

  if (turns.length === 1 && turns[0].role === 'Speaker') {
    const sentences = turns[0].text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [turns[0].text]
    turns.length = 0
    for (let i = 0; i < sentences.length; i += 3) turns.push({ role: 'Speaker', text: sentences.slice(i, i + 3).join(' ').trim() })
  }
  return turns.map((t, i) => ({ id: i + 1, role: t.role, text: t.text }))
}
