import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Wordmark } from '../../components/ui'

/* Example note shown beside the form: a real piece of the product's interface (coded sentences
   citing turns), labelled as an example, never presented as anyone's data. */
const EXAMPLE = [
  { letter: 'S', text: 'Reports poor sleep for two weeks, linked to worry about a work review.', turns: [4, 6], code: 'supported' },
  { letter: 'S', text: 'Describes feeling “on edge” most evenings.', turns: [8], code: 'supported' },
  { letter: 'A', text: 'Anxiety symptoms likely related to occupational stress.', turns: [4, 8], code: 'partial' },
  { letter: 'P', text: 'Practise the wind-down routine nightly; review sleep diary next session.', turns: [12, 13], code: 'supported' },
]

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div data-workspace="therapy" className="min-h-screen bg-ground grid lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
      <section className="field-accent hidden lg:flex flex-col justify-between p-10 xl:p-14">
        <Wordmark />
        <div className="max-w-[560px]">
          <h2 className="text-[48px] leading-[50px] font-bold tracking-[-0.04em] m-0">Two voices in.<br />One note you can check.</h2>
          <p className="text-[16px] leading-6 text-on-accent-muted mt-5 max-w-[460px]">
            EchoScribe separates the speakers in a therapy or mentoring session, transcribes them, and drafts a SOAP or GROW note in which every sentence cites the turns it came from and is checked by a second model.
          </p>
          <motion.div className="bg-ground text-ink mt-9 max-w-[520px] p-5"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}>
            <div className="flex items-baseline justify-between gap-3 mb-3 pb-3 border-b border-ink">
              <span className="font-bold">Example note</span>
              <span className="text-[12px] text-muted num">3 of 4 sentences supported</span>
            </div>
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {EXAMPLE.map((e, i) => (
                <li key={i} className="grid grid-cols-[22px_1fr] gap-2 items-start">
                  <span className="field-accent w-[22px] h-[22px] text-[12px] font-bold flex items-center justify-center mt-[1px]">{e.letter}</span>
                  <p className="stripe m-0 text-[13px] leading-[20px]" data-code={e.code}>
                    {e.text}
                    {e.turns.map(t => <span key={t} className="num ml-1 text-[10px] font-semibold px-1 bg-surface-2 text-muted">T{t}</span>)}
                  </p>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
        <p className="text-[12px] text-on-accent-muted m-0">Notes are drafts for a professional to review. EchoScribe does not diagnose.</p>
      </section>

      <section className="flex flex-col justify-center px-4 py-10 sm:px-10 xl:px-16">
        <div className="lg:hidden mb-8 text-accent"><Wordmark /></div>
        <motion.div className="w-full max-w-[420px]"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
          {children}
        </motion.div>
      </section>
    </div>
  )
}
