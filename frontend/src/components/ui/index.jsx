export function Badge({ status }) {
  const map = {
    PENDING:   ['badge-blue',   'Pending'],
    VALIDATED: ['badge-green',  'Validated'],
    MISMATCH:  ['badge-amber',  'Mismatch'],
    CONFIRMED: ['badge-purple', 'Confirmed'],
    FAILED:    ['badge-red',    'Failed'],
    PROCESSING:['badge-gray',   'Processing'],
    DONE:      ['badge-green',  'Done'],
    PASSED:    ['badge-green',  'Passed'],
    PARTIAL:   ['badge-amber',  'Partial'],
    BANK:      ['badge-blue',   'Bank'],
    LEDGER:    ['badge-purple', 'Ledger'],
    REGEX:     ['badge-gray',   'Regex'],
    OLLAMA:    ['badge-purple', 'Ollama'],
  }
  const [cls, label] = map[status] || ['badge-gray', status]
  return <span className={`badge ${cls}`}>{label}</span>
}

export function Spinner({ large }) {
  return <div className={large ? 'spinner spinner-lg' : 'spinner'} />
}

export function Empty({ title = 'Nothing here', sub, icon }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <BoxIcon />}</div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  )
}

function BoxIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
      <line x1="10" y1="12" x2="14" y2="12"/>
    </svg>
  )
}

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtAmount(n) {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
