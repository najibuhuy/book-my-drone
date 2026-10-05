# Book My Drone — Architecture

| | |
| --- | --- |
| **Status** | Implemented (v0.1) |
| **Last updated** | 2026-09-30 |
| **Related docs** | [PRD.md](PRD.md) · [../README.md](../README.md) |

---

## 1. Overview

Book My Drone is a three-tier web application:

- **Frontend** — a React single-page app (SPA) served by Vite, run with Bun.
- **Backend** — a Rust HTTP/JSON API built on Axum, talking to Postgres via sqlx.
- **Database** — PostgreSQL, the single source of truth and the place where
  business invariants (stock, referential integrity) are enforced.

Business rules that must never be violated (no overbooking, no orphaned
references) live as close to the data as possible — in transactions, row locks,
check constraints, and foreign keys — rather than only in application code.

## 2. System diagram

```mermaid
flowchart LR
  subgraph Client
    B["Browser (SPA)"]
  end
  subgraph Dev["Frontend host (Bun + Vite)"]
    V["Vite dev server :5173<br/>(proxies /api → :8080)"]
  end
  subgraph Backend["Rust service"]
    A["Axum API :8080<br/>handlers · validation · tx"]
  end
  subgraph Data
    P[("PostgreSQL :5433<br/>bookings · booking_drone_units · drones · drone_types<br/>drone_daily_progress · pilots · booking_drone_pilots")]
  end

  B -->|HTTP/JSON| V
  V -->|/api proxy| A
  A -->|sqlx pool| P
```

In development the browser talks to Vite (`:5173`), which proxies `/api/*` to the
Axum service (`:8080`); this avoids CORS during development. In production the SPA
would be served as static files and call the API directly (the API already sends
permissive CORS headers).

## 3. Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend framework | React 18 + TypeScript | SPA |
| Build / dev server | Vite 5, run with Bun | `/api` proxy in dev |
| Routing | react-router-dom 6 | `createBrowserRouter` |
| Charts | recharts | drones-per-type bar chart |
| API framework | Axum 0.8 (Rust) | `tokio` async runtime |
| DB access | sqlx 0.8 (runtime queries) | no compile-time DB needed |
| Migrations | `sqlx::migrate!` | embedded, run on startup |
| Types | chrono, uuid, serde | dates, ids, (de)serialization |
| Config | dotenvy + env vars | `DATABASE_URL`, `BIND_ADDR` |
| Logging | tracing + tower-http | structured request logs |
| Database | PostgreSQL 16 | via docker-compose |

Runtime (not compile-time-checked) sqlx queries are used deliberately so the
project builds without a live database — the tradeoff is that column/type
mismatches surface at request time rather than at `cargo build`.

## 4. Data model

```mermaid
erDiagram
  bookings ||--o{ booking_drone_units : "reserves (cascade delete)"
  drones   ||--o{ booking_drone_units : "reserved by (restrict delete)"
  drone_types ||--o{ drones : "categorizes (FK by name)"
  booking_drone_units ||--o{ drone_daily_progress : "logs per day (composite FK, cascade)"
  booking_drone_units ||--o{ booking_drone_pilots : "flown by (composite FK, cascade)"
  pilots ||--o{ booking_drone_pilots : "assigned to (restrict delete)"

  drone_types {
    serial      id PK
    text        name UK
    timestamptz created_at
  }
  drones {
    serial      id PK
    text        code UK
    text        drone_type FK "→ drone_types.name ON UPDATE CASCADE ON DELETE RESTRICT"
    text        status "CHECK Standby|Operational|Incomplete, default Standby"
    timestamptz created_at
  }
  bookings {
    uuid        id PK "gen_random_uuid()"
    text        project_name
    date        start_date
    date        end_date
    text        vendor_name
    text        description
    text        project_type "CHECK Bagworm|Foliar|Oryctes|Fertilizer|Forestry|Trial"
    double      area_to_cover_ha "base area (HA)"
    int         qty_rotation "CHECK >= 1, default 1 (Oryctes)"
    text        pic
    timestamptz created_at
    timestamptz updated_at
  }
  booking_drone_units {
    uuid    booking_id FK "→ bookings.id ON DELETE CASCADE"
    int     drone_id   FK "→ drones.id ON DELETE RESTRICT"
  }
  drone_daily_progress {
    serial  id PK
    uuid    booking_id FK "composite (booking_id, drone_id) → booking_drone_units ON DELETE CASCADE"
    int     drone_id   FK "part of composite FK"
    date    entry_date
    double  area_ha "hectares completed that day"
  }
  pilots {
    serial  id PK
    text    name UK
  }
  booking_drone_pilots {
    serial  id PK
    uuid    booking_id FK "composite (booking_id, drone_id) → booking_drone_units ON DELETE CASCADE"
    int     drone_id   FK "part of composite FK"
    int     pilot_id   FK "→ pilots.id ON DELETE RESTRICT"
  }
```

### Design decisions

- **Each drone is an individual unit** (`drones`) with a `UNIQUE` code, belonging
  to a type. How many of a type the company owns is derived (count of `drones`),
  not stored.
- **A booking reserves specific units** via `booking_drone_units` (PK
  `(booking_id, drone_id)`), so a booking's `total_drones` is the number of rows.
- **`drones.drone_type` references `drone_types.name`** (a `UNIQUE` column) with
  `ON UPDATE CASCADE` (renaming a type follows its drones) and `ON DELETE
  RESTRICT` (a type with drones can't be deleted). Bookings reference drones by
  stable `id`, so renames never touch reservations.
- **`ON DELETE CASCADE` on `booking_id`** — deleting a booking frees its units.
  **`ON DELETE RESTRICT` on `drone_id`** — a reserved drone can't be deleted.
- **Check constraints** (valid date range, `drones.status` and
  `bookings.project_type` in their allowed sets, `bookings.qty_rotation >= 1`)
  and uniqueness (`drone.code`, `drone_type.name`, `pilots.name`, and
  `booking_drone_pilots(booking_id, drone_id, pilot_id)`) enforce invariants
  regardless of the caller.
- **Project type and rotation.** Each booking has a `project_type` (`CHECK` in
  Bagworm / Foliar / Oryctes / Fertilizer / Forestry / Trial, default Foliar) and
  a `qty_rotation` (`CHECK >= 1`, default 1). Rotation is only meaningful for
  **Oryctes** projects; it is 1 for every other type.
- **Total area and progress are derived, not stored/entered.** The stored base
  area is `area_to_cover_ha`; the **total area to cover** is derived as
  `total_area_ha = area_to_cover_ha × qty_rotation` (returned in the booking
  JSON, not a column). A booking's `progress` % is computed as
  `round(area_done_ha / total_area_ha * 100)` (clamped 0..100), where
  `area_done_ha` is the sum of that booking's `drone_daily_progress` rows. Each
  assigned drone logs hectares completed per day, upserted on
  `(booking_id, drone_id, entry_date)`. `drone_daily_progress` uses a **composite
  FK** `(booking_id, drone_id) → booking_drone_units` so a daily log can only
  exist for a drone actually reserved by that booking, and cascades when the unit
  is freed.
- **Editing a booking diffs its drone set** rather than replacing it wholesale:
  `update_booking` deletes only removed units and inserts added ones
  (`ON CONFLICT DO NOTHING`). Kept units — and their logged daily progress —
  survive edits, so "boosting" a booking (adding another drone via the edit form)
  never discards existing logs.
- **Pilots are assigned per drone within a booking (project).**
  `booking_drone_pilots` records which pilot(s) flew a drone on a given
  booking — **multiple pilots per drone per project are allowed**. A composite
  FK `(booking_id, drone_id) → booking_drone_units` means a pilot can only be
  assigned to a drone actually reserved by that booking (assign the drone to the
  booking first), and the assignment cascades away when the unit is freed. A
  `UNIQUE(booking_id, drone_id, pilot_id)` stops the same pilot being added to
  the same drone twice in one booking. A drone's pilot **history is derived** from
  the bookings it flew (each booking supplies the dates), not a standalone date
  range. A pilot with assignments can't be deleted (`ON DELETE RESTRICT`).

### Migrations

Applied in order at startup by `sqlx::migrate!`:

| File | Purpose |
| --- | --- |
| `0001_init.sql` | `drone_types`, `bookings`; seed default types |
| `0002_multi_drone_types.sql` | count-based `booking_drones`; migrate single-type → lines |
| `0003_drone_stock.sql` | add `total_quantity` to `drone_types`; seed stock |
| `0004_drone_type_fk.sql` | FK `booking_drones.drone_type → drone_types.name` |
| `0005_drone_units.sql` | `drones` (unique code) + `booking_drone_units`; migrate counts → specific units (overlap-aware, fails loudly if infeasible); drop `booking_drones` and `total_quantity` |
| `0006_area_progress_pilots.sql` | bookings.total_area_ha (+drop progress); drones.status; drone_daily_progress; pilots + drone_pilot_assignments |
| `0007_project_pilots.sql` | replace standalone drone_pilot_assignments with project-scoped booking_drone_pilots (multi-pilot per drone per booking) |
| `0008_project_type_rotation.sql` | rename bookings.total_area_ha → area_to_cover_ha; add qty_rotation (CHECK ≥ 1, default 1) and project_type (CHECK in the six types, default Foliar) |
| `0009_daily_pilot_fail.sql` | drone_daily_progress gains `pilot_id` (→ pilots, RESTRICT; must be a pilot assigned to that drone on the booking, checked by the API) and `fail_reason` (CHECK Cuaca / Drone Issue / Crash / Genset Issue / Access Issue / Estate Issue); back-fills pilot_id where a drone had exactly one pilot |

## 5. API reference

Base path `/api`. All bodies are JSON.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/bookings?start=&end=` | List bookings overlapping the window (both optional) |
| POST | `/bookings` | Create a booking (reserves specific units) |
| GET | `/bookings/{id}` | Fetch one booking (incl. `project_type`, `area_to_cover_ha`, `qty_rotation`, derived `total_area_ha`, `area_done_ha`, derived `progress`, `drones[]` with `status`, `area_done_ha`, and assigned `pilots[]`) |
| PUT | `/bookings/{id}` | Update a booking (diffs its reserved units — kept units keep their daily logs; can add a drone to "boost") |
| DELETE | `/bookings/{id}` | Delete a booking (frees its units) |
| GET | `/bookings/{id}/daily-progress` | List a booking's per-drone daily progress rows |
| POST | `/bookings/{id}/daily-progress` | Upsert a daily log `{drone_id, entry_date, area_ha, pilot_id?, fail_reason?}` (ON CONFLICT); 409 if the pilot isn't assigned to that drone on the booking |
| DELETE | `/daily-progress/{id}` | Delete a daily-progress row |
| GET | `/drone-types` | List types with `total_units` + `booked_today` |
| POST | `/drone-types` | Create a type (`name`); 409 on duplicate |
| PUT | `/drone-types/{id}` | Rename a type (cascades to its drones) |
| DELETE | `/drone-types/{id}` | Delete a type; 409 if it still has drones |
| GET | `/drones` | List all drones (`id`, `code`, `drone_type`, `status`) |
| POST | `/drones` | Register a drone (`code`, `drone_type`, `status`); 409 on duplicate code |
| PUT | `/drones/{id}` | Update a drone's code / type / status |
| DELETE | `/drones/{id}` | Delete a drone; 409 if reserved by a booking |
| GET | `/pilots` | List pilots (`id`, `name`) |
| POST | `/pilots` | Create a pilot (`name`); 409 on duplicate |
| DELETE | `/pilots/{id}` | Delete a pilot; 409 if still assigned to a drone |
| POST | `/bookings/{id}/drone-pilots` | Assign a pilot to a drone in this booking `{drone_id, pilot_id}`; 409 on duplicate or if the drone isn't in the booking |
| DELETE | `/booking-drone-pilots/{id}` | Unassign a pilot (by assignment id) |
| GET | `/drones/{id}/pilot-history` | The drone's pilots across projects `[{id, booking_id, project_name, pilot_id, pilot_name, start_date, end_date}]` (dates from each booking) |
| GET | `/summary?start=&end=` | `{entries, projects}`: every daily log in the range (with drone, project, pilot, fail reason) plus projects active in the range with `total_area_ha`, `area_before_ha`, `area_in_range_ha` — the Summary page groups these by drone / project / pilot |
| GET | `/availability?start=&end=&exclude=` | Per-unit availability for a window |
| GET | `/stats` | Drones booked per type (dashboard chart) |

### Representative payload

```json
// POST /api/bookings — reserve specific drone units by id
{
  "project_name": "Harbour Mapping",
  "start_date": "2026-09-22",
  "end_date": "2026-09-28",
  "vendor_name": "AeroWorks",
  "description": "Multi-fleet survey",
  "project_type": "Oryctes",
  "area_to_cover_ha": 40.25,
  "qty_rotation": 3,
  "pic": "Rina",
  "drone_ids": [24, 25, 11]
}
```

`qty_rotation` defaults to 1 if omitted; an unknown `project_type` or a
`qty_rotation < 1` returns `400`. `total_area_ha` is **not** sent — the response
includes it derived as `area_to_cover_ha × qty_rotation`.

Responses return the reserved units, a computed total, the target/covered area,
and the **derived** progress. `progress` is not sent in the body — it is computed
from the daily logs (`round(area_done_ha / total_area_ha * 100)`, clamped 0..100).
Each entry in `drones[]` carries its `status` and `area_done_ha`:

```json
{ "id": "…", "project_name": "Harbour Mapping", "…": "…",
  "project_type": "Oryctes", "area_to_cover_ha": 40.25, "qty_rotation": 3,
  "total_area_ha": 120.75, "area_done_ha": 30.0, "progress": 25,
  "drones": [ { "id": 24, "code": "DJI Mavic 3-004", "drone_type": "DJI Mavic 3",
               "status": "Operational", "area_done_ha": 12.0 } ],
  "total_drones": 3 }
```

### Error model

Errors return `{"error": "message"}` with a status code:

| Status | Meaning | Example |
| --- | --- | --- |
| 400 Bad Request | Validation failure | `end_date must be on or after start_date` |
| 404 Not Found | Missing resource | `booking not found` |
| 409 Conflict | Well-formed but not allowed by current state | `Already booked for 2026-09-22 to 2026-09-24: DJI Mavic 3-001` |
| 500 | Unexpected server/database error | (generic message; details logged) |

## 6. Key flow — creating a booking that reserves specific units

```mermaid
sequenceDiagram
  autonumber
  participant F as Booking form (SPA)
  participant A as Axum API
  participant D as PostgreSQL

  F->>A: GET /availability?start&end (live hint)
  A-->>F: each unit + available flag
  F->>A: POST /bookings {dates, drone_ids[]}
  A->>A: validate() (dates, progress, ≥1 unit)
  A->>D: BEGIN
  A->>D: INSERT bookings ... RETURNING id
  A->>D: SELECT id FROM drones WHERE id = ANY(ids) ORDER BY id FOR UPDATE
  A->>A: verify all ids exist
  A->>D: SELECT codes of ids already in an OVERLAPPING booking (excl. self)
  alt any clash
    A->>D: ROLLBACK
    A-->>F: 409 Conflict "Already booked: <codes>"
  end
  A->>D: INSERT booking_drone_units (one row per id)
  A->>D: COMMIT
  A-->>F: 201 Created (booking + reserved units)
```

The client-side availability lookup is only a **hint**; the server's in-
transaction check is authoritative. If the hint fails to load, the form still
submits and the server enforces correctness.

## 7. Concurrency & data integrity

The core invariant — *a drone is never reserved by two overlapping bookings* — is
protected on three levels:

1. **Transaction** — the booking row and its unit assignments are written
   atomically; any clash rolls everything back, so no partial booking persists.
2. **Row lock** — `reserve_units()` runs `SELECT id FROM drones WHERE id =
   ANY($1) ORDER BY id FOR UPDATE`, locking the requested drone rows *before* the
   clash check. Two concurrent transactions reserving the same unit serialize on
   that lock: the second blocks until the first commits, then its clash query
   sees the first's now-committed reservation and returns `409`. Locking in id
   order avoids deadlocks.
3. **Foreign keys** — `drones.drone_type → drone_types.name`
   (`ON UPDATE CASCADE` / `ON DELETE RESTRICT`) keeps the catalog consistent, and
   `booking_drone_units.drone_id → drones.id` (`ON DELETE RESTRICT`) prevents
   deleting a reserved drone. Bookings reference drones by stable `id`, so a type
   rename never disturbs reservations.

A unit is available for a window `[s, e]` (excluding an optional booking `b`) when
it appears in **no** overlapping booking:

```
available(drone) = NOT EXISTS (
    booking_drone_units of `drone`
    joined to bookings that overlap [s, e]  (start ≤ e AND end ≥ s)
    and are not booking `b`
)
```

`exclude=b` lets the edit flow avoid counting a booking against itself.

## 8. Frontend structure

Single-page app with a shared shell (`App.tsx` + nav: Home / Book / Stock / Pilots):

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | `CalendarPage` | Home — month calendar with type/code filters, day detail panel (with project type badge), a **"Drones on this day"** summary (available vs in use, with codes; ignores the calendar filters), drones-per-type chart |
| `/book` | `BookPage` | Project summary table of all bookings — incl. a project **Type** badge and a client-side **Est. finish** column (rate = area done ÷ days elapsed; ETA vs scheduled end: on track / behind / Complete / "by *end date*" if not started); create/edit/delete |
| `/book/new`, `/book/:id` | `NewBookingPage` | Create / edit form; **Project type** dropdown, "Area to cover (HA)" field, a **Qty rotation** field shown only for Oryctes, and a read-only derived "Total area to cover (HA)" (area × rotation); areas/daily HA accept 2 decimals; picks specific units with live availability; in edit mode a per-drone **daily progress** section (date + HA logging with a derived progress bar), a per-drone **pilot assignment** control (add-pilot dropdown + removable pilot chips, multiple pilots per drone), and can add a drone to "boost" |
| `/stock` | `StockPage` | Drone-type catalog + individual drone (code) management, each with a Status dropdown (Standby/Operational/Incomplete) |
| `/pilots` | `PilotsPage` | Manage pilot names (add/delete) and view a per-drone pilot history (pick a drone → which pilots flew it on which projects, with dates). Pilots are assigned to drones inside a booking's edit form. |

Supporting modules:

- `api.ts` — typed fetch client (one function per endpoint).
- `types.ts` — TypeScript mirrors of the API shapes.
- `lib/date.ts` — timezone-safe `YYYY-MM-DD` date math for the calendar.
- `lib/color.ts` — deterministic color per label; progress color scale.
- `components/` — `BookingDetail`, `DroneChart`, `ProgressBar`.

## 9. Backend structure

```
backend/src/
  main.rs       # server bootstrap, router, CORS, migrations, pool
  config.rs     # env → Config (DATABASE_URL, BIND_ADDR)
  error.rs      # AppError → HTTP status + JSON body
  models.rs     # data models, input DTOs, validation, grouping helpers
  handlers.rs   # request handlers + stock check + SQL
```

- `AppState { pool: PgPool }` is shared across handlers.
- `AppError` maps domain errors to status codes (`Validation→400`,
  `NotFound→404`, `Conflict→409`, DB errors→500 with logging).
- `reserve_units()` is the transactional, lock-based guard used by both create
  and update: it locks the requested drone rows `FOR UPDATE`, rejects any unit
  already in an overlapping booking, then inserts the assignments.

## 10. Configuration & running

Environment (see `backend/.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://drone:drone@localhost:5433/bookmydrone` | Postgres connection |
| `BIND_ADDR` | `0.0.0.0:8080` | API bind address |
| `RUST_LOG` | `book_my_drone_backend=debug,tower_http=info,info` | Log filter |
| `VITE_API_TARGET` | `http://localhost:8080` | Frontend proxy target (dev) |

Run locally:

```bash
docker compose up -d                 # PostgreSQL on host port 5433
cd backend  && cargo run             # API on :8080 (applies migrations)
cd frontend && bun install && bun run dev   # SPA on :5173
```

> Host port **5433** is used for Postgres to avoid clashing with any other
> Postgres already bound to 5432 on the machine.

## 11. Security & operational notes (current state)

- **No authentication** — intended for a trusted internal network (see PRD
  non-goals). Add auth before any public exposure.
- **Permissive CORS** (`Any` origin) — convenient for local dev; tighten for
  production.
- **SQL injection** — all queries use bound parameters; no string interpolation
  of user input into SQL.
- **Input validation** — enforced both in the API (`validate()`) and the
  database (check constraints, foreign keys).
- **Migrations run on startup** — deploys must apply schema changes before
  serving; a failed migration prevents the server from starting.

## 12. Scaling & future direction

- Move hot-path queries to compile-time-checked sqlx (`query!`) once a CI
  database is available, to catch schema drift at build time.
- Add indexes as data grows (there are already a `(start_date, end_date)` index
  on `bookings`, `idx_drones_type`, and `idx_bdu_drone`).
- Introduce pagination on the bookings list.
- A GiST exclusion constraint (`btree_gist`) on `booking_drone_units` could push
  the no-overlap invariant fully into the schema, complementing the current
  transactional lock.
- Package the frontend as static assets served behind the API (or a CDN) for
  production, removing the Vite proxy.
