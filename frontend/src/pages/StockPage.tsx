import { useEffect, useState } from "react";
import { api } from "../api";
import type { Drone, DroneType } from "../types";
import { colorFor } from "../lib/color";

export default function StockPage() {
  const [types, setTypes] = useState<DroneType[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // New-type form
  const [typeName, setTypeName] = useState("");
  // New-drone form
  const [code, setCode] = useState("");
  const [droneType, setDroneType] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [t, d] = await Promise.all([api.listDroneTypes(), api.listDrones()]);
      setTypes(t);
      setDrones(d);
      if (!droneType && t.length > 0) setDroneType(t[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!typeName.trim()) {
      setError("Enter a drone type name first.");
      return;
    }
    try {
      await api.createDroneType(typeName.trim());
      setTypeName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add drone type");
    }
  }

  async function removeType(t: DroneType) {
    if (!confirm(`Delete drone type "${t.name}"?`)) return;
    setError(null);
    try {
      await api.deleteDroneType(t.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete type");
    }
  }

  async function addDrone(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Enter a drone code first.");
      return;
    }
    if (!droneType) {
      setError("Pick a drone type for the new drone.");
      return;
    }
    try {
      await api.createDrone(code.trim(), droneType);
      setCode("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add drone");
    }
  }

  async function removeDrone(d: Drone) {
    if (!confirm(`Delete drone "${d.code}"?`)) return;
    setError(null);
    try {
      await api.deleteDrone(d.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete drone");
    }
  }

  return (
    <div className="stock-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Drone stock</h1>
          <p className="page-subtitle">
            Register each drone with a unique code. Bookings reserve specific
            drones, so a drone can't be in two overlapping bookings.
          </p>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div className="stock-grid">
        {/* -------- Drone types -------- */}
        <section>
          <h2 className="section-title">Drone types</h2>
          <form className="stock-add" onSubmit={addType}>
            <input
              type="text"
              placeholder="New drone type (e.g. DJI Mavic 3)"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              required
            />
            <button type="submit" className="btn btn--primary">
              Add type
            </button>
          </form>

          {loading ? (
            <p className="detail-empty">Loading…</p>
          ) : types.length === 0 ? (
            <div className="empty-card">No drone types yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Owned</th>
                    <th>In use today</th>
                    <th>Free today</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => {
                    const freeToday = t.total_units - t.booked_today;
                    return (
                      <tr key={t.id}>
                        <td>
                          <span
                            className="type-dot"
                            style={{ background: colorFor(t.name) }}
                          />
                          {t.name}
                        </td>
                        <td>{t.total_units}</td>
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
                            onClick={() => removeType(t)}
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
        </section>

        {/* -------- Individual drones -------- */}
        <section>
          <h2 className="section-title">Drones ({drones.length})</h2>
          <form className="stock-add" onSubmit={addDrone}>
            <input
              type="text"
              placeholder="Unique code (e.g. MAV-001)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <select value={droneType} onChange={(e) => setDroneType(e.target.value)} required>
              <option value="" disabled>
                Type…
              </option>
              {types.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn--primary" disabled={types.length === 0}>
              Add drone
            </button>
          </form>

          {loading ? (
            <p className="detail-empty">Loading…</p>
          ) : drones.length === 0 ? (
            <div className="empty-card">
              No drones yet. Add a type, then register drones with codes.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {drones.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.code}</td>
                      <td>
                        <span
                          className="type-dot"
                          style={{ background: colorFor(d.drone_type) }}
                        />
                        {d.drone_type}
                      </td>
                      <td className="nowrap">
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => removeDrone(d)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
