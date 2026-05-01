import type { KdsLine, OrderItemStatus, TmsLine } from "./types";

export interface LineCounters {
  items_need_be_ready: number;
  items_need_be_collected: number;
}

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Normalizes API lines; when counters are absent (legacy API), infers from `order_status` + `quantity`. */
export function getLineCounters(line: KdsLine | TmsLine): LineCounters {
  if (isNum(line.items_need_be_ready) && isNum(line.items_need_be_collected)) {
    return {
      items_need_be_ready: line.items_need_be_ready,
      items_need_be_collected: line.items_need_be_collected,
    };
  }
  const q = line.quantity;
  const s: OrderItemStatus = line.order_status;
  if (s === "COLLECTED") return { items_need_be_ready: 0, items_need_be_collected: 0 };
  if (s === "READY") return { items_need_be_ready: 0, items_need_be_collected: q };
  return { items_need_be_ready: q, items_need_be_collected: 0 };
}

/** Drives row tint: kitchen work first, then counter queue, then done. */
export function lineVisualPhase(c: LineCounters): "PREPARING" | "READY" | "COLLECTED" {
  if (c.items_need_be_ready > 0) return "PREPARING";
  if (c.items_need_be_collected > 0) return "READY";
  return "COLLECTED";
}

export type BatchQuantityParseResult =
  | { ok: true; quantity: number | undefined }
  | { ok: false; message: string };

/**
 * Parses optional batch quantity from UI (empty = omit field → server moves max allowed for that status).
 * Does **not** clamp over the cap: values outside 1…cap are rejected so we never send a PATCH the API would 400 on.
 */
export function parseOptionalBatchQuantity(
  raw: string,
  cap: number,
  kind: "ready" | "collected",
): BatchQuantityParseResult {
  const t = raw.trim();
  if (!t) return { ok: true, quantity: undefined };

  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n < 1) {
    return {
      ok: false,
      message: "Enter a whole number of at least 1, or leave the field blank to move all allowed for this tap.",
    };
  }

  if (cap < 1) {
    return {
      ok: false,
      message:
        kind === "ready"
          ? "Nothing left to mark ready in the kitchen for this line."
          : "Nothing left to collect at the counter for this line.",
    };
  }

  if (n > cap) {
    const hint =
      kind === "ready"
        ? `At most ${cap} can be marked ready (still in kitchen).`
        : `At most ${cap} can be collected (waiting at counter).`;
    return { ok: false, message: hint };
  }

  return { ok: true, quantity: n };
}
