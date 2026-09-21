import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Availability, BookedDrone, BookingInput, DailyProgress, Pilot } from "../types";
import { toISO } from "../lib/date";
import { colorFor, progressColor } from "../lib/color";

const emptyForm = (): BookingInput => ({
  project_name: "",
  start_date: toISO(new Date()),
  end_date: toISO(new Date()),
  vendor_name: "",
  description: "",
  total_area_ha: 0,
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
  const [hasDrones, setHasDrones] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pickType, setPickType] = useState("");
  const [pickDroneId, setPickDroneId] = useState("");

  // Edit-mode: the booking's saved drones + their daily area logs.
  const [bookedDrones, setBookedDrones] = useState<BookedDrone[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyProgress[]>([]);
  const [dpDrone, setDpDrone] = useState("");
  const [dpDate, setDpDate] = useState(() => toISO(new Date()));
  const [dpArea, setDpArea] = useState<number>(0);

  // Edit-mode: pilots to assign per drone (project-scoped).
  const [allPilots, setAllPilots] = useState<Pilot[]>([]);
  const [addPilotSel, setAddPilotSel] = useState<Record<number, string>>({});

  useEffect(() => {
    api.listDrones().then((d) => setHasDrones(d.length > 0)).catch(() => {});
  }, []);

  useEffect(() => {
    if (id) api.listPilots().then(setAllPilots).catch(() => {});
  }, [id]);

  async function loadDaily(bookingId: string) {
    try {
      setDailyEntries(await api.listDailyProgress(bookingId));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!id) return;
    api
      .getBooking(id)
      .then((b) => {
        setForm({
          project_name: b.project_name,
          start_date: b.start_date,
          end_date: b.end_date,
          vendor_name: b.vendor_name,
          description: b.description,
          total_area_ha: b.total_area_ha,
          pic: b.pic,
          drone_ids: b.drones.map((d) => d.id),
        });
        setBookedDrones(b.drones);
        if (b.drones[0]) setDpDrone(String(b.drones[0].id));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    loadDaily(id);
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
  const availById = useMemo(() => {
    const m = new Map<number, Availability>();
    for (const a of avail) m.set(a.id, a);
    return m;
  }, [avail]);
  const typeOptions = useMemo(() => {
    const s = new Set(avail.map((a) => a.drone_type));
    return [...s].sort();
  }, [avail]);
  const pickUnits = useMemo(
    () => avail.filter((a) => a.drone_type === pickType),
    [avail, pickType],
  );
  useEffect(() => {
    if (!pickType && typeOptions.length > 0) setPickType(typeOptions[0]);
  }, [typeOptions, pickType]);

  // Live progress from the daily logs.
  const areaDone = useMemo(
    () => dailyEntries.reduce((s, e) => s + (Number(e.area_ha) || 0), 0),
    [dailyEntries],
  );
  const progressPct = useMemo(() => {
    if (!form.total_area_ha || form.total_area_ha <= 0) return 0;
    return Math.min(100, Math.round((areaDone / form.total_area_ha) * 100));
  }, [areaDone, form.total_area_ha]);

  function set<K extends keyof BookingInput>(key: K, value: BookingInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function toggle(droneId: number) {
    setForm((f) => ({
      ...f,
      drone_ids: f.drone_ids.includes(droneId)
        ? f.drone_ids.filter((x) => x !== droneId)
        : [...f.drone_ids, droneId],
    }));
  }
  function addPicked() {
    const idNum = Number(pickDroneId);
    if (!idNum || selected.has(idNum)) return;
    setForm((f) => ({ ...f, drone_ids: [...f.drone_ids, idNum] }));
    setPickDroneId("");
  }

  async function saveDaily(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const drone_id = Number(dpDrone);
    if (!drone_id) {
      setError("Pick a drone to log progress for.");
      return;
    }
    setError(null);
    try {
      await api.saveDailyProgress(id, {
        drone_id,
        entry_date: dpDate,
        area_ha: Math.max(0, dpArea),
      });
      setDpArea(0);
      await loadDaily(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save progress");
    }
  }

  async function removeDaily(entryId: number) {
    try {
      await api.deleteDailyProgress(entryId);
      if (id) await loadDaily(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function reloadBookedDrones() {
    if (!id) return;
    try {
      const b = await api.getBooking(id);
      setBookedDrones(b.drones);
    } catch {
      /* ignore */
    }
  }

  async function assignPilot(droneId: number) {
    if (!id) return;
    const pilotId = Number(addPilotSel[droneId]);
    if (!pilotId) return;
    setError(null);
    try {
      await api.assignDronePilot(id, droneId, pilotId);
      setAddPilotSel((s) => ({ ...s, [droneId]: "" }));
      await reloadBookedDrones();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign pilot");
    }
  }

  async function removePilot(assignmentId: number) {
    try {
      await api.unassignDronePilot(assignmentId);
      await reloadBookedDrones();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not remove pilot");
    }
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
      {!hasDrones && (
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
            <span className="field-label">Total area to cover (HA)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.total_area_ha}
              onChange={(e) => set("total_area_ha", Math.max(0, Number(e.target.value) || 0))}
              placeholder="e.g. 50"
            />
          </label>

          {/* Pick specific drones: choose a type, then a drone */}
          <div className="field field--full">
            <div className="lines-header">
              <span className="field-label">
                Drones — {form.drone_ids.length} selected
                {isEdit && <span className="muted-note"> · add one to boost progress</span>}
              </span>
            </div>

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
                <button type="button" className="btn btn--ghost" onClick={addPicked} disabled={!pickDroneId}>
                  Add
                </button>
              </div>
            )}

            {form.drone_ids.length > 0 && (
              <div className="drone-tags selected-drones">
                {form.drone_ids.map((did) => {
                  const a = availById.get(did) ?? bookedDrones.find((b) => b.id === did);
                  return (
                    <span
                      key={did}
                      className="drone-tag mono"
                      style={{ borderColor: colorFor(a?.drone_type ?? "") }}
                      title={a?.drone_type ?? ""}
                    >
                      {a?.code ?? `#${did}`}
                      <button type="button" className="tag-x" onClick={() => toggle(did)} aria-label="Remove">
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
              rows={3}
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

      {/* Daily progress — only for saved bookings with assigned drones */}
      {isEdit && bookedDrones.length > 0 && (
        <div className="form">
          <div className="lines-header">
            <h2 className="section-title">Daily progress</h2>
            <span className="muted-note">
              {areaDone.toFixed(1)} / {form.total_area_ha.toFixed(1)} HA
            </span>
          </div>
          <div className="progress" style={{ marginBottom: 14 }}>
            <div
              className="progress-fill"
              style={{ width: `${progressPct}%`, background: progressColor(progressPct) }}
            />
            <span className="progress-label">{progressPct}%</span>
          </div>

          <form className="daily-add" onSubmit={saveDaily}>
            <select value={dpDrone} onChange={(e) => setDpDrone(e.target.value)} aria-label="Drone">
              {bookedDrones.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </select>
            <input type="date" value={dpDate} onChange={(e) => setDpDate(e.target.value)} aria-label="Date" />
            <input
              type="number"
              min={0}
              step={0.1}
              value={dpArea}
              onChange={(e) => setDpArea(Math.max(0, Number(e.target.value) || 0))}
              placeholder="Area (HA)"
              aria-label="Area in hectares"
            />
            <button type="submit" className="btn btn--primary">
              Log
            </button>
          </form>

          {dailyEntries.length === 0 ? (
            <p className="detail-empty">No progress logged yet.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Drone</th>
                    <th>Area (HA)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dailyEntries.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{e.entry_date}</td>
                      <td className="mono">{e.code}</td>
                      <td>{e.area_ha.toFixed(1)}</td>
                      <td className="nowrap">
                        <button className="btn btn--danger btn--sm" onClick={() => removeDaily(e.id)}>
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
      )}

      {/* Pilots per drone (project-scoped, multiple allowed) */}
      {isEdit && bookedDrones.length > 0 && (
        <div className="form">
          <h2 className="section-title">Pilots per drone</h2>
          <p className="muted-note">
            Assign one or more pilots to each drone for this project.
          </p>
          {allPilots.length === 0 && (
            <p className="detail-empty">
              No pilots yet — add some on the <Link to="/pilots">Pilots page</Link>.
            </p>
          )}
          <div className="pilot-assign-list">
            {bookedDrones.map((d) => (
              <div className="pilot-assign-row" key={d.id}>
                <div className="pilot-assign-drone mono">{d.code}</div>
                <div className="pilot-chips">
                  {d.pilots.length === 0 && <span className="muted-note">no pilots</span>}
                  {d.pilots.map((p) => (
                    <span className="drone-tag" key={p.id}>
                      {p.name}
                      <button
                        type="button"
                        className="tag-x"
                        onClick={() => removePilot(p.id)}
                        aria-label="Remove pilot"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="pilot-add">
                  <select
                    value={addPilotSel[d.id] ?? ""}
                    onChange={(e) =>
                      setAddPilotSel((s) => ({ ...s, [d.id]: e.target.value }))
                    }
                    aria-label="Add pilot"
                  >
                    <option value="">Add pilot…</option>
                    {allPilots
                      .filter((pl) => !d.pilots.some((ap) => ap.pilot_id === pl.id))
                      .map((pl) => (
                        <option key={pl.id} value={pl.id}>
                          {pl.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => assignPilot(d.id)}
                    disabled={!addPilotSel[d.id]}
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
