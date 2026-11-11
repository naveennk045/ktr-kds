import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import KdsShell, { ModChip } from "../components/KdsShell";
import { getLineCounters } from "../lib/lineCounters";
import { STATIONS, inStation, useMenuIndex, type StationId } from "../lib/menuMeta";
import { clock, tokenOf, useKdsBoard, type LineMove } from "../lib/useKdsBoard";
import type { KdsLine, KdsOrder } from "../lib/types";

const STATION_KEY = "ktr-kds-station";
const HIDE_DONE_AFTER_MS = 5_000;
const WARN_MIN = 5;
const LATE_MIN = 10;

type TicketState = "new" | "cooking" | "partial" | "ready";

function readStation(): StationId {
  try {
    const v = localStorage.getItem(STATION_KEY);
    if (STATIONS.some((s) => s.id === v)) return v as StationId;
  } catch {
    /* ignore */
  }
  return "all";
}

function isParcel(order: KdsOrder, line: KdsLine): boolean {
  return (line.order_type ?? order.order_type) === "TAKEAWAY";
}

function ticketState(order: KdsOrder): TicketState {
  const cs = order.lines.map(getLineCounters);
  const toMake = cs.reduce((n, c) => n + c.items_need_be_ready, 0);
  const atCounter = cs.reduce((n, c) => n + c.items_need_be_collected, 0);
  if (toMake === 0) return "ready";
  if (atCounter > 0 || order.lines.some((l) => l.order_status === "READY" || l.order_status === "COLLECTED")) return "partial";
  return order.lines.some((l) => l.order_status === "PREPARING") ? "cooking" : "new";
}

export default function KdsBoard() {
  const { stored, board, error, live, busy, now, move, announceOrder } = useKdsBoard();
  const menu = useMenuIndex();
  const [station, setStation] = useState<StationId>(readStation);
  const [partQty, setPartQty] = useState<Record<number, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const doneAt = useRef<Record<number, number>>({});
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());

  const pickStation = (id: StationId) => {
    setStation(id);
    try {
      localStorage.setItem(STATION_KEY, id);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Tickets that arrived since the last snapshot slide in.
  useEffect(() => {
    if (!board) return;
    const ids = new Set(board.orders.map((o) => o.id));
    if (seen.current) {
      const added = [...ids].filter((id) => !seen.current!.has(id));
      if (added.length) {
        setFresh(new Set(added));
        setTimeout(() => setFresh(new Set()), 1200);
      }
    }
    seen.current = ids;
  }, [board]);

  // Fully collected tickets linger a few seconds, then leave the board.
  const orders = useMemo(() => {
    if (!board) return [];
    const liveIds = new Set<number>();
    const out = board.orders.filter((o) => {
      liveIds.add(o.id);
      const done = o.lines.length > 0 && o.lines.every((l) => l.order_status === "COLLECTED");
      if (!done) {
        delete doneAt.current[o.id];
        return true;
      }
      doneAt.current[o.id] ??= now;
      return now - doneAt.current[o.id] < HIDE_DONE_AFTER_MS;
    });
    for (const k of Object.keys(doneAt.current)) if (!liveIds.has(Number(k))) delete doneAt.current[Number(k)];
    return out;
  }, [board, now]);

  // Kitchen summary: what is still to make, added up by dish for this station.
  const summary = useMemo(() => {
    const g = new Map<string, { qty: number; toStart: number; cooking: number; mods: Map<string, number>; notes: number; parcel: number; tokens: string[] }>();
    for (const o of orders) {
      for (const l of o.lines) {
        const c = getLineCounters(l);
        if (c.items_need_be_ready <= 0 || !inStation(menu, station, l.item_name)) continue;
        const x = g.get(l.item_name) ?? { qty: 0, toStart: 0, cooking: 0, mods: new Map<string, number>(), notes: 0, parcel: 0, tokens: [] as string[] };
        x.qty += c.items_need_be_ready;
        if (l.order_status === "NOT_ACCEPTED") x.toStart += c.items_need_be_ready;
        else x.cooking += c.items_need_be_ready;
        for (const m of l.options ?? []) x.mods.set(m, (x.mods.get(m) ?? 0) + c.items_need_be_ready);
        if (l.note) x.notes += 1;
        if (isParcel(o, l)) x.parcel += c.items_need_be_ready;
        const tok = tokenOf(o.kot_code);
        if (!x.tokens.includes(tok)) x.tokens.push(tok);
        g.set(l.item_name, x);
      }
    }
    return [...g.entries()].sort((a, b) => b[1].qty - a[1].qty);
  }, [orders, menu, station]);
  const totalToMake = summary.reduce((n, [, x]) => n + x.qty, 0);

  const tickets = useMemo(() => {
    const list = orders.filter((o) => station === "all" || o.lines.some((l) => inStation(menu, station, l.item_name)));
    return list.sort((a, b) => {
      const ra = ticketState(a) === "ready";
      const rb = ticketState(b) === "ready";
      if (ra !== rb) return ra ? 1 : -1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [orders, menu, station]);

  if (!stored) return <Navigate to="/" replace />;

  const where = STATIONS.find((s) => s.id === station)?.where ?? "all stations";

  const allReady = (o: KdsOrder) => {
    const moves: LineMove[] = [];
    for (const l of o.lines) {
      const c = getLineCounters(l);
      if (c.items_need_be_ready > 0) moves.push({ lineId: l.id, status: "READY", quantity: c.items_need_be_ready });
    }
    void move(moves);
  };
  const allCollected = (o: KdsOrder) => {
    const moves: LineMove[] = [];
    for (const l of o.lines) {
      const c = getLineCounters(l);
      if (c.items_need_be_collected > 0) moves.push({ lineId: l.id, status: "COLLECTED", quantity: c.items_need_be_collected });
    }
    void move(moves);
  };

  return (
    <KdsShell
      storeName={stored.storeName}
      live={live}
      now={now}
      error={error}
      tools={
        <div className="kx-seg kx-stations" role="group" aria-label="Station">
          {STATIONS.map((s) => (
            <button key={s.id} type="button" aria-pressed={station === s.id} onClick={() => pickStation(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      }
    >
      <section className="kx-summary" aria-labelledby="h-sum">
        <div className="kx-head">
          <h2 id="h-sum">
            Kitchen summary
            {totalToMake > 0 && <span className="kx-sub">{totalToMake} to make at {where}</span>}
          </h2>
        </div>
        {summary.length === 0 ? (
          <div className="kx-empty">Nothing waiting at {where}. New tickets add up here by dish.</div>
        ) : (
          <div className="kx-sum-grid">
            {summary.map(([name, x]) => (
              <div key={name} className={`kx-sum-card ${x.qty >= 4 ? "hot" : ""}`}>
                <div className="kx-sum-top">
                  <span className="kx-sum-qty">{x.qty}</span>
                  <span className="kx-sum-name">{name}</span>
                </div>
                <div className="kx-sum-stages">
                  {x.toStart > 0 && <i className="s0" style={{ flex: x.toStart }} />}
                  {x.cooking > 0 && <i className="s1" style={{ flex: x.cooking }} />}
                </div>
                <div className="kx-sum-legend">
                  {x.toStart > 0 && <><b>{x.toStart}</b> to start · </>}
                  {x.cooking > 0 && <><b>{x.cooking}</b> {menu.stageOf(name).toLowerCase()} · </>}
                  tokens {x.tokens.join(", ")}
                </div>
                {(x.mods.size > 0 || x.notes > 0 || x.parcel > 0) && (
                  <div className="kx-mods">
                    {x.parcel > 0 && <span className="kx-mod parcel">Parcel ×{x.parcel}</span>}
                    {[...x.mods.entries()].map(([m, n]) => (
                      <ModChip key={m} text={m} count={n} />
                    ))}
                    {x.notes > 0 && <span className="kx-mod soft">{x.notes} {x.notes > 1 ? "notes" : "note"}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="kx-tickets-wrap" aria-labelledby="h-tickets">
        <div className="kx-head">
          <h2 id="h-tickets">
            Tickets
            {tickets.length > 0 && <span className="kx-sub">{tickets.length} on the board, oldest first</span>}
          </h2>
          <span className="kx-legend">
            <i className="lg ok" />Under {WARN_MIN} min <i className="lg warn" />{WARN_MIN} to {LATE_MIN} min <i className="lg late" />Over {LATE_MIN} min
          </span>
        </div>

        {!board && !error && <div className="kx-empty">Loading the board…</div>}
        {board && tickets.length === 0 && (
          <div className="kx-empty">No tickets at {where}. New orders appear here, oldest first.</div>
        )}

        <div className="kx-tickets">
          {tickets.map((o) => {
            const st = ticketState(o);
            const created = new Date(o.created_at).getTime();
            const mins = (now - created) / 60000;
            const age = st === "ready" ? "done" : mins >= LATE_MIN ? "late" : mins >= WARN_MIN ? "warn" : "";
            const parcelLines = o.lines.filter((l) => isParcel(o, l));
            const allParcel = parcelLines.length === o.lines.length;
            const mixed = parcelLines.length > 0 && !allParcel;
            const ticketBusy = o.lines.some((l) => busy.has(l.id));
            return (
              <article key={o.id} className={`kx-ticket ${st === "ready" ? "is-ready" : ""} ${fresh.has(o.id) ? "fresh" : ""}`}>
                <div className={`kx-t-head ${age}`}>
                  <span className="kx-t-token">{tokenOf(o.kot_code)}</span>
                  <div className="kx-t-meta">
                    <span className="kx-t-age">{clock(now - created)}</span>
                    <span className="kx-t-sub">{new Date(created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="kx-t-badges">
                    {allParcel && <span className="kx-mod parcel">Parcel</span>}
                    {mixed && <span className="kx-mod parcel">Part parcel</span>}
                    {st === "partial" && <span className="kx-pill partial">Partly ready</span>}
                    {st === "ready" && <span className="kx-pill ready">Ready</span>}
                  </div>
                </div>

                <div className="kx-t-items">
                  {o.lines.map((l) => {
                    const c = getLineCounters(l);
                    const done = l.order_status === "COLLECTED";
                    const lineBusy = busy.has(l.id);
                    const toMake = c.items_need_be_ready;
                    const atCounter = c.items_need_be_collected;
                    const cap = toMake > 0 ? toMake : atCounter;
                    const qty = Math.min(partQty[l.id] ?? cap, cap);
                    const stage =
                      done ? "Collected"
                        : toMake === 0 ? "At the counter"
                        : l.order_status === "NOT_ACCEPTED" ? "To start"
                        : atCounter > 0 ? `${menu.stageOf(l.item_name)} · ${atCounter} at counter`
                        : menu.stageOf(l.item_name);
                    return (
                      <div
                        key={l.id}
                        className={`kx-t-item ${done ? "done" : ""} ${toMake === 0 && !done ? "ready" : ""} ${inStation(menu, station, l.item_name) ? "" : "dim"}`}
                      >
                        <div className="kx-t-name">
                          <span className="q">{l.quantity}×</span>
                          {l.item_name}
                        </div>
                        <div className="kx-t-stage">
                          <span className="st">{stage}</span>
                          {cap > 1 && l.order_status !== "NOT_ACCEPTED" && (
                            <span className="kx-part" aria-label={`How many ${l.item_name}`}>
                              <button type="button" disabled={lineBusy || qty <= 1} onClick={() => setPartQty((m) => ({ ...m, [l.id]: qty - 1 }))}>−</button>
                              <output>{qty}</output>
                              <button type="button" disabled={lineBusy || qty >= cap} onClick={() => setPartQty((m) => ({ ...m, [l.id]: qty + 1 }))}>+</button>
                            </span>
                          )}
                          {l.order_status === "NOT_ACCEPTED" ? (
                            <button type="button" className="kx-bump" disabled={lineBusy} onClick={() => void move([{ lineId: l.id, status: "PREPARING" }])}>
                              Start
                            </button>
                          ) : toMake > 0 ? (
                            <button type="button" className="kx-bump go" disabled={lineBusy} onClick={() => void move([{ lineId: l.id, status: "READY", quantity: qty }])}>
                              Ready
                            </button>
                          ) : atCounter > 0 ? (
                            <button type="button" className="kx-bump" disabled={lineBusy} onClick={() => void move([{ lineId: l.id, status: "COLLECTED", quantity: qty }])}>
                              Collected
                            </button>
                          ) : (
                            <span className="kx-check" aria-label="Done">✓</span>
                          )}
                        </div>
                        {((l.options?.length ?? 0) > 0 || l.note || (mixed && isParcel(o, l))) && (
                          <div className="kx-t-detail">
                            <div className="kx-mods">
                              {mixed && isParcel(o, l) && <span className="kx-mod parcel">Parcel</span>}
                              {(l.options ?? []).map((m) => (
                                <ModChip key={m} text={m} />
                              ))}
                            </div>
                            {l.note && <div className="kx-note">{l.note}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="kx-t-foot">
                  {st !== "ready" ? (
                    <button type="button" className="kx-ghost go" disabled={ticketBusy} onClick={() => allReady(o)}>
                      All ready
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="kx-ghost"
                        onClick={async () => {
                          if (await announceOrder(o.id)) setToast(`Token ${tokenOf(o.kot_code)} announced`);
                        }}
                      >
                        Announce again
                      </button>
                      <button type="button" className="kx-ghost go" disabled={ticketBusy} onClick={() => allCollected(o)}>
                        Collected
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {toast && <div className="kx-toast" role="status">{toast}</div>}
    </KdsShell>
  );
}
