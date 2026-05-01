import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchTmsSnapshot, tmsEventSourceUrl } from "../lib/api";
import { getLineCounters, lineVisualPhase } from "../lib/lineCounters";
import { getXStoreIdHeaderValue, readStoredStore } from "../lib/storeContext";
import type { ItemStatusPayload, TmsSnapshotPayload, TmsToken, WsEnvelope } from "../lib/types";

const POLL_MS = 10_000;

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export default function TmsBoard() {
  const stored = useMemo(() => readStoredStore(), []);
  const [snap, setSnap] = useState<TmsSnapshotPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveHint, setLiveHint] = useState<string>("Connecting…");
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const xStore = stored ? getXStoreIdHeaderValue(stored) : "";

  const refetch = useCallback(async () => {
    if (!stored) return;
    setLoadError(null);
    try {
      const s = await fetchTmsSnapshot(xStore);
      setSnap(s);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load tokens");
    }
  }, [stored, xStore]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!stored) return;
    let cancelled = false;

    const clearPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const startPoll = () => {
      clearPoll();
      pollRef.current = setInterval(() => {
        void refetch();
      }, POLL_MS);
      setLiveHint("Polling (SSE unavailable)");
    };

    const url = tmsEventSourceUrl(stored.storeId);
    setLiveHint("Live (SSE)");
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(String(ev.data)) as WsEnvelope<TmsSnapshotPayload | ItemStatusPayload | Record<string, unknown>>;
        if (msg.type === "SNAPSHOT" && msg.payload && "tokens" in msg.payload) {
          setSnap(msg.payload as TmsSnapshotPayload);
          setLoadError(null);
        } else if (msg.type === "BOARD_REFRESH" || msg.type === "ITEM_STATUS_CHANGED") {
          void refetch();
        } else if (msg.type === "TMS_ANNOUNCE") {
          void refetch();
          const p = msg.payload as ItemStatusPayload;
          if (voiceOnRef.current && typeof p.speech === "string" && p.speech.trim()) {
            speak(p.speech);
          }
        }
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => {
      if (cancelled) return;
      es.close();
      startPoll();
    };

    return () => {
      cancelled = true;
      clearPoll();
      es.close();
    };
  }, [stored, refetch]);

  if (!stored) {
    return <Navigate to="/" replace />;
  }

  return (
    <div style={page}>
      <header style={topBar}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Token display</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 4 }}>
            {stored.storeName} · {liveHint}
          </div>
        </div>
        <nav style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            style={voiceBtn(voiceOn)}
            onClick={() => setVoiceOn((v) => !v)}
            title="Browsers may require a tap here before announcements can play."
          >
            Voice {voiceOn ? "on" : "off"}
          </button>
          <Link to="/kds" style={linkMuted}>
            KDS
          </Link>
          <Link to="/" style={linkMuted}>
            Setup
          </Link>
        </nav>
      </header>

      {loadError && (
        <div style={errBox} role="alert">
          {loadError}
        </div>
      )}

      {!snap && !loadError && <p style={{ color: "var(--muted)" }}>Loading tokens…</p>}

      {snap && (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
          Window {snap.live_window_minutes}m · read-only (status changes happen on KDS)
        </p>
      )}

      {snap?.tokens.length === 0 && <p style={{ color: "var(--muted)" }}>No active tokens.</p>}

      <div style={grid}>
        {snap?.tokens.map((t) => (
          <TokenCard key={`${t.order_id}-${t.kot_code}`} token={t} />
        ))}
      </div>
    </div>
  );
}

function TokenCard({ token }: { token: TmsToken }) {
  return (
    <article style={card}>
      <div style={head}>
        <span style={kot}>{token.kot_code}</span>
        <div style={flags}>
          {token.flags.has_in_kitchen ? <span style={chipKitchen}>In kitchen</span> : null}
          {token.flags.has_ready_for_pickup ? <span style={chipReady}>Ready / counter</span> : null}
        </div>
      </div>
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
        {new Date(token.created_at).toLocaleString()}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {token.lines.map((line) => {
          const c = getLineCounters(line);
          const visual = lineVisualPhase(c);
          return (
            <li key={line.id} style={lineRow(visual)}>
              <div style={{ fontWeight: 600 }}>{line.item_name}</div>
              <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                ×{line.quantity} · Kitchen {c.items_need_be_ready} · Counter {c.items_need_be_collected}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

const page: CSSProperties = { minHeight: "100vh", padding: "1rem 1.25rem", background: "var(--bg-cream)" };
const topBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  marginBottom: "1rem",
  flexWrap: "wrap",
};
const linkMuted: CSSProperties = { color: "var(--text-secondary)" };
const errBox: CSSProperties = {
  background: "rgba(234, 67, 53, 0.12)",
  border: "1px solid var(--warn)",
  padding: "0.65rem 0.85rem",
  borderRadius: 8,
  marginBottom: "1rem",
};
const grid: CSSProperties = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
};
const card: CSSProperties = {
  background: "var(--neutral-50)",
  border: "1px solid var(--border-primary)",
  borderRadius: 12,
  padding: "0.85rem 1rem",
  minWidth: 0,
};
const head: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.5rem",
  marginBottom: "0.35rem",
  flexWrap: "wrap",
};
const kot: CSSProperties = { fontSize: "1.2rem", fontWeight: 700, color: "var(--gold-accent)" };
const flags: CSSProperties = { display: "flex", gap: "0.35rem", flexWrap: "wrap" };
const chipBase: CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 700,
  textTransform: "uppercase",
  borderRadius: 999,
  padding: "0.12rem 0.45rem",
  whiteSpace: "nowrap",
};
const chipKitchen: CSSProperties = {
  ...chipBase,
  background: "rgba(247, 180, 37, 0.35)",
  border: "1px solid var(--gold-accent-light)",
  color: "var(--text-primary)",
};
const chipReady: CSSProperties = {
  ...chipBase,
  background: "rgba(61, 122, 79, 0.25)",
  border: "1px solid var(--gold-primary)",
  color: "var(--text-primary)",
};

function voiceBtn(on: boolean): CSSProperties {
  return {
    padding: "0.35rem 0.65rem",
    borderRadius: 8,
    border: "1px solid var(--border-primary)",
    background: on ? "var(--secondary-gradient)" : "transparent",
    color: on ? "var(--text-on-dark)" : "var(--text-primary)",
    fontWeight: 600,
    cursor: "pointer",
  };
}

const lineBase: CSSProperties = {
  padding: "0.45rem 0",
  borderTop: "1px solid var(--neutral-300)",
};

function lineRow(status: "PREPARING" | "READY" | "COLLECTED"): CSSProperties {
  if (status === "COLLECTED") {
    return {
      ...lineBase,
      opacity: 0.85,
      borderLeft: "3px solid var(--earth-light)",
      paddingLeft: "0.45rem",
    };
  }
  if (status === "READY") {
    return {
      ...lineBase,
      borderLeft: "3px solid var(--gold-primary)",
      paddingLeft: "0.45rem",
    };
  }
  return {
    ...lineBase,
    borderLeft: "3px solid var(--gold-accent-light)",
    paddingLeft: "0.45rem",
  };
}
