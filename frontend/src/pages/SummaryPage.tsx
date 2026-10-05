import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Summary, SummaryEntry } from "../types";
import { addDays, toISO } from "../lib/date";
import { colorFor } from "../lib/color";

type Tab = "drone" | "project" | "pilot";

const NO_PILOT = "(no pilot recorded)";

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function pct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/** "2× Cuaca, 1× Crash" from a reason → count map. */
function failText(fails: Map<string, number>): string {
  return [...fails.entries()].map(([r, n]) => `${n}× ${r}`).join(", ");
}

function addFail(fails: Map<string, number>, e: SummaryEntry) {
  if (e.fail_reason) fails.set(e.fail_reason, (fails.get(e.fail_reason) ?? 0) + 1);
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="muted-note">—</span>;
  return (
    <div className="drone-tags">
      {items.map((t) => (
        <span key={t} className="drone-tag">
          {t}
        </span>
      ))}
    </div>
  );
}

export default function SummaryPage() {
  const today = new Date();
  const [start, setStart] = useState(() => toISO(firstOfMonth(today)));
  const [end, setEnd] = useState(() => toISO(today));
  const [tab, setTab] = useState<Tab>("drone");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (end < start) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .summary(start, end)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  function preset(days: number | "month") {
    const now = new Date();
    setEnd(toISO(now));
    setStart(toISO(days === "month" ? firstOfMonth(now) : addDays(now, -(days - 1))));
  }

  const entries = data?.entries ?? [];

  const totals = useMemo(() => {
    const ha = entries.reduce((s, e) => s + e.area_ha, 0);
    const fails = entries.filter((e) => e.fail_reason).length;
    return { ha, logs: entries.length, fails };
  }, [entries]);

  // 1. Per drone: total HA, which projects, which pilots, flying days, fails.
  const byDrone = useMemo(() => {
    const m = new Map<
      number,
      {
        code: string;
        type: string;
        ha: number;
        flyDays: Set<string>;
        projects: Set<string>;
        pilots: Set<string>;
        fails: Map<string, number>;
      }
    >();
    for (const e of entries) {
      let r = m.get(e.drone_id);
      if (!r) {
        r = {
          code: e.drone_code,
          type: e.drone_type,
          ha: 0,
          flyDays: new Set(),
          projects: new Set(),
          pilots: new Set(),
          fails: new Map(),
        };
        m.set(e.drone_id, r);
      }
      r.ha += e.area_ha;
      if (e.area_ha > 0) r.flyDays.add(e.entry_date);
      r.projects.add(e.project_name);
      if (e.pilot_name) r.pilots.add(e.pilot_name);
      addFail(r.fails, e);
    }
    return [...m.values()].sort((a, b) => b.ha - a.ha);
  }, [entries]);

  // 2. Per project: progress at start → end of range, pilots, drones, fails.
  const byProject = useMemo(() => {
    const extra = new Map<
      string,
      { pilots: Set<string>; drones: Set<string>; fails: Map<string, number> }
    >();
    for (const e of entries) {
      let r = extra.get(e.booking_id);
      if (!r) {
        r = { pilots: new Set(), drones: new Set(), fails: new Map() };
        extra.set(e.booking_id, r);
      }
      if (e.pilot_name) r.pilots.add(e.pilot_name);
      r.drones.add(e.drone_code);
      addFail(r.fails, e);
    }
    return (data?.projects ?? [])
      .map((p) => {
        const startPct = pct(p.area_before_ha, p.total_area_ha);
        const endPct = pct(p.area_before_ha + p.area_in_range_ha, p.total_area_ha);
        const x = extra.get(p.booking_id);
        return {
          ...p,
          startPct,
          endPct,
          delta: endPct - startPct,
          pilots: x ? [...x.pilots] : [],
          drones: x ? [...x.drones] : [],
          fails: x?.fails ?? new Map<string, number>(),
        };
      })
      .sort((a, b) => b.area_in_range_ha - a.area_in_range_ha);
  }, [data, entries]);

  // 3. Per pilot: HA flown, drones used, projects, logs, fails.
  const byPilot = useMemo(() => {
    const m = new Map<
      string,
      {
        name: string;
        ha: number;
        logs: number;
        drones: Set<string>;
        projects: Set<string>;
        fails: Map<string, number>;
      }
    >();
    for (const e of entries) {
      const key = e.pilot_id ? String(e.pilot_id) : "none";
      let r = m.get(key);
      if (!r) {
        r = {
          name: e.pilot_name ?? NO_PILOT,
          ha: 0,
          logs: 0,
          drones: new Set(),
          projects: new Set(),
          fails: new Map(),
        };
        m.set(key, r);
      }
      r.ha += e.area_ha;
      r.logs += 1;
      r.drones.add(e.drone_code);
      r.projects.add(e.project_name);
      addFail(r.fails, e);
    }
    return [...m.values()].sort((a, b) => b.ha - a.ha);
  }, [entries]);

  return (
    <div className="summary-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Summary</h1>
          <p className="page-subtitle">
            Performance by drone, project, and pilot for a date range — based on
            the daily progress logs.
          </p>
        </div>
      </div>

      <div className="range-bar">
        <label className="filter">
          <span>From</span>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="filter">
          <span>To</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <div className="range-presets">
          <button className="btn btn--ghost btn--sm" onClick={() => preset(7)}>
            Last 7 days
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => preset(30)}>
            Last 30 days
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => preset("month")}>
            This month
          </button>
        </div>
        {loading && <span className="muted-note">loading…</span>}
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div className="kpi-row">
        <div className="kpi">
          <span className="kpi-num">{totals.ha.toFixed(2)}</span>
          <span className="kpi-label">HA completed</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{totals.logs}</span>
          <span className="kpi-label">daily logs</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{byProject.length}</span>
          <span className="kpi-label">active projects</span>
        </div>
        <div className="kpi kpi--warn">
          <span className="kpi-num">{totals.fails}</span>
          <span className="kpi-label">fail logs</span>
        </div>
      </div>

      <div className="tabs">
        {(["drone", "project", "pilot"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "tab tab--on" : "tab"}
            onClick={() => setTab(t)}
          >
            {t === "drone" ? "By drone" : t === "project" ? "By project" : "By pilot"}
          </button>
        ))}
      </div>

      {tab === "drone" &&
        (byDrone.length === 0 ? (
          <div className="empty-card">No daily logs in this range.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Drone</th>
                  <th>HA done</th>
                  <th>Flying days</th>
                  <th>Projects</th>
                  <th>Pilots</th>
                  <th>Fails</th>
                </tr>
              </thead>
              <tbody>
                {byDrone.map((d) => (
                  <tr key={d.code}>
                    <td>
                      <span className="type-dot" style={{ background: colorFor(d.type) }} />
                      <span className="mono">{d.code}</span>
                      <div className="muted-note">{d.type}</div>
                    </td>
                    <td className="num">{d.ha.toFixed(2)}</td>
                    <td className="num">{d.flyDays.size}</td>
                    <td>
                      <Chips items={[...d.projects]} />
                    </td>
                    <td>
                      <Chips items={[...d.pilots]} />
                    </td>
                    <td>
                      {d.fails.size ? (
                        <span className="fail-badge">{failText(d.fails)}</span>
                      ) : (
                        <span className="muted-note">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "project" &&
        (byProject.length === 0 ? (
          <div className="empty-card">No projects active in this range.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Progress in range</th>
                  <th>HA in range</th>
                  <th>Pilots on duty</th>
                  <th>Drones used</th>
                  <th>Fails</th>
                </tr>
              </thead>
              <tbody>
                {byProject.map((p) => (
                  <tr key={p.booking_id}>
                    <td>
                      <Link to={`/book/${p.booking_id}`}>{p.project_name}</Link>
                      <div>
                        <span className="type-badge">{p.project_type}</span>
                      </div>
                    </td>
                    <td className="nowrap">
                      {p.startPct}% → <b>{p.endPct}%</b>{" "}
                      <span className={p.delta > 0 ? "delta delta--up" : "delta"}>
                        {p.delta > 0 ? `+${p.delta}` : p.delta} pts
                      </span>
                    </td>
                    <td className="num">
                      {p.area_in_range_ha.toFixed(2)}
                      <div className="muted-note">of {p.total_area_ha.toFixed(2)} total</div>
                    </td>
                    <td>
                      <Chips items={p.pilots} />
                    </td>
                    <td>
                      <Chips items={p.drones} />
                    </td>
                    <td>
                      {p.fails.size ? (
                        <span className="fail-badge">{failText(p.fails)}</span>
                      ) : (
                        <span className="muted-note">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "pilot" &&
        (byPilot.length === 0 ? (
          <div className="empty-card">No daily logs in this range.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pilot</th>
                  <th>HA flown</th>
                  <th>Logs</th>
                  <th>Drones used</th>
                  <th>Projects</th>
                  <th>Fails</th>
                </tr>
              </thead>
              <tbody>
                {byPilot.map((p) => (
                  <tr key={p.name}>
                    <td className={p.name === NO_PILOT ? "muted-note" : ""}>{p.name}</td>
                    <td className="num">{p.ha.toFixed(2)}</td>
                    <td className="num">{p.logs}</td>
                    <td>
                      <Chips items={[...p.drones]} />
                    </td>
                    <td>
                      <Chips items={[...p.projects]} />
                    </td>
                    <td>
                      {p.fails.size ? (
                        <span className="fail-badge">{failText(p.fails)}</span>
                      ) : (
                        <span className="muted-note">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
