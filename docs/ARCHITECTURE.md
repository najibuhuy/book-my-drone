# Book My Drone — Architecture

| | |
| --- | --- |
| **Status** | Implemented (v0.1) |
| **Last updated** | 2026-09-18 |
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
    P[("PostgreSQL :5433<br/>bookings · booking_drone_units · drones · drone_types")]
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

  drone_types {
    serial      id PK
    text        name UK
    timestamptz created_at
  }
  drones {
    serial      id PK
    text        code UK
    text        drone_type FK "→ drone_types.name ON UPDATE CASCADE ON DELETE RESTRICT"
    timestamptz created_at
  }
  bookings {
    uuid        id PK "gen_random_uuid()"
    text        project_name
    date        start_date
    date        end_date
    text        vendor_name
    text        description
    int         progress "CHECK 0..100"
    text        pic
    timestamptz created_at
    timestamptz updated_at
  }
  booking_drone_units {
    uuid    booking_id FK "→ bookings.id ON DELETE CASCADE"
    int     drone_id   FK "→ drones.id ON DELETE RESTRICT"
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
- **Check constraints** (`progress 0..100`, valid date range) and uniqueness
  (`drone.code`, `drone_type.name`) enforce invariants regardless of the caller.

### Migrations

Applied in order at startup by `sqlx::migrate!`:

| File | Purpose |
| --- | --- |
| `0001_init.sql` | `drone_types`, `bookings`; seed default types |
| `0002_multi_drone_types.sql` | count-based `booking_drones`; migrate single-type → lines |
| `0003_drone_stock.sql` | add `total_quantity` to `drone_types`; seed stock |
| `0004_drone_type_fk.sql` | FK `booking_drones.drone_type → drone_types.name` |
| `0005_drone_units.sql` | `drones` (unique code) + `booking_drone_units`; migrate counts → specific units (overlap-aware, fails loudly if infeasible); drop `booking_drones` and `total_quantity` |

## 5. API reference

Base path `/api`. All bodies are JSON.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/bookings?start=&end=` | List bookings overlapping the window (both optional) |
| POST | `/bookings` | Create a booking (reserves specific units) |
| GET | `/bookings/{id}` | Fetch one booking |
| PUT | `/bookings/{id}` | Update a booking (replaces its reserved units) |
| DELETE | `/bookings/{id}` | Delete a booking (frees its units) |
| GET | `/drone-types` | List types with `total_units` + `booked_today` |
| POST | `/drone-types` | Create a type (`name`); 409 on duplicate |
| PUT | `/drone-types/{id}` | Rename a type (cascades to its drones) |
| DELETE | `/drone-types/{id}` | Delete a type; 409 if it still has drones |
| GET | `/drones` | List all drones (`id`, `code`, `drone_type`) |
| POST | `/drones` | Register a drone (`code`, `drone_type`); 409 on duplicate code |
| PUT | `/drones/{id}` | Update a drone's code / type |
| DELETE | `/drones/{id}` | Delete a drone; 409 if reserved by a booking |
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
  "progress": 25,
  "pic": "Rina",
  "drone_ids": [24, 25, 11]
}
```

Responses return the reserved units and a computed total:

```json
{ "id": "…", "project_name": "Harbour Mapping", "…": "…",
  "drones": [ { "id": 24, "code": "DJI Mavic 3-004", "drone_type": "DJI Mavic 3" } ],
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

Single-page app with three routes under a shared shell (`App.tsx` + nav):

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | `CalendarPage` | Home — month calendar with type/code filters, day detail panel, drones-per-type chart |
| `/book` | `BookPage` | Table of all bookings; create/edit/delete |
| `/book/new`, `/book/:id` | `NewBookingPage` | Create / edit form; picks specific units with live availability |
| `/stock` | `StockPage` | Drone-type catalog + individual drone (code) management |

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
