# Book My Drone — Product Requirements Document (PRD)

| | |
| --- | --- |
| **Product** | Book My Drone — drone booking dashboard |
| **Status** | Implemented (v0.1) |
| **Author** | Najib Alyasyfi (Najib.Alyasyfi@noovoleum.com) |
| **Last updated** | 2026-09-18 |
| **Related docs** | [ARCHITECTURE.md](ARCHITECTURE.md) · [../README.md](../README.md) |

---

## 1. Summary

Book My Drone is an internal web dashboard for scheduling drones the way a hotel
schedules rooms. A team maintains an inventory of individually-tracked drones
(each with a unique code, grouped by type), and staff create **bookings** that
reserve **specific drones** for a project over a date range. A calendar makes it
obvious what is booked when — filterable by drone type and by unique code — and
the system prevents the same drone from being double-booked on overlapping dates.

## 2. Background & problem

Drones are shared, limited assets. Without a single source of truth, teams
double-book equipment, lose track of which project holds which drones, and can't
see utilization at a glance. Spreadsheets don't enforce availability and don't
visualize a schedule.

We need a lightweight tool that:

- Shows a **calendar** of all drone bookings.
- Lets staff **create bookings** with full project context.
- Tracks **stock per drone type** and **blocks over-booking** for overlapping
  dates.

## 3. Goals & non-goals

### Goals

- G1 — A calendar view where any day reveals the drones booked that day,
  **filterable by drone type and by unique drone code**.
- G2 — A booking captures: project name, start/end date, vendor/booked-by,
  description, progress %, PIC (person in charge), and the **specific drones**
  reserved.
- G3 — Each drone is an individual unit with a **unique code**; a booking may
  reserve several specific drones (of one or more types).
- G4 — A drone cannot be reserved by two bookings whose dates overlap
  (**time-aware**, hotel-room model); the same drone frees up outside a booking.
- G5 — Everything is persisted in PostgreSQL and configurable.

### Non-goals (v0.1)

- Authentication / user accounts / roles (single trusted internal network).
- Per-drone maintenance tracking (flight hours, service history); drones carry a
  code and type only.
- Approvals / booking workflow states (draft, approved, etc.).
- Notifications, email, calendar sync (iCal/Google).
- Multi-tenant / multi-organization support.
- Payments or billing.

## 4. Users & personas

| Persona | Needs |
| --- | --- |
| **Booker** (project staff) | Reserve drones for a project window; see if stock is free before committing. |
| **PIC** (person in charge) | Be recorded as accountable for a project; track progress %. |
| **Fleet/stock manager** | Maintain the drone-type catalog and how many of each the company owns. |
| **Viewer** (anyone) | Glance at the calendar to see what's booked. |

## 5. Key concepts

- **Drone type** — a configurable category (e.g. "DJI Mavic 3"). Managed on the
  **Stock** page. How many the company owns is derived from its drones.
- **Drone (unit)** — an individual airframe with a **unique code** (e.g.
  "MAV-001") belonging to a type. Registered on the **Stock** page.
- **Booking** — a reservation for a project over `[start_date, end_date]` that
  reserves a set of **specific drones**. `total_drones` is how many it holds.
- **Availability (time-aware, per unit)** — a specific drone is free for a date
  window if it is not reserved by any OVERLAPPING booking. A drone booked outside
  a window is free inside it. This is the "hotel room" rule, per airframe.

## 6. Functional requirements

### 6.1 Home (Calendar) — G1

- FR-1 Month calendar grid (6×7), with previous / next / today controls.
- FR-2 Each day cell shows chips for bookings whose `[start,end]` covers that day
  (a multi-day booking appears on every day it spans).
- FR-3 Clicking a day opens a detail panel listing that day's bookings with:
  project, the reserved **drone codes** (color-coded by type), total drones,
  dates, vendor, PIC, description, and a progress bar. Each has Edit / Delete.
- FR-4 A dashboard chart shows drones booked per drone type.
- FR-5 **Filters**: the calendar can be filtered by **drone type** and by
  **unique drone code** (the code list narrows to the chosen type). Only bookings
  involving the selected type/code are shown.

### 6.2 Book (list + create/edit) — G2, G3

- FR-6 A table of all bookings: project, dates, the reserved drone codes, total,
  vendor, PIC, progress, and Edit / Delete actions.
- FR-7 "New booking" opens a form; the same form edits an existing booking.
- FR-8 The form captures: project name, vendor/booked-by, start date, end date,
  PIC, progress (0–100 slider), description, and a **selection of specific drone
  units**.
- FR-9 The unit picker groups available drones by type; each free unit is a
  checkbox showing its code. Units already booked for the chosen dates are shown
  disabled. On edit, the booking's own units are pre-selected.
- FR-10 If the availability lookup fails, the form still submits and relies on
  the server's authoritative check (never silently blocks).

### 6.3 Stock — G5

- FR-11 List drone types with: name, total owned (unit count), in-use today,
  free today.
- FR-12 Add and delete drone types (delete blocked while the type still has
  drones).
- FR-13 Register individual drones, each with a **unique code** and a type; list
  and delete them (delete blocked while a drone is reserved by a booking).

### 6.4 Booking enforcement — G4

- FR-14 On booking create/update, the server verifies every selected drone is
  free for the booking's dates, counting only **overlapping** bookings.
- FR-15 If any selected drone is taken, the whole operation is rejected
  atomically (`409 Conflict`) naming the clashing drone code(s). No partial
  booking is written.
- FR-16 The check is race-safe: concurrent bookings of the same drone cannot both
  succeed (the drone rows are locked `FOR UPDATE` within the transaction).

## 7. Business rules & validation

- BR-1 `end_date ≥ start_date`.
- BR-2 `progress` ∈ [0, 100].
- BR-3 A booking must reserve at least one drone.
- BR-4 `project_name`, `vendor_name`, and `pic` are required (non-empty).
- BR-5 Drone codes are unique; drone-type names are unique.
- BR-6 A drone must belong to a type that exists in the catalog.
- BR-7 A drone may be reserved by at most one booking per overlapping window.
- BR-8 Availability is inclusive-overlap: bookings overlap when
  `A.start ≤ B.end AND A.end ≥ B.start`.

## 8. Representative user stories

- US-1 *As a booker*, I open the calendar and filter by code "MAV-001" to see
  exactly when that specific drone is out and on which projects.
- US-2 *As a booker*, I create "Harbour Mapping" from Sep 22–28 and tick the
  specific free units (MAV-004, MAV-005, AUTEL-001); booked units are greyed out.
- US-3 *As a booker*, I try to reserve MAV-001 on dates it's already booked and
  I'm blocked with "Already booked: DJI Mavic 3-001."
- US-4 *As a booker*, I reserve MAV-001 for a later, non-overlapping window and it
  succeeds — the drone freed up.
- US-5 *As a stock manager*, I add type "DJI Agras T40" then register units
  AGRAS-001…005; they immediately become selectable in the booking form.
- US-6 *As a stock manager*, I try to delete a drone that's reserved (or a type
  that still has drones) and the system stops me.

## 9. Non-functional requirements

- NFR-1 **Consistency** — stock accounting must never overbook; enforced in the
  database via transactions, row locks, and foreign keys.
- NFR-2 **Portability** — runs locally with Docker (Postgres), `cargo run`
  (API), and Bun (frontend); no cloud dependency.
- NFR-3 **Configurability** — connection and bind address via environment
  variables; drone catalog and stock are data, not code.
- NFR-4 **Responsiveness** — API responses are simple JSON; the calendar loads
  only the visible window's bookings.
- NFR-5 **Observability** — structured request logging (tracing) on the backend.

## 10. Success metrics

- Zero overbooking incidents (bookings never exceed stock for their dates).
- Time-to-create a booking under ~30 seconds.
- Bookings and stock fully reflected in the calendar and Stock views without
  manual reconciliation.

## 11. Out of scope / future enhancements

- Authentication, roles, and audit trail.
- Booking approval workflow and status lifecycle.
- Drone maintenance records (flight hours, service history) beyond code + type.
- Conflict-aware suggestions ("next free unit"), and iCal/Google Calendar export.
- Pagination / search on the bookings list.
- Notifications and reminders.
- Code-splitting the frontend bundle; hardening CORS for public deployment.

## 12. Open questions

- Should deleting a drone type that only has **past** bookings be allowed
  (currently blocked if any booking references it)?
- Do we need soft-delete / cancellation instead of hard delete for bookings?
- Should progress drive any automation (e.g. auto-complete at 100%)?
