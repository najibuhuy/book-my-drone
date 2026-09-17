# Book My Drone — Product Requirements Document (PRD)

| | |
| --- | --- |
| **Product** | Book My Drone — drone booking dashboard |
| **Status** | Implemented (v0.1) |
| **Author** | Najib Alyasyfi (Najib.Alyasyfi@noovoleum.com) |
| **Last updated** | 2026-09-17 |
| **Related docs** | [ARCHITECTURE.md](ARCHITECTURE.md) · [../README.md](../README.md) |

---

## 1. Summary

Book My Drone is an internal web dashboard for scheduling drones the way a hotel
schedules rooms. A team maintains an inventory of drones (by type), and staff
create **bookings** that reserve one or more drones for a project over a date
range. A calendar makes it obvious what is booked when, and the system prevents
double-booking beyond the physical stock available for the requested dates.

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

- G1 — A calendar view where any day reveals the drones booked that day.
- G2 — A booking captures: drone type(s) + counts, project name, start/end date,
  vendor/booked-by, description, progress %, and PIC (person in charge).
- G3 — One booking may reserve **several drone types**, each with its own count
  (hotel reservation with multiple room types).
- G4 — Stock is configurable per drone type; bookings cannot exceed what is free
  for their dates (**time-aware**, hotel-room model).
- G5 — Everything is persisted in PostgreSQL and configurable.

### Non-goals (v0.1)

- Authentication / user accounts / roles (single trusted internal network).
- Per-drone (serial-number) tracking; stock is a count per **type**, not
  individual airframes.
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

- **Drone type** — a configurable category (e.g. "DJI Mavic 3") with a
  `total_quantity` the company owns. Managed on the **Stock** page.
- **Booking** — a reservation for a project over `[start_date, end_date]`. Holds
  one or more **drone lines**.
- **Drone line** — a `(drone_type, number_of_drones)` pair inside a booking. A
  booking's `total_drones` is the sum of its lines.
- **Availability (time-aware)** — for a drone type and a date window, the number
  free = `total_quantity − drones of that type in OVERLAPPING bookings`. A drone
  booked outside a window is free inside it. This is the "hotel room" rule.

## 6. Functional requirements

### 6.1 Home (Calendar) — G1

- FR-1 Month calendar grid (6×7), with previous / next / today controls.
- FR-2 Each day cell shows chips for bookings whose `[start,end]` covers that day
  (a multi-day booking appears on every day it spans).
- FR-3 Clicking a day opens a detail panel listing that day's bookings with:
  project, drone-type breakdown (`N× type`), total drones, dates, vendor, PIC,
  description, and a progress bar. Each has Edit / Delete.
- FR-4 A dashboard chart shows total drones booked per drone type.

### 6.2 Book (list + create/edit) — G2, G3

- FR-5 A table of all bookings: project, dates, drone breakdown, total, vendor,
  PIC, progress, and Edit / Delete actions.
- FR-6 "New booking" opens a form; the same form edits an existing booking.
- FR-7 The form captures: project name, vendor/booked-by, start date, end date,
  PIC, progress (0–100 slider), description, and **one or more drone lines**
  (add/remove rows), each a drone-type dropdown + count.
- FR-8 The number of drones is visualized (a small bar-per-drone indicator).
- FR-9 The form shows **live availability** for the chosen dates: each drone type
  shows "N free", and the form warns and blocks submit when a line exceeds what's
  free. If the availability lookup fails, the form still submits and relies on
  the server's authoritative check (never silently blocks).

### 6.3 Stock — G4, G5

- FR-10 List drone types with: name, total owned, in-use today, free today.
- FR-11 Add a new drone type with a starting quantity.
- FR-12 Edit a drone type's quantity.
- FR-13 Delete a drone type **only if no booking references it** (otherwise the
  API returns a clear conflict).

### 6.4 Stock enforcement — G4

- FR-14 On booking create/update, the server verifies every requested drone type
  has enough free during the booking's dates, counting only **overlapping**
  bookings.
- FR-15 If any type is short, the whole operation is rejected atomically
  (`409 Conflict`) with a message naming the type, the available count, and the
  requested count. No partial booking is written.
- FR-16 The check is race-safe: concurrent bookings of the same type cannot both
  pass and overbook (row-level locking in a transaction).

## 7. Business rules & validation

- BR-1 `end_date ≥ start_date`.
- BR-2 `progress` ∈ [0, 100].
- BR-3 Each drone line has `number_of_drones ≥ 1`.
- BR-4 A booking must have at least one drone line.
- BR-5 `project_name`, `vendor_name`, and `pic` are required (non-empty).
- BR-6 A drone type's `total_quantity ≥ 0`; names are unique.
- BR-7 A booking may only reference drone types that exist in the catalog.
- BR-8 Availability is inclusive-overlap: bookings overlap when
  `A.start ≤ B.end AND A.end ≥ B.start`.

## 8. Representative user stories

- US-1 *As a booker*, I open the calendar, click Sep 22, and see every drone
  booked that day so I know what's in the field.
- US-2 *As a booker*, I create a booking for "Harbour Mapping" reserving 2× DJI
  Mavic 3 and 3× Autel EVO II from Sep 22–28; the form shows each type is free
  before I save.
- US-3 *As a booker*, I try to book 3 Mavic 3 for dates that already have 4 of 5
  reserved and I'm blocked with "2 available, 3 requested."
- US-4 *As a booker*, I book the same drones for a later, non-overlapping window
  and it succeeds — the drones freed up.
- US-5 *As a stock manager*, I add "DJI Agras T40" with quantity 5 on the Stock
  page, and it immediately becomes selectable in the booking form.
- US-6 *As a stock manager*, I try to delete a type still used by a booking and
  the system stops me.

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
- Per-airframe tracking (serial numbers, maintenance, flight hours).
- Conflict-aware suggestions ("next free slot"), and iCal/Google Calendar export.
- Pagination / search / filtering on the bookings list.
- Notifications and reminders.
- Code-splitting the frontend bundle; hardening CORS for public deployment.

## 12. Open questions

- Should deleting a drone type that only has **past** bookings be allowed
  (currently blocked if any booking references it)?
- Do we need soft-delete / cancellation instead of hard delete for bookings?
- Should progress drive any automation (e.g. auto-complete at 100%)?
