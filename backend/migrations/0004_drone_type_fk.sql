-- Stock math joins booking_drones to drone_types by NAME. Without a foreign
-- key, renaming a drone type left the old name behind on booking rows (breaking
-- availability/overbooking checks) and a type in active use could be deleted,
-- orphaning bookings. Tie the two together by name so the database keeps them
-- consistent: renames cascade, and an in-use type can't be deleted.
ALTER TABLE booking_drones
    ADD CONSTRAINT booking_drones_drone_type_fkey
    FOREIGN KEY (drone_type) REFERENCES drone_types (name)
    ON UPDATE CASCADE ON DELETE RESTRICT;
