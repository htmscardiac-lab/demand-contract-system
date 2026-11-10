import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card, SectionHead, Btn, Input, Select, Badge, Spinner, Empty, PageTitle, Alert, TableWrap, Th, Td, Tabs } from '../ui.jsx'
import { useApp } from '../App.jsx'

export default function Admin() {
  const { settings, reloadSettings } = useApp()
  const [users, setUsers] = useState(null)
  const [dept, setDept] = useState({ department_email: '', department_name: '' })
  const [savingSettings, setSavingSettings] = useState(false)
  const [teams, setTeams] = useState([])
  const [supSel, setSupSel] = useState('')
  const [tab, setTab] = useState('users')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    const [{ data: u }, { data: t }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('team_memberships').select('*'),
    ])
    setUsers(u || []); setTeams(t || [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => setDept({
    department_email: settings.department_email || '',
    department_name: settings.department_name || '',
  }), [settings])

  const saveSettings = async () => {
    setErr(''); setOk(''); setSavingSettings(true)
    const rows = Object.entries(dept).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }))
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' })
    setSavingSettings(false)
    if (error) return setErr(error.message)
    setOk('Settings saved.')
    reloadSettings()
  }

  const update = async (id, patch) => {
    setErr(''); setOk('')
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setErr(error.message)
    else { setOk('Saved.'); load() }
  }

  const toggleTeam = async (supervisorId, engineerId, isMember) => {
    setErr(''); setOk('')
    const { error } = isMember
      ? await supabase.from('team_memberships').delete().eq('supervisor_id', supervisorId).eq('engineer_id', engineerId)
      : await supabase.from('team_memberships').insert({ supervisor_id: supervisorId, engineer_id: engineerId })
    if (error) setErr(error.message)
    else load()
  }

  if (!users) return <Spinner />
  const supervisors = users.filter(u => u.role === 'supervisor' && u.is_active)
  const engineers = users.filter(u => u.role === 'engineer')

  const waiting = users.filter(u => !u.is_active).length
  const teamSize = (id) => teams.filter(t => t.supervisor_id === id).length

  return (
    <div>
      <PageTitle subtitle="Accounts, roles, supervisor teams and system settings.">Administration</PageTitle>
      {err && <Alert>{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <Card className="overflow-hidden">
        <Tabs className="px-2" value={tab} onChange={(k) => { setTab(k); setErr(''); setOk('') }} tabs={[
          { key: 'users', label: 'Users', count: users.length },
          { key: 'teams', label: 'Teams', count: supervisors.length },
          { key: 'settings', label: 'Settings' },
        ]} />

        {tab === 'users' && (<>
          {waiting > 0 && <div className="px-5 py-3 text-[13px] text-amber-700 bg-amber-100/50 border-b border-ink-100">{waiting} account{waiting > 1 ? 's are' : ' is'} waiting for activation.</div>}
          <TableWrap>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <Td className="font-medium text-ink-900">{u.full_name}</Td>
                  <Td className="text-[13px] text-ink-600">{u.email}</Td>
                  <Td>
                    <select value={u.role} onChange={e => update(u.id, { role: e.target.value })} aria-label={`Role for ${u.full_name}`}
                      className="h-8 rounded-md border border-ink-300 bg-white px-2 pr-7 text-[13px] text-ink-900 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100">
                      <option value="engineer">Engineer</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="clinical_engineer">Clinical engineer</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </Td>
                  <Td>{u.is_active ? <Badge className="bg-olive-100 text-olive-700">Active</Badge> : <Badge className="bg-amber-100 text-amber-700">Waiting</Badge>}</Td>
                  <Td right>
                    <Btn size="sm" variant={u.is_active ? 'secondary' : 'success'} onClick={() => update(u.id, { is_active: !u.is_active })}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </Btn>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>)}

        {tab === 'teams' && (
          <div className="grid md:grid-cols-[260px_minmax(0,1fr)] min-h-[320px]">
            <div className="border-b md:border-b-0 md:border-r border-ink-100 p-3">
              <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Supervisors</div>
              {supervisors.length === 0 && <div className="px-2 py-3 text-[13px] text-ink-500">No active supervisors. Set a user's role to Supervisor on the Users tab.</div>}
              {supervisors.map(s => (
                <button key={s.id} onClick={() => setSupSel(s.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 h-10 rounded-lg text-sm text-left transition-colors ${supSel === s.id ? 'bg-ink-900 text-white' : 'text-ink-800 hover:bg-ink-50'}`}>
                  <span className="truncate">{s.full_name}</span>
                  <span className={`num text-[11px] ${supSel === s.id ? 'text-ink-300' : 'text-ink-500'}`}>{teamSize(s.id)}</span>
                </button>
              ))}
            </div>
            <div className="p-5">
              {!supSel ? <Empty icon="users" title="Select a supervisor" hint="Then tick the engineers on that supervisor's team. An engineer can be on more than one team and chooses the supervisor on each request." /> : (<>
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500 mb-3">Engineers on this team</div>
                {engineers.length === 0 && <Empty icon="users" title="No engineers yet" />}
                <div className="grid gap-2 sm:grid-cols-2">
                  {engineers.map(e => {
                    const isMember = teams.some(t => t.supervisor_id === supSel && t.engineer_id === e.id)
                    return (
                      <label key={e.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${isMember ? 'border-ink-900 bg-ink-50' : 'border-ink-200 bg-white hover:border-ink-400'}`}>
                        <input type="checkbox" checked={isMember} onChange={() => toggleTeam(supSel, e.id, isMember)} className="w-4 h-4 accent-brand-600" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink-900 truncate">{e.full_name}</span>
                          <span className="block text-[12px] text-ink-500 truncate">{e.email}{!e.is_active && ' · waiting for activation'}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </>)}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="p-5 max-w-2xl">
            <h3 className="font-display font-semibold text-[15px] tracking-wide uppercase text-ink-900">Release email</h3>
            <p className="text-[13px] text-ink-500 mt-1 mb-5">The release email is addressed to this mailbox and signed with the department name.</p>
            <div className="grid gap-4">
              <Input label="Recipient mailbox" type="email"
                value={dept.department_email} onChange={e => setDept(d => ({ ...d, department_email: e.target.value }))}
                placeholder="htms@mngha.med.sa" />
              <Input label="Department name"
                value={dept.department_name} onChange={e => setDept(d => ({ ...d, department_name: e.target.value }))}
                placeholder="Healthcare Technology Management Services (HTMS)" />
            </div>
            <div className="mt-5">
              <Btn onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save settings'}</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
