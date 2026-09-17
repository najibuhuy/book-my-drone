-- A booking is like a hotel reservation: it can contain several drone-type
-- lines, each with its own count (e.g. 2x "DJI Mavic 3" + 3x "Autel EVO II").
-- Move from the single drone_type/number_of_drones columns on `bookings` to a
-- child table `booking_drones`.

CREATE TABLE IF NOT EXISTS booking_drones (
    id               SERIAL PRIMARY KEY,
    booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    drone_type       TEXT NOT NULL,
    number_of_drones INTEGER NOT NULL DEFAULT 1 CHECK (number_of_drones >= 1)
);

CREATE INDEX IF NOT EXISTS idx_booking_drones_booking ON booking_drones (booking_id);

-- Carry existing single-type bookings over as one line each.
INSERT INTO booking_drones (booking_id, drone_type, number_of_drones)
SELECT id, drone_type, number_of_drones FROM bookings;

-- Drop the now-redundant single-type columns.
ALTER TABLE bookings DROP COLUMN IF EXISTS drone_type;
ALTER TABLE bookings DROP COLUMN IF EXISTS number_of_drones;
