import type { KioskStoreRow } from "./types";

const STORAGE_KEY = "ktr_store_context";

export interface StoredStoreContext {
  storeId: number;
  storeCode: string;
  storeName: string;
  savedAt: string;
}

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://localhost:8000";
}

export function readStoredStore(): StoredStoreContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredStoreContext;
    if (
      typeof parsed.storeId !== "number" ||
      typeof parsed.storeCode !== "string" ||
      typeof parsed.storeName !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredStore(ctx: Omit<StoredStoreContext, "savedAt">): void {
  const full: StoredStoreContext = {
    ...ctx,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
}

export function clearStoredStore(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Value for `X-Store-Id` header (numeric id is reliable for SSE query too). */
export function getXStoreIdHeaderValue(ctx: StoredStoreContext): string {
  return String(ctx.storeId);
}

export function storeRowToContext(row: KioskStoreRow): Omit<StoredStoreContext, "savedAt"> {
  return {
    storeId: row.store_id,
    storeCode: row.store_code,
    storeName: row.store_name,
  };
}

export function isStoreStillActive(
  ctx: StoredStoreContext,
  rows: KioskStoreRow[],
): boolean {
  return rows.some((r) => r.store_id === ctx.storeId);
}
