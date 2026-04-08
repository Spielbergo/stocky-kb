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
  const [modalInputValue, setModalInputValue] = useState('');
  const modalInputValueRef = useRef('');
  const [toastMsg, setToastMsg]   = useState('');

  // ── Campaign / Ad drill-down ──────────────────────────────────────────────
  const [expandedAccountId, setExpandedAccountId]       = useState(null);
  const [campaignRows, setCampaignRows]                 = useState({});   // { [accountId]: campaign[] }
  const [campaignLoading, setCampaignLoading]           = useState(null); // accountId being loaded
  const [expandedCampaignId, setExpandedCampaignId]     = useState(null);
  const [campaignTab, setCampaignTab]                   = useState({});   // { [campaignId]: 'adGroups'|'keywords'|'searchTerms' }
  const [adGroupRows, setAdGroupRows]                   = useState({});   // { [campaignId]: adGroup[] }
  const [adGroupLoading, setAdGroupLoading]             = useState(null); // campaignId being loaded
  const [keywordRows, setKeywordRows]                   = useState({});   // { [campaignId]: keyword[] }
  const [keywordLoading, setKeywordLoading]             = useState(null);
  const [searchTermRows, setSearchTermRows]             = useState({});   // { [campaignId]: searchTerm[] }
  const [searchTermLoading, setSearchTermLoading]       = useState(null);
  const [expandedAdGroupId, setExpandedAdGroupId]       = useState(null);
  const [adRows, setAdRows]                             = useState({});   // { [adGroupId]: ad[] }
  const [adLoading, setAdLoading]                       = useState(null); // adGroupId being loaded
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('ACTIVE'); // ACTIVE | PAUSED | REMOVED | ALL
  const [kwSearchFilter, setKwSearchFilter]             = useState('');   // filter keywords by text
  const [sidebarCollapsed, setSidebarCollapsed]         = useState(false);

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

  // ── Chat sessions ────────────────────────────────────────────────────────
  const [chatSessions, setChatSessions]   = useState([]);   // [{id,title,messages,updatedAt}]
  const [activeChatId, setActiveChatId]   = useState(null);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const autoSaveTimerRef = useRef(null);
  const activeChatIdRef  = useRef(null);

  // Keep ref in sync so the auto-save effect can read the latest ID without a dep
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  const genChatId = () => `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const loadChatSessions = async () => {
    try {
      const res = await fetch('/api/chats?profile=ads_optimizer');
      if (res.ok) setChatSessions(await res.json());
    } catch {}
  };

  // Auto-save: debounced 1.5 s after messages stop changing
  useEffect(() => {
    if (!optMessages.length) return;
    let id = activeChatIdRef.current;
    if (!id) {
      id = genChatId();
      activeChatIdRef.current = id;
      setActiveChatId(id);
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const firstUser = optMessages.find(m => m.role === 'user')?.content || '';
      const title = firstUser.length > 60 ? firstUser.slice(0, 60) + '…' : firstUser || 'Chat';
      const doc = { id, title, messages: optMessages, profile: 'ads_optimizer', updatedAt: new Date().toISOString() };
      fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
        .catch(() => {});
      setChatSessions(prev => [doc, ...prev.filter(c => c.id !== id)]);
    }, 1500);
  }, [optMessages]);

  const loadChatSession = (session) => {
    setOptMessages(session.messages || []);
    setActiveChatId(session.id);
    setChatModalOpen(false);
  };

  const deleteChatSession = async (id) => {
    await fetch(`/api/chats?id=${id}`, { method: 'DELETE' });
    setChatSessions(prev => prev.filter(c => c.id !== id));
    if (activeChatId === id) { setOptMessages([]); setActiveChatId(null); }
  };

  const startNewChat = () => {
    setOptMessages([]);
    setActiveChatId(null);
    setChatModalOpen(false);
  };

  useEffect(() => { loadChatSessions(); }, []);

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
    if (campaignRows[account.id]?.length > 0) return; // already loaded with data
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

  // Open a campaign's detail row; set default tab and trigger initial data load
  const toggleCampaignDetail = async (account, campaign, tab) => {
    const nextTab = tab || campaignTab[campaign.id] || 'adGroups';
    if (expandedCampaignId === campaign.id && (!tab || campaignTab[campaign.id] === nextTab)) {
      setExpandedCampaignId(null);
      return;
    }
    setExpandedCampaignId(campaign.id);
    setCampaignTab(prev => ({ ...prev, [campaign.id]: nextTab }));
    setExpandedAdGroupId(null);
    await loadCampaignTabData(account, campaign, nextTab);
  };

  const loadCampaignTabData = async (account, campaign, tab) => {
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from || !to) return;
    const qs = `accountId=${account.id}&campaignId=${campaign.id}&dateFrom=${from}&dateTo=${to}&includePaused=${includePaused ? '1' : '0'}`;

    if (tab === 'adGroups' && !adGroupRows[campaign.id]) {
      setAdGroupLoading(campaign.id);
      try {
        const res = await fetch(`/api/ads-campaigns?${qs}&view=adGroups`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setAdGroupRows(prev => ({ ...prev, [campaign.id]: data.adGroups || [] }));
      } catch (e) { toast(e.message); }
      finally { setAdGroupLoading(null); }
    }
    if (tab === 'keywords' && !keywordRows[campaign.id]) {
      setKeywordLoading(campaign.id);
      try {
        const res = await fetch(`/api/ads-campaigns?${qs}&view=keywords`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setKeywordRows(prev => ({ ...prev, [campaign.id]: data.keywords || [] }));
      } catch (e) { toast(e.message); }
      finally { setKeywordLoading(null); }
    }
    if (tab === 'searchTerms' && !searchTermRows[campaign.id]) {
      setSearchTermLoading(campaign.id);
      try {
        const res = await fetch(`/api/ads-campaigns?${qs}&view=searchTerms`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setSearchTermRows(prev => ({ ...prev, [campaign.id]: data.searchTerms || [] }));
      } catch (e) { toast(e.message); }
      finally { setSearchTermLoading(null); }
    }
  };

  const switchCampaignTab = (account, campaign, tab) => {
    setCampaignTab(prev => ({ ...prev, [campaign.id]: tab }));
    setExpandedAdGroupId(null);
    loadCampaignTabData(account, campaign, tab);
  };

  // Load ads for a specific ad group
  const toggleAdGroupAds = async (account, campaign, adGroup) => {
    if (expandedAdGroupId === adGroup.id) { setExpandedAdGroupId(null); return; }
    setExpandedAdGroupId(adGroup.id);
    if (adRows[adGroup.id]?.length > 0) return;
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from || !to) return;
    setAdLoading(adGroup.id);
    try {
      const res = await fetch(
        `/api/ads-campaigns?accountId=${account.id}&campaignId=${campaign.id}&adGroupId=${adGroup.id}&dateFrom=${from}&dateTo=${to}&includePaused=${includePaused ? '1' : '0'}&view=ads`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ads');
      setAdRows(prev => ({ ...prev, [adGroup.id]: data.ads || [] }));
    } catch (e) { toast(e.message); }
    finally { setAdLoading(null); }
  };

  // Invalidate all drill caches when date range or includePaused changes
  useEffect(() => {
    setCampaignRows({});
    setAdGroupRows({});
    setKeywordRows({});
    setSearchTermRows({});
    setAdRows({});
    setExpandedCampaignId(null);
    setExpandedAdGroupId(null);
  }, [datePreset, customFrom, customTo, includePaused]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Shrink/expand should only change height; keep width unchanged
  const handleShrink = () => setComposerDims(d => ({ ...d, minimized: true, expanded: false, height: null }));
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
          <aside className={`admin-sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>

            <div className="sidebar-profile-badge" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="sidebar-profile-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                </div>
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
              <button
                onClick={() => setSidebarCollapsed(true)}
                title="Collapse sidebar"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
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
              {/* <label className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Include paused campaigns</span>
                <span className={`${styles.toggleSwitch}${includePaused ? ` ${styles.toggleSwitchOn}` : ''}`} onClick={() => setIncludePaused(v => !v)} role="checkbox" aria-checked={includePaused} tabIndex={0} onKeyDown={e => e.key === ' ' && setIncludePaused(v => !v)}>
                  <span className={styles.toggleThumb} />
                </span>
              </label> */}
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
                            className={styles.savedPromptEdit}
                            onClick={() => {
                              modalInputValueRef.current = p.text || '';
                              setModalInputValue(p.text || '');
                              setModal({
                                open: true,
                                variant: 'input',
                                title: `Edit prompt: ${p.label}`,
                                inputPlaceholder: 'Edit prompt text...',
                                inputValue: p.text || '',
                                multiline: true,
                                onConfirm: async () => {
                                  const newText = modalInputValueRef.current || '';
                                  if (newText.trim() === (p.text || '').trim()) { closeModal(); return; }
                                  try {
                                    const res = await fetch('/api/ads-prompts', {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: p.id, text: newText })
                                    });
                                    const json = await res.json();
                                    if (res.ok) {
                                      setSavedPrompts(prev => prev.map(pp => pp.id === p.id ? { ...pp, text: json.prompt.text } : pp));
                                      toast('Prompt updated');
                                      closeModal();
                                    } else {
                                      toast(json.error || 'Update failed');
                                    }
                                  } catch (e) { toast('Update failed'); }
                                },
                                onInputChange: v => { modalInputValueRef.current = v; setModalInputValue(v); }
                              });
                            }}
                            title="Edit prompt"
                            aria-label="Edit prompt"
                          >✎</button>
                          <button
                            className={styles.savedPromptDelete}
                            onClick={() => setModal({ open: true, variant: 'confirm', title: 'Delete prompt?', message: `"${p.label}" will be permanently deleted.`, confirmText: 'Delete', onConfirm: () => { deletePrompt(p.id); closeModal(); } })}
                            title="Delete prompt"
                          >✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

          </aside>

          {/* ── Main ── */}
          <main className="admin-main">

            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
                style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderLeft: 'none', borderRadius: '0 6px 6px 0', padding: '10px 5px', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            )}

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
                                ) : (
                                  <>
                                  <div className={styles.drillFilterBar}>
                                    {['ACTIVE','PAUSED','REMOVED','ALL'].map(f => (
                                      <button
                                        key={f}
                                        className={`${styles.drillFilterBtn}${campaignStatusFilter === f ? ` ${styles.drillFilterBtnActive}` : ''}`}
                                        onClick={() => setCampaignStatusFilter(f)}
                                      >{f === 'ACTIVE' ? 'Active' : f === 'PAUSED' ? 'Paused' : f === 'REMOVED' ? 'Removed' : 'All'}</button>
                                    ))}
                                    <span className={styles.drillFilterCount}>
                                      {(() => {
                                        const fc = campaigns.filter(c =>
                                          campaignStatusFilter === 'ALL' ? true :
                                          campaignStatusFilter === 'ACTIVE' ? c.status === 'ENABLED' :
                                          c.status === campaignStatusFilter
                                        ).length;
                                        return `${fc} campaign${fc !== 1 ? 's' : ''}`;
                                      })()}
                                    </span>
                                  </div>
                                  {(() => {
                                    const filteredCampaigns = campaigns.filter(c =>
                                      campaignStatusFilter === 'ALL' ? true :
                                      campaignStatusFilter === 'ACTIVE' ? c.status === 'ENABLED' :
                                      c.status === campaignStatusFilter
                                    );
                                    return filteredCampaigns.length === 0 ? (
                                      <div className={styles.drillEmpty}>No {campaignStatusFilter.toLowerCase()} campaigns.</div>
                                    ) : (
                                  <table className={styles.drillTable}>
                                    <thead>
                                      <tr>
                                        <th>Campaign</th>
                                        <th>Status</th>
                                        <th>Type</th>
                                        <th>Bidding</th>
                                        <th>Impressions</th>
                                        <th>Clicks</th>
                                        <th>CTR</th>
                                        <th>Cost</th>
                                        <th>CPC</th>
                                        <th>Conv.</th>
                                        <th>IS%</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {filteredCampaigns.map(c => {
                                        const cm = c.metrics || {};
                                        const cExpanded = expandedCampaignId === c.id;
                                        const activeTab = campaignTab[c.id] || 'adGroups';
                                        const agRows    = adGroupRows[c.id] || [];
                                        const kwRows    = keywordRows[c.id] || [];
                                        const stRows    = searchTermRows[c.id] || [];
                                        const isShare   = cm.searchImprShare != null ? (parseFloat(cm.searchImprShare) * 100).toFixed(1) + '%' : '—';
                                        return (
                                          <React.Fragment key={c.id}>
                                            <tr>
                                              <td>
                                                <button
                                                  className={styles.drillLink}
                                                  onClick={() => toggleCampaignDetail(a, c, null)}
                                                  title={cExpanded ? 'Collapse' : 'View ad groups, keywords & search terms'}
                                                >
                                                  <span className={styles.drillArrow}>{cExpanded ? '▾' : '▸'}</span>
                                                  {c.name}
                                                </button>
                                              </td>
                                              <td><StatusBadge status={c.status} /></td>
                                              <td className={styles.drillMeta}>{c.channelType}</td>
                                              <td className={styles.drillMeta}>{c.biddingStrategy}</td>
                                              <td>{cm.impressions ? fmtNum(cm.impressions) : '—'}</td>
                                              <td>{cm.clicks ? fmtNum(cm.clicks) : '—'}</td>
                                              <td>{fmtCTR(cm.impressions, cm.clicks)}</td>
                                              <td>{cm.costMicros ? fmtCost(cm.costMicros, a.currencyCode) : '—'}</td>
                                              <td>{cm.avgCpcMicros ? fmtCost(cm.avgCpcMicros, a.currencyCode) : fmtCPC(cm.costMicros, cm.clicks, a.currencyCode)}</td>
                                              <td>{cm.conversions ? fmtNum(Math.round(cm.conversions)) : '—'}</td>
                                              <td className={styles.drillMeta}>{isShare}</td>
                                            </tr>
                                            {cExpanded && (
                                              <tr className={styles.drillRow}>
                                                <td colSpan={11} className={styles.drillCell}>
                                                  {/* Tab bar */}
                                                  <div className={styles.drillTabBar}>
                                                    {[['adGroups','Ad Groups'],['keywords','Keywords'],['searchTerms','Search Terms']].map(([tab,label]) => (
                                                      <button
                                                        key={tab}
                                                        className={`${styles.drillTab}${activeTab === tab ? ` ${styles.drillTabActive}` : ''}`}
                                                        onClick={() => switchCampaignTab(a, c, tab)}
                                                      >{label}</button>
                                                    ))}
                                                  </div>

                                                  {/* ── Ad Groups tab ── */}
                                                  {activeTab === 'adGroups' && (
                                                    adGroupLoading === c.id ? <div className={styles.drillLoading}>Loading ad groups…</div> :
                                                    agRows.length === 0 ? <div className={styles.drillEmpty}>No ad groups found.</div> :
                                                    <table className={styles.drillTable}>
                                                      <thead><tr>
                                                        <th>Ad Group</th>
                                                        <th>Status</th>
                                                        <th>Type</th>
                                                        <th>CPC Bid</th>
                                                        <th>Impressions</th>
                                                        <th>Clicks</th>
                                                        <th>CTR</th>
                                                        <th>Cost</th>
                                                        <th>Avg CPC</th>
                                                        <th>Conv.</th>
                                                      </tr></thead>
                                                      <tbody>
                                                        {agRows.map(ag => {
                                                          const agm = ag.metrics || {};
                                                          const agExpanded = expandedAdGroupId === ag.id;
                                                          const ads = adRows[ag.id] || [];
                                                          return (
                                                            <React.Fragment key={ag.id}>
                                                              <tr>
                                                                <td>
                                                                  <button
                                                                    className={styles.drillLink}
                                                                    onClick={() => toggleAdGroupAds(a, c, ag)}
                                                                    title={agExpanded ? 'Collapse ads' : 'View ads'}
                                                                  >
                                                                    <span className={styles.drillArrow}>{agExpanded ? '▾' : '▸'}</span>
                                                                    {ag.name}
                                                                  </button>
                                                                </td>
                                                                <td><StatusBadge status={ag.status} /></td>
                                                                <td className={styles.drillMeta}>{ag.type}</td>
                                                                <td className={styles.drillMeta}>{ag.bidMicros ? fmtCost(ag.bidMicros, a.currencyCode) : '—'}</td>
                                                                <td>{agm.impressions ? fmtNum(agm.impressions) : '—'}</td>
                                                                <td>{agm.clicks ? fmtNum(agm.clicks) : '—'}</td>
                                                                <td>{fmtCTR(agm.impressions, agm.clicks)}</td>
                                                                <td>{agm.costMicros ? fmtCost(agm.costMicros, a.currencyCode) : '—'}</td>
                                                                <td>{agm.avgCpcMicros ? fmtCost(agm.avgCpcMicros, a.currencyCode) : '—'}</td>
                                                                <td>{agm.conversions ? fmtNum(Math.round(agm.conversions)) : '—'}</td>
                                                              </tr>
                                                              {agExpanded && (
                                                                <tr className={styles.drillRow}>
                                                                  <td colSpan={10} className={styles.drillCell}>
                                                                    {adLoading === ag.id ? (
                                                                      <div className={styles.drillLoading}>Loading ads…</div>
                                                                    ) : ads.length === 0 ? (
                                                                      <div className={styles.drillEmpty}>No ads found.</div>
                                                                    ) : (
                                                                      <table className={styles.drillTable}>
                                                                        <thead><tr>
                                                                          <th>Ad Preview</th>
                                                                          <th>Type</th>
                                                                          <th>Status</th>
                                                                          <th>Policy</th>
                                                                          <th>Final URL</th>
                                                                          <th>Impressions</th>
                                                                          <th>Clicks</th>
                                                                          <th>CTR</th>
                                                                          <th>Cost</th>
                                                                          <th>Avg CPC</th>
                                                                          <th>Conv.</th>
                                                                        </tr></thead>
                                                                        <tbody>
                                                                          {ads.map(ad => {
                                                                            const am = ad.metrics || {};
                                                                            const h1 = ad.headlines?.[0] || ad.name || `Ad ${ad.id}`;
                                                                            const h2 = ad.headlines?.[1] || '';
                                                                            const desc = ad.descriptions?.[0] || '';
                                                                            return (
                                                                              <tr key={ad.id}>
                                                                                <td className={styles.adPreviewCell}>
                                                                                  <div className={styles.adPreviewHeadline}>{h1}{h2 ? ` | ${h2}` : ''}</div>
                                                                                  {desc && <div className={styles.adPreviewDesc}>{desc}</div>}
                                                                                  {ad.headlines?.length > 2 && <div className={styles.adPreviewMore}>+{ad.headlines.length - 2} more headlines · {ad.descriptions?.length || 0} descriptions</div>}
                                                                                </td>
                                                                                <td className={styles.drillMeta}>{ad.type?.replace('_',' ')}</td>
                                                                                <td><StatusBadge status={ad.status} /></td>
                                                                                <td className={styles.drillMeta}>{ad.approvalStatus || '—'}</td>
                                                                                <td className={styles.adUrlCell} title={ad.finalUrl}>{ad.finalUrl ? <a href={ad.finalUrl} target="_blank" rel="noreferrer" className={styles.adUrlLink}>{ad.finalUrl.replace(/^https?:\/\//,'').slice(0,40)}{ad.finalUrl.length > 50 ? '…' : ''}</a> : '—'}</td>
                                                                                <td>{am.impressions ? fmtNum(am.impressions) : '—'}</td>
                                                                                <td>{am.clicks ? fmtNum(am.clicks) : '—'}</td>
                                                                                <td>{fmtCTR(am.impressions, am.clicks)}</td>
                                                                                <td>{am.costMicros ? fmtCost(am.costMicros, a.currencyCode) : '—'}</td>
                                                                                <td>{am.avgCpcMicros ? fmtCost(am.avgCpcMicros, a.currencyCode) : '—'}</td>
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

                                                  {/* ── Keywords tab ── */}
                                                  {activeTab === 'keywords' && (
                                                    keywordLoading === c.id ? <div className={styles.drillLoading}>Loading keywords…</div> :
                                                    kwRows.length === 0 ? <div className={styles.drillEmpty}>No keywords found for this period.</div> : (() => {
                                                      const filteredKws = kwSearchFilter
                                                        ? kwRows.filter(k => k.text.toLowerCase().includes(kwSearchFilter.toLowerCase()))
                                                        : kwRows;
                                                      return (
                                                        <>
                                                          <div className={styles.drillSearchRow}>
                                                            <input
                                                              className={styles.drillSearchInput}
                                                              placeholder="Filter keywords…"
                                                              value={kwSearchFilter}
                                                              onChange={e => setKwSearchFilter(e.target.value)}
                                                            />
                                                            <span className={styles.drillFilterCount}>{filteredKws.length} of {kwRows.length}</span>
                                                          </div>
                                                          <table className={styles.drillTable}>
                                                            <thead><tr>
                                                              <th>Keyword</th>
                                                              <th>Match</th>
                                                              <th>Ad Group</th>
                                                              <th>Status</th>
                                                              <th>QS</th>
                                                              <th>Pred. CTR</th>
                                                              <th>Ad Rel.</th>
                                                              <th>LP Exp.</th>
                                                              <th>Bid</th>
                                                              <th>Impressions</th>
                                                              <th>Clicks</th>
                                                              <th>CTR</th>
                                                              <th>Cost</th>
                                                              <th>Avg CPC</th>
                                                              <th>Conv.</th>
                                                              <th>IS%</th>
                                                            </tr></thead>
                                                            <tbody>
                                                              {filteredKws.map(kw => {
                                                                const km = kw.metrics || {};
                                                                const qs = kw.qualityScore != null ? kw.qualityScore : '—';
                                                                const is = km.searchImprShare != null ? (parseFloat(km.searchImprShare)*100).toFixed(1)+'%' : '—';
                                                                return (
                                                                  <tr key={kw.id}>
                                                                    <td className={styles.kwText}>{kw.text}</td>
                                                                    <td><span className={`${styles.matchBadge} ${styles['match' + kw.matchType]}`}>{kw.matchType}</span></td>
                                                                    <td className={styles.drillMeta}>{kw.adGroupName}</td>
                                                                    <td><StatusBadge status={kw.status} /></td>
                                                                    <td className={styles.qsCell}>{qs !== '—' ? <span className={styles[`qs${qs > 6 ? 'High' : qs > 3 ? 'Mid' : 'Low'}`]}>{qs}</span> : '—'}</td>
                                                                    <td className={styles.drillMeta}>{kw.predictedCtr || '—'}</td>
                                                                    <td className={styles.drillMeta}>{kw.adRelevance || '—'}</td>
                                                                    <td className={styles.drillMeta}>{kw.landingPage || '—'}</td>
                                                                    <td className={styles.drillMeta}>{kw.bidMicros ? fmtCost(kw.bidMicros, a.currencyCode) : '—'}</td>
                                                                    <td>{km.impressions ? fmtNum(km.impressions) : '—'}</td>
                                                                    <td>{km.clicks ? fmtNum(km.clicks) : '—'}</td>
                                                                    <td>{fmtCTR(km.impressions, km.clicks)}</td>
                                                                    <td>{km.costMicros ? fmtCost(km.costMicros, a.currencyCode) : '—'}</td>
                                                                    <td>{km.avgCpcMicros ? fmtCost(km.avgCpcMicros, a.currencyCode) : '—'}</td>
                                                                    <td>{km.conversions ? fmtNum(Math.round(km.conversions)) : '—'}</td>
                                                                    <td className={styles.drillMeta}>{is}</td>
                                                                  </tr>
                                                                );
                                                              })}
                                                            </tbody>
                                                          </table>
                                                        </>
                                                      );
                                                    })()
                                                  )}

                                                  {/* ── Search Terms tab ── */}
                                                  {activeTab === 'searchTerms' && (
                                                    searchTermLoading === c.id ? <div className={styles.drillLoading}>Loading search terms…</div> :
                                                    stRows.length === 0 ? <div className={styles.drillEmpty}>No search terms data found for this period.</div> : (
                                                      <table className={styles.drillTable}>
                                                        <thead><tr>
                                                          <th>Search Term</th>
                                                          <th>Status</th>
                                                          <th>Ad Group</th>
                                                          <th>Impressions</th>
                                                          <th>Clicks</th>
                                                          <th>CTR</th>
                                                          <th>Cost</th>
                                                          <th>Avg CPC</th>
                                                          <th>Conv.</th>
                                                        </tr></thead>
                                                        <tbody>
                                                          {stRows.map((st, i) => (
                                                            <tr key={i}>
                                                              <td className={styles.kwText}>{st.term}</td>
                                                              <td className={styles.drillMeta}>{st.status}</td>
                                                              <td className={styles.drillMeta}>{st.adGroupName}</td>
                                                              <td>{st.impressions ? fmtNum(st.impressions) : '—'}</td>
                                                              <td>{st.clicks ? fmtNum(st.clicks) : '—'}</td>
                                                              <td>{fmtCTR(st.impressions, st.clicks)}</td>
                                                              <td>{st.costMicros ? fmtCost(st.costMicros, a.currencyCode) : '—'}</td>
                                                              <td>{st.avgCpcMicros ? fmtCost(st.avgCpcMicros, a.currencyCode) : '—'}</td>
                                                              <td>{st.conversions ? fmtNum(Math.round(st.conversions)) : '—'}</td>
                                                            </tr>
                                                          ))}
                                                        </tbody>
                                                      </table>
                                                    )
                                                  )}
                                                </td>
                                              </tr>
                                            )}
                                          </React.Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                    );
                                  })()}
                                  </>
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

      {/* Chat history modal */}
      {chatModalOpen && (
        <div className="modal-backdrop" onClick={() => setChatModalOpen(false)}>
          <div className={styles.chatHistoryModalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.chatHistoryModalHead}>
              <span>Chat History</span>
              <button className={styles.chatHistoryModalNewBtn} onClick={startNewChat}>+ New chat</button>
              <button className={styles.chatHistoryModalClose} onClick={() => setChatModalOpen(false)}>✕</button>
            </div>
            {chatSessions.length === 0 ? (
              <div className={styles.chatHistoryEmpty}>No saved chats yet.</div>
            ) : (
              <div className={styles.chatHistoryList}>
                {chatSessions.map(s => (
                  <div
                    key={s.id}
                    className={`${styles.chatHistoryItem}${activeChatId === s.id ? ` ${styles.chatHistoryItemActive}` : ''}`}
                  >
                    <button className={styles.chatHistoryItemBtn} onClick={() => loadChatSession(s)} title={s.title}>
                      <span className={styles.chatHistoryItemTitle}>{s.title}</span>
                      <span className={styles.chatHistoryItemDate}>
                        {new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </button>
                    <button className={styles.chatHistoryDeleteBtn} onClick={() => setModal({ open: true, variant: 'confirm', title: 'Delete chat?', message: `"${s.title}" will be permanently deleted.`, confirmText: 'Delete', onConfirm: () => { deleteChatSession(s.id); closeModal(); } })} title="Delete">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AppModal
        {...modal}
        onCancel={closeModal}
        inputValue={modalInputValue}
        onInputChange={v => { modalInputValueRef.current = v; setModalInputValue(v); }}
      />

      {/* Bottom-center Account Optimizer composer (resizable, centered name, controls) */}
      <div className={styles.composerOuter}>
        {activeChatId && (
          <div className={styles.chatTitleBar}>
            {chatSessions.find(s => s.id === activeChatId)?.title || 'Saved chat'}
          </div>
        )}
        <div ref={composerRef} className={styles.composer} style={{
          width: composerDims.width ? composerDims.width + 'px' : 'min(980px, 94%)',
          height: composerDims.height ? composerDims.height + 'px' : 'auto',
          maxHeight: composerDims.height ? 'none' : '60vh',
          minHeight: '120px',
        }}>
          <div className={styles.composerHeader}>
            {/* Left: chat session controls */}
            <div className={styles.chatSessionControls}>
              <button
                title="New chat"
                onClick={startNewChat}
                className={styles.composerCtrlBtn}
              >✎</button>
              <button
                title="Chat history"
                onClick={() => setChatModalOpen(o => !o)}
                className={`${styles.composerCtrlBtn}${chatModalOpen ? ` ${styles.chatHistoryBtnActive}` : ''}`}
              >☰</button>
            </div>

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
              rows={1}
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
            <div className={styles.toolbarSelectGroup}>
              <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" className="select-icon" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
              <select
                value={optPlatform}
                onChange={e => setOptPlatform(e.target.value)}
                className={`${styles.toolbarSelect} ${styles.toolbarSelectWide}`}
              >
                {['Campaign Performance','Ad Copy Review','Keyword Strategy','Budget Optimization','Conversion Analysis','Custom Analysis'].map(o => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>

            <div className={styles.toolbarSelectGroup}>
              <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" className="select-icon" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
              <select
                value={optSourceOption}
                onChange={e => setOptSourceOption(e.target.value)}
                className={styles.toolbarSelect}
              >
                <option value="mydata">My Data Only</option>
                <option value="combined">My Data + Model</option>
                <option value="model">Model Only</option>
              </select>
            </div>

            <div className={styles.toolbarSelectGroup}>
              <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" className="select-icon" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
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
