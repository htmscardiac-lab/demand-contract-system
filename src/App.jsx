import React, { lazy, Suspense, createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { Spinner, Btn, Icon, EcgTrace } from './ui.jsx'
import { usePoll } from './lib/poll.js'
import { actionFor, ROLE_LABEL } from './lib/helpers'
import emblem from './assets/mngha-emblem.jpg'
import AuthPage from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Requests from './pages/Requests.jsx'
const Contracts = lazy(() => import('./pages/Contracts.jsx'))
const NewRequest = lazy(() => import('./pages/NewRequest.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))
const Vendors = lazy(() => import('./pages/Vendors.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
const timeAgo = (d) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function Bell() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const unread = items.filter(n => !n.read_at).length

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)
    setItems(data || [])
  }, [])
  usePoll(load, 8000, [load])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Demand Contract System` : 'Demand Contract System'
  }, [unread])

  const markAll = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    load()
  }
  const openNotif = async (n) => {
    if (!n.read_at) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); load() }
    setOpen(false)
    if (n.request_id) navigate(`/requests?open=${n.request_id}`)
    else if (n.contract_id) navigate('/contracts')
  }

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={() => setOpen(o => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        className="relative w-10 h-10 rounded-lg flex items-center justify-center text-ink-600 hover:bg-ink-100 hover:text-ink-900">
        <Icon name="bell" />
        {unread > 0 && <span className="num absolute top-1 right-1 bg-brand-600 text-white text-[10px] font-medium rounded-full min-w-[17px] h-[17px] flex items-center justify-center px-1 ring-2 ring-white">{unread}</span>}
      </button>
      {open && (
        <div className="animate-rise absolute right-0 mt-2 w-[360px] max-w-[92vw] bg-white rounded-xl border border-ink-200 shadow-pop z-40 overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 border-b border-ink-100">
            <span className="font-display font-semibold text-sm tracking-wide uppercase">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-[13px] font-medium text-brand-700 hover:underline">Mark all as read</button>}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 && <div className="px-4 py-10 text-sm text-ink-400 text-center">You have no notifications.</div>}
            {items.map(n => (
              <button key={n.id} onClick={() => openNotif(n)}
                className="flex gap-3 w-full text-left px-4 py-3 border-b border-ink-100 last:border-0 hover:bg-ink-50">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? 'bg-ink-200' : 'bg-brand-600'}`} />
                <span className="min-w-0">
                  <span className={`block text-[13px] leading-snug ${n.read_at ? 'text-ink-500' : 'text-ink-900'}`}>{n.message}</span>
                  <span className="block text-[11px] text-ink-400 mt-1">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Sidebar({ counts, onNavigate }) {
  const { profile, signOut } = useApp()
  const role = profile.role
  const canRequest = ['engineer', 'supervisor', 'admin'].includes(role)
  const groups = [
    { label: 'Workspace', links: [
      { to: '/', label: 'Overview', icon: 'overview' },
      { to: '/requests', label: 'Requests', icon: 'requests', badge: counts.action },
      { to: '/contracts', label: 'Contracts', icon: 'contracts' },
      { to: '/vendors', label: 'Vendors', icon: 'users' },
    ] },
    { label: 'Insights', links: [{ to: '/reports', label: 'Reports', icon: 'reports' }] },
    ...(role === 'admin' ? [{ label: 'System', links: [{ to: '/admin', label: 'Administration', icon: 'admin' }] }] : []),
  ]
  return (
    <div className="h-full flex flex-col bg-ink-900 text-ink-300">
      <div className="px-5 pt-5 pb-4">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-3">
          <img src={emblem} alt="Ministry of National Guard Health Affairs" className="w-11 h-11 rounded-lg bg-white p-0.5 object-contain" />
          <span className="min-w-0">
            <span className="block font-display font-semibold text-[17px] leading-tight tracking-wide uppercase text-white">Demand Contracts</span>
            <span className="block text-[11px] tracking-[0.08em] uppercase text-ink-400 mt-0.5">HTMS · MNGHA</span>
          </span>
        </Link>
        <EcgTrace className="w-full h-5 mt-4 text-brand-500 opacity-80" />
      </div>

      {canRequest && (
        <div className="px-4 pb-4">
          <Link to="/new-request" onClick={onNavigate}
            className="flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors">
            <Icon name="plus" className="w-4 h-4" />New request
          </Link>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5" aria-label="Main">
        {groups.map(g => (
          <div key={g.label}>
            <div className="px-3 mb-1.5 text-[10.5px] font-medium tracking-[0.14em] uppercase text-ink-500">{g.label}</div>
            <div className="space-y-0.5">
              {g.links.map(l => (
                <NavLink key={l.to} to={l.to} end={l.to === '/'} onClick={onNavigate}
                  className={({ isActive }) => `relative flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors
                    ${isActive ? 'bg-white/[0.08] text-white' : 'text-ink-300 hover:bg-white/[0.04] hover:text-white'}`}>
                  {({ isActive }) => (<>
                    {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand-500" />}
                    <Icon name={l.icon} className="w-[18px] h-[18px]" />
                    <span className="flex-1">{l.label}</span>
                    {l.badge > 0 && <span className="num text-[11px] min-w-5 h-5 px-1.5 rounded-full bg-brand-600 text-white inline-flex items-center justify-center">{l.badge}</span>}
                  </>)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.08] p-3 flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-ink-700 text-white text-xs font-medium flex items-center justify-center shrink-0">{initials(profile.full_name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-white truncate">{profile.full_name}</span>
          <span className="block text-[11px] text-ink-400 truncate">{ROLE_LABEL[role] || role}</span>
        </span>
        <button onClick={signOut} title="Sign out" aria-label="Sign out" className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-400 hover:text-white hover:bg-white/[0.08]">
          <Icon name="logout" className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  )
}

function Layout({ children }) {
  const { profile, settings } = useApp()
  const [drawer, setDrawer] = useState(false)
  const [counts, setCounts] = useState({ action: 0 })
  const location = useLocation()

  usePoll(async () => {
    const { data } = await supabase.from('requests').select('status, archived, supervisor_id, engineer_id')
    setCounts({ action: (data || []).filter(r => actionFor(r, profile)).length })
  }, 8000, [profile.id, profile.role])

  useEffect(() => { setDrawer(false) }, [location.pathname])

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-30"><Sidebar counts={counts} /></aside>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink-950/50" onClick={() => setDrawer(false)}>
          <aside className="animate-rise w-72 max-w-[85vw] h-full" onClick={e => e.stopPropagation()}><Sidebar counts={counts} onNavigate={() => setDrawer(false)} /></aside>
        </div>
      )}
      <header className="sticky top-0 z-20 h-14 bg-white/90 backdrop-blur border-b border-ink-200 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 min-w-0">
          <button className="lg:hidden w-10 h-10 -ml-2 rounded-lg flex items-center justify-center text-ink-700 hover:bg-ink-100" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <span className="text-[13px] text-ink-500 truncate">{settings.department_name || 'Healthcare Technology Management Services'}</span>
        </div>
        <Bell />
      </header>
      <main className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1320px] mx-auto">{children}</main>
    </div>
  )
}

function Pending({ signOut, refresh }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-ink-50">
      <div className="bg-white rounded-xl border border-ink-200 shadow-card p-8 max-w-md text-center">
        <div className="w-12 h-12 rounded-full bg-gold-100 text-gold-700 flex items-center justify-center mx-auto mb-4"><Icon name="clock" /></div>
        <h1 className="font-display font-semibold text-xl tracking-wide uppercase mb-2">Awaiting activation</h1>
        <p className="text-sm text-ink-500 mb-6">Your account is created. An administrator needs to activate it and assign your role before you can sign in to the system.</p>
        <div className="flex justify-center gap-2">
          <Btn variant="dark" onClick={refresh}>Check again</Btn>
          <Btn variant="secondary" onClick={signOut}>Sign out</Btn>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [settings, setSettings] = useState({})
  const navigate = useNavigate()

  const loadProfile = useCallback(async (uid) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(data || null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('key, value')
    setSettings(Object.fromEntries((data || []).map(x => [x.key, x.value])))
  }, [])

  const uid = session?.user?.id
  useEffect(() => {
    if (uid) { loadProfile(uid); loadSettings() }
    else setProfile(null)
  }, [uid, loadProfile, loadSettings])

  const signOut = async () => { await supabase.auth.signOut(); navigate('/') }

  if (session === undefined) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>
  if (!session) return <AuthPage />
  if (!profile) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>
  if (!profile.is_active) return <Pending signOut={signOut} refresh={() => loadProfile(session.user.id)} />

  return (
    <Ctx.Provider value={{ session, profile, settings, reloadSettings: loadSettings, signOut,
      isAdmin: profile.role === 'admin', isSupervisor: profile.role === 'supervisor', isEngineer: profile.role === 'engineer' }}>
      <Layout>
        <Suspense fallback={<Spinner />}><Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/new-request" element={<NewRequest />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/approvals" element={<Navigate to="/requests" replace />} />
          <Route path="/clinical" element={<Navigate to="/requests" replace />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin" element={profile.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></Suspense>
      </Layout>
    </Ctx.Provider>
  )
}
