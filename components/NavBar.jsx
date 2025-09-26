import Link from "next/link";
import { useRouter } from "next/router";
import ThemeToggle from "./ThemeToggle";

export default function NavBar() {
  const router = useRouter();

  return (  
    <nav className="navbar">
      <div style={{ fontWeight: 800, paddingLeft: 12 }}>Stocky KB</div>
      <div style={{ flex: 1 }} />
      <ThemeToggle />
      <Link href="/" className={`nav-link${router.pathname === "/" ? " active" : ""}`}>
        Generate
      </Link>
      <Link href="/stocks" className={`nav-link${router.pathname === "/stocks" ? " active" : ""}`}>
        Stocks
      </Link>
      <Link href="/admin" className={`nav-link${router.pathname === "/admin" ? " active" : ""}`}>
        <img
          src="https://yopie.ca/wp-content/uploads/2023/06/YOPIE-LOGO-Y.png"
            alt="Admin Dashboard"
            style={{ height: 28, width: 28, objectFit: "contain", display: "block", borderRadius: "50%" }}
          title="Admin Dashboard"
        />
      </Link>
    </nav>
  );
}