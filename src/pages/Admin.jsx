import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card, Btn, Input, Select, Badge, Spinner, Empty, PageTitle, Alert, TableWrap, Th, Td } from '../ui.jsx'
import { useApp } from '../App.jsx'

export default function Admin() {
  const { settings, reloadSettings } = useApp()
  const [users, setUsers] = useState(null)
  const [dept, setDept] = useState({ department_email: '', department_name: '' })
  const [savingSettings, setSavingSettings] = useState(false)
  const [teams, setTeams] = useState([])
  const [supSel, setSupSel] = useState('')
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

  return (
    <div className="space-y-5">
      <PageTitle>Administration</PageTitle>
      {err && <Alert>{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <Card className="p-4">
        <h2 className="font-semibold mb-1">Settings</h2>
        <p className="text-sm text-slate-500 mb-3">The approval email is addressed to this department mailbox, and signed with the department name.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Department email (recipient of approval emails)" type="email"
            value={dept.department_email} onChange={e => setDept(d => ({ ...d, department_email: e.target.value }))}
            placeholder="htms@mngha.med.sa" />
          <Input label="Department name (email signature)"
            value={dept.department_name} onChange={e => setDept(d => ({ ...d, department_name: e.target.value }))}
            placeholder="Healthcare Technology Management Services (HTMS)" />
        </div>
        <div className="flex justify-end mt-3">
          <Btn onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save settings'}</Btn>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Users</h2>
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <Td className="font-medium">{u.full_name}</Td>
                <Td className="text-slate-500 text-xs">{u.email}</Td>
                <Td>
                  <select value={u.role} onChange={e => update(u.id, { role: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white">
                    <option value="engineer">Engineer</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="clinical_engineer">Clinical engineer</option>
                    <option value="admin">Admin</option>
                  </select>
                </Td>
                <Td>{u.is_active ? <Badge className="bg-emerald-100 text-emerald-800">Active</Badge> : <Badge className="bg-slate-200 text-slate-600">Inactive</Badge>}</Td>
                <Td>
                  <Btn variant={u.is_active ? 'secondary' : 'success'} className="!py-1 !px-3 text-xs"
                    onClick={() => update(u.id, { is_active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </Btn>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-1">Teams</h2>
        <p className="text-sm text-slate-500 mb-3">Assign engineers to a supervisor's team. An engineer may belong to more than one supervisor — they will choose which one to send each request to.</p>
        <Select label="Supervisor" value={supSel} onChange={e => setSupSel(e.target.value)} className="max-w-xs">
          <option value="">Select supervisor…</option>
          {supervisors.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
        {supSel && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {engineers.length === 0 && <Empty text="No engineers yet." />}
            {engineers.map(e => {
              const isMember = teams.some(t => t.supervisor_id === supSel && t.engineer_id === e.id)
              return (
                <label key={e.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer ${isMember ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-white'}`}>
                  <input type="checkbox" checked={isMember} onChange={() => toggleTeam(supSel, e.id, isMember)} className="w-4 h-4" />
                  <div>
                    <div className="text-sm font-medium">{e.full_name}</div>
                    <div className="text-xs text-slate-400">{e.email} {!e.is_active && '· inactive'}</div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
