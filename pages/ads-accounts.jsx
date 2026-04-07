import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import ErrorBoundary from '../components/ErrorBoundary';
import AppModal from '../components/ConfirmModal';
import styles from '../styles/ads-accounts.module.css';

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

// ── Date Range ─────────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { id: 'custom',    label: 'Custom' },
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7',     label: 'Last 7 days' },
  { id: 'last14',    label: 'Last 14 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'last30',    label: 'Last 30 days' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'last90',    label: 'Last 90 days' },
  { id: 'alltime',   label: 'All time' },
];

function computeDateRange(preset, customFrom, customTo) {
  const d = (offset = 0) => { const t = new Date(); t.setHours(0,0,0,0); t.setDate(t.getDate() + offset); return t.toISOString().slice(0, 10); };
  const disp = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const mk = (from, to) => {
    if (from === to) return { from, to, display: `${disp(from)}, ${new Date(from + 'T12:00:00').getFullYear()}` };
    const fd = new Date(from + 'T12:00:00'), td = new Date(to + 'T12:00:00');
    const sameMonth = fd.getMonth() === td.getMonth() && fd.getFullYear() === td.getFullYear();
    const display = sameMonth
      ? `${disp(from)} \u2013 ${td.getDate()}, ${td.getFullYear()}`
      : `${disp(from)} \u2013 ${disp(to)}, ${td.getFullYear()}`;
    return { from, to, display };
  };
  if (preset === 'today')     return mk(d(0),  d(0));
  if (preset === 'yesterday') return mk(d(-1), d(-1));
  if (preset === 'last7')     return mk(d(-6),  d());
  if (preset === 'last14')    return mk(d(-13), d());
  if (preset === 'last30')    return mk(d(-29), d());
  if (preset === 'last90')    return mk(d(-89), d());
  if (preset === 'thisMonth') { const t = new Date(); t.setHours(0,0,0,0); const f = new Date(t.getFullYear(), t.getMonth(), 1).toISOString().slice(0,10); return mk(f, d()); }
  if (preset === 'lastMonth') { const t = new Date(); t.setHours(0,0,0,0); const f = new Date(t.getFullYear(), t.getMonth()-1, 1).toISOString().slice(0,10); const to = new Date(t.getFullYear(), t.getMonth(), 0).toISOString().slice(0,10); return mk(f, to); }
  if (preset === 'custom' && customFrom && customTo) return mk(customFrom, customTo);
  if (preset === 'alltime') return mk('2015-01-01', d());
  return { from: '', to: '', display: '' };
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
  const [includePaused, setIncludePaused] = useState(false);
  const [sortBy, setSortBy]       = useState('name');
  const [sortDir, setSortDir]     = useState('asc');
  const [modal, setModal]         = useState({ open: false });
  const [toastMsg, setToastMsg]   = useState('');

  // ── Campaign / Ad drill-down ──────────────────────────────────────────────
  const [expandedAccountId, setExpandedAccountId]   = useState(null);
  const [campaignRows, setCampaignRows]             = useState({});   // { [accountId]: campaign[] }
  const [campaignLoading, setCampaignLoading]       = useState(null); // accountId being loaded
  const [expandedCampaignId, setExpandedCampaignId] = useState(null);
  const [adRows, setAdRows]                         = useState({});   // { [campaignId]: ad[] }
  const [adLoading, setAdLoading]                   = useState(null); // campaignId being loaded

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2500); };
  const closeModal  = () => setModal({ open: false });

  // ── Date range selector ────────────────────────────────────────────────────
  const [datePreset, setDatePreset]       = useState('last30');
  const [customFrom, setCustomFrom]       = useState('');
  const [customTo, setCustomTo]           = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const datePickerRef = useRef(null);
  const [liveMetrics, setLiveMetrics]       = useState(null);  // { [accountId]: metrics } for selected date range
  const [metricsLoading, setMetricsLoading] = useState(false);

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
  const [optPlatform, setOptPlatform] = useState('Campaign Performance');
  const [optSourceOption, setOptSourceOption] = useState('mydata');
  const [optGeminiModel, setOptGeminiModel] = useState('gemini-2.5-flash-lite');

  // ── Saved prompts ────────────────────────────────────────────────────────
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [newPromptLabel, setNewPromptLabel] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const labelEditedRef = useRef(false); // true once user manually edits the label field

  const loadSavedPrompts = async () => {
    try {
      const res = await fetch('/api/ads-prompts');
      const json = await res.json();
      if (res.ok) setSavedPrompts(json.prompts || []);
    } catch {}
  };

  const saveNewPrompt = async () => {
    if (!newPromptLabel.trim() || !newPromptText.trim()) return;
    setSavingPrompt(true);
    try {
      const res = await fetch('/api/ads-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newPromptLabel, text: newPromptText }),
      });
      const json = await res.json();
      if (res.ok) {
        setSavedPrompts(prev => [json.prompt, ...prev]);
        setNewPromptLabel('');
        setNewPromptText('');
        labelEditedRef.current = false;
        setSavePromptOpen(false);
        toast('Prompt saved');
      } else {
        toast(json.error || 'Save failed');
      }
    } catch { toast('Save failed'); }
    finally { setSavingPrompt(false); }
  };

  const deletePrompt = async (id) => {
    await fetch(`/api/ads-prompts?id=${id}`, { method: 'DELETE' });
    setSavedPrompts(prev => prev.filter(p => p.id !== id));
  };

  const loadPrompt = (text) => {
    setOptInput(text);
  };

  const loadAndSendPrompt = (text) => {
    handleOptimizerSendWithText(text);
  };

  useEffect(() => { loadSavedPrompts(); }, []);
  // Composer sizing / resize state
  const [composerDims, setComposerDims] = useState({ width: null, height: null, minimized: false, expanded: false });
  const composerRef = useRef(null);
  const dragStateRef = useRef(null);
  const [hoveredBtn, setHoveredBtn] = useState(null); // kept for compatibility, hover handled via CSS
  const optMessagesEndRef = useRef(null);
  const optLatestUserMsgRef = useRef(null);

  // Scroll to top of latest user message when messages change
  useEffect(() => {
    if (optLatestUserMsgRef.current) {
      optLatestUserMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (optMessagesEndRef.current) {
      optMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [optMessages]);

  useEffect(() => {
    if (composerDims.width === null && typeof window !== 'undefined') {
      const w = Math.min(980, Math.floor(window.innerWidth * 0.94));
      setComposerDims(d => ({ ...d, width: w }));
    }
  }, [composerDims.width]);

  // Close date picker when clicking outside
  useEffect(() => {
    if (!datePickerOpen) return;
    const handler = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) setDatePickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [datePickerOpen]);

  // Re-fetch metrics when the date range changes
  useEffect(() => {
    if (!accounts.length) return;
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from || !to) return;
    let cancelled = false;
    setMetricsLoading(true);
    const ids = accounts.filter(a => !a.isManager).map(a => a.id).join(',');
    fetch(`/api/ads-accounts?dateFrom=${from}&dateTo=${to}&accountIds=${ids}`)
      .then(r => r.json())
      .then(data => { if (!cancelled && data.metrics) setLiveMetrics(data.metrics); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [accounts, datePreset, customFrom, customTo]);

  // Shift the current range forward/backward by its own span
  const navigateDates = (direction) => {
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from || !to) return;
    const fromD = new Date(from + 'T12:00:00');
    const toD   = new Date(to   + 'T12:00:00');
    const days  = Math.round((toD - fromD) / 86400000) + 1;
    const nf = new Date(fromD); nf.setDate(nf.getDate() + direction * days);
    const nt = new Date(toD);   nt.setDate(nt.getDate() + direction * days);
    setCustomFrom(nf.toISOString().slice(0, 10));
    setCustomTo(nt.toISOString().slice(0, 10));
    setDatePreset('custom');
  };

  // ── Drill-down handlers ────────────────────────────────────────────────────
  const toggleCampaigns = async (account) => {
    if (expandedAccountId === account.id) {
      setExpandedAccountId(null);
      setExpandedCampaignId(null);
      return;
    }
    setExpandedAccountId(account.id);
    setExpandedCampaignId(null);
    if (campaignRows[account.id]) return; // already loaded
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from || !to) return;
    setCampaignLoading(account.id);
    try {
      const res = await fetch(
        `/api/ads-campaigns?accountId=${account.id}&dateFrom=${from}&dateTo=${to}&includePaused=${includePaused ? '1' : '0'}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load campaigns');
      setCampaignRows(prev => ({ ...prev, [account.id]: data.campaigns || [] }));
    } catch (e) { toast(e.message || 'Failed to load campaigns'); }
    finally { setCampaignLoading(null); }
  };

  const toggleAds = async (account, campaign) => {
    if (expandedCampaignId === campaign.id) {
      setExpandedCampaignId(null);
      return;
    }
    setExpandedCampaignId(campaign.id);
    if (adRows[campaign.id]) return; // already loaded
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from || !to) return;
    setAdLoading(campaign.id);
    try {
      const res = await fetch(
        `/api/ads-campaigns?accountId=${account.id}&campaignId=${campaign.id}&dateFrom=${from}&dateTo=${to}&includePaused=${includePaused ? '1' : '0'}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ads');
      setAdRows(prev => ({ ...prev, [campaign.id]: data.ads || [] }));
    } catch (e) { toast(e.message || 'Failed to load ads'); }
    finally { setAdLoading(null); }
  };

  // Invalidate campaign/ad cache when date range or includePaused changes
  useEffect(() => {
    setCampaignRows({});
    setAdRows({});
    setExpandedCampaignId(null);
  }, [datePreset, customFrom, customTo, includePaused]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Shrink/expand should only change height; keep width unchanged
  const handleShrink = () => setComposerDims(d => ({ ...d, minimized: true, expanded: false, height: 170 }));
  const handleExpand = () => setComposerDims(d => ({ ...d, minimized: false, expanded: true, height: 720 }));

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

  // Use live metrics for selected date range; fall back to cached metrics
  const getM = (a) => (liveMetrics && liveMetrics[a.id]) ? liveMetrics[a.id] : (a.metrics || {});
  const periodLabel = DATE_PRESETS.find(p => p.id === datePreset)?.label ?? 'Selected period';

  const hasMetrics = filtered.some(a => getM(a)?.impressions);

  const totals = filtered.reduce((acc, a) => {
    const m = getM(a);
    return {
      impressions: acc.impressions + (m?.impressions || 0),
      clicks:      acc.clicks      + (m?.clicks      || 0),
      costMicros:  acc.costMicros  + (m?.costMicros  || 0),
      conversions: acc.conversions + (m?.conversions || 0),
    };
  }, { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };
  const sortIndicator = (col) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const uniqueStatuses = ['ALL', ...Array.from(new Set(accounts.map(a => a.status)))];

  // Core send — accepts explicit text so it can be called from saved-prompt "Load + Send"
  const handleOptimizerSendWithText = async (text) => {
    if (!text?.trim()) return;
    setComposerDims(d => d.minimized || !d.height ? { ...d, minimized: false, height: 420 } : d);
    setOptLoading(true);
    setOptInput('');
    try {
      setOptMessages(prev => [...prev, { role: 'user', content: text }]);

      // add a placeholder AI message we will update as the stream arrives
      setOptMessages(prev => [...prev, { role: 'ai', content: '' }]);

      const { from: dateFrom, to: dateTo } = computeDateRange(datePreset, customFrom, customTo);
      const payload = {
        platform: optPlatform,
        userPrompt: text,
        sourceOption: optSourceOption,
        geminiModel: optGeminiModel,
        accountIds: filtered.map(a => a.id),
        dateFrom,
        dateTo,
      };

      const res = await fetch('/api/ads-query', {
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

  // Thin wrapper used from the textarea send button
  const handleOptimizerSend = () => handleOptimizerSendWithText(optInput);

  return (
    <ErrorBoundary>
      <AuthGate>
        <NavBar />
        <div className="admin-layout">

          {/* ── Sidebar ── */}
          <aside className="admin-sidebar">

            <div className={`sidebar-profile-badge ${styles.sidebarBadgeOuter}`}>
              <div className={styles.sidebarBadgeInner}>
                <div className="sidebar-profile-icon">📊</div>
                <div>
                  <div className="sidebar-profile-label">Google Ads</div>
                  <div className="sidebar-profile-sub">Account Manager</div>
                </div>
              </div>
              <button
                onClick={() => { setCsvModal({ open: true }); setCsvModalError(null); setCsvModalFile(null); setCsvModalHeaders([]); setCsvModalMapping({}); }}
                title="Import CSV"
                className={styles.importBtn}
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
                className={`upload-btn ${styles.reloadCacheBtn}`}
                onClick={loadCached}
                disabled={loading || syncing}
              >
                {loading ? (
                  <><span className="spinner spinner-sm" style={{ marginRight: 6 }} />Reloading…</>
                ) : '↺ Reload Cache'}
              </button>
              {/* {syncedAt && (
                <div className={styles.syncedAt}>
                  Last synced<br />
                  {new Date(syncedAt).toLocaleString()}
                </div>
              )} */}
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
              <label className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Include paused campaigns</span>
                <span className={`${styles.toggleSwitch}${includePaused ? ` ${styles.toggleSwitchOn}` : ''}`} onClick={() => setIncludePaused(v => !v)} role="checkbox" aria-checked={includePaused} tabIndex={0} onKeyDown={e => e.key === ' ' && setIncludePaused(v => !v)}>
                  <span className={styles.toggleThumb} />
                </span>
              </label>
            </div>

            {accounts.length > 0 && (
              <div className="sidebar-section" ref={acctDropdownRef}>
                <h3 className={`sidebar-section-title ${styles.acctDropdownTitle}`} onClick={() => setAcctDropdownOpen(o => !o)}>
                  <span>Accounts <span className="count-badge">{accounts.length}</span></span>
                  <span className={styles.dropdownArrow}>{acctDropdownOpen ? '▲' : '▼'}</span>
                </h3>
                {selectedAccounts.length > 0 && (
                  <div className={styles.acctSelectedInfo}>
                    {selectedAccounts.length === 1
                      ? selectedAccounts[0].name
                      : `${selectedAccounts.length} accounts selected`}
                    <button
                      onClick={() => setSelectedAccounts([])}
                      className={styles.clearBtn}
                    >Clear</button>
                  </div>
                )}
                {acctDropdownOpen && (
                  <div className={styles.acctDropdownList}>
                    {accounts.map(a => {
                      const checked = !!selectedAccounts.find(x => x.id === a.id);
                      return (
                        <label
                          key={a.id}
                          className={`${styles.acctItem}${checked ? ` ${styles.acctItemChecked}` : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAccountSelection(a)}
                            className={styles.acctCheckbox}
                          />
                          <div>
                            <div className={styles.acctName}>{a.name}</div>
                            <div className={styles.acctId}>{formatCustomerId(a.id)}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Saved Prompts: browse & use ── */}
            <div className="sidebar-section">
              <h3
                className={`sidebar-section-title ${styles.acctDropdownTitle}`}
                onClick={() => setPromptsOpen(o => !o)}
              >
                <span>Saved Prompts <span className="count-badge">{savedPrompts.length}</span></span>
                <span className={styles.dropdownArrow}>{promptsOpen ? '▲' : '▼'}</span>
              </h3>
              {promptsOpen && (
                savedPrompts.length === 0 ? (
                  <p className={styles.savedPromptsEmpty}>No prompts saved yet.</p>
                ) : (
                  <div className={styles.savedPromptsList}>
                    {savedPrompts.map(p => (
                      <div key={p.id} className={styles.savedPromptItem}>
                        <div className={styles.savedPromptMeta}>
                          {p.category && <span className={styles.savedPromptCategory}>{p.category}</span>}
                          <span className={styles.savedPromptLabel} title={p.text}>{p.label}</span>
                        </div>
                        <div className={styles.savedPromptActions}>
                          <button
                            className={styles.savedPromptBtn}
                            onClick={() => loadPrompt(p.text)}
                            title="Insert into composer"
                          >Load</button>
                          <button
                            className={`${styles.savedPromptBtn} ${styles.savedPromptBtnSend}`}
                            onClick={() => loadAndSendPrompt(p.text)}
                            title="Insert and send"
                          >Load + Send</button>
                          <button
                            className={styles.savedPromptDelete}
                            onClick={() => deletePrompt(p.id)}
                            title="Delete prompt"
                          >✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* ── Save a Prompt ── */}
            <div className="sidebar-section">
              <h3
                className={`sidebar-section-title ${styles.acctDropdownTitle}`}
                onClick={() => setSavePromptOpen(o => !o)}
              >
                <span>Save a Prompt</span>
                <span className={styles.dropdownArrow}>{savePromptOpen ? '▲' : '▼'}</span>
              </h3>
              {savePromptOpen && (
                <div className={styles.savePromptForm}>
                  <label className={styles.savePromptLabel}>Prompt text</label>
                  <textarea
                    className={`sidebar-input ${styles.savePromptTextarea}`}
                    placeholder="Enter the prompt…"
                    value={newPromptText}
                    onChange={e => {
                      const val = e.target.value;
                      setNewPromptText(val);
                      if (!labelEditedRef.current) {
                        const t = val.trim();
                        setNewPromptLabel(t.length > 55 ? t.slice(0, 55) + '…' : t);
                      }
                    }}
                    rows={4}
                  />
                  <label className={styles.savePromptLabel}>
                    Label
                    <span className={styles.savePromptOptional}> (auto-filled — edit to override)</span>
                  </label>
                  <input
                    className="sidebar-input"
                    placeholder="Short label…"
                    value={newPromptLabel}
                    onChange={e => { labelEditedRef.current = true; setNewPromptLabel(e.target.value); }}
                  />
                  <button
                    className="upload-btn"
                    onClick={saveNewPrompt}
                    disabled={savingPrompt || !newPromptLabel.trim() || !newPromptText.trim()}
                  >
                    {savingPrompt ? 'Saving…' : 'Save Prompt'}
                  </button>
                </div>
              )}
            </div>

          </aside>

          {/* ── Main ── */}
          <main className="admin-main">

            <div className={styles.pageHeader}>
              <div>
                <h1 className={styles.pageTitle}>Google Ads Accounts</h1>
                {syncedAt && (
                  <div className={styles.syncedAtMain}>
                    Data as of {new Date(syncedAt).toLocaleString()}
                    {hasMetrics && <span className="cached-badge" style={{ marginLeft: 8, fontSize: '0.68rem' }}>30d metrics</span>}
                  </div>
                )}
              </div>

              {/* ── Date Range Selector ── */}
              <div className={styles.dateSelectorWrap} ref={datePickerRef}>
                <div className={styles.dateSelectorRow}>

                  {/* 1. Preset label — opens picker */}
                  <button
                    className={`${styles.dateSelectorPresetTrigger}${datePickerOpen ? ` ${styles.dateSelectorOpen}` : ''}`}
                    onClick={() => setDatePickerOpen(o => !o)}
                  >
                    {DATE_PRESETS.find(p => p.id === datePreset)?.label}
                  </button>

                  {/* 2. Date range display — opens same picker */}
                  <button
                    className={`${styles.dateSelectorRangeTrigger}${datePickerOpen ? ` ${styles.dateSelectorOpen}` : ''}`}
                    onClick={() => setDatePickerOpen(o => !o)}
                  >
                    <span>{computeDateRange(datePreset, customFrom, customTo).display}</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={styles.dateSelectorChevron}>
                      <path d="M1 3L5 7L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {/* 3. Back / Forward arrows */}
                  <div className={styles.dateSelectorArrows}>
                    <button className={styles.dateSelectorArrow} onClick={() => navigateDates(-1)} title="Previous period">&#8249;</button>
                    <button className={styles.dateSelectorArrow} onClick={() => navigateDates(1)} title="Next period">&#8250;</button>
                  </div>

                  {/* 4. Quick “Last 30 days” shortcut */}
                  <button
                    className={styles.dateSelectorQuickLink}
                    onClick={() => { setDatePreset('last30'); setDatePickerOpen(false); }}
                    disabled={datePreset === 'last30'}
                  >Show last 30 days</button>

                </div>

                {datePickerOpen && (
                  <div className={`${styles.dateSelectorDropdown}${datePreset === 'custom' ? ` ${styles.dateSelectorDropdownRight}` : ''}`}>
                    <div className={styles.dateSelectorPresetList}>
                      {DATE_PRESETS.map(p => (
                        <button
                          key={p.id}
                          className={`${styles.dateSelectorPresetItem}${datePreset === p.id ? ` ${styles.dateSelectorPresetActive}` : ''}`}
                          onClick={() => {
                            if (p.id === 'custom') {
                              // Pre-fill custom inputs with current range so display doesn't go blank
                              const { from, to } = computeDateRange(datePreset, customFrom, customTo);
                              if (from && !customFrom) setCustomFrom(from);
                              if (to && !customTo) setCustomTo(to);
                            } else {
                              setDatePickerOpen(false);
                            }
                            setDatePreset(p.id);
                          }}
                        >{p.label}</button>
                      ))}
                    </div>
                    {datePreset === 'custom' && (
                      <div className={styles.dateSelectorCustomPanel}>
                        <div className={styles.dateSelectorCustomFields}>
                          <div>
                            <label className={styles.dateSelectorCustomLabel}>Start</label>
                            <input type="date" className={styles.dateSelectorDateInput} value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)} />
                          </div>
                          <span className={styles.dateSelectorCustomDash}>–</span>
                          <div>
                            <label className={styles.dateSelectorCustomLabel}>End</label>
                            <input type="date" className={styles.dateSelectorDateInput} value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)} />
                          </div>
                        </div>
                        <button
                          className="upload-btn"
                          style={{ marginTop: 10 }}
                          onClick={() => { if (customFrom && customTo) setDatePickerOpen(false); }}
                          disabled={!customFrom || !customTo}
                        >Apply</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* Summary stats */}
            {accounts.length > 0 && (
              <div className="stock-stat-grid" style={{ marginBottom: 24, opacity: metricsLoading ? 0.5 : 1, transition: 'opacity 0.25s' }}>
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
                    <div className="stock-stat-label">Impressions ({periodLabel})</div>
                    <div className="stock-stat-value">{fmtNum(totals.impressions)}</div>
                  </div>
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">Clicks ({periodLabel})</div>
                    <div className="stock-stat-value">{fmtNum(totals.clicks)}</div>
                    <div className="stock-stat-sub">
                      CTR {fmtCTR(totals.impressions, totals.clicks)}
                    </div>
                  </div>
                  <div className="stock-stat-item">
                    <div className="stock-stat-label">Total Spend ({periodLabel})</div>
                    <div className="stock-stat-value">{fmtCost(totals.costMicros, 'USD')}</div>
                    <div className="stock-stat-sub">
                      Avg CPC {fmtCPC(totals.costMicros, totals.clicks, 'USD')}
                    </div>
                  </div>
                  {totals.conversions > 0 && (
                    <div className="stock-stat-item">
                      <div className="stock-stat-label">Conversions ({periodLabel})</div>
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
                <span className={styles.emptyIcon}>📊</span>
                <p>No accounts loaded yet.</p>
                <p className={styles.emptyHint}>
                  Click <strong>↻ Sync Accounts</strong> to pull data from the Google Ads API.
                  Make sure these environment variables are set in your <code>.env.local</code>:
                </p>
                <ul className={styles.envList}>
                  <li>GOOGLE_ADS_DEVELOPER_TOKEN</li>
                  <li>GOOGLE_ADS_LOGIN_CUSTOMER_ID</li>
                  <li>GOOGLE_SERVICE_ACCOUNT_EMAIL</li>
                  <li>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</li>
                </ul>
              </div>
            )}

            {/* Accounts table */}
            {!loading && filtered.length > 0 && (
              <div className={styles.tableWrapper}>
                <table className="stocks-table">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort('name')} className={styles.thSortable}>
                        Account Name{sortIndicator('name')}
                      </th>
                      <th onClick={() => toggleSort('id')} className={styles.thSortable}>
                        Customer ID{sortIndicator('id')}
                      </th>
                      <th>Currency</th>
                      <th>Time Zone</th>
                      <th>Status</th>
                      {hasMetrics && <>
                        <th onClick={() => toggleSort('impressions')} className={styles.thSortable}>
                          Impressions{sortIndicator('impressions')}
                        </th>
                        <th onClick={() => toggleSort('clicks')} className={styles.thSortable}>
                          Clicks{sortIndicator('clicks')}
                        </th>
                        <th>CTR</th>
                        <th onClick={() => toggleSort('cost')} className={styles.thSortable}>
                          Cost ({periodLabel}){sortIndicator('cost')}
                        </th>
                        <th>CPC</th>
                        <th onClick={() => toggleSort('conversions')} className={styles.thSortable}>
                          Conv.{sortIndicator('conversions')}
                        </th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(a => {
                      const m = getM(a);
                      const isExpanded = expandedAccountId === a.id;
                      const colSpan = hasMetrics ? 11 : 5;
                      const campaigns = campaignRows[a.id] || [];
                      return (
                        <React.Fragment key={a.id}>
                          <tr key={a.id}>
                            <td>
                              <button
                                className={styles.drillLink}
                                onClick={() => toggleCampaigns(a)}
                                title={isExpanded ? 'Collapse campaigns' : 'View campaigns'}
                              >
                                <span className={styles.drillArrow}>{isExpanded ? '▾' : '▸'}</span>
                                <span className={styles.accountName}>{a.name}</span>
                              </button>
                              <div className={styles.accountFlags}>
                                {a.isTest && <span className={styles.testBadge}>TEST</span>}
                                {a.isManager && <span className={styles.mgrBadge}>MGR</span>}
                              </div>
                            </td>
                            <td className={styles.tdCustomerId}>{formatCustomerId(a.id)}</td>
                            <td>{a.currencyCode}</td>
                            <td className={styles.tdTimezone}>{a.timeZone}</td>
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
                          {isExpanded && (
                            <tr className={styles.drillRow}>
                              <td colSpan={colSpan} className={styles.drillCell}>
                                {campaignLoading === a.id ? (
                                  <div className={styles.drillLoading}>Loading campaigns…</div>
                                ) : campaigns.length === 0 ? (
                                  <div className={styles.drillEmpty}>No campaigns found for this period.</div>
                                ) : (
                                  <table className={styles.drillTable}>
                                    <thead>
                                      <tr>
                                        <th>Campaign</th>
                                        <th>Status</th>
                                        <th>Type</th>
                                        <th>Impressions</th>
                                        <th>Clicks</th>
                                        <th>CTR</th>
                                        <th>Cost</th>
                                        <th>Conv.</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {campaigns.map(c => {
                                        const cm = c.metrics || {};
                                        const cExpanded = expandedCampaignId === c.id;
                                        const ads = adRows[c.id] || [];
                                        return (
                                          <React.Fragment key={c.id}>
                                            <tr key={c.id}>
                                              <td>
                                                <button
                                                  className={styles.drillLink}
                                                  onClick={() => toggleAds(a, c)}
                                                  title={cExpanded ? 'Collapse ads' : 'View ads'}
                                                >
                                                  <span className={styles.drillArrow}>{cExpanded ? '▾' : '▸'}</span>
                                                  {c.name}
                                                </button>
                                              </td>
                                              <td><StatusBadge status={c.status} /></td>
                                              <td className={styles.drillMeta}>{c.channelType}</td>
                                              <td>{cm.impressions ? fmtNum(cm.impressions) : '—'}</td>
                                              <td>{cm.clicks ? fmtNum(cm.clicks) : '—'}</td>
                                              <td>{fmtCTR(cm.impressions, cm.clicks)}</td>
                                              <td>{cm.costMicros ? fmtCost(cm.costMicros, a.currencyCode) : '—'}</td>
                                              <td>{cm.conversions ? fmtNum(Math.round(cm.conversions)) : '—'}</td>
                                            </tr>
                                            {cExpanded && (
                                              <tr className={styles.drillRow}>
                                                <td colSpan={8} className={styles.drillCell}>
                                                  {adLoading === c.id ? (
                                                    <div className={styles.drillLoading}>Loading ads…</div>
                                                  ) : ads.length === 0 ? (
                                                    <div className={styles.drillEmpty}>No ads found for this period.</div>
                                                  ) : (
                                                    <table className={styles.drillTable}>
                                                      <thead>
                                                        <tr>
                                                          <th>Ad</th>
                                                          <th>Ad Group</th>
                                                          <th>Type</th>
                                                          <th>Status</th>
                                                          <th>Impressions</th>
                                                          <th>Clicks</th>
                                                          <th>CTR</th>
                                                          <th>Cost</th>
                                                          <th>Conv.</th>
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {ads.map(ad => {
                                                          const am = ad.metrics || {};
                                                          return (
                                                            <tr key={ad.id}>
                                                              <td>{ad.name || `Ad ${ad.id}`}</td>
                                                              <td className={styles.drillMeta}>{ad.adGroupName}</td>
                                                              <td className={styles.drillMeta}>{ad.type}</td>
                                                              <td><StatusBadge status={ad.status} /></td>
                                                              <td>{am.impressions ? fmtNum(am.impressions) : '—'}</td>
                                                              <td>{am.clicks ? fmtNum(am.clicks) : '—'}</td>
                                                              <td>{fmtCTR(am.impressions, am.clicks)}</td>
                                                              <td>{am.costMicros ? fmtCost(am.costMicros, a.currencyCode) : '—'}</td>
                                                              <td>{am.conversions ? fmtNum(Math.round(am.conversions)) : '—'}</td>
                                                            </tr>
                                                          );
                                                        })}
                                                      </tbody>
                                                    </table>
                                                  )}
                                                </td>
                                              </tr>
                                            )}
                                          </React.Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {filtered.length < accounts.length && (
                  <div className={styles.tableFooter}>
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
      <div className={styles.composerOuter}>
        <div ref={composerRef} className={styles.composer} style={{
          width: composerDims.width ? composerDims.width + 'px' : 'min(980px, 94%)',
          height: composerDims.height ? composerDims.height + 'px' : 'auto',
          maxHeight: composerDims.height ? 'none' : '60vh',
          minHeight: composerDims.minimized ? '170px' : '120px',
        }}>
          <div className={styles.composerHeader}>
            <div className={styles.composerTitle}>Account Optimizer</div>
            <div className={styles.composerAccountLabel}>
              {filtered.length === 0 ? 'No account selected' : filtered.length === 1 ? filtered[0].name : `${filtered.length} accounts`}
            </div>
            <div className={styles.composerControls}>
              <button
                title="Shrink"
                onClick={handleShrink}
                className={`${styles.composerCtrlBtn} ${styles.composerCtrlBtnShrink}`}
              >−</button>
              <button
                title="Expand"
                onClick={handleExpand}
                className={`${styles.composerCtrlBtn} ${styles.composerCtrlBtnExpand}`}
              >⤢</button>
              <div
                role="button"
                tabIndex={0}
                title="Drag to resize"
                onMouseDown={handleDragStart}
                className={styles.composerDragHandle}
              >≡</div>
            </div>
          </div>
          <div className={[styles.messagesArea, optMessages.length > 0 && styles.messagesAreaHasMsgs, composerDims.minimized && styles.messagesAreaMinimized].filter(Boolean).join(' ')}>
            {(() => {
              // find index of the last user message to attach the scroll ref
              let lastUserIdx = -1;
              for (let i = optMessages.length - 1; i >= 0; i--) {
                if (optMessages[i].role === 'user') { lastUserIdx = i; break; }
              }
              return optMessages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={i}
                    ref={isUser && i === lastUserIdx ? optLatestUserMsgRef : null}
                    className={`${styles.messageRow}${isUser ? ` ${styles.messageRowUser}` : ''}`}
                  >
                    <div className={`${styles.messageBubble} ${isUser ? styles.messageBubbleUser : styles.messageBubbleAi}`}>
                      {isUser
                        ? <span className={styles.userBubbleText}>{m.content}</span>
                        : <div
                            className={`markdown-body ${styles.aiContent}`}
                            dangerouslySetInnerHTML={{ __html: m.content ? marked.parse(m.content) : '<span style="opacity:0.4">Thinking…</span>' }}
                          />
                      }
                    </div>
                  </div>
                );
              });
            })()}
            <div ref={optMessagesEndRef} />
          </div>
          <div className={styles.inputRow}>
            <textarea
              value={optInput}
              onChange={e => setOptInput(e.target.value)}
              placeholder={filtered.length > 0 ? `Ask about ${filtered.length === 1 ? filtered[0].name : `${filtered.length} accounts`} (e.g. "Which campaigns had the best ROAS?")` : 'Select an account to target, then ask a question...'}
              rows={2}
              className={styles.optTextarea}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleOptimizerSend(); } }}
            />
            <button className="generate-btn" onClick={handleOptimizerSend} disabled={optLoading} aria-label="Analyze">
              {optLoading
                ? <span className="arrow-loader" />
                : <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', margin: 'auto' }}>
                    <circle cx="14" cy="14" r="14" fill="#fff" />
                    <path d="M14 8V20M14 8L8 14M14 8L20 14" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
              }
            </button>
          </div>
          {/* Toolbar: platform / source / model selects */}
          <div className={styles.toolbarRow}>
            <select
              value={optPlatform}
              onChange={e => setOptPlatform(e.target.value)}
              className={`${styles.toolbarSelect} ${styles.toolbarSelectWide}`}
            >
              {['Campaign Performance','Ad Copy Review','Keyword Strategy','Budget Optimization','Conversion Analysis','Custom Analysis'].map(o => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <select
              value={optSourceOption}
              onChange={e => setOptSourceOption(e.target.value)}
              className={styles.toolbarSelect}
            >
              <option value="mydata">My Data Only</option>
              <option value="combined">My Data + Model</option>
              <option value="model">Model Only</option>
            </select>
            <select
              value={optGeminiModel}
              onChange={e => setOptGeminiModel(e.target.value)}
              className={styles.toolbarSelect}
            >
              <optgroup label="Gemini 2.5">
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
              </optgroup>
            </select>
          </div>
        </div>
      </div>

      {/* ── CSV Import modal ── */}
      {csvModal.open && (
        <div
          className={styles.csvOverlay}
          onMouseDown={e => { if (e.target === e.currentTarget) setCsvModal({ open: false }); }}
        >
          <div className={styles.csvCard}>

            <div className={styles.csvModalHeader}>
              <h3 className={styles.csvModalTitle}>Import Ads CSV</h3>
              <button onMouseDown={() => setCsvModal({ open: false })} className={styles.csvCloseBtn}>×</button>
            </div>

            <label className={styles.csvFieldLabel}>Data Label</label>
            <input
              className="sidebar-input"
              placeholder="e.g. Brand Campaigns Q1 2026"
              value={csvModalLabel}
              onChange={e => setCsvModalLabel(e.target.value)}
              style={{ marginBottom: 14 }}
            />

            <label className={styles.csvFieldLabelFile}>CSV File</label>
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
              className={styles.csvDropzone}
            >
              {csvModalFile ? (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span className={styles.csvFileName}>{csvModalFile.name}</span>
                  <span className={styles.csvFileSize}>{(csvModalFile.size / 1024).toFixed(1)} KB &nbsp;·&nbsp; click to change</span>
                </>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span className={styles.csvDropLabel}>Drop CSV here</span>
                  <span className={styles.csvDropHint}>or click to browse</span>
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
              <div className={styles.csvMappingSection}>
                <div className={styles.csvMappingTitle}>Column Mapping</div>
                <div className={styles.csvMappingHint}>Map each required field to the matching column in your CSV.</div>
                <div className={styles.csvMappingGrid}>
                  {CSV_FIELDS.map(field => (
                    <div key={field}>
                      <label className={styles.csvInnerLabel}>
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                        {csvModalMapping[field] ? (
                          <span className={styles.csvMappedMark}>✓</span>
                        ) : CSV_REQUIRED.includes(field) ? (
                          <span className={styles.csvRequiredMark}>required</span>
                        ) : (
                          <span className={styles.csvOptionalMark}>optional</span>
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
              <div className={styles.csvError}>
                {csvModalError}
              </div>
            )}

            <div className={styles.csvFooter}>
              <button
                className={`upload-btn ${styles.csvCancelBtn}`}
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
      <div className={styles.toast}>{toastMsg}</div>
      )}
    </ErrorBoundary>
  );
}
