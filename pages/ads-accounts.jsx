import { useState, useEffect, useRef } from 'react';
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
  const [statusFilter, setStatusFilter] = useState('ENABLED');
  const [sortBy, setSortBy]       = useState('name');
  const [sortDir, setSortDir]     = useState('asc');
  const [modal, setModal]         = useState({ open: false });
  const [toastMsg, setToastMsg]   = useState('');

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2500); };
  const closeModal  = () => setModal({ open: false });

  // Selected accounts for optimizer target (multi-select)
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [acctDropdownOpen, setAcctDropdownOpen] = useState(false);
  const acctDropdownRef = useRef(null);

  const toggleAccountSelection = (a) => {
    setSelectedAccounts(prev =>
      prev.find(x => x.id === a.id) ? prev.filter(x => x.id !== a.id) : [...prev, a]
    );
  };
  const [optMessages, setOptMessages] = useState([]);
  const [optInput, setOptInput] = useState('');
  const [optLoading, setOptLoading] = useState(false);
  // Composer sizing / resize state
  const [composerDims, setComposerDims] = useState({ width: null, height: 135, minimized: false, expanded: false });
  const composerRef = useRef(null);
  const dragStateRef = useRef(null);
  const [hoveredBtn, setHoveredBtn] = useState(null);

  useEffect(() => {
    if (composerDims.width === null && typeof window !== 'undefined') {
      const w = Math.min(980, Math.floor(window.innerWidth * 0.94));
      setComposerDims(d => ({ ...d, width: w }));
    }
  }, [composerDims.width]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Shrink/expand should only change height; keep width unchanged
  const handleShrink = () => setComposerDims(d => ({ ...d, minimized: true, expanded: false, height: 135 }));
  const handleExpand = () => setComposerDims(d => ({ ...d, minimized: false, expanded: true, height: 420 }));

  // Dragging only adjusts height. Invert vertical so dragging up increases height (user preference).
  const handleDragging = (e) => {
    if (!dragStateRef.current) return;
    const dy = e.clientY - dragStateRef.current.startY; // positive when moving down
    // Invert: moving up (dy < 0) should increase height, so subtract dy
    const deltaH = -dy;
    const newH = clamp(dragStateRef.current.startH + deltaH, 80, window.innerHeight - 80);
    setComposerDims(d => ({ ...d, height: newH, minimized: false, expanded: false }));
  };

  const handleDragEnd = () => {
    dragStateRef.current = null;
    window.removeEventListener('mousemove', handleDragging);
    window.removeEventListener('mouseup', handleDragEnd);
  };

  const handleDragStart = (e) => {
    e.preventDefault();
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: composerRef.current ? composerRef.current.offsetWidth : composerDims.width,
      startH: composerRef.current ? composerRef.current.offsetHeight : composerDims.height,
    };
    window.addEventListener('mousemove', handleDragging);
    window.addEventListener('mouseup', handleDragEnd);
  };

  // ── CSV Import modal ──────────────────────────────────────────────────────
  const CSV_FIELDS    = ['date', 'campaign', 'impressions', 'clicks', 'cost', 'conversions'];
  const CSV_REQUIRED  = ['date', 'campaign', 'impressions', 'clicks', 'cost'];
  const [csvModal, setCsvModal]               = useState({ open: false });
  const [csvModalLabel, setCsvModalLabel]     = useState('');
  const [csvModalFile, setCsvModalFile]       = useState(null);
  const [csvModalHeaders, setCsvModalHeaders] = useState([]);
  const [csvModalMapping, setCsvModalMapping] = useState({});
  const [csvModalLoading, setCsvModalLoading] = useState(false);
  const [csvModalError, setCsvModalError]     = useState(null);
  const csvModalFileRef = useRef(null);

  const handleCsvModalFile = async (file) => {
    setCsvModalFile(file);
    const text = await file.text();
    const firstLine = text.split('\n')[0];
    const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"/g, ''));
    setCsvModalHeaders(headers);
    const fieldAliases = {
      date:        ['date', 'day', 'Date', 'Day'],
      campaign:    ['campaign', 'campaign name', 'Campaign', 'Campaign name', 'Campaign Name'],
      impressions: ['impressions', 'impr.', 'impr', 'Impressions'],
      clicks:      ['clicks', 'Clicks'],
      cost:        ['cost', 'spend', 'cost (usd)', 'cost (aud)', 'Cost', 'Spend'],
      conversions: ['conversions', 'conv.', 'conv', 'Conversions'],
    };
    const autoMap = {};
    for (const [field, aliases] of Object.entries(fieldAliases)) {
      const match = headers.find(h => aliases.some(a => a.toLowerCase() === h.toLowerCase().trim()));
      if (match) autoMap[field] = match;
    }
    setCsvModalMapping(autoMap);
  };

  const submitCsvImport = async () => {
    const lbl = csvModalLabel.trim();
    if (!lbl) { setCsvModalError('Enter a label for this data.'); return; }
    if (!csvModalFile) { setCsvModalError('Select a CSV file.'); return; }
    const unmapped = CSV_REQUIRED.filter(f => !csvModalMapping[f]);
    if (unmapped.length) { setCsvModalError(`Map all required fields. Missing: ${unmapped.join(', ')}`); return; }
    setCsvModalLoading(true);
    setCsvModalError(null);
    try {
      const rawText = await csvModalFile.text();
      const lines = rawText.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"/g, ''));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"/g, ''));
        const row = {};
        for (const field of CSV_FIELDS) {
          if (!csvModalMapping[field]) continue;
          const i = headers.indexOf(csvModalMapping[field]);
          row[field] = i >= 0 ? cols[i] : '';
        }
        return row;
      });
      const standardCsv = [
        CSV_FIELDS.join(','),
        ...rows.map(r => CSV_FIELDS.map(f => r[f] ?? '').join(',')),
      ].join('\n');
      const res = await fetch('/api/ads-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl, csv: standardCsv }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      toast(`Imported ${json.imported} rows for "${json.label}"${json.skipped ? ` (${json.skipped} skipped)` : ''}`);
      setCsvModal({ open: false });
      setCsvModalFile(null);
      setCsvModalHeaders([]);
      setCsvModalMapping({});
      setCsvModalLabel('');
      if (csvModalFileRef.current) csvModalFileRef.current.value = '';
    } catch (e) {
      setCsvModalError(e.message);
    } finally {
      setCsvModalLoading(false);
    }
  };
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
      const matchSelected = selectedAccounts.length === 0 || !!selectedAccounts.find(x => x.id === a.id);
      const matchSearch = !search ||
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        String(a.id).includes(search);
      const matchStatus = statusFilter === 'ALL' || a.status === statusFilter;
      return matchSelected && matchSearch && matchStatus;
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

  const activeAccounts = selectedAccounts.length > 0 ? selectedAccounts : accounts;

  const hasMetrics = filtered.some(a => a.metrics?.impressions);

  const totals = filtered.reduce((acc, a) => ({
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

  // Send a simple optimizer query (in-memory only; no chat persistence)
  // Streams AI output (if the endpoint supports streaming) and appends above the input in real time.
  const handleOptimizerSend = async () => {
    if (!optInput.trim()) return;
    setOptLoading(true);
    try {
      // add user message locally
      setOptMessages(prev => [...prev, { role: 'user', content: optInput }]);

      // add a placeholder AI message we will update as the stream arrives
      setOptMessages(prev => [...prev, { role: 'ai', content: '' }]);

      const payload = {
        platform: 'Campaign Performance',
        userPrompt: optInput,
        sourceOption: 'mydata',
        messages: [],
        geminiModel: 'gemini-2.5-flash-lite',
        profile: 'ads',
        accountIds: filtered.map(a => a.id),
      };

      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // If the response is a stream, read chunks and update the last AI message progressively.
      if (res.ok && res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let done = false;
        let acc = '';
        while (!done) {
          const { value, done: d } = await reader.read();
          done = d;
          if (value) {
            acc += dec.decode(value, { stream: true });
            // update the most recent AI message with accumulated text
            setOptMessages(prev => {
              const copy = prev.slice();
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === 'ai') {
                  copy[i] = { ...copy[i], content: acc };
                  break;
                }
              }
              return copy;
            });
          }
        }
        // try to finalize any remaining decoded bytes
        if (acc) {
          setOptMessages(prev => {
            const copy = prev.slice();
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === 'ai') {
                copy[i] = { ...copy[i], content: acc };
                break;
              }
            }
            return copy;
          });
        }
      } else {
        // Non-streaming fallback: parse JSON and append response
        const data = await res.json().catch(() => ({}));
        setOptMessages(prev => {
          const copy = prev.slice();
          // replace last AI placeholder if exists
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'ai') {
              copy[i] = { ...copy[i], content: data.response || (res.ok ? 'No response' : `Error: ${data.error || 'Request failed'}`) };
              return copy;
            }
          }
          return [...prev, { role: 'ai', content: data.response || 'No response' }];
        });
      }

      setOptInput('');
    } catch (e) {
      console.error('optimizer send error', e);
      setOptMessages(prev => {
        const copy = prev.slice();
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === 'ai') {
            copy[i] = { ...copy[i], content: `Error: ${e.message || e}` };
            return copy;
          }
        }
        return [...prev, { role: 'ai', content: `Error: ${e.message || e}` }];
      });
    } finally {
      setOptLoading(false);
    }
  };

  return (
    <ErrorBoundary>
      <AuthGate>
        <NavBar />
        <div className="admin-layout">

          {/* ── Sidebar ── */}
          <aside className="admin-sidebar">

            <div className="sidebar-profile-badge" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="sidebar-profile-icon">📊</div>
                <div>
                  <div className="sidebar-profile-label">Google Ads</div>
                  <div className="sidebar-profile-sub">Account Manager</div>
                </div>
              </div>
              <button
                onClick={() => { setCsvModal({ open: true }); setCsvModalError(null); setCsvModalFile(null); setCsvModalHeaders([]); setCsvModalMapping({}); }}
                title="Import CSV"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', flexShrink: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Import
              </button>
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
              <div className="sidebar-section" ref={acctDropdownRef}>
                <h3 className="sidebar-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => setAcctDropdownOpen(o => !o)}>
                  <span>Accounts <span className="count-badge">{accounts.length}</span></span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{acctDropdownOpen ? '▲' : '▼'}</span>
                </h3>
                {selectedAccounts.length > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 6, lineHeight: 1.5 }}>
                    {selectedAccounts.length === 1
                      ? selectedAccounts[0].name
                      : `${selectedAccounts.length} accounts selected`}
                    <button
                      onClick={() => setSelectedAccounts([])}
                      style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.7rem', padding: 0, textDecoration: 'underline' }}
                    >Clear</button>
                  </div>
                )}
                {acctDropdownOpen && (
                  <div style={{ border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                    {accounts.map(a => {
                      const checked = !!selectedAccounts.find(x => x.id === a.id);
                      return (
                        <label
                          key={a.id}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', cursor: 'pointer', background: checked ? 'rgba(99,102,241,0.08)' : 'transparent', borderBottom: '1px solid var(--card-border)', fontSize: '0.82rem' }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAccountSelection(a)}
                            style={{ marginTop: 2, flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{a.name}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--muted)' }}>{formatCustomerId(a.id)}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
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
                  <div className="stock-stat-value">{filtered.length}</div>
                  <div className="stock-stat-sub">
                    {filtered.filter(a => a.status === 'ENABLED').length} active ·{' '}
                    {filtered.filter(a => a.status === 'PAUSED').length} paused
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

      {/* Bottom-center Account Optimizer composer (resizable, centered name, controls) */}
      <div style={{ position: 'fixed', bottom: 28, left: '58%', transform: 'translateX(-50%)', zIndex: 1400 }}>
        <div ref={composerRef} style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)', width: composerDims.width ? composerDims.width + 'px' : 'min(980px, 94%)',
          height: composerDims.height ? composerDims.height + 'px' : 'auto', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Account Optimizer</div>
            <div style={{ flex: 1, textAlign: 'center', fontSize: '0.85rem', fontWeight: 500, color: 'var(--muted)' }}>
              {filtered.length === 0 ? 'No account selected' : filtered.length === 1 ? filtered[0].name : `${filtered.length} accounts`}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                title="Shrink"
                onClick={handleShrink}
                onMouseEnter={() => setHoveredBtn('shrink')}
                onMouseLeave={() => setHoveredBtn(null)}
                style={{ width: 30, height: 30, borderRadius: 8, background: hoveredBtn === 'shrink' ? 'var(--card-border)' : 'var(--input-bg)', border: '1px solid var(--card-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 18, lineHeight: 1, color: hoveredBtn === 'shrink' ? 'var(--foreground)' : '#888', transition: 'background 0.15s, color 0.15s' }}
              >−</button>
              <button
                title="Expand"
                onClick={handleExpand}
                onMouseEnter={() => setHoveredBtn('expand')}
                onMouseLeave={() => setHoveredBtn(null)}
                style={{ width: 30, height: 30, borderRadius: 8, background: hoveredBtn === 'expand' ? 'var(--card-border)' : 'var(--input-bg)', border: '1px solid var(--card-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 14, lineHeight: 1, color: hoveredBtn === 'expand' ? 'var(--foreground)' : '#888', transition: 'background 0.15s, color 0.15s' }}
              >⤢</button>
              <div
                role="button"
                tabIndex={0}
                title="Drag to resize"
                onMouseDown={handleDragStart}
                onMouseEnter={() => setHoveredBtn('drag')}
                onMouseLeave={() => setHoveredBtn(null)}
                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ns-resize', borderRadius: 8, background: hoveredBtn === 'drag' ? 'var(--card-border)' : 'var(--input-bg)', border: '1px solid var(--card-border)', flexShrink: 0, fontSize: 16, lineHeight: 1, color: hoveredBtn === 'drag' ? 'var(--foreground)' : '#888', transition: 'background 0.15s, color 0.15s' }}
              >≡</div>
            </div>
          </div>
          {optMessages.length > 0 && (
            <div style={{ marginBottom: 10, flex: 1, overflow: 'auto', paddingBottom: 8, borderBottom: '1px dashed var(--card-border)' }}>
              {optMessages.slice(-10).map((m, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: m.role === 'user' ? 'var(--foreground)' : 'var(--muted)', fontWeight: 700 }}>{m.role === 'user' ? 'You' : 'Optimizer'}</div>
                  <div style={{ marginTop: 6 }} dangerouslySetInnerHTML={{ __html: m.content || '' }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8, flexShrink: 0 }}>
            <textarea
              value={optInput}
              onChange={e => setOptInput(e.target.value)}
              placeholder={filtered.length > 0 ? `Ask about ${filtered.length === 1 ? filtered[0].name : `${filtered.length} accounts`} (e.g. "Which campaigns had the best ROAS?")` : 'Select an account to target, then ask a question...'}
              rows={2}
              style={{ flex: 1, resize: 'vertical', padding: 10, borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--foreground)' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleOptimizerSend(); } }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="generate-btn" onClick={handleOptimizerSend} disabled={optLoading} style={{ minWidth: 110 }}>{optLoading ? 'Analyzing…' : 'Analyze'}</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── CSV Import modal ── */}
      {csvModal.open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setCsvModal({ open: false }); }}
        >
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '22px 24px', width: 500, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow)' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Import Ads CSV</h3>
              <button onMouseDown={() => setCsvModal({ open: false })} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
            </div>

            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Label</label>
            <input
              className="sidebar-input"
              placeholder="e.g. Brand Campaigns Q1 2026"
              value={csvModalLabel}
              onChange={e => setCsvModalLabel(e.target.value)}
              style={{ marginBottom: 14 }}
            />

            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>CSV File</label>
            <label
              htmlFor="ads-csv-modal-file"
              onDragOver={e => { e.preventDefault(); e.currentTarget.setAttribute('data-drag', 'true'); }}
              onDragLeave={e => e.currentTarget.removeAttribute('data-drag')}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.removeAttribute('data-drag');
                const f = e.dataTransfer.files?.[0];
                if (f) handleCsvModalFile(f);
              }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, marginBottom: 14, cursor: 'pointer', padding: '22px 16px',
                border: '2px dashed var(--card-border)', borderRadius: 10,
                background: 'var(--input-bg)', transition: 'border-color 0.15s, background 0.15s',
                textAlign: 'center',
              }}
            >
              {csvModalFile ? (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)' }}>{csvModalFile.name}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{(csvModalFile.size / 1024).toFixed(1)} KB &nbsp;·&nbsp; click to change</span>
                </>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Drop CSV here</span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>or click to browse</span>
                </>
              )}
            </label>
            <input
              id="ads-csv-modal-file"
              ref={csvModalFileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvModalFile(f); }}
            />

            {csvModalHeaders.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Column Mapping</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: 10 }}>Map each required field to the matching column in your CSV.</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                  {CSV_FIELDS.map(field => (
                    <div key={field}>
                      <label style={{ fontSize: '0.76rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                        {csvModalMapping[field] ? (
                          <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>
                        ) : CSV_REQUIRED.includes(field) ? (
                          <span style={{ color: 'var(--danger)', marginLeft: 6 }}>required</span>
                        ) : (
                          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>optional</span>
                        )}
                      </label>
                      <select
                        className="sidebar-input"
                        style={{ marginBottom: 0 }}
                        value={csvModalMapping[field] || ''}
                        onChange={e => setCsvModalMapping(m => ({ ...m, [field]: e.target.value }))}
                      >
                        <option value="">-- select column --</option>
                        {csvModalHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {csvModalError && (
              <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: 12, padding: '8px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                {csvModalError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                className="upload-btn"
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', border: '1px solid var(--card-border)' }}
                onMouseDown={() => setCsvModal({ open: false })}
              >Cancel</button>
              <button
                className="upload-btn"
                onClick={submitCsvImport}
                disabled={csvModalLoading || !csvModalFile}
              >
                {csvModalLoading
                  ? <><span className="spinner spinner-sm spinner-white" style={{ marginRight: 6 }} />Importing…</>
                  : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

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
