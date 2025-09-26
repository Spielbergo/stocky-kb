// components/AuthGate.js
import { useState, useEffect } from "react";

const PASSWORD_KEY = "ai_auth_token";
const CORRECT_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

export default function AuthGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(PASSWORD_KEY);
    if (stored === CORRECT_PASSWORD) {
      setAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (password === CORRECT_PASSWORD) {
      localStorage.setItem(PASSWORD_KEY, CORRECT_PASSWORD);
      setAuthenticated(true);
    } else {
      alert("Wrong password");
    }
  };

  if (!authenticated) {
    return (
      <div style={{ padding: 40 }}>
        <h2>🔒 Enter Password</h2>
        <input
          type="password"
          placeholder="Enter password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={handleLogin}>Login</button>
      </div>
    );
  }

  return children;
}