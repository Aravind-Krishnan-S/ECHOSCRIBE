import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Check, GraduationCap, HeartPulse, Layers } from 'lucide-react'
import clsx from 'clsx'
import { AuthLayout } from './AuthLayout'
import { Field, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import type { Role } from '../../lib/types'

const ROLES: { id: Role; title: string; body: string; icon: typeof HeartPulse }[] = [
  { id: 'therapist', title: 'Therapist', body: 'Therapy sessions with patients, written up as SOAP notes with a risk screen.', icon: HeartPulse },
  { id: 'mentor', title: 'Mentor', body: 'Academic mentoring with mentees, written up as GROW notes with a wellbeing screen.', icon: GraduationCap },
  { id: 'both', title: 'Both', body: 'Two separate workspaces. You choose which one to open each time you sign in.', icon: Layers },
]

export default function Signup() {
  const { user, signup } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 'verify'>(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (user) return <Navigate to="/" replace />

  const passwordShort = password.length > 0 && password.length < 8

  function next(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || password.length < 8) return
    setError('')
    setStep(2)
  }

  async function create() {
    if (!role) return
    setPending(true)
    setError('')
    try {
      const { needsVerification } = await signup({ email: email.trim(), password, full_name: name.trim(), role })
      if (needsVerification) setStep('verify')
      else navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <AnimatePresence mode="wait" initial={false}>
        {step === 1 && (
          <motion.div key="s1" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.22 }}>
            <p className="text-[12px] text-muted m-0 num">Step 1 of 2</p>
            <h1 className="text-[24px] leading-8 font-semibold mt-1 mb-6">Create your account</h1>
            <form onSubmit={next} className="flex flex-col gap-4" noValidate>
              <Field label="Full name" hint="As it should appear on your notes and exports.">
                {p => <input {...p} className="input" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} />}
              </Field>
              <Field label="Email">
                {p => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />}
              </Field>
              <Field label="Password" hint="At least 8 characters." error={passwordShort ? 'Use at least 8 characters.' : undefined}>
                {p => <input {...p} className="input" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} />}
              </Field>
              <button className="btn btn-primary btn-lg mt-2" disabled={!name.trim() || !email.trim() || password.length < 8}>Continue</button>
            </form>
            <p className="text-muted mt-6 mb-0">Already have an account? <Link to="/login" className="link">Sign in</Link></p>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.22 }}>
            <button className="btn btn-ghost btn-sm -ml-3 mb-2" onClick={() => setStep(1)}><ArrowLeft size={15} />Back</button>
            <p className="text-[12px] text-muted m-0 num">Step 2 of 2</p>
            <h1 className="text-[24px] leading-8 font-semibold mt-1 mb-1">How will you use EchoScribe?</h1>
            <p className="text-muted mt-0 mb-5">You can change this later in your profile.</p>
            <div role="radiogroup" aria-label="Your role" className="flex flex-col gap-2.5">
              {ROLES.map(r => {
                const selected = role === r.id
                const Icon = r.icon
                return (
                  <button key={r.id} type="button" role="radio" aria-checked={selected} onClick={() => setRole(r.id)}
                    data-workspace={r.id === 'mentor' ? 'mentoring' : 'therapy'}
                    className={clsx('flex items-start gap-3 text-left rounded-[6px] p-4 border transition-[border-color,background-color,transform] duration-200 active:scale-[0.99]',
                      selected ? 'border-accent bg-accent-tint' : 'border-border bg-raised hover:border-control')}>
                    <span className={clsx('w-9 h-9 rounded-[6px] flex items-center justify-center flex-none', selected ? 'bg-raised text-accent' : 'bg-surface-2 text-muted')}>
                      <Icon size={18} />
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{r.title}</span>
                      <span className="block text-[13px] leading-[19px] text-muted mt-0.5">{r.body}</span>
                    </span>
                    <span className={clsx('w-5 h-5 rounded-full border flex items-center justify-center flex-none mt-0.5', selected ? 'bg-accent border-accent text-white' : 'border-control')}>
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
            <button className="btn btn-primary btn-lg w-full mt-5" disabled={!role || pending} onClick={create}>
              {pending && <Spinner />} Create account
            </button>
          </motion.div>
        )}

        {step === 'verify' && (
          <motion.div key="verify" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-[24px] leading-8 font-semibold m-0">Check your email</h1>
            <p className="text-muted mt-2">We sent a confirmation link to <span className="text-ink font-medium">{email}</span>. Open it, then sign in.</p>
            <Link to="/login" className="btn btn-primary btn-lg w-full mt-6">Go to sign in</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthLayout>
  )
}
