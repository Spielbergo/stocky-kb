import { useState, useEffect } from 'react';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import ErrorBoundary from '../components/ErrorBoundary';
import AppModal from '../components/ConfirmModal';

// ── Formatters ────────────────────────────────────────────────────────────────
function formatCustomerId(id) {
  const s = String(id || '').replace(/\D/g, '');
  if (s.length === 10) return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
  return s;
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}
function fmtCost(micros, currency) {
  const amount = Number(micros || 0) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
function fmtCTR(impressions, clicks) {
  if (!impressions || !clicks) return '—';
  return ((clicks / impressions) * 100).toFixed(2) + '%';
}
function fmtCPC(costMicros, clicks, currency) {
  if (!costMicros || !clicks) return '—';
  return fmtCost(costMicros / clicks, currency);
}

const STATUS_STYLE = {
  ENABLED:  { bg: 'rgba(22,163,74,0.12)',   color: '#16a34a' },
  PAUSED:   { bg: 'rgba(234,179,8,0.12)',   color: '#a16207' },
  REMOVED:  { bg: 'rgba(239,68,68,0.12)',   color: '#dc2626' },
  UNKNOWN:  { bg: 'rgba(107,114,128,0.12)', color: '#6b7280' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.UNKNOWN;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: '0.7rem', fontWeight: 700,
      background: s.bg, color: s.color,
    }}>
      {status}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdsAccountsPage() {
  const [accounts, setAccounts]   = useState([]);
  const [syncedAt, setSyncedAt]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy]       = useState('name');
  const [sortDir, setSortDir]     = useState('asc');
  const [modal, setModal]         = useState({ open: false });
  const [toastMsg, setToastMsg]   = useState('');

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2500); };
  const closeModal  = () => setModal({ open: false });
  const showAlert   = (message, title = 'Notice') =>
    setModal({ open: true, variant: 'alert', title, message });

  useEffect(() => { loadCached(); }, []);

  const loadCached = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/ads-accounts');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setAccounts(json.accounts || []);
      setSyncedAt(json.syncedAt || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const syncAccounts = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res  = await fetch('/api/ads-accounts', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      setAccounts(json.accounts || []);
      setSyncedAt(json.syncedAt || null);
      toast(`Synced ${json.accounts?.length ?? 0} accounts`);
    } catch (e) {
      showAlert(e.message, 'Sync Failed');
    } finally {
      setSyncing(false);
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────
  const filtered = accounts
    .filter(a => {
      const matchSearch = !search ||
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        String(a.id).includes(search);
      const matchStatus = statusFilter === 'ALL' || a.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'name')  return a.name.localeCompare(b.name) * dir;
      if (sortBy === 'id')    return String(a.id).localeCompare(String(b.id)) * dir;
      if (sortBy === 'cost')  return ((a.metrics?.costMicros || 0) - (b.metrics?.costMicros || 0)) * dir;
      if (sortBy === 'clicks')return ((a.metrics?.clicks || 0)     - (b.metrics?.clicks || 0))     * dir;
      if (sortBy === 'impressions') return ((a.metrics?.impressions || 0) - (b.metrics?.impressions || 0)) * dir;
      if (sortBy === 'conversions') return ((a.metrics?.conversions || 0) - (b.metrics?.conversions || 0)) * dir;
      return 0;
    });

  const hasMetrics = accounts.some(a => a.metrics?.impressions);

  const totals = accounts.reduce((acc, a) => ({
    impressions: acc.impressions + (a.metrics?.impressions || 0),
    clicks:      acc.clicks      + (a.metrics?.clicks      || 0),
    costMicros:  acc.costMicros  + (a.metrics?.costMicros  || 0),
    conversions: acc.conversions + (a.metrics?.conversions || 0),
  }), { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };
  const sortIndicator = (col) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const uniqueStatuses = ['ALL', ...Array.from(new Set(accounts.map(a => a.status)))];

  return (
    <ErrorBoundary>
      <AuthGate>
        <NavBar />
        <div className="admin-layout">

          {/* ── Sidebar ── */}
          <aside className="admin-sidebar">

            <div className="sidebar-profile-badge">
              <div className="sidebar-profile-icon">📊</div>
              <div>
                <div className="sidebar-profile-label">Google Ads</div>
                <div className="sidebar-profile-sub">Account Manager</div>
              </div>
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-section-title">Sync</h3>
              <button
                className="upload-btn"
                onClick={syncAccounts}
                disabled={syncing || loading}
                style={{ marginBottom: 5 }}
              >
                {syncing ? (
                  <><span className="spinner spinner-sm spinner-white" style={{ marginRight: 6 }} />Syncing…</>
                ) : '↻ Sync Accounts'}
              </button>
              <button
                className="upload-btn"
                onClick={loadCached}
                disabled={loading || syncing}
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', border: '1px solid var(--card-border)' }}
              >
                {loading ? (
                  <><span className="spinner spinner-sm" style={{ marginRight: 6 }} />Reloading…</>
                ) : '↺ Reload Cache'}
              </button>
              {syncedAt && (
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 9, lineHeight: 1.5 }}>
                  Last synced<br />
                  {new Date(syncedAt).toLocaleString()}
                </div>
              )}
            </div>

            <div className="sidebar-section">
              <h3 className="sidebar-section-title">Filter</h3>
              <input
                className="sidebar-input"
                placeholder="Search name or ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              {uniqueStatuses.length > 2 && (
                <>
                  <div className="chart-toolbar-label" style={{ marginBottom: 5 }}>Status</div>
                  <div className="period-btn-group">
                    {uniqueStatuses.map(s => (
                      <button
                        key={s}
                        className={`period-btn${statusFilter === s ? ' active' : ''}`}
                        onClick={() => setStatusFilter(s)}
                      >
                        {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {accounts.length > 0 && (
              <div className="sidebar-section sidebar-list-section" style={{ flex: 1 }}>
                <h3 className="sidebar-section-title">
                  Accounts <span className="count-badge">{accounts.length}</span>
                </h3>
                <ul className="sidebar-list" style={{ maxHeight: 'none' }}>
                  {accounts.map(a => (
                    <li
                      key={a.id}
                      className="sidebar-item"
                      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                      onClick={() => setSearch(String(a.id))}
                    >
                      <span className="sidebar-item-label">{a.name}</span>
                      <span className="sidebar-item-meta" style={{ fontFamily: 'monospace' }}>
                        {formatCustomerId(a.id)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </aside>

          {/* ── Main ── */}
          <main className="admin-main">

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Google Ads Accounts</h1>
                {syncedAt && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 3 }}>
                    Data as of {new Date(syncedAt).toLocaleString()}
                  </div>
                )}
              </div>
              {hasMetrics && (
                <span className="cached-badge" style={{ fontSize: '0.72rem' }}>Includes 30-day metrics</span>
              )}
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Summary stats */}
            {accounts.length > 0 && (
              <div className="stock-stat-grid" style={{ marginBottom: 24 }}>
                <div className="stock-stat-item">
                  <div className="stock-stat-label">Accounts</div>
                  <div className="stock-stat-value">{accounts.length}</div>
                  <div className="stock-stat-sub">
                    {accounts.filter(a => a.status === 'ENABLED').length} active ·{' '}
                    {accounts.filter(a => a.status === 'PAUSED').length} paused
                  </div>
                </div>
                {hasMetrics && <>
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">Impressions (30d)</div>
                    <div className="stock-stat-value">{fmtNum(totals.impressions)}</div>
                  </div>
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">Clicks (30d)</div>
                    <div className="stock-stat-value">{fmtNum(totals.clicks)}</div>
                    <div className="stock-stat-sub">
                      CTR {fmtCTR(totals.impressions, totals.clicks)}
                    </div>
                  </div>
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">Total Spend (30d)</div>
                    <div className="stock-stat-value">{fmtCost(totals.costMicros, 'USD')}</div>
                    <div className="stock-stat-sub">
                      Avg CPC {fmtCPC(totals.costMicros, totals.clicks, 'USD')}
                    </div>
                  </div>
                  {totals.conversions > 0 && (
                    <div className="stock-stat-item">
                      <div className="stock-stat-label">Conversions (30d)</div>
                      <div className="stock-stat-value">{fmtNum(Math.round(totals.conversions))}</div>
                      <div className="stock-stat-sub">
                        CPA {totals.conversions ? fmtCost(totals.costMicros / totals.conversions, 'USD') : '—'}
                      </div>
                    </div>
                  )}
                </>}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="admin-empty-state">
                <span className="spinner spinner-lg" style={{ margin: '0 auto 8px' }} />
                <p>Loading accounts…</p>
              </div>
            )}

            {/* Empty state */}
            {!loading && accounts.length === 0 && !error && (
              <div className="admin-empty-state">
                <span style={{ fontSize: '2rem' }}>📊</span>
                <p>No accounts loaded yet.</p>
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
                  Click <strong>↻ Sync Accounts</strong> to pull data from the Google Ads API.
                  Make sure these environment variables are set in your <code>.env.local</code>:
                </p>
                <ul style={{ fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'left', lineHeight: 2, fontFamily: 'monospace', listStyle: 'none', padding: 0 }}>
                  <li>GOOGLE_ADS_DEVELOPER_TOKEN</li>
                  <li>GOOGLE_ADS_LOGIN_CUSTOMER_ID</li>
                  <li>GOOGLE_SERVICE_ACCOUNT_EMAIL</li>
                  <li>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</li>
                </ul>
              </div>
            )}

            {/* Accounts table */}
            {!loading && filtered.length > 0 && (
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, overflow: 'auto' }}>
                <table className="stocks-table">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Account Name{sortIndicator('name')}
                      </th>
                      <th onClick={() => toggleSort('id')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Customer ID{sortIndicator('id')}
                      </th>
                      <th>Currency</th>
                      <th>Time Zone</th>
                      <th>Status</th>
                      {hasMetrics && <>
                        <th onClick={() => toggleSort('impressions')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Impressions{sortIndicator('impressions')}
                        </th>
                        <th onClick={() => toggleSort('clicks')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Clicks{sortIndicator('clicks')}
                        </th>
                        <th>CTR</th>
                        <th onClick={() => toggleSort('cost')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Cost (30d){sortIndicator('cost')}
                        </th>
                        <th>CPC</th>
                        <th onClick={() => toggleSort('conversions')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Conv.{sortIndicator('conversions')}
                        </th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(a => {
                      const m = a.metrics || {};
                      return (
                        <tr key={a.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{a.name}</div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                              {a.isTest && (
                                <span style={{ fontSize: '0.65rem', background: 'rgba(234,179,8,0.15)', color: '#a16207', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>TEST</span>
                              )}
                              {a.isManager && (
                                <span style={{ fontSize: '0.65rem', background: 'rgba(99,102,241,0.15)', color: '#4f46e5', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>MGR</span>
                              )}
                            </div>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {formatCustomerId(a.id)}
                          </td>
                          <td>{a.currencyCode}</td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{a.timeZone}</td>
                          <td><StatusBadge status={a.status} /></td>
                          {hasMetrics && <>
                            <td>{m.impressions ? fmtNum(m.impressions) : '—'}</td>
                            <td>{m.clicks ? fmtNum(m.clicks) : '—'}</td>
                            <td>{fmtCTR(m.impressions, m.clicks)}</td>
                            <td>{m.costMicros ? fmtCost(m.costMicros, a.currencyCode) : '—'}</td>
                            <td>{fmtCPC(m.costMicros, m.clicks, a.currencyCode)}</td>
                            <td>{m.conversions ? fmtNum(Math.round(m.conversions)) : '—'}</td>
                          </>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {filtered.length < accounts.length && (
                  <div style={{ padding: '10px 16px', fontSize: '0.78rem', color: 'var(--muted)', borderTop: '1px solid var(--card-border)' }}>
                    Showing {filtered.length} of {accounts.length} accounts
                    {search && <> matching &ldquo;{search}&rdquo;</>}
                    {statusFilter !== 'ALL' && <> with status {statusFilter}</>}
                  </div>
                )}
              </div>
            )}

          </main>
        </div>
      </AuthGate>

      <AppModal {...modal} onCancel={closeModal} />

      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '10px 22px',
          borderRadius: 24, fontSize: '0.85rem', fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)', zIndex: 9999, whiteSpace: 'nowrap',
        }}>{toastMsg}</div>
      )}
    </ErrorBoundary>
  );
}
