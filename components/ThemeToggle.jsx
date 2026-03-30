import { useEffect, useState, useRef } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const resolved = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(resolved);
    document.documentElement.setAttribute("data-theme", resolved);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const applyTheme = (t) => {
    setTheme(t);
    localStorage.setItem("theme", t);
    document.documentElement.setAttribute("data-theme", t);
    setOpen(false);
  };

  return (
    <div className="settings-menu" ref={ref}>
      <button
        className="settings-logo-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        title="Settings"
      >
        <img
          src="https://yopie.ca/wp-content/uploads/2023/06/YOPIE-LOGO-Y.png"
          alt="Settings"
          style={{ height: 28, width: 28, objectFit: "contain", borderRadius: "50%" }}
        />
      </button>

      {open && (
        <div className="settings-dropdown">
          <p className="settings-dropdown-label">Appearance</p>
          <button
            className={`settings-option${theme === "light" ? " selected" : ""}`}
            onClick={() => applyTheme("light")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            Light
            {theme === "light" && (
              <svg style={{ marginLeft: "auto" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            )}
          </button>
          <button
            className={`settings-option${theme === "dark" ? " selected" : ""}`}
            onClick={() => applyTheme("dark")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"/>
            </svg>
            Dark
            {theme === "dark" && (
              <svg style={{ marginLeft: "auto" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}