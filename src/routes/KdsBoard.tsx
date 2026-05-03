import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchKdsBoard, kdsWebSocketUrl, patchKdsLineStatus } from "../lib/api";
import { getLineCounters, lineVisualPhase, parseOptionalBatchQuantity } from "../lib/lineCounters";
import { getXStoreIdHeaderValue, readStoredStore } from "../lib/storeContext";
import type { KdsBoardPayload, KdsLine, OrderItemStatus, WsEnvelope } from "../lib/types";

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
  const [batchByLineId, setBatchByLineId] = useState<Record<number, string>>({});
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
        } else if (
          msg.type === "BOARD_REFRESH" ||
          msg.type === "ITEM_STATUS_CHANGED" ||
          msg.type === "TMS_ANNOUNCE"
        ) {
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

  async function sendPatch(
    line: KdsLine,
    status: OrderItemStatus,
    capForBatch: number,
    useBatchField: boolean,
  ) {
    if (!stored) return;
    const raw = useBatchField ? (batchByLineId[line.id] ?? "") : "";
    let quantity: number | undefined;
    if (status !== "PREPARING") {
      const kind = status === "READY" ? "ready" : "collected";
      const parsed = parseOptionalBatchQuantity(raw, capForBatch, kind);
      if (!parsed.ok) {
        setLoadError(parsed.message);
        return;
      }
      // Blank batch = "all remaining for this tap". Send an explicit `quantity` equal to the
      // current counter — omitting `quantity` makes some servers use the line *ordered* total,
      // which breaks after partial READY (e.g. 3 ordered, 1 left in kitchen → error if omitted).
      quantity =
        parsed.quantity !== undefined
          ? parsed.quantity
          : capForBatch > 0
            ? capForBatch
            : undefined;
    }
    setLineBusy(line.id);
    setLoadError(null);
    try {
      await patchKdsLineStatus(xStore, line.id, status, quantity);
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
          <Link to="/tms" style={linkMuted}>
            TMS
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

      <section style={clubbedStrip}>
        <h2 style={{ margin: 0, fontSize: "1rem", color: "var(--text-secondary)" }}>Clubbed summary</h2>
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
            Totals are <strong>ordered</strong> volume (not “still in kitchen”). Use per-line “Kitchen” counts below.
            <br />
            Window {visibleBoard.live_window_minutes}m · max {visibleBoard.max_rows} tickets
          </p>
        )}
      </section>

      {!visibleBoard && !loadError && <p style={{ color: "var(--muted)" }}>Loading board…</p>}
      {visibleBoard?.orders.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No tickets on the board.</p>
      )}
      <div className="kds-ticket-grid" style={ticketGrid}>
        {visibleBoard?.orders.map((order) => {
          let orderTypeText: string | undefined = order.order_type;
          if (order.order_type === "DINEIN") orderTypeText = "Dine-in";
          if (order.order_type === "TAKEAWAY") orderTypeText = "Takeaway";
          return (
            <article key={order.id} style={ticket}>
              <div style={ticketHead}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", minWidth: 0 }}>
                  <span style={kot}>{order.kot_code}</span>
                  {orderTypeText ? <span style={orderTypeBadge}>{orderTypeText}</span> : null}
                </div>
                <span style={{ color: "var(--muted)", fontSize: "0.85rem", textAlign: "right" }}>
                  {new Date(order.created_at).toLocaleString()}
                </span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {order.lines.map((line) => {
                  const c = getLineCounters(line);
                  const visual = lineVisualPhase(c);
                  const busy = lineBusy === line.id;
                  const showAccept = line.order_status === "NOT_ACCEPTED";
                  const showReady = c.items_need_be_ready > 0;
                  const showCollect = c.items_need_be_collected > 0;
                  const anyAction = showAccept || showReady || showCollect;
                  const showBatchField =
                    (showReady && c.items_need_be_ready > 1) ||
                    (showCollect && c.items_need_be_collected > 1);

                  return (
                    <li key={line.id} style={lineRow(visual)}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...lineItemText, fontWeight: 600 }}>{line.item_name}</div>
                        <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                          Ordered ×{line.quantity} · Kitchen {c.items_need_be_ready} · Counter{" "}
                          {c.items_need_be_collected}
                        </div>
                        {showBatchField ? (() => {
                          const maxQty = showReady ? c.items_need_be_ready : Math.max(c.items_need_be_collected, 1);
                          const currentQtyStr = batchByLineId[line.id];
                          const displayQty = currentQtyStr !== undefined ? currentQtyStr : maxQty;
                          const numQty = displayQty === "" ? 1 : Number(displayQty);
                          
                          const handleDec = () => {
                            if (busy || numQty <= 1) return;
                            setBatchByLineId((m) => ({ ...m, [line.id]: String(numQty - 1) }));
                          };
                          
                          const handleInc = () => {
                            if (busy || numQty >= maxQty) return;
                            setBatchByLineId((m) => ({ ...m, [line.id]: String(numQty + 1) }));
                          };

                          return (
                            <div style={batchRow}>
                              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>Batch qty</span>
                              <div style={qtyWrapper}>
                                <button
                                  type="button"
                                  disabled={busy || numQty <= 1}
                                  onClick={handleDec}
                                  style={{ ...qtyBtn, opacity: (busy || numQty <= 1) ? 0.5 : 1 }}
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={displayQty}
                                  disabled={busy}
                                  onChange={(e) => {
                                    const valStr = e.target.value.replace(/[^0-9]/g, '');
                                    if (valStr === "") {
                                      setBatchByLineId((m) => ({ ...m, [line.id]: "" }));
                                    } else {
                                      let val = parseInt(valStr, 10);
                                      if (val > maxQty) val = maxQty;
                                      setBatchByLineId((m) => ({ ...m, [line.id]: String(val) }));
                                    }
                                  }}
                                  style={qtyInputCenter}
                                  aria-label={`Batch quantity for ${line.item_name}`}
                                />
                                <button
                                  type="button"
                                  disabled={busy || numQty >= maxQty}
                                  onClick={handleInc}
                                  style={{ ...qtyBtn, opacity: (busy || numQty >= maxQty) ? 0.5 : 1 }}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })() : null}
                      </div>
                      <div style={actionCol}>
                        {showAccept ? (
                          <button
                            type="button"
                            style={advanceBtn}
                            disabled={busy}
                            onClick={() => void sendPatch(line, "PREPARING", 0, false)}
                          >
                            Start
                          </button>
                        ) : null}
                        {showReady ? (
                          <button
                            type="button"
                            style={advanceBtn}
                            disabled={busy}
                            onClick={() => void sendPatch(line, "READY", c.items_need_be_ready, showBatchField)}
                          >
                            Ready
                          </button>
                        ) : null}
                        {showCollect ? (
                          <button
                            type="button"
                            style={{ ...advanceBtn, background: "var(--gold-primary)", color: "var(--text-on-dark)" }}
                            disabled={busy}
                            onClick={() =>
                              void sendPatch(line, "COLLECTED", c.items_need_be_collected, showBatchField)
                            }
                          >
                            Collected
                          </button>
                        ) : null}
                        {!anyAction ? (
                          <span style={{ color: "var(--ready)", fontSize: "0.85rem" }}>Done</span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
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
  flexWrap: "wrap",
  gap: "0.55rem",
  marginTop: "0.65rem",
  overflowX: "visible",
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
const orderTypeBadge: CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  borderRadius: 999,
  padding: "0.15rem 0.5rem",
  background: "var(--order-type-gradient)",
  color: "var(--text-on-dark)",
  whiteSpace: "nowrap",
};
const lineBase: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "stretch",
  gap: "0.75rem",
  padding: "0.5rem 0",
  borderTop: "1px solid var(--neutral-300)",
};

const lineItemText: CSSProperties = {
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

const batchRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  marginTop: "0.35rem",
  fontSize: "0.78rem",
};

const qtyWrapper: CSSProperties = {
  display: "flex",
  alignItems: "center",
  border: "1px solid var(--border-primary)",
  borderRadius: 6,
  background: "var(--neutral-50)",
  overflow: "hidden",
};

const qtyBtn: CSSProperties = {
  background: "var(--bg-warm)",
  border: "none",
  color: "var(--text-primary)",
  padding: "0.15rem 0.6rem",
  fontSize: "1.1rem",
  fontWeight: "bold",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const qtyInputCenter: CSSProperties = {
  width: "2.5rem",
  textAlign: "center",
  border: "none",
  borderLeft: "1px solid var(--border-primary)",
  borderRight: "1px solid var(--border-primary)",
  background: "transparent",
  color: "var(--text-primary)",
  padding: "0.2rem 0",
  fontSize: "0.9rem",
};

const actionCol: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  justifyContent: "center",
  alignItems: "stretch",
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
