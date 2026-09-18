/** An individual drone unit with a unique code. */
export interface Drone {
  id: number;
  code: string;
  drone_type: string;
}

export interface Booking {
  id: string;
  project_name: string;
  start_date: string; // ISO date (YYYY-MM-DD)
  end_date: string; // ISO date (YYYY-MM-DD)
  vendor_name: string;
  description: string;
  progress: number; // 0..100
  pic: string;
  drones: Drone[]; // the specific units reserved
  total_drones: number;
  created_at: string;
  updated_at: string;
}

export interface BookingInput {
  project_name: string;
  start_date: string;
  end_date: string;
  vendor_name: string;
  description: string;
  progress: number;
  pic: string;
  drone_ids: number[]; // specific drone units to reserve
}

/** A drone type (category); quantities are derived from its drones. */
export interface DroneType {
  id: number;
  name: string;
  total_units: number;
  booked_today: number;
}

export interface DroneTypeStat {
  drone_type: string;
  bookings: number;
  total_drones: number;
}

/** A drone unit and whether it is free for a requested date window. */
export interface Availability {
  id: number;
  code: string;
  drone_type: string;
  available: boolean;
}
