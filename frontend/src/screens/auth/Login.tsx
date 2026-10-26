import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { Field, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setPending(true)
    try {
      await login(email.trim(), password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-[24px] leading-8 font-semibold m-0">Sign in</h1>
      <p className="text-muted mt-1 mb-6">Welcome back to EchoScribe.</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email">
          {p => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {p => <input {...p} className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        {error && <p className="field-error -mt-1" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg mt-2" disabled={pending || !email || !password}>
          {pending && <Spinner />} Sign in
        </button>
      </form>
      <p className="text-muted mt-6 mb-0">New to EchoScribe? <Link to="/signup" className="link">Create an account</Link></p>
    </AuthLayout>
  )
}
