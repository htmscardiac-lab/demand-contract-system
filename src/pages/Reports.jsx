import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, SectionHead, Spinner, Empty, PageTitle, TableWrap, Th, Td, Badge, Meter, Stat } from '../ui.jsx'
import { money, fmtDate, isOverdue } from '../lib/helpers'

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
  for (const r of reqs) for (const i of r.request_items.filter(x => !x.is_vat)) {
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
  const overdue = reqs.filter(r => !r.archived && isOverdue(r))

  const fmtHrs = h => h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`

  const totalValue = bals.reduce((s, b) => s + Number(b.total_amount), 0)
  const totalRemaining = bals.reduce((s, b) => s + Number(b.remaining), 0)
  const totalSpent = vendorRows.reduce((s, v) => s + v[1], 0)
  const compact = (n) => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })

  return (
    <div className="space-y-6">
      <PageTitle subtitle="Balances, spend and turnaround across all contracts you can see.">Reports</PageTitle>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Contracts" value={contracts.length} hint={`${compact(totalValue)} total value`} />
        <Stat label="Remaining balance" value={compact(totalRemaining)} tone="olive" hint={totalValue ? `${Math.round(totalRemaining / totalValue * 100)}% of total value` : undefined} />
        <Stat label="Approved spend" value={compact(totalSpent)} hint="Approved and closed requests" />
        <Stat label="Overdue deliveries" value={overdue.length} tone={overdue.length ? 'brand' : 'ink'} hint="Past the vendor promise date" />
      </div>

      <Card className="overflow-hidden">
        <SectionHead title="Balance by contract" />
        {bals.length === 0 ? <Empty icon="contracts" title="No contracts yet" /> : (
          <TableWrap>
            <thead><tr><Th>Contract</Th><Th>Vendor</Th><Th right>Total</Th><Th right>Previously consumed</Th><Th right>Committed</Th><Th right>Remaining</Th><Th className="w-40">Balance left</Th><Th>End date</Th></tr></thead>
            <tbody>
              {bals.map(b => {
                const c = cById[b.contract_id]
                const pct = Number(b.total_amount) > 0 ? Number(b.remaining) / Number(b.total_amount) * 100 : 0
                return (
                  <tr key={b.contract_id}>
                    <Td className="font-medium text-ink-900">{c?.contract_number}</Td>
                    <Td>{c?.vendors?.name}</Td>
                    <Td right className="num">{money(b.total_amount)}</Td>
                    <Td right className="num text-ink-600">{money(b.previous_consumed_amount)}</Td>
                    <Td right className="num text-ink-600">{money(b.approved_spend)}</Td>
                    <Td right className={`num font-medium ${pct <= 10 ? 'text-brand-600' : 'text-ink-900'}`}>{money(b.remaining)}</Td>
                    <Td><div className="flex items-center gap-3"><Meter pct={pct} className="flex-1" /><span className="num text-[12px] text-ink-600 w-9 text-right">{Math.round(pct)}%</span></div></Td>
                    <Td className="text-[13px]">{fmtDate(c?.end_date)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card className="overflow-hidden">
          <SectionHead title="Spend by vendor" hint="Approved and closed requests" />
          {vendorRows.length === 0 ? <Empty icon="reports" title="No approved spend yet" /> : (
            <ul className="p-5 space-y-4">
              {vendorRows.map(([name, amt]) => (
                <li key={name}>
                  <div className="flex justify-between gap-3 text-sm mb-1.5"><span className="text-ink-900 truncate">{name}</span><span className="num font-medium text-ink-900">{money(amt)}</span></div>
                  <div className="h-2 bg-ink-100 rounded-full overflow-hidden"><div className="h-full bg-ink-900 rounded-full" style={{ width: (amt / maxSpend * 100) + '%' }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <SectionHead title="Supervisor turnaround" hint="Average time from submission to decision" />
          {apprRows.length === 0 ? <Empty icon="clock" title="No decided requests yet" /> : (
            <TableWrap>
              <thead><tr><Th>Supervisor</Th><Th right>Average time</Th><Th right>Decided</Th></tr></thead>
              <tbody>
                {apprRows.map(a => (
                  <tr key={a.n}><Td className="text-ink-900">{a.n}</Td><Td right className="num font-medium text-ink-900">{fmtHrs(a.avg)}</Td><Td right className="num">{a.count}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <SectionHead title="Most requested parts" hint="Top 15 by quantity" />
        {partRows.length === 0 ? <Empty icon="box" title="No requests yet" /> : (
          <TableWrap>
            <thead><tr><Th>Part number</Th><Th>Description</Th><Th right>Times requested</Th><Th right>Total quantity</Th></tr></thead>
            <tbody>
              {partRows.map(p => (
                <tr key={p.part}>
                  <Td className="num text-[13px] text-ink-900">{p.part}</Td>
                  <Td className="max-w-[420px]">{p.desc}</Td>
                  <Td right className="num">{p.count}</Td><Td right className="num font-medium text-ink-900">{p.qty}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card className="overflow-hidden">
        <SectionHead title="Overdue deliveries" hint="Promise date has passed and parts are still outstanding" />
        {overdue.length === 0 ? <Empty icon="check" title="Nothing is overdue" /> : (
          <TableWrap>
            <thead><tr><Th>Request</Th><Th>Contract</Th><Th>Promise date</Th><Th>Last follow-up</Th><Th>Outstanding</Th></tr></thead>
            <tbody>
              {overdue.map(r => (
                <tr key={r.id}>
                  <Td className="num font-medium text-ink-900">{r.request_number}</Td>
                  <Td>{r.contracts?.contract_number}</Td>
                  <Td className="text-brand-700 font-medium">{fmtDate(r.promise_date)}</Td>
                  <Td>{fmtDate(r.last_followup_date)}</Td>
                  <Td><Badge className="bg-brand-100 text-brand-700">{r.request_items.filter(i => (i.received_quantity || 0) < i.quantity).length} lines outstanding</Badge></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  )
}
