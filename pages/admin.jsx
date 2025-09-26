import { useState, useEffect, useCallback } from "react";
import { marked } from "marked";

import AuthGate from "../components/AuthGate";
import NavBar from "../components/NavBar";

export default function AdminDashboard() {
  // Upload state
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [bookTitle, setBookTitle] = useState("");

  // Dashboard state
  const [books, setBooks] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);

  // Fetch books and plans
  useEffect(() => {
    fetch("/api/books")
      .then((res) => res.json())
      .then(setBooks)
      .catch(() => setBooks([]));
    fetch("/api/plans")
      .then((res) => res.json())
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [status]); // refetch after upload

  // Upload progress
  useEffect(() => {
    const password = localStorage.getItem("ai_auth_token");
    if (!password) return;

    const eventSource = new EventSource(`/api/upload-progress?key=${password}`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setProgress(data);
      if (data.current >= data.total) {
        eventSource.close();
      }
    };

    return () => eventSource.close();
  }, []);

  // Upload handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    const password = localStorage.getItem("ai_auth_token");
    if (!file) return alert("Please select a file");

    setStatus("Uploading...");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("bookTitle", bookTitle);

    try {
      const res = await fetch(`/api/upload?key=${password}`, {
        method: "POST",
        body: formData,
      });

      const text = await res.text();
      const json = JSON.parse(text);

      if (res.ok) {
        setStatus(`✅ Uploaded. ${json.chunks} chunks stored.`);
        setFile(null);
        setBookTitle("");
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
    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;
    if (!["application/pdf", "text/plain"].includes(droppedFile.type)) {
      alert("Please upload a .pdf or .txt file.");
      return;
    }
    setFile(droppedFile);
  }, []);

  const handleDragOver = (e) => e.preventDefault();

  // Remove book
  const handleRemoveBook = async (bookTitle) => {
    if (!window.confirm("Remove this book?")) return;
    await fetch(`/api/remove-book?title=${encodeURIComponent(bookTitle)}`, { method: "DELETE" });
    setBooks(books.filter((b) => b.bookTitle !== bookTitle));
    setSelectedBook(null);
    setStatus("Book removed.");
  };

  // Remove plan
  const handleRemovePlan = async (id) => {
    if (!window.confirm("Delete this plan?")) return;
    await fetch(`/api/remove-plan?id=${id}`, { method: "DELETE" });
    setPlans(plans.filter((p) => p.id !== id));
    setSelectedPlan(null);
    setStatus("Plan removed.");
  };

  // Copy plan
  const handleCopyPlan = (content) => {
    navigator.clipboard.writeText(content);
    setStatus("✅ Plan copied to clipboard!");
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

  // Fetch book chunks for viewer
  const [bookChunks, setBookChunks] = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  useEffect(() => {
    if (selectedBook) {
        setLoadingChunks(true);
        fetch(`/api/book-chunks?title=${encodeURIComponent(selectedBook.bookTitle)}`)
        .then((res) => res.json())
        .then(setBookChunks)
        .catch(() => setBookChunks([]))
        .finally(() => setLoadingChunks(false));
    } else {
        setBookChunks([]);
        setLoadingChunks(false);
    }
  }, [selectedBook]);

  return (
    <AuthGate>
    <NavBar />
      <div style={{ display: "flex", height: "90vh" }}>
        {/* Sidebar */}
        <div style={{ width: 370, display: "flex", flexDirection: "column", padding: 20 }}>
          {/* Upload Card */}
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Upload Book</h3>
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                placeholder="Book Title"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                style={{ marginBottom: 10, width: "94%", padding: 8 }}
                required
              />
              <div>
                  <input
                    type="file"
                    accept=".txt,.pdf"
                    onChange={(e) => setFile(e.target.files[0])}
                  />
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    style={{
                      padding: 20,
                      border: "2px dashed #ccc",
                      marginBottom: 20,
                      borderRadius: 10,
                      textAlign: "center",
                    }}
                  >
                    {file ? (
                      <strong>Selected file: {file.name}</strong>
                    ) : (
                      "Drag and drop a .txt or .pdf file here"
                    )}
                  </div>
              </div>
              <button type="submit">Upload</button>
            </form>
          </div>
          {/* Books Card */}
          <div className="card">
            <h3>Books</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {books.map((book) => (
                <li key={book.bookTitle} style={{ marginBottom: 8 }}>
                  <span
                    style={{ cursor: "pointer", color: "#0070f3" }}
                    onClick={() => { setSelectedBook(book); setSelectedPlan(null); }}
                  >
                    {book.bookTitle}
                  </span>
                  <button
                    onClick={() => handleRemoveBook(book.bookTitle)}
                    style={{ marginLeft: 10, color: "red", border: "none", background: "none", cursor: "pointer" }}
                  >🗑️</button>
                </li>
              ))}
            </ul>
          </div>
          {/* Plans Card */}
          <div className="card">
            <h3>Saved Plans</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {plans.map((plan) => (
                <li key={plan.id} style={{ display: "flex",  marginBottom: 8 }}>
                  <span
                    style={{ cursor: "pointer", color: "#0070f3" }}
                    onClick={() => { setSelectedPlan(plan); setSelectedBook(null); }}
                  >
                    {plan.title}
                  </span>
                  <button
                    onClick={() => handleRemovePlan(plan.id)}
                    style={{ marginLeft: 10, color: "red", border: "none", background: "none", cursor: "pointer" }}
                  >🗑️</button>
                  <button
                    onClick={() => handleCopyPlan(plan.content)}
                    style={{ marginLeft: 5, border: "none", background: "none", cursor: "pointer" }}
                  >📋</button>
                  <button
                    onClick={() => handleDownload(plan, "txt")}
                    style={{ marginLeft: 5, border: "none", background: "none", cursor: "pointer" }}
                  >⬇️ TXT</button>
                  <button
                    onClick={() => handleDownload(plan, "pdf")}
                    style={{ marginLeft: 5, border: "none", background: "none", cursor: "pointer" }}
                  >⬇️ PDF</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {/* Viewer */}
        <div style={{ flex: 1, marginLeft: 30, borderRadius: 10, padding: 30, overflowY: "auto" }}>
          {selectedBook && (
            <div>
              <h2>{selectedBook.bookTitle}</h2>
              <h4>Preview (all chunks):</h4>
              {loadingChunks ? (
                <div style={{ color: "var(--muted)", margin: "24px 0" }}>
                  <span className="loader" style={{
                    display: "inline-block",
                    width: 24,
                    height: 24,
                    border: "3px solid var(--card-border)",
                    borderTop: "3px solid var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    marginRight: 10,
                    verticalAlign: "middle"
                  }} />
                  Loading book chunks...
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg);}
                      100% { transform: rotate(360deg);}
                    }
                  `}</style>
                </div>
              ) : (
                <>
                  <ol>
                    {bookChunks.map((chunk, idx) => (
                      <li key={idx} style={{ marginBottom: 10 }}>
                        <pre style={{ whiteSpace: "pre-wrap" }}>{chunk.text}</pre>
                      </li>
                    ))}
                  </ol>
                  <p>Total Chunks: {bookChunks.length}</p>
                </>
              )}
            </div>
          )}
          {selectedPlan && (
            <div>
                <h2>{selectedPlan.title}</h2>
                <p><strong>Platform:</strong> {selectedPlan.platform}</p>
                <p><strong>Prompt:</strong> {selectedPlan.userPrompt}</p>
                <p><strong>Word Count:</strong> {selectedPlan.wordCount}</p>
                <p><strong>Saved:</strong> {selectedPlan.timestamp}</p>
                <div
                className="card"
                style={{ marginTop: 16 }}
                dangerouslySetInnerHTML={{
                    __html: marked.parse(selectedPlan.content || ""),
                }}
                />
            </div>
          )}
          {!selectedBook && !selectedPlan && (
            <div style={{ color: "#888" }}>Select a book or plan to view details.</div>
          )}
        </div>

        <div className="status" style={{ position: "fixed", bottom: 20, right: 20,  padding: 20, borderRadius: 10, boxShadow: "0 2px 8px #ccc" }}>
            <p>{status}</p>
            {progress.total > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ height: 20, borderRadius: 10 }}>
                  <div
                    style={{
                      width: `${(progress.current / progress.total) * 100}%`,
                      background: "#4caf50",
                      height: "100%",
                      borderRadius: 10,
                      transition: "width 0.2s",
                    }}
                  />
                </div>
                <p>
                  Embedding: {progress.current} / {progress.total}
                </p>
              </div>
            )}
        </div>
      </div>
    </AuthGate>
  );
}