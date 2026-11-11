/**
 * Live kitchen board shared by the kitchen display and the coffee bar: first snapshot over HTTP,
 * then the KDS WebSocket, with polling as the fallback when the socket is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { announceKdsOrder, fetchKdsBoard, kdsWebSocketUrl, patchKdsLineStatus } from "./api";
import { getXStoreIdHeaderValue, readStoredStore } from "./storeContext";
import type { KdsBoardPayload, OrderItemStatus, WsEnvelope } from "./types";

const POLL_MS = 10_000;
const MAX_ROWS = 40;

export interface LineMove {
  lineId: number;
  status: OrderItemStatus;
  /** Units to move; omit only for PREPARING (which takes the whole line). */
  quantity?: number;
}

export function useKdsBoard() {
  const stored = useMemo(() => readStoredStore(), []);
  const xStore = stored ? getXStoreIdHeaderValue(stored) : "";
  const [board, setBoard] = useState<KdsBoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"connecting" | "live" | "polling">("connecting");
  const [busy, setBusy] = useState<Set<number>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async () => {
    if (!stored) return;
    try {
      setBoard(await fetchKdsBoard(xStore, MAX_ROWS));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the board");
    }
  }, [stored, xStore]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    const clearPoll = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    const startPoll = () => {
      if (cancelled) return;
      clearPoll();
      pollRef.current = setInterval(() => void refetch(), POLL_MS);
      setLive("polling");
    };

    const ws = new WebSocket(kdsWebSocketUrl(stored.storeId, MAX_ROWS));
    ws.onopen = () => {
      if (cancelled) return;
      setLive("live");
      clearPoll();
    };
    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(String(ev.data)) as WsEnvelope<KdsBoardPayload | Record<string, unknown>>;
        if (msg.type === "SNAPSHOT" && msg.payload && "orders" in msg.payload) {
          setBoard(msg.payload as KdsBoardPayload);
          setError(null);
        } else if (msg.type === "BOARD_REFRESH" || msg.type === "ITEM_STATUS_CHANGED" || msg.type === "TMS_ANNOUNCE") {
          void refetch();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = startPoll;
    ws.onclose = startPoll;

    return () => {
      cancelled = true;
      clearPoll();
      ws.close();
    };
  }, [stored, refetch]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Applies one or more line moves, then reloads the board once. */
  const move = useCallback(
    async (moves: LineMove[]) => {
      if (!stored || moves.length === 0) return;
      const ids = moves.map((m) => m.lineId);
      setBusy((cur) => new Set([...cur, ...ids]));
      setError(null);
      try {
        for (const m of moves) {
          await patchKdsLineStatus(xStore, m.lineId, m.status, m.quantity);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      } finally {
        await refetch();
        setBusy((cur) => {
          const next = new Set(cur);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [stored, xStore, refetch],
  );

  const announceOrder = useCallback(
    async (orderId: number) => {
      if (!stored) return false;
      try {
        await announceKdsOrder(xStore, orderId);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not announce the order");
        return false;
      }
    },
    [stored, xStore],
  );

  return { stored, board, error, setError, live, busy, now, move, announceOrder };
}

/** m:ss since a timestamp. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Token as shown to guests ("KTR-042" → "042"). */
export function tokenOf(kotCode: string): string {
  return String(kotCode || "").replace(/^KTR-/i, "") || "—";
}
