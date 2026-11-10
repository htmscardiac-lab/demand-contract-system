import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, Spinner, Empty, PageTitle, TableWrap, Th, Td, Badge } from '../ui.jsx'
import { money, fmtDate } from '../lib/helpers'

export default function Reports() {
  const [data, setData] = useState(null)

  useEffect(() => {
    (async () => {
      const [{ data: bals }, { data: contracts }, { data: reqs }] = await Promise.all([
        supabase.from('contract_balances').select('*'),
        supabase.from('contracts').select('*, vendors(name)'),
        supabase.from('requests').select('*, request_items(*), supervisor:profiles!requests_supervisor_id_fkey(full_name), contracts(contract_number, vendor_id, vendors(name))'),
      ])
      setData({ bals: bals || [], contracts: contracts || [], reqs: reqs || [] })
    })()
  }, [])

  if (!data) return <Spinner />
  const { bals, contracts, reqs } = data
  const cById = Object.fromEntries(contracts.map(c => [c.id, c]))
  const spent = reqs.filter(r => ['approved', 'closed'].includes(r.status))

  // spend per vendor
  const vendorSpend = {}
  for (const r of spent) {
    const vn = r.contracts?.vendors?.name || 'Unknown'
    vendorSpend[vn] = (vendorSpend[vn] || 0) + r.request_items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  }
  const vendorRows = Object.entries(vendorSpend).sort((a, b) => b[1] - a[1])
  const maxSpend = Math.max(1, ...vendorRows.map(v => v[1]))

  // most requested parts
  const parts = {}
  for (const r of reqs) for (const i of r.request_items) {
    const k = i.part_number
    parts[k] = parts[k] || { part: i.part_number, desc: i.description, count: 0, qty: 0 }
    parts[k].count += 1; parts[k].qty += i.quantity
  }
  const partRows = Object.values(parts).sort((a, b) => b.qty - a.qty).slice(0, 15)

  // avg approval time per supervisor
  const approvals = {}
  for (const r of reqs.filter(x => x.decided_at)) {
    const n = r.supervisor?.full_name || '—'
    const hrs = (new Date(r.decided_at) - new Date(r.submitted_at)) / 3600000
    approvals[n] = approvals[n] || { total: 0, count: 0 }
    approvals[n].total += hrs; approvals[n].count += 1
  }
  const apprRows = Object.entries(approvals).map(([n, v]) => ({ n, avg: v.total / v.count, count: v.count }))

  // overdue with no receipt
  const overdue = reqs.filter(r => r.status === 'approved' && r.promise_date && new Date(r.promise_date) < new Date()
    && r.request_items.some(i => !i.received_at))

  const fmtHrs = h => h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`

  return (
    <div className="space-y-5">
      <PageTitle>Reports &amp; analytics</PageTitle>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Remaining balance per contract</h2>
        {bals.length === 0 ? <Empty text="No contracts." /> : (
          <TableWrap>
            <thead><tr><Th>Contract</Th><Th>Vendor</Th><Th>Total</Th><Th>Prev. consumed</Th><Th>Approved spend</Th><Th>Remaining</Th><Th>End date</Th></tr></thead>
            <tbody>
              {bals.map(b => {
                const c = cById[b.contract_id]
                const low = Number(b.remaining) <= 0.1 * Number(b.total_amount)
                return (
                  <tr key={b.contract_id}>
                    <Td className="font-medium">{c?.contract_number}</Td>
                    <Td>{c?.vendors?.name}</Td>
                    <Td>{money(b.total_amount)}</Td>
                    <Td>{money(b.previous_consumed_amount)}</Td>
                    <Td>{money(b.approved_spend)}</Td>
                    <Td className={low ? 'text-red-600 font-bold' : 'font-semibold text-emerald-700'}>{money(b.remaining)}</Td>
                    <Td>{fmtDate(c?.end_date)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Total spend per vendor <span className="text-xs font-normal text-slate-400">(approved + closed requests)</span></h2>
        {vendorRows.length === 0 ? <Empty text="No approved spend yet." /> : (
          <div className="space-y-2">
            {vendorRows.map(([name, amt]) => (
              <div key={name}>
                <div className="flex justify-between text-sm mb-0.5"><span>{name}</span><b>{money(amt)}</b></div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: (amt / maxSpend * 100) + '%' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Most requested parts</h2>
          {partRows.length === 0 ? <Empty text="No requests yet." /> : (
            <TableWrap>
              <thead><tr><Th>Part</Th><Th>Times requested</Th><Th>Total qty</Th></tr></thead>
              <tbody>
                {partRows.map(p => (
                  <tr key={p.part}>
                    <Td><div className="font-mono text-xs">{p.part}</div><div className="text-xs text-slate-500 max-w-[200px]">{p.desc}</div></Td>
                    <Td>{p.count}</Td><Td className="font-semibold">{p.qty}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-3">Average approval time per supervisor</h2>
          {apprRows.length === 0 ? <Empty text="No decided requests yet." /> : (
            <TableWrap>
              <thead><tr><Th>Supervisor</Th><Th>Avg. time to decision</Th><Th>Decided</Th></tr></thead>
              <tbody>
                {apprRows.map(a => (
                  <tr key={a.n}><Td>{a.n}</Td><Td className="font-semibold">{fmtHrs(a.avg)}</Td><Td>{a.count}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Overdue vs promise date (no receipt logged)</h2>
        {overdue.length === 0 ? <Empty text="Nothing overdue. 🎉" /> : (
          <TableWrap>
            <thead><tr><Th>Request</Th><Th>Contract</Th><Th>Promise date</Th><Th>Last follow-up</Th><Th>Pending items</Th></tr></thead>
            <tbody>
              {overdue.map(r => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.request_number}</Td>
                  <Td>{r.contracts?.contract_number}</Td>
                  <Td className="text-red-600 font-semibold">{fmtDate(r.promise_date)}</Td>
                  <Td>{fmtDate(r.last_followup_date)}</Td>
                  <Td><Badge className="bg-red-100 text-red-700">{r.request_items.filter(i => !i.received_at).length} not received</Badge></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  )
}
