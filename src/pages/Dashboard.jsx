import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, Badge, Spinner, TableWrap, Th, Td, Empty } from '../ui.jsx'
import { money, fmtDate, STATUS_STYLE, statusLabel } from '../lib/helpers'
import { usePoll } from '../lib/poll.js'

export default function Dashboard() {
  const { profile } = useApp()
  const [reqs, setReqs] = useState(null)
  const [bals, setBals] = useState([])

  usePoll(async () => {
    const { data: r } = await supabase.from('requests')
      .select('*, request_items(unit_price, quantity, received_quantity), contracts(contract_number, end_date, vendors(name)), engineer:profiles!requests_engineer_id_fkey(full_name)')
      .order('submitted_at', { ascending: false })
    setReqs(r || [])
    const { data: b } = await supabase.from('contract_balances').select('*')
    setBals(b || [])
  }, 10000, [])

  if (!reqs) return <Spinner />
  const pending = reqs.filter(r => r.status === 'pending')
  const returned = reqs.filter(r => r.status === 'returned')
  const open = reqs.filter(r => ['in_process', 'approved'].includes(r.status))
  const overdue = open.filter(r => r.promise_date && new Date(r.promise_date) < new Date()
    && r.request_items.some(i => (i.received_quantity || 0) < i.quantity))
  const lowBal = bals.filter(b => Number(b.remaining) <= 0.1 * Number(b.total_amount))

  const stat = (label, value, tone) => (
    <Card className="p-4">
      <div className="text-2xl font-bold" style={{ color: tone }}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </Card>
  )

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Welcome, {profile.full_name}</h1>
      <p className="text-sm text-slate-500 mb-5">Here is the current picture for your team.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {stat('Pending approval', pending.length, '#b45309')}
        {returned.length > 0 && stat('Returned for amendment', returned.length, '#c2410c')}
        {stat('Approved / in progress', open.length, '#047857')}
        {stat('Overdue vs promise date', overdue.length, '#b91c1c')}
        {stat('Contracts low on balance (≤10%)', lowBal.length, '#6d28d9')}
      </div>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Recent requests</h2>
          <Link to="/requests" className="text-sm text-blue-600 hover:underline">View all</Link>
        </div>
        {reqs.length === 0 ? <Empty text="No requests yet." /> : (
          <TableWrap>
            <thead><tr><Th>Request</Th><Th>Engineer</Th><Th>Contract</Th><Th>Total</Th><Th>Status</Th><Th>Date</Th></tr></thead>
            <tbody>
              {reqs.slice(0, 8).map(r => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.request_number}</Td>
                  <Td>{r.engineer?.full_name}</Td>
                  <Td>{r.contracts?.contract_number}</Td>
                  <Td>{money(r.request_items.reduce((s, i) => s + i.unit_price * i.quantity, 0))}</Td>
                  <Td><Badge className={STATUS_STYLE[r.status]}>{statusLabel(r.status)}</Badge></Td>
                  <Td className="text-slate-500">{fmtDate(r.submitted_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  )
}
