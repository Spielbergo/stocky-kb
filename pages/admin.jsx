import { useState, useEffect, useCallback, useContext } from "react";
import { marked } from "marked";

import AuthGate from "../components/AuthGate";
import NavBar from "../components/NavBar";
import AppModal from "../components/ConfirmModal";
import { ProfileContext } from "./_app";

const PROFILE_META = {
  stocks:  { label: "Stocks",       icon: "📈" },
  social:  { label: "Social Media", icon: "📱" },
  ads:     { label: "Google Ads",   icon: "📊" },
};

export default function AdminDashboard() {
  const { profile } = useContext(ProfileContext);

  // Upload state
  const [file, setFile]           = useState(null);
  const [status, setStatus]       = useState("");
  const [progress, setProgress]   = useState({ current: 0, total: 0 });
  const [bookTitle, setBookTitle] = useState("");

  // Modal state
  const [modal, setModal] = useState({ open: false });
  const closeModal = () => setModal({ open: false });
  const showAlert = (message, title = "Notice") =>
    setModal({ open: true, variant: "alert", title, message });
  const showConfirm = (message, onConfirm, title = "Are you sure?") =>
    setModal({ open: true, variant: "confirm", title, message, onConfirm });

  // Dashboard state
  const [books, setBooks]             = useState([]);
  const [plans, setPlans]             = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);

  // refreshKey is incremented only after a successful upload, triggering a re-fetch.
  // Delete/plan actions update local state directly to avoid racing Firestore consistency.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch(`/api/books?profile=${profile}`)
      .then((res) => res.json())
      .then((data) => setBooks(Array.isArray(data) ? data : []))
      .catch(() => setBooks([]));
    fetch("/api/plans")
      .then((res) => res.json())
      .then((data) => setPlans(Array.isArray(data) ? data : []))
      .catch(() => setPlans([]));
    // Clear selection when profile switches
    setSelectedBook(null);
    setSelectedPlan(null);
  }, [refreshKey, profile]);

  // Upload progress SSE
  useEffect(() => {
    const password = localStorage.getItem("ai_auth_token");
    if (!password) return;
    const eventSource = new EventSource(`/api/upload-progress?key=${password}`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setProgress(data);
      if (data.current >= data.total) eventSource.close();
    };
    return () => eventSource.close();
  }, []);

  // Upload handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    const password = localStorage.getItem("ai_auth_token");
    if (!file) {
      showAlert("Please select a file before uploading.", "No file selected");
      return;
    }
    setStatus("Uploading...");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("bookTitle", bookTitle);
    formData.append("profile", profile);
    try {
      const res  = await fetch(`/api/upload?key=${password}`, { method: "POST", body: formData });
      const json = JSON.parse(await res.text());
      if (res.ok) {
        setStatus(`✅ Uploaded — ${json.chunks} chunks stored.`);
        setFile(null);
        setBookTitle("");
        setRefreshKey((k) => k + 1); // trigger re-fetch from Firestore only after upload
      } else {
        setStatus(`❌ Error: ${json.error || "Unknown error"}`);
      }
    } catch (e) {
      console.error(e);
      setStatus("❌ Failed to upload. Check server logs.");
    }
  };

  // Drag & drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    if (!["application/pdf", "text/plain"].includes(dropped.type)) {
      showAlert("Please upload a .pdf or .txt file.", "Invalid file type");
      return;
    }
    setFile(dropped);
  }, []);
  const handleDragOver = (e) => e.preventDefault();

  // Remove book — update local state only, no Firestore re-fetch (avoids consistency race)
  const handleRemoveBook = (title) => {
    showConfirm(
      `Remove "${title}" and all its chunks? This cannot be undone.`,
      async () => {
        closeModal();
        const res = await fetch(`/api/remove-book?title=${encodeURIComponent(title)}&profile=${profile}`, { method: "DELETE" });
        if (res.ok) {
          setBooks((prev) => prev.filter((b) => b.bookTitle !== title));
          setSelectedBook(null);
          setStatus("Book removed.");
        } else {
          const json = await res.json().catch(() => ({}));
          showAlert(json.error || "Failed to remove book. Check server logs.", "Error");
        }
      },
      "Remove Book"
    );
  };

  // Remove plan — update local state only
  const handleRemovePlan = (id) => {
    showConfirm(
      "Delete this plan? This cannot be undone.",
      async () => {
        closeModal();
        const res = await fetch(`/api/remove-plan?id=${id}`, { method: "DELETE" });
        if (res.ok) {
          setPlans((prev) => prev.filter((p) => p.id !== id));
          setSelectedPlan(null);
          setStatus("Plan removed.");
        } else {
          showAlert("Failed to remove plan.", "Error");
        }
      },
      "Delete Plan"
    );
  };

  // Copy plan
  const handleCopyPlan = (content) => {
    navigator.clipboard.writeText(content);
    setStatus("✅ Copied to clipboard!");
  };

  // Download plan
  const handleDownload = (plan, type) => {
    if (!plan) return;
    if (type === "txt") {
      const blob = new Blob([plan.content], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${plan.title}.txt`;
      link.click();
    } else if (type === "pdf") {
      import("html2pdf.js").then(({ default: html2pdf }) => {
        const div = document.createElement("div");
        div.innerHTML = `<h2>${plan.title}</h2><pre>${plan.content}</pre>`;
        html2pdf().from(div).set({
          margin: 0.5,
          filename: `${plan.title}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        }).save();
      });
    }
  };

  // Book chunks viewer
  const [bookChunks, setBookChunks]     = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  useEffect(() => {
    if (selectedBook) {
      setLoadingChunks(true);
      fetch(`/api/book-chunks?title=${encodeURIComponent(selectedBook.bookTitle)}&profile=${profile}`)
        .then((res) => res.json())
        .then(setBookChunks)
        .catch(() => setBookChunks([]))
        .finally(() => setLoadingChunks(false));
    } else {
      setBookChunks([]);
    }
  }, [selectedBook, profile]);

  const meta = PROFILE_META[profile] ?? PROFILE_META.stocks;

  return (
    <AuthGate>
      <NavBar />
      <div className="admin-layout">

        {/* ── Sidebar ── */}
        <aside className="admin-sidebar">

          {/* Profile badge */}
          <div className="sidebar-profile-badge">
            <div className="sidebar-profile-icon">{meta.icon}</div>
            <div>
              <div className="sidebar-profile-label">{meta.label}</div>
              <div className="sidebar-profile-sub">Knowledge Base</div>
            </div>
          </div>

          {/* Upload */}
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Upload</h3>
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                placeholder="Book title..."
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                className="sidebar-input"
                required
              />
              <label
                className="upload-dropzone"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <input
                  type="file"
                  accept=".txt,.pdf"
                  onChange={(e) => setFile(e.target.files[0])}
                  style={{ display: "none" }}
                />
                {file ? (
                  <>
                    <span className="upload-file-icon">📄</span>
                    <span className="upload-filename">{file.name}</span>
                  </>
                ) : (
                  <>
                    <span className="upload-file-icon">⬆</span>
                    <span>Drop a PDF or TXT here, or click to browse</span>
                  </>
                )}
              </label>
              <button type="submit" className="upload-btn" disabled={status === "Uploading..."}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                {status === "Uploading..." ? (
                  <><span className="spinner spinner-sm spinner-white" /> Uploading…</>
                ) : 'Upload & Embed'}
              </button>
            </form>
          </div>

          {/* Books list */}
          <div className="sidebar-section sidebar-list-section">
            <h3 className="sidebar-section-title">
              Books <span className="count-badge">{books.length}</span>
            </h3>
            <ul className="sidebar-list">
              {books.map((book) => (
                <li
                  key={book.bookTitle}
                  className={`sidebar-item${selectedBook?.bookTitle === book.bookTitle ? " active" : ""}`}
                  onClick={() => { setSelectedBook(book); setSelectedPlan(null); }}
                >
                  <span className="sidebar-item-icon">📖</span>
                  <span className="sidebar-item-label">{book.bookTitle}</span>
                  <span className="sidebar-item-meta">{book.count}</span>
                  <button
                    className="icon-btn danger"
                    onClick={(e) => { e.stopPropagation(); handleRemoveBook(book.bookTitle); }}
                    title="Remove book"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                </li>
              ))}
              {books.length === 0 && <li className="sidebar-empty">No books for this profile yet</li>}
            </ul>
          </div>

          {/* Plans list */}
          <div className="sidebar-section sidebar-list-section">
            <h3 className="sidebar-section-title">
              Saved Plans <span className="count-badge">{plans.length}</span>
            </h3>
            <ul className="sidebar-list">
              {plans.map((plan) => (
                <li
                  key={plan.id}
                  className={`sidebar-item${selectedPlan?.id === plan.id ? " active" : ""}`}
                  onClick={() => { setSelectedPlan(plan); setSelectedBook(null); }}
                >
                  <span className="sidebar-item-label">{plan.title}</span>
                  <div className="sidebar-item-actions">
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleCopyPlan(plan.content); }} title="Copy">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                      </svg>
                    </button>
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleDownload(plan, "txt"); }} title="Download TXT">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                    </button>
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleDownload(plan, "pdf"); }} title="Download PDF">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </button>
                    <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); handleRemovePlan(plan.id); }} title="Delete">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
              {plans.length === 0 && <li className="sidebar-empty">No saved plans yet</li>}
            </ul>
          </div>

        </aside>

        {/* ── Main viewer ── */}
        <main className="admin-main">
          {selectedBook && (
            <div>
              <h2>{selectedBook.bookTitle}</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                {selectedBook.count} chunks · {meta.label} profile
              </p>
              {loadingChunks ? (
                <div style={{ color: "var(--muted)", marginTop: 24, display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="spinner" />
                  Loading chunks...
                </div>
              ) : (
                <>
                  <ol style={{ paddingLeft: 20, marginTop: 16 }}>
                    {bookChunks.map((chunk, idx) => (
                      <li key={idx} style={{ marginBottom: 12 }}>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{chunk.text}</pre>
                      </li>
                    ))}
                  </ol>
                  <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Total: {bookChunks.length} chunks</p>
                </>
              )}
            </div>
          )}

          {selectedPlan && (
            <div>
              <h2>{selectedPlan.title}</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                {selectedPlan.platform && <><strong>Platform:</strong> {selectedPlan.platform} · </>}
                <strong>Words:</strong> {selectedPlan.wordCount} · <strong>Saved:</strong> {selectedPlan.timestamp}
              </p>
              <div
                className="card"
                style={{ marginTop: 16 }}
                dangerouslySetInnerHTML={{ __html: marked.parse(selectedPlan.content || "") }}
              />
            </div>
          )}

          {!selectedBook && !selectedPlan && (
            <div className="admin-empty-state">
              <span>📚</span>
              <p>Select a book or plan from the sidebar to view its contents</p>
            </div>
          )}
        </main>

      </div>

      <AppModal {...modal} onCancel={closeModal} />

      {/* Upload status toast */}
      {(status || progress.total > 0) && (
        <div className="upload-status-toast">
          <p>{status}</p>
          {progress.total > 0 && (
            <>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <p className="progress-label">{progress.current} / {progress.total} chunks embedded</p>
            </>
          )}
        </div>
      )}
    </AuthGate>
  );
}

