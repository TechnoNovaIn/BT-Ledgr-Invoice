import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getInvoiceStats } from '../services/api'
import { Badge, Spinner, Empty, fmtDate, fmtAmount } from '../components/ui/index'

export default function DashboardPage() {
  const nav = useNavigate()
  const { data: stats, isLoading } = useQuery({
    queryKey: ['invoice-stats'],
    queryFn: getInvoiceStats,
  })

  const total     = stats?.total ?? 0
  const validated = stats?.validated ?? 0
  const mismatches = stats?.mismatches ?? 0
  const pending   = stats?.pending ?? 0
  const confirmed = stats?.confirmed ?? 0
  const totalValue = stats?.totalValue ?? 0
  const recent    = stats?.recent ?? []

  return (
    <>
      <div className="top-bar">
        <div>
          <div className="top-bar-title">Dashboard</div>
          <div className="top-bar-sub">Overview of all extracted invoices</div>
        </div>
        <div className="top-bar-spacer" />
        <button className="btn btn-primary" onClick={() => nav('/upload')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Upload Invoices
        </button>
      </div>

      <div className="page-body">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Invoices</div>
            <div className="stat-value">{total}</div>
            <div className="stat-sub">All time</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Value</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{fmtAmount(totalValue)}</div>
            <div className="stat-sub">Grand totals sum</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Validated</div>
            <div className="stat-value green">{validated}</div>
            <div className="stat-sub">Checks passed</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Mismatches</div>
            <div className="stat-value amber">{mismatches}</div>
            <div className="stat-sub">Need review</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Confirmed</div>
            <div className="stat-value">{confirmed}</div>
            <div className="stat-sub">User reviewed</div>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="section-header" style={{ padding: '16px 20px 12px' }}>
            <div className="section-title">Recent Invoices</div>
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/invoices')}>View all</button>
          </div>
          {isLoading ? (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>
          ) : recent.length === 0 ? (
            <Empty title="No invoices yet" sub="Upload PDFs to get started" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Vendor</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(inv => (
                    <tr key={inv.id} onClick={() => nav(`/invoices/${inv.id}`)}>
                      <td className="primary mono">{inv.invoiceNumber || '—'}</td>
                      <td>{inv.vendorName || '—'}</td>
                      <td>{fmtDate(inv.invoiceDate)}</td>
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
