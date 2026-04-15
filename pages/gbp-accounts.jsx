import React, { useState, useEffect, useRef } from 'react';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import ErrorBoundary from '../components/ErrorBoundary';
import AppModal from '../components/ConfirmModal';
import Chat from '../components/Chat';
import styles from '../styles/ads-accounts.module.css';

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtNum(n) { return Number(n || 0).toLocaleString(); }

const OPEN_STYLE = {
  OPEN:            { bg: 'rgba(22,163,74,0.12)',   color: '#16a34a' },
  CLOSED:          { bg: 'rgba(239,68,68,0.12)',   color: '#dc2626' },
  CLOSED_TEMPORARILY: { bg: 'rgba(234,179,8,0.12)', color: '#a16207' },
};

function OpenBadge({ status }) {
  const s = OPEN_STYLE[status] || { bg: 'rgba(107,114,128,0.12)', color: '#6b7280' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: '0.7rem', fontWeight: 700,
      background: s.bg, color: s.color,
    }}>
      {(status || 'UNKNOWN').replace(/_/g, ' ')}
    </span>
  );
}

// ── Insight summary card ───────────────────────────────────────────────────────
function InsightCards({ loc }) {
  const cards = [
    { label: 'Maps Impressions',   value: fmtNum((loc.impressionsDesktopMaps || 0) + (loc.impressionsMobileMaps || 0)) },
    { label: 'Search Impressions', value: fmtNum((loc.impressionsDesktopSearch || 0) + (loc.impressionsMobileSearch || 0)) },
    { label: 'Direction Requests', value: fmtNum(loc.directionRequests) },
    { label: 'Call Clicks',        value: fmtNum(loc.callClicks) },
    { label: 'Website Clicks',     value: fmtNum(loc.websiteClicks) },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 4 }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 8, padding: '6px 12px',
          fontSize: '0.78rem', minWidth: 110,
        }}>
          <div style={{ color: 'var(--muted)', marginBottom: 2 }}>{c.label}</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GbpAccountsPage() {
  const [accounts, setAccounts]     = useState([]);
  const [syncedAt, setSyncedAt]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [expandedAccountName, setExpandedAccountName] = useState(null);
  const [expandedLocationName, setExpandedLocationName] = useState(null);
  const [modal, setModal]           = useState({ open: false });
  const [toastMsg, setToastMsg]     = useState('');

  const toast     = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2500); };
  const closeModal = () => setModal({ open: false });

  // ── Load cached data on mount ─────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch('/api/gbp-accounts')
      .then(r => r.json())
      .then(data => {
        setAccounts(data.accounts || []);
        setSyncedAt(data.syncedAt || null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Sync from GBP API ─────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch('/api/gbp-accounts', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Sync failed');
      setAccounts(data.accounts || []);
      setSyncedAt(data.syncedAt || null);
      toast('Sync complete');
    } catch (e) {
      setError(e.message);
      toast('Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const searchLower = search.toLowerCase();
  const filteredAccounts = accounts.map(acc => ({
    ...acc,
    locations: (acc.locations || []).filter(loc =>
      !searchLower ||
      (loc.title || '').toLowerCase().includes(searchLower) ||
      (loc.address || '').toLowerCase().includes(searchLower) ||
      (loc.categories || '').toLowerCase().includes(searchLower)
    ),
  })).filter(acc =>
    !searchLower ||
    (acc.accountName || '').toLowerCase().includes(searchLower) ||
    acc.locations.length > 0
  );

  const totalLocations = filteredAccounts.reduce((sum, a) => sum + (a.locations?.length || 0), 0);

  return (
    <AuthGate>
      <ErrorBoundary>
        <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
          <NavBar />

          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 60px' }}>
            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className={styles.pageHeader}>
              <div>
                <h1 className={styles.pageTitle}>📍 Google Business Profile</h1>
                {syncedAt && (
                  <div className={styles.syncedAtMain}>
                    Last synced: {new Date(syncedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <button
                className="btn-primary"
                onClick={handleSync}
                disabled={syncing}
                style={{ minWidth: 120 }}
              >
                {syncing ? 'Syncing…' : '🔄 Sync Accounts'}
              </button>
            </div>

            {/* ── Error ──────────────────────────────────────────────────────── */}
            {error && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: '0.88rem',
              }}>
                {error}
              </div>
            )}

            {/* ── Loading ────────────────────────────────────────────────────── */}
            {loading && (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
                Loading accounts…
              </div>
            )}

            {/* ── Empty state ────────────────────────────────────────────────── */}
            {!loading && accounts.length === 0 && !error && (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <div className={styles.emptyIcon}>📍</div>
                <p style={{ fontWeight: 700, margin: '10px 0 6px' }}>No locations synced yet</p>
                <p className={styles.emptyHint}>
                  Click <strong>Sync Accounts</strong> to fetch your Google Business Profile locations.
                  Make sure the following env vars are set:
                </p>
                <ul className={styles.envList}>
                  <li>GBP_SERVICE_ACCOUNT_EMAIL</li>
                  <li>GBP_SERVICE_ACCOUNT_PRIVATE_KEY</li>
                  <li>GBP_DELEGATE_EMAIL</li>
                </ul>
              </div>
            )}

            {/* ── Search ─────────────────────────────────────────────────────── */}
            {!loading && accounts.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Search accounts, locations, categories…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                      flex: '1 1 240px', minWidth: 200,
                      padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--card-border)',
                      background: 'var(--card-bg)',
                      color: 'var(--foreground)',
                      fontSize: '0.9rem',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {filteredAccounts.length} account{filteredAccounts.length !== 1 ? 's' : ''} · {totalLocations} location{totalLocations !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* ── Accounts list ───────────────────────────────────────────── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {filteredAccounts.map(acc => {
                    const isExpanded = expandedAccountName === acc.name;
                    return (
                      <div key={acc.name} style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--card-border)',
                        borderRadius: 12, overflow: 'hidden',
                      }}>
                        {/* Account header */}
                        <button
                          onClick={() => setExpandedAccountName(isExpanded ? null : acc.name)}
                          style={{
                            width: '100%', textAlign: 'left', background: 'none',
                            border: 'none', cursor: 'pointer',
                            padding: '14px 18px',
                            display: 'flex', alignItems: 'center', gap: 12,
                          }}
                        >
                          <span style={{ fontSize: '1.1rem' }}>{isExpanded ? '▼' : '▶'}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{acc.accountName}</div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginTop: 2 }}>
                              {acc.name} · {acc.type || 'LOCATION_GROUP'} · {acc.locations?.length || 0} location{acc.locations?.length !== 1 ? 's' : ''}
                              {acc.verificationState && ` · ${acc.verificationState}`}
                            </div>
                          </div>
                        </button>

                        {/* Locations list */}
                        {isExpanded && (
                          <div style={{ borderTop: '1px solid var(--card-border)' }}>
                            {(acc.locations || []).length === 0 ? (
                              <div style={{ padding: '20px 18px', color: 'var(--muted)', fontSize: '0.88rem' }}>
                                No locations found for this account.
                              </div>
                            ) : (
                              (acc.locations || []).map(loc => {
                                const isLocExpanded = expandedLocationName === loc.name;
                                return (
                                  <div key={loc.name} style={{
                                    borderBottom: '1px solid var(--card-border)',
                                  }}>
                                    {/* Location row */}
                                    <button
                                      onClick={() => setExpandedLocationName(isLocExpanded ? null : loc.name)}
                                      style={{
                                        width: '100%', textAlign: 'left', background: 'none',
                                        border: 'none', cursor: 'pointer',
                                        padding: '12px 22px',
                                        display: 'flex', alignItems: 'flex-start', gap: 12,
                                      }}
                                    >
                                      <span style={{ fontSize: '0.9rem', marginTop: 2 }}>{isLocExpanded ? '▼' : '▶'}</span>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                          <span style={{ fontWeight: 600 }}>{loc.title || loc.name}</span>
                                          <OpenBadge status={loc.openInfo} />
                                          {loc.categories && (
                                            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                                              {loc.categories}
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 3 }}>
                                          {loc.address}
                                          {loc.phone && ` · ${loc.phone}`}
                                        </div>
                                      </div>
                                    </button>

                                    {/* Location detail */}
                                    {isLocExpanded && (
                                      <div style={{ padding: '4px 22px 16px 48px' }}>
                                        <InsightCards loc={loc} />
                                        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                                          {loc.websiteUri && (
                                            <a
                                              href={loc.websiteUri}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              style={{ fontSize: '0.8rem', color: 'var(--accent, #6366f1)' }}
                                            >
                                              🌐 Website
                                            </a>
                                          )}
                                          {loc.mapsUri && (
                                            <a
                                              href={loc.mapsUri}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              style={{ fontSize: '0.8rem', color: 'var(--accent, #6366f1)' }}
                                            >
                                              🗺 View on Maps
                                            </a>
                                          )}
                                          {loc.newReviewUri && (
                                            <a
                                              href={loc.newReviewUri}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              style={{ fontSize: '0.8rem', color: 'var(--accent, #6366f1)' }}
                                            >
                                              ⭐ Leave a Review
                                            </a>
                                          )}
                                        </div>
                                        <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
                                          {loc.name}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* insights footnote */}
                <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 10 }}>
                  Insight metrics show totals for the last 90 days.
                </p>
              </>
            )}

            {/* ── GBP Chat ────────────────────────────────────────────────────── */}
            <div style={{ marginTop: 48 }}>
              <h2 style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: 16 }}>
                💬 GBP AI Chat
              </h2>
              <ErrorBoundary>
                <Chat profile="gbp" persistChats />
              </ErrorBoundary>
            </div>
          </div>

          {/* ── Toast ─────────────────────────────────────────────────────────── */}
          {toastMsg && (
            <div style={{
              position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: 10, padding: '10px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              fontSize: '0.9rem', zIndex: 9999,
            }}>
              {toastMsg}
            </div>
          )}

          <AppModal {...modal} onClose={closeModal} />
        </div>
      </ErrorBoundary>
    </AuthGate>
  );
}
