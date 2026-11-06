import { useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { Amphora, BookOpen, Settings2 } from "lucide-react";
import { useLiveUpdates } from "./api";
import { AutosaveStatus } from "./autosave";
import { JarIcon } from "./components";
import { Inventory, Catalog, Settings, Vessels } from "./pages";

function ManufacturerRedirect() {
  const { id } = useParams();
  return <Navigate to={`/settings#manufacturer-${id}`} replace />;
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const { pathname, search } = useLocation();
  const inventory = pathname === "/" || pathname.startsWith("/containers/");
  const catalog = pathname === "/catalog" || pathname.startsWith("/glazes/");
  const vessels = pathname === "/vessels" || pathname.startsWith("/vessels/");
  const oldManufacturerList =
    new URLSearchParams(search).get("tab") === "manufacturers";
  const links = [
    { to: "/", icon: <JarIcon />, label: "Inventory", active: inventory },
    {
      to: "/catalog",
      icon: <BookOpen size={17} />,
      label: "Glazes",
      active: catalog,
    },
    {
      to: "/vessels",
      icon: <Amphora size={17} />,
      label: "Vessels",
      active: vessels,
    },
    {
      to: "/settings",
      icon: <Settings2 size={17} />,
      label: "Settings",
      active: pathname === "/settings",
    },
  ];
  useLiveUpdates(setConnected);
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          <JarIcon />
          <span>Glaze Manager</span>
        </Link>
        <nav aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              aria-current={link.active ? "page" : undefined}
              className={`nav-link ${link.active ? "active" : ""}`}
            >
              {link.icon}
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
        <div className="header-status">
          <AutosaveStatus />
          <span className={`connection ${connected ? "" : "offline"}`}>
            <i />
            {connected ? "Studio connected" : "Reconnecting…"}
          </span>
        </div>
      </header>
      <main
        className={
          inventory || catalog || vessels ? "inventory-main" : "standard-main"
        }
      >
        <Routes>
          <Route element={<Inventory />}>
            <Route index />
            <Route path="containers/:id" />
          </Route>
          <Route path="/low-stock" element={<Navigate to="/" replace />} />
          <Route
            element={
              pathname === "/catalog" && oldManufacturerList ? (
                <Navigate to="/settings#manufacturers" replace />
              ) : (
                <Catalog />
              )
            }
          >
            <Route path="/catalog" />
            <Route path="/glazes/:id" />
          </Route>
          <Route path="/manufacturers/:id" element={<ManufacturerRedirect />} />
          <Route path="/vessels/:id?" element={<Vessels />} />
          <Route path="/register" element={<Navigate to="/" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <div className="empty">
                <h1>Page not found</h1>
                <Link to="/">Return to inventory</Link>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
