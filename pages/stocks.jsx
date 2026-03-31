import { useState, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import ErrorBoundary from '../components/ErrorBoundary';
import AppModal from '../components/ConfirmModal';
import { sma, ema, bollingerBands } from '../lib/math';
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

const INDICATORS = [
  { id: 'sma20',  label: 'SMA 20',    color: '#f59e0b' },
  { id: 'sma50',  label: 'SMA 50',    color: '#3b82f6' },
  { id: 'sma200', label: 'SMA 200',   color: '#ef4444' },
  { id: 'ema20',  label: 'EMA 20',    color: '#a855f7' },
  { id: 'bb',     label: 'Bollinger', color: '#10b981' },
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
  const [errorCode, setErrorCode]     = useState(null);   // 'RATE_LIMITED' | 'NOT_FOUND' | 'TIMEOUT' | 'UNKNOWN'
  const [retryAt, setRetryAt]         = useState(null);   // Date after which retry is allowed
  const [retryCountdown, setRetryCountdown] = useState(0);
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

  // ── CSV Import modal ──────────────────────────────────────────────────────────
  const [csvModal, setCsvModal]               = useState({ open: false });
  const [csvModalTicker, setCsvModalTicker]   = useState('');
  const [csvModalFile, setCsvModalFile]       = useState(null);
  const [csvModalHeaders, setCsvModalHeaders] = useState([]);
  const [csvModalMapping, setCsvModalMapping] = useState({});
  const [csvModalLoading, setCsvModalLoading] = useState(false);
  const [csvModalError, setCsvModalError]     = useState(null);
  const csvModalFileRef = useRef(null);

  // ── Chart theme colours (resolved from CSS vars so Chart.js gets real hex values) ──
  const [chartTheme, setChartTheme] = useState({ muted: '#a1a1aa', accent: '#16a34a', grid: 'rgba(128,128,128,0.12)' });

  useEffect(() => {
    const resolve = () => {
      const style = getComputedStyle(document.documentElement);
      const muted  = style.getPropertyValue('--muted').trim()  || '#a1a1aa';
      const accent = style.getPropertyValue('--accent').trim() || '#16a34a';
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setChartTheme({
        muted,
        accent,
        grid: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
      });
    };
    resolve();
    const obs = new MutationObserver(resolve);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-profile'] });
    return () => obs.disconnect();
  }, []);

  // ── Ticker context menu ───────────────────────────────────────────────────────
  const [menuPos, setMenuPos] = useState(null); // { top, right } fixed position

  // ── In-memory ticker data cache (survives within this page session) ───────────
  // Keyed by ticker symbol. Holds { history, stockMeta } so switching between
  // previously-loaded tickers is instant with zero API calls.
  const tickerDataCache = useRef(new Map());

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

  // ── Retry countdown ticker ────────────────────────────────────────────────────
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRetryCountdown(secs);
      if (secs === 0) setRetryAt(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [retryAt]);

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
    setErrorCode(null);
    setRetryAt(null);
    setLoading(true);
    setTicker(t);
    try {
      const params = new URLSearchParams({ ticker: t, period: p });
      if (p === 'custom') { params.set('startDate', customStart); params.set('endDate', customEnd); }
      if (force) params.set('force', '1');
      const res  = await fetch(`/api/stock-history?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch', { cause: { code: data.code, retryAfter: data.retryAfter } });
      const historyRows = data.data || [];
      if (historyRows.length === 0) {
        throw new Error(`No data returned for ${t}. The ticker may be unsupported or have no history for this date range.`, { cause: { code: 'NOT_FOUND' } });
      }
      const meta = {
        startDate:  data.startDate,
        endDate:    data.endDate,
        cached:     data.cached,
        updated_at: data.updated_at,
      };
      // Store in session memory so switching back to this ticker is instant
      tickerDataCache.current.set(t.toUpperCase(), { history: historyRows, stockMeta: meta });
      setHistory(historyRows);
      setStockMeta(meta);
      setActiveTicker(t);
      setPage(1);
      await fetchCachedList();
    } catch (e) {
      const code        = e?.cause?.code || 'UNKNOWN';
      const retryAfter  = e?.cause?.retryAfter || (code === 'RATE_LIMITED' ? 60 : 0);
      setError(e.message);
      setErrorCode(code);
      if (retryAfter > 0) setRetryAt(Date.now() + retryAfter * 1000);
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

  // ── CSV Import modal handlers ─────────────────────────────────────────────────
  const REQUIRED_FIELDS = ['date','open','high','low','close','volume'];

  const handleCsvModalFile = async (file) => {
    setCsvModalFile(file);
    const text = await file.text();
    const firstLine = text.split('\n')[0];
    const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    setCsvModalHeaders(headers);
    const fieldAliases = {
      date:   ['date','time','timestamp','Date','Time','Timestamp'],
      open:   ['open','open_price','Open'],
      high:   ['high','high_price','High'],
      low:    ['low','low_price','Low'],
      close:  ['close','close_price','adj close','adj_close','Close','Adj Close'],
      volume: ['volume','vol','Volume','Vol'],
    };
    const autoMap = {};
    for (const [field, aliases] of Object.entries(fieldAliases)) {
      const match = headers.find(h => aliases.some(a => a.toLowerCase() === h.toLowerCase().trim()));
      if (match) autoMap[field] = match;
    }
    setCsvModalMapping(autoMap);
  };

  const submitCsvImport = async () => {
    const t = csvModalTicker.trim().toUpperCase() || ticker;
    if (!t) { setCsvModalError('Enter a ticker symbol.'); return; }
    if (!csvModalFile) { setCsvModalError('Select a CSV file.'); return; }
    const unmapped = REQUIRED_FIELDS.filter(f => !csvModalMapping[f]);
    if (unmapped.length) { setCsvModalError(`Map all required fields. Missing: ${unmapped.join(', ')}`); return; }
    setCsvModalLoading(true);
    setCsvModalError(null);
    try {
      const rawText = await csvModalFile.text();
      const lines = rawText.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const row = {};
        for (const field of REQUIRED_FIELDS) {
          const idx = headers.indexOf(csvModalMapping[field]);
          row[field] = idx >= 0 ? cols[idx] : '';
        }
        return row;
      });
      const standardCsv = [
        'date,open,high,low,close,volume',
        ...rows.map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`),
      ].join('\n');
      const res = await fetch('/api/stock-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, csv: standardCsv }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      toast(`Imported ${json.imported} rows for ${json.ticker}${json.skipped ? ` (${json.skipped} skipped)` : ''}`);
      setCsvModal({ open: false });
      await fetchCachedList();
    } catch (e) {
      setCsvModalError(e.message);
    } finally {
      setCsvModalLoading(false);
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

  // ── Indicator series ────────────────────────────────────────────────────────────
  const indicatorSeries = useMemo(() => {
    if (!sampled.length) return {};
    const closes = sampled.map(s => s.close);
    return {
      sma20:  sma(closes, 20),
      sma50:  sma(closes, 50),
      sma200: sma(closes, 200),
      ema20:  ema(closes, 20),
      bb:     bollingerBands(closes, 20, 2),
    };
  }, [sampled]);

  const chartData = useMemo(() => {
    const indicatorDatasets = INDICATORS.flatMap(ind => {
      if (!activeIndicators.has(ind.id)) return [];
      const s = indicatorSeries[ind.id];
      if (!s) return [];
      if (ind.id === 'bb') {
        return [
          { label: 'BB Upper',  data: s.upper,  borderColor: ind.color,       backgroundColor: 'transparent', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, spanGaps: false },
          { label: 'BB Middle', data: s.middle, borderColor: ind.color + '88', backgroundColor: 'transparent', borderWidth: 1, borderDash: [2, 4], pointRadius: 0, spanGaps: false },
          { label: 'BB Lower',  data: s.lower,  borderColor: ind.color,       backgroundColor: 'transparent', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, spanGaps: false },
        ];
      }
      return [{ label: ind.label, data: s, borderColor: ind.color, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, spanGaps: false }];
    });
    return {
      labels: sampled.map(s => s.date),
      datasets: [
        {
          label: `${ticker} ${metric}`,
          data:  sampled.map(s => s[metric]),
          borderColor:     chartTheme.accent,
          backgroundColor: chartTheme.accent + '18',
          pointRadius: 0,
          borderWidth: 1.5,
        },
        ...indicatorDatasets,
      ],
    };
  }, [sampled, ticker, metric, chartTheme, activeIndicators, indicatorSeries]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { type: 'time', time: { unit: 'day' }, grid: { color: chartTheme.grid }, ticks: { color: chartTheme.muted } },
      y: { beginAtZero: false, grid: { color: chartTheme.grid }, ticks: { color: chartTheme.muted } },
    },
    plugins: {
      legend: {
        display: activeIndicators.size > 0,
        labels: { color: chartTheme.muted, boxWidth: 20, padding: 12, font: { size: 11 } },
      },
    },
  }), [chartTheme, activeIndicators]);

  // clamp page
  useEffect(() => {
    const total = Math.max(1, Math.ceil(filteredSeries.length / pageSize));
    if (page > total) setPage(total);
  }, [filteredSeries.length, pageSize]);

  // close ticker context menu on outside click
  useEffect(() => {
    if (!activeMenuTicker) return;
    const handler = () => { setActiveMenuTicker(null); setMenuPos(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeMenuTicker]);

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <ErrorBoundary>
    <AuthGate>
      <NavBar />
      <div className="admin-layout">

        {/* â”€â”€ Sidebar â”€â”€ */}
        <aside className="admin-sidebar">

          {/* Header badge */}
          <div className="sidebar-profile-badge" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="sidebar-profile-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg></div>
              <div>
                <div className="sidebar-profile-label">Markets</div>
                <div className="sidebar-profile-sub">Stock History</div>
              </div>
            </div>
            <button
              onClick={() => {
                setCsvModal({ open: true });
                setCsvModalTicker('');
                setCsvModalFile(null);
                setCsvModalHeaders([]);
                setCsvModalMapping({});
                setCsvModalError(null);
                if (csvModalFileRef.current) csvModalFileRef.current.value = '';
              }}
              title="Import CSV"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', flexShrink: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import
            </button>
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
              {loading ? (
                <><span className="spinner spinner-sm spinner-white" style={{ marginRight: 6 }} />Fetching…</>
              ) : 'Fetch History'}
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

          {/* Cached tickers list */}
          <div className="sidebar-section sidebar-list-section" style={{ flex: 1 }}>
            <h3 className="sidebar-section-title">
              Cached Tickers <span className="count-badge">{cachedList.length}</span>
            </h3>
            <ul className="sidebar-list" style={{ maxHeight: 'none' }}>
              {cachedLoading && (
                <li className="sidebar-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span className="spinner spinner-sm" /> Loading…
                </li>
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
                    onClick={() => {
                      const mem = tickerDataCache.current.get(c.ticker.toUpperCase());
                      if (mem) {
                        // Already loaded this session — instant switch, no API call
                        setHistory(mem.history);
                        setStockMeta(mem.stockMeta);
                        setActiveTicker(c.ticker);
                        setTicker(c.ticker);
                        setQuery('');
                        setPage(1);
                        setError(null);
                      } else {
                        fetchHistory(c.ticker, fetchPeriod);
                      }
                    }}
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
                        {fmtMonthYear(c.start_date)} "“ {fmtMonthYear(c.end_date)}
                      </div>
                    )}

                    {/* options menu */}
                    <button
                      style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 4px', lineHeight: 1 }}
                      onMouseDown={e => {
                        e.stopPropagation();
                        if (activeMenuTicker === c.ticker) {
                          setActiveMenuTicker(null);
                          setMenuPos(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                          setActiveMenuTicker(c.ticker);
                        }
                      }}
                      title="Options"
                    ><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
                  </li>
                );
              })}
            </ul>
          </div>

        </aside>

        {/* â”€â”€ Main â”€â”€ */}
        <main className="admin-main">

          {error && (
            <div className="error-banner" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {errorCode === 'RATE_LIMITED' && (
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>Rate limit reached</div>
                )}
                {errorCode === 'NOT_FOUND' && (
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>Ticker not found</div>
                )}
                {errorCode === 'TIMEOUT' && (
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>Request timed out</div>
                )}
                <div>{error}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {errorCode === 'RATE_LIMITED' && retryCountdown > 0 && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    Retry in {retryCountdown}s
                  </span>
                )}
                <button
                  className="upload-btn"
                  disabled={errorCode === 'RATE_LIMITED' && retryCountdown > 0}
                  onClick={() => fetchHistory(ticker, fetchPeriod)}
                  style={{ fontSize: '0.78rem', padding: '4px 12px', whiteSpace: 'nowrap' }}
                >
                  ↺ Retry
                </button>
                {errorCode !== 'NOT_FOUND' && (
                  <button
                    className="upload-btn"
                    onClick={() => setCsvModal({ open: true })}
                    style={{ fontSize: '0.78rem', padding: '4px 12px', whiteSpace: 'nowrap', background: 'var(--input-bg)', color: 'var(--foreground)', border: '1px solid var(--card-border)' }}
                  >
                    + Import CSV
                  </button>
                )}
              </div>
            </div>
          )}

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
                  <div className="stock-stat-sub">Hi ${formatNumber(stats.last.high)} · Lo ${formatNumber(stats.last.low)}</div>
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
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/></svg>
              <p>Select a ticker and period, then click Fetch History</p>
            </div>
          )}

          {loading && (
            <div className="admin-empty-state">
              <span className="spinner" style={{ width: 28, height: 28, display: "block", margin: "0 auto" }} />
              <p>Fetching data… large ranges are split into chunks with pauses to avoid rate limits. This may take up to 30 seconds.</p>
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
                    <div style={{ color: 'var(--muted)', padding: 24 }}>Loading chart…</div>
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
                  ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M12 5v14M5 12l7 7 7-7"/></svg> CSV</button>
                </div>

                {/* Indicators toggle row */}
                <div className="chart-toolbar" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--card-border)' }}>
                  <div className="chart-toolbar-group">
                    <span className="chart-toolbar-label">Indicators</span>
                    <div className="period-btn-group" style={{ marginBottom: 0 }}>
                      {INDICATORS.map(ind => (
                        <button
                          key={ind.id}
                          className={`period-btn${activeIndicators.has(ind.id) ? ' active' : ''}`}
                          onClick={() => toggleIndicator(ind.id)}
                          style={activeIndicators.has(ind.id) ? { borderColor: ind.color, color: ind.color, background: ind.color + '18' } : {}}
                        >
                          {ind.label}
                        </button>
                      ))}
                    </div>
                  </div>
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
                          {lbl} {sortBy === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}
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
                  <button className="period-btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Prev</button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Page {page} / {Math.max(1, Math.ceil(filteredSeries.length / pageSize))}</span>
                  <button className="period-btn" onClick={() => setPage(p => Math.min(Math.ceil(filteredSeries.length / pageSize), p+1))} disabled={page * pageSize >= filteredSeries.length}>Next <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
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

      {/* ── Ticker context menu (fixed, escapes sidebar overflow) ── */}
      {activeMenuTicker && menuPos && (() => {
        const mc = cachedList.find(x => x.ticker === activeMenuTicker);
        if (!mc) return null;
        return (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: menuPos.top, right: menuPos.right,
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: 8, boxShadow: 'var(--shadow)', zIndex: 1200,
              minWidth: 150, overflow: 'hidden',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.78rem', padding: '7px 10px', borderBottom: '1px solid var(--card-border)', color: 'var(--foreground)' }}>{mc.ticker}</div>
            <button
              style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'none', border: 'none', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.8rem' }}
              onMouseDown={() => { setActiveMenuTicker(null); setMenuPos(null); handleRenameTicker(mc.ticker); }}
            >Rename</button>
            <button
              style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem' }}
              onMouseDown={() => {
                setActiveMenuTicker(null);
                setMenuPos(null);
                showConfirm(
                  `This will remove ${mc.ticker} and all its cached data.`,
                  async () => {
                    closeModal();
                    try {
                      const res = await fetch(`/api/stock-cache?ticker=${encodeURIComponent(mc.ticker)}`, { method: 'DELETE' });
                      if (!res.ok) throw new Error('Delete failed');
                      if (activeTicker === mc.ticker) { setHistory([]); setStockMeta(null); setActiveTicker(null); }
                      await fetchCachedList();
                      toast(`Deleted ${mc.ticker}`);
                    } catch (e) {
                      toast(`Failed to delete ${mc.ticker}`);
                    }
                  },
                  `Delete ${mc.ticker}?`
                );
              }}
            >Delete</button>
          </div>
        );
      })()}

      {/* ── CSV Import modal ── */}
      {csvModal.open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setCsvModal({ open: false }); }}
        >
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '22px 24px', width: 500, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow)' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Import CSV</h3>
              <button onMouseDown={() => setCsvModal({ open: false })} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
            </div>

            {/* Ticker */}
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ticker Symbol</label>
            <input
              className="sidebar-input"
              placeholder="e.g. AAPL"
              value={csvModalTicker}
              onChange={e => setCsvModalTicker(e.target.value.toUpperCase())}
              style={{ marginBottom: 14 }}
            />

            {/* Drop zone */}
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>CSV File</label>
            <label
              htmlFor="csv-modal-file"
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
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {(csvModalFile.size / 1024).toFixed(1)} KB &nbsp;·&nbsp; click to change
                  </span>
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
              id="csv-modal-file"
              ref={csvModalFileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvModalFile(f); }}
            />

            {/* Field mapping */}
            {csvModalHeaders.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Column Mapping</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: 10 }}>
                  Map each required field to the matching column in your CSV.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                  {REQUIRED_FIELDS.map(field => (
                    <div key={field}>
                      <label style={{ fontSize: '0.76rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                        {csvModalMapping[field] ? (
                          <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>
                        ) : (
                          <span style={{ color: 'var(--danger)', marginLeft: 6 }}>required</span>
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

            {/* Actions */}
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
    </AuthGate>
    </ErrorBoundary>
  );
}
