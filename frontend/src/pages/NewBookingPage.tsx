import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Availability, BookingInput, DroneLine, DroneType } from "../types";
import { toISO } from "../lib/date";
import { colorFor, progressColor } from "../lib/color";

const emptyForm = (): BookingInput => ({
  project_name: "",
  start_date: toISO(new Date()),
  end_date: toISO(new Date()),
  vendor_name: "",
  description: "",
  progress: 0,
  pic: "",
  drones: [{ drone_type: "", number_of_drones: 1 }],
});

export default function NewBookingPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<BookingInput>(emptyForm);
  const [droneTypes, setDroneTypes] = useState<DroneType[]>([]);
  const [avail, setAvail] = useState<Availability[]>([]);
  const [availError, setAvailError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listDroneTypes().then(setDroneTypes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .getBooking(id)
      .then((b) =>
        setForm({
          project_name: b.project_name,
          start_date: b.start_date,
          end_date: b.end_date,
          vendor_name: b.vendor_name,
          description: b.description,
          progress: b.progress,
          pic: b.pic,
          drones: b.drones.length
            ? b.drones
            : [{ drone_type: "", number_of_drones: 1 }],
        }),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [id]);

  // Live availability for the chosen window (excludes this booking when editing).
  useEffect(() => {
    if (form.end_date < form.start_date) return;
    let cancelled = false;
    api
      .availability(form.start_date, form.end_date, id)
      .then((a) => {
        if (!cancelled) {
          setAvail(a);
          setAvailError(false);
        }
      })
      .catch(() => {
        // Don't treat a failed lookup as "zero available" — that would silently
        // block the form. Fall back to letting the server enforce stock.
        if (!cancelled) setAvailError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [form.start_date, form.end_date, id]);

  // Default the first line's type once types load (create mode).
  useEffect(() => {
    if (!isEdit && droneTypes.length > 0) {
      setForm((f) => {
        if (f.drones[0]?.drone_type) return f;
        const drones = [...f.drones];
        drones[0] = { ...drones[0], drone_type: droneTypes[0].name };
        return { ...f, drones };
      });
    }
  }, [droneTypes, isEdit]);

  const availByType = useMemo(() => {
    const m = new Map<string, Availability>();
    for (const a of avail) m.set(a.drone_type, a);
    return m;
  }, [avail]);

  // Total requested per drone type across all lines in the form.
  const requestedByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of form.drones) {
      if (!d.drone_type) continue;
      m.set(d.drone_type, (m.get(d.drone_type) ?? 0) + (Number(d.number_of_drones) || 0));
    }
    return m;
  }, [form.drones]);

  // Types where the form requests more than is free for the window.
  const overbooked = useMemo(() => {
    const bad: { type: string; requested: number; available: number }[] = [];
    for (const [type, requested] of requestedByType) {
      const available = availByType.get(type)?.available ?? 0;
      if (requested > available) bad.push({ type, requested, available });
    }
    return bad;
  }, [requestedByType, availByType]);

  function set<K extends keyof BookingInput>(key: K, value: BookingInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateLine(index: number, patch: Partial<DroneLine>) {
    setForm((f) => ({
      ...f,
      drones: f.drones.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      drones: [
        ...f.drones,
        { drone_type: droneTypes[0]?.name ?? "", number_of_drones: 1 },
      ],
    }));
  }

  function removeLine(index: number) {
    setForm((f) => ({
      ...f,
      drones: f.drones.length > 1 ? f.drones.filter((_, i) => i !== index) : f.drones,
    }));
  }

  const totalDrones = useMemo(
    () => form.drones.reduce((sum, d) => sum + (Number(d.number_of_drones) || 0), 0),
    [form.drones],
  );
  const droneBars = useMemo(
    () => Array.from({ length: Math.min(totalDrones, 24) }),
    [totalDrones],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.end_date < form.start_date) {
      setError("End date must be on or after start date.");
      return;
    }
    if (form.drones.some((d) => !d.drone_type)) {
      setError("Every drone line needs a drone type selected.");
      return;
    }
    if (!availError && overbooked.length > 0) {
      const first = overbooked[0];
      setError(
        `Not enough "${first.type}" for these dates: ${first.available} free, ${first.requested} requested.`,
      );
      return;
    }
    setSaving(true);
    try {
      if (isEdit && id) {
        await api.updateBooking(id, form);
      } else {
        await api.createBooking(form);
      }
      navigate("/book");
    } catch (err) {
      // Server-side stock conflicts (409) surface here too.
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-page">
      <div className="form-head">
        <h1>{isEdit ? "Edit booking" : "New booking"}</h1>
        <button className="btn btn--ghost" onClick={() => navigate("/book")}>
          Cancel
        </button>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {droneTypes.length === 0 && (
        <div className="banner banner--warn">
          No drone types in stock yet. Add some on the{" "}
          <Link to="/stock">Stock page</Link> first.
        </div>
      )}
      {availError && (
        <div className="banner banner--warn">
          Couldn't load live availability — you can still save; the server
          enforces stock and rejects over-booking.
        </div>
      )}

      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Project name</span>
            <input
              type="text"
              value={form.project_name}
              onChange={(e) => set("project_name", e.target.value)}
              placeholder="e.g. Riverside Survey"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Vendor / booked by</span>
            <input
              type="text"
              value={form.vendor_name}
              onChange={(e) => set("vendor_name", e.target.value)}
              placeholder="Vendor or person who booked"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Start date</span>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">End date</span>
            <input
              type="date"
              value={form.end_date}
              min={form.start_date}
              onChange={(e) => set("end_date", e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">PIC (person in charge)</span>
            <input
              type="text"
              value={form.pic}
              onChange={(e) => set("pic", e.target.value)}
              placeholder="Who is charged with the project"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Progress — {form.progress}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={form.progress}
              onChange={(e) => set("progress", Number(e.target.value))}
            />
            <div className="progress">
              <div
                className="progress-fill"
                style={{
                  width: `${form.progress}%`,
                  background: progressColor(form.progress),
                }}
              />
              <span className="progress-label">{form.progress}%</span>
            </div>
          </label>

          {/* Drone lines — like room types on a hotel reservation */}
          <div className="field field--full">
            <div className="lines-header">
              <span className="field-label">
                Drones — {totalDrones} total across {form.drones.length} type
                {form.drones.length === 1 ? "" : "s"}
                <span className="muted-note">
                  {" "}· availability shown for {form.start_date} → {form.end_date}
                </span>
              </span>
              <button type="button" className="btn btn--ghost" onClick={addLine}>
                + Add drone type
              </button>
            </div>

            <div className="drone-lines">
              {form.drones.map((line, i) => {
                const a = line.drone_type ? availByType.get(line.drone_type) : undefined;
                const requested = line.drone_type
                  ? requestedByType.get(line.drone_type) ?? 0
                  : 0;
                const over = a !== undefined && requested > a.available;
                return (
                  <div className="drone-line-wrap" key={i}>
                    <div className="drone-line">
                      <select
                        value={line.drone_type}
                        onChange={(e) => updateLine(i, { drone_type: e.target.value })}
                        required
                      >
                        <option value="" disabled>
                          Select a drone type…
                        </option>
                        {droneTypes.map((t) => {
                          const av = availByType.get(t.name)?.available;
                          return (
                            <option key={t.id} value={t.name}>
                              {t.name}
                              {av !== undefined ? ` — ${av} free` : ""}
                            </option>
                          );
                        })}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={line.number_of_drones}
                        onChange={(e) =>
                          updateLine(i, {
                            number_of_drones: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        aria-label="Number of drones"
                        required
                      />
                      <button
                        type="button"
                        className="btn btn--danger line-remove"
                        onClick={() => removeLine(i)}
                        disabled={form.drones.length === 1}
                        title={form.drones.length === 1 ? "At least one type required" : "Remove"}
                      >
                        ✕
                      </button>
                    </div>
                    {line.drone_type && a && (
                      <div className={over ? "line-hint line-hint--bad" : "line-hint"}>
                        {over
                          ? `Only ${a.available} free of ${a.total_quantity} for these dates — you requested ${requested}.`
                          : `${a.available} of ${a.total_quantity} free for these dates.`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="drone-bars" aria-hidden>
              {droneBars.map((_, i) => (
                <span
                  key={i}
                  className="drone-bar"
                  style={{ background: colorFor(form.project_name || "drone") }}
                />
              ))}
              {totalDrones > 24 && (
                <span className="drone-bars-more">+{totalDrones - 24}</span>
              )}
            </div>
          </div>

          <label className="field field--full">
            <span className="field-label">Description</span>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What is this booking for?"
            />
          </label>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || (!availError && overbooked.length > 0)}
          >
            {saving ? "Saving…" : isEdit ? "Update booking" : "Create booking"}
          </button>
        </div>
      </form>
    </div>
  );
}
