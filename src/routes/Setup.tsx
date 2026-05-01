import { useCallback, useEffect, useMemo, useReducer, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { fetchKioskConfig } from "../lib/api";
import type { KioskStoreRow } from "../lib/types";
import {
  clearStoredStore,
  getXStoreIdHeaderValue,
  isStoreStillActive,
  readStoredStore,
  storeRowToContext,
  writeStoredStore,
} from "../lib/storeContext";

export default function Setup() {
  const [rows, setRows] = useState<KioskStoreRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, refreshStoreView] = useReducer((n: number) => n + 1, 0);
  const stored = readStoredStore();
  const [storeId, setStoreId] = useState(stored?.storeId ? String(stored.storeId) : "");
  const [storeCode, setStoreCode] = useState(stored?.storeCode ?? "");
  const [storeName, setStoreName] = useState(stored?.storeName ?? "");
  const savedAt = useMemo(() => {
    if (!stored?.savedAt) return null;
    const dt = new Date(stored.savedAt);
    return Number.isNaN(dt.getTime()) ? stored.savedAt : dt.toLocaleString();
  }, [stored?.savedAt]);

  const loadStores = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchKioskConfig();
      setRows(list);
      const current = readStoredStore();
      if (current && !isStoreStillActive(current, list)) {
        clearStoredStore();
        refreshStoreView();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load kiosk config");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  function selectStore(row: KioskStoreRow) {
    setError(null);
    writeStoredStore(storeRowToContext(row));
    setStoreId(String(row.store_id));
    setStoreCode(row.store_code);
    setStoreName(row.store_name);
    refreshStoreView();
  }

  function saveStoreContext() {
    setError(null);
    const parsedStoreId = Number.parseInt(storeId, 10);
    if (!Number.isFinite(parsedStoreId) || parsedStoreId <= 0) {
      setError("Store ID must be a valid positive number.");
      return;
    }
    if (!storeCode.trim() || !storeName.trim()) {
      setError("Store code and store name are required.");
      return;
    }
    writeStoredStore({
      storeId: parsedStoreId,
      storeCode: storeCode.trim(),
      storeName: storeName.trim(),
    });
    refreshStoreView();
  }

  return (
    <div style={shell}>
      <header style={header}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Outlet setup</h1>
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", maxWidth: 560 }}>
          Loads active stores from <code>GET /admin/kiosk-config</code> and saves your choice in{" "}
          <code>localStorage</code>.
        </p>
      </header>

      {error && (
        <div style={bannerError} role="alert">
          {error}
        </div>
      )}

      {rows === null && <p style={{ color: "var(--muted)" }}>Loading stores…</p>}
      {rows?.length === 0 && !error && (
        <p style={{ color: "var(--muted)" }}>No active stores returned from the server.</p>
      )}

      {stored && (
        <section style={card}>
          <h2 style={h2}>Current outlet</h2>
          <p style={{ margin: 0 }}>
            <strong>{stored.storeName}</strong>{" "}
            <span style={{ color: "var(--muted)" }}>
              (id {stored.storeId}, code {stored.storeCode})
            </span>
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            Header value: <code>X-Store-Id: {getXStoreIdHeaderValue(stored)}</code>
            {savedAt ? <> · Saved {savedAt}</> : null}
          </p>
          <nav style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
            <Link to="/kds" style={primaryLink}>
              Open KDS
            </Link>
            <Link to="/tms" style={primaryLink}>
              Open TMS
            </Link>
          </nav>
        </section>
      )}

      {rows?.length ? (
        <section style={card}>
          <h2 style={h2}>Select outlet</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {rows.map((row) => (
              <li
                key={row.store_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "0.65rem 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{row.store_name}</div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    {row.store_code} · id {row.store_id}
                  </div>
                </div>
                <button type="button" style={btn} onClick={() => selectStore(row)}>
                  Use this store
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section style={card}>
        <h2 style={h2}>{stored ? "Update outlet" : "Add outlet"}</h2>
        <div style={fieldGrid}>
          <label style={field}>
            <span style={labelText}>Store ID</span>
            <input value={storeId} onChange={(e) => setStoreId(e.target.value)} style={input} placeholder="1" />
          </label>
          <label style={field}>
            <span style={labelText}>Store Code</span>
            <input
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              style={input}
              placeholder="STR001"
            />
          </label>
          <label style={field}>
            <span style={labelText}>Store Name</span>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              style={input}
              placeholder="Main Outlet"
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={saveStoreContext}>
            Save credentials
          </button>
          {stored && (
            <button
              type="button"
              style={{ ...btn, background: "transparent", borderColor: "var(--border)" }}
              onClick={() => {
                clearStoredStore();
                refreshStoreView();
              }}
            >
              Clear saved outlet
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

const shell: CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "1.5rem",
};

const header: CSSProperties = { marginBottom: "1.25rem" };

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1rem 1.25rem",
  marginTop: "1rem",
};

const h2: CSSProperties = { margin: "0 0 0.75rem", fontSize: "1.1rem" };

const btn: CSSProperties = {
  padding: "0.45rem 0.85rem",
  borderRadius: 8,
  border: "1px solid var(--border-primary)",
  background: "var(--secondary-gradient)",
  color: "var(--text-on-dark)",
  fontWeight: 600,
};

const primaryLink: CSSProperties = {
  display: "inline-block",
  padding: "0.5rem 1rem",
  borderRadius: 8,
  background: "var(--secondary-gradient)",
  color: "var(--text-on-dark)",
  textDecoration: "none",
  fontWeight: 600,
};

const bannerError: CSSProperties = {
  background: "rgba(234, 67, 53, 0.12)",
  border: "1px solid var(--warn)",
  color: "#f8d7da",
  padding: "0.75rem 1rem",
  borderRadius: 8,
  marginBottom: "1rem",
};

const fieldGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "0.75rem",
};

const field: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
};

const labelText: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text-secondary)",
  fontWeight: 600,
};

const input: CSSProperties = {
  borderRadius: 8,
  border: "1px solid var(--border-primary)",
  padding: "0.5rem 0.6rem",
  background: "var(--neutral-50)",
  color: "var(--text-primary)",
};
