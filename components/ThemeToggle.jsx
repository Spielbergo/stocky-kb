import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <button
      aria-label="Toggle light/dark mode"
      onClick={toggleTheme}
      style={{
        background: "none",
        border: "none",
        fontSize: "1.5rem",
        cursor: "pointer",
        marginLeft: 12,
      }}
      title="Toggle light/dark mode"
    >
      {theme === "dark" ? "🌞" : "🌙"}
    </button>
  );
}