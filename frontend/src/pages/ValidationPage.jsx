import { useState } from 'react'
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listBatches, listStatements, runValidation, overrideValidation } from '../services/api'
import { Badge, Spinner, Empty, fmtAmount } from '../components/ui/index'
import { useToast } from '../components/ui/Toast'

function CheckCell({ val }) {
  if (val === true)  return <span style={{ color: 'var(--green)' }}>✓</span>
  if (val === false) return <span style={{ color: 'var(--red)' }}>✗</span>
  return <span style={{ color: 'var(--text-3)' }}>—</span>
}

export default function ValidationPage() {
  const toast = useToast()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [batchId, setBatchId] = useState('')
  const [useAllStatements, setUseAllStatements] = useState(true)
  const [selectedStatementIds, setSelectedStatementIds] = useState([])
  const [results, setResults] = useState(null)
  const [overrideId, setOverrideId] = useState(null)
  const [overrideNote, setOverrideNote] = useState('')

  const { data: batches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: listBatches,
    staleTime: 30_000,
  })

  const { data: statements = [], isLoading: statementsLoading } = useQuery({
    queryKey: ['statements'],
    queryFn: listStatements,
  })

  const runMut = useMutation({
    mutationFn: () => runValidation({
      batchId,
      statementId: useAllStatements ? 'all' : (selectedStatementIds.length === 1 ? selectedStatementIds[0] : undefined),
      statementIds: useAllStatements ? undefined : selectedStatementIds,
    }),
    onSuccess: (data) => {
      setResults(data)
      const s = data.summary ?? {}
      toast(`Validation complete — ${s.passed ?? 0} passed, ${s.mismatch ?? 0} mismatched`, 'success')
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => toast(e?.message || 'Validation failed', 'error'),
  })

  const overrideMut = useMutation({
    mutationFn: ({ invoiceId, notes }) => overrideValidation(invoiceId, { notes }),
    onSuccess: () => {
      toast('Override saved', 'success')
      setOverrideId(null)
      setOverrideNote('')
      if (batchId) runMut.mutate()
    },
    onError: (e) => toast(e?.message || 'Failed', 'error'),
  })

  const resultRows = results?.results || []

  const handleExportCSV = () => {
    if (!resultRows.length) return
    const headers = ['Invoice #', 'Vendor', 'Amount', 'Amt Match', 'Vendor Match', 'Date Check', 'GSTIN Match', 'Ref Match', 'Status', 'Discrepancies']
    const rows = resultRows.map(r => [
      `"${(r.invoiceNumber || '').replace(/"/g, '""')}"`,
      `"${(r.vendorInvoice || '').replace(/"/g, '""')}"`,
      r.amountInvoice || '',
      r.amountMatch ? 'PASS' : 'FAIL',
      r.vendorMatch ? 'PASS' : 'FAIL',
      r.dateCheck ? 'PASS' : 'FAIL',
      r.gstinMatch ? 'PASS' : 'FAIL',
      r.invoiceRefMatch ? 'PASS' : 'FAIL',
      r.overallStatus || '',
      `"${(r.discrepancyDetails ? (typeof r.discrepancyDetails === 'string' ? r.discrepancyDetails : JSON.stringify(r.discrepancyDetails)) : '').replace(/"/g, '""')}"`
    ])
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `reconciliation_report_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="top-bar">
        <div>
          <div className="top-bar-title">Validate</div>
          <div className="top-bar-sub">Cross-check invoices against a bank or ledger statement</div>
        </div>
      </div>

      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Run Validation</div>
              <div className="section-sub">Select a batch and statement to run all 5 checks</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {/* Batch dropdown */}
            <div className="form-group" style={{ flex: 1, minWidth: 200, margin: 0 }}>
              <label className="form-label">
                Invoice Batch
                {batchesLoading && <Spinner style={{ marginLeft: 6 }} />}
              </label>
              <select
                className="form-input"
                value={batchId}
                onChange={e => setBatchId(e.target.value)}
                disabled={batchesLoading}
              >
                <option value="">
                  {batchesLoading ? 'Loading batches…' : batches.length === 0 ? 'No batches found' : 'Select batch…'}
                </option>
                {batches.map(b => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.fileName
                      ? `${b.fileName.replace(/\.[^/.]+$/, '')} (${b.invoiceCount} invoice${b.invoiceCount !== 1 ? 's' : ''})`
                      : `${b.batchId.slice(0, 8)}… (${b.invoiceCount} invoice${b.invoiceCount !== 1 ? 's' : ''})`
                    }
                  </option>
                ))}
              </select>
            </div>

            {/* Statements selector */}
            <div className="form-group" style={{ flex: 1.5, minWidth: 260, margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>
                  Bank & Ledger Statements
                  {statementsLoading && <Spinner style={{ marginLeft: 6 }} />}
                </label>
                <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: useAllStatements ? 'var(--accent)' : 'var(--text-3)', fontWeight: useAllStatements ? 600 : 400 }}>
                    <input
                      type="radio"
                      name="stmt_mode"
                      checked={useAllStatements}
                      onChange={() => setUseAllStatements(true)}
                    />
                    All Statements
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: !useAllStatements ? 'var(--accent)' : 'var(--text-3)', fontWeight: !useAllStatements ? 600 : 400 }}>
                    <input
                      type="radio"
                      name="stmt_mode"
                      checked={!useAllStatements}
                      onChange={() => setUseAllStatements(false)}
                    />
                    Choose Specific
                  </label>
                </div>
              </div>

              {useAllStatements ? (
                <div style={{
                  padding: '7px 12px',
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  boxSizing: 'border-box'
                }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
                  Cross-checking all {statements.length} statement{statements.length !== 1 ? 's' : ''} ({statements.reduce((acc, s) => acc + (s._count?.transactions || 0), 0)} txns)
                </div>
              ) : (
                <div style={{
                  maxHeight: 120,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  background: 'var(--bg-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}>
                  {statements.map(s => {
                    const isChecked = selectedStatementIds.includes(s.id)
                    return (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedStatementIds(selectedStatementIds.filter(id => id !== s.id))
                            } else {
                              setSelectedStatementIds([...selectedStatementIds, s.id])
                            }
                          }}
                        />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.fileName} ({s.statementType})
                        </span>
                        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
                          {s._count?.transactions ?? 0} txns
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <button
              className="btn btn-primary"
              onClick={() => runMut.mutate()}
              disabled={!batchId || (!useAllStatements && selectedStatementIds.length === 0) || runMut.isPending}
              style={{ height: 36 }}
            >
              {runMut.isPending ? <><Spinner /> Running…</> : 'Run Validation'}
            </button>
          </div>

          {/* Helper messages */}
          {!batchesLoading && batches.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--amber)' }}>
              No invoice batches found. <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => nav('/upload')}>Upload invoices first →</span>
            </div>
          )}
          {!statementsLoading && statements.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--amber)' }}>
              No statements uploaded. <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => nav('/statements')}>Upload a statement first →</span>
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              'Payment amount vs grand total',
              'Vendor name (fuzzy)',
              'Invoice date vs payment date',
              'GSTIN match',
              'Invoice ref in narration',
            ].map(c => (
              <span key={c} className="tag">{c}</span>
            ))}
          </div>
        </div>

        {/* Results */}
        {runMut.isPending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-3)', fontSize: 13 }}>
            <Spinner /> Running validation checks…
          </div>
        )}

        {resultRows.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <div className="section-header" style={{ padding: '16px 20px 12px' }}>
              <div>
                <div className="section-title">Results</div>
                <div className="section-sub">{resultRows.length} invoice{resultRows.length !== 1 ? 's' : ''} checked</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                  <span style={{ color: 'var(--green)' }}>✓ {resultRows.filter(r => r.overallStatus === 'PASSED').length} passed</span>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  <span style={{ color: 'var(--amber)' }}>{resultRows.filter(r => r.overallStatus === 'PARTIAL').length} partial</span>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  <span style={{ color: 'var(--red)' }}>{resultRows.filter(r => r.overallStatus === 'MISMATCH').length} mismatch</span>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportCSV}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 12 }}
                  title="Download reconciliation report as CSV"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Vendor</th>
                    <th>Amount</th>
                    <th style={{ textAlign: 'center' }}>Amt</th>
                    <th style={{ textAlign: 'center' }}>Vendor</th>
                    <th style={{ textAlign: 'center' }}>Date</th>
                    <th style={{ textAlign: 'center' }}>GSTIN</th>
                    <th style={{ textAlign: 'center' }}>Ref</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map(r => (
                    <React.Fragment key={r.invoiceId}>
                      <tr>
                        <td
                          className="primary mono"
                          style={{ cursor: 'pointer', color: 'var(--accent)' }}
                          onClick={() => nav(`/invoices/${r.invoiceId}`)}
                        >{r.invoiceNumber || r.invoiceId?.slice(0, 8) + '…'}</td>
                        <td>{r.vendorInvoice || '—'}</td>
                        <td className="mono">{fmtAmount(r.amountInvoice)}</td>
                        <td style={{ textAlign: 'center' }}><CheckCell val={r.amountMatch} /></td>
                        <td style={{ textAlign: 'center' }}><CheckCell val={r.vendorMatch} /></td>
                        <td style={{ textAlign: 'center' }}><CheckCell val={r.dateCheck} /></td>
                        <td style={{ textAlign: 'center' }}><CheckCell val={r.gstinMatch} /></td>
                        <td style={{ textAlign: 'center' }}><CheckCell val={r.invoiceRefMatch} /></td>
                        <td><Badge status={r.overallStatus} /></td>
                        <td>
                          {r.overallStatus === 'MISMATCH' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => setOverrideId(r.invoiceId)}>
                              Override
                            </button>
                          )}
                        </td>
                      </tr>
                      {overrideId === r.invoiceId && (
                        <tr style={{ cursor: 'default' }}>
                          <td colSpan={10} style={{ padding: '10px 16px', background: 'var(--bg-3)' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input
                                className="form-input"
                                placeholder="Reason for override…"
                                value={overrideNote}
                                onChange={e => setOverrideNote(e.target.value)}
                                style={{ maxWidth: 360 }}
                              />
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => overrideMut.mutate({ invoiceId: r.invoiceId, notes: overrideNote })}
                                disabled={!overrideNote || overrideMut.isPending}
                              >
                                {overrideMut.isPending ? <Spinner /> : 'Confirm Override'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setOverrideId(null)}>Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {resultRows.length === 0 && !runMut.isPending && (
          <Empty
            title="No results yet"
            sub="Select a batch and statement above, then run validation"
            icon={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/>
              </svg>
            }
          />
        )}
      </div>
    </>
  )
}
