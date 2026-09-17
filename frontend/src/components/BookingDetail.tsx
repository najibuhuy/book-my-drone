import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Booking } from "../types";
import { colorFor } from "../lib/color";
import { prettyDate } from "../lib/date";
import ProgressBar from "./ProgressBar";

interface Props {
  date: string | null;
  bookings: Booking[];
  onDeleted: (id: string) => void;
}

export default function BookingDetail({ date, bookings, onDeleted }: Props) {
  const navigate = useNavigate();

  async function handleDelete(b: Booking) {
    if (!confirm(`Delete booking "${b.project_name}"?`)) return;
    try {
      await api.deleteBooking(b.id);
      onDeleted(b.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete booking");
    }
  }

  return (
    <aside className="detail">
      <h2 className="detail-title">
        {date ? prettyDate(date) : "Select a day"}
      </h2>
      {!date && (
        <p className="detail-empty">
          Click any day in the calendar to see the drones booked for that date.
        </p>
      )}
      {date && bookings.length === 0 && (
        <p className="detail-empty">No drones booked on this day.</p>
      )}

      <div className="detail-list">
        {bookings.map((b) => (
          <article className="booking-card" key={b.id}>
            <div className="booking-card-head">
              <span
                className="type-dot"
                style={{ background: colorFor(b.project_name) }}
              />
              <div>
                <h3 className="booking-card-title">{b.project_name}</h3>
                <p className="booking-card-sub">
                  {b.drones.length} drone type{b.drones.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="drone-count" title="Total drones">
                {b.total_drones}× 🚁
              </span>
            </div>

            <div className="drone-tags">
              {b.drones.map((d, i) => (
                <span
                  key={i}
                  className="drone-tag"
                  style={{ borderColor: colorFor(d.drone_type) }}
                >
                  <b>{d.number_of_drones}×</b> {d.drone_type}
                </span>
              ))}
            </div>

            <dl className="booking-meta">
              <div>
                <dt>Dates</dt>
                <dd>
                  {prettyDate(b.start_date)} → {prettyDate(b.end_date)}
                </dd>
              </div>
              <div>
                <dt>Vendor</dt>
                <dd>{b.vendor_name}</dd>
              </div>
              <div>
                <dt>PIC</dt>
                <dd>{b.pic}</dd>
              </div>
            </dl>

            {b.description && <p className="booking-desc">{b.description}</p>}

            <ProgressBar value={b.progress} />

            <div className="booking-actions">
              <button
                className="btn btn--ghost"
                onClick={() => navigate(`/book/${b.id}`)}
              >
                Edit
              </button>
              <button className="btn btn--danger" onClick={() => handleDelete(b)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
