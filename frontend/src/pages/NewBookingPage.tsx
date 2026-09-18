import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Availability, BookingInput } from "../types";
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
  drone_ids: [],
});

export default function NewBookingPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<BookingInput>(emptyForm);
  const [avail, setAvail] = useState<Availability[]>([]);
  const [availError, setAvailError] = useState(false);
  const [hasTypes, setHasTypes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cascading picker: choose a type, then a specific drone.
  const [pickType, setPickType] = useState("");
  const [pickDroneId, setPickDroneId] = useState("");

  useEffect(() => {
    api.listDrones().then((d) => setHasTypes(d.length > 0)).catch(() => {});
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
          drone_ids: b.drones.map((d) => d.id),
        }),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [id]);

  // Per-unit availability for the chosen window (excludes this booking on edit).
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
        if (!cancelled) setAvailError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [form.start_date, form.end_date, id]);

  const selected = useMemo(() => new Set(form.drone_ids), [form.drone_ids]);

  // Resolve a selected drone id -> its code/type for the chips.
  const availById = useMemo(() => {
    const m = new Map<number, Availability>();
    for (const a of avail) m.set(a.id, a);
    return m;
  }, [avail]);

  // Distinct drone types (that have at least one unit).
  const typeOptions = useMemo(() => {
    const s = new Set(avail.map((a) => a.drone_type));
    return [...s].sort();
  }, [avail]);

  // Units of the currently-picked type.
  const pickUnits = useMemo(
    () => avail.filter((a) => a.drone_type === pickType),
    [avail, pickType],
  );

  // Default the type picker to the first type once availability loads.
  useEffect(() => {
    if (!pickType && typeOptions.length > 0) setPickType(typeOptions[0]);
  }, [typeOptions, pickType]);

  function set<K extends keyof BookingInput>(key: K, value: BookingInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggle(droneId: number) {
    setForm((f) => {
      const has = f.drone_ids.includes(droneId);
      return {
        ...f,
        drone_ids: has
          ? f.drone_ids.filter((x) => x !== droneId)
          : [...f.drone_ids, droneId],
      };
    });
  }

  function addPicked() {
    const idNum = Number(pickDroneId);
    if (!idNum || selected.has(idNum)) return;
    setForm((f) => ({ ...f, drone_ids: [...f.drone_ids, idNum] }));
    setPickDroneId("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.end_date < form.start_date) {
      setError("End date must be on or after start date.");
      return;
    }
    if (form.drone_ids.length === 0) {
      setError("Select at least one drone.");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && id) await api.updateBooking(id, form);
      else await api.createBooking(form);
      navigate("/book");
    } catch (err) {
      // Server-side unit conflicts (409) surface here too.
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
      {!hasTypes && (
        <div className="banner banner--warn">
          No drones registered yet. Add some on the{" "}
          <Link to="/stock">Stock page</Link> first.
        </div>
      )}
      {availError && (
        <div className="banner banner--warn">
          Couldn't load live availability — you can still save; the server
          enforces it and rejects double-booked drones.
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

          {/* Pick specific drones: choose a type, then a drone */}
          <div className="field field--full">
            <span className="field-label">
              Drones — {form.drone_ids.length} selected
              <span className="muted-note">
                {" "}· availability for {form.start_date} → {form.end_date}
              </span>
            </span>

            {typeOptions.length === 0 ? (
              <p className="detail-empty">No drones to choose from.</p>
            ) : (
              <div className="drone-picker">
                <select
                  className="picker-select"
                  value={pickType}
                  onChange={(e) => {
                    setPickType(e.target.value);
                    setPickDroneId("");
                  }}
                  aria-label="Drone type"
                >
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                <select
                  className="picker-select"
                  value={pickDroneId}
                  onChange={(e) => setPickDroneId(e.target.value)}
                  aria-label="Drone"
                >
                  <option value="">Select a drone…</option>
                  {pickUnits.map((u) => {
                    const added = selected.has(u.id);
                    const busy = !u.available;
                    return (
                      <option key={u.id} value={u.id} disabled={added || busy}>
                        {u.code}
                        {added ? " (added)" : busy ? " (booked)" : ""}
                      </option>
                    );
                  })}
                </select>

                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={addPicked}
                  disabled={!pickDroneId}
                >
                  Add
                </button>
              </div>
            )}

            {form.drone_ids.length > 0 && (
              <div className="drone-tags selected-drones">
                {form.drone_ids.map((did) => {
                  const a = availById.get(did);
                  return (
                    <span
                      key={did}
                      className="drone-tag mono"
                      style={{ borderColor: colorFor(a?.drone_type ?? "") }}
                      title={a?.drone_type ?? ""}
                    >
                      {a?.code ?? `#${did}`}
                      <button
                        type="button"
                        className="tag-x"
                        onClick={() => toggle(did)}
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
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
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Update booking" : "Create booking"}
          </button>
        </div>
      </form>
    </div>
  );
}
