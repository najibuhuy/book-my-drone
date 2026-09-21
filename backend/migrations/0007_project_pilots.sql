-- Pilots are assigned to a drone WITHIN a project (booking): assign a drone to
-- the booking, then assign one or more pilots to that drone for that project.
-- This replaces the standalone per-drone date-range assignment table; a drone's
-- pilot history is now derived from its bookings (each booking has dates).
DROP TABLE IF EXISTS drone_pilot_assignments;

CREATE TABLE booking_drone_pilots (
    id         SERIAL PRIMARY KEY,
    booking_id UUID    NOT NULL,
    drone_id   INTEGER NOT NULL,
    pilot_id   INTEGER NOT NULL REFERENCES pilots (id) ON DELETE RESTRICT,
    UNIQUE (booking_id, drone_id, pilot_id),
    -- Can only assign a pilot to a drone that is actually reserved by the
    -- booking; removing the drone from the booking removes its pilots.
    FOREIGN KEY (booking_id, drone_id)
        REFERENCES booking_drone_units (booking_id, drone_id) ON DELETE CASCADE
);
CREATE INDEX idx_bdp_booking ON booking_drone_pilots (booking_id);
CREATE INDEX idx_bdp_drone ON booking_drone_pilots (drone_id);
