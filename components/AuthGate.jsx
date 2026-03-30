// components/AuthGate.js
import { useState, useEffect } from "react";

const PASSWORD_KEY = "ai_auth_token";
const CORRECT_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

export default function AuthGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(PASSWORD_KEY);
    if (stored === CORRECT_PASSWORD) setAuthenticated(true);
  }, []);

  const handleLogin = () => {
    if (password === CORRECT_PASSWORD) {
      localStorage.setItem(PASSWORD_KEY, CORRECT_PASSWORD);
      setAuthenticated(true);
    } else {
      setError("Incorrect password. Please try again.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPassword("");
    }
  };

  if (!authenticated) {
    return (
      <>
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(18px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes shake {
            0%,100% { transform: translateX(0); }
            20%     { transform: translateX(-8px); }
            40%     { transform: translateX(8px); }
            60%     { transform: translateX(-5px); }
            80%     { transform: translateX(5px); }
          }
          .auth-wrap {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--background);
            padding: 24px;
          }
          .auth-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 20px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.18);
            padding: 48px 44px 40px;
            width: 100%;
            max-width: 400px;
            animation: fadeIn 0.35s ease;
            text-align: center;
          }
          .auth-logo {
            width: 64px;
            height: 64px;
            object-fit: contain;
            border-radius: 50%;
            margin-bottom: 20px;
            box-shadow: 0 2px 16px rgba(230,100,20,0.25);
          }
          .auth-title {
            font-size: 1.5rem;
            font-weight: 800;
            color: var(--foreground);
            margin: 0 0 4px;
            letter-spacing: -0.3px;
          }
          .auth-subtitle {
            font-size: 0.83rem;
            color: var(--muted);
            margin: 0 0 28px;
          }
          .auth-input-wrap {
            position: relative;
            margin-bottom: 14px;
          }
          .auth-input-wrap svg {
            position: absolute;
            left: 14px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--muted);
            pointer-events: none;
          }
          .auth-input {
            width: 100%;
            box-sizing: border-box;
            padding: 12px 14px 12px 40px;
            border-radius: 10px;
            border: 1.5px solid var(--card-border);
            background: var(--input-bg);
            color: var(--foreground);
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.15s;
          }
          .auth-input:focus {
            border-color: var(--accent);
          }
          .auth-error {
            font-size: 0.78rem;
            color: var(--danger, #ef4444);
            margin-bottom: 12px;
            animation: shake 0.4s ease;
          }
          .auth-btn {
            width: 100%;
            padding: 12px;
            border-radius: 10px;
            border: none;
            background: var(--accent);
            color: #fff;
            font-size: 0.95rem;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.15s, opacity 0.15s;
            letter-spacing: 0.2px;
          }
          .auth-btn:hover { background: var(--accent-hover); }
          .auth-footer {
            margin-top: 22px;
            font-size: 0.72rem;
            color: var(--muted);
          }
        `}</style>
        <div className="auth-wrap">
          <div className="auth-card">
            <img
              src="https://yopie.ca/wp-content/uploads/2023/06/YOPIE-LOGO-Y.png"
              alt="Yopie"
              className="auth-logo"
            />
            <h1 className="auth-title">Yopie KB</h1>
            <p className="auth-subtitle">Enter your password to continue</p>

            <div className={`auth-input-wrap${shake ? ' auth-error-shake' : ''}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                autoFocus
              />
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button className="auth-btn" onClick={handleLogin}>
              Sign In
            </button>

            <div className="auth-footer">Yopie internal tool · {new Date().getFullYear()}</div>
          </div>
        </div>
      </>
    );
  }

  return children;
}