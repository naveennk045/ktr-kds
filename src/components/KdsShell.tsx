import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import "../kds.css";

interface Props {
  storeName: string;
  live: "connecting" | "live" | "polling";
  now: number;
  error: string | null;
  /** Extra controls on the right of the top bar (station filter, etc.). */
  tools?: ReactNode;
  className?: string;
  children: ReactNode;
}

const LIVE_TEXT = { connecting: "Connecting…", live: "Live", polling: "Checking every 10 s" } as const;

/** Frame shared by the kitchen display and the coffee bar: brand, view switch, clock, errors. */
export default function KdsShell({ storeName, live, now, error, tools, className = "", children }: Props) {
  const time = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`kx ${className}`}>
      <header className="kx-top">
        <div className="kx-brand">
          <span className="kx-logo">KTR</span>
          <div className="kx-brand-sub">
            <b>{storeName}</b>
            <span>
              <i className={`kx-live ${live}`} />
              {LIVE_TEXT[live]}
            </span>
          </div>
        </div>
        <nav className="kx-seg" aria-label="View">
          <NavLink to="/kds">Kitchen</NavLink>
          <NavLink to="/bar">Coffee bar</NavLink>
        </nav>
        {tools}
        <div className="kx-clock">{time}</div>
        <Link to="/" className="kx-ghost">Setup</Link>
      </header>
      {error && (
        <div className="kx-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </div>
  );
}

const SOFT = /^(no |less |light$)/i;

/** Kitchen option chip: loud red for changes that alter the dish, softer for "less / no" tweaks. */
export function ModChip({ text, count }: { text: string; count?: number }) {
  return (
    <span className={`kx-mod ${SOFT.test(text) ? "soft" : ""}`}>
      {text}
      {count && count > 1 ? ` ×${count}` : ""}
    </span>
  );
}
