import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { uploadInvoices, getBatchStatus } from '../services/api'
import { Spinner } from '../components/ui/index'
import { useToast } from '../components/ui/Toast'

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getFileBadge(name) {
  const ext = (name.split('.').pop() || '').toUpperCase()
  const colors = {
    PDF: '#e11d48',
    JPG: '#2563eb',
    JPEG: '#2563eb',
    PNG: '#16a34a',
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

export default function UploadPage() {
  const nav = useNavigate()
  const toast = useToast()
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [batchId, setBatchId] = useState(null)

  const onDrop = useCallback((accepted, rejected) => {
    if (rejected.length) toast(`${rejected.length} file(s) not accepted. Supported: PDF, JPG, PNG, WebP, TIFF, BMP`, 'error')
    setFiles(prev => {
      const existing = prev.map(f => f.name)
      const newFiles = accepted.filter(f => !existing.includes(f.name))
      return [...prev, ...newFiles]
    })
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
    },
    maxSize: 50 * 1024 * 1024,
  })

  const remove = (name) => setFiles(f => f.filter(x => x.name !== name))

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setProgress({ done: 0, total: files.length })
    try {
      const res = await uploadInvoices(files)
      const bId = res.batchId || res.batch?.id
      setBatchId(bId)
      let done = false
      let timedOut = false
      let attempts = 0
      while (!done && attempts < 50) {
        await new Promise(r => setTimeout(r, 1500))
        const status = await getBatchStatus(bId)
        const uploads = status.uploads || []
        const finished = uploads.filter(u => u.status !== 'PROCESSING').length
        setProgress({ done: finished, total: uploads.length })
        if (finished === uploads.length) done = true
        attempts++
      }
      timedOut = !done
      if (timedOut) {
        toast('Processing is taking longer than expected — check the invoices page', 'info')
        setTimeout(() => nav('/invoices'), 800)
      } else {
        const final = await getBatchStatus(bId)
        const uploads = final.uploads || []
        const failed = uploads.filter(u => u.status === 'FAILED').length
        const succeeded = uploads.filter(u => u.status === 'DONE').length
        if (succeeded > 0) {
          toast(`${succeeded} invoice(s) processed${failed > 0 ? `, ${failed} failed` : ''}`, failed === 0 ? 'success' : 'info')
        } else {
          toast(`${failed} invoice(s) failed to process`, 'error')
        }
        setTimeout(() => nav('/invoices'), 800)
      }
    } catch (e) {
      toast(e?.message || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="top-bar">
        <div>
          <div className="top-bar-title">Upload Invoices</div>
          <div className="top-bar-sub">PDF (digital & scans), JPEG, PNG, WebP, TIFF, BMP — up to 50MB each</div>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 680 }}>
        <div className="card">
          <div
            {...getRootProps()}
            className={`dropzone ${isDragActive ? 'active' : ''}`}
          >
            <input {...getInputProps()} />
            <div className="dropzone-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            {isDragActive ? (
              <div className="dropzone-title">Drop invoices here…</div>
            ) : (
              <>
                <div className="dropzone-title">Drag & drop invoices or click to browse</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 }}>
                  {['PDF (Digital & Scans)', 'PNG', 'JPG / JPEG', 'WEBP', 'TIFF', 'BMP'].map((fmtName) => (
                    <span key={fmtName} style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 12,
                      background: 'var(--bg-3)',
                      color: 'var(--text-2)',
                      border: '1px solid var(--border)'
                    }}>
                      {fmtName}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {files.length > 0 && (
            <>
              <div className="file-list" style={{ marginTop: 16 }}>
                {files.map(f => {
                  const badge = getFileBadge(f.name)
                  return (
                    <div key={f.name} className="file-chip" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                        <span className="file-chip-remove" onClick={() => remove(f.name)} style={{ cursor: 'pointer' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {uploading && progress && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Spinner /> Running high-accuracy OCR & GST validation…
                    </span>
                    <span style={{ fontWeight: 600 }}>{progress.done}/{progress.total}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                </div>
              )}

              <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleUpload}
                  disabled={uploading}
                  style={{ flex: 1 }}
                >
                  {uploading ? <><Spinner /> Processing Invoices…</> : `Upload & Process ${files.length} Invoice${files.length > 1 ? 's' : ''}`}
                </button>
                {!uploading && (
                  <button className="btn btn-ghost" onClick={() => setFiles([])}>Clear All</button>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 20, padding: '16px 18px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>High-Accuracy Extraction Pipeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['1', 'Multi-Format Ingestion', 'Direct support for PDF (digital text & scanned), PNG, JPG, WEBP, TIFF, and BMP.'],
              ['2', '300 DPI Preprocessing & OCR', 'Poppler 300 DPI rasterization, adaptive contrast binarization, and native Tesseract 5.5 OCR.'],
              ['3', 'Indian GST Rule Engine', 'Dynamic buyer/vendor extraction, 15-char GSTIN checksum validation, and mathematical self-healing.'],
            ].map(([n, title, desc]) => (
              <div key={n} style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-4)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{n}</span>
                <div><span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{title}</span> <span style={{ color: 'var(--text-3)' }}>— {desc}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
