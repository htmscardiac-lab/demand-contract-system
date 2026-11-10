import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card, Badge, Spinner, Empty, PageTitle, TableWrap, Th, Td } from '../ui.jsx'
import { money, fmtDateTime, fmtDate } from '../lib/helpers'
import { RequestDetail, REQUEST_QUERY } from './Requests.jsx'
import { usePoll } from '../lib/poll.js'

export default function ClinicalQueue() {
  const [reqs, setReqs] = useState(null)
  const [sel, setSel] = useState(null)
  const [tab, setTab] = useState('queue')

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select(REQUEST_QUERY)
      .in('status', tab === 'queue' ? ['pending_clinical'] : ['in_process'])
      .order('submitted_at')
    setReqs(data || [])
  }, [tab])
  usePoll(load, 8000, [load])

  return (
    <div>
      <PageTitle>Clinical engineer — procurement</PageTitle>
      <div className="flex gap-1.5 mb-4">
        <button onClick={() => setTab('queue')} className={`px-3 py-1.5 rounded-full text-sm ${tab === 'queue' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Awaiting completion</button>
        <button onClick={() => setTab('process')} className={`px-3 py-1.5 rounded-full text-sm ${tab === 'process' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>In process</button>
      </div>
      {!reqs ? <Spinner /> : reqs.length === 0 ? <Card className="p-6"><Empty text={tab === 'queue' ? 'No requests awaiting procurement.' : 'Nothing in process.'} /></Card> : (
        <Card className="p-2 sm:p-4">
          <TableWrap>
            <thead><tr><Th>Request</Th><Th>Engineer</Th><Th>Supervisor</Th><Th>Contract / PO</Th><Th>Items</Th><Th>Total</Th>{tab === 'process' && <Th>Release / Promise</Th>}<Th>Since</Th></tr></thead>
            <tbody>
              {reqs.map(r => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(r)}>
                  <Td className="font-medium text-blue-700">{r.request_number}</Td>
                  <Td>{r.engineer?.full_name}</Td>
                  <Td>{r.supervisor?.full_name}</Td>
                  <Td>{r.contracts?.contract_number}<div className="text-xs text-slate-400">PO {r.contracts?.po_number}</div></Td>
                  <Td>{r.request_items.length}</Td>
                  <Td>{money(r.request_items.reduce((s, i) => s + i.unit_price * i.quantity, 0))}</Td>
                  {tab === 'process' && <Td className="text-xs">{r.release_number}<div className="text-slate-400">{fmtDate(r.promise_date)}</div></Td>}
                  <Td className="text-slate-500">{fmtDateTime(r.submitted_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {sel && <RequestDetail request={sel} onClose={() => { setSel(null); load() }} />}
    </div>
  )
}
