import type { OrderItemStatus } from "./types";

const CHAIN: OrderItemStatus[] = ["PREPARING", "READY", "COLLECTED"];

export function nextOrderItemStatus(
  current: OrderItemStatus,
): OrderItemStatus | null {
  if (current === "NOT_ACCEPTED") return "PREPARING";
  const i = CHAIN.indexOf(current);
  if (i === -1 || i >= CHAIN.length - 1) return null;
  return CHAIN[i + 1] ?? null;
}

export function statusLabel(s: OrderItemStatus): string {
  if (s === "NOT_ACCEPTED") return "New";
  if (s === "READY") return "Ready";
  if (s === "COLLECTED") return "Collected";
  return "Preparing";
}
