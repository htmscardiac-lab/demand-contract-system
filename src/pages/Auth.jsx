import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Btn, Input, Alert, EcgTrace } from '../ui.jsx'
import emblem from '../assets/mngha-emblem.jpg'
import htms from '../assets/htms-logo.jpg'

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
        if (!form.name.trim()) throw new Error('Enter your full name.')
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
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] bg-white">
      {/* Identity panel */}
      <section className="relative bg-ink-900 text-white flex flex-col justify-between px-7 py-8 sm:px-12 sm:py-12 overflow-hidden">
        <div className="flex items-center gap-4">
          <img src={emblem} alt="Ministry of National Guard Health Affairs" className="w-16 h-16 rounded-xl bg-white p-1 object-contain" />
          <div>
            <div className="text-[15px] font-medium leading-snug">Ministry of National Guard</div>
            <div className="text-[15px] text-ink-300 leading-snug">Health Affairs</div>
          </div>
        </div>

        <div className="py-10 lg:py-0">
          <div className="text-[12px] tracking-[0.16em] uppercase text-brand-500 font-medium">Healthcare Technology Management Services</div>
          <h1 className="font-display font-semibold uppercase tracking-wide text-[40px] sm:text-[56px] leading-[1.02] mt-4">Demand<br />Contract<br />System</h1>
          <EcgTrace animate className="w-full max-w-[520px] h-12 mt-6 text-brand-500" />
          <p className="text-ink-300 text-[15px] leading-relaxed max-w-md mt-6">
            Spare-part releases against demand contracts — requested, approved, released and received in one traceable record.
          </p>
        </div>

        <dl className="hidden lg:grid grid-cols-3 gap-6 text-[13px] border-t border-white/10 pt-6">
          <div><dt className="text-ink-400">Request</dt><dd className="text-white mt-1">Per device: HTM, serial and work order</dd></div>
          <div><dt className="text-ink-400">Approve</dt><dd className="text-white mt-1">Supervisor, then clinical engineer</dd></div>
          <div><dt className="text-ink-400">Track</dt><dd className="text-white mt-1">Release, promise date and receipt</dd></div>
        </dl>
      </section>

      {/* Sign-in panel */}
      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="w-full max-w-sm mx-auto">
          <h2 className="font-display font-semibold text-[26px] tracking-wide uppercase text-ink-900">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p className="text-sm text-ink-500 mt-1 mb-6">
            {mode === 'login' ? 'Use your work email to continue.' : 'New accounts are activated by an administrator.'}
          </p>
          {err && <Alert>{err}</Alert>}
          {msg && <Alert kind="ok">{msg}</Alert>}
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && <Input label="Full name" autoComplete="name" value={form.name} onChange={set('name')} />}
            <Input label="Work email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} placeholder="name@mngha.med.sa" />
            <Input label="Password" type="password" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} />
            <Btn size="lg" className="w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</Btn>
          </form>
          <p className="text-sm text-ink-500 mt-6">
            {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); setMsg('') }}
              className="font-medium text-brand-700 hover:underline">{mode === 'login' ? 'Create one' : 'Sign in'}</button>
          </p>
          <div className="mt-12 pt-6 border-t border-ink-100">
            <img src={htms} alt="HTMS — Healthcare Technology Management Services" className="h-14 w-auto opacity-90" />
          </div>
        </div>
      </section>
    </div>
  )
}
