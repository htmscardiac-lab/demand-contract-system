import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card, Badge, Spinner, Empty, PageTitle, TableWrap, Th, Td } from '../ui.jsx'
import { money, fmtDateTime, STATUS_STYLE } from '../lib/helpers'
import { RequestDetail, REQUEST_QUERY } from './Requests.jsx'
import { usePoll } from '../lib/poll.js'

export default function Approvals() {
  const [reqs, setReqs] = useState(null)
  const [sel, setSel] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select(REQUEST_QUERY)
      .eq('status', 'pending').order('submitted_at')
    setReqs(data || [])
  }, [])
  usePoll(load, 8000, [load])

  if (!reqs) return <Spinner />
  return (
    <div>
      <PageTitle>Pending approvals</PageTitle>
      {reqs.length === 0 ? <Card className="p-6"><Empty text="Nothing waiting for approval. 🎉" /></Card> : (
        <Card className="p-2 sm:p-4">
          <TableWrap>
            <thead><tr><Th>Request</Th><Th>Engineer</Th><Th>Contract</Th><Th>Items</Th><Th>Total</Th><Th>Submitted</Th></tr></thead>
            <tbody>
              {reqs.map(r => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(r)}>
                  <Td className="font-medium text-blue-700">{r.request_number}</Td>
                  <Td>{r.engineer?.full_name}</Td>
                  <Td>{r.contracts?.contract_number}</Td>
                  <Td>{r.request_items.length}</Td>
                  <Td>{money(r.request_items.reduce((s, i) => s + i.unit_price * i.quantity, 0))}</Td>
                  <Td className="text-slate-500">{fmtDateTime(r.submitted_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {sel && <RequestDetail request={sel} decideMode onClose={() => { setSel(null); load() }} />}
    </div>
  )
}
