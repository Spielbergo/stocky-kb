import { useState, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import ErrorBoundary from '../components/ErrorBoundary';
import AppModal from '../components/ConfirmModal';
const Line = dynamic(() => import('react-chartjs-2').then(mod => mod.Line), { ssr: false });

function formatDate(d) {
  const dt = new Date(d);
  return dt.toISOString().split('T')[0];
}
function fmtMonthYear(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function getDecimalsForMetric(metric) {
  if (!metric) return 2;
  const m = metric.toLowerCase();
  if (m === 'volume') return 0;
  return 2;
}
function formatNumber(n, metric) {
  const v = Number(n);
  if (!isFinite(v)) return n;
  return v.toFixed(getDecimalsForMetric(metric));
}
function formatVolume(v) {
  const n = Number(v);
  if (!isFinite(n)) return v;
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)         return (n / 1_000).toFixed(0) + 'K';
  return Math.round(n).toLocaleString();
}
function calcYears(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const ms = new Date(endStr) - new Date(startStr);
  return (ms / (365.25 * 24 * 3600 * 1000)).toFixed(1);
}

const FETCH_PERIODS = [
  { value: '1y',  label: '1Y' },
  { value: '3y',  label: '3Y' },
  { value: '5y',  label: '5Y' },
  { value: '10y', label: '10Y' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const CHART_RANGES = ['1m','3m','6m','1y','5y','all'];
const METRICS = [
  { value: 'close',  label: 'Close' },
  { value: 'open',   label: 'Open' },
  { value: 'high',   label: 'High' },
  { value: 'low',    label: 'Low' },
  { value: 'volume', label: 'Volume' },
];

export default function StocksPage() {
  // â”€â”€ Ticker / search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [ticker, setTicker]           = useState('AAPL');
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg]       = useState(false);
  const [activeIdx, setActiveIdx]     = useState(-1);

  // â”€â”€ Fetch period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [fetchPeriod, setFetchPeriod] = useState('10y');
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');

  // â”€â”€ Data / state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [loading, setLoading]         = useState(false);
  const [history, setHistory]         = useState([]);
  const [stockMeta, setStockMeta]     = useState(null); // { startDate, endDate, cached, updated_at }
  const [error, setError]             = useState(null);
  const [cachedList, setCachedList]   = useState([]);
  const [cachedLoading, setCachedLoading] = useState(false);
  const [activeTicker, setActiveTicker]   = useState(null); // ticker whose data is loaded

  // â”€â”€ Chart display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [range, setRange]               = useState('1y');
  const [metric, setMetric]             = useState('close');
  const [aggregateBy, setAggregateBy]   = useState('none');
  const [chartReady, setChartReady]     = useState(false);
  const [chartError, setChartError]     = useState(null);

  // â”€â”€ Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage]         = useState(1);
  const [sortBy, setSortBy]     = useState('date');
  const [sortDir, setSortDir]   = useState('desc');

  // â”€â”€ Sidebar menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activeMenuTicker, setActiveMenuTicker] = useState(null);

  // â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [toastMsg, setToastMsg] = useState('');
  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2500); };

  // ── CSV Import ────────────────────────────────────────────────────────────────
  const [importTicker, setImportTicker] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const csvFileRef = useRef(null);

  // â”€â”€ Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [modal, setModal]               = useState({ open: false });
  const [modalInputValue, setModalInputValue] = useState('');
  const modalInputValueRef              = useRef('');
  const closeModal  = () => { setModal({ open: false }); setModalInputValue(''); };
  const showAlert   = (message, title = 'Notice') =>
    setModal({ open: true, variant: 'alert', title, message });
  const showConfirm = (message, onConfirm, title = 'Are you sure?') =>
    setModal({ open: true, variant: 'confirm', title, message, onConfirm });
  const handleRenameTicker = (t) => {
    modalInputValueRef.current = '';
    setModalInputValue('');
    setModal({
      open: true, variant: 'input', title: `Rename ${t}`,
      inputPlaceholder: 'Enter display name...',
      onConfirm: async () => {
        const name = modalInputValueRef.current.trim();
        if (!name) return;
        closeModal();
        await fetch('/api/stock-cache', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: t, display_name: name }),
        });
        await fetchCachedList();
        setActiveMenuTicker(null);
      },
    });
  };

  // â”€â”€ Autocomplete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!query) { setSuggestions([]); setShowSugg(false); return; }
    const id = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/finnhub-search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        const list = (json.result || []).slice(0, 12).map(i => ({ symbol: i.symbol, description: i.description }));
        setSuggestions(list);
        setShowSugg(list.length > 0);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  // â”€â”€ Cached list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => { fetchCachedList(); }, []);

  const fetchCachedList = async () => {
    setCachedLoading(true);
    try {
      const res  = await fetch('/api/stock-cache');
      const json = await res.json();
      if (res.ok) setCachedList(json.data || []);
    } catch { /* ignore */ } finally { setCachedLoading(false); }
  };

  // â”€â”€ Fetch history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchHistory = async (tickerVal, periodVal, force = false) => {
    const t = tickerVal || ticker;
    const p = periodVal || fetchPeriod;
    if (p === 'custom' && (!customStart || !customEnd)) {
      showAlert('Please set both a start and end date for the custom range.', 'Custom Range Required');
      return;
    }
    setError(null);
    setLoading(true);
    setTicker(t);
    try {
      const params = new URLSearchParams({ ticker: t, period: p });
      if (p === 'custom') { params.set('startDate', customStart); params.set('endDate', customEnd); }
      if (force) params.set('force', '1');
      const res  = await fetch(`/api/stock-history?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');
      setHistory(data.data || []);
      setStockMeta({
        startDate:  data.startDate,
        endDate:    data.endDate,
        cached:     data.cached,
        updated_at: data.updated_at,
      });
      setActiveTicker(t);
      setPage(1);
      await fetchCachedList();
    } catch (e) {
      setError(e.message);
      setHistory([]);
      setStockMeta(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Download CSV ──────────────────────────────────────────────────────────────
  const downloadCSV = () => {
    if (!history.length) return;
    const header = ['date,open,high,low,close,volume'];
    const rows   = history.map(r => `${formatDate(r.date)},${r.open},${r.high},${r.low},${r.close},${r.volume}`);
    const blob   = new Blob([header.concat(rows).join('\n')], { type: 'text/csv' });
    const a      = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ticker}_history.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Import CSV ────────────────────────────────────────────────────────────────
  const importCSV = async (file) => {
    const t = importTicker.trim().toUpperCase() || ticker;
    if (!t) { showAlert('Enter a ticker symbol before importing.', 'Ticker Required'); return; }
    if (!file) return;
    setImportLoading(true);
    try {
      const text = await file.text();
      const res  = await fetch('/api/stock-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, csv: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      toast(`Imported ${json.imported} rows for ${json.ticker}${json.skipped ? ` (${json.skipped} skipped)` : ''}`);
      await fetchCachedList();
      if (csvFileRef.current) csvFileRef.current.value = '';
    } catch (e) {
      showAlert(e.message, 'Import Failed');
    } finally {
      setImportLoading(false);
    }
  };

  // â”€â”€ Chart.js registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      try {
        const ChartJSModule  = await import('chart.js');
        const ChartJS        = ChartJSModule.default || ChartJSModule;
        const CategoryScale  = ChartJSModule.CategoryScale  || ChartJS?.CategoryScale;
        const LinearScale    = ChartJSModule.LinearScale    || ChartJS?.LinearScale;
        const PointElement   = ChartJSModule.PointElement   || ChartJS?.PointElement;
        const LineElement    = ChartJSModule.LineElement    || ChartJS?.LineElement;
        const Tooltip        = ChartJSModule.Tooltip        || ChartJS?.Tooltip;
        const TimeScale      = ChartJSModule.TimeScale      || ChartJS?.TimeScale;
        const Legend         = ChartJSModule.Legend         || ChartJS?.Legend;
        try { await import('chartjs-adapter-date-fns'); } catch (e) { console.warn('date adapter', e); }
        if (ChartJS?.register && CategoryScale && LinearScale && PointElement && LineElement && Tooltip && TimeScale && Legend) {
          ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, TimeScale, Legend);
          if (mounted) { setChartReady(true); setChartError(null); }
        } else {
          const auto = await import('chart.js/auto');
          try { await import('chartjs-adapter-date-fns'); } catch { /* ignore */ }
          if (auto && mounted) { setChartReady(true); setChartError(null); }
        }
      } catch (e) {
        console.warn('chartjs load failed', e);
        if (mounted) setChartError(String(e?.message || e) || 'Chart load error');
      }
    })();
    return () => { mounted = false; };
  }, []);

  // â”€â”€ Derived series â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const series = useMemo(() => {
    if (!history.length) return [];
    return history.map(h => ({ ...h, date: new Date(h.date) })).sort((a, b) => a.date - b.date);
  }, [history]);

  const filteredSeries = useMemo(() => {
    if (!series.length) return [];
    const end   = new Date();
    let   start = new Date(0);
    if      (range === '1m') { start = new Date(); start.setMonth(start.getMonth() - 1); }
    else if (range === '3m') { start = new Date(); start.setMonth(start.getMonth() - 3); }
    else if (range === '6m') { start = new Date(); start.setMonth(start.getMonth() - 6); }
    else if (range === '1y') { start = new Date(); start.setFullYear(start.getFullYear() - 1); }
    else if (range === '5y') { start = new Date(); start.setFullYear(start.getFullYear() - 5); }
    return series.filter(s => s.date >= start && s.date <= end);
  }, [series, range]);

  const sampled = useMemo(() => {
    let data = filteredSeries.slice();
    if (aggregateBy === 'weekly' && data.length > 0) {
      const buckets = {};
      data.forEach(d => {
        const dt = new Date(d.date);
        const wk = Math.floor((dt - new Date(dt.getFullYear(),0,1)) / (7*24*3600*1000));
        const k  = `${dt.getFullYear()}-w${wk}`;
        if (!buckets[k] || buckets[k].date < d.date) buckets[k] = d;
      });
      data = Object.values(buckets).sort((a,b) => a.date - b.date);
    } else if (aggregateBy === 'monthly' && data.length > 0) {
      const buckets = {};
      data.forEach(d => {
        const dt = new Date(d.date);
        const k  = `${dt.getFullYear()}-${dt.getMonth()+1}`;
        if (!buckets[k] || buckets[k].date < d.date) buckets[k] = d;
      });
      data = Object.values(buckets).sort((a,b) => a.date - b.date);
    }
    const n  = data.length;
    const mp = 1000;
    if (n <= mp) return data;
    const step = Math.ceil(n / mp);
    return data.filter((_, i) => i % step === 0);
  }, [filteredSeries, aggregateBy]);

  const sortedFilteredSeries = useMemo(() => {
    const arr = filteredSeries.slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'date') { va = new Date(va); vb = new Date(vb); }
      const na = Number(va), nb = Number(vb);
      if (isFinite(na) && isFinite(nb)) return (na - nb) * dir;
      return String(va) < String(vb) ? -dir : dir;
    });
    return arr;
  }, [filteredSeries, sortBy, sortDir]);

  // â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const stats = useMemo(() => {
    if (!series.length) return null;
    const last = series[series.length - 1];
    const cutoff52 = new Date(); cutoff52.setFullYear(cutoff52.getFullYear() - 1);
    const w52 = series.filter(s => s.date >= cutoff52);
    const high52  = w52.length ? Math.max(...w52.map(s => s.high))   : null;
    const low52   = w52.length ? Math.min(...w52.map(s => s.low))    : null;
    const vol30   = (() => {
      const cut = new Date(); cut.setDate(cut.getDate() - 30);
      const sl  = series.filter(s => s.date >= cut);
      return sl.length ? Math.round(sl.reduce((a,b) => a + b.volume, 0) / sl.length) : null;
    })();
    const years = calcYears(series[0].date.toISOString(), last.date.toISOString());
    return { last, high52, low52, vol30, years, points: series.length };
  }, [series]);

  const chartData = useMemo(() => ({
    labels: sampled.map(s => s.date),
    datasets: [{
      label: `${ticker} ${metric}`,
      data:  sampled.map(s => s[metric]),
      borderColor:     'var(--accent)',
      backgroundColor: 'rgba(22,163,74,0.08)',
      pointRadius: 0,
      borderWidth: 1.5,
    }],
  }), [sampled, ticker, metric]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { type: 'time', time: { unit: 'day' }, grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: 'var(--muted)' } },
      y: { beginAtZero: false, grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: 'var(--muted)' } },
    },
    plugins: { legend: { display: false } },
  }), []);

  // clamp page
  useEffect(() => {
    const total = Math.max(1, Math.ceil(filteredSeries.length / pageSize));
    if (page > total) setPage(total);
  }, [filteredSeries.length, pageSize]);

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <ErrorBoundary>
    <AuthGate>
      <NavBar />
      <div className="admin-layout">

        {/* â”€â”€ Sidebar â”€â”€ */}
        <aside className="admin-sidebar">

          {/* Header badge */}
          <div className="sidebar-profile-badge">
            <div className="sidebar-profile-icon">ðŸ“ˆ</div>
            <div>
              <div className="sidebar-profile-label">Markets</div>
              <div className="sidebar-profile-sub">Stock History</div>
            </div>
          </div>

          {/* Fetch section */}
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Fetch History</h3>

            {/* Ticker search */}
            <div style={{ position: 'relative', marginBottom: 9 }}>
              <input
                className="sidebar-input"
                style={{ marginBottom: 0 }}
                placeholder="Ticker symbol..."
                value={query || ticker}
                onChange={e => { setQuery(e.target.value); setTicker(e.target.value.toUpperCase()); }}
                onFocus={() => { if (suggestions.length) setShowSugg(true); }}
                onBlur={() => setTimeout(() => setShowSugg(false), 150)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') setActiveIdx(i => Math.min(i+1, suggestions.length-1));
                  else if (e.key === 'ArrowUp') setActiveIdx(i => Math.max(i-1, 0));
                  else if (e.key === 'Enter' && activeIdx >= 0 && suggestions[activeIdx]) {
                    const s = suggestions[activeIdx];
                    setTicker(s.symbol); setQuery(''); setShowSugg(false); setActiveIdx(-1);
                  }
                }}
              />
              {showSugg && suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', left: 0, top: '100%', width: '100%',
                  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                  borderRadius: 7, zIndex: 50, maxHeight: 220, overflowY: 'auto',
                  boxShadow: 'var(--shadow)',
                }}>
                  {suggestions.map((s, idx) => (
                    <div
                      key={s.symbol}
                      onMouseDown={() => { setTicker(s.symbol); setQuery(''); setShowSugg(false); setActiveIdx(-1); }}
                      style={{
                        padding: '7px 10px', cursor: 'pointer',
                        background: idx === activeIdx ? 'var(--input-bg)' : 'transparent',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{s.symbol}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Period selector */}
            <div className="chart-toolbar-label" style={{ marginBottom: 6 }}>Period to fetch</div>
            <div className="period-btn-group">
              {FETCH_PERIODS.map(p => (
                <button
                  key={p.value}
                  className={`period-btn${fetchPeriod === p.value ? ' active' : ''}`}
                  onClick={() => setFetchPeriod(p.value)}
                >{p.label}</button>
              ))}
            </div>

            {/* Custom date range */}
            {fetchPeriod === 'custom' && (
              <div style={{ marginBottom: 6 }}>
                <div className="chart-toolbar-label" style={{ marginBottom: 4 }}>From</div>
                <input type="date" className="sidebar-input" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ marginBottom: 6 }} />
                <div className="chart-toolbar-label" style={{ marginBottom: 4 }}>To</div>
                <input type="date" className="sidebar-input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            )}

            {/* Fetch + Refresh buttons */}
            <button
              className="upload-btn"
              style={{ marginBottom: 5 }}
              onClick={() => fetchHistory(ticker, fetchPeriod)}
              disabled={loading}
            >
              {loading ? 'Fetchingâ€¦' : 'Fetch History'}
            </button>
            <button
              className="upload-btn"
              style={{ background: 'var(--input-bg)', color: 'var(--foreground)', border: '1px solid var(--card-border)' }}
              onClick={() => fetchHistory(ticker, fetchPeriod, true)}
              disabled={loading}
            >
              Force Refresh
            </button>
          </div>

          {/* Import CSV section */}
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Import CSV</h3>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 8, lineHeight: 1.4 }}>
              Upload a CSV with columns: <code style={{ background: 'var(--input-bg)', padding: '1px 4px', borderRadius: 3 }}>date, open, high, low, close, volume</code>
            </div>
            <input
              className="sidebar-input"
              style={{ marginBottom: 6 }}
              placeholder="Ticker (e.g. AAPL)"
              value={importTicker}
              onChange={e => setImportTicker(e.target.value.toUpperCase())}
            />
            <label
              htmlFor="csv-file-input"
              className="upload-btn"
              style={{
                display: 'block', textAlign: 'center', cursor: importLoading ? 'not-allowed' : 'pointer',
                opacity: importLoading ? 0.6 : 1,
              }}
            >
              {importLoading ? 'Importing…' : '↑ Choose CSV File'}
            </label>
            <input
              id="csv-file-input"
              ref={csvFileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              disabled={importLoading}
              onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); }}
            />
          </div>

          {/* Cached tickers list */}
          <div className="sidebar-section sidebar-list-section" style={{ flex: 1 }}>
            <h3 className="sidebar-section-title">
              Cached Tickers <span className="count-badge">{cachedList.length}</span>
            </h3>
            <ul className="sidebar-list" style={{ maxHeight: 'none' }}>
              {cachedLoading && (
                <li className="sidebar-empty">Loadingâ€¦</li>
              )}
              {!cachedLoading && cachedList.length === 0 && (
                <li className="sidebar-empty">No cached tickers yet</li>
              )}
              {!cachedLoading && cachedList.map(c => {
                const yrs = calcYears(c.start_date, c.end_date);
                const isActive = activeTicker === c.ticker;
                return (
                  <li
                    key={c.ticker}
                    className={`sidebar-item${isActive ? ' active' : ''}`}
                    style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, position: 'relative', paddingRight: 28 }}
                    onClick={() => fetchHistory(c.ticker, fetchPeriod)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <span className="sidebar-item-label" style={{ fontWeight: 700 }}>
                        {c.company_name ? `${c.ticker}` : c.ticker}
                      </span>
                      {yrs && <span className="sidebar-item-meta">{yrs}y</span>}
                    </div>
                    {c.company_name && (
                      <div className="stock-cache-meta">{c.company_name}</div>
                    )}
                    {c.start_date && c.end_date && (
                      <div className="stock-cache-meta">
                        {fmtMonthYear(c.start_date)} â€“ {fmtMonthYear(c.end_date)}
                      </div>
                    )}

                    {/* â‹¯ menu */}
                    <button
                      style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 4px', lineHeight: 1 }}
                      onClick={e => { e.stopPropagation(); setActiveMenuTicker(activeMenuTicker === c.ticker ? null : c.ticker); }}
                      title="Options"
                    >â‹¯</button>
                    {activeMenuTicker === c.ticker && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: 'absolute', right: 0, top: 'calc(100% + 2px)',
                          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                          borderRadius: 8, boxShadow: 'var(--shadow)', zIndex: 80,
                          minWidth: 140, overflow: 'hidden',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', padding: '7px 10px', borderBottom: '1px solid var(--card-border)', color: 'var(--foreground)' }}>{c.ticker}</div>
                        <button style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'none', border: 'none', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.8rem' }}
                          onClick={() => handleRenameTicker(c.ticker)}>Rename</button>
                        <button style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem' }}
                          onClick={() => {
                            setActiveMenuTicker(null);
                            showConfirm(
                              `This will remove ${c.ticker} and all its cached data.`,
                              async () => {
                                closeModal();
                                try {
                                  const res = await fetch(`/api/stock-cache?ticker=${encodeURIComponent(c.ticker)}`, { method: 'DELETE' });
                                  if (!res.ok) throw new Error('Delete failed');
                                  if (activeTicker === c.ticker) { setHistory([]); setStockMeta(null); setActiveTicker(null); }
                                  await fetchCachedList();
                                  toast(`Deleted ${c.ticker}`);
                                } catch (e) {
                                  toast(`Failed to delete ${c.ticker}`);
                                }
                              },
                              `Delete ${c.ticker}?`
                            );
                          }}>Delete</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

        </aside>

        {/* â”€â”€ Main â”€â”€ */}
        <main className="admin-main">

          {error && <div className="error-banner">{error}</div>}

          {/* Stats card */}
          {stats && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <h2 style={{ margin: 0 }}>{activeTicker}</h2>
                {stockMeta?.cached && <span className="cached-badge">Cached</span>}
                {stockMeta && !stockMeta.cached && <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>fresh from Yahoo</span>}
              </div>
              {stockMeta?.updated_at && (
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 14 }}>
                  Last updated: {new Date(stockMeta.updated_at).toLocaleString()}
                </div>
              )}

              <div className="stock-stat-grid">
                <div className="stock-stat-item">
                  <div className="stock-stat-label">History</div>
                  <div className="stock-stat-value">{stats.years} yrs</div>
                  <div className="stock-stat-sub">{stats.points.toLocaleString()} trading days</div>
                </div>
                <div className="stock-stat-item">
                  <div className="stock-stat-label">Date Range</div>
                  <div className="stock-stat-value" style={{ fontSize: '0.85rem' }}>{fmtMonthYear(series[0]?.date)}</div>
                  <div className="stock-stat-sub">to {fmtMonthYear(stats.last.date)}</div>
                </div>
                <div className="stock-stat-item">
                  <div className="stock-stat-label">Last Close</div>
                  <div className="stock-stat-value">${formatNumber(stats.last.close)}</div>
                  <div className="stock-stat-sub">{formatDate(stats.last.date)}</div>
                </div>
                <div className="stock-stat-item">
                  <div className="stock-stat-label">Last Open</div>
                  <div className="stock-stat-value">${formatNumber(stats.last.open)}</div>
                  <div className="stock-stat-sub">Hi ${formatNumber(stats.last.high)} Â· Lo ${formatNumber(stats.last.low)}</div>
                </div>
                {stats.high52 && (
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">52-Week High</div>
                    <div className="stock-stat-value">${formatNumber(stats.high52)}</div>
                  </div>
                )}
                {stats.low52 && (
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">52-Week Low</div>
                    <div className="stock-stat-value">${formatNumber(stats.low52)}</div>
                  </div>
                )}
                {stats.vol30 && (
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">Avg Volume 30d</div>
                    <div className="stock-stat-value">{formatVolume(stats.vol30)}</div>
                  </div>
                )}
                <div className="stock-stat-item">
                  <div className="stock-stat-label">Last Volume</div>
                  <div className="stock-stat-value">{formatVolume(stats.last.volume)}</div>
                </div>
              </div>
            </>
          )}

          {!history.length && !loading && !error && (
            <div className="admin-empty-state">
              <span>ðŸ“Š</span>
              <p>Select a ticker and period, then click Fetch History</p>
            </div>
          )}

          {loading && (
            <div className="admin-empty-state">
              <span style={{ fontSize: '1.5rem' }}>â³</span>
              <p>Fetching dataâ€¦ large ranges are split into chunks with pauses to avoid rate limits. This may take up to 30 seconds.</p>
            </div>
          )}

          {/* Chart */}
          {history.length > 0 && !loading && (
            <>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
                <div style={{ height: 340 }}>
                  {chartReady ? (
                    <Line data={chartData} options={chartOptions} />
                  ) : chartError ? (
                    <div style={{ color: 'var(--danger)', padding: 16 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Chart failed to load</div>
                      <div style={{ fontSize: '0.82rem' }}>{chartError}</div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--muted)', padding: 24 }}>Loading chartâ€¦</div>
                  )}
                </div>

                {/* Chart toolbar */}
                <div className="chart-toolbar">
                  <div className="chart-toolbar-group">
                    <span className="chart-toolbar-label">Range</span>
                    <div className="period-btn-group" style={{ marginBottom: 0 }}>
                      {CHART_RANGES.map(r => (
                        <button key={r} className={`period-btn${range === r ? ' active' : ''}`} onClick={() => { setRange(r); setPage(1); }}>
                          {r.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chart-toolbar-group">
                    <span className="chart-toolbar-label">Metric</span>
                    <div className="period-btn-group" style={{ marginBottom: 0 }}>
                      {METRICS.map(m => (
                        <button key={m.value} className={`period-btn${metric === m.value ? ' active' : ''}`} onClick={() => setMetric(m.value)}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chart-toolbar-group">
                    <span className="chart-toolbar-label">Aggregate</span>
                    <div className="period-btn-group" style={{ marginBottom: 0 }}>
                      {['none','weekly','monthly'].map(a => (
                        <button key={a} className={`period-btn${aggregateBy === a ? ' active' : ''}`} onClick={() => setAggregateBy(a)}>
                          {a === 'none' ? 'Daily' : a.charAt(0).toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={downloadCSV}
                    className="period-btn"
                    title="Download filtered data as CSV"
                  >â¬‡ CSV</button>
                </div>
              </div>

              {/* Data table */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>
                    Data Preview <span className="count-badge">{filteredSeries.length} pts</span>
                  </h3>
                  <div className="chart-toolbar-group">
                    <span className="chart-toolbar-label">Rows</span>
                    <select
                      className="sidebar-input"
                      style={{ width: 'auto', marginBottom: 0, padding: '4px 8px' }}
                      value={pageSize}
                      onChange={e => { setPageSize(+e.target.value); setPage(1); }}
                    >
                      {[10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                <table className="stocks-table">
                  <thead>
                    <tr>
                      {[['date','Date'],['open','Open'],['high','High'],['low','Low'],['close','Close'],['volume','Volume']].map(([k, lbl]) => (
                        <th key={k} onClick={() => { setSortBy(k); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                          {lbl} {sortBy === k ? (sortDir === 'asc' ? 'â–²' : 'â–¼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const total = sortedFilteredSeries.length;
                      const start = Math.max(0, total - (page * pageSize));
                      const end   = Math.max(0, total - ((page-1) * pageSize));
                      return sortedFilteredSeries.slice(start, end).reverse().map((r, i) => (
                        <tr key={i}>
                          <td>{formatDate(r.date)}</td>
                          <td>${formatNumber(r.open)}</td>
                          <td>${formatNumber(r.high)}</td>
                          <td>${formatNumber(r.low)}</td>
                          <td>${formatNumber(r.close)}</td>
                          <td>{formatVolume(r.volume)}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                  <button className="period-btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>â€¹ Prev</button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Page {page} / {Math.max(1, Math.ceil(filteredSeries.length / pageSize))}</span>
                  <button className="period-btn" onClick={() => setPage(p => Math.min(Math.ceil(filteredSeries.length / pageSize), p+1))} disabled={page * pageSize >= filteredSeries.length}>Next â€º</button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <AppModal
        {...modal}
        onCancel={closeModal}
        inputValue={modalInputValue}
        onInputChange={v => { modalInputValueRef.current = v; setModalInputValue(v); }}
      />

      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          color: 'var(--foreground)', padding: '10px 16px',
          borderRadius: 9, boxShadow: 'var(--shadow)', zIndex: 2000, fontSize: '0.85rem',
        }}>
          {toastMsg}
        </div>
      )}
    </AuthGate>
    </ErrorBoundary>
  );
}
