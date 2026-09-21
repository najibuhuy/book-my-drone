import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Drone, DronePilotHistory, Pilot } from "../types";
import { colorFor } from "../lib/color";
import { prettyDate } from "../lib/date";

export default function PilotsPage() {
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newPilot, setNewPilot] = useState("");
  const [historyDrone, setHistoryDrone] = useState("");
  const [history, setHistory] = useState<DronePilotHistory[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, d] = await Promise.all([api.listPilots(), api.listDrones()]);
      setPilots(p);
      setDrones(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Load the selected drone's pilot history.
  useEffect(() => {
    if (!historyDrone) {
      setHistory([]);
      return;
    }
    api
      .dronePilotHistory(Number(historyDrone))
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [historyDrone]);

  async function addPilot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newPilot.trim()) {
      setError("Enter a pilot name first.");
      return;
    }
    try {
      await api.createPilot(newPilot.trim());
      setNewPilot("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add pilot");
    }
  }

  async function removePilot(p: Pilot) {
    if (!confirm(`Delete pilot "${p.name}"?`)) return;
    setError(null);
    try {
      await api.deletePilot(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete pilot");
    }
  }

  return (
    <div className="pilots-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Pilots</h1>
          <p className="page-subtitle">
            Manage pilot names here. Assign pilots to drones inside a booking (on
            the <Link to="/book">Book</Link> page's edit form) — each drone can
            have several pilots per project.
          </p>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div className="stock-grid">
        {/* Pilots list */}
        <section>
          <h2 className="section-title">Pilots ({pilots.length})</h2>
          <form className="stock-add" onSubmit={addPilot}>
            <input
              type="text"
              placeholder="New pilot name"
              value={newPilot}
              onChange={(e) => setNewPilot(e.target.value)}
              required
            />
            <button type="submit" className="btn btn--primary">
              Add pilot
            </button>
          </form>
          {loading ? (
            <p className="detail-empty">Loading…</p>
          ) : pilots.length === 0 ? (
            <div className="empty-card">No pilots yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pilots.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="nowrap">
                        <button className="btn btn--danger btn--sm" onClick={() => removePilot(p)}>
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

        {/* Per-drone pilot history */}
        <section>
          <h2 className="section-title">Drone pilot history</h2>
          <select
            className="picker-select"
            value={historyDrone}
            onChange={(e) => setHistoryDrone(e.target.value)}
            aria-label="Drone"
          >
            <option value="">Pick a drone…</option>
            {drones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} ({d.drone_type})
              </option>
            ))}
          </select>

          {!historyDrone ? (
            <p className="detail-empty">
              Pick a drone to see which pilots flew it, and on which projects.
            </p>
          ) : history.length === 0 ? (
            <div className="empty-card">No pilot history for this drone yet.</div>
          ) : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Pilot</th>
                    <th>Project</th>
                    <th>Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <span
                          className="type-dot"
                          style={{ background: colorFor(h.pilot_name) }}
                        />
                        {h.pilot_name}
                      </td>
                      <td>{h.project_name}</td>
                      <td className="nowrap">
                        {prettyDate(h.start_date)} → {prettyDate(h.end_date)}
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
