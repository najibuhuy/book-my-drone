-- A booking now has a project type. The area field becomes the base "area to
-- cover"; the total area (progress denominator) is area_to_cover_ha × qty_rotation.
-- qty_rotation is only meaningful for Oryctes projects (defaults to 1 otherwise).
ALTER TABLE bookings RENAME COLUMN total_area_ha TO area_to_cover_ha;

ALTER TABLE bookings
    ADD COLUMN qty_rotation INTEGER NOT NULL DEFAULT 1 CHECK (qty_rotation >= 1);

ALTER TABLE bookings
    ADD COLUMN project_type TEXT NOT NULL DEFAULT 'Foliar'
        CHECK (project_type IN ('Bagworm', 'Foliar', 'Oryctes', 'Fertilizer', 'Forestry', 'Trial'));
