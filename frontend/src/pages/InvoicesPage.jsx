import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listInvoices } from '../services/api'
import { Badge, Spinner, Empty, fmtDate, fmtAmount } from '../components/ui/index'

const STATUSES = ['', 'PENDING', 'VALIDATED', 'MISMATCH', 'CONFIRMED']

export default function InvoicesPage() {
  const nav = useNavigate()
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data: invoicesRaw = [], isLoading } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: () => listInvoices({ limit: 10000, ...(statusFilter ? { status: statusFilter } : {}) }),
  })

  const invoices = invoicesRaw.filter(inv => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      inv.invoiceNumber?.toLowerCase().includes(q) ||
      inv.vendorName?.toLowerCase().includes(q) ||
      inv.vendorGSTIN?.toLowerCase().includes(q)
    )
  })

  return (
    <>
      <div className="top-bar">
        <div>
          <div className="top-bar-title">Invoices</div>
          <div className="top-bar-sub">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="top-bar-spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => nav('/upload')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Upload
        </button>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input
            className="form-input"
            placeholder="Search invoice #, vendor, GSTIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <select
            className="form-input"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ maxWidth: 160 }}
          >
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
          </select>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {isLoading ? (
            <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}><Spinner /></div>
          ) : invoices.length === 0 ? (
            <Empty title="No invoices found" sub="Try adjusting your filters or upload new invoices" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Vendor</th>
                    <th>GSTIN</th>
                    <th>Date</th>
                    <th>Taxable</th>
                    <th>Grand Total</th>
                    <th>Status</th>
                    <th>Extracted via</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} onClick={() => nav(`/invoices/${inv.id}`)}>
                      <td className="primary mono">{inv.invoiceNumber || '—'}</td>
                      <td className="primary">{inv.vendorName || '—'}</td>
                      <td className="mono">{inv.vendorGSTIN || '—'}</td>
                      <td>{fmtDate(inv.invoiceDate)}</td>
                      <td>{fmtAmount(inv.totalTaxable)}</td>
                      <td className="primary">{fmtAmount(inv.grandTotal)}</td>
                      <td><Badge status={inv.invoiceStatus} /></td>
                      <td><Badge status={inv.extractionMethod} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
