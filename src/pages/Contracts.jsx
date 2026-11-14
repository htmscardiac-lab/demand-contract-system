import React, { useEffect, useState, useCallback } from 'react'
import { supabase, imgUrl } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, SectionHead, Btn, Input, Badge, Modal, Spinner, Empty, PageTitle, BackLink, Alert, TableWrap, Th, Td, Row, SearchInput, Meter, Icon } from '../ui.jsx'
import { money, fmtDate } from '../lib/helpers'

export default function Contracts() {
  const { profile, settings } = useApp()
  const canEdit = profile.role === 'admin' || profile.role === 'supervisor'
  const [contracts, setContracts] = useState(null)
  const [bals, setBals] = useState({})
  const [vendors, setVendors] = useState([])
  const [sel, setSel] = useState(null)
  const [items, setItems] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('created')
  const [sortDir, setSortDir] = useState('desc')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    const [{ data: c }, { data: b }, { data: v }] = await Promise.all([
      supabase.from('contracts').select('*, vendors(id, name, contact_email)').order('created_at', { ascending: false }),
      supabase.from('contract_balances').select('*'),
      supabase.from('vendors').select('id, name, vendor_contacts(id, name, email, phone)').order('name'),
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
    try {
      const [{ loadReportData, overviewReport }, { exportReportPdf }] = await Promise.all([import('../lib/reportData'), import('../lib/reportExport')])
      await exportReportPdf(overviewReport(await loadReportData(), {}), { by: profile.full_name, department: settings.department_name })
    } catch (ex) { setErr('Could not build the PDF: ' + ex.message) }
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
          {canEdit && <Btn variant="secondary" icon="upload" onClick={() => setShowImport(true)}>Import from Excel</Btn>}
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
      <ImportContractsModal open={showImport} onClose={() => { setShowImport(false); load() }} vendors={vendors} profile={profile} />
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
  const empty = { contract_number: '', po_number: '', vendor_name: '', contact_name: '', contact_email: '', contact_phone: '', total_amount: '', previous_consumed_amount: '0', start_date: '', end_date: '', vat_line_number: '', vat_line_value: '' }
  const [f, setF] = useState(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const existing = vendors.find(v => v.name.trim().toLowerCase() === f.vendor_name.trim().toLowerCase())
  // a new vendor needs one contact: a name plus an email or a mobile number
  const hasContact = f.contact_name.trim() !== '' && (f.contact_email.trim() !== '' || f.contact_phone.trim() !== '')
  const contactBlank = !f.contact_name.trim() && !f.contact_email.trim() && !f.contact_phone.trim()
  const contactOk = existing ? (contactBlank || hasContact) : hasContact
  const save = async () => {
    setErr(''); setBusy(true)
    try {
      let vendorId = existing?.id
      if (!vendorId) {
        const { data, error } = await supabase.from('vendors').insert({ name: f.vendor_name.trim() }).select('id').single()
        if (error) throw error
        vendorId = data.id
      }
      if (f.contact_name.trim()) {
        const { error } = await supabase.from('vendor_contacts').insert({
          vendor_id: vendorId, name: f.contact_name.trim(), email: f.contact_email.trim() || null, phone: f.contact_phone.trim() || null })
        if (error) throw error
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
        <div className="sm:col-span-2 rounded-lg border border-ink-200 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label="Vendor" list="vendor-list" value={f.vendor_name} onChange={set('vendor_name')}
                placeholder="Start typing a vendor name" autoComplete="off" />
              <datalist id="vendor-list">
                {vendors.map(v => <option key={v.id} value={v.name} />)}
              </datalist>
              {f.vendor_name.trim() !== '' && (existing
                ? <p className="text-[12px] text-olive-700 mt-1.5">Already in the vendor directory with {existing.vendor_contacts?.length || 0} contact{existing.vendor_contacts?.length === 1 ? '' : 's'}. Fill the fields below only to add another contact.</p>
                : <p className="text-[12px] text-steel-700 mt-1.5">New vendor. It is added to the vendor directory with this contact when you save.</p>)}
            </div>
            <div className="sm:col-span-2"><Input label={existing ? 'Contact name (optional)' : 'Contact name'} value={f.contact_name} onChange={set('contact_name')} /></div>
            <Input label="Contact email" type="email" value={f.contact_email} onChange={set('contact_email')} />
            <Input label="Contact mobile" type="tel" value={f.contact_phone} onChange={set('contact_phone')} />
          </div>
        </div>
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
        <Btn onClick={save} disabled={busy || !f.contract_number || !f.po_number || !f.vendor_name.trim() || !contactOk || !f.total_amount || !f.start_date || !f.end_date || (f.vat_line_number === '') !== (f.vat_line_value === '')}>
          {busy ? 'Saving…' : 'Save contract'}
        </Btn>
      </div>
    </Modal>
  )
}

const CONTRACT_COLS = ['Contract Number', 'PO Number', 'Vendor Name', 'Contact Name', 'Contact Email', 'Contact Mobile',
  'Total Amount', 'Previously Consumed', 'Start Date', 'End Date', 'VAT Line Number', 'VAT Line Value']

// Excel date cell (serial number) or text (2026-01-31, 31/01/2026, 31-01-2026) to yyyy-mm-dd; '' when unreadable.
function toIsoDate(v) {
  if (v === '' || v == null) return ''
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10)
  const t = String(v).trim()
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

function ImportContractsModal({ open, onClose, vendors, profile }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  useEffect(() => { if (open) { setRows(null); setErr(''); setDone(null) } }, [open])

  const template = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([CONTRACT_COLS])
    sheet['!cols'] = CONTRACT_COLS.map(c => ({ wch: Math.max(16, c.length + 4) }))
    const help = XLSX.utils.aoa_to_sheet([
      ['How to fill the "Contracts" sheet'], [],
      ['Column', 'Required', 'What to enter', 'Example'],
      ['Contract Number', 'Yes', 'Each contract number once.', 'DC-2026-0114'],
      ['PO Number', 'Yes', 'Purchase order number of the contract.', '448120'],
      ['Vendor Name', 'Yes', 'A vendor that is not in the directory yet is added automatically.', 'Draeger Arabia'],
      ['Contact Name', 'For a new vendor', 'Person to contact at the vendor. Added to the vendor directory.', 'Eng. Ahmed Ali'],
      ['Contact Email', 'Email or mobile', 'The release email is sent to this address.', 'ahmed@vendor.com'],
      ['Contact Mobile', 'Email or mobile', 'Mobile number of the contact.', '0500000000'],
      ['Total Amount', 'Yes', 'Total contract value, numbers only.', 850000],
      ['Previously Consumed', 'No', 'Amount already spent before the contract was added here. Empty counts as 0.', 120000],
      ['Start Date', 'Yes', 'A date cell, or text as YYYY-MM-DD or DD/MM/YYYY.', '2026-01-01'],
      ['End Date', 'Yes', 'A date cell, or text as YYYY-MM-DD or DD/MM/YYYY.', '2026-12-31'],
      ['VAT Line Number', 'No', 'Number of the contract line VAT is released against. Fill together with VAT Line Value.', 25],
      ['VAT Line Value', 'No', 'Value of one unit of the VAT line.', 100],
      [], ['Keep the first row (the column titles). One contract per row, starting from row 2. Only the first sheet is read.'],
      ['Line items are uploaded afterwards, inside each contract.'],
    ])
    help['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 84 }, { wch: 22 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Contracts')
    XLSX.utils.book_append_sheet(wb, help, 'How to fill')
    XLSX.writeFile(wb, 'contracts-template.xlsx')
  }

  const onFile = async (e) => {
    setErr(''); setDone(null)
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      let raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      raw = raw.filter(r => r.some(c => String(c).trim() !== ''))
      if (raw.length < 2) throw new Error('The sheet has no contracts. Fill at least one row under the column titles.')
      const head = raw[0].map(h => String(h).toLowerCase())
      const find = (re) => head.findIndex(h => re.test(h))
      const col = {
        number: find(/contract/), po: find(/p\.?\s?o\b|purchase/), vendor: find(/vendor/), cname: find(/contact.*name/),
        email: find(/mail/), phone: find(/mobile|phone/), total: find(/total/), prev: find(/prev|consumed/),
        start: find(/\bstart\b/), end: find(/\bend\b/), vatNo: find(/vat.*(number|no)/), vatVal: find(/vat.*value/),
      }
      const missing = Object.entries({ 'Contract Number': col.number, 'PO Number': col.po, 'Vendor Name': col.vendor, 'Total Amount': col.total, 'Start Date': col.start, 'End Date': col.end })
        .filter(([, i]) => i < 0).map(([n]) => n)
      if (missing.length) throw new Error(`Column${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}. Use the Excel template.`)
      const cell = (r, i) => (i >= 0 ? r[i] ?? '' : '')
      const text = (r, i) => String(cell(r, i)).trim()
      const known = new Set(vendors.map(v => v.name.trim().toLowerCase()))
      const seen = new Set()
      setRows(raw.slice(1).map((r, i) => {
        const x = {
          row: i + 2, contract_number: text(r, col.number), po_number: text(r, col.po), vendor_name: text(r, col.vendor),
          contact_name: text(r, col.cname), contact_email: text(r, col.email), contact_phone: text(r, col.phone),
          total_amount: Number(cell(r, col.total)), previous: Number(cell(r, col.prev) || 0),
          start_date: toIsoDate(cell(r, col.start)), end_date: toIsoDate(cell(r, col.end)),
          vat_no: text(r, col.vatNo), vat_val: text(r, col.vatVal),
        }
        const problems = []
        if (!x.contract_number) problems.push('contract number missing')
        else if (seen.has(x.contract_number.toLowerCase())) problems.push('contract number repeated in the file')
        seen.add(x.contract_number.toLowerCase())
        if (!x.po_number) problems.push('PO number missing')
        if (!x.vendor_name) problems.push('vendor name missing')
        if (!(x.total_amount > 0)) problems.push('total amount not valid')
        if (isNaN(x.previous) || x.previous < 0) problems.push('previously consumed not valid')
        if (!x.start_date) problems.push('start date not readable')
        if (!x.end_date) problems.push('end date not readable')
        if ((x.vat_no === '') !== (x.vat_val === '')) problems.push('fill both VAT line number and value, or neither')
        else if (x.vat_no !== '' && !(Number(x.vat_no) > 0 && Number(x.vat_val) > 0)) problems.push('VAT line not valid')
        const newVendor = x.vendor_name && !known.has(x.vendor_name.toLowerCase())
        const hasContact = x.contact_name && (x.contact_email || x.contact_phone)
        if (newVendor && !hasContact) problems.push('new vendor needs a contact name with an email or mobile')
        if (!x.contact_name && (x.contact_email || x.contact_phone)) problems.push('contact name missing')
        return { ...x, newVendor, problems }
      }))
    } catch (ex) { setErr(ex.message); setRows(null) }
  }

  const run = async () => {
    setBusy(true); setErr('')
    const ids = Object.fromEntries(vendors.map(v => [v.name.trim().toLowerCase(), v.id]))
    const contacts = Object.fromEntries(vendors.map(v => [v.id, (v.vendor_contacts || []).map(c => `${c.name}|${c.email || ''}`.toLowerCase())]))
    const failed = []; let ok = 0
    for (const x of rows.filter(r => r.problems.length === 0)) {
      try {
        const key = x.vendor_name.toLowerCase()
        if (!ids[key]) {
          const { data, error } = await supabase.from('vendors').insert({ name: x.vendor_name }).select('id').single()
          if (error) throw error
          ids[key] = data.id; contacts[data.id] = []
        }
        const ckey = `${x.contact_name}|${x.contact_email}`.toLowerCase()
        if (x.contact_name && !contacts[ids[key]].includes(ckey)) {
          const { error } = await supabase.from('vendor_contacts').insert({ vendor_id: ids[key], name: x.contact_name, email: x.contact_email || null, phone: x.contact_phone || null })
          if (error) throw error
          contacts[ids[key]].push(ckey)
        }
        const { error } = await supabase.from('contracts').insert({
          contract_number: x.contract_number, po_number: x.po_number, vendor_id: ids[key], total_amount: x.total_amount,
          previous_consumed_amount: x.previous, start_date: x.start_date, end_date: x.end_date, created_by: profile.id,
          vat_line_number: x.vat_no === '' ? null : Number(x.vat_no), vat_line_value: x.vat_val === '' ? null : Number(x.vat_val),
        })
        if (error) throw error
        ok++
      } catch (ex) {
        failed.push({ row: x.row, number: x.contract_number, reason: /duplicate|unique/i.test(ex.message) ? 'a contract with this number already exists' : ex.message })
      }
    }
    setBusy(false); setDone({ ok, failed }); setRows(null)
  }

  const good = rows ? rows.filter(r => r.problems.length === 0).length : 0
  return (
    <Modal open={open} onClose={onClose} title="Import contracts from Excel" wide>
      {err && <Alert>{err}</Alert>}
      {done && (<>
        <Alert kind={done.ok ? 'ok' : 'warn'}>{done.ok} contract{done.ok === 1 ? '' : 's'} imported{done.failed.length ? `, ${done.failed.length} not imported` : ''}.</Alert>
        {done.failed.length > 0 && (
          <ul className="text-[13px] text-ink-700 space-y-1 mb-4">
            {done.failed.map(f => <li key={f.row}>Row <span className="num">{f.row}</span> · <span className="num">{f.number}</span>: {f.reason}</li>)}
          </ul>
        )}
      </>)}
      {!rows && (
        <ol className="space-y-3">
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-4 py-3">
            <span className="text-sm text-ink-800"><span className="num text-ink-500 mr-2">1</span>Download the template and fill one contract per row.</span>
            <Btn variant="secondary" icon="download" onClick={template}>Excel template</Btn>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-4 py-3">
            <span className="text-sm text-ink-800"><span className="num text-ink-500 mr-2">2</span>Upload the filled file. You review it before anything is saved.</span>
            <label className="inline-flex items-center justify-center gap-2 h-9.5 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white cursor-pointer transition-colors">
              <Icon name="upload" className="w-4 h-4" />Choose file
              <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onFile} />
            </label>
          </li>
        </ol>
      )}
      {rows && (<>
        <p className="text-sm text-ink-600 mb-3">{good} of {rows.length} row{rows.length === 1 ? '' : 's'} ready to import.{good < rows.length ? ' Rows with a problem are skipped.' : ''}</p>
        <TableWrap className="rounded-lg border border-ink-200 max-h-[46vh] overflow-y-auto">
          <thead><tr><Th>Row</Th><Th>Contract</Th><Th>Vendor</Th><Th right>Total</Th><Th>Period</Th><Th>VAT line</Th><Th>Check</Th></tr></thead>
          <tbody>
            {rows.map(x => (
              <tr key={x.row} className={x.problems.length ? 'bg-brand-50/60' : ''}>
                <Td className="num text-ink-500">{x.row}</Td>
                <Td className="whitespace-nowrap"><div className="font-medium text-ink-900">{x.contract_number || '—'}</div><div className="num text-[12px] text-ink-500">PO {x.po_number || '—'}</div></Td>
                <Td className="whitespace-nowrap"><div>{x.vendor_name || '—'}</div>{x.newVendor && <div className="text-[12px] text-steel-700">New vendor</div>}{x.contact_name && <div className="text-[12px] text-ink-500">{x.contact_name}</div>}</Td>
                <Td right className="num">{x.total_amount > 0 ? money(x.total_amount) : '—'}</Td>
                <Td className="text-[13px] whitespace-nowrap">{x.start_date ? fmtDate(x.start_date) : '—'} – {x.end_date ? fmtDate(x.end_date) : '—'}</Td>
                <Td className="num text-[13px] whitespace-nowrap">{x.vat_no !== '' ? `${x.vat_no} · ${money(x.vat_val)}` : <span className="text-ink-300">—</span>}</Td>
                <Td className="text-[13px] min-w-[240px]">{x.problems.length ? <span className="text-brand-700">{x.problems.join('; ')}</span> : <Badge className="bg-olive-100 text-olive-700">Ready</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="flex justify-end gap-2 mt-6">
          <Btn variant="secondary" onClick={() => setRows(null)}>Choose another file</Btn>
          <Btn onClick={run} disabled={busy || good === 0}>{busy ? 'Importing…' : `Import ${good} contract${good === 1 ? '' : 's'}`}</Btn>
        </div>
      </>)}
    </Modal>
  )
}

function ContractDetail({ contract, items, bal, canEdit, onBack, reload }) {
  const { profile, settings } = useApp()
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
      const [{ loadReportData, contractReport }, { exportReportPdf }] = await Promise.all([import('../lib/reportData'), import('../lib/reportExport')])
      await exportReportPdf(contractReport(await loadReportData(), {}, contract.id), { by: profile.full_name, department: settings.department_name })
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
      // With a title row, columns are found by their titles, so their order does not matter.
      let col = { line: 0, desc: 1, part: 2, price: 3, model: 4, equip: 5, vat: 6 }
      if (rows.length && isNaN(Number(rows[0][0]))) {
        const head = rows[0].map(h => String(h).toLowerCase())
        const find = (re) => head.findIndex(h => re.test(h))
        col = { line: find(/line/), part: find(/part/), price: find(/price/), model: find(/model/), equip: find(/equip/), vat: find(/vat|tax/),
          desc: head.findIndex(h => /desc/.test(h) && !/equip/.test(h)) }
        rows = rows.slice(1)
      } else if (rows.length && rows.every(r => r.length <= 6)) {
        col = { ...col, equip: -1, vat: 5 }   // sheet without titles in the earlier six-column layout
      }
      const cell = (r, i) => (i >= 0 ? r[i] ?? '' : '')
      const parsed = rows.map(r => ({
        line_number: Number(cell(r, col.line)), description: String(cell(r, col.desc)).trim(),
        part_number: String(cell(r, col.part)).trim(), unit_price: Number(cell(r, col.price)),
        device_model: String(cell(r, col.model)).trim() || null,
        equipment_description: String(cell(r, col.equip)).trim() || null, taxable: isYes(cell(r, col.vat)),
      }))
      const bad = parsed.findIndex((p, i) => !p.line_number || !p.description || !p.part_number || isNaN(p.unit_price) || String(cell(rows[i], col.price)).trim() === '')
      if (bad >= 0) throw new Error(`Row ${bad + 2} is not valid. Each row needs a line number, description, part number and unit price. Download the Excel template to see the expected columns.`)
      setExcelRows(parsed)
    } catch (ex) { setErr(ex.message) }
    e.target.value = ''
  }

  // Empty Excel sheet with the columns in the order the upload expects.
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const cols = ['Line Number', 'Description', 'Part Number', 'Unit Price (before VAT)', 'Model', 'Equipment Description', 'VAT (Yes/No)']
    const sheet = XLSX.utils.aoa_to_sheet([cols])
    sheet['!cols'] = [{ wch: 13 }, { wch: 46 }, { wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 30 }, { wch: 14 }]
    const help = XLSX.utils.aoa_to_sheet([
      ['How to fill the "Line items" sheet'],
      [],
      ['Column', 'Required', 'What to enter', 'Example'],
      ['Line Number', 'Yes', 'The line number from the contract. Each number once per contract.', 1],
      ['Description', 'Yes', 'Part description as written in the contract.', 'Flow sensor, Infinity ID'],
      ['Part Number', 'Yes', 'Vendor part number.', '8403735'],
      ['Unit Price (before VAT)', 'Yes', 'Price of one unit before VAT, numbers only.', 1450],
      ['Model', 'No', 'Device model the part belongs to. It is filled in automatically on requests.', 'Evita V500'],
      ['Equipment Description', 'No', 'Equipment the model belongs to. It is filled in automatically on requests and in the release email.', 'Ventilator, ICU'],
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
            <thead><tr><Th>Line</Th><Th>Description</Th><Th>Part number</Th><Th>Model and equipment</Th><Th>VAT</Th><Th right>Unit price before VAT</Th></tr></thead>
            <tbody>{excelRows.slice(0, 8).map((r, i) => <tr key={i}><Td className="num">{r.line_number}</Td><Td>{r.description}</Td><Td className="num text-[13px]">{r.part_number}</Td><Td>{r.device_model || <span className="text-ink-300">—</span>}{r.equipment_description && <div className="text-[12px] text-ink-500">{r.equipment_description}</div>}</Td><Td><VatBadge on={r.taxable} /></Td><Td right className="num">{money(r.unit_price)}</Td></tr>)}</tbody>
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
            <thead><tr><Th className="w-16">Line</Th><Th className="w-16">Image</Th><Th>Description</Th><Th>Part number</Th><Th>Model and equipment</Th><Th>VAT</Th><Th right>Unit price before VAT</Th>{canEdit && <Th></Th>}</tr></thead>
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
                  <Td>{it.device_model || <span className="text-ink-300">—</span>}{it.equipment_description && <div className="text-[12px] text-ink-500 mt-0.5">{it.equipment_description}</div>}</Td>
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
  const empty = { line_number: '', description: '', part_number: '', unit_price: '', device_model: '', equipment_description: '', taxable: false }
  const [f, setF] = useState(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  useEffect(() => {
    if (!open) return
    setErr('')
    setF(item ? { line_number: item.line_number, description: item.description, part_number: item.part_number,
      unit_price: item.unit_price, device_model: item.device_model || '', equipment_description: item.equipment_description || '', taxable: !!item.taxable } : empty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])
  const save = async () => {
    setErr(''); setBusy(true)
    const row = {
      line_number: Number(f.line_number), description: String(f.description).trim(), part_number: String(f.part_number).trim(),
      unit_price: Number(f.unit_price), device_model: f.device_model.trim() || null,
      equipment_description: f.equipment_description.trim() || null, taxable: f.taxable,
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
        <Input label="Equipment description" value={f.equipment_description} onChange={set('equipment_description')} placeholder="Ventilators, Sub-Acute" />
        <div className="sm:col-span-2"><Input label="Unit price before VAT" type="number" min="0" step="0.01" value={f.unit_price} onChange={set('unit_price')} /></div>
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
