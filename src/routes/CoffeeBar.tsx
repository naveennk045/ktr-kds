import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import KdsShell, { ModChip } from "../components/KdsShell";
import { getLineCounters } from "../lib/lineCounters";
import { isDrink, useMenuIndex, type MenuIndex } from "../lib/menuMeta";
import { clock, tokenOf, useKdsBoard } from "../lib/useKdsBoard";
import type { KdsLine, KdsOrder } from "../lib/types";

const WARN_MIN = 3;
const LATE_MIN = 6;

interface Cup {
  order: KdsOrder;
  line: KdsLine;
  qty: number; // cups still to pour
  age: number;
}

function ageClass(ms: number): "ok" | "warn" | "late" {
  const m = ms / 60000;
  return m >= LATE_MIN ? "late" : m >= WARN_MIN ? "warn" : "ok";
}

function isCold(name: string): boolean {
  return /cold|iced|ice\b/i.test(name);
}

function isParcel(order: KdsOrder, line: KdsLine): boolean {
  return (line.order_type ?? order.order_type) === "TAKEAWAY";
}

/** Where the rest of the order is, so the barista pours at the right moment. */
function foodStatus(menu: MenuIndex, order: KdsOrder): { text: string; cls: string } {
  const food = order.lines.filter((l) => !isDrink(menu, l.item_name) && menu.categoryOf(l.item_name) !== "addon");
  if (!food.length) return { text: "Drinks only", cls: "solo" };
  if (food.every((l) => getLineCounters(l).items_need_be_ready === 0)) return { text: "Food is ready, pour now", cls: "now" };
  if (food.some((l) => l.order_status !== "NOT_ACCEPTED")) return { text: "Food is cooking", cls: "soon" };
  return { text: "Food not started", cls: "wait" };
}

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* sound is optional */
  }
}

export default function CoffeeBar() {
  const { stored, board, error, live, busy, now, move } = useKdsBoard();
  const menu = useMenuIndex();
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const [flash, setFlash] = useState(false);

  const cups = useMemo<Cup[]>(() => {
    const out: Cup[] = [];
    for (const order of board?.orders ?? []) {
      for (const line of order.lines) {
        const qty = getLineCounters(line).items_need_be_ready;
        if (qty > 0 && isDrink(menu, line.item_name)) {
          out.push({ order, line, qty, age: now - new Date(order.created_at).getTime() });
        }
      }
    }
    return out.sort((a, b) => b.age - a.age);
  }, [board, menu, now]);

  // A new drink on the board: flash the screen and chime (sound needs one tap on the page first).
  const cupIds = cups.map((c) => c.line.id).join(",");
  useEffect(() => {
    const ids = new Set(cups.map((c) => c.line.id));
    if (seen.current) {
      const added = [...ids].filter((id) => !seen.current!.has(id));
      if (added.length) {
        setFresh(new Set(added));
        setFlash(true);
        chime();
        const t = setTimeout(() => {
          setFresh(new Set());
          setFlash(false);
        }, 1300);
        seen.current = ids;
        return () => clearTimeout(t);
      }
    }
    if (board) seen.current = ids;
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cupIds, board]);

  const batches = useMemo(() => {
    const g = new Map<string, { name: string; mods: string[]; qty: number; cups: Cup[] }>();
    for (const c of cups) {
      const mods = [...(c.line.options ?? [])].sort();
      const key = `${c.line.item_name}|${mods.join("+")}`;
      const x = g.get(key) ?? { name: c.line.item_name, mods, qty: 0, cups: [] };
      x.qty += c.qty;
      x.cups.push(c);
      g.set(key, x);
    }
    return [...g.values()].sort((a, b) => b.qty - a.qty);
  }, [cups]);

  const poured = useMemo(() => {
    const out: { order: KdsOrder; line: KdsLine; status: string; cls: string }[] = [];
    for (const order of board?.orders ?? []) {
      const orderReady = order.lines.every((l) => getLineCounters(l).items_need_be_ready === 0);
      for (const line of order.lines) {
        if (!isDrink(menu, line.item_name) || getLineCounters(line).items_need_be_ready > 0) continue;
        const collected = line.order_status === "COLLECTED";
        out.push({ order, line, status: collected ? "Collected" : orderReady ? "At counter" : "Waiting for food", cls: collected ? "col" : "" });
      }
    }
    return out.reverse().slice(0, 8);
  }, [board, menu]);

  if (!stored) return <Navigate to="/" replace />;

  const count = (f: (c: Cup) => boolean) => cups.filter(f).reduce((n, c) => n + c.qty, 0);
  const total = count(() => true);
  const cold = count((c) => isCold(c.line.item_name));
  const hot = total - cold;
  const oldest = cups[0]?.age ?? 0;

  const tips: string[] = [];
  if (hot >= 3) tips.push(`Warm ${hot} tumblers and dabaras now.`);
  if (cold) tips.push(`Keep ${cold} glass${cold > 1 ? "es" : ""} and ice ready for cold filter.`);
  const strong = cups.filter((c) => (c.line.options ?? []).includes("Strong")).length;
  if (strong) tips.push(`${strong} strong: go heavy on decoction.`);
  const lessSugar = cups.filter((c) => (c.line.options ?? []).some((m) => /sugar/i.test(m))).length;
  if (lessSugar) tips.push(`${lessSugar} with less or no sugar. Sweeten each one separately.`);
  if (!tips.length) tips.push("Decoction fresh? Brew a new batch every 2 hours.", "Milk hot and frothy, not boiling over.");

  return (
    <KdsShell storeName={stored.storeName} live={live} now={now} error={error} className={`kx-bar ${flash ? "flash" : ""}`}>
      <section className="kx-bar-hero">
        <div className="kx-bar-title">
          <span className="kx-bar-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" />
              <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" />
              <path d="M8 3v2M11.5 3v2M15 3v2" />
            </svg>
          </span>
          <div>
            <h1>Coffee &amp; drinks bar</h1>
            <p>Every drink on the board, oldest first. Pour when the food is nearly up.</p>
          </div>
        </div>
        <div className="kx-bar-stats">
          <div className="bs big"><b>{total}</b><span>cups to pour</span></div>
          <div className="bs hot"><b>{hot}</b><span>Hot</span></div>
          <div className="bs cold"><b>{cold}</b><span>Cold</span></div>
          <div className={`bs ${cups.length ? ageClass(oldest) : ""}`}><b>{cups.length ? clock(oldest) : "–"}</b><span>Oldest wait</span></div>
        </div>
      </section>

      <section aria-labelledby="h-batch">
        <h2 id="h-batch">Pour together</h2>
        {batches.length === 0 ? (
          <div className="kx-empty">Nothing to pour right now. Enjoy the quiet, and top up the decoction.</div>
        ) : (
          <div className="kx-batch-row">
            {batches.map((b) => {
              const tokens = [...new Set(b.cups.map((c) => tokenOf(c.order.kot_code)))];
              const batchBusy = b.cups.some((c) => busy.has(c.line.id));
              return (
                <div key={`${b.name}|${b.mods.join("+")}`} className={`kx-batch ${isCold(b.name) ? "cold" : "hot"}`}>
                  <div className="b-qty">{b.qty}<small>×</small></div>
                  <div className="b-tx">
                    <b>{b.name}</b>
                    <div className="kx-mods">
                      {b.mods.length ? b.mods.map((m) => <ModChip key={m} text={m} />) : <span className="kx-mod plain">Regular</span>}
                    </div>
                    <span className="b-tok">Tokens {tokens.join(", ")}</span>
                  </div>
                  <button
                    type="button"
                    className="kx-bar-btn go"
                    disabled={batchBusy}
                    onClick={() => void move(b.cups.map((c) => ({ lineId: c.line.id, status: "READY" as const, quantity: c.qty })))}
                  >
                    All poured
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="kx-bar-main">
        <section aria-labelledby="h-queue">
          <div className="kx-head">
            <h2 id="h-queue">Drinks queue</h2>
            <span className="kx-legend">
              <i className="lg ok" />Under {WARN_MIN} min <i className="lg warn" />{WARN_MIN} to {LATE_MIN} min <i className="lg late" />Over {LATE_MIN} min
            </span>
          </div>
          {cups.length === 0 ? (
            <div className="kx-empty big">All drinks are out. New drinks pop up here the moment they&apos;re ordered.</div>
          ) : (
            <div className="kx-bar-queue">
              {cups.map((c) => {
                const fs = foodStatus(menu, c.order);
                const brewing = c.line.order_status !== "NOT_ACCEPTED";
                const lineBusy = busy.has(c.line.id);
                return (
                  <article
                    key={c.line.id}
                    className={`kx-cup ${ageClass(c.age)} ${isCold(c.line.item_name) ? "is-cold" : "is-hot"} ${brewing ? "brewing" : ""} ${fresh.has(c.line.id) ? "fresh" : ""}`}
                  >
                    <div className="cup-top">
                      <span className="cup-tok">{tokenOf(c.order.kot_code)}</span>
                      <span className="cup-age">{clock(c.age)}</span>
                    </div>
                    <div className="cup-name">
                      <span className="q">{c.qty}×</span>
                      {c.line.item_name}
                    </div>
                    <div className="kx-mods">
                      {(c.line.options ?? []).length ? (c.line.options ?? []).map((m) => <ModChip key={m} text={m} />) : <span className="kx-mod plain">Regular</span>}
                    </div>
                    {c.line.note && <div className="cup-note">“{c.line.note}”</div>}
                    <div className="cup-tags">
                      {isParcel(c.order, c.line) ? <span className="ct parcel">Parcel · use a cup with lid</span> : <span className="ct">Eat here · tumbler &amp; dabara</span>}
                    </div>
                    <div className={`cup-food ${fs.cls}`}>{fs.text}</div>
                    <div className="cup-acts">
                      {brewing ? (
                        <button type="button" className="kx-bar-btn go" disabled={lineBusy} onClick={() => void move([{ lineId: c.line.id, status: "READY", quantity: c.qty }])}>
                          Poured, ready
                        </button>
                      ) : (
                        <button type="button" className="kx-bar-btn" disabled={lineBusy} onClick={() => void move([{ lineId: c.line.id, status: "PREPARING" }])}>
                          Start brewing
                        </button>
                      )}
                      {brewing && <span className="cup-st">Brewing</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="kx-bar-side" aria-labelledby="h-poured">
          <h2 id="h-poured">Just poured</h2>
          {poured.length === 0 ? (
            <p className="kx-muted">Poured drinks show here.</p>
          ) : (
            <div className="kx-poured">
              {poured.map((p) => (
                <div key={p.line.id} className="pd">
                  <span className="pd-tok">{tokenOf(p.order.kot_code)}</span>
                  <span className="pd-tx">
                    {p.line.quantity} × {p.line.item_name}
                    {(p.line.options ?? []).length ? ` · ${(p.line.options ?? []).join(", ")}` : ""}
                  </span>
                  <span className={`pd-st ${p.cls}`}>{p.status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="kx-bar-tip">
            <h3>Bar checklist</h3>
            <ul>
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </KdsShell>
  );
}
