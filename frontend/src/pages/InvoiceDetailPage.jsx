import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getInvoice, updateInvoice, confirmInvoice, deleteInvoice, getValidationResult } from '../services/api'
import { Badge, Spinner, Empty, fmtDate, fmtAmount } from '../components/ui/index'
import { useToast } from '../components/ui/Toast'

function CheckRow({ label, passed, detail, detail2 }) {
  return (
    <div className="check-row">
      <span className={passed === true ? 'check-icon-pass' : passed === false ? 'check-icon-fail' : 'check-icon-skip'}>
        {passed === true
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
          : passed === false
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        }
      </span>
      <span className="check-label">{label}</span>
      {detail && <span className="check-detail">{detail}</span>}
      {detail2 && <span className="check-detail" style={{ color: 'var(--text-2)' }}>→ {detail2}</span>}
    </div>
  )
}

function FilePreview({ fileUrl, fileName }) {
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const isPdf = fileName?.toLowerCase().endsWith('.pdf')

  useEffect(() => {
    setError(false)
    setLoading(true)
    if (!isPdf) {
      const timer = setTimeout(() => setLoading(false), 300)
      return () => clearTimeout(timer)
    }
  }, [fileUrl, isPdf])

  if (!fileUrl) return null

  if (error) {
    return (
      <div className="compare-preview-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>Failed to load file</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setError(false)}>Retry</button>
      </div>
    )
  }

  return (
    <div className="compare-preview-body">
      {loading && (
        <div style={{ position: 'absolute', padding: 40 }}><Spinner /></div>
      )}
      {isPdf ? (
        <embed
          src={fileUrl}
          type="application/pdf"
          title={fileName}
          style={{ display: loading ? 'none' : undefined }}
          onLoad={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false) }}
        />
      ) : (
        <img
          src={fileUrl}
          alt={fileName}
          style={{ display: loading ? 'none' : undefined }}
          onLoad={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false) }}
        />
      )}
    </div>
  )
}

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState(null)
  const [showPreview, setShowPreview] = useState(true)

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoice(id),
  })

  useEffect(() => {
    if (invoice && !editing) setEditData(invoice)
  }, [invoice, editing])

  const hasValidation = invoice && ['VALIDATED', 'MISMATCH', 'CONFIRMED'].includes(invoice.invoiceStatus)
  const { data: vr } = useQuery({
    queryKey: ['validation', id],
    queryFn: () => getValidationResult(id),
    enabled: hasValidation,
    retry: false,
    staleTime: 30_000,
  })

  const updateMut = useMutation({
    mutationFn: () => updateInvoice(id, editData),
    onSuccess: (updated) => {
      toast('Saved', 'success')
      setEditing(false)
      setEditData(updated)
      qc.invalidateQueries({ queryKey: ['invoice', id] })
    },
    onError: (e) => toast(e?.message || 'Save failed', 'error'),
  })

  const confirmMut = useMutation({
    mutationFn: () => confirmInvoice(id),
    onSuccess: () => {
      toast('Confirmed', 'success')
      qc.invalidateQueries({ queryKey: ['invoice', id] })
    },
    onError: (e) => toast(e?.message || 'Failed', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteInvoice(id),
    onSuccess: () => { toast('Deleted', 'info'); nav('/invoices') },
    onError: (e) => toast(e?.message || 'Delete failed', 'error'),
  })

  if (isLoading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <Spinner large />
    </div>
  )

  if (!invoice) return (
    <div style={{ flex: 1, display: 'flex' }}>
      <div className="page-body"><Empty title="Invoice not found" /></div>
    </div>
  )

  const d = editing ? (editData || invoice) : invoice

  const missingRequired = invoice.extractionRaw?.missingRequired
  const hasMissing = Array.isArray(missingRequired) && missingRequired.length > 0

  const field = (key) => editing
    ? <input className="inline-edit" value={d[key] || ''} onChange={e => setEditData(p => ({ ...p, [key]: e.target.value }))} />
    : <div className={`detail-field-value${!d[key] ? ' empty' : ''}`}>{d[key] || 'Not extracted'}</div>

  const moneyField = (key) => editing
    ? <input className="inline-edit" type="number" step="0.01" value={d[key] || ''} onChange={e => setEditData(p => ({ ...p, [key]: e.target.value }))} />
    : <div className={`detail-field-value mono${!d[key] ? ' empty' : ''}`}>{d[key] != null ? fmtAmount(d[key]) : 'Not extracted'}</div>

  const fileUrl = invoice.upload?.filePath ? `/${invoice.upload.filePath}` : null

  return (
    <>
      <div className="top-bar">
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => nav('/invoices')} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div>
          <div className="top-bar-title">{invoice.invoiceNumber || 'Invoice'}</div>
          <div className="top-bar-sub">{invoice.vendorName || 'Unknown vendor'}</div>
        </div>
        <div style={{ marginLeft: 12 }}><Badge status={invoice.invoiceStatus} /></div>
        <div className="top-bar-spacer" />
        {fileUrl && (
          <button
            className={`btn btn-ghost btn-sm compare-toggle-btn${showPreview ? ' active' : ''}`}
            onClick={() => setShowPreview(p => !p)}
            title="Toggle file preview"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Compare
          </button>
        )}
        {editing ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setEditData(invoice) }}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>
              {updateMut.isPending ? <Spinner /> : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(true); setEditData({ ...invoice }) }}>Edit</button>
            {invoice.invoiceStatus !== 'CONFIRMED' && (
              <button className="btn btn-primary btn-sm" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}>
                {confirmMut.isPending ? <Spinner /> : 'Confirm'}
              </button>
            )}
            <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('Delete this invoice?')) deleteMut.mutate() }}>Delete</button>
          </>
        )}
      </div>

      <div className="compare-layout">
        {/* Left: Form */}
        <div className="compare-form-pane">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {hasMissing && !editing && (
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius)',
                background: 'rgba(245, 158, 11, 0.12)', border: '1px solid var(--amber)',
                fontSize: 12, color: 'var(--text-2)', display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--amber)', marginBottom: 2 }}>Some required fields were not extracted</div>
                  <div>Missing: {missingRequired.map(f => f.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())).join(', ')}. Edit and save to complete the record before validation.</div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="detail-section-title">Invoice Header</div>
              <div className="detail-grid">
                <div>
                  <div className="detail-field">
                    <div className="detail-field-label">Invoice Number</div>
                    {field('invoiceNumber')}
                  </div>
                  <div className="detail-field">
                    <div className="detail-field-label">Invoice Date</div>
                    {editing
                      ? <input className="inline-edit" type="date" value={d.invoiceDate ? d.invoiceDate.slice(0,10) : ''} onChange={e => setEditData(p => ({ ...p, invoiceDate: e.target.value }))} />
                      : <div className="detail-field-value">{fmtDate(d.invoiceDate) || 'Not extracted'}</div>
                    }
                  </div>
                </div>
                <div>
                  <div className="detail-field">
                    <div className="detail-field-label">Due Date</div>
                    {editing
                      ? <input className="inline-edit" type="date" value={d.dueDate ? d.dueDate.slice(0,10) : ''} onChange={e => setEditData(p => ({ ...p, dueDate: e.target.value }))} />
                      : <div className="detail-field-value">{fmtDate(d.dueDate) || '—'}</div>
                    }
                  </div>
                  <div className="detail-field">
                    <div className="detail-field-label">Extraction Method</div>
                    <div><Badge status={invoice.extractionMethod} /></div>
                  </div>
                </div>
              </div>

              {invoice.extractionRaw?.confidence != null && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Extraction confidence</div>
                  <div style={{ flex: 1, height: 4, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.round(invoice.extractionRaw.confidence * 100)}%`,
                      background: invoice.extractionRaw.confidence >= 0.75 ? 'var(--green)' : invoice.extractionRaw.confidence >= 0.5 ? 'var(--amber)' : 'var(--red)',
                      borderRadius: 2,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--mono)', minWidth: 32 }}>
                    {Math.round(invoice.extractionRaw.confidence * 100)}%
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <div className="detail-grid">
                <div>
                  <div className="detail-section-title">Vendor</div>
                  <div className="detail-field"><div className="detail-field-label">Name</div>{field('vendorName')}</div>
                  <div className="detail-field"><div className="detail-field-label">GSTIN</div>{field('vendorGSTIN')}</div>
                  <div className="detail-field"><div className="detail-field-label">PAN</div>{field('vendorPAN')}</div>
                  <div className="detail-field"><div className="detail-field-label">Address</div>{field('vendorAddress')}</div>
                </div>
                <div>
                  <div className="detail-section-title">Buyer</div>
                  <div className="detail-field"><div className="detail-field-label">Name</div>{field('buyerName')}</div>
                  <div className="detail-field"><div className="detail-field-label">GSTIN</div>{field('buyerGSTIN')}</div>
                  <div className="detail-field"><div className="detail-field-label">Address</div>{field('buyerAddress')}</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="detail-section-title">GST Totals</div>
              <div className="detail-grid">
                <div>
                  <div className="detail-field"><div className="detail-field-label">Taxable Amount</div>{moneyField('totalTaxable')}</div>
                  <div className="detail-field"><div className="detail-field-label">CGST</div>{moneyField('totalCGST')}</div>
                  <div className="detail-field"><div className="detail-field-label">SGST</div>{moneyField('totalSGST')}</div>
                </div>
                <div>
                  <div className="detail-field"><div className="detail-field-label">IGST</div>{moneyField('totalIGST')}</div>
                  <div className="detail-field"><div className="detail-field-label">Cess</div>{moneyField('totalCess')}</div>
                  <div className="detail-field"><div className="detail-field-label">Round Off</div>{moneyField('roundOff')}</div>
                </div>
              </div>
              <div className="divider" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Grand Total</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
                  {invoice.grandTotal != null ? fmtAmount(invoice.grandTotal) : 'Not extracted'}
                </div>
              </div>
            </div>

            {invoice.lineItems?.length > 0 && (
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '14px 18px 10px' }}>
                  <div className="detail-section-title" style={{ margin: 0 }}>
                    Line Items <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>({invoice.lineItems.length})</span>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Description</th>
                        <th>HSN/SAC</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Taxable</th>
                        <th>GST</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.lineItems.map((li, i) => (
                        <tr key={li.id} style={{ cursor: 'default' }}>
                          <td style={{ color: 'var(--text-3)' }}>{li.slNo || i + 1}</td>
                          <td className="primary">{li.description || '—'}</td>
                          <td className="mono">{li.hsnSac || '—'}</td>
                          <td className="mono">{li.quantity ? `${li.quantity} ${li.unit || ''}` : '—'}</td>
                          <td className="mono">{fmtAmount(li.rateExclTax)}</td>
                          <td className="mono">{fmtAmount(li.taxableAmount)}</td>
                          <td className="mono" style={{ fontSize: 11 }}>
                            {li.cgstRate ? `C${li.cgstRate}%` : ''}{li.sgstRate ? ` S${li.sgstRate}%` : ''}{li.igstRate ? ` I${li.igstRate}%` : ''}
                          </td>
                          <td className="primary mono">{fmtAmount(li.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {invoice.extractionRaw?.rawText && (
              <details style={{ fontSize: 11 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-3)', padding: '6px 0' }}>
                  Raw extracted text (debug)
                </summary>
                <div style={{
                  marginTop: 8, padding: 12,
                  background: 'var(--bg-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', fontFamily: 'var(--mono)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 300, overflow: 'auto', color: 'var(--text-3)',
                }}>
                  {invoice.extractionRaw.rawText}
                </div>
              </details>
            )}
          </div>
        </div>

        {/* Center: File preview (toggleable) */}
        {showPreview && fileUrl && (
          <div className="compare-preview-pane">
            <div className="compare-preview-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="preview-filename" title={invoice.upload.fileName}>{invoice.upload.fileName}</span>
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '2px 8px' }}
                title="Open in new tab"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Open
              </a>
            </div>
            <FilePreview fileUrl={fileUrl} fileName={invoice.upload.fileName} />
          </div>
        )}

        {/* Right: Sidebar */}
        <div style={{ width: 260, minWidth: 260, borderLeft: '1px solid var(--border)', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="detail-section-title">Validation</div>
            {!hasValidation ? (
              <div className="empty-state" style={{ padding: '16px 0' }}>
                <div className="empty-sub">Not validated yet</div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => nav('/validate')}>
                  Run validation
                </button>
              </div>
            ) : !vr ? (
              <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'center' }}><Spinner /></div>
            ) : (
              <>
                <div style={{ marginBottom: 10 }}>
                  <Badge status={vr.overallStatus} />
                  {vr.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{vr.notes}</div>}
                </div>
                <div className="checks-grid">
                  <CheckRow label="Amount match" passed={vr.amountMatch} detail={fmtAmount(vr.amountInvoice)} detail2={fmtAmount(vr.amountStatement)} />
                  <CheckRow label="Vendor name" passed={vr.vendorMatch} detail={vr.vendorInvoice} detail2={vr.vendorStatement} />
                  <CheckRow label="Date check" passed={vr.dateCheck} detail={vr.daysDiff != null ? `${vr.daysDiff}d gap` : null} />
                  <CheckRow label="GSTIN match" passed={vr.gstinMatch} detail={vr.gstinInvoice} />
                  <CheckRow label="Invoice ref" passed={vr.invoiceRefMatch} detail={vr.invoiceRefFound} />
                </div>
                {vr.overallStatus === 'MISMATCH' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 10, width: '100%' }}
                    onClick={() => nav('/validate')}
                  >Override</button>
                )}
              </>
            )}
          </div>

          <div className="card card-sm" style={{ fontSize: 12, padding: 16 }}>
            <div className="detail-section-title">Metadata</div>
            <div className="detail-field">
              <div className="detail-field-label">Invoice ID</div>
              <div className="detail-field-value mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{invoice.id}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Created</div>
              <div className="detail-field-value">{fmtDate(invoice.createdAt)}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Updated</div>
              <div className="detail-field-value">{fmtDate(invoice.updatedAt)}</div>
            </div>
            {invoice.upload && (
              <div className="detail-field">
                <div className="detail-field-label">Source file</div>
                <div className="detail-field-value" style={{ wordBreak: 'break-all' }}>{invoice.upload.fileName}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
