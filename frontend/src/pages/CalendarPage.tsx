import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Booking, Drone, DroneType, DroneTypeStat } from "../types";
import {
  addMonths,
  dateInRange,
  isSameDay,
  monthGrid,
  monthLabel,
  toISO,
} from "../lib/date";
import { colorFor } from "../lib/color";
import BookingDetail from "../components/BookingDetail";
import DroneChart from "../components/DroneChart";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState<DroneTypeStat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [types, setTypes] = useState<DroneType[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterCode, setFilterCode] = useState("");

  const grid = useMemo(() => monthGrid(month), [month]);

  useEffect(() => {
    api.listDroneTypes().then(setTypes).catch(() => {});
    api.listDrones().then(setDrones).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rangeStart = toISO(grid[0]);
      const rangeEnd = toISO(grid[grid.length - 1]);
      const [b, s] = await Promise.all([
        api.listBookings({ start: rangeStart, end: rangeEnd }),
        api.stats(),
      ]);
      setBookings(b);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Reset the code filter if it no longer belongs to the chosen type.
  useEffect(() => {
    if (
      filterType &&
      filterCode &&
      !drones.some((d) => d.code === filterCode && d.drone_type === filterType)
    ) {
      setFilterCode("");
    }
  }, [filterType, filterCode, drones]);

  const codeOptions = useMemo(
    () => drones.filter((d) => !filterType || d.drone_type === filterType),
    [drones, filterType],
  );

  const filtered = useMemo(
    () =>
      bookings.filter((b) => {
        if (filterType && !b.drones.some((d) => d.drone_type === filterType)) return false;
        if (filterCode && !b.drones.some((d) => d.code === filterCode)) return false;
        return true;
      }),
    [bookings, filterType, filterCode],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const day of grid) {
      const iso = toISO(day);
      map.set(
        iso,
        filtered.filter((b) => dateInRange(iso, b.start_date, b.end_date)),
      );
    }
    return map;
  }, [grid, filtered]);

  const selectedBookings = selected ? byDay.get(selected) ?? [] : [];
  const today = new Date();
  const filtering = Boolean(filterType || filterCode);

  return (
    <div className="calendar-layout">
      <section className="calendar-panel">
        <div className="calendar-header">
          <div>
            <h1 className="calendar-title">{monthLabel(month)}</h1>
            <p className="calendar-subtitle">
              {filtered.length} booking{filtered.length === 1 ? "" : "s"}
              {filtering ? " (filtered)" : ""} in view
              {loading && " · loading…"}
            </p>
          </div>
          <div className="calendar-controls">
            <button className="btn btn--ghost" onClick={() => setMonth(addMonths(month, -1))}>
              ‹
            </button>
            <button className="btn btn--ghost" onClick={() => setMonth(new Date())}>
              Today
            </button>
            <button className="btn btn--ghost" onClick={() => setMonth(addMonths(month, 1))}>
              ›
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <label className="filter">
            <span>Drone type</span>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Unique code</span>
            <select value={filterCode} onChange={(e) => setFilterCode(e.target.value)}>
              <option value="">All codes</option>
              {codeOptions.map((d) => (
                <option key={d.id} value={d.code}>
                  {d.code}
                </option>
              ))}
            </select>
          </label>
          {filtering && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setFilterType("");
                setFilterCode("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        <div className="weekday-row">
          {WEEKDAYS.map((w) => (
            <div key={w} className="weekday">
              {w}
            </div>
          ))}
        </div>

        <div className="grid">
          {grid.map((day) => {
            const iso = toISO(day);
            const items = byDay.get(iso) ?? [];
            const inMonth = day.getMonth() === month.getMonth();
            const classes = [
              "cell",
              inMonth ? "" : "cell--muted",
              isSameDay(day, today) ? "cell--today" : "",
              selected === iso ? "cell--selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button key={iso} className={classes} onClick={() => setSelected(iso)}>
                <span className="cell-date">{day.getDate()}</span>
                <div className="cell-chips">
                  {items.slice(0, 3).map((b) => (
                    <span
                      key={b.id}
                      className="chip"
                      style={{ background: colorFor(b.project_name) }}
                      title={`${b.project_name} — ${b.total_drones} drone(s): ${b.drones
                        .map((d) => d.code)
                        .join(", ")}`}
                    >
                      {b.project_name}
                    </span>
                  ))}
                  {items.length > 3 && (
                    <span className="chip chip--more">+{items.length - 3} more</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="chart-card">
          <h2 className="chart-title">Drones booked by type</h2>
          <DroneChart data={stats} />
        </div>
      </section>

      <BookingDetail date={selected} bookings={selectedBookings} onDeleted={() => load()} />
    </div>
  );
}
