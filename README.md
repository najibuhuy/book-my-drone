# 🚁 Book My Drone

A drone-booking dashboard where a drone is treated like a hotel room: you see a
calendar of what's booked and create bookings with all the project details.

> 📄 Design docs live in [`docs/`](docs/): [PRD](docs/PRD.md) ·
> [Architecture](docs/ARCHITECTURE.md).

Three pages:

- **Home** — a month calendar. Click any day to see the bookings on that date
  (project, vendor, PIC, dates, progress, and the drone breakdown by type with a
  total count), plus a chart of drones booked per type.
- **Book** — a table of all bookings, with create / edit / delete. Like a hotel
  reservation, one booking can hold **several drone-type lines**, each with its
  own count (e.g. 2× "DJI Mavic 3" + 3× "Autel EVO II"). The form shows **live
  availability** for the chosen dates and blocks over-booking.
- **Stock** — manage the drone-type catalog and how many of each you own
  (`total_quantity`), with an "in use / free today" snapshot.

**Time-aware stock (hotel-room model).** Each drone type has a stock count. When
a booking is created or updated, a database transaction (with row locks) checks
that enough of each type is free during the booking's dates, counting only
**overlapping** bookings — so the same drone frees up for non-overlapping
periods. If stock is insufficient the API returns `409 Conflict` and the booking
is not created.

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

This runs Postgres on `localhost:5432` with db `bookmydrone` (user/pass `drone`/`drone`).

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
| `DATABASE_URL` | `postgres://drone:drone@localhost:5432/bookmydrone` | Postgres connection string |
| `BIND_ADDR`    | `0.0.0.0:8080`                                       | Address the API binds to   |
| `RUST_LOG`     | `book_my_drone_backend=debug,tower_http=info,info`  | Log filter                 |

The frontend proxy target can be overridden with `VITE_API_TARGET`.

## API

| Method   | Path                   | Description                                  |
| -------- | ---------------------- | -------------------------------------------- |
| `GET`    | `/api/health`          | Health check                                 |
| `GET`    | `/api/bookings`        | List bookings (`?start=&end=` to filter)     |
| `POST`   | `/api/bookings`        | Create a booking                             |
| `GET`    | `/api/bookings/:id`    | Get one booking                              |
| `PUT`    | `/api/bookings/:id`    | Update a booking                             |
| `DELETE` | `/api/bookings/:id`    | Delete a booking                             |
| `GET`    | `/api/drone-types`     | List drone types with stock + today's usage  |
| `POST`   | `/api/drone-types`     | Add a drone type (`name`, `total_quantity`)  |
| `PUT`    | `/api/drone-types/:id` | Update a drone type's name / stock           |
| `DELETE` | `/api/drone-types/:id` | Remove a drone type                          |
| `GET`    | `/api/availability`    | Per-type free count for `?start=&end=&exclude=` |
| `GET`    | `/api/stats`           | Drones booked per type (dashboard chart)     |

### Booking payload

A booking carries one or more drone-type lines (`drones[]`):

```json
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
        ├── pages/           # CalendarPage, NewBookingPage
        ├── components/      # BookingDetail, DroneChart, ProgressBar
        └── lib/             # date + color helpers
```
