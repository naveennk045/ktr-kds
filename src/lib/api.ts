import type { KdsBoardPayload, KioskStoreRow, OrderItemStatus, TmsSnapshotPayload } from "./types";
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
  quantity?: number,
): Promise<unknown> {
  const body: { status: OrderItemStatus; quantity?: number } = { status };
  if (quantity !== undefined && Number.isFinite(quantity) && quantity > 0) {
    body.quantity = Math.floor(quantity);
  }
  const res = await fetch(buildUrl(`/kds/items/${lineId}/status`), {
    method: "PATCH",
    headers: {
      "X-Store-Id": xStoreId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function announceKdsItem(xStoreId: string, lineId: number): Promise<unknown> {
  const res = await fetch(buildUrl(`/kds/items/${lineId}/announce`), {
    method: "POST",
    headers: { "X-Store-Id": xStoreId },
  });
  return parseJson(res);
}

export async function announceKdsOrder(xStoreId: string, orderId: number): Promise<unknown> {
  const res = await fetch(buildUrl(`/kds/orders/${orderId}/announce`), {
    method: "POST",
    headers: { "X-Store-Id": xStoreId },
  });
  return parseJson(res);
}

export async function fetchTmsSnapshot(xStoreId: string): Promise<TmsSnapshotPayload> {
  const res = await fetch(buildUrl("/tms/snapshot"), {
    headers: { "X-Store-Id": xStoreId },
  });
  return parseJson<TmsSnapshotPayload>(res);
}

/** URL for `EventSource` (browsers cannot set `X-Store-Id` on SSE). */
export function tmsEventSourceUrl(storeId: number): string {
  return buildUrl("/tms/stream", { store_id: storeId });
}

export function kdsWebSocketUrl(storeId: number, maxRows = 20): string {
  const httpBase = getApiBaseUrl();
  const wsBase = httpBase.replace(/^http/, "ws");
  const path = `/kds/ws?max_rows=${encodeURIComponent(maxRows)}&store_id=${encodeURIComponent(storeId)}`;
  const url = new URL(path, `${wsBase}/`);
  return url.toString();
}

export interface MenuMetaPayload {
  categories?: { id: string; name: string; stage?: string }[];
  items?: { id: string; category: string; name: string; aliases?: string[] }[];
}

/** Hard-coded menu copy shared with the token board; used here to sort dishes into stations. */
export async function fetchMenuMeta(): Promise<MenuMetaPayload> {
  const res = await fetch(buildUrl("/tms/menu-meta"));
  return parseJson<MenuMetaPayload>(res);
}
