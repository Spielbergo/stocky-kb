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
      { href: "/", label: "Generate" },
      { href: "/stocks", label: "Markets" },
    ],
  },
  social: {
    label: "Social Media",
    icon: "📱",
    links: [
      { href: "/", label: "Generate" },
    ],
  },
  ads: {
    label: "Google Ads",
    icon: "📊",
    links: [
      { href: "/", label: "Generate" },
    ],
  },
};

export default function NavBar() {
  const router = useRouter();
  const { profile, setProfile } = useContext(ProfileContext);
  const [open, setOpen] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = PROFILES[profile] ?? PROFILES.stocks;

  return (
    <nav className="navbar">
      <div className="navbar-brand">Stocky KB</div>

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
                onClick={() => { setProfile(key); setOpen(false); }}
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