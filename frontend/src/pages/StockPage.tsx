import { useEffect, useState } from "react";
import { api } from "../api";
import type { DroneType } from "../types";
import { colorFor } from "../lib/color";

export default function StockPage() {
  const [types, setTypes] = useState<DroneType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // New-type form
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);

  // Per-row edited quantities (id -> value)
  const [edits, setEdits] = useState<Record<number, number>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTypes(await api.listDroneTypes());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Enter a drone type name first.");
      return;
    }
    try {
      await api.createDroneType(name.trim(), Math.max(0, qty));
      setName("");
      setQty(1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add drone type");
    }
  }

  async function saveQty(t: DroneType) {
    const next = edits[t.id];
    if (next === undefined || next === t.total_quantity) return;
    setError(null);
    try {
      await api.updateDroneType(t.id, t.name, Math.max(0, next));
      setEdits((e) => {
        const { [t.id]: _, ...rest } = e;
        return rest;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update stock");
    }
  }

  async function remove(t: DroneType) {
    if (!confirm(`Delete drone type "${t.name}"?`)) return;
    setError(null);
    try {
      await api.deleteDroneType(t.id);
      setTypes((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <div className="stock-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Drone stock</h1>
          <p className="page-subtitle">
            How many of each drone type you own. Bookings can't exceed what's
            free for their dates.
          </p>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <form className="stock-add" onSubmit={addType}>
        <input
          type="text"
          placeholder="New drone type (e.g. DJI Mavic 3)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="number"
          min={0}
          max={1000}
          value={qty}
          onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))}
          aria-label="Quantity"
          title="How many you own"
        />
        <button type="submit" className="btn btn--primary">
          Add type
        </button>
      </form>

      {loading ? (
        <p className="detail-empty">Loading…</p>
      ) : types.length === 0 ? (
        <div className="empty-card">No drone types yet. Add one above.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Drone type</th>
                <th>Total owned</th>
                <th>In use today</th>
                <th>Free today</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const editing = edits[t.id];
                const value = editing ?? t.total_quantity;
                const freeToday = t.total_quantity - t.booked_today;
                return (
                  <tr key={t.id}>
                    <td>
                      <span
                        className="type-dot"
                        style={{ background: colorFor(t.name) }}
                      />
                      {t.name}
                    </td>
                    <td>
                      <div className="qty-edit">
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          value={value}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [t.id]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                        />
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={editing === undefined || editing === t.total_quantity}
                          onClick={() => saveQty(t)}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                    <td>{t.booked_today}</td>
                    <td>
                      <span
                        className={freeToday <= 0 ? "pill pill--danger" : "pill pill--ok"}
                      >
                        {freeToday}
                      </span>
                    </td>
                    <td className="nowrap">
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => remove(t)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
