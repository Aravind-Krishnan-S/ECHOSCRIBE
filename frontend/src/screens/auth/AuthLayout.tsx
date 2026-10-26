import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Wordmark } from '../../components/ui'
import { ConversationStrip } from '../../components/ConversationStrip'

/* Example session shown beside the form: a real piece of the product's interface,
   labelled as an example, never presented as anyone's data. */
const EXAMPLE_TURNS = [
  { role: 'Therapist', start: 0, end: 9 }, { role: 'Patient', start: 9, end: 41 },
  { role: 'Therapist', start: 41, end: 50 }, { role: 'Patient', start: 50, end: 96 },
  { role: 'Therapist', start: 96, end: 112 }, { role: 'Patient', start: 112, end: 141 },
  { role: 'Therapist', start: 141, end: 160 }, { role: 'Patient', start: 160, end: 214 },
  { role: 'Therapist', start: 214, end: 231 }, { role: 'Patient', start: 231, end: 262 },
]

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div data-workspace="therapy" className="min-h-screen bg-chrome grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <section className="hidden lg:flex flex-col justify-between p-10 xl:p-14">
        <Wordmark />
        <div className="max-w-[560px]">
          <h2 className="serif text-[44px] leading-[48px] m-0">Two voices in. One clear note out.</h2>
          <p className="text-[16px] leading-6 text-muted mt-4 max-w-[460px]">
            EchoScribe separates the speakers in a therapy or mentoring session, transcribes them, and drafts a SOAP or GROW note for you to review and keep.
          </p>
          <motion.div data-ui className="panel mt-8 max-w-[520px]"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}>
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <span className="font-semibold">Example session</span>
              <span className="text-[12px] text-muted num">4 min 22 s · 10 turns</span>
            </div>
            <ConversationStrip turns={EXAMPLE_TURNS} professional="Therapist" client="Patient" />
            <div className="panel-inner mt-4 p-4 grid grid-cols-[28px_1fr] gap-x-3 gap-y-2">
              <span className="w-7 h-7 rounded-[8px] bg-accent-tint text-accent-ink font-semibold flex items-center justify-center">S</span>
              <p className="m-0 text-[13px] leading-[19px]">Reports poor sleep for two weeks, linked to worry about a work review; describes feeling “on edge” in the evenings.</p>
              <span className="w-7 h-7 rounded-[8px] bg-accent-tint text-accent-ink font-semibold flex items-center justify-center">P</span>
              <p className="m-0 text-[13px] leading-[19px]">Practise the wind-down routine nightly; review sleep diary next session.</p>
            </div>
          </motion.div>
        </div>
        <p className="text-[12px] text-muted m-0">Notes are drafts for a professional to review. EchoScribe does not diagnose.</p>
      </section>

      <section className="flex flex-col justify-center px-4 py-10 sm:px-10 lg:pr-10 lg:pl-0">
        <div className="lg:hidden mb-8"><Wordmark /></div>
        <motion.div className="glass rounded-[24px] p-6 sm:p-8 w-full max-w-[460px] mx-auto lg:mx-0"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
          {children}
        </motion.div>
      </section>
    </div>
  )
}
