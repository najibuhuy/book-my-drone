# Book My Drone — Architecture

| | |
| --- | --- |
| **Status** | Implemented (v0.1) |
| **Last updated** | 2026-09-17 |
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
    P[("PostgreSQL :5433<br/>bookings · booking_drones · drone_types")]
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
  bookings ||--o{ booking_drones : "has lines (cascade delete)"
  drone_types ||--o{ booking_drones : "referenced by name (FK)"

  drone_types {
    serial      id PK
    text        name UK
    int         total_quantity "CHECK >= 0"
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
  booking_drones {
    serial id PK
    uuid   booking_id FK "→ bookings.id ON DELETE CASCADE"
    text   drone_type FK "→ drone_types.name ON UPDATE CASCADE ON DELETE RESTRICT"
    int    number_of_drones "CHECK >= 1"
  }
```

### Design decisions

- **A booking has many drone lines** (`booking_drones`), mirroring a hotel
  reservation that can hold several room types. `total_drones` is derived, not
  stored.
- **`booking_drones.drone_type` references `drone_types.name`** (a `UNIQUE`
  column) rather than an integer id, because all stock math joins by name and the
  calendar/detail views display the name. The foreign key carries:
  - `ON UPDATE CASCADE` — renaming a type updates every booking line
    automatically, keeping stock accounting consistent.
  - `ON DELETE RESTRICT` — a type still referenced by a booking cannot be
    deleted (the API turns the DB error into a friendly `409`).
- **`ON DELETE CASCADE` on `booking_id`** — deleting a booking removes its lines.
- **Check constraints** (`progress 0..100`, `number_of_drones ≥ 1`, valid date
  range, `total_quantity ≥ 0`) enforce invariants regardless of the caller.

### Migrations

Applied in order at startup by `sqlx::migrate!`:

| File | Purpose |
| --- | --- |
| `0001_init.sql` | `drone_types`, `bookings`; seed default types |
| `0002_multi_drone_types.sql` | `booking_drones`; migrate single-type → lines; drop old columns |
| `0003_drone_stock.sql` | add `total_quantity` to `drone_types`; seed stock |
| `0004_drone_type_fk.sql` | FK `booking_drones.drone_type → drone_types.name` (cascade/restrict) |

## 5. API reference

Base path `/api`. All bodies are JSON.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/bookings?start=&end=` | List bookings overlapping the window (both optional) |
| POST | `/bookings` | Create a booking (stock-checked) |
| GET | `/bookings/{id}` | Fetch one booking |
| PUT | `/bookings/{id}` | Update a booking (stock-checked, replaces lines) |
| DELETE | `/bookings/{id}` | Delete a booking (cascades its lines) |
| GET | `/drone-types` | List types with `total_quantity` + `booked_today` |
| POST | `/drone-types` | Create a type (`name`, `total_quantity`); 409 on duplicate |
| PUT | `/drone-types/{id}` | Update name / quantity (rename cascades) |
| DELETE | `/drone-types/{id}` | Delete a type; 409 if referenced by a booking |
| GET | `/availability?start=&end=&exclude=` | Per-type free count for a window |
| GET | `/stats` | Drones booked per type (dashboard chart) |

### Representative payload

```json
// POST /api/bookings
{
  "project_name": "Harbour Mapping",
  "start_date": "2026-09-22",
  "end_date": "2026-09-28",
  "vendor_name": "AeroWorks",
  "description": "Multi-fleet survey",
  "progress": 25,
  "pic": "Rina",
  "drones": [
    { "drone_type": "DJI Mavic 3", "number_of_drones": 2 },
    { "drone_type": "Autel EVO II", "number_of_drones": 3 }
  ]
}
```

Responses add a computed `total_drones` alongside the returned `drones[]`.

### Error model

Errors return `{"error": "message"}` with a status code:

| Status | Meaning | Example |
| --- | --- | --- |
| 400 Bad Request | Validation failure | `end_date must be on or after start_date` |
| 404 Not Found | Missing resource | `booking not found` |
| 409 Conflict | Well-formed but not allowed by current state | `Not enough "DJI Mavic 3" for 2026-09-22 to 2026-09-24: 2 available, 3 requested` |
| 500 | Unexpected server/database error | (generic message; details logged) |

## 6. Key flow — creating a booking with the stock check

```mermaid
sequenceDiagram
  autonumber
  participant F as Booking form (SPA)
  participant A as Axum API
  participant D as PostgreSQL

  F->>A: GET /availability?start&end (live hint)
  A-->>F: per-type free counts
  F->>A: POST /bookings {dates, drones[]}
  A->>A: validate() (dates, progress, lines)
  A->>D: BEGIN
  A->>D: INSERT bookings ... RETURNING id
  loop each requested drone type (sorted)
    A->>D: SELECT total_quantity ... WHERE name=? FOR UPDATE
    A->>D: SELECT SUM(number_of_drones) from overlapping bookings
    A->>A: available = total − booked
    alt available < requested
      A->>D: ROLLBACK
      A-->>F: 409 Conflict "Not enough X"
    end
  end
  A->>D: INSERT booking_drones (lines)
  A->>D: COMMIT
  A-->>F: 201 Created (booking + total_drones)
```

The client-side availability lookup is only a **hint**; the server's in-
transaction check is authoritative. If the hint fails to load, the form still
submits and the server enforces correctness.

## 7. Concurrency & data integrity

The core invariant — *never book more drones of a type than are free for the
requested dates* — is protected on three levels:

1. **Transaction** — the booking row and its lines are written atomically; a
   shortfall rolls everything back, so no partial booking persists.
2. **Row lock** — `SELECT total_quantity ... FOR UPDATE` locks the drone-type
   catalog row before counting overlaps. Two concurrent transactions booking the
   same type serialize on that lock, so they cannot both read "1 free" and each
   insert — the second waits, re-reads, and correctly sees the first's booking.
   Requested types are locked in a stable (sorted) order to avoid deadlocks.
3. **Foreign keys** — `booking_drones.drone_type → drone_types.name` with
   `ON UPDATE CASCADE` / `ON DELETE RESTRICT` guarantees stock math (which joins
   by name) can never desync via a rename or a delete.

Availability for a window `[s, e]` excluding an optional booking `b`:

```
available(type) = total_quantity(type)
                − Σ number_of_drones
                    for booking_drones of `type`
                    joined to bookings that overlap [s, e]  (start ≤ e AND end ≥ s)
                    and are not booking `b`
```

`exclude=b` lets the edit flow avoid counting a booking against itself.

## 8. Frontend structure

Single-page app with three routes under a shared shell (`App.tsx` + nav):

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | `CalendarPage` | Home — month calendar, day detail panel, drones-per-type chart |
| `/book` | `BookPage` | Table of all bookings; create/edit/delete |
| `/book/new`, `/book/:id` | `NewBookingPage` | Create / edit form with live availability |
| `/stock` | `StockPage` | Drone-type catalog + stock management |

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
- `check_stock()` is the transactional, lock-based availability guard used by
  both create and update.

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
- Add indexes as data grows (there is already a `(start_date, end_date)` index
  on `bookings` and a `booking_id` index on `booking_drones`).
- Introduce pagination on the bookings list.
- Per-airframe inventory if serial-level tracking becomes necessary (would
  replace the count-based `total_quantity` model).
- Package the frontend as static assets served behind the API (or a CDN) for
  production, removing the Vite proxy.
