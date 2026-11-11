import React, { useEffect, useState, useCallback } from 'react'
import { supabase, imgUrl } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, SectionHead, Btn, Input, Badge, Modal, Spinner, Empty, PageTitle, BackLink, Alert, TableWrap, Th, Td, Row, SearchInput, Meter, Icon } from '../ui.jsx'
import { money, fmtDate } from '../lib/helpers'

export default function Contracts() {
  const { profile } = useApp()
  const canEdit = profile.role === 'admin' || profile.role === 'supervisor'
  const [contracts, setContracts] = useState(null)
  const [bals, setBals] = useState({})
  const [vendors, setVendors] = useState([])
  const [sel, setSel] = useState(null)
  const [items, setItems] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [showVendors, setShowVendors] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('created')
  const [sortDir, setSortDir] = useState('desc')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    const [{ data: c }, { data: b }, { data: v }] = await Promise.all([
      supabase.from('contracts').select('*, vendors(id, name, contact_email)').order('created_at', { ascending: false }),
      supabase.from('contract_balances').select('*'),
      supabase.from('vendors').select('*').order('name'),
    ])
    setContracts(c || [])
    setBals(Object.fromEntries((b || []).map(x => [x.contract_id, x])))
    setVendors(v || [])
  }, [])
  useEffect(() => { load() }, [load])

  const openContract = async (c) => {
    setSel(c)
    const { data } = await supabase.from('contract_items').select('*').eq('contract_id', c.id).order('line_number')
    setItems(data || [])
  }

  const exportAll = async () => {
    setExporting(true)
    const { data: reqs } = await supabase.from('requests')
      .select('contract_id, request_items(unit_price, quantity, received_quantity)')
    const { allContractsPdf } = await import('../lib/report')
    allContractsPdf({ contracts, balances: Object.values(bals), requests: reqs || [] })
    setExporting(false)
  }

  if (!contracts) return <Spinner />

  if (sel) return <ContractDetail contract={sel} items={items} bal={bals[sel.id]} canEdit={canEdit}
    onBack={() => { setSel(null); load() }} reload={() => openContract(sel)} />

  const num = (c, key) => key === 'remaining' ? Number(bals[c.id]?.remaining ?? 0)
    : key === 'total' ? Number(c.total_amount)
    : key === 'end' ? new Date(c.end_date).getTime()
    : key === 'vendor' ? (c.vendors?.name || '').toLowerCase()
    : key === 'number' ? (c.contract_number || '').toLowerCase()
    : new Date(c.created_at).getTime()
  const q = search.trim().toLowerCase()
  const visible = contracts
    .filter(c => !q || [c.contract_number, c.po_number, c.vendors?.name].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => { const av = num(a, sortBy), bv = num(b, sortBy); const r = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === 'asc' ? r : -r })

  const daysLeft = (c) => Math.round((new Date(c.end_date) - new Date()) / 86400000)

  return (
    <div>
      <PageTitle subtitle="Demand contracts, their line items and remaining balance."
        right={<>
          <Btn variant="secondary" icon="download" onClick={exportAll} disabled={exporting || contracts.length === 0}>{exporting ? 'Exporting…' : 'Export PDF'}</Btn>
          {canEdit && <Btn variant="secondary" onClick={() => setShowVendors(true)}>Vendors</Btn>}
          {canEdit && <Btn icon="plus" onClick={() => setShowNew(true)}>New contract</Btn>}
        </>}>Contracts</PageTitle>
      {err && <Alert>{err}</Alert>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-ink-100">
          <SearchInput className="flex-1 min-w-[220px] max-w-md" placeholder="Search contract, PO or vendor" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search contracts" />
          <div className="flex items-center gap-2 ml-auto">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort by"
              className="h-9.5 rounded-lg border border-ink-300 bg-white px-3 pr-8 text-sm text-ink-800 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100">
              <option value="created">Sort: date added</option>
              <option value="number">Sort: contract number</option>
              <option value="vendor">Sort: vendor</option>
              <option value="remaining">Sort: remaining balance</option>
              <option value="total">Sort: total amount</option>
              <option value="end">Sort: end date</option>
            </select>
            <Btn variant="secondary" icon="sort" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} aria-label="Reverse sort order">
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </Btn>
          </div>
        </div>
        {contracts.length === 0 ? (
          <Empty icon="contracts" title="No contracts yet" hint="Add the first demand contract, then upload its line items from Excel."
            action={canEdit && <Btn icon="plus" onClick={() => setShowNew(true)}>New contract</Btn>} />
        ) : visible.length === 0 ? <Empty icon="search" title="No contracts match" hint="Try a different contract number, PO or vendor name." /> : (
          <>
          <ul className="md:hidden">
            {visible.map(c => {
              const b = bals[c.id]
              const rem = Number(b?.remaining ?? 0)
              const pct = b && Number(c.total_amount) > 0 ? rem / Number(c.total_amount) * 100 : 0
              return (
                <li key={c.id}>
                  <button onClick={() => openContract(c)} className="w-full text-left px-5 py-4 border-b border-ink-100 last:border-0 active:bg-ink-50">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink-900">{c.contract_number}</span>
                      <span className="num text-sm text-ink-900">{money(rem)}</span>
                    </span>
                    <Meter pct={pct} className="mt-2.5" />
                    <span className="flex justify-between gap-3 text-[12px] text-ink-500 mt-1.5">
                      <span className="truncate">{c.vendors?.name}</span>
                      <span className="shrink-0">Ends {fmtDate(c.end_date)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <TableWrap className="hidden md:block">
            <thead><tr><Th>Contract</Th><Th>Vendor</Th><Th>Period</Th><Th right>Total</Th><Th right>Remaining</Th><Th className="w-48">Balance left</Th></tr></thead>
            <tbody>
              {visible.map(c => {
                const b = bals[c.id]
                const rem = Number(b?.remaining ?? 0)
                const pct = b && Number(c.total_amount) > 0 ? rem / Number(c.total_amount) * 100 : 0
                const left = daysLeft(c)
                return (
                  <Row key={c.id} onClick={() => openContract(c)}>
                    <Td><div className="font-medium text-ink-900">{c.contract_number}</div><div className="num text-[12px] text-ink-500 mt-0.5">PO {c.po_number}</div></Td>
                    <Td>{c.vendors?.name}</Td>
                    <Td>
                      <div className="text-[13px]">{fmtDate(c.start_date)} – {fmtDate(c.end_date)}</div>
                      {left < 0 ? <div className="text-[12px] text-brand-700 font-medium mt-0.5">Ended</div>
                        : left <= 30 ? <div className="text-[12px] text-brand-700 font-medium mt-0.5">Ends in {left} days</div> : null}
                    </Td>
                    <Td right className="num text-ink-600">{money(c.total_amount)}</Td>
                    <Td right className="num font-medium text-ink-900">{money(rem)}</Td>
                    <Td><div className="flex items-center gap-3"><Meter pct={pct} className="flex-1" /><span className="num text-[12px] text-ink-600 w-9 text-right">{Math.round(pct)}%</span></div></Td>
                  </Row>
                )
              })}
            </tbody>
          </TableWrap>
          </>
        )}
      </Card>
      <NewContractModal open={showNew} onClose={() => setShowNew(false)} vendors={vendors} onSaved={() => { setShowNew(false); load() }} profile={profile} />
      <VendorsModal open={showVendors} onClose={() => { setShowVendors(false); load() }} vendors={vendors} />
    </div>
  )
}

// Reads the VAT column of an Excel sheet: Yes / Y / True / 1 / 15% / نعم mean the part is taxable.
const isYes = (v) => ['yes', 'y', 'true', '1', 'taxable', 'vat', '15', '15%', '0.15', 'نعم', 'خاضع', 'خاضعة'].includes(String(v ?? '').trim().toLowerCase())
const VatBadge = ({ on }) => on
  ? <Badge className="bg-gold-100 text-gold-700">VAT</Badge>
  : <span className="text-[12px] text-ink-400">No VAT</span>

// Turns a database "duplicate" error into something the user can act on.
const lineError = (error) => /duplicate|unique/i.test(error.message)
  ? 'A line with this line number already exists on this contract. Line numbers must be unique.'
  : error.message

function NewContractModal({ open, onClose, vendors, onSaved, profile }) {
  const empty = { contract_number: '', po_number: '', vendor_name: '', vendor_email: '', total_amount: '', previous_consumed_amount: '0', start_date: '', end_date: '', vat_line_number: '', vat_line_value: '' }
  const [f, setF] = useState(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const existing = vendors.find(v => v.name.trim().toLowerCase() === f.vendor_name.trim().toLowerCase())
  const save = async () => {
    setErr(''); setBusy(true)
    try {
      let vendorId = existing?.id
      if (!vendorId) {
        const { data, error } = await supabase.from('vendors')
          .insert({ name: f.vendor_name.trim(), contact_email: f.vendor_email.trim() || null })
          .select('id').single()
        if (error) throw error
        vendorId = data.id
      }
      const { error } = await supabase.from('contracts').insert({
        contract_number: f.contract_number.trim(), po_number: f.po_number.trim(),
        vendor_id: vendorId, total_amount: Number(f.total_amount),
        previous_consumed_amount: Number(f.previous_consumed_amount || 0),
        vat_line_number: f.vat_line_number === '' ? null : Number(f.vat_line_number),
        vat_line_value: f.vat_line_value === '' ? null : Number(f.vat_line_value),
        start_date: f.start_date, end_date: f.end_date, created_by: profile.id,
      })
      if (error) throw error
      setF(empty); onSaved()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="New contract">
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Contract number" value={f.contract_number} onChange={set('contract_number')} />
        <Input label="PO number" value={f.po_number} onChange={set('po_number')} />
        <div>
          <Input label="Vendor" list="vendor-list" value={f.vendor_name} onChange={set('vendor_name')}
            placeholder="Start typing a vendor name" autoComplete="off" />
          <datalist id="vendor-list">
            {vendors.map(v => <option key={v.id} value={v.name} />)}
          </datalist>
          {f.vendor_name.trim() !== '' && (
            existing
              ? <p className="text-[12px] text-olive-700 mt-1.5">Existing vendor.</p>
              : <p className="text-[12px] text-steel-700 mt-1.5">New vendor. It is added when you save.</p>
          )}
        </div>
        {!existing && f.vendor_name.trim() !== ''
          ? <Input label="Vendor contact email" type="email" value={f.vendor_email} onChange={set('vendor_email')} placeholder="vendor@example.com" />
          : <div />}
        <Input label="Total contract amount" type="number" min="0" step="0.01" value={f.total_amount} onChange={set('total_amount')} />
        <Input label="Previously consumed" type="number" min="0" step="0.01" value={f.previous_consumed_amount} onChange={set('previous_consumed_amount')} />
        <Input label="Start date" type="date" value={f.start_date} onChange={set('start_date')} />
        <Input label="End date" type="date" value={f.end_date} onChange={set('end_date')} />
        <Input label="VAT line number" type="number" min="1" value={f.vat_line_number} onChange={set('vat_line_number')} placeholder="Usually the last line" />
        <Input label="VAT line value" type="number" min="0" step="0.01" value={f.vat_line_value} onChange={set('vat_line_value')} placeholder="Value of one unit" />
      </div>
      <p className="text-[13px] text-ink-500 mt-4">Previously consumed is what was spent on this contract before it was added here, so the remaining balance starts out correct.</p>
      <p className="text-[13px] text-ink-500 mt-2">The VAT line is the contract line that VAT is released against. Leave both fields empty if no part on this contract is taxed.</p>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.contract_number || !f.po_number || !f.vendor_name.trim() || !f.total_amount || !f.start_date || !f.end_date || (f.vat_line_number === '') !== (f.vat_line_value === '')}>
          {busy ? 'Saving…' : 'Save contract'}
        </Btn>
      </div>
    </Modal>
  )
}

function VendorsModal({ open, onClose, vendors }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [list, setList] = useState(vendors)
  useEffect(() => setList(vendors), [vendors])
  const add = async () => {
    setErr('')
    const { error } = await supabase.from('vendors').insert({ name: name.trim(), contact_email: email.trim() || null })
    if (error) return setErr(error.message)
    const { data } = await supabase.from('vendors').select('*').order('name')
    setList(data || []); setName(''); setEmail('')
  }
  return (
    <Modal open={open} onClose={onClose} title="Vendors">
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end mb-4">
        <Input label="Vendor name" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Contact email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <Btn onClick={add} disabled={!name.trim()}>Add vendor</Btn>
      </div>
      <TableWrap className="rounded-lg border border-ink-200">
        <thead><tr><Th>Name</Th><Th>Email</Th></tr></thead>
        <tbody>{list.map(v => <tr key={v.id}><Td>{v.name}</Td><Td className="text-ink-500">{v.contact_email || '—'}</Td></tr>)}</tbody>
      </TableWrap>
    </Modal>
  )
}

function ContractDetail({ contract, items, bal, canEdit, onBack, reload }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showVat, setShowVat] = useState(false)
  const [vat, setVat] = useState({ number: contract.vat_line_number, value: contract.vat_line_value })
  const [excelRows, setExcelRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const exportPdf = async () => {
    setPdfBusy(true); setErr('')
    try {
      const { data: reqs } = await supabase.from('requests')
        .select('*, request_items(*), engineer:profiles!requests_engineer_id_fkey(id, full_name)')
        .eq('contract_id', contract.id).order('submitted_at', { ascending: false })
      const { contractPdf } = await import('../lib/report')
      contractPdf({ contract, balance: bal, items, requests: reqs || [] })
    } catch (ex) { setErr('Could not build the PDF: ' + ex.message) } finally { setPdfBusy(false) }
  }

  const onExcel = async (e) => {
    setErr('')
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      const ws = wb.Sheets[wb.SheetNames[0]]
      let rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      rows = rows.filter(r => r.length && String(r[0]).trim() !== '')
      // skip a header row if the first cell is not a number
      if (rows.length && isNaN(Number(rows[0][0]))) rows = rows.slice(1)
      const parsed = rows.map(r => ({
        line_number: Number(r[0]), description: String(r[1]).trim(),
        part_number: String(r[2]).trim(), unit_price: Number(r[3]),
        device_model: String(r[4] ?? '').trim() || null, taxable: isYes(r[5]),
      }))
      const bad = parsed.find(p => !p.line_number || !p.description || !p.part_number || isNaN(p.unit_price))
      if (bad) throw new Error('Some rows are invalid. Expected columns in order: Line Number, Description, Part Number, Unit Price, Model, VAT (Yes or No). Model and VAT are optional.')
      setExcelRows(parsed)
    } catch (ex) { setErr(ex.message) }
    e.target.value = ''
  }

  // Empty Excel sheet with the columns in the order the upload expects.
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const cols = ['Line Number', 'Description', 'Part Number', 'Unit Price (before VAT)', 'Model', 'VAT (Yes/No)']
    const sheet = XLSX.utils.aoa_to_sheet([cols])
    sheet['!cols'] = [{ wch: 13 }, { wch: 46 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 14 }]
    const help = XLSX.utils.aoa_to_sheet([
      ['How to fill the "Line items" sheet'],
      [],
      ['Column', 'Required', 'What to enter', 'Example'],
      ['Line Number', 'Yes', 'The line number from the contract. Each number once per contract.', 1],
      ['Description', 'Yes', 'Part description as written in the contract.', 'Flow sensor, Infinity ID'],
      ['Part Number', 'Yes', 'Vendor part number.', '8403735'],
      ['Unit Price (before VAT)', 'Yes', 'Price of one unit before VAT, numbers only.', 1450],
      ['Model', 'No', 'Device model the part belongs to. It is filled in automatically on requests.', 'Evita V500'],
      ['VAT (Yes/No)', 'No', 'Yes if VAT applies to the part, No if it does not. Empty counts as No.', 'Yes'],
      [],
      ['Do not add the VAT line here. Its line number and value are set on the contract itself.'],
      [],
      ['Keep the first row (the column titles) and do not change the column order.'],
      ['Start typing from row 2, one part per row. Only the first sheet is read.'],
    ])
    help['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 74 }, { wch: 26 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Line items')
    XLSX.utils.book_append_sheet(wb, help, 'How to fill')
    XLSX.writeFile(wb, 'contract-line-items-template.xlsx')
  }

  const importExcel = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.from('contract_items').insert(excelRows.map(r => ({ ...r, contract_id: contract.id })))
    setBusy(false)
    if (error) return setErr(lineError(error))
    setExcelRows(null); reload()
  }

  const uploadImage = async (item, file) => {
    if (!file) return
    setErr('')
    const path = `${contract.id}/${item.id}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('part-images').upload(path, file, { upsert: true })
    if (error) return setErr(error.message)
    const { error: e2 } = await supabase.from('contract_items').update({ image_path: path }).eq('id', item.id)
    if (e2) return setErr(e2.message)
    reload()
  }

  const total = Number(contract.total_amount)
  const prev = Number(contract.previous_consumed_amount)
  const committed = Number(bal?.approved_spend ?? 0)
  const remaining = Number(bal?.remaining ?? total - prev)
  const share = (n) => total > 0 ? Math.max(0, Math.min(100, n / total * 100)) : 0

  return (
    <div>
      <PageTitle back={<BackLink onClick={onBack}>Contracts</BackLink>}
        subtitle={`${contract.vendors?.name} · PO ${contract.po_number} · ${fmtDate(contract.start_date)} – ${fmtDate(contract.end_date)}`}
        right={<Btn variant="secondary" icon="download" onClick={exportPdf} disabled={pdfBusy}>{pdfBusy ? 'Building PDF…' : 'Export PDF'}</Btn>}>
        {contract.contract_number}
      </PageTitle>
      {err && <Alert>{err}</Alert>}

      <Card className="p-5 mb-6">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          {[['Contract total', total, 'text-ink-900'], ['Previously consumed', prev, 'text-ink-600'],
            ['Committed in requests', committed, 'text-ink-600'], ['Remaining', remaining, remaining <= 0.1 * total ? 'text-brand-600' : 'text-olive-700']].map(([l, v, tone]) => (
            <div key={l}>
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">{l}</dt>
              <dd className={`num text-[22px] font-medium mt-1 ${tone}`}>{money(v)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex h-2 rounded-full overflow-hidden bg-olive-100 mt-5" aria-hidden="true">
          <div className="bg-ink-400" style={{ width: share(prev) + '%' }} />
          <div className="bg-ink-900" style={{ width: share(committed) + '%' }} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-500 mt-2.5">
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-ink-400" />Previously consumed</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-ink-900" />Committed in requests</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-olive-100 border border-olive-500/40" />Remaining</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-ink-100">
          <div className="text-sm">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500 mr-3">VAT line</span>
            {vat.number
              ? <span className="text-ink-900">Line <span className="num">{vat.number}</span> · <span className="num">{money(vat.value)}</span> per unit</span>
              : <span className="text-ink-500">Not set. Requests with taxed parts cannot be submitted until it is.</span>}
          </div>
          {canEdit && <Btn size="sm" variant="secondary" onClick={() => setShowVat(true)}>{vat.number ? 'Edit VAT line' : 'Set VAT line'}</Btn>}
        </div>
      </Card>

      {excelRows && (
        <Card className="mb-6 overflow-hidden border-steel-600/40">
          <SectionHead title="Excel preview" hint={`${excelRows.length} rows read from the file, ${excelRows.filter(r => r.taxable).length} with VAT. Nothing is saved until you import.`}
            right={<div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setExcelRows(null)}>Discard</Btn>
              <Btn onClick={importExcel} disabled={busy}>{busy ? 'Importing…' : `Import ${excelRows.length} line items`}</Btn>
            </div>} />
          <TableWrap>
            <thead><tr><Th>Line</Th><Th>Description</Th><Th>Part number</Th><Th>Model</Th><Th>VAT</Th><Th right>Unit price before VAT</Th></tr></thead>
            <tbody>{excelRows.slice(0, 8).map((r, i) => <tr key={i}><Td className="num">{r.line_number}</Td><Td>{r.description}</Td><Td className="num text-[13px]">{r.part_number}</Td><Td>{r.device_model || <span className="text-ink-300">—</span>}</Td><Td><VatBadge on={r.taxable} /></Td><Td right className="num">{money(r.unit_price)}</Td></tr>)}</tbody>
          </TableWrap>
          {excelRows.length > 8 && <div className="text-[13px] text-ink-500 px-5 py-3">and {excelRows.length - 8} more rows</div>}
        </Card>
      )}

      <Card className="overflow-hidden">
        <SectionHead title={`Line items · ${items.length}`} hint={canEdit ? 'All prices are before VAT. Download the Excel template, fill one part per row, then upload it.' : 'All prices are before VAT.'}
          right={canEdit && <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" icon="download" onClick={downloadTemplate}>Excel template</Btn>
            <label className="inline-flex items-center justify-center gap-2 h-9.5 px-4 rounded-lg text-sm font-medium bg-white hover:bg-ink-50 text-ink-800 border border-ink-300 cursor-pointer transition-colors">
              <Icon name="upload" className="w-4 h-4" />Upload Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onExcel} />
            </label>
            <Btn icon="plus" onClick={() => setShowAdd(true)}>Add line item</Btn>
          </div>} />
        {items.length === 0 ? <Empty icon="box" title="No line items yet" hint="Download the Excel template, fill it and upload it, or add line items one by one." /> : (
          <TableWrap>
            <thead><tr><Th className="w-16">Line</Th><Th className="w-16">Image</Th><Th>Description</Th><Th>Part number</Th><Th>Model</Th><Th>VAT</Th><Th right>Unit price before VAT</Th>{canEdit && <Th></Th>}</tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <Td className="num text-ink-500">{it.line_number}</Td>
                  <Td>
                    {it.image_path
                      ? <img src={imgUrl(it.image_path)} alt="" className="w-10 h-10 rounded-md object-cover border border-ink-200" />
                      : <div className="w-10 h-10 rounded-md bg-ink-100 flex items-center justify-center text-ink-300"><Icon name="image" className="w-4 h-4" /></div>}
                  </Td>
                  <Td className="max-w-[360px] text-ink-900">{it.description}</Td>
                  <Td className="num text-[13px]">{it.part_number}</Td>
                  <Td>{it.device_model || <span className="text-ink-300">—</span>}</Td>
                  <Td><VatBadge on={it.taxable} /></Td>
                  <Td right className="num text-ink-900">{money(it.unit_price)}</Td>
                  {canEdit && (
                    <Td right>
                      <button onClick={() => setEditItem(it)} className="text-[13px] font-medium text-brand-700 hover:underline whitespace-nowrap mr-4">Edit</button>
                      <label className="text-[13px] font-medium text-brand-700 hover:underline cursor-pointer whitespace-nowrap">
                        {it.image_path ? 'Replace image' : 'Add image'}
                        <input type="file" accept="image/*" className="sr-only" onChange={e => uploadImage(it, e.target.files?.[0])} />
                      </label>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <VatLineModal open={showVat} contract={contract} vat={vat} onClose={() => setShowVat(false)}
        onSaved={(v) => { setVat(v); contract.vat_line_number = v.number; contract.vat_line_value = v.value; setShowVat(false) }} />
      <ItemModal open={showAdd || !!editItem} item={editItem} contract={contract}
        onClose={() => { setShowAdd(false); setEditItem(null) }} onSaved={() => { setShowAdd(false); setEditItem(null); reload() }} />
    </div>
  )
}

function VatLineModal({ open, onClose, contract, vat, onSaved }) {
  const [f, setF] = useState({ number: '', value: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setErr(''); setF({ number: vat.number ?? '', value: vat.value ?? '' }) } }, [open, vat])
  const both = f.number !== '' && f.value !== '' && Number(f.value) > 0
  const none = f.number === '' && f.value === ''
  const save = async () => {
    setErr(''); setBusy(true)
    const v = none ? { number: null, value: null } : { number: Number(f.number), value: Number(f.value) }
    const { error } = await supabase.from('contracts').update({ vat_line_number: v.number, vat_line_value: v.value }).eq('id', contract.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(v)
  }
  return (
    <Modal open={open} onClose={onClose} title="VAT line">
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-ink-600 mb-4">VAT is released against its own contract line. On each request the system adds this line with a quantity equal to the VAT due (15% of the taxed parts) divided by the line value.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="VAT line number" type="number" min="1" value={f.number} onChange={e => setF(x => ({ ...x, number: e.target.value }))} />
        <Input label="VAT line value" type="number" min="0" step="0.01" value={f.value} onChange={e => setF(x => ({ ...x, value: e.target.value }))} />
      </div>
      {both && <p className="num text-[12px] text-ink-500 mt-3">Example: VAT due 50.00 gives quantity {String(Number((50 / Number(f.value)).toFixed(4)))}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !(both || none)}>Save VAT line</Btn>
      </div>
    </Modal>
  )
}

function ItemModal({ open, onClose, contract, onSaved, item }) {
  const empty = { line_number: '', description: '', part_number: '', unit_price: '', device_model: '', taxable: false }
  const [f, setF] = useState(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  useEffect(() => {
    if (!open) return
    setErr('')
    setF(item ? { line_number: item.line_number, description: item.description, part_number: item.part_number,
      unit_price: item.unit_price, device_model: item.device_model || '', taxable: !!item.taxable } : empty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])
  const save = async () => {
    setErr(''); setBusy(true)
    const row = {
      line_number: Number(f.line_number), description: String(f.description).trim(), part_number: String(f.part_number).trim(),
      unit_price: Number(f.unit_price), device_model: f.device_model.trim() || null, taxable: f.taxable,
    }
    const { error } = item
      ? await supabase.from('contract_items').update(row).eq('id', item.id)
      : await supabase.from('contract_items').insert({ ...row, contract_id: contract.id })
    setBusy(false)
    if (error) return setErr(lineError(error))
    onSaved()
  }
  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit line item' : 'Add line item'}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Line number" type="number" value={f.line_number} onChange={set('line_number')} />
        <Input label="Part number" value={f.part_number} onChange={set('part_number')} />
        <div className="sm:col-span-2"><Input label="Description" value={f.description} onChange={set('description')} /></div>
        <Input label="Model" value={f.device_model} onChange={set('device_model')} placeholder="ASTRAL 150" />
        <Input label="Unit price before VAT" type="number" min="0" step="0.01" value={f.unit_price} onChange={set('unit_price')} />
        <label className={`sm:col-span-2 flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${f.taxable ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-400'}`}>
          <input type="checkbox" checked={f.taxable} onChange={e => setF(x => ({ ...x, taxable: e.target.checked }))} className="w-4 h-4 accent-brand-600" />
          <span>
            <span className="block text-sm font-medium text-ink-900">VAT applies to this part</span>
            <span className="block text-[12px] text-ink-500">Leave unticked for parts that are not taxed.</span>
          </span>
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.line_number || !f.description || !f.part_number || f.unit_price === ''}>{item ? 'Save changes' : 'Add line item'}</Btn>
      </div>
    </Modal>
  )
}
