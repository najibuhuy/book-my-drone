# 🚁 Book My Drone

A drone-booking dashboard where a drone is treated like a hotel room: you see a
calendar of what's booked and create bookings with all the project details.

> 📄 Design docs live in [`docs/`](docs/): [PRD](docs/PRD.md) ·
> [Architecture](docs/ARCHITECTURE.md).

Four pages:

- **Home** — a month calendar, **filterable by drone type and unique code**.
  Click any day to see the bookings on that date (project, vendor, PIC, dates,
  progress, and the reserved drone codes), plus a chart of drones booked per type.
  Selecting a day also shows a **"Drones on this day"** summary — how many drones
  are **available** vs **in use** that day, with their codes.
- **Book** — a project summary table (with **Type** and **Est. finish** columns)
  plus create / edit / delete. A booking has a **project type** (Bagworm, Foliar,
  Oryctes, Fertilizer, Forestry, Trial), reserves **specific drones** (picked by
  code), and records an **area to cover (HA)**; for **Oryctes** a **Qty rotation**
  applies, and the total area = area × rotation. The form shows **live
  availability** for the chosen dates and greys out units already taken. Progress
  is **not typed in** — in edit mode you log **per-drone daily hectares** (up to
  2 decimals), and the booking's progress is **derived** from those logs. You can
  also **add another drone** ("boost") without losing logged progress. The
  estimated finish uses the progress rate so far vs the scheduled end date.
- **Stock** — manage the drone-type catalog **and register individual drones,
  each with a unique code** (e.g. `MAV-001`), with an "in use / free today"
  snapshot per type. Each drone has a **Status** (Standby / Operational /
  Incomplete).
- **Pilots** — manage pilots, and assign **one or more pilots to each drone
  inside a booking** (project-scoped); each drone keeps a **pilot history across
  projects**.

**Time-aware, per-unit (hotel-room model).** Each drone is an individual unit
with a unique code. When a booking is created or updated, a database transaction
locks the selected drone rows (`FOR UPDATE`) and rejects any unit already
reserved by an **overlapping** booking — so the same drone frees up for
non-overlapping periods. On a clash the API returns `409 Conflict` (naming the
code) and the booking is not created.

## Stack

| Layer    | Tech                                                        |
| -------- | ---------------------------------------------------------- |
| Frontend | React 18 + TypeScript + Vite (run with Bun) + recharts     |
| Backend  | Rust + Axum + sqlx (runtime queries) + embedded migrations |
| Database | PostgreSQL 16                                               |

## Prerequisites

- [Docker](https://www.docker.com/) (for Postgres)
- [Rust](https://rustup.rs/) toolchain
- [Bun](https://bun.sh/)

## 1. Start Postgres

```bash
docker compose up -d
```

This runs Postgres on `localhost:5433` with db `bookmydrone` (user/pass `drone`/`drone`).

## 2. Run the backend

```bash
cd backend
cp .env.example .env          # adjust DATABASE_URL / BIND_ADDR if needed
cargo run
```

Migrations run automatically on startup. The API listens on
`http://localhost:8080`.

## 3. Run the frontend

```bash
cd frontend
bun install
bun run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend,
so no CORS setup is needed in development.

## Configuration

Everything is configured through environment variables (see `backend/.env.example`):

| Variable       | Default                                              | Purpose                    |
| -------------- | --------------------------------------------------- | -------------------------- |
| `DATABASE_URL` | `postgres://drone:drone@localhost:5433/bookmydrone` | Postgres connection string |
| `BIND_ADDR`    | `0.0.0.0:8080`                                       | Address the API binds to   |
| `RUST_LOG`     | `book_my_drone_backend=debug,tower_http=info,info`  | Log filter                 |

The frontend proxy target can be overridden with `VITE_API_TARGET`.

## API

| Method   | Path                   | Description                                  |
| -------- | ---------------------- | -------------------------------------------- |
| `GET`    | `/api/health`          | Health check                                 |
| `GET`    | `/api/bookings`        | List bookings (`?start=&end=` to filter)     |
| `POST`   | `/api/bookings`        | Create a booking                             |
| `GET`    | `/api/bookings/:id`    | Get one booking (incl. `project_type`, `area_to_cover_ha`, `qty_rotation`, derived `total_area_ha` and `progress`) |
| `PUT`    | `/api/bookings/:id`    | Update a booking (diffs its units; keeps daily logs; can "boost") |
| `DELETE` | `/api/bookings/:id`    | Delete a booking                             |
| `GET`    | `/api/bookings/:id/daily-progress` | List a booking's per-drone daily progress |
| `POST`   | `/api/bookings/:id/daily-progress` | Upsert a daily log (`drone_id`, `entry_date`, `area_ha`) |
| `DELETE` | `/api/daily-progress/:id` | Delete a daily-progress row               |
| `GET`    | `/api/drone-types`     | List types with `total_units` + today's usage |
| `POST`   | `/api/drone-types`     | Add a drone type (`name`)                    |
| `PUT`    | `/api/drone-types/:id` | Rename a drone type (cascades to its drones) |
| `DELETE` | `/api/drone-types/:id` | Remove a type (409 if it still has drones)   |
| `GET`    | `/api/drones`          | List individual drones (`id`, `code`, type, `status`) |
| `POST`   | `/api/drones`          | Register a drone (`code`, `drone_type`, `status`) |
| `PUT`    | `/api/drones/:id`      | Update a drone's code / type / status        |
| `DELETE` | `/api/drones/:id`      | Remove a drone (409 if reserved)             |
| `GET`    | `/api/pilots`          | List pilots                                  |
| `POST`   | `/api/pilots`          | Add a pilot (`name`)                         |
| `DELETE` | `/api/pilots/:id`      | Remove a pilot (409 if still assigned)       |
| `POST`   | `/api/bookings/:id/drone-pilots` | Assign a pilot to a drone in this booking (`drone_id`, `pilot_id`) |
| `DELETE` | `/api/booking-drone-pilots/:id` | Unassign a pilot (by assignment id)   |
| `GET`    | `/api/drones/:id/pilot-history` | A drone's pilots across projects (with dates) |
| `GET`    | `/api/availability`    | Per-unit availability for `?start=&end=&exclude=` |
| `GET`    | `/api/stats`           | Drones booked per type (dashboard chart)     |

### Booking payload

A booking reserves specific drone units by id (`drone_ids[]`):

```json
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

`qty_rotation` defaults to 1 (it only matters for Oryctes). The total area is
**derived** — `total_area_ha = area_to_cover_ha × qty_rotation` — and returned in
the response. Progress is **not** part of the payload either: it is derived from
the per-drone daily HA logs (`round(area_done_ha / total_area_ha * 100)`).
Responses return the reserved units in `drones[]` (each with its `status`,
`area_done_ha`, and `pilots`) plus `total_drones`, `area_done_ha`, and `progress`.

## Project layout

```
book-my-drone/
├── docker-compose.yml       # Postgres
├── backend/                 # Rust + Axum API
│   ├── migrations/          # SQL migrations (run on startup)
│   └── src/
│       ├── main.rs          # server + routes
│       ├── config.rs        # env config
│       ├── error.rs         # error → JSON mapping
│       ├── models.rs        # data models + validation
│       └── handlers.rs      # request handlers
└── frontend/                # React + Vite (Bun)
    └── src/
        ├── api.ts           # typed API client
        ├── pages/           # CalendarPage, BookPage, NewBookingPage, StockPage, PilotsPage
        ├── components/      # BookingDetail, DroneChart, ProgressBar
        └── lib/             # date + color helpers
```
