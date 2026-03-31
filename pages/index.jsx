import { useState, useRef, useEffect, useContext } from "react";
import { marked } from "marked";
import AuthGate from "../components/AuthGate";
import NavBar from "../components/NavBar";
import { ProfileContext } from "./_app";
import AppModal from '../components/ConfirmModal';
import { FiLayers, FiDatabase, FiCpu } from "react-icons/fi";
import { FiCopy, FiEdit2 } from "react-icons/fi";

const PLATFORM_OPTIONS = {
  stocks: ["Opportunity Summary", "Entry / Exit Strategy", "Risk Assessment", "Earnings / News Impact", "Valuation Notes", "Custom Analysis"],
  social: ["Post Performance", "Content Strategy", "Audience Insights", "Competitor Analysis", "Engagement Analysis", "Custom Analysis"],
  ads:    ["Campaign Performance", "Ad Copy Review", "Keyword Strategy", "Budget Optimization", "Conversion Analysis", "Custom Analysis"],
};

const CHAT_CONFIG = {
  stocks: {
    heading:     "What stock question or opportunity do you want to explore?",
    placeholder: "e.g., How did AAPL perform over the last month? Any interesting patterns?",
  },
  social: {
    heading:     "What social media question or strategy do you want to explore?",
    placeholder: "e.g., Which of my posts drove the most engagement last month?",
  },
  ads: {
    heading:     "What Google Ads question or campaign do you want to analyze?",
    placeholder: "e.g., Which campaigns had the best ROAS this quarter?",
  },
};

export default function Home() {
  const { profile } = useContext(ProfileContext);
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
  // Refs for debounced per-chat Firestore saves
  const pendingSavesRef = useRef({});
  const prevChatsRef = useRef([]);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [modal, setModal] = useState({ open: false });
  const [modalInputValue, setModalInputValue] = useState('');
  const modalInputValueRef = useRef('');
  const closeModal = () => { setModal({ open: false }); setModalInputValue(''); };
  const showAlert = (message, title = 'Notice') =>
    setModal({ open: true, variant: 'alert', title, message });
  const showConfirm = (message, onConfirm, title = 'Are you sure?') =>
    setModal({ open: true, variant: 'confirm', title, message, onConfirm });
  const [pendingChat, setPendingChat] = useState(true);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingMsgIdx, setEditingMsgIdx] = useState(null);
  const [editingMsgValue, setEditingMsgValue] = useState("");

  // Helper to create a new chat
  const createNewChat = () => {
    setPendingChat(true);
    setActiveChatId(null);
    setMessages([]);
    setShowResult(false);
  };

  // Load chats for the active profile; reset state on profile switch
  useEffect(() => {
    // Reset platform dropdown to first option for this profile
    setPlatform(PLATFORM_OPTIONS[profile]?.[0] ?? PLATFORM_OPTIONS.stocks[0]);
    // Cancel any in-flight debounced saves from the previous profile
    Object.values(pendingSavesRef.current).forEach(t => clearTimeout(t));
    pendingSavesRef.current = {};
    // Reset UI
    setChats([]);
    prevChatsRef.current = [];
    setMessages([]);
    setShowResult(false);
    setPendingChat(true);
    setActiveChatId(null);
    setChatsLoading(true);
    fetch(`/api/chats?profile=${encodeURIComponent(profile)}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setChats(data);
          prevChatsRef.current = data;
          // Restore the last-viewed chat for this profile
          const savedId = localStorage.getItem(`mp_activeChatId_${profile}`);
          if (savedId && data.find(c => c.id === savedId)) {
            setActiveChatId(savedId);
            setPendingChat(false);
            setShowResult(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => setChatsLoading(false));
  }, [profile]);

  // When messages change, sync them into the active chat in the chats array
  useEffect(() => {
    if (!activeChatId) return;
    setChats(prev =>
      prev.map(chat =>
        chat.id === activeChatId ? { ...chat, messages } : chat
      )
    );
  }, [messages, activeChatId]);

  // Debounced save: only write chats that actually changed to Firestore
  useEffect(() => {
    const prev = prevChatsRef.current;
    chats.forEach(chat => {
      const prevChat = prev.find(c => c.id === chat.id);
      if (!prevChat || JSON.stringify(prevChat) !== JSON.stringify(chat)) {
        if (pendingSavesRef.current[chat.id]) clearTimeout(pendingSavesRef.current[chat.id]);
        pendingSavesRef.current[chat.id] = setTimeout(() => {
          fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...chat, updatedAt: new Date().toISOString() }),
          }).catch(() => {});
          delete pendingSavesRef.current[chat.id];
        }, 800);
      }
    });
    prevChatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    if (activeChatId) {
      localStorage.setItem(`mp_activeChatId_${profile}`, activeChatId);
    }
  }, [activeChatId, profile]);

  useEffect(() => {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (chat) setMessages(chat.messages);
    else setMessages([]);
  }, [activeChatId]);

  const handleSelectChat = (chatId) => {
    setActiveChatId(chatId);
    setPendingChat(false);
    setShowResult(true);
  };

  const handleEditTitle = (chatId, newTitle) => {
    setChats(prev =>
      prev.map(chat =>
        chat.id === chatId ? { ...chat, title: newTitle } : chat
      )
    );
  };

  const chatEndRef = useRef(null);
  const latestUserMsgRef = useRef(null);

  useEffect(() => {
    if (
      messages.length > 0 &&
      messages[messages.length - 1].role === "user" &&
      chatEndRef.current
    ) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  useEffect(() => {
    if (latestUserMsgRef.current) {
      latestUserMsgRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [messages, loading]);

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      showAlert("Please enter your question or objective about stocks.", "Input required");
      return;
    }
    setShowResult(true);
    setLoading(true);

    // If pendingChat, create and save the chat
    if (pendingChat) {
      const newChat = {
        id: Date.now().toString(),
        title: userPrompt.slice(0, 40) || "New Chat",
        messages: [{ role: "user", content: userPrompt }],
        profile,
      };
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setPendingChat(false);
      setMessages([{ role: "user", content: userPrompt }]);
    } else {
      // Add user message to current chat
      setMessages(prev => [...prev, { role: "user", content: userPrompt }]);
    }
    setUserPrompt(""); // clear input

    // If we have user data enabled, fetch a short stock summary to include in the prompt
    let stockContext = null;
    if (sourceOption !== "model" && (profile !== 'stocks' || includeHistorical)) {
      try {
        const sres = await fetch('/api/stock-summary');
        if (sres.ok) {
          const sd = await sres.json();
          stockContext = sd.summary || null;
        }
      } catch (e) {
        console.warn('stock-summary fetch failed', e?.message || e);
      }
    }

    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        userPrompt,
        sourceOption,
        messages,
        stockContext,
        geminiModel,
      }),
    });

    // Parse response and append AI message
    const data = await res.json();
    const now = new Date();
    const ts = now.toLocaleString();

    setMessages(prev => [
      ...prev,
      res.ok
        ? { role: "ai", content: data.response, timestamp: ts, wordCount: data.wordCount }
        : { role: "ai", content: `❌ Error: ${data.error}` },
    ]);

    setLoading(false);
  };

  const regenerateAIForMessage = async (userMsgIdx, newPrompt) => {
    // Remove the old AI message (if present)
    setMessages(msgs => {
      const newMsgs = msgs.filter((m, i) => !(i === userMsgIdx + 1 && m.role === "ai"));
      // Insert a loading AI message
      newMsgs.splice(userMsgIdx + 1, 0, { role: "ai", content: "⏳ Generating..." });
      return newMsgs;
    });

    // Fetch new AI result
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        userPrompt: newPrompt,
        sourceOption,
        messages,
        geminiModel,
      }),
    });

    const data = await res.json();
    const now = new Date();
    const ts = now.toLocaleString();

    setMessages(msgs => {
      // Replace the loading AI message with the real one
      const newMsgs = [...msgs];
      newMsgs[userMsgIdx + 1] = res.ok
        ? { role: "ai", content: data.response, timestamp: ts, wordCount: data.wordCount }
        : { role: "ai", content: `❌ Error: ${data.error}` };
      return newMsgs;
    });
  };

  const formatWithTimestamp = (content, timestamp) => {
    return `Generated: ${timestamp}\n\n${content}`;
  };

  const handleCopy = (content, timestamp) => {
    navigator.clipboard.writeText(formatWithTimestamp(content, timestamp)).then(() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    });
  };

  const handleDownloadTxt = (content, timestamp) => {
    const blob = new Blob([formatWithTimestamp(content, timestamp)], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "stock-report.txt";
    link.click();
  };

  const handleDownloadPdf = async (content, timestamp) => {
    if (!content) return;
    const { default: html2pdf } = await import("html2pdf.js");
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = `<pre>${formatWithTimestamp(content, timestamp)}</pre>`;
    document.body.appendChild(tempDiv);
    const opt = {
      margin: 0.5,
      filename: "marketing-plan.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
    };
    await html2pdf().from(tempDiv).set(opt).save();
    document.body.removeChild(tempDiv);
  };

  const handleSavePlan = (content, timestamp, wordCount) => {
    if (!content) return;
    modalInputValueRef.current = '';
    setModalInputValue('');
    setModal({
      open: true,
      variant: 'input',
      title: 'Save Plan',
      inputPlaceholder: 'Enter a title for this plan...',
      onConfirm: async () => {
        const title = modalInputValueRef.current.trim();
        if (!title) return;
        closeModal();
        try {
          const res = await fetch('/api/save-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              content,
              timestamp: new Date().toISOString(),
              platform,
              wordCount,
            }),
          });
          if (res.ok) showAlert('Plan saved!', 'Success');
          else showAlert('Failed to save plan.', 'Error');
        } catch {
          showAlert('Failed to save plan.', 'Error');
        }
      },
    });
  };

  const Buttons = ({ content, timestamp, wordCount }) => (
    <div style={{ display: "flex", gap: "5px", marginTop: 10 }}>
      <button onClick={() => handleCopy(content, timestamp)}>Copy</button>
      <button onClick={() => handleDownloadTxt(content, timestamp)}>Download TXT</button>
      <button onClick={() => handleDownloadPdf(content, timestamp)}>Download PDF</button>
      <button onClick={() => handleSavePlan(content, timestamp, wordCount)}>Save Plan</button>
    </div>
  );

  return (
    <AuthGate>
      <NavBar />
      <aside className="chat-sidebar">
        <div className="sidebar-section" style={{ flexShrink: 0 }}>
          <button onClick={createNewChat} className="upload-btn">+ New Chat</button>
        </div>
        <div className="sidebar-section sidebar-list-section" style={{ flex: 1, minHeight: 0 }}>
          <h3 className="sidebar-section-title">
            Chats <span className="count-badge">{chats.length}</span>
          </h3>
          <ul className="sidebar-list" style={{ maxHeight: 'none' }}>
            {chatsLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[0,1,2].map(i => <div key={i} className="skeleton" style={{ height: 40, borderRadius: 6 }} />)}
              </div>
            )}
            {!chatsLoading && chats.length === 0 && (
              <li className="sidebar-empty">No chats yet</li>
            )}
            {!chatsLoading && chats.map(chat => (
              <li
                key={chat.id}
                className={`sidebar-item${chat.id === activeChatId ? ' active' : ''}`}
                style={{ position: "relative" }}
                onClick={() => handleSelectChat(chat.id)}
              >
                {editingChatId === chat.id ? (
                  <input
                    value={editingTitle}
                    autoFocus
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={() => {
                      handleEditTitle(chat.id, editingTitle.trim() || "New Chat");
                      setEditingChatId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        handleEditTitle(chat.id, editingTitle.trim() || "New Chat");
                        setEditingChatId(null);
                      } else if (e.key === "Escape") {
                        setEditingChatId(null);
                      }
                    }}
                    style={{
                      border: "1px solid var(--card-border)",
                      background: "var(--input-bg)",
                      fontWeight: 500,
                      fontSize: "0.86rem",
                      flex: 1,
                      outline: "none",
                      color: "var(--foreground)",
                      borderRadius: 4,
                      padding: "2px 6px"
                    }}
                  />
                ) : (
                  <span className="sidebar-item-label">{chat.title}</span>
                )}
                <button
                  className="icon-btn"
                  style={{ flexShrink: 0, fontSize: 16, fontWeight: 700, padding: "2px 5px" }}
                  onMouseDown={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === chat.id ? null : chat.id); }}
                  onClick={e => e.stopPropagation()}
                  aria-label="Chat options"
                >
                  &#8230;
                </button>
                {menuOpenId === chat.id && (
                  <div
                    style={{
                      position: "absolute",
                      top: 36,
                      right: 8,
                      background: "var(--card-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                      zIndex: 100,
                      minWidth: 130,
                      overflow: "hidden"
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      className="icon-btn"
                      style={{ width: "100%", padding: "9px 13px", borderRadius: 0, justifyContent: "flex-start", fontSize: "0.84rem", fontWeight: 500, color: "var(--foreground)" }}
                      onClick={() => {
                        setEditingChatId(chat.id);
                        setEditingTitle(chat.title);
                        setMenuOpenId(null);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="icon-btn danger"
                      style={{ width: "100%", padding: "9px 13px", borderRadius: 0, justifyContent: "flex-start", fontSize: "0.84rem", fontWeight: 500 }}
                      onClick={() => {
                        setMenuOpenId(null);
                        showConfirm(
                          'This will permanently delete the selected chat.',
                          () => {
                            const id = chat.id;
                            setChats(prev => prev.filter(c => c.id !== id));
                            if (activeChatId === id) {
                              setActiveChatId(null);
                              setMessages([]);
                              setShowResult(false);
                            }
                            fetch(`/api/chats?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
                            setToastMsg('Chat deleted');
                            setTimeout(() => setToastMsg(''), 2500);
                            closeModal();
                          },
                          'Delete Chat?'
                        );
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div
        style={{
          minHeight: "90vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--background)",
          flexDirection: "column",
          marginLeft: 320,
        }}
      >
        {/* Result Area */}
        {showResult && (
          <div
            className="result-area"
            style={{
              width: "100%",
              transition: "width 0.2s cubic-bezier(.4,0,.2,1)",
            }}
          >
            <div className="result-content">
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Render user/AI pairs */}
                {(() => {
                  const result = [];
                  let latestUserIdx = -1;
                  // Find the latest user message index
                  for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === "user") {
                      latestUserIdx = i;
                      break;
                    }
                  }
                  for (let i = 0; i < messages.length; i++) {
                    if (messages[i].role === "user") {
                      // User message
                      result.push(
                        <div
                          key={`user-${i}`}
                          ref={i === latestUserIdx ? latestUserMsgRef : null}
                          style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}
                        >
                          <div
                            className="user-message"
                            style={{
                              borderRadius: "18px 18px 4px 18px",
                              padding: "14px 20px",
                              maxWidth: editingMsgIdx === i ? "40vw" : 420,
                              width: editingMsgIdx === i ? "40vw" : "auto",
                              fontSize: 17,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                              marginLeft: 40,
                              position: "relative"
                            }}
                          >
                            {editingMsgIdx === i ? (
                              <>
                                <textarea
                                  value={editingMsgValue}
                                  onChange={e => setEditingMsgValue(e.target.value)}
                                  style={{
                                    width: "100%",
                                    minHeight: 60,
                                    fontSize: 16,
                                    borderRadius: 6,
                                    padding: 8,
                                    marginBottom: 8,
                                    resize: "vertical"
                                  }}
                                  autoFocus
                                />
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                                  <button
                                    onClick={() => {
                                      setEditingMsgIdx(null);
                                      setEditingMsgValue("");
                                    }}
                                    style={{
                                      background: "#000",
                                      color: "#fff",
                                      border: "none",
                                      borderRadius: 50,
                                      padding: "8px 12px",
                                      cursor: "pointer",
                                      fontSize: ".875em",
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={async () => {
                                      await setMessages(msgs => {
                                        // Update user message
                                        const newMsgs = msgs.map((m, idx2) =>
                                          idx2 === i ? { ...m, content: editingMsgValue } : m
                                        );
                                        return newMsgs;
                                      });
                                      setEditingMsgIdx(null);
                                      setEditingMsgValue("");
                                      // Auto re-run AI for this message
                                      regenerateAIForMessage(i, editingMsgValue);
                                    }}
                                    style={{
                                      background: "#fff",
                                      color: "#000",
                                      border: "none",
                                      borderRadius: 50,
                                      padding: "8px 12px",
                                      cursor: "pointer",
                                      fontSize: ".875em",
                                    }}
                                  >
                                    Send
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                {messages[i].content}
                              </>
                            )}
                          </div>
                          {/* Action buttons container */}
                          {editingMsgIdx !== i && (
                            <div
                              style={{
                                background: "#222",
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                              }}
                            >
                              <button
                                onClick={() => handleCopy(messages[i].content, messages[i].timestamp)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  fontSize: 16,
                                  display: "flex",
                                  alignItems: "center",
                                  padding: "0 5px",
                                  marginRight: 0,
                                }}
                                title="Copy"
                              >
                                <FiCopy />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingMsgIdx(i);
                                  setEditingMsgValue(messages[i].content);
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  fontSize: 16,
                                  display: "flex",
                                  alignItems: "center",
                                  marginRight: 0,
                                }}
                                title="Edit"
                              >
                                <FiEdit2 />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                      // If next message is AI, render it right below
                      if (messages[i + 1] && messages[i + 1].role === "ai") {
  result.push(
    <div key={`ai-${i + 1}`} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                            <div
                              style={{
                                borderRadius: "18px 18px 18px 4px",
                                padding: "14px 20px",
                                fontSize: 17,
                                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                                marginRight: 40,
                                position: "relative"
                              }}
                            >
                              <div style={{ marginBottom: 8, fontSize: 13, color: "#888" }}>
                                {messages[i + 1].wordCount && (
                                  <>
                                    <strong>Word Count:</strong> {messages[i + 1].wordCount} &nbsp;|&nbsp;
                                  </>
                                )}
                                {messages[i + 1].timestamp && (
                                  <><strong>Generated:</strong> {messages[i + 1].timestamp}</>
                                )}
                              </div>
                              <div
                                dangerouslySetInnerHTML={{
                                  __html: marked.parse(messages[i + 1].content),
                                }}
                              />
                              <Buttons content={messages[i + 1].content} timestamp={messages[i + 1].timestamp} wordCount={messages[i + 1].wordCount} />
                            </div>
                          </div>
                        );
                        i++; // Skip the AI message in the next iteration
                      }
                    }
                  }
                  return result;
                })()}
                {loading && (
                  <div style={{ minHeight: 32, marginBottom: 16 }}>
                    <span className="blinking-cursor" />
                    <span style={{ color: "var(--muted)" }}>Generating...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* Inputs Area */}
        <div className={`inputs-area${showResult ? " slide-down" : ""}`}>
          <h1
            className={`fade-h1${showResult ? " hide" : ""}`}
            style={{
              textAlign: "center",
              fontSize: 28,
              fontWeight: 400,
            }}
          >
            {(CHAT_CONFIG[profile] ?? CHAT_CONFIG.stocks).heading}
          </h1>
          <div className="input-container">
            <label>
              <textarea
                style={{ width: "96%", marginTop: "6px", marginBottom: "0",  resize: "vertical" }}
                placeholder={(CHAT_CONFIG[profile] ?? CHAT_CONFIG.stocks).placeholder}
                rows={1}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 5 }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <div className="custom-select-wrapper">
                  <FiLayers className="select-icon" />
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="custom-select"
                  >
                    {(PLATFORM_OPTIONS[profile] ?? PLATFORM_OPTIONS.stocks).map(opt => (
                      <option key={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div className="custom-select-wrapper" style={{ left: -42 }}>
                  <FiDatabase className="select-icon" />
                  <select
                    value={sourceOption}
                    onChange={(e) => setSourceOption(e.target.value)}
                    className="custom-select"
                  >
                    <option value="mydata">Use Only My Data</option>
                    <option value="combined">Use My Data + Model Help</option>
                    <option value="model">Use Only Model Knowledge</option>
                  </select>
                </div>
                <div className="custom-select-wrapper" style={{ left: -89 }}>
                  <FiCpu className="select-icon" />
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="custom-select"
                  >
                    <optgroup label="Gemini 3">
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                      <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                      <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite</option>
                    </optgroup>
                    <optgroup label="Gemini 2.5">
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                    </optgroup>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="generate-btn"
                  aria-label="Analyze"
                >
                {loading ? (
                  <span className="arrow-loader" />
                ) : (
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 28 28"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ display: "block", margin: "auto" }}
                  >
                    <circle cx="14" cy="14" r="14" fill="#fff" />
                    <path
                      d="M14 8V20M14 8L8 14M14 8L20 14"
                      stroke="#111"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                </button>
              </div>
            </div>
          </div>
          {profile === 'stocks' && (
            <label style={{ position: 'relative', left: 20, display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={includeHistorical}
                onChange={e => setIncludeHistorical(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Include historical data
            </label>
          )}
        </div>

        {/* Toast */}
        {showToast && (
          <div style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            backgroundColor: '#333',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 5,
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            zIndex: 9999,
            opacity: 0.95
          }}>
            ✅ Copied to clipboard!
          </div>
        )}
        {toastMsg && (
          <div style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            backgroundColor: '#222',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            zIndex: 10000
          }}>
            {toastMsg}
          </div>
        )}
      </div>
      <AppModal
        {...modal}
        onCancel={closeModal}
        inputValue={modalInputValue}
        onInputChange={(v) => { modalInputValueRef.current = v; setModalInputValue(v); }}
      />
    </AuthGate>
  );
}