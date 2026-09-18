-- Move from a count per drone type to individually tracked drones, each with a
-- unique code. A booking now reserves specific drone units.

-- 1. Individual drones. Each belongs to a type (by name, cascading on rename).
CREATE TABLE drones (
    id         SERIAL PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    drone_type TEXT NOT NULL REFERENCES drone_types (name)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drones_type ON drones (drone_type);

-- 2. Seed one drone per unit of existing stock, with generated codes
--    (e.g. "DJI Mavic 3-001"). These are placeholders the user can rename.
INSERT INTO drones (code, drone_type)
SELECT dt.name || '-' || lpad(gs::text, 3, '0'), dt.name
FROM drone_types dt
CROSS JOIN LATERAL generate_series(1, dt.total_quantity) AS gs;

-- 3. A booking reserves specific drone units.
CREATE TABLE booking_drone_units (
    booking_id UUID    NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    drone_id   INTEGER NOT NULL REFERENCES drones (id)   ON DELETE RESTRICT,
    PRIMARY KEY (booking_id, drone_id)
);
CREATE INDEX idx_bdu_drone ON booking_drone_units (drone_id);

-- 4. Migrate existing count-based lines to specific units. For each old line,
--    assign N units of that type that aren't already committed to a
--    temporally-overlapping booking (greedy, deterministic).
DO $$
DECLARE
    line RECORD;
    unit RECORD;
    assigned INTEGER;
BEGIN
    FOR line IN
        SELECT bd.booking_id, bd.drone_type, bd.number_of_drones,
               b.start_date, b.end_date
        FROM booking_drones bd
        JOIN bookings b ON b.id = bd.booking_id
        ORDER BY b.start_date, bd.booking_id, bd.id
    LOOP
        assigned := 0;
        FOR unit IN
            SELECT d.id
            FROM drones d
            WHERE d.drone_type = line.drone_type
              AND NOT EXISTS (
                  SELECT 1
                  FROM booking_drone_units bdu
                  JOIN bookings ob ON ob.id = bdu.booking_id
                  WHERE bdu.drone_id = d.id
                    AND ob.start_date <= line.end_date
                    AND ob.end_date   >= line.start_date
              )
            ORDER BY d.id
        LOOP
            EXIT WHEN assigned >= line.number_of_drones;
            INSERT INTO booking_drone_units (booking_id, drone_id)
            VALUES (line.booking_id, unit.id);
            assigned := assigned + 1;
        END LOOP;

        -- Fail loudly rather than silently dropping reservations if a booking's
        -- overlapping demand ever exceeds available stock (rolls back the whole
        -- migration so the old data isn't lost).
        IF assigned < line.number_of_drones THEN
            RAISE EXCEPTION 'Cannot migrate booking %: needs % unit(s) of "%" for % to %, but only % were free',
                line.booking_id, line.number_of_drones, line.drone_type,
                line.start_date, line.end_date, assigned;
        END IF;
    END LOOP;
END $$;

-- 5. Drop the old count-based representation.
DROP TABLE booking_drones;
ALTER TABLE drone_types DROP COLUMN total_quantity;
