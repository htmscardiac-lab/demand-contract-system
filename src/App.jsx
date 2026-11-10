import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { Spinner, Btn } from './ui.jsx'
import { usePoll } from './lib/poll.js'

export const ACTIVE_STATUSES = ['pending', 'pending_clinical', 'in_process', 'approved', 'returned']
import AuthPage from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Contracts from './pages/Contracts.jsx'
import NewRequest from './pages/NewRequest.jsx'
import Requests from './pages/Requests.jsx'
import Approvals from './pages/Approvals.jsx'
import ClinicalQueue from './pages/ClinicalQueue.jsx'
import Reports from './pages/Reports.jsx'
import Admin from './pages/Admin.jsx'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

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

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [load])

  // close when clicking anywhere outside the dropdown
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
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
      <button onClick={() => setOpen(o => !o)} className="relative p-2 rounded-lg hover:bg-slate-100" aria-label="Notifications">
        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-xl border border-slate-200 shadow-lg z-40">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-xs text-blue-600 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="p-4 text-sm text-slate-400 text-center">No notifications</div>}
            {items.map(n => (
              <button key={n.id} onClick={() => openNotif(n)}
                className={`block w-full text-left px-4 py-3 border-b border-slate-50 text-sm hover:bg-blue-50 ${n.read_at ? 'text-slate-500' : 'text-slate-800 bg-blue-50/50'}`}>
                {n.message}
                <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                  {new Date(n.created_at).toLocaleString('en-GB')}
                  {n.request_id && <span className="text-blue-500">· open request →</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Layout({ children }) {
  const { profile, signOut } = useApp()
  const [menu, setMenu] = useState(false)
  const [counts, setCounts] = useState({ requests: 0, approvals: 0, clinical: 0 })
  const role = profile.role

  usePoll(async () => {
    const { data } = await supabase.from('requests').select('status, archived, supervisor_id')
    const rows = (data || []).filter(r => !r.archived)
    setCounts({
      requests: rows.filter(r => ACTIVE_STATUSES.includes(r.status)).length,
      approvals: rows.filter(r => r.status === 'pending').length,
      clinical: rows.filter(r => r.status === 'pending_clinical').length,
    })
  }, 8000, [])

  const links = [
    { to: '/', label: 'Dashboard' },
    { to: '/contracts', label: 'Contracts' },
    ...((role === 'engineer' || role === 'supervisor' || role === 'admin') ? [{ to: '/new-request', label: 'New Request' }] : []),
    { to: '/requests', label: 'Requests', badge: counts.requests },
    ...((role === 'supervisor' || role === 'admin') ? [{ to: '/approvals', label: 'Approvals', badge: counts.approvals }] : []),
    ...((role === 'clinical_engineer' || role === 'admin') ? [{ to: '/clinical', label: 'Clinical Queue', badge: counts.clinical }] : []),
    { to: '/reports', label: 'Reports' },
    ...(role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : []),
  ]
  const linkCls = ({ isActive }) =>
    `relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`
  const Badge = ({ n }) => n > 0 ? <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold">{n}</span> : null
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button className="md:hidden p-2 -ml-2" onClick={() => setMenu(m => !m)} aria-label="Menu">
              <svg className="w-6 h-6 text-slate-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <span className="font-bold text-slate-800 truncate">Demand Contracts</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {links.map(l => <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkCls}>{l.label}<Badge n={l.badge} /></NavLink>)}
          </nav>
          <div className="flex items-center gap-1">
            <Bell />
            <div className="hidden sm:block text-right mr-1">
              <div className="text-xs font-semibold text-slate-700 leading-tight">{profile.full_name}</div>
              <div className="text-[10px] text-slate-400 uppercase">{profile.role.replace('_',' ')}</div>
            </div>
            <button onClick={signOut} title="Sign out" className="p-2 rounded-lg hover:bg-slate-100" aria-label="Sign out">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
        {menu && (
          <nav className="md:hidden border-t border-slate-100 px-4 py-2 space-y-1 bg-white">
            {links.map(l => <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkCls} onClick={() => setMenu(false)}>{l.label}<Badge n={l.badge} /></NavLink>)}
          </nav>
        )}
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}

function Pending({ signOut, refresh }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md text-center">
        <div className="text-4xl mb-3">⏳</div>
        <h1 className="text-lg font-bold mb-2">Account pending activation</h1>
        <p className="text-sm text-slate-500 mb-6">Your account was created but has not been activated yet. Please ask your administrator to activate it and assign your role.</p>
        <div className="flex justify-center gap-3">
          <Btn variant="secondary" onClick={refresh}>Check again</Btn>
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

  useEffect(() => {
    if (session?.user) { loadProfile(session.user.id); loadSettings() }
    else setProfile(null)
  }, [session, loadProfile, loadSettings])

  const signOut = async () => { await supabase.auth.signOut(); navigate('/') }

  if (session === undefined) return <Spinner />
  if (!session) return <AuthPage />
  if (!profile) return <Spinner />
  if (!profile.is_active) return <Pending signOut={signOut} refresh={() => loadProfile(session.user.id)} />

  return (
    <Ctx.Provider value={{ session, profile, settings, reloadSettings: loadSettings, signOut,
      isAdmin: profile.role === 'admin', isSupervisor: profile.role === 'supervisor', isEngineer: profile.role === 'engineer' }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/new-request" element={<NewRequest />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/clinical" element={<ClinicalQueue />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </Ctx.Provider>
  )
}
