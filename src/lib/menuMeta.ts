/**
 * Sorts board lines into kitchen stations using the shared menu copy (GET /tms/menu-meta).
 * Petpooja only gives item names, so lines are matched by normalised name; anything that does not
 * match falls back to keywords, and a dish with no known category is shown at every station
 * (a ticket is never hidden because we could not classify it).
 */
import { useEffect, useState } from "react";
import { fetchMenuMeta, type MenuMetaPayload } from "./api";

export type StationId = "all" | "tawa" | "steam" | "rice" | "coffee";

export const STATIONS: { id: StationId; label: string; where: string; categories: string[] | null }[] = [
  { id: "all", label: "All", where: "all stations", categories: null },
  { id: "tawa", label: "Tawa", where: "the tawa", categories: ["davangere", "bengaluru", "paddu", "addon"] },
  { id: "steam", label: "Steamer & fryer", where: "the steamer and fryer", categories: ["idli", "vada", "addon"] },
  { id: "rice", label: "Rice & sweets", where: "rice and sweets", categories: ["rice", "dessert"] },
  { id: "coffee", label: "Coffee", where: "the coffee bar", categories: ["coffee"] },
];

const STAGE_FALLBACK = "Cooking";

export interface MenuIndex {
  categoryOf: (itemName: string) => string | null;
  stageOf: (itemName: string) => string;
}

function normalise(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const KEYWORDS: [RegExp, string][] = [
  [/coffee|kaapi|\btea\b|chai|buttermilk|majjige|juice|lassi|water/i, "coffee"],
  [/idli/i, "idli"],
  [/wada|vada/i, "vada"],
  [/paddu|paniyaram/i, "paddu"],
  [/dose|dosa/i, "bengaluru"],
  [/kesari|sweet|halwa|payasa/i, "dessert"],
  [/bath|rice|puliyogare|chitranna/i, "rice"],
  [/chutney|pudi|sambar/i, "addon"],
];

export function buildMenuIndex(meta: MenuMetaPayload | null): MenuIndex {
  const byName = new Map<string, string>();
  for (const it of meta?.items ?? []) {
    for (const n of [it.name, ...(it.aliases ?? [])]) {
      const k = normalise(n);
      if (k && !byName.has(k)) byName.set(k, it.category);
    }
  }
  const stage = new Map<string, string>();
  for (const c of meta?.categories ?? []) if (c.stage) stage.set(c.id, c.stage);

  const cache = new Map<string, string | null>();
  const categoryOf = (itemName: string): string | null => {
    if (cache.has(itemName)) return cache.get(itemName) ?? null;
    const key = normalise(itemName);
    let cat: string | null = byName.get(key) ?? null;
    if (!cat) {
      // Longest menu name contained in the line name ("Medu Wada (2 pcs)" → Medu Wada).
      let best = 0;
      for (const [n, c] of byName) {
        if (n.length > best && key.includes(n)) {
          best = n.length;
          cat = c;
        }
      }
    }
    if (!cat) cat = KEYWORDS.find(([re]) => re.test(itemName))?.[1] ?? null;
    cache.set(itemName, cat);
    return cat;
  };

  return {
    categoryOf,
    stageOf: (itemName) => stage.get(categoryOf(itemName) ?? "") ?? STAGE_FALLBACK,
  };
}

export function inStation(index: MenuIndex, station: StationId, itemName: string): boolean {
  const cats = STATIONS.find((s) => s.id === station)?.categories;
  if (!cats) return true;
  const cat = index.categoryOf(itemName);
  return cat === null || cats.includes(cat);
}

export function isDrink(index: MenuIndex, itemName: string): boolean {
  return index.categoryOf(itemName) === "coffee";
}

let cached: MenuIndex | null = null;

/** Menu index; starts as keyword-only matching and upgrades once menu-meta has loaded. */
export function useMenuIndex(): MenuIndex {
  const [index, setIndex] = useState<MenuIndex>(() => cached ?? buildMenuIndex(null));
  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetchMenuMeta()
      .then((meta) => {
        cached = buildMenuIndex(meta);
        if (alive) setIndex(cached);
      })
      .catch(() => {
        /* keyword matching keeps working */
      });
    return () => {
      alive = false;
    };
  }, []);
  return index;
}
