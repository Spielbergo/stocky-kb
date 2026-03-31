import "../styles/globals.css";
import { createContext, useState, useEffect } from "react";

export const ProfileContext = createContext({ profile: "stocks", setProfile: () => {} });

const VALID_PROFILES = ["stocks", "social", "ads", "ads_bp"];

export default function App({ Component, pageProps }) {
  const [profile, setProfileState] = useState("stocks");

  useEffect(() => {
    const saved = localStorage.getItem("active_profile");
    const resolved = VALID_PROFILES.includes(saved) ? saved : "stocks";
    setProfileState(resolved);
    document.documentElement.setAttribute("data-profile", resolved);
  }, []);

  const setProfile = (p) => {
    if (!VALID_PROFILES.includes(p)) return;
    setProfileState(p);
    localStorage.setItem("active_profile", p);
    document.documentElement.setAttribute("data-profile", p);
  };

  return (
    <ProfileContext.Provider value={{ profile, setProfile }}>
      <Component {...pageProps} />
    </ProfileContext.Provider>
  );
}