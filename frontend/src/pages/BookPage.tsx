import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Booking } from "../types";
import { colorFor } from "../lib/color";
import { parseISO, prettyDate, toISO } from "../lib/date";
import ProgressBar from "../components/ProgressBar";

type Est = { label: string; tone: "ok" | "behind" | "done" | "none" };

/**
 * Estimate a project's finish date from its progress rate vs schedule:
 * rate = area done / days elapsed; ETA = today + remaining/rate. On track if
 * the ETA lands on or before the scheduled end date.
 */
function estimateFinish(b: Booking): Est {
  if (b.progress >= 100) return { label: "Complete", tone: "done" };
  const msDay = 86_400_000;
  const today = new Date();
  const start = parseISO(b.start_date);
  const end = parseISO(b.end_date);
  if (b.area_done_ha <= 0 || b.total_area_ha <= 0 || today < start) {
    return { label: `by ${prettyDate(b.end_date)}`, tone: "none" };
  }
  const elapsed = Math.max(1, Math.round((today.getTime() - start.getTime()) / msDay));
  const rate = b.area_done_ha / elapsed; // HA per day
  const remaining = b.total_area_ha - b.area_done_ha;
  const etaDays = Math.ceil(remaining / Math.max(rate, 1e-9));
  const eta = new Date(today.getTime() + etaDays * msDay);
  const onSchedule = eta.getTime() <= end.getTime();
  return { label: prettyDate(toISO(eta)), tone: onSchedule ? "ok" : "behind" };
}

export default function BookPage() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const b = await api.listBookings();
      setBookings(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(b: Booking) {
    if (!confirm(`Delete booking "${b.project_name}"?`)) return;
    try {
      await api.deleteBooking(b.id);
      setBookings((prev) => prev.filter((x) => x.id !== b.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="book-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">
            {loading ? "Loading…" : `${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => navigate("/book/new")}>
          + New booking
        </button>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {!loading && bookings.length === 0 && (
        <div className="empty-card">
          No bookings yet.{" "}
          <button className="link-btn" onClick={() => navigate("/book/new")}>
            Create the first one
          </button>
          .
        </div>
      )}

      {bookings.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Drones</th>
                <th>Total</th>
                <th>PIC</th>
                <th>Progress</th>
                <th>Est. finish</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span
                      className="type-dot"
                      style={{ background: colorFor(b.project_name) }}
                    />
                    {b.project_name}
                  </td>
                  <td className="nowrap">
                    <span className="type-badge">{b.project_type}</span>
                  </td>
                  <td className="nowrap">
                    {prettyDate(b.start_date)} → {prettyDate(b.end_date)}
                  </td>
                  <td>
                    <div className="drone-tags">
                      {b.drones.map((d) => (
                        <span
                          key={d.id}
                          className="drone-tag mono"
                          style={{ borderColor: colorFor(d.drone_type) }}
                          title={`${d.drone_type}${
                            d.pilots.length ? ` · ${d.pilots.map((p) => p.name).join(", ")}` : ""
                          }`}
                        >
                          {d.code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap" title={`${b.area_done_ha.toFixed(2)} / ${b.total_area_ha.toFixed(2)} HA`}>
                    {b.total_drones}× 🚁
                  </td>
                  <td>{b.pic}</td>
                  <td style={{ minWidth: 120 }}>
                    <ProgressBar value={b.progress} />
                  </td>
                  <td className="nowrap">
                    {(() => {
                      const e = estimateFinish(b);
                      return <span className={`est est--${e.tone}`}>{e.label}</span>;
                    })()}
                  </td>
                  <td className="nowrap">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/book/${b.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => handleDelete(b)}
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
    </div>
  );
}
