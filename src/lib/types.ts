export type OrderItemStatus =
  | "NOT_ACCEPTED"
  | "PREPARING"
  | "READY"
  | "COLLECTED";

export type OrderType = "DINEIN" | "TAKEAWAY";

export interface KioskStoreRow {
  store_id: number;
  store_code: string;
  store_name: string;
  pinelabs_configured?: boolean;
  terminals?: unknown[];
}

export interface KdsLine {
  id: number;
  sku_code?: string;
  item_name: string;
  quantity: number;
  /** Units still to mark READY (new API). Omitted on legacy responses — infer via {@link getLineCounters}. */
  items_need_be_ready?: number;
  /** Units at counter, not yet COLLECTED (new API). */
  items_need_be_collected?: number;
  order_status: OrderItemStatus;
  /** Per-line DINEIN / TAKEAWAY (mixed orders); falls back to the order's type. */
  order_type?: OrderType | string;
  /** Free kitchen options chosen on the kiosk, e.g. "Extra crispy". */
  options?: string[];
  /** Guest's note for the kitchen. */
  note?: string | null;
}

export interface KdsOrder {
  id: number;
  store_id: number;
  order_id: string;
  kot_code: string;
  order_type?: OrderType | string;
  kot_number?: number;
  kot_date?: string;
  created_at: string;
  lines: KdsLine[];
}

export interface ClubbedTotal {
  item_name: string;
  quantity: number;
}

export interface KdsBoardPayload {
  store_id: number;
  live_window_minutes: number;
  option: string;
  max_rows: number;
  orders: KdsOrder[];
  clubbed_totals: ClubbedTotal[];
}

export type WsEventType =
  | "SNAPSHOT"
  | "PING"
  | "BOARD_REFRESH"
  | "ITEM_STATUS_CHANGED"
  | "TMS_ANNOUNCE";

export interface WsEnvelope<T = unknown> {
  type: string;
  payload: T;
}

export interface ItemStatusPayload {
  store_id: number;
  line_id: number;
  order_id: string;
  kot_code: string;
  item_name: string;
  /** Batch size for this PATCH/event — not the line's ordered total. */
  quantity: number;
  items_need_be_ready?: number;
  items_need_be_collected?: number;
  order_status: OrderItemStatus;
  speech?: string;
}

export interface TmsLine {
  id: number;
  item_name: string;
  quantity: number;
  items_need_be_ready?: number;
  items_need_be_collected?: number;
  order_status: OrderItemStatus;
}

export interface TmsToken {
  kot_code: string;
  order_id: string;
  created_at: string;
  lines: TmsLine[];
  flags: {
    has_ready_for_pickup: boolean;
    has_in_kitchen: boolean;
  };
}

export interface TmsSnapshotPayload {
  store_id: number;
  live_window_minutes: number;
  option: string;
  tokens: TmsToken[];
}
