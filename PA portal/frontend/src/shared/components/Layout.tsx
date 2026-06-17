import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

interface NavEntry {
  to: string;
  label: string;
  hint: string;
  icon: IconName;
}

const NAV: NavEntry[] = [
  { to: "/queue", label: "Live Queue", hint: "Today's visitors", icon: "queue" },
  { to: "/scheduler", label: "Scheduler", hint: "Book ahead", icon: "calendar" },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `nav__link${isActive ? " nav__link--active" : ""}`
          }
        >
          <span className="nav__icon">
            <Icon name={item.icon} size={19} />
          </span>
          <span className="nav__text">
            <span className="nav__label">{item.label}</span>
            <span className="nav__hint">{item.hint}</span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}

function todayLong(): string {
  return new Date().toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function Layout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const current = NAV.find((n) => location.pathname.startsWith(n.to)) ?? NAV[0];

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? " sidebar--open" : ""}`}>
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">
            PA
          </div>
          <div className="brand__text">
            <span className="brand__title">PA Portal</span>
            <span className="brand__sub">Grievance &amp; Appointments</span>
          </div>
        </div>

        <div className="nav-section">Workspace</div>
        <NavItems onNavigate={() => setMenuOpen(false)} />

        <div className="sidebar__foot">
          <div className="office-card">
            <span className="office-card__icon">
              <Icon name="building" size={18} />
            </span>
            <div className="office-card__body">
              <span className="office-card__name">Minister's PA Desk</span>
              <span className="office-card__status">
                <span className="office-card__dot" /> Open · accepting visitors
              </span>
            </div>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}

      <div className="main">
        <header className="topbar">
          <button
            className="topbar__menu"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" size={20} />
          </button>

          <div className="topbar__crumb">
            <span className="topbar__crumb-icon">
              <Icon name={current.icon} size={18} />
            </span>
            {current.label}
          </div>

          <div className="topbar__spacer" />

          <div className="topbar__right">
            <span className="date-pill">
              <Icon name="calendar" size={15} />
              <span>{todayLong()}</span>
            </span>
            <button className="icon-btn" aria-label="Notifications">
              <Icon name="bell" size={18} />
              <span className="icon-btn__badge" />
            </button>
            <div className="avatar-chip" title="PA Office" aria-hidden="true">
              PA
            </div>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
