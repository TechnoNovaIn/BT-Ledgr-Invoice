import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import { listStatements, uploadStatement, deleteStatement, listBatches } from '../services/api'
import { Badge, Spinner, Empty, fmtDate } from '../components/ui/index'
import { useToast } from '../components/ui/Toast'

function fmt(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getFileBadge(name) {
  const ext = (name.split('.').pop() || '').toUpperCase()
  const colors = {
    XLSX: '#10b981',
    XLS: '#10b981',
    CSV: '#06b6d4',
    PDF: '#e11d48',
    JPG: '#2563eb',
    JPEG: '#2563eb',
    PNG: '#3b82f6',
    WEBP: '#059669',
    TIFF: '#8b5cf6',
    TIF: '#8b5cf6',
    BMP: '#d97706',
  }
  return {
    label: ext,
    color: colors[ext] || '#6b7280',
  }
}

export default function StatementsPage() {
  const toast = useToast()
  const qc = useQueryClient()
  const [files, setFiles] = useState([])
  const [batchId, setBatchId] = useState('')
  const [uploading, setUploading] = useState(false)

  // listStatements already returns array directly
  const { data: statements = [], isLoading } = useQuery({
    queryKey: ['statements'],
    queryFn: listStatements,
  })

  // Invoice batches the statement can be auto-reconciled against
  const { data: batches = [] } = useQuery({
    queryKey: ['batches'],
    queryFn: listBatches,
  })

  const onDrop = useCallback((accepted, rejected) => {
    if (rejected.length) toast(`${rejected.length} file(s) not accepted. Supported: Excel (.xlsx, .xls), CSV, PDF, or Images`, 'error')
    if (accepted.length) {
      setFiles(prev => {
        const existing = prev.map(f => f.name)
        const newFiles = accepted.filter(f => !existing.includes(f.name))
        return [...prev, ...newFiles]
      })
    }
  }, [toast])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/tiff': ['.tiff', '.tif'],
      'image/bmp': ['.bmp'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    maxSize: 50 * 1024 * 1024,
  })

  const removeFile = (name) => {
    setFiles(prev => prev.filter(f => f.name !== name))
  }

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    try {
      await uploadStatement(files, batchId || undefined)
      toast(`${files.length} statement${files.length > 1 ? 's' : ''} uploaded and processing…`, 'success')
      setFiles([])
      qc.invalidateQueries({ queryKey: ['statements'] })
    } catch (e) {
      toast(e?.message || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  const deleteMut = useMutation({
    mutationFn: deleteStatement,
    onSuccess: () => { toast('Deleted', 'info'); qc.invalidateQueries({ queryKey: ['statements'] }) },
    onError: (e) => toast(e?.message || 'Delete failed', 'error'),
  })

  return (
    <>
      <div className="top-bar">
        <div>
          <div className="top-bar-title">Statements</div>
          <div className="top-bar-sub">Bank or ledger account statements for cross-validation</div>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div className="card">
            <div className="section-header" style={{ marginBottom: 12 }}>
              <div className="section-title">Upload Statements</div>
              {files.length > 1 && !uploading && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFiles([])}
                  style={{ fontSize: 11, padding: '2px 8px' }}
                >
                  Clear all
                </button>
              )}
            </div>
            <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`} style={{ padding: '24px 16px' }}>
              <input {...getInputProps()} />
              <div className="dropzone-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              <div className="dropzone-title">Drop statements here (multiple files supported)</div>
              <div className="dropzone-sub">Excel (.xlsx, .xls), CSV, or Bank/Ledger PDF</div>
            </div>

            <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="form-label">Reconcile against invoice batch (optional)</label>
              <select
                className="form-input"
                value={batchId}
                onChange={e => setBatchId(e.target.value)}
              >
                <option value="">None — reconcile manually later</option>
                {batches.map(b => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.fileName
                      ? `${b.fileName.replace(/\.[^/.]+$/, '')} (${b.invoiceCount} invoice${b.invoiceCount !== 1 ? 's' : ''})`
                      : `${b.batchId.slice(0, 8)}… (${b.invoiceCount} invoices)`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                If selected, validation runs automatically once statements finish processing.
              </div>
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  maxHeight: 180,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginBottom: 12,
                  paddingRight: 4
                }}>
                  {files.map(f => {
                    const badge = getFileBadge(f.name)
                    return (
                      <div key={f.name} className="file-chip" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                        <span style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: '2px 5px',
                          borderRadius: 4,
                          background: `${badge.color}20`,
                          color: badge.color,
                          border: `1px solid ${badge.color}40`,
                          letterSpacing: 0.5
                        }}>
                          {badge.label}
                        </span>
                        <span className="file-chip-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.name}
                        </span>
                        <span className="file-chip-size" style={{ color: 'var(--text-3)', fontSize: 11 }}>
                          {fmt(f.size)}
                        </span>
                        {!uploading && (
                          <span className="file-chip-remove" onClick={() => removeFile(f.name)} style={{ cursor: 'pointer' }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={handleUpload}
                  disabled={uploading}
                >
                  {uploading ? (
                    <><Spinner /> Uploading {files.length} statement{files.length > 1 ? 's' : ''}…</>
                  ) : (
                    `Upload ${files.length} Statement${files.length > 1 ? 's' : ''}`
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="card" style={{ background: 'var(--bg-3)' }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Supported formats</div>
            {[
              ['Bank Statement', 'Date, Narration, Debit, Credit, Balance columns. Supports multi-bank formats.'],
              ['Ledger Account', 'Vendor-wise ledger with invoice references, GSTIN, narration entries.'],
            ].map(([t, d]) => (
              <div key={t} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 3 }}>{t}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{d}</div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              Auto-detection picks the correct parser based on column headers.
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="section-header" style={{ padding: '16px 20px 12px' }}>
            <div className="section-title">Uploaded Statements</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{statements.length} total</div>
          </div>
          {isLoading ? (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>
          ) : statements.length === 0 ? (
            <Empty title="No statements yet" sub="Upload a bank or ledger statement to validate invoices" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Transactions</th>
                    <th>Status</th>
                    <th>Uploaded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map(s => (
                    <tr key={s.id} style={{ cursor: 'default' }}>
                      <td className="primary">{s.fileName}</td>
                      <td><Badge status={s.statementType} /></td>
                      <td>{s._count?.transactions ?? s.transactions?.length ?? '—'}</td>
                      <td><Badge status={s.status} /></td>
                      <td>{fmtDate(s.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => { if (confirm('Delete this statement?')) deleteMut.mutate(s.id) }}
                        >Delete</button>
                      </td>
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
