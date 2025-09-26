import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import ErrorBoundary from '../components/ErrorBoundary';
// Load react-chartjs-2 Line component only on the client to avoid SSR issues
const Line = dynamic(() => import('react-chartjs-2').then(mod => mod.Line), { ssr: false });

// Chart.js modules will be registered client-side in a useEffect below.

function formatDate(d) {
  const dt = new Date(d);
  return dt.toISOString().split('T')[0];
}

// decimals configuration per metric
function getDecimalsForMetric(metric) {
  if (!metric) return 2;
  const m = metric.toLowerCase();
  if (m === 'volume') return 0;
  if (m === 'percent' || m.endsWith('%') || m.includes('percent')) return 2;
  // default for prices
  return 2;
}

function formatNumber(n, metric) {
  const v = Number(n);
  if (!isFinite(v)) return n;
  const dp = getDecimalsForMetric(metric);
  return v.toFixed(dp);
}

function formatVolume(v) {
  const n = Number(v);
  if (!isFinite(n)) return v;
  return Math.round(n).toLocaleString();
}

export default function StocksPage() {
  const [ticker, setTicker] = useState('AAPL');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [range, setRange] = useState('1y'); // options: 1m, 3m, 6m, 1y, 5y, all
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [metric, setMetric] = useState('close'); // close, open, high, low, volume
  const [aggregateBy, setAggregateBy] = useState('none'); // none, weekly, monthly
  const [useFullResolution, setUseFullResolution] = useState(false);
  const [maxPoints, setMaxPoints] = useState(1000);
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' or 'desc'
  const [error, setError] = useState(null);
  const [chartReady, setChartReady] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [cachedList, setCachedList] = useState([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [activeMenuTicker, setActiveMenuTicker] = useState(null);

  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/finnhub-search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        const list = (json.result || []).slice(0, 12).map(i => ({ symbol: i.symbol, description: i.description }));
        setSuggestions(list);
        setShowSuggestions(list.length > 0);
      } catch (e) {
        // ignore
      }
    }, 300);

    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    fetchCachedList();
  }, []);

  useEffect(() => {
    // debug visibility
    if (chartReady) console.info('Chart registration complete - chartReady=true');
    else console.info('Chart not ready yet - chartReady=false');
  }, [chartReady]);

  const fetchCachedList = async () => {
    try {
      const res = await fetch('/api/stock-cache');
      const json = await res.json();
      if (res.ok) setCachedList(json.data || []);
    } catch (e) {
      // ignore
    }
  };

  const fetchHistory = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/stock-history?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');
      setHistory(data.data || []);
      // refresh cached list after a successful fetch/upsert
      await fetchCachedList();
    } catch (e) {
      setError(e.message);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!history || history.length === 0) return;
    const header = ['date,open,high,low,close,volume'];
    const rows = history.map(r => `${formatDate(r.date)},${r.open},${r.high},${r.low},${r.close},${r.volume}`);
    const csv = header.concat(rows).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ticker}_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latest = history && history.length ? history[history.length - 1] : null;

  // Register Chart.js modules on the client only
  useEffect(() => {
    let mounted = true;
    (async () => {
      console.info('Starting Chart.js dynamic registration...');
      if (!mounted) return;
      try {
        const ChartJSModule = await import('chart.js');
        const ChartJS = ChartJSModule.default || ChartJSModule;

        // Resolve named exports from either the module or its default
        const CategoryScale = ChartJSModule.CategoryScale || (ChartJSModule.default && ChartJSModule.default.CategoryScale);
        const LinearScale = ChartJSModule.LinearScale || (ChartJSModule.default && ChartJSModule.default.LinearScale);
        const PointElement = ChartJSModule.PointElement || (ChartJSModule.default && ChartJSModule.default.PointElement);
        const LineElement = ChartJSModule.LineElement || (ChartJSModule.default && ChartJSModule.default.LineElement);
        const Tooltip = ChartJSModule.Tooltip || (ChartJSModule.default && ChartJSModule.default.Tooltip);
        const TimeScale = ChartJSModule.TimeScale || (ChartJSModule.default && ChartJSModule.default.TimeScale);
        const Legend = ChartJSModule.Legend || (ChartJSModule.default && ChartJSModule.default.Legend);

        // Try to load the date adapter but don't fail registration if adapter load errors; log it.
        try {
          await import('chartjs-adapter-date-fns');
        } catch (adapterErr) {
          console.warn('chart date adapter load failed', adapterErr);
        }

        if (ChartJS && ChartJS.register && CategoryScale && LinearScale && PointElement && LineElement && Tooltip && TimeScale && Legend) {
          ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, TimeScale, Legend);
          setChartReady(true);
          setChartError(null);
        } else {
          // Fallback: try importing chart.js/auto which auto-registers everything in one go
          try {
            const auto = await import('chart.js/auto');
            // ensure adapter loaded
            try { await import('chartjs-adapter-date-fns'); } catch (e) { console.warn('adapter load failed in auto fallback', e); }
            if (auto) {
              console.info('chart.js/auto loaded as fallback');
              setChartReady(true);
              setChartError(null);
            } else {
              const msg = 'ChartJS registration skipped, missing modules and auto fallback failed';
              console.warn(msg, { ChartJS: !!ChartJS, auto: !!auto });
              setChartError(msg + ' (see console for details)');
            }
          } catch (autoErr) {
            const msg = 'ChartJS registration skipped, missing modules and auto import failed';
            console.warn(msg, autoErr, { ChartJS: !!ChartJS, CategoryScale: !!CategoryScale, LinearScale: !!LinearScale, PointElement: !!PointElement, LineElement: !!LineElement, Tooltip: !!Tooltip, TimeScale: !!TimeScale, Legend: !!Legend });
            setChartError(msg + ' (see console for details)');
          }
        }
      } catch (e) {
        // swallow errors during SSR or dynamic load
        console.warn('chartjs dynamic load failed', e);
        setChartError(String(e && (e.message || e)) || 'Unknown chart load error');
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Convert history into sorted time series (date asc)
  const series = useMemo(() => {
    if (!history || history.length === 0) return [];
    // Ensure dates are Date objects
    return history.map(h => ({ ...h, date: new Date(h.date) })).sort((a, b) => a.date - b.date);
  }, [history]);

  // Apply time range filter
  const filteredSeries = useMemo(() => {
    if (!series.length) return [];
    const end = new Date();
    let start = new Date(0);
    if (range === '1m') { start = new Date(); start.setMonth(start.getMonth() - 1); }
    else if (range === '3m') { start = new Date(); start.setMonth(start.getMonth() - 3); }
    else if (range === '6m') { start = new Date(); start.setMonth(start.getMonth() - 6); }
    else if (range === '1y') { start = new Date(); start.setFullYear(start.getFullYear() - 1); }
    else if (range === '5y') { start = new Date(); start.setFullYear(start.getFullYear() - 5); }
    else start = new Date(0);

    return series.filter(s => s.date >= start && s.date <= end);
  }, [series, range]);

  // Apply aggregation and downsample for chart performance
  const sampled = useMemo(() => {
    let data = filteredSeries.slice();

    // aggregation
    if (aggregateBy === 'weekly' && data.length > 0) {
      const buckets = {};
      data.forEach(d => {
        const dt = new Date(d.date);
        const week = Math.floor((dt - new Date(dt.getFullYear(),0,1)) / (7 * 24 * 3600 * 1000));
        const key = `${dt.getFullYear()}-w${week}`;
        // keep the last point in the bucket
        if (!buckets[key] || buckets[key].date < d.date) buckets[key] = d;
      });
      data = Object.values(buckets).sort((a,b)=>a.date-b.date);
    } else if (aggregateBy === 'monthly' && data.length > 0) {
      const buckets = {};
      data.forEach(d => {
        const dt = new Date(d.date);
        const key = `${dt.getFullYear()}-${dt.getMonth()+1}`;
        if (!buckets[key] || buckets[key].date < d.date) buckets[key] = d;
      });
      data = Object.values(buckets).sort((a,b)=>a.date-b.date);
    }

    if (useFullResolution) return data;

    if (!maxPoints || maxPoints === 'all') return data;
    const mp = parseInt(maxPoints, 10) || 1000;
    const n = data.length;
    if (n <= mp) return data;
    const step = Math.ceil(n / mp);
    return data.filter((_, i) => i % step === 0);
  }, [filteredSeries, aggregateBy, useFullResolution, maxPoints]);

  // Sorting for preview table
  const sortedFilteredSeries = useMemo(() => {
    const arr = filteredSeries.slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va = a[sortBy];
      let vb = b[sortBy];
      if (sortBy === 'date') { va = new Date(va); vb = new Date(vb); }
      if (typeof va === 'string' && !isFinite(Number(va))) return 0;
      const na = Number(va);
      const nb = Number(vb);
      if (isFinite(na) && isFinite(nb)) return (na - nb) * dir;
      // fallback to string compare
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filteredSeries, sortBy, sortDir]);

  // Chart data
  const chartData = useMemo(() => ({
    labels: sampled.map(s => s.date),
    datasets: [
      {
        label: `${ticker} ${metric}`,
        data: sampled.map(s => s[metric]),
        borderColor: 'rgba(75,192,192,1)',
        backgroundColor: 'rgba(75,192,192,0.2)',
        pointRadius: 0,
        borderWidth: 1.25,
      },
    ],
  }), [sampled, ticker, metric]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { type: 'time', time: { unit: 'day' } },
      y: { beginAtZero: false },
    },
    plugins: { legend: { display: true } },
  }), []);

  // clamp page when data or pageSize changes
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredSeries.length / pageSize));
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [filteredSeries.length, pageSize]);

  return (
    <ErrorBoundary>
    <AuthGate>
      <NavBar />
      <style jsx>{`
        .sidebar-row { position: relative; margin-bottom: 6px; }
        .sidebar-item { border-radius: 6px; background: #222; cursor: pointer; padding: 8px; }
        .menu-button { position: absolute; right: -8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #ccc; cursor: pointer; font-size: 18px; opacity: 0; transition: opacity .12s; }
        .sidebar-row:hover .menu-button { opacity: 1; }
        .menu-dropdown { position: absolute; right: 8px; top: calc(50% + 18px); background: #0f1720; border: 1px solid #2b2b2b; box-shadow: 0 8px 24px rgba(2,6,23,0.6); z-index: 80; min-width: 160px; border-radius: 8px; overflow: hidden; }
        .menu-dropdown button { display: block; width: 100%; padding: 10px 12px; text-align: left; background: none; border: none; color: #e6eef8; }
        .menu-dropdown button:hover { background: rgba(255,255,255,0.03); }
        .menu-title { font-weight: 700; color: #fff; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); }
      `}</style>
      <div style={{ display: 'flex' }}>
        <aside style={{ width: 260, position: 'sticky', top: 76, height: 'calc(100vh - 76px)', padding: '12px', background: '#111', overflowY: 'auto' }}>
          <div style={{ color: '#ccc', fontSize: 14, marginBottom: 8 }}>Saved tickers</div>
          {cachedList.length === 0 && <div style={{ color: '#666' }}>No cached tickers</div>}
          {cachedList.map((c) => (
            <div key={c.ticker} className="sidebar-row">
              <div className="sidebar-item" onClick={async () => { setTicker(c.ticker); await fetchHistory(); }}>
                <div style={{ fontWeight: 700 }}>{c.company_name ? `${c.company_name} (${c.ticker})` : c.ticker}</div>
                <div style={{ fontSize: 12, color: '#999' }}>updated: {c.updated_at ? new Date(c.updated_at).toLocaleString() : c.start_date}</div>
              </div>

              <button
                className="menu-button"
                onClick={(e) => { e.stopPropagation(); setActiveMenuTicker(activeMenuTicker === c.ticker ? null : c.ticker); }}
                aria-label="options"
              >⋯</button>

              {activeMenuTicker === c.ticker && (
                <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
                  <div className="menu-title">{c.ticker}</div>
                  <button onClick={async () => { const name = prompt('Enter display name:'); if (name !== null) { await fetch('/api/stock-cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: c.ticker, display_name: name }) }); await fetchCachedList(); setActiveMenuTicker(null); } }}>Rename</button>
                  <button onClick={async () => { if (!confirm(`Delete ${c.ticker}?`)) return; await fetch(`/api/stock-cache?ticker=${encodeURIComponent(c.ticker)}`, { method: 'DELETE' }); await fetchCachedList(); setActiveMenuTicker(null); }}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </aside>
        <div style={{ padding: 24, marginLeft: 50, flex: 1 }}>
          <h1>Stock History</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <input
              value={query || ticker}
              onChange={e => { setQuery(e.target.value); setTicker(e.target.value.toUpperCase()); }}
              onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
                else if (e.key === 'ArrowUp') { setActiveIdx(i => Math.max(i - 1, 0)); }
                else if (e.key === 'Enter') { if (activeIdx >= 0 && suggestions[activeIdx]) { const s = suggestions[activeIdx]; setTicker(s.symbol); setQuery(''); setShowSuggestions(false); } }
              }}
            />
            {showSuggestions && (
              <div style={{ position: 'absolute', left: 0, top: '100%', background: '#111', border: '1px solid #333', width: 320, maxHeight: 260, overflowY: 'auto', zIndex: 50 }}>
                {suggestions.map((s, idx) => (
                  <div key={s.symbol} onMouseDown={() => { setTicker(s.symbol); setQuery(''); setShowSuggestions(false); }}
                    style={{ padding: 8, background: idx === activeIdx ? '#222' : 'transparent', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 700 }}>{s.symbol}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{s.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={fetchHistory} disabled={loading}>{loading ? 'Loading...' : 'Fetch'}</button>
          <button onClick={async () => { setLoading(true); try { const res = await fetch(`/api/stock-history?ticker=${encodeURIComponent(ticker)}&force=1`); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Failed'); setHistory(data.data || []); await fetchCachedList(); } catch (e) { setError(e.message); } finally { setLoading(false); } }} disabled={loading}>Refresh</button>
          <button onClick={downloadCSV} disabled={!history || history.length === 0}>Download CSV</button>
        </div>

        {error && <div style={{ color: 'red', marginTop: 12 }}>{error}</div>}

        {latest && (
          <div style={{ marginTop: 16 }}>
            <h3>{ticker} — Latest</h3>
            <div>Date: {formatDate(latest.date)}</div>
            <div>Close: {formatNumber(latest.close)}</div>
            <div>Open: {formatNumber(latest.open)}</div>
            <div>High: {formatNumber(latest.high)}</div>
            <div>Low: {formatNumber(latest.low)}</div>
            <div>Volume: {formatVolume(latest.volume)}</div>
            <div style={{ marginTop: 12 }}>
              <strong>Data points:</strong> {history.length}
            </div>
          </div>
        )}

        {history && history.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3>Chart</h3>
            <div style={{ height: 360, background: '#0b1220', padding: 12, borderRadius: 8 }}>
              {chartReady ? (
                <Line data={chartData} options={chartOptions} />
              ) : chartError ? (
                <div style={{ color: '#f88', padding: 18 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Chart failed to load</div>
                  <div style={{ color: '#fbb', marginBottom: 12 }}>{chartError}</div>
                  <div style={{ color: '#ccc', marginBottom: 12 }}>Open the browser console for details.</div>
                  <div>
                    <button onClick={() => window.location.reload()}>Reload page</button>
                    <button onClick={() => (window.location.href = '/')} style={{ marginLeft: 8 }}>Go Home</button>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#999', padding: 24 }}>Loading chart...</div>
              )}
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div title="Choose time window to display on chart">
                <label>Range: </label>
                <select value={range} onChange={e => { setRange(e.target.value); setPage(1); }} title="Choose time window to display on chart">
                  <option value="1m">1M</option>
                  <option value="3m">3M</option>
                  <option value="6m">6M</option>
                  <option value="1y">1Y</option>
                  <option value="5y">5Y</option>
                  <option value="all">All</option>
                </select>
              </div>

              <div title="Metric shown on the chart">
                <label>Metric: </label>
                <select value={metric} onChange={e => setMetric(e.target.value)} title="Metric shown on the chart">
                  <option value="close">Close</option>
                  <option value="open">Open</option>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                  <option value="volume">Volume</option>
                </select>
              </div>

              <div title="Aggregate data into weekly or monthly buckets to reduce noise">
                <label>Aggregate: </label>
                <select value={aggregateBy} onChange={e => setAggregateBy(e.target.value)} title="Aggregate data into weekly or monthly buckets to reduce noise">
                  <option value="none">None</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div title="When checked, chart will try to show full resolution (may be slow)">
                <label>Full res: </label>
                <input type="checkbox" checked={useFullResolution} onChange={e => setUseFullResolution(e.target.checked)} title="When checked, chart will try to show full resolution (may be slow)" />
              </div>

              <div title="Maximum number of points to keep for the chart when not using full resolution">
                <label>Max points: </label>
                <input type="number" value={maxPoints} onChange={e => setMaxPoints(e.target.value)} style={{ width: 80 }} title="Maximum number of points to keep for the chart when not using full resolution" />
              </div>

              <div>
                <label>Items per page: </label>
                <select value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            <h3 style={{ marginTop: 18 }}>Preview</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', cursor: 'pointer' }} onClick={() => { setSortBy('date'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>Date {sortBy === 'date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th style={{ borderBottom: '1px solid #ccc', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setSortBy('open'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>Open {sortBy === 'open' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th style={{ borderBottom: '1px solid #ccc', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setSortBy('high'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>High {sortBy === 'high' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th style={{ borderBottom: '1px solid #ccc', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setSortBy('low'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>Low {sortBy === 'low' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th style={{ borderBottom: '1px solid #ccc', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setSortBy('close'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>Close {sortBy === 'close' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th style={{ borderBottom: '1px solid #ccc', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setSortBy('volume'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>Volume {sortBy === 'volume' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const total = sortedFilteredSeries.length;
                  const start = Math.max(0, total - (page * pageSize));
                  const end = Math.max(0, total - ((page - 1) * pageSize));
                  const pageItems = sortedFilteredSeries.slice(start, end).reverse();
                  return pageItems.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', textAlign: 'left' }}>{formatDate(r.date)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>{formatNumber(r.open, 'price')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>{formatNumber(r.high, 'price')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>{formatNumber(r.low, 'price')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>{formatNumber(r.close, 'price')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>{formatVolume(r.volume)}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>

            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
              <div>Page {page} / {Math.max(1, Math.ceil(filteredSeries.length / pageSize))}</div>
              <button onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(filteredSeries.length / pageSize)), p + 1))} disabled={(page * pageSize) >= filteredSeries.length}>Next</button>
              <div style={{ marginLeft: 12, color: '#999' }}>{filteredSeries.length} points</div>
            </div>
          </div>
        )}
        </div>
      </div>
    </AuthGate>
    </ErrorBoundary>
  );
}
