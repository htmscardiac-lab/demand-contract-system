import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Btn, Input, Alert } from '../ui.jsx'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setBusy(true)
    try {
      if (mode === 'signup') {
        if (!form.name.trim()) throw new Error('Please enter your full name.')
        const { error } = await supabase.auth.signUp({
          email: form.email.trim(), password: form.password,
          options: { data: { full_name: form.name.trim() } },
        })
        if (error) throw error
        setMsg('Account created. Signing you in…')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password })
        if (error) throw error
      }
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Demand Contract System</h1>
          <p className="text-sm text-slate-500 mt-1">Medical device parts requests — HTMS</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex rounded-lg bg-slate-100 p-1 mb-5 text-sm font-medium">
            <button className={`flex-1 py-2 rounded-md ${mode === 'login' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`} onClick={() => setMode('login')}>Sign in</button>
            <button className={`flex-1 py-2 rounded-md ${mode === 'signup' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`} onClick={() => setMode('signup')}>Create account</button>
          </div>
          {err && <Alert>{err}</Alert>}
          {msg && <Alert kind="ok">{msg}</Alert>}
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && <Input label="Full name" value={form.name} onChange={set('name')} placeholder="e.g. Naif Alshammari" />}
            <Input label="Email" type="email" required value={form.email} onChange={set('email')} placeholder="you@hospital.med.sa" />
            <Input label="Password" type="password" required minLength={6} value={form.password} onChange={set('password')} placeholder="••••••••" />
            <Btn className="w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</Btn>
          </form>
          {mode === 'signup' && <p className="text-xs text-slate-400 mt-4">New accounts start inactive until the administrator activates them and assigns a role.</p>}
        </div>
      </div>
    </div>
  )
}
