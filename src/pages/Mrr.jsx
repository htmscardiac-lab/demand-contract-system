import React, { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { usePoll } from '../lib/poll.js'
import { Card, Btn, Badge, Spinner, Empty, PageTitle, Alert, Tabs, SearchInput, TableWrap, Th, Td, Row, Stat, Icon, Drawer, Field } from '../ui.jsx'
import { fmtDate, fmtQty, money } from '../lib/helpers'
import { MrrModal, MrrReminderModal, unlinkedReceipts, poRelease } from '../lib/mrr.jsx'
import { allMrrs, awaitingMrrReport, recordedMrrReport, singleMrrReport } from '../lib/mrrReports'
import { ExportButtons } from './Reports.jsx'
import { REQUEST_QUERY } from './Requests.jsx'

const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000))

export default function Mrr() {
  const { settings, profile, prefs, savePrefs } = useApp()
  const navigate = useNavigate()
  const [reqs, setReqs] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState('pending')
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState('')
  const [open, setOpen] = useState({})
  const [mrrFor, setMrrFor] = useState(null)
  const [remind, setRemind] = useState(null)
  const [ok, setOk] = useState('')
  const [mrrOpen, setMrrOpen] = useState(null)
  const [poOpen, setPoOpen] = useState({})

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('requests').select(REQUEST_QUERY).in('status', ['in_process', 'approved', 'closed']).order('submitted_at', { ascending: false })
    if (error) { setLoadErr(`Could not load requests: ${error.message}. If this mentions request_receipts or mrrs, run supabase/migration_004_contacts_mrr.sql in the Supabase SQL Editor.`); return }
    setLoadErr('')
    setReqs(data || [])
  }, [])
  usePoll(load, 15000, [load])

  if (loadErr && !reqs) return <Alert>{loadErr}</Alert>
  if (!reqs) return <Spinner />
  const pendingAll = reqs.map(r => ({ r, lines: unlinkedReceipts(r) })).filter(x => x.lines.length > 0)
  const vendors = [...new Set(pendingAll.map(x => x.r.contracts?.vendors?.name).filter(Boolean))].sort()
  const needle = q.trim().toLowerCase()
  const match = (r) => (!vendor || r.contracts?.vendors?.name === vendor) && (!needle ||
    [r.request_number, r.release_number, r.contracts?.po_number, r.contracts?.contract_number, r.contracts?.vendors?.name, r.engineer?.full_name]
      .some(v => String(v || '').toLowerCase().includes(needle)))
  const pending = pendingAll.filter(x => match(x.r))
  const byVendor = pending.reduce((m, x) => { const k = x.r.contracts?.vendors?.name || '—'; (m[k] = m[k] || []).push(x); return m }, {})
  const recorded = allMrrs(reqs).filter(e => match(e.r) || (needle && e.m.mrr_number.toLowerCase().includes(needle)))
  const byPo = [...new Set(recorded.map(e => e.po))].map(po => ({ po, list: recorded.filter(e => e.po === po) }))
  const view = prefs.mrrView === 'po' ? 'po' : 'mrr'
  const shown = mrrOpen ? allMrrs(reqs).find(e => e.m.id === mrrOpen) : null
  const oldest = pendingAll.flatMap(x => x.lines).reduce((d, l) => Math.max(d, daysSince(l.received_at)), 0)
  const scope = vendor || (needle ? `Search: ${q.trim()}` : 'All vendors')
  const meta = { by: profile.full_name, department: settings.department_name }
  const mrrRow = (e, withPo = true) => (
    <Row key={e.m.id} onClick={() => setMrrOpen(e.m.id)}>
      <Td className="num font-medium text-ink-900 whitespace-nowrap">{e.m.mrr_number}</Td>
      <Td className="whitespace-nowrap">{fmtDate(e.m.mrr_date)}</Td>
      <Td className="num text-[13px] whitespace-nowrap">{withPo ? e.ref : e.r.release_number || '—'}</Td>
      <Td className="num text-[13px] whitespace-nowrap">{e.r.request_number}</Td>
      {withPo && <Td>{e.vendor}</Td>}
      <Td right className="num">{e.lines.length}</Td>
      <Td right className="num">{money(e.total)}</Td>
    </Row>
  )

  return (
    <div>
      <PageTitle subtitle="Lines that are received but not covered by an MRR yet, and the MRRs already recorded."
        right={<ExportButtons meta={meta} disabled={tab === 'pending' ? pending.length === 0 : recorded.length === 0}
          build={async () => tab === 'pending' ? awaitingMrrReport(pending.map(x => x.r), scope) : recordedMrrReport(recorded, scope)} />}>MRR</PageTitle>
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Requests awaiting MRR" value={pendingAll.length} tone={pendingAll.length ? 'brand' : 'ink'} />
        <Stat label="Received lines without MRR" value={pendingAll.reduce((n, x) => n + x.lines.length, 0)} />
        <Stat label="Vendors concerned" value={vendors.length} />
        <Stat label="Longest wait" value={pendingAll.length ? `${oldest} d` : '—'} tone={oldest > 30 ? 'brand' : 'ink'} hint="Since the oldest receipt without an MRR" />
      </div>

      <Card className="overflow-hidden">
        <Tabs className="px-2" value={tab} onChange={setTab} tabs={[
          { key: 'pending', label: 'Awaiting MRR', count: pendingAll.length, alert: true },
          { key: 'recorded', label: 'Recorded MRRs', count: reqs.reduce((n, r) => n + (r.mrrs || []).length, 0) },
        ]} />
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-ink-100">
          <SearchInput className="flex-1 min-w-[220px] max-w-md" placeholder={tab === 'pending' ? 'Search request, PO, release or vendor' : 'Search MRR number, request, PO or vendor'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
          {tab === 'recorded' && (
            <span role="group" aria-label="List by" className="inline-flex rounded-lg border border-ink-300 overflow-hidden">
              {[['mrr', 'By MRR'], ['po', 'By P.O']].map(([k, t]) => (
                <button key={k} aria-pressed={view === k} onClick={() => savePrefs({ mrrView: k })}
                  className={`h-9.5 px-3.5 text-sm font-medium border-l border-ink-300 first:border-l-0 transition-colors ${view === k ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-ink-50'}`}>{t}</button>
              ))}
            </span>
          )}
          {tab === 'pending' && vendors.length > 1 && (
            <select value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Filter by vendor"
              className="h-9.5 rounded-lg border border-ink-300 bg-white px-3 pr-8 text-sm text-ink-800 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100">
              <option value="">All vendors</option>
              {vendors.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </div>

        {tab === 'pending' && (pending.length === 0 ? (
          pendingAll.length === 0
            ? <Empty icon="check" title="Every received line has an MRR" hint="Lines appear here as soon as an engineer records a receipt, in full or in part." />
            : <Empty icon="search" title="Nothing matches" hint="Clear the search or the vendor filter." />
        ) : Object.entries(byVendor).sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => (
          <section key={name} className="border-b border-ink-200 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-ink-50">
              <div>
                <h2 className="text-sm font-medium text-ink-900">{name}</h2>
                <p className="text-[12px] text-ink-500">{list.length} request{list.length === 1 ? '' : 's'} · {list.reduce((n, x) => n + x.lines.length, 0)} received line{list.reduce((n, x) => n + x.lines.length, 0) === 1 ? '' : 's'} without MRR</p>
              </div>
              <Btn size="sm" variant="secondary" icon="mail" onClick={() => setRemind(list.map(x => x.r))}>Reminder for all {list.length}</Btn>
            </div>
            <ul>
              {list.map(({ r, lines }) => {
                const wait = lines.reduce((d, l) => Math.max(d, daysSince(l.received_at)), 0)
                const isOpen = !!open[r.id]
                return (
                  <li key={r.id} className="border-t border-ink-100">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                      <button onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))} aria-expanded={isOpen} className="flex items-center gap-3 min-w-0 flex-1 basis-64 text-left">
                        <Icon name="right" className={`w-4 h-4 text-ink-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="num text-sm font-medium text-ink-900">{poRelease(r)}</span>
                            <Badge className={wait > 30 ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-600'}>{wait === 0 ? 'Received today' : `Waiting ${wait} day${wait === 1 ? '' : 's'}`}</Badge>
                          </span>
                          <span className="block text-[13px] text-ink-500 mt-0.5 truncate"><span className="num">{r.request_number}</span> · {r.engineer?.full_name} · {lines.length} line{lines.length === 1 ? '' : 's'}</span>
                        </span>
                      </button>
                      <div className="flex gap-2">
                        <Btn size="sm" variant="ghost" onClick={() => navigate(`/requests?open=${r.id}`)}>Open request</Btn>
                        <Btn size="sm" variant="secondary" icon="mail" onClick={() => setRemind([r])}>Reminder</Btn>
                        <Btn size="sm" onClick={() => setMrrFor(r)}>Generate MRR</Btn>
                      </div>
                    </div>
                    {isOpen && (
                      <TableWrap className="border-t border-ink-100">
                        <thead><tr><Th>Line</Th><Th>Description</Th><Th>Part number</Th><Th right>Qty received</Th><Th>Received on</Th></tr></thead>
                        <tbody>
                          {lines.map(x => (
                            <tr key={x.id}>
                              <Td className="num text-ink-500">{x.item.line_number}</Td>
                              <Td className="text-ink-900">{x.item.is_vat ? 'VAT line' : x.item.description}</Td>
                              <Td className="num text-[13px]">{x.item.part_number}</Td>
                              <Td right className="num">{fmtQty(x.quantity)}</Td>
                              <Td className="text-[13px]">{fmtDate(x.received_at)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </TableWrap>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )))}

        {tab === 'recorded' && (recorded.length === 0
          ? (needle ? <Empty icon="search" title="Nothing matches" hint="Clear the search." /> : <Empty title="No MRR recorded yet" hint="An MRR appears here once a clinical engineer links received lines to its number." />)
          : view === 'mrr' ? (
            <TableWrap>
              <thead><tr><Th>MRR number</Th><Th>MRR date</Th><Th>P.O – Release</Th><Th>Request</Th><Th>Vendor</Th><Th right>Lines</Th><Th right>Total incl. VAT</Th></tr></thead>
              <tbody>{recorded.map(e => mrrRow(e))}</tbody>
            </TableWrap>
          ) : (
            <ul>
              {byPo.map(({ po, list }) => {
                const isOpen = !!poOpen[po]
                return (
                  <li key={po} className="border-b border-ink-100 last:border-0">
                    <button onClick={() => setPoOpen(o => ({ ...o, [po]: !o[po] }))} aria-expanded={isOpen} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left hover:bg-ink-50">
                      <Icon name="right" className={`w-4 h-4 text-ink-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="block text-sm font-medium text-ink-900">P.O <span className="num">{po}</span></span>
                        <span className="block text-[13px] text-ink-500 truncate">{list[0].vendor} · <span className="num">{list[0].r.contracts?.contract_number}</span></span>
                      </span>
                      <Badge className="bg-ink-100 text-ink-700">{list.length} MRR{list.length === 1 ? '' : 's'}</Badge>
                      <span className="num text-sm text-ink-900 w-36 text-right">{money(list.reduce((s, e) => s + e.total, 0))}</span>
                    </button>
                    {isOpen && (
                      <TableWrap className="border-t border-ink-100">
                        <thead><tr><Th>MRR number</Th><Th>MRR date</Th><Th>Release</Th><Th>Request</Th><Th right>Lines</Th><Th right>Total incl. VAT</Th></tr></thead>
                        <tbody>{list.map(e => mrrRow(e, false))}</tbody>
                      </TableWrap>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </Card>

      <MrrModal request={mrrFor} onClose={() => setMrrFor(null)} onSaved={(n) => { setMrrFor(null); setOk(`MRR ${n} recorded.`); load() }} />
      <Drawer open={!!shown} onClose={() => setMrrOpen(null)} title={shown ? `MRR ${shown.m.mrr_number}` : ''} subtitle={shown ? `${shown.vendor} · P.O ${shown.ref}` : ''}
        footer={shown && <div className="flex flex-wrap justify-end gap-2">
          <Btn variant="ghost" onClick={() => navigate(`/requests?open=${shown.r.id}`)}>Open request</Btn>
          <ExportButtons meta={meta} build={async () => singleMrrReport(shown)} />
        </div>}>
        {shown && <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 mb-6">
            <Field label="MRR date">{fmtDate(shown.m.mrr_date)}</Field>
            <Field label="Request"><span className="num">{shown.r.request_number}</span></Field>
            <Field label="Requested by">{shown.r.engineer?.full_name}</Field>
            <Field label="Lines covered"><span className="num">{shown.lines.length}</span></Field>
            <Field label="Value before VAT"><span className="num">{money(shown.value)}</span></Field>
            <Field label="Total incl. VAT"><span className="num">{money(shown.total)}</span></Field>
          </dl>
          <div className="rounded-lg border border-ink-200 overflow-hidden">
            <TableWrap>
              <thead><tr><Th>Line</Th><Th>Description</Th><Th right>Qty</Th><Th right>Value</Th><Th>Received</Th></tr></thead>
              <tbody>
                {shown.lines.map(x => (
                  <tr key={x.id}>
                    <Td className="num text-ink-500">{x.item.line_number}</Td>
                    <Td><span className="block text-ink-900">{x.item.description}</span><span className="block num text-[12px] text-ink-500">{x.item.part_number} · HTM {x.item.htm_number}</span></Td>
                    <Td right className="num">{fmtQty(x.quantity)}</Td>
                    <Td right className="num">{money(x.quantity * x.item.unit_price)}</Td>
                    <Td className="text-[13px] whitespace-nowrap">{fmtDate(x.received_at)}</Td>
                  </tr>
                ))}
                {shown.vatLine && shown.vatQty > 0 && (
                  <tr className="bg-gold-100/40">
                    <Td className="num text-ink-500">{shown.vatLine.line_number}</Td>
                    <Td><span className="block text-ink-900">VAT 15%</span><span className="block text-[12px] text-ink-500">On the taxed parts of this MRR</span></Td>
                    <Td right className="num">{fmtQty(shown.vatQty)}</Td>
                    <Td right className="num">{money(shown.vat)}</Td>
                    <Td />
                  </tr>
                )}
              </tbody>
            </TableWrap>
          </div>
        </>}
      </Drawer>
      <MrrReminderModal requests={remind} settings={settings} onClose={() => setRemind(null)} />
    </div>
  )
}
