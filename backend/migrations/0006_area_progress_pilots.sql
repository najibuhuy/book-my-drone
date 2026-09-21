-- Area to cover per booking (hectares). Progress is now DERIVED from daily
-- per-drone area logs, so the manual progress column is removed.
ALTER TABLE bookings
    ADD COLUMN total_area_ha DOUBLE PRECISION NOT NULL DEFAULT 0
        CHECK (total_area_ha >= 0);
ALTER TABLE bookings DROP COLUMN progress;

-- Per-drone operational status.
ALTER TABLE drones
    ADD COLUMN status TEXT NOT NULL DEFAULT 'Standby'
        CHECK (status IN ('Standby', 'Operational', 'Incomplete'));

-- Daily area completed by each assigned drone on a booking. One row per
-- (booking, drone, day); tied to the drone's assignment so it goes away if the
-- drone is unassigned or the booking is deleted.
CREATE TABLE drone_daily_progress (
    id         SERIAL PRIMARY KEY,
    booking_id UUID    NOT NULL,
    drone_id   INTEGER NOT NULL,
    entry_date DATE    NOT NULL,
    area_ha    DOUBLE PRECISION NOT NULL CHECK (area_ha >= 0),
    UNIQUE (booking_id, drone_id, entry_date),
    FOREIGN KEY (booking_id, drone_id)
        REFERENCES booking_drone_units (booking_id, drone_id) ON DELETE CASCADE
);
CREATE INDEX idx_ddp_booking ON drone_daily_progress (booking_id);

-- Pilots, and their per-drone assignment history (independent of bookings).
CREATE TABLE pilots (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE drone_pilot_assignments (
    id         SERIAL PRIMARY KEY,
    drone_id   INTEGER NOT NULL REFERENCES drones (id) ON DELETE CASCADE,
    pilot_id   INTEGER NOT NULL REFERENCES pilots (id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_pilot_range CHECK (end_date >= start_date)
);
CREATE INDEX idx_dpa_drone ON drone_pilot_assignments (drone_id);
