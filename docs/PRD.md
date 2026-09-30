# Book My Drone — Product Requirements Document (PRD)

| | |
| --- | --- |
| **Product** | Book My Drone — drone booking dashboard |
| **Status** | Implemented (v0.1) |
| **Author** | Najib Alyasyfi (Najib.Alyasyfi@noovoleum.com) |
| **Last updated** | 2026-09-30 |
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
- G6 — A booking records an **area to cover (in hectares)**; the **total area to
  cover** is derived from it (× rotation, see G11), and progress is **derived**
  from the actual area completed rather than typed in by hand.
- G7 — Each assigned drone logs **daily hectares completed**; the booking's
  progress % is computed from the sum of those logs against the total area.
- G8 — **Pilots** are assigned to a drone **within a project** (booking) —
  **multiple pilots per drone per project** are allowed — and each drone keeps a
  **pilot history across projects** (the dates come from the projects it flew).
- G9 — Each drone carries an operational **status**
  (Standby / Operational / Incomplete).
- G10 — Each booking is classified by **project type**
  (Bagworm / Foliar / Oryctes / Fertilizer / Forestry / Trial).
- G11 — **Oryctes** projects record a **qty rotation** (how many passes over the
  area); total area to cover = area to cover × rotation.
- G12 — The Home page shows, for a selected day, how many drones are
  **available vs in use**, with their codes.
- G13 — The Book page is a **project summary** that estimates each project's
  **finish date** from its actual pace and flags whether it is on track against
  the scheduled end date.

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
- **Area / progress** — a booking has an **area to cover** in hectares
  (`area_to_cover_ha`) and a **qty rotation** (`qty_rotation`, 1 unless Oryctes).
  The **total area to cover** is derived: `total_area_ha = area_to_cover_ha ×
  qty_rotation`, and it is the progress denominator. Progress is **derived, not
  entered**: it is `round(area_done_ha / total_area_ha * 100)` (clamped 0..100),
  where `area_done_ha` is the sum of the booking's per-drone daily logs.
- **Project type** — each booking is one of **Bagworm**, **Foliar**, **Oryctes**,
  **Fertilizer**, **Forestry**, or **Trial** (default Foliar). Only Oryctes uses
  a rotation count other than 1.
- **Estimated finish** — a rate-based ETA computed on the Book page: rate =
  `area_done_ha ÷ days elapsed since start_date`; ETA = today + remaining area ÷
  rate. It is compared against the scheduled `end_date` (on track if ETA ≤ end
  date, behind otherwise).
- **Drone status** — each drone (unit) has an operational status:
  **Standby**, **Operational**, or **Incomplete** (default Standby), set per drone.
- **Pilot / assignment history** — a **pilot** (unique name) is assigned to a
  specific **drone within a booking (project)**; **multiple pilots per drone per
  project** are allowed. Each drone keeps a **pilot history derived from the
  bookings it flew** — each project supplies the dates.

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

- FR-6 A table of all bookings: project, type, dates, the reserved drone codes,
  total, PIC, (derived) progress, estimated finish, and Edit / Delete actions
  (see FR-24).
- FR-7 "New booking" opens a form; the same form edits an existing booking.
- FR-8 The form captures: project name, **project type** (dropdown: Bagworm /
  Foliar / Oryctes / Fertilizer / Forestry / Trial), vendor/booked-by, start
  date, end date, PIC, **Area to cover (HA)**, description, and a **selection of
  specific drone units**. When the type is **Oryctes**, a **Qty rotation** field
  appears; switching to another type resets it to 1. A read-only **Total area to
  cover (HA)** shows `area × rotation`. Area inputs accept 2 decimal places.
  There is **no manual progress input** — progress is derived from daily logs
  (see FR-17).
- FR-9 The unit picker groups available drones by type; each free unit is a
  checkbox showing its code. Units already booked for the chosen dates are shown
  disabled. On edit, the booking's own units are pre-selected.
- FR-10 If the availability lookup fails, the form still submits and relies on
  the server's authoritative check (never silently blocks).
- FR-17 **Daily progress logging (edit mode).** In edit mode the form shows a
  "Daily progress" section where each assigned drone logs **hectares completed per
  day** (date + HA, **2 decimal places**, step 0.01; values display with 2
  decimals). Entries are upserted per `(drone, date)`. A **derived
  progress bar** shows `round(area_done_ha / total_area_ha * 100)`. Each drone
  also shows its own `area_done_ha`.
- FR-18 **Boosting.** From the edit form, staff can **add another drone** to an
  existing booking. Editing diffs the drone set — only removed units are dropped
  and added ones inserted — so daily progress already logged for kept drones is
  preserved.

### 6.3 Stock — G5

- FR-11 List drone types with: name, total owned (unit count), in-use today,
  free today.
- FR-12 Add and delete drone types (delete blocked while the type still has
  drones).
- FR-13 Register individual drones, each with a **unique code** and a type; list
  and delete them (delete blocked while a drone is reserved by a booking).
- FR-19 Each drone has a **Status** dropdown
  (**Standby** / **Operational** / **Incomplete**, default Standby), set and
  updated per drone from the Stock page.

### 6.4 Booking enforcement — G4

- FR-14 On booking create/update, the server verifies every selected drone is
  free for the booking's dates, counting only **overlapping** bookings.
- FR-15 If any selected drone is taken, the whole operation is rejected
  atomically (`409 Conflict`) naming the clashing drone code(s). No partial
  booking is written.
- FR-16 The check is race-safe: concurrent bookings of the same drone cannot both
  succeed (the drone rows are locked `FOR UPDATE` within the transaction).

### 6.5 Pilots — G8

- FR-20 A dedicated **Pilots** page (nav: Home / Book / Stock / Pilots, route
  `/pilots`) manages **pilot names** — staff can **add / delete** pilots. Pilot
  names are **unique**; a pilot still assigned to a drone cannot be deleted.
- FR-21 Staff **assign one or more pilots to each drone inside a booking's edit
  form**: each assigned drone has an add-pilot control (which filters out pilots
  already on that drone) and removable pilot chips. There is **no standalone
  date range** — a pilot is assigned to a drone within a project, and the
  project's dates apply.
- FR-22 The Pilots page includes a **per-drone pilot history** viewer: pick a
  drone to see which pilots flew it on which projects, with dates. The history is
  **derived from the bookings** the drone flew.

### 6.6 Day availability & project summary — G10–G13

- FR-23 **Drones on this day.** Selecting a day on the Home page shows a summary
  card with the count of drones **available** vs **in use** that day, listing
  each group's drone codes. "In use" means reserved by any booking overlapping
  that day, **regardless of the calendar filters**. The day detail card also
  shows each booking's project type badge.
- FR-24 **Project summary (Book page).** The bookings table includes a **Type**
  column (project type badge) and an **Est. finish** column computed
  client-side (see *Estimated finish*): shown green when the ETA is on or before
  the scheduled end date ("on track"), red when later ("behind"), "Complete" at
  100%, and "by *end date*" when the project has not started yet. (The Vendor
  column is omitted from this table; drone chip tooltips include assigned
  pilots.)

## 7. Business rules & validation

- BR-1 `end_date ≥ start_date`.
- BR-2 `progress` is **derived, never entered**:
  `round(area_done_ha / total_area_ha * 100)`, clamped to [0, 100].
- BR-3 A booking must reserve at least one drone.
- BR-4 `project_name`, `vendor_name`, and `pic` are required (non-empty).
- BR-5 Drone codes are unique; drone-type names are unique; **pilot names are
  unique**.
- BR-6 A drone must belong to a type that exists in the catalog.
- BR-7 A drone may be reserved by at most one booking per overlapping window.
- BR-8 Availability is inclusive-overlap: bookings overlap when
  `A.start ≤ B.end AND A.end ≥ B.start`.
- BR-9 `area_to_cover_ha ≥ 0` and each daily-progress `area_ha ≥ 0`.
- BR-10 A daily-progress entry for a drone requires that drone to be **assigned
  to the booking** (enforced by the composite FK to `booking_drone_units`); one
  entry per `(booking, drone, date)`.
- BR-11 `drones.status` must be one of Standby / Operational / Incomplete.
- BR-12 A pilot can only be assigned to a drone that is **reserved by that
  booking** (enforced by the composite FK to `booking_drone_units`).
- BR-13 The same pilot cannot be assigned to the same drone twice in one booking
  (`UNIQUE(booking_id, drone_id, pilot_id)`).
- BR-14 `project_type` must be one of Bagworm / Foliar / Oryctes / Fertilizer /
  Forestry / Trial (otherwise `400`).
- BR-15 `qty_rotation ≥ 1` (otherwise `400`); the UI keeps it at 1 for
  non-Oryctes projects.
- BR-16 `total_area_ha` is **derived, never stored or sent**:
  `total_area_ha = area_to_cover_ha × qty_rotation`.
- BR-17 Area values (`area_to_cover_ha`, daily `area_ha`) may have up to 2
  decimal places.

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
