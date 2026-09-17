-- Drone types are stored in the DB so they can be configured from the UI.
CREATE TABLE IF NOT EXISTS drone_types (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drone_type       TEXT NOT NULL,
    project_name     TEXT NOT NULL,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    number_of_drones INTEGER NOT NULL DEFAULT 1 CHECK (number_of_drones >= 1),
    vendor_name      TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    progress         INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    pic              TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings (start_date, end_date);

-- Seed a few default drone types (idempotent).
INSERT INTO drone_types (name) VALUES
    ('DJI Mavic 3'),
    ('DJI Matrice 350 RTK'),
    ('DJI Agras T40'),
    ('Autel EVO II'),
    ('Custom Survey Drone')
ON CONFLICT (name) DO NOTHING;
