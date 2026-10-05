-- Each daily log records which pilot flew it (so hectares can be credited per
-- pilot) and, when the drone couldn't fly, why.
ALTER TABLE drone_daily_progress
    ADD COLUMN pilot_id INTEGER REFERENCES pilots (id) ON DELETE RESTRICT;

ALTER TABLE drone_daily_progress
    ADD COLUMN fail_reason TEXT
        CHECK (fail_reason IN ('Cuaca', 'Drone Issue', 'Crash', 'Genset Issue',
                               'Access Issue', 'Estate Issue'));

CREATE INDEX idx_ddp_date ON drone_daily_progress (entry_date);
CREATE INDEX idx_ddp_pilot ON drone_daily_progress (pilot_id);

-- Back-fill: where a drone had exactly one pilot on a booking, credit that
-- pilot with the drone's existing logs on that booking.
UPDATE drone_daily_progress dp
SET pilot_id = one.pilot_id
FROM (
    SELECT booking_id, drone_id, MIN(pilot_id) AS pilot_id
    FROM booking_drone_pilots
    GROUP BY booking_id, drone_id
    HAVING COUNT(*) = 1
) one
WHERE dp.booking_id = one.booking_id
  AND dp.drone_id = one.drone_id
  AND dp.pilot_id IS NULL;
