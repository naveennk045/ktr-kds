import type { KdsBoardPayload, KioskStoreRow, OrderItemStatus } from "./types";
import { getApiBaseUrl } from "./storeContext";

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const base = getApiBaseUrl();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${base}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function fetchKioskConfig(): Promise<KioskStoreRow[]> {
  const res = await fetch(buildUrl("/admin/kiosk-config"));
  return parseJson<KioskStoreRow[]>(res);
}

export async function fetchKdsBoard(
  xStoreId: string,
  maxRows = 20,
): Promise<KdsBoardPayload> {
  const res = await fetch(buildUrl("/kds/board", { max_rows: maxRows }), {
    headers: { "X-Store-Id": xStoreId },
  });
  return parseJson<KdsBoardPayload>(res);
}

export async function patchKdsLineStatus(
  xStoreId: string,
  lineId: number,
  status: OrderItemStatus,
): Promise<unknown> {
  const res = await fetch(buildUrl(`/kds/items/${lineId}/status`), {
    method: "PATCH",
    headers: {
      "X-Store-Id": xStoreId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  return parseJson(res);
}

export function kdsWebSocketUrl(storeId: number, maxRows = 20): string {
  const httpBase = getApiBaseUrl();
  const wsBase = httpBase.replace(/^http/, "ws");
  const path = `/kds/ws?max_rows=${encodeURIComponent(maxRows)}&store_id=${encodeURIComponent(storeId)}`;
  const url = new URL(path, `${wsBase}/`);
  return url.toString();
}
