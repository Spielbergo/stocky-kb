import { useState, useRef, useEffect } from "react";
import { marked } from "marked";
import AuthGate from "../components/AuthGate";
import NavBar from "../components/NavBar";
import ConfirmModal from '../components/ConfirmModal';
import { FiLayers, FiDatabase } from "react-icons/fi";
import { FiCopy, FiEdit2 } from "react-icons/fi";

import books from '../data/books.json'; // adjust path as needed


export default function Home() {
  const [platform, setPlatform] = useState("Opportunity Type");
  const [userPrompt, setUserPrompt] = useState("");
  const [sourceOption, setSourceOption] = useState("mydata");
  const [loading, setLoading] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [timestamp, setTimestamp] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mp_chats");
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [activeChatId, setActiveChatId] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("mp_activeChatId") || null;
    }
    return null;
  });
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [pendingChat, setPendingChat] = useState(true);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingMsgIdx, setEditingMsgIdx] = useState(null);
  const [editingMsgValue, setEditingMsgValue] = useState("");  
  const [hoveredChunkIdx, setHoveredChunkIdx] = useState(null);

  // Helper to create a new chat
  const createNewChat = () => {
    setPendingChat(true);
    setActiveChatId(null);
    setMessages([]);
    setShowResult(false);
  };

  useEffect(() => {
    if (!activeChatId) return;
    setChats(prev =>
      prev.map(chat =>
        chat.id === activeChatId ? { ...chat, messages } : chat
      )
    );
  }, [messages, activeChatId]);

  useEffect(() => {
    localStorage.setItem("mp_chats", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    if (activeChatId) {
      localStorage.setItem("mp_activeChatId", activeChatId);
    }
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (chat) setMessages(chat.messages);
    else setMessages([]);
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) return;
    setChats(prev =>
      prev.map(chat =>
        chat.id === activeChatId ? { ...chat, messages } : chat
      )
    );
  }, [messages]);

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
      alert("Please enter your question or objective about stocks.");
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
    if (sourceOption !== "model") {
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

  const handleSavePlan = async (content, timestamp, wordCount) => {
    if (!content) return;
    const planTitle = prompt("Enter a title for this plan:");
    if (!planTitle) return;
    const res = await fetch("/api/save-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: planTitle,
        content,
        timestamp: new Date().toISOString(),
        platform,
        wordCount,
      }),
    });
    if (res.ok) {
      alert("Plan saved!");
    } else {
      alert("Failed to save plan.");
    }
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
      <div style={{
        position: "fixed",
        left: 0,
        top: 3,
        bottom: 0,
        width: 275,
        padding: "76px 16px 16px 16px",
        background: "#111",
        overflowY: "auto",
        zIndex: 0
      }}>
        <button onClick={createNewChat} style={{ marginBottom: 16, width: "100%" }}>+ New Chat</button>
        {chats.map(chat => (
          <div
            key={chat.id}
            className="chat-item"
            style={{
              marginBottom: 8,
              borderRadius: 6,
              background: chat.id === activeChatId ? "#333" : "#111",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              position: "relative"
            }}
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
                  border: "1px solid #555",
                  background: "#222",
                  fontWeight: 500,
                  fontSize: 15,
                  flex: 1,
                  outline: "none",
                  color: "#fff",
                  borderRadius: 4,
                  padding: "2px 6px"
                }}
              />
            ) : (
              <input
                value={chat.title}
                readOnly
                style={{
                  border: "none",
                  background: "#333",
                  fontWeight: 500,
                  fontSize: 15,
                  flex: 1,
                  outline: "none",
                  color: chat.id === activeChatId ? "#fff" : "#eee"
                }}
              />
            )}
            <button
              style={{
                position: "relative",
                left: -20,
                background: "none",
                border: "none",
                color: "#aaa",
                cursor: "pointer",
                padding: 4,
                marginBottom: 8,
                marginLeft: 4,
                fontSize: 18,
                fontWeight: 700,
              }}
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
                  background: "#222",
                  borderRadius: 6,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  zIndex: 100,
                  minWidth: 120
                }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "none",
                    textAlign: "left",
                    cursor: "pointer"
                  }}
                  onClick={() => {
                    setEditingChatId(chat.id);
                    setEditingTitle(chat.title);
                    setMenuOpenId(null);
                  }}
                >
                  Rename
                </button>
                <button
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "none",
                    textAlign: "left",
                    color: "#d00",
                    cursor: "pointer"
                  }}
                  onClick={() => {
                    setConfirmTarget({ type: 'chat', id: chat.id });
                    setConfirmOpen(true);
                    setMenuOpenId(null);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          minHeight: "90vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--background)",
          flexDirection: "column",
          marginLeft: 200,
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
  // Find the chunk referenced by this AI message
  const chunkId = messages[i + 1].chunkId; // or chunkIndex
  const chunk = books.find(b => b.id === chunkId); // or books[chunkIndex]
  result.push(
    <div key={`ai-${i + 1}`} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
      {/* Reference chunk label with tooltip */}
      {chunk && (
        <div
          style={{
            fontSize: 13,
            color: "#888",
            marginBottom: 4,
            cursor: "pointer",
            display: "inline-block",
            position: "relative"
          }}
          onMouseEnter={() => setHoveredChunkIdx(i)}
          onMouseLeave={() => setHoveredChunkIdx(null)}
        >
          Reference: Book Chunk
          {hoveredChunkIdx === i && (
            <div
              style={{
                position: "absolute",
                top: "120%",
                left: 0,
                background: "#222",
                color: "#fff",
                padding: "12px 16px",
                borderRadius: 8,
                boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
                zIndex: 1000,
                minWidth: 220,
                maxWidth: 340,
                whiteSpace: "pre-wrap"
              }}
            >
              <div style={{ marginBottom: 8, fontWeight: 500, color: "#fff" }}>
                Book Chunk:
              </div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>
                {chunk.text}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(chunk.text);
                  setShowToast(true);
                  setTimeout(() => setShowToast(false), 2000);
                }}
                style={{
                  background: "#fff",
                  color: "#111",
                  border: "none",
                  borderRadius: 4,
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <FiCopy style={{ marginRight: 4, verticalAlign: "middle" }} />
                Copy Chunk
              </button>
            </div>
          )}
        </div>
      )}
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
            What stock question or opportunity do you want to explore?
          </h1>
          <div className="input-container">
            <label>
              <textarea
                style={{ width: "96%", marginTop: "6px", marginBottom: "0",  resize: "vertical" }}
                placeholder="e.g., How did AAPL perform over the last month? Any interesting patterns?"
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
                    <option>Opportunity Summary</option>
                    <option>Entry / Exit Strategy</option>
                    <option>Risk Assessment</option>
                    <option>Earnings / News Impact</option>
                    <option>Valuation Notes</option>
                    <option>Custom Analysis</option>
                  </select>
                </div>
                <div className="custom-select-wrapper" style={{ left: -83 }}>
                  <FiDatabase className="select-icon" />
                  <select
                    value={sourceOption}
                    onChange={(e) => setSourceOption(e.target.value)}
                    className="custom-select"
                  >
                    <option value="mydata">Use Only My Data (books & stock history)</option>
                    <option value="combined">Use My Data + Model Help</option>
                    <option value="model">Use Only Model Knowledge</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="generate-btn"
                aria-label="Analyze Stock Opportunity"
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
      </div>
    </AuthGate>
  );
}