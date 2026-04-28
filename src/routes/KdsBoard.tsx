import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchKdsBoard, kdsWebSocketUrl, patchKdsLineStatus } from "../lib/api";
import { nextOrderItemStatus, statusLabel } from "../lib/status";
import { getXStoreIdHeaderValue, readStoredStore } from "../lib/storeContext";
import type { KdsBoardPayload, KdsLine, WsEnvelope } from "../lib/types";

const POLL_MS = 10_000;
const DEFAULT_MAX_ROWS = 20;
const HIDE_COMPLETED_AFTER_MS = 5_000;

export default function KdsBoard() {
  const stored = useMemo(() => readStoredStore(), []);
  const [board, setBoard] = useState<KdsBoardPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wsHint, setWsHint] = useState<string>("Connecting…");
  const [lineBusy, setLineBusy] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedAtRef = useRef<Record<number, number>>({});

  const xStore = stored ? getXStoreIdHeaderValue(stored) : "";

  const refetch = useCallback(async () => {
    if (!stored) return;
    setLoadError(null);
    try {
      const b = await fetchKdsBoard(xStore, DEFAULT_MAX_ROWS);
      setBoard(b);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load board");
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
      setWsHint("Polling (WebSocket unavailable)");
    };

    const url = kdsWebSocketUrl(stored.storeId, DEFAULT_MAX_ROWS);
    setWsHint("Connecting…");
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (cancelled) return;
      setWsHint("Live (WebSocket)");
      clearPoll();
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(String(ev.data)) as WsEnvelope<KdsBoardPayload | Record<string, unknown>>;
        if (msg.type === "SNAPSHOT" && msg.payload && "orders" in msg.payload) {
          setBoard(msg.payload as KdsBoardPayload);
          setLoadError(null);
        } else if (msg.type === "BOARD_REFRESH" || msg.type === "ITEM_STATUS_CHANGED") {
          void refetch();
        } else if (msg.type === "PING") {
          /* ignore */
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      if (cancelled) return;
      startPoll();
    };

    ws.onclose = () => {
      if (cancelled) return;
      startPoll();
    };

    return () => {
      cancelled = true;
      clearPoll();
      ws.close();
    };
  }, [stored, refetch]);

  useEffect(() => {
    const id = globalThis.setInterval(() => setTick((n) => n + 1), 1000);
    return () => globalThis.clearInterval(id);
  }, []);

  const visibleBoard = useMemo(() => {
    const now = Date.now() + tick * 0;
    if (!board) return null;
    const activeLineIds = new Set<number>();
    const nextOrders = board.orders
      .map((order) => {
        const visibleLines = order.lines.filter((line) => {
          activeLineIds.add(line.id);
          const isCompleted = line.order_status === "COLLECTED";
          if (!isCompleted) {
            delete completedAtRef.current[line.id];
            return true;
          }
          if (!completedAtRef.current[line.id]) {
            completedAtRef.current[line.id] = now;
          }
          return now - completedAtRef.current[line.id] < HIDE_COMPLETED_AFTER_MS;
        });
        return { ...order, lines: visibleLines };
      })
      .filter((order) => order.lines.length > 0);

    for (const key of Object.keys(completedAtRef.current)) {
      const id = Number(key);
      if (!activeLineIds.has(id)) {
        delete completedAtRef.current[id];
      }
    }

    return { ...board, orders: nextOrders };
  }, [board, tick]);

  async function advanceLine(line: KdsLine) {
    if (!stored) return;
    const next = nextOrderItemStatus(line.order_status);
    if (!next) return;
    setLineBusy(line.id);
    setLoadError(null);
    try {
      await patchKdsLineStatus(xStore, line.id, next);
      await refetch();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setLineBusy(null);
    }
  }

  if (!stored) {
    return <Navigate to="/" replace />;
  }

  return (
    <div style={page}>
      <header style={topBar}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Kitchen display</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 4 }}>
            {stored.storeName} · {wsHint}
          </div>
        </div>
        <nav style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
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

      <section style={clubbedStrip}>
        <h2 style={{ margin: 0, fontSize: "1rem", color: "var(--text-secondary)" }}>Clubbed Summary</h2>
        {!visibleBoard || visibleBoard.clubbed_totals.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: "0.5rem 0 0" }}>No open items.</p>
        ) : (
          <div style={clubbedChipWrap}>
            {visibleBoard.clubbed_totals.map((row) => (
              <div key={row.item_name} style={clubbedChip}>
                <span style={clubbedQty}>{row.quantity}</span>
                <span style={clubbedName}>{row.item_name}</span>
              </div>
            ))}
          </div>
        )}
        {visibleBoard && (
          <p style={{ marginTop: "0.6rem", fontSize: "0.8rem", color: "var(--muted)" }}>
            Window {visibleBoard.live_window_minutes}m · max {visibleBoard.max_rows} tickets
          </p>
        )}
      </section>

      {!visibleBoard && !loadError && <p style={{ color: "var(--muted)" }}>Loading board…</p>}
      {visibleBoard?.orders.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No tickets on the board.</p>
      )}
      <div style={ticketGrid}>
        {visibleBoard?.orders.map((order) => (
          <article key={order.id} style={ticket}>
            <div style={ticketHead}>
              <span style={kot}>{order.kot_code}</span>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {new Date(order.created_at).toLocaleString()}
              </span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {order.lines.map((line) => {
                const next = nextOrderItemStatus(line.order_status);
                let visualStatus: "PREPARING" | "READY" | "COLLECTED" = "PREPARING";
                if (line.order_status === "READY") {
                  visualStatus = "READY";
                } else if (line.order_status === "COLLECTED") {
                  visualStatus = "COLLECTED";
                }
                return (
                  <li key={line.id} style={lineRow(visualStatus)}>
                    <div>
                      <div style={{ ...lineItemText, fontWeight: 600 }}>{line.item_name}</div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                        ×{line.quantity} · {statusLabel(line.order_status)}
                      </div>
                    </div>
                    {next ? (
                      <button
                        type="button"
                        style={advanceBtn}
                        disabled={lineBusy === line.id}
                        onClick={() => void advanceLine(line)}
                      >
                        {next === "READY" ? "Mark Ready" : "Mark Collected"}
                      </button>
                    ) : (
                      <span style={{ color: "var(--ready)", fontSize: "0.85rem" }}>
                        {statusLabel(line.order_status)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </div>
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
const clubbedStrip: CSSProperties = {
  background: "var(--neutral-50)",
  border: "1px solid var(--border-primary)",
  borderRadius: 12,
  padding: "1rem",
  marginBottom: "1rem",
  boxShadow: "var(--shadow-sm)",
};
const clubbedChipWrap: CSSProperties = {
  display: "flex",
  gap: "0.55rem",
  marginTop: "0.65rem",
  overflowX: "auto",
  paddingBottom: "0.2rem",
};
const clubbedChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.45rem",
  border: "1px solid var(--border-primary)",
  borderRadius: 999,
  padding: "0.35rem 0.7rem",
  background: "var(--bg-warm)",
  whiteSpace: "nowrap",
};
const clubbedQty: CSSProperties = {
  minWidth: 24,
  height: 24,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--secondary-gradient)",
  color: "var(--text-on-dark)",
  fontWeight: 700,
  fontSize: "0.78rem",
};
const clubbedName: CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 600,
};
const ticketGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "1rem",
};
const ticket: CSSProperties = {
  background: "var(--neutral-50)",
  border: "1px solid var(--border-primary)",
  borderRadius: 12,
  padding: "0.85rem 1rem",
  minWidth: 0,
};
const ticketHead: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: "0.65rem",
  gap: "0.5rem",
};
const kot: CSSProperties = { fontSize: "1.25rem", fontWeight: 700, color: "var(--gold-accent)" };
const lineBase: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.5rem 0",
  borderTop: "1px solid var(--neutral-300)",
};

const lineItemText: CSSProperties = {
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};
function lineRow(status: "PREPARING" | "READY" | "COLLECTED"): CSSProperties {
  if (status === "COLLECTED") {
    return {
      ...lineBase,
      background: "linear-gradient(90deg, rgba(127, 147, 131, 0.18) 0%, rgba(127, 147, 131, 0) 80%)",
      borderLeft: "3px solid var(--earth-light)",
      paddingLeft: "0.5rem",
      opacity: 0.85,
    };
  }
  if (status === "READY") {
    return {
      ...lineBase,
      background: "linear-gradient(90deg, rgba(61, 122, 79, 0.18) 0%, rgba(61, 122, 79, 0) 80%)",
      borderLeft: "3px solid var(--gold-primary)",
      paddingLeft: "0.5rem",
    };
  }
  return {
    ...lineBase,
    background: "linear-gradient(90deg, rgba(247, 180, 37, 0.18) 0%, rgba(247, 180, 37, 0) 80%)",
    borderLeft: "3px solid var(--gold-accent-light)",
    paddingLeft: "0.5rem",
  };
}
const advanceBtn: CSSProperties = {
  padding: "0.35rem 0.65rem",
  borderRadius: 8,
  border: "1px solid var(--border-primary)",
  background: "var(--secondary-gradient)",
  color: "var(--text-on-dark)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
