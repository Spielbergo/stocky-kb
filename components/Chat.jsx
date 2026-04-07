import { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import AppModal from '../components/ConfirmModal';
import { FiLayers, FiDatabase, FiCpu, FiCopy, FiEdit2 } from 'react-icons/fi';

const PLATFORM_OPTIONS = {
  stocks: ["Opportunity Summary", "Entry / Exit Strategy", "Risk Assessment", "Earnings / News Impact", "Valuation Notes", "Custom Analysis"],
  social: ["Post Performance", "Content Strategy", "Audience Insights", "Competitor Analysis", "Engagement Analysis", "Custom Analysis"],
  ads:    ["Campaign Performance", "Ad Copy Review", "Keyword Strategy", "Budget Optimization", "Conversion Analysis", "Custom Analysis"],
  ads_bp: ["Campaign Performance", "Ad Copy Review", "Keyword Strategy", "Budget Optimization", "Conversion Analysis", "Custom Analysis"],
};

const CHAT_CONFIG = {
  stocks: { heading: "What stock question or opportunity do you want to explore?", placeholder: "e.g., How did AAPL perform over the last month? Any interesting patterns?" },
  social: { heading: "What social media question or strategy do you want to explore?", placeholder: "e.g., Which of my posts drove the most engagement last month?" },
  ads:    { heading: "What Google Ads question or campaign do you want to analyze?", placeholder: "e.g., Which campaigns had the best ROAS this quarter?" },
  ads_bp: { heading: "What Google Ads question or campaign do you want to analyze?", placeholder: "e.g., Which campaigns had the best ROAS this quarter?" },
};

export default function Chat({ profile = 'stocks', persistChats = true, selectedAccountId = null }) {
  const [platform, setPlatform] = useState(() => PLATFORM_OPTIONS[profile]?.[0] ?? PLATFORM_OPTIONS.stocks[0]);
  const [includeHistorical, setIncludeHistorical] = useState(true);
  const [userPrompt, setUserPrompt] = useState("");
  const [sourceOption, setSourceOption] = useState("mydata");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash-lite");
  const [loading, setLoading] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [timestamp, setTimestamp] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [activeChatId, setActiveChatId] = useState(null);
  const pendingSavesRef = useRef({});
  const prevChatsRef = useRef([]);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [modal, setModal] = useState({ open: false });
  const [modalInputValue, setModalInputValue] = useState('');
  const modalInputValueRef = useRef('');
  const closeModal = () => { setModal({ open: false }); setModalInputValue(''); };
  const showAlert = (message, title = 'Notice') => setModal({ open: true, variant: 'alert', title, message });
  const showConfirm = (message, onConfirm, title = 'Are you sure?') => setModal({ open: true, variant: 'confirm', title, message, onConfirm });
  const [pendingChat, setPendingChat] = useState(true);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingMsgIdx, setEditingMsgIdx] = useState(null);
  const [editingMsgValue, setEditingMsgValue] = useState("");

  const chatEndRef = useRef(null);
  const latestUserMsgRef = useRef(null);

  useEffect(() => {
    setPlatform(PLATFORM_OPTIONS[profile]?.[0] ?? PLATFORM_OPTIONS.stocks[0]);
    setChats([]);
    prevChatsRef.current = [];
    setMessages([]);
    setShowResult(false);
    setPendingChat(true);
    setActiveChatId(null);
    setChatsLoading(true);
    if (persistChats) {
      fetch(`/api/chats?profile=${encodeURIComponent(profile)}`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) { setChats(data); prevChatsRef.current = data; const savedId = localStorage.getItem(`mp_activeChatId_${profile}`); if (savedId && data.find(c => c.id === savedId)) { setActiveChatId(savedId); setPendingChat(false); setShowResult(true); } } })
        .catch(() => {})
        .finally(() => setChatsLoading(false));
    } else {
      setChatsLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!activeChatId) return;
    setChats(prev => prev.map(chat => chat.id === activeChatId ? { ...chat, messages } : chat));
  }, [messages, activeChatId]);

  useEffect(() => {
    if (!persistChats) return;
    const prev = prevChatsRef.current;
    chats.forEach(chat => {
      const prevChat = prev.find(c => c.id === chat.id);
      if (!prevChat || JSON.stringify(prevChat) !== JSON.stringify(chat)) {
        if (pendingSavesRef.current[chat.id]) clearTimeout(pendingSavesRef.current[chat.id]);
        pendingSavesRef.current[chat.id] = setTimeout(() => {
          fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...chat, updatedAt: new Date().toISOString() }) }).catch(() => {});
          delete pendingSavesRef.current[chat.id];
        }, 800);
      }
    });
    prevChatsRef.current = chats;
  }, [chats]);

  useEffect(() => { if (activeChatId) localStorage.setItem(`mp_activeChatId_${profile}`, activeChatId); }, [activeChatId, profile]);

  useEffect(() => { if (!activeChatId) return; const chat = chats.find(c => c.id === activeChatId); if (chat) setMessages(chat.messages); else setMessages([]); }, [activeChatId]);

  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === 'user' && chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => { if (latestUserMsgRef.current) latestUserMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [messages, loading]);

  const createNewChat = () => { setPendingChat(true); setActiveChatId(null); setMessages([]); setShowResult(false); };

  const handleSelectChat = (chatId) => { setActiveChatId(chatId); setPendingChat(false); setShowResult(true); };

  const handleEditTitle = (chatId, newTitle) => setChats(prev => prev.map(chat => chat.id === chatId ? { ...chat, title: newTitle } : chat));

  const handleGenerate = async () => {
    if (!userPrompt.trim()) { showAlert('Please enter your question or objective.','Input required'); return; }
    setShowResult(true); setLoading(true);
    if (pendingChat) {
      const newChat = { id: Date.now().toString(), title: userPrompt.slice(0,40) || 'New Chat', messages: [{ role: 'user', content: userPrompt }], profile };
      setChats(prev => [newChat, ...prev]); setActiveChatId(newChat.id); setPendingChat(false); setMessages([{ role: 'user', content: userPrompt }]);
    } else {
      setMessages(prev => [...prev, { role: 'user', content: userPrompt }]);
    }
    const promptToSend = userPrompt;
    setUserPrompt('');

    let stockContext = null;
    if (sourceOption !== 'model' && profile === 'stocks' && includeHistorical) {
      try { const sres = await fetch('/api/stock-summary'); if (sres.ok) { const sd = await sres.json(); stockContext = sd.summary || null; } } catch (e) { console.warn('stock-summary fetch failed', e?.message || e); }
    }

    const res = await fetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, userPrompt: promptToSend, sourceOption, messages, stockContext, geminiModel, profile, accountId: selectedAccountId }) });
    const data = await res.json();
    const now = new Date();
    const ts = now.toLocaleString();
    setMessages(prev => [...prev, res.ok ? { role: 'ai', content: data.response, timestamp: ts, wordCount: data.wordCount } : { role: 'ai', content: `❌ Error: ${data.error}` }]);
    setLoading(false);
  };

  const regenerateAIForMessage = async (userMsgIdx, newPrompt) => {
    setMessages(msgs => { const newMsgs = msgs.filter((m,i) => !(i === userMsgIdx+1 && m.role === 'ai')); newMsgs.splice(userMsgIdx+1, 0, { role: 'ai', content: '⏳ Generating...' }); return newMsgs; });
    const res = await fetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, userPrompt: newPrompt, sourceOption, messages, geminiModel, profile, accountId: selectedAccountId }) });
    const data = await res.json(); const now = new Date(); const ts = now.toLocaleString(); setMessages(msgs => { const newMsgs = [...msgs]; newMsgs[userMsgIdx+1] = res.ok ? { role: 'ai', content: data.response, timestamp: ts, wordCount: data.wordCount } : { role: 'ai', content: `❌ Error: ${data.error}` }; return newMsgs; });
  };

  const formatWithTimestamp = (content, timestamp) => `Generated: ${timestamp}\n\n${content}`;
  const handleCopy = (content, timestamp) => { navigator.clipboard.writeText(formatWithTimestamp(content,timestamp)); setShowToast(true); setTimeout(() => setShowToast(false),2000); };
  const handleDownloadTxt = (content, timestamp) => { const blob = new Blob([formatWithTimestamp(content,timestamp)], { type: 'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'report.txt'; link.click(); };
  const handleDownloadPdf = async (content, timestamp) => { if (!content) return; const { default: html2pdf } = await import('html2pdf.js'); const tempDiv = document.createElement('div'); tempDiv.innerHTML = `<pre>${formatWithTimestamp(content,timestamp)}</pre>`; document.body.appendChild(tempDiv); await html2pdf().from(tempDiv).set({ margin:0.5, filename:'marketing-plan.pdf', image:{type:'jpeg',quality:0.98}, html2canvas:{scale:2}, jsPDF:{unit:'in',format:'letter',orientation:'portrait'} }).save(); document.body.removeChild(tempDiv); };

  const handleSavePlan = (content, timestamp, wc) => {
    if (!content) return; modalInputValueRef.current = ''; setModalInputValue(''); setModal({ open:true, variant:'input', title:'Save Plan', inputPlaceholder:'Enter a title for this plan...', onConfirm: async () => { const title = modalInputValueRef.current.trim(); if (!title) return; closeModal(); try { const res = await fetch('/api/save-plan', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ title, content, timestamp: new Date().toISOString(), platform, wordCount: wc }) }); if (res.ok) showAlert('Plan saved!', 'Success'); else showAlert('Failed to save plan.', 'Error'); } catch { showAlert('Failed to save plan.','Error'); } } });
  };

  const Buttons = ({ content, timestamp, wordCount }) => (<div style={{ display:'flex', gap:5, marginTop:10 }}><button onClick={() => handleCopy(content,timestamp)}>Copy</button><button onClick={() => handleDownloadTxt(content,timestamp)}>Download TXT</button><button onClick={() => handleDownloadPdf(content,timestamp)}>Download PDF</button><button onClick={() => handleSavePlan(content,timestamp,wordCount)}>Save Plan</button></div>);

  return (
    <div style={{ minHeight: '60vh', marginLeft: 0 }}>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12 }}>
        <div>
          <h2 style={{ margin:0 }}>{(CHAT_CONFIG[profile] ?? CHAT_CONFIG.stocks).heading}</h2>
        </div>
      </div>

      <div style={{ display:'flex' }}>
        {/* Sidebar chats */}
        <aside style={{ width: 300, marginRight: 12 }}>
          <div style={{ marginBottom: 8 }}><button onClick={createNewChat} className='upload-btn'>+ New Chat</button></div>
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {chatsLoading ? <div>Loading chats…</div> : (chats.length === 0 ? <div>No chats yet</div> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {chats.map(chat => (
                  <li key={chat.id} style={{ padding: 8, borderRadius:6, marginBottom:6, background: chat.id===activeChatId ? 'var(--card-bg)' : 'transparent', cursor:'pointer' }} onClick={() => handleSelectChat(chat.id)}>
                    <div style={{ fontWeight:700 }}>{chat.title}</div>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </aside>

        {/* Main chat area */}
        <div style={{ flex:1 }}>
          {showResult && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: 12 }}>
              <div>
                {messages.map((m,i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize:12, fontWeight:700, color: m.role === 'user' ? 'var(--foreground)' : 'var(--muted)' }}>{m.role === 'user' ? 'You' : 'Optimizer'}</div>
                    <div style={{ marginTop:6 }} dangerouslySetInnerHTML={{ __html: m.content ? marked.parse(m.content) : '' }} />
                    {m.role === 'ai' && <Buttons content={m.content} timestamp={m.timestamp} wordCount={m.wordCount} />}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} placeholder={(CHAT_CONFIG[profile] ?? CHAT_CONFIG.stocks).placeholder} rows={2} style={{ width:'100%', padding:8, borderRadius:6 }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }} />
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:8 }}>
              <button onClick={handleGenerate} className='generate-btn' disabled={loading}>{loading ? '…' : 'Analyze'}</button>
            </div>
          </div>
        </div>
      </div>

      <AppModal {...modal} onCancel={closeModal} inputValue={modalInputValue} onInputChange={(v) => { modalInputValueRef.current = v; setModalInputValue(v); }} />
    </div>
  );
}
