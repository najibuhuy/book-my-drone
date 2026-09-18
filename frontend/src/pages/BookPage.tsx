import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Booking } from "../types";
import { colorFor } from "../lib/color";
import { prettyDate } from "../lib/date";
import ProgressBar from "../components/ProgressBar";

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
                <th>Dates</th>
                <th>Drones</th>
                <th>Total</th>
                <th>Vendor</th>
                <th>PIC</th>
                <th>Progress</th>
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
                    {prettyDate(b.start_date)} → {prettyDate(b.end_date)}
                  </td>
                  <td>
                    <div className="drone-tags">
                      {b.drones.map((d) => (
                        <span
                          key={d.id}
                          className="drone-tag mono"
                          style={{ borderColor: colorFor(d.drone_type) }}
                          title={d.drone_type}
                        >
                          {d.code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap">{b.total_drones}× 🚁</td>
                  <td>{b.vendor_name}</td>
                  <td>{b.pic}</td>
                  <td style={{ minWidth: 120 }}>
                    <ProgressBar value={b.progress} />
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
