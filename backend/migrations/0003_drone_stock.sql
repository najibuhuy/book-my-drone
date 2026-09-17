-- Each drone type now carries a stock: how many the company owns in total.
-- Availability for a booking window is computed as total_quantity minus the
-- drones of that type already committed to OVERLAPPING bookings (hotel-room
-- model), so a drone frees up outside a booking's dates.

ALTER TABLE drone_types
    ADD COLUMN IF NOT EXISTS total_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (total_quantity >= 0);

-- Give the pre-seeded types a usable starting stock.
UPDATE drone_types SET total_quantity = 5 WHERE total_quantity = 0;
