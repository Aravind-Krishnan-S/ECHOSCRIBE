import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './components/ui'
import { BootSplash } from './components/Loading'
import { AppShell } from './components/AppShell'
import { TourProvider } from './tour/TourProvider'
import { isWorkspace, workspacesFor } from './lib/workspace'
import { lastWorkspace } from './lib/useWorkspace'
import { ApiError } from './lib/api'

const Login = lazy(() => import('./screens/auth/Login'))
const Signup = lazy(() => import('./screens/auth/Signup'))
const Workspaces = lazy(() => import('./screens/Workspaces'))
const Home = lazy(() => import('./screens/Home'))
const Clients = lazy(() => import('./screens/Clients'))
const ClientDetail = lazy(() => import('./screens/ClientDetail'))
const Record = lazy(() => import('./screens/Record'))
const Summary = lazy(() => import('./screens/Summary'))
const SettingsLayout = lazy(() => import('./screens/settings/SettingsLayout'))
const ProfileSettings = lazy(() => import('./screens/settings/ProfileSettings'))
const ModelSettings = lazy(() => import('./screens/settings/ModelSettings'))
const GeneralSettings = lazy(() => import('./screens/settings/GeneralSettings'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

/** Signed in, with a profile; otherwise login, splash or a setup error. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, profile, profileLoading, profileError } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (profileLoading) return <BootSplash />
  if (profileError || !profile) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6">
        <div className="panel max-w-[460px]">
          <h1 className="text-[20px] font-semibold m-0">EchoScribe could not load your profile</h1>
          <p className="text-muted mt-2">{profileError?.message || 'Unknown error.'}</p>
          <button className="btn btn-secondary mt-4" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

/** Only the workspaces the user's role includes. */
function WorkspaceGuard({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { mode } = useParams()
  const allowed = workspacesFor(profile?.role)
  if (!isWorkspace(mode) || !allowed.includes(mode)) return <Navigate to={`/w/${allowed[0]}`} replace />
  return <>{children}</>
}

/** "/": the picker for people with both roles (unless they chose a default), else their one workspace. */
function RootRedirect() {
  const { profile } = useAuth()
  const allowed = workspacesFor(profile?.role)
  if (allowed.length === 1) return <Navigate to={`/w/${allowed[0]}`} replace />
  const pref = profile?.prefs?.default_workspace
  if (pref && pref !== 'ask' && allowed.includes(pref)) return <Navigate to={`/w/${pref}`} replace />
  return <Navigate to="/workspaces" replace />
}

function PreferenceEffects() {
  const { profile } = useAuth()
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = profile?.prefs?.reduce_motion ? 'true' : 'false'
    document.documentElement.dataset.density = profile?.prefs?.compact ? 'compact' : 'comfortable'
  }, [profile?.prefs?.reduce_motion, profile?.prefs?.compact])
  useEffect(() => {
    if (!document.body.dataset.workspace) document.body.dataset.workspace = lastWorkspace() || 'therapy'
  }, [])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <TourProvider>
              <PreferenceEffects />
              <Suspense fallback={<BootSplash />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/" element={<RequireAuth><RootRedirect /></RequireAuth>} />
                  <Route path="/workspaces" element={<RequireAuth><Workspaces /></RequireAuth>} />
                  <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                    <Route path="/w/:mode" element={<WorkspaceGuard><Home /></WorkspaceGuard>} />
                    <Route path="/w/:mode/clients" element={<WorkspaceGuard><Clients /></WorkspaceGuard>} />
                    <Route path="/w/:mode/clients/:id" element={<WorkspaceGuard><ClientDetail /></WorkspaceGuard>} />
                    <Route path="/w/:mode/record" element={<WorkspaceGuard><Record /></WorkspaceGuard>} />
                    <Route path="/w/:mode/sessions/:id" element={<WorkspaceGuard><Summary /></WorkspaceGuard>} />
                    <Route path="/settings" element={<SettingsLayout />}>
                      <Route index element={<Navigate to="profile" replace />} />
                      <Route path="profile" element={<ProfileSettings />} />
                      <Route path="models" element={<ModelSettings />} />
                      <Route path="general" element={<GeneralSettings />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </TourProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
