import { useState, useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { getAuthStatus, verifyPin } from '../../services/api'

const LOGO_SVG = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
)

const navItems = [
  {
    label: 'Dashboard', to: '/dashboard',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
  },
  {
    label: 'Upload Invoices', to: '/upload',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
  },
  {
    label: 'Invoices', to: '/invoices',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
  },
  {
    label: 'Statements', to: '/statements',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
  },
  {
    label: 'Validate', to: '/validate',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
  },
]

export default function Layout() {
  const [pinRequired, setPinRequired] = useState(false)
  const [isUnlocked, setIsUnlocked] = useState(true)
  const [enteredPin, setEnteredPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [checkingPin, setCheckingPin] = useState(false)

  useEffect(() => {
    getAuthStatus()
      .then(res => {
        if (res && res.pinRequired) {
          setPinRequired(true)
          const savedUnlocked = sessionStorage.getItem('bt_ledgr_unlocked') === 'true'
          setIsUnlocked(savedUnlocked)
        } else {
          setPinRequired(false)
          setIsUnlocked(true)
        }
      })
      .catch(() => {
        // Fallback open if auth check fails
        setIsUnlocked(true)
      })
  }, [])

  const handleUnlock = async (e) => {
    e.preventDefault()
    if (!enteredPin) return
    setCheckingPin(true)
    setPinError('')
    try {
      const res = await verifyPin(enteredPin)
      if (res && res.valid) {
        sessionStorage.setItem('bt_ledgr_unlocked', 'true')
        setIsUnlocked(true)
        setEnteredPin('')
      } else {
        setPinError('Invalid PIN code. Please try again.')
      }
    } catch (err) {
      setPinError(err?.response?.data?.message || 'Incorrect PIN')
    } finally {
      setCheckingPin(false)
    }
  }

  const handleLock = () => {
    sessionStorage.removeItem('bt_ledgr_unlocked')
    setIsUnlocked(false)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">{LOGO_SVG}</div>
          <div>
            <div className="sidebar-logo-text">BT Ledgr</div>
            <div className="sidebar-logo-sub">Invoice Intelligence</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Workspace</div>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>Backend</div>
              <div style={{ fontSize: '11px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }}/>
                {typeof window !== 'undefined' ? window.location.host : 'localhost:3002'}
              </div>
            </div>
            {pinRequired && isUnlocked && (
              <button
                onClick={handleLock}
                className="btn btn-ghost btn-sm"
                title="Lock Session"
                style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-3)' }}
              >
                🔒 Lock
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="main-content">
        {pinRequired && !isUnlocked ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            minHeight: '80vh',
            padding: 20
          }}>
            <div className="card" style={{ maxWidth: 400, width: '100%', textAlign: 'center', padding: '32px 24px' }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.12)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: 24
              }}>
                🔒
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Network Access Protection</h2>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 20px', lineHeight: 1.4 }}>
                This BT Ledgr instance is protected. Enter the access PIN to view financial records.
              </p>

              <form onSubmit={handleUnlock}>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  className="form-input"
                  style={{
                    fontSize: 20,
                    letterSpacing: '0.3em',
                    textAlign: 'center',
                    marginBottom: 12,
                    fontWeight: 700
                  }}
                  placeholder="••••"
                  value={enteredPin}
                  onChange={e => setEnteredPin(e.target.value)}
                  autoFocus
                />

                {pinError && (
                  <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>
                    {pinError}
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={checkingPin || !enteredPin}
                >
                  {checkingPin ? 'Verifying…' : 'Unlock Workspace'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}

