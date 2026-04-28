export type OrderItemStatus =
  | "NOT_ACCEPTED"
  | "PREPARING"
  | "READY"
  | "COLLECTED";

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
  order_status: OrderItemStatus;
}

export interface KdsOrder {
  id: number;
  store_id: number;
  order_id: string;
  kot_code: string;
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
  | "ITEM_STATUS_CHANGED";

export interface WsEnvelope<T = unknown> {
  type: WsEventType | string;
  payload: T;
}

export interface ItemStatusPayload {
  store_id: number;
  line_id: number;
  order_id: string;
  kot_code: string;
  item_name: string;
  quantity: number;
  order_status: OrderItemStatus;
}
