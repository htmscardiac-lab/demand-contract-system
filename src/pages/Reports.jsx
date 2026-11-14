import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../App.jsx'
import { Card, SectionHead, Btn, Input, Select, Spinner, Empty, PageTitle, Alert, Tabs, TableWrap, Th, Td } from '../ui.jsx'
import { Chart } from '../lib/charts.jsx'
import { fmtCell } from '../lib/reportExport'
import { loadReportData, performanceScope, overviewReport, contractReport, teamsReport, engineersReport, partsReport } from '../lib/reportData'

const NUMERIC = ['money', 'num', 'int', 'pct', 'days']
const PAGE = 25

export function ExportButtons({ build, meta, disabled }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const run = async (kind) => {
    setBusy(kind); setErr('')
    try {
      const report = await build()
      if (!report) throw new Error('Nothing to export')
      const m = await import('../lib/reportExport')
      await (kind === 'pdf' ? m.exportReportPdf : m.exportReportExcel)(report, meta)
    } catch (ex) { setErr(`Could not build the ${kind === 'pdf' ? 'PDF' : 'Excel file'}: ${ex.message}`) }
    setBusy('')
  }
  return (
    <>
      <Btn variant="secondary" icon="download" onClick={() => run('xlsx')} disabled={!!busy || disabled}>{busy === 'xlsx' ? 'Exporting…' : 'Excel'}</Btn>
      <Btn variant="secondary" icon="download" onClick={() => run('pdf')} disabled={!!busy || disabled}>{busy === 'pdf' ? 'Exporting…' : 'PDF'}</Btn>
      {err && <span role="alert" className="basis-full text-right text-[13px] text-brand-700">{err}</span>}
    </>
  )
}

function ReportTable({ table }) {
  const [all, setAll] = useState(false)
  const rows = all ? table.rows : table.rows.slice(0, PAGE)
  const totals = table.columns.some(c => c.sum) && table.rows.length > 1
  return (
    <Card className="overflow-hidden mb-6">
      <SectionHead title={table.title} hint={`${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`} />
      {table.rows.length === 0 ? <Empty title="Nothing in this period" /> : (
        <TableWrap>
          <thead><tr>{table.columns.map(c => <Th key={c.k} right={NUMERIC.includes(c.t)}>{c.h}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{table.columns.map((c, j) => (
                <Td key={c.k} right={NUMERIC.includes(c.t)}
                  className={`${NUMERIC.includes(c.t) || c.t === 'date' ? 'num text-[13px] whitespace-nowrap' : ''} ${j === 0 ? 'font-medium text-ink-900 whitespace-nowrap' : ''} ${(c.w || 0) >= 36 ? 'min-w-[240px]' : ''}`}>
                  {fmtCell(r[c.k], c.t)}
                </Td>
              ))}</tr>
            ))}
            {totals && (
              <tr className="bg-ink-50 font-medium text-ink-900">{table.columns.map((c, j) => (
                <Td key={c.k} right={NUMERIC.includes(c.t)} className="num text-[13px] border-t border-ink-300">
                  {c.sum ? fmtCell(table.rows.reduce((s, r) => s + Number(r[c.k] || 0), 0), c.t) : j === 0 ? 'Total' : ''}
                </Td>
              ))}</tr>
            )}
          </tbody>
        </TableWrap>
      )}
      {table.rows.length > PAGE && (
        <div className="px-5 py-3 border-t border-ink-100 text-[13px] text-ink-500 flex items-center justify-between gap-3">
          <span>{all ? `All ${table.rows.length} rows` : `First ${PAGE} of ${table.rows.length} rows. The Excel and PDF files include every row.`}</span>
          <Btn size="sm" variant="ghost" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : 'Show all'}</Btn>
        </div>
      )}
    </Card>
  )
}

export function ReportView({ report }) {
  if (!report) return <Empty icon="search" title="Nothing to report" hint="Pick another item or widen the period." />
  const charts = report.charts.filter(c => c && (c.spec.rows?.length || c.spec.points?.length))
  return (
    <div>
      <dl className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6 gap-3 mb-6">
        {report.kpis.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-ink-200 shadow-card px-4 py-3.5">
            <dt className="text-[11px] font-medium uppercase tracking-[0.080em] text-ink-500 leading-snug">{k.label}</dt>
            <dd className={`num font-medium mt-1.5 break-words ${String(k.value).length > 16 ? 'text-[15px] leading-snug' : 'text-[22px] leading-tight'} ${k.alert ? 'text-brand-600' : 'text-ink-900'}`}>{k.value}</dd>
          </div>
        ))}
      </dl>
      {charts.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
          {charts.map(c => (
            <Card key={c.title} className="overflow-hidden">
              <SectionHead title={c.title} hint={c.note} />
              <div className="px-5 py-4"><Chart spec={c.spec} label={c.title} /></div>
            </Card>
          ))}
        </div>
      )}
      {report.tables.map(t => <ReportTable key={t.title} table={t} />)}
    </div>
  )
}

export default function Reports() {
  const { profile, settings } = useApp()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ from: '', to: '' })
  const role = profile.role
  const wide = ['admin', 'clinical_engineer'].includes(role)
  const tabs = [
    { key: 'overview', label: 'All contracts' }, { key: 'contract', label: 'By contract' },
    ...(role === 'engineer' ? [] : [{ key: 'teams', label: wide ? 'Teams' : 'My team' }]),
    { key: 'engineers', label: role === 'engineer' ? 'My report' : 'Engineers' }, { key: 'parts', label: 'Parts' },
  ]
  const tab = tabs.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview'
  const id = params.get('id') || ''
  const part = params.get('part') || ''
  const go = (patch) => { const p = { tab, id, part, ...patch }; setParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v)), { replace: true }) }

  useEffect(() => { loadReportData().then(setData).catch(ex => setErr(ex.message)) }, [])

  const scope = useMemo(() => data ? performanceScope(data.requests, profile) : [], [data, profile])
  const people = useMemo(() => {
    const uniq = (pick) => [...new Map(scope.map(pick).filter(x => x?.id).map(x => [x.id, x])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
    return { engineers: uniq(r => r.engineer), supervisors: uniq(r => r.supervisor) }
  }, [scope])
  const partOptions = useMemo(() => {
    if (!data) return []
    const m = new Map()
    for (const r of data.requests) if (!id || String(r.contract_id) === id) for (const i of r.parts) if (!m.has(i.part_number)) m.set(i.part_number, i.description)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data, id])

  const report = useMemo(() => {
    if (!data) return null
    if (tab === 'overview') return overviewReport(data, f)
    if (tab === 'contract') return contractReport(data, f, id || data.contracts[0]?.id)
    if (tab === 'teams') return teamsReport(data, f, scope, wide ? id : profile.id)
    if (tab === 'engineers') return engineersReport(data, f, scope, role === 'engineer' ? profile.id : id)
    return partsReport(data, f, id, part)
  }, [data, f, tab, id, part, scope, wide, role, profile.id])

  if (err) return <Alert>Could not load the report data: {err}</Alert>
  if (!data) return <Spinner />
  const meta = { by: profile.full_name, department: settings.department_name }

  return (
    <div>
      <PageTitle subtitle="Balances, request activity and delivery performance. Every view exports to Excel or PDF with its charts."
        right={<ExportButtons build={async () => report} meta={meta} disabled={!report} />}>Reports</PageTitle>
      {!wide && <Alert kind="info">Request figures cover {role === 'supervisor' ? 'your team\'s requests' : 'your own requests'}. Contract balances are the full balances.</Alert>}

      <Card className="mb-6">
        <Tabs className="px-2" value={tab} onChange={(k) => go({ tab: k, id: '', part: '' })} tabs={tabs} />
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          {tab === 'contract' && (
            <Select label="Contract" className="min-w-[240px]" value={id || data.contracts[0]?.id || ''} onChange={e => go({ id: e.target.value })}>
              {data.contracts.map(c => <option key={c.id} value={c.id}>{c.contract_number} · {c.vendors?.name}</option>)}
            </Select>
          )}
          {tab === 'teams' && wide && (
            <Select label="Team" className="min-w-[240px]" value={id} onChange={e => go({ id: e.target.value })}>
              <option value="">All teams</option>
              {people.supervisors.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          )}
          {tab === 'engineers' && role !== 'engineer' && (
            <Select label="Engineer" className="min-w-[240px]" value={id} onChange={e => go({ id: e.target.value })}>
              <option value="">All engineers</option>
              {people.engineers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          )}
          {tab === 'parts' && <>
            <Select label="Contract" className="min-w-[220px]" value={id} onChange={e => go({ id: e.target.value, part: '' })}>
              <option value="">All contracts</option>
              {data.contracts.map(c => <option key={c.id} value={c.id}>{c.contract_number} · {c.vendors?.name}</option>)}
            </Select>
            <Select label="Part" className="min-w-[260px] max-w-sm" value={part} onChange={e => go({ part: e.target.value })}>
              <option value="">All parts</option>
              {partOptions.map(([pn, d]) => <option key={pn} value={pn}>{d} · {pn}</option>)}
            </Select>
          </>}
          <Input label="Submitted from" type="date" value={f.from} max={f.to || undefined} onChange={e => setF(x => ({ ...x, from: e.target.value }))} />
          <Input label="Submitted to" type="date" value={f.to} min={f.from || undefined} onChange={e => setF(x => ({ ...x, to: e.target.value }))} />
          {(f.from || f.to) && <Btn variant="ghost" onClick={() => setF({ from: '', to: '' })}>All dates</Btn>}
        </div>
      </Card>

      {report && <div className="mb-5"><h2 className="font-display text-xl font-medium text-ink-900">{report.title}</h2><p className="text-sm text-ink-500 mt-1">{report.subtitle}</p></div>}
      <ReportView report={report} />
    </div>
  )
}
