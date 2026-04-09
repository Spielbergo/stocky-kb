import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useState, useRef, useEffect } from "react";
import { ProfileContext } from "../pages/_app";
import ThemeToggle from "./ThemeToggle";

const PROFILES = {
  stocks: {
    label: "Stocks",
    icon: "📈",
    links: [
      { href: "/", label: "Chat" },
      { href: "/stocks", label: "Markets" },
    ],
  },
  social: {
    label: "Social Media",
    icon: "📱",
    links: [
      { href: "/", label: "Chat" },
    ],
  },
  ads: {
    label: "Google Ads",
    icon: "📊",
    links: [
      { href: "/", label: "Chat" },
      { href: "/ads-accounts", label: "Accounts" },
    ],
  },
  ads_bp: {
    label: "Google Ads - Best Practices",
    icon: "📋",
    links: [
      { href: "/", label: "Chat" },
      { href: "/ads-accounts", label: "Accounts" },
    ],
  },
};

/** Pages that are shared across all profiles — never redirect away from these. */
const ALWAYS_AVAILABLE = (pathname) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

export default function NavBar({ tools }) {
  const router = useRouter();
  const { profile, setProfile } = useContext(ProfileContext);
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const dropRef = useRef(null);
  const toolsRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
      if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = PROFILES[profile] ?? PROFILES.stocks;

  return (
    <nav className="navbar">
      <div className="navbar-brand">Yopie KB</div>

      <div className="profile-selector" ref={dropRef}>
        <button className="profile-btn" onClick={() => setOpen((o) => !o)}>
          <span className="profile-icon">{current.icon}</span>
          <span className="profile-label">{current.label}</span>
          <svg
            className={`chevron${open ? " open" : ""}`}
            width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="profile-dropdown">
            {Object.entries(PROFILES).map(([key, p]) => (
              <button
                key={key}
                className={`profile-option${profile === key ? " selected" : ""}`}
                onClick={() => {
                  setProfile(key);
                  setOpen(false);
                  // If the current page doesn't exist in the new profile, go to home
                  const newLinks = PROFILES[key]?.links?.map((l) => l.href) ?? [];
                  if (!ALWAYS_AVAILABLE(router.pathname) && !newLinks.includes(router.pathname)) {
                    router.push("/");
                  }
                }}
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
                {profile === key && (
                  <svg style={{ marginLeft: "auto" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>


      <div className="navbar-links">
        {tools && (
          <div className="navbar-tools" ref={toolsRef} style={{ position: 'relative' }}>
            <button className={`nav-link${toolsOpen ? ' active' : ''}`} onClick={() => setToolsOpen(o => !o)}>
              Tools
              <svg
                className={`chevron${toolsOpen ? " open" : ""}`}
                width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
                style={{ marginLeft: 8 }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {toolsOpen && (
              <div className="profile-dropdown" style={{ right: 0, left: 'auto' }}>
                <button className="profile-option" onClick={() => { setToolsOpen(false); tools.onReloadCache && tools.onReloadCache(); }}>
                  ↺ Reload Cache
                </button>
                <button className="profile-option" onClick={() => { setToolsOpen(false); tools.onOpenOptSessions && tools.onOpenOptSessions(); }}>
                  Saved Optimizations
                </button>
                <button className="profile-option" onClick={() => { setToolsOpen(false); tools.onOpenAudit && tools.onOpenAudit(); }}>
                  Audit Log
                </button>
              </div>
            )}
          </div>
        )}

        {current.links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link${router.pathname === link.href ? " active" : ""}`}
          >
            {link.label}
          </Link>
        ))}
        <Link
          href="/admin"
          className={`nav-link${router.pathname === "/admin" ? " active" : ""}`}
        >
          Library
        </Link>
      </div>

      

      <ThemeToggle />
    </nav>
  );
}