import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, SectionHead, Badge, Spinner, Empty, Stat, Meter, Btn, Icon } from '../ui.jsx'
import { money, fmtDate, STATUS_STYLE, statusLabel, actionFor, requestTotal, isOverdue, ACTIVE_STATUSES } from '../lib/helpers'
import { usePoll } from '../lib/poll.js'

const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)

export default function Dashboard() {
  const { profile } = useApp()
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  usePoll(async () => {
    const [{ data: r }, { data: b }, { data: c }] = await Promise.all([
      supabase.from('requests')
        .select('*, request_items(unit_price, quantity, received_quantity), contracts(contract_number, vendors(name)), engineer:profiles!requests_engineer_id_fkey(full_name)')
        .order('submitted_at', { ascending: false }),
      supabase.from('contract_balances').select('*'),
      supabase.from('contracts').select('id, contract_number, end_date, vendors(name)'),
    ])
    setData({ reqs: (r || []).filter(x => !x.archived), bals: b || [], contracts: c || [] })
  }, 10000, [])

  if (!data) return <Spinner />
  const { reqs, bals, contracts } = data
  const cById = Object.fromEntries(contracts.map(c => [c.id, c]))
  const mine = reqs.filter(r => actionFor(r, profile))
  const active = reqs.filter(r => ACTIVE_STATUSES.includes(r.status))
  const overdue = reqs.filter(isOverdue)
  const balRows = bals
    .map(b => ({ ...b, c: cById[b.contract_id], pct: Number(b.total_amount) > 0 ? Number(b.remaining) / Number(b.total_amount) * 100 : 0 }))
    .filter(b => b.c)
    .sort((a, b) => a.pct - b.pct)
  const low = balRows.filter(b => b.pct <= 10)
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const open = (id) => navigate(`/requests?open=${id}`)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[13px] text-ink-500">{today}</div>
          <h1 className="font-display font-semibold text-[26px] leading-tight tracking-wide uppercase text-ink-900 mt-0.5">Overview</h1>
        </div>
        {['engineer', 'supervisor', 'admin'].includes(profile.role) && <Btn icon="plus" onClick={() => navigate('/new-request')}>New request</Btn>}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Needs your action" value={mine.length} tone={mine.length ? 'brand' : 'ink'} icon="inbox"
          hint={mine.length ? 'Waiting on you now' : 'Nothing waiting on you'} onClick={() => navigate('/requests?view=action')} />
        <Stat label="Open requests" value={active.length} icon="requests" hint="Submitted and not yet closed" onClick={() => navigate('/requests?view=open')} />
        <Stat label="Overdue deliveries" value={overdue.length} tone={overdue.length ? 'brand' : 'ink'} icon="clock" hint="Past the vendor promise date" />
        <Stat label="Contracts low on balance" value={low.length} tone={low.length ? 'gold' : 'ink'} icon="contracts" hint="10% or less remaining" onClick={() => navigate('/contracts')} />
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-6 items-start">
        <Card>
          <SectionHead title="Needs your action" right={<Link to="/requests" className="text-[13px] font-medium text-brand-700 hover:underline">All requests</Link>} />
          {mine.length === 0 ? (
            <Empty icon="check" title="You are up to date" hint="Requests that need your decision, release or amendment appear here." />
          ) : (
            <ul>
              {mine.slice(0, 8).map(r => (
                <li key={r.id}>
                  <button onClick={() => open(r.id)} className="w-full flex items-center gap-4 px-5 py-3.5 border-b border-ink-100 last:border-0 text-left hover:bg-ink-50 transition-colors">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="num text-sm font-medium text-ink-900">{r.request_number}</span>
                        <Badge className={STATUS_STYLE[r.status]}>{statusLabel(r.status)}</Badge>
                      </span>
                      <span className="block text-[13px] text-ink-500 mt-1 truncate">
                        {r.engineer?.full_name} · {r.contracts?.contract_number} · {r.contracts?.vendors?.name}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="num block text-sm text-ink-900">{money(requestTotal(r))}</span>
                      <span className="block text-[12px] font-medium text-brand-700 mt-0.5">{actionFor(r, profile)}</span>
                    </span>
                    <Icon name="right" className="w-4 h-4 text-ink-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHead title="Contract balances" hint="Lowest remaining first" right={<Link to="/contracts" className="text-[13px] font-medium text-brand-700 hover:underline">All contracts</Link>} />
          {balRows.length === 0 ? <Empty icon="contracts" title="No contracts yet" /> : (
            <ul>
              {balRows.slice(0, 6).map(b => {
                const left = daysBetween(b.c.end_date, new Date())
                return (
                  <li key={b.contract_id} className="px-5 py-3.5 border-b border-ink-100 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink-900 truncate">{b.c.contract_number}</span>
                      <span className="num text-sm text-ink-900 shrink-0">{money(b.remaining)}</span>
                    </div>
                    <Meter pct={b.pct} className="mt-2" />
                    <div className="flex justify-between gap-3 text-[12px] text-ink-500 mt-1.5">
                      <span className="truncate">{b.c.vendors?.name}</span>
                      <span className={`shrink-0 ${left <= 30 ? 'text-brand-700 font-medium' : ''}`}>
                        {left < 0 ? `Ended ${fmtDate(b.c.end_date)}` : left <= 30 ? `Ends in ${left} days` : `${Math.round(b.pct)}% remaining`}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      {overdue.length > 0 && (
        <Card>
          <SectionHead title="Overdue deliveries" hint="Promise date has passed and parts are still outstanding" />
          <ul>
            {overdue.slice(0, 6).map(r => (
              <li key={r.id}>
                <button onClick={() => open(r.id)} className="w-full flex items-center gap-4 px-5 py-3 border-b border-ink-100 last:border-0 text-left hover:bg-ink-50 transition-colors">
                  <span className="num text-sm font-medium text-ink-900 w-36 shrink-0">{r.request_number}</span>
                  <span className="text-[13px] text-ink-500 flex-1 truncate">{r.contracts?.vendors?.name} · Release {r.release_number || '—'}</span>
                  <span className="text-[13px] font-medium text-brand-700 shrink-0">{daysBetween(new Date(), r.promise_date)} days late</span>
                  <Icon name="right" className="w-4 h-4 text-ink-300" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
